# VIGORCORE ETL — PROCEDIMIENTO DE VERIFICACIÓN OPERATIVA EN WINDOWS
**Fase:** 3.5.0.4  
**Fecha:** 2026-11-11  
**Dirigido a:** Operador del Sistema / Ingeniero de Migración  
**Entorno Requerido:** Windows 10/11 / Windows Server, Windows PowerShell 5.1 (consola local o Terminal)  
**Objetivo:** Validar sintaxis, pruebas locales, estado Git, endurecer ACL del directorio raíz de caché y auditar vigencia temporal del Preflight token.  
**Regla Estricta:** Este procedimiento NO incluye ni autoriza la ejecución del comando Extract (descarga de documentos completos).  

---

## 1. PASO 1: VALIDACIÓN ESTÁTICA DE SINTAXIS POWERSHELL 5.1

Desde el directorio raíz de la POC (`poc/catalyst-3-2`), valide que los scripts de PowerShell no contengan errores de sintaxis, variables mal formateadas o tokens incompatibles con el parser del CLR de PowerShell 5.1:

```powershell
# 1.1 Validación de sintaxis de extract-firestore.ps1
$errors1 = $null
[System.Management.Automation.Language.Parser]::ParseFile(
    (Resolve-Path "scripts\extract-firestore.ps1"),
    [ref]$null,
    [ref]$errors1
) | Out-Null

if ($errors1.Count -gt 0) {
    Write-Host "ERROR DE SINTAXIS EN extract-firestore.ps1:" -ForegroundColor Red
    $errors1 | Format-Table -AutoSize
    throw "Sintaxis inválida en extract-firestore.ps1"
} else {
    Write-Host "extract-firestore.ps1: SINTAXIS PS 5.1 VALIDA (0 errores)" -ForegroundColor Green
}

# 1.2 Validación de sintaxis de secure-firestore-cache-root.ps1
$errors2 = $null
[System.Management.Automation.Language.Parser]::ParseFile(
    (Resolve-Path "scripts\secure-firestore-cache-root.ps1"),
    [ref]$null,
    [ref]$errors2
) | Out-Null

if ($errors2.Count -gt 0) {
    Write-Host "ERROR DE SINTAXIS EN secure-firestore-cache-root.ps1:" -ForegroundColor Red
    $errors2 | Format-Table -AutoSize
    throw "Sintaxis inválida en secure-firestore-cache-root.ps1"
} else {
    Write-Host "secure-firestore-cache-root.ps1: SINTAXIS PS 5.1 VALIDA (0 errores)" -ForegroundColor Green
}
```

*Criterio de Aceptación:* Cero errores de sintaxis (`Count -eq 0`) en ambos archivos.

---

## 2. PASO 2: EJECUCIÓN DE PRUEBAS AUTOMATIZADAS LOCALES

Ejecute la suite de pruebas unitarias y de regresión funcional:

```powershell
npx tsx scripts/test-phase-3.5-extractor.ts
```

*Criterio de Aceptación:* Debe reportar exactamente:
```
========================================================================
RESUMEN: 30 APROBADAS | 0 FALLIDAS | TOTAL: 30
========================================================================
```

---

## 3. PASO 3: REVISIÓN DEL ESTADO DEL REPOSITORIO Y EXCLUSIONES GIT

Compruebe que el árbol de trabajo se encuentre limpio, que las políticas de exclusión de Git para `.data/` y `*.bin` estén activas y que no existan binarios residuales fuera de `.data/`:

```powershell
# 3.1 Estado de Git y archivos modificados
git status --short

# 3.2 Comprobación de que .data/ está formalmente ignorado por Git
git check-ignore -v .data/firestore-export/control/preflight-token.bin

# 3.3 Verificación de ausencia de binarios stray (.bin) fuera de .data/
$stray = Get-ChildItem -Path . -Filter "*.bin" -Recurse -File | Where-Object { $_.FullName -notmatch '[\\/]\.data[\\/]' }
if ($stray -and $stray.Count -gt 0) {
    Write-Host "ALERTA: Se encontraron binarios fuera de .data/:" -ForegroundColor Red
    $stray | Select-Object FullName
    throw "Existen binarios sin aislar fuera de .data/"
} else {
    Write-Host "REPOSITORIO LIMPIO: Cero binarios fuera de .data/." -ForegroundColor Green
}
```

*Criterio de Aceptación:* El archivo binario de control está ignorado por regla `.data/`, y la búsqueda de binarios no controlados retorna 0 elementos.

---

## 4. PASO 4: ENDURECIMIENTO DE LA ACL DEL CACHÉ DEFINITIVO (CONFIRMACIÓN EXPRESA)

Aísle el directorio raíz del caché local `.data\firestore-export` otorgando acceso exclusivo al operador actual, SYSTEM y Administradores, y deshabilitando la herencia:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\secure-firestore-cache-root.ps1 -OperatorConfirmed
```

### Comprobaciones del Paso 4:
1. Respaldo XML creado en `.data\firestore-export\control\cache-root-acl-backup.xml`.
2. Respaldo SDDL creado en `.data\firestore-export\control\cache-root-sddl-backup.txt`.
3. Herencia deshabilitada (`AreAccessRulesProtected: True`).
4. Grupo `BUILTIN\Users` excluido (cero ACEs asignadas a Users).
5. Acceso de control total garantizado para el usuario actual, `NT AUTHORITY\SYSTEM` y `BUILTIN\Administrators`.
6. ACL de `control\` verificada como **IDENTICA Y PRESERVADA**.
7. Prueba de sondeo I/O (`.probe-*.tmp`) completada con éxito.
8. Dictamen reportado: `CACHE_ROOT_HARDENED`.

---

## 5. PASO 5: GENERACIÓN DE NUEVO PREFLIGHT RECIENTE (DATETIMEOFFSET UTC)

Genere un nuevo token de preflight fresco con timestamp ISO 8601 estricto con zona horaria UTC:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\extract-firestore.ps1 -Mode Preflight
```

### Comprobaciones del Paso 5:
1. Conexión ADC exitosa mediante REST API v1.
2. 5 usuarios raíz detectados.
3. 68 documentos hijos inventariados.
4. Total: 73 documentos estructurales (diferencia frente al baseline: 0).
5. Dictamen reportado: `PREFLIGHT_PASS`.
6. `preflight-token.bin` generado y cifrado con DPAPI CurrentUser en `.data\firestore-export\control\preflight-token.bin`.

---

## 6. PASO 6: AUDITORÍA FINAL DE SEGURIDAD (UTC, DPAPI Y ACL)

Inmediatamente tras generar el preflight, ejecute la auditoría pasiva de seguridad:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\extract-firestore.ps1 -Mode LocalSecurityAudit
```

### Comprobaciones Esperadas en el Paso 6:
1. `preflight-token.json` encontrado en `reports\firestore-extraction-3.5\`.
2. `preflight-token.bin` verificado en `.data\firestore-export\control\`.
3. Descifrado DPAPI CurrentUser: **OK**.
4. SHA-256 coincidente entre JSON y sobre BIN: **OK**.
5. ProjectId (`gen-lang-client-0041212770`) y DatabaseId coincidente: **OK**.
6. Estado del preflight: `PREFLIGHT_PASS`.
7. **Frescura temporal (< 60 min): OK (~0.1 a ~1.0 min de antigüedad)**.  
   *(El bug de los 300 minutos queda definitivamente superado gracias a DateTimeOffset).*
8. Cero errores, cero conteos null, cero tokens ADC filtrados.
9. Estado de directorio definitivo: `DIRECTORY_PRESENT_WITH_FILES`.
10. **ACL de directorio definitivo: OK (Herencia deshabilitada y acceso exclusivo)**.
11. ACL de subdirectorio control: **OK (Herencia deshabilitada y acceso exclusivo)**.
12. Prueba sintética de ACL: **EXITOSA**.
13. Exclusiones Git: `.data/` y `*.bin` verificadas, cero binarios stray detectados.
14. Dictamen final reportado:
```
========================================================================
DICTAMEN: LOCAL_SECURITY_AUDIT_PASS
Todos los controles de seguridad local y preflight fueron aprobados.
========================================================================
```

---

## 7. ACCIONES DE CONTINGENCIA (PLAN DE ROLLBACK DE ACL)

Si por alguna razón operacional se requiriera restaurar los permisos originales de `.data\firestore-export`:

```powershell
# Opción A: Restauración mediante objeto Clixml
$backupXml = ".data\firestore-export\control\cache-root-acl-backup.xml"
$originalAcl = Import-Clixml -Path $backupXml
Set-Acl -Path ".data\firestore-export" -AclObject $originalAcl

# Opción B: Restauración mediante descriptor SDDL
$sddl = Get-Content ".data\firestore-export\control\cache-root-sddl-backup.txt"
$acl = Get-Acl ".data\firestore-export"
$acl.SetSecurityDescriptorSddlForm($sddl)
Set-Acl ".data\firestore-export" $acl
```
