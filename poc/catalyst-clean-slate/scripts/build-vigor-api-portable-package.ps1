<#
.SYNOPSIS
    VigorCore Phase 5.3 - Deterministic & Reproducible Portable Package Builder for `vigor_api` (Windows PowerShell 5.1)

.DESCRIPTION
    Builds a clean, isolated temporary production staging directory and generates the deterministic versioned ZIP:
    `artifacts/vigor_api-vars-reconciled-portable.zip`
    strictly for Zoho Catalyst Advanced I/O (Node.js 22).

    Determinism & Safety Rules:
      - ZERO remote calls or Catalyst CLI deploy/create/apig operations.
      - Anchored strictly to `poc/catalyst-clean-slate/`.
      - Uses an isolated temporary staging directory so `artifacts/vigor_api/` and prior ZIPs remain untouched.
      - Sorts ZIP entry paths strictly by UTF-16/ASCII code-point ordinal (`[System.StringComparer]::Ordinal`).
      - Uses 100% forward-slash ('/') paths and zero directory entries.
      - Fixes LastWriteTime on every ZIP entry to canonical DOS epoch `1980-01-01T00:00:00Z`.
      - Excludes devDependencies, tests, frontend, docs, scripts, config/candidates, .env*/secrets,
        Firebase/GCP artifacts, source maps (*.js.map), symlinks, .bin/ shims, and OS metadata files.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$OutputZipPath = '',

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
if ([string]::IsNullOrWhiteSpace($OutputZipPath)) {
    $VersionedZipPath = Join-Path $ArtifactsDir 'vigor_api-vars-reconciled-portable.zip'
}
else {
    $VersionedZipPath = $OutputZipPath
}

$StagingDir = Join-Path ([System.IO.Path]::GetTempPath()) ("vigor-api-reproducible-" + [System.Guid]::NewGuid().ToString('N'))

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

$ExcludedFileNames = @('.DS_Store', 'Thumbs.db', 'desktop.ini')
$FixedDosEpoch = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)

function Write-Utf8NoBomLf {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Content
    )
    $normalized = $Content.Replace("`r`n", "`n")
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $normalized, $utf8NoBom)
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

Write-Host '=== VigorCore Phase 5.3: Reproducible Portable Deployment Package Builder ==='
Write-Host ("Poc Root       : {0}" -f $PocRoot)
Write-Host ("Staging Dir    : {0}" -f $StagingDir)
Write-Host ("Versioned ZIP  : {0}" -f $VersionedZipPath)

if (-not (Test-Path -LiteralPath $ArtifactsDir)) {
    New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null
}

try {
    # Step 1: Compile server TypeScript
    Write-Host '[1/5] Compiling TypeScript server (npm run build:server)...'
    Invoke-ExternalCommand -Executable 'npm' -Arguments @('--prefix', $PocRoot, 'run', 'build:server')

    $DistRoot = Join-Path $PocRoot 'dist'
    $CompiledEntry = Join-Path (Join-Path $DistRoot 'server') 'catalystEntry.js'
    if (-not (Test-Path -LiteralPath $CompiledEntry)) {
        throw "Compiled entrypoint missing: $CompiledEntry"
    }

    # Step 2: Prepare isolated temporary staging directory
    Write-Host '[2/5] Preparing clean isolated staging directory...'
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
            $jsText = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
            Write-Utf8NoBomLf -Path $targetFile -Content $jsText
        }
    }

    # Step 3: Write production package.json & catalyst-config.json with LF line endings
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
        description  = 'VigorCore Advanced I/O API backend for Zoho Catalyst (Node.js 22) - Final Environment Audit Package'
        main         = 'dist/server/catalystEntry.js'
        engines      = [ordered]@{ node = '>=22' }
        dependencies = $prodDeps
    }
    Write-Utf8NoBomLf -Path (Join-Path $StagingDir 'package.json') -Content (($stagingPkg | ConvertTo-Json -Depth 6) + "`n")

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
    Write-Utf8NoBomLf -Path (Join-Path $StagingDir 'catalyst-config.json') -Content (($catalystConfig | ConvertTo-Json -Depth 6) + "`n")

    # Step 4: Install runtime dependencies in staging
    if (-not $SkipNpmInstall) {
        Write-Host '[4/5] Installing production-only runtime dependencies...'
        Invoke-ExternalCommand -Executable 'npm' -Arguments @('--prefix', $StagingDir, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund')
    }

    $lockFile = Join-Path $StagingDir 'package-lock.json'
    if (Test-Path -LiteralPath $lockFile) {
        $lockText = [System.IO.File]::ReadAllText($lockFile, [System.Text.Encoding]::UTF8)
        Write-Utf8NoBomLf -Path $lockFile -Content $lockText
    }

    $binDir = Join-Path (Join-Path $StagingDir 'node_modules') '.bin'
    if (Test-Path -LiteralPath $binDir) {
        Remove-Item -LiteralPath $binDir -Recurse -Force
    }

    # Step 5: Build deterministic portable ZIP with ordinal-sorted forward-slash paths and fixed timestamp
    Write-Host '[5/5] Building deterministic portable ZIP archive...'
    if (Test-Path -LiteralPath $VersionedZipPath) {
        Remove-Item -LiteralPath $VersionedZipPath -Force
    }

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $fileItems = New-Object 'System.Collections.Generic.List[object]'
    foreach ($file in (Get-ChildItem -LiteralPath $StagingDir -Recurse -File)) {
        if (($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
        if ($ExcludedFileNames -contains $file.Name) { continue }
        if ($file.Name.EndsWith('.js.map')) { continue }
        $rel = $file.FullName.Substring($StagingDir.Length).TrimStart('\', '/').Replace('\', '/')
        if ($rel.StartsWith('node_modules/.bin/') -or $rel.Contains('/node_modules/.bin/')) { continue }
        $fileItems.Add([PSCustomObject]@{
            Rel      = $rel
            FullName = $file.FullName
        }) | Out-Null
    }

    $fileItems.Sort([System.Comparison[object]] {
        param($a, $b)
        [System.StringComparer]::Ordinal.Compare($a.Rel, $b.Rel)
    })
    $sortedItems = $fileItems

    $fsZip = [System.IO.File]::Create($VersionedZipPath)
    try {
        $archive = New-Object System.IO.Compression.ZipArchive($fsZip, [System.IO.Compression.ZipArchiveMode]::Create, $true)
        try {
            foreach ($item in $sortedItems) {
                $entry = $archive.CreateEntry($item.Rel, [System.IO.Compression.CompressionLevel]::Optimal)
                $entry.LastWriteTime = $FixedDosEpoch
                $entryStream = $entry.Open()
                try {
                    $fileStream = [System.IO.File]::OpenRead($item.FullName)
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
    Write-Host 'SUCCESS: Reproducible portable deployment package built!'
    Write-Host ('Artifact Path : {0}' -f $VersionedZipPath)
    Write-Host ('Entries       : {0}' -f $sortedItems.Count)
    Write-Host ('File Size     : {0} bytes ({1} MB)' -f $zipInfo.Length, [Math]::Round($zipInfo.Length / 1MB, 2))
    Write-Host ('SHA-256       : {0}' -f $sha256Hash)
    Write-Host '=================================================='
    exit 0
}
finally {
    if (Test-Path -LiteralPath $StagingDir) {
        Remove-Item -LiteralPath $StagingDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
