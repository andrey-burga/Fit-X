<#
.SYNOPSIS
    VigorCore — Fase 3.5.0.3: Procedimiento Seguro de Migración Local del Preflight Binario
.DESCRIPTION
    Reubica de manera segura preflight-token.bin desde la ubicación no permitida
    (reports/firestore-extraction-3.5/preflight-token.bin) hacia la ubicación
    estándar y protegida (.data/firestore-export/control/preflight-token.bin).
    
    Reglas de seguridad:
    - 0 descifrado (mueve el ciphertext intacto).
    - Verificación estricta de hash SHA-256 antes y después de mover.
    - Falla si el archivo de destino ya existe (anti-sobrescritura).
    - Aplica ACLs restrictivas en el subdirectorio control.
    - Cero PII en salida de consola.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$PocRoot = ''
)

$ErrorActionPreference = 'Stop'

Write-Host '========================================================================' -ForegroundColor Cyan
Write-Host ' VIGORCORE -- FASE 3.5.0.3: MIGRACION SEGURA DEL PREFLIGHT BINARIO       ' -ForegroundColor Cyan
Write-Host '========================================================================' -ForegroundColor Cyan

# 1. Determinar directorio raíz de la POC
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($PocRoot)) {
    $pocDir = Split-Path -Parent $scriptDir
} else {
    $pocDir = [System.IO.Path]::GetFullPath($PocRoot)
}

$sourceFile = Join-Path $pocDir 'reports\firestore-extraction-3.5\preflight-token.bin'
$targetDir  = Join-Path $pocDir '.data\firestore-export\control'
$targetFile = Join-Path $targetDir 'preflight-token.bin'

Write-Host (' - Directorio POC:  ' + $pocDir)
Write-Host (' - Archivo origen:  ' + $sourceFile)
Write-Host (' - Destino seguro:  ' + $targetFile)
Write-Host '------------------------------------------------------------------------'

function Compute-FileSha256 {
    param ([string]$Path)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $hashBytes = $hasher.ComputeHash($bytes)
    return [System.BitConverter]::ToString($hashBytes).Replace('-', '').ToLowerInvariant()
}

# Paso 1: Verificar existencia del archivo origen
Write-Host ' [1/12] Verificando existencia del binario antiguo en reports/...' -NoNewline
if (-not (Test-Path -LiteralPath $sourceFile)) {
    Write-Host ' ERROR' -ForegroundColor Red
    throw ('ABORTADO: El archivo origen no existe: ' + $sourceFile)
}
Write-Host ' OK' -ForegroundColor Green

# Paso 2: Verificar tamaño mayor a 0
Write-Host ' [2/12] Verificando tamaño de archivo origen...' -NoNewline
$sourceLength = (Get-Item -LiteralPath $sourceFile).Length
if ($sourceLength -eq 0) {
    Write-Host ' ERROR' -ForegroundColor Red
    throw 'ABORTADO: El archivo origen tiene 0 bytes (vacío).'
}
Write-Host (' OK ({0} bytes)' -f $sourceLength) -ForegroundColor Green

# Paso 3: Calcular hash SHA-256 inicial del ciphertext
Write-Host ' [3/12] Calculando hash SHA-256 inicial del ciphertext...' -NoNewline
$initialHash = Compute-FileSha256 -Path $sourceFile
Write-Host ' OK' -ForegroundColor Green

# Paso 4: Comprobar que no existe archivo de destino previo (anti-sobrescritura)
Write-Host ' [4/12] Comprobando que no exista archivo de destino previo...' -NoNewline
if (Test-Path -LiteralPath $targetFile) {
    Write-Host ' EXISTE' -ForegroundColor Red
    throw ('ABORTADO: El archivo de destino ya existe. Operación cancelada para evitar sobrescrituras: ' + $targetFile)
}
Write-Host ' OK (Destino libre)' -ForegroundColor Green

# Paso 5: Crear subdirectorio control si es necesario
Write-Host ' [5/12] Creando subdirectorio control si es necesario...' -NoNewline
if (-not (Test-Path -LiteralPath $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    Write-Host ' OK (Creado)' -ForegroundColor Green
} else {
    Write-Host ' OK (Ya existía)' -ForegroundColor Green
}

# Paso 6: Aplicar protección ACL restrictiva al subdirectorio control
Write-Host ' [6/12] Aplicando ACL restrictiva al subdirectorio control...' -NoNewline
try {
    $acl = Get-Acl -LiteralPath $targetDir
    $acl.SetAccessRuleProtection($true, $false) # Deshabilitar herencia y remover reglas heredadas
    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $currentUser,
        'FullControl',
        'ContainerInherit,ObjectInherit',
        'None',
        'Allow'
    )
    $acl.ResetAccessRule($rule)
    Set-Acl -LiteralPath $targetDir -AclObject $acl
    Write-Host ' OK (Herencia removida y acceso exclusivo)' -ForegroundColor Green
} catch {
    Write-Host (' ADVERTENCIA (' + $_.Exception.Message + ')') -ForegroundColor Yellow
}

# Paso 7: Comprobar capacidad efectiva de lectura y escritura del usuario
Write-Host ' [7/12] Comprobando capacidad de E/S en subdirectorio control...' -NoNewline
$testProbe = Join-Path $targetDir 'write-probe.tmp'
try {
    [System.IO.File]::WriteAllBytes($testProbe, [byte[]]@(1, 2, 3))
    $readProbe = [System.IO.File]::ReadAllBytes($testProbe)
    Remove-Item -LiteralPath $testProbe -Force
    if ($readProbe.Length -ne 3) { throw 'Longitud no coincide en sondeo de E/S.' }
    Write-Host ' OK' -ForegroundColor Green
} catch {
    Write-Host ' ERROR' -ForegroundColor Red
    throw ('ABORTADO: Falla al verificar permisos de E/S en carpeta control: ' + $_.Exception.Message)
}

# Paso 8: Mover el ciphertext sin descifrar
Write-Host ' [8/12] Moviendo ciphertext a destino...' -NoNewline
Move-Item -LiteralPath $sourceFile -Destination $targetFile -Force
Write-Host ' OK' -ForegroundColor Green

# Paso 9: Comprobar existencia y tamaño del archivo destino
Write-Host ' [9/12] Verificando archivo de destino...' -NoNewline
if (-not (Test-Path -LiteralPath $targetFile)) {
    Write-Host ' ERROR' -ForegroundColor Red
    throw 'ABORTADO: El archivo de destino no fue encontrado tras la operación de mover.'
}
$targetLength = (Get-Item -LiteralPath $targetFile).Length
if ($targetLength -ne $sourceLength) {
    Write-Host ' ERROR' -ForegroundColor Red
    throw ('ABORTADO: El tamaño difiere tras mover ({0} vs {1} bytes).' -f $targetLength, $sourceLength)
}
Write-Host (' OK ({0} bytes)' -f $targetLength) -ForegroundColor Green

# Paso 10: Verificar que el SHA-256 es idéntico byte a byte
Write-Host ' [10/12] Verificando coincidencia exacta de SHA-256...' -NoNewline
$finalHash = Compute-FileSha256 -Path $targetFile
if ($finalHash -ne $initialHash) {
    Write-Host ' DISCREPANCIA' -ForegroundColor Red
    throw 'ABORTADO CRITICO: El hash SHA-256 del archivo destino difiere del origen. Posible corrupción de disco.'
}
Write-Host ' OK (SHA-256 idéntico)' -ForegroundColor Green

# Paso 11: Verificar que el archivo antiguo ya no existe en reports/
Write-Host ' [11/12] Verificando remoción de binario en reports/...' -NoNewline
if (Test-Path -LiteralPath $sourceFile) {
    Write-Host ' ERROR' -ForegroundColor Red
    throw 'ABORTADO: El archivo origen aún permanece en reports/.'
}
Write-Host ' OK (Removido de reports/)' -ForegroundColor Green

# Paso 12: Conclusión y certificación
Write-Host ' [12/12] Certificando migración...' -NoNewline
Write-Host ' OK' -ForegroundColor Green

Write-Host ''
Write-Host '========================================================================' -ForegroundColor Cyan
Write-Host ' MIGRACION EXITOSA -- PREFLIGHT BINARIO REUBICADO CORRECTAMENTE         ' -ForegroundColor Green
Write-Host '========================================================================' -ForegroundColor Cyan
Write-Host (' - Nueva ubicación:  ' + $targetFile)
Write-Host (' - Longitud:         ' + $targetLength + ' bytes')
Write-Host (' - Hash SHA-256:     ' + $finalHash)
Write-Host ' - Estado:           REUBICACION COMPLETADA SIN ALTERACION DE BYTES'
Write-Host '========================================================================' -ForegroundColor Cyan
