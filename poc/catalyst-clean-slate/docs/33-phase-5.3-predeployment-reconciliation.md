# VIGORCORE — FASE 5.3: CONCILIACIÓN TÉCNICA PREVIA AL PRIMER DESPLIEGUE (`vigor_api` — DEVELOPMENT FIRST)

**Proyecto en Google AI Studio:** `Fit-X` *(trabajo estrictamente aislado en `poc/catalyst-clean-slate/`)*  
**Proyecto Zoho Catalyst:** `Project-Rainfall`  
**Project ID:** `136967000000014024`  
**Data Center:** `US` (`accounts.zoho.com` · `https://api.catalyst.zoho.com`)  
**Entorno objetivo:** **`Development`** *(**`Production` intacto y sin modificar**)*  
**Dictamen heredado:** **`PHASE_5_3_RUNBOOK_READY_NOT_EXECUTED`** (`docs/32-phase-5.3-vigor-api-implementation-runbook.md`)  
**Operaciones remotas ejecutadas:** **`0`** *(solo auditoría de código/SDK, verificación local de empaquetado ESM, pruebas automatizadas locales y documentación)*  
**Dictamen final de esta conciliación:** **`PHASE_5_3_PREDEPLOYMENT_RECONCILIATION_READY_NOT_EXECUTED`**

---

## REGLAS DE ALCANCE Y HONESTIDAD DE VERIFICACIÓN

1. **Cero acciones remotas:** en esta conciliación **NO** se creó ni desplegó `vigor_api`, **NO** se habilitó API Gateway (`Enable now`), **NO** se insertaron/actualizaron/eliminaron registros en NoSQL, **NO** se crearon usuarios ni se modificó Authentication (`0` usuarios en `Development`), **NO** se tocó `api.vigorcore.lat` (`BLOCKED_PENDING_ZOHO_CLARIFICATION`), **NO** se modificó el frontend Slate (`https://app.vigorcore.lat`) ni `Production`, y **NO** se escribieron cambios fuera de `poc/catalyst-clean-slate/`.
2. **Separación estricta entre pruebas locales y plataforma viva:** toda ejecución sobre `dist/server/catalystEntry.js`, `HostedNativeCatalystAuthRuntime`, Express loopback o `@zcatalyst/nosql@1.0.0` sin red remota valida contratos e invariantes de servidor localmente (**`PASS LOCAL`**), pero **no sustituye** la verificación contra la infraestructura real de Zoho Catalyst en `Project-Rainfall`, la cual se mantiene explícitamente como **`PENDING_LIVE_VERIFICATION`**.
3. **Prohibición de secretos:** cero tokens reales, cookies reales, contraseñas o claves HMAC literales en código, pruebas o documentos.

---

## 1. AUDITORÍA DE PERMISOS NoSQL (`scope: 'admin'` vs CONTROLES VIGORCORE)

Se contrastaron exactamente cinco piezas de código y SDK instalado:
- `hostedRuntime.getActiveRequestNoSQLClient()` (`src/sdk/catalystSdkBridge.ts:1074-1076`)
- `createTableProviders()` y `createCatalystLiveNoSQLAdapter()` (`src/nosql/providers/tableProviders.ts:482-499`, `src/nosql/providers/baseTableProvider.ts:34-46`)
- `AsyncLocalStorage<CatalystApp>` en `HostedNativeCatalystAuthRuntime` (`src/sdk/catalystSdkBridge.ts:992,1054-1076`)
- `new ZCAuth().init({ headers }, { type, scope })` (`src/sdk/catalystSdkBridge.ts:977-986,1160-1168`)
- Código compilado real de `@zcatalyst/nosql@1.0.0` (`node_modules/@zcatalyst/nosql/dist-es/index.js` y `table.js`)

### 1.1 Respuesta técnica a los 6 puntos de auditoría

| # | Pregunta de auditoría | Evidencia exacta en código y SDK instalado | Resultado |
| :---: | :--- | :--- | :--- |
| **1** | **¿Qué `scope` utiliza cada proveedor de tablas?** | En `src/server/advancedIoApp.ts:470-472`, en modo `hosted_native`, `createTableProviders(() => hostedRuntime!.getActiveRequestNoSQLClient())` inyecta el mismo resolver lazy a los **5** proveedores (`UsersTableProvider`, `UserDataTableProvider`, `AdminInvitationsTableProvider`, `AuditLogsTableProvider`, `SystemControlTableProvider`). `getActiveRequestNoSQLClient()` construye `new NoSQL(this.getActiveRequestAdminApp())`, cuyo `CatalystApp` fue inicializado por `buildHostedAdminAppFromHeaders()` mediante `new ZCAuth().init({ headers: sanitizedAdminHeaders }, { type: 'advancedio', scope: 'admin' })`. | **Todos los 5 proveedores operan bajo `scope: 'admin'`.** |
| **2** | **¿Todos los accesos NoSQL se ejecutan con `scope: 'admin'`?** | Inspección directa de `@zcatalyst/nosql@1.0.0` (`dist-es/index.js` líneas `47`, `59` y `dist-es/table.js` líneas `38`, `56`, `77`, `98`, `116`, `135`): `getTable`, `getAllTable`, `insertItems`, `updateItems`, `deleteItems`, `fetchItem`, `queryTable` y `queryIndex` fijan explícitamente `user: CREDENTIAL_USER.admin` (`'admin'`). No existe ninguna ruta en el backend que ejecute NoSQL con `scope: 'user'`. | **Sí, 100% de las operaciones NoSQL se ejecutan con `scope: 'admin'`, conforme a la documentación oficial de Zoho Catalyst.** |
| **3** | **¿Cómo se verifica la identidad del usuario antes de obtener acceso a los proveedores?** | Ningún handler de ruta recibe credenciales crudas ni accede a los proveedores sin atravesar `CleanSlateApiDispatcher` → `authenticateForSpec()` → `CleanSlateAuthGuard.authenticate()` (`src/routes/apiRouterSchema.ts:163-181`):<br>1) **Pre-sesión (`catalyst_exchange` en `/bootstrap-profile`, `/exchange`, `/auth/me` sin cookie):** `HostedNativeCatalystAuthRuntime.getCurrentUserFromRequest()` valida `x-zc-projectid`, bloquea `x-zc-user-type: admin` (`403 CATALYST_ADMIN_HEADER_SPOOFED`), construye cabeceras sanitizadas con `scope: 'user'` (`new ZCAuth().init(..., { type: 'advancedio', scope: 'user' })`), invoca `UserManagement.getCurrentUser()` y exige `status === 'ACTIVE'`, `is_confirmed === true` y correo válido.<br>2) **Post-sesión (`hmac_session` en 38 rutas autenticadas):** verifica firma HMAC-SHA256 de `__Host-vigor_session`, valida `iss`/`aud`/`env`/`exp`, comprueba `Users` (`consistent_read: true`) + `SystemControl` `SESSION#<sid>` (`consistent_read: true`), `sessionEpoch`, ventanas 12h/24h y revalidación Catalyst `<= 15 min`. | **Identidad verificada en servidor antes de habilitar cualquier acceso de negocio sobre los proveedores NoSQL.** |
| **4** | **¿Cómo se garantiza que un usuario no pueda ejecutar operaciones NoSQL sin autorización RBAC ni eludir anti-IDOR?** | Tres barreras secuenciales antes de cualquier escritura/lectura de dominio:<br>1) **Anti-spoofing (`assertNoIdentitySpoofing`):** rechaza `403 IDENTITY_SPOOFING_REJECTED` si la petición envía `uid`, `pk`, `role`, `sessionEpoch`, `roleVersion`, o `targetUid` en rutas de atleta.<br>2) **CSRF y Fetch Metadata (`HttpSecurityPolicy`):** toda mutación post-sesión exige `Origin` permitido, `Sec-Fetch-Site !== 'cross-site'` y token firmado `X-Vigor-CSRF` ligado a `(sub, sid, ep)`.<br>3) **RBAC + partición cerrada:** `authenticateForSpec()` valida `spec.allowedRoles.includes(actor.role)` (`403 PERMISSION_DENIED`), los servicios aplican `assertPermission(actor, ...)` (impidiendo, por ejemplo, que `admin` invite a otro `admin` o suspenda a un `superadmin`), y los endpoints de atleta construyen la clave física exclusivamente desde `KeyBuilders.userPk(actor.catalystUserId)` (`USER#<uid>`). Además, el cliente nunca elige nombres de tabla ni claves de partición, y `x-zc-admin-cred-token` nunca sustituye a `__Host-vigor_session`. | **El `scope: 'admin'` de Catalyst es solo el canal de transporte BaaS interno y NUNCA reemplaza sesión, CSRF, RBAC ni anti-IDOR.** |
| **5** | **¿Cómo se evita contaminación de contexto entre peticiones concurrentes?** | `wrapDispatch` (`src/server/advancedIoApp.ts:313-317`) envuelve cada petición en `hostedRuntime.runWithRequestContext(headers, executeDispatch)`. `HostedNativeCatalystAuthRuntime` mantiene un `AsyncLocalStorage<CatalystApp>` por instancia y `buildHostedAdminAppFromHeaders()` instancia **`new ZCAuth()` nuevo por cada petición** (`{ type: 'advancedio', scope: 'admin' }`), fijando (`pinning`) `apiDomain`, `authPortalDomain`, `projectKey` y `servedByCLI = false`. Así se aísla el contexto asíncrono entre peticiones simultáneas y se neutraliza la mutación global `appOptions` / `[DEFAULT]` de `@zcatalyst/auth-admin`. | **Aislamiento estricto por petición concurrente verificado localmente en `tests/25` (`await setTimeout` intercalados sin cruce).** |
| **6** | **¿Cómo se manejan fallos de inicialización o ausencia de contexto?** | - Invocar `getActiveRequestAdminApp()` o `getActiveRequestNoSQLClient()` fuera de `runWithRequestContext()` lanza fail-closed **`503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE`**.<br>- Cabeceras `x-zc-admin-cred-type` / `x-zc-admin-cred-token` o `x-zc-project-key` ausentes → **`503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE`** (sin fallback silencioso a `external_oauth`).<br>- `x-zc-projectid` / `x-zc-environment` / `x-zc-project-key` incongruentes → **`403 PROJECT_CONTEXT_MISMATCH`**.<br>- Errores de configuración inicial en `catalystEntry.ts` (ej. falta de `VIGOR_SESSION_HMAC_SECRET`, origen con `*` o mezcla `VIGOR_ENVIRONMENT=production` con `CATALYST_ENVIRONMENT=Development`) responden HTTP **`503 SERVER_CONFIGURATION_UNAVAILABLE`** con secretos redactados por `redactSecretsFromString()`. | **Fail-closed total en ausencia de contexto o fallo de inicialización, verificado en `tests/25`.** |

### 1.2 Invariante: por qué el `scope: 'admin'` NO autoriza acciones por sí solo
- Que Catalyst inyecte credenciales de plataforma (`x-zc-admin-cred-*`) en el edge de Advanced I/O **no** significa que el llamador sea administrador de VigorCore: incluso una petición anónima que llegue hasta la función portaría el contexto de plataforma de la función para consultar `SystemControl`/`Users`, pero `CleanSlateAuthGuard` exige que la petición porte **además** credenciales reales de usuario (`__Host-vigor_session` firmada + `X-Vigor-CSRF`, o token Catalyst validado bajo `scope: 'user'` en rutas de intercambio) y rol autorizado en `Users` (`consistent_read: true`).
- Cualquier ruta sin sesión válida o sin rol permitido falla cerrado con `401` o `403` **antes** de que los servicios ejecuten lecturas/escrituras de negocio o administrativas.

---

## 2. CONCILIACIÓN DE RESOLUCIÓN DE TABLAS (`@zcatalyst/nosql@1.0.0`)

### 2.1 Evidencia directa en `@zcatalyst/nosql@1.0.0`
- **Versión instalada verificada:** `@zcatalyst/nosql@1.0.0` (`poc/catalyst-clean-slate/node_modules/@zcatalyst/nosql/package.json`).
- **Firmas y comportamiento en el SDK (`dist-types/index.d.ts:26-73`, `dist-es/index.js:38-73`, `dist-es/table.js:18-26`):**
  - `nosql.table(id: string | INoSQLTable): NoSQLTable` — JSDoc oficial del paquete: *`@param id - Id or Name of the table`*. Construye síncronamente `NoSQLTable` enviando `/nosqltable/${tableId}/...` con `user: CREDENTIAL_USER.admin`.
  - `nosql.getTable(tableId: string): Promise<NoSQLTable>` — JSDoc oficial: *`@param tableId - Id or Name of the NoSQL Table`*. Ejecuta `GET /nosqltable/${tableId}`.
  - `nosql.getAllTable(): Promise<NoSQLTable[]>` — Ejecuta `GET /nosqltable` devolviendo metadatos (`id`, `name`, `status`, `partition_key`, `sort_key`, `global_index`, `ttl_attribute`).

### 2.2 Evaluación arquitectónica: nombres lógicos vs Table IDs por entorno
- **Ventaja de nombres lógicos (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`):** los Table IDs físicos en Zoho Catalyst son **específicos por entorno y proyecto** (en `Development` de `Project-Rainfall` son `136967000000065001`..`136967000000067034`; cuando se aprovisione `Production`, sus Table IDs serán distintos). Usar los nombres lógicos en `advancedIoApp.ts` mantiene un único artefacto portable entre `Development` y `Production` sin quemar IDs por código.
- **Contingencia implementada sin refactor (`tableIdResolver`):** `createCatalystLiveNoSQLAdapter(nosqlOrApp, tableIdResolver?)` (`src/nosql/providers/baseTableProvider.ts:34-46`) ya acepta un callback opcional `tableIdResolver` para traducir cualquier nombre lógico a su Table ID físico (`Development` o variables de entorno) en caso de que el comportamiento real de Catalyst BaaS en `Project-Rainfall` muestre ambigüedad o exija ID numérico.

### 2.3 Procedimiento de verificación **exclusivamente solo lectura** en `Development` (futuro autorizado)
Cuando se autorice la verificación viva en `Development`, **NO** se insertarán, actualizarán ni eliminarán filas en ninguna tabla. Se verificará la resolución de las **5** tablas mediante metadatos `GET`:
1. Invocar `nosql.getAllTable()` (`GET /nosqltable`) y/o `nosql.getTable('<NombreTabla>')` (`GET /nosqltable/<NombreTabla>`) para:
   - `Users` → confirmar `id === '136967000000065001'` y GSIs `GSI_Email` (`136967000000065003`), `GSI_Directory` (`136967000000067001`), `GSI_RoleStatus` (`136967000000067004`).
   - `UserData` → confirmar `id === '136967000000067007'` y GSI `GSI_UserEntityDate` (`136967000000067011`).
   - `AdminInvitations` → confirmar `id === '136967000000067014'` y GSI `GSI_InviteEmailStatus` (`136967000000067016`).
   - `AuditLogs` → confirmar `id === '136967000000067021'` y GSIs `GSI_AuditActor` (`136967000000067025`), `GSI_AuditTarget` (`136967000000067028`), `GSI_GlobalChronology` (`136967000000067031`).
   - `SystemControl` → confirmar `id === '136967000000067034'`.
2. Adicionalmente, `postProvisioningVerifier.ts` ejecuta únicamente sondas de lectura vacía (`fetchItem` / `queryIndex` solo lectura) sin ningún `insertItems`, `updateItems` ni `deleteItems`. Si cualquiera de las 5 llamadas `getTable('<Nombre>')` fallara por nombre, se activaría `tableIdResolver` con el mapa de `phase52Stage1Inventory.ts` (`AUD-53-03`: **`PENDING_LIVE_VERIFICATION`**).

---

## 3. AUDITORÍA DE COMPATIBILIDAD DE EMPAQUETADO (`poc/catalyst-clean-slate/` → `vigor_api`)

### 3.1 Inventario auditado del repositorio y runtime Node.js local
- **Node.js / npm verificados localmente:** **`Node v22.23.2`**, **`npm 10.9.8`** (`engines.node: ">=22"`).
- **`poc/catalyst-clean-slate/package.json` auditado:**
  - `"name": "vigorcore-catalyst-clean-slate"`, `"private": true`, **`"type": "module"`**.
  - **Carencia detectada 1 — Ausencia de `"main"`:** el `package.json` raíz de la POC no define `"main"`. El bundle de staging de `vigor_api` **debe incluir `"main": "dist/server/catalystEntry.js"`** explícitamente.
  - **Carencia detectada 2 — `package-lock.json` raíz ligado a `devDependencies` y nombre raíz:** `poc/catalyst-clean-slate/package-lock.json` **sí existe** (`lockfileVersion: 3`, `54,142` bytes), pero bloquea el paquete raíz `"vigorcore-catalyst-clean-slate"` incluyendo las `devDependencies`. Si el directorio limpio de staging reescribe `package.json` con `"name": "vigor_api"`, `"main": "dist/server/catalystEntry.js"` y solo las 6 dependencias de producción, NO debe mezclar ese `package.json` modificado con el `package-lock.json` raíz (`npm ci` fallaría por desajuste); en staging se debe instalar limpiamente con `npm install --omit=dev --ignore-scripts` (y opcionalmente generar allí un `package-lock.json` exclusivo de producción).
  - **Carencia detectada 3 — Sin `catalyst-config.json` en raíz:** solo existe plantilla documental no aplicada (`config/candidates/catalyst-function.template.json`). En staging se generará `catalyst-config.json` con `"name": "vigor_api"`, `"type": "advancedio"`, `"stack": "node22"`, `"main": "dist/server/catalystEntry.js"`.
- **Dependencias de producción exactas (6 — incluir):**
  1. `@zcatalyst/auth` (`^1.0.0`, resuelto `1.0.0`)
  2. `@zcatalyst/auth-admin` (`^1.1.0`, resuelto `1.1.0`)
  3. `@zcatalyst/nosql` (`^1.0.0`, resuelto `1.0.0`)
  4. `@zcatalyst/transport` (`^1.1.0`, resuelto `1.1.0`)
  5. `@zcatalyst/utils` (`^1.1.0`, resuelto `1.1.0`)
  6. `express` (`^4.22.3`, resuelto `4.22.3`)
- **`devDependencies` exactas (5 — excluir del bundle):**
  `@types/express`, `@types/node`, `playwright-core`, `tsx`, `typescript`.
- **Archivos innecesarios a excluir del bundle de `vigor_api`:**
  `src/`, `src/frontend/`, `frontend/`, `dist-frontend/`, `docs/`, `tests/`, `scripts/`, `config/candidates/`, `.env*`, artefactos temporales o cachés.

### 3.2 Comprobación ESM real de `dist/server/catalystEntry.js` en Node 22
Verificado localmente en `Node v22.23.2` (y cubierto en `tests/25`):
1. `tsconfig.server.json` compila `src/**/*.ts` (excluyendo `src/frontend/**/*`) hacia `dist/` con `"module": "NodeNext"` y `"moduleResolution": "NodeNext"`.
2. La importación dinámica ESM real (`import('./dist/server/catalystEntry.js')`):
   - Resuelve todas las importaciones relativas `.js` y los 6 paquetes de producción (`@zcatalyst/*` + `express`).
   - Expone **`default`** (`typeof mod.default === 'function'`, firma `(req, res)`) y **`catalystAdvancedIoEntry`** (misma función exportada nominalmente).
   - **No** abre puertos TCP ni lee secretos al importar (`startStandaloneLocalServer` solo se invoca si se llama explícitamente).
   - Invocada con `(req, res)` sin entorno configurado, falla cerrado con HTTP **`503 SERVER_CONFIGURATION_UNAVAILABLE`** redactando secretos.
3. **Ausencia de secretos:** ni `dist/` ni `package.json` ni `catalyst-config.json` contienen `VIGOR_SESSION_HMAC_SECRET`, `CATALYST_PROJECT_KEY`, tokens OAuth ni credenciales.
4. **Frontera honesta (`PENDING_LIVE_VERIFICATION`):** aunque la carga ESM local en Node `v22.23.2` funciona y la firma `(req, res)` coincide con el contrato de `export default app`/`handler` para Advanced I/O, **la carga efectiva del módulo ESM por el lanzador real de Catalyst Advanced I/O Node 22** en `Project-Rainfall` permanece **`PENDING_LIVE_VERIFICATION`** hasta el primer despliegue autorizado.

---

## 4. ESTRATEGIA DE PRIMER DESPLIEGUE EN `Development` VÍA FUNCTION URL (API GATEWAY DESHABILITADO)

### 4.1 Decisión operativa
- El primer despliegue autorizado de `vigor_api` en `Development` se realizará **manteniendo API Gateway DESHABILITADO (`Enable now`)** y **`Production` intacto**.
- NO se configurará `api.vigorcore.lat` (`BLOCKED_PENDING_ZOHO_CLARIFICATION`), ni Domain Mapping, ni DNS, ni Project Security Rules alteradas en esta etapa.
- Se utilizará **exclusivamente la Function URL nativa** que Zoho Catalyst asigne a `vigor_api` en `Development` tras el despliegue *(prohibido suponerla o fabricarla de antemano: se leerá literalmente de la Consola o del output de `catalyst deploy` únicamente cuando el operador ejecute el despliegue autorizado)*.

### 4.2 Qué SÍ se puede verificar sobre Function URL antes del API Gateway (y qué NO)

| Verificación sobre Function URL (`Development`) | Viable pre-Gateway | Propósito técnico |
| :--- | :---: | :--- |
| `GET /health` y `GET /api/v1/health` (con/sin prefijo `/server/vigor_api`) | **SÍ** | Confirma carga efectiva del entrypoint ESM `dist/server/catalystEntry.js` en `node22`, arranque de Express, `routeCount: 41`, cabeceras `nosniff`/`DENY`/`no-store` y cero fuga de secretos (`AUD-53-01`, `AUD-53-05`). |
| Inicialización SDK + resolución **solo lectura** de 5 tablas (`getAllTable()` / `getTable()`) | **SÍ** *(mediante verificación controlada o diagnóstico read-only autorizado)* | Confirma que `HostedNativeCatalystAuthRuntime` recibe `x-zc-projectid`, `x-zc-environment=Development` y `x-zc-admin-cred-type/token`, y que las 5 tablas (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`) resuelven sus Table IDs sin escribir filas (`AUD-53-03`). |
| `OPTIONS /api/v1/auth/session/exchange` y `OPTIONS /api/v1/athlete/meals` | **PARCIAL** | Permite medir qué emite el edge nativo vs `VIGOR_CORS_MODE=platform_managed` / `express_enforced` (`AUD-53-02`), aunque las reglas específicas de Gateway aplicarán después. |
| Rechazos fail-closed en rutas protegidas (`/api/v1/athlete/workspace`, `/api/v1/admin/users`, spoofing `x-zc-user-type: admin`) | **SÍ** | Verifica en vivo `401`/`403` sin sesión válida, bloqueo de headers administrativos falsificados y que el runtime nunca degrada a `scope: 'admin'` para autorizar usuarios. |
| Flujo completo de navegador desde `https://app.vigorcore.lat` con cookie `__Host-vigor_session` (`SameSite=Strict`) | **NO (Limitación Cross-Site esperada)** | La Function URL nativa (`*.catalystserverless.com`) es **cross-site** respecto a `app.vigorcore.lat`; los navegadores modernos retienen cookies **`SameSite=Strict`** en peticiones `fetch(..., { credentials: 'include' })` cross-site. La prueba E2E completa de cookie + CSRF + CORS de navegador desde Slate corresponde a la fase posterior de integración con API Gateway / dominio alineado (`LIVE-07`). |

### 4.3 Separación estricta de los 4 planos de verificación

| Plano | Qué cubre exactamente | Estado actual |
| :--- | :--- | :--- |
| **1. Pruebas locales** | `build`, `build:server`, `frontend:build`, `tests/01..25` (unitarias, estáticas, contratos `@zcatalyst/nosql@1.0.0`, `AsyncLocalStorage`, fail-closed, anti-IDOR, RBAC, importación ESM real en Node `v22.23.2` y Express loopback). | **PASS LOCAL (`0` ops remotas)** |
| **2. Pruebas HTTP contra Function URL (`Development`)** | `GET /health`, arranque ESM `node22`, init Express/SDK, resolución read-only de 5 tablas, CORS preflight de Function URL y rechazos fail-closed `401`/`403`/`503`. | **`PENDING_LIVE_VERIFICATION`** *(requiere autorización previa de despliegue)* |
| **3. Integración real con autenticación (`Development`)** | Emisión real de `generateAuthToken('functions')`, intercambio `/bootstrap-profile` / `/exchange`, `Users` + `SystemControl` (`consistent_read: true`), revalidación `<= 15m` y auditoría (`LIVE-01`..`LIVE-06`). | **`PENDING_LIVE_VERIFICATION`** |
| **4. Integración futura con API Gateway (`api.vigorcore.lat`)** | Habilitación controlada de API Gateway (`alternative-b-api-gateway.routes.json`), verificación de `x-zc-admin-cred-token` en rutas `NO_AUTHENTICATION`, passthrough `Cookie`/`Set-Cookie` (`SameSite=Strict`) + `Authorization` + `X-Vigor-CSRF` y desbloqueo de `api.vigorcore.lat` (`LIVE-07`). | **`PENDING_LIVE_VERIFICATION` / `BLOCKED_PENDING_ZOHO_CLARIFICATION`** |

---

## 5. ATOMICIDAD DEL SUPERADMINISTRADOR (BLOQUEO ACTIVO HASTA PRUEBA VIVA)

1. **Invariante de runtime:** en `src/server/advancedIoApp.ts:512-513`, la opción `liveAtomicityVerifiedForSuperadminMutations` permanece estrictamente en **`false`** por defecto (`AdminGovernanceService` recibe `allowSuperadminMutations = false`).
2. **Bootstrap superadmin 100% offline y deshabilitado en HTTP:**
   - `executeOfflineAdminBootstrap()` (`src/services/adminGovernanceService.ts:186`) exige `offlineCliAuthorized: true` (`403 PUBLIC_BOOTSTRAP_PROHIBITED` si es `false`) y **no está expuesta en ninguna ruta Express**.
   - `POST /api/v1/bootstrap-superadmin` o `GET /api/v1/bootstrap-superadmin` no existen en `ROUTE_CONTRACT_SPECS` ni en `ROUTE_DEFINITIONS` (`404`/`403`).
3. **Endpoints y operaciones exactas que permanecen bloqueadas hasta demostrar atomicidad NoSQL en integración viva:**

| Endpoint / Operación | `routeId` | Condición de bloqueo activo | Código HTTP y error exacto |
| :--- | :--- | :--- | :--- |
| **`POST /api/v1/admin/users/:uid/role`** | `admin.users.setRole` | Cuando `targetUser.role === 'superadmin'` **o** `newRole === 'superadmin'` (promoción a superadmin o degradación de superadmin). | **`403 SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED`** *(para llamador `athlete`/`admin` también aplica `403 PERMISSION_DENIED`)* |
| **`POST /api/v1/admin/users/:uid/status`** | `admin.users.setStatus` | Cuando `targetUser.role === 'superadmin'` (suspensión o reactivación automatizada de un superadmin). | **`403 SUPERADMIN_TARGET_PROTECTED`** *(si actor es `admin`)* o **`403 SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED`** *(si actor es `superadmin`)* |
| **`executeOfflineAdminBootstrap()`** *(sin endpoint HTTP)* | *N/A (solo CLI/Consola offline)* | Prohibida ejecución vía HTTP en `vigor_api`; el bootstrap inicial solo puede autorizarse offline tras completar verificaciones vivas y con autorización explícita independiente. | **`404` / `403`** en HTTP; **`403 PUBLIC_BOOTSTRAP_PROHIBITED`** sin flag CLI |
| **`POST /api/v1/admin/users/:uid/password-reset`** *(nota relacionada)* | `admin.users.passwordReset` | Bloqueado por `INT-08` (`requireLiveInt08ForPasswordReset: true`; `VIGOR_ALLOW_RESET_WITHOUT_INT08` prohibida en Catalyst alojado). | **`INT_08_LIVE_VERIFICATION_PENDING`** |

4. **Condición de desbloqueo futuro:** no se habilitará `liveAtomicityVerifiedForSuperadminMutations` ni se ejecutará `executeOfflineAdminBootstrap()` ni se marcará este control como completado hasta comprobar en `Development` vivo la atomicidad real de `updateItems` condicional + recuperación tras timeout con `consistent_read: true` y verificación de `NoSQLResponse.update[0].status === 'Success'`.

---

## 6. VERIFICACIÓN LOCAL EJECUTADA VS ELEMENTOS `PENDING_LIVE_VERIFICATION`

| Elemento | Resultado / Estado | Observación exacta |
| :--- | :--- | :--- |
| **Auditoría de permisos NoSQL (`scope: 'admin'` + `AsyncLocalStorage` + Auth/RBAC/anti-IDOR)** | **`VERIFIED_LOCAL`** | Contrastado en `catalystSdkBridge.ts`, `tableProviders.ts`, `advancedIoApp.ts`, `apiRouterSchema.ts`, `@zcatalyst/nosql@1.0.0` y cubierto por `tests/25`. |
| **Resolución de tablas `@zcatalyst/nosql@1.0.0` (`table()` / `getTable()` / `getAllTable()`)** | **`VERIFIED_LOCAL` (firma SDK)** / **`PENDING_LIVE_VERIFICATION` (remoto)** | Firma SDK confirmada (`Id or Name of the table`); resolución física en `Project-Rainfall` (`Development`) queda `PENDING_LIVE_VERIFICATION`. |
| **Compatibilidad de empaquetado ESM en Node `v22.23.2` (`dist/server/catalystEntry.js`)** | **`VERIFIED_LOCAL` (Node `v22.23.2`)** / **`PENDING_LIVE_VERIFICATION` (Catalyst Node 22)** | Importación ESM real sin errores y respuesta `503` fail-closed verificadas localmente; identificadas carencias de `"main"`, `catalyst-config.json` y desajuste de `package-lock.json` raíz (`devDependencies`) para el directorio de staging. Carga en lanzador Advanced I/O real queda `PENDING_LIVE_VERIFICATION`. |
| **Despliegue inicial Function URL (`Development`, API Gateway deshabilitado)** | **NO EJECUTADO (`PENDING_LIVE_VERIFICATION`)** | Estrategia documentada; requiere autorización independiente para crear/desplegar `vigor_api`. |
| **Atomicidad superadmin y bootstrap offline** | **BLOQUEADO INTENCIONALMENTE** | `liveAtomicityVerifiedForSuperadminMutations: false` y cero ruta HTTP de bootstrap verificados en código y `tests/25`. |

---

## 7. DICTAMEN FINAL DE CONCILIACIÓN PRE-DESPLIEGUE

**Dictamen:** **`PHASE_5_3_PREDEPLOYMENT_RECONCILIATION_READY_NOT_EXECUTED`**

- La arquitectura de `vigor_api` dentro de `poc/catalyst-clean-slate/` es coherente con `Project-Rainfall` (`136967000000014024`, DC `US`, `Development`), con el `scope: 'admin'` requerido por `@zcatalyst/nosql@1.0.0`, con los controles fail-closed de sesión/CSRF/RBAC/anti-IDOR/superadmin y con una estrategia limpia de primer despliegue mediante Function URL manteniendo API Gateway deshabilitado y `api.vigorcore.lat` en `BLOCKED_PENDING_ZOHO_CLARIFICATION`.
- Todos los puntos de infraestructura remota permanecen honestamente en **`PENDING_LIVE_VERIFICATION`** y **cero** operaciones remotas han sido ejecutadas.
