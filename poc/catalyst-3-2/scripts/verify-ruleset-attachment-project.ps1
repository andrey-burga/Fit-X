<#
.SYNOPSIS
    VigorCore Fase 3.5.0.12 — Diagnóstico Forense de Discrepancia de Project Number
    Consulta exclusivamente de lectura mediante Google Cloud Resource Manager (gcloud).

.DESCRIPTION
    Verifica de forma objetiva, sin asumir validez previa de ningún número:
    1. Ejecuta 'gcloud projects describe <ExpectedProjectId> --format=json' para obtener
       projectId, projectNumber y lifecycleState reales en Google Cloud Resource Manager.
    2. Compara el projectNumber real obtenido contra el valor esperado (510844325101)
       y contra el valor observado en attachment_point (955230563489).
    3. Ejecuta 'gcloud projects list --filter="projectNumber=955230563489" --format=json'
       sobre los proyectos accesibles a la cuenta activa de gcloud.
    4. Si el proyecto 955230563489 es visible, muestra su projectId, projectNumber y lifecycleState.
    5. Si el resultado está vacío, clasifica estrictamente como PROJECT_NOT_VISIBLE_TO_ACTIVE_ACCOUNT
       (NUNCA como prueba de inexistencia del proyecto).
    6. En caso de discrepancia entre projectNumber real y 510844325101, consulta también
       'gcloud projects list --filter="projectNumber=510844325101" --format=json' en modo solo lectura.
    7. Distingue explícitamente errores de autenticación, permisos, API, respuesta vacía y JSON malformado.
    8. Nunca imprime ni persiste tokens, cabeceras Authorization ni credenciales.
    9. Genera un informe JSON local con resultados, diagnóstico y limitaciones.

    RESTRICCIONES ABSOLUTAS:
    - CERO llamadas a Firebase Rules API (ni releases, ni rulesets.list, ni rulesets.get).
    - CERO descarga de contenido de reglas remotas.
    - CERO modificaciones de proyecto, IAM, facturación, releases, rulesets ni configuración local.
    - NO corrige automáticamente números esperados ni relaja validaciones de seguridad.

.PARAMETER ExpectedProjectId
    ID del proyecto GCP esperado (default: "gen-lang-client-0041212770").

.PARAMETER ExpectedProjectNumber
    Número de proyecto previamente esperado en Fase 3.5.0.9 (default: "510844325101").

.PARAMETER ObservedAttachmentProjectNumber
    Número de proyecto observado en el attachment_point remoto (default: "955230563489").

.PARAMETER DatabaseId
    ID de la base de datos Firestore nombrada (default: "ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c").

.PARAMETER ReportPath
    Ruta local de salida del informe JSON (default: "reports/firestore-extraction-3.5.0.12/ruleset-attachment-project-verification.json").
#>

[CmdletBinding()]
param(
    [string]$ExpectedProjectId = "gen-lang-client-0041212770",
    [string]$ExpectedProjectNumber = "510844325101",
    [string]$ObservedAttachmentProjectNumber = "955230563489",
    [string]$DatabaseId = "ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c",
    [string]$ReportPath = "reports/firestore-extraction-3.5.0.12/ruleset-attachment-project-verification.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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

function Remove-SensitiveStrings {
    param(
        [Parameter(Mandatory = $false)]
        [string]$InputText
    )

    if ([string]::IsNullOrEmpty($InputText)) {
        return ""
    }

    $sanitized = $InputText -replace "ya29\.[a-zA-Z0-9_\-\.]+", "[REDACTED_TOKEN]"
    $sanitized = $sanitized -replace "(?i)Bearer\s+[a-zA-Z0-9_\-\.]+", "Bearer [REDACTED_TOKEN]"
    $sanitized = $sanitized -replace "(?i)Authorization\s*:\s*[^\r\n]+", "Authorization: [REDACTED]"
    return $sanitized
}

function Resolve-GcloudErrorClassification {
    param(
        [Parameter(Mandatory = $false)]
        [string]$ErrorText
    )

    $msg = if ($ErrorText) { $ErrorText } else { "" }

    if ($msg -match "(?i)(Reauthentication|invalid_rapt|HTTP\s*401|401\s+Unauthorized|not logged in|no currently active account|No credentialed accounts|gcloud auth login|UNAUTHENTICATED|invalid_grant|RefreshError|Could not reach metadata|credentials were not found|Your credentials)") {
        return "AUTH_ERROR"
    }

    if ($msg -match "(?i)(PERMISSION_DENIED|HTTP\s*403|403\s+Forbidden|does not have permission|not authorized|resourcemanager\.projects\.(get|list)|Caller does not have)") {
        return "PERMISSION_DENIED"
    }

    return "API_ERROR"
}

function Invoke-GcloudReadJson {
    param(
        [Parameter(Mandatory = $true)]
        [string]$GcloudExecutable,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $result = [ordered]@{
        ok             = $false
        classification = "UNKNOWN"
        exitCode       = -1
        data           = $null
        errorDetail    = $null
    }

    $errTempFile = [System.IO.Path]::GetTempFileName()
    $prevEap = $ErrorActionPreference
    $stdoutRaw = ""
    $stderrRaw = ""
    $exitCode = -1

    try {
        $ErrorActionPreference = "Continue"
        $stdoutLines = & $GcloudExecutable @Arguments 2> $errTempFile
        $exitCode = $LASTEXITCODE
        $stdoutRaw = ($stdoutLines | Out-String).Trim()
        if (Test-Path $errTempFile) {
            $stderrRaw = [System.IO.File]::ReadAllText($errTempFile).Trim()
        }
    }
    catch {
        $stderrRaw = $_.Exception.Message
        $exitCode = 1
    }
    finally {
        $ErrorActionPreference = $prevEap
        if (Test-Path $errTempFile) {
            Remove-Item -Path $errTempFile -Force -ErrorAction SilentlyContinue
        }
    }

    $sanitizedErr = Remove-SensitiveStrings -InputText $stderrRaw
    $result.exitCode = $exitCode

    if ($exitCode -ne 0) {
        $result.classification = Resolve-GcloudErrorClassification -ErrorText $sanitizedErr
        $result.errorDetail = if ([string]::IsNullOrWhiteSpace($sanitizedErr)) { "gcloud finalizó con código $exitCode sin detalle en stderr." } else { $sanitizedErr }
        return $result
    }

    if ([string]::IsNullOrWhiteSpace($stdoutRaw)) {
        $result.classification = "EMPTY_RESPONSE"
        $result.errorDetail = "gcloud finalizó con código 0 pero retornó salida vacía."
        return $result
    }

    try {
        $parsed = ConvertFrom-Json -InputObject $stdoutRaw
        $result.ok = $true
        $result.classification = "SUCCESS"
        $result.data = $parsed
        return $result
    }
    catch {
        $result.classification = "MALFORMED_JSON"
        $result.errorDetail = Remove-SensitiveStrings -InputText ("JSON malformado en respuesta de gcloud: " + $_.Exception.Message)
        return $result
    }
}

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host " VIGORCORE — FASE 3.5.0.12: VERIFICACIÓN DE PROJECT NUMBER (SOLO LECTURA)" -ForegroundColor Cyan
Write-Host " Fuente: Google Cloud Resource Manager (gcloud CLI)" -ForegroundColor Cyan
Write-Host " Proyecto Esperado     : $ExpectedProjectId" -ForegroundColor Cyan
Write-Host " Número Previo Esperado: $ExpectedProjectNumber" -ForegroundColor Cyan
Write-Host " Número en Ruleset     : $ObservedAttachmentProjectNumber" -ForegroundColor Cyan
Write-Host " Base de Datos         : $DatabaseId" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan

$gcloudCmd = Get-Command gcloud -ErrorAction SilentlyContinue
if ($null -eq $gcloudCmd) {
    Write-Host "[!] ERROR: No se encontró el binario 'gcloud' en el PATH del sistema." -ForegroundColor Red
    Write-Host "`nDictamen: GCLOUD_CLI_NOT_FOUND" -ForegroundColor Red
    exit 1
}

$gcloudPath = $gcloudCmd.Source

# 1. Consultar proyecto esperado mediante gcloud projects describe
Write-Host "`n[PASO 1/3] Ejecutando 'gcloud projects describe $ExpectedProjectId --format=json'..." -ForegroundColor Yellow
$describeRes = Invoke-GcloudReadJson -GcloudExecutable $gcloudPath -Arguments @("projects", "describe", $ExpectedProjectId, "--format=json")

$expectedDescribeReport = [ordered]@{
    command                          = "gcloud projects describe $ExpectedProjectId --format=json"
    status                           = if ($describeRes.ok) { "OK" } else { "ERROR" }
    classification                   = $describeRes.classification
    projectId                        = $null
    projectNumber                    = $null
    lifecycleState                   = $null
    matchesExpectedProjectNumber     = $false
    matchesObservedAttachmentNumber  = $false
    comparisonStatus                 = "UNVERIFIED_DUE_TO_ERROR"
    errorDetail                      = $describeRes.errorDetail
}

if ($describeRes.ok) {
    $descObj = $describeRes.data
    $actualId = [string](Get-SafePropertyValue -Target $descObj -PropertyName "projectId")
    $actualNumber = [string](Get-SafePropertyValue -Target $descObj -PropertyName "projectNumber")
    $actualState = [string](Get-SafePropertyValue -Target $descObj -PropertyName "lifecycleState")

    if ([string]::IsNullOrWhiteSpace($actualId) -or [string]::IsNullOrWhiteSpace($actualNumber)) {
        $expectedDescribeReport.status = "ERROR"
        $expectedDescribeReport.classification = "MALFORMED_JSON"
        $expectedDescribeReport.errorDetail = "La respuesta JSON de 'gcloud projects describe' carece de 'projectId' o 'projectNumber'."
    }
    else {
        $expectedDescribeReport.projectId = $actualId
        $expectedDescribeReport.projectNumber = $actualNumber
        $expectedDescribeReport.lifecycleState = $actualState
        $expectedDescribeReport.matchesExpectedProjectNumber = ($actualNumber -eq $ExpectedProjectNumber)
        $expectedDescribeReport.matchesObservedAttachmentNumber = ($actualNumber -eq $ObservedAttachmentProjectNumber)

        if ($actualNumber -eq $ExpectedProjectNumber) {
            $expectedDescribeReport.comparisonStatus = "MATCHES_EXPECTED_510844325101"
        }
        elseif ($actualNumber -eq $ObservedAttachmentProjectNumber) {
            $expectedDescribeReport.comparisonStatus = "MATCHES_OBSERVED_ATTACHMENT_955230563489"
        }
        else {
            $expectedDescribeReport.comparisonStatus = "NEITHER_EXPECTED_NOR_OBSERVED"
        }

        Write-Host "[OK] Proyecto descrito en Resource Manager:" -ForegroundColor Green
        Write-Host "    projectId      : $actualId" -ForegroundColor White
        Write-Host "    projectNumber  : $actualNumber" -ForegroundColor White
        Write-Host "    lifecycleState : $actualState" -ForegroundColor White
        Write-Host "    ¿Coincide con 510844325101? : $($expectedDescribeReport.matchesExpectedProjectNumber)" -ForegroundColor $(if ($expectedDescribeReport.matchesExpectedProjectNumber) { "Green" } else { "Yellow" })
        Write-Host "    ¿Coincide con 955230563489? : $($expectedDescribeReport.matchesObservedAttachmentNumber)" -ForegroundColor $(if ($expectedDescribeReport.matchesObservedAttachmentNumber) { "Cyan" } else { "Yellow" })
    }
}
else {
    Write-Host "[!] Error en 'gcloud projects describe' [$($describeRes.classification)]: $($describeRes.errorDetail)" -ForegroundColor Red
}

# 2. Consultar proyectos visibles filtrando por el número observado (955230563489)
Write-Host "`n[PASO 2/3] Ejecutando 'gcloud projects list --filter=`"projectNumber=$ObservedAttachmentProjectNumber`" --format=json'..." -ForegroundColor Yellow
$listObservedRes = Invoke-GcloudReadJson -GcloudExecutable $gcloudPath -Arguments @("projects", "list", "--filter=projectNumber=$ObservedAttachmentProjectNumber", "--format=json")

$observedLookupReport = [ordered]@{
    command         = "gcloud projects list --filter=`"projectNumber=$ObservedAttachmentProjectNumber`" --format=json"
    status          = if ($listObservedRes.ok) { "OK" } else { "ERROR" }
    classification  = $listObservedRes.classification
    visibleCount    = 0
    visibleProjects = @()
    limitations     = @(
        "gcloud projects list devuelve únicamente los proyectos sobre los que la cuenta activa posee permisos de listado/visibilidad.",
        "Un resultado vacío NO demuestra que el proyecto 955230563489 no exista; únicamente indica PROJECT_NOT_VISIBLE_TO_ACTIVE_ACCOUNT."
    )
    errorDetail     = $listObservedRes.errorDetail
}

if ($listObservedRes.ok) {
    $items = @()
    if ($null -ne $listObservedRes.data) {
        $items = @($listObservedRes.data)
    }

    if ($items.Count -eq 0) {
        $observedLookupReport.classification = "PROJECT_NOT_VISIBLE_TO_ACTIVE_ACCOUNT"
        Write-Host "[INFO] Clasificación: PROJECT_NOT_VISIBLE_TO_ACTIVE_ACCOUNT" -ForegroundColor Yellow
        Write-Host "       La cuenta activa no tiene visibilidad de listado sobre el número $ObservedAttachmentProjectNumber." -ForegroundColor Yellow
        Write-Host "       Nota: Esto NO constituye prueba de que el proyecto no exista." -ForegroundColor Yellow
    }
    else {
        $observedLookupReport.classification = "PROJECT_VISIBLE_TO_ACTIVE_ACCOUNT"
        $visibleList = @()
        foreach ($proj in $items) {
            $pId = [string](Get-SafePropertyValue -Target $proj -PropertyName "projectId")
            $pNum = [string](Get-SafePropertyValue -Target $proj -PropertyName "projectNumber")
            $pState = [string](Get-SafePropertyValue -Target $proj -PropertyName "lifecycleState")
            $visibleList += [ordered]@{
                projectId      = $pId
                projectNumber  = $pNum
                lifecycleState = $pState
            }
            Write-Host "[OK] Proyecto visible para ${ObservedAttachmentProjectNumber}:" -ForegroundColor Green
            Write-Host "    projectId      : $pId" -ForegroundColor White
            Write-Host "    projectNumber  : $pNum" -ForegroundColor White
            Write-Host "    lifecycleState : $pState" -ForegroundColor White
        }
        $observedLookupReport.visibleCount = $visibleList.Count
        $observedLookupReport.visibleProjects = $visibleList
    }
}
else {
    Write-Host "[!] Error en 'gcloud projects list' [$($listObservedRes.classification)]: $($listObservedRes.errorDetail)" -ForegroundColor Red
}

# 3. Consulta auxiliar de solo lectura para 510844325101 si describe mostró un número distinto
Write-Host "`n[PASO 3/3] Verificación auxiliar de solo lectura sobre $ExpectedProjectNumber..." -ForegroundColor Yellow
$expectedNumberLookupReport = [ordered]@{
    executed        = $false
    command         = "gcloud projects list --filter=`"projectNumber=$ExpectedProjectNumber`" --format=json"
    classification  = "SKIPPED_MATCHED_IN_DESCRIBE"
    visibleCount    = 0
    visibleProjects = @()
    errorDetail     = $null
}

if (-not $expectedDescribeReport.matchesExpectedProjectNumber) {
    $expectedNumberLookupReport.executed = $true
    $listExpectedRes = Invoke-GcloudReadJson -GcloudExecutable $gcloudPath -Arguments @("projects", "list", "--filter=projectNumber=$ExpectedProjectNumber", "--format=json")
    if ($listExpectedRes.ok) {
        $expItems = @()
        if ($null -ne $listExpectedRes.data) {
            $expItems = @($listExpectedRes.data)
        }
        if ($expItems.Count -eq 0) {
            $expectedNumberLookupReport.classification = "PROJECT_NOT_VISIBLE_TO_ACTIVE_ACCOUNT"
            Write-Host "[INFO] Número $ExpectedProjectNumber -> PROJECT_NOT_VISIBLE_TO_ACTIVE_ACCOUNT" -ForegroundColor Yellow
        }
        else {
            $expectedNumberLookupReport.classification = "PROJECT_VISIBLE_TO_ACTIVE_ACCOUNT"
            $expList = @()
            foreach ($proj in $expItems) {
                $pId = [string](Get-SafePropertyValue -Target $proj -PropertyName "projectId")
                $pNum = [string](Get-SafePropertyValue -Target $proj -PropertyName "projectNumber")
                $pState = [string](Get-SafePropertyValue -Target $proj -PropertyName "lifecycleState")
                $expList += [ordered]@{
                    projectId      = $pId
                    projectNumber  = $pNum
                    lifecycleState = $pState
                }
                Write-Host "[OK] Proyecto visible para ${ExpectedProjectNumber}: $pId ($pState)" -ForegroundColor Cyan
            }
            $expectedNumberLookupReport.visibleCount = $expList.Count
            $expectedNumberLookupReport.visibleProjects = $expList
        }
    }
    else {
        $expectedNumberLookupReport.classification = $listExpectedRes.classification
        $expectedNumberLookupReport.errorDetail = $listExpectedRes.errorDetail
        Write-Host "[!] Error consultando ${ExpectedProjectNumber} [$($listExpectedRes.classification)]: $($listExpectedRes.errorDetail)" -ForegroundColor Red
    }
}
else {
    Write-Host "[INFO] $ExpectedProjectId ya coincide con $ExpectedProjectNumber; búsqueda auxiliar omitida." -ForegroundColor Gray
}

# Diagnóstico de Causa Raíz
$diagnosisCode = "INCONCLUSIVE_DUE_TO_ACCESS_OR_API_ERROR"
$diagnosisSummary = "No se pudo completar la verificación de Resource Manager debido a errores de autenticación, permisos o API."

if ($expectedDescribeReport.status -eq "OK") {
    $realNum = $expectedDescribeReport.projectNumber
    if ($realNum -eq $ObservedAttachmentProjectNumber -and $realNum -ne $ExpectedProjectNumber) {
        $diagnosisCode = "EXPECTED_NUMBER_MISMATCH_OBSERVED_MATCHES_PROJECT"
        $diagnosisSummary = "El projectNumber real de '$ExpectedProjectId' es '$realNum', coincidiendo con el attachment_point remoto ('$ObservedAttachmentProjectNumber'). El número previo '$ExpectedProjectNumber' NO corresponde a '$ExpectedProjectId'."
    }
    elseif ($realNum -eq $ExpectedProjectNumber -and $realNum -ne $ObservedAttachmentProjectNumber) {
        $diagnosisCode = "CROSS_PROJECT_OR_ANOMALOUS_ATTACHMENT_POINT"
        $diagnosisSummary = "El projectNumber real de '$ExpectedProjectId' es '$ExpectedProjectNumber'. El attachment_point remoto declara otro proyecto ('$ObservedAttachmentProjectNumber')."
    }
    elseif ($realNum -ne $ExpectedProjectNumber -and $realNum -ne $ObservedAttachmentProjectNumber) {
        $diagnosisCode = "BOTH_NUMBERS_DISCREPANT_FROM_ACTUAL_PROJECT"
        $diagnosisSummary = "El projectNumber real de '$ExpectedProjectId' es '$realNum', distinto tanto de '$ExpectedProjectNumber' como de '$ObservedAttachmentProjectNumber'."
    }
    else {
        $diagnosisCode = "ALL_NUMBERS_MATCH"
        $diagnosisSummary = "Todos los números coinciden."
    }
}

$fullReport = [ordered]@{
    generatedAtUtc             = [DateTimeOffset]::UtcNow.ToString("o")
    phase                      = "3.5.0.12"
    mode                       = "READ_ONLY_CLOUD_RESOURCE_MANAGER_GCLOUD"
    firebaseRulesApiCallsCount = 0
    rulesSourceDownloaded      = $false
    targetParameters           = [ordered]@{
        expectedProjectId               = $ExpectedProjectId
        expectedProjectNumber           = $ExpectedProjectNumber
        observedAttachmentProjectNumber = $ObservedAttachmentProjectNumber
        databaseId                      = $DatabaseId
    }
    expectedProjectDescribe    = $expectedDescribeReport
    observedProjectListLookup  = $observedLookupReport
    expectedNumberListLookup   = $expectedNumberLookupReport
    rootCauseDiagnosis         = [ordered]@{
        code    = $diagnosisCode
        summary = $diagnosisSummary
    }
    limitations                = @(
        "Las consultas emplean exclusivamente Google Cloud Resource Manager vía gcloud (describe/list).",
        "No se ejecutaron llamadas a Firebase Rules API (ni rulesets.list ni rulesets.get) ni se descargó código de reglas.",
        "La ausencia de un proyecto en 'gcloud projects list' se clasifica como PROJECT_NOT_VISIBLE_TO_ACTIVE_ACCOUNT y nunca demuestra inexistencia.",
        "Este script NO modifica configuración ni relaja las validaciones de query-remote-rules.ps1."
    )
}

# Guardado atómico en UTF-8 sin BOM
$reportDir = [System.IO.Path]::GetDirectoryName($ReportPath)
if ($reportDir -and -not (Test-Path $reportDir)) {
    New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$tmpReport = "$ReportPath.tmp"
try {
    $jsonContent = ConvertTo-Json $fullReport -Depth 8
    [System.IO.File]::WriteAllText($tmpReport, $jsonContent, $utf8NoBom)
    Move-Item -Path $tmpReport -Destination $ReportPath -Force
    Write-Host "`n[OK] Informe JSON local guardado en: $ReportPath" -ForegroundColor Green
}
catch {
    if (Test-Path $tmpReport) {
        Remove-Item -Path $tmpReport -Force -ErrorAction SilentlyContinue
    }
    Write-Host "[!] Error guardando el informe JSON: $($_.Exception.Message)" -ForegroundColor Red
    exit 3
}

Write-Host "`n========================================================================" -ForegroundColor Cyan
Write-Host " DIAGNÓSTICO: $diagnosisCode" -ForegroundColor Cyan
Write-Host " $diagnosisSummary" -ForegroundColor White
Write-Host "========================================================================" -ForegroundColor Cyan

if ($expectedDescribeReport.status -ne "OK" -or $observedLookupReport.status -ne "OK") {
    exit 2
}

exit 0
