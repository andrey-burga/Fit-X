# =============================================================================
# VIGORCORE ETL -- ENDURECIMIENTO DE ACL EN DOS ETAPAS CON RESPALDO SDDL
# Archivo: poc/catalyst-3-2/scripts/secure-firestore-cache-root.ps1
# Version: 2.0.0 (Fase 3.5.0.6: Procedimiento en Dos Etapas y Rollback SDDL)
# Compatibilidad: Windows PowerShell 5.1+
#
# ETAPA 1 (-Stage 1): Aislamiento exclusivo de control\ con SetAccessRuleProtection($true, $true)
# ETAPA 2 (-Stage 2): Endurecimiento de la raiz con SetAccessRuleProtection($true, $false)
# =============================================================================

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [ValidateSet(1, 2, 'All')]
    $Stage = 1,

    [Parameter(Mandatory = $false)]
    [string]$CacheRootDir,

    [Parameter(Mandatory = $false)]
    [switch]$ConfirmStage1,

    [Parameter(Mandatory = $false)]
    [switch]$ConfirmStage2,

    [Parameter(Mandatory = $false)]
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

Write-Host '========================================================================' -ForegroundColor Cyan
Write-Host 'VIGORCORE ETL -- ENDURECIMIENTO ACL EN DOS ETAPAS (.data\firestore-export)' -ForegroundColor Cyan
Write-Host '========================================================================' -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# FUNCIONES AUXILIARES DE SEGURIDAD Y SDDL
# -----------------------------------------------------------------------------
function Get-FileSha256Hex {
    param ([string]$FilePath)
    $bytes = [System.IO.File]::ReadAllBytes($FilePath)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    $hash = $hasher.ComputeHash($bytes)
    return [System.BitConverter]::ToString($hash).Replace('-', '').ToLower()
}

function Get-StringSha256Hex {
    param ([string]$InputString)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($InputString)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    $hash = $hasher.ComputeHash($bytes)
    return [System.BitConverter]::ToString($hash).Replace('-', '').ToLower()
}

function Test-ReparsePointOrSymlink {
    param ([string]$PathToCheck)
    $dirInfo = New-Object System.IO.DirectoryInfo($PathToCheck)
    $isReparse = ($dirInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
    return $isReparse
}

function Test-CanonicalAceOrdering {
    param ([System.Security.AccessControl.DirectorySecurity]$AclObject)
    # En Windows canonical ordering:
    # 1. Deny explícito antes de Allow explícito
    # 2. Deny heredado antes de Allow heredado
    $seenExplicitAllow = $false
    $seenInherited = $false
    $seenInheritedAllow = $false

    foreach ($ace in $AclObject.Access) {
        $isInherited = $ace.IsInherited
        $isDeny = ($ace.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny)
        $isAllow = ($ace.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow)

        if (-not $isInherited) {
            if ($seenInherited) { return $false } # Regla explicita despues de heredada
            if ($isAllow) { $seenExplicitAllow = $true }
            if ($isDeny -and $seenExplicitAllow) { return $false } # Deny explicito despues de Allow explicito
        } else {
            $seenInherited = $true
            if ($isAllow) { $seenInheritedAllow = $true }
            if ($isDeny -and $seenInheritedAllow) { return $false } # Deny heredado despues de Allow heredado
        }
    }
    return $true
}

# -----------------------------------------------------------------------------
# DETERMINACION DE RUTAS
# -----------------------------------------------------------------------------
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$pocDir = Split-Path -Parent $scriptDir

if (-not $CacheRootDir) {
    $CacheRootDir = Join-Path $pocDir '.data\firestore-export'
}

$resolvedCacheRoot = [System.IO.Path]::GetFullPath($CacheRootDir)
$controlDir = Join-Path $resolvedCacheRoot 'control'

Write-Host ('Ruta raiz cache : ' + $resolvedCacheRoot)
Write-Host ('Ruta control\   : ' + $controlDir)
Write-Host ('Etapa solicitada: ' + $Stage)
Write-Host ''

# 1. Verificacion de existencia de rutas
if (-not (Test-Path -Path $resolvedCacheRoot)) {
    throw ('BLOQUEO: El directorio de cache no existe: ' + $resolvedCacheRoot)
}
if (-not (Test-Path -Path $controlDir)) {
    throw ('BLOQUEO: El subdirectorio control\ no existe: ' + $controlDir)
}

# 2. Comprobacion de enlaces simbolicos o reparse points
if (Test-ReparsePointOrSymlink -PathToCheck $resolvedCacheRoot) {
    throw ('BLOQUEO DE SEGURIDAD: La raiz del cache es un enlace simbolico o punto de reanalisis: ' + $resolvedCacheRoot)
}
if (Test-ReparsePointOrSymlink -PathToCheck $controlDir) {
    throw ('BLOQUEO DE SEGURIDAD: El directorio control\ es un enlace simbolico o punto de reanalisis: ' + $controlDir)
}

# Rutas de archivos de respaldo SDDL inmutables
$rootBackupSddlPath    = Join-Path $controlDir 'root-original-sddl.txt'
$rootBackupShaPath     = Join-Path $controlDir 'root-original-sddl.sha256'
$controlBackupSddlPath = Join-Path $controlDir 'control-original-sddl.txt'
$controlBackupShaPath  = Join-Path $controlDir 'control-original-sddl.sha256'
$stage1BackupSddlPath  = Join-Path $controlDir 'stage1-control-sddl.txt'
$stage1BackupShaPath   = Join-Path $controlDir 'stage1-control-sddl.sha256'

# -----------------------------------------------------------------------------
# ETAPA 1: AISLAMIENTO EXCLUSIVO DE control/
# -----------------------------------------------------------------------------
if ($Stage -eq 1 -or $Stage -eq 'All') {
    Write-Host '========================================================================' -ForegroundColor Cyan
    Write-Host '[ETAPA 1/2] AISLAMIENTO EXCLUSIVO DE control\ (SetAccessRuleProtection $true, $true)' -ForegroundColor Cyan
    Write-Host '========================================================================' -ForegroundColor Cyan

    # 1.1 Inspeccion de ACEs actuales y canonical ordering
    Write-Host ' - Inspeccionando ACEs actuales de control\...' -NoNewline
    $currentControlAcl = Get-Acl -Path $controlDir
    $isCanonical = Test-CanonicalAceOrdering -AclObject $currentControlAcl
    if (-not $isCanonical) {
        Write-Host ' NO CANONICO' -ForegroundColor Yellow
        Write-Host '   [AVISO]: El orden de ACEs contiene anomalías no canónicas.' -ForegroundColor Yellow
    } else {
        Write-Host ' OK (Orden canónico)' -ForegroundColor Green
    }

    # 1.2 Respaldo previo inmutable de SDDLs de root y control (sin sobrescribir)
    Write-Host ' - Verificando respaldos iniciales de SDDL...' -NoNewline
    $currentRootAcl = Get-Acl -Path $resolvedCacheRoot
    $currentRootSddl = $currentRootAcl.Sddl
    $currentControlSddl = $currentControlAcl.Sddl

    # Escritura de respaldos iniciales solo si no existen previamente
    if (-not (Test-Path -Path $rootBackupSddlPath)) {
        [System.IO.File]::WriteAllText($rootBackupSddlPath, $currentRootSddl, (New-Object System.Text.UTF8Encoding($false)))
        $rootHash = Get-StringSha256Hex -InputString $currentRootSddl
        [System.IO.File]::WriteAllText($rootBackupShaPath, $rootHash, (New-Object System.Text.UTF8Encoding($false)))
    }
    if (-not (Test-Path -Path $controlBackupSddlPath)) {
        [System.IO.File]::WriteAllText($controlBackupSddlPath, $currentControlSddl, (New-Object System.Text.UTF8Encoding($false)))
        $ctrlHash = Get-StringSha256Hex -InputString $currentControlSddl
        [System.IO.File]::WriteAllText($controlBackupShaPath, $ctrlHash, (New-Object System.Text.UTF8Encoding($false)))
    }
    Write-Host ' RESPALDADOS Y VERIFICADOS' -ForegroundColor Green

    # Validar integridad SHA-256 de los respaldos leidos desde disco
    $diskRootSddl = [System.IO.File]::ReadAllText($rootBackupSddlPath, (New-Object System.Text.UTF8Encoding($false)))
    $diskRootSha  = ([System.IO.File]::ReadAllText($rootBackupShaPath, (New-Object System.Text.UTF8Encoding($false)))).Trim()
    if ((Get-StringSha256Hex -InputString $diskRootSddl) -ne $diskRootSha) {
        throw 'ERROR CRITICO: Corrupcion detectada en el archivo de respaldo root-original-sddl.txt.'
    }

    $diskControlSddl = [System.IO.File]::ReadAllText($controlBackupSddlPath, (New-Object System.Text.UTF8Encoding($false)))
    $diskControlSha  = ([System.IO.File]::ReadAllText($controlBackupShaPath, (New-Object System.Text.UTF8Encoding($false)))).Trim()
    if ((Get-StringSha256Hex -InputString $diskControlSddl) -ne $diskControlSha) {
        throw 'ERROR CRITICO: Corrupcion detectada en el archivo de respaldo control-original-sddl.txt.'
    }

    # 1.3 Verificacion de confirmacion explicita para Etapa 1
    if (-not $ConfirmStage1) {
        Write-Host ''
        Write-Host 'ATENCION: La Etapa 1 deshabilitara la herencia de control\ preservando' -ForegroundColor Yellow
        Write-Host 'sus reglas actuales como explicitas protegidas.' -ForegroundColor Yellow
        $promptResponse = Read-Host 'Escriba "CONFIRMAR_ETAPA_1" para proceder con el aislamiento de control\'
        if ($promptResponse -ne 'CONFIRMAR_ETAPA_1') {
            Write-Host 'OPERACION CANCELADA POR EL OPERADOR EN ETAPA 1. Permisos intactos.' -ForegroundColor Yellow
            return
        }
    } else {
        Write-Host ' - Confirmacion de Etapa 1 otorgada via switch -ConfirmStage1.' -ForegroundColor Green
    }

    if ($WhatIf) {
        Write-Host 'MODO WHATIF ACTIVO: Se omite la aplicacion de permisos de Etapa 1.' -ForegroundColor Cyan
        if ($Stage -ne 'All') { return }
    } else {
        # 1.4 Ejecutar SetAccessRuleProtection($true, $true) sobre control\
        Write-Host ' - Aplicando SetAccessRuleProtection($true, $true) en control\...' -NoNewline
        $aclStage1 = Get-Acl -Path $controlDir
        $aclStage1.SetAccessRuleProtection($true, $true)
        Set-Acl -Path $controlDir -AclObject $aclStage1
        Write-Host ' OK' -ForegroundColor Green

        # 1.5 Verificaciones post-Etapa 1
        $verControlAcl = Get-Acl -Path $controlDir
        if (-not $verControlAcl.AreAccessRulesProtected) {
            throw 'FALLA DE ETAPA 1: AreAccessRulesProtected sigue siendo False en control\.'
        }
        Write-Host ' - Verificacion AreAccessRulesProtected en control\: TRUE' -ForegroundColor Green

        # 1.6 Guardar snapshot SDDL post-Etapa 1 de control\
        $stage1Sddl = $verControlAcl.Sddl
        [System.IO.File]::WriteAllText($stage1BackupSddlPath, $stage1Sddl, (New-Object System.Text.UTF8Encoding($false)))
        $stage1Sha = Get-StringSha256Hex -InputString $stage1Sddl
        [System.IO.File]::WriteAllText($stage1BackupShaPath, $stage1Sha, (New-Object System.Text.UTF8Encoding($false)))

        # 1.7 Verificar que la raiz NO fue modificada durante Etapa 1
        $postStage1RootAcl = Get-Acl -Path $resolvedCacheRoot
        if ($postStage1RootAcl.Sddl -ne $currentRootSddl) {
            throw 'FALLA DE CONTENCION EN ETAPA 1: La ACL de la raiz fue alterada indebidamente.'
        }
        Write-Host ' - Verificacion de raiz inalterada durante Etapa 1: IDENTICA' -ForegroundColor Green

        Write-Host ''
        Write-Host '========================================================================' -ForegroundColor Green
        Write-Host 'ETAPA 1 COMPLETADA EXITOSAMENTE: control\ AISLADO Y PROTEGIDO' -ForegroundColor Green
        Write-Host '========================================================================' -ForegroundColor Green
    }
}

# -----------------------------------------------------------------------------
# ETAPA 2: ENDURECIMIENTO DE LA RAIZ (.data\firestore-export)
# -----------------------------------------------------------------------------
if ($Stage -eq 2 -or $Stage -eq 'All') {
    Write-Host ''
    Write-Host '========================================================================' -ForegroundColor Cyan
    Write-Host '[ETAPA 2/2] ENDURECIMIENTO DE LA RAIZ (.data\firestore-export)' -ForegroundColor Cyan
    Write-Host '========================================================================' -ForegroundColor Cyan

    # 2.1 Verificar que Etapa 1 fue completada satisfactoriamente
    Write-Host ' - Comprobando pre-requisito: proteccion activa en control\...' -NoNewline
    $checkControlAcl = Get-Acl -Path $controlDir
    if (-not $checkControlAcl.AreAccessRulesProtected) {
        Write-Host ' NO PROTEGIDO' -ForegroundColor Red
        throw 'BLOQUEO: Etapa 2 rechazada. control\ no tiene herencia deshabilitada (Etapa 1 pendiente).'
    }
    Write-Host ' OK (AreAccessRulesProtected = True)' -ForegroundColor Green

    # 2.2 Verificar integridad SHA-256 de respaldos
    Write-Host ' - Verificando integridad de respaldos SDDL...' -NoNewline
    if (-not (Test-Path -Path $stage1BackupSddlPath) -or -not (Test-Path -Path $stage1BackupShaPath)) {
        throw 'BLOQUEO: No se encontraron los respaldos SDDL de la Etapa 1 en control\.'
    }
    $expectedStage1Sddl = [System.IO.File]::ReadAllText($stage1BackupSddlPath, (New-Object System.Text.UTF8Encoding($false)))
    $expectedStage1Sha  = ([System.IO.File]::ReadAllText($stage1BackupShaPath, (New-Object System.Text.UTF8Encoding($false)))).Trim()
    if ((Get-StringSha256Hex -InputString $expectedStage1Sddl) -ne $expectedStage1Sha) {
        throw 'ERROR CRITICO: El hash SHA-256 del respaldo stage1-control-sddl.txt no coincide.'
    }
    Write-Host ' OK (Hashes integros)' -ForegroundColor Green

    # 2.3 Verificar ausencia de archivos y directorios inesperados en la raiz
    Write-Host ' - Verificando contenido del directorio raiz...' -NoNewline
    $allItems = @(Get-ChildItem -Path $resolvedCacheRoot -Force -ErrorAction SilentlyContinue)
    $files = @($allItems | Where-Object { -not $_.PSIsContainer })
    $dirs  = @($allItems | Where-Object { $_.PSIsContainer })

    if ($files.Count -gt 0) {
        throw ('BLOQUEO DE SEGURIDAD: La raiz contiene {0} archivo(s). Debe estar vacia de documentos.' -f $files.Count)
    }
    if ($dirs.Count -ne 1 -or $dirs[0].Name -ne 'control') {
        throw 'BLOQUEO DE SEGURIDAD: La raiz contiene subdirectorios inesperados. Solo se autoriza control\.'
    }
    Write-Host ' OK (0 archivos, 1 subdirectorio autorizado)' -ForegroundColor Green

    # 2.4 Verificacion de confirmacion explicita para Etapa 2
    if (-not $ConfirmStage2) {
        Write-Host ''
        Write-Host 'ATENCION: La Etapa 2 deshabilitara la herencia de la raiz de cache,' -ForegroundColor Yellow
        Write-Host 'removiendo el acceso a BUILTIN\Users y otorgando acceso exclusivo a' -ForegroundColor Yellow
        Write-Host 'CurrentUser, SYSTEM y BUILTIN\Administrators.' -ForegroundColor Yellow
        $promptResponse2 = Read-Host 'Escriba "CONFIRMAR_ETAPA_2" para proceder con el endurecimiento de la raiz'
        if ($promptResponse2 -ne 'CONFIRMAR_ETAPA_2') {
            Write-Host 'OPERACION CANCELADA POR EL OPERADOR EN ETAPA 2. Raiz intacta.' -ForegroundColor Yellow
            return
        }
    } else {
        Write-Host ' - Confirmacion de Etapa 2 otorgada via switch -ConfirmStage2.' -ForegroundColor Green
    }

    if ($WhatIf) {
        Write-Host 'MODO WHATIF ACTIVO: Se omite la aplicacion de permisos de Etapa 2.' -ForegroundColor Cyan
        return
    }

    # 2.5 Construir la ACL endurecida para la raiz
    Write-Host ' - Aplicando ACL endurecida y exclusiva en la raiz...' -NoNewline
    $currentUserIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $currentUserName = $currentUserIdentity.Name

    $targetRootAcl = New-Object System.Security.AccessControl.DirectorySecurity
    # Deshabilitar herencia y remover reglas heredadas de la raiz
    $targetRootAcl.SetAccessRuleProtection($true, $false)
    $targetRootAcl.SetOwner($currentUserIdentity.User)

    $ruleInheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $rulePropagation = [System.Security.AccessControl.PropagationFlags]::None
    $ruleAccessType  = [System.Security.AccessControl.AccessControlType]::Allow

    $targetRootAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        $currentUserName,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        $ruleInheritance, $rulePropagation, $ruleAccessType
    )))
    $targetRootAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        'NT AUTHORITY\SYSTEM',
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        $ruleInheritance, $rulePropagation, $ruleAccessType
    )))
    $targetRootAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        'BUILTIN\Administrators',
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        $ruleInheritance, $rulePropagation, $ruleAccessType
    )))

    # Aplicar estrictamente sobre la raiz (sin recursion)
    [System.IO.Directory]::SetAccessControl($resolvedCacheRoot, $targetRootAcl)
    Write-Host ' OK' -ForegroundColor Green

    # 2.6 Verificacion de herencia deshabilitada en la raiz y exclusion de Users
    Write-Host ' - Verificando permisos de la raiz post-endurecimiento...' -NoNewline
    $verifiedRootAcl = Get-Acl -Path $resolvedCacheRoot
    if (-not $verifiedRootAcl.AreAccessRulesProtected) {
        throw 'FALLA CRITICA: La herencia no quedo deshabilitada en la raiz de cache.'
    }
    foreach ($ar in $verifiedRootAcl.Access) {
        if ($ar.IdentityReference.Value -match 'Everyone|Todos|Users|Usuarios|BUILTIN\\Users') {
            throw ('FALLA DE AISLAMIENTO: Permiso no autorizado detectado en raiz: ' + $ar.IdentityReference.Value)
        }
    }
    Write-Host ' OK (Herencia protegida y cero Users)' -ForegroundColor Green

    # 2.7 Verificacion de no-regresion: El SDDL de control\ debe mantenerse identico al de Etapa 1
    Write-Host ' - Verificando preservacion del SDDL de control\...' -NoNewline
    $postStage2ControlAcl = Get-Acl -Path $controlDir
    $postStage2ControlSddl = $postStage2ControlAcl.Sddl

    if ($postStage2ControlSddl -ne $expectedStage1Sddl) {
        throw 'FALLA DE CONTENCION: La ACL de control\ sufrio mutaciones tras la Etapa 2.'
    }
    Write-Host ' OK (SDDL de control\ identico y preservado)' -ForegroundColor Green

    # 2.8 Sondeo funcional de I/O
    Write-Host ' - Ejecutando prueba de sondeo I/O...' -NoNewline
    $probeFile = Join-Path $resolvedCacheRoot ('.probe-' + [System.Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [System.IO.File]::WriteAllText($probeFile, 'VIGORCORE_PROBE_STAGE2_OK')
        $readText = [System.IO.File]::ReadAllText($probeFile)
        if ($readText -ne 'VIGORCORE_PROBE_STAGE2_OK') {
            throw 'Discrepancia de contenido en prueba de sondeo I/O.'
        }
        Remove-Item -Path $probeFile -Force
        Write-Host ' OK' -ForegroundColor Green
    } catch {
        if (Test-Path -Path $probeFile) { Remove-Item -Path $probeFile -Force -ErrorAction SilentlyContinue }
        throw ('Falla en prueba de sondeo I/O: ' + $_.Exception.Message)
    }

    Write-Host ''
    Write-Host '========================================================================' -ForegroundColor Green
    Write-Host 'DICTAMEN: CACHE_ROOT_HARDENED -- ENDURECIMIENTO EN DOS ETAPAS EXITOSO' -ForegroundColor Green
    Write-Host '========================================================================' -ForegroundColor Green
}
