# VIGORCORE — FASE 4.1: PLAN DE APROVISIONAMIENTO CONTROLADO DE LAS CINCO TABLAS CLEAN-SLATE

**Fecha:** 2026-11-14  
**Directorio aislado:** `poc/catalyst-clean-slate/`  
**Dictamen:** **`CLEAN_SLATE_PROVISIONING_PLAN_READY — PENDING EXPLICIT OPERATOR AUTHORIZATION`**  
**Estado de Infraestructura:** **0** tablas creadas, **0** índices creados, **0** usuarios creados, **0** importaciones desde Firestore/Firebase, **0** bootstrap ejecutado, **0** despliegues; sitio Slate (`https://fit-x-bhnatsxl.onslate.com`), Firebase, GCP y código raíz (`src/`, `functions/`, manifiestos) 100% intactos.

---

## ENTREGABLE 1 — INFORME DE CONCILIACIÓN DE ESQUEMAS

Se auditaron línea a línea los 4 documentos normativos requeridos frente al código fuente congelado `src/types/cleanSlate.ts` (`TABLE_SCHEMA_REGISTRY`) y los tipos reales de `@zcatalyst/nosql@1.0.0` (`node_modules/@zcatalyst/nosql/dist-types/`):

1. `docs/03-nosql-data-model-and-indexes.md`
2. `docs/07-manual-catalyst-tables-runbook.md`
3. `docs/08-phase-4.0.2-schema-freeze-and-guarantees.md`
4. `docs/11-phase-4.0.5-pre-provisioning-closure.md`

### Resultado de la Conciliación

| Aspecto Auditado | Resultado | Detalle Exacto |
| :--- | :---: | :--- |
| **Número y nombres de tablas** | **SIN DISCREPANCIAS** | Exactamente **5 tablas**: `Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`. Cero tablas adicionales. |
| **Partition Keys & Sort Keys** | **SIN DISCREPANCIAS** | `Users`, `AdminInvitations` y `SystemControl` usan solo `pk` (`String`) con SK primaria omitida (`null`). `UserData` y `AuditLogs` usan `pk` (`String`) + `sk` (`String`). |
| **Additional Sort Keys** | **SIN DISCREPANCIAS** | `UserData`: `entityType`, `updatedAt` (`3/5` total SK). `AuditLogs`: `action`, `timestamp` (`3/5` total SK). Restantes: `0/5`. |
| **Secondary Indexes (8 GSIs totales)** | **SIN DISCREPANCIAS** | `Users` (3): `GSI_Email`, `GSI_Directory`, `GSI_RoleStatus`; `UserData` (1): `GSI_UserEntityDate`; `AdminInvitations` (1): `GSI_InviteEmailStatus`; `AuditLogs` (3): `GSI_AuditActor`, `GSI_AuditTarget`, `GSI_GlobalChronology`; `SystemControl` (0). |
| **Proyecciones** | **CONCILIADO (Mapeo Enum SDK)** | 7 GSIs usan proyección `ALL` (`AttribType.ALL = "all"`). `Users.GSI_Directory` usa `SPECIFIC_ATTRIBUTES` (`AttribType.INCLUDE = "include"`) proyectando las mismas **11 columnas** exactas en los 4 documentos y en `cleanSlate.ts`. |
| **TTL por Tabla y Atributo** | **SIN DISCREPANCIAS** | Desactivado en `Users`, `UserData` y `AuditLogs`. Activado con **`ttlEpochSec` (`Number` / `DataType.N`)** exclusivamente en `AdminInvitations` y `SystemControl`. En `SystemControl`, `ttlEpochSec` se asigna **solo** en `CTRL#SAGA#*` y `SESSION#<sid>`, nunca en `CTRL#BOOTSTRAP` ni `CTRL#SUPERADMIN_COUNT`. |
| **Estado / Nomenclatura de Fase** | **CONCILIADO** | `docs/08` conserva el sello histórico `CLEAN_SLATE_SCHEMA_FREEZE`; `docs/07` y `docs/12` avanzan el dictamen operativo a `CLEAN_SLATE_PROVISIONING_PLAN_READY — PENDING EXPLICIT OPERATOR AUTHORIZATION`. |

---

## ENTREGABLE 2 — FICHAS FÍSICAS EXACTAS DE LAS 5 TABLAS AUTORIZABLES

### Ficha 1 de 5 — `Users`
1. **Nombre exacto de tabla:** `Users`
2. **Partition Key:** `pk` (`String` / SDK `DataType.S`) — patrón `USER#<catalystUserId>`
3. **Sort Key Primaria:** **Omitida (`null`)** — un único ítem por partición
4. **Tipos de datos:** `pk` = `String`; atributos principales: `uid` (`String`), `email` (`String`), `normalizedEmail` (`String`), `displayName` (`String`), `role` (`String`: `athlete|admin|superadmin`), `roleVersion` (`Number`), `sessionEpoch` (`Number`), `accountStatus` (`String`: `active|suspended`), `emailVerified` (`Boolean`), `directorySegment` (`String`: `USER_SEG#0..3`), `createdAt`/`updatedAt`/`lastSignInAt` (`String` ISO-8601)
5. **Additional Sort Keys:** Ninguna (**0 adicionales; 0 / 5 SKs totales**)
6. **Secondary Indexes (`3 / 20`):**
   - `GSI_Email` — PK: `normalizedEmail` (`String`), SK: *Ninguna* (`isUniqueConstraint: false`)
   - `GSI_Directory` — PK: `directorySegment` (`String`: `USER_SEG#0..3`), SK: `createdAt` (`String`) (`isUniqueConstraint: false`)
   - `GSI_RoleStatus` — PK: `role` (`String`), SK: `accountStatus` (`String`) (`isUniqueConstraint: false`)
7. **Atributos Proyectados:**
   - `GSI_Email`: **`ALL`** (`AttribType.all`)
   - `GSI_RoleStatus`: **`ALL`** (`AttribType.all`)
   - `GSI_Directory`: **`SPECIFIC_ATTRIBUTES`** (`AttribType.include`) — exactamente 11 columnas: `pk`, `uid`, `email`, `displayName`, `role`, `roleVersion`, `accountStatus`, `emailVerified`, `directorySegment`, `createdAt`, `lastSignInAt`
8. **TTL:** **Desactivado** (`ttl_enabled: false`)
9. **Consultas soportadas / no soportadas:**
   - *Soportadas:* `fetchItem(USER#<uid>, consistent_read: true)`, búsqueda por correo en `GSI_Email`, directorio segmentado paralelo (`Promise.all` sobre `USER_SEG#0..3` orden `createdAt` descendente), filtrado exacto por `role` + `accountStatus` en `GSI_RoleStatus` (`consistent_read: true`).
   - *No soportadas directamente:* Búsqueda libre por subcadena (`contains` en `displayName`) sin paginar resultados; restricción `UNIQUE` en índice secundario.
   - *Paginación:* Cursor `start_key` y cursor compuesto base64 (`limit <= 100`).
10. **Límites y restricciones:** Tamaño <= 400 KB (techo app 350 KB); lotes escritura <= 25; lecturas <= 100/llamada; sin transacciones ACID multi-ítem.

### Ficha 2 de 5 — `UserData`
1. **Nombre exacto de tabla:** `UserData`
2. **Partition Key:** `pk` (`String` / SDK `DataType.S`) — patrón `USER#<catalystUserId>` (aislamiento multi-tenant)
3. **Sort Key Primaria:** `sk` (`String` / SDK `DataType.S`) — prefijos de las 11 áreas: `BIO#current`, `PREF#settings`, `GROCERY#<id>`, `MEAL#<dateTimeIso>#<id>`, `RECIPE#<id>`, `PLAN#<weekStartIso>`, `ROUTINE#<id>`, `WORKOUT#<startedAtIso>#<id>`, `SET#<executedWorkoutId>#<sessionId>`, `CARDIO#<dateIso>#<id>`, `NOTIF#<createdAtIso>#<id>`
4. **Tipos de datos:** `pk`, `sk`, `uid`, `entityType`, `entityId`, `entityDateKey`, `createdAt`, `updatedAt` (`String`); `version` (`Number`); `payload` (`Map` / JSON serializado <= 350 KB)
5. **Additional Sort Keys (`2` adicionales -> Total `3 / 5` SKs):** `entityType` (`String`), `updatedAt` (`String`)
6. **Secondary Indexes (`1 / 20`):**
   - `GSI_UserEntityDate` — PK: `pk` (`String`), SK: `entityDateKey` (`String`: `<ENTITY_TYPE>#<ISO_DATE>#<id>`)
7. **Atributos Proyectados:** `GSI_UserEntityDate` -> **`ALL`** (`AttribType.all`)
8. **TTL:** **Desactivado** (`ttl_enabled: false`)
9. **Consultas soportadas / no soportadas:**
   - *Soportadas:* Workspace completo por atleta (`queryTable(pk)`), rangos de fechas sobre `sk` (`BEGINS_WITH` / `BETWEEN` en comidas/sets), cronología filtrada por entidad+fecha vía `GSI_UserEntityDate`.
   - *No soportadas directamente:* Consultas *cross-user* (prohibidas por diseño anti-IDOR) ni búsqueda full-text sobre `payload`.
   - *Paginación:* `start_key` (`<= 100` ítems/página).
10. **Límites y restricciones:** Techo 350 KB (hard cap 400 KB); lotes sincronización de despensa chunked a `<= 25` ítems; invariante de sesión activa e inmutabilidad terminal en `executedWorkouts`.

### Ficha 3 de 5 — `AdminInvitations`
1. **Nombre exacto de tabla:** `AdminInvitations`
2. **Partition Key:** `pk` (`String` / SDK `DataType.S`) — patrón `INVITE#<inviteId>`
3. **Sort Key Primaria:** **Omitida (`null`)** — 1 ítem por partición
4. **Tipos de datos:** `pk`, `inviteId`, `emailNormalized`, `targetRole` (`athlete|admin`), `status` (`pending|redeeming|redeemed|revoked|expired`), `tokenHash` (`String` SHA-256), `createdBy`, `createdByEmail`, `createdAt`, `expiresAt` (`String`); `expiresAtEpochSec`, `ttlEpochSec`, `lockExpiresAtMs` (`Number`)
5. **Additional Sort Keys:** Ninguna (**0 / 5 SKs totales**)
6. **Secondary Indexes (`1 / 20`):**
   - `GSI_InviteEmailStatus` — PK: `emailNormalized` (`String`), SK: `status` (`String`)
7. **Atributos Proyectados:** `GSI_InviteEmailStatus` -> **`ALL`** (`AttribType.all`)
8. **TTL:** **Activado** (`ttl_enabled: true`), atributo **`ttlEpochSec` (`Number` / `DataType.N`)** = `expiresAtEpochSec + 86400` *(purga asíncrona únicamente; validez comprobada en backend por `expiresAtEpochSec > nowSec`)*.
9. **Consultas soportadas / no soportadas:**
   - *Soportadas:* `fetchItem(INVITE#<id>, consistent_read: true)`, verificación de invitaciones activas por correo en `GSI_InviteEmailStatus`.
   - *No soportadas:* Listado global cronológico sin `emailNormalized`.
10. **Límites y restricciones:** Canje/revocación protegidos por actualización condicional atómica de ítem único (`status === 'pending'`, verificación `data.update[0].status === 'Success'`).

### Ficha 4 de 5 — `AuditLogs`
1. **Nombre exacto de tabla:** `AuditLogs`
2. **Partition Key:** `pk` (`String` / SDK `DataType.S`) — patrón `AUDIT#<YYYY-MM>`
3. **Sort Key Primaria:** `sk` (`String` / SDK `DataType.S`) — patrón `<invertedEpochMs>#<eventId>`
4. **Tipos de datos:** `pk`, `sk`, `auditPeriodBucket`, `globalChronologyKey`, `eventId`, `action`, `actorUid`, `actorRole`, `actorEmail`, `targetUid`, `timestamp` (`String`); `changes` (`Map` / JSON)
5. **Additional Sort Keys (`2` adicionales -> Total `3 / 5` SKs):** `action` (`String`), `timestamp` (`String`)
6. **Secondary Indexes (`3 / 20`):**
   - `GSI_AuditActor` — PK: `actorUid` (`String`), SK: `timestamp` (`String`)
   - `GSI_AuditTarget` — PK: `targetUid` (`String`), SK: `timestamp` (`String`)
   - `GSI_GlobalChronology` — PK: `auditPeriodBucket` (`String`: `AUDIT_Q#<YYYY>-Q<1..4>`), SK: `globalChronologyKey` (`String`: `<ISO_TIMESTAMP>#<eventId>`)
7. **Atributos Proyectados:** Todos los GSIs -> **`ALL`** (`AttribType.all`)
8. **TTL:** **Desactivado** (`ttl_enabled: false` — retención permanente *append-only*)
9. **Consultas soportadas / no soportadas:**
   - *Soportadas:* Cronología mensual descendente por tabla base, cronología por actor/objetivo, cronología global por buckets trimestrales con merge acotado.
   - *No soportadas:* Búsqueda full-text sobre `reason` o `changes` sin leer páginas.
10. **Límites y restricciones:** Sin operaciones de borrado o actualización (*append-only*); `<= 100` eventos por página.

### Ficha 5 de 5 — `SystemControl`
1. **Nombre exacto de tabla:** `SystemControl`
2. **Partition Key:** `pk` (`String` / SDK `DataType.S`) — claves reservadas:
   - `CTRL#BOOTSTRAP`
   - `CTRL#SUPERADMIN_COUNT`
   - `CTRL#SAGA#<idempotencyKey>`
   - `SESSION#<sid>`
3. **Sort Key Primaria:** **Omitida (`null`)** — acceso O(1) por partición exacta
4. **Tipos de datos:** `pk` (`String`), metadatos de control/saga/sesión (`String` / `Number` / `Map`); **`ttlEpochSec` (`Number`)** exclusivamente en `CTRL#SAGA#*` y `SESSION#<sid>`
5. **Additional Sort Keys:** Ninguna (**0 / 5 SKs totales**)
6. **Secondary Indexes:** Ninguno (**0 / 20**)
7. **Atributos Proyectados:** *N/A* (sin índices secundarios)
8. **TTL:** **Activado** (`ttl_enabled: true`), único atributo **`ttlEpochSec` (`Number` / `DataType.N`)**:
   - **Permitido únicamente en:** `CTRL#SAGA#<idempotencyKey>` (`nowSec + 7*86400`) y `SESSION#<sid>` (`expiresAtEpochSec + 86400`).
   - **PROHIBIDO asignar en:** `CTRL#BOOTSTRAP` y `CTRL#SUPERADMIN_COUNT`.
   - **Regla de seguridad:** Expiración autoritativa de sesión validada en código mediante `expiresAtEpochSec > nowSec` tras `consistent_read: true`.
9. **Consultas soportadas / no soportadas:**
   - *Soportadas:* `fetchItem(pk, { consistent_read: true })` y `updateItem` condicional de un único ítem inspeccionando `data.update[0].status`.
   - *No soportadas:* Escaneo masivo de sagas/sesiones (no requerido).
10. **Límites y restricciones:** Prohibido depender de `insertItems` condicional sobre partición vacía; mutaciones automáticas de `superadmin` bloqueadas por defecto (`liveAtomicityVerifiedForSuperadminMutations: false`) hasta `INT-01`.

---

## ENTREGABLES 3 Y 4 — RUNBOOK MANUAL PASO A PASO Y CHECKLIST POST-APROVISIONAMIENTO

El procedimiento manual detallado y las comprobaciones visuales inmediatas tras cada tabla residen en **`docs/07-manual-catalyst-tables-runbook.md`**. Resumen del checklist de solo lectura tras crear las 5 tablas:

1. [ ] Confirmar en Catalyst Console -> NoSQL que existen **exactamente 5 tablas** (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`) en estado `ONLINE`.
2. [ ] Confirmar visualmente en Catalyst Console que `ttlEpochSec` está configurado con tipo **`Number`** en `AdminInvitations` y `SystemControl`, y que el TTL está desactivado en `Users`, `UserData` y `AuditLogs`.
3. [ ] Confirmar visualmente que `Users.GSI_Directory` usa proyección específica con exactamente 11 columnas y que el Data Browser reporta **0 documentos** en todas las tablas.
4. [ ] Confirmar en Catalyst Authentication que hay **0 usuarios** registrados.
5. [ ] Ejecutar en consola el script de verificación **estrictamente de solo lectura**:
   ```bash
   npx tsx scripts/verify-clean-slate-provisioning.ts --live --confirm-readonly
   ```
   y confirmar `verdict: "PASS_READONLY_CLEAN_SLATE"`, `writeOperationsExecuted: 0`, `authUsersCount: 0` y `discrepancies: []`.

---

## ENTREGABLE 5 — HERRAMIENTA / SCRIPT DE VERIFICACIÓN DE SOLO LECTURA

- **Módulo:** `src/provisioning/postProvisioningVerifier.ts`
- **CLI ejecutables:** `scripts/verify-clean-slate-provisioning.ts`
- **Garantías verificadas:**
  - Expone exclusivamente métodos de lectura (`getAllTable()`, `fetchItem()`, `queryTable()`, `queryIndex()`, `UserManagement.getAllUsers()`).
  - Modo por defecto sin `--live`: ejecuta `runOfflineSelfCheck()` con **0 llamadas de red** y **0 escrituras**.
  - Modo remoto `--live`: exige explícitamente `--confirm-readonly` y credenciales administrativas por variables de entorno (`ZC_PROJECT_ID`, `ZC_PROJECT_KEY`, `ZC_CLIENT_ID`, `ZC_CLIENT_SECRET`, `ZC_REFRESH_TOKEN`, `ZC_ENVIRONMENT`).
  - Valida tablas exactas, estado `ONLINE`, `partition_key`, `sort_key` omitida o presente, `additional_sort_keys`, los 8 GSIs, proyección `GSI_Directory` (11 columnas tanto en `Set<string>` como `Array<string>`), `ttl_enabled` + `ttl_attribute === 'ttlEpochSec'`, ausencia de datos mediante sondeos `consistent_read: true` (`USER_SEG#0..3`, `GSI_RoleStatus`, `CTRL#BOOTSTRAP`, `CTRL#SUPERADMIN_COUNT`, `AUDIT#YYYY-MM`, `AUDIT_Q#YYYY-QN`), `metrics`, y `getAllUsers().length === 0`.

---

## ENTREGABLES 6 Y 7 — PRUEBAS AUTOMATIZADAS Y CLASIFICACIÓN ESTRICTA

- **Pruebas ejecutadas localmente en Fase 4.1 (`node --test --import tsx`):**
  - `tests/01-auth-and-anti-idor.test.ts`: **PASS-MOCK**
  - `tests/02-domain-validators-and-invariants.test.ts`: **PASS-UNIT / PASS-MOCK**
  - `tests/03-nosql-schema-indexes-and-limits.test.ts`: **PASS-UNIT / PASS-MOCK**
  - `tests/04-admin-rbac-bootstrap-and-saga.test.ts`: **PASS-MOCK**
  - `tests/05-static-isolation-and-clean-slate.test.ts`: **PASS-STATIC** (incluye validación estática de cero escrituras en `src/provisioning/` y `scripts/`)
  - `tests/07-session-lifecycle-and-http-security.test.ts`: **PASS-UNIT / PASS-MOCK**
  - `tests/08-provisioning-verification-readonly.test.ts`: **PASS-UNIT / PASS-MOCK** (validación de `runOfflineSelfCheck`, `verifySchemaAgainstRegistry`, `probeCleanSlateEmptyAndContracts` con clúster vacío simulado, fallos ante *schema drift*, registros residuales, `metrics > 0` o usuarios en Auth, y bloqueo de `--live` sin `--confirm-readonly`)
- **Pruebas remotas y navegador real (`tests/06-integration-catalyst-live.spec.ts`):**
  - `INT-01..INT-08`: **`PENDING (PASS-INTEGRATION)`**
  - `BR-01..BR-20` (**Chromium** & **Safari/WebKit**): **`PENDING (PASS-INTEGRATION)`**

---

## ENTREGABLE 8 — RIESGOS Y LIMITACIONES HONESTAS

1. **Limitación SDK sobre tipo de columna TTL:** En `@zcatalyst/nosql@1.0.0` (`INoSQLTable`), `ttl_attribute` devuelve únicamente el nombre del atributo (`string | undefined`), no su tipo (`DataType.N`). Por ello el runbook exige validación visual de `ttlEpochSec = Number` en Catalyst Console.
2. **Ausencia de `SCAN` nativo en `@zcatalyst/nosql@1.0.0`:** La SDK no expone escaneo completo de tabla; el verificador compensa sondeando todos los segmentos conocidos (`USER_SEG#0..3`, `GSI_RoleStatus`, `CTRL#BOOTSTRAP`, `CTRL#SUPERADMIN_COUNT`, mes/trimestre actual de `AuditLogs`) y `INoSQLTable.metrics` si está poblado, pero requiere confirmación visual de `0 documentos` en Data Browser.
3. **Índices secundarios no únicos:** `GSI_Email` no impone `UNIQUE` en base de datos; depende de lecturas `consistent_read: true` y verificación de unicidad en Catalyst Auth (`INT-03` pendiente).
4. **TTL asíncrono vs validez inmediata de sesión:** El TTL de Catalyst no borra al instante; toda sesión sigue validándose en backend con `expiresAtEpochSec > nowSec` y lectura consistente.
5. **Bloqueo *cross-site* de Slate (`https://fit-x-bhnatsxl.onslate.com`):** La compatibilidad real de cookies `__Host-vigor_session` (`SameSite=Strict`) depende de elegir e implementar la topología de dominio **Alternativa A, B o C** antes de `INT-06`/`INT-07` en Chromium y Safari/WebKit.

---

## ENTREGABLE 9 — INVENTARIO DE ENTREGABLES Y HASHES SHA-256

| Archivo (`poc/catalyst-clean-slate/...`) | SHA-256 |
| :--- | :--- |
| `src/types/cleanSlate.ts` | `c6f13a3cab647bed33ab380055fee0537bf5f465ddd9f5f18e4da1b0d3eede97` |
| `src/security/httpSecurityPolicy.ts` | `779a61e0f25ac3bddaa7518ef36f90f4b5624b2f4425fb44b9c05f29571e8e98` |
| `src/auth/cleanSlateAuthGuard.ts` | `3a6b13c4516fbad570bcc09bcf78b61619573582ccd7de343ef892a8f2581412` |
| `src/routes/apiRouterSchema.ts` | `766b151bf261ea9b01d603d1e24345768b713cf8861e4d591f643bcab28a1d96` |
| `src/nosql/catalystModularAdapter.ts` | `e35427bee470a59e24736e88889f5f95bcdd81defac9c69e36c0679d50b6f220` |
| `src/nosql/cleanSlateEngine.ts` | `4631050fefc926c97fd48e6215729000f5756159d593e9c6ef263eeea2275a5b` |
| `src/provisioning/postProvisioningVerifier.ts` | `7b23b5fff4a03cf77cf042eb6fe3d5843bf75b1f7e362c8fdb37c6a7d699584e` |
| `src/services/adminGovernanceService.ts` | `913a0e1139d308b539ecd059dbb86fd5d8d130c116a885bab059305cbac5540a` |
| `src/services/athleteDataService.ts` | `185f5eaa9e0c8cb1b3e03ea1ac6512018e90190aec04e2d1eb8a29a4e16193f4` |
| `src/validators/domainValidators.ts` | `a7763424f0b8035f697ff30aeb235a3470cb25110303e493fead7c59c0891e16` |
| `scripts/verify-clean-slate-provisioning.ts` | `e13704c448f7a8110a0c26d3bfe253440e6a6aabd1e51b9a8ac9de3682487e07` |
| `tests/01-auth-and-anti-idor.test.ts` | `c841af4af63e6486d2c582db88ecaed3aaca1e782e26a42b42c182d3d9301bdb` |
| `tests/02-domain-validators-and-invariants.test.ts` | `b1b7dc6be03e8b92df2f665820f39a4d585773b133aecd3baf9b005bea152070` |
| `tests/03-nosql-schema-indexes-and-limits.test.ts` | `2899a61f96518a9cb27faa72c31a06e30a59746c6267c5a0482b2b5d8507c251` |
| `tests/04-admin-rbac-bootstrap-and-saga.test.ts` | `f478f70eeb3e23af7f4b7d165b5b1ec2477ad4b33ed0179aea899f49054c249a` |
| `tests/05-static-isolation-and-clean-slate.test.ts` | `9f876a7431cd06c48c87fe6265a23774f52fc4a472493f2a6e9527741717820c` |
| `tests/06-integration-catalyst-live.spec.ts` | `ca9ecb83e6717b98745819e0a2777552d247e608f13de9f309a9a34b83d72471` |
| `tests/07-session-lifecycle-and-http-security.test.ts` | `5ea6fad5fccda7aba9be9da602c8cdefb6d2228928bcd9ca45cbeb1c61ed94af` |
| `tests/08-provisioning-verification-readonly.test.ts` | `99b3c53dfc011b682b3649edb848dde867543da17640625dd5fd744d9957c4ce` |
| `docs/01-clean-slate-architecture-report.md` | `9cb831754ccc9f0df985675f2ebbe09074edbaf94b47497d86c3c6757e5182db` |
| `docs/02-functional-inventory.md` | `450c96b2d343956e2c5cad9c3e653f5bee79ad00595b4ea5275becee5df728b4` |
| `docs/03-nosql-data-model-and-indexes.md` | `d6a538addeed254b3b39872e58470d0c6ea9a84c593a752b113ca892fbfd03c8` |
| `docs/04-equivalence-auth-endpoints-security.md` | `9d7cb20791150c4cf50f60ff9940c4a806136ed57027c11b88e6b7fe5b2f77bb` |
| `docs/05-verification-and-test-report.md` | `c301470d8f202ad681c6c68bb7909d75cac14b08341890d1c29dd7399f967e23` |
| `docs/06-adversarial-audit-4.0.1.md` | `449e8c6c4587234fbb75ff2eeca2eea47f11585314ca0ed71570f9e12c3fb90b` |
| `docs/07-manual-catalyst-tables-runbook.md` | `00e535857e21ec46210b8c186ad8c49c658f49287ef0f13777509694736340a8` |
| `docs/08-phase-4.0.2-schema-freeze-and-guarantees.md` | `8e7c1f7b2b54f5f11c5f2f6cb423739915260c94936749c87a0f00bd6a18de0a` |
| `docs/09-phase-4.0.3-auth-and-sdk-audit.md` | `152f2b400e3390478057d6a9e86d80f3a8b1bf3117559125e21ff6d62f826a76` |
| `docs/10-phase-4.0.4-session-and-slate-compatibility.md` | `87622265d6b7c881cb568969ce9a50c398d5f49776f22e9c646955deae5c458b` |
| `docs/11-phase-4.0.5-pre-provisioning-closure.md` | `acb699e53916e36b673d147aa433f036676aa5f65a23851bc2731c16a936341d` |

*(Nota: el hash SHA-256 propio de `docs/12-phase-4.1-provisioning-plan.md` se calcula y reporta en el dictamen final tras cerrar esta tabla.)*
