# VIGORCORE — RUNBOOK MANUAL DE APROVISIONAMIENTO CLEAN-SLATE EN ZOHO CATALYST (FASE 4.1)

> **ESTADO: `CLEAN_SLATE_PROVISIONING_PLAN_READY — PENDING EXPLICIT OPERATOR AUTHORIZATION` (CERO RECURSOS REMOTOS CREADOS).**  
> **Prohibición vigente:** NO crear tablas, índices ni usuarios en Zoho Catalyst, NO importar documentos desde Firestore/Firebase, NO ejecutar bootstrap ni despliegues, y NO modificar Slate (`https://fit-x-bhnatsxl.onslate.com`), Firebase ni GCP hasta autorización explícita del operador.

---

## 1. REGLAS ESTRICTAS DE EJECUCIÓN MANUAL (SIN INVENCIÓN DE CONTROLES UI)

1. Este runbook define los **parámetros físicos exactos** congelados en `src/types/cleanSlate.ts` (`TABLE_SCHEMA_REGISTRY`) y contrastados contra `@zcatalyst/nosql@1.0.0`.
2. **NO se inventan etiquetas visuales de botones o pestañas** de la consola web de Zoho Catalyst (las pantallas pueden variar según versión de UI). Utiliza únicamente los valores físicos exactos listados en la Sección 2.
3. **REGLA DE DETENCIÓN INMEDIATA (FAIL-CLOSED):** Si durante la creación en Zoho Catalyst Console observas cualquiera de estas condiciones, **DETENTE y documenta el bloqueador** sin improvisar cambios de esquema:
   - La consola obligara a definir *Sort Key* en tablas especificadas como `Sort Key Primaria: Omitida` (`Users`, `AdminInvitations`, `SystemControl`).
   - La consola no permitiera configurar `ttlEpochSec` con tipo `Number` en `AdminInvitations` o `SystemControl`.
   - La consola no permitiera proyectar las 11 columnas exactas de `Users.GSI_Directory` bajo proyección específica (`SPECIFIC_ATTRIBUTES` / `include`).
   - Existiera previamente alguna de las 5 tablas con datos residuales o un usuario de aplicación ya creado.
4. **Limpieza absoluta Clean-Slate:** La base comienza **con 0 documentos** en todas las tablas y **0 usuarios** en Catalyst Authentication hasta completar las verificaciones de solo lectura.

---

## 2. CREACIÓN MANUAL PASO A PASO DE LAS 5 TABLAS (CON CHECKLIST VISUAL INMEDIATO)

*(Las claves principales, Sort Keys adicionales y GSIs son **inmutables** tras crearse.)*

### Paso 1 — Tabla 1: `Users`
- **Nombre exacto de tabla:** `Users`
- **Partition Key:** nombre `pk`, tipo **`String`** (`DataType.S`) — patrón runtime `USER#<catalystUserId>`
- **Primary Sort Key:** **Omitida / No habilitar** (`null` — 1 ítem por partición)
- **Additional Sort Keys:** **Ninguna (`0 / 5`)**
- **TTL:** **Desactivado** (`ttl_enabled: false`)
- **Global Secondary Indexes (`3 / 20`):**
  1. `GSI_Email`
     - PK: `normalizedEmail` (`String`)
     - SK: *Ninguna / Omitida*
     - Proyección: **`ALL`** (`AttribType.all`) *(no impone `UNIQUE` nativo; la app valida duplicados con `consistent_read: true`)*
  2. `GSI_Directory`
     - PK: `directorySegment` (`String` — valores runtime `USER_SEG#0..3`)
     - SK: `createdAt` (`String`)
     - Proyección: **`SPECIFIC_ATTRIBUTES`** (`AttribType.include`) con **exactamente estas 11 columnas**:
       `pk`, `uid`, `email`, `displayName`, `role`, `roleVersion`, `accountStatus`, `emailVerified`, `directorySegment`, `createdAt`, `lastSignInAt`
  3. `GSI_RoleStatus`
     - PK: `role` (`String`)
     - SK: `accountStatus` (`String`)
     - Proyección: **`ALL`** (`AttribType.all`)
- **Verificación visual inmediata post-creación (`Users`):**
  - [ ] Estado de tabla `Users` = `ONLINE`.
  - [ ] PK = `pk` (`String`), sin Primary Sort Key ni Additional Sort Keys.
  - [ ] TTL completamente desactivado.
  - [ ] Los 3 GSIs figuran activos (`ONLINE`), `GSI_Directory` lista exactamente las 11 columnas especificadas.
  - [ ] Data Browser muestra **0 documentos**.

### Paso 2 — Tabla 2: `UserData`
- **Nombre exacto de tabla:** `UserData`
- **Partition Key:** nombre `pk`, tipo **`String`** (`DataType.S`) — patrón runtime `USER#<catalystUserId>`
- **Primary Sort Key:** nombre `sk`, tipo **`String`** (`DataType.S`) — prefijos: `BIO#`, `PREF#`, `GROCERY#`, `MEAL#`, `RECIPE#`, `PLAN#`, `ROUTINE#`, `WORKOUT#`, `SET#`, `CARDIO#`, `NOTIF#`
- **Additional Sort Keys (`2` adicionales -> Total SK = `3 / 5`):**
  1. `entityType` (`String`)
  2. `updatedAt` (`String`)
- **TTL:** **Desactivado** (`ttl_enabled: false`)
- **Global Secondary Indexes (`1 / 20`):**
  1. `GSI_UserEntityDate`
     - PK: `pk` (`String`)
     - SK: `entityDateKey` (`String`)
     - Proyección: **`ALL`** (`AttribType.all`)
- **Verificación visual inmediata post-creación (`UserData`):**
  - [ ] Estado = `ONLINE`.
  - [ ] PK = `pk` (`String`), Primary SK = `sk` (`String`), Additional SKs = `entityType` (`String`), `updatedAt` (`String`).
  - [ ] TTL desactivado.
  - [ ] GSI `GSI_UserEntityDate` (`pk` -> `entityDateKey`, `ALL`) = `ONLINE`.
  - [ ] Data Browser muestra **0 documentos**.

### Paso 3 — Tabla 3: `AdminInvitations`
- **Nombre exacto de tabla:** `AdminInvitations`
- **Partition Key:** nombre `pk`, tipo **`String`** (`DataType.S`) — patrón runtime `INVITE#<inviteId>`
- **Primary Sort Key:** **Omitida / No habilitar** (`null`)
- **Additional Sort Keys:** **Ninguna (`0 / 5`)**
- **TTL:** **Activado** (`ttl_enabled: true`) — atributo exacto **`ttlEpochSec`**, tipo **`Number`** (`DataType.N`, Unix epoch en segundos). *(Regla backend: validez comprobada con `expiresAtEpochSec > nowSec` tras lectura consistente.)*
- **Global Secondary Indexes (`1 / 20`):**
  1. `GSI_InviteEmailStatus`
     - PK: `emailNormalized` (`String`)
     - SK: `status` (`String`)
     - Proyección: **`ALL`** (`AttribType.all`)
- **Verificación visual inmediata post-creación (`AdminInvitations`):**
  - [ ] Estado = `ONLINE`.
  - [ ] PK = `pk` (`String`), sin Sort Key ni Additional Sort Keys.
  - [ ] TTL activado con atributo `ttlEpochSec` de tipo **`Number`**.
  - [ ] GSI `GSI_InviteEmailStatus` (`emailNormalized` -> `status`, `ALL`) = `ONLINE`.
  - [ ] Data Browser muestra **0 documentos**.

### Paso 4 — Tabla 4: `AuditLogs`
- **Nombre exacto de tabla:** `AuditLogs`
- **Partition Key:** nombre `pk`, tipo **`String`** (`DataType.S`) — patrón runtime `AUDIT#<YYYY-MM>`
- **Primary Sort Key:** nombre `sk`, tipo **`String`** (`DataType.S`) — patrón runtime `<invertedEpochMs>#<eventId>`
- **Additional Sort Keys (`2` adicionales -> Total SK = `3 / 5`):**
  1. `action` (`String`)
  2. `timestamp` (`String`)
- **TTL:** **Desactivado** (`ttl_enabled: false` — bitácora inmutable)
- **Global Secondary Indexes (`3 / 20`):**
  1. `GSI_AuditActor` — PK `actorUid` (`String`), SK `timestamp` (`String`), Proyección `ALL`
  2. `GSI_AuditTarget` — PK `targetUid` (`String`), SK `timestamp` (`String`), Proyección `ALL`
  3. `GSI_GlobalChronology` — PK `auditPeriodBucket` (`String`, patrón `AUDIT_Q#<YYYY>-Q<1..4>`), SK `globalChronologyKey` (`String`), Proyección `ALL`
- **Verificación visual inmediata post-creación (`AuditLogs`):**
  - [ ] Estado = `ONLINE`.
  - [ ] PK = `pk` (`String`), Primary SK = `sk` (`String`), Additional SKs = `action` (`String`), `timestamp` (`String`).
  - [ ] TTL desactivado.
  - [ ] Los 3 GSIs (`GSI_AuditActor`, `GSI_AuditTarget`, `GSI_GlobalChronology`) = `ONLINE`.
  - [ ] Data Browser muestra **0 documentos**.

### Paso 5 — Tabla 5: `SystemControl`
- **Nombre exacto de tabla:** `SystemControl`
- **Partition Key:** nombre `pk`, tipo **`String`** (`DataType.S`) — valores runtime reservados: `CTRL#BOOTSTRAP`, `CTRL#SUPERADMIN_COUNT`, `CTRL#SAGA#<idempotencyKey>`, `SESSION#<sid>`
- **Primary Sort Key:** **Omitida / No habilitar** (`null`)
- **Additional Sort Keys:** **Ninguna (`0 / 5`)**
- **Global Secondary Indexes:** **Ninguno (`0 / 20`)**
- **TTL DEFINITIVO:** **Activado** (`ttl_enabled: true`) — único atributo TTL **`ttlEpochSec`**, tipo **`Number`** (`DataType.N`):
  - **Usado ÚNICAMENTE en:** `CTRL#SAGA#<idempotencyKey>` y `SESSION#<sid>`.
  - **PROHIBIDO asignar `ttlEpochSec` en:** `CTRL#BOOTSTRAP` y `CTRL#SUPERADMIN_COUNT`.
  - **Regla estricta de backend:** La expiración de `SESSION#<sid>` se verifica siempre con `expiresAtEpochSec > nowSec` tras lectura `consistent_read: true`; jamás se delega la autorización al daemon asíncrono TTL.
- **Verificación visual inmediata post-creación (`SystemControl`):**
  - [ ] Estado = `ONLINE`.
  - [ ] PK = `pk` (`String`), sin Sort Key, sin Additional Sort Keys, 0 GSIs.
  - [ ] TTL activado con atributo `ttlEpochSec` de tipo **`Number`**.
  - [ ] Data Browser muestra **0 documentos** (aún no existen `CTRL#BOOTSTRAP` ni `CTRL#SUPERADMIN_COUNT`).

---

## 3. VERIFICACIÓN POST-APROVISIONAMIENTO DE SOLO LECTURA (SIN ESCRITURAS)

Tras crear manualmente las 5 tablas (y **antes** de autorizar `INT-01..INT-08`, alta de usuarios o bootstrap):

1. Ejecutar comprobación automática local offline (sin red):
   ```powershell
   npx tsx scripts/verify-clean-slate-provisioning.ts
   ```
2. Ejecutar preflight local de variables y configuración Catalyst (sin red ni escrituras; redacta secretos automáticamente):
   ```powershell
   npx tsx scripts/verify-clean-slate-provisioning.ts --preflight
   ```
3. Ejecutar inspección **estrictamente de solo lectura** contra el proyecto Catalyst aprobado (requiere variables `CATALYST_PROJECT_ID`, `CATALYST_PROJECT_KEY`, `CATALYST_ENVIRONMENT`, `VIGOR_ENVIRONMENT`, `CATALYST_API_DOMAIN`, `CATALYST_ACCOUNTS_URL`, credenciales OAuth administrativas `CATALYST_ADMIN_CLIENT_ID`/`SECRET`/`REFRESH_TOKEN` o `CATALYST_ADMIN_ACCESS_TOKEN`, y confirmación explícita):
   ```powershell
   npx tsx scripts/verify-clean-slate-provisioning.ts --live --confirm-readonly
   ```
   El script ejecuta primero el preflight fail-closed y luego valida via `CatalystAdminAppProvider` + `NoSQL.getAllTable()` (`INoSQLTable`), `project_details.id`, claves PK/SK, Additional SKs, 8 GSIs, proyecciones, `ttl_enabled`/`ttl_attribute`, ausencia de tablas extra, sondeos vacíos de solo lectura con `consistent_read: true`, y `UserManagement.getAllUsers() === 0`, con **0 operaciones de escritura**.
4. Completar manualmente en consola los puntos no expuestos por el SDK `@zcatalyst/nosql@1.0.0`:
   - Confirmar visualmente que el tipo de columna `ttlEpochSec` en `AdminInvitations` y `SystemControl` es **`Number`**.
   - Confirmar visualmente en el Data Browser de Catalyst Console **0 documentos** en las 5 tablas y **0 usuarios** en Authentication.

---

## 4. REQUISITOS DEL BOOTSTRAP OFFLINE Y SEGURIDAD HTTP (SIN CAMBIOS RESPECTO A 4.0.5)

- El bootstrap offline del primer superadministrador (`executeOfflineAdminBootstrap()`), la prohibición de ruta HTTP pública `/bootstrap-superadmin`, la generación CSPRNG de `VIGOR_SESSION_HMAC_SECRET` (256 bits Base64URL canónico), la cookie `__Host-vigor_session` (`HttpOnly; Secure; SameSite=Strict; Path=/`, sin `Domain=`), CORS allowlist, CSRF (`POST/PUT/PATCH/DELETE`) y la elección obligatoria de topología **Alternativa A, B o C** para `https://fit-x-bhnatsxl.onslate.com` permanecen congelados conforme a `docs/11-phase-4.0.5-pre-provisioning-closure.md`.
- La suite `INT-01..INT-08` y la matriz de navegador `BR-01..BR-20` (Chromium y Safari/WebKit) permanecen **`PENDING`** hasta autorización separada posterior al aprovisionamiento vacío.
