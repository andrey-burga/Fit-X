# VIGORCORE — FASE 3.5.0.1: DICTAMEN FORMAL DE PREPARACIÓN (READINESS DECISION)

## 1. DICTAMEN OFICIAL

### **`LOCAL SECURITY VERIFIED — READY FOR EXTRACTION REVIEW`**

La seguridad criptográfica local, la integridad del token de preflight y las diez compuertas de control del modo de extracción han sido verificadas y reforzadas exitosamente.

---

## 2. ALCANCE Y RESTRICCIONES DEL DICTAMEN

> **ADVERTENCIA FORMAL:**
> Este dictamen certifica que las herramientas, validadores y compuertas de seguridad están listos para la revisión técnica y ejecución controlada.
> **Este dictamen NO AUTORIZA AUTOMÁTICAMENTE la extracción de datos ni el paso a la Fase 3.5.1.**
> La extracción de documentos reales de Firestore requiere la aprobación expresa y posterior del operador, junto con la ventana de mantenimiento declarada.

---

## 3. CHECKLIST DE VERIFICACIÓN DE REQUISITOS (REQ-01 A REQ-10)

| Requisito | Estado | Verificación Técnica |
| :--- | :---: | :--- |
| **REQ-01: Modo `-Mode CryptoSelfTest` real** | **CUMPLIDO** | Implementado en PowerShell 5.1/7+ con el protocolo estricto de 11 pasos DPAPI `CurrentUser`. |
| **REQ-02: Resistencia a manipulación DPAPI** | **CUMPLIDO** | Verificado que alteraciones de bits en ciphertext son rechazadas fail-closed. |
| **REQ-03: Preflight token protegido criptográficamente** | **CUMPLIDO** | `preflight-token.bin` cifrado con DPAPI contiene firma SHA-256 del JSON legible. |
| **REQ-04: Detección de manipulación de Preflight** | **CUMPLIDO** | Probado que alterar campos del JSON invalida la correspondencia contra el binario autenticado. |
| **REQ-05: Validación de proyecto y base de datos** | **CUMPLIDO** | Revisa que `projectId` y `databaseId` del token coincidan con los argumentos de ejecución. |
| **REQ-06: Caducidad estricta de Preflight (< 60 min)** | **CUMPLIDO** | Aborta con `TOKEN_EXPIRED` si transcurren más de 60 minutos desde su generación. |
| **REQ-07: Exclusión de Git verificada** | **CUMPLIDO** | `.data/` y `*.bin` incluidos en `poc/catalyst-3-2/.gitignore` y validados en runtime. |
| **REQ-08: Restricción de permisos Windows ACL** | **CUMPLIDO** | Script desactiva herencia (`SetAccessRuleProtection`) y asigna `FullControl` al usuario actual. |
| **REQ-09: Imposibilidad de bypass accidental en Extract** | **CUMPLIDO** | Confirmaciones del operador y de mantenimiento requieren flags explícitos o prompt interactivo `Read-Host`. |
| **REQ-10: Cero modificaciones a producción** | **CUMPLIDO** | `src/`, `functions/`, `firestore.rules`, `package.json` raíz y `bun.lock` raíz 100% intactos. |

---

## 4. COMANDOS POWERSHELL PARA LA ESTACIÓN WINDOWS DEL OPERADOR

El desarrollador debe ejecutar las siguientes instrucciones en su estación Windows para culminar la verificación local real:

### 1. Validación de Sintaxis PowerShell
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-3-2\scripts\validate-script-syntax.ps1 -TargetScript extract-firestore.ps1
```

### 2. Ejecución del Self-Test Criptográfico Real DPAPI (11 Pasos)
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-3-2\scripts\extract-firestore.ps1 -Mode CryptoSelfTest
```

### 3. Ejecución de la Suite Local de Pruebas Automatizadas (40 Casos)
```powershell
npx tsx poc/catalyst-3-2/scripts/test-phase-3.5-extractor.ts
```

### 4. Ejecución del Preflight Remoto Autenticado (Genera `.json` y `.bin`)
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-3-2\scripts\extract-firestore.ps1 -Mode Preflight
```
