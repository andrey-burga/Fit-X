# VIGORCORE — CIERRE DOCUMENTAL DE FASE 5.2, ETAPA 1 (NOSQL EN `Development`)

**Proyecto en Google AI Studio:** `Fit-X` (alcance exclusivo en `poc/catalyst-clean-slate/`)  
**Proyecto Zoho Catalyst:** `Project-Rainfall`  
**CATALYST_PROJECT_ID:** `136967000000014024`  
**Data Center:** `US` (`accounts.zoho.com` · `https://api.catalyst.zoho.com`)  
**Entorno aprovisionado:** `Development` (`Production` **NO** promovido)  
**Dictamen de cierre (Etapa 1):** **`PHASE_5_2_STAGE_1_NOSQL_PROVISIONING_COMPLETED`**  
**Operaciones remotas ejecutadas en este cierre documental:** **`0`** *(conciliación documental y validación local únicamente)*

---

## 1. REGISTRO OFICIAL DE IDENTIFICADORES EN `Development`

### 1.1 Cinco Tablas NoSQL

| Orden | Tabla | Table ID | Partition Key | Primary Sort Key | Additional Sort Keys | TTL | Registros | Bytes |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- | :---: | :---: |
| **1** | `Users` | `136967000000065001` | `pk` (`String`) | *Sin Primary SK* | *Ninguna* | *Sin TTL* | `0` | `0` |
| **2** | `UserData` | `136967000000067007` | `pk` (`String`) | `sk` (`String`) | `entityType` (`String`), `updatedAt` (`String`) | *Sin TTL* | `0` | `0` |
| **3** | `AdminInvitations` | `136967000000067014` | `pk` (`String`) | *Sin Sort Key* | *Ninguna* | `ttlEpochSec` (`Number`) | `0` | `0` |
| **4** | `AuditLogs` | `136967000000067021` | `pk` (`String`) | `sk` (`String`) | `action` (`String`), `timestamp` (`String`) | *Sin TTL* | `0` | `0` |
| **5** | `SystemControl` | `136967000000067034` | `pk` (`String`) | *Sin Sort Key* | *Ninguna* | `ttlEpochSec` (`Number`)* | `0` | `0` |

\* **Restricción obligatoria de aplicación en `SystemControl`:** asignar `ttlEpochSec` únicamente en registros `CTRL#SAGA#<idempotencyKey>` y `SESSION#<sid>`; **prohibido** agregarlo a `CTRL#BOOTSTRAP` y `CTRL#SUPERADMIN_COUNT`.

### 1.2 Ocho Índices Secundarios Globales (`Active`)

| Tabla | Índice | Index ID | Partition Key | Sort Key | Proyección | Estado | Elementos | Bytes |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| `Users` | `GSI_Email` | `136967000000065003` | `normalizedEmail` (`String`) | *Ninguna* | `ALL` | `Active` | `0` | `0` |
| `Users` | `GSI_Directory` | `136967000000067001` | `directorySegment` (`String`) | `createdAt` (`String`) | `SPECIFIC_ATTRIBUTES` (11 cols) | `Active` | `0` | `0` |
| `Users` | `GSI_RoleStatus` | `136967000000067004` | `role` (`String`) | `accountStatus` (`String`) | `ALL` | `Active` | `0` | `0` |
| `UserData` | `GSI_UserEntityDate` | `136967000000067011` | `pk` (`String`) | `entityDateKey` (`String`) | `ALL` | `Active` | `0` | `0` |
| `AdminInvitations` | `GSI_InviteEmailStatus` | `136967000000067016` | `emailNormalized` (`String`) | `status` (`String`) | `ALL` | `Active` | `0` | `0` |
| `AuditLogs` | `GSI_AuditActor` | `136967000000067025` | `actorUid` (`String`) | `timestamp` (`String`) | `ALL` | `Active` | `0` | `0` |
| `AuditLogs` | `GSI_AuditTarget` | `136967000000067028` | `targetUid` (`String`) | `timestamp` (`String`) | `ALL` | `Active` | `0` | `0` |
| `AuditLogs` | `GSI_GlobalChronology` | `136967000000067031` | `auditPeriodBucket` (`String`) | `globalChronologyKey` (`String`) | `ALL` | `Active` | `0` | `0` |

**Columnas proyectadas exactas de `Users.GSI_Directory` (`11`):**
`pk`, `uid`, `email`, `displayName`, `role`, `roleVersion`, `accountStatus`, `emailVerified`, `directorySegment`, `createdAt`, `lastSignInAt`.

---

## 2. CONCILIACIÓN DE IDENTIFICADORES CONTRA REFERENCIAS (CERO DUPLICACIONES O CONTRADICCIONES)

- **Prefijo consistente en `Project-Rainfall`:** Los `5` Table IDs y los `8` Index IDs (`13` identificadores únicos en total) comparten el prefijo numérico de organización/proyecto `1369670000000*` congruente con `CATALYST_PROJECT_ID=136967000000014024`.
- **Unicidad verificada:** Ninguno de los `13` identificadores se duplica entre sí ni colisiona con `136967000000014024` (`Project-Rainfall`) ni con `16391000000005003` (CNAME de Slate `app.vigorcore.lat`).
- **Paridad con esquema congelado:** `validatePhase52Stage1Inventory()` comprueba programáticamente la correspondencia exacta de tablas, PKs, SKs, Additional SKs, GSIs, las 11 columnas de `Users.GSI_Directory` y reglas TTL frente a `TABLE_SCHEMA_REGISTRY` (`src/types/cleanSlate.ts`).

---

## 3. DIFERENCIACIÓN ESTRICTA DE EVIDENCIA Y VALIDACIONES

| Categoría de Evidencia | Qué está respaldado | Fuente / Alcance |
| :--- | :--- | :--- |
| **Evidencia observada en la consola** *(comunicada por el operador)* | Las 5 tablas muestran `0` registros y `0` bytes; los 8 índices figuran en estado `Active` con `0` elementos y `0` bytes; los 5 Table IDs y 8 Index IDs fueron recogidos en Catalyst Console (`Development`). | Inspección visual del operador en Zoho Catalyst Console (`Project-Rainfall`, `Development`). |
| **Configuración comunicada por el operador** | Definición exacta de PK/SK/Additional SKs/proyecciones, ausencia total de datos de prueba, y configuración del atributo TTL `ttlEpochSec` como tipo **`Number`** en `AdminInvitations` y `SystemControl`. | Declaración operativa del operador (recordando que `@zcatalyst/nosql@1.0.0` no expone el tipo del TTL por SDK). |
| **Validaciones locales del código** | Integridad del registro `PHASE_5_2_STAGE_1_DEV_INVENTORY`, unicidad de los 13 IDs, paridad 1:1 con `TABLE_SCHEMA_REGISTRY`, compilación TypeScript/Vite y suite completa de pruebas automatizadas. | Ejecución local en `poc/catalyst-clean-slate/` (`0` red). |
| **Consultas remotas automatizadas** | **NO ejecutadas en este cierre documental.** No se corrió `verify-clean-slate-provisioning.ts --live --confirm-readonly` contra Zoho Catalyst desde este entorno. | Pendiente de ejecución opcional en estación del operador con credenciales efímeras read-only (`--auth-mode external_oauth`). |

---

## 4. ESTADO DE RECURSOS Y ALCANCE PENDIENTE DE AUTORIZACIÓN

- **Completado y cerrado documentalmente (Etapa 1 en `Development`):**
  - Existen `5` tablas (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`) y `8` índices (`Active`) en **`Development`**, todos vacíos (`0` registros / `0` bytes).
- **Intacto y NO autorizado ni ejecutado en esta etapa:**
  - **Etapa 2 — Native Catalyst Authentication** (`Set Up`, selección Hosted Login, verificación directa de `0` usuarios en `Authentication → Users`): **PENDIENTE DE AUTORIZACIÓN INDEPENDIENTE**.
  - **Third-party Authentication:** sigue sin activar (`Set Up`).
  - **Funciones (`vigor_api`) y API Gateway:** sin crear ni habilitar (`Enable now` / `Functions are not created yet!!`).
  - **Entorno `Production`:** **NO** se promovieron tablas, índices ni configuraciones a `Production`.
  - **Dominios / Slate / Cloud externo:** `api.vigorcore.lat` (`BLOCKED_PENDING_ZOHO_CLARIFICATION`), `app.vigorcore.lat` (Slate), frontend raíz, DNS, Firebase y GCP permanecen intactos.

---

## 5. DICTAMEN FINAL

**`PHASE_5_2_STAGE_1_NOSQL_PROVISIONING_COMPLETED`**

- **Operaciones remotas ejecutadas durante este cierre documental:** **Ninguna (`0`).**
- **Siguiente paso habilitable solo bajo autorización explícita:** **Etapa 2 de Fase 5.2 — Configuración de Native Catalyst Authentication en `Development`** (y, cuando el operador lo decida, verificación CLI `--live --confirm-readonly`).

---

## 6. VERIFICACIONES Y COMPILACIONES LOCALES EJECUTADAS

- `npm --prefix poc/catalyst-clean-slate run build` (`tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.frontend.json`) — **OK (código de salida `0`)**.
- `npm --prefix poc/catalyst-clean-slate run build:server` (`tsc -p tsconfig.server.json`) — **OK (código de salida `0`)**.
- `npm --prefix poc/catalyst-clean-slate run frontend:build` (`vite build --config vite.frontend.config.ts`) — **OK (código de salida `0`)**.
- `npm --prefix poc/catalyst-clean-slate test` (`tsx --test tests/*.test.ts`) — **94/94 PASS** (`0` fallos, `0` omitidos, `0` cancelados; incluye las suites `tests/20` y `tests/21`).
- Verificación raíz del applet (`compile_applet` + `lint_applet`) — **OK** (sin afectación al proyecto raíz `Fit-X`).

