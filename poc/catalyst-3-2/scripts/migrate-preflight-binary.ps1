# =============================================================================
# VIGORCORE ETL — MIGRACION DE PREFLIGHT BINARIO HACIA CACHE DEFINITIVO
# Archivo: poc/catalyst-3-2/scripts/migrate-preflight-binary.ps1
# Version: 1.0.0
# Compatibilidad: Windows PowerShell 5.1+
# Objetivo: Reubicar de forma segura preflight-token.bin desde reports/ hacia
#           .data/firestore-export/control/, verificando hash SHA-256 antes y despues.
# =============================================================================

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$pocDir = Split-Path -Parent $scriptDir

$sourcePath = Join-Path $pocDir 'reports\firestore-extraction-3.5\preflight-token.bin'
$targetDir  = Join-Path $pocDir '.data\firestore-export\control'
$targetPath = Join-Path $targetDir 'preflight-token.bin'

Write-Host '========================================================================' -ForegroundColor Cyan
Write-Host 'VIGORCORE ETL — MIGRACION DE PREFLIGHT-TOKEN.BIN' -ForegroundColor Cyan
Write-Host '========================================================================' -ForegroundColor Cyan

if (-not (Test-Path -Path $sourcePath)) {
    if (Test-Path -Path $targetPath) {
        Write-Host 'AVISO: El archivo preflight-token.bin ya se encuentra en su destino definitivo.' -ForegroundColor Green
        Write-Host ('Destino: ' + $targetPath)
        return
    }
    throw ('BLOQUEO: No se encontro el archivo de origen en ' + $sourcePath)
}

if (-not (Test-Path -Path $targetDir)) {
    Write-Host ' - Creando directorio de control destino...'
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

$sourceBytes = [System.IO.File]::ReadAllBytes($sourcePath)
$hasher = [System.Security.Cryptography.SHA256]::Create()
$sourceHash = [System.BitConverter]::ToString($hasher.ComputeHash($sourceBytes)).Replace('-', '').ToLower()

Write-Host (' - Archivo origen : ' + $sourcePath)
Write-Host (' - SHA-256 origen : ' + $sourceHash)
Write-Host (' - Tamaño origen  : ' + $sourceBytes.Length + ' bytes')

# Copia inicial atómica
[System.IO.File]::WriteAllBytes($targetPath, $sourceBytes)

$targetBytes = [System.IO.File]::ReadAllBytes($targetPath)
$targetHash = [System.BitConverter]::ToString($hasher.ComputeHash($targetBytes)).Replace('-', '').ToLower()

if ($targetHash -ne $sourceHash) {
    Remove-Item -Path $targetPath -Force
    throw 'ERROR CRITICO: Discrepancia de SHA-256 tras la copia. Operacion abortada.'
}

# Remover origen
Remove-Item -Path $sourcePath -Force

Write-Host ''
Write-Host '========================================================================' -ForegroundColor Green
Write-Host 'MIGRACION COMPLETADA EXITOSAMENTE' -ForegroundColor Green
Write-Host ('Nuevo archivo : ' + $targetPath)
Write-Host ('SHA-256 verif : ' + $targetHash)
Write-Host '========================================================================' -ForegroundColor Green
