# =============================================================================
# VIGORCORE ETL -- RESTAURACION SEGURA DE ACL MEDIANTE SDDL PURO (ROLLBACK)
# Archivo: poc/catalyst-3-2/scripts/restore-firestore-cache-acl.ps1
# Version: 1.0.0 (Fase 3.5.0.6: Reversion Nativa via SDDL sin dependencia Clixml)
# Compatibilidad: Windows PowerShell 5.1+
# =============================================================================

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [ValidateSet('All', 'ControlOnly', 'RootOnly')]
    [string]$Target = 'All',

    [Parameter(Mandatory = $false)]
    [string]$CacheRootDir,

    [Parameter(Mandatory = $false)]
    [switch]$ConfirmRollback,

    [Parameter(Mandatory = $false)]
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

Write-Host '========================================================================' -ForegroundColor Cyan
Write-Host 'VIGORCORE ETL -- RECUPERACION Y ROLLBACK DE ACL MEDIANTE SDDL' -ForegroundColor Cyan
Write-Host '========================================================================' -ForegroundColor Cyan

function Get-StringSha256Hex {
    param ([string]$InputString)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($InputString)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    $hash = $hasher.ComputeHash($bytes)
    return [System.BitConverter]::ToString($hash).Replace('-', '').ToLower()
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$pocDir = Split-Path -Parent $scriptDir

if (-not $CacheRootDir) {
    $CacheRootDir = Join-Path $pocDir '.data\firestore-export'
}

$resolvedCacheRoot = [System.IO.Path]::GetFullPath($CacheRootDir)
$controlDir = Join-Path $resolvedCacheRoot 'control'

Write-Host ('Ruta raiz cache : ' + $resolvedCacheRoot)
Write-Host ('Ruta control\   : ' + $controlDir)
Write-Host ('Objetivo Rollback: ' + $Target)
Write-Host ''

# 1. Comprobacion de existencia de directorios
if (-not (Test-Path -Path $resolvedCacheRoot)) {
    throw ('BLOQUEO: El directorio de cache no existe: ' + $resolvedCacheRoot)
}
if (-not (Test-Path -Path $controlDir)) {
    throw ('BLOQUEO: El subdirectorio control\ no existe: ' + $controlDir)
}

$rootBackupSddlPath    = Join-Path $controlDir 'root-original-sddl.txt'
$rootBackupShaPath     = Join-Path $controlDir 'root-original-sddl.sha256'
$controlBackupSddlPath = Join-Path $controlDir 'control-original-sddl.txt'
$controlBackupShaPath  = Join-Path $controlDir 'control-original-sddl.sha256'

# 2. Verificacion de confirmacion explicita de rollback
if (-not $ConfirmRollback) {
    Write-Host 'ATENCION: Esta operacion restaurara los permisos NTFS originales' -ForegroundColor Yellow
    Write-Host 'al estado previo al endurecimiento utilizando los respaldos SDDL.' -ForegroundColor Yellow
    $prompt = Read-Host 'Escriba "CONFIRMAR_ROLLBACK" para proceder con la restauracion'
    if ($prompt -ne 'CONFIRMAR_ROLLBACK') {
        Write-Host 'OPERACION CANCELADA POR EL OPERADOR. Permisos sin cambios.' -ForegroundColor Yellow
        return
    }
} else {
    Write-Host ' - Confirmacion de Rollback otorgada via switch -ConfirmRollback.' -ForegroundColor Green
}

if ($WhatIf) {
    Write-Host 'MODO WHATIF ACTIVO: Se omite la ejecucion de la restauracion.' -ForegroundColor Cyan
    return
}

# -----------------------------------------------------------------------------
# RESTAURACION EN ORDEN ESTRICTO: RAIZ PRIMERO, LUEGO CONTROL
# -----------------------------------------------------------------------------

# 1. Restaurar Raiz si se solicito 'All' o 'RootOnly'
if ($Target -eq 'All' -or $Target -eq 'RootOnly') {
    Write-Host ''
    Write-Host '[1/2] Restaurando descriptor de seguridad de la RAIZ...' -NoNewline
    if (-not (Test-Path -Path $rootBackupSddlPath) -or -not (Test-Path -Path $rootBackupShaPath)) {
        throw 'BLOQUEO: No se encontraron los archivos de respaldo SDDL de la raiz.'
    }

    $rootSddl = [System.IO.File]::ReadAllText($rootBackupSddlPath, (New-Object System.Text.UTF8Encoding($false)))
    $rootSha  = ([System.IO.File]::ReadAllText($rootBackupShaPath, (New-Object System.Text.UTF8Encoding($false)))).Trim()

    if ((Get-StringSha256Hex -InputString $rootSddl) -ne $rootSha) {
        throw 'ERROR CRITICO: Corrupcion de hash en el respaldo root-original-sddl.txt. Rollback abortado.'
    }

    # Aplicar SDDL nativamente via SetSecurityDescriptorSddlForm
    $rootAcl = Get-Acl -Path $resolvedCacheRoot
    $rootAcl.SetSecurityDescriptorSddlForm($rootSddl)
    Set-Acl -Path $resolvedCacheRoot -AclObject $rootAcl

    # Verificar que el SDDL resultante coincide con el respaldo
    $verRootSddl = (Get-Acl -Path $resolvedCacheRoot).Sddl
    if ($verRootSddl -ne $rootSddl) {
        throw 'FALLA DE ROLLBACK: El SDDL de la raiz no coincide con el respaldo original tras la restauracion.'
    }
    Write-Host ' RESTAURADA Y VERIFICADA' -ForegroundColor Green
}

# 2. Restaurar Control si se solicito 'All' o 'ControlOnly'
if ($Target -eq 'All' -or $Target -eq 'ControlOnly') {
    Write-Host ''
    Write-Host '[2/2] Restaurando descriptor de seguridad de CONTROL\...' -NoNewline
    if (-not (Test-Path -Path $controlBackupSddlPath) -or -not (Test-Path -Path $controlBackupShaPath)) {
        throw 'BLOQUEO: No se encontraron los archivos de respaldo SDDL de control\.'
    }

    $ctrlSddl = [System.IO.File]::ReadAllText($controlBackupSddlPath, (New-Object System.Text.UTF8Encoding($false)))
    $ctrlSha  = ([System.IO.File]::ReadAllText($controlBackupShaPath, (New-Object System.Text.UTF8Encoding($false)))).Trim()

    if ((Get-StringSha256Hex -InputString $ctrlSddl) -ne $ctrlSha) {
        throw 'ERROR CRITICO: Corrupcion de hash en el respaldo control-original-sddl.txt. Rollback abortado.'
    }

    # Aplicar SDDL nativamente via SetSecurityDescriptorSddlForm
    $ctrlAcl = Get-Acl -Path $controlDir
    $ctrlAcl.SetSecurityDescriptorSddlForm($ctrlSddl)
    Set-Acl -Path $controlDir -AclObject $ctrlAcl

    # Verificar que el SDDL resultante coincide con el respaldo
    $verCtrlSddl = (Get-Acl -Path $controlDir).Sddl
    if ($verCtrlSddl -ne $ctrlSddl) {
        throw 'FALLA DE ROLLBACK: El SDDL de control\ no coincide con el respaldo original tras la restauracion.'
    }
    Write-Host ' RESTAURADO Y VERIFICADO' -ForegroundColor Green
}

Write-Host ''
Write-Host '========================================================================' -ForegroundColor Green
Write-Host 'ROLLBACK COMPLETADO EXITOSAMENTE MEDIANTE SDDL' -ForegroundColor Green
Write-Host '========================================================================' -ForegroundColor Green
