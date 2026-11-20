<#
.SYNOPSIS
    VigorCore Phase 5.3 - Deep ZIP Forensic Auditor & Conservative Portable Builder for `vigor_api` (Windows PowerShell 5.1 + Node.js >=22)

.DESCRIPTION
    Performs a byte-level forensic audit of `poc/catalyst-clean-slate/artifacts/vigor_api.zip`
    against Linux Info-ZIP `unzip -o` compatibility rules WITHOUT modifying or overwriting it.
    If staging validation succeeds, builds a conservative portable archive at:
      `poc/catalyst-clean-slate/artifacts/vigor_api-portable.zip`
    with strict `/` forward slashes, regular file entries only, zero symlinks/ReparsePoints,
    zero `node_modules/.bin` shims, zero empty directory entries, zero ZIP64, and full tree/ESM checks.

    Strict Safety Rules:
      - ZERO remote calls, uploads, deployments, or Catalyst CLI invocations.
      - NEVER overwrites `artifacts/vigor_api.zip` (preserved as first-attempt evidence).
      - Compatible with Windows PowerShell 5.1 (.NET Framework 4.5–4.8) and Node.js v24.16.0 (engines.node >=22).

.PARAMETER SkipPortableBuild
    Optional switch to run the forensic audit only without generating `vigor_api-portable.zip`.

.PARAMETER Force
    Optional switch to rebuild `vigor_api-portable.zip` even if it already exists.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [switch]$SkipPortableBuild,

    [Parameter(Mandatory = $false)]
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$PocRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$RootPackageJsonPath = Join-Path $PocRoot 'package.json'
if (-not (Test-Path -LiteralPath $RootPackageJsonPath) -or (Split-Path -Path $PocRoot -Leaf) -ne 'catalyst-clean-slate') {
    throw "Anchor validation failed: script must execute inside 'poc/catalyst-clean-slate/scripts/'."
}

$ArtifactsDir = Join-Path $PocRoot 'artifacts'
$StagingDir = Join-Path $ArtifactsDir 'vigor_api'
$OriginalZipPath = Join-Path $ArtifactsDir 'vigor_api.zip'
$PortableZipPath = Join-Path $ArtifactsDir 'vigor_api-portable.zip'

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Invoke-ExternalCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Executable @Arguments
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $prevPref
    }
    if ($code -ne 0) {
        throw ("Command '{0} {1}' failed with exit code {2}." -f $Executable, ($Arguments -join ' '), $code)
    }
}

function Get-FileSha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $fs = [System.IO.File]::OpenRead($Path)
        try {
            $hashBytes = $sha.ComputeHash($fs)
            return ([System.BitConverter]::ToString($hashBytes) -replace '-', '').ToLowerInvariant()
        }
        finally {
            $fs.Dispose()
        }
    }
    finally {
        $sha.Dispose()
    }
}

function Read-ZipFileBytes {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "ZIP file does not exist or is not a regular file: '$Path'"
    }

    $fileInfo = [System.IO.FileInfo]::new((Resolve-Path -LiteralPath $Path).Path)
    if ($fileInfo.Length -eq 0) {
        throw "Invalid ZIP file (0 bytes / empty file): '$($fileInfo.FullName)'"
    }
    if ($fileInfo.Length -lt 22) {
        throw "Truncated or invalid ZIP file (only $($fileInfo.Length) bytes; minimum EOCD size is 22 bytes): '$($fileInfo.FullName)'"
    }

    [byte[]]$rawBytes = [System.IO.File]::ReadAllBytes($fileInfo.FullName)
    if ($null -eq $rawBytes -or $rawBytes.LongLength -ne $fileInfo.Length) {
        $actualLen = if ($null -eq $rawBytes) { 0 } else { $rawBytes.LongLength }
        throw "Binary read length mismatch for '$($fileInfo.FullName)': expected $($fileInfo.Length) bytes, read $actualLen bytes."
    }

    # Unary comma prevents PowerShell pipeline enumeration/unwrapping of the byte[]
    return , $rawBytes
}

[uint64]$script:Crc32Mask = [uint64]4294967295
[uint64]$script:Crc32Polynomial = [uint64]3988292384
[uint64[]]$script:Crc32Table = $null

function Initialize-Crc32Table {
    [uint64[]]$table = New-Object uint64[] 256
    for ($n = 0; $n -lt 256; $n++) {
        [uint64]$c = [uint64]$n
        for ($k = 0; $k -lt 8; $k++) {
            [uint64]$lsb = $c -band [uint64]1
            [uint64]$shifted = ($c -shr 1) -band [uint64]2147483647
            if ($lsb -ne [uint64]0) {
                $c = ($shifted -bxor $script:Crc32Polynomial) -band $script:Crc32Mask
            }
            else {
                $c = $shifted -band $script:Crc32Mask
            }
        }
        $table[$n] = $c -band $script:Crc32Mask
    }
    $script:Crc32Table = $table
}

function Compute-Crc32 {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [byte[]]$Bytes
    )

    if ($null -eq $Bytes -or $Bytes.Length -eq 0) {
        return [System.Convert]::ToUInt32([uint64]0)
    }

    if ($null -eq $script:Crc32Table) {
        Initialize-Crc32Table
    }

    [uint64]$mask = $script:Crc32Mask
    [uint64]$crc = $mask
    [uint64[]]$table = $script:Crc32Table

    foreach ($b in $Bytes) {
        [uint64]$byteVal = [uint64]$b
        [int]$idx = [int](($crc -bxor $byteVal) -band [uint64]255)
        [uint64]$shifted = ($crc -shr 8) -band [uint64]16777215
        $crc = ($shifted -bxor $table[$idx]) -band $mask
    }

    [uint64]$final = ($crc -bxor $mask) -band $mask
    if ($final -gt $mask) {
        throw "CRC32 result exceeded 32-bit unsigned bounds: $final"
    }
    return [System.Convert]::ToUInt32($final)
}

function Test-Crc32SelfCheck {
    $vectors = @(
        @{ Label = 'empty'; Bytes = (New-Object byte[] 0); Expected = '00000000' },
        @{ Label = 'ascii-123456789'; Bytes = ([System.Text.Encoding]::ASCII.GetBytes('123456789')); Expected = 'CBF43926' },
        @{ Label = 'above-int32-max-a'; Bytes = ([System.Text.Encoding]::ASCII.GetBytes('a')); Expected = 'E8B7BE43' }
    )

    [byte[]]$all256 = New-Object byte[] 256
    for ($i = 0; $i -lt 256; $i++) {
        $all256[$i] = [byte]$i
    }
    $vectors += @{ Label = 'all-bytes-0-255'; Bytes = $all256; Expected = '29058C73' }

    [byte[]]$largeBuf = New-Object byte[] 1048576
    for ($i = 0; $i -lt 1048576; $i++) {
        $largeBuf[$i] = [byte]((($i * 31) + 7) -band 255)
    }
    $vectors += @{ Label = 'large-1mib'; Bytes = $largeBuf; Expected = 'D424BDC1' }

    foreach ($v in $vectors) {
        [uint32]$actual = Compute-Crc32 -Bytes $v.Bytes
        $actualHex = ('{0:X8}' -f $actual)
        if ($actualHex -ne $v.Expected) {
            throw ("CRC32 self-check failed for '{0}': expected {1}, got {2}." -f $v.Label, $v.Expected, $actualHex)
        }
    }
}

function Inspect-ZipRawHeaders {
    param([Parameter(Mandatory = $true)][string]$ZipFile)

    [byte[]]$bytes = Read-ZipFileBytes -Path $ZipFile
    $len = $bytes.Length

    # Find End of Central Directory (0x06054b50)
    $eocdOffset = -1
    $minOff = [Math]::Max(0, $len - 65557)
    for ($i = $len - 22; $i -ge $minOff; $i--) {
        if ($bytes[$i] -eq 0x50 -and $bytes[$i + 1] -eq 0x4B -and $bytes[$i + 2] -eq 0x05 -and $bytes[$i + 3] -eq 0x06) {
            $eocdOffset = $i
            break
        }
    }
    if ($eocdOffset -lt 0) {
        throw "Truncated or invalid ZIP: End-of-Central-Directory (PK 05 06) not found in '$ZipFile'."
    }

    # Check ZIP64 EOCD Locator (0x07064b50) immediately preceding EOCD
    $hasZip64 = $false
    if ($eocdOffset -ge 20) {
        $locOff = $eocdOffset - 20
        if ($bytes[$locOff] -eq 0x50 -and $bytes[$locOff + 1] -eq 0x4B -and $bytes[$locOff + 2] -eq 0x06 -and $bytes[$locOff + 3] -eq 0x07) {
            $hasZip64 = $true
        }
    }

    $totalEntries = [System.BitConverter]::ToUInt16($bytes, $eocdOffset + 10)
    $cdOffset = [System.BitConverter]::ToUInt32($bytes, $eocdOffset + 16)
    if ($totalEntries -eq 0) {
        throw "Invalid ZIP archive '$ZipFile': Central Directory reports 0 entries."
    }
    if ([int64]$cdOffset -ge [int64]$eocdOffset -or ([int64]$cdOffset + 46) -gt [int64]$len) {
        throw "Truncated or corrupt ZIP '$ZipFile': Central Directory offset ($cdOffset) is out of bounds (fileLength=$len, eocdOffset=$eocdOffset)."
    }
    $cursor = [int]$cdOffset

    $findings = [ordered]@{
        ZipFile                = $ZipFile
        ByteLength             = $len
        Sha256                 = Get-FileSha256Hex -Path $ZipFile
        TotalEntries           = $totalEntries
        HasZip64               = $hasZip64
        WrappingParentEntries  = @()
        BackslashEntries       = @()
        AbsoluteOrTraversal    = @()
        DuplicateEntries       = @()
        CaseCollisions         = @()
        UnsupportedCompression = @()
        EncryptedEntries       = @()
        DataDescriptorEntries  = @()
        Utf8FlagEntries        = @()
        EmptyDirEntries        = @()
        SymlinkEntries         = @()
        NonAsciiEntries        = @()
        WindowsJunkEntries     = @()
        NodeBinEntries         = @()
        LongPathEntries        = @()
        HiddenEntries          = @()
        CrcMismatches          = @()
        ExternalAttrsSample    = @()
        CreateSystems          = @{}
        FlagsHistogram         = @{}
    }

    $seenExact = @{}
    $seenLower = @{}

    for ($idx = 0; $idx -lt $totalEntries; $idx++) {
        if (($cursor + 46) -gt $len) {
            throw "Truncated ZIP '$ZipFile': Central Directory entry #$idx exceeds file bounds at offset $cursor."
        }
        $sig = [System.BitConverter]::ToUInt32($bytes, $cursor)
        if ($sig -ne 0x02014B50) {
            throw ("Invalid Central Directory signature at offset {0}: 0x{1:X8}" -f $cursor, $sig)
        }

        $verMade = [System.BitConverter]::ToUInt16($bytes, $cursor + 4)
        $createSys = ($verMade -shr 8) -band 0xFF
        $flags = [System.BitConverter]::ToUInt16($bytes, $cursor + 8)
        $method = [System.BitConverter]::ToUInt16($bytes, $cursor + 10)
        $crcExpected = [System.BitConverter]::ToUInt32($bytes, $cursor + 16)
        $compSize = [System.BitConverter]::ToUInt32($bytes, $cursor + 20)
        $uncompSize = [System.BitConverter]::ToUInt32($bytes, $cursor + 24)
        $nameLen = [System.BitConverter]::ToUInt16($bytes, $cursor + 28)
        $extraLen = [System.BitConverter]::ToUInt16($bytes, $cursor + 30)
        $commentLen = [System.BitConverter]::ToUInt16($bytes, $cursor + 32)
        $extAttr = [System.BitConverter]::ToUInt32($bytes, $cursor + 38)
        $localOff = [System.BitConverter]::ToUInt32($bytes, $cursor + 42)

        if (($cursor + 46 + $nameLen + $extraLen + $commentLen) -gt $len) {
            throw "Truncated ZIP '$ZipFile': Central Directory metadata for entry #$idx exceeds file bounds."
        }
        $rawName = [System.Text.Encoding]::UTF8.GetString($bytes, $cursor + 46, $nameLen)

        $csKey = [string]$createSys
        if (-not $findings.CreateSystems.ContainsKey($csKey)) { $findings.CreateSystems[$csKey] = 0 }
        $findings.CreateSystems[$csKey] = $findings.CreateSystems[$csKey] + 1

        $flKey = ('0x{0:X}' -f $flags)
        if (-not $findings.FlagsHistogram.ContainsKey($flKey)) { $findings.FlagsHistogram[$flKey] = 0 }
        $findings.FlagsHistogram[$flKey] = $findings.FlagsHistogram[$flKey] + 1

        if ($findings.ExternalAttrsSample.Count -lt 8) {
            $findings.ExternalAttrsSample += ('0x{0:X8} ({1})' -f $extAttr, $rawName)
        }

        if ([uint64]$compSize -eq $script:Crc32Mask -or [uint64]$uncompSize -eq $script:Crc32Mask -or [uint64]$localOff -eq $script:Crc32Mask) {
            $findings.HasZip64 = $true
        }

        if ($rawName -like 'vigor_api/*' -or $rawName -like 'vigor_api\*') {
            $findings.WrappingParentEntries += $rawName
        }
        if ($rawName.Contains('\')) {
            $findings.BackslashEntries += $rawName
        }
        if ($rawName.StartsWith('/') -or $rawName.StartsWith('\') -or ($rawName -match '(^|[\\/])\.\.([\\/]|$)')) {
            $findings.AbsoluteOrTraversal += $rawName
        }

        if ($seenExact.ContainsKey($rawName)) {
            $findings.DuplicateEntries += $rawName
        }
        else {
            $seenExact[$rawName] = $true
        }

        $lowerName = ($rawName -replace '\\', '/').ToLowerInvariant()
        if ($seenLower.ContainsKey($lowerName)) {
            $findings.CaseCollisions += $rawName
        }
        else {
            $seenLower[$lowerName] = $true
        }

        if ($method -ne 0 -and $method -ne 8) {
            $findings.UnsupportedCompression += ("{0} (method={1})" -f $rawName, $method)
        }
        if (($flags -band 0x1) -ne 0) { $findings.EncryptedEntries += $rawName }
        if (($flags -band 0x8) -ne 0) { $findings.DataDescriptorEntries += $rawName }
        if (($flags -band 0x800) -ne 0) { $findings.Utf8FlagEntries += $rawName }
        if ($rawName.EndsWith('/') -or $rawName.EndsWith('\')) { $findings.EmptyDirEntries += $rawName }

        # POSIX symlink mode 0120000 stored in upper 16 bits of external attributes when create_system == 3
        [uint64]$posixMode = (([uint64]$extAttr) -shr 16) -band [uint64]61440
        if ($createSys -eq 3 -and $posixMode -eq [uint64]40960) {
            $findings.SymlinkEntries += $rawName
        }

        if ($rawName -match '[^\x00-\x7F]') { $findings.NonAsciiEntries += $rawName }
        if ($rawName.Length -gt 200) { $findings.LongPathEntries += $rawName }
        if ($lowerName -match '(^|/)(desktop\.ini|thumbs\.db|\.ds_store)$' -or $lowerName.Contains(':zone.identifier')) {
            $findings.WindowsJunkEntries += $rawName
        }
        if ($lowerName -match '(^|/)node_modules/\.bin/') {
            $findings.NodeBinEntries += $rawName
        }
        if ($lowerName -match '(^|/)\.[^/]+') {
            $findings.HiddenEntries += $rawName
        }

        # Verify Local File Header CRC32 via decompressed stream read
        if (([int64]$localOff + 30) -gt [int64]$len) {
            throw "Truncated ZIP '$ZipFile': Local File Header for '$rawName' exceeds file bounds."
        }
        $localSig = [System.BitConverter]::ToUInt32($bytes, [int]$localOff)
        if ($localSig -ne 0x04034B50) {
            throw ("Invalid Local File Header signature for '{0}' at offset {1}" -f $rawName, $localOff)
        }
        $lhNameLen = [System.BitConverter]::ToUInt16($bytes, [int]$localOff + 26)
        $lhExtraLen = [System.BitConverter]::ToUInt16($bytes, [int]$localOff + 28)
        $dataStart64 = [int64]$localOff + 30 + [int64]$lhNameLen + [int64]$lhExtraLen
        if (($dataStart64 + [int64]$compSize) -gt [int64]$len) {
            throw "Truncated ZIP '$ZipFile': compressed payload for '$rawName' exceeds file bounds."
        }
        $dataStart = [int]$dataStart64

        if (-not $rawName.EndsWith('/') -and -not $rawName.EndsWith('\') -and ($method -eq 0 -or $method -eq 8)) {
            [byte[]]$compSlice = New-Object byte[] ([int]$compSize)
            if ($compSize -gt 0) {
                [System.Array]::Copy($bytes, $dataStart, $compSlice, 0, [int]$compSize)
            }
            [byte[]]$plainBytes = $compSlice
            if ($method -eq 8) {
                $msIn = [System.IO.MemoryStream]::new($compSlice)
                try {
                    $ds = New-Object System.IO.Compression.DeflateStream($msIn, [System.IO.Compression.CompressionMode]::Decompress)
                    try {
                        $msOut = New-Object System.IO.MemoryStream
                        try {
                            $ds.CopyTo($msOut)
                            [byte[]]$plainBytes = $msOut.ToArray()
                        }
                        finally { $msOut.Dispose() }
                    }
                    finally { $ds.Dispose() }
                }
                finally { $msIn.Dispose() }
            }
            if ([uint32]$plainBytes.Length -ne $uncompSize) {
                $findings.CrcMismatches += ("{0} (size {1} != {2})" -f $rawName, $plainBytes.Length, $uncompSize)
            }
            else {
                $actualCrc = Compute-Crc32 -Bytes $plainBytes
                if ($actualCrc -ne $crcExpected) {
                    $findings.CrcMismatches += ("{0} (crc 0x{1:X8} != 0x{2:X8})" -f $rawName, $actualCrc, $crcExpected)
                }
            }
        }

        $cursor += 46 + $nameLen + $extraLen + $commentLen
    }

    return $findings
}

function Print-AuditSummary {
    param([Parameter(Mandatory = $true)]$Report)
    Write-Host ("  File                    : {0}" -f $Report.ZipFile)
    Write-Host ("  Size / SHA-256          : {0} bytes | {1}" -f $Report.ByteLength, $Report.Sha256)
    Write-Host ("  Entries / ZIP64         : {0} | HasZip64={1}" -f $Report.TotalEntries, $Report.HasZip64)
    Write-Host ("  Backslashes (\)         : {0}" -f @($Report.BackslashEntries).Count)
    Write-Host ("  Wrapping vigor_api/     : {0}" -f @($Report.WrappingParentEntries).Count)
    Write-Host ("  Absolute / Traversal    : {0}" -f @($Report.AbsoluteOrTraversal).Count)
    Write-Host ("  Duplicates / CaseClash  : {0} / {1}" -f @($Report.DuplicateEntries).Count, @($Report.CaseCollisions).Count)
    Write-Host ("  DataDescriptors (0x8)   : {0}" -f @($Report.DataDescriptorEntries).Count)
    Write-Host ("  Symlinks / .bin entries : {0} / {1}" -f @($Report.SymlinkEntries).Count, @($Report.NodeBinEntries).Count)
    Write-Host ("  Empty Dirs / WinJunk    : {0} / {1}" -f @($Report.EmptyDirEntries).Count, @($Report.WindowsJunkEntries).Count)
    Write-Host ("  CRC / Size Mismatches   : {0}" -f @($Report.CrcMismatches).Count)
    if (@($Report.BackslashEntries).Count -gt 0) {
        Write-Warning ("CRITICAL: Detected {0} ZIP entries with Windows backslash '\'. Linux Info-ZIP 'unzip -o' exits with status=1 ('warning: ... appears to use backslashes as path separators'), causing Catalyst /var/runtime/index.js:145 to fail." -f @($Report.BackslashEntries).Count)
    }
}

$psEditionLabel = if ($PSVersionTable.ContainsKey('PSEdition')) { [string]$PSVersionTable['PSEdition'] } else { 'Desktop' }
Write-Host '=== VigorCore Phase 5.3: Deep ZIP Forensic Audit & Portable Builder ==='
Write-Host ("POC Root       : {0}" -f $PocRoot)
Write-Host ("PS Edition/Ver : {0} ({1})" -f $psEditionLabel, $PSVersionTable.PSVersion)
Write-Host 'Remote Ops     : 0 (offline forensic inspection and local verification only)'

if ($null -eq (Get-Command 'node' -ErrorAction SilentlyContinue)) {
    throw 'Node.js CLI (node) is required in PATH.'
}
$prevNodePref = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$nodeVerRaw = (& node -v)
$nodeExit = $LASTEXITCODE
$ErrorActionPreference = $prevNodePref
if ($nodeExit -ne 0 -or [string]::IsNullOrWhiteSpace($nodeVerRaw)) {
    throw 'Failed to detect Node.js version.'
}
$nodeVer = $nodeVerRaw.Trim()
if ($nodeVer -notmatch '^v(\d+)\.(\d+)\.(\d+)') {
    throw "Unable to parse Node.js version: '$nodeVer'."
}
$nodeMajor = [int]$Matches[1]
if ($nodeMajor -lt 22) {
    throw "Node.js >= 22 (engines.node >=22) required; detected '$nodeVer'."
}
Write-Host ("Local Node.js  : {0} (satisfies engines.node >=22; remote Catalyst node22 runtime remains PENDING_LIVE_VERIFICATION)" -f $nodeVer)

if (-not (Test-Path -LiteralPath $OriginalZipPath)) {
    throw "First-attempt archive missing: $OriginalZipPath"
}

Test-Crc32SelfCheck
Write-Host 'CRC32 SelfTest : PASS (00000000, CBF43926, E8B7BE43, 29058C73, D424BDC1)'

Write-Host '[1/4] Auditing existing vigor_api.zip (read-only, never overwritten)...'
$origShaBefore = Get-FileSha256Hex -Path $OriginalZipPath
$origAudit = Inspect-ZipRawHeaders -ZipFile $OriginalZipPath
$origShaAfter = Get-FileSha256Hex -Path $OriginalZipPath
if ($origShaBefore -ne $origShaAfter) {
    throw "Integrity violation: original ZIP SHA-256 changed during read-only inspection ($origShaBefore != $origShaAfter)."
}
Print-AuditSummary -Report $origAudit
Write-Host ("  Read-Only Hash Preserved: {0}" -f $origShaAfter)

if (@($origAudit.CrcMismatches).Count -gt 0) {
    throw "Original ZIP failed CRC/size integrity verification."
}

if ($SkipPortableBuild) {
    Write-Host 'SkipPortableBuild specified; exiting after read-only audit.'
    exit 0
}

if (-not (Test-Path -LiteralPath $StagingDir)) {
    throw "Staging directory missing: $StagingDir. Run prepare-vigor-api-upload.ps1 first."
}

Write-Host '[2/4] Building conservative portable ZIP (vigor_api-portable.zip) with forward slashes & zero symlinks...'
if (Test-Path -LiteralPath $PortableZipPath) {
    Remove-Item -LiteralPath $PortableZipPath -Force
}

$fixedUtc = New-Object System.DateTimeOffset(2026, 11, 20, 0, 0, 0, [System.TimeSpan]::Zero)
$portableCandidates = @()
$skippedEntries = @()

$allDirs = @($StagingDir) + @(Get-ChildItem -LiteralPath $StagingDir -Recurse -Directory -Force | ForEach-Object { $_.FullName })
foreach ($dirPath in $allDirs) {
    $dirInfo = Get-Item -LiteralPath $dirPath -Force
    if (($dirInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        $skippedEntries += $dirPath
        continue
    }
    $relDir = $dirPath.Substring($StagingDir.Length).TrimStart('\', '/') -replace '\\', '/'
    if ($relDir -match '(^|/)node_modules/\.bin($|/)') {
        $skippedEntries += $relDir
        continue
    }
    foreach ($f in @(Get-ChildItem -LiteralPath $dirPath -File -Force)) {
        if (($f.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            $skippedEntries += $f.FullName
            continue
        }
        $lowerName = $f.Name.ToLowerInvariant()
        if ($lowerName -eq 'desktop.ini' -or $lowerName -eq 'thumbs.db' -or $lowerName -eq '.ds_store' -or $lowerName.Contains(':zone.identifier')) {
            $skippedEntries += $f.FullName
            continue
        }
        $relFile = ($f.FullName.Substring($StagingDir.Length).TrimStart('\', '/')) -replace '\\', '/'
        if ($relFile -match '(^|/)node_modules/\.bin/') {
            $skippedEntries += $relFile
            continue
        }
        $portableCandidates += [PSCustomObject]@{
            FullPath = $f.FullName
            RelPath  = $relFile
        }
    }
}

$portableCandidates = @($portableCandidates | Sort-Object -Property RelPath)
$portablePreExisted = Test-Path -LiteralPath $PortableZipPath -PathType Leaf
$portShaBefore = if ($portablePreExisted) { Get-FileSha256Hex -Path $PortableZipPath } else { $null }

if ($portablePreExisted -and -not $Force) {
    Write-Host '[2/4] Existing vigor_api-portable.zip found; preserving untouched (pass -Force to rebuild)...'
}
else {
    Write-Host '[2/4] Building conservative portable ZIP (vigor_api-portable.zip) with forward slashes & zero symlinks...'
    if ($portablePreExisted) {
        Remove-Item -LiteralPath $PortableZipPath -Force
    }

    $fixedUtc = New-Object System.DateTimeOffset(2026, 11, 20, 0, 0, 0, [System.TimeSpan]::Zero)
    $fsOut = [System.IO.File]::Open($PortableZipPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $zipArchive = New-Object System.IO.Compression.ZipArchive($fsOut, [System.IO.Compression.ZipArchiveMode]::Create, $false)
        try {
            foreach ($item in $portableCandidates) {
                # Explicit '/' forward slashes prevent .NET Framework 4.x UseBackslash quirk on PS 5.1
                $entry = $zipArchive.CreateEntry($item.RelPath, [System.IO.Compression.CompressionLevel]::Optimal)
                $entry.LastWriteTime = $fixedUtc
                if ($null -ne $entry.PSObject.Properties['ExternalAttributes']) {
                    $entry.ExternalAttributes = 0x20
                }
                $entryStream = $entry.Open()
                try {
                    $srcStream = [System.IO.File]::OpenRead($item.FullPath)
                    try {
                        $srcStream.CopyTo($entryStream)
                    }
                    finally { $srcStream.Dispose() }
                }
                finally { $entryStream.Dispose() }
            }
        }
        finally {
            $zipArchive.Dispose()
        }
    }
    finally {
        $fsOut.Dispose()
    }
}

Write-Host '[3/4] Running forensic audit & clean extraction check on vigor_api-portable.zip...'
$portAudit = Inspect-ZipRawHeaders -ZipFile $PortableZipPath
if ($portablePreExisted -and -not $Force -and $portAudit.Sha256 -ne $portShaBefore) {
    throw "Integrity violation: existing portable ZIP SHA-256 changed ($portShaBefore != $($portAudit.Sha256))."
}
Print-AuditSummary -Report $portAudit

if (@($portAudit.BackslashEntries).Count -gt 0 -or
    @($portAudit.WrappingParentEntries).Count -gt 0 -or
    @($portAudit.AbsoluteOrTraversal).Count -gt 0 -or
    @($portAudit.DuplicateEntries).Count -gt 0 -or
    @($portAudit.CaseCollisions).Count -gt 0 -or
    @($portAudit.UnsupportedCompression).Count -gt 0 -or
    @($portAudit.EncryptedEntries).Count -gt 0 -or
    @($portAudit.DataDescriptorEntries).Count -gt 0 -or
    @($portAudit.SymlinkEntries).Count -gt 0 -or
    @($portAudit.NodeBinEntries).Count -gt 0 -or
    @($portAudit.WindowsJunkEntries).Count -gt 0 -or
    @($portAudit.CrcMismatches).Count -gt 0 -or
    $portAudit.HasZip64) {
    Remove-Item -LiteralPath $PortableZipPath -Force
    throw 'Portable ZIP failed one or more strict Linux unzip compatibility gates.'
}

$tempExtract = Join-Path ([System.IO.Path]::GetTempPath()) ('vigor_extract_' + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempExtract -Force | Out-Null
try {
    [System.IO.Compression.ZipFile]::ExtractToDirectory($PortableZipPath, $tempExtract)
    $extractedFiles = @(Get-ChildItem -LiteralPath $tempExtract -Recurse -File -Force | ForEach-Object {
        ($_.FullName.Substring($tempExtract.Length).TrimStart('\', '/')) -replace '\\', '/'
    } | Sort-Object)
    $expectedFiles = @($portableCandidates | ForEach-Object { $_.RelPath } | Sort-Object)
    $diff = Compare-Object -ReferenceObject $expectedFiles -DifferenceObject $extractedFiles
    if ($null -ne $diff) {
        throw 'Extracted portable file tree does not match staging candidate tree.'
    }

    Write-Host '[4/4] Verifying extracted dist/server/catalystEntry.js ESM load & fail-closed 503 probe...'
    $esmScript = @'
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const rootDir = path.resolve(process.argv[1]);
const mod = await import(pathToFileURL(path.join(rootDir, 'dist', 'server', 'catalystEntry.js')).href);
if (typeof mod.default !== 'function' || typeof mod.catalystAdvancedIoEntry !== 'function') {
  throw new Error('Extracted entrypoint missing default / catalystAdvancedIoEntry');
}
let status = 0;
let body = '';
const mockRes = { statusCode: 200, setHeader(){}, end(c){ status = mockRes.statusCode; body = String(c || ''); } };
mod.default({ headers: {}, method: 'GET', url: '/health' }, mockRes);
if (status !== 503 || !body.includes('SERVER_CONFIGURATION_UNAVAILABLE')) {
  throw new Error(`Expected fail-closed 503 probe on extracted portable entry, got ${status}: ${body}`);
}
console.log('PORTABLE_EXTRACTED_ESM_OK');
'@
    $tmpProbe = Join-Path $ArtifactsDir '.validate-vigor-portable-extracted.mjs'
    try {
        Write-Utf8NoBom -Path $tmpProbe -Content $esmScript
        Invoke-ExternalCommand -Executable 'node' -Arguments @($tmpProbe, $tempExtract)
    }
    finally {
        if (Test-Path -LiteralPath $tmpProbe) { Remove-Item -LiteralPath $tmpProbe -Force }
    }
}
finally {
    if (Test-Path -LiteralPath $tempExtract) {
        Remove-Item -LiteralPath $tempExtract -Recurse -Force
    }
}

Write-Host ("SUCCESS : Portable archive '{0}' verified ({1} entries, skipped={2})." -f $PortableZipPath, $portAudit.TotalEntries, @($skippedEntries).Count)
Write-Host ("PRESERVED: Original archive '{0}' untouched (SHA-256 {1})." -f $OriginalZipPath, $origAudit.Sha256)
Write-Host ("PORTABLE : Portable archive '{0}' ready     (SHA-256 {1})." -f $PortableZipPath, $portAudit.Sha256)
exit 0
