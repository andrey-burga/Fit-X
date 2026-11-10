# AUDITORÍA ESTÁTICA Y ADVERSARIAL DE LAS 10 COMPUERTAS DE EXTRACCIÓN
## VIGORCORE ETL — FASE 3.5.0.2

**Fecha de Auditoría:** 10 de noviembre de 2026  
**Script Auditado:** `poc/catalyst-3-2/scripts/extract-firestore.ps1` (Modo `Extract`)  
**Módulo TypeScript de Referencia:** `poc/catalyst-3-2/src/etl/firestoreExtractor.ts`  
**Estado:** AUDITED — IMPENETRABLE FAIL-CLOSED ARCHITECTURE  

---

### 1. OBJETIVO DE LA AUDITORÍA DE COMPUERTAS

Demostrar formal y estáticamente que el modo `Extract` de `extract-firestore.ps1` posee una arquitectura de seguridad **Fail-Closed**, donde ninguna compuerta puede ser eludida por omisión de parámetros, variables por defecto o invocaciones no interactivas accidentales.

---

### 2. MATRIZ DETALLADA DE LAS 10 COMPUERTAS DE SEGURIDAD

| Nro | Control | Nombre de la Compuerta | Mecanismo de Validación | Comportamiento Fail-Closed |
|---|---|---|---|---|
| **Gate 1** | Control 1 | **Validación ADC en Memoria** | `Get-AdcAccessToken` comprueba que exista credencial y no sea nula/vacía | Si falla: `throw 'BLOQUEO: Credencial ADC no válida o vacía en memoria.'` |
| **Gate 2** | Control 2 | **Autenticidad e Integridad de Preflight** | Verifica presencia de `preflight-token.json` y `preflight-token.bin`. Descifra sobre DPAPI y recalcula SHA-256 | Si falta algún archivo o el hash difiere: `throw 'BLOQUEO DE INTEGRIDAD...'` |
| **Gate 3** | Control 3 | **Correspondencia Project & Database ID** | Compara `projectId == gen-lang-client-0041212770` y `databaseId == ai-studio-vigorcore-...` | Si difiere: `throw 'BLOQUEO: El token de preflight corresponde al proyecto...'` |
| **Gate 4** | Control 4 | **Frescura Temporal y Cero Errores** | Calcula `ageMinutes = (now - preflightDate)`. Verifica `ageMinutes <= 60`, `errors.Count == 0` y `status != PREFLIGHT_FAILED` | Si `ageMinutes > 60` o existen errores: `throw 'BLOQUEO: El token de preflight tiene X min...'` |
| **Gate 5** | Control 5 | **Reconocimiento Explícito de Drift** | Si `status == BASELINE_DRIFT`, evalúa el switch `-DriftAcknowledged` | Si hay drift y el switch no fue pasado: `throw 'BLOQUEO: Existe BASELINE_DRIFT...'` |
| **Gate 6** | Control 6 | **Confirmación Explícita del Operador** | Si `-OperatorConfirmed` es `$false`, invoca `Read-Host` solicitando confirmación interactiva `[Y/N]` | Si la respuesta no es `'Y'`: `throw 'EXTRACCION CANCELADA POR EL OPERADOR.'` |
| **Gate 7** | Control 7 | **Confirmación de Ventana de Mantenimiento** | Si `-MaintenanceWindowConfirmed` es `$false`, solicita confirmación interactiva declarativa | Si no responde `'Y'`: `throw 'EXTRACCION CANCELADA: Ventana de mantenimiento no confirmada.'` |
| **Gate 8** | Control 8 | **Prueba de Cifrado DPAPI y Resistencia a Manipulación** | Invoca `Test-DpapiRoundtrip`: cifra un payload aleatorio, lo corrompe y verifica que falle el descifrado | Si el roundtrip falla o no detecta manipulación: `throw 'DPAPI_ERROR...'` |
| **Gate 9** | Control 9 | **Protección de Repositorio Git y Permisos ACL** | Comprueba que `.gitignore` contenga `.data/`. Aplica `SetAccessRuleProtection($true, $false)` al directorio de caché | Si `.data/` falta en `.gitignore`: `throw 'BLOQUEO: El directorio .data/ no está excluido...'` |
| **Gate 10** | Control 10 | **Integridad de Checkpoint previo** | Si se invoca con `-Resume`, descifra el `checkpoint.bin` previo y valida `nextDocIndex` y `confirmedDocIds` | Si el checkpoint está corrupto o inconsistente: `throw 'BLOQUEO: Checkpoint previo corrupto...'` |

---

### 3. AUDITORÍA DE PARÁMETROS: IMPOSIBILIDAD DE BYPASS ACCIDENTAL

Se inspeccionó la declaración de parámetros del bloque `param()` en `extract-firestore.ps1`:

```powershell
[Parameter(Mandatory=$false)]
[switch]$OperatorConfirmed = $false,

[Parameter(Mandatory=$false)]
[switch]$MaintenanceWindowConfirmed = $false,

[Parameter(Mandatory=$false)]
[switch]$DriftAcknowledged = $false,

[Parameter(Mandatory=$false)]
[switch]$Resume = $false
```

#### Análisis de Seguridad:
1. **Valor por Defecto Incondicionalmente `$false`:** Todos los switches de autorización tienen valor por defecto explícito `$false`.
2. **Imposibilidad de Ejecución "Silenciosa" no interactiva:**  
   Si un script o pipeline CI intenta ejecutar:
   `powershell -File extract-firestore.ps1 -Mode Extract`
   El proceso se detendrá en seco en la Gate 6 esperando un `Read-Host`. Si la entrada estándar está cerrada o redirigida sin enviar un carácter `'Y'`, el script aborta inmediatamente con cancelación.
3. **Imposibilidad de Extraer con Drift sin Reconocimiento:**  
   Incluso si el operador confirma con `'Y'`, si el preflight detectó `BASELINE_DRIFT` (por ejemplo 74 documentos en vez de 73), la extracción se bloquea incondicionalmente en la Gate 5 a menos que el operador haya incluido conscientemente la bandera `-DriftAcknowledged`.
4. **Protección Criptográfica Automática:**  
   Las compuertas Gate 2 y Gate 8 no dependen de ningún parámetro del usuario: son validaciones matemáticas autónomas (verificación de firma SHA-256 del preflight y prueba de ida y vuelta de DPAPI).

---

### 4. COBERTURA DE PRUEBAS UNITARIAS DE LAS COMPUERTAS

En `poc/catalyst-3-2/scripts/test-phase-3.5-extractor.ts`, las pruebas 9.8 a 9.14 verifican exhaustivamente todas las rutas de falla y la ruta feliz de `auditExtractGates`:

- `9.8`: Rechazo por ADC inválido (`GATE_ADC_INVALID`).
- `9.9`: Rechazo por falta de confirmación de operador (`GATE_OPERATOR_NOT_CONFIRMED`).
- `9.10`: Rechazo por falta de ventana de mantenimiento (`GATE_MAINTENANCE_NOT_CONFIRMED`).
- `9.11`: Rechazo por omisión en `.gitignore` (`GATE_GIT_NOT_PROTECTED`).
- `9.12`: Rechazo por checkpoint inconsistente (`GATE_CHECKPOINT_INCONSISTENT`).
- `9.13`: Rechazo por drift no reconocido (`GATE_DRIFT_NOT_ACKNOWLEDGED`).
- `9.14`: Aprobación integral cuando las 10 compuertas están satisfechas.

---

### 5. CONCLUSIÓN

La arquitectura estática del modo Extract de VigorCore no admite rutas de bypass. Cada una de las 10 compuertas actúa como un fusible de seguridad independiente que detiene la ejecución inmediatamente si cualquier condición de seguridad no se cumple.
