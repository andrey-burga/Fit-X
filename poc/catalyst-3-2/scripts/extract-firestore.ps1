# VigorCore -- Fase 3.5.0: Extractor Forense Firestore -> Cache Local Protegido
# Compatible al 100% con Windows PowerShell 5.1 y PowerShell 7+.
# Sintaxis plana estricta, cero expresiones $() embebidas en cadenas, cero backticks.
# Almacenamiento cifrado en reposo con Windows DPAPI (CurrentUser).

[CmdletBinding()]
param (
    [ValidateSet('Preflight', 'Extract', 'Verify', 'CryptoSelfTest', 'LocalSecurityAudit')]
    [string]$Mode = 'Preflight',

    [string]$ProjectId = 'gen-lang-client-0041212770',

    [string]$DatabaseId = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',

    [string]$CacheDir = '',

    [string]$ReportDir = '',

    [int]$ThrottleMs = 100,

    [int]$MaxRequests = 500,

    [int]$MaxDocuments = 2000,

    [int]$MaxDepth = 10,

    [switch]$Resume,

    [switch]$OperatorConfirmed,

    [switch]$MaintenanceWindowConfirmed,

    [switch]$DriftAcknowledged
)

$ErrorActionPreference = 'Stop'

Write-Host '========================================================================' -ForegroundColor Cyan
Write-Host ' VIGORCORE -- FASE 3.5.0: EXTRACTOR FORENSE FIRESTORE -> CACHE PROTEGIDO' -ForegroundColor Cyan
$headerSub = ' Modo: {0} | DPAPI CurrentUser | Zero Leak | PS 5.1/7+                  ' -f $Mode
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
# 1. Resolución de Rutas de Trabajo y Seguridad del Directorio Local
# -----------------------------------------------------------------------------
$scriptDir = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $PSScriptRoot
} else {
    Split-Path -Parent $MyInvocation.MyCommand.Definition
}

$pocDir = Split-Path -Parent $scriptDir

# Directorio de cache protegido (.data/firestore-export)
$defaultCacheDir = Join-Path $pocDir '.data\firestore-export'
if ([string]::IsNullOrWhiteSpace($CacheDir)) {
    $resolvedCacheDir = $defaultCacheDir
} else {
    if ([System.IO.Path]::IsPathRooted($CacheDir)) {
        $resolvedCacheDir = [System.IO.Path]::GetFullPath($CacheDir)
    } else {
        $cleanRel = $CacheDir.TrimStart('/', '\')
        $resolvedCacheDir = [System.IO.Path]::GetFullPath((Join-Path $pocDir $cleanRel))
    }
}

# Directorio de reportes públicos (reports/firestore-extraction-3.5)
$defaultReportDir = Join-Path $pocDir 'reports\firestore-extraction-3.5'
if ([string]::IsNullOrWhiteSpace($ReportDir)) {
    $resolvedReportDir = $defaultReportDir
} else {
    if ([System.IO.Path]::IsPathRooted($ReportDir)) {
        $resolvedReportDir = [System.IO.Path]::GetFullPath($ReportDir)
    } else {
        $cleanRel = $ReportDir.TrimStart('/', '\')
        $resolvedReportDir = [System.IO.Path]::GetFullPath((Join-Path $pocDir $cleanRel))
    }
}

if (-not (Test-Path -Path $resolvedReportDir)) {
    New-Item -ItemType Directory -Path $resolvedReportDir -Force | Out-Null
}

$controlDir = Join-Path $resolvedCacheDir 'control'
$preflightTokenPath          = Join-Path $resolvedReportDir 'preflight-token.json'
$preflightTokenBinPath       = Join-Path $controlDir 'preflight-token.bin'
$legacyPreflightTokenBinPath = Join-Path $resolvedReportDir 'preflight-token.bin'
$manifestAuditPath           = Join-Path $resolvedReportDir 'manifest-audit.json'
$verifyReportPath            = Join-Path $resolvedReportDir 'verify-report.json'

$checkpointBinPath = Join-Path $controlDir 'checkpoint.bin'
if (-not (Test-Path -Path $checkpointBinPath) -and (Test-Path -Path (Join-Path $resolvedCacheDir 'checkpoint.bin'))) {
    $checkpointBinPath = Join-Path $resolvedCacheDir 'checkpoint.bin'
}
$idMappingBinPath = Join-Path $controlDir 'id-mapping.bin'
if (-not (Test-Path -Path $idMappingBinPath) -and (Test-Path -Path (Join-Path $resolvedCacheDir 'id-mapping.bin'))) {
    $idMappingBinPath = Join-Path $resolvedCacheDir 'id-mapping.bin'
}

# -----------------------------------------------------------------------------
# 2. Verificación de Exclusión en Git para .data/
# -----------------------------------------------------------------------------
$pocGitignorePath = Join-Path $pocDir '.gitignore'
$gitignoreOk = $false
if (Test-Path -Path $pocGitignorePath) {
    $giContent = Get-Content -Path $pocGitignorePath -Raw
    if ($giContent -match '\.data/' -or $giContent -match '\.data\\') {
        $gitignoreOk = $true
    }
}

if (-not $gitignoreOk) {
    Write-Host '[ADVERTENCIA GITIGNORE]: El directorio .data/ no aparece excluido en poc/catalyst-3-2/.gitignore.' -ForegroundColor Yellow
} else {
    Write-Host '[SECURITY CHECK]: Directorio .data/ correctamente excluido del control de versiones Git.' -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# 3. Módulo Criptográfico DPAPI (CurrentUser)
# -----------------------------------------------------------------------------
$dpapiAvailable = $false
try {
    Add-Type -AssemblyName System.Security -ErrorAction Stop
    $dpapiAvailable = $true
} catch {
    Write-Host '[WARN]: Ensamblado System.Security no cargado directamente: ' -NoNewline
    Write-Host $_.Exception.Message -ForegroundColor Yellow
}

function Protect-DpapiBytes {
    param (
        [byte[]]$PlainBytes
    )
    if (-not $PlainBytes -or $PlainBytes.Length -eq 0) {
        return New-Object byte[] 0
    }
    $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    return [System.Security.Cryptography.ProtectedData]::Protect($PlainBytes, $null, $scope)
}

function Unprotect-DpapiBytes {
    param (
        [byte[]]$CipherBytes
    )
    if (-not $CipherBytes -or $CipherBytes.Length -eq 0) {
        return New-Object byte[] 0
    }
    $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    return [System.Security.Cryptography.ProtectedData]::Unprotect($CipherBytes, $null, $scope)
}

function Test-DpapiRoundtrip {
    try {
        $testMsg = 'VIGORCORE_DPAPI_SELFTEST_' + [System.Guid]::NewGuid().ToString()
        $testBytes = [System.Text.Encoding]::UTF8.GetBytes($testMsg)
        $cipher = Protect-DpapiBytes -PlainBytes $testBytes
        if (-not $cipher -or $cipher.Length -eq 0) {
            return $false
        }
        $plain = Unprotect-DpapiBytes -CipherBytes $cipher
        $recoveredMsg = [System.Text.Encoding]::UTF8.GetString($plain)
        if ($testMsg -ne $recoveredMsg) { return $false }

        # Verificación estricta de resistencia a manipulación
        $tampered = [byte[]]$cipher.Clone()
        $tampered[$tampered.Length - 1] = [byte]($tampered[$tampered.Length - 1] -bxor 0xFF)
        $tamperDetected = $false
        try {
            Unprotect-DpapiBytes -CipherBytes $tampered | Out-Null
        } catch {
            $tamperDetected = $true
        }
        return $tamperDetected
    } catch {
        return $false
    }
}

function Compute-Sha256Hex {
    param (
        [string]$InputString
    )
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($InputString)
    $hashBytes = $hasher.ComputeHash($bytes)
    $builder = New-Object System.Text.StringBuilder
    foreach ($b in $hashBytes) {
        [void]$builder.Append($b.ToString('x2'))
    }
    return $builder.ToString()
}

# -----------------------------------------------------------------------------
# 4. Sanitización de Errores e Invariantes de Privacidad
# -----------------------------------------------------------------------------
function New-SanitizedError {
    param (
        [string]$RawMessage,
        [int]$StatusCode = 0
    )
    $code = 'HTTP_ERROR'
    if ($RawMessage -match 'billing|billing_disabled') {
        $code = 'BILLING_DISABLED'
    } elseif ($StatusCode -eq 429 -or $RawMessage -match 'quota exceeded|resource exhausted') {
        $code = 'QUOTA_EXCEEDED'
    } elseif ($StatusCode -eq 401 -or $RawMessage -match 'unauthenticated|invalid token|expired token|auth') {
        $code = 'AUTH_ERROR'
    } elseif ($StatusCode -eq 403 -or $RawMessage -match 'permission denied|forbidden') {
        $code = 'PERMISSION_DENIED'
    } elseif ($RawMessage -match 'dpapi|protect|unprotect|crypto') {
        $code = 'DPAPI_ERROR'
    } elseif ($RawMessage -match 'serialize|deserializ|json[\s.]*parse|bigint') {
        $code = 'SERIALIZATION_ERROR'
    } elseif ($RawMessage -match 'drift|mismatch|baseline') {
        $code = 'BASELINE_DRIFT'
    }

    $sanitized = $RawMessage
    $sanitized = [System.Text.RegularExpressions.Regex]::Replace($sanitized, 'ya29\.[a-zA-Z0-9_-]+', '[REDACTED_ACCESS_TOKEN]')
    $sanitized = [System.Text.RegularExpressions.Regex]::Replace($sanitized, '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', '[REDACTED_EMAIL]')
    $sanitized = [System.Text.RegularExpressions.Regex]::Replace($sanitized, 'Bearer\s+[^\s]+', 'Bearer [REDACTED]')
    $sanitized = [System.Text.RegularExpressions.Regex]::Replace($sanitized, 'projects/[^/]+/databases/[^/]+/documents/users/([^/\s]+)', 'projects/.../databases/.../documents/users/[REDACTED_UID]')

    return [ordered]@{
        timestamp  = (Get-Date).ToString('o')
        code       = $code
        statusCode = $StatusCode
        message    = $sanitized
    }
}

# -----------------------------------------------------------------------------
# 5. Adquisición de ADC y Conexión REST a Firestore
# -----------------------------------------------------------------------------
$script:requestCount = 0
$script:recordedErrors = @()
$databaseRootUrl = 'https://firestore.googleapis.com/v1/projects/' + $ProjectId + '/databases/' + $DatabaseId + '/documents'

function Get-AdcAccessToken {
    $tokenOutput = & gcloud auth application-default print-access-token 2>&1
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($tokenOutput)) {
        throw 'No se pudo obtener el Access Token ADC en memoria via gcloud.'
    }
    return $tokenOutput.ToString().Trim()
}

function Invoke-FirestoreRestSafe {
    param (
        [string]$Method = 'GET',
        [string]$Url,
        [object]$Body = $null,
        [string]$AccessToken,
        [int]$MaxRetries = 3
    )

    $attempt = 0
    while ($attempt -lt $MaxRetries) {
        $attempt++
        $script:requestCount++

        if ($script:requestCount -gt $MaxRequests) {
            throw ('MaxRequests excedido: {0} >= {1}' -f $script:requestCount, $MaxRequests)
        }

        if ($ThrottleMs -gt 0) {
            Start-Sleep -Milliseconds $ThrottleMs
        }

        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $headers = @{
                'Authorization'   = 'Bearer ' + $AccessToken
                'Accept'          = 'application/json'
                'Content-Type'    = 'application/json; charset=utf-8'
                'x-goog-user-project' = $ProjectId
            }

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
            $ex = $_.Exception
            $statusCode = 0
            $respBody = ''
            if ($ex.Response) {
                $statusCode = [int]$ex.Response.StatusCode
                try {
                    $reader = New-Object System.IO.StreamReader($ex.Response.GetResponseStream())
                    $respBody = $reader.ReadToEnd()
                    $reader.Close()
                } catch {
                    $respBody = ''
                }
            }

            if (($statusCode -eq 429 -or $statusCode -eq 503) -and $attempt -lt $MaxRetries) {
                $backoffSec = [Math]::Pow(2, $attempt)
                Start-Sleep -Seconds $backoffSec
                continue
            }

            $sanitized = New-SanitizedError -RawMessage ($ex.Message + ' ' + $respBody) -StatusCode $statusCode
            $script:recordedErrors += $sanitized

            return @{
                StatusCode = $statusCode
                Body       = $null
                DurationMs = $sw.ElapsedMilliseconds
                Error      = $sanitized
            }
        } catch {
            $sw.Stop()
            $sanitized = New-SanitizedError -RawMessage $_.Exception.Message -StatusCode 0
            $script:recordedErrors += $sanitized
            return @{
                StatusCode = 0
                Body       = $null
                DurationMs = $sw.ElapsedMilliseconds
                Error      = $sanitized
            }
        }
    }

    $exhausted = New-SanitizedError -RawMessage ('Reintentos agotados para URL' ) -StatusCode 0
    return @{ StatusCode = 0; Body = $null; DurationMs = 0; Error = $exhausted }
}

# -----------------------------------------------------------------------------
# 6. Constantes del Modelo de Datos VigorCore
# -----------------------------------------------------------------------------
$candidateSubcollections = @(
    'biometrics',
    'preferences',
    'groceries',
    'mealLogs',
    'notifications',
    'workoutSessions',
    'cardioSessions',
    'recipes',
    'mealPlans',
    'workoutRoutines',
    'executedWorkouts'
)

$administrativeCollections = @(
    'adminUserDirectory',
    'adminRoleState',
    'adminInvitations',
    'accountAccess',
    'adminAuditLogs',
    'adminInvitationOperations'
)

$HISTORICAL_BASELINE_COUNT = 73
$EXPECTED_USERS_COUNT = 5

# -----------------------------------------------------------------------------
# 7. Modo A: PREFLIGHT
# -----------------------------------------------------------------------------
if ($Mode -eq 'Preflight') {
    Write-Host ''
    Write-Host '[PREFLIGHT]: Iniciando verificación estructural previa sin descargar campos privados...' -ForegroundColor Cyan
    Write-Host '------------------------------------------------------------------------'

    $token = Get-AdcAccessToken
    Write-Host ' - Access Token ADC adquirido en memoria.' -ForegroundColor Green

    # 1. Descubrir documentos de la colección raíz users
    Write-Host ' - Consultando colección raíz users (__name__ projection)...' -NoNewline
    $usersRunQueryUrl = $databaseRootUrl + ':runQuery'
    $usersBody = [ordered]@{
        structuredQuery = [ordered]@{
            select = @{ fields = @( @{ fieldPath = '__name__' } ) }
            from   = @( @{ collectionId = 'users' } )
            orderBy = @( @{ field = @{ fieldPath = '__name__' }; direction = 'ASCENDING' } )
            limit  = 100
        }
    }

    $usersRes = Invoke-FirestoreRestSafe -Method 'POST' -Url $usersRunQueryUrl -Body $usersBody -AccessToken $token
    if ($usersRes.StatusCode -ne 200 -or -not $usersRes.Body) {
        Write-Host ' ERROR' -ForegroundColor Red
        throw ('Fallo en preflight al consultar coleccion users: HTTP ' + $usersRes.StatusCode)
    }

    $discoveredUserPaths = @()
    if ($usersRes.Body -is [System.Array]) {
        foreach ($item in $usersRes.Body) {
            if ($item -and $item.document -and $item.document.name) {
                # Invariante estricta: prohibido campos de datos
                if ($item.document.fields) {
                    throw 'VIOLACION DE PRIVACIDAD: campos de datos retornados en proyeccion __name__'
                }
                $discoveredUserPaths += $item.document.name
            }
        }
    }

    $discoveredUsersCount = $discoveredUserPaths.Count
    Write-Host (' OK (Usuarios encontrados: ' + $discoveredUsersCount + ')') -ForegroundColor Green

    # Asignar alias secuenciales USER_001..USER_00N en memoria
    $userAliasMap = [ordered]@{}
    $userPathToAlias = @{}
    $uIndex = 1
    foreach ($uPath in $discoveredUserPaths) {
        $alias = 'USER_{0:D3}' -f $uIndex
        $userAliasMap[$alias] = $uPath
        $userPathToAlias[$uPath] = $alias
        $uIndex++
    }

    # 2. Consultar las 11 subcolecciones candidatas por cada usuario
    Write-Host ' - Inspeccionando subcolecciones candidatas por usuario...'
    $countsByUser = [ordered]@{}
    $totalChildDocsDiscovered = 0

    foreach ($alias in $userAliasMap.Keys) {
        $userDocPath = $userAliasMap[$alias]
        $countsByUser[$alias] = [ordered]@{}
        $userSubParentUrl = 'https://firestore.googleapis.com/v1/' + $userDocPath

        foreach ($subName in $candidateSubcollections) {
            $subRunQueryUrl = $userSubParentUrl + ':runQuery'
            $subBody = [ordered]@{
                structuredQuery = [ordered]@{
                    select = @{ fields = @( @{ fieldPath = '__name__' } ) }
                    from   = @( @{ collectionId = $subName } )
                    orderBy = @( @{ field = @{ fieldPath = '__name__' }; direction = 'ASCENDING' } )
                    limit  = 200
                }
            }

            $subRes = Invoke-FirestoreRestSafe -Method 'POST' -Url $subRunQueryUrl -Body $subBody -AccessToken $token
            if ($subRes.StatusCode -eq 200 -and $subRes.Body) {
                $subDocCount = 0
                if ($subRes.Body -is [System.Array]) {
                    foreach ($subItem in $subRes.Body) {
                        if ($subItem -and $subItem.document -and $subItem.document.name) {
                            if ($subItem.document.fields) {
                                throw 'VIOLACION DE PRIVACIDAD: campos detectados en subcoleccion'
                            }
                            $subDocCount++
                        }
                    }
                }
                $countsByUser[$alias][$subName] = $subDocCount
                $totalChildDocsDiscovered += $subDocCount
            } else {
                # Error: el conteo es desconocido, no cero
                $countsByUser[$alias][$subName] = $null
                Write-Host ('   [!] Error consultando ' + $subName + ' para ' + $alias + ' (HTTP ' + $subRes.StatusCode + ')') -ForegroundColor Yellow
            }
        }
    }

    # 3. Consultar las 6 colecciones administrativas a nivel raíz
    Write-Host ' - Verificando 6 colecciones administrativas a nivel raíz...'
    $adminCounts = [ordered]@{}
    foreach ($admCol in $administrativeCollections) {
        $admQueryUrl = $databaseRootUrl + ':runQuery'
        $admBody = [ordered]@{
            structuredQuery = [ordered]@{
                select = @{ fields = @( @{ fieldPath = '__name__' } ) }
                from   = @( @{ collectionId = $admCol } )
                orderBy = @( @{ field = @{ fieldPath = '__name__' }; direction = 'ASCENDING' } )
                limit  = 50
            }
        }
        $admRes = Invoke-FirestoreRestSafe -Method 'POST' -Url $admQueryUrl -Body $admBody -AccessToken $token
        if ($admRes.StatusCode -eq 200 -and $admRes.Body) {
            $admCount = 0
            if ($admRes.Body -is [System.Array]) {
                foreach ($admItem in $admRes.Body) {
                    if ($admItem -and $admItem.document -and $admItem.document.name) {
                        $admCount++
                    }
                }
            }
            $adminCounts[$admCol] = $admCount
        } else {
            $adminCounts[$admCol] = $null
        }
    }

    # 4. Evaluación de Baseline Drift
    $grandTotalDiscovered = $discoveredUsersCount + $totalChildDocsDiscovered
    $baselineStatus = 'PREFLIGHT_PASS'
    $driftReason = ''

    if ($discoveredUsersCount -ne $EXPECTED_USERS_COUNT) {
        $baselineStatus = 'BASELINE_DRIFT'
        $driftReason = 'Usuarios descubiertos difieren del baseline esperado ({0} != {1})' -f $discoveredUsersCount, $EXPECTED_USERS_COUNT
    } elseif ($grandTotalDiscovered -ne $HISTORICAL_BASELINE_COUNT) {
        $baselineStatus = 'BASELINE_DRIFT'
        $driftReason = 'Total de documentos descubierto difiere del baseline historico ({0} != {1})' -f $grandTotalDiscovered, $HISTORICAL_BASELINE_COUNT
    }

    if ($script:recordedErrors.Count -gt 0) {
        $baselineStatus = 'PREFLIGHT_FAILED'
        $driftReason = 'Se registraron errores durante la ejecucion de consultas de preflight.'
    }

    # 5. Generación del Token de Preflight
    $preflightToken = [ordered]@{
        extractorVersion          = '1.0.0'
        executionId               = [System.Guid]::NewGuid().ToString()
        timestampUtc              = (Get-Date).ToUniversalTime().ToString('o')
        projectId                 = $ProjectId
        databaseId                = $DatabaseId
        usersDiscovered           = $discoveredUsersCount
        totalDocumentsDiscovered  = $grandTotalDiscovered
        historicalBaselineTotal   = $HISTORICAL_BASELINE_COUNT
        status                    = $baselineStatus
        driftReason               = $driftReason
        countsByUser              = $countsByUser
        administrativeCounts      = $adminCounts
        totalRequestsExecuted     = $script:requestCount
        errors                    = $script:recordedErrors
    }

    $preflightToken | ConvertTo-Json -Depth 6 | Set-Content -Path $preflightTokenPath -Encoding UTF8

    # Generación de sobre autenticado DPAPI de preflight (preflight-token.bin)
    $tokenJsonCompact = $preflightToken | ConvertTo-Json -Depth 6 -Compress
    $tokenSha256 = Compute-Sha256Hex -InputString $tokenJsonCompact
    $authEnvelope = [ordered]@{
        version      = '1.0.0'
        timestampUtc = $preflightToken.timestampUtc
        projectId    = $ProjectId
        databaseId   = $DatabaseId
        status       = $baselineStatus
        tokenSha256  = $tokenSha256
        grandTotal   = $grandTotalDiscovered
        usersCount   = $discoveredUsersCount
    }
    $authEnvelopeJson = $authEnvelope | ConvertTo-Json -Depth 8 -Compress
    $authEnvelopeBytes = [System.Text.Encoding]::UTF8.GetBytes($authEnvelopeJson)
    $authEnvelopeCipher = Protect-DpapiBytes -PlainBytes $authEnvelopeBytes

    if (-not (Test-Path -Path $controlDir)) {
        New-Item -ItemType Directory -Path $controlDir -Force | Out-Null
        try {
            $aclCtrl = Get-Acl -Path $controlDir
            $aclCtrl.SetAccessRuleProtection($true, $false)
            $cUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
            $rCtrl = New-Object System.Security.AccessControl.FileSystemAccessRule($cUser, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
            $aclCtrl.ResetAccessRule($rCtrl)
            Set-Acl -Path $controlDir -AclObject $aclCtrl
        } catch { }
    }
    [System.IO.File]::WriteAllBytes($preflightTokenBinPath, $authEnvelopeCipher)

    Write-Host ''
    Write-Host '========================================================================' -ForegroundColor Cyan
    Write-Host ' RESULTADO DEL PREFLIGHT' -ForegroundColor Cyan
    Write-Host '========================================================================' -ForegroundColor Cyan
    Write-Host (' - Usuarios descubiertos:       ' + $discoveredUsersCount)
    Write-Host (' - Documentos secundarios:      ' + $totalChildDocsDiscovered)
    Write-Host (' - Total de documentos:         ' + $grandTotalDiscovered)
    Write-Host (' - Baseline histórico esperado: ' + $HISTORICAL_BASELINE_COUNT)
    if ($baselineStatus -eq 'PREFLIGHT_PASS') {
        Write-Host (' - Estado:                      PREFLIGHT_PASS (100% Coincidente)') -ForegroundColor Green
    } elseif ($baselineStatus -eq 'BASELINE_DRIFT') {
        Write-Host (' - Estado:                      BASELINE_DRIFT (' + $driftReason + ')') -ForegroundColor Yellow
        Write-Host '   [AVISO]: El modo Extract requerira autorizacion con -DriftAcknowledged.' -ForegroundColor Yellow
    } else {
        Write-Host (' - Estado:                      PREFLIGHT_FAILED (' + $driftReason + ')') -ForegroundColor Red
    }
    Write-Host (' - Token Preflight (JSON):      ' + $preflightTokenPath)
    Write-Host (' - Sobre Cifrado (BIN):         ' + $preflightTokenBinPath)
    Write-Host '========================================================================' -ForegroundColor Cyan
}

# -----------------------------------------------------------------------------
# 8. Modo B: EXTRACT (Controlado, Protegido y Cifrado)
# -----------------------------------------------------------------------------
elseif ($Mode -eq 'Extract') {
    Write-Host ''
    Write-Host '[EXTRACT]: Verificando compuertas y controles estrictos antes de iniciar...' -ForegroundColor Cyan
    Write-Host '------------------------------------------------------------------------'

    # Control 1: Validación obligatoria de ADC en memoria
    Write-Host ' - Validando credenciales ADC en memoria...' -NoNewline
    $token = Get-AdcAccessToken
    if ([string]::IsNullOrWhiteSpace($token)) {
        Write-Host ' ERROR' -ForegroundColor Red
        throw 'BLOQUEO: Credencial ADC no válida o vacía en memoria.'
    }
    Write-Host ' OK' -ForegroundColor Green

    # Control 2: Verificación criptográfica y autenticidad del Preflight Token
    Write-Host ' - Verificando autenticidad e integridad del token de preflight...' -NoNewline
    if (-not (Test-Path -Path $preflightTokenPath)) {
        throw 'BLOQUEO: No se encontró preflight-token.json reciente. Ejecute primero -Mode Preflight.'
    }
    if (-not (Test-Path -Path $preflightTokenBinPath)) {
        if (Test-Path -Path $legacyPreflightTokenBinPath) {
            throw ('BLOQUEO: preflight-token.bin se encuentra en la ubicación no permitida reports/. Requiere migración hacia: ' + $preflightTokenBinPath)
        }
        throw ('BLOQUEO: No se encontró preflight-token.bin en la ubicación requerida: ' + $preflightTokenBinPath + '. Ejecute la migración o un nuevo Preflight.')
    }

    # Descifrado DPAPI del sobre autenticado de preflight
    $authCipherBytes = [System.IO.File]::ReadAllBytes($preflightTokenBinPath)
    $authPlainBytes = $null
    try {
        $authPlainBytes = Unprotect-DpapiBytes -CipherBytes $authCipherBytes
    } catch {
        throw ('BLOQUEO CRIPTOGRAFICO: Falla al descifrar preflight-token.bin via DPAPI: ' + $_.Exception.Message)
    }

    $authEnvelope = [System.Text.Encoding]::UTF8.GetString($authPlainBytes) | ConvertFrom-Json
    $tokenContent = Get-Content -Path $preflightTokenPath -Raw | ConvertFrom-Json
    $recomputedTokenJson = $tokenContent | ConvertTo-Json -Depth 6 -Compress
    $recomputedSha256 = Compute-Sha256Hex -InputString $recomputedTokenJson

    if ($recomputedSha256 -ne $authEnvelope.tokenSha256) {
        throw 'BLOQUEO DE INTEGRIDAD: preflight-token.json fue manipulado o no coincide con la firma autenticada DPAPI.'
    }

    # Control 3: Correspondencia de ProjectId y DatabaseId
    if ($authEnvelope.projectId -ne $ProjectId -or $tokenContent.projectId -ne $ProjectId) {
        throw ('BLOQUEO: El token de preflight corresponde al proyecto {0}, pero el script fue invocado para {1}.' -f $authEnvelope.projectId, $ProjectId)
    }
    if ($authEnvelope.databaseId -ne $DatabaseId -or $tokenContent.databaseId -ne $DatabaseId) {
        throw ('BLOQUEO: El token de preflight corresponde a la base {0}, pero el script fue invocado para {1}.' -f $authEnvelope.databaseId, $DatabaseId)
    }

    # Control 4: Antigüedad máxima del Preflight (< 60 minutos)
    $preflightDate = [DateTime]::Parse($authEnvelope.timestampUtc)
    $ageMinutes = ((Get-Date).ToUniversalTime() - $preflightDate).TotalMinutes
    if ($ageMinutes -gt 60) {
        throw ('BLOQUEO: El token de preflight tiene {0:F1} minutos de antigüedad (> 60 min). Ejecute un nuevo Preflight.' -f $ageMinutes)
    }
    if ($authEnvelope.status -eq 'PREFLIGHT_FAILED' -or $tokenContent.status -eq 'PREFLIGHT_FAILED') {
        throw 'BLOQUEO: El preflight reportó errores de consulta (PREFLIGHT_FAILED). Extracción denegada.'
    }
    if ($tokenContent.errors -and $tokenContent.errors.Count -gt 0) {
        throw 'BLOQUEO: El preflight contiene errores de consulta registrados. Extracción denegada.'
    }

    # Control 5: Baseline drift acknowledgment
    if ($authEnvelope.status -eq 'BASELINE_DRIFT' -and -not $DriftAcknowledged) {
        throw 'BLOQUEO: Existe BASELINE_DRIFT y no se especificó el parámetro -DriftAcknowledged.'
    }
    Write-Host ' OK (Autenticado y vigente)' -ForegroundColor Green

    # Control 6: Confirmación explícita del operador
    if (-not $OperatorConfirmed) {
        Write-Host ''
        $promptOp = Read-Host '¿Confirma la descarga segura y cifrada de los documentos a su disco local? [Y/N]'
        if ($promptOp.ToUpper() -ne 'Y') {
            throw 'EXTRACCION CANCELADA POR EL OPERADOR.'
        }
    }

    # Control 7: Confirmación de ventana de mantenimiento / suspensión de escrituras
    if (-not $MaintenanceWindowConfirmed) {
        Write-Host ''
        Write-Host '[ATENCION]: Esta confirmacion es una declaracion operativa del usuario.' -ForegroundColor Yellow
        Write-Host 'Firestore REST no ofrece bloqueo transaccional a nivel de motor.' -ForegroundColor Yellow
        $promptMaint = Read-Host '¿Confirma que la ventana de mantenimiento / suspensión de escrituras en origen está activa? [Y/N]'
        if ($promptMaint.ToUpper() -ne 'Y') {
            throw 'EXTRACCION CANCELADA: Ventana de mantenimiento no confirmada.'
        }
    }

    # Control 8: Prueba de ida y vuelta DPAPI obligatoria
    Write-Host ' - Probando protección criptográfica DPAPI CurrentUser y tamper-resistance...' -NoNewline
    $dpapiTestOk = Test-DpapiRoundtrip
    if (-not $dpapiTestOk) {
        Write-Host ' ERROR CRITICO' -ForegroundColor Red
        throw 'DPAPI_ERROR: La prueba de ida y vuelta de DPAPI falló o no detectó manipulación. No se puede garantizar el cifrado en reposo.'
    }
    Write-Host ' OK (DPAPI CurrentUser operativo y resistente a manipulación)' -ForegroundColor Green

    # Control 9: Verificación de exclusión Git y permisos ACL del directorio de caché
    if (-not $gitignoreOk) {
        throw 'BLOQUEO: El directorio .data/ no está excluido en .gitignore. Riesgo de fuga a repositorio.'
    }
    if (-not (Test-Path -Path $resolvedCacheDir)) {
        New-Item -ItemType Directory -Path $resolvedCacheDir -Force | Out-Null
    }
    try {
        $acl = Get-Acl -Path $resolvedCacheDir
        $acl.SetAccessRuleProtection($true, $false) # Deshabilitar herencia de permisos
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($currentUser, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.ResetAccessRule($rule)
        Set-Acl -Path $resolvedCacheDir -AclObject $acl
        Write-Host ' - Permisos ACL restringidos al usuario ejecutor actual (herencia removida).' -ForegroundColor Green
    } catch {
        Write-Host '   [WARN] No se pudieron ajustar ACLs avanzadas de Windows: ' -NoNewline
        Write-Host $_.Exception.Message -ForegroundColor Yellow
    }

    # Control 10: Validación de integridad de Checkpoint si se usa -Resume
    if ($Resume -and (Test-Path -Path $checkpointBinPath)) {
        try {
            $cpBytes = [System.IO.File]::ReadAllBytes($checkpointBinPath)
            $cpPlain = Unprotect-DpapiBytes -CipherBytes $cpBytes
            $cpObj = [System.Text.Encoding]::UTF8.GetString($cpPlain) | ConvertFrom-Json
            if (-not $cpObj.nextDocIndex -or -not $cpObj.confirmedDocIds) {
                throw 'Checkpoint corrupto o esquema inconsistente.'
            }
        } catch {
            throw ('BLOQUEO: Checkpoint previo corrupto o inconsistente: ' + $_.Exception.Message)
        }
    }

    # Iniciando extracción secuencial y cifrado en sobre atómico
    Write-Host ''
    Write-Host ' - Iniciando extracción secuencial y cifrado en sobre atómico...' -ForegroundColor Cyan
    # $token ya adquirido y validado en Control 1

    $docIndex = 1
    $confirmedOpaqueIds = @()
    $extractedEnvelopesSummary = @()
    $countsByCol = [ordered]@{}
    $countsByUsr = [ordered]@{}
    $idMappingTable = [ordered]@{}

    # Reanudación desde checkpoint cifrado si existe
    if ($Resume -and (Test-Path -Path $checkpointBinPath)) {
        try {
            $cpBytes = [System.IO.File]::ReadAllBytes($checkpointBinPath)
            $cpPlain = Unprotect-DpapiBytes -CipherBytes $cpBytes
            $cpObj = [System.Text.Encoding]::UTF8.GetString($cpPlain) | ConvertFrom-Json
            $docIndex = [int]$cpObj.nextDocIndex
            foreach ($cid in $cpObj.confirmedDocIds) { $confirmedOpaqueIds += $cid }
            Write-Host (' [CHECKPOINT]: Reanudando desde documento indice ' + $docIndex) -ForegroundColor Yellow
        } catch {
            Write-Host ' [WARN]: No se pudo restaurar checkpoint cifrado; iniciando desde cero.' -ForegroundColor Yellow
        }
    }

    # Helper interno para extraer, validar, encapsular, cifrar y escribir un documento individual
    function Process-DocumentExtraction {
        param (
            [string]$DocResourcePath,
            [string]$UserAlias,
            [string]$CollectionId
        )

        $opaqueId = 'doc-{0:D6}' -f $script:docIndex
        $targetBin = Join-Path $resolvedCacheDir ($opaqueId + '.bin')
        $targetTmp = $targetBin + '.tmp'

        # GET documento completo
        $docUrl = 'https://firestore.googleapis.com/v1/' + $DocResourcePath
        $docRes = Invoke-FirestoreRestSafe -Method 'GET' -Url $docUrl -AccessToken $token

        if ($docRes.StatusCode -ne 200 -or -not $docRes.Body) {
            throw ('Error descargando documento ' + $DocResourcePath + ': HTTP ' + $docRes.StatusCode)
        }

        $rawDoc = $docRes.Body
        $createTime = if ($rawDoc.createTime) { $rawDoc.createTime } else { '' }
        $updateTime = if ($rawDoc.updateTime) { $rawDoc.updateTime } else { '' }
        $docId = Split-Path -Leaf $DocResourcePath

        $rawDocJson = $rawDoc | ConvertTo-Json -Depth 15 -Compress
        $contentSha256 = Compute-Sha256Hex -InputString $rawDocJson

        # Construcción del sobre confidencial
        $envelope = [ordered]@{
            version            = '1.0.0'
            docIndex           = $script:docIndex
            opaqueId           = $opaqueId
            sourceResourcePath = $DocResourcePath
            userAlias          = $UserAlias
            collectionId       = $CollectionId
            documentId         = $docId
            createTime         = $createTime
            updateTime         = $updateTime
            extractedAtUtc     = (Get-Date).ToUniversalTime().ToString('o')
            contentSha256      = $contentSha256
            rawRestDocument    = $rawDoc
        }

        $envelopeJson = $envelope | ConvertTo-Json -Depth 16 -Compress
        $envelopeBytes = [System.Text.Encoding]::UTF8.GetBytes($envelopeJson)

        # Cifrado DPAPI
        $cipherBytes = Protect-DpapiBytes -PlainBytes $envelopeBytes

        # Escritura atómica
        [System.IO.File]::WriteAllBytes($targetTmp, $cipherBytes)
        if (Test-Path -Path $targetBin) {
            Remove-Item -Path $targetBin -Force
        }
        Move-Item -Path $targetTmp -Destination $targetBin -Force

        # Verificación inmediata de lectura y descifrado
        $verifyCipher = [System.IO.File]::ReadAllBytes($targetBin)
        $verifyPlain = Unprotect-DpapiBytes -CipherBytes $verifyCipher
        $verifyObj = [System.Text.Encoding]::UTF8.GetString($verifyPlain) | ConvertFrom-Json
        if ($verifyObj.contentSha256 -ne $contentSha256) {
            throw ('Falla de verificacion en ' + $opaqueId + ': Hash no coincide')
        }

        # Registrar confirmación
        $script:confirmedOpaqueIds += $opaqueId
        $script:idMappingTable[$opaqueId] = [ordered]@{
            userAlias    = $UserAlias
            collectionId = $CollectionId
            resourcePath = $DocResourcePath
            createTime   = $createTime
            updateTime   = $updateTime
            fileBytes    = $cipherBytes.Length
        }

        if (-not $script:countsByCol.Contains($CollectionId)) { $script:countsByCol[$CollectionId] = 0 }
        $script:countsByCol[$CollectionId]++

        if (-not $script:countsByUsr.Contains($UserAlias)) { $script:countsByUsr[$UserAlias] = [ordered]@{} }
        if (-not $script:countsByUsr[$UserAlias].Contains($CollectionId)) { $script:countsByUsr[$UserAlias][$CollectionId] = 0 }
        $script:countsByUsr[$UserAlias][$CollectionId]++

        $script:extractedEnvelopesSummary += [ordered]@{
            resourcePath = $DocResourcePath
            updateTime   = $updateTime
        }

        $script:docIndex++

        # Guardar checkpoint atómico cifrado cada 10 documentos o al final
        if ($script:docIndex % 10 -eq 0) {
            Save-EncryptedCheckpoint -Status 'IN_PROGRESS'
        }
    }

    function Save-EncryptedCheckpoint {
        param ([string]$Status)
        $cpData = [ordered]@{
            extractorVersion = '1.0.0'
            timestampUtc     = (Get-Date).ToUniversalTime().ToString('o')
            nextDocIndex     = $script:docIndex
            status           = $Status
            confirmedCount   = $script:confirmedOpaqueIds.Count
            confirmedDocIds  = $script:confirmedOpaqueIds
        }
        $cpJson = $cpData | ConvertTo-Json -Depth 6 -Compress
        $cpBytes = Protect-DpapiBytes -PlainBytes ([System.Text.Encoding]::UTF8.GetBytes($cpJson))
        $cpTmp = $checkpointBinPath + '.tmp'
        [System.IO.File]::WriteAllBytes($cpTmp, $cpBytes)
        if (Test-Path -Path $checkpointBinPath) { Remove-Item -Path $checkpointBinPath -Force }
        Move-Item -Path $cpTmp -Destination $checkpointBinPath -Force
    }

    # 1. Extraer los 5 documentos de la colección users
    Write-Host ' - Extrayendo colección raíz users...'
    $userDocMap = $tokenContent.countsByUser
    $usersRunQueryUrl = $databaseRootUrl + ':runQuery'
    $usersBody = [ordered]@{
        structuredQuery = [ordered]@{
            select = @{ fields = @( @{ fieldPath = '__name__' } ) }
            from   = @( @{ collectionId = 'users' } )
            orderBy = @( @{ field = @{ fieldPath = '__name__' }; direction = 'ASCENDING' } )
            limit  = 100
        }
    }
    $usersRes = Invoke-FirestoreRestSafe -Method 'POST' -Url $usersRunQueryUrl -Body $usersBody -AccessToken $token
    $userCountIdx = 1
    if ($usersRes.Body -is [System.Array]) {
        foreach ($uItem in $usersRes.Body) {
            if ($uItem -and $uItem.document -and $uItem.document.name) {
                $uAlias = 'USER_{0:D3}' -f $userCountIdx
                Process-DocumentExtraction -DocResourcePath $uItem.document.name -UserAlias $uAlias -CollectionId 'users'
                $userCountIdx++
            }
        }
    }

    # 2. Extraer subcolecciones de cada usuario
    Write-Host ' - Extrayendo subcolecciones de usuarios...'
    $uIdx2 = 1
    if ($usersRes.Body -is [System.Array]) {
        foreach ($uItem in $usersRes.Body) {
            if ($uItem -and $uItem.document -and $uItem.document.name) {
                $uAlias = 'USER_{0:D3}' -f $uIdx2
                $userDocPath = $uItem.document.name
                $userSubParentUrl = 'https://firestore.googleapis.com/v1/' + $userDocPath

                foreach ($subCol in $candidateSubcollections) {
                    $subUrl = $userSubParentUrl + ':runQuery'
                    $subBody = [ordered]@{
                        structuredQuery = [ordered]@{
                            select = @{ fields = @( @{ fieldPath = '__name__' } ) }
                            from   = @( @{ collectionId = $subCol } )
                            orderBy = @( @{ field = @{ fieldPath = '__name__' }; direction = 'ASCENDING' } )
                            limit  = 200
                        }
                    }
                    $subRes = Invoke-FirestoreRestSafe -Method 'POST' -Url $subUrl -Body $subBody -AccessToken $token
                    if ($subRes.StatusCode -eq 200 -and $subRes.Body -is [System.Array]) {
                        foreach ($subDocItem in $subRes.Body) {
                            if ($subDocItem -and $subDocItem.document -and $subDocItem.document.name) {
                                Process-DocumentExtraction -DocResourcePath $subDocItem.document.name -UserAlias $uAlias -CollectionId $subCol
                            }
                        }
                    }
                }
                $uIdx2++
            }
        }
    }

    # Guardar checkpoint final
    Save-EncryptedCheckpoint -Status 'COMPLETED'

    # Guardar ID mapping cifrado
    $idMapJson = $idMappingTable | ConvertTo-Json -Depth 6 -Compress
    $idMapBytes = Protect-DpapiBytes -PlainBytes ([System.Text.Encoding]::UTF8.GetBytes($idMapJson))
    [System.IO.File]::WriteAllBytes($idMappingBinPath, $idMapBytes)

    # 3. Verificación post-extracción de consistencia de metadatos (updateTime)
    Write-Host ' - Ejecutando verificación de consistencia de metadatos observados...' -NoNewline
    $consistencyVerdict = 'STABLE_DURING_OBSERVED_WINDOW'
    $driftsDetected = @()

    foreach ($envSummary in $extractedEnvelopesSummary) {
        $pUrl = 'https://firestore.googleapis.com/v1/' + $envSummary.resourcePath
        # Usamos StructuredQuery de un solo documento para consultar updateTime
        $parentCol = Split-Path -Parent $envSummary.resourcePath
        $docIdCheck = Split-Path -Leaf $envSummary.resourcePath
        $docCheckRes = Invoke-FirestoreRestSafe -Method 'GET' -Url $pUrl -AccessToken $token
        if ($docCheckRes.StatusCode -eq 200 -and $docCheckRes.Body) {
            $postUpdateTime = $docCheckRes.Body.updateTime
            if ($postUpdateTime -ne $envSummary.updateTime) {
                $driftsDetected += ('MODIFIED: ' + $envSummary.resourcePath)
                $consistencyVerdict = 'CONSISTENCY_DRIFT'
            }
        } elseif ($docCheckRes.StatusCode -eq 404) {
            $driftsDetected += ('DELETED: ' + $envSummary.resourcePath)
            $consistencyVerdict = 'CONSISTENCY_DRIFT'
        }
    }
    Write-Host (' ' + $consistencyVerdict) -ForegroundColor Green

    # 4. Generación de Manifiesto de Auditoría Sanitizado (Público)
    $totalEncryptedBytes = 0
    foreach ($k in $idMappingTable.Keys) {
        $totalEncryptedBytes += $idMappingTable[$k].fileBytes
    }

    $manifestAudit = [ordered]@{
        extractorVersion          = '1.0.0'
        executionId               = [System.Guid]::NewGuid().ToString()
        extractedAtUtc            = (Get-Date).ToUniversalTime().ToString('o')
        totalDocumentsExtracted   = $confirmedOpaqueIds.Count
        userAliases               = @($countsByUsr.Keys)
        countsByCollection        = $countsByCol
        countsByUser              = $countsByUsr
        status                    = if ($driftsDetected.Count -gt 0) { 'COMPLETED_WITH_DRIFT' } else { 'COMPLETED_SUCCESS' }
        totalEncryptedBytes       = $totalEncryptedBytes
        sanitizedErrors           = $script:recordedErrors
        consistencyVerdict        = $consistencyVerdict
        consistencyDrifts         = $driftsDetected
    }

    $manifestAudit | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestAuditPath -Encoding UTF8

    Write-Host ''
    Write-Host '========================================================================' -ForegroundColor Cyan
    Write-Host ' RESUMEN DE EXTRACCION COMPLETADA' -ForegroundColor Cyan
    Write-Host '========================================================================' -ForegroundColor Cyan
    Write-Host (' - Documentos extraídos y cifrados: ' + $confirmedOpaqueIds.Count)
    Write-Host (' - Total bytes cifrados en reposo:  ' + $totalEncryptedBytes)
    Write-Host (' - Veredicto de consistencia:       ' + $consistencyVerdict)
    Write-Host (' - Manifiesto público de auditoría: ' + $manifestAuditPath)
    Write-Host '========================================================================' -ForegroundColor Cyan
}

# -----------------------------------------------------------------------------
# 9. Modo C: VERIFY (Local, Cero Firestore, Cero Fugas)
# -----------------------------------------------------------------------------
elseif ($Mode -eq 'Verify') {
    Write-Host ''
    Write-Host '[VERIFY]: Iniciando verificación forense del caché local protegido...' -ForegroundColor Cyan
    Write-Host '------------------------------------------------------------------------'

    if (-not (Test-Path -Path $resolvedCacheDir)) {
        throw 'BLOQUEO: El directorio de cache no existe en la ruta esperada.'
    }
    if (-not (Test-Path -Path $manifestAuditPath)) {
        throw 'BLOQUEO: No se encontro el archivo manifest-audit.json.'
    }
    if (-not (Test-Path -Path $checkpointBinPath)) {
        throw 'BLOQUEO: No se encontro checkpoint.bin cifrado en el cache.'
    }
    if (-not (Test-Path -Path $idMappingBinPath)) {
        throw 'BLOQUEO: No se encontro id-mapping.bin cifrado en el cache.'
    }

    $auditManifest = Get-Content -Path $manifestAuditPath -Raw | ConvertFrom-Json
    $expectedCount = [int]$auditManifest.totalDocumentsExtracted

    # 1. Descifrar y validar checkpoint
    Write-Host ' - Validando integridad de checkpoint.bin cifrado...' -NoNewline
    $cpBytes = [System.IO.File]::ReadAllBytes($checkpointBinPath)
    $cpPlain = Unprotect-DpapiBytes -CipherBytes $cpBytes
    $cpObj = [System.Text.Encoding]::UTF8.GetString($cpPlain) | ConvertFrom-Json
    Write-Host (' OK (Confirmados en checkpoint: ' + $cpObj.confirmedCount + ')') -ForegroundColor Green

    # 2. Descifrar y validar id-mapping
    Write-Host ' - Validando integridad de id-mapping.bin cifrado...' -NoNewline
    $mapBytes = [System.IO.File]::ReadAllBytes($idMappingBinPath)
    $mapPlain = Unprotect-DpapiBytes -CipherBytes $mapBytes
    $mapObj = [System.Text.Encoding]::UTF8.GetString($mapPlain) | ConvertFrom-Json
    Write-Host ' OK' -ForegroundColor Green

    # 3. Escanear y verificar todos los archivos doc-XXXXXX.bin
    Write-Host ' - Escaneando y verificando descifrado individual e integridad de hash...'
    $binFiles = Get-ChildItem -Path $resolvedCacheDir -Filter '*.bin' | Where-Object { $_.Name -ne 'checkpoint.bin' -and $_.Name -ne 'id-mapping.bin' }
    $verifiedCount = 0
    $corruptedFiles = @()
    $unregisteredFiles = @()

    foreach ($file in $binFiles) {
        $fName = $file.Name
        if ($fName -notmatch '^doc-\d{6}\.bin$') {
            $unregisteredFiles += $fName
            continue
        }

        try {
            $cipher = [System.IO.File]::ReadAllBytes($file.FullName)
            $plain = Unprotect-DpapiBytes -CipherBytes $cipher
            $envelope = [System.Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json

            # Recomputar hash del documento crudo
            $rawJson = $envelope.rawRestDocument | ConvertTo-Json -Depth 15 -Compress
            $computedSha = Compute-Sha256Hex -InputString $rawJson

            if ($computedSha -ne $envelope.contentSha256) {
                $corruptedFiles += ($fName + ' (HASH_MISMATCH)')
            } else {
                $verifiedCount++
            }
        } catch {
            $corruptedFiles += ($fName + ' (DECRYPTION_FAILED: ' + $_.Exception.Message + ')')
        }
    }

    # 4. Conciliación final
    $verifyStatus = 'VERIFY_SUCCESS'
    $statusReason = 'Todos los archivos coinciden con el manifiesto y superan verificacion SHA-256.'

    if ($corruptedFiles.Count -gt 0) {
        $verifyStatus = 'CORRUPTED_CACHE'
        $statusReason = 'Se detectaron archivos corruptos o ilegibles.'
    } elseif ($verifiedCount -ne $expectedCount) {
        $verifyStatus = 'COUNT_MISMATCH'
        $statusReason = 'Discrepancia entre archivos verificados ({0}) y manifiesto ({1})' -f $verifiedCount, $expectedCount
    } elseif ($unregisteredFiles.Count -gt 0) {
        $verifyStatus = 'UNREGISTERED_FILES'
        $statusReason = 'Se encontraron archivos no catalogados en el directorio de cache.'
    }

    $verifyReport = [ordered]@{
        verifyTimestampUtc  = (Get-Date).ToUniversalTime().ToString('o')
        status              = $verifyStatus
        statusReason        = $statusReason
        expectedCount       = $expectedCount
        verifiedCount       = $verifiedCount
        corruptedFiles      = $corruptedFiles
        unregisteredFiles   = $unregisteredFiles
    }

    $verifyReport | ConvertTo-Json -Depth 6 | Set-Content -Path $verifyReportPath -Encoding UTF8

    Write-Host ''
    Write-Host '========================================================================' -ForegroundColor Cyan
    Write-Host ' RESULTADO DE LA VERIFICACION FORENSE' -ForegroundColor Cyan
    Write-Host '========================================================================' -ForegroundColor Cyan
    Write-Host (' - Documentos verificados: ' + $verifiedCount + ' de ' + $expectedCount)
    if ($verifyStatus -eq 'VERIFY_SUCCESS') {
        Write-Host (' - Estado:                 VERIFY_SUCCESS') -ForegroundColor Green
    } else {
        Write-Host (' - Estado:                 ' + $verifyStatus + ' (' + $statusReason + ')') -ForegroundColor Red
    }
    Write-Host (' - Reporte de Verificación:' + $verifyReportPath)
    Write-Host '========================================================================' -ForegroundColor Cyan
}

# -----------------------------------------------------------------------------
# 10. Modo D: CRYPTOSELFTEST (Validación Criptográfica Real DPAPI CurrentUser en 11 Pasos)
# -----------------------------------------------------------------------------
elseif ($Mode -eq 'CryptoSelfTest') {
    Write-Host ''
    Write-Host '[CRYPTO-SELFTEST]: Ejecutando prueba criptográfica DPAPI CurrentUser en 11 pasos...' -ForegroundColor Cyan
    Write-Host '------------------------------------------------------------------------'

    # Paso 1: Comprobar disponibilidad de ProtectedData
    Write-Host ' [1/11] Comprobando disponibilidad de System.Security.Cryptography.ProtectedData...' -NoNewline
    if (-not $dpapiAvailable) {
        Write-Host ' ERROR' -ForegroundColor Red
        throw 'DPAPI_ERROR: ProtectedData no está disponible en este entorno.'
    }
    Write-Host ' OK' -ForegroundColor Green

    # Paso 2: Generar contenido sintético aleatorio
    Write-Host ' [2/11] Generando contenido sintético aleatorio en memoria...' -NoNewline
    $testGuid = [System.Guid]::NewGuid().ToString()
    $testPayload = 'VIGORCORE_DPAPI_VERIFY_' + $testGuid + '_' + (Get-Date).Ticks
    $plainBytes = [System.Text.Encoding]::UTF8.GetBytes($testPayload)
    Write-Host ' OK' -ForegroundColor Green

    # Paso 3: Cifrar usando CurrentUser
    Write-Host ' [3/11] Cifrando contenido con DataProtectionScope::CurrentUser...' -NoNewline
    $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    $cipherBytes = [System.Security.Cryptography.ProtectedData]::Protect($plainBytes, $null, $scope)
    if (-not $cipherBytes -or $cipherBytes.Length -eq 0) {
        Write-Host ' ERROR' -ForegroundColor Red
        throw 'DPAPI_ERROR: Falla en Protect; ciphertext vacío o nulo.'
    }
    Write-Host ' OK' -ForegroundColor Green

    # Paso 4: Escribir el ciphertext en archivo temporal protegido
    Write-Host ' [4/11] Escribiendo ciphertext en archivo temporal protegido...' -NoNewline
    if (-not (Test-Path -Path $resolvedCacheDir)) {
        New-Item -ItemType Directory -Path $resolvedCacheDir -Force | Out-Null
    }
    $tempFile = Join-Path $resolvedCacheDir ('selftest-' + [System.Guid]::NewGuid().ToString() + '.tmp')
    [System.IO.File]::WriteAllBytes($tempFile, $cipherBytes)
    Write-Host ' OK' -ForegroundColor Green

    # Paso 5: Leer el ciphertext desde disco
    Write-Host ' [5/11] Leyendo ciphertext desde archivo temporal...' -NoNewline
    $readBackBytes = [System.IO.File]::ReadAllBytes($tempFile)
    if ($readBackBytes.Length -ne $cipherBytes.Length) {
        Write-Host ' ERROR' -ForegroundColor Red
        throw 'DPAPI_ERROR: Longitud leída no coincide con longitud escrita.'
    }
    Write-Host ' OK' -ForegroundColor Green

    # Paso 6: Descifrar bajo el mismo usuario
    Write-Host ' [6/11] Descifrando ciphertext con DataProtectionScope::CurrentUser...' -NoNewline
    $decryptedBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($readBackBytes, $null, $scope)
    Write-Host ' OK' -ForegroundColor Green

    # Paso 7: Comparar el resultado byte por byte
    Write-Host ' [7/11] Comparando contenido original vs descifrado byte a byte...' -NoNewline
    $bytesIdentical = $true
    if ($plainBytes.Length -ne $decryptedBytes.Length) {
        $bytesIdentical = $false
    } else {
        for ($i = 0; $i -lt $plainBytes.Length; $i++) {
            if ($plainBytes[$i] -ne $decryptedBytes[$i]) {
                $bytesIdentical = $false
                break
            }
        }
    }
    if (-not $bytesIdentical) {
        Write-Host ' ERROR' -ForegroundColor Red
        throw 'DPAPI_ERROR: Los bytes descifrados difieren de los bytes originales.'
    }
    Write-Host ' OK (Coincidencia exacta 100%)' -ForegroundColor Green

    # Paso 8: Comprobar que el ciphertext no contiene el texto original
    Write-Host ' [8/11] Verificando ausencia de filtración de texto plano en ciphertext...' -NoNewline
    $cipherString = [System.Text.Encoding]::UTF8.GetString($cipherBytes)
    if ($cipherString.Contains($testGuid)) {
        Write-Host ' ERROR DE SEGURIDAD' -ForegroundColor Red
        throw 'DPAPI_SECURITY_LEAK: El ciphertext contiene subcadenas del texto original.'
    }
    Write-Host ' OK (Cero texto plano en ciphertext)' -ForegroundColor Green

    # Paso 9: Intentar descifrar una copia alterada y verificar que falla
    Write-Host ' [9/11] Probando detección de manipulación en ciphertext alterado...' -NoNewline
    $tamperedBytes = [byte[]]$cipherBytes.Clone()
    $tamperedBytes[$tamperedBytes.Length - 1] = [byte]($tamperedBytes[$tamperedBytes.Length - 1] -bxor 0xFF)
    $tamperDetected = $false
    try {
        [System.Security.Cryptography.ProtectedData]::Unprotect($tamperedBytes, $null, $scope) | Out-Null
    } catch {
        $tamperDetected = $true
    }
    if (-not $tamperDetected) {
        Write-Host ' ERROR' -ForegroundColor Red
        throw 'DPAPI_ERROR: El descifrado no rechazó el ciphertext alterado (fallo de detección de integridad).'
    }
    Write-Host ' OK (Manipulación rechazada fail-closed)' -ForegroundColor Green

    # Paso 10: Eliminar los archivos temporales
    Write-Host ' [10/11] Eliminando archivos temporales de prueba...' -NoNewline
    if (Test-Path -Path $tempFile) {
        Remove-Item -Path $tempFile -Force
    }
    Write-Host ' OK' -ForegroundColor Green

    # Paso 11: Informar resultado sin imprimir secretos ni contenido sensible
    Write-Host ' [11/11] Generando veredicto de validación criptográfica...' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '========================================================================' -ForegroundColor Cyan
    Write-Host ' RESULTADO DEL SELF-TEST CRIPTOGRAFICO REAL DPAPI' -ForegroundColor Cyan
    Write-Host '========================================================================' -ForegroundColor Cyan
    Write-Host ' - Proveedor:        Windows DPAPI (CurrentUser)' -ForegroundColor Green
    Write-Host ' - Integridad:       11/11 Pasos Aprobados (100% PASS-LOCAL-WINDOWS)' -ForegroundColor Green
    Write-Host ' - Fuga de Texto:    CERO (Validado ausente)' -ForegroundColor Green
    Write-Host ' - Anti-Tampering:   VALIDADO (Ciphertext alterado rechazado)' -ForegroundColor Green
    Write-Host ' - Veredicto:        DPAPI_LOCAL_SECURITY_VERIFIED' -ForegroundColor Green
    Write-Host '========================================================================' -ForegroundColor Cyan
}

# -----------------------------------------------------------------------------
# 11. Modo E: LOCALSECURITYAUDIT (Auditoría Runtime de ACL NTFS, Preflight Token y Caché Local)
# -----------------------------------------------------------------------------
elseif ($Mode -eq 'LocalSecurityAudit') {
    Write-Host ''
    Write-Host '========================================================================' -ForegroundColor Cyan
    Write-Host ' VIGORCORE -- FASE 3.5.0.3: AUDITORIA RUNTIME DE SEGURIDAD LOCAL         ' -ForegroundColor Cyan
    Write-Host '========================================================================' -ForegroundColor Cyan

    $auditFailed = $false
    $auditErrors = @()

    # -------------------------------------------------------------------------
    # PARTE 1: VERIFICACION REAL DEL PREFLIGHT TOKEN (OFFLINE)
    # -------------------------------------------------------------------------
    Write-Host ''
    Write-Host '[1/3] AUDITORIA DE INTEGRIDAD Y AUTENTICIDAD DEL PREFLIGHT TOKEN' -ForegroundColor Cyan
    Write-Host '------------------------------------------------------------------------'

    # 1.1 Comprobación de existencia de preflight-token.json
    Write-Host ' - Verificando presencia de preflight-token.json en reports/...' -NoNewline
    if (-not (Test-Path -Path $preflightTokenPath)) {
        Write-Host ' FALTA' -ForegroundColor Red
        $auditFailed = $true
        $auditErrors += 'PREFLIGHT_JSON_MISSING: preflight-token.json no encontrado.'
    } else {
        $jsonLen = (Get-Item -Path $preflightTokenPath).Length
        if ($jsonLen -eq 0) {
            Write-Host ' VACIO' -ForegroundColor Red
            $auditFailed = $true
            $auditErrors += 'PREFLIGHT_JSON_EMPTY: preflight-token.json tiene 0 bytes.'
        } else {
            Write-Host (' OK ({0} bytes)' -f $jsonLen) -ForegroundColor Green
        }
    }

    # 1.2 Comprobación de preflight-token.bin en la nueva ubicación (.data/firestore-export/control/)
    Write-Host ' - Verificando preflight-token.bin en .data/firestore-export/control/...' -NoNewline
    $targetBinToRead = $null
    if (Test-Path -Path $preflightTokenBinPath) {
        $binLen = (Get-Item -Path $preflightTokenBinPath).Length
        if ($binLen -eq 0) {
            Write-Host ' VACIO' -ForegroundColor Red
            $auditFailed = $true
            $auditErrors += 'PREFLIGHT_BINARY_EMPTY: preflight-token.bin en control/ tiene 0 bytes.'
        } else {
            Write-Host (' OK ({0} bytes en control/)' -f $binLen) -ForegroundColor Green
            $targetBinToRead = $preflightTokenBinPath
        }
    } else {
        # Verificar si reside en la ubicación antigua no permitida (reports/)
        if (Test-Path -Path $legacyPreflightTokenBinPath) {
            $legacyBinLen = (Get-Item -Path $legacyPreflightTokenBinPath).Length
            Write-Host (' UBICACION NO PERMITIDA ({0} bytes en reports/)' -f $legacyBinLen) -ForegroundColor Yellow
            $auditFailed = $true
            $auditErrors += ('UNALLOWED_BINARY_LOCATION: ' + $legacyPreflightTokenBinPath + ' (debe migrarse a .data/firestore-export/control/)')
            $auditErrors += 'PREFLIGHT_BINARY_MISSING: preflight-token.bin no encontrado en .data/firestore-export/control/.'
            $targetBinToRead = $legacyPreflightTokenBinPath
        } else {
            Write-Host ' FALTA' -ForegroundColor Red
            $auditFailed = $true
            $auditErrors += 'PREFLIGHT_BINARY_MISSING: preflight-token.bin no encontrado en .data/firestore-export/control/ ni en reports/.'
        }
    }

    # 1.3 Lectura y descifrado real DPAPI CurrentUser
    if ($targetBinToRead -and (Test-Path -Path $preflightTokenPath)) {
        Write-Host ' - Descifrando sobre binario autenticado con DPAPI CurrentUser...' -NoNewline
        $authPlainBytes = $null
        try {
            $authCipherBytes = [System.IO.File]::ReadAllBytes($targetBinToRead)
            $authPlainBytes = Unprotect-DpapiBytes -CipherBytes $authCipherBytes
            Write-Host ' OK' -ForegroundColor Green
        } catch {
            Write-Host ' ERROR' -ForegroundColor Red
            $auditFailed = $true
            $auditErrors += ('PREFLIGHT_BINARY_DECRYPT_ERROR: Falló el descifrado DPAPI: ' + $_.Exception.Message)
        }

        if ($authPlainBytes) {
            $authEnvelope = [System.Text.Encoding]::UTF8.GetString($authPlainBytes) | ConvertFrom-Json
            $tokenContent = Get-Content -Path $preflightTokenPath -Raw | ConvertFrom-Json
            $tokenRawJson = Get-Content -Path $preflightTokenPath -Raw

            # 1.4 Verificación de hash canónico contra sobre DPAPI
            Write-Host ' - Verificando firma SHA-256 de preflight-token.json...' -NoNewline
            $recomputedJson = $tokenContent | ConvertTo-Json -Depth 6 -Compress
            $recomputedSha256 = Compute-Sha256Hex -InputString $recomputedJson

            if ($recomputedSha256 -ne $authEnvelope.tokenSha256) {
                Write-Host ' ALTERADO' -ForegroundColor Red
                $auditFailed = $true
                $auditErrors += 'PREFLIGHT_TOKEN_TAMPERED: El contenido JSON no coincide con la firma autenticada DPAPI.'
            } else {
                Write-Host ' OK (Firma y contenido coinciden)' -ForegroundColor Green
            }

            # 1.5 Verificación de correspondencia de ProjectId y DatabaseId
            Write-Host ' - Verificando correspondencia de ProjectId...' -NoNewline
            if ($authEnvelope.projectId -ne $ProjectId -or $tokenContent.projectId -ne $ProjectId) {
                Write-Host ' DISCREPANCIA' -ForegroundColor Red
                $auditFailed = $true
                $auditErrors += ('PREFLIGHT_PROJECT_MISMATCH: Esperado {0}, encontrado {1}' -f $ProjectId, $authEnvelope.projectId)
            } else {
                Write-Host (' OK ({0})' -f $ProjectId) -ForegroundColor Green
            }

            Write-Host ' - Verificando correspondencia de DatabaseId...' -NoNewline
            if ($authEnvelope.databaseId -ne $DatabaseId -or $tokenContent.databaseId -ne $DatabaseId) {
                Write-Host ' DISCREPANCIA' -ForegroundColor Red
                $auditFailed = $true
                $auditErrors += ('PREFLIGHT_DATABASE_MISMATCH: Esperado {0}, encontrado {1}' -f $DatabaseId, $authEnvelope.databaseId)
            } else {
                Write-Host (' OK ({0})' -f $DatabaseId) -ForegroundColor Green
            }

            # 1.6 Estado PREFLIGHT_PASS
            Write-Host ' - Verificando estado del preflight...' -NoNewline
            if ($authEnvelope.status -ne 'PREFLIGHT_PASS' -or $tokenContent.status -ne 'PREFLIGHT_PASS') {
                Write-Host (' NO PASS ({0})' -f $authEnvelope.status) -ForegroundColor Red
                $auditFailed = $true
                $auditErrors += ('PREFLIGHT_STATUS_NOT_PASS: Estado actual es ' + $authEnvelope.status)
            } else {
                Write-Host ' OK (PREFLIGHT_PASS)' -ForegroundColor Green
            }

            # 1.7 Antigüedad (< 60 minutos) - Sin regeneración artificial
            Write-Host ' - Comprobando frescura temporal (< 60 min)...' -NoNewline
            $tokenDate = [DateTime]::Parse($authEnvelope.timestampUtc)
            $ageMinutes = ((Get-Date).ToUniversalTime() - $tokenDate).TotalMinutes
            if ($ageMinutes -gt 60) {
                Write-Host (' VENCIDO ({0:F1} min)' -f $ageMinutes) -ForegroundColor Red
                $auditFailed = $true
                $auditErrors += ('PREFLIGHT_TOKEN_EXPIRED: Antigüedad de {0:F1} min supera el umbral de 60 min.' -f $ageMinutes)
            } else {
                Write-Host (' OK ({0:F1} min de antigüedad)' -f $ageMinutes) -ForegroundColor Green
            }

            # 1.8 Ausencia de errores o conteos null
            Write-Host ' - Comprobando ausencia de errores o conteos null...' -NoNewline
            $hasNullOrError = $false
            if ($tokenContent.errors -and $tokenContent.errors.Count -gt 0) {
                $hasNullOrError = $true
            }
            if ($tokenContent.countsByUser) {
                foreach ($prop in $tokenContent.countsByUser.PSObject.Properties) {
                    $userCounts = $prop.Value
                    if ($userCounts) {
                        foreach ($subProp in $userCounts.PSObject.Properties) {
                            if ($subProp.Value -eq $null) {
                                $hasNullOrError = $true
                            }
                        }
                    }
                }
            }
            if ($hasNullOrError) {
                Write-Host ' DETECTADO ERROR O NULL' -ForegroundColor Red
                $auditFailed = $true
                $auditErrors += 'PREFLIGHT_CONTAINS_NULL_OR_ERRORS: Se encontraron conteos nulos o errores registrados.'
            } else {
                Write-Host ' OK (Conteos íntegros y cero errores)' -ForegroundColor Green
            }

            # 1.9 Ausencia de tokens ADC
            Write-Host ' - Inspeccionando ausencia de tokens ADC en preflight...' -NoNewline
            if ($tokenRawJson -match 'ya29\.[a-zA-Z0-9_-]+' -or ([System.Text.Encoding]::UTF8.GetString($authPlainBytes)) -match 'ya29\.[a-zA-Z0-9_-]+') {
                Write-Host ' ALERTA DE FUGA' -ForegroundColor Red
                $auditFailed = $true
                $auditErrors += 'SECURITY_LEAK_ADC_TOKEN_FOUND: Se detectó token ADC dentro de los archivos de preflight.'
            } else {
                Write-Host ' OK (Cero tokens ADC)' -ForegroundColor Green
            }
        }
    }

    # -------------------------------------------------------------------------
    # PARTE 2: CONCILIACION DEL DIRECTORIO DEFINITIVO Y AUDITORIA RUNTIME DE ACL
    # -------------------------------------------------------------------------
    Write-Host ''
    Write-Host '[2/3] CONCILIACION DEL DIRECTORIO DEFINITIVO Y AUDITORIA DE ACL' -ForegroundColor Cyan
    Write-Host '------------------------------------------------------------------------'

    # 2.1 Clasificación forense del directorio definitivo (.data/firestore-export/)
    Write-Host ' - Conciliando estado del directorio definitivo firestore-export...' -NoNewline
    $definitiveDirState = 'DIRECTORY_ABSENT'
    $defFileCount = 0
    $defDirCount = 0
    $defTotalBytes = 0
    $defExtensions = @{}
    $defOpaqueNames = @()
    $hasDocBins = $false
    $hasUnexpectedFiles = $false

    if (-not (Test-Path -Path $resolvedCacheDir)) {
        $definitiveDirState = 'DIRECTORY_ABSENT'
        Write-Host ' DIRECTORY_ABSENT' -ForegroundColor Green
    } else {
        $allItems = Get-ChildItem -Path $resolvedCacheDir -Force -ErrorAction SilentlyContinue
        $cacheFiles = $allItems | Where-Object { -not $_.PSIsContainer }
        $cacheDirs  = $allItems | Where-Object { $_.PSIsContainer }

        $defFileCount = if ($cacheFiles) { $cacheFiles.Count } else { 0 }
        $defDirCount  = if ($cacheDirs)  { $cacheDirs.Count } else { 0 }

        if ($defFileCount -eq 0 -and $defDirCount -eq 0) {
            $definitiveDirState = 'DIRECTORY_PRESENT_EMPTY'
            Write-Host ' DIRECTORY_PRESENT_EMPTY' -ForegroundColor Green
        } else {
            # Inspección exclusiva de metadatos (sin descifrado)
            if ($cacheFiles) {
                foreach ($cf in $cacheFiles) {
                    $defTotalBytes += $cf.Length
                    $ext = $cf.Extension.ToLower()
                    if (-not $ext) { $ext = '[sin_extension]' }
                    $defExtensions[$ext] = ($defExtensions[$ext] + 1)
                    $defOpaqueNames += $cf.Name

                    if ($cf.Name -match '^doc-\d{6}\.bin$') {
                        $hasDocBins = $true
                    } elseif ($cf.Name -match '^(checkpoint|id-mapping)\.bin$' -or $cf.Name -match '^manifest-audit\.json$') {
                        # Artefactos conocidos
                    } else {
                        $hasUnexpectedFiles = $true
                    }
                }
            }
            if ($cacheDirs) {
                foreach ($cd in $cacheDirs) {
                    $defOpaqueNames += ($cd.Name + '/')
                    if ($cd.Name -ne 'control') {
                        $hasUnexpectedFiles = $true
                    }
                }
            }

            if ($hasUnexpectedFiles) {
                $definitiveDirState = 'DIRECTORY_PRESENT_WITH_UNEXPECTED_FILES'
                Write-Host ' DIRECTORY_PRESENT_WITH_UNEXPECTED_FILES' -ForegroundColor Yellow
                $auditErrors += 'DIRECTORY_PRESENT_WITH_UNEXPECTED_FILES: Elementos con nombres o extensiones inesperadas en caché definitivo.'
            } elseif ($hasDocBins) {
                $definitiveDirState = 'DIRECTORY_PRESENT_WITH_UNVERIFIED_CACHE'
                Write-Host ' DIRECTORY_PRESENT_WITH_UNVERIFIED_CACHE' -ForegroundColor Yellow
                Write-Host '   [AVISO ANTI-SOBRESCRITURA]: Caché previo detectado. Bloqueada cualquier operación que pueda sobrescribir documentos.' -ForegroundColor Yellow
            } else {
                $definitiveDirState = 'DIRECTORY_PRESENT_WITH_FILES'
                Write-Host ' DIRECTORY_PRESENT_WITH_FILES' -ForegroundColor Green
            }

            Write-Host ('   - Archivos:          {0}' -f $defFileCount)
            Write-Host ('   - Subdirectorios:    {0}' -f $defDirCount)
            Write-Host ('   - Bytes agregados:   {0}' -f $defTotalBytes)
            Write-Host ('   - Extensiones:       {0}' -f ($defExtensions.Keys -join ', '))
            Write-Host ('   - Nombres opacos:    {0}' -f ($defOpaqueNames -join ', '))
        }

        # 2.2 Auditoría de ACL del directorio definitivo (Get-Acl pasivo, sin modificarlo)
        Write-Host ' - Auditando ACL del directorio definitivo (Get-Acl pasivo)...' -NoNewline
        try {
            $defAcl = Get-Acl -Path $resolvedCacheDir
            $defProtected = $defAcl.AreAccessRulesProtected
            $defHasUsers = $false
            foreach ($ar in $defAcl.Access) {
                if ($ar.IdentityReference.Value -match 'Everyone|Todos|Users|Usuarios|BUILTIN\\Users') {
                    $defHasUsers = $true
                }
            }
            if (-not $defProtected -or $defHasUsers) {
                Write-Host ' ACL INSUFICIENTE / HEREDADA' -ForegroundColor Yellow
                Write-Host '   [ACCION REQUERIDA]: Ejecutar endurecimiento de ACL sobre .data\firestore-export (herencia no desactivada)' -ForegroundColor Yellow
            } else {
                Write-Host ' OK (Herencia deshabilitada y acceso exclusivo)' -ForegroundColor Green
            }
        } catch {
            Write-Host (' [WARN]: ' + $_.Exception.Message) -ForegroundColor Yellow
        }
    }

    # 2.3 Auditoría de ACL del subdirectorio control (Get-Acl pasivo, si existe)
    if (Test-Path -Path $controlDir) {
        Write-Host ' - Auditando ACL del subdirectorio control (Get-Acl pasivo)...' -NoNewline
        try {
            $ctrlAcl = Get-Acl -Path $controlDir
            $ctrlProtected = $ctrlAcl.AreAccessRulesProtected
            $ctrlHasUsers = $false
            foreach ($ar in $ctrlAcl.Access) {
                if ($ar.IdentityReference.Value -match 'Everyone|Todos|Users|Usuarios|BUILTIN\\Users') {
                    $ctrlHasUsers = $true
                }
            }
            if (-not $ctrlProtected -or $ctrlHasUsers) {
                Write-Host ' ACL INSUFICIENTE' -ForegroundColor Yellow
            } else {
                Write-Host ' OK (Herencia deshabilitada y acceso exclusivo)' -ForegroundColor Green
            }
        } catch {
            Write-Host (' [WARN]: ' + $_.Exception.Message) -ForegroundColor Yellow
        }
    }

    # 2.4 Prueba de ACL en directorio sintético (.data/security-selftest/)
    $syntheticAclDir = Join-Path $pocDir '.data\security-selftest'
    Write-Host (' - Creando directorio sintético de prueba: ' + $syntheticAclDir)
    if (-not (Test-Path -Path $syntheticAclDir)) {
        New-Item -ItemType Directory -Path $syntheticAclDir -Force | Out-Null
    }

    try {
        Write-Host ' - Aplicando reglas ACL de prueba en directorio sintético...' -NoNewline
        $acl = Get-Acl -Path $syntheticAclDir
        $acl.SetAccessRuleProtection($true, $false)
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $currentUser,
            'FullControl',
            'ContainerInherit,ObjectInherit',
            'None',
            'Allow'
        )
        $acl.ResetAccessRule($rule)
        Set-Acl -Path $syntheticAclDir -AclObject $acl
        Write-Host ' OK' -ForegroundColor Green

        Write-Host ' - Verificando Get-Acl sobre directorio sintético...' -NoNewline
        $verifiedAcl = Get-Acl -Path $syntheticAclDir
        $isProtected = $verifiedAcl.AreAccessRulesProtected
        if (-not $isProtected) {
            Write-Host ' FALLA' -ForegroundColor Red
            $auditFailed = $true
            $auditErrors += 'ACL_INHERITANCE_NOT_DISABLED: La herencia de permisos no quedó deshabilitada en sintético.'
        } else {
            Write-Host ' OK (Herencia deshabilitada)' -ForegroundColor Green
        }

        $hasEveryoneOrUsers = $false
        foreach ($accessRule in $verifiedAcl.Access) {
            $idRef = $accessRule.IdentityReference.Value
            if ($idRef -match 'Everyone|Todos|Users|Usuarios|BUILTIN\\Users') {
                $hasEveryoneOrUsers = $true
            }
        }
        Write-Host ' - Comprobando ausencia de reglas Everyone/Users en sintético...' -NoNewline
        if ($hasEveryoneOrUsers) {
            Write-Host ' DETECTADO PERMISO INNECESARIO' -ForegroundColor Yellow
            $auditErrors += 'ACL_EXCESSIVE_PERMISSIONS: Se detectaron reglas para Everyone o Users en sintético.'
        } else {
            Write-Host ' OK (Sin reglas genéricas Everyone/Users)' -ForegroundColor Green
        }

        # Prueba de E/S local
        Write-Host ' - Probando capacidad efectiva de lectura y escritura local...' -NoNewline
        $testFile = Join-Path $syntheticAclDir 'acl-write-test.tmp'
        $testPayload = [System.Text.Encoding]::UTF8.GetBytes('VIGORCORE_ACL_TEST')
        [System.IO.File]::WriteAllBytes($testFile, $testPayload)
        $readBytes = [System.IO.File]::ReadAllBytes($testFile)
        Remove-Item -Path $testFile -Force

        if ($readBytes.Length -eq $testPayload.Length) {
            Write-Host ' OK (Lectura/Escritura verificada)' -ForegroundColor Green
        } else {
            Write-Host ' ERROR' -ForegroundColor Red
            $auditFailed = $true
            $auditErrors += 'ACL_IO_TEST_FAILED: No se pudo verificar la lectura y escritura efectiva.'
        }
    } catch {
        Write-Host ' ERROR CRITICO' -ForegroundColor Red
        $auditFailed = $true
        $auditErrors += ('ACL_RUNTIME_EXCEPTION: ' + $_.Exception.Message)
    } finally {
        Write-Host ' - Limpiando y eliminando directorio sintético de prueba...' -NoNewline
        if (Test-Path -Path $syntheticAclDir) {
            Remove-Item -Path $syntheticAclDir -Recurse -Force
        }
        if (-not (Test-Path -Path $syntheticAclDir)) {
            Write-Host ' OK (Directorio sintético eliminado)' -ForegroundColor Green
        } else {
            Write-Host ' ADVERTENCIA (No se pudo eliminar directorio sintético)' -ForegroundColor Yellow
        }
    }

    # -------------------------------------------------------------------------
    # PARTE 3: AUDITORIA DE EXCLUSION GIT Y ESCANEO DE BINARIOS
    # -------------------------------------------------------------------------
    Write-Host ''
    Write-Host '[3/3] AUDITORIA DE EXCLUSION GIT Y ESCANEO DE BINARIOS' -ForegroundColor Cyan
    Write-Host '------------------------------------------------------------------------'

    Write-Host ' - Comprobando directivas .data/ y *.bin en .gitignore...' -NoNewline
    if (-not $gitignoreOk) {
        Write-Host ' FALLA' -ForegroundColor Red
        $auditFailed = $true
        $auditErrors += 'GITIGNORE_MISSING_EXCLUSION: poc/catalyst-3-2/.gitignore no contiene .data/'
    } else {
        Write-Host ' OK (.data/ y *.bin excluidos)' -ForegroundColor Green
    }

    # Escaneo exhaustivo de binarios en todo el ámbito de la POC
    Write-Host ' - Escaneando binarios en el árbol de la POC...' -NoNewline
    $allBinFiles = Get-ChildItem -Path $pocDir -Filter '*.bin' -Recurse -Force -ErrorAction SilentlyContinue
    $disallowedBins = @()
    $suspiciousBins = @()

    if ($allBinFiles) {
        foreach ($bf in $allBinFiles) {
            $normPath = $bf.FullName.Replace('\', '/')
            if ($normPath -match '/\.data/') {
                if ($bf.Name -match '^doc-\d{6}\.bin$' -or $bf.Name -match '^(checkpoint|id-mapping|preflight-token)\.bin$') {
                    # Binario confidencial permitido en .data/
                } else {
                    $suspiciousBins += $bf.FullName
                }
            } else {
                # Cualquier binario fuera de .data/ es ubicación no permitida
                $disallowedBins += $bf.FullName
            }
        }
    }

    if ($disallowedBins.Count -gt 0 -or $suspiciousBins.Count -gt 0) {
        Write-Host (' DETECTADOS {0} BINARIOS IRREGULARES' -f ($disallowedBins.Count + $suspiciousBins.Count)) -ForegroundColor Red
        $auditFailed = $true
        foreach ($db in $disallowedBins) {
            Write-Host ('   [!] Binario en ubicación no permitida (fuera de .data/): ' + $db) -ForegroundColor Red
            $auditErrors += ('UNALLOWED_BINARY_LOCATION: ' + $db)
        }
        foreach ($sb in $suspiciousBins) {
            Write-Host ('   [!] Binario sospechoso o con nombre desconocido: ' + $sb) -ForegroundColor Yellow
            $auditErrors += ('SUSPICIOUS_BINARY_DETECTED: ' + $sb)
        }
    } else {
        Write-Host ' OK (Cero binarios fuera de .data/ y binarios internos válidos)' -ForegroundColor Green
    }

    # -------------------------------------------------------------------------
    # DICTAMEN FINAL DE LA AUDITORIA LOCAL
    # -------------------------------------------------------------------------
    Write-Host ''
    Write-Host '========================================================================' -ForegroundColor Cyan
    Write-Host ' DICTAMEN DE LA AUDITORIA DE SEGURIDAD LOCAL FASE 3.5.0.3' -ForegroundColor Cyan
    Write-Host '========================================================================' -ForegroundColor Cyan
    if ($auditFailed) {
        Write-Host ' ESTADO: PARTIALLY VERIFIED — BLOCKERS REMAIN' -ForegroundColor Red
        Write-Host ' Bloqueos detectados que impiden autorizar la extracción:' -ForegroundColor Red
        foreach ($ae in $auditErrors) {
            Write-Host ('  - ' + $ae) -ForegroundColor Red
        }
    } else {
        Write-Host ' ESTADO: REMEDIATION IMPLEMENTED — WINDOWS VERIFICATION PENDING' -ForegroundColor Green
        Write-Host ' Todos los controles locales auditados exitosamente.' -ForegroundColor Green
    }
    Write-Host '========================================================================' -ForegroundColor Cyan
}
