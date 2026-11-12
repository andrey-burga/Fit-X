<#
.SYNOPSIS
    VigorCore Phase 3.5.0.7 — Procedimiento Seguro de Consulta de Reglas Remotas
    Consulta en modo SOLO LECTURA (GET) la Firebase Security Rules Management API.

.DESCRIPTION
    Realiza una inspección forense de las reglas actualmente desplegadas en GCP:
    1. Obtiene token de acceso ADC (o gcloud).
    2. Consulta GET https://firebaserules.googleapis.com/v1/projects/{projectId}/releases
    3. Identifica la release asociada a la base nombrada vs (default).
    4. Consulta GET https://firebaserules.googleapis.com/v1/{rulesetName}
    5. Recupera la fuente original de las reglas, calcula su SHA-256 y muestra metadatos.
    6. Opcionalmente guarda el snapshot verificado en disco (UTF-8 sin BOM).

    LÍMITES DE SEGURIDAD:
    - CERO operaciones de escritura o despliegue.
    - CERO modificaciones de IAM o Facturación.
    - CERO creación de rulesets o releases.

.PARAMETER ProjectId
    ID del proyecto Google Cloud (default: "gen-lang-client-0041212770").

.PARAMETER DatabaseId
    ID de la base de datos Firestore nombrada (default: "ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c").

.PARAMETER SaveSnapshot
    Switch para guardar el contenido recuperado en un archivo local.

.PARAMETER OutputPath
    Ruta destino para guardar el snapshot (default: "./firestore.rules.remote-live-snapshot.rules").
#>

[CmdletBinding()]
param(
    [string]$ProjectId = "gen-lang-client-0041212770",
    [string]$DatabaseId = "ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c",
    [switch]$SaveSnapshot,
    [string]$OutputPath = "./firestore.rules.remote-live-snapshot.rules"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host " VIGORCORE — CONSULTA FORENSE DE REGLAS REMOTAS (FIREBASE RULES API)" -ForegroundColor Cyan
Write-Host " Modo: SOLO LECTURA (GET) — Proyecto: $ProjectId" -ForegroundColor Cyan
Write-Host " Base de Datos: $DatabaseId" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan

# 1. Obtención de Token de Acceso
Write-Host "`n[PASO 1/4] Obteniendo token de autorización ADC..." -ForegroundColor Yellow
$token = $null
try {
    $token = (gcloud auth print-access-token 2>$null)
    if ($token) {
        $token = $token.Trim()
    }
}
catch {
    $token = $null
}

if (-not $token) {
    Write-Host "[!] No se detectó un token activo mediante 'gcloud auth print-access-token'." -ForegroundColor Red
    Write-Host "    Asegúrese de haber iniciado sesión con credenciales autorizadas:" -ForegroundColor Yellow
    Write-Host "    > gcloud auth application-default login" -ForegroundColor White
    Write-Host "    o" -ForegroundColor Yellow
    Write-Host "    > gcloud auth login" -ForegroundColor White
    Write-Host "`nDictamen: LIMITACION_ENTORNO — NO_ADC_TOKEN_AVAILABLE" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Token de acceso obtenido satisfactoriamente." -ForegroundColor Green

$headers = @{
    "Authorization" = "Bearer $token"
    "Accept"        = "application/json"
}

# 2. Listar Releases del Proyecto
Write-Host "`n[PASO 2/4] Consultando releases registradas en Firebase Rules API..." -ForegroundColor Yellow
$releasesUrl = "https://firebaserules.googleapis.com/v1/projects/$ProjectId/releases"
$releasesData = $null

try {
    $releasesData = Invoke-RestMethod -Uri $releasesUrl -Headers $headers -Method Get
}
catch {
    Write-Host "[!] Error HTTP al consultar releases: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "    Verifique los permisos del operador (roles/firebaserules.viewer o superior)." -ForegroundColor Yellow
    exit 2
}

if (-not $releasesData -or -not $releasesData.releases -or $releasesData.releases.Count -eq 0) {
    Write-Host "[!] No se encontraron releases publicadas en el proyecto $ProjectId." -ForegroundColor Yellow
    Write-Host "    Esto indica que no se han desplegado reglas a través de Firebase Rules API." -ForegroundColor Yellow
    exit 0
}

Write-Host "[OK] Se encontraron $($releasesData.releases.Count) releases registradas:" -ForegroundColor Green
$targetRelease = $null
$defaultRelease = $null

foreach ($rel in $releasesData.releases) {
    $rName = $rel.name
    $rSet  = $rel.rulesetName
    $uTime = $rel.updateTime
    Write-Host "    - Release: $rName" -ForegroundColor White
    Write-Host "      Ruleset: $rSet" -ForegroundColor Gray
    Write-Host "      Actualizado: $uTime" -ForegroundColor Gray

    if ($rName -like "*$DatabaseId*") {
        $targetRelease = $rel
    }
    elseif ($rName -match "cloud\.firestore$" -or $rName -like "*/(default)") {
        $defaultRelease = $rel
    }
}

# 3. Selección y Diferenciación de Base de Datos
Write-Host "`n[PASO 3/4] Identificando attachment point para la base de datos..." -ForegroundColor Yellow
$selectedRelease = $null

if ($targetRelease) {
    Write-Host "[OK] Release encontrada específicamente para la base nombrada: '$DatabaseId'" -ForegroundColor Green
    $selectedRelease = $targetRelease
}
elseif ($defaultRelease) {
    Write-Host "[AVISO] No existe release específica para '$DatabaseId'. Se detectó release para '(default)'." -ForegroundColor Yellow
    Write-Host "        NOTA: Las reglas de '(default)' NO protegen automáticamente bases nombradas en modo multi-db." -ForegroundColor Yellow
    $selectedRelease = $defaultRelease
}
else {
    Write-Host "[!] No se encontró ninguna release de Firestore (ni nombrada ni default)." -ForegroundColor Red
    exit 3
}

$rulesetName = $selectedRelease.rulesetName
Write-Host "Attachment Point : $($selectedRelease.name)" -ForegroundColor Cyan
Write-Host "Ruleset Name     : $rulesetName" -ForegroundColor Cyan
Write-Host "Create/Update    : $($selectedRelease.updateTime)" -ForegroundColor Cyan

# 4. Recuperación del Ruleset y Fuente Original
Write-Host "`n[PASO 4/4] Descargando código fuente del ruleset..." -ForegroundColor Yellow
$rulesetUrl = "https://firebaserules.googleapis.com/v1/$rulesetName"
$rulesetData = $null

try {
    $rulesetData = Invoke-RestMethod -Uri $rulesetUrl -Headers $headers -Method Get
}
catch {
    Write-Host "[!] Error al obtener el ruleset '$rulesetName': $($_.Exception.Message)" -ForegroundColor Red
    exit 4
}

if (-not $rulesetData.source -or -not $rulesetData.source.files) {
    Write-Host "[!] El ruleset no contiene archivos de reglas legibles." -ForegroundColor Red
    exit 5
}

$rulesFile = $rulesetData.source.files[0]
$rulesContent = $rulesFile.content
$rulesFileName = $rulesFile.name

# Cálculo de Hash SHA-256 del contenido recuperado
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$contentBytes = [System.Text.Encoding]::UTF8.GetBytes($rulesContent)
$hashBytes = $sha256.ComputeHash($contentBytes)
$hashHex = [System.BitConverter]::ToString($hashBytes) -replace "-", ""

Write-Host "`n========================================================================" -ForegroundColor Green
Write-Host " RESUMEN FORENSE DEL RULESET EN VIVO" -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Green
Write-Host "Archivo declarado : $rulesFileName"
Write-Host "Tamaño bytes      : $($contentBytes.Length)"
Write-Host "Líneas de código  : $(($rulesContent -split "`n").Length)"
Write-Host "SHA-256           : $hashHex"
Write-Host "Create Time       : $($rulesetData.createTime)"
Write-Host "Release Name      : $($selectedRelease.name)"
Write-Host "========================================================================" -ForegroundColor Green

if ($SaveSnapshot) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($OutputPath, $rulesContent, $utf8NoBom)
    [System.IO.File]::WriteAllText("$OutputPath.sha256", "$hashHex  $([System.IO.Path]::GetFileName($OutputPath))`n", $utf8NoBom)
    Write-Host "[OK] Snapshot verificado guardado en: $OutputPath" -ForegroundColor Green
    Write-Host "[OK] Hash de verificación guardado en: $OutputPath.sha256" -ForegroundColor Green
}
else {
    Write-Host "[INFO] Para guardar el snapshot en disco use el switch -SaveSnapshot" -ForegroundColor Gray
}

Write-Host "`nDictamen: REMOTE_RULESET_QUERY_COMPLETED" -ForegroundColor Green
