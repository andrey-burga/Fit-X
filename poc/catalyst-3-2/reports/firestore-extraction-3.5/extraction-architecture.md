# VIGORCORE — FASE 3.5.0: ARQUITECTURA DEL EXTRACTOR FORENSE

## 1. RESUMEN EJECUTIVO

El extractor forense `extract-firestore.ps1` ha sido diseñado para ejecutar la extracción controlada, verificable y protegida de los datos históricos de VigorCore desde Google Cloud Firestore hacia un almacenamiento local cifrado en reposo.

- **Proyecto GCP:** `gen-lang-client-0041212770`
- **Base de Datos Firestore:** `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c` (Named Database, Enterprise Edition, `us-east1`)
- **Universo de Referencia:** 73 documentos históricos (5 documentos raíz en `users` y 68 documentos secundarios distribuidos entre 5 atletas: `USER_001` a `USER_005`).
- **Plataforma de Ejecución:** Windows PowerShell 5.1 y PowerShell 7+ en la estación de trabajo Windows del operador, utilizando ADC local (`gcloud auth application-default print-access-token`) y DPAPI (`CurrentUser`).

---

## 2. MODOS OPERATIVOS

El script implementa tres modos funcionales desacoplados y mutuamente excluyentes:

```
                  +-------------------------------------------------------+
                  |         extract-firestore.ps1 [Modos]                 |
                  +-------------------------------------------------------+
                                      |
         +----------------------------+----------------------------+
         |                                                         |
         v                                                         v
   [ PREFLIGHT ]                                              [ VERIFY ]
  - Validación ADC                                         - 100% Local (Offline)
  - Proyección __name__                                    - Cero Firestore / Catalyst
  - 5 Users + 11 Subcols                                   - Desencriptado DPAPI
  - 6 Admins                                               - Recomputación SHA-256
  - Detección Baseline Drift                               - Conciliación de Manifiesto
  - Genera preflight-token.json                            - Chequeo de Archivos Huérfanos
         |
         | (Preflight Válido < 60 min + Confirmación Operador + Ventana Mantenimiento)
         v
   [ EXTRACT ]
  - Bloqueado por defecto en Fase 3.5.0
  - Prueba de Ida y Vuelta DPAPI
  - Descarga Secuencial REST GET
  - Encapsulado en Sobre doc-XXXXXX.bin
  - Cifrado DPAPI CurrentUser en Reposo
  - Checkpoint Cifrado Atómico
  - Verificación de Consistencia Observada
  - Generación de manifest-audit.json
```

### A. Preflight (Comprobación Previa No Invasiva)
- **Objetivo:** Descubrir el estado actual del inventario remoto sin descargar campos de datos ni comprometer la privacidad.
- **Técnica:** Ejecución de `StructuredQuery` con proyección estricta `select.fields = ['__name__']`.
- **Colecciones Consultadas:**
  - Raíz: `users` (se confirman los 5 usuarios y se asocian en memoria a los alias `USER_001` .. `USER_005`).
  - 11 Subcolecciones candidatas por usuario: `biometrics`, `preferences`, `groceries`, `mealLogs`, `notifications`, `workoutSessions`, `cardioSessions`, `recipes`, `mealPlans`, `workoutRoutines`, `executedWorkouts`.
  - 6 Colecciones administrativas: `adminUserDirectory`, `adminRoleState`, `adminInvitations`, `accountAccess`, `adminAuditLogs`, `adminInvitationOperations`.
- **Detección de Drift:** Si el conteo total difiere de 73 o el número de usuarios difiere de 5, el estado se cataloga como `BASELINE_DRIFT`, bloqueando la autorización automática de extracción.

### B. Extract (Extracción Protegida y Cifrada)
- **Estado en Fase 3.5.0:** Implementado pero **NO AUTORIZADO para ejecución remota en esta fase**.
- **Controles de Compuerta Obligatorios:**
  1. ADC vigente y verificado.
  2. Preflight reciente (< 60 minutos) con veredicto distinto de `PREFLIGHT_FAILED`.
  3. Reconocimiento explícito de cualquier `BASELINE_DRIFT` mediante el parámetro `-DriftAcknowledged`.
  4. Confirmación interactiva o explícita del operador: `Read-Host "¿Confirma la descarga segura...? [Y/N]"`.
  5. Declaración de ventana de mantenimiento o suspensión de escrituras en origen (registrada expresamente como declaración humana y no como lock transaccional de Firestore).
  6. Prueba de ida y vuelta DPAPI exitosa en el entorno local.
  7. Verificación de exclusión de `.data/` en `.gitignore`.
- **Mecanismo:** Descarga de documentos completos mediante GET REST, encapsulamiento en estructuras JSON canónicas, cálculo de hash SHA-256, cifrado en reposo mediante Windows DPAPI (`CurrentUser`), y persistencia atómica con extensión `.tmp` antes de renombrar a `doc-XXXXXX.bin`.

### C. Verify (Auditoría Forense Local Offline)
- **Objetivo:** Comprobar la integridad criptográfica de la totalidad del caché local sin emitir solicitudes a la nube.
- **Acciones:**
  - Descifra en memoria cada archivo `doc-XXXXXX.bin` mediante DPAPI.
  - Recomputa el hash SHA-256 del documento REST descifrado y lo compara con el `contentSha256` registrado en el sobre.
  - Reconcilia el número de archivos válidos contra el `manifest-audit.json` y el `checkpoint.bin`.
  - Detecta archivos huérfanos o no catalogados en el directorio de caché.
  - Distingue archivos ausentes de archivos corruptos o ilegibles.

---

## 3. LÍMITES Y POLÍTICA FAIL-CLOSED

Para proteger la infraestructura de origen contra costos excesivos, consumo de cuota o bloqueos:

| Parámetro | Valor por Defecto | Justificación |
| :--- | :--- | :--- |
| **MaxRequests** | 500 | Suficiente para el universo de 73 docs + 55 consultas subcolección + reintentos; previene bucles infinitos. |
| **MaxDocuments** | 2.000 | Techo estricto; aborta si se detecta una explosión imprevista de registros. |
| **MaxDepth** | 10 | Evita recursión descontrolada en subcolecciones jerárquicas anidadas. |
| **ThrottleMs** | 100 ms | Espaciado entre peticiones REST para evitar saturación de ancho de banda o límites de burst. |
| **MaxRetries** | 3 | Con backoff exponencial ($2^n$ segundos) exclusivo para errores transitorios HTTP 429 y 503. |

### Detención Inmediata (Fail-Closed)
El extractor aborta sin declarar éxito ante:
- HTTP 401 (`AUTH_ERROR`) o credenciales expiradas.
- HTTP 403 (`PERMISSION_DENIED`).
- Errores de Facturación (`BILLING_DISABLED`).
- Cuota Excedida (`QUOTA_EXCEEDED`).
- HTTP 404 inesperado en un recurso previamente listado.
- Falla en el roundtrip de DPAPI (`DPAPI_ERROR`).
- Inconsistencia en checkpoints o desajuste de hashes.
- Detección de campos de datos no autorizados durante el Preflight.
