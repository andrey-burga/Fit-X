# FASE 5.1 — PREPARACIÓN OPERATIVA, PREFLIGHT, RECONCILIACIÓN DE ESQUEMAS Y VERIFICACIÓN READ-ONLY CATALYST

**Alcance:** Exclusivo dentro de `poc/catalyst-clean-slate/`  
**Dictamen final de Fase 5.1:** **`OPERATIONAL_READINESS_PARTIAL`** *(Herramientas locales de preflight, reconciliación, runbook PowerShell 5.1 y verificador read-only 100% verificadas en `75/75` pruebas; activación operativa remota bloqueada hasta aprovisionamiento manual de las 5 tablas vacías, respuesta de Soporte Zoho Grupo B y ejecución live de `INT-01..INT-08`)*  
**Aislamiento preservado:** **`0`** tablas creadas remotamente, **`0`** GSIs remotos creados, **`0`** usuarios creados en Catalyst Auth, **`0`** despliegues, **`0`** secretos reales en archivos/logs y **`0`** cambios fuera de `poc/catalyst-clean-slate/`.

---

## 1. Matriz de las Cinco Tablas NoSQL Congeladas (Reconciliada Fase 4.0 ↔ 5.0 ↔ 5.1)

Reconciliación auditada entre `TABLE_SCHEMA_REGISTRY` (`src/types/cleanSlate.ts`), los cinco proveedores reales (`src/nosql/providers/tableProviders.ts`), `CleanSlateEngine` (`src/nosql/cleanSlateEngine.ts`), `CatalystLiveNoSQLAdapter` (`src/nosql/catalystModularAdapter.ts`), los servicios de dominio y las 41 rutas canónicas (`src/provisioning/schemaReconciliationAudit.ts`). **No se altera ningún parámetro físico congelado.**

| Tabla | Partition Key (`PK`) | Primary Sort Key (`SK`) | Additional Sort Keys (`Total <= 5`) | TTL (`ttlEpochSec: Number`) | Patrones / Prefijos de Claves | Escrituras Condicionales e Idempotencia | `consistent_read: true` | Límites Plataforma (`400 KB / 350 KB`, batch `<=25`, query `<=100`) | Proveedor Real Fase 5.0 (`@zcatalyst/nosql@1.0.0`) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **`Users`** | `pk` (`String`) | **Omitida (`null`)** *(1 ítem por partición)* | `0 / 5` totales (`0` adicionales) | **Desactivado** (`ttl_enabled: false`) | `USER#<catalystUserId>`, `directorySegment = USER_SEG#0..3` | Bootstrap: pre-lectura `fetchItem` + `GSI_Email` + `insertUser`. Mutaciones: `update` condicional sobre `roleVersion` / `sessionEpoch` verificando `response.update[0].status === 'Success'` (no solo HTTP 200). `bumpSessionEpoch` recupera timeouts via `consistent_read`. | **Sí** en `fetchItem`, `GSI_Email` y `GSI_RoleStatus`. (`GSI_Directory` usa eventual salvo override). | Ítem `< 350 KB`; `queryIndex` paginado `limit <= 100`. *Nota actualizada en Fase 5.1.1: `AdminGovernanceService.getAdminStats` itera con cursor `startKey` por cada segmento `USER_SEG#0..3` hasta agotar `nextStartKey` (con guardia `DIRECTORY_PAGINATION_STALLED` y deduplicación por `pk`), superando el límite previo de 100 usuarios/segmento.* | `UsersTableProvider` |
| **`UserData`** | `pk` (`String`) | `sk` (`String`) | `entityType` (`String`), `updatedAt` (`String`) → **Total `3 / 5`** | **Desactivado** (`ttl_enabled: false`) | `pk = USER#<uid>`; `sk`: `BIO#current`, `PREF#settings`, `GROCERY#<id>`, `MEAL#<dateTime>#<id>`, `RECIPE#<id>`, `PLAN#<weekStart>`, `ROUTINE#<id>`, `WORKOUT#<startedAt>#<id>`, `SET#<workoutId>#<setId>`, `CARDIO#<date>#<id>`, `NOTIF#<createdAt>#<id>` | Versión optimista en ítems mutables (`version == expectedVersion`), bloqueo `WORKOUT#` terminal vs `in_progress`, `consistent_read` previo en `workouts/start` y `groceries/create` (`409` duplicado), borrado idempotente por `{ pk, sk }`. | **Sí** en lectura de workspace (`queryTable`), mutaciones previas, `meals.list` y deletes. | Payload validado `<= 350 KB` (`SAFE_PAYLOAD_BUDGET_BYTES`) antes de llamar SDK (`400 KB` límite Catalyst). Batch chunks `<= 25` (`chunkArray`), declarando `atomicBatch: false` si `batchCalls > 1`. Consultas `<= 100`. | `UserDataTableProvider` |
| **`AdminInvitations`** | `pk` (`String`) | **Omitida (`null`)** *(1 ítem por partición)* | `0 / 5` totales | **Activado** (`ttlEpochSec`, **`Number`** Unix epoch sec) | `pk = INVITE#<inviteId>` | Transición condicional `status == 'pending'` → `'redeeming'` → `'redeemed'` / `'revoked'` inspeccionando `update[0].status`. Hash `SHA-256` + `timingSafeEqual`. Expiración validada en backend (`expiresAtEpochSec > nowSec`), **jamás** delegada al daemon TTL. | **Sí** en `fetchItem`, `revoke` y `redeem`. | Ítem pequeño (`<< 350 KB`). | `AdminInvitationsTableProvider` |
| **`AuditLogs`** | `pk` (`String`) | `sk` (`String`) | `action` (`String`), `timestamp` (`String`) → **Total `3 / 5`** | **Desactivado** (`ttl_enabled: false` — bitácora inmutable) | `pk = AUDIT#<YYYY-MM>`; `sk = <invertedEpochMs>#<eventId>`; `auditPeriodBucket = AUDIT_Q#<YYYY>-Q<1..4>` | **Append-only estrictamente** (`insert` inmutable; sin `update` ni `delete` expuestos). | **Sí** en consultas cronológicas y por target/actor (`GSI_AuditActor`, `GSI_AuditTarget`, `GSI_GlobalChronology`). | `limit <= 100` por partición/trimestre; fan-out paralelo acotado por rango de meses/trimestres (hasta 40 trimestres). | `AuditLogsTableProvider` |
| **`SystemControl`** | `pk` (`String`) | **Omitida (`null`)** *(1 ítem por partición)* | `0 / 5` totales (`0` GSIs) | **Activado** (`ttlEpochSec`, **`Number`** Unix epoch sec) **SOLO** en `CTRL#SAGA#*` y `SESSION#*`. **PROHIBIDO** en `CTRL#BOOTSTRAP` y `CTRL#SUPERADMIN_COUNT`. | `CTRL#BOOTSTRAP`, `CTRL#SUPERADMIN_COUNT`, `CTRL#SAGA#<idempotencyKey>`, `SESSION#<sid>` | Contadores atómicos con `update_function` (`add` / `subtract`) sin colisión con `update_attributes`; condición `version == expected AND activeSuperadminCount > 1`; `SESSION#` exige `expiresAtEpochSec > nowSec`, techo 24h, idle 12h y recuperación `consistent_read` tras timeout en refresh/logout/incremento. | **Sí** obligatorio en todas las lecturas de control y sesión. | Ítems `< 4 KB`; operaciones single-item deterministas. | `SystemControlTableProvider` |

---

## 2. Matriz de los Ocho GSIs y Relación con las 41 Rutas y 5 Proveedores

Verificado programáticamente mediante `verifyReconciliationCompleteness()` (`src/provisioning/schemaReconciliationAudit.ts`): **`5` tablas, `8` GSIs, `41 / 41` rutas canónicas mapeadas (`0` faltantes, `0` sobrantes)**.

| # | Tabla | Índice (`GSI`) | `PK` GSI | `SK` GSI | Proyección / `INCLUDE` | Métodos del Proveedor Fase 5.0 | Consumidores Reales en Servicios / 41 Rutas | Estado en Código |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `Users` | **`GSI_Email`** | `normalizedEmail` (`S`) | *Ninguna* | `ALL` | `UsersTableProvider.findByNormalizedEmail` | `CleanSlateAuthGuard.bootstrapAuthenticatedProfile` → `auth.session.bootstrapProfile` *(bloqueo de duplicados con `consistent_read: true`; el GSI no es `UNIQUE` nativo)*. | **Activo en rutas y proveedor** |
| 2 | `Users` | **`GSI_Directory`** | `directorySegment` (`S`: `USER_SEG#0..3`) | `createdAt` (`S`) | `SPECIFIC_ATTRIBUTES` (**11 cols exactas**: `pk`, `uid`, `email`, `displayName`, `role`, `roleVersion`, `accountStatus`, `emailVerified`, `directorySegment`, `createdAt`, `lastSignInAt`) | `UsersTableProvider.listDirectorySegment`, `listAllDirectorySegmentsConcurrently` | `AdminGovernanceService.listDirectoryUsers`, `getAdminStats` → `admin.users.list`, `admin.stats.get`. | **Activo en rutas y proveedor** |
| 3 | `Users` | **`GSI_RoleStatus`** | `role` (`S`) | `accountStatus` (`S`) | `ALL` | `UsersTableProvider.queryByRoleStatus` | `listDirectoryUsers` (con filtro `role`), `assertNoSuperadminCounterDrift`, `executeOfflineAdminBootstrap` → `admin.users.list`, `admin.users.setRole`, `admin.users.setStatus`. | **Activo en rutas y proveedor** |
| 4 | `UserData` | **`GSI_UserEntityDate`** | `pk` (`S`) | `entityDateKey` (`S`) | `ALL` | `UserDataTableProvider.queryEntityDateIndex` | Todos los escritores de las 11 subcolecciones poblan `entityDateKey = <TYPE>#<ISO>#<id>`; los endpoints actuales consultan por `sk` primario/`BETWEEN`. | **Activo en proveedor / escrituras; reservado para expansión de queries** *(inmutable en consola: conservar en creación inicial)* |
| 5 | `AdminInvitations` | **`GSI_InviteEmailStatus`** | `emailNormalized` (`S`) | `status` (`S`) | `ALL` | `AdminInvitationsTableProvider.findByEmailAndStatus` | Los endpoints actuales (`create`/`revoke`/`redeem`) operan directamente por `INVITE#<inviteId>`; el índice permanece activo en el proveedor para búsquedas por email/estado sin requerir backfill posterior. | **Activo en proveedor; reservado para deduplicación / filtros por email** |
| 6 | `AuditLogs` | **`GSI_AuditActor`** | `actorUid` (`S`) | `timestamp` (`S`) | `ALL` | `AuditLogsTableProvider.listByActor` | `AdminGovernanceService.listAuditLogs` → `admin.auditLogs.list` (`?actorUid=...`). | **Activo en rutas y proveedor** |
| 7 | `AuditLogs` | **`GSI_AuditTarget`** | `targetUid` (`S`) | `timestamp` (`S`) | `ALL` | `AuditLogsTableProvider.listByTarget` | `getAdminUserDetail` (`top 20`), `listAuditLogs` → `admin.users.detail`, `admin.auditLogs.list`. | **Activo en rutas y proveedor** |
| 8 | `AuditLogs` | **`GSI_GlobalChronology`** | `auditPeriodBucket` (`S`: `AUDIT_Q#<YYYY>-Q<1..4>`) | `globalChronologyKey` (`S`) | `ALL` | `AuditLogsTableProvider.listByQuarterBucket` | `AdminGovernanceService.listAuditLogs` → `admin.auditLogs.list` *(fan-out paralelo acotado por trimestres sin partición global única)*. | **Activo en rutas y proveedor** |

**Distribución de las 41 rutas reconciliadas:** `6` Auth/Sesión (`auth.*`), `25` Atleta/Workspace (`athlete.*`, incluyendo `athlete.biometrics.put` y `athlete.preferences.put` reconciliadas en Fase 4.2.3), `1` Invitación pública autenticada (`invitations.redeem`) y `9` Gobernanza Admin (`admin.*`) = **`41` rutas únicas**, todas con entrada en `ROUTE_TO_SCHEMA_MAPPING`.

---

## 3. Auditoría de Variables y Configuración Real del SDK (`@zcatalyst/*`)

Inspeccionado directamente sobre `node_modules/@zcatalyst/{auth@1.0.0, auth-admin@1.1.0, nosql@1.0.0, transport@1.1.0, utils@1.1.0}` y formalizado en `CATALYST_ENV_VAR_CATALOG` (`src/provisioning/catalystConfigPreflight.ts`):

| Variable | Clasificación | Secreto | Requerida en `--live --confirm-readonly` | Requerida en Runtime Servidor | Consumo exacto en SDK / VigorCore |
| --- | --- | --- | --- | --- | --- |
| `CATALYST_PROJECT_ID` | Identificador público | No | **Sí** | **Sí** | `CatalystApp.config.projectId` → ruta `/baas/v1/project/:projectId/...` y validación anti-spoof de `x-zc-projectid`. |
| `CATALYST_PROJECT_KEY` | Credencial sensible de app | **Sí** | **Sí** | **Sí** | `CatalystApp.config.projectKey` → cabecera HTTP **`PROJECT_ID`** inyectada por `addDefaultAppHeaders()`. |
| `CATALYST_PROJECT_SECRET_KEY` | Credencial sensible opcional | **Sí** | No | No | `CatalystApp.config.projectSecretKey` → cabecera opcional `x-zc-project-secret-key`. |
| `CATALYST_ENVIRONMENT` | Política de entorno pública | No | **Sí** | **Sí** | `Development` o `Production` exactos → cabecera `X-Catalyst-Environment`. |
| `VIGOR_ENVIRONMENT` | Política runtime VigorCore | No | **Sí** | **Sí** | Bloquea cruce entre `VIGOR_ENVIRONMENT=production` y `CATALYST_ENVIRONMENT=Development` (y viceversa). |
| `CATALYST_API_DOMAIN` | Endpoint regional público | No | **Sí** | **Sí** | Debe declararse explícitamente (por ej. `https://api.catalyst.zoho.com` para US, o el host correspondiente en `CATALYST_DATA_CENTERS`: `us`, `eu`, `in`, `au`, `ca`, `sa`, `jp`, `uae`). |
| `CATALYST_ACCOUNTS_URL` | Endpoint Zoho Accounts | No | **Sí** | **Sí** | Validado como HTTPS y coherente en TLD regional con `CATALYST_API_DOMAIN`. |
| `CATALYST_ADMIN_CLIENT_ID` | ID público OAuth servidor | No | **Sí*** | **Sí** | `RefreshTokenCredential.clientId` *(no requerido si `--live --confirm-readonly` usa token efímero `CATALYST_ADMIN_ACCESS_TOKEN`)*. |
| `CATALYST_ADMIN_CLIENT_SECRET` | **Secreto OAuth servidor** | **Sí** | **Sí*** | **Sí** | `RefreshTokenCredential.clientSecret` (jamás expuesto al navegador). |
| `CATALYST_ADMIN_REFRESH_TOKEN` | **Secreto OAuth servidor** | **Sí** | **Sí*** | **Sí** | `RefreshTokenCredential.refreshToken` para obtener access tokens administrativos server-side. |
| `CATALYST_ADMIN_ACCESS_TOKEN` | **Secreto OAuth efímero** | **Sí** | Opcional alt. | **Prohibido en prod** | `AccessTokenCredential` válido solo para diagnóstico read-only efímero (no prod runtime). |
| `X_ZOHO_CATALYST_ORG_ID` | Identificador público opcional | No | No | No | Cabecera nativa opcional `CATALYST-ORG` en `@zcatalyst/auth-admin`. |
| **`ZAID`** | **Solo cliente Web SDK** | No | **No** | **No** | Usado **únicamente** por `@zcatalyst/auth/dist-es/web.js` (`/accounts/p/:zaid` en Slate/navegador). **No** lo consumen ni `@zcatalyst/auth-admin` ni `@zcatalyst/nosql`. |
| `VIGOR_SESSION_HMAC_SECRET` | **Secreto criptográfico runtime** | **Sí** | No | **Sí** | Clave Base64URL >= 256 bits de entropía para `__Host-vigor_session` y CSRF ligado a sesión. |
| `VIGOR_SESSION_ACTIVE_KID` / `VIGOR_SESSION_PREVIOUS_SECRETS_JSON` | Política / rotación HMAC | Parcial (**Sí** JSON) | No | Opcional | Identificador de clave activa (por defecto `k1`) e historial de rotación JSON válido. |
| `VIGOR_ALLOWED_ORIGINS` | Política CORS explícita | No | No | **Sí** | Lista separada por comas de orígenes `https://` estrictos. Prohíbe `*`. |
| `ZC_SECURE` | Flag de transporte SDK | No | **Prohibido `override`** | **Prohibido `override`** | En `@zcatalyst/transport`, `ZC_SECURE=override` desactiva la verificación TLS de certificados. El preflight falla en cerrado si detecta `override`. |

**Defecto SDK mitigado sin parchear `node_modules` (`SDK-01`..`SDK-05`) y Modo Dual Fase 5.1.1:** El script CLI `--live --confirm-readonly` (que se ejecuta fuera del edge de Catalyst) y el entorno externo consumen únicamente `CatalystAdminAppProvider.fromEnvironment()` (`VIGOR_CATALYST_AUTH_MODE=external_oauth`), evitando la omisión de `Authorization` en `ApplicationCustomCredential` (`SDK-01`) y el bug `!isNonEmptyString(!projectId)` de `getDefaultCredentials()` (`SDK-03`). Adicionalmente, tras la confirmación oficial de Zoho Support (17 de noviembre de 2026), en Fase 5.1.1 el preflight soporta `--auth-mode hosted_native` / `VIGOR_CATALYST_AUTH_MODE=hosted_native` para validar despliegue dentro de Catalyst Advanced I/O (`HostedNativeCatalystAuthRuntime` via `ZCAuth.init(req, { scope: 'admin' | 'user' })`) sin exigir credenciales OAuth externas (`CATALYST_ADMIN_*`), junto con `VIGOR_CORS_MODE=platform_managed`. Véase `docs/24-phase-5.1.1-zoho-support-architecture-reconciliation.md`.

---

## 4. Resultado del Preflight (`catalystConfigPreflight.ts`)

Implementado en `src/provisioning/catalystConfigPreflight.ts` y conectado al flag `--preflight` en `scripts/verify-clean-slate-provisioning.ts`:

- **Garantía de cero red y cero escrituras:** `networkCallsExecuted: 0`, `writeOperationsExecuted: 0` en todos los escenarios.
- **Redacción garantizada de secretos:** Todos los mensajes y resúmenes reemplazan cualquier secreto crudo por `[REDACTED:len=<N>]` o `[REDACTED]`.
- **Validaciones fail-closed cubiertas y verificadas (`Tests 71 y 72`):**
  - Rechaza variables faltantes, valores placeholder (`YOUR_*`, `<...>`, `placeholder`, `000`, `xxx`), IDs malformados y `--expected-project` / `--expected-region` discordantes.
  - Exige coherencia entre `CATALYST_API_DOMAIN` y `CATALYST_ACCOUNTS_URL` a través de las **8 regiones oficiales de `CATALYST_DATA_CENTERS`** (`us`, `eu`, `in`, `au`, `ca`, `sa`, `jp`, `uae`).
  - Rechaza cruces dev/prod (`VIGOR_ENVIRONMENT` vs `CATALYST_ENVIRONMENT`), URLs HTTP no-HTTPS fuera de test loopback, `ZC_SECURE=override`, secretos HMAC débiles o con baja entropía, `*` en `VIGOR_ALLOWED_ORIGINS` y conflictos con variables heredadas `ZC_PROJECT_ID`.
- **Resultado real observado al ejecutar sin credenciales cargadas (`npx --prefix poc/catalyst-clean-slate tsx poc/catalyst-clean-slate/scripts/verify-clean-slate-provisioning.ts --preflight`):**
  - Código de salida **`1`** (fail-closed esperado).
  - JSON emitido: `mode: "CONFIG_PREFLIGHT_ZERO_NETWORK"`, `verdict: "FAIL"`, `networkCallsExecuted: 0`, `writeOperationsExecuted: 0`, reportando exactamente los 8 fallos de variables aún no configuradas (`CATALYST_PROJECT_ID`, `CATALYST_PROJECT_KEY`, `CATALYST_ENVIRONMENT`, `CATALYST_API_DOMAIN`, `CATALYST_ACCOUNTS_URL`, `CATALYST_ADMIN_CLIENT_ID`, `CATALYST_ADMIN_CLIENT_SECRET`, `CATALYST_ADMIN_REFRESH_TOKEN`), más `WARN` recordatorio de configurar `VIGOR_SESSION_HMAC_SECRET` antes del servidor Advanced I/O.

---

## 5. Estado del Verificador Read-Only (`postProvisioningVerifier.ts` + CLI)

Actualizado respecto a Fase 4.1 (`src/provisioning/postProvisioningVerifier.ts` y `scripts/verify-clean-slate-provisioning.ts`):

1. **Integración real con `CatalystAdminAppProvider` (`SDK-01` corregido):** Se añade `createReadOnlyEnvironmentFromProvider(adminProvider)` que expone **exclusivamente** `nosql.getAllTable()`, `fetchItem()`, `queryTable()`, `queryIndex()` y `auth.getAllUsers()` (cualquier método de escritura como `insertItems`, `updateItems`, `deleteItems` sigue ausente por tipo y verificado estáticamente por `tests/05`).
2. **Matrices explícitas y contexto de proyecto/región:**
   - Emite `tableMatrix` (5 filas: existencia, `status === 'ONLINE'`, `partitionKeyOk`, `sortKeyOk`, `additionalSortKeysOk`, `ttlOk`, `projectDetailsMatch`, `metricsItemCount`, `emptyProbePassed`).
   - Emite `indexMatrix` (8 filas: existencia, `status === 'ONLINE'`, `partitionKeyOk`, `sortKeyOk`, `projectionOk`, `includeColumnsOk`, `emptyProbePassed`).
   - Emite `targetContext` (`projectId`, `catalystEnvironment`, `apiDomain`, `inferredRegion`, `databaseEngine: 'Zoho Catalyst NoSQL'`) y valida `meta.project_details?.id === expectedProjectId`.
3. **Tres modos operativos en CLI (`verify-clean-slate-provisioning.ts`):**
   - Sin flags → `runOfflineSelfCheck()` (`PASS_SELF_CHECK`, `0` llamadas de red, `0` escrituras).
   - `--preflight [--full-runtime] [--expected-project <id>] [--expected-region <r>]` → valida variables sin red ni escrituras.
   - `--live --confirm-readonly [--allow-extra-tables] [--expected-project <id>] [--expected-region <r>]` → aborta antes de abrir sockets si `--confirm-readonly` falta o `--preflight` falla; luego valida esquema completo, métricas `=== 0`, sondas con `consistent_read: true` en todas las tablas/GSIs/segmentos y `UserManagement.getAllUsers().length === 0`.
4. **Limitaciones del SDK `@zcatalyst/nosql@1.0.0` documentadas en `SDK_KNOWN_LIMITATIONS` (requieren confirmación visual en Catalyst Console):**
   - `INoSQLTable.ttl_attribute` devuelve únicamente el nombre (`ttlEpochSec`), **no** el tipo `Number`.
   - `@zcatalyst/nosql` no ofrece `SCAN` completo de tabla; el estado vacío fuera de índices/claves sonda se corrobora con `metrics` + Data Browser visual.
   - Los GSIs no devuelven restricción `UNIQUE` (no existe en Catalyst NoSQL; la unicidad de email en `Users.GSI_Email` se refuerza en backend con `consistent_read: true`).
   - `INoSQLTable` no devuelve la región cloud en el metadata de tabla (se infiere y contrasta desde `CATALYST_API_DOMAIN` y Consola).

---

## 6. Runbook Manual Paso a Paso + Comandos Windows PowerShell 5.1

> **Regla vigente:** NO ejecutar este runbook contra Catalyst hasta contar con autorización operativa explícita del usuario y el proyecto destino confirmado. **Prohibido** insertar filas de prueba, crear usuarios de test, ejecutar bootstrap o modificar Slate/producción.

### 6.1 Orden exacto de creación manual en Zoho Catalyst Console (5 tablas vacías)

El detalle de campos y checkboxes de verificación inmediata tras cada tabla reside en `poc/catalyst-clean-slate/docs/07-manual-catalyst-tables-runbook.md`:

1. **`Users`** — PK `pk` (`String`), **sin Primary Sort Key**, `0` Additional SKs, TTL **Desactivado**, 3 GSIs:
   - `GSI_Email`: PK `normalizedEmail` (`String`), sin SK, Proyección `ALL`.
   - `GSI_Directory`: PK `directorySegment` (`String`), SK `createdAt` (`String`), Proyección `SPECIFIC_ATTRIBUTES` con las **11 columnas exactas**: `pk, uid, email, displayName, role, roleVersion, accountStatus, emailVerified, directorySegment, createdAt, lastSignInAt`.
   - `GSI_RoleStatus`: PK `role` (`String`), SK `accountStatus` (`String`), Proyección `ALL`.
2. **`UserData`** — PK `pk` (`String`), Primary SK `sk` (`String`), Additional SKs (`2`): `entityType` (`String`), `updatedAt` (`String`), TTL **Desactivado**, 1 GSI:
   - `GSI_UserEntityDate`: PK `pk` (`String`), SK `entityDateKey` (`String`), Proyección `ALL`.
3. **`AdminInvitations`** — PK `pk` (`String`), **sin Primary Sort Key**, `0` Additional SKs, TTL **Activado** atributo **`ttlEpochSec` (`Number`)**, 1 GSI:
   - `GSI_InviteEmailStatus`: PK `emailNormalized` (`String`), SK `status` (`String`), Proyección `ALL`.
4. **`AuditLogs`** — PK `pk` (`String`), Primary SK `sk` (`String`), Additional SKs (`2`): `action` (`String`), `timestamp` (`String`), TTL **Desactivado**, 3 GSIs:
   - `GSI_AuditActor`: PK `actorUid` (`String`), SK `timestamp` (`String`), `ALL`.
   - `GSI_AuditTarget`: PK `targetUid` (`String`), SK `timestamp` (`String`), `ALL`.
   - `GSI_GlobalChronology`: PK `auditPeriodBucket` (`String`), SK `globalChronologyKey` (`String`), `ALL`.
5. **`SystemControl`** — PK `pk` (`String`), **sin Primary Sort Key**, `0` Additional SKs, `0` GSIs, TTL **Activado** atributo **`ttlEpochSec` (`Number`)** *(en runtime solo `CTRL#SAGA#*` y `SESSION#*` llevan `ttlEpochSec`; `CTRL#BOOTSTRAP` y `CTRL#SUPERADMIN_COUNT` nunca lo llevan)*.

**Recuperación STOP-ON-ERROR:** En Zoho Catalyst NoSQL las claves primarias, Additional Sort Keys y GSIs son **inmutables** una vez creados. Si una tabla se crea con tipo o clave errónea antes de tener datos (`0` documentos), **DETENTE**, no intentes adaptarla con código distinto, documenta la discrepancia exacta y corrige/recrea únicamente esa tabla vacía conforme a los permisos del proyecto antes de re-ejecutar el verificador `--live --confirm-readonly`.

### 6.2 Comandos Windows PowerShell 5.1 Listos para Ejecutar *(sin instalación manual de dependencias y sin sintaxis bash `&&`)*

```powershell
# 1. Ubicarse en el proyecto POC aislado (todas las dependencias ya gestionadas)
Set-Location poc\catalyst-clean-slate

# 2. Verificación local completa sin red ni credenciales (TypeScript + Vite + 75 tests + self-check)
npm run build
npm run frontend:build
npm test
npx tsx scripts\verify-clean-slate-provisioning.ts

# 3. Cargar variables en memoria de la sesión actual PowerShell 5.1 (CUANDO exista proyecto autorizado; reemplazar <...> con valores reales en consola local únicamente)
$env:CATALYST_PROJECT_ID = "<CATALYST_PROJECT_ID>"
$env:CATALYST_PROJECT_KEY = "<CATALYST_PROJECT_KEY>"
$env:CATALYST_ENVIRONMENT = "Development"
$env:VIGOR_ENVIRONMENT = "development"
$env:CATALYST_API_DOMAIN = "https://api.catalyst.zoho.com"
$env:CATALYST_ACCOUNTS_URL = "https://accounts.zoho.com"
$env:CATALYST_ADMIN_CLIENT_ID = "<OAUTH_CLIENT_ID>"
$env:CATALYST_ADMIN_CLIENT_SECRET = "<OAUTH_CLIENT_SECRET>"
$env:CATALYST_ADMIN_REFRESH_TOKEN = "<OAUTH_REFRESH_TOKEN>"

# 4. Preflight de configuración (CERO llamadas de red, redacta secretos automáticamente)
npx tsx scripts\verify-clean-slate-provisioning.ts --preflight --expected-project $env:CATALYST_PROJECT_ID --expected-region us

# 5. (Opcional) Si también deseas validar variables completas del servidor Advanced I/O sin arrancar servidor:
$env:VIGOR_SESSION_HMAC_SECRET = (node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
$env:VIGOR_ALLOWED_ORIGINS = "https://fit-x-bhnatsxl.onslate.com"
npx tsx scripts\verify-clean-slate-provisioning.ts --preflight --full-runtime --expected-project $env:CATALYST_PROJECT_ID --expected-region us

# 6. Verificación remota ESTRICTAMENTE READ-ONLY (SOLO tras crear manualmente las 5 tablas vacías)
npx tsx scripts\verify-clean-slate-provisioning.ts --live --confirm-readonly --expected-project $env:CATALYST_PROJECT_ID --expected-region us
```

---

## 7. Pruebas y Resultados Reales Ejecutados (Post-Edición Fase 5.1)

| Ejecución / Suite | Cobertura | Resultado Observado | Clasificación Honesta |
| --- | --- | --- | --- |
| `npm --prefix poc/catalyst-clean-slate run build` | `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.frontend.json` (backend + preflight + CLI + verifier + frontend) | **PASS (`0` errores)** | `[PASS-UNIT]` |
| `npm --prefix poc/catalyst-clean-slate run frontend:build` | Vite build limpio (`dist-frontend/`) | **PASS** | `[PASS-UNIT]` |
| `npx tsx poc/catalyst-clean-slate/scripts/verify-clean-slate-provisioning.ts` | Offline self-check: 5 tablas, 8 GSIs, `consistent_read=true`, `0` escrituras | **PASS (`PASS_SELF_CHECK`)** | `[PASS-UNIT]` |
| `npx tsx poc/catalyst-clean-slate/scripts/verify-clean-slate-provisioning.ts --preflight` | Preflight fail-closed sin credenciales configuradas (`0` red, `0` escrituras, salida `1`) | **PASS (`FAIL` esperado)** | `[PASS-UNIT]` |
| Suites `tests/01` .. `tests/05`, `tests/07` .. `tests/14` | Seguridad anti-IDOR, límites NoSQL, gobernanza/saga, aislamiento estático `tests/05` (cero escrituras en `src/provisioning/` y `scripts/`), paridad 41 rutas, CSRF ligado, ciclo sesión y Chromium E2E | **PASS (`61 / 61`)** | `[PASS-UNIT]` / `[PASS-STATIC]` / `[PASS-MOCK]` / `[PASS-LOOPBACK]` / `[PASS-BROWSER-E2E]` |
| Suites `tests/15` .. `tests/16` (Fases 5.0 / 5.0.1) | SDK bridge (`SDK-01`..`SDK-05`), `PROJECT_ID=projectKey`, 5 proveedores `@zcatalyst/nosql` en loopback y servidor Express 41 rutas | **PASS (`8 / 8`, Tests 62–69)** | `[PASS-SDK-CONTRACT]` / `[PASS-UNIT]` / `[PASS-LOOPBACK]` |
| Suite `tests/17-phase-5.1-preflight-and-provisioning.test.ts` (Tests 70–75) | Reconciliación `5` tablas / `8` GSIs / `41` rutas, catálogo de variables y `ZAID`, 8 regiones, redacción de secretos, fail-closed en placeholders/CORS/`ZC_SECURE=override`, y prueba `--live --confirm-readonly` contra servidor HTTP loopback emulando Catalyst BaaS a través de `CatalystAdminAppProvider` + `@zcatalyst/nosql` real (`0` escrituras, detección de proyecto erróneo y datos no vacíos) | **PASS (`6 / 6`, Tests 70–75)** | `[PASS-UNIT]` / `[PASS-LOOPBACK]` |
| **`npm --prefix poc/catalyst-clean-slate test` (Total Suite)** | Ejecución completa conjunta post-edición (`tsx --test tests/*.test.ts`) | **`75 / 75 PASS` (`0` fail, `0` skipped, `23.2s`)** | **Verificado localmente** |
| `tests/06-integration-catalyst-live.spec.ts` (`INT-01..INT-08`) y matriz `BR-01..BR-20` en live | BaaS Catalyst real, `accounts.zoho.*` OAuth exchange, `UserManagement.resetPassword` (`INT-08`), dominio custom `api.vigorcore.lat` y Safari/WebKit HTTPS real | **NO EJECUTADA** | **`[PENDING-LIVE-VERIFICATION]`** |

---

## 8. Separación Estricta de Bloqueos respecto a Soporte de Zoho Catalyst

| Grupo | Qué abarca | Estado actual | Por qué pertenece a este grupo |
| --- | --- | --- | --- |
| **Grupo A — Desbloqueado y Completado Localmente** | Espejo de esquemas congelados (5 tablas, 8 GSIs), 5 proveedores tipados `@zcatalyst/nosql@1.0.0`, 41 rutas canónicas, mitigación `SDK-01..SDK-05` (`CatalystAdminAppProvider`), validador preflight sin red con redacción de secretos, verificador CLI `--live --confirm-readonly` con matrices 5/8 y `project_details.id`, plantilla `.env.example`, runbook manual y PowerShell 5.1, y `75/75` pruebas locales. | **COMPLETADO (`PASS` local)** | No requiere tickets ni cambios remotos en la infraestructura de Zoho para desarrollarse ni validarse en loopback. |
| **Grupo B — Infraestructura Remota y Cierre Post-Respuesta Zoho (ver `docs/24`)** | Creación manual de las 5 tablas vacías en proyecto aprobado; respuesta escrita de Zoho recibida el 17-nov-2026 confirma `api.vigorcore.lat` via CloudScale Domain Mapping + API Gateway + Whitelisting Authorized Domains + `zcAuth.init` nativo dentro de Advanced I/O. Siguen **`PENDING-LIVE-VERIFICATION`**: inyección real de `x-zc-admin-cred-token` en rutas `NO_AUTHENTICATION` de API Gateway, preservación de `Origin`/`Referer`/`Sec-Fetch-Site`, preflight `OPTIONS` Chromium sin duplicación, `Set-Cookie __Host-vigor_session SameSite=Strict` en Safari/WebKit, `INT-01..INT-08` y `BR-01..BR-20`. | **PARCIALMENTE ACLARADO / BLOQUEADO EN LIVE** | La arquitectura documental/local quedó reconciliada en Fase 5.1.1 (`docs/24`), pero la verificación en vivo de las cabeceras del edge y BaaS real solo puede cerrarse tras aprovisionar tablas y ejecutar pruebas controladas en Catalyst real. |

---

## 9. Confirmación Explícita de Ausencia de Operaciones Remotas

Se certifica tras el cierre de Fase 5.1:
- **No** se han creado ni modificado tablas NoSQL ni índices GSIs en Zoho Catalyst.
- **No** se han creado usuarios en Catalyst Authentication ni se ha ejecutado bootstrap de superadministrador.
- **No** se han desplegado funciones Advanced I/O ni rutas de API Gateway ni cambios en DNS (`app.vigorcore.lat` / `api.vigorcore.lat`).
- **No** se ha tocado el frontend raíz publicado (`/src/**`, `package.json` raíz), ni Zoho Slate publicado (`https://fit-x-bhnatsxl.onslate.com`), ni Firebase, ni Firestore, ni GCP.
- **No** se han introducido secretos, tokens ni credenciales reales en ningún archivo, plantilla ni salida de consola.

**Archivos añadidos o actualizados en Fase 5.1 (todos dentro de `poc/catalyst-clean-slate/`):**
- `src/provisioning/catalystConfigPreflight.ts` *(nuevo)*
- `src/provisioning/schemaReconciliationAudit.ts` *(nuevo)*
- `src/provisioning/postProvisioningVerifier.ts` *(actualizado)*
- `scripts/verify-clean-slate-provisioning.ts` *(actualizado)*
- `.env.example` *(actualizado)*
- `docs/07-manual-catalyst-tables-runbook.md` *(actualizado Sección 3)*
- `tests/17-phase-5.1-preflight-and-provisioning.test.ts` *(nuevo)*
- `docs/23-phase-5.1-catalyst-operational-readiness.md` *(este informe)*

---

## 10. Siguiente Paso Recomendado y Dictamen Final Honesto

### Dictamen final: **`OPERATIONAL_READINESS_PARTIAL`**
- El frente técnico local (**Grupo A**) está **listo y verificado**: existe coherencia exacta entre el diseño congelado (`5` tablas / `8` GSIs), los `5` proveedores reales, las `41` rutas canónicas, el preflight con redacción segura, el verificador estrictamente read-only y las **`75 / 75`** pruebas locales.
- El dictamen global permanece honestamente en **`OPERATIONAL_READINESS_PARTIAL`** porque el frente remoto (**Grupo B**) no puede cerrarse sin:
  1. Aprobación explícita del operador para crear manualmente las **5 tablas vacías** en el proyecto Catalyst designado (`docs/07` + Sección 6.1) y ejecutar `--preflight` seguido de `--live --confirm-readonly` (más comprobación visual de `ttlEpochSec = Number` y `0` ítems).
  2. Respuesta de soporte Zoho sobre infraestructura/custom domain/cookies para definir Alternativa A vs B y habilitar la ejecución controlada de `INT-01..INT-08` y `BR-01..BR-20`.

### Siguiente paso inmediato recomendado cuando decidas pasar a ejecución remota controlada:
1. Revisar y aprobar el proyecto Catalyst objetivo (sin tocar producción/Slate ni DNS público) y configurar únicamente las variables en memoria PowerShell 5.1 de la Sección 6.2.
2. Ejecutar `npx tsx scripts\verify-clean-slate-provisioning.ts --preflight` antes de abrir la consola.
3. Crear manualmente las 5 tablas vacías en orden (`Users` → `UserData` → `AdminInvitations` → `AuditLogs` → `SystemControl`) siguiendo la regla STOP-ON-ERROR.
4. Ejecutar inmediatamente `npx tsx scripts\verify-clean-slate-provisioning.ts --live --confirm-readonly` y completar la inspección visual de `ttlEpochSec` (`Number`) y `0` documentos antes de autorizar `INT-01..INT-08`.
