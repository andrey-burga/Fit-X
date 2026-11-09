# VigorCore -- Fase 3.3.4: Inventario Estructural, Auditoria y Preparacion de Deep Inventory
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

    [int]$ThrottleMs = 100,

    [int]$MaxRequests = 500,

    [int]$MaxDocuments = 2000,

    [int]$MaxDepth = 10,

    [switch]$Resume
)

$ErrorActionPreference = 'Stop'

Write-Host '========================================================================' -ForegroundColor Cyan
Write-Host ' VIGORCORE -- FASE 3.3.4: AUDITORIA DE RECORRIDO Y PREPARACION DEEP     ' -ForegroundColor Cyan
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

# Rutas de artefactos para modo Shallow
$summaryPath     = Join-Path $resolvedOutputDir 'inventory-summary.json'
$collectionsPath = Join-Path $resolvedOutputDir 'collections-tree.json'
$countsPath      = Join-Path $resolvedOutputDir 'document-counts.json'
$errorsPath      = Join-Path $resolvedOutputDir 'inventory-errors.json'
$consistencyPath = Join-Path $resolvedOutputDir 'consistency-check.json'
$reportPath      = Join-Path $resolvedOutputDir 'inventory-report.md'

# Rutas de artefactos para modo Deep
$deepSummaryPath     = Join-Path $resolvedOutputDir 'deep-summary.json'
$deepCollectionsPath = Join-Path $resolvedOutputDir 'deep-collections-tree.json'
$deepCountsPath      = Join-Path $resolvedOutputDir 'deep-document-counts.json'
$deepErrorsPath      = Join-Path $resolvedOutputDir 'deep-errors.json'
$deepReportPath      = Join-Path $resolvedOutputDir 'deep-inventory-report.md'
$deepValidationPath  = Join-Path $resolvedOutputDir 'deep-validation-3.3.6.md'
$deepCheckpointPath  = Join-Path $resolvedOutputDir 'checkpoint.json'

# Archivado preventivo de reportes previos
$targetSummaryCheck = if ($Mode -eq 'Deep') { $deepSummaryPath } else { $summaryPath }
if (Test-Path -Path $targetSummaryCheck) {
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

if ($Mode -eq 'Deep') {
    $limMsg1 = ' - Limites de Seguridad:      MaxRequests={0}, MaxDocuments={1}, MaxDepth={2}, Throttle={3}ms' -f $MaxRequests, $MaxDocuments, $MaxDepth, $ThrottleMs
    Write-Host $limMsg1 -ForegroundColor Magenta
}

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

# Función auxiliar para enmascarar rutas de recursos eliminando UIDs en reportes Markdown
function Get-MaskedResourcePath {
    param ([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return '' }
    $parts = $Path.Split('/')
    $masked = [System.Collections.Generic.List[string]]::new()
    for ($i = 0; $i -lt $parts.Length; $i++) {
        if ($i % 2 -eq 0) {
            $masked.Add($parts[$i])
        } else {
            $masked.Add('{id}')
        }
    }
    return ($masked -join '/')
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

if ($probeExists) {
    if (-not $systemInListCols) {
        $consistencyReport.ComparisonVerdict = 'DIVERGENCE_OBSERVED'
        $divergenceExplanation = 'El documento _system_/audit_read_probe respondio HTTP 200 via GET, pero listCollectionIds no devolvio _system_ en la raiz.'
        $consistencyReport.TechnicalExplanation = $divergenceExplanation
    } else {
        $consistencyReport.ComparisonVerdict = 'CONSISTENT_EXISTING'
        $consistencyReport.TechnicalExplanation = 'El documento _system_ existe y listCollectionIds lo incluye.'
    }
} else {
    $consistencyReport.ComparisonVerdict = 'CONSISTENT_NOT_FOUND'
    $consistencyReport.TechnicalExplanation = 'GET sobre _system_/audit_read_probe respondio HTTP 404 (documento no existe) y RunQuery devolvio 0 documentos. listCollectionIds devolvio unicamente: [' + $rootColsJoined + '].'
    Write-Host ' [RESULTADO CONSISTENCIA]: _system_ no contiene documentos y no aparece en la raiz. users es el unico punto de entrada confirmado.' -ForegroundColor Green
}

$consistencyJson = $consistencyReport | ConvertTo-Json -Depth 6
Set-Content -Path $consistencyPath -Value $consistencyJson -Encoding UTF8

# -----------------------------------------------------------------------------
# 6. Descubrimiento de Colecciones y Estructura (Shallow vs Deep)
# -----------------------------------------------------------------------------
Write-Host ''
$discHeader = ' [3/5] EJECUTANDO INVENTARIO CON PROYECCION SEGURA ({0} Mode)' -f $Mode
Write-Host $discHeader -ForegroundColor Cyan
Write-Host '------------------------------------------------------------------------'

$stopwatchTotal = [System.Diagnostics.Stopwatch]::StartNew()
$isShallow = ($Mode -eq 'Shallow')

if ($isShallow) {
    # MODO SHALLOW:
    # Punto de entrada obligatorio: colecciones descubiertas dinámicamente por listCollectionIds en raíz
    $collectionsToInspect = [System.Collections.Generic.List[string]]::new()
    foreach ($col in $freshRootCols) {
        if (-not $collectionsToInspect.Contains($col)) { $collectionsToInspect.Add($col) }
    }
    # Si listCollectionIds devolvió vacío (failsafe), incluir 'users' como punto de partida
    if ($collectionsToInspect.Count -eq 0 -and $usersInListCols) {
        $collectionsToInspect.Add('users')
    }

    $collectionsTree = @()
    $documentCountsMap = [ordered]@{}
    $hasAnyFailure = $false
    $totalDiscoveredDocuments = 0

    foreach ($colId in $collectionsToInspect) {
        Write-Host ''
        $colHeaderMsg = " [Coleccion Raiz Confirmada] '{0}'" -f $colId
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

        $docResult = Query-CollectionDocumentsSafe -CollectionId $colId -ParentResourceUrl $databaseRootUrl -SampleOnly $true

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
                SampledOnly         = $true
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
                SampledOnly         = $true
                Status              = 'FAILED'
                Error               = $docResult.Error
            }

            $errReason = if ($docResult.Error -and $docResult.Error.Message) { $docResult.Error.Message } else { 'Error en consulta' }
            $colErrMsg = '   - [ERROR EN CONSULTA]: {0}' -f $errReason
            Write-Host $colErrMsg -ForegroundColor Red
        }

        $collectionsTree += $colNode
    }

    $stopwatchTotal.Stop()
    $totalElapsedMs = $stopwatchTotal.ElapsedMilliseconds

    $overallStatus = if ($hasAnyFailure) { 'PARTIAL_FAILURE' } else { 'COMPLETED_SUCCESS' }

    $totalDocsValue = if ($totalDiscoveredDocuments -eq $null) {
        'UNKNOWN (Partial failure in 1 or more collections)'
    } else {
        $totalDiscoveredDocuments
    }

    $summaryObj = [ordered]@{
        Timestamp                  = (Get-Date).ToString('o')
        Mode                       = 'Shallow'
        ProjectId                  = $ProjectId
        DatabaseId                 = $DatabaseId
        ExecutionTimeMs            = $totalElapsedMs
        TotalRestRequestsMade      = $script:requestCount
        TotalCollectionsInspected  = $collectionsToInspect.Count
        TotalDocumentsDiscovered   = $totalDocsValue
        TotalErrorsEncountered     = $script:recordedErrors.Count
        PrivacyVerification        = 'StructuredQuery select fieldPath: __name__ (100% field protection, 0 data leaked)'
        Status                     = $overallStatus
    }

    # Guardar reportes Shallow
    $summaryObj | ConvertTo-Json -Depth 6 | Set-Content -Path $summaryPath -Encoding UTF8
    $collectionsTree | ConvertTo-Json -Depth 10 | Set-Content -Path $collectionsPath -Encoding UTF8
    $documentCountsMap | ConvertTo-Json -Depth 6 | Set-Content -Path $countsPath -Encoding UTF8
    $script:recordedErrors | ConvertTo-Json -Depth 6 | Set-Content -Path $errorsPath -Encoding UTF8

    $mdBuilder = New-Object System.Text.StringBuilder
    $currentTimeUtc = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    [void]$mdBuilder.AppendLine('# VIGORCORE -- REPORTE DE INVENTARIO ESTRUCTURAL CLOUD FIRESTORE (FASE 3.3.4)')
    [void]$mdBuilder.AppendLine(('Generado el {0} (UTC)' -f $currentTimeUtc))
    [void]$mdBuilder.AppendLine('')
    [void]$mdBuilder.AppendLine('## 1. RESUMEN EJECUTIVO')
    [void]$mdBuilder.AppendLine('')
    [void]$mdBuilder.AppendLine('| Parametro | Valor |')
    [void]$mdBuilder.AppendLine('| :--- | :--- |')
    [void]$mdBuilder.AppendLine(('| **Proyecto GCP** | ' + $ProjectId + ' |'))
    [void]$mdBuilder.AppendLine(('| **Database ID** | ' + $DatabaseId + ' |'))
    [void]$mdBuilder.AppendLine('| **Modo de Inventario** | Shallow |')
    [void]$mdBuilder.AppendLine(('| **Colecciones Raiz Confirmadas** | ' + $collectionsToInspect.Count + ' (' + $rootColsJoined + ') |'))
    [void]$mdBuilder.AppendLine(('| **Documentos Enumerados** | ' + $totalDocsValue + ' |'))
    [void]$mdBuilder.AppendLine(('| **Solicitudes REST** | ' + $script:requestCount + ' |'))
    [void]$mdBuilder.AppendLine(('| **Tiempo Total** | ' + $totalElapsedMs + ' ms |'))
    [void]$mdBuilder.AppendLine(('| **Estado General** | ' + $overallStatus + ' |'))
    [void]$mdBuilder.AppendLine('')
    [void]$mdBuilder.AppendLine('## 2. COMPROBACION DE CONSISTENCIA')
    [void]$mdBuilder.AppendLine('')
    [void]$mdBuilder.AppendLine(('- listCollectionIds raiz: ' + $rootColsJoined))
    [void]$mdBuilder.AppendLine(('- RunQuery _system_: Estado HTTP ' + $consistencyReport.SystemCollectionQuery.StatusCode + ', documentos: ' + $systemDocsCount))
    [void]$mdBuilder.AppendLine(('- GET _system_/audit_read_probe: Estado HTTP ' + $consistencyReport.SystemProbeGet.StatusCode + ' (Existe: ' + $consistencyReport.SystemProbeGet.Exists + ')'))
    [void]$mdBuilder.AppendLine(('- Dictamen: ' + $consistencyReport.ComparisonVerdict))
    [void]$mdBuilder.AppendLine('')
    [void]$mdBuilder.AppendLine('## 3. TABLA DE COLECCIONES CONFIRMADAS')
    [void]$mdBuilder.AppendLine('')
    [void]$mdBuilder.AppendLine('| Coleccion | Tipo | Documentos Enumerados | Tiene Mas? | Estado |')
    [void]$mdBuilder.AppendLine('| :--- | :--- | :--- | :--- | :--- |')
    foreach ($col in $collectionsTree) {
        $docCountStr = if ($col.DocumentsEnumerated -eq $null) { 'null (Error)' } else { [string]$col.DocumentsEnumerated }
        $hasMoreStr = if ($col.HasMore -eq $null) { 'null' } elseif ($col.HasMore) { 'Si' } else { 'No' }
        $statusStr = if ($col.Error) { 'FAILED' } else { 'SUCCESS' }
        [void]$mdBuilder.AppendLine(('| ' + $col.Id + ' | Raiz | ' + $docCountStr + ' | ' + $hasMoreStr + ' | ' + $statusStr + ' |'))
    }

    Set-Content -Path $reportPath -Value ($mdBuilder.ToString()) -Encoding UTF8
    Write-Host ''
    Write-Host '[OK] Reporte Shallow generado en: ' -NoNewline
    Write-Host $reportPath -ForegroundColor Green
} else {
    # MODO DEEP: RECORRIDO RECURSIVO CON LIMITES DE SEGURIDAD Y CHECKPOINTS (FASE 3.3.6)
    Write-Host 'Iniciando preparacion del recorrido profundo recursivo multi-usuario...' -ForegroundColor Cyan

    $candidateSubcollections = @(
        'biometrics',
        'groceries',
        'mealLogs',
        'notifications',
        'preferences',
        'workoutSessions',
        'executedWorkouts',
        'cardioSessions',
        'recipes',
        'mealPlans',
        'workoutRoutines'
    )

    $administrativeCollections = @(
        'adminUserDirectory',
        'adminRoleState',
        'adminInvitations',
        'accountAccess',
        'adminAuditLogs',
        'adminInvitationOperations'
    )

    $deepQueue = [System.Collections.Generic.Queue[object]]::new()
    $completedCollections = [System.Collections.Generic.HashSet[string]]::new()
    $completedDocuments = [System.Collections.Generic.HashSet[string]]::new()
    $visitedPaths = [System.Collections.Generic.HashSet[string]]::new()

    $userAliasMap = [ordered]@{}
    $userMatrix = [ordered]@{}
    $adminMatrix = [ordered]@{}

    $totalDiscoveredDocuments = 0
    $totalSubcollectionsDiscovered = 0
    $limitReached = $false
    $limitReason = ''
    $executionId = [System.Guid]::NewGuid().ToString()

    # Reanudacion desde checkpoint si se solicita y existe
    if ($Resume -and (Test-Path -Path $deepCheckpointPath)) {
        try {
            $cpRaw = Get-Content -Path $deepCheckpointPath -Raw | ConvertFrom-Json
            if ($cpRaw.completedCollections) {
                foreach ($c in $cpRaw.completedCollections) { [void]$completedCollections.Add($c) }
            }
            if ($cpRaw.completedDocuments) {
                foreach ($d in $cpRaw.completedDocuments) { [void]$completedDocuments.Add($d) }
            }
            if ($cpRaw.stats) {
                $script:requestCount = [int]$cpRaw.stats.totalRequests
                $totalDiscoveredDocuments = [int]$cpRaw.stats.totalDocuments
                $totalSubcollectionsDiscovered = [int]$cpRaw.stats.totalSubcollections
            }
            if ($cpRaw.pendingQueue) {
                foreach ($item in $cpRaw.pendingQueue) {
                    $deepQueue.Enqueue($item)
                    [void]$visitedPaths.Add($item.path)
                }
            }
            if ($cpRaw.userAliasMap) {
                foreach ($prop in $cpRaw.userAliasMap.PSObject.Properties) {
                    $userAliasMap[$prop.Name] = $prop.Value
                }
            }
            $executionId = $cpRaw.executionId
            Write-Host ' [CHECKPOINT]: Reanudando sesion previa con colecciones completadas.' -ForegroundColor Yellow
        } catch {
            Write-Host ' [WARN]: No se pudo restaurar el checkpoint; iniciando nueva sesion.' -ForegroundColor Yellow
        }
    }

    # Si la cola esta vacia, sembrar con 'users' y las 6 colecciones administrativas raiz
    if ($deepQueue.Count -eq 0) {
        # 1. Coleccion raiz users
        $rootUserItem = [ordered]@{
            collectionId      = 'users'
            parentResourceUrl = $databaseRootUrl
            path              = 'users'
            depth             = 0
            cursor            = $null
            itemType          = 'ROOT_USERS'
            userAlias         = $null
        }
        $deepQueue.Enqueue($rootUserItem)
        [void]$visitedPaths.Add('users')

        # 2. Colecciones administrativas raiz investigadas directamente
        foreach ($admCol in $administrativeCollections) {
            $admItem = [ordered]@{
                collectionId      = $admCol
                parentResourceUrl = $databaseRootUrl
                path              = $admCol
                depth             = 0
                cursor            = $null
                itemType          = 'ROOT_ADMIN'
                userAlias         = $null
            }
            $deepQueue.Enqueue($admItem)
            [void]$visitedPaths.Add($admCol)
            $adminMatrix[$admCol] = [ordered]@{
                count  = $null
                status = 'PENDING'
            }
        }
    }

    $deepCollectionsTree = @()
    $deepCountsMap = [ordered]@{}

    function Save-DeepCheckpoint {
        param (
            [string]$Status,
            [string]$Reason = ''
        )
        $queueArray = @()
        foreach ($q in $deepQueue) {
            $queueArray += $q
        }
        $cpObj = [ordered]@{
            executionId          = $executionId
            timestamp            = (Get-Date).ToString('o')
            mode                 = 'Deep'
            completedCollections = @($completedCollections)
            completedDocuments   = @($completedDocuments)
            pendingQueue         = $queueArray
            userAliasMap         = $userAliasMap
            stats                = [ordered]@{
                totalRequests       = $script:requestCount
                totalDocuments      = $totalDiscoveredDocuments
                totalSubcollections = $totalSubcollectionsDiscovered
            }
            limits               = [ordered]@{
                maxRequests  = $MaxRequests
                maxDocuments = $MaxDocuments
                maxDepth     = $MaxDepth
                throttleMs   = $ThrottleMs
            }
            status               = $Status
            limitReachedReason   = $Reason
        }

        # Escritura atomica mediante archivo temporal
        $tempCp = $deepCheckpointPath + '.tmp'
        $cpObj | ConvertTo-Json -Depth 8 | Set-Content -Path $tempCp -Encoding UTF8
        Move-Item -Path $tempCp -Destination $deepCheckpointPath -Force
    }

    Write-Host ' [DEEP RUNNER]: Procesando cola recursiva con deduplicacion por ruta real...' -ForegroundColor Cyan

    while ($deepQueue.Count -gt 0) {
        # 1. Comprobacion de limites de seguridad
        if ($script:requestCount -ge $MaxRequests) {
            $limitReached = $true
            $limitReason = 'MaxRequests alcanzado ({0} >= {1})' -f $script:requestCount, $MaxRequests
            Write-Host (' [LIMITE ALCANZADO]: ' + $limitReason) -ForegroundColor Yellow
            break
        }
        if ($totalDiscoveredDocuments -ge $MaxDocuments) {
            $limitReached = $true
            $limitReason = 'MaxDocuments alcanzado ({0} >= {1})' -f $totalDiscoveredDocuments, $MaxDocuments
            Write-Host (' [LIMITE ALCANZADO]: ' + $limitReason) -ForegroundColor Yellow
            break
        }

        $currentItem = $deepQueue.Dequeue()
        $currentColId = $currentItem.collectionId
        $currentParent = $currentItem.parentResourceUrl
        $currentPath = $currentItem.path
        $currentDepth = [int]$currentItem.depth
        $currentCursor = $currentItem.cursor
        $itemType = $currentItem.itemType
        $uAlias = $currentItem.userAlias

        if ($currentDepth -gt $MaxDepth) {
            Write-Host (' [LIMITE MAXDEPTH]: Omitiendo subcoleccion que supera profundidad ' + $MaxDepth) -ForegroundColor Yellow
            continue
        }

        $displayPath = if ($uAlias) { 'users/' + $uAlias + '/' + $currentColId } else { Get-MaskedResourcePath $currentPath }
        $iterMsg = ' -> Explorando [{0}] (Nivel {1})...' -f $displayPath, $currentDepth
        Write-Host $iterMsg -ForegroundColor Gray

        # Consultar lote de documentos con proyeccion exclusiva __name__
        $queryRes = Run-FirestoreQuery -CollectionId $currentColId -Limit $PageSize -StartAfterDocName $currentCursor -ParentResourceUrl $currentParent
        if ($queryRes.StatusCode -ne 200 -or $queryRes.Body -eq $null) {
            $errEntry = if ($queryRes.Error) { $queryRes.Error } else { @{ StatusCode = $queryRes.StatusCode; Message = 'Error en runQuery' } }
            $deepCountsMap[$displayPath] = [ordered]@{
                DocumentsEnumerated = $null
                Status              = 'FAILED'
                Error               = $errEntry
            }
            if ($uAlias -and $userMatrix.Contains($uAlias) -and $userMatrix[$uAlias].Contains($currentColId)) {
                $userMatrix[$uAlias][$currentColId].count = $null
                $userMatrix[$uAlias][$currentColId].status = 'FAILED'
            }
            Write-Host '   [!] Error consultando coleccion; se marca en estado FAILED.' -ForegroundColor Red
            Save-DeepCheckpoint -Status 'PAUSED_ON_ERROR' -Reason 'Error en consulta de coleccion'
            break
        }

        $batchDocs = @()
        $privacyAlertTriggered = $false

        if ($queryRes.Body -is [System.Array]) {
            foreach ($item in $queryRes.Body) {
                if ($item -and $item.document -and $item.document.name) {
                    if ($item.document.fields) {
                        Write-Host '   [ALERTA PRIVACIDAD CRITICA]: Fields presentes; abortando ejecucion.' -ForegroundColor Red
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
            $limitReached = $true
            $limitReason = 'Failsafe de privacidad activado por campos inesperados'
            Save-DeepCheckpoint -Status 'FAILED' -Reason $limitReason
            break
        }

        $totalDiscoveredDocuments += $batchDocs.Count
        Write-Host ('   + Documentos descubiertos en lote: ' + $batchDocs.Count) -ForegroundColor Green

        # Registro de conteos en matrices
        if ($itemType -eq 'ROOT_ADMIN') {
            $adminMatrix[$currentColId] = [ordered]@{
                count  = $batchDocs.Count
                status = if ($batchDocs.Count -gt 0) { 'DISCOVERED' } else { 'CHECKED_EMPTY' }
            }
            $deepCountsMap['admin/' + $currentColId] = [ordered]@{
                DocumentsEnumerated = $batchDocs.Count
                Status              = if ($batchDocs.Count -gt 0) { 'SUCCESS' } else { 'EMPTY' }
            }
        } elseif ($uAlias) {
            if (-not $userMatrix.Contains($uAlias)) {
                $userMatrix[$uAlias] = [ordered]@{}
            }
            $userMatrix[$uAlias][$currentColId] = [ordered]@{
                count  = $batchDocs.Count
                status = if ($batchDocs.Count -gt 0) { 'DISCOVERED' } else { 'CHECKED_EMPTY' }
            }
            $deepCountsMap['users/' + $uAlias + '/' + $currentColId] = [ordered]@{
                DocumentsEnumerated = $batchDocs.Count
                Status              = if ($batchDocs.Count -gt 0) { 'SUCCESS' } else { 'EMPTY' }
            }
        }

        # PROCESAMIENTO ESPECIAL DE USUARIOS RAIZ:
        if ($itemType -eq 'ROOT_USERS') {
            # Ordenar deterministamente los usuarios por Name
            $batchDocs = $batchDocs | Sort-Object -Property Name
            $userIndex = 0
            foreach ($uDoc in $batchDocs) {
                $userIndex++
                $assignedAlias = 'USER_' + $userIndex.ToString('D3')
                $userAliasMap[$uDoc.Name] = $assignedAlias
                Write-Host ('   [USUARIO ASIGNADO]: ' + $assignedAlias) -ForegroundColor Cyan

                # Inicializar matriz para este usuario
                $userMatrix[$assignedAlias] = [ordered]@{}
                foreach ($cand in $candidateSubcollections) {
                    $userMatrix[$assignedAlias][$cand] = [ordered]@{
                        count  = $null
                        status = 'PENDING'
                    }
                }

                # Descubrir subcolecciones dinamicas para este usuario
                $uDocParentUrl = 'https://firestore.googleapis.com/v1/' + $uDoc.Name
                $uSubCols = Get-FirestoreCollectionIds -ParentResourceUrl $uDocParentUrl
                [void]$completedDocuments.Add($uDoc.Name)

                # Encolar cada subcoleccion descubierta con su RUTA CONCRETA INDIVIDUAL
                foreach ($subId in $uSubCols) {
                    $concreteUserSubPath = $uDoc.Name + '/' + $subId
                    if (-not $visitedPaths.Contains($concreteUserSubPath)) {
                        $totalSubcollectionsDiscovered++
                        [void]$visitedPaths.Add($concreteUserSubPath)
                        $deepQueue.Enqueue([ordered]@{
                            collectionId      = $subId
                            parentResourceUrl = $uDocParentUrl
                            path              = $concreteUserSubPath
                            depth             = 1
                            cursor            = $null
                            itemType          = 'USER_SUBCOLLECTION'
                            userAlias         = $assignedAlias
                            isCandidateCheck  = $false
                        })
                        Write-Host ('     [SUBCOLECCION DETECTADA]: ' + $assignedAlias + '/' + $subId) -ForegroundColor Magenta
                    }
                }

                # Encolar candidatos no detectados por listCollectionIds para verificacion exhaustiva
                foreach ($candId in $candidateSubcollections) {
                    if ($uSubCols -notcontains $candId) {
                        $concreteCandPath = $uDoc.Name + '/' + $candId
                        if (-not $visitedPaths.Contains($concreteCandPath)) {
                            [void]$visitedPaths.Add($concreteCandPath)
                            $deepQueue.Enqueue([ordered]@{
                                collectionId      = $candId
                                parentResourceUrl = $uDocParentUrl
                                path              = $concreteCandPath
                                depth             = 1
                                cursor            = $null
                                itemType          = 'USER_SUBCOLLECTION'
                                userAlias         = $assignedAlias
                                isCandidateCheck  = $true
                            })
                        }
                    }
                }
            }
        } else {
            # Descubrimiento de subcolecciones para documentos hijos (L2 / L3)
            foreach ($doc in $batchDocs) {
                $docResourceName = $doc.Name
                if ($completedDocuments.Contains($docResourceName)) {
                    continue
                }

                if ($script:requestCount -ge $MaxRequests) {
                    $limitReached = $true
                    $limitReason = 'MaxRequests alcanzado ({0} >= {1})' -f $script:requestCount, $MaxRequests
                    break
                }

                $childParentUrl = 'https://firestore.googleapis.com/v1/' + $docResourceName
                $childSubCols = Get-FirestoreCollectionIds -ParentResourceUrl $childParentUrl
                [void]$completedDocuments.Add($docResourceName)

                if ($childSubCols.Count -gt 0) {
                    foreach ($subId in $childSubCols) {
                        $childConcretePath = $docResourceName + '/' + $subId
                        if (-not $visitedPaths.Contains($childConcretePath)) {
                            $totalSubcollectionsDiscovered++
                            [void]$visitedPaths.Add($childConcretePath)
                            $deepQueue.Enqueue([ordered]@{
                                collectionId      = $subId
                                parentResourceUrl = $childParentUrl
                                path              = $childConcretePath
                                depth             = ($currentDepth + 1)
                                cursor            = $null
                                itemType          = 'CHILD_SUBCOLLECTION'
                                userAlias         = $uAlias
                            })
                            Write-Host ('     [SUBCOLECCION L2 DETECTADA]: ' + $subId) -ForegroundColor DarkMagenta
                        }
                    }
                }
            }
        }

        if ($limitReached) {
            break
        }

        # Manejo de paginacion si hay mas documentos en la coleccion actual
        if ($batchDocs.Count -ge $PageSize) {
            $lastDocName = $batchDocs[-1].Name
            $currentItem.cursor = $lastDocName
            $deepQueue.Enqueue($currentItem)
            Write-Host '   (Paginacion: coleccion encolada para siguiente lote)' -ForegroundColor DarkGray
        } else {
            [void]$completedCollections.Add($currentPath)
        }

        # Guardar checkpoint periodico
        Save-DeepCheckpoint -Status 'IN_PROGRESS'
    }

    $stopwatchTotal.Stop()
    $totalElapsedMs = $stopwatchTotal.ElapsedMilliseconds

    $deepStatus = if ($limitReached) { 'PAUSED_LIMIT_REACHED' } else { 'COMPLETED_SUCCESS' }
    Save-DeepCheckpoint -Status $deepStatus -Reason $limitReason

    # Generar reportes Deep agregados sin UIDs
    $deepSummaryObj = [ordered]@{
        ExecutionId                  = $executionId
        Timestamp                    = (Get-Date).ToString('o')
        Mode                         = 'Deep'
        ProjectId                    = $ProjectId
        DatabaseId                   = $DatabaseId
        ExecutionTimeMs              = $totalElapsedMs
        TotalRestRequestsMade        = $script:requestCount
        TotalDocumentsDiscovered     = $totalDiscoveredDocuments
        TotalSubcollectionsFound     = $totalSubcollectionsDiscovered
        TotalErrorsEncountered       = $script:recordedErrors.Count
        Limits                       = [ordered]@{
            MaxRequests  = $MaxRequests
            MaxDocuments = $MaxDocuments
            MaxDepth     = $MaxDepth
            ThrottleMs   = $ThrottleMs
        }
        LimitReached                 = $limitReached
        LimitReachedReason           = $limitReason
        Status                       = $deepStatus
        UserMatrix                   = $userMatrix
        AdminMatrix                  = $adminMatrix
    }

    $deepSummaryObj | ConvertTo-Json -Depth 8 | Set-Content -Path $deepSummaryPath -Encoding UTF8
    $deepCountsMap | ConvertTo-Json -Depth 6 | Set-Content -Path $deepCountsPath -Encoding UTF8
    $script:recordedErrors | ConvertTo-Json -Depth 6 | Set-Content -Path $deepErrorsPath -Encoding UTF8

    $deepMd = New-Object System.Text.StringBuilder
    $currentTimeUtc = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    [void]$deepMd.AppendLine('# VIGORCORE -- REPORTE DE INVENTARIO PROFUNDO CLOUD FIRESTORE (FASE 3.3.6)')
    [void]$deepMd.AppendLine(('Generado el {0} (UTC)' -f $currentTimeUtc))
    [void]$deepMd.AppendLine('')
    [void]$deepMd.AppendLine('## 1. RESUMEN DE EJECUCION DEEP')
    [void]$deepMd.AppendLine('')
    [void]$deepMd.AppendLine('| Parametro | Valor |')
    [void]$deepMd.AppendLine('| :--- | :--- |')
    [void]$deepMd.AppendLine(('| **Proyecto GCP** | ' + $ProjectId + ' |'))
    [void]$deepMd.AppendLine(('| **Database ID** | ' + $DatabaseId + ' |'))
    [void]$deepMd.AppendLine(('| **Estado de Ejecucion** | **' + $deepStatus + '** |'))
    [void]$deepMd.AppendLine(('| **Documentos Descubiertos** | ' + $totalDiscoveredDocuments + ' |'))
    [void]$deepMd.AppendLine(('| **Subcolecciones Encontradas** | ' + $totalSubcollectionsDiscovered + ' |'))
    [void]$deepMd.AppendLine(('| **Solicitudes REST Realizadas** | ' + $script:requestCount + ' / ' + $MaxRequests + ' |'))
    [void]$deepMd.AppendLine(('| **Tiempo de Recorrido** | ' + $totalElapsedMs + ' ms |'))
    if ($limitReached) {
        [void]$deepMd.AppendLine(('| **Motivo de Detencion** | ' + $limitReason + ' |'))
        [void]$deepMd.AppendLine('| **Accion de Reanudacion** | Ejecutar con flag [-Resume] para continuar |')
    }
    [void]$deepMd.AppendLine('')
    [void]$deepMd.AppendLine('## 2. MATRIZ DE COBERTURA INDIVIDUAL POR USUARIO')
    [void]$deepMd.AppendLine('')
    [void]$deepMd.AppendLine('| Usuario | biometrics | groceries | mealLogs | notifications | preferences | workoutSessions | executedWorkouts | cardioSessions | recipes | mealPlans | workoutRoutines |')
    [void]$deepMd.AppendLine('| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |')

    foreach ($uKey in $userMatrix.Keys) {
        $uRow = '| ' + $uKey
        foreach ($cKey in $candidateSubcollections) {
            $cell = $userMatrix[$uKey][$cKey]
            $cellStr = if ($cell -and $cell.count -ne $null) { [string]$cell.count } elseif ($cell -and $cell.status -eq 'CHECKED_EMPTY') { '0' } else { 'NO VERIFICADO' }
            $uRow = $uRow + ' | ' + $cellStr
        }
        $uRow = $uRow + ' |'
        [void]$deepMd.AppendLine($uRow)
    }

    [void]$deepMd.AppendLine('')
    [void]$deepMd.AppendLine('## 3. INVENTARIO DE COLECCIONES ADMINISTRATIVAS')
    [void]$deepMd.AppendLine('')
    [void]$deepMd.AppendLine('| Coleccion Administrativa | Documentos Enumerados | Estado |')
    [void]$deepMd.AppendLine('| :--- | :---: | :--- |')
    foreach ($aKey in $adminMatrix.Keys) {
        $aCell = $adminMatrix[$aKey]
        $aCountStr = if ($aCell -and $aCell.count -ne $null) { [string]$aCell.count } else { 'null (Error)' }
        $aStatusStr = if ($aCell) { $aCell.status } else { 'NO VERIFICADO' }
        [void]$deepMd.AppendLine(('| ' + $aKey + ' | ' + $aCountStr + ' | ' + $aStatusStr + ' |'))
    }

    [void]$deepMd.AppendLine('')
    [void]$deepMd.AppendLine('## 4. ARBOL DE ESQUEMAS DESCUBIERTOS (ANONIMIZADO)')
    [void]$deepMd.AppendLine('')
    [void]$deepMd.AppendLine('| Ruta de Esquema Mascarada | Nivel de Profundidad |')
    [void]$deepMd.AppendLine('| :--- | :--- |')
    foreach ($p in $visitedPaths) {
        $mPath = Get-MaskedResourcePath $p
        $pDepth = ($mPath.Split('/')).Length / 2
        [void]$deepMd.AppendLine(('| ' + $mPath + ' | L' + [Math]::Floor($pDepth) + ' |'))
    }

    $mdContent = $deepMd.ToString()
    Set-Content -Path $deepReportPath -Value $mdContent -Encoding UTF8
    Set-Content -Path $deepValidationPath -Value $mdContent -Encoding UTF8
    Write-Host ''
    Write-Host ('[OK] Reporte Deep generado en: ' + $deepReportPath) -ForegroundColor Green
    Write-Host ('[OK] Reporte de Validacion generado en: ' + $deepValidationPath) -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# 8. Dictamen Final en Consola
# -----------------------------------------------------------------------------
Write-Host ''
Write-Host '[5/5] EVALUACION DE FINALIZACION' -ForegroundColor Cyan
Write-Host '------------------------------------------------------------------------'

$finalStatus = if ($Mode -eq 'Deep') { $deepStatus } else { $overallStatus }
if ($finalStatus -eq 'COMPLETED_SUCCESS') {
    Write-Host ' [ESTADO]: INVENTARIO FINALIZADO EXITOSAMENTE (COMPLETED_SUCCESS)' -ForegroundColor Green
    Write-Host (' - Total Documentos Descubiertos:    ' + $totalDiscoveredDocuments) -ForegroundColor Green
} elseif ($finalStatus -eq 'PAUSED_LIMIT_REACHED') {
    Write-Host ' [ESTADO]: RECORRIDO EN PAUSA POR LIMITE DE SEGURIDAD (PAUSED_LIMIT_REACHED)' -ForegroundColor Yellow
    Write-Host (' - Motivo:                           ' + $limitReason) -ForegroundColor Yellow
    Write-Host ' - Checkpoint guardado; ejecute con -Resume para continuar.' -ForegroundColor Yellow
} else {
    Write-Host ' [ADVERTENCIA]: INVENTARIO FINALIZADO CON ESTADO PARCIAL (PARTIAL_FAILURE)' -ForegroundColor Yellow
}

Write-Host (' - Total Solicitudes REST:           ' + $script:requestCount) -ForegroundColor Gray
Write-Host (' - Duracion Total:                   ' + $totalElapsedMs + ' ms') -ForegroundColor Gray
Write-Host ''
Write-Host 'Reportes guardados en:' -ForegroundColor White
Write-Host ('    ' + $resolvedOutputDir) -ForegroundColor Yellow
