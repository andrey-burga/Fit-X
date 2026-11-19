<#
.SYNOPSIS
    VigorCore Phase 5.1.2 - Assisted Strictly Read-Only Zoho Catalyst & DNS Inventory (Windows PowerShell 5.1)

.DESCRIPTION
    Strictly read-only diagnostic script for Windows PowerShell 5.1 and Node.js v24.16.0+.
    NEVER installs packages, NEVER modifies Catalyst config, NEVER switches active project,
    NEVER reads or prints tokens/secrets, NEVER provisions tables, and NEVER touches DNS.

    Allowed Catalyst CLI commands (explicit allowlist enforced via literal switch):
      - --version
      - whoami
      - project:list

    Explicitly blocked commands include (without limitation):
      config:list, config:get, pull, deploy, apig:enable, apig:disable,
      ds:import, project:use, project:reset, org:list, init, serve, login

.PARAMETER ExpectedProjectId
    Optional expected Catalyst Project ID to check unambiguously against `catalyst project:list`.

.PARAMETER ExpectedProjectName
    Optional expected Catalyst Project Name to check against `catalyst project:list`.

.PARAMETER OutputDirectory
    Local directory where sanitized reports will be saved (defaults to ..\reports relative to this script).
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$ExpectedProjectId = '',

    [Parameter(Mandatory = $false)]
    [string]$ExpectedProjectName = '',

    [Parameter(Mandatory = $false)]
    [string]$OutputDirectory = ''
)

$ErrorActionPreference = 'Continue'

# Explicit allowlist of read-only Catalyst CLI subcommands
$script:AllowedCatalystCommands = @('--version', 'whoami', 'project:list')

# Explicitly forbidden commands (defense in depth alongside strict allowlist)
$script:ForbiddenCatalystCommands = @(
    'config:list',
    'config:get',
    'pull',
    'deploy',
    'apig:enable',
    'apig:disable',
    'ds:import',
    'project:use',
    'project:reset',
    'org:list',
    'init',
    'serve',
    'login',
    'logout',
    'token:generate',
    'functions:shell',
    'functions:setup'
)

function Protect-SensitiveText {
    param(
        [Parameter(Mandatory = $false)]
        [AllowEmptyString()]
        [string]$Text = ''
    )

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return ''
    }

    $sanitized = $Text
    # Strip ANSI/VT terminal escape sequences emitted by CLI formatters
    $sanitized = [regex]::Replace($sanitized, '\x1B\[[0-9;?]*[ -/]*[@-~]', '')
    # Redact Bearer / Zoho-oauthtoken / OAuth token strings
    $sanitized = [regex]::Replace($sanitized, '(?i)(Bearer|Zoho-oauthtoken)\s+[A-Za-z0-9\-._~+/=]+', '$1 [REDACTED]')
    # Redact key=value / key: value secrets and auth metadata
    $sanitized = [regex]::Replace($sanitized, '(?i)(token|secret|password|passwd|private_key|refresh_token|access_token|client_secret|project_key|cookie|authorization|zuid|user_id)\s*[:=]\s*["'']?[^\s"''`,;]+["'']?', '$1=[REDACTED]')
    # Redact Zoho 1000.xxx token shapes if present
    $sanitized = [regex]::Replace($sanitized, '\b1000\.[A-Za-z0-9_.\-]{8,}\b', '[REDACTED_ZOHO_TOKEN]')
    # Mask email local parts to avoid unnecessary PII exposure while preserving domain context
    $sanitized = [regex]::Replace($sanitized, '([A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]*(@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})', '$1***$2')

    return $sanitized.Trim()
}

function Get-RedactedWhoamiSummary {
    param(
        [Parameter(Mandatory = $false)]
        [string[]]$CleanLines = @()
    )

    if ($null -eq $CleanLines -or $CleanLines.Count -eq 0) {
        return 'Authenticated CLI session active (no output details).'
    }

    $summaryParts = @()
    foreach ($ln in $CleanLines) {
        if ($ln -match '([A-Za-z0-9._%+\-*]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})') {
            $summaryParts += ('account={0}' -f $Matches[1])
        }
        elseif ($ln -match '(?i)\b(dc|region|environment|org)\b') {
            $summaryParts += $ln
        }
    }

    if ($summaryParts.Count -eq 0) {
        return 'Authenticated CLI session active (personal identity fields omitted).'
    }

    return (($summaryParts | Select-Object -Unique) -join '; ')
}

function Write-Utf8NoBomFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter(Mandatory = $true)]
        [string]$Content
    )

    $resolvedPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($FilePath)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($resolvedPath, $Content, $utf8NoBom)
}

function Test-CatalystCommandAllowed {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SubCommand
    )

    $normalized = $SubCommand.Trim()
    if ([string]::IsNullOrWhiteSpace($normalized)) {
        return $false
    }

    # Reject shell chaining, pipes, or whitespace-separated extra commands
    if ($normalized -match '[;&|`$><\r\n\s]') {
        return $false
    }

    if ($script:ForbiddenCatalystCommands -contains $normalized.ToLowerInvariant()) {
        return $false
    }

    return ($script:AllowedCatalystCommands -contains $normalized)
}

function Invoke-AllowedCatalystCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SubCommand,

        [Parameter(Mandatory = $true)]
        [string]$CatalystExecutablePath
    )

    if (-not (Test-CatalystCommandAllowed -SubCommand $SubCommand)) {
        throw ("ALLOWED_READONLY_COMMAND_VIOLATION: Command '{0}' is outside the Phase 5.1.2 strict read-only allowlist ({1})." -f $SubCommand, ($script:AllowedCatalystCommands -join ', '))
    }

    $outputLines = @()
    $exitCode = 1
    $cmdOk = $false
    $global:LASTEXITCODE = 0

    try {
        # Literal switch prevents arbitrary argument construction or dynamic evaluation
        switch ($SubCommand) {
            '--version' {
                $outputLines = & $CatalystExecutablePath '--version' 2>&1
                $cmdOk = $?
                $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } elseif ($cmdOk) { 0 } else { 1 }
            }
            'whoami' {
                $outputLines = & $CatalystExecutablePath 'whoami' 2>&1
                $cmdOk = $?
                $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } elseif ($cmdOk) { 0 } else { 1 }
            }
            'project:list' {
                $outputLines = & $CatalystExecutablePath 'project:list' 2>&1
                $cmdOk = $?
                $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } elseif ($cmdOk) { 0 } else { 1 }
            }
            default {
                throw ("ALLOWED_READONLY_COMMAND_VIOLATION: Unhandled subcommand '{0}'." -f $SubCommand)
            }
        }
    }
    catch {
        $errMsg = Protect-SensitiveText -Text $_.Exception.Message
        return [ordered]@{
            command   = ('catalyst {0}' -f $SubCommand)
            exitCode  = 1
            succeeded = $false
            rawLines  = @()
            output    = $errMsg
        }
    }

    $cleanLines = @()
    foreach ($line in $outputLines) {
        $rawText = if ($line -is [System.Management.Automation.ErrorRecord]) {
            [string]$line.Exception.Message
        }
        else {
            [string]$line
        }
        $asText = Protect-SensitiveText -Text $rawText
        if (-not [string]::IsNullOrWhiteSpace($asText)) {
            $cleanLines += $asText
        }
    }

    return [ordered]@{
        command   = ('catalyst {0}' -f $SubCommand)
        exitCode  = $exitCode
        succeeded = ($exitCode -eq 0)
        rawLines  = $cleanLines
        output    = ($cleanLines -join "`n")
    }
}

function Get-ReadOnlyDnsCnameStatus {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Hostname
    )

    $nowUtc = (Get-Date).ToUniversalTime().ToString('o')
    $resolveCmd = Get-Command Resolve-DnsName -ErrorAction SilentlyContinue
    if ($null -eq $resolveCmd) {
        return [ordered]@{
            hostname             = $Hostname
            source               = 'PowerShell Resolve-DnsName'
            timestampUtc         = $nowUtc
            status               = 'NOT_ACCESSIBLE'
            nonSensitiveEvidence = 'Resolve-DnsName cmdlet is unavailable in this PowerShell session.'
            limitations          = 'DNS module (DnsClient) not available on host.'
            pendingAction        = ('Run nslookup -type=CNAME {0} manually (read-only).' -f $Hostname)
            cnameTargets         = @()
        }
    }

    try {
        $cnameRecords = @(Resolve-DnsName -Name $Hostname -Type CNAME -DnsOnly -ErrorAction Stop | Where-Object { $_.QueryType -eq 'CNAME' -or $_.Type -eq 'CNAME' })
        if ($cnameRecords.Count -gt 0) {
            $targets = @()
            foreach ($rec in $cnameRecords) {
                if ($rec.NameHost) {
                    $targets += [string]$rec.NameHost
                }
            }
            $uniqueTargets = @($targets | Select-Object -Unique)
            if ($uniqueTargets.Count -eq 1) {
                return [ordered]@{
                    hostname             = $Hostname
                    source               = 'PowerShell Resolve-DnsName -Type CNAME -DnsOnly'
                    timestampUtc         = $nowUtc
                    status               = 'VERIFIED_REMOTE'
                    nonSensitiveEvidence = ('CNAME resolved -> {0}' -f ($uniqueTargets -join ', '))
                    limitations          = 'Public DNS lookup only; Catalyst Console Domain Mapping SSL/activation still requires visual Console verification.'
                    pendingAction        = 'Confirm matching Domain Mapping status in Catalyst Console -> Cloud Scale -> Domain Mapping (docs/26 Seccion 4.G).'
                    cnameTargets         = $uniqueTargets
                }
            }
            return [ordered]@{
                hostname             = $Hostname
                source               = 'PowerShell Resolve-DnsName -Type CNAME -DnsOnly'
                timestampUtc         = $nowUtc
                status               = 'AMBIGUOUS'
                nonSensitiveEvidence = ('Multiple CNAME targets returned: {0}' -f ($uniqueTargets -join ', '))
                limitations          = 'Public DNS returned non-unique CNAME set.'
                pendingAction        = ('Inspect authoritative DNS zone for {0} (read-only).' -f $Hostname)
                cnameTargets         = $uniqueTargets
            }
        }

        # Check whether any non-CNAME record exists to avoid misclassifying CNAME vs A/AAAA ambiguity
        $anyRecords = @(Resolve-DnsName -Name $Hostname -Type A_AAAA -DnsOnly -ErrorAction SilentlyContinue)
        if ($anyRecords.Count -gt 0) {
            $types = @($anyRecords | ForEach-Object { [string]$_.QueryType } | Select-Object -Unique)
            return [ordered]@{
                hostname             = $Hostname
                source               = 'PowerShell Resolve-DnsName -Type A_AAAA -DnsOnly'
                timestampUtc         = $nowUtc
                status               = 'AMBIGUOUS'
                nonSensitiveEvidence = ('No CNAME record found, but non-CNAME DNS records exist ({0}).' -f ($types -join ', '))
                limitations          = 'Host resolves without a CNAME record.'
                pendingAction        = ('Inspect DNS records for {0} in DNS provider (read-only).' -f $Hostname)
                cnameTargets         = @()
            }
        }

        return [ordered]@{
            hostname             = $Hostname
            source               = 'PowerShell Resolve-DnsName -Type CNAME -DnsOnly'
            timestampUtc         = $nowUtc
            status               = 'NOT_CONFIGURED'
            nonSensitiveEvidence = ('No CNAME or A/AAAA records returned for {0}.' -f $Hostname)
            limitations          = 'Checked against configured recursive resolver only.'
            pendingAction        = 'Leave unchanged during Phase 5.1.2; CNAME creation is deferred to Phase 5.3+ after API Gateway + Domain Mapping readiness.'
            cnameTargets         = @()
        }
    }
    catch {
        $errText = Protect-SensitiveText -Text $_.Exception.Message
        if ($errText -match '(?i)(does not exist|DNS name does not exist|NXDOMAIN|no records|DNS_ERROR_NAME_DOES_NOT_EXIST|DNS_INFO_NO_RECORDS)') {
            return [ordered]@{
                hostname             = $Hostname
                source               = 'PowerShell Resolve-DnsName -Type CNAME -DnsOnly'
                timestampUtc         = $nowUtc
                status               = 'NOT_CONFIGURED'
                nonSensitiveEvidence = ('DNS lookup confirmed record does not exist (NXDOMAIN / no DNS record) for {0}.' -f $Hostname)
                limitations          = 'Read-only DNS resolution from local station.'
                pendingAction        = 'Expected pre-cutover state for api.vigorcore.lat; do NOT create DNS during Phase 5.1.2.'
                cnameTargets         = @()
            }
        }

        return [ordered]@{
            hostname             = $Hostname
            source               = 'PowerShell Resolve-DnsName -Type CNAME -DnsOnly'
            timestampUtc         = $nowUtc
            status               = 'NOT_ACCESSIBLE'
            nonSensitiveEvidence = ('DNS resolution error for {0}: {1}' -f $Hostname, $errText)
            limitations          = 'Local DNS resolver/network failed to answer query.'
            pendingAction        = ('Retry read-only DNS lookup when network/DNS access is available for {0}.' -f $Hostname)
            cnameTargets         = @()
        }
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pocRoot = Split-Path -Parent $scriptDir
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $pocRoot 'reports'
}

if (-not (Test-Path -LiteralPath $OutputDirectory)) {
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
}

$runTimestampUtc = (Get-Date).ToUniversalTime().ToString('o')
$psVersionString = $PSVersionTable.PSVersion.ToString()
$psEditionString = if ($PSVersionTable.PSEdition) { [string]$PSVersionTable.PSEdition } else { 'Desktop' }

# 1. Node.js check (read-only)
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodeVersion = 'NOT_FOUND'
if ($null -ne $nodeCmd) {
    try {
        $global:LASTEXITCODE = 0
        $nodeOut = & $nodeCmd.Source --version 2>$null
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace([string]$nodeOut)) {
            $nodeVersion = ([string]$nodeOut).Trim()
        }
    }
    catch {
        $nodeVersion = 'ERROR_CHECKING_VERSION'
    }
}

Write-Host '====================================================================' -ForegroundColor Cyan
Write-Host ' VIGORCORE - FASE 5.1.2: INVENTARIO REMOTO ASISTIDO (SOLO LECTURA)' -ForegroundColor Cyan
Write-Host '====================================================================' -ForegroundColor Cyan
Write-Host ('PowerShell : {0} ({1})' -f $psVersionString, $psEditionString)
Write-Host ('Node.js    : {0}' -f $nodeVersion)
Write-Host ('POC Root   : {0}' -f $pocRoot)
Write-Host ('Timestamp  : {0}' -f $runTimestampUtc)
Write-Host ''

$matrixRows = @()

# Local runtime row
$matrixRows += [ordered]@{
    resourceId            = 'LOCAL-STATION-RUNTIME'
    category              = 'LOCAL_TOOLING'
    resource              = 'Windows PowerShell & Node.js runtime'
    source                = '$PSVersionTable + node --version'
    timestampUtc          = $runTimestampUtc
    status                = 'VERIFIED_LOCAL_ONLY'
    nonSensitiveEvidence  = ('PowerShell={0} ({1}); Node={2}' -f $psVersionString, $psEditionString, $nodeVersion)
    limitations           = 'Local workstation metadata only; proves nothing about remote Catalyst project.'
    pendingReadOnlyAction = 'None.'
}

# 2. Detect Catalyst CLI non-destructively (DO NOT install if absent)
$catalystCmd = Get-Command catalyst -ErrorAction SilentlyContinue
$cliAvailable = ($null -ne $catalystCmd)
$cliVersion = $null
$cliAuthStatus = 'NOT_ACCESSIBLE'
$cliIdentitySummary = $null
$projectListCount = $null
$projectMatchStatus = 'NOT_ACCESSIBLE'
$projectMatchEvidence = ''
$projectCandidateLabels = @()
$cliErrors = @()

if (-not $cliAvailable) {
    $msg = 'Catalyst CLI not detected on PATH. Per Phase 5.1.2 rules, CLI is NOT installed automatically. Proceed with Catalyst Console manual read-only checklist (docs/26-phase-5.1.2-readonly-remote-inventory.md).'
    Write-Warning $msg

    $matrixRows += [ordered]@{
        resourceId            = 'CLI-AVAILABILITY'
        category              = 'CATALYST_CLI'
        resource              = 'Zoho Catalyst CLI binary (catalyst)'
        source                = 'Get-Command catalyst -ErrorAction SilentlyContinue'
        timestampUtc          = $runTimestampUtc
        status                = 'NOT_ACCESSIBLE'
        nonSensitiveEvidence  = 'catalyst binary not present on PATH.'
        limitations           = 'Cannot query Catalyst CLI identity or project:list from this shell.'
        pendingReadOnlyAction = 'Complete remote inventory via Catalyst Console read-only checklist in docs/26-phase-5.1.2-readonly-remote-inventory.md Secciones 4.A-4.G.'
    }
}
else {
    Write-Host ('Catalyst CLI detected at: {0}' -f $catalystCmd.Source) -ForegroundColor Green

    # 2a. catalyst --version
    $verResult = Invoke-AllowedCatalystCommand -SubCommand '--version' -CatalystExecutablePath $catalystCmd.Source
    if ($verResult.succeeded) {
        $cliVersion = $verResult.output
        $matrixRows += [ordered]@{
            resourceId            = 'CLI-VERSION'
            category              = 'CATALYST_CLI'
            resource              = 'Zoho Catalyst CLI version'
            source                = 'catalyst --version'
            timestampUtc          = (Get-Date).ToUniversalTime().ToString('o')
            status                = 'VERIFIED_LOCAL_ONLY'
            nonSensitiveEvidence  = $cliVersion
            limitations           = 'Local CLI binary check only.'
            pendingReadOnlyAction = 'None.'
        }
    }
    else {
        $cliErrors += $verResult.output
    }

    # 2b. catalyst whoami (minimal identity check only, personal fields & tokens scrubbed)
    $whoamiResult = Invoke-AllowedCatalystCommand -SubCommand 'whoami' -CatalystExecutablePath $catalystCmd.Source
    $whoamiTime = (Get-Date).ToUniversalTime().ToString('o')

    if ($whoamiResult.succeeded -and ($whoamiResult.output -notmatch '(?i)(not logged in|please login|unauthorized|authentication failed|error)')) {
        $cliAuthStatus = 'VERIFIED_REMOTE'
        $cliIdentitySummary = Get-RedactedWhoamiSummary -CleanLines $whoamiResult.rawLines
        $matrixRows += [ordered]@{
            resourceId            = 'CLI-AUTH-IDENTITY'
            category              = 'CATALYST_AUTH_SESSION'
            resource              = 'Catalyst CLI authenticated session (whoami)'
            source                = 'catalyst whoami'
            timestampUtc          = $whoamiTime
            status                = 'VERIFIED_REMOTE'
            nonSensitiveEvidence  = $cliIdentitySummary
            limitations           = 'Personal identity details minimized/masked; tokens and credentials never read.'
            pendingReadOnlyAction = 'None.'
        }

        # 2c. catalyst project:list (strictly read-only; never project:use or project:reset)
        $projResult = Invoke-AllowedCatalystCommand -SubCommand 'project:list' -CatalystExecutablePath $catalystCmd.Source
        $projTime = (Get-Date).ToUniversalTime().ToString('o')

        if ($projResult.succeeded) {
            $candidateLines = @()
            foreach ($ln in $projResult.rawLines) {
                # Skip ASCII and Unicode box-drawing borders and table headers
                if ($ln -match '^[\+\-\|=\s\u2500-\u257F]+$') { continue }
                $trimmedCellText = ($ln -replace '[\|\u2502]', ' ').Trim()
                if ([string]::IsNullOrWhiteSpace($trimmedCellText)) { continue }
                if ($trimmedCellText -match '(?i)^(Project\s+ID|Project\s+Name|S\.No|No\.|#)\b') { continue }
                if ($trimmedCellText -match '(?i)^(Showing|Total|Available)\b') { continue }
                $candidateLines += $trimmedCellText
            }

            $projectListCount = $candidateLines.Count
            $matchedLines = @()
            foreach ($ln in $candidateLines) {
                $matchedId = (-not [string]::IsNullOrWhiteSpace($ExpectedProjectId)) -and ($ln -match [regex]::Escape($ExpectedProjectId))
                $matchedName = (-not [string]::IsNullOrWhiteSpace($ExpectedProjectName)) -and ($ln -match [regex]::Escape($ExpectedProjectName))
                if ($matchedId -or $matchedName) {
                    $matchedLines += $ln
                }
            }

            if ($projectListCount -eq 0) {
                $projectMatchStatus = 'NOT_ACCESSIBLE'
                $projectMatchEvidence = 'catalyst project:list returned 0 project entries for active account/DC.'
            }
            elseif ((-not [string]::IsNullOrWhiteSpace($ExpectedProjectId)) -or (-not [string]::IsNullOrWhiteSpace($ExpectedProjectName))) {
                if ($matchedLines.Count -eq 1) {
                    $projectMatchStatus = 'VERIFIED_REMOTE'
                    $projectMatchEvidence = ('Unique target project matched in project:list ({0} total accessible project row(s)): {1}' -f $projectListCount, $matchedLines[0])
                    $projectCandidateLabels = @($matchedLines[0])
                }
                elseif ($matchedLines.Count -gt 1) {
                    $projectMatchStatus = 'AMBIGUOUS'
                    $projectMatchEvidence = ('Multiple rows ({0}) matched target criteria inside {1} accessible project row(s). Target remains AMBIGUOUS.' -f $matchedLines.Count, $projectListCount)
                    $projectCandidateLabels = $matchedLines
                }
                else {
                    $projectMatchStatus = 'NOT_ACCESSIBLE'
                    $projectMatchEvidence = ('Target project filter did not match any of the {0} accessible project row(s); wrong DC, wrong account, or project not accessible.' -f $projectListCount)
                }
            }
            else {
                # Per strict Phase 5.1.2 rule: never auto-assume project without unambiguous target ID
                $projectMatchStatus = 'AMBIGUOUS'
                $projectMatchEvidence = ('Listed {0} accessible project row(s); left as AMBIGUOUS until operator confirms target project in Catalyst Console (no project:use executed and no other-account details dumped).' -f $projectListCount)
                # Keep only sanitized project row summaries without dumping unnecessary unrelated account metadata
                $idx = 0
                foreach ($rowText in $candidateLines) {
                    $idx++
                    $normalizedRow = ($rowText -replace '\s{2,}', ' | ')
                    $projectCandidateLabels += ('Row#{0}: {1}' -f $idx, $normalizedRow)
                }
            }

            $matrixRows += [ordered]@{
                resourceId            = 'CLI-PROJECT-LIST'
                category              = 'PROJECT_DISCOVERY'
                resource              = 'Accessible Zoho Catalyst projects (catalyst project:list)'
                source                = 'catalyst project:list'
                timestampUtc          = $projTime
                status                = $projectMatchStatus
                nonSensitiveEvidence  = $projectMatchEvidence
                limitations           = 'CLI project:list does NOT list NoSQL tables, GSIs, Security Rules, API Gateway routes, Auth users, or Domain Mappings.'
                pendingReadOnlyAction = 'Identify unambiguous VigorCore project and inspect Secciones 4.A-4.G in Catalyst Console.'
            }
        }
        else {
            $cliErrors += $projResult.output
            $matrixRows += [ordered]@{
                resourceId            = 'CLI-PROJECT-LIST'
                category              = 'PROJECT_DISCOVERY'
                resource              = 'Accessible Zoho Catalyst projects (catalyst project:list)'
                source                = 'catalyst project:list'
                timestampUtc          = $projTime
                status                = 'NOT_ACCESSIBLE'
                nonSensitiveEvidence  = ('catalyst project:list exited with code {0}: {1}' -f $projResult.exitCode, $projResult.output)
                limitations           = 'Error reported without attempting repair or changing CLI config.'
                pendingReadOnlyAction = 'Verify DC/session visually in Catalyst Console (docs/26 Seccion 4.A).'
            }
        }
    }
    else {
        $cliAuthStatus = 'NOT_ACCESSIBLE'
        $cliErrors += $whoamiResult.output
        Write-Warning 'Catalyst CLI is installed but not authenticated. Stopping CLI queries per Phase 5.1.2 (no login or config changes performed). Use Catalyst Console checklist in docs/26.'

        $matrixRows += [ordered]@{
            resourceId            = 'CLI-AUTH-IDENTITY'
            category              = 'CATALYST_AUTH_SESSION'
            resource              = 'Catalyst CLI authenticated session (whoami)'
            source                = 'catalyst whoami'
            timestampUtc          = $whoamiTime
            status                = 'NOT_ACCESSIBLE'
            nonSensitiveEvidence  = ('CLI session unauthenticated or errored (code {0}): {1}' -f $whoamiResult.exitCode, $whoamiResult.output)
            limitations           = 'Stopped CLI remote portion without modifying credentials or prompting for tokens.'
            pendingReadOnlyAction = 'Complete remote inventory via Catalyst Console manual read-only checklist (docs/26 Secciones 4.A-4.G).'
        }
    }
}

# 3. Read-only DNS CNAME Verification (api.vigorcore.lat + app.vigorcore.lat)
Write-Host 'Running read-only DNS CNAME checks...' -ForegroundColor Cyan
$dnsApi = Get-ReadOnlyDnsCnameStatus -Hostname 'api.vigorcore.lat'
$dnsApp = Get-ReadOnlyDnsCnameStatus -Hostname 'app.vigorcore.lat'

$matrixRows += [ordered]@{
    resourceId            = 'DNS-CNAME-API'
    category              = 'DNS_READONLY'
    resource              = 'DNS CNAME for api.vigorcore.lat'
    source                = $dnsApi.source
    timestampUtc          = $dnsApi.timestampUtc
    status                = $dnsApi.status
    nonSensitiveEvidence  = $dnsApi.nonSensitiveEvidence
    limitations           = $dnsApi.limitations
    pendingReadOnlyAction = $dnsApi.pendingAction
}

$matrixRows += [ordered]@{
    resourceId            = 'DNS-CNAME-APP'
    category              = 'DNS_READONLY'
    resource              = 'DNS CNAME for app.vigorcore.lat (Slate intact verification)'
    source                = $dnsApp.source
    timestampUtc          = $dnsApp.timestampUtc
    status                = $dnsApp.status
    nonSensitiveEvidence  = $dnsApp.nonSensitiveEvidence
    limitations           = $dnsApp.limitations
    pendingReadOnlyAction = $dnsApp.pendingAction
}

# 4. Placeholder rows for mandatory Catalyst Console manual inspection items (Section 4.A-4.G in docs/26)
$consolePendingItems = @(
    @{ id = 'CONSOLE-A-PROJECT-ORG'; res = 'Proyecto, ID, Organización, Región/DC y entornos (Production + otros)'; ref = 'docs/26 Seccion 4.A' },
    @{ id = 'CONSOLE-B-APPS-FUNCTIONS'; res = 'Slate existente y funciones Basic I/O, Advanced I/O u otras'; ref = 'docs/26 Seccion 4.B' },
    @{ id = 'CONSOLE-C-API-GATEWAY'; res = 'Estado de API Gateway, rutas y configuraciones existentes'; ref = 'docs/26 Seccion 4.C' },
    @{ id = 'CONSOLE-D-SECURITY-RULES'; res = 'Project Security Rules actuales y export/snapshot JSON de solo lectura'; ref = 'docs/26 Seccion 4.D' },
    @{ id = 'CONSOLE-E-NOSQL-TABLES'; res = 'Tablas NoSQL existentes, GSIs, TTL y deteccion de colisiones con las 5 tablas'; ref = 'docs/26 Seccion 4.E' },
    @{ id = 'CONSOLE-F-AUTHENTICATION'; res = 'Catalyst Authentication: usuarios existentes (conteo=0), plantillas reset y dominios'; ref = 'docs/26 Seccion 4.F' },
    @{ id = 'CONSOLE-G-DOMAINS-CORS'; res = 'Domain Mapping (api.vigorcore.lat), certificado SSL, Authorized Domains y app.vigorcore.lat intacto'; ref = 'docs/26 Seccion 4.G' }
)

foreach ($item in $consolePendingItems) {
    $matrixRows += [ordered]@{
        resourceId            = $item.id
        category              = 'CATALYST_CONSOLE_READONLY'
        resource              = $item.res
        source                = 'Catalyst Console (Manual Read-Only Inspection)'
        timestampUtc          = $runTimestampUtc
        status                = 'PENDING_OPERATOR'
        nonSensitiveEvidence  = 'Not yet recorded from Catalyst Console.'
        limitations           = 'Catalyst CLI does not expose full NoSQL/SecurityRules/Auth/DomainMapping inspection without mutating project state.'
        pendingReadOnlyAction = ('Inspect visually in Catalyst Console following {0} (zero edits, zero secrets logged).' -f $item.ref)
    }
}

$reportObject = [ordered]@{
    phase                   = '5.1.2-addendum'
    mode                    = 'ASSISTED_READONLY_INVENTORY'
    writeOperationsExecuted = 0
    secretsExposed          = 0
    generatedAtUtc          = $runTimestampUtc
    workstation             = [ordered]@{
        powershellVersion = $psVersionString
        powershellEdition = $psEditionString
        nodeVersion       = $nodeVersion
    }
    catalystCli             = [ordered]@{
        available             = $cliAvailable
        version               = $cliVersion
        allowlistEnforced     = $script:AllowedCatalystCommands
        authStatus            = $cliAuthStatus
        redactedIdentity      = $cliIdentitySummary
        accessibleProjectRows = $projectListCount
        projectListRows       = $projectCandidateLabels
        targetMatchStatus     = $projectMatchStatus
        targetMatchEvidence   = $projectMatchEvidence
        errors                = $cliErrors
    }
    dnsChecks               = [ordered]@{
        apiVigorcoreLat = $dnsApi
        appVigorcoreLat = $dnsApp
    }
    matrix                  = $matrixRows
    honestVerdict           = 'PREPARATION_PARTIAL'
    nextActionForOperator   = 'Complete Secciones 4.A-4.G in Catalyst Console per docs/26-phase-5.1.2-readonly-remote-inventory.md, attach sanitized Security Rules JSON metadata, and reconcile collisions before requesting Phase 5.2 authorization.'
}

$jsonPath = Join-Path $OutputDirectory 'phase-5.1.2-readonly-inventory-report.json'
$mdPath = Join-Path $OutputDirectory 'phase-5.1.2-readonly-inventory-summary.md'

Write-Utf8NoBomFile -FilePath $jsonPath -Content ($reportObject | ConvertTo-Json -Depth 8)

$mdLines = @()
$mdLines += '# VIGORCORE - REPORTE LOCAL DE INVENTARIO READ-ONLY (FASE 5.1.2)'
$mdLines += ''
$mdLines += ('- **Generado (UTC):** {0}' -f $runTimestampUtc)
$mdLines += ('- **PowerShell:** {0} ({1})' -f $psVersionString, $psEditionString)
$mdLines += ('- **Node.js:** {0}' -f $nodeVersion)
$mdLines += ('- **Catalyst CLI disponible:** {0}' -f $cliAvailable)
$mdLines += ('- **Estado auth CLI:** {0}' -f $cliAuthStatus)
$mdLines += ('- **Identificacion proyecto objetivo:** {0}' -f $projectMatchStatus)
$mdLines += '- **Operaciones de escritura ejecutadas:** 0'
$mdLines += '- **Secretos leidos o impresos:** 0'
$mdLines += ''
$mdLines += '| ID | Recurso | Fuente | Estado | Evidencia no sensible | Accion pendiente |'
$mdLines += '| --- | --- | --- | --- | --- | --- |'
foreach ($row in $matrixRows) {
    $ev = ([string]$row.nonSensitiveEvidence) -replace '\|', '/' -replace "`r?`n", ' '
    $pa = ([string]$row.pendingReadOnlyAction) -replace '\|', '/' -replace "`r?`n", ' '
    $mdLines += ('| {0} | {1} | {2} | `{3}` | {4} | {5} |' -f $row.resourceId, $row.resource, $row.source, $row.status, $ev, $pa)
}
$mdLines += ''
$mdLines += '## Siguiente paso obligatorio'
$mdLines += 'Completar las Secciones 4.A - 4.G en Catalyst Console (`docs/26-phase-5.1.2-readonly-remote-inventory.md`) sin modificar recursos ni registrar secretos.'

Write-Utf8NoBomFile -FilePath $mdPath -Content ($mdLines -join "`r`n")

Write-Host ''
Write-Host '=== RESUMEN DE INVENTARIO READ-ONLY ===' -ForegroundColor Yellow
foreach ($row in $matrixRows) {
    Write-Host ('[{0}] {1} -> {2}' -f $row.status, $row.resourceId, $row.nonSensitiveEvidence)
}
Write-Host ''
Write-Host ('JSON report written to : {0}' -f $jsonPath) -ForegroundColor Green
Write-Host ('MD summary written to  : {0}' -f $mdPath) -ForegroundColor Green
Write-Host 'Verdict: PREPARATION_PARTIAL (Phase 5.2 NOT started; zero remote writes performed).' -ForegroundColor Yellow
exit 0
