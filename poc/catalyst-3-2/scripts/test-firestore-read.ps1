# ==============================================================================
# VIGORCORE — PRUEBA DE CONECTIVIDAD FIRESTORE READ-ONLY MEDIANTE REST Y ADC LOCAL
# Archivo: poc/catalyst-3-2/scripts/test-firestore-read.ps1
# Entorno objetivo: Estación Windows local del desarrollador (PowerShell 5.1 / 7+)
# Requisitos: gcloud CLI autenticado mediante 'gcloud auth application-default login'
# ==============================================================================

[CmdletBinding()]
param (
    [string]$ProjectId = "gen-lang-client-0041212770",
    [string]$DatabaseId = "ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c",
    [string]$DocumentPath = "_system_/audit_read_probe"
)

# Permitir sobreescritura mediante variables de entorno si existen
if ($env:GCP_PROJECT_ID) { $ProjectId = $env:GCP_PROJECT_ID }
if ($env:FIRESTORE_DATABASE_ID) { $DatabaseId = $env:FIRESTORE_DATABASE_ID }
if ($env:FIRESTORE_AUDIT_DOC_PATH) { $DocumentPath = $env:FIRESTORE_AUDIT_DOC_PATH }

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host " VIGORCORE: AUDITORIA REST READ-ONLY FIRESTORE (ADC LOCAL)              " -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host " - Proyecto GCP Objetivo:   $ProjectId"
Write-Host " - Firestore Database ID:   $DatabaseId"
Write-Host " - Documento de Sondeo:     $DocumentPath"
Write-Host " - Modo de Operacion:       STRICT READ-ONLY (API REST oficial, 0 escrituras)"
Write-Host " - Dependencias requeridas: CERO (PowerShell nativo + gcloud CLI)"
Write-Host "------------------------------------------------------------------------"

# 1. Obtención del token ADC en memoria mediante gcloud CLI
Write-Host "`n[1/3] Obteniendo Access Token desde Application Default Credentials..." -ForegroundColor Yellow

$gcloudCmd = Get-Command "gcloud" -ErrorAction SilentlyContinue
if (-not $gcloudCmd) {
    Write-Host "[ERROR FATAL]: Google Cloud SDK ('gcloud') no esta disponible en el PATH." -ForegroundColor Red
    Write-Host "Asegurese de tener instalado Google Cloud CLI en su estacion de trabajo." -ForegroundColor Yellow
    exit 1
}

# Obtener token en memoria de forma segura (sin imprimir ni escribir a disco)
$tokenOutput = & gcloud auth application-default print-access-token 2>&1
$rawToken = $tokenOutput -join ""

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($rawToken) -or $rawToken -match "ERROR" -or $rawToken -match "Traceback") {
    Write-Host "[ERROR FATAL]: No se pudo obtener el token ADC desde gcloud." -ForegroundColor Red
    Write-Host "Detalle del error de gcloud: $rawToken" -ForegroundColor DarkRed
    Write-Host "`nAccion correctiva recomendada:" -ForegroundColor Yellow
    Write-Host "Ejecute previamente en su terminal:" -ForegroundColor White
    Write-Host "    gcloud auth application-default login" -ForegroundColor Cyan
    exit 1
}

$token = $rawToken.Trim()
Write-Host " -> Token ADC obtenido satisfactoriamente en memoria." -ForegroundColor Green
Write-Host " -> Regla de Seguridad: Token protegido en memoria volatil (no impreso, no persistido)." -ForegroundColor Gray

# 2. Detección de Quota Project en ADC local (si existe)
$quotaProject = $null
$adcFilePath = Join-Path $env:APPDATA "gcloud\application_default_credentials.json"
if (Test-Path $adcFilePath) {
    try {
        $adcJson = Get-Content $adcFilePath -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($adcJson.quota_project_id) {
            $quotaProject = $adcJson.quota_project_id
            Write-Host " -> Quota Project detectado en ADC local: $quotaProject" -ForegroundColor Gray
        }
    } catch {
        # Continuar sin quota project explícito si no se puede parsear
    }
}

# 3. Preparación de la petición HTTP REST
Write-Host "`n[2/3] Enviando consulta REST a Cloud Firestore API v1..." -ForegroundColor Yellow

# Endpoint REST oficial de Firestore v1 para lectura de documento:
# GET https://firestore.googleapis.com/v1/projects/{projectId}/databases/{databaseId}/documents/{documentPath}
$encodedDocPath = [System.Uri]::EscapeUriString($DocumentPath)
$restUri = "https://firestore.googleapis.com/v1/projects/$ProjectId/databases/$DatabaseId/documents/$encodedDocPath?mask.fieldPaths=__meta_probe_only__"

$headers = @{
    "Authorization" = "Bearer $token"
    "Accept"        = "application/json"
}

if (-not [string]::IsNullOrEmpty($quotaProject)) {
    $headers["x-goog-user-project"] = $quotaProject
}

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$responseStatus = 0
$responseBody = $null
$httpException = $null

try {
    # Usar Invoke-WebRequest con control estricto de errores
    $response = Invoke-WebRequest -Uri $restUri -Headers $headers -Method Get -UseBasicParsing -ErrorAction Stop
    $stopwatch.Stop()
    $responseStatus = [int]$response.StatusCode
    $responseBody = $response.Content | ConvertFrom-Json -ErrorAction SilentlyContinue
}
catch {
    $stopwatch.Stop()
    $httpException = $_
    
    # Extraer código de estado HTTP y cuerpo de respuesta
    if ($_.Exception.Response) {
        $responseStatus = [int]$_.Exception.Response.StatusCode
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $rawContent = $reader.ReadToEnd()
            $responseBody = $rawContent | ConvertFrom-Json -ErrorAction SilentlyContinue
        } catch {
            $responseBody = $null
        }
    }
}

# 4. Evaluación y Diagnóstico de Resultados
Write-Host "`n[3/3] EVALUACION Y DIAGNOSTICO DE RESULTADOS" -ForegroundColor Cyan
Write-Host "------------------------------------------------------------------------"
$durationMs = [Math]::Round($stopwatch.Elapsed.TotalMilliseconds, 2)
Write-Host " - Latencia de Respuesta:      $durationMs ms"
Write-Host " - Codigo de Estado HTTP:     $responseStatus"

# A. HTTP 200: Lectura Autorizada y Documento Existente
if ($responseStatus -eq 200) {
    $resourceName = if ($responseBody -and $responseBody.name) {
        $responseBody.name
    } elseif ($response -and $response.Content -match '"name"\s*:\s*"([^"]+)"') {
        $matches[1]
    } else {
        "projects/$ProjectId/databases/$DatabaseId/documents/$DocumentPath"
    }

    Write-Host " - Estado de Autorizacion:    AUTORIZADO (Lectura concedida por Google Cloud IAM)" -ForegroundColor Green
    Write-Host " - Existencia del Documento:  DOCUMENTO EXISTE" -ForegroundColor Green
    Write-Host " - Recurso Identificado:      $resourceName" -ForegroundColor Gray
    Write-Host " - Proteccion de Datos:       Contenido oculto (Invariante de privacidad garantizado)" -ForegroundColor Gray
    Write-Host "`n[VEREDICTO]: PASS-INTEGRATION — Firestore responde autorizadamente mediante ADC local sin reactivar Billing." -ForegroundColor Green
    exit 0
}

# B. HTTP 404: Documento Inexistente o Base de Datos Inexistente
if ($responseStatus -eq 404) {
    $errorMsg = if ($responseBody.error.message) { $responseBody.error.message } else { "Recurso no encontrado" }
    
    if ($errorMsg -match "database.*not found" -or $errorMsg -match "Database.*does not exist") {
        Write-Host " - Estado de Autorizacion:    DENEGADO / NO ENCONTRADO" -ForegroundColor Red
        Write-Host " - Diagnostico:               DATABASE_NOT_FOUND" -ForegroundColor Red
        Write-Host " - Detalle Tecnico:           La base de datos nombrada '$DatabaseId' no existe en el proyecto '$ProjectId'." -ForegroundColor Yellow
        exit 1
    } else {
        # Si la base de datos existe y responde 404 porque el DOCUMENTO específico no existe,
        # significa que la autorización IAM fue APROBADA (el servidor procesó la petición).
        Write-Host " - Estado de Autorizacion:    AUTORIZADO (Lectura procesada por IAM)" -ForegroundColor Green
        Write-Host " - Existencia del Documento:  NO EXISTE (404 Documento Inexistente, pero lectura autorizada)" -ForegroundColor Yellow
        Write-Host " - Diagnostico:               DOCUMENT_NOT_FOUND (Data Plane 100% activo y accesible)" -ForegroundColor Green
        Write-Host " - Detalle del Servidor:      $errorMsg" -ForegroundColor Gray
        Write-Host "`n[VEREDICTO]: PASS-INTEGRATION — La conectividad REST y la autorizacion ADC estan demostradas con exito." -ForegroundColor Green
        exit 0
    }
}

# C. HTTP 403: Forbidden / Denegado
if ($responseStatus -eq 403) {
    $errorMsg = if ($responseBody.error.message) { $responseBody.error.message } else { $httpException.Exception.Message }
    $errorStatus = if ($responseBody.error.status) { $responseBody.error.status } else { "FORBIDDEN" }
    
    Write-Host " - Estado de Autorizacion:    DENEGADO (HTTP 403)" -ForegroundColor Red
    Write-Host " - Status gRPC / REST:        $errorStatus" -ForegroundColor Yellow
    Write-Host " - Detalle del Servidor:      $errorMsg" -ForegroundColor Yellow
    
    if ($errorMsg -match "billing" -or $errorMsg -match "account has been closed" -or $errorMsg -match "Billing") {
        Write-Host "`n[DIAGNOSTICO]: BILLING_DISABLED — Google Cloud bloqueo expresamente la llamada por facturacion." -ForegroundColor Red
    } elseif ($errorMsg -match "API has not been used" -or $errorMsg -match "has not been enabled") {
        Write-Host "`n[DIAGNOSTICO]: API_DISABLED — La API de Cloud Firestore / Datastore no esta habilitada en el proyecto." -ForegroundColor Red
    } else {
        Write-Host "`n[DIAGNOSTICO]: PERMISSION_DENIED / IAM_INVESTIGATION" -ForegroundColor Yellow
        Write-Host "Posibles causas a verificar en la estacion local:" -ForegroundColor White
        Write-Host " 1. Verifique si 'quota_project_id' en su ADC coincide con '$ProjectId'." -ForegroundColor Gray
        Write-Host " 2. Compruebe si la cuenta activa en ADC coincide exactamente con 'jhonyandreyburga@gmail.com'." -ForegroundColor Gray
        Write-Host " 3. Ejecute para comprobar la cuenta activa: gcloud auth application-default print-access-token" -ForegroundColor Gray
    }
    exit 1
}

# D. HTTP 401: Unauthorized
if ($responseStatus -eq 401) {
    Write-Host " - Estado de Autorizacion:    NO AUTENTICADO (HTTP 401)" -ForegroundColor Red
    Write-Host " - Diagnostico:               UNAUTHENTICATED — El token ADC expiro o es invalido." -ForegroundColor Red
    Write-Host "Ejecute 'gcloud auth application-default login' para refrescar la credencial." -ForegroundColor Yellow
    exit 1
}

# E. Otros errores (429, 500, Red)
Write-Host " - Estado de Autorizacion:    ERROR NO CLASIFICADO (HTTP $responseStatus)" -ForegroundColor Red
if ($responseBody.error.message) {
    Write-Host " - Mensaje del Servidor:      $($responseBody.error.message)" -ForegroundColor Yellow
} else {
    Write-Host " - Excepcion:                 $($httpException.Exception.Message)" -ForegroundColor Yellow
}
exit 1
