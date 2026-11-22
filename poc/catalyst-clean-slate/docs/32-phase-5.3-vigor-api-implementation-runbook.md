# VIGORCORE — FASE 5.3: RUNBOOK DE PREPARACIÓN E IMPLEMENTACIÓN DE `vigor_api` (DEVELOPMENT FIRST)

**Proyecto en Google AI Studio:** `Fit-X` *(trabajo estrictamente aislado en `poc/catalyst-clean-slate/`)*  
**Proyecto Zoho Catalyst:** `Project-Rainfall`  
**CATALYST_PROJECT_ID:** `136967000000014024`  
**Data Center:** `US` (`accounts.zoho.com` · `https://api.catalyst.zoho.com`)  
**Entorno objetivo:** **`Development`** *(**`Production` sin modificar**)*  
**Líneas base heredadas:**  
- **Fase 5.2, Etapa 1 (NoSQL):** **`PHASE_5_2_STAGE_1_NOSQL_PROVISIONING_COMPLETED`** (`docs/29`, `phase52Stage1Inventory.ts`)  
- **Fase 5.2, Etapa 2 (Native Auth):** **`PHASE_5_2_STAGE_2_NATIVE_AUTH_CONFIGURED_PENDING_LIVE_VERIFICATION`** (`docs/30`, `docs/31`, `phase52Stage2Inventory.ts`)  
- **Dominio API personalizado (`api.vigorcore.lat`):** **`BLOCKED_PENDING_ZOHO_CLARIFICATION`**  
**Operaciones remotas ejecutadas en esta preparación:** **`0`** *(solo auditoría de código, validación/compilación local y documentación)*  
**Dictamen base del runbook (Fase 5.3):** **`PHASE_5_3_RUNBOOK_READY_NOT_EXECUTED`**  
**Conciliación técnica previa al primer despliegue:** **`PHASE_5_3_PREDEPLOYMENT_RECONCILIATION_READY_NOT_EXECUTED`** *(ver expediente completo en `docs/33-phase-5.3-predeployment-reconciliation.md`)*

---

## REGLAS DE ALCANCE Y HONESTIDAD OPERATIVA

1. En esta fase **NO se ha ejecutado ninguna operación remota** contra Zoho Catalyst:
   - NO se ha creado ni desplegado la función `vigor_api`.
   - NO se ha habilitado API Gateway (`Enable now` permanece deshabilitado).
   - NO se han modificado `Security Rules`, `Domain Mapping` ni registros DNS.
   - NO se han creado usuarios en Authentication ni registros de prueba en NoSQL.
   - NO se ha modificado `Production`, el frontend Slate (`https://app.vigorcore.lat`), el frontend raíz fuera de `poc/catalyst-clean-slate/`, Firebase ni GCP.
2. **Las pruebas locales NO equivalen a pruebas en vivo:** las suites `[PASS-UNIT]`, `[PASS-STATIC]` y `[PASS-LOOPBACK]` confirman contratos, esquemas, cabeceras y lógica Express/SDK sobre adaptadores simulados o servidor loopback local; **no demuestran por sí mismas** el comportamiento real de Zoho Catalyst Edge, Catalyst Advanced I/O, NoSQL físico ni API Gateway, cuyos elementos reales permanecen marcados como **`PENDING_LIVE_VERIFICATION`**.
3. **Prohibición de fallback no autorizado:** `VIGOR_CATALYST_AUTH_MODE` debe mantenerse estrictamente en **`hosted_native`**. **Queda prohibido activar `external_oauth`** como fallback salvo que una prueba en vivo con API Gateway demuestre insuficiencia de cabeceras `x-zc-admin-cred-*` y exista **autorización independiente expresa**.

---

## 1. AUDITORÍA COMPLETA DEL BACKEND (`poc/catalyst-clean-slate/`)

Se auditó el código real compilable en `poc/catalyst-clean-slate/` antes de empaquetar o desplegar `vigor_api`:

### 1.1 `catalystEntry.ts` y proceso de empaquetado (`tsconfig.server.json` + `package.json`)
- **Archivo fuente:** `src/server/catalystEntry.ts` (compila a `dist/server/catalystEntry.js` vía `npm --prefix poc/catalyst-clean-slate run build:server` usando `tsconfig.server.json` con `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"noEmit": false`, `"outDir": "./dist"`, excluyendo `src/frontend/**/*`, `scripts/**/*`, `tests/**/*`).
- **Exportaciones e inicialización perezosa:**
  - Exporta `catalystAdvancedIoEntry(req, res)`, `getOrInitializeAdvancedIoRuntime`, `resetAdvancedIoRuntimeForTests`, `startStandaloneLocalServer`, y **`export default catalystAdvancedIoEntry`**.
  - **Sin `listen()` al importar:** importar `dist/server/catalystEntry.js` **no** lee secretos de entorno ni abre sockets TCP automáticamente. El runtime se inicializa bajo demanda (`getOrInitializeAdvancedIoRuntime`) en la primera petición y, ante fallo de configuración, responde HTTP **`503 SERVER_CONFIGURATION_UNAVAILABLE`** redactado mediante `redactSecretsFromString()`.
  - **`startStandaloneLocalServer`:** pensado solo para ejecución local/CLI leyendo `X_ZOHO_CATALYST_LISTEN_PORT || PORT || 0` sobre `127.0.0.1`.
- **Hallazgo crítico de auditoría (`AUD-53-01` — Manifiesto, lockfile y empaquetado ESM Node 22):**
  - El `package.json` de `poc/catalyst-clean-slate/` declara `"type": "module"` y `"engines": { "node": ">=22" }`, pero **carece del campo `"main"`** y mezcla dependencias de desarrollo/frontend/test (`playwright-core`, `tsx`, `typescript`, `@types/express`, `@types/node`) que **no deben empaquetarse** en la función serverless. Aunque existe un `package-lock.json` raíz para `vigorcore-catalyst-clean-slate` (`54,142` bytes), dicho lockfile incluye las `devDependencies` y ese nombre de paquete; además no existe `catalyst-config.json` vivo en la raíz (solo plantilla no aplicada en `config/candidates/`).
  - La importación ESM real de `dist/server/catalystEntry.js` sobre Node `v22.23.2` resuelve las **6** dependencias de producción y expone `default` (`catalystAdvancedIoEntry`) sin abrir puertos; sin embargo, al preparar el paquete de staging para Catalyst (`node22` Advanced I/O), el operador debe generar un directorio limpio con `dist/`, `package.json` de solo producción (`"name": "vigor_api"`, `"main": "dist/server/catalystEntry.js"`, `"type": "module"`), instalar dependencias de runtime con `npm install --omit=dev --ignore-scripts` (sin reutilizar un `package-lock.json` incompatible de raíz con `devDependencies`), e incluir `catalyst-config.json` (`"type": "advancedio"`, `"stack": "node22"`, `"main": "dist/server/catalystEntry.js"`).
  - La carga efectiva del módulo ESM (`export default catalystAdvancedIoEntry`) por el cargador real de Catalyst Advanced I/O Node 22 en `Project-Rainfall` queda marcada **`PENDING_LIVE_VERIFICATION`** (detalle ampliado en `docs/33`, Sección 3).

### 1.2 Express (`advancedIoApp.ts`) y los 41 endpoints (`CleanSlateApiDispatcher`)
- **Normalización de prefijo y anti-traversal (`normalizeCatalystPath`):**
  - Elimina el prefijo de montaje `/server/<functionName>` (por ejemplo `/server/vigor_api/api/v1/...` → `/api/v1/...`) conservando coincidencia 1:1 con las **41** rutas de `ROUTE_CONTRACT_SPECS` (verificado por `verifyGatewayRewriteCoverage('vigor_api')`).
  - Rechaza fail-closed (`400 INVALID_REQUEST_PATH`) bytes nulos `\0`, barras invertidas `\`, codificación porcentual malformada, segmentos `.` / `..` y prefijos `/server/<fn>` inválidos.
- **Hardening HTTP de Express (`createVigorCoreExpressApp`):**
  - `app.disable('x-powered-by')` y `app.set('trust proxy', 1)`.
  - Cabeceras de seguridad en todas las respuestas: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `Pragma: no-cache`.
  - Límite de JSON body `1mb` (`413 PAYLOAD_TOO_LARGE` / `400 INVALID_JSON_BODY`).
  - Solo acepta `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` (`405 METHOD_NOT_ALLOWED` para cualquier otro método).
  - `ROUTE_DEFINITIONS` verifica paridad exacta de longitud e IDs contra `ROUTE_CONTRACT_SPECS` (**41 rutas**).

### 1.3 Middleware de autenticación, autorización y `AsyncLocalStorage` (`CleanSlateAuthGuard` + `HostedNativeCatalystAuthRuntime`)
- **Aislamiento por petición (`wrapDispatch`):** en modo `VIGOR_CATALYST_AUTH_MODE=hosted_native`, cada petición no-`OPTIONS` (y distinta de `/health` / `/api/v1/health`) se ejecuta dentro de `hostedRuntime.runWithRequestContext(headers, executeDispatch)` usando `AsyncLocalStorage<CatalystApp>`.
- **`buildHostedAdminAppFromHeaders`:**
  - Valida `x-zc-projectid === '136967000000014024'` y `x-zc-environment === 'Development'` (y `x-zc-project-key` si `CATALYST_PROJECT_KEY` está fijada en servidor) o rechaza fail-closed con **`403 PROJECT_CONTEXT_MISMATCH`**.
  - Exige presencia de `x-zc-admin-cred-type` y `x-zc-admin-cred-token` (o falla fail-closed con **`503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE`** sin fallback silencioso).
  - Instancia un `new ZCAuth()` nuevo por petición (`{ type: 'advancedio', scope: 'admin' }`) y fija (`pin`) `apiDomain`, `authPortalDomain`, `projectKey` y `servedByCLI = false` para evitar el estado global compartido de `appOptions` y mitigar `SDK-01`/`SDK-05`.
- **`getCurrentUserFromRequest` (`scope: 'user'`):**
  - Rechaza **`403 CATALYST_ADMIN_HEADER_SPOOFED`** si entra `x-zc-user-type: admin`.
  - En rutas `catalyst_exchange` (`/bootstrap-profile`, `/exchange`) y `catalyst_or_hmac_inspect` (`/auth/me`), exige token/cookie Catalyst de usuario válido, construye cabeceras sanitizadas con `scope: 'user'`, ejecuta `new UserManagement(userApp).getCurrentUser()` y valida fail-closed `status === 'ACTIVE'`, `is_confirmed === true` y `email_id` válido.

### 1.4 Catalyst NoSQL, scope Admin obligatorio y las cinco tablas creadas
- **Cliente lazy por petición y scope Admin (`@zcatalyst/nosql@1.0.0`):** `advancedIoApp.ts:470-472` instancia los **5** proveedores (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`) pasando el resolver `() => hostedRuntime!.getActiveRequestNoSQLClient()` a `createTableProviders()` → `createCatalystLiveNoSQLAdapter()`. Dentro de `@zcatalyst/nosql@1.0.0` (`dist-es/index.js` y `dist-es/table.js`), todas las operaciones (`getTable`, `getAllTable`, `fetchItem`, `queryTable`, `queryIndex`, `insertItems`, `updateItems`, `deleteItems`) envían **`user: CREDENTIAL_USER.admin` (`'admin'`)**, cumpliendo la documentación oficial de Zoho Catalyst.
- **El scope Admin nunca sustituye los controles de VigorCore:** antes de que un endpoint ejecute operaciones en los proveedores, `CleanSlateAuthGuard` exige `x-zc-projectid` válido, rechaza `x-zc-user-type: admin` (`403 CATALYST_ADMIN_HEADER_SPOOFED`), autentica la identidad mediante `scope: 'user'` (`exchange`/`bootstrap-profile`) o `__Host-vigor_session` + `X-Vigor-CSRF`, aplica `assertNoIdentitySpoofing()`, verifica `spec.allowedRoles` y `assertPermission()`, y fija particiones `USER#<uid>` para anti-IDOR. Cada petición corre aislada en `AsyncLocalStorage` con un `new ZCAuth()` independiente por request.
- **Condiciones reales del SDK (`@zcatalyst/nosql@1.0.0`):**
  - Lecturas fuertes con `consistent_read: true` (snake_case) en `Users`, `SystemControl`, unicidad `GSI_Email`, canje de invitaciones y padre de series (`WORKOUT#`).
  - Escrituras condicionales verificando `NoSQLResponse.update[0].status === 'Success'` (`ConditionMismatch` / `CriteriaMismatch` no silenciados).
  - Presupuesto suave `350 KB` en ítems de `Users`/`UserData` (techo Catalyst `400 KB`) y lotes `<= 25` ítems (`athlete.groceries.sync`, `athlete.notifications.markAllRead`).
- **Hallazgo de auditoría (`AUD-53-03` — Resolución nombre lógico vs Table ID):**
  - El SDK instalado `@zcatalyst/nosql@1.0.0` (`dist-types/index.d.ts` y `dist-es/index.js`) documenta explícitamente que `NoSQL.table(id)` y `NoSQL.getTable(tableId)` aceptan **tanto el Table ID como el Table Name** (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`).
  - Usar los nombres lógicos preserva la portabilidad entre `Development` (`136967000000065001`..`034`) y un futuro `Production` (que tendrá Table IDs propios). Además, `createCatalystLiveNoSQLAdapter` ya soporta `tableIdResolver` como contingencia si se requiriera mapeo explícito por ID. En `Development`, tras el primer despliegue autorizado, se verificará **en modo estrictamente solo lectura** (`getAllTable()` / `getTable('<Nombre>')` sin insertar, actualizar ni eliminar filas) que los 5 nombres resuelven exactamente los 5 Table IDs aprovisionados (**`PENDING_LIVE_VERIFICATION`**).

### 1.5 `CatalystHostedAuthBridge` y su intercambio de credenciales
- Conciliado en `src/frontend/adapters/CatalystHostedAuthBridge.ts`:
  - Navegación top-level estricta (`Hosted Login`, bloquea iFrame con `403 HOSTED_LOGIN_IFRAME_FORBIDDEN`).
  - Rutas separadas: `/auth/login` (iniciador / post-logout) y `/auth/callback` (retorno `redirect_url`).
  - Llama `isUserAuthenticated()`, exige `is_confirmed !== false` y `status === 'ACTIVE'`, obtiene `generateAuthToken('functions')` **solo en RAM**, envía cabecera `Authorization` a `POST /api/v1/auth/session/bootstrap-profile` o `POST /api/v1/auth/session/exchange`, y limpia la referencia en `finally`. No persiste tokens Catalyst en `localStorage`, `sessionStorage` ni IndexedDB.

### 1.6 Sesiones, cookies, CSRF, RBAC, anti-IDOR y rutas administrativas / bootstrap
- **Sesión firmada HMAC-SHA256 (`ServerSessionTokenManager`):**
  - Emite cookie **`__Host-vigor_session`** con validación estricta en `assertStrictCookieAttributes()`: `HttpOnly; Secure; SameSite=Strict; Path=/` y **sin atributo `Domain=`**.
  - Registro individual en `SystemControl` (`pk = SESSION#<sid>`, `consistent_read: true`, ventana de reposo 12h, techo absoluto 24h, gracia de rotación concurrente `<= 5s`, detección de replay con `sessionEpoch++` y revalidación Catalyst cada `<= 15 min` con coalescing).
- **CSRF y Anti-IDOR (`HttpSecurityPolicy` + `assertNoIdentitySpoofing`):**
  - Rechaza cabeceras/parámetros/campos falsificados (`uid`, `pk`, `role`, `sessionEpoch`, `roleVersion`, `targetUid` en rutas de atleta).
  - Verifica Fetch Metadata (`Sec-Fetch-Site !== 'cross-site'`), `Origin` / `Referer` explícito contra `VIGOR_ALLOWED_ORIGINS` (sin `*`), `X-Vigor-Requested-With` en intercambio pre-sesión y `X-Vigor-CSRF` firmado ligado a `(sub, sid, ep)` en mutaciones post-sesión.
- **Protección administrativa y bootstrap offline:**
  - **Bootstrap superadmin 100% offline:** `executeOfflineAdminBootstrap()` no tiene **ninguna ruta HTTP** (`/api/v1/bootstrap-superadmin` responde `404` en `GET` y `403` pre-enrutado en `POST` sin CSRF).
  - **Bloqueos fail-closed activos por defecto en `vigor_api`:**
    - `liveAtomicityVerifiedForSuperadminMutations: false` en `advancedIoApp.ts:512-513` → las mutaciones sobre `superadmin` (`setRole`, suspender a un `superadmin`) responden **`403 SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED`**.
    - `requireLiveInt08ForPasswordReset: true` (mientras `VIGOR_ALLOW_RESET_WITHOUT_INT08` no sea `'true'`, prohibido en Catalyst alojado) → `POST /api/v1/admin/users/:uid/password-reset` falla cerrado con **`INT_08_LIVE_VERIFICATION_PENDING`**.

### 1.7 `OPTIONS`, CORS (`AUD-53-02`) y `/health`
- **`GET /health` y `GET /api/v1/health`:** responden `200 { success: true, service, routeCount: 41, status: 'ok' }` antes de `wrapDispatch`, sin secretos ni dependencia de cabeceras `x-zc-admin-cred-*`.
- **`OPTIONS` preflight:** omite `deps.wrapDispatch` (`advancedIoApp.ts:313`) y delega en `HttpSecurityPolicy.buildCorsHeaders()`, devolviendo `204` **solo** a orígenes en `VIGOR_ALLOWED_ORIGINS` (`https://app.vigorcore.lat`) y `403 CORS_ORIGIN_REJECTED` al resto.
- **Hallazgo `AUD-53-02` (`HttpSecurityPolicy.ts:149-160`):**
  - En modo `express_enforced`, `Access-Control-Allow-Headers` emite `Content-Type, X-Vigor-CSRF, X-Vigor-Requested-With` (omitiendo `Authorization`).
  - En el modo recomendado **`VIGOR_CORS_MODE=platform_managed`**, Express **no emite cabeceras `Access-Control-*`** duplicadas (solo `Vary: Origin`) y confía en **CloudScale → Whitelisting → Authorized Domains (`https://app.vigorcore.lat`)**. El passthrough efectivo de `Authorization`, `X-Vigor-CSRF`, `X-Vigor-Requested-With`, `Origin`, `Referer`, `Sec-Fetch-Site`, `Cookie` y `Set-Cookie` en el edge real de Catalyst queda **`PENDING_LIVE_VERIFICATION`**.

---

## 2. VERIFICACIÓN DEL APROVISIONAMIENTO EXISTENTE (ETAPAS 1 Y 2)

### 2.1 Identificación de proyecto y entorno verificado
- **Proyecto Catalyst:** `Project-Rainfall`
- **CATALYST_PROJECT_ID:** `136967000000014024`
- **Data Center:** `US` (`accounts.zoho.com` · `https://api.catalyst.zoho.com`)
- **Entorno objetivo inicial:** `Development` (`Production` intacto y sin promover)

### 2.2 Inventario NoSQL verificado visualmente en `Development` (Etapa 1 — `PHASE_5_2_STAGE_1_NOSQL_PROVISIONING_COMPLETED`)

| Orden | Tabla | Table ID (`Project-Rainfall`) | Partition Key | Sort Key (+ Adicionales) | TTL (`ttlEpochSec: Number`) | Estado visual en Consola |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **`Users`** | `136967000000065001` | `pk` (`String`) | *Sin Sort Key* | Deshabilitado | `0` filas / `0` bytes |
| 2 | **`UserData`** | `136967000000067007` | `pk` (`String`) | `sk` (`String`); adicionales: `entityType` (`String`), `updatedAt` (`String`) | Deshabilitado | `0` filas / `0` bytes |
| 3 | **`AdminInvitations`** | `136967000000067014` | `pk` (`String`) | *Sin Sort Key* | **Habilitado** (`ttlEpochSec: Number`) | `0` filas / `0` bytes |
| 4 | **`AuditLogs`** | `136967000000067021` | `pk` (`String`) | `sk` (`String`); adicionales: `action` (`String`), `timestamp` (`String`) | Deshabilitado | `0` filas / `0` bytes |
| 5 | **`SystemControl`** | `136967000000067034` | `pk` (`String`) | *Sin Sort Key* | **Habilitado condicional** (`ttlEpochSec: Number` solo en `CTRL#SAGA#*` y `SESSION#*`; prohibido en `CTRL#BOOTSTRAP` y `CTRL#SUPERADMIN_COUNT`) | `0` filas / `0` bytes |

**Los 8 Índices Secundarios Globales (`Active`, `0` items, `0` bytes):**

| Tabla | Índice GSI | Index ID | Partition Key | Sort Key | Proyección | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| `Users` | **`GSI_Email`** | `136967000000065003` | `normalizedEmail` (`String`) | *Ninguno* | `ALL` | `Active` |
| `Users` | **`GSI_Directory`** | `136967000000067001` | `directorySegment` (`String`) | `createdAt` (`String`) | `SPECIFIC_ATTRIBUTES` (11 columnas: `pk`, `uid`, `email`, `displayName`, `role`, `roleVersion`, `accountStatus`, `emailVerified`, `directorySegment`, `createdAt`, `lastSignInAt`) | `Active` |
| `Users` | **`GSI_RoleStatus`** | `136967000000067004` | `role` (`String`) | `accountStatus` (`String`) | `ALL` | `Active` |
| `UserData` | **`GSI_UserEntityDate`** | `136967000000067011` | `pk` (`String`) | `entityDateKey` (`String`) | `ALL` | `Active` |
| `AdminInvitations` | **`GSI_InviteEmailStatus`** | `136967000000067016` | `emailNormalized` (`String`) | `status` (`String`) | `ALL` | `Active` |
| `AuditLogs` | **`GSI_AuditActor`** | `136967000000067025` | `actorUid` (`String`) | `timestamp` (`String`) | `ALL` | `Active` |
| `AuditLogs` | **`GSI_AuditTarget`** | `136967000000067028` | `targetUid` (`String`) | `timestamp` (`String`) | `ALL` | `Active` |
| `AuditLogs` | **`GSI_GlobalChronology`** | `136967000000067031` | `auditPeriodBucket` (`String`) | `globalChronologyKey` (`String`) | `ALL` | `Active` |

### 2.3 Inventario Native Catalyst Authentication en `Development` (Etapa 2 — `PHASE_5_2_STAGE_2_NATIVE_AUTH_CONFIGURED_PENDING_LIVE_VERIFICATION`)
- **Native Catalyst Authentication:** configurada en `Development` mediante **Hosted Login**.
- **Public Signup:** `Disabled` | **Social Login:** todos desactivados | **Third-party Authentication:** sin configurar (`Set Up`) | **Custom User Validation:** `Disabled`.
- **Authorized Domain:** `app.vigorcore.lat` | **CORS:** `Enabled` | **iFrame:** `Disabled` | **`api.vigorcore.lat`:** no agregado.
- **Evidencia visual directa de usuarios:** pantalla `Manage Application Users` mostró literalmente **`Add your first user`** → **`0` usuarios en `Development`** (sin cuentas de prueba y sin pulsar `Add User`).

### 2.4 Evidencia visual completada vs verificación CLI automatizada aún no ejecutada

| Tipo de verificación | Estado actual | Cómo completarla / alcance |
| :--- | :--- | :--- |
| **Inspección visual en Catalyst Console (`Development`)** | **COMPLETADA** (Etapas 1 y 2) | Operador confirmó 5 Table IDs, 8 Index IDs `Active`, configuración Hosted Login y `0` usuarios (`Add your first user`). |
| **Conciliación documental y código local** | **COMPLETADA** (`0` llamadas remotas) | Validada por `phase52Stage1Inventory.ts`, `phase52Stage2Inventory.ts`, `phase53VigorApiManifest.ts` y pruebas `tests/21..24`. |
| **Verificación CLI remota automatizada (`--live --confirm-readonly`)** | **NO EJECUTADA TODAVÍA** | Se ejecuta desde Windows del operador usando credenciales administrativas OAuth temporales en modo **solo lectura** (`--auth-mode external_oauth`): `npx tsx scripts/verify-clean-slate-provisioning.ts --live --confirm-readonly --auth-mode external_oauth`. *(Solo valida lectura de tablas/usuarios; no altera `hosted_native` en la app ni crea recursos).* |

---

## 3. PREPARACIÓN TÉCNICA DE `vigor_api`

### 3.1 Compatibilidad de runtime y SDK `@zcatalyst/*` (`SDK-01`..`SDK-05`)
- **Runtime objetivo:** `Node.js >= 22` (`node22` en Catalyst Advanced I/O).
- **Paquetes instalados y verificados en código:**
  - `@zcatalyst/auth@1.0.0` (`^1.0.0`) — `UserManagement`, `USER_STATUS` (`ENABLE`/`DISABLE`).
  - `@zcatalyst/auth-admin@1.1.0` (`^1.1.0`) — `ZCAuth`, `CatalystApp` (y `RefreshTokenCredential`/`AccessTokenCredential` solo para `external_oauth` fuera de Catalyst alojado).
  - `@zcatalyst/nosql@1.0.0` (`^1.0.0`) — `NoSQL`, `NoSQLTable`, `NoSQLMarshall`, `NoSQLItem`, `NoSQLEnum`.
  - `@zcatalyst/transport@1.1.0` (`^1.1.0`) — capa HTTPS (guarda `ZC_SECURE !== 'override'`).
  - `@zcatalyst/utils@1.1.0` (`^1.1.0`) — constantes de cabeceras y regiones US/EU/IN/AU/CA/SA/JP/UAE.
  - `express@4.22.3` (`^4.22.3`).
- **Mitigaciones SDK activas:** `SDK-01` (`ApplicationCustomCredential` omitida), `SDK-02` (sin mutación de opciones planas), `SDK-03` (sin `getDefaultCredentials()`), `SDK-04` (`resetPassword` bloqueado por `INT-08`), `SDK-05` (`scope: 'user'` con fijación de proyecto/dominio y bloqueo de `x-zc-user-type: admin`).

### 3.2 Inventario de dependencias, exclusión de `devDependencies` y empaquetado
- **Incluir en el bundle de `vigor_api` (solo las 6 dependencias de producción):**
  `@zcatalyst/auth`, `@zcatalyst/auth-admin`, `@zcatalyst/nosql`, `@zcatalyst/transport`, `@zcatalyst/utils`, `express`.
- **Excluir del bundle de `vigor_api` (`devDependencies` de build/tests/Playwright):**
  `@types/express`, `@types/node`, `playwright-core`, `tsx`, `typescript`, además de `src/frontend/`, `docs/`, `tests/`, `scripts/` y `config/candidates/`.
- **Contenido exacto del artefacto desplegable de staging:**
  1. `dist/` completo generado por `npm --prefix poc/catalyst-clean-slate run build:server`.
  2. `package.json` de runtime exclusivo para la función: `"name": "vigor_api"`, `"private": true`, `"type": "module"`, `"main": "dist/server/catalystEntry.js"`, `"engines": { "node": ">=22" }`, y únicamente el bloque `"dependencies"` de los 6 paquetes runtime.
  3. `catalyst-config.json` dentro de la carpeta de la función (`name: "vigor_api"`, `type: "advancedio"`, `stack: "node22"`, `main: "dist/server/catalystEntry.js"`).
  4. `node_modules/` generado dentro de esa carpeta limpia con `npm install --omit=dev --ignore-scripts` *(o generando primero un `package-lock.json` exclusivo de producción dentro de staging antes de `npm ci --omit=dev --ignore-scripts`, ya que el `package-lock.json` de raíz corresponde al paquete `vigorcore-catalyst-clean-slate` con `devDependencies`)*.
- **Punto de entrada:** `dist/server/catalystEntry.js` (`export default catalystAdvancedIoEntry` y export nominal `catalystAdvancedIoEntry`). Verificado localmente en Node `v22.23.2` con resolución real ESM; carga remota en Catalyst Advanced I/O marcada **`PENDING_LIVE_VERIFICATION`**.

### 3.3 Matriz completa de variables de entorno de `vigor_api` (Sin secretos literales)

| Variable | Clasificación | `vigor_api` (`hosted_native`) | Valor / Regla operativa en `Development` (`Project-Rainfall`) |
| :--- | :--- | :---: | :--- |
| **`VIGOR_CATALYST_AUTH_MODE`** | Política Auth | **REQUIRED** | **`hosted_native`** *(no cambiar a `external_oauth` sin prueba en vivo + autorización)* |
| **`VIGOR_CORS_MODE`** | Política CORS | **REQUIRED** | **`platform_managed`** detrás de Authorized Domains *(alternativa local: `express_enforced`)* |
| **`VIGORCORE_CATALYST_PROJECT_ID`** | Identificador público | **REQUIRED** | **`136967000000014024`** *(reemplaza a la clave reservada `CATALYST_PROJECT_ID`)* |
| **`VIGORCORE_DEPLOYMENT_ENVIRONMENT`** | Identificador público | **REQUIRED** | **`Development`** *(estrictamente nunca `Production` aquí; evita keyword reservado `CATALYST_ENVIRONMENT`)* |
| **`VIGOR_ENVIRONMENT`** | Política Entorno | **REQUIRED** | **`development`** |
| **`VIGORCORE_CATALYST_API_DOMAIN`** | Identificador regional | **REQUIRED** | **`https://api.catalyst.zoho.com`** *(DC US; reemplaza a la clave reservada `CATALYST_API_DOMAIN`)* |
| **`VIGORCORE_CATALYST_ACCOUNTS_URL`** | Identificador regional | **REQUIRED** | **`https://accounts.zoho.com`** *(DC US; reemplaza a la clave reservada `CATALYST_ACCOUNTS_URL`)* |
| **`VIGOR_SESSION_HMAC_SECRET`** | **Secreto Runtime** | **REQUIRED** | `[CONFIGURAR_EN_CATALYST]` *(clave CSPRNG >= 256 bits en Base64URL)* |
| **`VIGOR_SESSION_ACTIVE_KID`** | Política Sesión | **REQUIRED** | **`k1`** |
| **`VIGOR_ALLOWED_ORIGINS`** | Política CORS | **REQUIRED** | **`https://app.vigorcore.lat`** *(cero `*`)* |
| **`NODE_ENV`** | Runtime Node | **REQUIRED** | **`production`** *(modo optimizado de Express dentro del contenedor Catalyst)* |
| `CATALYST_FUNCTION_NAME` | Identificador público | OPTIONAL | `vigor_api` |
| `CATALYST_PROJECT_DOMAIN` | Identificador público | OPTIONAL | `[CONFIGURAR_EN_CATALYST]` |
| `CATALYST_RESET_REDIRECT_URL` | Identificador público | OPTIONAL | `https://app.vigorcore.lat/auth/login` |
| `X_ZOHO_CATALYST_ORG_ID` | Identificador público | OPTIONAL | `[CONFIGURAR_EN_CATALYST]` *(solo si aplica multi-org)* |
| `CATALYST_PROJECT_KEY` | **Secreto App** | OPTIONAL | `[CONFIGURAR_EN_CATALYST]` *(si no, se valida el header `x-zc-project-key` inyectado)* |
| `CATALYST_PROJECT_SECRET_KEY` | **Secreto App** | OPTIONAL | `[CONFIGURAR_EN_CATALYST]` |
| `VIGOR_SESSION_PREVIOUS_SECRETS_JSON` | **Secreto Runtime** | OPTIONAL | `[]` *(solo durante rotación de claves HMAC)* |
| `X_ZOHO_CATALYST_LISTEN_PORT` | Plataforma Catalyst | PLATFORM_INJECTED | Inyectado por Catalyst Advanced I/O si se usa servidor propio |
| `PORT` | Runtime local | OPTIONAL | `3002` *(uso local únicamente)* |
| `ZAID` | Cliente Slate | OPTIONAL (NO servidor) | `[PUBLIC_WEB_SDK_ZAID]` *(solo frontend Slate; servidor no lo lee como credencial)* |
| `CATALYST_ADMIN_CLIENT_ID` | **OAuth Fallback** | OPTIONAL (sin uso en `hosted_native`) | No configurar en `vigor_api` salvo autorización explícita de fallback |
| `CATALYST_ADMIN_CLIENT_SECRET` | **Secreto OAuth** | OPTIONAL (sin uso en `hosted_native`) | No configurar en `vigor_api` salvo autorización explícita de fallback |
| `CATALYST_ADMIN_REFRESH_TOKEN` | **Secreto OAuth** | OPTIONAL (sin uso en `hosted_native`) | No configurar en `vigor_api` salvo autorización explícita de fallback |
| `CATALYST_ADMIN_ACCESS_TOKEN` | **Secreto OAuth** | **FORBIDDEN** | Prohibido en runtimes de servidor |
| `VIGOR_ALLOW_RESET_WITHOUT_INT08` | Flag Seguridad | **FORBIDDEN** | No definir (mantener bloqueo fail-closed de `INT-08`) |
| `ZC_SECURE` | Flag Transporte TLS | **FORBIDDEN** | Nunca definir `'override'` |
| `ZC_PROJECT_ID`, `ZC_PROJECT_KEY`, `ZC_CLIENT_ID`, `ZC_CLIENT_SECRET`, `ZC_REFRESH_TOKEN`, `ZC_ENVIRONMENT` | **Legacy** | **FORBIDDEN** | Variables obsoletas; usar exclusivamente prefijo `CATALYST_*` |

### 3.4 Configuración Advanced I/O, inicialización `ZCAuth`, NoSQL, credenciales, errores/logs y salud
- **Catalyst Advanced I/O:** tipo `advancedio`, stack `node22`, memoria recomendada por defecto sin estado en disco (`AsyncLocalStorage` por petición).
- **Acceso a NoSQL:** siempre mediante `hostedRuntime.getActiveRequestNoSQLClient()` dentro de `runWithRequestContext`, respaldado por `x-zc-admin-cred-token`. Nunca desde cabeceras de usuario final.
- **Inicialización de `ZCAuth`:** `new ZCAuth().init({ headers: sanitizedHeaders }, { type: 'advancedio', scope: 'admin' })` para operaciones BaaS administrativas y `scope: 'user'` en rutas de intercambio (`bootstrap-profile`, `exchange`, `/auth/me`) sobre cabeceras validadas.
- **Manejo de credenciales administrativas:**
  - En `Development` bajo `hosted_native`, las credenciales administrativas de request las inyecta el plano de plataforma Catalyst (`x-zc-admin-cred-type`, `x-zc-admin-cred-token`).
  - Las credenciales OAuth `CATALYST_ADMIN_*` **no se cargan en `vigor_api`**; se reservan fuera de Catalyst para CLI `--live --confirm-readonly` y bootstrap superadmin offline.
- **Política de errores y logging sin fugas de secretos:**
  - Toda respuesta HTTP de error y todo `RedactedRequestLogEntry` pasa por `redactSecretsFromString()` (`Zoho-oauthtoken`, `Bearer`, `__Host-vigor_session=`, `client_secret`, `refresh_token`, `access_token`, HMAC y claves).
  - Ningún `console.log` ni respuesta imprime cuerpos con tokens, cookies ni headers `x-zc-admin-cred-token` / `x-zc-user-cred-token`.
- **Health checks:** `GET /health` y `GET /api/v1/health` retornan `200 { success: true, service: "vigor_api", routeCount: 41, status: "ok" }` sin exponer variables ni secretos.
- **Estrategia de pruebas sobre los 41 endpoints (post-despliegue futuro autorizado):**
  1. Liveness: `GET /health` y `GET /api/v1/health` → `200`.
  2. Preflight CORS: `OPTIONS /api/v1/auth/session/exchange` con `Origin: https://app.vigorcore.lat` (`204`) vs origen no autorizado (`403`).
  3. Rechazo fail-closed no autenticado: muestreo representativo en rutas atleta, invitaciones y admin esperando `401`/`403`.
  4. Con cuenta controlada autorizada en etapa posterior: flujo `bootstrap-profile` / `exchange` → emisión `__Host-vigor_session` + `X-Vigor-CSRF` → batería completa de los **29** endpoints de atleta, **1** de canje, **6** de sesión/auth y **9** administrativos (con cuenta admin autorizada), verificando **41/41** rutas (`41` totales).

---

## 4. SEGURIDAD Y AUTENTICACIÓN (INVARIANTES NO NEGOCIABLES)

1. **`VIGOR_CATALYST_AUTH_MODE=hosted_native`:** obligatorio en `vigor_api`.
2. **`generateAuthToken('functions')` exclusivamente en RAM:** emitido por `@zcatalyst/auth` web SDK, enviado solo en el intercambio pre-sesión y limpiado en `finally`.
3. **Cookie `__Host-vigor_session`:** `HttpOnly; Secure; SameSite=Strict; Path=/` y **sin `Domain=`** (validado antes de cada `res.setHeader('Set-Cookie', ...)`).
4. **CSRF doble barrera:** `Origin`/`Referer` + `Sec-Fetch-Site` + `X-Vigor-Requested-With` en pre-sesión y token HMAC `X-Vigor-CSRF` vinculado a `(sub, sid, ep)` en mutaciones post-sesión.
5. **RBAC y estado autoritativos desde `Users` + `SystemControl` (`consistent_read: true`):** nunca desde campos del cliente ni desde claims no verificados.
6. **Controles fail-closed activos:** bloqueo de spoofing, bloqueo de mutaciones a `superadmin` (`liveAtomicityVerifiedForSuperadminMutations: false`), bloqueo de `resetPassword` (`INT-08`), bootstrap superadmin 100% offline.
7. **Public Signup `Disabled` y Social Login desactivados** en Catalyst Authentication (`Development`).
8. **Third-party Authentication sin configurar** (`Set Up`).
9. **Prohibición estricta sobre `external_oauth`:** NO habilitar fallback `external_oauth` en `vigor_api` salvo que (a) las pruebas en vivo detrás de API Gateway demuestren objetivamente ausencia de `x-zc-admin-cred-token` en rutas `NO_AUTHENTICATION` y (b) el operador otorgue **autorización independiente específica**.

---

## 5. API GATEWAY (DESHABILITADO INICIALMENTE) E INVENTARIO COMPLETO DE 41 RUTAS

> **Estado obligatorio durante la preparación y despliegue inicial de `vigor_api` en Fase 5.3:**  
> **API Gateway debe permanecer DESHABILITADO (`Enable now`)** hasta completar la creación/verificación base de `vigor_api` y obtener autorización para habilitar el Gateway.

### 5.1 Inventario completo de rutas (41 canónicas + `OPTIONS` + `/health`)

| # | `routeId` | Método | Path Canónico | Gateway Path | Target Rewrite (`/server/vigor_api...`) | Auth Gateway Recomendada | Enforcement Backend + CSRF |
| :---: | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | `auth.session.bootstrapProfile` | `POST` | `/api/v1/auth/session/bootstrap-profile` | `/api/v1/auth/session/bootstrap-profile` | `/server/vigor_api/api/v1/auth/session/bootstrap-profile` | `CATALYST_USERS_AUTHENTICATION` | Catalyst `user` scope + GSI_Email + pre-session CSRF |
| 2 | `auth.session.exchange` | `POST` | `/api/v1/auth/session/exchange` | `/api/v1/auth/session/exchange` | `/server/vigor_api/api/v1/auth/session/exchange` | `CATALYST_USERS_AUTHENTICATION` | Catalyst `user` scope + `Users` `consistent_read` + pre-session CSRF |
| 3 | `auth.session.refresh` | `POST` | `/api/v1/auth/session/refresh` | `/api/v1/auth/session/refresh` | `/server/vigor_api/api/v1/auth/session/refresh` | `NO_AUTHENTICATION` | HMAC `__Host-vigor_session` + bound `X-Vigor-CSRF` + Catalyst live check |
| 4 | `auth.session.logout` | `POST` | `/api/v1/auth/session/logout` | `/api/v1/auth/session/logout` | `/server/vigor_api/api/v1/auth/session/logout` | `NO_AUTHENTICATION` | HMAC `__Host-vigor_session` + bound `X-Vigor-CSRF` + `SESSION#<sid>` revoke |
| 5 | `auth.session.revoke` | `POST` | `/api/v1/auth/session/revoke` | `/api/v1/auth/session/revoke` | `/server/vigor_api/api/v1/auth/session/revoke` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + Catalyst live + anti-superadmin-by-admin |
| 6 | `auth.me` | `GET` | `/api/v1/auth/me` | `/api/v1/auth/me` | `/server/vigor_api/api/v1/auth/me` | `NO_AUTHENTICATION` | HMAC o Catalyst inspect (`Users` `consistent_read`, deny-by-default) |
| 7 | `athlete.workspace.get` | `GET` | `/api/v1/athlete/workspace` | `/api/v1/athlete/workspace` | `/server/vigor_api/api/v1/athlete/workspace` | `NO_AUTHENTICATION` | HMAC `__Host-vigor_session` + anti-IDOR `USER#<uid>` (safe GET) |
| 8 | `athlete.profile.patch` | `PATCH` | `/api/v1/athlete/profile` | `/api/v1/athlete/profile` | `/server/vigor_api/api/v1/athlete/profile` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + anti-IDOR `USER#<uid>` |
| 9 | `athlete.onboarding.complete` | `POST` | `/api/v1/athlete/onboarding/complete` | `/api/v1/athlete/onboarding/complete` | `/server/vigor_api/api/v1/athlete/onboarding/complete` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + anti-IDOR `USER#<uid>` |
| 10 | `athlete.meals.create` | `POST` | `/api/v1/athlete/meals` | `/api/v1/athlete/meals` | `/server/vigor_api/api/v1/athlete/meals` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + anti-IDOR `USER#<uid>` |
| 11 | `athlete.meals.list` | `GET` | `/api/v1/athlete/meals` | `/api/v1/athlete/meals` | `/server/vigor_api/api/v1/athlete/meals` | `NO_AUTHENTICATION` | HMAC `__Host-vigor_session` + anti-IDOR `USER#<uid>` (safe GET) |
| 12 | `athlete.groceries.sync` | `PUT` | `/api/v1/athlete/groceries/sync` | `/api/v1/athlete/groceries/sync` | `/server/vigor_api/api/v1/athlete/groceries/sync` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + lotes `<= 25` |
| 13 | `athlete.workouts.start` | `POST` | `/api/v1/athlete/workouts/start` | `/api/v1/athlete/workouts/start` | `/server/vigor_api/api/v1/athlete/workouts/start` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + `consistent_read` |
| 14 | `athlete.workouts.logSet` | `POST` | `/api/v1/athlete/workouts/:workoutId/sets` | `/api/v1/athlete/workouts/{workoutId}/sets` | `/server/vigor_api/api/v1/athlete/workouts/:workoutId/sets` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + padre `in_progress` |
| 15 | `athlete.workouts.complete` | `POST` | `/api/v1/athlete/workouts/:workoutId/complete` | `/api/v1/athlete/workouts/{workoutId}/complete` | `/server/vigor_api/api/v1/athlete/workouts/:workoutId/complete` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + bloqueo terminal condicional |
| 16 | `athlete.cardio.create` | `POST` | `/api/v1/athlete/cardio` | `/api/v1/athlete/cardio` | `/server/vigor_api/api/v1/athlete/cardio` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + anti-IDOR `USER#<uid>` |
| 17 | `athlete.notifications.create` | `POST` | `/api/v1/athlete/notifications` | `/api/v1/athlete/notifications` | `/server/vigor_api/api/v1/athlete/notifications` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + anti-IDOR `USER#<uid>` |
| 18 | `athlete.recipes.put` | `PUT` | `/api/v1/athlete/recipes/:recipeId` | `/api/v1/athlete/recipes/{recipeId}` | `/server/vigor_api/api/v1/athlete/recipes/:recipeId` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + techo 350 KB |
| 19 | `athlete.mealPlans.put` | `PUT` | `/api/v1/athlete/meal-plans/:weekStart` | `/api/v1/athlete/meal-plans/{weekStart}` | `/server/vigor_api/api/v1/athlete/meal-plans/:weekStart` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + techo 350 KB |
| 20 | `athlete.routines.put` | `PUT` | `/api/v1/athlete/routines/:routineId` | `/api/v1/athlete/routines/{routineId}` | `/server/vigor_api/api/v1/athlete/routines/:routineId` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + techo 350 KB |
| 21 | `invitations.redeem` | `POST` | `/api/v1/invitations/redeem` | `/api/v1/invitations/redeem` | `/server/vigor_api/api/v1/invitations/redeem` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + Catalyst live + SHA-256 `timingSafeEqual` |
| 22 | `admin.users.list` | `GET` | `/api/v1/admin/users` | `/api/v1/admin/users` | `/server/vigor_api/api/v1/admin/users` | `NO_AUTHENTICATION` | HMAC + RBAC `admin\|superadmin` (safe GET) |
| 23 | `admin.stats.get` | `GET` | `/api/v1/admin/stats` | `/api/v1/admin/stats` | `/server/vigor_api/api/v1/admin/stats` | `NO_AUTHENTICATION` | HMAC + RBAC `admin\|superadmin` (safe GET) |
| 24 | `admin.users.detail` | `GET` | `/api/v1/admin/users/:uid` | `/api/v1/admin/users/{uid}` | `/server/vigor_api/api/v1/admin/users/:uid` | `NO_AUTHENTICATION` | HMAC + RBAC `admin\|superadmin` (safe GET) |
| 25 | `admin.invitations.create` | `POST` | `/api/v1/admin/invitations` | `/api/v1/admin/invitations` | `/server/vigor_api/api/v1/admin/invitations` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + RBAC `admin\|superadmin` |
| 26 | `admin.invitations.revoke` | `POST` | `/api/v1/admin/invitations/:inviteId/revoke` | `/api/v1/admin/invitations/{inviteId}/revoke` | `/server/vigor_api/api/v1/admin/invitations/:inviteId/revoke` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + RBAC `admin\|superadmin` |
| 27 | `admin.users.setStatus` | `POST` | `/api/v1/admin/users/:uid/status` | `/api/v1/admin/users/{uid}/status` | `/server/vigor_api/api/v1/admin/users/:uid/status` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + Catalyst live + lock superadmin |
| 28 | `admin.users.setRole` | `POST` | `/api/v1/admin/users/:uid/role` | `/api/v1/admin/users/{uid}/role` | `/server/vigor_api/api/v1/admin/users/:uid/role` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + Catalyst live + solo `superadmin` |
| 29 | `admin.users.passwordReset` | `POST` | `/api/v1/admin/users/:uid/password-reset` | `/api/v1/admin/users/{uid}/password-reset` | `/server/vigor_api/api/v1/admin/users/:uid/password-reset` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + Catalyst live + bloqueo `INT-08` |
| 30 | `admin.auditLogs.list` | `GET` | `/api/v1/admin/audit-logs` | `/api/v1/admin/audit-logs` | `/server/vigor_api/api/v1/admin/audit-logs` | `NO_AUTHENTICATION` | HMAC + RBAC `admin\|superadmin` (safe GET) |
| 31 | `athlete.biometrics.put` | `PUT` | `/api/v1/athlete/biometrics` | `/api/v1/athlete/biometrics` | `/server/vigor_api/api/v1/athlete/biometrics` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + anti-IDOR `USER#<uid>` |
| 32 | `athlete.preferences.put` | `PUT` | `/api/v1/athlete/preferences` | `/api/v1/athlete/preferences` | `/server/vigor_api/api/v1/athlete/preferences` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + anti-IDOR `USER#<uid>` |
| 33 | `athlete.meals.delete` | `DELETE` | `/api/v1/athlete/meals/:mealId` | `/api/v1/athlete/meals/{mealId}` | `/server/vigor_api/api/v1/athlete/meals/:mealId` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + anti-IDOR `USER#<uid>` |
| 34 | `athlete.recipes.delete` | `DELETE` | `/api/v1/athlete/recipes/:recipeId` | `/api/v1/athlete/recipes/{recipeId}` | `/server/vigor_api/api/v1/athlete/recipes/:recipeId` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + anti-IDOR `USER#<uid>` |
| 35 | `athlete.groceries.create` | `POST` | `/api/v1/athlete/groceries` | `/api/v1/athlete/groceries` | `/server/vigor_api/api/v1/athlete/groceries` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + anti-IDOR `USER#<uid>` |
| 36 | `athlete.groceries.patchStatus` | `PATCH` | `/api/v1/athlete/groceries/:groceryId` | `/api/v1/athlete/groceries/{groceryId}` | `/server/vigor_api/api/v1/athlete/groceries/:groceryId` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + versión optimista |
| 37 | `athlete.groceries.delete` | `DELETE` | `/api/v1/athlete/groceries/:groceryId` | `/api/v1/athlete/groceries/{groceryId}` | `/server/vigor_api/api/v1/athlete/groceries/:groceryId` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + anti-IDOR `USER#<uid>` |
| 38 | `athlete.routines.setDefault` | `POST` | `/api/v1/athlete/routines/:routineId/default` | `/api/v1/athlete/routines/{routineId}/default` | `/server/vigor_api/api/v1/athlete/routines/:routineId/default` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + anti-IDOR `USER#<uid>` |
| 39 | `athlete.cardio.delete` | `DELETE` | `/api/v1/athlete/cardio/:cardioId` | `/api/v1/athlete/cardio/{cardioId}` | `/server/vigor_api/api/v1/athlete/cardio/:cardioId` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + anti-IDOR `USER#<uid>` |
| 40 | `athlete.notifications.markRead` | `PATCH` | `/api/v1/athlete/notifications/:notificationId/read` | `/api/v1/athlete/notifications/{notificationId}/read` | `/server/vigor_api/api/v1/athlete/notifications/:notificationId/read` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + versión optimista |
| 41 | `athlete.notifications.markAllRead` | `POST` | `/api/v1/athlete/notifications/read-all` | `/api/v1/athlete/notifications/read-all` | `/server/vigor_api/api/v1/athlete/notifications/read-all` | `NO_AUTHENTICATION` | HMAC + bound `X-Vigor-CSRF` + lotes `<= 25` |

**Rutas auxiliares del manifiesto:**
- **`OPTIONS /api/v1/*`** → `/server/vigor_api/api/v1/*` (`NO_AUTHENTICATION`, CORS preflight evaluado sin `wrapDispatch` + CloudScale Authorized Domains).
- **`GET /health` y `GET /api/v1/health`** → `/server/vigor_api/health` y `/server/vigor_api/api/v1/health` (`NO_AUTHENTICATION`, respuesta mínima `{ success: true, service, routeCount: 41, status: 'ok' }`).

*(Nunca usar `OAuth ZohoCatalyst.Functions.Execute` sobre estas 41 rutas de navegador: ver `ROUTE_GATEWAY_AUTH_MATRIX`).*

### 5.2 Impacto global al activar API Gateway (`catalyst apig:enable`) y plan de recuperación
- **Desactivación global de Project Security Rules:** al habilitar API Gateway en `Project-Rainfall`, Zoho Catalyst **desactiva automáticamente Project Security Rules a nivel de todo el proyecto**.
- **Consecuencia para `vigor_api`:** aunque hoy no existan funciones heredadas (`Functions are not created yet!!`), en cuanto exista `vigor_api`, activar API Gateway expone tanto las rutas del Gateway como potencialmente `/server/vigor_api/*` directo sin Security Rules intermedias. Por ello:
  1. Deben crearse inmediatamente las reglas de API Gateway de `config/candidates/alternative-b-api-gateway.routes.json`.
  2. Debe auditarse la accesibilidad directa de `/server/vigor_api/*` y confirmar que todas las defensas internas de `vigor_api` (`__Host-vigor_session`, `X-Vigor-CSRF`, `Origin`/Fetch Metadata, `RBAC`, `anti-IDOR`, `x-zc-projectid`, bloqueo de `x-zc-user-type: admin`) rechazan fail-closed cualquier invocación anómala.
  3. **Comprobaciones obligatorias en vivo tras habilitar API Gateway en una fase futura autorizada:** passthrough real de `Authorization`, `Cookie` (`__Host-vigor_session`), `Set-Cookie` (`SameSite=Strict`), `X-Vigor-CSRF`, `Origin`, `Referer`, `Sec-Fetch-Site`, respuestas `OPTIONS`, e inspección real de presencia de `x-zc-admin-cred-token` en rutas `NO_AUTHENTICATION`.
- **Plan de rollback inmediato si falla el Gateway o faltan cabeceras:** ejecutar **`catalyst apig:disable`** para desactivar API Gateway y restaurar Project Security Rules globalmente mientras se corrigen rutas o permisos.

---

## 6. DOMINIO PERSONALIZADO (`api.vigorcore.lat`) Y ESTRATEGIA DE PRIMER DESPLIEGUE CON FUNCTION URL (`Development`)

- **Estado estricto de `api.vigorcore.lat`:** **`BLOCKED_PENDING_ZOHO_CLARIFICATION`**.
- **Estrategia escalonada de primer despliegue (API Gateway DESHABILITADO):**
  1. El primer despliegue autorizado de `vigor_api` en `Development` se realizará utilizando **únicamente la Function URL propia** generada por Zoho Catalyst para `vigor_api`, manteniendo **API Gateway deshabilitado (`Enable now`)** y **`Production` sin modificar**.
  2. Sobre dicha Function URL *(observada solo en Consola/CLI post-despliegue, nunca inventada de antemano)* podrán comprobarse: `GET /health` y `GET /api/v1/health`, carga ESM del entrypoint, inicialización Express (`routeCount: 41`), inicialización del SDK (`ZCAuth` / `AsyncLocalStorage`), resolución **solo lectura** de las 5 tablas (`getAllTable()` / `getTable()`), preflight `OPTIONS` CORS y rechazos fail-closed (`401`/`403`/`503`) en rutas protegidas.
  3. **Limitación esperada antes de API Gateway + mismo sitio:** una Function URL nativa es **cross-site** respecto a `https://app.vigorcore.lat`, por lo que los navegadores retendrán cookies `SameSite=Strict` (`__Host-vigor_session`) hasta integrar el API Gateway y dominio del mismo sitio en una etapa posterior.
  4. **NO** crear Domain Mapping ni registros `CNAME`/DNS para `api.vigorcore.lat` durante esta etapa *(detalle completo en `docs/33`, Sección 4)*.

---

## 7. PROCEDIMIENTO OPERATIVO (WINDOWS POWERSHELL 5.1), PRUEBAS, CONDICIONES `STOP` Y ROLLBACK

Todas las instrucciones CLI siguen sintaxis estricta de **Windows PowerShell 5.1** (sin operadores `&&` ni `||`, usando `;`, `$LASTEXITCODE` y `Set-StrictMode -Version Latest`).

### 7.1 Verificaciones locales ejecutables hoy en la estación Windows (`0` operaciones remotas)

```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# 1. Validar compilación servidor + frontend + suite local completa dentro de poc/catalyst-clean-slate
npm --prefix poc/catalyst-clean-slate run build
if ($LASTEXITCODE -ne 0) { throw "Fallo build TS" }

npm --prefix poc/catalyst-clean-slate run build:server
if ($LASTEXITCODE -ne 0) { throw "Fallo build:server (dist/)" }

npm --prefix poc/catalyst-clean-slate run frontend:build
if ($LASTEXITCODE -ne 0) { throw "Fallo frontend:build" }

npm --prefix poc/catalyst-clean-slate test
if ($LASTEXITCODE -ne 0) { throw "Fallo suite de pruebas locales" }

# 2. Auditoría offline del plan de preparación Fase 5.1.2/5.3 (zero network, zero writes)
Push-Location poc/catalyst-clean-slate
try {
  npx tsx scripts/prepare-catalyst-phase-5.1.2.ts --mode inspect
  if ($LASTEXITCODE -ne 0) { throw "Fallo prepare-catalyst inspect" }
  npx tsx scripts/prepare-catalyst-phase-5.1.2.ts --mode plan
  if ($LASTEXITCODE -ne 0) { throw "Fallo prepare-catalyst plan" }
}
finally {
  Pop-Location
}
```

### 7.2 Verificación CLI remota solo lectura opcional (Etapas 1 y 2 — estación Windows del operador)

```powershell
# [SOLO LECTURA REMOTA] Ejecutar únicamente si el operador desea respaldo CLI automatizado de NoSQL/Auth.
# Usa --auth-mode external_oauth solo para lectura administrativa desde estación local (no altera hosted_native).
Push-Location poc/catalyst-clean-slate
try {
  $env:VIGORCORE_CATALYST_PROJECT_ID = '136967000000014024'
  $env:VIGORCORE_DEPLOYMENT_ENVIRONMENT = 'Development'
  $env:VIGOR_ENVIRONMENT = 'development'
  $env:VIGORCORE_CATALYST_API_DOMAIN = 'https://api.catalyst.zoho.com'
  $env:VIGORCORE_CATALYST_ACCOUNTS_URL = 'https://accounts.zoho.com'
  # Definir CATALYST_PROJECT_KEY, CATALYST_ADMIN_CLIENT_ID, CATALYST_ADMIN_CLIENT_SECRET y CATALYST_ADMIN_REFRESH_TOKEN solo en memoria de sesión (sin guardarlos en disco).
  npx tsx scripts/verify-clean-slate-provisioning.ts --live --confirm-readonly --auth-mode external_oauth
  if ($LASTEXITCODE -ne 0) { throw "Fallo verificacion readonly remota" }
}
finally {
  Pop-Location
}
```

### 7.3 Procedimiento futuro de empaquetado limpio y creación/despliegue de `vigor_api` (**`[REQUIERE AUTORIZACIÓN INDEPENDIENTE]`**)

```powershell
# [NO EJECUTAR AHORA — SUJETO A AUTORIZACIÓN INDEPENDIENTE DE FASE 5.3]
# 1. Verificar CLI y sesión Catalyst sin modificar recursos
Get-Command catalyst -ErrorAction Stop
catalyst --version
if ($LASTEXITCODE -ne 0) { throw "Catalyst CLI no disponible" }
catalyst whoami
if ($LASTEXITCODE -ne 0) { throw "Sesión Catalyst CLI no iniciada" }
catalyst project:list
if ($LASTEXITCODE -ne 0) { throw "No se pudo listar proyectos Catalyst" }

# 2. Compilar backend limpio y preparar directorio staging de vigor_api (fuera de Git / solo runtime)
npm --prefix poc/catalyst-clean-slate run build:server
if ($LASTEXITCODE -ne 0) { throw "Error compilando dist/" }

$StagingRoot = Join-Path $env:TEMP 'vigorcore-stage53-bundle'
$FnDir = Join-Path $StagingRoot 'functions\vigor_api'
if (Test-Path $StagingRoot) { Remove-Item -Recurse -Force $StagingRoot }
New-Item -ItemType Directory -Force -Path $FnDir | Out-Null
Copy-Item -Recurse -Force 'poc\catalyst-clean-slate\dist' (Join-Path $FnDir 'dist')

# 3. Escribir package.json solo runtime (con "main": "dist/server/catalystEntry.js" y sin devDependencies)
# y catalyst-config.json (type: "advancedio", stack: "node22", main: "dist/server/catalystEntry.js"),
# instalar dependencias de producción con `npm install --omit=dev --ignore-scripts` en $FnDir,
# validar preflight (`--mode preflight --auth-mode hosted_native`), y ejecutar `catalyst deploy`
# apuntando EXCLUSIVAMENTE a Project-Rainfall (136967000000014024) en entorno Development,
# manteniendo API Gateway deshabilitado inicialmente.
```

### 7.4 Condiciones `STOP` (Abortar inmediatamente y no continuar)
- `VIGORCORE_CATALYST_PROJECT_ID !== '136967000000014024'` o `VIGORCORE_DEPLOYMENT_ENVIRONMENT !== 'Development'`.
- Presencia de `Production` en variables o destino del comando `catalyst deploy`.
- Cualquier intento de habilitar `API Gateway` o editar DNS/Domain Mapping de `api.vigorcore.lat` durante el despliegue inicial de `vigor_api`.
- Ausencia de `VIGOR_SESSION_HMAC_SECRET` válido (>= 256 bits Base64URL) o presencia de `ZC_SECURE=override` / `VIGOR_ALLOW_RESET_WITHOUT_INT08=true`.
- Fallo de arranque ESM de `dist/server/catalystEntry.js` en `node22` o respuesta `503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE` en rutas autenticadas (aplicar rollback sin habilitar `external_oauth`).

### 7.5 Checklist de verificación post-despliegue (tras futura ejecución autorizada en `Development`)
- [ ] `vigor_api` visible en Catalyst Console → Functions (`Development`) con stack `node22` y entrada `dist/server/catalystEntry.js`.
- [ ] `API Gateway` permanece deshabilitado (`Enable now`); `Production` permanece intacto.
- [ ] `GET /health` y `GET /api/v1/health` en la URL real observada devuelven HTTP `200` con `routeCount: 41` y cero secretos.
- [ ] `OPTIONS /api/v1/auth/session/exchange` con `Origin: https://app.vigorcore.lat` responde `204`; origen ajeno responde `403 CORS_ORIGIN_REJECTED`.
- [ ] Verificación de NoSQL real con `HostedNativeCatalystAuthRuntime` (`AUD-53-03`: confirmar resolución de tablas por nombre o activar `tableIdResolver` con los 5 Table IDs).
- [ ] Logs de Catalyst Functions revisados: cero tokens, cookies, claves HMAC o `x-zc-admin-cred-token` en texto claro.

### 7.6 Separación estricta de planos

| Plano | Qué incluye exactamente | Estado actual |
| :--- | :--- | :--- |
| **1. Preparación y conciliación local** | Auditoría completa del backend, conciliación técnica pre-despliegue (`docs/33`: permisos NoSQL Admin, resolución de tablas `@zcatalyst/nosql@1.0.0`, empaquetado Node 22, estrategia Function URL, bloqueo superadmin), inventario 41 rutas + Gateway, matriz de 33 variables env y manifiesto `phase53VigorApiManifest.ts`. | **COMPLETADO (`0` ops remotas)** |
| **2. Pruebas locales verificadas** | `npm run build`, `build:server`, `frontend:build` y `npm test` (`tests/01..25`, incluyendo aislamiento concurrente `AsyncLocalStorage`, acceso sin sesión/RBAC, anti-IDOR, fallos de init, carga ESM real en Node `v22.23.2` y Express loopback). **No prueban runtime Catalyst real.** | **PASS LOCAL** |
| **3. Verificación remota pendiente** | CLI opcional `--live --confirm-readonly` de Etapas 1–2; comprobación en vivo sobre Function URL (`GET /health`, arranque ESM `node22`, `x-zc-admin-cred-token`, resolución solo lectura `AUD-53-03`) y posteriormente flujo completo auth/CORS/cookies/CSRF (`LIVE-01`..`LIVE-07`). | **PENDIENTE (`PENDING_LIVE_VERIFICATION`)** |
| **4. Operaciones futuras sujetas a autorización** | Creación/despliegue de `vigor_api` con Function URL en `Development`, habilitación controlada de API Gateway + pruebas de seguridad, desbloqueo de `api.vigorcore.lat` (`BLOCKED_PENDING_ZOHO_CLARIFICATION`), bootstrap superadmin offline y promoción futura a `Production`. | **NO EJECUTADAS / REQUIEREN AUTORIZACIÓN INDEPENDIENTE** |

---

## 8. DICTAMEN FINAL DE FASE 5.3

**Dictamen base del runbook (`docs/32`):** **`PHASE_5_3_RUNBOOK_READY_NOT_EXECUTED`**  
**Dictamen de conciliación técnica pre-despliegue (`docs/33`):** **`PHASE_5_3_PREDEPLOYMENT_RECONCILIATION_READY_NOT_EXECUTED`**

- **Base cerrada:** Etapas 1 (`PHASE_5_2_STAGE_1_NOSQL_PROVISIONING_COMPLETED`) y 2 (`PHASE_5_2_STAGE_2_NATIVE_AUTH_CONFIGURED_PENDING_LIVE_VERIFICATION`) completamente conciliadas en `Development` para `Project-Rainfall` (`136967000000014024`).
- **Pendiente de autorización independiente:** empaquetado final y despliegue de `vigor_api` en `Development` vía Function URL (con API Gateway deshabilitado), verificación en vivo de `AUD-53-01`..`AUD-53-03` y `LIVE-01`..`LIVE-07`, posterior activación de API Gateway y desbloqueo de `api.vigorcore.lat`.
