# VIGORCORE — FASE 4.1.3: AUDITORÍA DE AUTENTICACIÓN DUAL, CICLO DE TOKENS Y DEFINICIÓN DE LA FRONTERA DE SESIÓN

**Fecha:** 2026-11-14  
**Directorio aislado:** `poc/catalyst-clean-slate/`  
**Naturaleza de la fase:** Auditoría técnica en modo estrictamente de solo lectura y especificación arquitectónica.  
**Estado de código e infraestructura:** **0** archivos de código modificados, **0** cambios en la aplicación raíz (`src/`), **0** paquetes instalados, **0** dominios comprados, **0** registros DNS/SSL creados, **0** tablas/índices/usuarios creados, **0** correos enviados a soporte Zoho y **0** despliegues remotos.

---

## 1. RESUMEN EJECUTIVO

La Fase 4.1.2 identificó una colisión arquitectónica directa entre el código actual de la POC (`poc/catalyst-clean-slate/`) y la topología de la **Alternativa A** (Frontend en Catalyst Slate `https://app.<dominio-propio>` + Backend en Catalyst Advanced I/O `https://api.<dominio-propio>`):

1. **`CleanSlateAuthGuard.authenticate()` (`src/auth/cleanSlateAuthGuard.ts:616-621`) exige identidad viva de Catalyst Auth (`resolveVerifiedCatalystIdentity` -> `zcAuth.init(req)` -> `getCurrentUser()`) en TODAS las peticiones protegidas**, además de verificar `__Host-vigor_session`, `Users` (`consistent_read: true`) y `SystemControl` (`SESSION#<sid>`, `consistent_read: true`).
2. **`HttpSecurityPolicy.buildCorsHeaders()` (`src/security/httpSecurityPolicy.ts:117`) solo declara `Access-Control-Allow-Headers: Content-Type, X-Vigor-CSRF` y NO incluye `Authorization`.** En un despliegue de subdominios separados (`app.` frente a `api.`), las cookies nativas de Catalyst Authentication emitidas en `app.` no viajan automáticamente a `api.`; cualquier uso de `catalyst.auth.generateAuthToken()` vía `Authorization` quedaría bloqueado en el preflight `OPTIONS` del navegador.
3. **Hallazgo crítico en el SDK instalado (`@zcatalyst/transport`, `@zcatalyst/auth-admin`, `@zcatalyst/nosql`):**
   - `AuthorizedHttpClient.send()` y `HttpClient.send()` (`node_modules/@zcatalyst/transport/dist-es/http-handler.js:300-303,358-365`) leen el `scope` activo de `app.credential.getCurrentUser()` (`this.scope`), ignorando la propiedad `user: CREDENTIAL_USER.admin` que fijan `@zcatalyst/nosql` (`node_modules/@zcatalyst/nosql/dist-es/index.js:47,59` y `table.js:38,56,77,98,116`) y `UserManagementAdmin`. Si en una petición autenticada (`x-zc-user-type: 'user'`) se reutiliza la misma instancia `zcAuth.init(req)` sin `{ scope: 'admin' }`, las llamadas a NoSQL se enviarían con `scope = 'user'`.
   - Inversamente, inicializar NoSQL con `zcAuth.init(req, { scope: 'admin' })` utiliza `x-zc-admin-cred-type` y `x-zc-admin-cred-token` inyectados por el entorno Advanced I/O (`credential.js:248-275`) y **NO requiere** credenciales de usuario en Catalyst (`x-zc-user-cred-token` / `x-zc-cookie`), permitiendo separar limpiamente la frontera entre verificación de identidad externa y autorización de aplicación.
4. **Hallazgo crítico sobre `generateAuthToken()` (`@zcatalyst/auth/dist-es/internal/token-manager.js:26-69`):**
   - El token emitido tiene validez por defecto de **1 hora (`3600` s)**, **carece de `refresh_token`** en el SDK Web y se obtiene únicamente mientras el navegador conserve una sesión activa de Catalyst en el origen frontend (`/authentication/custom-token` + `IAM_DOMAIN/clientoauth/v2/{zaid}/remote/auth`).
   - La documentación oficial de Catalyst *Cross Domain Access* envía ese token en el encabezado **`"Authorization": token` (valor directo sin prefijo `Bearer`)**, aunque la preservación real de este formato y de `Set-Cookie` a través de CloudScale Domain Mapping / API Gateway sigue pendiente de prueba en vivo (`PASS-INTEGRATION`).

### Decisión arquitectónica recomendada
- **Se recomienda adoptar el Modelo B Refinado** (frontera explícita de sesión):
  - **Catalyst Authentication (`zcAuth.init(req, { scope: 'user' })` + `Authorization: <token>`)** se exige en la frontera de autenticación y establecimiento/revalidación de sesión: `POST /api/v1/auth/session/bootstrap-profile`, `POST /api/v1/auth/session/exchange` y opcionalmente en `POST /api/v1/auth/session/refresh` o mediante verificación administrativa servidor-a-servidor (`UserManagementAdmin.getUserDetails(uid)` con `scope: 'admin'`).
  - **Todas las rutas normales de aplicación (`/athlete/*`, `/invitations/redeem`, `/auth/me` con cookie, `/auth/session/logout`, `/auth/session/revoke`, `/admin/*`)** verifican la cookie **`__Host-vigor_session`** (HMAC-SHA256 verificada antes de confiar en `claims.sub`), seguida de lectura fuerte (`consistent_read: true`) en **`Users`** y **`SystemControl` (`SESSION#<sid>`)**, operando los clientes `@zcatalyst/nosql` y `UserManagementAdmin` bajo `zcAuth.init(req, { scope: 'admin' })`.
- **Estado del dictamen:** **`NO LISTO PARA DESPLIEGUE SIN AJUSTE PREVIO DE CÓDIGO Y CONFIRMACIÓN DE ZOHO`**. Requiere aprobación del operador antes de modificar código en una fase posterior.

---

## 2. AUDITORÍA DEL CÓDIGO ACTUAL (`poc/catalyst-clean-slate/`)

Se inspeccionaron en modo estricto de solo lectura los módulos principales de seguridad, autenticación, enrutamiento, datos, gobernanza y tests.

| Archivo | Evidencia Exacta | Comportamiento Actual Verificado | Impacto bajo Alternativa A (`app.` -> `api.`) |
| :--- | :--- | :--- | :--- |
| `src/security/httpSecurityPolicy.ts` | Líneas `20`, `72-87`, `98-120`, `126-181`, `187-210`, `253-338` | - `DEFAULT_ALLOWED_ORIGINS = ['https://fit-x-bhnatsxl.onslate.com']`.<br>- `buildCorsHeaders()` emite `Access-Control-Allow-Origin: <canonical>`, `Access-Control-Allow-Credentials: true`, `Vary: Origin`, `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`.<br>- **Línea `117`: `Access-Control-Allow-Headers: 'Content-Type, X-Vigor-CSRF'`.**<br>- En `POST/PUT/PATCH/DELETE` exige `Origin`/`Referer` en allowlist y bloquea `Sec-Fetch-Site: cross-site`, permitiendo `same-origin`, `same-site` y `none`.<br>- `assertStrictCookieAttributes()` exige `__Host-vigor_session`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` y prohíbe `Domain=`. | 1. **Bloqueo CORS preflight:** Si el cliente envía `Authorization`, el navegador fallará en `OPTIONS` porque `Authorization` falta en línea `117`.<br>2. `allowedOrigins` deberá incluir `https://app.<dominio-propio>` en despliegue.<br>3. `evaluateBrowserCookieCompatibility()` clasifica `app.` <-> `api.` como `same-site` y exige `credentials: 'include'` + `INT-06`/`INT-07`. |
| `src/auth/cleanSlateAuthGuard.ts` | Líneas `144-387`, `447-520`, `545-1084` | - `ServerSessionTokenManager`: HMAC-SHA256 de >=256 bits (`crypto.timingSafeEqual`), rotación con `activeKeyId` + `previousSecrets`, `defaultTtlSec = 43200` (12h), `maxTtlSec = 86400` (24h).<br>- `assertNoIdentitySpoofing()` bloquea cabeceras/query/body de suplantación (`x-vigor-*`, `x-auth-*`, `role`, `sessionEpoch`, `uid`, etc.), **no** bloquea `Authorization` ni `Cookie`.<br>- **Líneas `616-628`: `authenticate()` llama SIEMPRE a `resolveVerifiedCatalystIdentity(req)`** antes de leer `Users` y antes de evaluar `__Host-vigor_session`.<br>- **Línea `657`:** `verifyToken(signedCookie, sessionUser.user_id)` exige `expectedUserId` ya resuelto desde Catalyst Auth.<br>- **`bootstrapAuthenticatedProfile()` (líneas `987-1073`):** verifica `GSI_Email` con `consistent_read: true` y luego ejecuta `insertItem('Users', newProfile)` **sin** `condition: { type: 'attribute_not_exists', attr: 'pk' }`. | 1. **Acoplamiento dual obligatorio:** Hoy es imposible autenticar una petición normal solo con `__Host-vigor_session` porque línea `621` falla con `401 AUTH_SESSION_INVALID` / `UNAUTHENTICATED` si `getCurrentUserFromRequest(req)` no trae token/cookie Catalyst.<br>2. Si en el futuro se implementa Modelo B, `verifyToken` debe poder extraer `claims.sub` tras validar HMAC antes de leer `Users`.<br>3. Conviene añadir condición `attribute_not_exists(pk)` en el alta de `Users`. |
| `src/routes/apiRouterSchema.ts` | Líneas `44-75`, `77-343` | - `CLEAN_SLATE_ENDPOINT_CATALOG` define **30** endpoints (`2` `session_bootstrap`, `19` `session_registered`, `8` `admin`, `1` `superadmin_verified_only`).<br>- `CleanSlateApiDispatcher.dispatch()` maneja `OPTIONS` (`204`, sin cookie/sesión) antes de autenticar.<br>- `bootstrap-profile`, `exchange` y `me` pasan `requireSignedSession: false`; los demás endpoints implementados exigen `requireSignedSession: true`.<br>- **Brecha catálogo vs dispatcher:** el catálogo declara `30` rutas, pero `dispatch()` implementa `17` rutas concretas + `OPTIONS` (faltan `13` rutas `/athlete/*` como `POST/GET /meals`, `PUT /groceries/sync`, `POST /workouts/*`, `POST /cardio`, `POST /notifications`, `PUT /recipes/:id`, `PUT /meal-plans/:weekStart`, `PUT /routines/:id`, `POST /onboarding/complete`), y difieren 4 paths exactos de admin (`/admin/invitations/revoke` vs `:inviteId/revoke`, `/admin/users/set-*` vs `:uid/*`). | 1. Para rutas `session_registered` y `admin` faltantes en `dispatch()`, su contrato en el catálogo es claro, pero falta su cableado HTTP en el dispatcher Express.<br>2. Los 4 desajustes de path `:id` vs cuerpo JSON deben unificarse antes de integrar el frontend Slate. |
| `src/services/athleteDataService.ts` | Líneas `57-502` | - Todos los métodos reciben `actor: AuthoritativeActor` ya validado por `CleanSlateAuthGuard`.<br>- Usan exclusivamente `ICleanSlateNoSQLAdapter` (`Users` y `UserData`), con `consistent_read: true` en lecturas críticas y lock condicional en `completeExecutedWorkout`.<br>- **Cero llamadas** a APIs de usuario de Catalyst Auth. | Compatible al 100% con Modelo A y Modelo B (solo necesita `NoSQL` en `scope: 'admin'`). |
| `src/services/adminGovernanceService.ts` | Líneas `1-1223` | - RBAC por `PERMISSION_MATRIX` sobre `actor.role` proveniente de `Users` (`consistent_read: true`).<br>- `setUserStatus` actualiza `Users.accountStatus`, incrementa `Users.sessionEpoch` y llama a `this.authRuntime.updateUserStatus(uid, USER_STATUS.ENABLE/DISABLE)`.<br>- `requestAdminPasswordReset` llama `this.authRuntime.sendPasswordReset(targetUser.email)` (nota: en `@zcatalyst/auth`, `UserManagement.resetPassword` usa `CREDENTIAL_USER.user`, ver Sección 3).<br>- Todas las demás operaciones solo usan NoSQL (`Users`, `AdminInvitations`, `AuditLogs`, `SystemControl`). | Compatible con Modelo B; solo requiere revisar el mecanismo real de envío de correo/reset en Catalyst (`UserManagement.resetPassword` frente a flujo propio o email service). |
| `src/nosql/cleanSlateEngine.ts` | Líneas `163-307`, `314-747` | - `CatalystLiveNoSQLAdapter` recibe `(table: TableName) => NoSQLTable` y envía exactamente `consistent_read` (`snake_case`) y `NoSQLResponse.update[0].status`. | Quien construya `getTableClient` en producción debe inicializar `@zcatalyst/nosql` con `zcAuth.init(req, { scope: 'admin' })`. |
| `tests/01-auth-and-anti-idor.test.ts` | Líneas `1-327` | - `MockCatalystAuthRuntime.getCurrentUserFromRequest()` simula identidad activa en todos los test cases. | Los tests actuales asumen Modelo A implícitamente en el mock (`authRuntime.setCurrentUser(...)` activo en cada llamada). Si se adopta Modelo B, deberán separarse explícitamente escenarios sin cabecera Catalyst tras el `/exchange`. |

---

## 3. AUDITORÍA DEL SDK INSTALADO (`poc/catalyst-clean-slate/node_modules/@zcatalyst/*`)

Se inspeccionaron directamente los paquetes instalados en `poc/catalyst-clean-slate/node_modules/`:

### 3.1 `@zcatalyst/auth@1.0.0` (lado servidor Node — `dist-es/node.js` y `user-management.js`) y `@zcatalyst/auth-admin` (`dist-es/index.js`, `credential.js`, `dist-types/index.d.ts`)

1. **Inicialización en Advanced I/O (`zcAuth.init(req, { type, appName, scope })`):**
   - `ZCAuth.init()` (`auth-admin/dist-es/index.js:17-65`) detecta `req.headers` como `INIT_TYPE.advancedio`, exige `x-zc-projectid` (`PROJECT_HEADER.id`), `x-zc-admin-cred-type` y `x-zc-admin-cred-token` (`credential.js:248-249`) y crea `new CatalystCredential(options.headers, scope)`.
   - **Comportamiento del parámetro `scope` (`credential.js:253-265`):**
     ```js
     this.userType = credObj['x-zc-user-type'] === 'admin' ? 'admin' : 'user';
     this.scope = scope || this.userType;
     if (this.scope === 'user') {
       if (this.userType === 'admin') {
         throw new CatalystAuthError('AUTH_ERROR', 'User not authenticated...');
       }
       if (this.userToken === undefined && this.cookieStr === undefined) {
         throw new CatalystAuthError('INVALID_CREDENTIAL', 'missing user credentials');
       }
     }
     ```
   - **Implicación decisiva para Modelo A vs Modelo B:**
     - Si una petición entra al endpoint Advanced I/O **sin** token/cookie de usuario Catalyst (caso normal en **Modelo B** usando solo `__Host-vigor_session`), llamar a `zcAuth.init(req)` con `scope: 'user'` (o si `x-zc-user-type` faltara o fuera `'admin'` bajo `{ scope: 'user' }`) lanza `AUTH_ERROR` o `INVALID_CREDENTIAL`.
     - En cambio, llamar a **`zcAuth.init(req, { scope: 'admin' })`** inicializa `CatalystCredential` con `adminCred` (`x-zc-admin-cred-token` / `ticket`) **sin requerir credenciales del usuario final** (`x-zc-user-cred-token` ni `x-zc-cookie`), habilitando `@zcatalyst/nosql` y `UserManagementAdmin` con total autonomía.

2. **Cómo usa `@zcatalyst/transport` (`dist-es/http-handler.js`) el `scope` de `CatalystApp`:**
   - `@zcatalyst/nosql` (`index.js:47,59`, `table.js:38,56,77,98,116`) etiqueta sus peticiones con `user: CREDENTIAL_USER.admin`.
   - **Hallazgo real en `http-handler.js:300-303,358-365`:** `AuthorizedHttpClient.send(request)` llama a `this.app.authenticateRequest(requestCopy)` (que invoca `this.credential.getToken()`, regido por `this.scope` en `credential.js:293-305`) y `HttpClient.send()` asigna `X-CATALYST-USER` desde `this.app.credential.getCurrentUserType()` (basado también en `this.scope`), **sin llamar automáticamente a `switchUser(request.user)`**.
   - **Consecuencia práctica:** Nunca debe reutilizarse una instancia `CatalystApp` inicializada con `{ scope: 'user' }` para instanciar `new NoSQL(app)` o `UserManagementAdmin`; debe crearse una instancia dedicada `appAdmin = zcAuth.init(req, { scope: 'admin' })` (o invocarse `switchUser('admin')` en instancia separada).

3. **Alcance real (`user` vs `admin`) de los métodos de `UserManagement` (`@zcatalyst/auth/dist-es/user-management.js`):**
   - **`userManagement.getCurrentUser()` (línea `28`):** `GET /project-user/current`, marcado `user: CREDENTIAL_USER.user`. **Único** método del backend que exige token/cookie de usuario Catalyst autenticado ante la pasarela.
   - **`userManagement.resetPassword(email, resetConfig)` (línea `47`):** `POST /project-user/forgotpassword`, marcado **`user: CREDENTIAL_USER.user`** (flujo de usuario/anónimo de Catalyst; `adminGovernanceService.ts` lo abstrae detrás de `authRuntime.sendPasswordReset`, pero deberá validarse en vivo si funciona bajo `scope: 'admin'` o invocación directa sin token de usuario objetivo).
   - **`UserManagementAdmin.updateUserStatus(id, USER_STATUS.DISABLE|ENABLE)` (línea `192`):** `POST /project-user/${id}/${userStatus}`, **`CREDENTIAL_USER.admin`**. Funciona con `scope: 'admin'` sin token del usuario objetivo.
   - **`UserManagementAdmin.getUserDetails(id)` (línea `78`):** `GET /project-user/${id}`, **`CREDENTIAL_USER.admin`**. Permite consultar servidor-a-servidor el estado vivo de un usuario en Catalyst Auth (`status`, `is_confirmed`) usando solo credenciales `admin`, sin depender de `generateAuthToken()` en el navegador.
   - **`UserManagementAdmin.deleteUser`, `registerUser`, `getAllUsers`, `generateCustomToken`:** Todos usan `CREDENTIAL_USER.admin`.

4. **Construcción de cabeceras internas en `CatalystApp.authenticateRequest()` (`auth-admin/dist-es/index.js:182-218`):**
   - Si el runtime inyectó `token.access_token`, reenvía `Authorization: Zoho-oauthtoken <token>` hacia Catalyst BaaS.
   - Si inyectó `token.ticket`, reenvía `Authorization: Zoho-ticket <ticket>`.
   - Si inyectó `token.cookie`, reenvía `Cookie` + `X-ZCSRF-TOKEN: zd_csrparam=<ZD_CSRF_TOKEN>`.
   - El SDK Node **no** parsea ni valida el encabezado `Authorization` que envió el navegador; **confía íntegramente** en que la pasarela/runtime de Catalyst valide la petición entrante e inyecte `x-zc-projectid`, `x-zc-admin-cred-*`, `x-zc-user-type` y `x-zc-user-cred-*` (`[VERIFICADO]` en código SDK; la sanitización anti-spoofing de `x-zc-*` desde Internet está `[NO VERIFICADO]` hasta prueba en cuenta real).

### 3.2 `@zcatalyst/auth@1.0.0` (lado navegador — `dist-es/web.js`, `internal/token-manager.js`, `@zcatalyst/auth-client` y `@zcatalyst/transport/dist-es/fetch-handler.js`)

1. **Protocolos de sesión en el navegador (`@zcatalyst/auth-client` + `fetch-handler.js:145-184,258-281`):**
   - `ZcrfTokenProtocol` (por defecto en hosting Catalyst mismo origen): lee la cookie `ZD_CSRF_TOKEN` y envía `X-ZCSRF-TOKEN: zd_csrparam=<csrfToken>` junto con `credentials: 'include'`.
   - `OAuthTokenProtocol` (usado por `PopupManager` en contextos iframe): almacena `{ token, exp }` en **IndexedDB** (`idb-token.js:46-56`) y envía `Authorization: Zoho-oauthtoken <token>`.
   - `JwtTokenProtocol`: lee cookie `JWT_COOKIE_PREFIX` y `ConfigStore` en `sessionStorage` (`config-store.js:1-15`).
2. **Funcionamiento interno exacto de `generateAuthToken(feature = 'functions')` (`internal/token-manager.js:26-69`):**
   - **Paso 1:** Con la sesión activa del navegador en `https://app.<dominio-propio>` (`CREDENTIAL_USER.user`), ejecuta `GET /baas/v1/project/{projectId}/authentication/custom-token?feature=functions`.
   - **Paso 2:** Recibe `{ client_id, scopes, jwt_token }` y llama a `POST {IAM_DOMAIN}/clientoauth/v2/{zaid}/remote/auth` con `auth: false`, `headers: { Origin: window.location.origin }` y query `response_type=remote_token`, `scope`, `client_id`, `jwt_token`.
   - **Paso 3:** Devuelve **`{ access_token, expires_in_sec }`** (con fallback `3600` segundos = 1 hora).
   - **Hechos críticos verificados:**
     - **NO devuelve ni gestiona ningún `refresh_token`.**
     - **NO llama a `setTokenStorage()` ni guarda el `access_token` en IndexedDB, `localStorage`, `sessionStorage` ni cookies** (esa persistencia en IDB solo ocurre en `PopupManager`, no en `generateAuthToken()`).
     - En consecuencia, **renovar** el token de `generateAuthToken()` exige obligatoriamente que la sesión Catalyst de origen en `app.<dominio-propio>` siga viva para repetir `GET /authentication/custom-token` + `remote/auth`.

---

## 4. INVENTARIO Y CLASIFICACIÓN DE TODAS LAS RUTAS (`CLEAN_SLATE_ENDPOINT_CATALOG`)

El catálogo (`src/routes/apiRouterSchema.ts:44-75`) declara **30 rutas**. En la tabla siguiente se clasifican por frontera de autenticación, indicando además si requieren permisos nativos de usuario Catalyst (`CREDENTIAL_USER.user`) frente a operaciones puras de backend (`NoSQL` / `UserManagementAdmin` en `scope: 'admin'`):

| # | Método y Ruta (Catálogo) | Categoría Funcional | Estado en `dispatch()` Actual | ¿Necesita Catalyst `scope: 'user'`? | Frontera en **Modelo A** | Frontera en **Modelo B (Recomendado)** |
| :-: | :--- | :--- | :---: | :---: | :--- | :--- |
| **-** | `OPTIONS *` (preflight CORS) | Preflight HTTP | Implementado (`apiRouterSchema.ts:98`) | **No** | Sin sesión ni cookies; valida `Origin` allowlist | Sin sesión ni cookies; valida `Origin` allowlist |
| **1** | `POST /api/v1/auth/session/bootstrap-profile` | Bootstrap de alta inicial + emisión de cookie | Implementado (`:106`) | **Sí (`getCurrentUser`)** | Catalyst Auth (`Authorization`) + CSRF | **Frontera Catalyst (`Authorization`)** + CSRF -> crea `Users` + `SESSION#<sid>` + `__Host-vigor_session` |
| **2** | `POST /api/v1/auth/session/exchange` | Intercambio de sesión Catalyst -> cookie VigorCore | Implementado (`:117`) | **Sí (`getCurrentUser`)** | Catalyst Auth (`Authorization`) + CSRF | **Frontera Catalyst (`Authorization`)** + CSRF -> valida `Users` + crea `SESSION#<sid>` + `__Host-vigor_session` |
| **3** | `POST /api/v1/auth/session/refresh` | Rotación de `SESSION#<sid>` y cookie | Implementado (`:133`) | Ver análisis abajo* | Catalyst Auth + `__Host-vigor_session` + `SESSION#<sid>` + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + CSRF (*y opcionalmente `UserManagementAdmin.getUserDetails(sub)` con `scope: 'admin'` o Catalyst token si se exige reauth periódica*) |
| **4** | `POST /api/v1/auth/session/logout` | Cierre de sesión actual | Implementado (`:148`) | **No** | Catalyst Auth + `__Host-vigor_session` + `SESSION#<sid>` + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + CSRF (revoca `SESSION#<sid>` y limpia cookie incluso si `generateAuthToken` expiró) |
| **5** | `POST /api/v1/auth/session/revoke` | Revocación individual (`sid`) o global (`sessionEpoch++`) | Implementado (`:162`) | **No** | Catalyst Auth + `__Host-vigor_session` + `SESSION#<sid>` + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + CSRF |
| **6** | `GET /api/v1/auth/me` | Lectura de sesión/actor actual | Implementado (`:183`) | Solo si no hay cookie | Catalyst Auth (`Users` + cookie opcional) | **Si hay `__Host-vigor_session`:** valida cookie + `SESSION#<sid>` + `Users`. **Si no hay cookie y viene `Authorization`:** valida Catalyst (`scope: 'user'`) + `Users` (sin emitir cookie en GET) |
| **7** | `GET /api/v1/athlete/workspace` | Hidratación paginada de datos de atleta | Implementado (`:188`) | **No** (solo NoSQL `admin`) | Catalyst Auth + `__Host-vigor_session` + `SESSION#<sid>` + `Users` | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** (`scope: 'admin'` para NoSQL) |
| **8** | `PATCH /api/v1/athlete/profile` | Actualización segura de perfil propio | Implementado (`:194`) | **No** | Dual + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + CSRF |
| **9** | `POST /api/v1/athlete/onboarding/complete` | Cierre de onboarding (batch <=25) | **Solo catálogo** | **No** | Dual + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + CSRF |
| **10** | `POST /api/v1/athlete/meals` | Registro de comida | **Solo catálogo** | **No** | Dual + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + CSRF |
| **11** | `GET /api/v1/athlete/meals` | Consulta paginada de comidas | **Solo catálogo** | **No** | Dual | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** |
| **12** | `PUT /api/v1/athlete/groceries/sync` | Sincronización de lista de compras (chunks <=25) | **Solo catálogo** | **No** | Dual + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + CSRF |
| **13** | `POST /api/v1/athlete/workouts/start` | Inicio de entrenamiento en progreso | **Solo catálogo** | **No** | Dual + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + CSRF |
| **14** | `POST /api/v1/athlete/workouts/:workoutId/sets` | Registro de series vinculadas | **Solo catálogo** | **No** | Dual + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + CSRF |
| **15** | `POST /api/v1/athlete/workouts/:workoutId/complete` | Cierre condicional de entrenamiento | **Solo catálogo** | **No** | Dual + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + CSRF |
| **16** | `POST /api/v1/athlete/cardio` | Registro de sesión cardio | **Solo catálogo** | **No** | Dual + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + CSRF |
| **17** | `POST /api/v1/athlete/notifications` | Creación de notificación propia | **Solo catálogo** | **No** | Dual + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + CSRF |
| **18** | `PUT /api/v1/athlete/recipes/:recipeId` | Guardado de receta (<=400 KB) | **Solo catálogo** | **No** | Dual + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + CSRF |
| **19** | `PUT /api/v1/athlete/meal-plans/:weekStart` | Guardado de plan semanal (<=400 KB) | **Solo catálogo** | **No** | Dual + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + CSRF |
| **20** | `PUT /api/v1/athlete/routines/:routineId` | Guardado de rutina (<=400 KB) | **Solo catálogo** | **No** | Dual + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + CSRF |
| **21** | `POST /api/v1/invitations/redeem` | Canje de invitación admin/atleta | Implementado (`:203`) | **No** | Dual + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + CSRF |
| **22** | `GET /api/v1/admin/users` | Directorio de usuarios (`GSI_Directory`) | Implementado (`:214`) | **No** | Dual + RBAC (`admin`/`superadmin`) | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + RBAC (`admin`/`superadmin`) |
| **23** | `GET /api/v1/admin/stats` | Estadísticas agregadas | Implementado (`:223`) | **No** | Dual + RBAC (`admin`/`superadmin`) | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + RBAC |
| **24** | `GET /api/v1/admin/users/:uid` | Detalle de usuario + auditoría | Implementado (`:232`) | **No** | Dual + RBAC (`admin`/`superadmin`) | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + RBAC |
| **25** | `POST /api/v1/admin/invitations` | Emisión de invitación | Implementado (`:242`) | **No** | Dual + RBAC + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + RBAC + CSRF |
| **26** | `POST /api/v1/admin/invitations/:inviteId/revoke` | Revocación de invitación | Implementado como `/admin/invitations/revoke` (`:256`) | **No** | Dual + RBAC + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + RBAC + CSRF |
| **27** | `POST /api/v1/admin/users/:uid/status` | Suspensión/habilitación (`USER_STATUS`) | Implementado como `/admin/users/set-status` (`:288`) | **No** (`UserManagementAdmin` es `admin`) | Dual + RBAC + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + RBAC + CSRF |
| **28** | `POST /api/v1/admin/users/:uid/role` | Cambio de rol (`superadmin` deshabilitado por defecto) | Implementado como `/admin/users/set-role` (`:270`) | **No** (solo `Users`/`SystemControl` `admin`) | Dual + `superadmin` + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + `superadmin` + CSRF (*recomendable validar `UserManagementAdmin.getUserDetails` con `scope: 'admin'` antes de promover*) |
| **29** | `POST /api/v1/admin/users/:uid/password-reset` | Envío de reset de contraseña administrativo | Implementado como `/admin/users/password-reset` (`:303`) | **Revisar SDK** (`resetPassword` en `user-management.js:47` marca `user`, no `admin`) | Dual + RBAC + CSRF | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + RBAC + CSRF (probar en `PASS-INTEGRATION` cómo ejecuta `resetPassword` desde backend) |
| **30** | `GET /api/v1/admin/audit-logs` | Consulta cronológica de auditoría | Implementado (`:313`) | **No** | Dual + RBAC (`admin`/`superadmin`) | **`__Host-vigor_session` + `SESSION#<sid>` + `Users`** + RBAC |

> **Nota sobre rutas públicas:** No existen rutas públicas de lectura de datos en `CLEAN_SLATE_ENDPOINT_CATALOG`. Únicamente las peticiones `OPTIONS` de preflight CORS operan sin autenticación. La ruta `POST /api/v1/auth/session/bootstrap-profile` es el único punto explícito de alta inicial en `Users`, pero **exige identidad Catalyst previamente verificada** (`is_confirmed === true` y `status === 'ACTIVE'`).

---

## 5. COMPARATIVA DETALLADA: MODELO A FRENTE A MODELO B

### Modelo A — Autenticación Dual Obligatoria en Cada Petición
El cliente mantiene en memoria un `access_token` de `catalyst.auth.generateAuthToken('functions')` (validez 1h) y lo envía en **todas** las peticiones en `Authorization: <token>` junto con `credentials: 'include'` (`Cookie: __Host-vigor_session=...`). El backend ejecuta siempre `zcAuth.init(req, { scope: 'user' })` -> `getCurrentUser()` **y además** valida `__Host-vigor_session`, `Users` y `SESSION#<sid>`.

- **Ventajas reales:**
  1. **Detección inmediata de baja/suspensión externa en Catalyst Console:** Si un operador borra o deshabilita el usuario directamente en la consola de Catalyst (sin pasar por `/admin/users/set-status`), el gateway o `getCurrentUser()` rechaza el token de Catalyst (o al menos al expirar la ventana de 1h del token actual).
  2. **Doble barrera independiente:** Un atacante necesitaría simultáneamente robar la cookie `HttpOnly` (no legible por JS) **y** poseer un token válido de `generateAuthToken()` en memoria.
  3. **Menor cambio conceptual respecto al código actual de `CleanSlateAuthGuard.authenticate()`**, salvo separar `appAdmin` (`scope: 'admin'`) para NoSQL y añadir `Authorization` en `HttpSecurityPolicy`.
- **Desventajas y riesgos críticos en Alternativa A:**
  1. **Recarga de página (`F5`) y pérdida de memoria:** Como `generateAuthToken()` **no debe guardarse en `localStorage` ni `sessionStorage`**, cada recarga de pestaña vacía el token en memoria y obliga a invocar `generateAuthToken()` (2 round-trips a BaaS + IAM) antes de poder disparar siquiera `GET /api/v1/athlete/workspace`.
  2. **Desajuste de ciclos de vida (1h frente a 12h) sin `refresh_token`:** Si la sesión web de Catalyst expira antes de 12h o el usuario deja la pestaña abierta, `generateAuthToken()` fallará aunque `__Host-vigor_session` (12h) siga vigente. Además, hasta que venza el JWT de 1h ya emitido, un `USER_STATUS.DISABLE` hecho fuera de VigorCore tampoco invalidaría automáticamente un `access_token` stateless de 1h salvo que el gateway o `getCurrentUser()` lo consulte en BaaS.
  3. **Mayor latencia y tráfico de red:** Cada petición protegida añade el coste de validación de `Authorization` en gateway + `GET /project-user/current` en BaaS (`getCurrentUser()`) + **preflight `OPTIONS` obligatorio** incluso en `GET` simples (porque `Authorization` convierte toda petición `GET` en no-simple ante CORS).
  4. **Imposibilidad de `/logout` cuando expiró `generateAuthToken()`:** Si el token de 1h caducó en una pestaña inactiva y el usuario pulsa "Cerrar sesión", `/logout` fallaría con `401` si exigiera `Authorization` vigente, dejando la cookie `HttpOnly` viva en el navegador.

### Modelo B Refinado — Frontera Explícita (Catalyst Auth al Inicio/Intercambio; `__Host-vigor_session` + `SESSION#<sid>` + `Users` en Rutas Normales)
El navegador usa `catalyst.auth.generateAuthToken('functions')` **exclusivamente** en el momento de establecer la sesión VigorCore (`POST /api/v1/auth/session/bootstrap-profile` y `POST /api/v1/auth/session/exchange`, o fallback inicial sin cookie en `GET /api/v1/auth/me`). Una vez emitida `__Host-vigor_session`, todas las peticiones normales de la app (`/athlete/*`, `/invitations/redeem`, `/admin/*`, `/logout`, `/revoke`, `/refresh`) envían **solo** la cookie `HttpOnly; SameSite=Strict` (`credentials: 'include'`), sin `Authorization`. En el backend, `CleanSlateAuthGuard` verifica firma HMAC + `Users` (`consistent_read: true`) + `SystemControl` (`SESSION#<sid>`, `consistent_read: true`) e inicializa NoSQL con `zcAuth.init(req, { scope: 'admin' })`.

- **Ventajas reales:**
  1. **Alineación nativa con el SDK instalado:** `@zcatalyst/nosql` y `UserManagementAdmin` operan con `scope: 'admin'` (`x-zc-admin-cred-token`) y **no necesitan** `x-zc-user-cred-token`.
  2. **Supervivencia transparente a recargas (`F5`):** Al recargar Slate en `https://app.<dominio-propio>`, el navegador envía automáticamente `__Host-vigor_session` en `GET /api/v1/auth/me` y `GET /api/v1/athlete/workspace` sin pasar por `/authentication/custom-token` ni `IAM_DOMAIN`.
  3. **Eliminación de renovaciones continuas cada ~55 min y de bloqueos de `/logout`:** El usuario no pierde su sesión VigorCore de 12h por un fallo transitorio de renovación de `generateAuthToken()`, y `/logout` siempre puede revocar `SESSION#<sid>` y limpiar `__Host-vigor_session`.
  4. **Menos latencia y menos preflights CORS:** Al no enviar `Authorization`, las peticiones `GET` de lectura no disparan `OPTIONS` innecesarios (y se evita una llamada extra `GET /project-user/current` en cada API call).
- **Riesgos específicos del Modelo B y cómo se mitigan:**
  1. **Brecha de deshabilitación/borrado externo directo en Catalyst Console:** Si un operador desactiva o borra una cuenta directamente en Catalyst Console sin usar `POST /api/v1/admin/users/set-status` (el flujo normal sí actualiza `Users.accountStatus`, incrementa `Users.sessionEpoch` y llama `USER_STATUS.DISABLE`), las sesiones ya emitidas podrían seguir operando hasta su expiración (`12h`) o rotación.
     - **Mitigación verificada en SDK (`user-management.js:69-82`):** `UserManagementAdmin.getUserDetails(uid)` utiliza `CREDENTIAL_USER.admin`! Por tanto, el backend en Modelo B **sí puede** consultar servidor-a-servidor el estado en Catalyst Auth (`status === 'ACTIVE' && is_confirmed === true`) **sin pedir `Authorization` al cliente** en momentos críticos: en `POST /api/v1/auth/session/refresh`, en acciones sensibles (`set-role`, `redeem`), o mediante revalidación periódica en `SystemControl` (p. ej. si han pasado >15 min desde la última comprobación de Catalyst en `SESSION#<sid>`).
  2. **Dependencia total de `__Host-vigor_session` frente a XSS o fugas del secreto HMAC:** Mitigado por `HttpOnly; Secure; SameSite=Strict; Path=/` (inaccesible a JS), secreto >=256 bits en entorno + `kid` rotatorio, comprobación constante de `SESSION#<sid>` y `Users.sessionEpoch` con `consistent_read: true`, y protección CSRF multicapa (`Origin`, `Sec-Fetch-Site`, `SameSite=Strict`).
  3. **Riesgo de acoplamiento si el backend necesitara invocar APIs Catalyst con permisos de usuario final:** Hoy VigorCore **no** usa Data Store por usuario ni Stratus con permisos por usuario; toda la capa de datos pasa por NoSQL en servidor con anti-IDOR estricto (`actor.catalystUserId`). Si en el futuro se añade Stratus o un componente con alcance `user`, esas rutas puntuales podrían exigir `Authorization: <generateAuthToken('stratus')>` sin romper el resto del Modelo B.

### Tabla Comparativa Sintética

| Criterio | Modelo A (Dual en cada petición) | Modelo B Refinado (Frontera en Exchange + Cookie en API) |
| :--- | :--- | :--- |
| **Cabeceras por petición normal** | `Cookie: __Host-vigor_session` + `Authorization: <token 1h>` | Solo `Cookie: __Host-vigor_session` (`credentials: 'include'`) |
| **Preflight `OPTIONS` en `GET`** | Siempre (por `Authorization`) | No requerido en `GET` simples sin cabeceras custom |
| **Impacto de `F5` / recarga** | Obliga a regenerar token en memoria antes de hidratar datos | Transparente; cookie `HttpOnly` ya presente |
| **Llamadas BaaS por petición API** | `getCurrentUser()` + NoSQL `Users` + NoSQL `SESSION#<sid>` | NoSQL `Users` + NoSQL `SESSION#<sid>` (+ `getUserDetails` solo en `/refresh` o umbral) |
| **Dependencia de `generateAuthToken()`** | Crítica en el 100% del uso continuo | Limitada a login/bootstrap/exchange inicial |
| **Cierre de sesión (`/logout`) tras 1h** | Puede fallar si caducó `generateAuthToken()` | Siempre operativo con `__Host-vigor_session` |
| **Detección de `DISABLE` vía VigorCore Admin** | Inmediata (`Users.accountStatus` + `sessionEpoch`) | Inmediata (`Users.accountStatus` + `sessionEpoch`) |
| **Detección de `DISABLE` externo en Consola** | Al caducar JWT 1h (o inmediato si BaaS invalida token) | Inmediato en próximo `/exchange` o `/refresh` (vía `getUserDetails` `admin`) |
| **Riesgo principal** | Fricción UX, single-flight complejo y caducidad a 1h | Requiere política operativa de no mutar usuarios fuera de VigorCore o revalidación en `/refresh` |

---

## 6. DIAGRAMA DEL FLUJO DE AUTENTICACIÓN ELEGIDO (MODELO B REFINADO)

```text
Navegador (Slate)                        Catalyst Auth / IAM                Backend Advanced I/O                  Catalyst NoSQL
https://app.<dominio>                    (SDK Web + BaaS/IAM)               https://api.<dominio>                 (scope: 'admin')
─────────────────────                    ────────────────────               ─────────────────────                 ────────────────
1. Usuario inicia sesión ──────────────> Login Catalyst en app.<dominio>
   (SDK Catalyst Auth Web) <──────────── Sesión Catalyst de origen activa

2. Inicio de sesión VigorCore:
   generateAuthToken('functions') ─────> GET /authentication/custom-token
                                         POST /clientoauth/v2/{zaid}/remote/auth
   token (1h, SOLO en RAM JS) <───────── { access_token, expires_in_sec }

3. Intercambio / Alta explícita:
   POST /api/v1/auth/session/exchange
   Headers: Authorization: <token>
            Origin: https://app.<dominio>
   Fetch:   credentials: 'include' ───────────────────────────────────────> [Gateway Catalyst valida token
                                                                             e inyecta x-zc-user-cred-*]
                                                                            - assertCsrfAndOriginForRequest()
                                                                            - zcAuth.init(req,{scope:'user'})
                                                                              -> getCurrentUser() == ACTIVE
                                                                            - consistent_read Users ──────────────> Fetch USER#<uid>
                                                                            - Crear SESSION#<sid> (12h) ──────────> Insert SystemControl
   200 OK + Set-Cookie:                                                     - Firmar HMAC-SHA256
   __Host-vigor_session=...;
   HttpOnly; Secure; SameSite=Strict;
   Path=/; Max-Age=43200 <───────────────────────────────────────────────── [Limpiar `token` de RAM]

4. Navegación normal y recargas (F5):
   GET /api/v1/athlete/workspace
   POST /api/v1/athlete/workouts/start
   Fetch: credentials: 'include'
   (SIN cabecera Authorization) ──────────────────────────────────────────> [Solo llega __Host-vigor_session]
                                                                            - CSRF (Origin + Sec-Fetch-Site)
                                                                            - HMAC verifyToken -> claims.sub
                                                                            - consistent_read Users ──────────────> Fetch USER#<sub >
                                                                            - consistent_read SESSION#<sid> ──────> Fetch SystemControl
                                                                            - Validar ep, status, expiresAtEpochSec
                                                                            - Ejecutar dominio con scope:'admin' ─> Query/Update UserData
   200 OK { success: true, ... } <─────────────────────────────────────────

5. Renovación / Logout / Revocación:
   POST /api/v1/auth/session/refresh ─────────────────────────────────────> [Opcional: UserManagementAdmin.getUserDetails(sub)]
                                                                            - Revocar oldSid -> emitir newSid ────> Update/Insert SystemControl
   POST /api/v1/auth/session/logout ──────────────────────────────────────> - Revocar sid -> Set-Cookie Max-Age=0 -> Update SystemControl
```

*(Nota: Si el operador autorizase finalmente el **Modelo A**, el paso 3 conservaría `access_token` en memoria RAM del frontend y todos los pasos 4–5 adjuntarían `Authorization: <token>` aplicando la política de renovación de la Sección 7.)*

---

## 7. POLÍTICA DE DURACIÓN, RENOVACIÓN Y CICLO DEL TOKEN `generateAuthToken()`

El diseño de esta política se basa estrictamente en la implementación real de `TokenManager.generateAuthToken()` (`node_modules/@zcatalyst/auth/dist-es/internal/token-manager.js:26-69`):

1. **Duración y naturaleza del token:**
   - Duración nominal devuelta en `expires_in_sec`: **3600 segundos (1 hora)**.
   - **No existe `refresh_token` independiente.** Cada renovación vuelve a ejecutar el flujo completo `GET /authentication/custom-token` + `POST {IAM_DOMAIN}/clientoauth/v2/{zaid}/remote/auth` apoyándose en la sesión Catalyst activa del usuario en el navegador.
2. **Regla estricta de almacenamiento en cliente:**
   - **Prohibido** persistir el `access_token` de `generateAuthToken()` en `localStorage`, `sessionStorage` o cookies accesibles por JS (`document.cookie`).
   - Debe residir **exclusivamente en memoria RAM** dentro de un closure/módulo privado de cliente (`{ token, expiresAtMs }`) y borrarse inmediatamente tras completar `/bootstrap-profile` o `/exchange` (en Modelo B) o en el cierre de sesión / `401` definitivo (en Modelo A).
3. **Política de renovación proactiva y bloqueo *single-flight* (obligatorio si se usa Modelo A; recomendado también como utilidad compartida):**
   - **Umbral proactivo:** Si el token aún está en memoria y le quedan `<= 300_000 ms` (5 minutos antes de `expiresAtMs`), se solicita un nuevo token antes de emitir peticiones protegidas.
   - **Lock *single-flight*:** Un único `let inFlightRefresh: Promise<string> | null = null` compartido por toda la SPA impide que múltiples llamadas simultáneas de componentes (`Promise.all`) lancen renovaciones paralelas a `/authentication/custom-token` e IAM. Toda petición concurrente espera a la misma promesa en curso y limpia el puntero en `finally`.
4. **Reintentos seguros ante `401` / errores de Catalyst:**
   - Máximo **1 reintento** tras `401 AUTH_SESSION_INVALID` / `UNAUTHENTICATED`: invalidar la caché en RAM, obtener un token nuevo mediante el lock *single-flight* (forzado) y reintentar **únicamente operaciones idempotentes** (`GET`, `PUT` con clave natural o mutaciones con `idempotencyKey`) cuando la causa sea expiración de token y no `SIGNED_SESSION_REQUIRED` / `SESSION_REVOKED_REAUTH_REQUIRED`.
   - Si `generateAuthToken()` falla (p. ej. porque la sesión Catalyst de origen expiró), o si el backend responde `SESSION_REVOKED_REAUTH_REQUIRED` / `CATALYST_USER_DISABLED` / `ACCOUNT_SUSPENDED`, **detener reintentos de inmediato**, limpiar el estado en RAM y dirigir al usuario a reautenticación en Catalyst.
5. **Comportamiento tras 1 hora y 12 horas (pestaña abierta, inactividad, recarga):**
   - **Escenario A — Pestaña recargada (`F5`) entre 1 min y 12 h:**
     - En **Modelo B:** La cookie `__Host-vigor_session` (12h) sobrevive a la recarga automáticamente; el usuario sigue autenticado sin pedir nuevo `generateAuthToken()`.
     - En **Modelo A:** El token en RAM se pierde al recargar; el cliente intenta llamar silenciosamente a `generateAuthToken()` al arrancar. Si la sesión Catalyst de origen ya caducó aunque `__Host-vigor_session` siguiera vigente, el usuario queda bloqueado hasta volver a iniciar sesión en Catalyst.
   - **Escenario B — Pestaña abierta e inactiva > 1 hora (< 12 horas):**
     - En **Modelo B:** Al reanudar actividad, `__Host-vigor_session` sigue siendo válida hasta las 12h (`expiresAtEpochSec`), y puede renovarse vía `/api/v1/auth/session/refresh` (respetando la ventana máxima configurada).
     - En **Modelo A:** El `access_token` en RAM está caducado; al despertar, el gestor proactivo intenta regenerarlo mediante `generateAuthToken()`. Si la sesión Catalyst del navegador expiró antes de las 12h, las llamadas fallan hasta re-login.
   - **Escenario C — Inactividad >= 12 horas (`defaultTtlSec = 43200s`):**
     - En ambos modelos, `__Host-vigor_session` expira (`Max-Age=43200` y validación explícita `sessionRec.expiresAtEpochSec <= nowSec` en `cleanSlateAuthGuard.ts:696`), forzando reautenticación limpia mediante `/exchange`.
   - **Incógnita documentada (`[NO VERIFICADO]`):** La duración exacta de la cookie/sesión nativa de Catalyst Authentication en el navegador dentro de Slate (`app.<dominio-propio>`) depende de la configuración de sesión de Zoho Accounts / Catalyst Auth y debe medirse empíricamente en `PASS-INTEGRATION`.

---

## 8. ANÁLISIS COMPLETO DE CORS, `Authorization` Y CSRF

### 8.1 Los dos niveles de CORS en Zoho Catalyst

| Nivel | Ubicación y Responsabilidad | Estado Requerido para Alternativa A (`https://app.<dominio>` -> `https://api.<dominio>`) |
| :--- | :--- | :--- |
| **Nivel A: Catalyst Authentication — *Authorized Domains*** | Consola Catalyst -> *CloudScale -> Authentication -> Whitelisting -> Authorized Domains* | Deben registrarse explícitamente **ambos orígenes** (`https://app.<dominio-propio>` y `https://api.<dominio-propio>`) con **CORS habilitado**. Sin este registro, la capa BaaS/Authentication de Catalyst bloquea invocaciones web SDK/cross-domain antes o durante `generateAuthToken()` y llamadas al proyecto. |
| **Nivel B: Backend Express Advanced I/O (`HttpSecurityPolicy`)** | `poc/catalyst-clean-slate/src/security/httpSecurityPolicy.ts` | Debe validar origen exacto contra `allowedOrigins: ['https://app.<dominio-propio>']` y emitir las cabeceras CORS hacia el navegador. Debe verificarse en vivo (`INT-06`) si CloudScale Domain Mapping / API Gateway inyecta o sobrescribe cabeceras CORS antes de llegar a Express. |

### 8.2 Formato exacto del encabezado `Authorization` (sin añadir `Bearer` a ciegas)

1. **Evidencia oficial de Zoho Catalyst (*Cross Domain Access*):** El ejemplo oficial documentado por Zoho para tokens devueltos por `catalyst.auth.generateAuthToken()` pasa el valor directamente sin prefijo:
   ```http
   Authorization: <response.access_token>
   ```
2. **Evidencia del SDK servidor (`@zcatalyst/auth-admin`):** `zcAuth.init(req)` nunca inspecciona `req.headers.authorization` directamente; lee `x-zc-user-cred-type` (`token` o `ticket`) y `x-zc-user-cred-token` inyectados por la pasarela de Catalyst antes de entrar al contenedor Node.js, y posteriormente `CatalystApp.authenticateRequest()` (`auth-admin/dist-es/index.js:182-218`) antepone `Zoho-oauthtoken ` al hablar con BaaS.
3. **Regla obligatoria:** **NO debe añadirse automáticamente el prefijo `Bearer `** en el cliente al enviar el resultado de `generateAuthToken()`. El frontend debe enviar `"Authorization": token` exactamente según la documentación *Cross Domain Access* de Catalyst, dejando marcado como **`[PENDIENTE PASS-INTEGRATION / INT-06]`** confirmar que la pasarela Advanced I/O detrás de `https://api.<dominio-propio>` (CloudScale Domain Mapping / API Gateway) reconoce ese valor directo e inyecta `x-zc-user-type: user` y `x-zc-user-cred-token`.

### 8.3 Política HTTP requerida en `HttpSecurityPolicy`

- `Access-Control-Allow-Origin`: exclusivamente el origen exacto validado (`https://app.<dominio-propio>`). **Nunca `*`**.
- `Access-Control-Allow-Credentials`: `true` (y `fetch(..., { credentials: 'include' })` en cliente).
- `Vary`: `Origin` (presente en respuestas exitosas, `OPTIONS` y errores).
- `OPTIONS` preflight: responde `204` **sin** exigir `__Host-vigor_session` ni token Catalyst (`apiRouterSchema.ts:98-104`).
- `Access-Control-Allow-Headers`:
  - **En Modelo A** (o en Modelo B para `/bootstrap-profile`, `/exchange` y `/me`): debe actualizarse la línea `117` de `httpSecurityPolicy.ts` a:
    `Content-Type, X-Vigor-CSRF, Authorization`
  - **En Modelo B estricto sobre rutas normales:** el cliente no envía `Authorization`, evitando preflight adicional en `GET`, aunque mantener `Authorization` permitido en la lista `Access-Control-Allow-Headers` de la política CORS es seguro y necesario para `/bootstrap-profile` y `/exchange`.
- **Protección CSRF (`httpSecurityPolicy.ts:126-181`):** En `POST/PUT/PATCH/DELETE`, el backend ya valida:
  1. `Sec-Fetch-Site`: rechaza `cross-site` (`403 CSRF_CROSS_SITE_REJECTED`), permite `same-origin`, `same-site` y `none`.
  2. `Origin` (o `Referer` si falta `Origin`): debe coincidir exactamente con `allowedOriginSet`.
  3. Cookie `__Host-vigor_session` con `SameSite=Strict; HttpOnly; Secure; Path=/` sin `Domain=`.
  4. Cabecera personalizada opcional `X-Vigor-CSRF` / `Content-Type: application/json` que fuerzan preflight CORS en navegadores modernos.

---

## 9. MODELO DE REVOCACIÓN INTEGRAL

| Mecanismo | Almacenamiento Autorizado | Cómo Opera en Modelo A | Cómo Opera en Modelo B | Tiempo Efectivo de Corte |
| :--- | :--- | :--- | :--- | :--- |
| **1. Logout / Revocación individual (`sid`)** | `SystemControl`: `pk = SESSION#<sid>`, `status: 'revoked'`, `consistent_read: true` | `authenticate()` valida `SESSION#<sid>` y rechaza con `401`. Requiere que `generateAuthToken()` aún esté vivo para llamar `/logout`. | `authenticate()` valida `SESSION#<sid>` desde cookie y rechaza con `401`. `/logout` funciona siempre con la cookie aunque `generateAuthToken()` haya expirado. | **Inmediato** en la siguiente petición |
| **2. Revocación global (`sessionEpoch`)** | `Users`: `pk = USER#<uid>`, `sessionEpoch++` con update condicional y recuperación por `consistent_read: true` | `claims.ep < userItem.sessionEpoch` rechaza todas las sesiones previas (`401`). | Idéntico (`claims.ep < userItem.sessionEpoch` rechaza todas las cookies emitidas antes del incremento). | **Inmediato** en la siguiente petición |
| **3. Suspensión vía VigorCore Admin (`/admin/users/set-status`)** | `Users.accountStatus = 'suspended'` + `sessionEpoch++` + `USER_STATUS.DISABLE` en Catalyst | Rechazado por `Users.accountStatus !== 'active'` y en Catalyst Auth. | Rechazado inmediatamente por `Users.accountStatus !== 'active'` y `sessionEpoch++`. | **Inmediato** en la siguiente petición |
| **4. Deshabilitación o borrado externo en Consola Catalyst** | Estado remoto en Catalyst Auth BaaS (fuera de `Users`) | Detectado al fallar `getCurrentUser()` (inmediato o al caducar JWT 1h). | **Brecha si no se mitiga:** sesiones activas viven hasta `exp` (<=12h). **Mitigación:** llamar `UserManagementAdmin.getUserDetails(uid)` (`scope: 'admin'`) en `/refresh`, en acciones de alto privilegio o tras ventana periódica (p. ej. 15 min), o prohibir mutaciones manuales fuera de VigorCore. | **Modelo A:** <=1h; **Modelo B sin mitigación:** <=12h; **Modelo B con `getUserDetails`:** acotado a ventana de revalidación |
| **5. Expiración temporal absoluta** | `expiresAtEpochSec` en `SESSION#<sid>` + `exp` en HMAC (`12h`, `max 24h`) | Cookie expira a 12h; `generateAuthToken()` exige renovación cada 1h. | Cookie y `SESSION#<sid>` expiran explícitamente a las 12h (`expiresAtEpochSec <= nowSec`), independiente del TTL asíncrono (`ttlEpochSec`). | **Exacto** al segundo |

---

## 10. RIESGOS RESIDUALES IDENTIFICADOS

1. **Comportamiento de la pasarela L7 de Catalyst (CloudScale Domain Mapping / API Gateway) `[NO VERIFICADO]`:** No existe evidencia en documentación pública de que conserve literalmente `Set-Cookie: __Host-vigor_session=...` (sin añadir `Domain=`), ni que pase `Origin`, `Sec-Fetch-Site`, `OPTIONS` sin auth y `Authorization: <token>` tal cual hasta Advanced I/O.
2. **Sanitización de cabeceras internas `x-zc-*` en Catalyst Advanced I/O `[NO VERIFICADO]`:** El SDK `@zcatalyst/auth-admin` confía en `req.headers['x-zc-user-type']` y `req.headers['x-zc-user-cred-token']`. Debe comprobarse en entorno real que el edge de Catalyst sobrescribe o descarta cualquier cabecera `x-zc-*` enviada por un cliente externo malicioso.
3. **Políticas Safari/WebKit ITP sobre cookies `SameSite=Strict` entre subdominios `app.` y `api.` con CNAMEs distintos `[NO VERIFICADO]`:** Requiere pruebas en navegador real (`INT-07`).
4. **Incompletitud parcial de `CleanSlateApiDispatcher.dispatch()` frente a `CLEAN_SLATE_ENDPOINT_CATALOG`:** 13 rutas `/athlete/*` están especificadas en el catálogo pero no enrutadas aún en `dispatch()`, y 4 rutas `/admin/*` presentan nombres de ruta distintos entre catálogo y dispatcher.
5. **Comportamiento de `UserManagement.resetPassword()` (`user-management.js:47`):** Marcado internamente como `user: CREDENTIAL_USER.user` en el SDK; en `PASS-INTEGRATION` debe verificarse si un administrador en `scope: 'admin'` puede disparar resets para otro usuario o si corresponde usar un flujo de verificación/email propio de Catalyst.
6. **Condición faltante en `insertItem('Users', newProfile)` (`cleanSlateAuthGuard.ts:1052`):** Ante dos llamadas concurrentes a `/bootstrap-profile` del mismo `user_id`, conviene incluir `condition: { type: 'attribute_not_exists', attr: 'pk' }` (o manejar idempotencia) en la fase futura de código.
7. **Reuso accidental de `CatalystApp` con `scope: 'user'` para `@zcatalyst/nosql`:** Verificado en `http-handler.js:300-365`; debe garantizarse separación estricta entre `zcAuth.init(req, { scope: 'user' })` y `zcAuth.init(req, { scope: 'admin' })`.

---

## 11. MATRIZ DE PRUEBAS (ESTADO ACTUAL VS PENDIENTES)

| Suite / Caso | Clasificación Real | Estado Actual | Qué Demuestra / Qué Falta |
| :--- | :---: | :---: | :--- |
| `tests/01-auth-and-anti-idor.test.ts` .. `tests/08-post-provisioning-verifier.test.ts` (40 tests) | `PASS-UNIT` / `PASS-MOCK` / `PASS-STATIC` | **APROBADOS (40/40)** | Reglas locales de HMAC, anti-IDOR, NoSQL payloads `consistent_read`, TTL `SystemControl`, CORS/CSRF en memoria y verificador de aprovisionamiento. **No sustituye pruebas vivas.** |
| Prueba unitaria/mock de **Modelo B** (`cookie-only` en rutas normales sin `MockCatalystAuthRuntime` activo tras `/exchange`) | `PASS-MOCK` *(nueva)* | **PENDIENTE (por crear en fase de código)** | Verificar que `/athlete/*`, `/admin/*`, `/logout`, `/revoke` funcionan con `__Host-vigor_session` únicamente, sin `Authorization`, y rechazan cookies revocadas o expiradas. |
| Prueba de `Authorization` en `HttpSecurityPolicy.buildCorsHeaders()` y `OPTIONS` | `PASS-UNIT` *(nueva)* | **PENDIENTE (por crear en fase de código)** | Verificar `Access-Control-Allow-Headers` incluye `Authorization` cuando corresponde y `OPTIONS` responde `204` sin sesión. |
| Prueba de gestor in-memory + single-flight lock de `generateAuthToken()` | `PASS-UNIT` *(nueva)* | **PENDIENTE (por crear en fase de código)** | Verificar cero uso de `localStorage`/`sessionStorage`, lock único ante N llamadas concurrentes y límite de 1 reintento. |
| **`INT-06`**: Preflight `OPTIONS`, `Authorization: <token>`, `Origin`, `Sec-Fetch-Site` y `Set-Cookie: __Host-vigor_session` a través de Catalyst CloudScale Domain Mapping / API Gateway | `PASS-INTEGRATION` | **PENDIENTE (requiere cuenta/despliegue real)** | Confirmar en red real que Zoho no altera `__Host-vigor_session` ni bloquea `Authorization` / `OPTIONS`. |
| **`INT-07` / `BR-01..BR-20`**: Envío de `SameSite=Strict` en `https://app.<dominio>` -> `https://api.<dominio>` en Chromium, Firefox y Safari/WebKit reales | `PASS-INTEGRATION` | **PENDIENTE (requiere navegador y dominios reales)** | Confirmar que Safari ITP no bloquea la cookie `SameSite=Strict` entre subdominios hermanos. |
| **`INT-08`**: Prueba viva de `zcAuth.init(req, { scope: 'user' })` + `zcAuth.init(req, { scope: 'admin' })` (`NoSQL`, `UserManagementAdmin.getUserDetails`, `USER_STATUS.DISABLE`, `resetPassword`) y sanitización de `x-zc-*` | `PASS-INTEGRATION` | **PENDIENTE (requiere función Advanced I/O real)** | Verificar separación real de `scope` y comportamiento de gateway en producción. |

---

## 12. DICTAMEN FINAL

1. **Estado actual del código en `poc/catalyst-clean-slate/` respecto a Alternativa A:** **Incompatibilidad parcial documentada (`REQUIRES CODE REFACTOR BEFORE DEPLOY`)**. El código actual exige identidad Catalyst en **todas** las rutas (`cleanSlateAuthGuard.ts:621`) y además excluye `Authorization` en CORS (`httpSecurityPolicy.ts:117`), por lo que fallaría en navegador bajo subdominios separados (`app.` frente a `api.`).
2. **Frontera de autenticación recomendada:** **Modelo B Refinado** (Catalyst Auth + `generateAuthToken()` en la frontera de alta/intercambio `/bootstrap-profile`, `/exchange` y fallback sin cookie de `/me`; cookie `__Host-vigor_session` + `Users` `consistent_read: true` + `SystemControl` `SESSION#<sid>` `consistent_read: true` en todas las rutas normales de atleta/admin/logout/revoke; clientes NoSQL y `UserManagementAdmin` inicializados exclusivamente con `zcAuth.init(req, { scope: 'admin' })`; y revalidación administrativa `getUserDetails(uid)` en `/refresh` o acciones críticas).
3. **Autorización de infraestructura:** **Sigue bloqueada.** No deben comprarse dominios, modificarse DNS, aprovisionarse tablas ni desplegarse funciones hasta que el operador elija el modelo (A o B) y obtenga confirmación escrita de soporte Zoho Catalyst (`docs/14-phase-4.1.2-alternative-a-feasibility.md`, Sección 9).

---

## 13. CAMBIOS DE CÓDIGO QUE SERÍAN NECESARIOS EN UNA FASE FUTURA (NO APLICADOS AHORA)

Si el operador autoriza en una fase posterior implementar el **Modelo B Refinado** (o en su caso el Modelo A):

1. **`poc/catalyst-clean-slate/src/security/httpSecurityPolicy.ts`:**
   - Añadir `'Authorization'` a `Access-Control-Allow-Headers` en `buildCorsHeaders()` (`línea 117`) para habilitar `/bootstrap-profile`, `/exchange` (y todas las rutas si fuese Modelo A).
   - Parametrizar `allowedOrigins` desde variable de entorno explícita (incluyendo `https://app.<dominio-propio>` cuando aplique).
2. **`poc/catalyst-clean-slate/src/auth/cleanSlateAuthGuard.ts`:**
   - Separar explícitamente el método de **frontera Catalyst** (`authenticateViaCatalystExchange`, ejecutado en `/bootstrap-profile`, `/exchange` y fallback `/me`) de **`authenticateWithSignedSession`** (ejecutado en rutas normales).
   - En `ServerSessionTokenManager`: separar `decodeAndVerifySignatureOnly(rawToken)` o permitir que `verifyToken` verifique primero la firma HMAC en tiempo constante y devuelva `claims.sub`, validando luego `Users` (`USER#<claims.sub>`) y `SESSION#<claims.sid>` con `consistent_read: true`.
   - En `ICatalystAuthRuntime` e implementación viva futura: usar **`zcAuth.init(req, { scope: 'user' })`** solo para `getCurrentUser()`, y **`zcAuth.init(req, { scope: 'admin' })`** para `@zcatalyst/nosql` y `UserManagementAdmin` (`updateUserStatus`, `getUserDetails`).
   - En `/refresh` (y opcionalmente `/admin/users/set-role`), agregar consulta `UserManagementAdmin.getUserDetails(sub)` con `scope: 'admin'` para detectar cuentas deshabilitadas/borradas externamente en Consola Catalyst.
   - Añadir condición `{ type: 'attribute_not_exists', attr: 'pk' }` en `bootstrapAuthenticatedProfile()` al insertar `Users`.
3. **`poc/catalyst-clean-slate/src/routes/apiRouterSchema.ts`:**
   - Completar en `CleanSlateApiDispatcher.dispatch()` los **13 endpoints `/athlete/*`** definidos en `CLEAN_SLATE_ENDPOINT_CATALOG` y alinear los 4 paths `/admin/*` que hoy difieren entre catálogo y dispatcher.
   - Crear el adaptador HTTP Express real para Catalyst Advanced I/O que conecte `req`/`res` con `CleanSlateApiDispatcher.dispatch()`.
4. **Cliente Slate (fase posterior de frontend):**
   - Implementar un cliente HTTP centralizado con `credentials: 'include'`, almacenamiento **exclusivo en memoria RAM** del token de `generateAuthToken('functions')`, lock *single-flight* y envío de `"Authorization": token` (sin prefijo `Bearer`) únicamente hacia los endpoints de frontera definidos (o en todas las peticiones si se eligiera Modelo A).
5. **Tests (`poc/catalyst-clean-slate/tests/`):**
   - Actualizar/ampliar `tests/01` y `tests/07` para cubrir autenticación solo con `__Host-vigor_session` sin `Authorization`, rechazo de `Authorization` en CORS si falta en allowlist, y single-flight token lifecycle en memoria.

---

## 14. DECISIONES QUE REQUIEREN AUTORIZACIÓN DEL OPERADOR

Antes de editar código o continuar hacia pruebas en vivo, el operador debe confirmar:

1. **Elección del modelo de autenticación entre `app.` y `api.`:**
   - **Opción 1 (Recomendada):** **Modelo B Refinado** (Catalyst Auth + `generateAuthToken()` solo en `/bootstrap-profile`, `/exchange` y fallback `/me`; `__Host-vigor_session` + `SESSION#<sid>` + `Users` en todas las rutas normales; chequeo `getUserDetails` en `scope: 'admin'` durante `/refresh` y mutaciones críticas).
   - **Opción 2:** **Modelo A** (exigir `Authorization: <generateAuthToken>` de 1h en **cada** petición API junto con `__Host-vigor_session`, aceptando renovación en memoria cada ~55 min, recarga obligatoria tras `F5` y fallo de rutas tras 1h si caduca sesión Catalyst de origen).
2. **Política de `/api/v1/auth/session/refresh` en Modelo B:**
   - Confirmar si `/refresh` rotará la cookie validando `__Host-vigor_session` + `SESSION#<sid>` + `UserManagementAdmin.getUserDetails` (`scope: 'admin'`), o si exigirá también token fresco de Catalyst (`generateAuthToken()`).
3. **Gestión de usuarios en producción:**
   - Confirmar la política operativa de realizar altas/bajas/suspensiones **únicamente vía endpoints VigorCore** (salvo emergencias) para mantener sincronía inmediata con `Users.sessionEpoch` y `accountStatus`.
4. **Envío de consulta a Zoho Support (`support@zohocatalyst.com`) y autorización de fase de refactor:**
   - Autorizar (a) el envío del cuestionario técnico de 7 puntos preparado en `docs/14-phase-4.1.2-alternative-a-feasibility.md` Sección 9, y (b) en una fase posterior separada, la aplicación de los cambios de código de la Sección 13 en `poc/catalyst-clean-slate/`.
