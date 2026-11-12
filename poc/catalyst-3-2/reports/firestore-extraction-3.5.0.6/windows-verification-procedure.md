# VIGORCORE ETL — PROCEDIMIENTO DE VERIFICACIÓN OPERATIVA EN WINDOWS
**Fase:** 3.5.0.6  
**Fecha:** 2026-11-11  
**Dirigido a:** Operador del Sistema / Ingeniero de Migración  
**Entorno Requerido:** Windows 10/11 / Windows Server, Windows PowerShell 5.1 (Consola local o Terminal)  
**Objetivo:** Ejecutar el endurecimiento en dos etapas de forma segura y verificar la vigencia temporal del preflight.  
**Regla Absoluta:** Este procedimiento NO incluye ni autoriza la ejecución del comando Extract (descarga de documentos completos).  

---

## 1. PASO 1: VALIDACIÓN ESTÁTICA DE SINTAXIS POWERSHELL 5.1

Desde el directorio raíz de la POC (`poc/catalyst-3-2`), valide los tres scripts involucrados mediante el parser nativo del CLR de PowerShell 5.1:

```powershell
$scriptsToValidate = @(
    "scripts\extract-firestore.ps1",
    "scripts\secure-firestore-cache-root.ps1",
    "scripts\restore-firestore-cache-acl.ps1"
)

foreach ($scriptPath in $scriptsToValidate) {
    $errs = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        (Resolve-Path $scriptPath),
        [ref]$null,
        [ref]$errs
    ) | Out-Null

    if ($errs.Count -gt 0) {
        Write-Host "ERROR EN $scriptPath ($($errs.Count) errores):" -ForegroundColor Red
        $errs | Format-Table -AutoSize
        throw "Sintaxis inválida en $scriptPath"
    } else {
        Write-Host "$scriptPath : SINTAXIS PS 5.1 VALIDA (0 errores)" -ForegroundColor Green
    }
}
```

*Criterio de Aceptación:* Cero errores de sintaxis en los 3 scripts.

---

## 2. PASO 2: EJECUCIÓN DE PRUEBAS AUTOMATIZADAS LOCALES

Ejecute la suite completa de pruebas:

```powershell
npx tsx scripts/test-phase-3.5-extractor.ts
```

*Criterio de Aceptación:* Debe reportar exactamente:
```
========================================================================
RESUMEN: 45 APROBADAS | 0 FALLIDAS | TOTAL: 45
========================================================================
```

---

## 3. PASO 3: REVISIÓN DEL ESTADO GIT Y EXCLUSIONES

Compruebe que las reglas añadidas al `.gitignore` raíz excluyen formalmente los dos archivos locales no deseados:

```powershell
# 3.1 Comprobar estado de Git
git status --short

# 3.2 Verificar que el archivo de respaldo de reglas está ignorado
git check-ignore -v ../../firestore.rules.pre-7d-live-backup.rules

# 3.3 Verificar que el package-lock raíz está ignorado
git check-ignore -v ../../package-lock.json

# 3.4 Verificar que el binario de control está ignorado
git check-ignore -v .data/firestore-export/control/preflight-token.bin
```

*Criterio de Aceptación:* Los archivos `.rules`, `package-lock.json` de la raíz y `preflight-token.bin` aparecen como ignorados por `.gitignore`.

---

## 4. PASO 4: ETAPA 1 — AISLAMIENTO EXCLUSIVO DE `control/`

Aísle el subdirectorio `control/` convirtiendo sus reglas heredadas en explícitas protegidas, sin alterar la raíz:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\secure-firestore-cache-root.ps1 -Stage 1 -ConfirmStage1
```

### Comprobaciones del Paso 4:
1. Respaldo `root-original-sddl.txt` y `root-original-sddl.sha256` creados en `control\`.
2. Respaldo `control-original-sddl.txt` y `control-original-sddl.sha256` creados en `control\`.
3. Integridad SHA-256 de respaldos verificada.
4. `control\` reporta: `AreAccessRulesProtected: True`.
5. Snapshot `stage1-control-sddl.txt` generado.
6. La raíz `.data\firestore-export` permanece intacta (`IDENTICA`).
7. Dictamen de etapa: `ETAPA 1 COMPLETADA EXITOSAMENTE: control\ AISLADO Y PROTEGIDO`.

---

## 5. PASO 5: ETAPA 2 — ENDURECIMIENTO DE LA RAÍZ

Una vez aprobada la Etapa 1, proceda con el endurecimiento del contenedor raíz:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\secure-firestore-cache-root.ps1 -Stage 2 -ConfirmStage2
```

### Comprobaciones del Paso 5:
1. Pre-requisito verificado: `control\` tiene `AreAccessRulesProtected: True`.
2. Integridad de `stage1-control-sddl.txt` verificada con SHA-256.
3. Raíz verificada con 0 archivos y 1 subdirectorio autorizado (`control`).
4. Herencia deshabilitada en la raíz (`AreAccessRulesProtected: True`).
5. Cero ACEs para `BUILTIN\Users` en la raíz.
6. SDDL de `control\` verificado como **IDENTICO Y PRESERVADO** (resuelto el bloqueo H-ACL-02).
7. Prueba de sondeo I/O (`.probe-*.tmp`) completada con éxito.
8. Dictamen reportado:
```
========================================================================
DICTAMEN: CACHE_ROOT_HARDENED -- ENDURECIMIENTO EN DOS ETAPAS EXITOSO
========================================================================
```

---

## 6. PASO 6: GENERACIÓN DE NUEVO PREFLIGHT RECIENTE (DATETIMEOFFSET UTC)

Genere un preflight fresco con timestamp ISO 8601 estricto con zona horaria UTC:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\extract-firestore.ps1 -Mode Preflight
```

### Comprobaciones del Paso 6:
1. Conexión ADC exitosa.
2. 5 usuarios raíz y 68 documentos hijos inventariados (73 total, diferencia 0).
3. Dictamen reportado: `PREFLIGHT_PASS`.
4. `preflight-token.bin` generado en `.data\firestore-export\control\preflight-token.bin`.

---

## 7. PASO 7: AUDITORÍA FINAL DE SEGURIDAD LOCAL (LOCAL SECURITY AUDIT)

Inmediatamente tras el preflight, valide todos los controles pasivos:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\extract-firestore.ps1 -Mode LocalSecurityAudit
```

### Comprobaciones Esperadas del Paso 7:
1. Descifrado DPAPI y SHA-256 de JSON vs BIN: **OK**.
2. **Frescura temporal (< 60 min): OK (~0.1 a ~1.0 min)** (desfase de 300 min definitivamente resuelto).
3. **ACL de directorio definitivo: OK (Herencia deshabilitada y acceso exclusivo)**.
4. **ACL de subdirectorio control: OK (Herencia deshabilitada y acceso exclusivo)**.
5. Cero errores, cero tokens ADC filtrados, cero binarios fuera de `.data/`.
6. Dictamen final reportado:
```
========================================================================
DICTAMEN: LOCAL_SECURITY_AUDIT_PASS
Todos los controles de seguridad local y preflight fueron aprobados.
========================================================================
```

---

## 8. PLAN DE CONTINGENCIA Y ROLLBACK MEDIANTE SDDL

Si se requiriera revertir los permisos al estado original:

### Caso A: Revertir ambas etapas (Restauración completa)
```powershell
powershell -ExecutionPolicy Bypass -File scripts\restore-firestore-cache-acl.ps1 -Target All -ConfirmRollback
```
*(Restaura la Raíz primero y luego Control, verificando los hashes SHA-256).*

### Caso B: Revertir únicamente la Etapa 1
```powershell
powershell -ExecutionPolicy Bypass -File scripts\restore-firestore-cache-acl.ps1 -Target ControlOnly -ConfirmRollback
```
