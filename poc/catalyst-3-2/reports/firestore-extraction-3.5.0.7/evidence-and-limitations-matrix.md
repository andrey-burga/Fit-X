# VIGORCORE — MATRIZ DE EVIDENCIAS Y LIMITACIONES OPERATIVAS
## FASE 3.5.0.7: AUDITORÍA FORENSE DE REGLAS Y CONCILIACIÓN DE LOCKFILES

**Fecha de Emisión:** 11 de Noviembre de 2026  
**Proyecto GCP:** `gen-lang-client-0041212770`  
**Base de Datos Firestore:** `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c` (Enterprise, us-east1)

---

### 1. MATRIZ DE EVIDENCIAS FÍSICAS

| Identificador | Artefacto / Recurso | Tamaño Físico | Hash SHA-256 | Procedencia / Diagnóstico | Clasificación Oficial |
|---|---|---|---|---|---|
| **E-3507-01** | `firestore.rules.pre-7d-live-backup.rules` | 166 bytes | `D4CE9EBC583DBF901BD7728E2E9FD5711601FB567499C4A3D78DE453C9640C18` | Generado por redirección de comando inválido `firebase firestore:rules:get` | `INVALID_BACKUP_ARTIFACT — ERROR OUTPUT` |
| **E-3507-02** | `package-lock.json` (Raíz) | 177,558 bytes | `3247172EACE20F71919A4C0EB490DC1AB8000012FC20DEF72BF0F7E0F49D596E` | Generado colateralmente por `npx` el 23/10/2026 en proyecto Bun | `OBSOLETE_COLLATERAL_LOCKFILE` |
| **E-3507-03** | `bun.lock` (Raíz) | 124,735 bytes | `64001f5ad16fec7a9c46d77ba85374c4e0751a36022124e843a8bb684a364459` | Lockfile activo generado por Bun v1.x con 226 dependencias resueltas | `CANONICAL_ROOT_LOCKFILE` |
| **E-3507-04** | `functions/package-lock.json` | 109,940 bytes | `2ff1d70f234104a4764e7884f96b1e0a3698547c6b15f060d6b26b711b0a6e58` | Lockfile npm para Cloud Functions v2 en Node.js 22 | `CANONICAL_FUNCTIONS_LOCKFILE` |
| **E-3507-05** | `firestore.rules` (Raíz) | 17,770 bytes | (469 líneas) | Reglas productivas actuales de VigorCore con soporte para 6 colecciones admin | `PRODUCTION_RULES_SPECIFICATION` |
| **E-3507-06** | `firestore.rules.backup-20261023-pre-deploy-6c2` | 14,438 bytes | (280 líneas) | Snapshot local previo a Fase 6C.2 (carece de colecciones administrativas 7D) | `HISTORICAL_BACKUP_LEGITIMATE` |
| **E-3507-07** | `/.gitignore` | 213 bytes | `23e1e9f1...` | Reglas ancladas `/firestore.rules.pre-7d-live-backup.rules` y `/package-lock.json` | `GIT_ISOLATION_RULES` |

---

### 2. MATRIZ DE LIMITACIONES OPERATIVAS

| Limitación | Causa Raíz | Impacto en la Fase | Mitigación Implementada |
|---|---|---|---|
| **Ausencia de ADC en Contenedor** | El contenedor Linux de desarrollo no dispone de credenciales de Service Account ni login de Google Cloud (`NO_ADC`). | Imposibilidad de ejecutar la consulta REST remota directamente desde este contenedor. | Se desarrolló el script seguro `query-remote-rules.ps1` y se documentó el procedimiento REST para que el operador lo ejecute en Windows con su sesión autorizada. |
| **Comando Inexistente en Firebase CLI** | `firebase-tools` no implementa `firestore:rules:get`. | Incapacidad de usar comandos CLI estándar de Firebase para respaldar reglas. | Migración completa a la API REST oficial de Google Cloud (`firebaserules.googleapis.com/v1`). |
| **Desacoplamiento Multi-Database** | Las reglas de la base nombrada y de `(default)` son releases distintas en GCP. | No se puede inferir el estado de la base nombrada inspeccionando `(default)`. | El procedimiento y el script filtran explícitamente por el identificador de la base nombrada `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`. |
| **Estado Remoto No Comprobado Directamente** | Restricción de no inventar respaldos ni falsear consultas en vivo. | El dictamen debe reflejar honestamente que el respaldo en vivo está pendiente de verificación remota. | Emisión del dictamen condicional `FIRESTORE_RULES_BACKUP_STATUS_RECONCILED — PENDING VERIFIED REMOTE RULESET`. |

---

### 3. CUMPLIMIENTO ESTRICTO DE LÍMITES DE SEGURIDAD

Durante la ejecución de la Fase 3.5.0.7 se cumplieron sin excepciones los siguientes límites:

1. **CERO ejecuciones de Extract:** No se realizó ninguna extracción de datos de Firestore.
2. **CERO descargas de documentos:** No se descargó ningún documento completo ni se consultaron colecciones.
3. **CERO escrituras remotas:** No se crearon documentos, colecciones ni releases remotas.
4. **CERO cambios de Firebase Rules:** No se desplegaron reglas (`firebase deploy` no invocado).
5. **CERO modificaciones de IAM o Billing:** No se alteraron cuentas de servicio, roles ni facturación.
6. **CERO mutaciones de código productivo:** `src/`, `functions/`, `firestore.rules`, `package.json` y `bun.lock` se mantuvieron 100% inalterados.
7. **CERO eliminaciones destructivas:** El archivo de error de 166 bytes y el lockfile de 177,558 bytes se preservaron físicamente en el entorno local.
