# VigorCore -- Fase 3.3.3: Inventario Estructural y Validacion de Consistencia de Cloud Firestore
# Compatible al 100% con Windows PowerShell 5.1 y PowerShell 7+.
# Cero expresiones complejas embebidas, cero backticks y sintaxis plana estricta.

[CmdletBinding()]
param (
    [ValidateSet('Shallow', 'Deep')]
    [string]$Mode = 'Shallow',

    [string]$ProjectId = 'gen-lang-client-0041212770',

    [string]$DatabaseId = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',

    [string]$OutputDir = '',

    [int]$PageSize = 100,

    [int]$ThrottleMs = 50,

    [switch]$Resume
)

$ErrorActionPreference = 'Stop'

Write-Host '========================================================================' -ForegroundColor Cyan
Write-Host ' VIGORCORE -- FASE 3.3.3: INVENTARIO ESTRUCTURAL Y VALIDACION ROBUSTA   ' -ForegroundColor Cyan
$headerSub = ' Modo: {0} | StructuredQuery (__name__) | PS 5.1/7+ | Zero Data       ' -f $Mode
Write-Host $headerSub -ForegroundColor Cyan
Write-Host '========================================================================' -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# 0. Control de Ejecución: Validación Sintáctica Previa del Script (Parser)
# -----------------------------------------------------------------------------
$selfScriptPath = if (-not [string]::IsNullOrWhiteSpace($PSCommandPath)) {
    $PSCommandPath
} elseif (-not [string]::IsNullOrWhiteSpace($MyInvocation.MyCommand.Path)) {
    $MyInvocation.MyCommand.Path
} else {
    $null
}

if ($selfScriptPath -and (Test-Path -Path $selfScriptPath)) {
    $parseTokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($selfScriptPath, [ref]$parseTokens, [ref]$parseErrors) | Out-Null
    if ($parseErrors -and $parseErrors.Count -gt 0) {
        Write-Host '[ERROR CRITICO DE SINTAXIS]: El script contiene errores de parser:' -ForegroundColor Red
        foreach ($pErr in $parseErrors) {
            $errLine = '  Linea {0}, Col {1}: {2}' -f $pErr.Extent.StartLineNumber, $pErr.Extent.StartColumnNumber, $pErr.Message
            Write-Host $errLine -ForegroundColor Red
        }
        throw 'PowerShell ParserError: Ejecución cancelada antes de acceder a red o credenciales.'
    }
    Write-Host '[PARSER CHECK]: Script validado exitosamente por System.Management.Automation.Language.Parser.' -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# 1. Resolución Robusta de Rutas y Conservación de Evidencias Anteriores
# -----------------------------------------------------------------------------
$scriptDir = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $PSScriptRoot
} else {
    Split-Path -Parent $MyInvocation.MyCommand.Definition
}

$pocDir = Split-Path -Parent $scriptDir
$defaultReportDir = Join-Path $pocDir 'reports\firestore-inventory'

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $resolvedOutputDir = $defaultReportDir
} else {
    if ([System.IO.Path]::IsPathRooted($OutputDir)) {
        $resolvedOutputDir = [System.IO.Path]::GetFullPath($OutputDir)
    } else {
        $cleanRelative = $OutputDir.TrimStart('/', '\')
        $resolvedOutputDir = [System.IO.Path]::GetFullPath((Join-Path $pocDir $cleanRelative))
    }
}

if (-not (Test-Path -Path $resolvedOutputDir)) {
    New-Item -ItemType Directory -Path $resolvedOutputDir -Force | Out-Null
}

$summaryPath     = Join-Path $resolvedOutputDir 'inventory-summary.json'
$collectionsPath = Join-Path $resolvedOutputDir 'collections-tree.json'
$countsPath      = Join-Path $resolvedOutputDir 'document-counts.json'
$errorsPath      = Join-Path $resolvedOutputDir 'inventory-errors.json'
$consistencyPath = Join-Path $resolvedOutputDir 'consistency-check.json'
$reportPath      = Join-Path $resolvedOutputDir 'inventory-report.md'
$checkpointPath  = Join-Path $resolvedOutputDir 'checkpoint.json'

# Archivado de reportes previos para evitar sobreescritura silenciosa
if (Test-Path -Path $summaryPath) {
    try {
        $archiveBase = Join-Path $resolvedOutputDir 'archive'
        if (-not (Test-Path -Path $archiveBase)) {
            New-Item -ItemType Directory -Path $archiveBase -Force | Out-Null
        }
        $backupStamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
        $archiveTarget = Join-Path $archiveBase ('run-' + $backupStamp)
        New-Item -ItemType Directory -Path $archiveTarget -Force | Out-Null

        Get-ChildItem -Path $resolvedOutputDir -File | Where-Object { $_.Name -ne 'checkpoint.json' } | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination $archiveTarget -Force
        }
        $archivedMsg = ' [BACKUP] Reportes anteriores preservados en: {0}' -f $archiveTarget
        Write-Host $archivedMsg -ForegroundColor DarkGray
    } catch {
        $warnBackup = ' [WARN] No se pudo crear copia de seguridad de reportes previos: {0}' -f $_.Exception.Message
        Write-Host $warnBackup -ForegroundColor Yellow
    }
}

# -----------------------------------------------------------------------------
# 2. Detección y Adquisición de Credenciales ADC Locales
# -----------------------------------------------------------------------------
Write-Host ''
Write-Host '[1/5] DETECCION Y ADQUISICION DE CREDENCIALES ADC' -ForegroundColor Cyan
Write-Host '------------------------------------------------------------------------'

$appDataPath = [System.Environment]::GetFolderPath('ApplicationData')
$adcFilePath = Join-Path $appDataPath 'gcloud\application_default_credentials.json'
$adcIdentity = 'Cuenta de usuario autorizada via gcloud ADC'
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
        $adcFoundMsg = ' - Archivo ADC Detectado:     {0}' -f $adcFilePath
        Write-Host $adcFoundMsg -ForegroundColor Green
    } catch {
        $adcWarnMsg = ' - Archivo ADC Detectado:     {0} (Error parseando JSON)' -f $adcFilePath
        Write-Host $adcWarnMsg -ForegroundColor Yellow
    }
}

$destProjMsg = ' - Proyecto GCP Destino:      {0}' -f $ProjectId
$destDbMsg   = ' - Base de Datos Firestore:   {0}' -f $DatabaseId
$quotaMsg    = ' - Quota Project Header:      {0}' -f $adcQuotaProject
$outDirMsg   = ' - Directorio de Reportes:    {0}' -f $resolvedOutputDir

Write-Host $destProjMsg
Write-Host $destDbMsg
Write-Host $quotaMsg
Write-Host $outDirMsg

Write-Host ''
Write-Host ' - Adquiriendo Access Token en memoria...' -NoNewline
$tokenOutput = & gcloud auth application-default print-access-token 2>&1
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($tokenOutput)) {
    Write-Host ' ERROR' -ForegroundColor Red
    Write-Host ''
    Write-Host '[ERROR CRITICO]: No se pudo obtener el Access Token ADC.' -ForegroundColor Red
    Write-Host 'Ejecuta previamente en PowerShell:' -ForegroundColor Yellow
    Write-Host '    gcloud auth application-default login' -ForegroundColor Yellow
    exit 1
}

$splitTokens = $tokenOutput -split '[\r\n]+'
$accessToken = $splitTokens[0].Trim()
$tokenLen = $accessToken.Length
$tokenOkMsg = ' OK (Token protegido en memoria, longitud: {0} caracteres)' -f $tokenLen
Write-Host $tokenOkMsg -ForegroundColor Green

# -----------------------------------------------------------------------------
# 3. Motor de Invocación REST con Resiliencia y Control de Tasa
# -----------------------------------------------------------------------------
$headers = @{
    'Authorization'       = 'Bearer ' + $accessToken
    'x-goog-user-project' = $adcQuotaProject
    'Accept'              = 'application/json'
    'Content-Type'        = 'application/json; charset=utf-8'
}

$databaseRootUrl = 'https://firestore.googleapis.com/v1/projects/' + $ProjectId + '/databases/' + $DatabaseId + '/documents'

$script:recordedErrors = @()
$script:requestCount = 0
$script:totalRestLatencyMs = 0

function Invoke-FirestoreRest {
    param (
        [string]$Method = 'GET',
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
                    $params['Body'] = $Body
                } else {
                    $params['Body'] = ($Body | ConvertTo-Json -Depth 10 -Compress)
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
            $respBody = ''
            if ($ex.Response) {
                $statusCode = [int]$ex.Response.StatusCode
                $reader = New-Object System.IO.StreamReader($ex.Response.GetResponseStream())
                $respBody = $reader.ReadToEnd()
                $reader.Close()
            }

            if (($statusCode -eq 429 -or $statusCode -eq 503) -and $attempt -lt $MaxRetries) {
                $backoffSec = [Math]::Pow(2, $attempt)
                $warnRetry = '   [WARN] HTTP {0} recibido. Reintentando en {1} s...' -f $statusCode, $backoffSec
                Write-Host $warnRetry -ForegroundColor Yellow
                Start-Sleep -Seconds $backoffSec
                continue
            }

            $errorEntry = [ordered]@{
                Timestamp   = (Get-Date).ToString('o')
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
            $exMsg = $_.Exception.Message
            $errorEntry = [ordered]@{
                Timestamp   = (Get-Date).ToString('o')
                Url         = $Url
                Method      = $Method
                StatusCode  = 0
                Message     = $exMsg
                Details     = $_.ToString()
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

    $failMsg = 'Excedido maximo de reintentos para ' + $Url
    return @{
        StatusCode = 0
        Body       = $null
        DurationMs = 0
        Error      = @{ Message = $failMsg }
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
    $url = $ParentResourceUrl + ':listCollectionIds'

    do {
        $bodyObj = [ordered]@{ 'pageSize' = $PageSize }
        if (-not [string]::IsNullOrEmpty($pageToken)) {
            $bodyObj['pageToken'] = $pageToken
        }

        $res = Invoke-FirestoreRest -Method 'POST' -Url $url -Body $bodyObj
        if ($res.StatusCode -eq 200 -and $res.Body) {
            if ($res.Body.collectionIds) {
                foreach ($id in $res.Body.collectionIds) {
                    $collections += $id
                }
            }
            $pageToken = $res.Body.nextPageToken
        } else {
            $warnList = '   [!] Advertencia: No se pudieron listar colecciones en {0} (Status: {1})' -f $ParentResourceUrl, $res.StatusCode
            Write-Host $warnList -ForegroundColor Yellow
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

    $fromObj = [ordered]@{ 'collectionId' = $CollectionId }
    if ($AllDescendants) {
        $fromObj['allDescendants'] = $true
    }

    $structuredQuery = [ordered]@{
        'select' = @{
            'fields' = @(
                @{ 'fieldPath' = '__name__' }
            )
        }
        'from' = @($fromObj)
        'orderBy' = @(
            @{
                'field'     = @{ 'fieldPath' = '__name__' }
                'direction' = 'ASCENDING'
            }
        )
        'limit' = $Limit
    }

    if (-not [string]::IsNullOrWhiteSpace($StartAfterDocName)) {
        $structuredQuery['startAt'] = @{
            'values' = @(
                @{ 'referenceValue' = $StartAfterDocName }
            )
            'before' = $false
        }
    }

    $requestBody = @{
        'structuredQuery' = $structuredQuery
    }

    $runQueryUrl = $ParentResourceUrl + ':runQuery'
    $res = Invoke-FirestoreRest -Method 'POST' -Url $runQueryUrl -Body $requestBody
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
            $queryError = if ($res.Error) { $res.Error } else { @{ StatusCode = $res.StatusCode; Message = 'Respuesta no exitosa de runQuery' } }
            break
        }

        $batchDocs = @()
        $privacyAlertTriggered = $false

        if ($res.Body -is [System.Array]) {
            foreach ($item in $res.Body) {
                if ($item -and $item.document -and $item.document.name) {
                    # Invariante estricta de privacidad: detección de fields
                    if ($item.document.fields) {
                        Write-Host '   [ALERTA DE PRIVACIDAD CRITICA] Fields detectados en respuesta; abortando lote por proteccion de datos.' -ForegroundColor Red
                        $privacyAlert = [ordered]@{
                            Timestamp   = (Get-Date).ToString('o')
                            Collection  = $CollectionId
                            StatusCode  = 400
                            Message     = 'Campos inesperados detectados en la respuesta de runQuery; procesamiento abortado para garantizar cero fugas.'
                        }
                        $script:recordedErrors += $privacyAlert
                        $querySuccess = $false
                        $queryError = @{ StatusCode = 400; Message = 'Failsafe de privacidad activado: campos inesperados detectados' }
                        $privacyAlertTriggered = $true
                        break
                    }

                    $batchDocs += [ordered]@{
                        Name       = $item.document.name
                        CreateTime = $item.document.createTime
                        UpdateTime = $item.document.updateTime
                    }
                }
            }
        }

        if ($privacyAlertTriggered) {
            break
        }

        $documents += $batchDocs

        if ($batchDocs.Count -ge $limitPerPage) {
            $hasMore = $true
            $lastIndex = $batchDocs.Count - 1
            $cursor = $batchDocs[$lastIndex].Name
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
Write-Host ''
Write-Host '[2/5] COMPROBACION DE CONSISTENCIA (_system_ vs users)' -ForegroundColor Cyan
Write-Host '------------------------------------------------------------------------'

$consistencyReport = [ordered]@{
    Timestamp               = (Get-Date).ToString('o')
    ListCollectionIdsRoot   = @()
    SystemCollectionQuery   = [ordered]@{}
    SystemProbeGet          = [ordered]@{}
    ComparisonVerdict       = ''
    TechnicalExplanation   = ''
}

Write-Host ' A. Re-listando colecciones raiz mediante listCollectionIds (paginacion completa)...' -NoNewline
$freshRootCols = Get-FirestoreCollectionIds -ParentResourceUrl $databaseRootUrl
$consistencyReport.ListCollectionIdsRoot = $freshRootCols
$rootColsJoined = if ($freshRootCols.Count -gt 0) { $freshRootCols -join ', ' } else { 'Vacio' }
$rootColsMsg = ' Encontradas: {0}' -f $rootColsJoined
Write-Host $rootColsMsg -ForegroundColor Yellow

Write-Host ' B. Verificando ruta concreta _system_/audit_read_probe via GET directo...' -NoNewline
$probeUrl = $databaseRootUrl + '/_system_/audit_read_probe'
$probeRes = Invoke-FirestoreRest -Method 'GET' -Url $probeUrl
$probeStatus = $probeRes.StatusCode
$probeExists = ($probeStatus -eq 200)
$probeLatency = $probeRes.DurationMs

$probeResourceName = if ($probeExists -and $probeRes.Body -and $probeRes.Body.name) {
    $probeRes.Body.name
} else {
    'No determinado'
}

$consistencyReport.SystemProbeGet = [ordered]@{
    StatusCode   = $probeStatus
    Exists       = $probeExists
    ResourceName = $probeResourceName
    LatencyMs    = $probeLatency
}
$probeStatusColor = if ($probeExists) { 'Green' } else { 'Yellow' }
$probeStatusMsg = ' HTTP {0}' -f $probeStatus
Write-Host $probeStatusMsg -ForegroundColor $probeStatusColor

Write-Host ' C. Ejecutando RunQuery con proyeccion __name__ sobre coleccion _system_...' -NoNewline
$systemQueryRes = Run-FirestoreQuery -CollectionId '_system_' -Limit 10
$systemDocsCount = 0
$systemQueryStatus = $systemQueryRes.StatusCode

if ($systemQueryStatus -eq 200 -and ($systemQueryRes.Body -is [System.Array])) {
    $foundNames = @()
    foreach ($item in $systemQueryRes.Body) {
        if ($item -and $item.document -and $item.document.name) {
            $leafName = Split-Path $item.document.name -Leaf
            $foundNames += $leafName
            $systemDocsCount++
        }
    }
    $consistencyReport.SystemCollectionQuery = [ordered]@{
        StatusCode    = 200
        DocumentCount = $systemDocsCount
        Documents     = $foundNames
    }
    $systemQueryOkMsg = ' HTTP 200 ({0} documentos encontrados)' -f $systemDocsCount
    Write-Host $systemQueryOkMsg -ForegroundColor Green
} else {
    $sysErrMsg = if ($systemQueryRes.Error) { $systemQueryRes.Error.Message } else { 'Error de consulta' }
    $consistencyReport.SystemCollectionQuery = [ordered]@{
        StatusCode = $systemQueryStatus
        Error      = $sysErrMsg
    }
    $sysErrStatusMsg = ' HTTP {0}' -f $systemQueryStatus
    Write-Host $sysErrStatusMsg -ForegroundColor Yellow
}

# Evaluación empírica de consistencia
$systemInListCols = ($freshRootCols -contains '_system_')
$usersInListCols  = ($freshRootCols -contains 'users')

if ($probeExists -and (-not $systemInListCols)) {
    $consistencyReport.ComparisonVerdict = 'DIVERGENCE_OBSERVED'
    $divergenceExplanation = 'El documento _system_/audit_read_probe responde HTTP 200 via GET (recurso existente), y RunQuery sobre _system_ responde HTTP {0} con {1} documentos. Sin embargo, listCollectionIds devolvio: [{2}]. Se observa una divergencia real entre la lista de colecciones y el acceso directo a documentos. No se asume ninguna hipotesis de prefijo; se auditan ambas fuentes de forma transparente.' -f $systemQueryStatus, $systemDocsCount, $rootColsJoined
    $consistencyReport.TechnicalExplanation = $divergenceExplanation
    Write-Host ''
    Write-Host ' [HALLAZGO EMPIRICO]: _system_/audit_read_probe EXISTE (HTTP 200), pero listCollectionIds no enumero _system_. Ambas fuentes seran incorporadas al inventario.' -ForegroundColor Magenta
} else {
    $consistencyReport.ComparisonVerdict = 'CONSISTENT'
    $consistencyReport.TechnicalExplanation = 'Los resultados de listCollectionIds, GET y RunQuery son consistentes entre si.'
}

# Guardar consistency-check.json
$consistencyJson = $consistencyReport | ConvertTo-Json -Depth 6
Set-Content -Path $consistencyPath -Value $consistencyJson -Encoding UTF8
$consSavedMsg = ' [OK] Consistencia registrada en: {0}' -f $consistencyPath
Write-Host $consSavedMsg -ForegroundColor Green

# -----------------------------------------------------------------------------
# 6. Descubrimiento de Colecciones y Estructura
# -----------------------------------------------------------------------------
Write-Host ''
$discHeader = ' [3/5] EJECUTANDO INVENTARIO CON PROYECCION SEGURA ({0} Mode)' -f $Mode
Write-Host $discHeader -ForegroundColor Cyan
Write-Host '------------------------------------------------------------------------'

$stopwatchTotal = [System.Diagnostics.Stopwatch]::StartNew()

# Conjunto de colecciones a inspeccionar: descubiertas dinámicamente + colecciones del modelo de datos
$allCollectionsToInspect = [System.Collections.Generic.List[string]]::new()
foreach ($col in $freshRootCols) {
    if (-not $allCollectionsToInspect.Contains($col)) { $allCollectionsToInspect.Add($col) }
}
foreach ($expectedCol in @('_system_', 'users', 'athletes', 'trainers', 'invitations', 'security_audit', 'locks')) {
    if (-not $allCollectionsToInspect.Contains($expectedCol)) { $allCollectionsToInspect.Add($expectedCol) }
}

$collectionsTree = @()
$documentCountsMap = [ordered]@{}
$hasAnyFailure = $false
$totalDiscoveredDocuments = 0

$isShallow = ($Mode -eq 'Shallow')

foreach ($colId in $allCollectionsToInspect) {
    Write-Host ''
    $colHeaderMsg = " [Coleccion] '{0}'" -f $colId
    Write-Host $colHeaderMsg -ForegroundColor White

    $colNode = [ordered]@{
        Id                   = $colId
        Path                 = $colId
        Type                 = 'root_collection'
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
            Status              = 'SUCCESS'
        }

        $moreSuffix = if ($hasMore) { ' (+ mas disponibles)' } else { '' }
        $colSuccessMsg = '   - Documentos enumerados: {0}{1}' -f $count, $moreSuffix
        Write-Host $colSuccessMsg -ForegroundColor Green
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
            Status              = 'FAILED'
            Error               = $docResult.Error
        }

        $errReason = if ($docResult.Error -and $docResult.Error.Message) { $docResult.Error.Message } else { 'Error en consulta' }
        $colErrMsg = '   - [ERROR EN CONSULTA]: {0}' -f $errReason
        Write-Host $colErrMsg -ForegroundColor Red
        Write-Host '     Estado registrado como: DocumentsEnumerated = null, EnumerationComplete = false' -ForegroundColor Yellow
    }

    $collectionsTree += $colNode
}

$stopwatchTotal.Stop()
$totalElapsedMs = $stopwatchTotal.ElapsedMilliseconds

# -----------------------------------------------------------------------------
# 7. Generación de Archivos de Reporte
# -----------------------------------------------------------------------------
Write-Host ''
Write-Host '[4/5] GENERANDO REPORTES Y ARTEFACTOS ESTRUCTURALES' -ForegroundColor Cyan
Write-Host '------------------------------------------------------------------------'

$overallStatus = if ($hasAnyFailure) { 'PARTIAL_FAILURE' } else { 'COMPLETED_SUCCESS' }

$totalDocsValue = if ($totalDiscoveredDocuments -eq $null) {
    'UNKNOWN (Partial failure in 1 or more collections)'
} else {
    $totalDiscoveredDocuments
}

$summaryObj = [ordered]@{
    Timestamp                  = (Get-Date).ToString('o')
    Mode                       = $Mode
    ProjectId                  = $ProjectId
    DatabaseId                 = $DatabaseId
    ExecutionTimeMs            = $totalElapsedMs
    TotalRestRequestsMade      = $script:requestCount
    TotalCollectionsInspected  = $allCollectionsToInspect.Count
    TotalDocumentsDiscovered   = $totalDocsValue
    TotalErrorsEncountered     = $script:recordedErrors.Count
    PrivacyVerification        = 'StructuredQuery select fieldPath: __name__ (100% field protection, 0 data leaked)'
    MissingParentsLimitation   = 'Firestore REST no enumera padres fantasma en shallow runQuery; documentado formalmente'
    Status                     = $overallStatus
}

# 1. inventory-summary.json
$summaryJson = $summaryObj | ConvertTo-Json -Depth 6
Set-Content -Path $summaryPath -Value $summaryJson -Encoding UTF8
$sumOkMsg = ' [OK] Resumen JSON:           {0}' -f $summaryPath
Write-Host $sumOkMsg -ForegroundColor Green

# 2. collections-tree.json
$treeJson = $collectionsTree | ConvertTo-Json -Depth 10
Set-Content -Path $collectionsPath -Value $treeJson -Encoding UTF8
$treeOkMsg = ' [OK] Arbol de Colecciones:   {0}' -f $collectionsPath
Write-Host $treeOkMsg -ForegroundColor Green

# 3. document-counts.json
$countsJson = $documentCountsMap | ConvertTo-Json -Depth 6
Set-Content -Path $countsPath -Value $countsJson -Encoding UTF8
$countsOkMsg = ' [OK] Conteo de Documentos:   {0}' -f $countsPath
Write-Host $countsOkMsg -ForegroundColor Green

# 4. inventory-errors.json
$errorsJson = $script:recordedErrors | ConvertTo-Json -Depth 6
Set-Content -Path $errorsPath -Value $errorsJson -Encoding UTF8
$errOkMsg = ' [OK] Registro de Errores:    {0}' -f $errorsPath
Write-Host $errOkMsg -ForegroundColor Green

# 5. inventory-report.md (Construido sin interpolaciones anidadas, solo comillas simples)
$mdBuilder = New-Object System.Text.StringBuilder

$currentTimeUtc = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
[void]$mdBuilder.AppendLine('# VIGORCORE -- REPORTE DE INVENTARIO ESTRUCTURAL CLOUD FIRESTORE (FASE 3.3.3)')
$genLine = 'Generado el {0} (UTC)' -f $currentTimeUtc
[void]$mdBuilder.AppendLine($genLine)
[void]$mdBuilder.AppendLine('')
[void]$mdBuilder.AppendLine('## 1. RESUMEN EJECUTIVO')
[void]$mdBuilder.AppendLine('')
[void]$mdBuilder.AppendLine('| Parametro | Valor |')
[void]$mdBuilder.AppendLine('| :--- | :--- |')
$p1 = '| **Proyecto GCP** | ' + $ProjectId + ' |'
$p2 = '| **Database ID** | ' + $DatabaseId + ' |'
$p3 = '| **Modo de Inventario** | ' + $Mode + ' |'
$p4 = '| **Identidad ADC** | ' + $adcIdentity + ' |'
$p5 = '| **Colecciones Inspeccionadas** | ' + $allCollectionsToInspect.Count + ' |'

$docsText = if ($totalDiscoveredDocuments -eq $null) { 'DESCONOCIDO (Fallo parcial registrado)' } else { [string]$totalDiscoveredDocuments }
$p6 = '| **Documentos Enumerados** | ' + $docsText + ' |'
$p7 = '| **Solicitudes REST Realizadas** | ' + $script:requestCount + ' |'
$p8 = '| **Tiempo Total de Ejecucion** | ' + $totalElapsedMs + ' ms |'
$p9 = '| **Garantia de Privacidad** | StructuredQuery con proyeccion exclusiva __name__ (Cero campos de atletas) |'
$p10 = '| **Estado General** | ' + $overallStatus + ' |'

[void]$mdBuilder.AppendLine($p1)
[void]$mdBuilder.AppendLine($p2)
[void]$mdBuilder.AppendLine($p3)
[void]$mdBuilder.AppendLine($p4)
[void]$mdBuilder.AppendLine($p5)
[void]$mdBuilder.AppendLine($p6)
[void]$mdBuilder.AppendLine($p7)
[void]$mdBuilder.AppendLine($p8)
[void]$mdBuilder.AppendLine($p9)
[void]$mdBuilder.AppendLine($p10)
[void]$mdBuilder.AppendLine('')
[void]$mdBuilder.AppendLine('## 2. DISCREPANCIA _system_ VS users')
[void]$mdBuilder.AppendLine('')
$d1 = '- Resultado listCollectionIds: ' + $rootColsJoined
$d2 = '- Resultado RunQuery _system_: Estado HTTP ' + $consistencyReport.SystemCollectionQuery.StatusCode
$d3 = '- Resultado GET _system_/audit_read_probe: Estado HTTP ' + $consistencyReport.SystemProbeGet.StatusCode + ' (Existe: ' + $consistencyReport.SystemProbeGet.Exists + ')'
$d4 = '- Dictamen de Consistencia: ' + $consistencyReport.ComparisonVerdict
$d5 = '- Explicacion Tecnica: ' + $consistencyReport.TechnicalExplanation

[void]$mdBuilder.AppendLine($d1)
[void]$mdBuilder.AppendLine($d2)
[void]$mdBuilder.AppendLine($d3)
[void]$mdBuilder.AppendLine($d4)
[void]$mdBuilder.AppendLine($d5)
[void]$mdBuilder.AppendLine('')
[void]$mdBuilder.AppendLine('## 3. TABLA DE COLECCIONES Y ESTADOS')
[void]$mdBuilder.AppendLine('')
[void]$mdBuilder.AppendLine('| Coleccion | Nivel | Documentos Enumerados | Tiene Mas? | Completo? | Estado |')
[void]$mdBuilder.AppendLine('| :--- | :--- | :--- | :--- | :--- | :--- |')

foreach ($col in $collectionsTree) {
    $cId = $col.Id
    $docCountStr = if ($col.DocumentsEnumerated -eq $null) { 'null (Error)' } else { [string]$col.DocumentsEnumerated }
    $hasMoreStr = if ($col.HasMore -eq $null) { 'null' } elseif ($col.HasMore) { 'Si' } else { 'No' }
    $compStr = if ($col.EnumerationComplete) { 'Si' } else { 'No' }
    $statusStr = if ($col.Error) { 'FAILED (' + $col.Error.StatusCode + ')' } else { 'SUCCESS' }

    $colLine = '| ' + $cId + ' | Raiz | ' + $docCountStr + ' | ' + $hasMoreStr + ' | ' + $compStr + ' | ' + $statusStr + ' |'
    [void]$mdBuilder.AppendLine($colLine)
}

[void]$mdBuilder.AppendLine('')
[void]$mdBuilder.AppendLine('## 4. LIMITACIONES ARQUITECTONICAS DOCUMENTADAS')
[void]$mdBuilder.AppendLine('')
[void]$mdBuilder.AppendLine('1. Padres Fantasma (Missing Parents): En Firestore, si un documento padre fue eliminado o nunca creado pero existen subcolecciones hijas, dicho padre no es retornado por consultas sobre la coleccion padre sin usar allDescendants: true. Por estricta precaucion de privacidad, no se ejecutan consultas globales de subcolecciones hasta contar con el mapeo seguro.')
[void]$mdBuilder.AppendLine('2. Tratamiento de Metadatos de Colecciones: listCollectionIds enumera colecciones registradas en el catalogo de particiones. Las colecciones no listadas pero con documentos existentes (ej. _system_) son inspeccionadas directamente mediante la lista declarativa del modelo de datos.')

Set-Content -Path $reportPath -Value ($mdBuilder.ToString()) -Encoding UTF8
$repOkMsg = ' [OK] Reporte Markdown:       {0}' -f $reportPath
Write-Host $repOkMsg -ForegroundColor Green

# -----------------------------------------------------------------------------
# 8. Dictamen Final en Consola
# -----------------------------------------------------------------------------
Write-Host ''
Write-Host '[5/5] EVALUACION DE FINALIZACION' -ForegroundColor Cyan
Write-Host '------------------------------------------------------------------------'

if ($overallStatus -eq 'COMPLETED_SUCCESS') {
    Write-Host ' [ESTADO]: INVENTARIO FINALIZADO EXITOSAMENTE (COMPLETED_SUCCESS)' -ForegroundColor Green
    $finColsMsg = ' - Colecciones Inspeccionadas:       {0}' -f $allCollectionsToInspect.Count
    $finDocsMsg = ' - Total Documentos Descubiertos:    {0}' -f $totalDiscoveredDocuments
    Write-Host $finColsMsg -ForegroundColor Green
    Write-Host $finDocsMsg -ForegroundColor Green
} else {
    Write-Host ' [ADVERTENCIA]: INVENTARIO FINALIZADO CON ESTADO PARCIAL (PARTIAL_FAILURE)' -ForegroundColor Yellow
    Write-Host ' - Se registraron errores en una o mas consultas; los conteos fallidos se mantienen en null.' -ForegroundColor Yellow
    $errColsCount = 0
    foreach ($cNode in $collectionsTree) {
        if ($cNode.Error -ne $null) { $errColsCount++ }
    }
    $errColsMsg = ' - Colecciones con Incidencias:       {0}' -f $errColsCount
    Write-Host $errColsMsg -ForegroundColor Yellow
}

$finReqMsg  = ' - Total Solicitudes REST:           {0}' -f $script:requestCount
$finTimeMsg = ' - Duracion Total:                   {0} ms' -f $totalElapsedMs
Write-Host $finReqMsg -ForegroundColor Gray
Write-Host $finTimeMsg -ForegroundColor Gray
Write-Host ''
Write-Host 'Reportes guardados en:' -ForegroundColor White
$finalOutDirMsg = '    ' + $resolvedOutputDir
Write-Host $finalOutDirMsg -ForegroundColor Yellow
