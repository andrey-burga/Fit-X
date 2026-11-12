<#
.SYNOPSIS
    VigorCore Phase 3.5.0.10 — Procesamiento Robusto de Respuestas Firebase Rules API
    Consulta en modo ESTRICTO DE SOLO LECTURA (GET) la Firebase Security Rules Management API.

.DESCRIPTION
    Realiza una inspección forense de las reglas actualmente desplegadas en GCP:
    1. Obtiene token de acceso ADC estricto mediante 'gcloud auth application-default print-access-token'
       en memoria, verificando que no esté vacío, sin persistirlo ni exponerlo en logs.
    2. Accede a todas las propiedades de respuestas de Invoke-RestMethod mediante inspección
       defensiva de PSObject.Properties, evitando excepciones en PowerShell 5.1 bajo Set-StrictMode.
    3. Consulta GET https://firebaserules.googleapis.com/v1/projects/{projectId}/releases
       gestionando paginación exhaustiva mediante nextPageToken de forma segura.
    4. Identifica la release mediante COINCIDENCIA EXACTA con la ruta canónica:
       projects/{projectId}/releases/cloud.firestore/{databaseId}
       Rechaza coincidencias parciales, release de (default), rutas alternativas no canónicas
       y resultados múltiples ambiguos. Si no existe, emite NO_MATCH y finaliza sin consultar rulesets.
    5. Valida que rulesetName cumpla el patrón canónico projects/{projectId}/rulesets/{id}.
    6. Consulta GET https://firebaserules.googleapis.com/v1/{rulesetName} (única llamada adicional).
    7. Valida que source.files exista, no esté vacío y contenga EXACTAMENTE un archivo.
       Si contiene más de un archivo, aborta con MULTI_FILE_RULESET.
    8. Valida attachment_point si se encuentra presente, aceptando exclusivamente los formatos:
       - firestore.googleapis.com/projects/{project_number}/databases/{database_id}
       - firestore.googleapis.com/databases/{database_id}
       Rechazando attachment_point vacío, de (default), de otra base o con project number distinto.
    9. Calcula SHA-256 del contenido recuperado y muestra metadatos observados.
    10. Si se especifica -SaveSnapshot:
       - Valida protección anti-sobrescritura sin -AllowOverwrite.
       - Escribe atómicamente a través de archivo temporal .tmp con UTF-8 sin BOM.
       - Verifica la integridad del hash en disco antes de promover el archivo.
       - Genera companion .sha256 y un manifiesto .manifest.json con metadatos forenses (sin credenciales).

    LÍMITES DE SEGURIDAD ABSOLUTOS:
    - CERO operaciones remotas de escritura (N GETs para releases, 1 GET para ruleset; N >= 1).
    - CERO modificaciones de IAM o Facturación.
    - CERO creación o publicación de rulesets o releases.
    - CERO sustitución de bases de datos.

.PARAMETER ProjectId
    ID del proyecto Google Cloud (default: "gen-lang-client-0041212770").

.PARAMETER DatabaseId
    ID de la base de datos Firestore nombrada (default: "ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c").

.PARAMETER ProjectNumber
    Project number verificado en GCP (default: "510844325101").

.PARAMETER SaveSnapshot
    Switch para autorizar el guardado local del snapshot verificado.

.PARAMETER OutputPath
    Ruta destino para guardar el snapshot (default: ".data/firestore-export/control/firestore.rules.remote-live-snapshot.rules").

.PARAMETER AllowOverwrite
    Switch explícito obligatorio para autorizar la sobrescritura de un snapshot local preexistente.
#>

[CmdletBinding()]
param(
    [string]$ProjectId = "gen-lang-client-0041212770",
    [string]$DatabaseId = "ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c",
    [string]$ProjectNumber = "510844325101",
    [switch]$SaveSnapshot,
    [string]$OutputPath = ".data/firestore-export/control/firestore.rules.remote-live-snapshot.rules",
    [switch]$AllowOverwrite
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Helper de acceso defensivo a propiedades de PSObject para Windows PowerShell 5.1
function Get-SafePropertyValue {
    param(
        [Parameter(Mandatory = $false)]
        $Target,
        [Parameter(Mandatory = $true)]
        [string]$PropertyName
    )

    if ($null -eq $Target) {
        return $null
    }

    if ($Target.PSObject -and $null -ne $Target.PSObject.Properties[$PropertyName]) {
        return $Target.PSObject.Properties[$PropertyName].Value
    }

    return $null
}

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host " VIGORCORE — CONSULTA FORENSE DE REGLAS REMOTAS (FASE 3.5.0.10)" -ForegroundColor Cyan
Write-Host " Modo: ESTRICTO DE SOLO LECTURA (GET) — Proyecto: $ProjectId" -ForegroundColor Cyan
Write-Host " Base de Datos Nombrada: $DatabaseId" -ForegroundColor Cyan
Write-Host " Project Number: $ProjectNumber" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan

# 1. Obtención de Token de Acceso ADC Estricto (Sin exponer en logs)
Write-Host "`n[PASO 1/5] Obteniendo token de autorización Application Default (ADC)..." -ForegroundColor Yellow
$token = $null
try {
    $token = (gcloud auth application-default print-access-token 2>$null)
    if ($token) {
        $token = $token.Trim()
    }
}
catch {
    $token = $null
}

if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Host "[!] ERROR: No se pudo obtener un token ADC válido mediante 'gcloud auth application-default print-access-token'." -ForegroundColor Red
    Write-Host "    Asegúrese de haber iniciado sesión con credenciales Application Default autorizadas:" -ForegroundColor Yellow
    Write-Host "    > gcloud auth application-default login" -ForegroundColor White
    Write-Host "`nDictamen: LIMITACION_ENTORNO — NO_ADC_TOKEN_AVAILABLE" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Token de acceso ADC disponible en memoria (no persistido ni expuesto)." -ForegroundColor Green

$headers = @{
    "Authorization" = "Bearer $token"
    "Accept"        = "application/json"
}

# 2. Listar Releases del Proyecto con Paginación Exhaustiva Defensiva
Write-Host "`n[PASO 2/5] Consultando releases registradas en Firebase Rules API (GET con paginación)..." -ForegroundColor Yellow
$allReleases = @()
$pageToken = ""
$pageCount = 0

do {
    $pageCount++
    $releasesUrl = "https://firebaserules.googleapis.com/v1/projects/$ProjectId/releases"
    if (-not [string]::IsNullOrWhiteSpace($pageToken)) {
        $releasesUrl += "?pageToken=$pageToken"
    }

    $releasesData = $null
    try {
        $releasesData = Invoke-RestMethod -Uri $releasesUrl -Headers $headers -Method Get
    }
    catch {
        $httpStatus = $null
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $httpStatus = [int]$_.Exception.Response.StatusCode
        }
        Write-Host "[!] Error HTTP al consultar releases (Página $pageCount): $($_.Exception.Message)" -ForegroundColor Red
        if ($httpStatus) {
            Write-Host "    Código HTTP recibido: $httpStatus" -ForegroundColor Yellow
        }
        exit 2
    }

    # Validación estructural del objeto de respuesta
    if ($null -eq $releasesData -or -not ($releasesData.PSObject)) {
        Write-Host "[!] ERROR: Respuesta HTTP inválida o no deserializable como objeto JSON." -ForegroundColor Red
        Write-Host "`nDictamen: API_RESPONSE_SCHEMA_INVALID" -ForegroundColor Red
        exit 2
    }

    # Extracción segura de la propiedad opcional 'releases'
    $releasesVal = Get-SafePropertyValue -Target $releasesData -PropertyName "releases"
    if ($null -ne $releasesVal) {
        $allReleases += @($releasesVal)
    }

    # Extracción segura de la propiedad opcional 'nextPageToken' (previene error de StrictMode)
    $nextPageVal = Get-SafePropertyValue -Target $releasesData -PropertyName "nextPageToken"
    if ($null -ne $nextPageVal -and -not [string]::IsNullOrWhiteSpace($nextPageVal)) {
        $pageToken = [string]$nextPageVal
        Write-Host "    Página $pageCount recibida. nextPageToken presente, continuando paginación..." -ForegroundColor Gray
    } else {
        $pageToken = $null
        Write-Host "    Página $pageCount recibida. nextPageToken ausente (paginación completada)." -ForegroundColor Gray
    }
} while (-not [string]::IsNullOrWhiteSpace($pageToken))

Write-Host "[OK] Paginación finalizada: $($allReleases.Count) releases recuperadas a lo largo de $pageCount solicitud(es) GET." -ForegroundColor Green

if ($allReleases.Count -eq 0) {
    Write-Host "[!] El proyecto $ProjectId no tiene releases registradas." -ForegroundColor Yellow
    Write-Host "`nDictamen: NO_MATCH — RELEASE_NOT_FOUND_FOR_NAMED_DATABASE" -ForegroundColor Red
    exit 3
}

# 3. Validación de Coincidencia Exacta con la Release Canónica
Write-Host "`n[PASO 3/5] Validando coincidencia exacta con la release canónica..." -ForegroundColor Yellow
$canonicalReleaseName = "projects/$ProjectId/releases/cloud.firestore/$DatabaseId"
Write-Host "Ruta Canónica Esperada: $canonicalReleaseName" -ForegroundColor Cyan

$exactMatches = @()
$partialMatches = @()
$defaultDetected = $false

foreach ($rel in $allReleases) {
    if ($null -eq $rel -or -not ($rel.PSObject)) {
        continue
    }

    $rName = Get-SafePropertyValue -Target $rel -PropertyName "name"
    if ([string]::IsNullOrWhiteSpace($rName)) {
        continue
    }

    if ($rName -eq $canonicalReleaseName) {
        $exactMatches += $rel
    }
    elseif ($rName -like "*$DatabaseId*") {
        $partialMatches += $rel
    }
    elseif ($rName -match "cloud\.firestore$" -or $rName -like "*/(default)") {
        $defaultDetected = $true
    }
}

if ($exactMatches.Count -eq 0) {
    Write-Host "[!] NO_MATCH: No se encontró release con coincidencia EXACTA para '$canonicalReleaseName'." -ForegroundColor Red
    if ($partialMatches.Count -gt 0) {
        Write-Host "    AVISO: Se detectaron $($partialMatches.Count) coincidencia(s) parcial(es) o no canónica(s):" -ForegroundColor Yellow
        foreach ($pm in $partialMatches) {
            $pmName = Get-SafePropertyValue -Target $pm -PropertyName "name"
            Write-Host "      - $pmName" -ForegroundColor Yellow
        }
        Write-Host "    POLÍTICA: Las coincidencias parciales son estrictamente rechazadas por seguridad." -ForegroundColor Yellow
    }
    if ($defaultDetected) {
        Write-Host "    AVISO: Se detectó release para '(default)'. En Firestore Enterprise Multi-Database, (default) no protege bases nombradas." -ForegroundColor Yellow
        Write-Host "    POLÍTICA: Queda prohibida la sustitución de releases de (default)." -ForegroundColor Yellow
    }
    Write-Host "`nDictamen: NO_MATCH — RELEASE_NOT_FOUND_FOR_NAMED_DATABASE" -ForegroundColor Red
    exit 3
}

if ($exactMatches.Count -gt 1) {
    Write-Host "[!] ERROR: Se detectaron múltiples releases ($($exactMatches.Count)) con el mismo nombre canónico exacto." -ForegroundColor Red
    Write-Host "`nDictamen: AMBIGUOUS_RELEASES_DETECTED" -ForegroundColor Red
    exit 3
}

$targetRelease = $exactMatches[0]
$targetName = Get-SafePropertyValue -Target $targetRelease -PropertyName "name"
$rulesetName = Get-SafePropertyValue -Target $targetRelease -PropertyName "rulesetName"
$updateTime = Get-SafePropertyValue -Target $targetRelease -PropertyName "updateTime"

if ([string]::IsNullOrWhiteSpace($rulesetName)) {
    Write-Host "[!] ERROR: La release canónica no contiene la propiedad obligatoria 'rulesetName'." -ForegroundColor Red
    Write-Host "`nDictamen: API_RESPONSE_SCHEMA_INVALID" -ForegroundColor Red
    exit 3
}

Write-Host "[OK] Coincidencia EXACTA unívoca confirmada:" -ForegroundColor Green
Write-Host "    Release Name : $targetName" -ForegroundColor Cyan
Write-Host "    Ruleset Name : $rulesetName" -ForegroundColor Cyan
Write-Host "    UpdateTime   : $updateTime" -ForegroundColor Cyan

# Validación de formato del rulesetName
$rulesetRegex = "^projects/$ProjectId/rulesets/[a-zA-Z0-9_\-]+$"
if ($rulesetName -notmatch $rulesetRegex) {
    Write-Host "[!] ERROR: rulesetName no cumple el formato canónico 'projects/$ProjectId/rulesets/{id}': '$rulesetName'" -ForegroundColor Red
    exit 3
}

# 4. Recuperación del Ruleset y Validación Estricta de attachment_point y source.files (GET)
Write-Host "`n[PASO 4/5] Descargando definición del ruleset referenciado (GET)..." -ForegroundColor Yellow
$rulesetUrl = "https://firebaserules.googleapis.com/v1/$rulesetName"
$rulesetData = $null

try {
    $rulesetData = Invoke-RestMethod -Uri $rulesetUrl -Headers $headers -Method Get
}
catch {
    Write-Host "[!] Error HTTP al recuperar ruleset '$rulesetName': $($_.Exception.Message)" -ForegroundColor Red
    exit 4
}

if ($null -eq $rulesetData -or -not ($rulesetData.PSObject)) {
    Write-Host "[!] ERROR: Respuesta de ruleset inválida o no deserializable como objeto." -ForegroundColor Red
    Write-Host "`nDictamen: API_RESPONSE_SCHEMA_INVALID" -ForegroundColor Red
    exit 4
}

# 4.1. Validación estricta de attachment_point en Ruleset (el objeto Release no contiene este campo)
$rawAttachmentPoint = Get-SafePropertyValue -Target $rulesetData -PropertyName "attachment_point"
if ($null -eq $rawAttachmentPoint) {
    $rawAttachmentPoint = Get-SafePropertyValue -Target $rulesetData -PropertyName "attachmentPoint"
}

if ($null -eq $rawAttachmentPoint -or [string]::IsNullOrWhiteSpace($rawAttachmentPoint)) {
    Write-Host "[!] ERROR: El Ruleset '$rulesetName' no contiene la propiedad obligatoria 'attachment_point'." -ForegroundColor Red
    Write-Host "`nDictamen: ATTACHMENT_POINT_MISSING" -ForegroundColor Red
    exit 4
}

$rawAttachmentStr = [string]$rawAttachmentPoint
$expectedFullAttachment = "firestore.googleapis.com/projects/$ProjectNumber/databases/$DatabaseId"
$expectedShortAttachment = "firestore.googleapis.com/databases/$DatabaseId"

if ($rawAttachmentStr -ne $expectedFullAttachment -and $rawAttachmentStr -ne $expectedShortAttachment) {
    Write-Host "[!] ERROR: attachment_point discrepante con la base nombrada o project number." -ForegroundColor Red
    Write-Host "    Recibido: '$rawAttachmentStr'" -ForegroundColor Yellow
    Write-Host "    Esperado: '$expectedFullAttachment' o '$expectedShortAttachment'" -ForegroundColor Yellow
    exit 4
}
Write-Host "[OK] attachment_point del Ruleset verificado con éxito: $rawAttachmentStr" -ForegroundColor Green

# 4.2. Extracción y Validación de source.files (únicamente después de validar attachment_point)
$sourceVal = Get-SafePropertyValue -Target $rulesetData -PropertyName "source"
if ($null -eq $sourceVal -or -not ($sourceVal.PSObject)) {
    Write-Host "[!] ERROR: El ruleset no contiene la estructura 'source'." -ForegroundColor Red
    Write-Host "`nDictamen: API_RESPONSE_SCHEMA_INVALID" -ForegroundColor Red
    exit 5
}

$filesVal = Get-SafePropertyValue -Target $sourceVal -PropertyName "files"
if ($null -eq $filesVal) {
    Write-Host "[!] ERROR: El ruleset no contiene la lista 'source.files'." -ForegroundColor Red
    Write-Host "`nDictamen: API_RESPONSE_SCHEMA_INVALID" -ForegroundColor Red
    exit 5
}

$files = @($filesVal)
if ($files.Count -eq 0) {
    Write-Host "[!] ERROR: La lista 'source.files' está vacía." -ForegroundColor Red
    exit 5
}

Write-Host "[OK] Archivos detectados en el ruleset ($($files.Count)):" -ForegroundColor Green
foreach ($f in $files) {
    $fName = Get-SafePropertyValue -Target $f -PropertyName "name"
    Write-Host "    - $fName" -ForegroundColor White
}

if ($files.Count -gt 1) {
    Write-Host "[!] MULTI_FILE_RULESET: El ruleset contiene $($files.Count) archivos. La política exige exactamente 1 archivo." -ForegroundColor Red
    Write-Host "    Abortando para evitar combinación o pérdida de código." -ForegroundColor Yellow
    exit 5
}

$rulesFile = $files[0]
if ($null -eq $rulesFile -or -not ($rulesFile.PSObject)) {
    Write-Host "[!] ERROR: El archivo de reglas no es un objeto válido." -ForegroundColor Red
    exit 5
}

$rulesContent = Get-SafePropertyValue -Target $rulesFile -PropertyName "content"
$rulesFileName = Get-SafePropertyValue -Target $rulesFile -PropertyName "name"

if ($null -eq $rulesContent) {
    Write-Host "[!] ERROR: El archivo de reglas no contiene la propiedad obligatoria 'content'." -ForegroundColor Red
    exit 5
}

# Cálculo de Hash SHA-256
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$contentBytes = [System.Text.Encoding]::UTF8.GetBytes($rulesContent)
$hashBytes = $sha256.ComputeHash($contentBytes)
$hashHex = [System.BitConverter]::ToString($hashBytes) -replace "-", ""

$rulesetCreateTime = Get-SafePropertyValue -Target $rulesetData -PropertyName "createTime"

Write-Host "`n========================================================================" -ForegroundColor Green
Write-Host " RESUMEN FORENSE DEL RULESET EN VIVO (OBSERVADO)" -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Green
Write-Host "Archivo declarado : $rulesFileName"
Write-Host "Tamaño bytes      : $($contentBytes.Length)"
Write-Host "Líneas de código  : $(($rulesContent -split "`n").Length)"
Write-Host "SHA-256           : $hashHex"
Write-Host "Create Time       : $rulesetCreateTime"
Write-Host "Release Name      : $targetName"
Write-Host "Attachment Point  : $expectedFullAttachment"
Write-Host "========================================================================" -ForegroundColor Green

# 5. Guardado Seguro de Snapshot con Anti-Sobrescritura y Manifiesto
if ($SaveSnapshot) {
    Write-Host "`n[PASO 5/5] Procediendo al guardado seguro de snapshot local..." -ForegroundColor Yellow

    $outputDir = [System.IO.Path]::GetDirectoryName($OutputPath)
    if ($outputDir -and -not (Test-Path $outputDir)) {
        New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    }

    $shaPath = "$OutputPath.sha256"
    $manifestPath = "$OutputPath.manifest.json"

    # Verificación estricta de preexistencia sin -AllowOverwrite
    if (-not $AllowOverwrite) {
        if (Test-Path $OutputPath) {
            Write-Host "[!] BLOQUEO ANTI-SOBRESCRITURA: El archivo '$OutputPath' ya existe." -ForegroundColor Red
            Write-Host "    Para autorizar la sobrescritura, suministre el switch explícito -AllowOverwrite." -ForegroundColor Yellow
            exit 6
        }
        if (Test-Path $shaPath) {
            Write-Host "[!] BLOQUEO ANTI-SOBRESCRITURA: El archivo '$shaPath' ya existe." -ForegroundColor Red
            Write-Host "    Para autorizar la sobrescritura, suministre el switch explícito -AllowOverwrite." -ForegroundColor Yellow
            exit 6
        }
        if (Test-Path $manifestPath) {
            Write-Host "[!] BLOQUEO ANTI-SOBRESCRITURA: El archivo '$manifestPath' ya existe." -ForegroundColor Red
            Write-Host "    Para autorizar la sobrescritura, suministre el switch explícito -AllowOverwrite." -ForegroundColor Yellow
            exit 6
        }
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $tmpPath = "$OutputPath.tmp"

    try {
        # Escritura atómica a archivo temporal
        $fileStream = [System.IO.File]::Open($tmpPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        $writer = New-Object System.IO.StreamWriter($fileStream, $utf8NoBom)
        $writer.Write($rulesContent)
        $writer.Flush()
        $writer.Close()
        $fileStream.Close()

        # Validación post-escritura antes de mover
        $savedBytes = [System.IO.File]::ReadAllBytes($tmpPath)
        $savedHashBytes = $sha256.ComputeHash($savedBytes)
        $savedHashHex = [System.BitConverter]::ToString($savedHashBytes) -replace "-", ""

        if ($savedHashHex -ne $hashHex) {
            Remove-Item -Path $tmpPath -Force -ErrorAction SilentlyContinue
            throw "Integridad comprometida: el hash del archivo grabado no coincide con el descargado."
        }

        # Promoción atómica
        Move-Item -Path $tmpPath -Destination $OutputPath -Force

        # Escritura del archivo .sha256 companion
        [System.IO.File]::WriteAllText($shaPath, "$hashHex  $([System.IO.Path]::GetFileName($OutputPath))`n", $utf8NoBom)

        # Creación de manifiesto forense sin credenciales
        $manifestObj = [ordered]@{
            capturedAtUtc    = [DateTimeOffset]::UtcNow.ToString("o")
            projectId        = $ProjectId
            projectNumber    = $ProjectNumber
            databaseId       = $DatabaseId
            canonicalRelease = $canonicalReleaseName
            rulesetName      = $rulesetName
            rulesFileName    = $rulesFileName
            sizeBytes        = $contentBytes.Length
            lineCount        = ($rulesContent -split "`n").Length
            sha256           = $hashHex
            attachmentPoint  = $expectedFullAttachment
            classification   = "OBSERVED_LIVE_SNAPSHOT"
            statement        = "Snapshot remoto observado en vivo en la fecha y hora indicadas. NO constituye un respaldo historico previo a Fase 7D."
        }
        $manifestJson = ConvertTo-Json $manifestObj -Depth 5
        [System.IO.File]::WriteAllText($manifestPath, $manifestJson, $utf8NoBom)

        Write-Host "[OK] Snapshot guardado en: $OutputPath" -ForegroundColor Green
        Write-Host "[OK] Hash companion guardado en: $shaPath" -ForegroundColor Green
        Write-Host "[OK] Manifiesto forense guardado en: $manifestPath" -ForegroundColor Green
    }
    catch {
        if (Test-Path $tmpPath) {
            Remove-Item -Path $tmpPath -Force -ErrorAction SilentlyContinue
        }
        Write-Host "[!] Error durante el guardado: $($_.Exception.Message)" -ForegroundColor Red
        exit 7
    }
}
else {
    Write-Host "`n[INFO] Para guardar el snapshot en disco use los parámetros -SaveSnapshot y -OutputPath." -ForegroundColor Gray
}

Write-Host "`nDictamen: REMOTE_RULESET_QUERY_COMPLETED" -ForegroundColor Green
