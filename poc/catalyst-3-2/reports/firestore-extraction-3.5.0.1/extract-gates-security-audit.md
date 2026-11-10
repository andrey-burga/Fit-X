# VIGORCORE — FASE 3.5.0.1: AUDITORÍA DE COMPUERTAS DE SEGURIDAD DEL MODO EXTRACT

## 1. OBJETIVO DEL SISTEMA DE COMPUERTAS

El modo `Extract` es la operación de mayor criticidad de la fase de preparación, ya que una ejecución prematura descargaría documentos de Firestore. El sistema de compuertas implementado en `extract-firestore.ps1` garantiza que sea **técnicamente imposible iniciar la extracción** si no se satisfacen rigurosamente todos los controles de autorización, integridad, criptografía y consistencia.

---

## 2. MATRIZ DE COMPUERTAS DE SEGURIDAD (GATES 1 A 10)

```
                 SOLICITUD: extract-firestore.ps1 -Mode Extract
                                       │
     ┌─────────────────────────────────┴─────────────────────────────────┐
     ▼                                                                   ▼
[GATE 01] ADC Válido en Memoria                                      [RECHAZO] -> GATE_ADC_INVALID
[GATE 02] Sobre Autenticado Preflight (DPAPI + SHA-256)              [RECHAZO] -> GATE_PREFLIGHT_TOKEN_TAMPERED
[GATE 03] Alineación Estricta ProjectId y DatabaseId                 [RECHAZO] -> GATE_PREFLIGHT_MISMATCH
[GATE 04] Frescura Temporal Preflight (< 60 Minutos)                 [RECHAZO] -> GATE_PREFLIGHT_EXPIRED
[GATE 05] Cero Errores Previos en Preflight (errors == 0)            [RECHAZO] -> GATE_PREFLIGHT_FAILED
[GATE 06] Reconocimiento Obligatorio de Baseline Drift               [RECHAZO] -> GATE_DRIFT_NOT_ACKNOWLEDGED
[GATE 07] Confirmación Expresa del Operador                          [RECHAZO] -> GATE_OPERATOR_NOT_CONFIRMED
[GATE 08] Declaración Expresa de Ventana de Mantenimiento            [RECHAZO] -> GATE_MAINTENANCE_NOT_CONFIRMED
[GATE 09] Auto-Test Criptográfico DPAPI + Anti-Tampering             [RECHAZO] -> GATE_DPAPI_FAILED
[GATE 10] Exclusión Git y ACL NTFS en Directorio Local               [RECHAZO] -> GATE_GIT_NOT_PROTECTED
     │
     └───────────────────────► [EXTRACCIÓN AUTORIZADA]
```

---

## 3. AUDITORÍA FORENSE DETALLADA DE CADA COMPUERTA

### Compuerta 01: Validación de Credenciales ADC en Memoria
- **Control:** Invoca `Get-AdcAccessToken`.
- **Condición Fail-Closed:** Si `gcloud` devuelve código distinto de cero o el token es nulo/vacío, aborta de inmediato.
- **Protección:** El token reside únicamente en una variable volátil; nunca se graba en disco ni se incluye en logs.

### Compuerta 02: Autenticidad e Integridad Criptográfica del Preflight
- **Control:** Carga `preflight-token.bin` y `preflight-token.json`.
- **Condición Fail-Closed:** Descifra el sobre binario con DPAPI y compara el SHA-256 canónico contra el JSON legible. Si el JSON fue editado o el binario alterado, aborta con `BLOQUEO DE INTEGRIDAD`.

### Compuerta 03: Correspondencia de Proyecto y Base de Datos
- **Control:** Compara `$authEnvelope.projectId == $ProjectId` y `$authEnvelope.databaseId == $DatabaseId`.
- **Condición Fail-Closed:** Si el preflight se ejecutó en otro proyecto (ej. `rogue-project`) o contra la base `(default)` en lugar de la named DB `ai-studio-vigorcore-...`, la extracción se detiene inmediatamente.

### Compuerta 04: Frescura Temporal (< 60 Minutos)
- **Control:** Calcula `(Get-Date).ToUniversalTime() - [DateTime]::Parse($authEnvelope.timestampUtc)`.
- **Condición Fail-Closed:** Si la diferencia supera 60 minutos, el token se declara caducado (`TOKEN_EXPIRED`), exigiendo un nuevo preflight para descartar cambios en origen.

### Compuerta 05: Cero Errores Previos en Preflight
- **Control:** Evalúa `$authEnvelope.status != 'PREFLIGHT_FAILED'` y `$tokenContent.errors.Count == 0`.
- **Condición Fail-Closed:** Si alguna subcolección o consulta previa falló (conteo `null`), no se permite extraer sobre un inventario incompleto.

### Compuerta 06: Reconocimiento Explícito de Baseline Drift
- **Control:** Si `$authEnvelope.status == 'BASELINE_DRIFT'`, exige el parámetro explícito `-DriftAcknowledged`.
- **Condición Fail-Closed:** Si los datos cambiaron respecto a 73 y el operador no pasa el flag, la extracción no puede iniciar.

### Compuerta 07: Confirmación Expresa del Operador (Anti-Accidental)
- **Control:** Comprueba `-OperatorConfirmed`. Si no se suministra en la línea de comandos, el script ejecuta un bloqueo interactivo:
  `$promptOp = Read-Host '¿Confirma la descarga segura y cifrada de los documentos a su disco local? [Y/N]'`
- **Condición Fail-Closed:** Si el operador ingresa cualquier valor distinto de `'Y'` o `'y'`, aborta con `EXTRACCION CANCELADA POR EL OPERADOR`.
- **Imposibilidad de Bypass Accidental:** Los valores predeterminados son `$false` (switch de PowerShell). Ninguna ejecución desatendida sin el flag explícito puede sobrepasar este control.

### Compuerta 08: Declaración de Ventana de Mantenimiento
- **Control:** Comprueba `-MaintenanceWindowConfirmed`. Si falta, emite advertencia explícita y solicita confirmación:
  `$promptMaint = Read-Host '¿Confirma que la ventana de mantenimiento / suspensión de escrituras en origen está activa? [Y/N]'`
- **Condición Fail-Closed:** Si no se confirma expresamente, la extracción se aborta.

### Compuerta 09: Auto-Prueba Criptográfica DPAPI y Anti-Tampering
- **Control:** Ejecuta `Test-DpapiRoundtrip` en memoria antes de tocar la colección `users`.
- **Condición Fail-Closed:** Verifica tanto el descifrado exacto byte a byte como el rechazo obligatorio ante alteración de bits. Si DPAPI falla o acepta ciphertext alterado, aborta con `DPAPI_ERROR`.

### Compuerta 10: Exclusión Git y ACL NTFS
- **Control:** Verifica que `$pocGitignorePath` contenga `.data/` y aplica directiva ACL sin herencia sobre `$resolvedCacheDir`.
- **Condición Fail-Closed:** Si `.data/` no está en `.gitignore`, aborta para prevenir fugas a Git.

---

## 4. CONCLUSIÓN DE LA AUDITORÍA DE COMPUERTAS

El diseño de las compuertas es exhaustivo, estrictamente determinista y con política fail-closed. No existen caminos alternativos ni parámetros permisivos que permitan iniciar la descarga de documentos sin autorización explícita y validación criptográfica.
