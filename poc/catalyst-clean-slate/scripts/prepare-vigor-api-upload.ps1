<#
.SYNOPSIS
    VigorCore Phase 5.3 - Isolated Staging & ZIP Upload Package Builder for `vigor_api` (Windows PowerShell 5.1)

.DESCRIPTION
    Builds a clean, isolated production staging directory and upload ZIP (`vigor_api.zip`)
    strictly inside `poc/catalyst-clean-slate/artifacts/` for Zoho Catalyst Advanced I/O (Node.js 22).

    Strict Safety Rules:
      - ZERO remote calls or Catalyst CLI deploy/create/apig mutations.
      - Strictly anchored to `poc/catalyst-clean-slate/`.
      - Excludes devDependencies, tests, frontend, dist-frontend, docs, scripts, config/candidates,
        .env*/secrets, Firebase/GCP artifacts, and non-runtime provisioning modules.
      - Generates its own production-only `package-lock.json` inside staging (never copies root lockfile).
      - Creates the ZIP archive ONLY after all staging, ESM import, dependency, and secret checks pass.

.PARAMETER SkipNpmInstall
    Optional switch to skip `npm install --omit=dev --ignore-scripts` if staging `node_modules` is already populated.

.PARAMETER KeepOnFailure
    Optional switch to keep the staging directory if validation fails for post-mortem inspection.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [switch]$SkipNpmInstall,

    [Parameter(Mandatory = $false)]
    [switch]$KeepOnFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$PocRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$RootPackageJsonPath = Join-Path $PocRoot 'package.json'
$TsConfigServerPath = Join-Path $PocRoot 'tsconfig.server.json'

if (-not (Test-Path -LiteralPath $RootPackageJsonPath) -or -not (Test-Path -LiteralPath $TsConfigServerPath)) {
    throw "Anchor validation failed: script must execute inside 'poc/catalyst-clean-slate/scripts/'."
}

$ExpectedPocLeaf = Split-Path -Path $PocRoot -Leaf
if ($ExpectedPocLeaf -ne 'catalyst-clean-slate') {
    throw "Invalid working root '$PocRoot'. Expected 'poc/catalyst-clean-slate'."
}

$ArtifactsDir = Join-Path $PocRoot 'artifacts'
$StagingDir = Join-Path $ArtifactsDir 'vigor_api'
$ZipPath = Join-Path $ArtifactsDir 'vigor_api.zip'

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

function Remove-PreviousZip {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetZip
    )

    if (Test-Path -LiteralPath $TargetZip) {
        Remove-Item -LiteralPath $TargetZip -Force
    }
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

$psEditionLabel = if ($PSVersionTable.ContainsKey('PSEdition')) { [string]$PSVersionTable['PSEdition'] } else { 'Desktop' }
Write-Host '=== VigorCore Phase 5.3: vigor_api Isolated Staging & ZIP Builder ==='
Write-Host ("POC Root       : {0}" -f $PocRoot)
Write-Host ("Staging Dir    : {0}" -f $StagingDir)
Write-Host ("Target ZIP     : {0}" -f $ZipPath)
Write-Host ("PS Edition/Ver : {0} ({1})" -f $psEditionLabel, $PSVersionTable.PSVersion)
Write-Host 'Target Runtime : Catalyst Advanced I/O node22 (PENDING_LIVE_VERIFICATION)'
Write-Host 'Remote Ops     : 0 (offline staging and local verification only)'

if ($null -eq (Get-Command 'node' -ErrorAction SilentlyContinue)) {
    throw 'Node.js CLI (node) is required in PATH.'
}
if ($null -eq (Get-Command 'npm' -ErrorAction SilentlyContinue)) {
    throw 'npm CLI (npm) is required in PATH.'
}

# Verify Node.js meets engines.node >=22 (e.g. v22.x or v24.16.0 on operator Windows workstation)
$prevPrefNode = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$nodeVersionRaw = (& node -v)
$nodeExit = $LASTEXITCODE
$ErrorActionPreference = $prevPrefNode

if ($nodeExit -ne 0 -or [string]::IsNullOrWhiteSpace($nodeVersionRaw)) {
    throw 'Node.js is required in PATH and must respond to node -v.'
}
$nodeVersionClean = $nodeVersionRaw.Trim()
if ($nodeVersionClean -notmatch '^v(\d+)\.(\d+)\.(\d+)') {
    throw "Unable to parse Node.js version: '$nodeVersionClean'."
}
$nodeMajor = [int]$Matches[1]
if ($nodeMajor -lt 22) {
    throw "Node.js >= 22 (engines.node >=22) is required to build/stage vigor_api; detected '$nodeVersionClean'."
}
Write-Host ("Local Node.js  : {0} (satisfies engines.node >=22)" -f $nodeVersionClean)
if ($nodeMajor -ne 22) {
    Write-Host ("NOTE           : Local packaging/ESM checks run on Node.js {0}. This does NOT replace testing the remote Catalyst Node.js 22 runtime (PENDING_LIVE_VERIFICATION)." -f $nodeVersionClean)
}

# Step 1: Compile TypeScript server (`dist/`)
Write-Host '[1/6] Compiling TypeScript server (npm run build:server)...'
Invoke-ExternalCommand -Executable 'npm' -Arguments @('--prefix', $PocRoot, 'run', 'build:server')

$DistRoot = Join-Path $PocRoot 'dist'
$CompiledEntry = Join-Path (Join-Path $DistRoot 'server') 'catalystEntry.js'
if (-not (Test-Path -LiteralPath $CompiledEntry)) {
    throw "Compiled entrypoint missing: $CompiledEntry"
}

# Step 2: Prepare clean staging directory and remove stale ZIP
Write-Host '[2/6] Creating isolated staging directory...'
if (-not (Test-Path -LiteralPath $ArtifactsDir)) {
    New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null
}
Remove-PreviousZip -TargetZip $ZipPath
if (Test-Path -LiteralPath $StagingDir) {
    Remove-Item -LiteralPath $StagingDir -Recurse -Force
}
New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null

$StagingCompleted = $false
try {
    # Step 3: Copy ONLY required runtime JS modules from dist/ (exclude dist/provisioning, dist/frontend, .js.map)
    Write-Host '[3/6] Copying required compiled runtime modules (.js only, excluding provisioning/sourcemaps)...'
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

    # Step 4: Generate production-only package.json + catalyst-config.json
    Write-Host '[4/6] Writing production package.json and catalyst-config.json...'
    $rootPkg = Get-Content -LiteralPath $RootPackageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
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
        description  = 'VigorCore Advanced I/O API backend for Zoho Catalyst (Node.js 22)'
        main         = 'dist/server/catalystEntry.js'
        engines      = [ordered]@{ node = '>=22' }
        dependencies = $prodDeps
    }
    $stagingPkgJson = ($stagingPkg | ConvertTo-Json -Depth 6) + "`n"
    Write-Utf8NoBom -Path (Join-Path $StagingDir 'package.json') -Content $stagingPkgJson

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
    $catalystConfigJson = ($catalystConfig | ConvertTo-Json -Depth 6) + "`n"
    Write-Utf8NoBom -Path (Join-Path $StagingDir 'catalyst-config.json') -Content $catalystConfigJson

    # Step 5: Install ONLY production runtime dependencies in staging (produces isolated package-lock.json)
    if (-not $SkipNpmInstall) {
        Write-Host '[5/6] Installing production-only runtime dependencies inside staging...'
        Invoke-ExternalCommand -Executable 'npm' -Arguments @('--prefix', $StagingDir, 'install', '--omit=dev', '--ignore-scripts', '--package-lock')
    }
    else {
        Write-Host '[5/6] Skipping npm install (-SkipNpmInstall specified).'
    }

    # Step 6: Run all local staging checks BEFORE generating ZIP
    Write-Host '[6/6] Running local staging & ESM validation checks...'
    $validationScript = @'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const stagingDir = path.resolve(process.argv[1]);
const expectedDeps = ['@zcatalyst/auth', '@zcatalyst/auth-admin', '@zcatalyst/nosql', '@zcatalyst/transport', '@zcatalyst/utils', 'express'];
const devDeps = ['@types/express', '@types/node', 'playwright-core', 'tsx', 'typescript'];

const pkg = JSON.parse(fs.readFileSync(path.join(stagingDir, 'package.json'), 'utf8'));
if (pkg.name !== 'vigor_api') throw new Error('Invalid staging package name');
if (pkg.type !== 'module') throw new Error('Staging package.json must have type=module');
if (pkg.main !== 'dist/server/catalystEntry.js') throw new Error('Invalid staging main');
if (pkg?.engines?.node !== '>=22') throw new Error('Staging package.json must declare engines.node >=22');
if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) throw new Error('devDependencies present in staging package.json');
if (JSON.stringify(Object.keys(pkg.dependencies).sort()) !== JSON.stringify([...expectedDeps].sort())) {
  throw new Error('Unexpected dependencies in staging package.json');
}

const cfg = JSON.parse(fs.readFileSync(path.join(stagingDir, 'catalyst-config.json'), 'utf8'));
if (cfg?.deployment?.name !== 'vigor_api' || cfg?.deployment?.type !== 'advancedio' || cfg?.deployment?.stack !== 'node22') {
  throw new Error('Invalid catalyst-config.json deployment settings');
}
if (cfg?.execution?.main !== 'dist/server/catalystEntry.js') {
  throw new Error('Invalid catalyst-config.json execution.main');
}

for (const d of devDeps) {
  if (fs.existsSync(path.join(stagingDir, 'node_modules', d))) {
    throw new Error(`devDependency leaked into staging node_modules: ${d}`);
  }
}
for (const d of expectedDeps) {
  if (!fs.existsSync(path.join(stagingDir, 'node_modules', d, 'package.json'))) {
    throw new Error(`Runtime dependency missing from staging node_modules: ${d}`);
  }
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const nonNmFiles = walk(stagingDir).filter(f => !f.includes(`${path.sep}node_modules${path.sep}`));
const forbiddenPathTerms = ['.env', 'firebase', 'firestore', 'gcp', 'google-services', 'candidates', 'provisioning', 'frontend', 'docs/', 'docs\\', 'tests/', 'tests\\', 'scripts/', 'scripts\\', '.js.map'];
for (const f of nonNmFiles) {
  const rel = path.relative(stagingDir, f).toLowerCase();
  for (const term of forbiddenPathTerms) {
    if (rel.includes(term)) throw new Error(`Forbidden staging file detected: ${rel}`);
  }
}

const entryUrl = pathToFileURL(path.join(stagingDir, 'dist', 'server', 'catalystEntry.js')).href;
const mod = await import(entryUrl);
if (typeof mod.default !== 'function' || typeof mod.catalystAdvancedIoEntry !== 'function') {
  throw new Error('Staged catalystEntry.js does not export default / catalystAdvancedIoEntry handler');
}

let statusCode = 0;
let bodyText = '';
const mockReq = { headers: {}, method: 'GET', url: '/health' };
const mockRes = {
  statusCode: 200,
  setHeader() {},
  end(chunk) { statusCode = this.statusCode; bodyText = String(chunk || ''); }
};
mod.default(mockReq, mockRes);
if (statusCode !== 503 || !bodyText.includes('SERVER_CONFIGURATION_UNAVAILABLE')) {
  throw new Error(`Expected fail-closed 503 probe on unconfigured staged entry, got ${statusCode}: ${bodyText}`);
}
console.log('LOCAL_STAGING_VALIDATION_OK');
'@

    $tmpValidateFile = Join-Path $ArtifactsDir '.validate-vigor-staging.mjs'
    try {
        Write-Utf8NoBom -Path $tmpValidateFile -Content $validationScript
        Invoke-ExternalCommand -Executable 'node' -Arguments @($tmpValidateFile, $StagingDir)
    }
    finally {
        if (Test-Path -LiteralPath $tmpValidateFile) {
            Remove-Item -LiteralPath $tmpValidateFile -Force
        }
    }

    # Build ZIP ONLY after all validations pass, with files at archive root (no wrapping folder)
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $StagingDir,
        $ZipPath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    $zipRead = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $entryNames = @($zipRead.Entries | ForEach-Object { $_.FullName -replace '\\', '/' })
        $requiredRootFiles = @('package.json', 'package-lock.json', 'catalyst-config.json', 'dist/server/catalystEntry.js')
        foreach ($reqEntry in $requiredRootFiles) {
            if ($entryNames -notcontains $reqEntry) {
                throw "ZIP root structure validation failed: missing '$reqEntry' at archive root."
            }
            $zipEntryObj = $zipRead.GetEntry($reqEntry)
            if ($null -eq $zipEntryObj) {
                $altKey = $reqEntry -replace '/', '\'
                $zipEntryObj = $zipRead.GetEntry($altKey)
            }
            if ($null -eq $zipEntryObj) {
                throw "ZIP integrity validation failed: unable to open entry '$reqEntry'."
            }
            $entryStream = $zipEntryObj.Open()
            try {
                $reader = New-Object System.IO.StreamReader($entryStream, [System.Text.Encoding]::UTF8)
                try {
                    $contentCheck = $reader.ReadToEnd()
                    if ([string]::IsNullOrWhiteSpace($contentCheck)) {
                        throw "ZIP integrity validation failed: empty critical entry '$reqEntry'."
                    }
                }
                finally {
                    $reader.Dispose()
                }
            }
            finally {
                $entryStream.Dispose()
            }
        }
        $wrapped = @($entryNames | Where-Object { $_ -like 'vigor_api/*' })
        if ($wrapped.Count -gt 0) {
            throw 'ZIP structure validation failed: unexpected wrapping vigor_api/ parent directory.'
        }
    }
    finally {
        $zipRead.Dispose()
    }

    $zipInfo = Get-Item -LiteralPath $ZipPath
    $zipMb = [Math]::Round($zipInfo.Length / 1MB, 2)
    Write-Host ("SUCCESS: Created clean upload ZIP '{0}' ({1} bytes / {2} MB) using local Node {3}." -f $ZipPath, $zipInfo.Length, $zipMb, $nodeVersionClean)
    Write-Host 'STATUS : PHASE_5_3_UPLOAD_PACKAGE_READY_NOT_DEPLOYED (target Catalyst node22 runtime remains PENDING_LIVE_VERIFICATION)'
    $StagingCompleted = $true
}
finally {
    if (-not $StagingCompleted) {
        Remove-PreviousZip -TargetZip $ZipPath
        if (-not $KeepOnFailure -and (Test-Path -LiteralPath $StagingDir)) {
            Remove-Item -LiteralPath $StagingDir -Recurse -Force
        }
    }
}

exit 0
