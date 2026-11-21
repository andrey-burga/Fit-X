<#
.SYNOPSIS
    VigorCore Phase 5.3 - Final Portable Production Package Builder for `vigor_api` (Windows PowerShell 5.1)

.DESCRIPTION
    Builds a clean, isolated production staging directory and generates the versioned portable ZIP:
    `artifacts/vigor_api-env-audit-portable.zip`
    strictly for Zoho Catalyst Advanced I/O (Node.js 22).

    Strict Safety Rules:
      - ZERO remote calls or Catalyst CLI deploy/create/apig operations.
      - Anchored strictly to `poc/catalyst-clean-slate/`.
      - Excludes devDependencies, tests, frontend, docs, scripts, config/candidates, .env*/secrets,
        Firebase/GCP artifacts, source maps (*.js.map), symlinks, and .bin/ shims.
      - Generates isolated production-only `package-lock.json` inside staging.
      - Ensures 100% forward-slash ('/') paths and MS-DOS portable header flags (create_system=0, version=20, flag_bits=0).
      - Preserves previous original and portable artifacts untouched.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [switch]$SkipNpmInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$PocRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$RootPackageJsonPath = Join-Path $PocRoot 'package.json'
$TsConfigServerPath = Join-Path $PocRoot 'tsconfig.server.json'

if (-not (Test-Path -LiteralPath $RootPackageJsonPath) -or -not (Test-Path -LiteralPath $TsConfigServerPath)) {
    throw "Anchor validation failed: script must execute inside 'poc/catalyst-clean-slate/scripts/'."
}

$ArtifactsDir = Join-Path $PocRoot 'artifacts'
$StagingDir = Join-Path $ArtifactsDir 'vigor_api'
$VersionedZipPath = Join-Path $ArtifactsDir 'vigor_api-env-audit-portable.zip'

$RuntimePackages = @(
    '@zcatalyst/auth',
    '@zcatalyst/auth-admin',
    '@zcatalyst/nosql',
    '@zcatalyst/transport',
    '@zcatalyst/utils',
    'express'
)

$RequiredDistDirs = @(
    'auth',
    'nosql',
    'routes',
    'sdk',
    'security',
    'server',
    'services',
    'types',
    'validators'
)

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Content
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Invoke-ExternalCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )
    $prevPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Executable @Arguments
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $prevPreference
    }
    if ($code -ne 0) {
        throw ("Command '{0} {1}' failed with exit code {2}." -f $Executable, ($Arguments -join ' '), $code)
    }
}

Write-Host '=== VigorCore Phase 5.3: Final Portable Deployment Package Builder ==='
Write-Host ("Poc Root       : {0}" -f $PocRoot)
Write-Host ("Staging Dir    : {0}" -f $StagingDir)
Write-Host ("Versioned ZIP  : {0}" -f $VersionedZipPath)

if (-not (Test-Path -LiteralPath $ArtifactsDir)) {
    New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null
}

# Step 1: Compile server TypeScript
Write-Host '[1/5] Compiling TypeScript server (npm run build:server)...'
Invoke-ExternalCommand -Executable 'npm' -Arguments @('--prefix', $PocRoot, 'run', 'build:server')

$DistRoot = Join-Path $PocRoot 'dist'
$CompiledEntry = Join-Path (Join-Path $DistRoot 'server') 'catalystEntry.js'
if (-not (Test-Path -LiteralPath $CompiledEntry)) {
    throw "Compiled entrypoint missing: $CompiledEntry"
}

# Step 2: Prepare clean staging directory
Write-Host '[2/5] Preparing clean isolated staging directory...'
if (Test-Path -LiteralPath $StagingDir) {
    Remove-Item -LiteralPath $StagingDir -Recurse -Force
}
New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null

$StagingDist = Join-Path $StagingDir 'dist'
New-Item -ItemType Directory -Path $StagingDist -Force | Out-Null

foreach ($subDir in $RequiredDistDirs) {
    $srcSubDir = Join-Path $DistRoot $subDir
    if (-not (Test-Path -LiteralPath $srcSubDir)) {
        throw "Required compiled module directory missing: $srcSubDir"
    }
    $dstSubDir = Join-Path $StagingDist $subDir
    $jsFiles = @(Get-ChildItem -LiteralPath $srcSubDir -Recurse -File -Filter '*.js')
    if ($jsFiles.Count -eq 0) {
        throw "No .js files found inside compiled runtime directory: $srcSubDir"
    }
    foreach ($f in $jsFiles) {
        $relPath = $f.FullName.Substring($srcSubDir.Length).TrimStart('\', '/')
        $targetFile = Join-Path $dstSubDir $relPath
        $targetParent = Split-Path -Path $targetFile -Parent
        if (-not (Test-Path -LiteralPath $targetParent)) {
            New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
        }
        Copy-Item -LiteralPath $f.FullName -Destination $targetFile -Force
    }
}

# Step 3: Write production package.json & catalyst-config.json
Write-Host '[3/5] Writing production package.json and catalyst-config.json...'
$rootPkg = Get-Content -LiteralPath (Join-Path $PocRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$prodDeps = [ordered]@{}
foreach ($depName in $RuntimePackages) {
    $verProp = $rootPkg.dependencies.PSObject.Properties[$depName]
    if ($null -eq $verProp -or [string]::IsNullOrWhiteSpace([string]$verProp.Value)) {
        throw "Missing required runtime dependency '$depName' in root package.json."
    }
    $prodDeps[$depName] = [string]$verProp.Value
}

$stagingPkg = [ordered]@{
    name         = 'vigor_api'
    version      = '1.0.0'
    private      = $true
    type         = 'module'
    description  = 'VigorCore Advanced I/O API backend for Zoho Catalyst (Node.js 22) - Environment Audit Release'
    main         = 'dist/server/catalystEntry.js'
    engines      = [ordered]@{ node = '>=22' }
    dependencies = $prodDeps
}
Write-Utf8NoBom -Path (Join-Path $StagingDir 'package.json') -Content (($stagingPkg | ConvertTo-Json -Depth 6) + "`n")

$catalystConfig = [ordered]@{
    deployment = [ordered]@{
        name  = 'vigor_api'
        type  = 'advancedio'
        stack = 'node22'
    }
    execution = [ordered]@{
        main = 'dist/server/catalystEntry.js'
    }
}
Write-Utf8NoBom -Path (Join-Path $StagingDir 'catalyst-config.json') -Content (($catalystConfig | ConvertTo-Json -Depth 6) + "`n")

# Step 4: Install runtime dependencies in staging
if (-not $SkipNpmInstall) {
    Write-Host '[4/5] Installing production-only runtime dependencies...'
    Invoke-ExternalCommand -Executable 'npm' -Arguments @('--prefix', $StagingDir, 'install', '--omit=dev', '--ignore-scripts', '--package-lock')
}

$binDir = Join-Path (Join-Path $StagingDir 'node_modules') '.bin'
if (Test-Path -LiteralPath $binDir) {
    Remove-Item -LiteralPath $binDir -Recurse -Force
}

# Step 5: Build portable ZIP with explicit forward-slash paths (MS-DOS create_system=0)
Write-Host '[5/5] Building portable ZIP archive with forward-slash paths...'
if (Test-Path -LiteralPath $VersionedZipPath) {
    Remove-Item -LiteralPath $VersionedZipPath -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$filePaths = @(Get-ChildItem -LiteralPath $StagingDir -Recurse -File | Where-Object { $_.FullName -notmatch '\\node_modules\\\.bin\\' })
$fsZip = [System.IO.File]::Create($VersionedZipPath)
try {
    $archive = New-Object System.IO.Compression.ZipArchive($fsZip, [System.IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        foreach ($file in $filePaths) {
            $rel = $file.FullName.Substring($StagingDir.Length).TrimStart('\', '/').replace('\', '/')
            $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
            $entryStream = $entry.Open()
            try {
                $fileStream = [System.IO.File]::OpenRead($file.FullName)
                try {
                    $fileStream.CopyTo($entryStream)
                }
                finally {
                    $fileStream.Dispose()
                }
            }
            finally {
                $entryStream.Dispose()
            }
        }
    }
    finally {
        $archive.Dispose()
    }
}
finally {
    $fsZip.Dispose()
}

$zipInfo = Get-Item -LiteralPath $VersionedZipPath
$sha256Hash = (Get-FileHash -LiteralPath $VersionedZipPath -Algorithm SHA256).Hash.ToLower()

Write-Host '=================================================='
Write-Host 'SUCCESS: Final portable deployment package built!'
Write-Host ('Artifact Path : {0}' -f $VersionedZipPath)
Write-Host ('File Size     : {0} bytes ({1} MB)' -f $zipInfo.Length, [Math]::Round($zipInfo.Length / 1MB, 2))
Write-Host ('SHA-256       : {0}' -f $sha256Hash)
Write-Host '=================================================='
exit 0
