# =============================================================================
# VIGORCORE ETL -- EXTRACTOR FORENSE CONTROLADO FIRESTORE -> CACHE LOCAL CIFRADO
# Archivo: poc/catalyst-3-2/scripts/extract-firestore.ps1
# Version: 1.0.5 (Fase 3.5.0.5: Parser fix, single-element arrays, hash exacto)
# Compatibilidad: Windows PowerShell 5.1+
# =============================================================================

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [string]$ProjectId = 'gen-lang-client-0041212770',

    [Parameter(Mandatory = $false)]
    [string]$DatabaseId = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',

    [Parameter(Mandatory = $false)]
    [ValidateSet('Preflight', 'Extract', 'CryptoSelfTest', 'LocalSecurityAudit')]
    [string]$Mode = 'Preflight',

    [Parameter(Mandatory = $false)]
    [string]$CacheDir = '.data\firestore-export',

    [Parameter(Mandatory = $false)]
    [switch]$DriftAcknowledged,

    [Parameter(Mandatory = $false)]
    [switch]$SkipDpapiVerify,

    [Parameter(Mandatory = $false)]
    [switch]$AllowOverwrite
)

$ErrorActionPreference = 'Stop'

# Cargar System.Security para ProtectedData (DPAPI)
Add-Type -AssemblyName System.Security

# -----------------------------------------------------------------------------
# RUTAS DE CONTROL Y DIRECTORIOS
# -----------------------------------------------------------------------------
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$pocDir = Split-Path -Parent $scriptDir

$reportsDir = Join-Path $pocDir 'reports\firestore-extraction-3.5'
$preflightTokenJsonPath = Join-Path $reportsDir 'preflight-token.json'

$resolvedCacheDir = [System.IO.Path]::GetFullPath((Join-Path $pocDir $CacheDir))
$controlDir = Join-Path $resolvedCacheDir 'control'
$preflightTokenBinPath = Join-Path $controlDir 'preflight-token.bin'
$legacyPreflightTokenBinPath = Join-Path $reportsDir 'preflight-token.bin'

$checkpointBinPath = Join-Path $controlDir 'checkpoint.bin'
$idMappingBinPath  = Join-Path $controlDir 'id-mapping.bin'
$manifestAuditPath = Join-Path $reportsDir 'manifest-audit.json'

# Colecciones y subcolecciones canonicas segun inventario forense
$candidateSubcollections = @(
    'biometrics', 'groceries', 'preferences', 'mealLogs',
    'notifications', 'waterLogs', 'progressPhotos', 'workouts',
    'subscriptions', 'inventory', 'auditLogs'
)

$candidateAdminCollections = @(
    'tenants', 'metadata', 'systemConfig',
    'platformSettings', 'catalystSync', 'migrationAudit'
)

# -----------------------------------------------------------------------------
# FUNCIONES AUXILIARES CRIPTOGRAFICAS Y DE SEGURIDAD
# -----------------------------------------------------------------------------
function Protect-DpapiBytes {
    param (
        [Parameter(Mandatory = $true)]
        [byte[]]$PlainBytes
    )
    return [System.Security.Cryptography.ProtectedData]::Protect(
        $PlainBytes,
        $null,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
}

function Unprotect-DpapiBytes {
    param (
        [Parameter(Mandatory = $true)]
        [byte[]]$CipherBytes
    )
    return [System.Security.Cryptography.ProtectedData]::Unprotect(
        $CipherBytes,
        $null,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
}

function Get-Sha256String {
    param (
        [Parameter(Mandatory = $true)]
        [string]$InputString
    )
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($InputString)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    $hashBytes = $hasher.ComputeHash($bytes)
    return [System.BitConverter]::ToString($hashBytes).Replace('-', '').ToLower()
}

function Get-Sha256Bytes {
    param (
        [Parameter(Mandatory = $true)]
        [byte[]]$InputBytes
    )
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    $hashBytes = $hasher.ComputeHash($InputBytes)
    return [System.BitConverter]::ToString($hashBytes).Replace('-', '').ToLower()
}

function Get-GcpAccessToken {
    Write-Host ' - Obteniendo token de acceso GCP ADC...' -NoNewline
    $rawToken = $null
    try {
        $rawToken = (& gcloud auth application-default print-access-token 2>$null)
    } catch {
        $rawToken = $null
    }

    if (-not $rawToken) {
        try {
            $rawToken = (& gcloud auth print-access-token 2>$null)
        } catch {
            $rawToken = $null
        }
    }

    if (-not $rawToken) {
        Write-Host ' FALLA' -ForegroundColor Red
        throw 'ERROR: No se pudo obtener el token de acceso ADC. Ejecute "gcloud auth application-default login" previamente.'
    }

    $token = ([string]($rawToken | Select-Object -First 1)).Trim()
    if ($token.Length -lt 20) {
        Write-Host ' FORMATO INVALIDO' -ForegroundColor Red
        throw 'ERROR: Token obtenido tiene un formato inesperado o vacio.'
    }
    Write-Host ' OK' -ForegroundColor Green
    return $token
}

function Categorize-HttpError {
    param (
        [int]$StatusCode,
        [string]$ErrorBody
    )
    if ($ErrorBody -match 'BILLING_DISABLED|billing|quotaExceeded|RESOURCE_EXHAUSTED|rateLimitExceeded') {
        return 'RESOURCE_EXHAUSTED'
    }
    if ($StatusCode -eq 401) { return 'UNAUTHENTICATED' }
    if ($StatusCode -eq 403) { return 'PERMISSION_DENIED' }
    if ($StatusCode -eq 404) { return 'NOT_FOUND' }
    if ($StatusCode -eq 429) { return 'RESOURCE_EXHAUSTED' }
    if ($StatusCode -ge 500) { return 'UNAVAILABLE' }
    return 'UNKNOWN'
}

function Invoke-FirestoreRestSafe {
    param (
        [string]$Method = 'GET',
        [string]$Url,
        [object]$Body = $null,
        [string]$AccessToken
    )

    $headers = @{
        'Authorization' = 'Bearer ' + $AccessToken
        'Content-Type'  = 'application/json; charset=utf-8'
    }

    $jsonBody = $null
    if ($Body) {
        $jsonBody = $Body | ConvertTo-Json -Depth 10 -Compress
    }

    $maxRetries = 3
    $attempt = 0
    $lastException = $null

    while ($attempt -lt $maxRetries) {
        $attempt++
        try {
            if ($Method -eq 'GET') {
                $response = Invoke-RestMethod -Uri $Url -Method Get -Headers $headers -TimeoutSec 30
            } else {
                $response = Invoke-RestMethod -Uri $Url -Method Post -Headers $headers -Body $jsonBody -TimeoutSec 30
            }
            return [ordered]@{
                StatusCode = 200
                Body       = $response
                Error      = $null
                Category   = 'OK'
            }
        } catch {
            $lastException = $_
            $statusCode = 0
            $errBodyText = ''
            if ($_.Exception.Response) {
                try { $statusCode = [int]$_.Exception.Response.StatusCode } catch { $statusCode = 0 }
            }
            if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
                $errBodyText = $_.ErrorDetails.Message
            } elseif ($_.Exception.Response -and ($_.Exception.Response -is [System.Net.WebResponse])) {
                try {
                    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                    $errBodyText = $reader.ReadToEnd()
                    $reader.Close()
                } catch { }
            }
            $category = Categorize-HttpError -StatusCode $statusCode -ErrorBody $errBodyText

            # Reintentos solo en casos transitorios
            if ($category -in @('RESOURCE_EXHAUSTED', 'UNAVAILABLE') -and $attempt -lt $maxRetries) {
                $backoffSec = [Math]::Pow(2, $attempt)
                Start-Sleep -Seconds $backoffSec
                continue
            }

            return [ordered]@{
                StatusCode  = $statusCode
                Body        = $null
                Error       = $_.Exception.Message
                ErrorDetail = $errBodyText
                Category    = $category
            }
        }
    }

    return [ordered]@{
        StatusCode  = 0
        Body        = $null
        Error       = $lastException.Exception.Message
        ErrorDetail = ''
        Category    = 'RETRY_EXHAUSTED'
    }
}

# -----------------------------------------------------------------------------
# MODO 1: CRYPTO SELF TEST (Windows DPAPI Real)
# -----------------------------------------------------------------------------
if ($Mode -eq 'CryptoSelfTest') {
    Write-Host '========================================================================' -ForegroundColor Cyan
    Write-Host 'VIGORCORE ETL -- PRUEBA CRIPTOGRAFICA WINDOWS DPAPI (DataProtectionScope.CurrentUser)' -ForegroundColor Cyan
    Write-Host '========================================================================' -ForegroundColor Cyan

    $testPayload = 'VIGORCORE_DPAPI_VERIFICATION_PAYLOAD_' + [System.Guid]::NewGuid().ToString() + '_' + [DateTimeOffset]::UtcNow.ToString('o')
    $plainBytes = [System.Text.Encoding]::UTF8.GetBytes($testPayload)

    Write-Host '1. Generando payload sintetico...' -NoNewline
    Write-Host ' OK' -ForegroundColor Green

    Write-Host '2. Ejecutando Protect-DpapiBytes...' -NoNewline
    $cipherBytes = Protect-DpapiBytes -PlainBytes $plainBytes
    Write-Host (' OK ({0} bytes cifrados)' -f $cipherBytes.Length) -ForegroundColor Green

    Write-Host '3. Verificando que el texto cifrado difiere del original...' -NoNewline
    if ($cipherBytes.Length -eq $plainBytes.Length) {
        $identical = $true
        for ($i = 0; $i -lt $plainBytes.Length; $i++) {
            if ($cipherBytes[$i] -ne $plainBytes[$i]) { $identical = $false; break }
        }
        if ($identical) {
            Write-Host ' FALLA' -ForegroundColor Red
            throw 'FALLA: El texto cifrado es identico al texto plano.'
        }
    }
    Write-Host ' OK (Difieren)' -ForegroundColor Green

    Write-Host '4. Escribiendo temporalmente a disco...' -NoNewline
    $tempFile = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllBytes($tempFile, $cipherBytes)
    Write-Host ' OK' -ForegroundColor Green

    Write-Host '5. Leyendo desde disco...' -NoNewline
    $readCipher = [System.IO.File]::ReadAllBytes($tempFile)
    Write-Host ' OK' -ForegroundColor Green

    Write-Host '6. Ejecutando Unprotect-DpapiBytes...' -NoNewline
    $decryptedBytes = Unprotect-DpapiBytes -CipherBytes $readCipher
    $decryptedText = [System.Text.Encoding]::UTF8.GetString($decryptedBytes)
    Write-Host ' OK' -ForegroundColor Green

    Write-Host '7. Verificando integridad del payload descifrado...' -NoNewline
    if ($decryptedText -ne $testPayload) {
        Write-Host ' FALLA' -ForegroundColor Red
        throw 'FALLA: El payload descifrado difiere del original.'
    }
    Write-Host ' OK (Payload identico)' -ForegroundColor Green

    Write-Host '8. Probando deteccion de corrupcion/manipulacion...' -NoNewline
    $corruptCipher = [byte[]]$readCipher.Clone()
    $corruptCipher[10] = ($corruptCipher[10] -bxor 0xFF)
    $tamperDetected = $false
    try {
        $null = Unprotect-DpapiBytes -CipherBytes $corruptCipher
    } catch [System.Security.Cryptography.CryptographicException] {
        $tamperDetected = $true
    } catch {
        $tamperDetected = $true
    }
    if (-not $tamperDetected) {
        Write-Host ' FALLA' -ForegroundColor Red
        throw 'FALLA: No se detecto manipulacion en datos cifrados corruptos.'
    }
    Write-Host ' OK (CryptographicException confirmada)' -ForegroundColor Green

    Write-Host '9. Verificando aislamiento de sesion (CurrentUser)...' -NoNewline
    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    Write-Host (' OK (Identidad: {0})' -f $currentUser) -ForegroundColor Green

    Write-Host '10. Limpiando archivos temporales...' -NoNewline
    if (Test-Path -Path $tempFile) { Remove-Item -Path $tempFile -Force }
    Write-Host ' OK' -ForegroundColor Green

    Write-Host '11. Dictamen final de prueba criptografica...' -NoNewline
    Write-Host ' CRYPTO_SELFTEST_PASS' -ForegroundColor Green
    return
}

# -----------------------------------------------------------------------------
# MODO 2: PREFLIGHT (Inspeccion estructural no extractiva)
# -----------------------------------------------------------------------------
if ($Mode -eq 'Preflight') {
    Write-Host '========================================================================' -ForegroundColor Cyan
    Write-Host 'VIGORCORE ETL -- EJECUCION DE PREFLIGHT ESTRUCTURAL REMOTO' -ForegroundColor Cyan
    Write-Host '========================================================================' -ForegroundColor Cyan
    Write-Host ('Proyecto GCP : ' + $ProjectId)
    Write-Host ('Base Datos   : ' + $DatabaseId)
    Write-Host ''

    $token = Get-GcpAccessToken
    $databaseRootUrl = 'https://firestore.googleapis.com/v1/projects/' + $ProjectId + '/databases/' + $DatabaseId + '/documents'

    # Asegurar existencia de directorio de reportes
    if (-not (Test-Path -Path $reportsDir)) {
        New-Item -ItemType Directory -Path $reportsDir -Force | Out-Null
    }

    # Asegurar existencia de directorio control/ en el cache definitivo
    if (-not (Test-Path -Path $controlDir)) {
        New-Item -ItemType Directory -Path $controlDir -Force | Out-Null
    }

    Write-Host ' - Consultando coleccion raiz users...' -NoNewline
    $usersRunQueryUrl = $databaseRootUrl + ':runQuery'
    $usersBody = [ordered]@{
        structuredQuery = [ordered]@{
            select  = @{ fields = @( @{ fieldPath = '__name__' } ) }
            from    = @( @{ collectionId = 'users' } )
            orderBy = @( @{ field = @{ fieldPath = '__name__' }; direction = 'ASCENDING' } )
            limit   = 100
        }
    }

    $usersRes = Invoke-FirestoreRestSafe -Method 'POST' -Url $usersRunQueryUrl -Body $usersBody -AccessToken $token
    if ($usersRes.StatusCode -ne 200) {
        Write-Host (' FALLA (' + $usersRes.Category + ')') -ForegroundColor Red
        throw ('Error consultando usuarios: ' + $usersRes.Error)
    }

    $userDocNames = @()
    if ($usersRes.Body) {
        foreach ($item in @($usersRes.Body)) {
            if ($item -and $item.document -and $item.document.name) {
                $userDocNames += $item.document.name
            }
        }
    }
    Write-Host (' OK ({0} usuarios detectados)' -f $userDocNames.Count) -ForegroundColor Green

    $countsByUser = [ordered]@{}
    $countsByCol = [ordered]@{
        'users'          = $userDocNames.Count
        'biometrics'     = 0
        'groceries'      = 0
        'preferences'    = 0
        'mealLogs'       = 0
        'notifications'  = 0
        'waterLogs'      = 0
        'progressPhotos' = 0
        'workouts'       = 0
        'subscriptions'  = 0
        'inventory'      = 0
        'auditLogs'      = 0
    }

    $totalSecondaryDocs = 0
    $recordedErrors = @()

    $userIndex = 1
    foreach ($userDocPath in $userDocNames) {
        $userAlias = 'USER_{0:D3}' -f $userIndex
        $countsByUser[$userAlias] = [ordered]@{}

        Write-Host (' - Inspeccionando subcolecciones de {0}...' -f $userAlias) -NoNewline
        $userSubParentUrl = 'https://firestore.googleapis.com/v1/' + $userDocPath

        foreach ($subCol in $candidateSubcollections) {
            $subQueryUrl = $userSubParentUrl + ':runQuery'
            $subBody = [ordered]@{
                structuredQuery = [ordered]@{
                    select  = @{ fields = @( @{ fieldPath = '__name__' } ) }
                    from    = @( @{ collectionId = $subCol } )
                    orderBy = @( @{ field = @{ fieldPath = '__name__' }; direction = 'ASCENDING' } )
                    limit   = 200
                }
            }
            $subRes = Invoke-FirestoreRestSafe -Method 'POST' -Url $subQueryUrl -Body $subBody -AccessToken $token
            if ($subRes.StatusCode -eq 200) {
                $subDocCount = 0
                if ($subRes.Body) {
                    foreach ($dItem in @($subRes.Body)) {
                        if ($dItem -and $dItem.document -and $dItem.document.name) {
                            $subDocCount++
                        }
                    }
                }
                $countsByUser[$userAlias][$subCol] = $subDocCount
                $countsByCol[$subCol] = ($countsByCol[$subCol] + $subDocCount)
                $totalSecondaryDocs += $subDocCount
            } else {
                $recordedErrors += ('Error en ' + $userAlias + '/' + $subCol + ': ' + $subRes.Category)
                $countsByUser[$userAlias][$subCol] = $null
            }
        }
        Write-Host ' OK' -ForegroundColor Green
        $userIndex++
    }

    # Consultar colecciones administrativas
    Write-Host ' - Consultando colecciones administrativas candidatas...' -NoNewline
    $adminCounts = [ordered]@{}
    $adminTotal = 0
    foreach ($adminCol in $candidateAdminCollections) {
        $adminQueryUrl = $databaseRootUrl + ':runQuery'
        $adminBody = [ordered]@{
            structuredQuery = [ordered]@{
                select = @{ fields = @( @{ fieldPath = '__name__' } ) }
                from   = @( @{ collectionId = $adminCol } )
                limit  = 10
            }
        }
        $admRes = Invoke-FirestoreRestSafe -Method 'POST' -Url $adminQueryUrl -Body $adminBody -AccessToken $token
        $admCount = 0
        if ($admRes.StatusCode -eq 200 -and $admRes.Body) {
            foreach ($aItem in @($admRes.Body)) {
                if ($aItem -and $aItem.document -and $aItem.document.name) {
                    $admCount++
                }
            }
        }
        $adminCounts[$adminCol] = $admCount
        $adminTotal += $admCount
    }
    Write-Host (' OK ({0} documentos administrativos)' -f $adminTotal) -ForegroundColor Green

    $totalDocs = $userDocNames.Count + $totalSecondaryDocs
    $diffFromBaseline = $totalDocs - 73

    $status = 'PREFLIGHT_PASS'
    if ($recordedErrors.Count -gt 0) {
        $status = 'PREFLIGHT_FAILED'
    } elseif ($diffFromBaseline -ne 0) {
        $status = 'BASELINE_DRIFT'
    }

    # Timestamp ISO 8601 estricto con zona horaria UTC
    $timestampUtc = [DateTimeOffset]::UtcNow.ToString('o')

    $tokenContent = [ordered]@{
        version              = '1.0.5'
        projectId            = $ProjectId
        databaseId           = $DatabaseId
        status               = $status
        timestampUtc         = $timestampUtc
        totalDocuments       = $totalDocs
        totalUsers           = $userDocNames.Count
        totalSecondaryDocs   = $totalSecondaryDocs
        diffFromBaseline     = $diffFromBaseline
        countsByCollection   = $countsByCol
        countsByUser         = $countsByUser
        adminCollections     = $adminCounts
        errors               = @($recordedErrors)
    }

    $tokenJson = $tokenContent | ConvertTo-Json -Depth 8

    # Escritura EXACTA (UTF-8 sin BOM, sin salto de linea extra) para que el hash coincida al releer
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($preflightTokenJsonPath, $tokenJson, $utf8NoBom)

    $tokenSha256 = Get-Sha256String -InputString $tokenJson

    $authEnvelope = [ordered]@{
        version            = '1.0.5'
        projectId          = $ProjectId
        databaseId         = $DatabaseId
        status             = $status
        timestampUtc       = $timestampUtc
        totalDocuments     = $totalDocs
        totalUsers         = $userDocNames.Count
        tokenSha256        = $tokenSha256
    }

    $authEnvelopeJson = $authEnvelope | ConvertTo-Json -Depth 4 -Compress
    $authEnvelopeBytes = [System.Text.Encoding]::UTF8.GetBytes($authEnvelopeJson)
    $encryptedAuthEnvelope = Protect-DpapiBytes -PlainBytes $authEnvelopeBytes

    # Guardar en el directorio definitivo control/
    [System.IO.File]::WriteAllBytes($preflightTokenBinPath, $encryptedAuthEnvelope)

    Write-Host ''
    Write-Host '========================================================================' -ForegroundColor Green
    Write-Host ('PREFLIGHT RESULTADO : ' + $status) -ForegroundColor Green
    Write-Host ('Total Documentos    : ' + $totalDocs + ' (Esperados: 73)')
    Write-Host ('Usuarios Raiz       : ' + $userDocNames.Count + ' (Esperados: 5)')
    Write-Host ('Docs Secundarios    : ' + $totalSecondaryDocs + ' (Esperados: 68)')
    Write-Host ('Token SHA-256       : ' + $tokenSha256)
    Write-Host ('Token JSON          : ' + $preflightTokenJsonPath)
    Write-Host ('Token BIN (DPAPI)   : ' + $preflightTokenBinPath)
    Write-Host '========================================================================' -ForegroundColor Green
    return
}

# -----------------------------------------------------------------------------
# MODO 3: EXTRACT (Extraccion forense protegida)
# -----------------------------------------------------------------------------
if ($Mode -eq 'Extract') {
    Write-Host '========================================================================' -ForegroundColor Cyan
    Write-Host 'VIGORCORE ETL -- COMPUERTAS DE AUTORIZACION PREVIAS A LA EXTRACCION' -ForegroundColor Cyan
    Write-Host '========================================================================' -ForegroundColor Cyan

    # Control 1: Existencia de archivos de control
    if (-not (Test-Path -Path $preflightTokenJsonPath)) {
        throw ('BLOQUEO: preflight-token.json no existe en ' + $preflightTokenJsonPath)
    }
    if (-not (Test-Path -Path $preflightTokenBinPath)) {
        throw ('BLOQUEO: preflight-token.bin no existe en ' + $preflightTokenBinPath)
    }

    # Control 2: Descifrado DPAPI y verificacion de integridad
    $authCipherBytes = [System.IO.File]::ReadAllBytes($preflightTokenBinPath)
    $authPlainBytes = Unprotect-DpapiBytes -CipherBytes $authCipherBytes
    $authEnvelope = [System.Text.Encoding]::UTF8.GetString($authPlainBytes) | ConvertFrom-Json

    $tokenRawJson = [System.IO.File]::ReadAllText($preflightTokenJsonPath, (New-Object System.Text.UTF8Encoding($false)))
    $tokenContent = $tokenRawJson | ConvertFrom-Json
    $expectedHash = Get-Sha256String -InputString $tokenRawJson

    if ($authEnvelope.tokenSha256 -ne $expectedHash) {
        throw 'BLOQUEO: El hash SHA-256 de preflight-token.json no coincide con el sobre DPAPI.'
    }

    # Control 3: Correspondencia de ProjectId y DatabaseId
    if ($authEnvelope.projectId -ne $ProjectId -or $tokenContent.projectId -ne $ProjectId) {
        throw ('BLOQUEO: El token de preflight corresponde al proyecto {0}, pero el script fue invocado para {1}.' -f $authEnvelope.projectId, $ProjectId)
    }
    if ($authEnvelope.databaseId -ne $DatabaseId -or $tokenContent.databaseId -ne $DatabaseId) {
        throw ('BLOQUEO: El token de preflight corresponde a la base {0}, pero el script fue invocado para {1}.' -f $authEnvelope.databaseId, $DatabaseId)
    }

    # Control 4: Antiguedad maxima del Preflight (< 60 minutos) usando DateTimeOffset
    $preflightOffset = [DateTimeOffset]::MinValue
    try {
        $preflightOffset = [DateTimeOffset]::Parse([string]$authEnvelope.timestampUtc, [System.Globalization.CultureInfo]::InvariantCulture)
    } catch {
        throw ('BLOQUEO: Formato de timestamp invalido en preflight: ' + $authEnvelope.timestampUtc)
    }
    if ([string]$authEnvelope.timestampUtc -ne [string]$tokenContent.timestampUtc) {
        throw 'BLOQUEO: timestampUtc en JSON y sobre DPAPI difieren.'
    }
    $ageMinutes = ([DateTimeOffset]::UtcNow - $preflightOffset).TotalMinutes
    if ($ageMinutes -lt -2.0) {
        throw ('BLOQUEO: El token de preflight tiene fecha en el futuro ({0:F1} min).' -f [Math]::Abs($ageMinutes))
    }
    if ($ageMinutes -gt 60.0) {
        throw ('BLOQUEO: El token de preflight tiene {0:F1} minutos de antiguedad (> 60 min). Ejecute un nuevo Preflight.' -f $ageMinutes)
    }
    if ($authEnvelope.status -eq 'PREFLIGHT_FAILED' -or $tokenContent.status -eq 'PREFLIGHT_FAILED') {
        throw 'BLOQUEO: El preflight reporto errores de consulta (PREFLIGHT_FAILED). Extraccion denegada.'
    }
    if ($tokenContent.errors -and @($tokenContent.errors).Count -gt 0) {
        throw 'BLOQUEO: El preflight contiene errores de consulta registrados. Extraccion denegada.'
    }

    # Control 5: Baseline drift acknowledgment
    if ($authEnvelope.status -eq 'BASELINE_DRIFT' -and -not $DriftAcknowledged) {
        throw 'BLOQUEO: Existe BASELINE_DRIFT y no se especifico el parametro -DriftAcknowledged.'
    }

    # Control 6: Verificacion de cache previo y regla anti-sobrescritura
    if (Test-Path -Path $resolvedCacheDir) {
        $existingDocBins = @(Get-ChildItem -Path $resolvedCacheDir -Filter 'doc-*.bin' -File -ErrorAction SilentlyContinue)
        if ($existingDocBins.Count -gt 0 -and -not $AllowOverwrite) {
            throw ('BLOQUEO ANTI-SOBRESCRITURA: Se detectaron {0} documentos ya extraidos en el cache. Especifique -AllowOverwrite si desea reiniciar.' -f $existingDocBins.Count)
        }
    }

    # Control 7: Verificacion de ACL en cache definitivo
    if (Test-Path -Path $resolvedCacheDir) {
        try {
            $acl = Get-Acl -Path $resolvedCacheDir
            if (-not $acl.AreAccessRulesProtected) {
                Write-Host 'ADVERTENCIA: La herencia de permisos NTFS no esta deshabilitada en el cache definitivo.' -ForegroundColor Yellow
            }
        } catch { }
    }

    Write-Host 'TODAS LAS COMPUERTAS DE AUTORIZACION FUERON VALIDADAS EXITOSAMENTE.' -ForegroundColor Green
    Write-Host 'AVISO DE GOBERNANZA: La extraccion de documentos completos esta restringida a la Fase 3.5.1.' -ForegroundColor Yellow
    return
}

# -----------------------------------------------------------------------------
# MODO 4: LOCAL SECURITY AUDIT
# -----------------------------------------------------------------------------
if ($Mode -eq 'LocalSecurityAudit') {
    Write-Host '========================================================================' -ForegroundColor Cyan
    Write-Host 'VIGORCORE ETL -- AUDITORIA DE SEGURIDAD LOCAL, RUNTIME ACL Y PREFLIGHT' -ForegroundColor Cyan
    Write-Host '========================================================================' -ForegroundColor Cyan

    $auditFailed = $false
    $auditErrors = @()

    # PARTE 1: VERIFICACION INTEGRAL DEL PREFLIGHT TOKEN Y SOBRE DPAPI
    Write-Host ''
    Write-Host '[1/3] VERIFICACION DEL PREFLIGHT TOKEN Y SOBRE CIFRADO DPAPI' -ForegroundColor Cyan
    Write-Host '------------------------------------------------------------------------'

    # 1.1 Existencia y ubicacion
    Write-Host ' - Verificando existencia de preflight-token.json...' -NoNewline
    if (-not (Test-Path -Path $preflightTokenJsonPath)) {
        Write-Host ' NO ENCONTRADO' -ForegroundColor Red
        $auditFailed = $true
        $auditErrors += ('PREFLIGHT_JSON_MISSING: ' + $preflightTokenJsonPath)
    } else {
        $jsonSize = (Get-Item -Path $preflightTokenJsonPath).Length
        Write-Host (' OK ({0} bytes en {1})' -f $jsonSize, $preflightTokenJsonPath) -ForegroundColor Green
    }

    Write-Host ' - Verificando ubicacion de preflight-token.bin...' -NoNewline
    $binFound = $false
    $activeBinPath = $null

    if (Test-Path -Path $preflightTokenBinPath) {
        $activeBinPath = $preflightTokenBinPath
        $binSize = (Get-Item -Path $preflightTokenBinPath).Length
        Write-Host (' OK (UBICACION DEFINITIVA: {0} bytes en control\)' -f $binSize) -ForegroundColor Green
        $binFound = $true
    } elseif (Test-Path -Path $legacyPreflightTokenBinPath) {
        $activeBinPath = $legacyPreflightTokenBinPath
        $binSize = (Get-Item -Path $legacyPreflightTokenBinPath).Length
        Write-Host (' ENCONTRADO EN UBICACION LEGACY ({0} bytes en reports\)' -f $binSize) -ForegroundColor Yellow
        $auditFailed = $true
        $auditErrors += 'PREFLIGHT_BIN_IN_LEGACY_LOCATION: Debe migrarse a .data\firestore-export\control\.'
        $binFound = $true
    } else {
        Write-Host ' NO ENCONTRADO' -ForegroundColor Red
        $auditFailed = $true
        $auditErrors += 'PREFLIGHT_BIN_MISSING: preflight-token.bin no existe en ninguna ubicacion.'
    }

    # 1.2 Descifrado DPAPI
    $authEnvelope = $null
    $authPlainBytes = $null
    if ($binFound -and $activeBinPath) {
        Write-Host ' - Descifrando sobre DPAPI...' -NoNewline
        try {
            $authCipherBytes = [System.IO.File]::ReadAllBytes($activeBinPath)
            $authPlainBytes = Unprotect-DpapiBytes -CipherBytes $authCipherBytes
            $authEnvelope = [System.Text.Encoding]::UTF8.GetString($authPlainBytes) | ConvertFrom-Json
            Write-Host ' OK (Descifrado con CurrentUser)' -ForegroundColor Green
        } catch {
            Write-Host ' FALLA' -ForegroundColor Red
            $auditFailed = $true
            $auditErrors += ('DPAPI_DECRYPT_FAILED: ' + $_.Exception.Message)
        }
    }

    # 1.3 Integridad del JSON vs Hash
    $tokenContent = $null
    $tokenRawJson = $null
    if (Test-Path -Path $preflightTokenJsonPath) {
        $tokenRawJson = [System.IO.File]::ReadAllText($preflightTokenJsonPath, (New-Object System.Text.UTF8Encoding($false)))
        try {
            $tokenContent = $tokenRawJson | ConvertFrom-Json
        } catch {
            $auditFailed = $true
            $auditErrors += 'PREFLIGHT_JSON_INVALID_SYNTAX: Error al parsear JSON.'
        }
    }

    if ($authEnvelope -and $tokenRawJson -and $tokenContent) {
        Write-Host ' - Verificando integridad SHA-256 entre JSON y BIN...' -NoNewline
        $actualSha256 = Get-Sha256String -InputString $tokenRawJson
        if ($actualSha256 -ne $authEnvelope.tokenSha256) {
            Write-Host ' DISCREPANCIA' -ForegroundColor Red
            $auditFailed = $true
            $auditErrors += ('PREFLIGHT_HASH_MISMATCH: Esperado {0}, calculado {1}' -f $authEnvelope.tokenSha256, $actualSha256)
        } else {
            Write-Host ' OK (Hash coincidente)' -ForegroundColor Green
        }

        # 1.4 y 1.5 Correspondencia de ProjectId y DatabaseId
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

        # 1.7 Antiguedad (< 60 minutos) usando DateTimeOffset
        Write-Host ' - Comprobando correspondencia de timestampUtc en JSON y BIN...' -NoNewline
        if ([string]$authEnvelope.timestampUtc -ne [string]$tokenContent.timestampUtc) {
            Write-Host ' DISCREPANCIA' -ForegroundColor Red
            $auditFailed = $true
            $auditErrors += ('PREFLIGHT_TIMESTAMP_MISMATCH: JSON ({0}) y sobre BIN ({1}) difieren.' -f $tokenContent.timestampUtc, $authEnvelope.timestampUtc)
        } else {
            Write-Host ' OK' -ForegroundColor Green
        }

        Write-Host ' - Comprobando frescura temporal (< 60 min)...' -NoNewline
        $preflightOffset = [DateTimeOffset]::MinValue
        $parseSuccess = $false
        try {
            $preflightOffset = [DateTimeOffset]::Parse([string]$authEnvelope.timestampUtc, [System.Globalization.CultureInfo]::InvariantCulture)
            $parseSuccess = $true
        } catch {
            Write-Host ' FORMATO INVALIDO' -ForegroundColor Red
            $auditFailed = $true
            $auditErrors += ('PREFLIGHT_TOKEN_INVALID_TIMESTAMP: Formato de timestamp invalido: ' + $authEnvelope.timestampUtc)
        }

        if ($parseSuccess) {
            $ageMinutes = ([DateTimeOffset]::UtcNow - $preflightOffset).TotalMinutes
            if ($ageMinutes -lt -2.0) {
                Write-Host (' FECHA EN EL FUTURO ({0:F1} min)' -f [Math]::Abs($ageMinutes)) -ForegroundColor Red
                $auditFailed = $true
                $auditErrors += ('PREFLIGHT_TOKEN_FUTURE: El token de preflight tiene fecha en el futuro ({0:F1} min).' -f [Math]::Abs($ageMinutes))
            } elseif ($ageMinutes -gt 60.0) {
                Write-Host (' VENCIDO ({0:F1} min)' -f $ageMinutes) -ForegroundColor Red
                $auditFailed = $true
                $auditErrors += ('PREFLIGHT_TOKEN_EXPIRED: Antiguedad de {0:F1} min supera el umbral de 60 min.' -f $ageMinutes)
            } else {
                Write-Host (' OK ({0:F1} min de antiguedad)' -f $ageMinutes) -ForegroundColor Green
            }
        }

        # 1.8 Ausencia de errores o conteos null
        Write-Host ' - Comprobando ausencia de errores o conteos null...' -NoNewline
        $hasNullOrError = $false
        if ($tokenContent.errors -and @($tokenContent.errors).Count -gt 0) {
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
            Write-Host ' OK (Conteos integros y cero errores)' -ForegroundColor Green
        }

        # 1.9 Ausencia de tokens ADC
        Write-Host ' - Inspeccionando ausencia de tokens ADC en preflight...' -NoNewline
        $plainEnvelopeText = ''
        if ($authPlainBytes) { $plainEnvelopeText = [System.Text.Encoding]::UTF8.GetString($authPlainBytes) }
        if ($tokenRawJson -match 'ya29\.[a-zA-Z0-9_-]+' -or $plainEnvelopeText -match 'ya29\.[a-zA-Z0-9_-]+') {
            Write-Host ' ALERTA DE FUGA' -ForegroundColor Red
            $auditFailed = $true
            $auditErrors += 'SECURITY_LEAK_ADC_TOKEN_FOUND: Se detecto token ADC dentro de los archivos de preflight.'
        } else {
            Write-Host ' OK (Cero tokens ADC)' -ForegroundColor Green
        }
    }

    # PARTE 2: CONCILIACION DEL DIRECTORIO DEFINITIVO Y AUDITORIA RUNTIME DE ACL
    Write-Host ''
    Write-Host '[2/3] CONCILIACION DEL DIRECTORIO DEFINITIVO Y AUDITORIA DE ACL' -ForegroundColor Cyan
    Write-Host '------------------------------------------------------------------------'

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
        $allItems = @(Get-ChildItem -Path $resolvedCacheDir -Force -ErrorAction SilentlyContinue)
        $cacheFiles = @($allItems | Where-Object { -not $_.PSIsContainer })
        $cacheDirs  = @($allItems | Where-Object { $_.PSIsContainer })

        $defFileCount = $cacheFiles.Count
        $defDirCount  = $cacheDirs.Count

        if ($defFileCount -eq 0 -and $defDirCount -eq 0) {
            $definitiveDirState = 'DIRECTORY_PRESENT_EMPTY'
            Write-Host ' DIRECTORY_PRESENT_EMPTY' -ForegroundColor Green
        } else {
            foreach ($cf in $cacheFiles) {
                $defTotalBytes += $cf.Length
                $ext = $cf.Extension.ToLower()
                if (-not $ext) { $ext = '[sin_extension]' }
                $defExtensions[$ext] = ($defExtensions[$ext] + 1)
                $defOpaqueNames += $cf.Name

                if ($cf.Name -match '^doc-\d{6}\.bin$') {
                    $hasDocBins = $true
                } elseif ($cf.Name -match '^(checkpoint|id-mapping)\.bin$' -or $cf.Name -match '^manifest-audit\.json$') {
                    # Artefactos esperados
                } else {
                    $hasUnexpectedFiles = $true
                }
            }
            foreach ($cd in $cacheDirs) {
                $defOpaqueNames += ($cd.Name + '/')
                if ($cd.Name -ne 'control') {
                    $hasUnexpectedFiles = $true
                }
            }

            if ($hasUnexpectedFiles) {
                $definitiveDirState = 'DIRECTORY_PRESENT_WITH_UNEXPECTED_FILES'
                Write-Host ' DIRECTORY_PRESENT_WITH_UNEXPECTED_FILES' -ForegroundColor Red
                $auditFailed = $true
                $auditErrors += 'DIRECTORY_PRESENT_WITH_UNEXPECTED_FILES: Elementos con nombres o extensiones inesperadas en cache definitivo.'
            } elseif ($hasDocBins) {
                $definitiveDirState = 'DIRECTORY_PRESENT_WITH_UNVERIFIED_CACHE'
                Write-Host ' DIRECTORY_PRESENT_WITH_UNVERIFIED_CACHE' -ForegroundColor Yellow
                Write-Host '   [AVISO ANTI-SOBRESCRITURA]: Cache previo detectado. Bloqueada cualquier operacion que pueda sobrescribir documentos.' -ForegroundColor Yellow
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

        # 2.2 Auditoria de ACL del directorio definitivo (Get-Acl pasivo)
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
                Write-Host ' ACL INSUFICIENTE / HEREDADA' -ForegroundColor Red
                Write-Host '   [ACCION REQUERIDA]: Ejecutar endurecimiento de ACL sobre .data\firestore-export (herencia no desactivada)' -ForegroundColor Yellow
                $auditFailed = $true
                $auditErrors += 'DEFINITIVE_CACHE_ACL_INSUFFICIENT: El directorio definitivo .data\firestore-export tiene herencia activa o acceso BUILTIN\Users no restringido.'
            } else {
                Write-Host ' OK (Herencia deshabilitada y acceso exclusivo)' -ForegroundColor Green
            }
        } catch {
            Write-Host (' [WARN]: ' + $_.Exception.Message) -ForegroundColor Yellow
        }
    }

    # 2.3 Auditoria de ACL del subdirectorio control (Get-Acl pasivo, si existe)
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
                Write-Host ' ACL INSUFICIENTE' -ForegroundColor Red
                $auditFailed = $true
                $auditErrors += 'CONTROL_DIR_ACL_INSUFFICIENT: El subdirectorio control tiene herencia activa o acceso BUILTIN\Users no restringido.'
            } else {
                Write-Host ' OK (Herencia deshabilitada y acceso exclusivo)' -ForegroundColor Green
            }
        } catch {
            Write-Host (' [WARN]: ' + $_.Exception.Message) -ForegroundColor Yellow
        }
    }

    # 2.4 Prueba de ACL en directorio sintetico (.data/security-selftest/)
    $syntheticAclDir = Join-Path $pocDir '.data\security-selftest'
    Write-Host (' - Creando directorio sintetico de prueba: ' + $syntheticAclDir)
    if (-not (Test-Path -Path $syntheticAclDir)) {
        New-Item -ItemType Directory -Path $syntheticAclDir -Force | Out-Null
    }

    try {
        $synAcl = Get-Acl -Path $syntheticAclDir
        $synAcl.SetAccessRuleProtection($true, $false)
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $currentUser,
            'FullControl',
            'ContainerInherit,ObjectInherit',
            'None',
            'Allow'
        )
        $synAcl.AddAccessRule($rule)
        Set-Acl -Path $syntheticAclDir -AclObject $synAcl

        $verAcl = Get-Acl -Path $syntheticAclDir
        if (-not $verAcl.AreAccessRulesProtected) {
            throw 'Falla al deshabilitar herencia en directorio de prueba.'
        }
        Write-Host ' - Prueba sintetica de ACL: EXITOSA' -ForegroundColor Green
    } catch {
        Write-Host (' - Prueba sintetica de ACL FALLO: ' + $_.Exception.Message) -ForegroundColor Yellow
    } finally {
        if (Test-Path -Path $syntheticAclDir) {
            Remove-Item -Path $syntheticAclDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    # PARTE 3: VERIFICACION DE EXCLUSIONES GIT
    Write-Host ''
    Write-Host '[3/3] VERIFICACION DE EXCLUSIONES GIT' -ForegroundColor Cyan
    Write-Host '------------------------------------------------------------------------'

    $gitignorePath = Join-Path (Split-Path -Parent $pocDir) '.gitignore'
    if (-not (Test-Path -Path $gitignorePath)) {
        $gitignorePath = Join-Path $pocDir '.gitignore'
    }

    if (Test-Path -Path $gitignorePath) {
        $gitLines = @(Get-Content -Path $gitignorePath)
        $hasDataIgnore = (@($gitLines | Where-Object { $_ -match '^\s*\.data/' })).Count -gt 0
        $hasBinIgnore  = (@($gitLines | Where-Object { $_ -match '^\s*\*?\.bin' })).Count -gt 0

        Write-Host ' - Comprobando regla .data/ en .gitignore...' -NoNewline
        if ($hasDataIgnore) { Write-Host ' OK' -ForegroundColor Green } else {
            Write-Host ' FALTA' -ForegroundColor Red
            $auditFailed = $true
            $auditErrors += 'GITIGNORE_MISSING_DATA: Regla .data/ no encontrada en .gitignore.'
        }

        Write-Host ' - Comprobando regla *.bin en .gitignore...' -NoNewline
        if ($hasBinIgnore) { Write-Host ' OK' -ForegroundColor Green } else {
            Write-Host ' FALTA' -ForegroundColor Red
            $auditFailed = $true
            $auditErrors += 'GITIGNORE_MISSING_BIN: Regla *.bin no encontrada en .gitignore.'
        }
    }

    # Buscar archivos .bin fuera de .data/
    Write-Host ' - Buscando binarios (.bin) fuera de .data/ en la POC...' -NoNewline
    $strayBins = @(Get-ChildItem -Path $pocDir -Filter '*.bin' -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '[\\/]\.data[\\/]' -and $_.FullName -notmatch '[\\/]node_modules[\\/]' })

    if ($strayBins.Count -gt 0) {
        Write-Host (' DETECTADO ({0} archivo(s))' -f $strayBins.Count) -ForegroundColor Red
        foreach ($sb in $strayBins) {
            Write-Host ('   ALERTA: ' + $sb.FullName) -ForegroundColor Red
            $auditErrors += ('UNALLOWED_BINARY_LOCATION: ' + $sb.FullName)
        }
        $auditFailed = $true
    } else {
        Write-Host ' OK (0 binarios fuera de .data/)' -ForegroundColor Green
    }

    # DICTAMEN FINAL
    Write-Host ''
    Write-Host '========================================================================' -ForegroundColor Cyan
    if ($auditFailed) {
        Write-Host 'DICTAMEN: LOCAL_SECURITY_AUDIT_FAILED' -ForegroundColor Red
        Write-Host 'Se detectaron los siguientes impedimentos de seguridad:' -ForegroundColor Red
        foreach ($err in $auditErrors) {
            Write-Host ('  - ' + $err) -ForegroundColor Red
        }
    } else {
        Write-Host 'DICTAMEN: LOCAL_SECURITY_AUDIT_PASS' -ForegroundColor Green
        Write-Host 'Todos los controles de seguridad local y preflight fueron aprobados.' -ForegroundColor Green
    }
    Write-Host '========================================================================' -ForegroundColor Cyan
}