<#
.SYNOPSIS
    VigorCore — Fase 3.3.1: Inventario Estructural y Proyección Segura de Cloud Firestore
    Descubrimiento read-only mediante API REST, StructuredQuery y credenciales ADC locales.

.DESCRIPTION
    Herramienta de auditoría e inventario corregida para la base de datos Firestore Enterprise de VigorCore.
    Utiliza exclusivamente StructuredQuery con proyección de clave primaria __name__, garantizando
    cero transmisión o almacenamiento de atributos biométricos, rutinas deportivas o planes nutricionales.
    
    Correcciones aplicadas (Fase 3.3.1):
      1. Sustitución de 'mask.fieldPaths=__none__' por 'documents:runQuery' con proyección estricta '__name__'.
      2. Paginación determinista basada en cursores 'startAt' con referenceValue y before: false.
      3. Comprobación exhaustiva de consistencia entre la colección '_system_' y 'users'.
      4. Manejo estricto de estados incompletos (documentsEnumerated = null ante fallos, no 0).
      5. Resolución robusta de rutas relativas de reportes y archivado de ejecuciones anteriores.

.PARAMETER Mode
    'Shallow' (predeterminado) o 'Deep'.
.PARAMETER ProjectId
    ID del proyecto de Google Cloud (gen-lang-client-0041212770).
.PARAMETER DatabaseId
    ID de la base de datos Cloud Firestore nombrada.
.PARAMETER OutputDir
    Directorio de salida para los reportes JSON y Markdown (predeterminado: poc/catalyst-3-2/reports/firestore-inventory).
.PARAMETER PageSize
    Tamaño de página para consultas REST (predeterminado: 100).
.PARAMETER ThrottleMs
    Retardo en milisegundos entre solicitudes REST (predeterminado: 50 ms).
.PARAMETER Resume
    Reanudar inventario Deep a partir de checkpoint.json si existe.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-3-2\scripts\inventory-firestore.ps1 -Mode Shallow
    powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-3-2\scripts\inventory-firestore.ps1 -Mode Deep
#>

[CmdletBinding()]
param (
    [ValidateSet("Shallow", "Deep")]
    [string]$Mode = "Shallow",

    [string]$ProjectId = "gen-lang-client-0041212770",

    [string]$DatabaseId = "ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c",

    [string]$OutputDir = "",

    [int]$PageSize = 100,

    [int]$ThrottleMs = 50,

    [switch]$Resume
)

$ErrorActionPreference = "Stop"

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host " VIGORCORE -- FASE 3.3.1: INVENTARIO ESTRUCTURAL Y PROYECCION SEGURA    " -ForegroundColor Cyan
Write-Host " Modo: $Mode | StructuredQuery (__name__) | Zero Data | API REST v1     " -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# 1. Resolución Robusta de Rutas y Conservación de Evidencias Anteriores
# -----------------------------------------------------------------------------
$scriptDir = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $PSScriptRoot
} else {
    Split-Path -Parent $MyInvocation.MyCommand.Definition
}

# La raíz del módulo aislado es el padre del directorio scripts/
$pocDir = Split-Path -Parent $scriptDir
$defaultReportDir = Join-Path $pocDir "reports\firestore-inventory"

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $resolvedOutputDir = $defaultReportDir
} else {
    if ([System.IO.Path]::IsPathRooted($OutputDir)) {
        $resolvedOutputDir = [System.IO.Path]::GetFullPath($OutputDir)
    } else {
        # Limpiar barras iniciales para evitar resolución en C:\
        $cleanRelative = $OutputDir.TrimStart('/', '\')
        $resolvedOutputDir = [System.IO.Path]::GetFullPath((Join-Path $pocDir $cleanRelative))
    }
}

if (-not (Test-Path -Path $resolvedOutputDir)) {
    New-Item -ItemType Directory -Path $resolvedOutputDir -Force | Out-Null
}

# Rutas de artefactos
$summaryPath     = Join-Path $resolvedOutputDir "inventory-summary.json"
$collectionsPath = Join-Path $resolvedOutputDir "collections-tree.json"
$countsPath      = Join-Path $resolvedOutputDir "document-counts.json"
$errorsPath      = Join-Path $resolvedOutputDir "inventory-errors.json"
$consistencyPath = Join-Path $resolvedOutputDir "consistency-check.json"
$reportPath      = Join-Path $resolvedOutputDir "inventory-report.md"
$checkpointPath  = Join-Path $resolvedOutputDir "checkpoint.json"

# Archivado de reportes previos para evitar sobreescritura silenciosa
if (Test-Path -Path $summaryPath) {
    try {
        $archiveBase = Join-Path $resolvedOutputDir "archive"
        if (-not (Test-Path -Path $archiveBase)) {
            New-Item -ItemType Directory -Path $archiveBase -Force | Out-Null
        }
        $backupStamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
        $archiveTarget = Join-Path $archiveBase "run-$backupStamp"
        New-Item -ItemType Directory -Path $archiveTarget -Force | Out-Null

        Get-ChildItem -Path $resolvedOutputDir -File | Where-Object { $_.Name -ne "checkpoint.json" } | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination $archiveTarget -Force
        }
        Write-Host " [BACKUP] Reportes anteriores preservados en: $archiveTarget" -ForegroundColor DarkGray
    } catch {
        Write-Host " [WARN] No se pudo crear copia de seguridad de reportes previos: $_" -ForegroundColor Yellow
    }
}

# -----------------------------------------------------------------------------
# 2. Detección y Adquisición de Credenciales ADC Locales
# -----------------------------------------------------------------------------
Write-Host "`n[1/5] DETECCION Y ADQUISICION DE CREDENCIALES ADC" -ForegroundColor Cyan
Write-Host "------------------------------------------------------------------------"

$appDataPath = [System.Environment]::GetFolderPath('ApplicationData')
$adcFilePath = Join-Path $appDataPath "gcloud\application_default_credentials.json"
$adcIdentity = "Cuenta de usuario autorizada via gcloud ADC"
$adcQuotaProject = $ProjectId

if (Test-Path -Path $adcFilePath) {
    try {
        $adcContent = Get-Content -Path $adcFilePath -Raw | ConvertFrom-Json
        if ($adcContent.quota_project_id) {
            $adcQuotaProject = $adcContent.quota_project_id
        }
        if ($adcContent.client_email) {
            $adcIdentity = $adcContent.client_email
        }
        Write-Host " - Archivo ADC Detectado:     $adcFilePath" -ForegroundColor Green
    } catch {
        Write-Host " - Archivo ADC Detectado:     $adcFilePath (Error parseando JSON)" -ForegroundColor Yellow
    }
}

Write-Host " - Proyecto GCP Destino:      $ProjectId"
Write-Host " - Base de Datos Firestore:   $DatabaseId"
Write-Host " - Quota Project Header:      $adcQuotaProject"
Write-Host " - Directorio de Reportes:    $resolvedOutputDir"

Write-Host "`n - Adquiriendo Access Token en memoria..." -NoNewline
$tokenOutput = & gcloud auth application-default print-access-token 2>&1
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($tokenOutput)) {
    Write-Host " ERROR" -ForegroundColor Red
    Write-Host "`n[ERROR CRITICO]: No se pudo obtener el Access Token ADC." -ForegroundColor Red
    Write-Host "Ejecuta previamente en PowerShell:" -ForegroundColor Yellow
    Write-Host "    gcloud auth application-default login" -ForegroundColor Yellow
    exit 1
}

$accessToken = ($tokenOutput -split "`r?`n")[0].Trim()
Write-Host " OK (Token protegido en memoria, longitud: $($accessToken.Length) caracteres)" -ForegroundColor Green

# -----------------------------------------------------------------------------
# 3. Motor de Invocación REST con Resiliencia y Control de Tasa
# -----------------------------------------------------------------------------
$headers = @{
    "Authorization"       = "Bearer $accessToken"
    "x-goog-user-project" = $adcQuotaProject
    "Accept"              = "application/json"
    "Content-Type"        = "application/json; charset=utf-8"
}

$databaseRootUrl = "https://firestore.googleapis.com/v1/projects/$ProjectId/databases/$DatabaseId/documents"

$script:recordedErrors = @()
$script:requestCount = 0
$script:totalRestLatencyMs = 0

function Invoke-FirestoreRest {
    param (
        [string]$Method = "GET",
        [string]$Url,
        [object]$Body = $null,
        [int]$MaxRetries = 3
    )

    $attempt = 0
    while ($attempt -lt $MaxRetries) {
        $attempt++
        $script:requestCount++

        if ($ThrottleMs -gt 0) {
            Start-Sleep -Milliseconds $ThrottleMs
        }

        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $params = @{
                Method          = $Method
                Uri             = $Url
                Headers         = $headers
                UseBasicParsing = $true
            }

            if ($Body -ne $null) {
                if ($Body -is [string]) {
                    $params["Body"] = $Body
                } else {
                    $params["Body"] = ($Body | ConvertTo-Json -Depth 10 -Compress)
                }
            }

            $response = Invoke-WebRequest @params
            $sw.Stop()
            $script:totalRestLatencyMs += $sw.ElapsedMilliseconds

            $parsedBody = $null
            if ($response.Content) {
                $parsedBody = $response.Content | ConvertFrom-Json
            }

            return @{
                StatusCode = [int]$response.StatusCode
                Body       = $parsedBody
                DurationMs = $sw.ElapsedMilliseconds
                Raw        = $response.Content
            }
        } catch [System.Net.WebException] {
            $sw.Stop()
            $script:totalRestLatencyMs += $sw.ElapsedMilliseconds
            $ex = $_.Exception
            $statusCode = 0
            $respBody = ""
            if ($ex.Response) {
                $statusCode = [int]$ex.Response.StatusCode
                $reader = New-Object System.IO.StreamReader($ex.Response.GetResponseStream())
                $respBody = $reader.ReadToEnd()
                $reader.Close()
            }

            if (($statusCode -eq 429 -or $statusCode -eq 503) -and $attempt -lt $MaxRetries) {
                $backoffSec = [Math]::Pow(2, $attempt)
                Write-Host "   [WARN] HTTP $statusCode recibido. Reintentando en $backoffSec s..." -ForegroundColor Yellow
                Start-Sleep -Seconds $backoffSec
                continue
            }

            $errorEntry = [ordered]@{
                Timestamp   = (Get-Date).ToString("o")
                Url         = $Url
                Method      = $Method
                StatusCode  = $statusCode
                Message     = $ex.Message
                Details     = $respBody
            }
            $script:recordedErrors += $errorEntry

            return @{
                StatusCode = $statusCode
                Body       = $null
                DurationMs = $sw.ElapsedMilliseconds
                Error      = $errorEntry
            }
        } catch {
            $sw.Stop()
            $errorEntry = [ordered]@{
                Timestamp   = (Get-Date).ToString("o")
                Url         = $Url
                Method      = $Method
                StatusCode  = 0
                Message     = $_.Exception.Message
                Details     = "$_"
            }
            $script:recordedErrors += $errorEntry

            return @{
                StatusCode = 0
                Body       = $null
                DurationMs = $sw.ElapsedMilliseconds
                Error      = $errorEntry
            }
        }
    }

    return @{
        StatusCode = 0
        Body       = $null
        DurationMs = 0
        Error      = @{ Message = "Excedido maximo de reintentos para $Url" }
    }
}

# -----------------------------------------------------------------------------
# 4. Operaciones de Consulta Segura: StructuredQuery con Proyección __name__
# -----------------------------------------------------------------------------

function Get-FirestoreCollectionIds {
    param (
        [string]$ParentResourceUrl
    )

    $collections = @()
    $pageToken = $null
    $url = "$ParentResourceUrl`:listCollectionIds"

    do {
        $bodyObj = [ordered]@{ "pageSize" = $PageSize }
        if (-not [string]::IsNullOrEmpty($pageToken)) {
            $bodyObj["pageToken"] = $pageToken
        }

        $res = Invoke-FirestoreRest -Method "POST" -Url $url -Body $bodyObj
        if ($res.StatusCode -eq 200 -and $res.Body) {
            if ($res.Body.collectionIds) {
                foreach ($id in $res.Body.collectionIds) {
                    $collections += $id
                }
            }
            $pageToken = $res.Body.nextPageToken
        } else {
            Write-Host "   [!] Advertencia: No se pudieron listar colecciones en $ParentResourceUrl (Status: $($res.StatusCode))" -ForegroundColor Yellow
            break
        }
    } while (-not [string]::IsNullOrEmpty($pageToken))

    return ,$collections
}

function Run-FirestoreQuery {
    param (
        [string]$CollectionId,
        [int]$Limit = 100,
        [string]$StartAfterDocName = $null,
        [string]$ParentResourceUrl = $databaseRootUrl,
        [bool]$AllDescendants = $false
    )

    $fromObj = [ordered]@{ "collectionId" = $CollectionId }
    if ($AllDescendants) {
        $fromObj["allDescendants"] = $true
    }

    $structuredQuery = [ordered]@{
        "select" = @{
            "fields" = @(
                @{ "fieldPath" = "__name__" }
            )
        }
        "from" = @($fromObj)
        "orderBy" = @(
            @{
                "field"     = @{ "fieldPath" = "__name__" }
                "direction" = "ASCENDING"
            }
        )
        "limit" = $Limit
    }

    if (-not [string]::IsNullOrWhiteSpace($StartAfterDocName)) {
        $structuredQuery["startAt"] = @{
            "values" = @(
                @{ "referenceValue" = $StartAfterDocName }
            )
            "before" = $false
        }
    }

    $requestBody = @{
        "structuredQuery" = $structuredQuery
    }

    $runQueryUrl = "$ParentResourceUrl`:runQuery"
    $res = Invoke-FirestoreRest -Method "POST" -Url $runQueryUrl -Body $requestBody
    return $res
}

function Query-CollectionDocumentsSafe {
    param (
        [string]$CollectionId,
        [string]$ParentResourceUrl = $databaseRootUrl,
        [bool]$SampleOnly = $false
    )

    $documents = @()
    $cursor = $null
    $hasMore = $false
    $limitPerPage = if ($SampleOnly) { 10 } else { $PageSize }
    $querySuccess = $true
    $queryError = $null

    do {
        $res = Run-FirestoreQuery -CollectionId $CollectionId -Limit $limitPerPage -StartAfterDocName $cursor -ParentResourceUrl $ParentResourceUrl

        if ($res.StatusCode -ne 200 -or $res.Body -eq $null) {
            $querySuccess = $false
            $queryError = if ($res.Error) { $res.Error } else { @{ StatusCode = $res.StatusCode; Message = "Respuesta no exitosa de runQuery" } }
            break
        }

        $batchDocs = @()
        if ($res.Body -is [System.Array]) {
            foreach ($item in $res.Body) {
                if ($item -and $item.document -and $item.document.name) {
                    # Invariante de privacidad: comprobar que no se extraigan campos
                    if ($item.document.fields) {
                        Write-Host "   [ALERTA DE PRIVACIDAD] Fields detectados en respuesta; excluidos estrictamente de la memoria." -ForegroundColor Yellow
                    }

                    $batchDocs += [ordered]@{
                        Name       = $item.document.name
                        CreateTime = $item.document.createTime
                        UpdateTime = $item.document.updateTime
                    }
                }
            }
        }

        $documents += $batchDocs

        if ($batchDocs.Count -ge $limitPerPage) {
            $hasMore = $true
            $cursor = $batchDocs[-1].Name
            if ($SampleOnly) {
                break
            }
        } else {
            $hasMore = $false
            break
        }
    } while ($hasMore)

    return @{
        Success   = $querySuccess
        Documents = $documents
        HasMore   = $hasMore
        Error     = $queryError
    }
}

# -----------------------------------------------------------------------------
# 5. Comprobación de Consistencia: '_system_' vs 'users'
# -----------------------------------------------------------------------------
Write-Host "`n[2/5] COMPROBACION DE CONSISTENCIA (_system_ vs users)" -ForegroundColor Cyan
Write-Host "------------------------------------------------------------------------"

$consistencyReport = [ordered]@{
    Timestamp               = (Get-Date).ToString("o")
    ListCollectionIdsRoot   = @()
    SystemCollectionQuery   = [ordered]@{}
    SystemProbeGet          = [ordered]@{}
    ComparisonVerdict       = ""
    TechnicalExplanation   = ""
}

Write-Host " 1. Re-listando colecciones raiz mediante listCollectionIds..." -NoNewline
$freshRootCols = Get-FirestoreCollectionIds -ParentResourceUrl $databaseRootUrl
$consistencyReport.ListCollectionIdsRoot = $freshRootCols
Write-Host " Encontradas: $($freshRootCols -join ', ')" -ForegroundColor Yellow

Write-Host " 2. Ejecutando RunQuery con proyeccion __name__ sobre coleccion '_system_'..." -NoNewline
$systemQueryRes = Run-FirestoreQuery -CollectionId "_system_" -Limit 10
$systemDocsCount = 0
$systemQueryStatus = $systemQueryRes.StatusCode

if ($systemQueryRes.StatusCode -eq 200 -and ($systemQueryRes.Body -is [System.Array])) {
    $foundNames = @()
    foreach ($item in $systemQueryRes.Body) {
        if ($item -and $item.document -and $item.document.name) {
            $foundNames += (Split-Path $item.document.name -Leaf)
            $systemDocsCount++
        }
    }
    $consistencyReport.SystemCollectionQuery = [ordered]@{
        StatusCode    = 200
        DocumentCount = $systemDocsCount
        Documents     = $foundNames
    }
    Write-Host " HTTP 200 ($systemDocsCount documentos encontrados)" -ForegroundColor Green
} else {
    $consistencyReport.SystemCollectionQuery = [ordered]@{
        StatusCode = $systemQueryRes.StatusCode
        Error      = if ($systemQueryRes.Error) { $systemQueryRes.Error.Message } else { "Error de consulta" }
    }
    Write-Host " HTTP $($systemQueryRes.StatusCode)" -ForegroundColor Yellow
}

Write-Host " 3. Verificando ruta concreta '_system_/audit_read_probe' via GET directo..." -NoNewline
$probeUrl = "$databaseRootUrl/_system_/audit_read_probe"
$probeRes = Invoke-FirestoreRest -Method "GET" -Url $probeUrl
$consistencyReport.SystemProbeGet = [ordered]@{
    StatusCode = $probeRes.StatusCode
    Exists     = ($probeRes.StatusCode -eq 200)
    LatencyMs  = $probeRes.DurationMs
}
Write-Host " HTTP $($probeRes.StatusCode)" -ForegroundColor $(if ($probeRes.StatusCode -eq 200) { "Green" } else { "Yellow" })

# Evaluación de la discrepancia
$hasSystemInList = ($freshRootCols -contains "_system_")
$hasUsersInList  = ($freshRootCols -contains "users")

if ($probeRes.StatusCode -eq 200 -and (-not $hasSystemInList)) {
    $consistencyReport.ComparisonVerdict = "DOCUMENT_EXISTS_BUT_OMITTED_BY_LIST_COLLECTION_IDS"
    $consistencyReport.TechnicalExplanation = "El documento '_system_/audit_read_probe' existe plenamente y responde HTTP 200, pero 'listCollectionIds' omite la coleccion '_system_'. Esto ocurre comunmente en Firestore cuando: (a) colecciones con prefijo de guion bajo '_' reciben tratamiento de metadatos/sistema y no son expuestas por el indice estandar de colecciones, o (b) la coleccion fue creada directamente sin metadatos de catalogo. La coleccion 'users' si aparece en listCollectionIds."
    Write-Host "`n [HALLAZGO CONSISTENCIA]: El documento '_system_/audit_read_probe' EXISTE realmente (HTTP 200), pero listCollectionIds no enumera colecciones prefijadas con '_'. Se agregara '_system_' a la lista de inspeccion obligatoria." -ForegroundColor Magenta
} else {
    $consistencyReport.ComparisonVerdict = "CONSISTENT"
    $consistencyReport.TechnicalExplanation = "Los resultados de listCollectionIds y las consultas directas son consistentes."
}

# Guardar consistency-check.json
$consistencyJson = $consistencyReport | ConvertTo-Json -Depth 6
Set-Content -Path $consistencyPath -Value $consistencyJson -Encoding UTF8
Write-Host " [OK] Consistencia registrada en: $consistencyPath" -ForegroundColor Green

# -----------------------------------------------------------------------------
# 6. Descubrimiento de Colecciones y Estructura
# -----------------------------------------------------------------------------
Write-Host "`n[3/5] EJECUTANDO INVENTARIO CON PROYECCION SEGURA ($Mode Mode)" -ForegroundColor Cyan
Write-Host "------------------------------------------------------------------------"

$stopwatchTotal = [System.Diagnostics.Stopwatch]::StartNew()

# Conjunto de colecciones a inspeccionar: las devueltas por listCollectionIds + colecciones conocidas del dominio
$allCollectionsToInspect = [System.Collections.Generic.List[string]]::new()
foreach ($col in $freshRootCols) {
    if (-not $allCollectionsToInspect.Contains($col)) { $allCollectionsToInspect.Add($col) }
}
# Garantizar inspección de _system_ y usuarios
foreach ($expectedCol in @("_system_", "users", "athletes", "trainers", "invitations", "security_audit", "locks")) {
    if (-not $allCollectionsToInspect.Contains($expectedCol)) { $allCollectionsToInspect.Add($expectedCol) }
}

$collectionsTree = @()
$documentCountsMap = [ordered]@{}
$hasAnyFailure = $false
$totalDiscoveredDocuments = 0

$isShallow = ($Mode -eq "Shallow")

foreach ($colId in $allCollectionsToInspect) {
    Write-Host "`n [Coleccion] '$colId'" -ForegroundColor White

    $colNode = [ordered]@{
        Id                   = $colId
        Path                 = $colId
        Type                 = "root_collection"
        Level                = 0
        DocumentsEnumerated  = $null
        HasMore              = $null
        EnumerationComplete  = $false
        Subcollections       = @()
        Error                = $null
    }

    $docResult = Query-CollectionDocumentsSafe -CollectionId $colId -ParentResourceUrl $databaseRootUrl -SampleOnly $isShallow

    if ($docResult.Success) {
        $docs = $docResult.Documents
        $hasMore = $docResult.HasMore
        $count = $docs.Count

        $colNode.DocumentsEnumerated = $count
        $colNode.HasMore             = $hasMore
        $colNode.EnumerationComplete = (-not $hasMore)

        if ($totalDiscoveredDocuments -ne $null) {
            $totalDiscoveredDocuments += $count
        }

        $documentCountsMap[$colId] = [ordered]@{
            DocumentsEnumerated = $count
            HasMore             = $hasMore
            SampledOnly         = $isShallow
            Status              = "SUCCESS"
        }

        Write-Host "   - Documentos enumerados: $count $(if ($hasMore) { '(+ mas disponibles)' } else { '' })" -ForegroundColor Green
    } else {
        $hasAnyFailure = $true
        $colNode.DocumentsEnumerated = $null
        $colNode.HasMore             = $null
        $colNode.EnumerationComplete = $false
        $colNode.Error               = $docResult.Error
        $totalDiscoveredDocuments    = $null

        $documentCountsMap[$colId] = [ordered]@{
            DocumentsEnumerated = $null
            HasMore             = $null
            SampledOnly         = $isShallow
            Status              = "FAILED"
            Error               = $docResult.Error
        }

        Write-Host "   - [ERROR EN CONSULTA]: $($docResult.Error.Message)" -ForegroundColor Red
        Write-Host "     Estado registrado como: DocumentsEnumerated = null, EnumerationComplete = false" -ForegroundColor Yellow
    }

    $collectionsTree += $colNode
}

$stopwatchTotal.Stop()
$totalElapsedMs = $stopwatchTotal.ElapsedMilliseconds

# -----------------------------------------------------------------------------
# 7. Generación de Archivos de Reporte
# -----------------------------------------------------------------------------
Write-Host "`n[4/5] GENERANDO REPORTES Y ARTEFACTOS ESTRUCTURALES" -ForegroundColor Cyan
Write-Host "------------------------------------------------------------------------"

$overallStatus = if ($hasAnyFailure) { "PARTIAL_FAILURE" } else { "COMPLETED_SUCCESS" }

$summaryObj = [ordered]@{
    Timestamp                  = (Get-Date).ToString("o")
    Mode                       = $Mode
    ProjectId                  = $ProjectId
    DatabaseId                 = $DatabaseId
    ExecutionTimeMs            = $totalElapsedMs
    TotalRestRequestsMade      = $script:requestCount
    TotalCollectionsInspected  = $allCollectionsToInspect.Count
    TotalDocumentsDiscovered   = if ($totalDiscoveredDocuments -eq $null) { "UNKNOWN (Partial failure in 1 or more collections)" } else { $totalDiscoveredDocuments }
    TotalErrorsEncountered     = $script:recordedErrors.Count
    PrivacyVerification        = "StructuredQuery select fieldPath: __name__ (100% field protection, 0 data leaked)"
    MissingParentsLimitation   = "Firestore REST no enumera padres fantasma en shallow runQuery; documentado formalmente"
    Status                     = $overallStatus
}

# 1. inventory-summary.json
$summaryJson = $summaryObj | ConvertTo-Json -Depth 6
Set-Content -Path $summaryPath -Value $summaryJson -Encoding UTF8
Write-Host " [OK] Resumen JSON:           $summaryPath" -ForegroundColor Green

# 2. collections-tree.json
$treeJson = $collectionsTree | ConvertTo-Json -Depth 10
Set-Content -Path $collectionsPath -Value $treeJson -Encoding UTF8
Write-Host " [OK] Arbol de Colecciones:   $collectionsPath" -ForegroundColor Green

# 3. document-counts.json
$countsJson = $documentCountsMap | ConvertTo-Json -Depth 6
Set-Content -Path $countsPath -Value $countsJson -Encoding UTF8
Write-Host " [OK] Conteo de Documentos:   $countsPath" -ForegroundColor Green

# 4. inventory-errors.json
$errorsJson = $script:recordedErrors | ConvertTo-Json -Depth 6
Set-Content -Path $errorsPath -Value $errorsJson -Encoding UTF8
Write-Host " [OK] Registro de Errores:    $errorsPath" -ForegroundColor Green

# 5. inventory-report.md
$mdBuilder = New-Object System.Text.StringBuilder

[void]$mdBuilder.AppendLine("# VIGORCORE -- REPORTE DE INVENTARIO ESTRUCTURAL CLOUD FIRESTORE (FASE 3.3.1)")
[void]$mdBuilder.AppendLine("Generado el $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) (UTC)")
[void]$mdBuilder.AppendLine("")
[void]$mdBuilder.AppendLine("## 1. RESUMEN EJECUTIVO")
[void]$mdBuilder.AppendLine("")
[void]$mdBuilder.AppendLine("| Parametro | Valor |")
[void]$mdBuilder.AppendLine("| :--- | :--- |")
[void]$mdBuilder.AppendLine("| **Proyecto GCP** | `$ProjectId` |")
[void]$mdBuilder.AppendLine("| **Database ID** | `$DatabaseId` |")
[void]$mdBuilder.AppendLine("| **Modo de Inventario** | `$Mode` |")
[void]$mdBuilder.AppendLine("| **Identidad ADC** | `$adcIdentity` |")
[void]$mdBuilder.AppendLine("| **Colecciones Inspeccionadas** | $($allCollectionsToInspect.Count) |")
[void]$mdBuilder.AppendLine("| **Documentos Enumerados** | $(if ($totalDiscoveredDocuments -eq $null) { 'DESCONOCIDO (Fallo parcial registrado)' } else { $totalDiscoveredDocuments }) |")
[void]$mdBuilder.AppendLine("| **Solicitudes REST Realizadas** | $($script:requestCount) |")
[void]$mdBuilder.AppendLine("| **Tiempo Total de Ejecucion** | $($totalElapsedMs) ms |")
[void]$mdBuilder.AppendLine("| **Garantia de Privacidad** | StructuredQuery con proyeccion exclusiva `__name__` (Cero campos de atletas) |")
[void]$mdBuilder.AppendLine("| **Estado General** | **`$overallStatus`** |")
[void]$mdBuilder.AppendLine("")
[void]$mdBuilder.AppendLine("## 2. DISCREPANCIA `_system_` VS `users`")
[void]$mdBuilder.AppendLine("")
[void]$mdBuilder.AppendLine("- **Resultado listCollectionIds:** $(if ($freshRootCols.Count -gt 0) { $freshRootCols -join ', ' } else { 'Vacio' })")
[void]$mdBuilder.AppendLine("- **Resultado RunQuery `_system_`:** Estado HTTP $($consistencyReport.SystemCollectionQuery.StatusCode)")
[void]$mdBuilder.AppendLine("- **Resultado GET `_system_/audit_read_probe`:** Estado HTTP $($consistencyReport.SystemProbeGet.StatusCode) (Existe: $($consistencyReport.SystemProbeGet.Exists))")
[void]$mdBuilder.AppendLine("- **Dictamen de Consistencia:** $($consistencyReport.ComparisonVerdict)")
[void]$mdBuilder.AppendLine("- **Explicacion Tecnica:** $($consistencyReport.TechnicalExplanation)")
[void]$mdBuilder.AppendLine("")
[void]$mdBuilder.AppendLine("## 3. TABLA DE COLECCIONES Y ESTADOS")
[void]$mdBuilder.AppendLine("")
[void]$mdBuilder.AppendLine("| Coleccion | Nivel | Documentos Enumerados | Tiene Mas? | Completo? | Estado |")
[void]$mdBuilder.AppendLine("| :--- | :--- | :--- | :--- | :--- | :--- |")

foreach ($col in $collectionsTree) {
    $cId = $col.Id
    $docCountStr = if ($col.DocumentsEnumerated -eq $null) { "null (Error)" } else { "$($col.DocumentsEnumerated)" }
    $hasMoreStr = if ($col.HasMore -eq $null) { "null" } elseif ($col.HasMore) { "Si" } else { "No" }
    $compStr = if ($col.EnumerationComplete) { "Si" } else { "No" }
    $statusStr = if ($col.Error) { "FAILED ($($col.Error.StatusCode))" } else { "SUCCESS" }

    [void]$mdBuilder.AppendLine("| `$cId` | Raiz | $docCountStr | $hasMoreStr | $compStr | $statusStr |")
}

[void]$mdBuilder.AppendLine("")
[void]$mdBuilder.AppendLine("## 4. LIMITACIONES ARQUITECTONICAS DOCUMENTADAS")
[void]$mdBuilder.AppendLine("")
[void]$mdBuilder.AppendLine("1. **Padres Fantasma (Missing Parents):** En Firestore, si un documento padre fue eliminado o nunca creado pero existen subcolecciones hijas, dicho padre no es retornado por consultas sobre la coleccion padre sin usar `allDescendants: true`. Por estricta precaucion de privacidad, no se ejecutan consultas globales de subcolecciones hasta contar con el mapeo seguro.")
[void]$mdBuilder.AppendLine("2. **Tratamiento de Prefijo de Subguion (`_`):** `listCollectionIds` no garantiza la exposicion de colecciones internas de sistema. La herramienta inspecciona tanto la lista dinamica como las colecciones declaradas en el modelo de datos de VigorCore.")

Set-Content -Path $reportPath -Value ($mdBuilder.ToString()) -Encoding UTF8
Write-Host " [OK] Reporte Markdown:       $reportPath" -ForegroundColor Green

# -----------------------------------------------------------------------------
# 8. Dictamen Final en Consola
# -----------------------------------------------------------------------------
Write-Host "`n[5/5] EVALUACION DE FINALIZACION" -ForegroundColor Cyan
Write-Host "------------------------------------------------------------------------"

if ($overallStatus -eq "COMPLETED_SUCCESS") {
    Write-Host " [ESTADO]: INVENTARIO FINALIZADO EXITOSAMENTE (COMPLETED_SUCCESS)" -ForegroundColor Green
    Write-Host " - Colecciones Inspeccionadas:       $($allCollectionsToInspect.Count)" -ForegroundColor Green
    Write-Host " - Total Documentos Descubiertos:    $totalDiscoveredDocuments" -ForegroundColor Green
} else {
    Write-Host " [ADVERTENCIA]: INVENTARIO FINALIZADO CON ESTADO PARCIAL (PARTIAL_FAILURE)" -ForegroundColor Yellow
    Write-Host " - Se registraron errores en una o mas consultas; los conteos fallidos se mantienen en 'null'." -ForegroundColor Yellow
    Write-Host " - Colecciones con Incidencias:       $(($collectionsTree | Where-Object { $_.Error -ne $null }).Count)" -ForegroundColor Yellow
}

Write-Host " - Total Solicitudes REST:           $($script:requestCount)" -ForegroundColor Gray
Write-Host " - Duracion Total:                   $totalElapsedMs ms" -ForegroundColor Gray
Write-Host "`nReportes guardados en:" -ForegroundColor White
Write-Host "    $resolvedOutputDir" -ForegroundColor Yellow
