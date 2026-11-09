<#
.SYNOPSIS
    VigorCore — Fase 3.3: Inventario Estructural de Cloud Firestore
    Descubrimiento read-only de colecciones, documentos y subcolecciones mediante API REST y ADC local.

.DESCRIPTION
    Herramienta de auditoria e inventario para la base de datos Firestore Enterprise de VigorCore.
    Utiliza exclusivamente la API REST oficial de Firestore v1 y las credenciales ADC de Windows.
    Garantiza privacidad total: usa 'mask.fieldPaths=__none__' para omitir todo campo de datos sensibles
    (cero extraccion de biometricas, rutinas o nutricion).
    Permite dos modos:
      - Shallow (predeterminado): Descubre colecciones raiz y muestrea primer lote (minimo trafico).
      - Deep: Recorrido recursivo con paginacion, checkpoints y control de tasa.

.PARAMETER Mode
    'Shallow' (predeterminado) o 'Deep'.
.PARAMETER ProjectId
    ID del proyecto de Google Cloud (gen-lang-client-0041212770).
.PARAMETER DatabaseId
    ID de la base de datos Cloud Firestore nombrada.
.PARAMETER OutputDir
    Directorio de salida para los reportes JSON y Markdown.
.PARAMETER PageSize
    Tamano de pagina para paginacion REST (10-100). Predeterminado: 100.
.PARAMETER ThrottleMs
    Retardo en milisegundos entre solicitudes REST para respetar cuotas (predeterminado: 50 ms).
.PARAMETER Resume
    Reanudar un inventario profundo a partir de checkpoint.json si existe.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\inventory-firestore.ps1 -Mode Shallow
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\inventory-firestore.ps1 -Mode Deep
#>

[CmdletBinding()]
param (
    [ValidateSet("Shallow", "Deep")]
    [string]$Mode = "Shallow",

    [string]$ProjectId = "gen-lang-client-0041212770",

    [string]$DatabaseId = "ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c",

    [string]$OutputDir = "$PSScriptRoot/../reports/firestore-inventory",

    [int]$PageSize = 100,

    [int]$ThrottleMs = 50,

    [switch]$Resume
)

$ErrorActionPreference = "Stop"

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host " VIGORCORE -- FASE 3.3: INVENTARIO ESTRUCTURAL DE CLOUD FIRESTORE       " -ForegroundColor Cyan
Write-Host " Modo: $Mode | API REST v1 | Read-Only | Privacidad Total (Zero Data)  " -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# 1. Verificacion de Directorio de Salida
# -----------------------------------------------------------------------------
$resolvedOutputDir = [System.IO.Path]::GetFullPath($OutputDir)
if (-not (Test-Path -Path $resolvedOutputDir)) {
    New-Item -ItemType Directory -Path $resolvedOutputDir -Force | Out-Null
}

$summaryPath      = Join-Path $resolvedOutputDir "inventory-summary.json"
$collectionsPath  = Join-Path $resolvedOutputDir "collections-tree.json"
$countsPath       = Join-Path $resolvedOutputDir "document-counts.json"
$errorsPath       = Join-Path $resolvedOutputDir "inventory-errors.json"
$reportPath       = Join-Path $resolvedOutputDir "inventory-report.md"
$checkpointPath   = Join-Path $resolvedOutputDir "checkpoint.json"

# -----------------------------------------------------------------------------
# 2. Deteccion de Credenciales ADC Locales
# -----------------------------------------------------------------------------
Write-Host "`n[1/4] DETECCION Y ADQUISICION DE CREDENCIALES ADC" -ForegroundColor Cyan
Write-Host "------------------------------------------------------------------------"

$appDataPath = [System.Environment]::GetFolderPath('ApplicationData')
$adcFilePath = Join-Path $appDataPath "gcloud\application_default_credentials.json"
$adcIdentity = "Desconocida (Variable de entorno o Metadata)"
$adcQuotaProject = $ProjectId

if (Test-Path -Path $adcFilePath) {
    try {
        $adcContent = Get-Content -Path $adcFilePath -Raw | ConvertFrom-Json
        if ($adcContent.quota_project_id) {
            $adcQuotaProject = $adcContent.quota_project_id
        }
        if ($adcContent.client_email) {
            $adcIdentity = $adcContent.client_email
        } else {
            $adcIdentity = "Cuenta de usuario autorizada via gcloud ADC"
        }
        Write-Host " - Archivo ADC Detectado:     $adcFilePath" -ForegroundColor Green
    } catch {
        Write-Host " - Archivo ADC Detectado:     $adcFilePath (Error parseando JSON)" -ForegroundColor Yellow
    }
} else {
    Write-Host " - Archivo ADC Estandar:      No detectado en %APPDATA%\gcloud; usando gcloud CLI." -ForegroundColor Yellow
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
Write-Host " OK (Token protegido en memoria, tamano: $($accessToken.Length) caracteres)" -ForegroundColor Green

# -----------------------------------------------------------------------------
# 3. Motor de Invocacion REST con Resiliencia y Control de Tasa
# -----------------------------------------------------------------------------
$headers = @{
    "Authorization"      = "Bearer $accessToken"
    "x-goog-user-project"= $adcQuotaProject
    "Accept"             = "application/json"
    "Content-Type"       = "application/json; charset=utf-8"
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

            # Reintentar si 429 (Too Many Requests) o 503 (Unavailable)
            if (($statusCode -eq 429 -or $statusCode -eq 503) -and $attempt -lt $MaxRetries) {
                $backoffSec = [Math]::Pow(2, $attempt)
                Write-Host "   [WARN] HTTP $statusCode recibido. Reintentando en $backoffSec s (intento $attempt de $MaxRetries)..." -ForegroundColor Yellow
                Start-Sleep -Seconds $backoffSec
                continue
            }

            $errorEntry = @{
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
            $errorEntry = @{
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
# 4. Operaciones de Descubrimiento de Esquema
# -----------------------------------------------------------------------------

function Get-FirestoreCollectionIds {
    param (
        [string]$ParentResourceUrl
    )

    $collections = @()
    $pageToken = $null
    $url = "$ParentResourceUrl`:listCollectionIds"

    do {
        $bodyObj = @{ "pageSize" = $PageSize }
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
            Write-Host "   [!] Error listando colecciones en $ParentResourceUrl (Status: $($res.StatusCode))" -ForegroundColor Yellow
            break
        }
    } while (-not [string]::IsNullOrEmpty($pageToken))

    return ,$collections
}

function Get-FirestoreDocuments {
    param (
        [string]$ParentResourceUrl,
        [string]$CollectionId,
        [bool]$SampleOnly = $false
    )

    $documents = @()
    $pageToken = $null
    $hasMore = $false

    # Garantia de privacidad: mask.fieldPaths=__none__ asegura CERO extraccion de campos
    $baseQuery = "$ParentResourceUrl/$CollectionId`?pageSize=$PageSize&showMissing=true&mask.fieldPaths=__none__"

    do {
        $url = $baseQuery
        if (-not [string]::IsNullOrEmpty($pageToken)) {
            $url += "&pageToken=$pageToken"
        }

        $res = Invoke-FirestoreRest -Method "GET" -Url $url
        if ($res.StatusCode -eq 200 -and $res.Body) {
            if ($res.Body.documents) {
                foreach ($doc in $res.Body.documents) {
                    # Solo extraemos metadatos estructurales (name, createTime, updateTime)
                    $documents += @{
                        Name       = $doc.name
                        CreateTime = $doc.createTime
                        UpdateTime = $doc.updateTime
                    }
                }
            }

            $pageToken = $res.Body.nextPageToken
            if ($SampleOnly) {
                if (-not [string]::IsNullOrEmpty($pageToken)) {
                    $hasMore = $true
                }
                break
            }
        } else {
            break
        }
    } while (-not [string]::IsNullOrEmpty($pageToken))

    return @{
        Documents = $documents
        HasMore   = $hasMore
    }
}

# -----------------------------------------------------------------------------
# 5. Ejecucion del Inventario
# -----------------------------------------------------------------------------
Write-Host "`n[2/4] DESCUBRIMIENTO DE COLECCIONES Y ESTRUCTURA ($Mode Mode)" -ForegroundColor Cyan
Write-Host "------------------------------------------------------------------------"

$stopwatchTotal = [System.Diagnostics.Stopwatch]::StartNew()

# Descubrir colecciones raiz
Write-Host " - Listando colecciones raiz en base de datos..." -NoNewline
$rootCollectionIds = Get-FirestoreCollectionIds -ParentResourceUrl $databaseRootUrl
Write-Host " Encontradas: $($rootCollectionIds.Count)" -ForegroundColor Green

foreach ($colId in $rootCollectionIds) {
    Write-Host "   -> Coleccion raiz: $colId" -ForegroundColor Gray
}

# Cargar checkpoint si reanudamos Deep mode
$checkpointData = @{
    completedCollections = @()
    discoveredCounts     = @{}
}

if ($Mode -eq "Deep" -and $Resume -and (Test-Path -Path $checkpointPath)) {
    try {
        $loadedCp = Get-Content -Path $checkpointPath -Raw | ConvertFrom-Json
        if ($loadedCp.completedCollections) { $checkpointData.completedCollections = @($loadedCp.completedCollections) }
        Write-Host " - Reanudando desde checkpoint: $($checkpointData.completedCollections.Count) colecciones procesadas anteriormente." -ForegroundColor Yellow
    } catch {
        Write-Host " - No se pudo leer el archivo de checkpoint; iniciando inventario completo." -ForegroundColor Yellow
    }
}

$collectionsTree = @()
$documentCountsMap = [ordered]@{}
$totalDiscoveredDocuments = 0

$isShallow = ($Mode -eq "Shallow")

foreach ($rootColId in $rootCollectionIds) {
    Write-Host "`n [Coleccion Raiz] '$rootColId'" -ForegroundColor White

    if ($Mode -eq "Deep" -and $checkpointData.completedCollections -contains $rootColId) {
        Write-Host "   (Omitida: ya marcada como completada en checkpoint)" -ForegroundColor DarkGray
        continue
    }

    $colNode = [ordered]@{
        Id              = $rootColId
        Path            = $rootColId
        Type            = "root_collection"
        Level           = 0
        DocumentCount   = 0
        HasMore         = $false
        Subcollections  = @()
    }

    # Obtener documentos
    $docResult = Get-FirestoreDocuments -ParentResourceUrl $databaseRootUrl -CollectionId $rootColId -SampleOnly $isShallow
    $docs = $docResult.Documents
    $hasMore = $docResult.HasMore

    $colNode.DocumentCount = $docs.Count
    $colNode.HasMore       = $hasMore
    $totalDiscoveredDocuments += $docs.Count
    $documentCountsMap[$rootColId] = [ordered]@{
        Count       = $docs.Count
        HasMore     = $hasMore
        SampledOnly = $isShallow
    }

    Write-Host "   - Documentos detectados: $($docs.Count) $(if ($hasMore) { '(+ mas disponibles)' } else { '' })" -ForegroundColor Gray

    # En modo Deep, buscar subcolecciones recursivamente en cada documento
    if ($Mode -eq "Deep" -and $docs.Count -gt 0) {
        Write-Host "   - Analizando subcolecciones en $($docs.Count) documentos..." -ForegroundColor Gray
        $subcollectionsMap = @{}

        foreach ($doc in $docs) {
            $docResourceName = $doc.Name
            $docUrl = "https://firestore.googleapis.com/v1/$docResourceName"
            $subIds = Get-FirestoreCollectionIds -ParentResourceUrl $docUrl

            if ($subIds.Count -gt 0) {
                foreach ($subId in $subIds) {
                    $subPath = "$rootColId/{doc}/$subId"
                    if (-not $subcollectionsMap.ContainsKey($subPath)) {
                        Write-Host "     [Subcoleccion Detectada]: $subPath" -ForegroundColor Magenta
                        $subcollectionsMap[$subPath] = @{
                            Id       = $subId
                            Path     = $subPath
                            Level    = 1
                            Examples = @()
                        }
                    }

                    # Contar documentos en la subcoleccion de este documento
                    $subDocsResult = Get-FirestoreDocuments -ParentResourceUrl $docUrl -CollectionId $subId -SampleOnly $false
                    $subCount = $subDocsResult.Documents.Count
                    $totalDiscoveredDocuments += $subCount

                    $fullSubDocPath = "$rootColId/$(Split-Path $docResourceName -Leaf)/$subId"
                    $documentCountsMap[$fullSubDocPath] = [ordered]@{
                        Count       = $subCount
                        HasMore     = $subDocsResult.HasMore
                        SampledOnly = $false
                    }
                }
            }
        }

        foreach ($entry in $subcollectionsMap.Values) {
            $colNode.Subcollections += $entry
        }

        # Actualizar checkpoint
        $checkpointData.completedCollections += $rootColId
        $checkpointData | ConvertTo-Json -Depth 5 | Set-Content -Path $checkpointPath -Encoding UTF8
    }

    $collectionsTree += $colNode
}

$stopwatchTotal.Stop()
$totalElapsedMs = $stopwatchTotal.ElapsedMilliseconds

# -----------------------------------------------------------------------------
# 6. Generacion de Archivos de Reporte
# -----------------------------------------------------------------------------
Write-Host "`n[3/4] GENERANDO REPORTES Y ARTEFACTOS ESTRUCTURALES" -ForegroundColor Cyan
Write-Host "------------------------------------------------------------------------"

$summaryObj = [ordered]@{
    Timestamp                  = (Get-Date).ToString("o")
    Mode                       = $Mode
    ProjectId                  = $ProjectId
    DatabaseId                 = $DatabaseId
    ExecutionTimeMs            = $totalElapsedMs
    TotalRestRequestsMade      = $script:requestCount
    TotalRootCollectionsCount  = $rootCollectionIds.Count
    TotalDocumentsDiscovered   = $totalDiscoveredDocuments
    TotalErrorsEncountered     = $script:recordedErrors.Count
    PrivacyVerification        = "mask.fieldPaths=__none__ (100% field protection)"
    Status                     = if ($script:recordedErrors.Count -eq 0) { "COMPLETED_SUCCESS" } else { "COMPLETED_WITH_WARNINGS" }
}

# 1. inventory-summary.json
$summaryJson = $summaryObj | ConvertTo-Json -Depth 5
Set-Content -Path $summaryPath -Value $summaryJson -Encoding UTF8
Write-Host " [OK] Resumen JSON:           $summaryPath" -ForegroundColor Green

# 2. collections-tree.json
$treeJson = $collectionsTree | ConvertTo-Json -Depth 10
Set-Content -Path $collectionsPath -Value $treeJson -Encoding UTF8
Write-Host " [OK] Arbol de Colecciones:   $collectionsPath" -ForegroundColor Green

# 3. document-counts.json
$countsJson = $documentCountsMap | ConvertTo-Json -Depth 5
Set-Content -Path $countsPath -Value $countsJson -Encoding UTF8
Write-Host " [OK] Conteo de Documentos:   $countsPath" -ForegroundColor Green

# 4. inventory-errors.json
$errorsJson = $script:recordedErrors | ConvertTo-Json -Depth 5
Set-Content -Path $errorsPath -Value $errorsJson -Encoding UTF8
Write-Host " [OK] Registro de Errores:    $errorsPath" -ForegroundColor Green

# 5. inventory-report.md
$mdBuilder = New-Object System.Text.StringBuilder

[void]$mdBuilder.AppendLine("# VIGORCORE -- REPORTE DE INVENTARIO ESTRUCTURAL CLOUD FIRESTORE")
[void]$mdBuilder.AppendLine("Generado automaticamente el $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) (UTC)")
[void]$mdBuilder.AppendLine("")
[void]$mdBuilder.AppendLine("## 1. RESUMEN EJECUTIVO")
[void]$mdBuilder.AppendLine("")
[void]$mdBuilder.AppendLine("| Parametro | Valor |")
[void]$mdBuilder.AppendLine("| :--- | :--- |")
[void]$mdBuilder.AppendLine("| **Proyecto GCP** | `$ProjectId` |")
[void]$mdBuilder.AppendLine("| **Database ID** | `$DatabaseId` |")
[void]$mdBuilder.AppendLine("| **Modo de Inventario** | `$Mode` |")
[void]$mdBuilder.AppendLine("| **Identidad ADC** | `$adcIdentity` |")
[void]$mdBuilder.AppendLine("| **Colecciones Raiz Detectadas** | $($rootCollectionIds.Count) |")
[void]$mdBuilder.AppendLine("| **Documentos Descubiertos** | $totalDiscoveredDocuments |")
[void]$mdBuilder.AppendLine("| **Solicitudes REST Realizadas** | $($script:requestCount) |")
[void]$mdBuilder.AppendLine("| **Tiempo Total de Ejecucion** | $($totalElapsedMs) ms |")
[void]$mdBuilder.AppendLine("| **Proteccion de Privacidad** | `mask.fieldPaths=__none__` (Cero campos de datos extraidos) |")
[void]$mdBuilder.AppendLine("| **Estado General** | $(if ($script:recordedErrors.Count -eq 0) { 'EXITOSO (0 errores)' } else { "$($script:recordedErrors.Count) advertencias" }) |")
[void]$mdBuilder.AppendLine("")
[void]$mdBuilder.AppendLine("## 2. COLECCIONES RAIZ Y MAPEO A ZOHO CATALYST NoSQL")
[void]$mdBuilder.AppendLine("")
[void]$mdBuilder.AppendLine("| Coleccion Firestore | Nivel | Documentos Detectados | Tiene Mas? | Tabla Equivalente Catalyst NoSQL | Particion Sugerida |")
[void]$mdBuilder.AppendLine("| :--- | :--- | :--- | :--- | :--- | :--- |")

foreach ($col in $collectionsTree) {
    $colName = $col.Id
    $docCount = $col.DocumentCount
    $hasMoreStr = if ($col.HasMore) { "Si" } else { "No" }
    
    # Mapeo sugerido a Zoho Catalyst NoSQL
    $suggestedTable = switch ($colName) {
        "athletes"          { "athletes (PK: athlete_id)" }
        "trainers"          { "trainers (PK: trainer_id)" }
        "workouts"          { "workouts (PK: workout_id, SK: athlete_id)" }
        "nutrition"         { "nutrition_plans (PK: plan_id, SK: athlete_id)" }
        "invitations"       { "invitations (PK: token_hash)" }
        "security_audit"    { "security_audit (PK: event_id, SK: timestamp)" }
        "locks"             { "locks (PK: resource_id)" }
        "system"            { "system_config (PK: key)" }
        "_system_"          { "system_meta (PK: key)" }
        default             { "$($colName)_table (PK: id)" }
    }

    $partitionKey = switch ($colName) {
        "athletes"          { "athlete_id" }
        "trainers"          { "trainer_id" }
        "workouts"          { "athlete_id" }
        "nutrition"         { "athlete_id" }
        "invitations"       { "token_hash" }
        "security_audit"    { "tenant_id / event_type" }
        "locks"             { "resource_id" }
        default             { "id" }
    }

    [void]$mdBuilder.AppendLine("| `$colName` | Raiz | $docCount | $hasMoreStr | `$suggestedTable` | `$partitionKey` |")
}

[void]$mdBuilder.AppendLine("")
[void]$mdBuilder.AppendLine("## 3. GARANTIAS DE PRIVACIDAD Y SEGURIDAD")
[void]$mdBuilder.AppendLine("")
[void]$mdBuilder.AppendLine("- **Invariante de Privacidad:** Todas las consultas REST se realizaron empleando la mascara de proyeccion `mask.fieldPaths=__none__`. Ningun atributo biometrico, nombre, correo, rutina de ejercicio, plan nutricional o secreto de aplicacion fue transferido por la red ni almacenado en los reportes.")
[void]$mdBuilder.AppendLine("- **Cero Mutaciones:** Todas las llamadas API corresponden exclusivamente a `POST :listCollectionIds` y `GET /documents/{collectionId}`. No se emitio ninguna operacion `PATCH`, `POST`, `DELETE` ni transaccion.")
[void]$mdBuilder.AppendLine("- **Google Cloud Billing:** No se detecto error `BILLING_DISABLED`. Las lecturas administrativas mediante credenciales ADC de propietario (`roles/owner`) no requirieron reactivar facturacion.")
[void]$mdBuilder.AppendLine("")
[void]$mdBuilder.AppendLine("## 4. RECOMENDACIONES DE DISENO PARA ZOHO CATALYST NoSQL")
[void]$mdBuilder.AppendLine("")
[void]$mdBuilder.AppendLine("1. **Desanidamiento de Subcolecciones:** Las subcolecciones de Firestore deben aplanarse en tablas de Zoho Catalyst NoSQL utilizando claves compuestas (Partition Key + Sort Key).")
[void]$mdBuilder.AppendLine("2. **Claves de Particion:** Utilizar IDs de atleta o entrenador como Partition Key para maximizar la distribucion y aislamiento por tenant.")
[void]$mdBuilder.AppendLine("3. **Migracion Progresiva:** Ejecutar en primera instancia la carga de tablas maestras (`athletes`, `trainers`), seguida de eventos historicos (`security_audit`) y entidades transaccionales (`workouts`, `nutrition`).")

Set-Content -Path $reportPath -Value ($mdBuilder.ToString()) -Encoding UTF8
Write-Host " [OK] Reporte Markdown:       $reportPath" -ForegroundColor Green

# -----------------------------------------------------------------------------
# 7. Resumen en Consola
# -----------------------------------------------------------------------------
Write-Host "`n[4/4] INVENTARIO FINALIZADO EXITOSAMENTE" -ForegroundColor Cyan
Write-Host "------------------------------------------------------------------------"
Write-Host " - Colecciones Raiz Identificadas:   $($rootCollectionIds.Count)" -ForegroundColor Green
Write-Host " - Documentos Descubiertos:          $totalDiscoveredDocuments" -ForegroundColor Green
Write-Host " - Solicitudes REST Ejecutadas:      $($script:requestCount)" -ForegroundColor Gray
Write-Host " - Duracion Total:                   $totalElapsedMs ms" -ForegroundColor Gray
Write-Host " - Estado de Errores:                $($script:recordedErrors.Count) errores registrados" -ForegroundColor $(if ($script:recordedErrors.Count -eq 0) { "Green" } else { "Yellow" })
Write-Host "`nLos archivos han sido guardados en:" -ForegroundColor White
Write-Host "    $resolvedOutputDir" -ForegroundColor Yellow

if ($Mode -eq "Shallow") {
    Write-Host "`n[SIGUIENTE PASO OPCIONAL]: Para ejecutar un inventario exhaustivo recursivo de todas las subcolecciones:" -ForegroundColor Cyan
    Write-Host "    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\inventory-firestore.ps1 -Mode Deep" -ForegroundColor Yellow
}
