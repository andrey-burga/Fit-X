# =============================================================================
# VIGORCORE ETL — SCRIPT DE ENDURECIMIENTO ACL DEL CACHE DEFINITIVO
# Archivo: poc/catalyst-3-2/scripts/secure-firestore-cache-root.ps1
# Version: 1.0.0
# Compatibilidad: Windows PowerShell 5.1+
# Objetivo: Aislar .data/firestore-export/ deshabilitando herencia y garantizando
#           acceso exclusivo para CurrentUser, SYSTEM y BUILTIN\Administrators.
# Regla Crítica: NO RECURSIVO. Preserva íntegramente la ACL de control/.
# =============================================================================

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [string]$CacheRootDir,

    [Parameter(Mandatory = $false)]
    [switch]$OperatorConfirmed,

    [Parameter(Mandatory = $false)]
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

Write-Host '========================================================================' -ForegroundColor Cyan
Write-Host 'VIGORCORE ETL — ENDURECIMIENTO ACL DE CACHE DEFINITIVO (.data\firestore-export)' -ForegroundColor Cyan
Write-Host '========================================================================' -ForegroundColor Cyan

# 1. Determinación de rutas
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$pocDir = Split-Path -Parent $scriptDir

if (-not $CacheRootDir) {
    $CacheRootDir = Join-Path $pocDir '.data\firestore-export'
}

$resolvedCacheRoot = [System.IO.Path]::GetFullPath($CacheRootDir)
$controlDir = Join-Path $resolvedCacheRoot 'control'

Write-Host ('Ruta de cache definitivo : ' + $resolvedCacheRoot)
Write-Host ('Ruta de subdirectorio    : ' + $controlDir)
Write-Host ''

# 2. Verificación de existencia del directorio
if (-not (Test-Path -Path $resolvedCacheRoot)) {
    throw ('BLOQUEO: El directorio de cache no existe: ' + $resolvedCacheRoot)
}

# 3. Inspección de seguridad: Garantizar que no hay archivos inesperados
Write-Host '[1/6] Inspeccionando contenido existente del cache...' -NoNewline
$allItems = Get-ChildItem -Path $resolvedCacheRoot -Force -ErrorAction SilentlyContinue
$cacheFiles = $allItems | Where-Object { -not $_.PSIsContainer }
$cacheDirs  = $allItems | Where-Object { $_.PSIsContainer }

$fileCount = if ($cacheFiles) { $cacheFiles.Count } else { 0 }
$dirCount  = if ($cacheDirs)  { $cacheDirs.Count } else { 0 }

if ($fileCount -gt 0) {
    Write-Host ' ALERTA' -ForegroundColor Red
    throw ('BLOQUEO DE SEGURIDAD: El directorio contiene {0} archivo(s). Debe estar vacio o contener unicamente control\.' -f $fileCount)
}

if ($dirCount -gt 1) {
    Write-Host ' ALERTA' -ForegroundColor Red
    throw ('BLOQUEO DE SEGURIDAD: Se detectaron {0} subdirectorios inesperados. Unicamente se permite control\.' -f $dirCount)
}

if ($dirCount -eq 1 -and $cacheDirs[0].Name -ne 'control') {
    Write-Host ' ALERTA' -ForegroundColor Red
    throw ('BLOQUEO DE SEGURIDAD: Subdirectorio no reconocido: ' + $cacheDirs[0].Name)
}
Write-Host (' OK (0 archivos, {0} subdirectorios autorizados)' -f $dirCount) -ForegroundColor Green

# 4. Asegurar existencia de control/ para alojar respaldos
if (-not (Test-Path -Path $controlDir)) {
    Write-Host ' - Creando subdirectorio control\ para respaldos...'
    New-Item -ItemType Directory -Path $controlDir -Force | Out-Null
}

# Registrar ACL previa de control\ para verificación posterior de no-regresión
$initialControlAcl = Get-Acl -Path $controlDir
$initialControlSddl = $initialControlAcl.Sddl

# 5. Lectura y respaldo de la ACL actual del directorio raíz
Write-Host '[2/6] Leyendo y respaldando ACL original...' -NoNewline
$originalAcl = Get-Acl -Path $resolvedCacheRoot
$originalSddl = $originalAcl.Sddl

$backupXmlPath  = Join-Path $controlDir 'cache-root-acl-backup.xml'
$backupSddlPath = Join-Path $controlDir 'cache-root-sddl-backup.txt'

$originalAcl | Export-Clixml -Path $backupXmlPath -Force
$originalSddl | Out-File -FilePath $backupSddlPath -Encoding UTF8 -Force
Write-Host ' RESPALDADO' -ForegroundColor Green
Write-Host ('   - Backup XML  : ' + $backupXmlPath)
Write-Host ('   - Backup SDDL : ' + $backupSddlPath)
Write-Host ('   - SDDL actual : ' + $originalSddl)

# 6. Verificación de confirmación del operador
Write-Host ''
Write-Host '[3/6] Verificando autorizacion explicita del operador...'
if (-not $OperatorConfirmed) {
    Write-Host 'ATENCION: Esta operacion deshabilitara la herencia de permisos NTFS' -ForegroundColor Yellow
    Write-Host 'en el directorio raiz de cache y removera el acceso para BUILTIN\Users.' -ForegroundColor Yellow
    $promptResponse = Read-Host 'Desea proceder con el endurecimiento de ACL? (Escriba "CONFIRMAR" para continuar)'
    if ($promptResponse -ne 'CONFIRMAR') {
        Write-Host 'OPERACION CANCELADA POR EL OPERADOR. Ningun permiso fue alterado.' -ForegroundColor Yellow
        return
    }
} else {
    Write-Host ' - Confirmacion otorgada mediante switch -OperatorConfirmed.' -ForegroundColor Green
}

if ($WhatIf) {
    Write-Host 'MODO WHATIF ACTIVO: Se omiten las escrituras de ACL.' -ForegroundColor Cyan
    return
}

# 7. Construcción de la nueva ACL endurecida
Write-Host ''
Write-Host '[4/6] Aplicando politica de acceso exclusivo NTFS...'
$currentUserIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentUserName = $currentUserIdentity.Name

Write-Host (' - Usuario en ejecucion : ' + $currentUserName)

# Instanciamos una nueva DirectorySecurity limpia o basada en la actual
$targetAcl = New-Object System.Security.AccessControl.DirectorySecurity

# Deshabilitar herencia y remover reglas heredadas (isProtected = $true, preserveInheritance = $false)
$targetAcl.SetAccessRuleProtection($true, $false)

# Establecer propietario explícito
$targetAcl.SetOwner($currentUserIdentity.User)

# Reglas de FullControl con herencia hacia elementos secundarios dentro de la raíz
$ruleInheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
$rulePropagation = [System.Security.AccessControl.PropagationFlags]::None
$ruleAccessType  = [System.Security.AccessControl.AccessControlType]::Allow

# 1. Regla para CurrentUser
$ruleUser = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $currentUserName,
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    $ruleInheritance,
    $rulePropagation,
    $ruleAccessType
)
$targetAcl.AddAccessRule($ruleUser)

# 2. Regla para NT AUTHORITY\SYSTEM
$ruleSystem = New-Object System.Security.AccessControl.FileSystemAccessRule(
    'NT AUTHORITY\SYSTEM',
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    $ruleInheritance,
    $rulePropagation,
    $ruleAccessType
)
$targetAcl.AddAccessRule($ruleSystem)

# 3. Regla para BUILTIN\Administrators
$ruleAdmin = New-Object System.Security.AccessControl.FileSystemAccessRule(
    'BUILTIN\Administrators',
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    $ruleInheritance,
    $rulePropagation,
    $ruleAccessType
)
$targetAcl.AddAccessRule($ruleAdmin)

# Aplicar ACL estrictamente sobre el directorio raíz (sin flag recursivo)
[System.IO.Directory]::SetAccessControl($resolvedCacheRoot, $targetAcl)
Write-Host ' - ACL aplicada exitosamente en directorio raiz.' -ForegroundColor Green

# 8. Verificación forense post-aplicación
Write-Host ''
Write-Host '[5/6] Verificando aislamiento y no-regresion en control\...'
$verifiedRootAcl = Get-Acl -Path $resolvedCacheRoot
$verifiedRootSddl = $verifiedRootAcl.Sddl

Write-Host (' - Nuevo SDDL raiz     : ' + $verifiedRootSddl)
Write-Host (' - Herencia protegida  : ' + $verifiedRootAcl.AreAccessRulesProtected)

# Validar que BUILTIN\Users no tiene ACE
$hasUsersAce = $false
foreach ($ar in $verifiedRootAcl.Access) {
    if ($ar.IdentityReference.Value -match 'Everyone|Todos|Users|Usuarios|BUILTIN\\Users') {
        $hasUsersAce = $true
    }
}
if ($hasUsersAce) {
    throw 'FALLA DE AISLAMIENTO: Se detectaron permisos para Users en el nuevo ACL del cache.'
}
Write-Host ' - Validacion de exclusion de Users: APROBADA (cero ACEs de Users)' -ForegroundColor Green

# Validar que control\ conservo su SDDL inicial
$postControlAcl = Get-Acl -Path $controlDir
$postControlSddl = $postControlAcl.Sddl

if ($postControlSddl -ne $initialControlSddl) {
    Write-Host ' ADVERTENCIA: La ACL de control\ sufrio cambios.' -ForegroundColor Red
    throw 'FALLA DE CONTENCION: La ACL del subdirectorio control\ no se mantuvo identica.'
} else {
    Write-Host ' - Validacion de control\ ACL: IDENTICA Y PRESERVADA' -ForegroundColor Green
}

# 9. Prueba funcional de I/O
Write-Host ''
Write-Host '[6/6] Ejecutando prueba de sondeo I/O en directorio aislado...' -NoNewline
$probeFile = Join-Path $resolvedCacheRoot ('.probe-' + [System.Guid]::NewGuid().ToString('N') + '.tmp')
try {
    [System.IO.File]::WriteAllText($probeFile, 'VIGORCORE_PROBE_OK')
    $readBack = [System.IO.File]::ReadAllText($probeFile)
    if ($readBack -ne 'VIGORCORE_PROBE_OK') {
        throw 'Discrepancia en contenido leido del archivo de prueba'
    }
    Remove-Item -Path $probeFile -Force
    Write-Host ' OK (Lectura/Escritura/Eliminacion verificada)' -ForegroundColor Green
} catch {
    Write-Host ' FALLA' -ForegroundColor Red
    if (Test-Path -Path $probeFile) { Remove-Item -Path $probeFile -Force -ErrorAction SilentlyContinue }
    throw ('Falla de I/O en directorio protegido: ' + $_.Exception.Message)
}

Write-Host ''
Write-Host '========================================================================' -ForegroundColor Green
Write-Host 'DICTAMEN: CACHE_ROOT_HARDENED — AISLAMIENTO COMPLETADO EXITOSAMENTE' -ForegroundColor Green
Write-Host '========================================================================' -ForegroundColor Green
Write-Host 'INSTRUCCIONES DE ROLLBACK (si fuera necesario restaurar):'
Write-Host ('  1. XML  : $b = Import-Clixml -Path "' + $backupXmlPath + '"; Set-Acl -Path "' + $resolvedCacheRoot + '" -AclObject $b')
Write-Host ('  2. SDDL : $s = Get-Content "' + $backupSddlPath + '"; $a = Get-Acl "' + $resolvedCacheRoot + '"; $a.SetSecurityDescriptorSddlForm($s); Set-Acl "' + $resolvedCacheRoot + '" $a')
Write-Host '========================================================================' -ForegroundColor Green
