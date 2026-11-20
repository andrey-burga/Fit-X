# VIGORCORE — FASE 5.2, ETAPA 2: CONCILIACIÓN FINAL Y RUNBOOK OPERATIVO DE NATIVE CATALYST AUTHENTICATION (`Development`)

**Proyecto en Google AI Studio:** `Fit-X` *(trabajo estrictamente aislado dentro de `poc/catalyst-clean-slate/`)*  
**Proyecto Zoho Catalyst:** `Project-Rainfall`  
**CATALYST_PROJECT_ID:** `136967000000014024`  
**Data Center:** `US` (`accounts.zoho.com` · `https://api.catalyst.zoho.com`)  
**Entorno autorizado en este runbook:** **`Development`** únicamente *(**`Production` queda estrictamente fuera del alcance de Etapa 2**)*  
**Línea base heredada (Etapa 1 cerrada):** **`PHASE_5_2_STAGE_1_NOSQL_PROVISIONING_COMPLETED`** (`docs/29`, `phase52Stage1Inventory.ts` — `5` tablas vacías + `8` GSIs `Active` en `Development`)  
**Estado previo de este runbook antes de su ejecución:** `PHASE_5_2_STAGE_2_RUNBOOK_READY_NOT_EXECUTED` / `RUNBOOK_RECONCILED_READY_FOR_DEVELOPMENT_EXECUTION`  
**Estado actual de Etapa 2 tras ejecución manual en Consola (`Development`):** **`PHASE_5_2_STAGE_2_NATIVE_AUTH_CONFIGURED_PENDING_LIVE_VERIFICATION`** *(Acta oficial en `docs/31-phase-5.2-stage-2-native-auth-closure.md` y registro tipado en `src/provisioning/phase52Stage2Inventory.ts`)*  
**Operaciones remotas ejecutadas por este agente en el cierre:** **`0`**

---

## 1. AUDITORÍA TÉCNICA DE ARQUITECTURA (`ADR-002`) Y SDK INSTALADO (`@zcatalyst/auth@1.0.0`)

Se inspeccionaron directamente los paquetes instalados en `poc/catalyst-clean-slate/node_modules/` (`@zcatalyst/auth@1.0.0`, `@zcatalyst/auth-client`) y los módulos fuente de la POC:

| Componente Auditado | Evidencia Directa Verificada en Código | Implicación para Etapa 2 |
| :--- | :--- | :--- |
| **`@zcatalyst/auth@1.0.0` (`dist-es/web.js`)** | Expone `init()`, `hostedSignIn(redirectUrl)`, `signIn(id, config)`, `generateAuthToken('functions')`, `isUserAuthenticated()`, `signOut(redirectURL)`, `signUp(body)` y `publicSignup()`. **NO** existe ningún método `signInWithEmailAndPassword(email, password)`. | Un formulario React propio no puede autenticar contraseñas directamente contra Catalyst; debe delegar el login al portal de Catalyst (**Hosted Login**). |
| **`@zcatalyst/auth@1.0.0` (`internal/iframe-signin.js`)** | `signIn()` (Embedded) consulta `GET /__catalyst/auth/public-signup`, inyecta `<iframe id="iam_iframe">` hacia `/accounts/p/${zaid}/signin`, accede a `iframeElem.contentWindow.document`, muta nodos Zoho IAM (`.fieldcontainer`, `.signin_container`, `login_id`) y dentro de un iframe cae a `PopupManager` + almacenamiento OAuth en **IndexedDB** (`OAuthTokenProtocol`). | Alto acoplamiento al DOM interno de Zoho IAM, riesgo CSP y desvío hacia tokens persistidos en IndexedDB. Descartado. |
| **`@zcatalyst/auth@1.0.0` (`internal/token-manager.js:26-69`)** | `generateAuthToken('functions')` llama a `GET /baas/v1/project/{id}/authentication/custom-token?feature=functions` (vía `ZcrfTokenProtocol` / `ZD_CSRF_TOKEN`) y luego `POST {IAM_DOMAIN}/clientoauth/v2/{zaid}/remote/auth`. Devuelve `{ access_token, expires_in_sec }` (`~3600` s), **sin `refresh_token`**, y **NO** guarda nada en IndexedDB, `localStorage` ni `sessionStorage`. | Compatible con **Modelo B Refinado**: el token efímero vive solo en RAM durante el único intercambio inicial (`/bootstrap-profile` o `/exchange`) y se descarta al instante. |
| **`@zcatalyst/auth@1.0.0` (`dist-es/user-management.js:98-117`)** | `UserManagementAdmin.registerUser(signupConfig, userDetails)` invoca `POST /project-user` con `user: CREDENTIAL_USER.admin` (`scope: 'admin'`). Exige `signupConfig.platform_type` y `userDetails.first_name` + `userDetails.email_id`. **Nota:** `POST /api/v1/admin/invitations` actualmente **no** lo invoca. | La incorporación de nuevos usuarios con `Public Signup = Disabled` debe resolverse mediante un mecanismo administrativo autorizado (Alternativa A manual ahora en `Development`; Alternativa B evaluable hacia `Production`). |
| **`ADR-002-CATALYST-AUTH-DUAL-MODE` (`src/sdk/catalystSdkBridge.ts`)** | Separa la identidad del usuario final (`scope: 'user'` en `/bootstrap-profile` y `/exchange`, bloqueando `x-zc-user-type: admin` con `403 CATALYST_ADMIN_HEADER_SPOOFED`) del contexto administrativo de `vigor_api` (`VIGOR_CATALYST_AUTH_MODE=hosted_native` -> `new ZCAuth().init({ headers }, { type: 'advancedio', scope: 'admin' })` por petición con `AsyncLocalStorage`, eliminando `CATALYST_ADMIN_*`). | Catalyst Auth verifica identidad de usuario; NoSQL, sesiones, RBAC y auditoría operan en `scope: 'admin'` sin mezclar instancias `CatalystApp`. |
| **Frontend Slate (`https://app.vigorcore.lat`) y POC React 19 / Vite** | El workspace raíz usa `react@^19.0.1` + `vite@^8.3.0`; la POC compila con `vite.frontend.config.ts` (`react-jsx`). `CatalystHostedAuthBridge.ts` implementa `hostedSignIn('/auth/callback')`, protección anti-Open-Redirect y limpieza de RAM en `finally`. | Cero conflicto con React 19, cero manipulación de DOM interno y cero persistencia de tokens en navegador. |

---

## 2. VERIFICACIÓN DE COMPATIBILIDAD DE **HOSTED LOGIN** CON EL STACK VIGORCORE

| Eje de Compatibilidad | Análisis Técnico y Evidencia Verificada | Estado / Clasificación |
| :--- | :--- | :--- |
| **1. React 19 (`^19.0.1`) y Vite (`^8.3.0`)** | `@zcatalyst/auth@1.0.0` (`dist-es/web.js`) es ESM estándar sin dependencia de React ni APIs retiradas (`findDOMNode`). `zcAuth.hostedSignIn('/auth/callback')` realiza navegación top-level (`window.location.href`), sin tocar el árbol DOM de React 19 ni montar iframes dentro de componentes React. | **`[VERIFICADO EN SDK + COMPILACIÓN]`** |
| **2. Frontend Slate (`https://app.vigorcore.lat`)** | Catalyst Slate sirve la SPA bajo `https://app.vigorcore.lat` (`16391000000005003`, SSL activo). Catalyst provee nativamente en ese origen `/__catalyst/sdk/init`, `/__catalyst/auth/login`, `ZD_CSRF_TOKEN` y `/baas/v1/project/{id}/authentication/custom-token`. **En Etapa 2 NO se modifica ni redespliega Slate.** El comportamiento SPA history fallback de `/auth/callback` en Slate real queda pendiente de validación al enlazar frontend. | **`[VERIFICADO EN ARQUITECTURA]`** · comportamiento HTTP vivo en Slate **`PENDING_LIVE_VERIFICATION`** |
| **3. Backend Advanced I/O (`vigor_api` previsto)** | En `app.vigorcore.lat/auth/callback`, la SPA ejecuta `generateAuthToken('functions')` e invoca `POST https://api.vigorcore.lat/api/v1/auth/session/bootstrap-profile` (primer acceso) o `/exchange`. `CleanSlateAuthGuard` exige `scope: 'user'`, `is_confirmed === true && status === 'ACTIVE'`, verifica `Users` (`consistent_read: true`) y registra `SESSION#<sid>` en `SystemControl`. | **`[PASS-LOOPBACK]`** · pasarela real `vigor_api` **`PENDING_LIVE_VERIFICATION`** |
| **4. Flujo `generateAuthToken('functions')` y cabecera `Authorization`** | `CatalystHostedAuthBridge.establishVigorSession()` mantiene `access_token` (1 h, sin `refresh_token`) exclusivamente en RAM solo para `/bootstrap-profile` o `/exchange` (`preSessionExchange: true`) y lo limpia en `finally`. **Limitación vigente verificada en código:** `HttpSecurityPolicy.buildCorsHeaders()` (`src/security/httpSecurityPolicy.ts:157`, modo `express_enforced`) declara hoy `Access-Control-Allow-Headers: Content-Type, X-Vigor-CSRF, X-Vigor-Requested-With` (sin `Authorization`), y Zoho *Cross Domain Access* (`docs/15`) usa token directo en `Authorization` (frente a `Zoho-oauthtoken`). El formato exacto aceptado por el API Gateway bajo `CATALYST_USERS_AUTHENTICATION` vs fallback `NO_AUTHENTICATION` queda en **`PENDING_LIVE_VERIFICATION`**. | **`[PASS-LOOPBACK]`** · passthrough `Authorization` en Gateway **`PENDING_LIVE_VERIFICATION`** |
| **5. Sesiones `__Host-vigor_session` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`)** | `app.vigorcore.lat` y `api.vigorcore.lat` comparten `vigorcore.lat` (*same-site*, cross-origin). `/bootstrap-profile`, `/exchange` y `/refresh` emiten `__Host-vigor_session; HttpOnly; Secure; SameSite=Strict; Path=/` (prohibido `SameSite=None`, prohibido `Domain=`). Las llamadas siguientes usan únicamente `credentials: 'include'` sin enviar tokens Catalyst. | **`[PASS-LOOPBACK]`** · comportamiento real Chromium/Safari **`PENDING_LIVE_VERIFICATION`** |
| **6. CSRF (`X-Vigor-CSRF` + Fetch Metadata + `X-Vigor-Requested-With`)** | Pre-sesión: `Origin` en allowlist (`https://app.vigorcore.lat`), `Sec-Fetch-Site` != `cross-site` y `X-Vigor-Requested-With: VigorCore-CleanSlate`. Post-sesión: `X-Vigor-CSRF` HMAC-SHA256 ligado a `(sub, sid, ep)` guardado solo en memoria (`ServerCsrfTokenProvider`), rotado en `/refresh` y limpiado en `/logout`. | **`[PASS-LOOPBACK]`** · passthrough de cabeceras en Gateway **`PENDING_LIVE_VERIFICATION`** |
| **7. RBAC (`athlete`, `admin`, `superadmin`)** | Catalyst Authentication es únicamente proveedor de identidad (`catalystUserId`, `email`, `is_confirmed`, `status`). Roles (`role`, `roleVersion`, `sessionEpoch`, `accountStatus`) viven autoritativamente en `Users` (`consistent_read: true`) bajo `PERMISSION_MATRIX`. | **`[PASS-UNIT]` + `[PASS-LOOPBACK]`** |

---

## 3. AUDITORÍA EXHAUSTIVA DE RUTAS HOSTED LOGIN (`@zcatalyst/auth@1.0.0`)

### 3.1 Evidencia Directa del SDK Web Instalado (`node_modules/@zcatalyst/auth/dist-es/web.js` y `@zcatalyst/auth-client`)

1. **Firma y comportamiento real de `zcAuth.hostedSignIn(redirectUrl?: string): Promise<void>` (`web.js:121-126`, `web.d.ts:238-255`):**
   ```js
   async hostedSignIn(redirectUrl) {
       if (!ConfigStore.get('INITIALIZED')) {
           await getCredentials();
       }
       window.location.href = `/${URL_DIVIDER.RESERVED_URL}/${URL_DIVIDER.AUTH}/${URL_DIVIDER.LOGIN}?redirect_url=${encodeURIComponent(redirectUrl ?? '/')}`;
   }
   ```
   - Si no se ha ejecutado `zcAuth.init()`, llama primero a `getCredentials()` (`GET /__catalyst/sdk/init` en el mismo origen), cargando `ZAID`, `PROJECT_ID`, `API_DOMAIN`, `AUTH_DOMAIN` (`IAM_DOMAIN`), `ENVIRONMENT`, `IS_APPSAIL` y `PROJECT_DOMAIN` (`@zcatalyst/auth-client/dist-es/index.js:8-48`).
   - Ejecuta una redirección top-level completa del navegador (`window.location.href`) hacia la ruta reservada de la plataforma Catalyst:
     **`/__catalyst/auth/login?redirect_url=<URI_ENCODED_REDIRECT_URL>`** (`RESERVED_URL = '__catalyst'`, `AUTH = 'auth'`, `LOGIN = 'login'`).
2. **Significado exacto del parámetro `redirectUrl`:**
   - Es el destino al que **Catalyst redirige al navegador después de un inicio de sesión exitoso** (transportado en el query param `redirect_url`). Si se omite (`undefined`), Catalyst SDK usa `'/'`.
   - **No** define la URL del formulario de login de Catalyst (esa URL es fija de plataforma: `/__catalyst/auth/login`).
3. **Comportamiento después del inicio de sesión exitoso:**
   - Cuando el usuario se autentica en `/__catalyst/auth/login`, Catalyst establece su sesión de origen en `https://app.vigorcore.lat` (`ZD_CSRF_TOKEN` / `ZcrfTokenProtocol`) y redirige al navegador al destino `redirect_url` configurado — en VigorCore: **`https://app.vigorcore.lat/auth/callback`** (invocado como `zcAuth.hostedSignIn('/auth/callback')`).
   - En `/auth/callback`, la SPA ejecuta `await zcAuth.init()` -> `await zcAuth.isUserAuthenticated()` -> `await zcAuth.generateAuthToken('functions')` (en RAM) -> intercambio único `POST /api/v1/auth/session/exchange` (o `/bootstrap-profile`), recibiendo `__Host-vigor_session` + `X-Vigor-CSRF`.
   - *(El comportamiento exacto de cookies internas y redirecciones HTTP de `/__catalyst/auth/login` en el edge live de Slate es **`PENDING_LIVE_VERIFICATION`**).*
4. **Manejo de cancelaciones y errores:**
   - **Antes de abandonar la SPA:** si `GET /__catalyst/sdk/init` falla o faltan `zaid`/`project_id`, `getCredentials()` rechaza la promesa con `CatalystAuthError` (`CREDENTIAL_FETCH_ERROR` / `PROPERTY_NOT_FOUND`, `@zcatalyst/auth-client/dist-es/index.js:42,63`) y `hostedSignIn()` propaga la excepción sin navegar.
   - **Dentro o al volver del portal `/__catalyst/auth/login`:** el SDK `@zcatalyst/auth@1.0.0` **no** expone ningún callback, código de error en URL ni evento de cancelación específico para `hostedSignIn()` (a diferencia de `signInViaPopup`, que define `POPUP_TIMEOUT`, `POPUP_BLOCKED`, `AUTH_ERROR`). Si el usuario cancela, vuelve atrás o la sesión no queda establecida al llegar a `/auth/callback`, `isUserAuthenticated()` retorna `false` y `CatalystHostedAuthBridge.establishVigorSession()` falla cerrado (`401 CATALYST_USER_NOT_AUTHENTICATED`), permitiendo devolver al usuario a `/auth/login`. Los parámetros exactos que el portal web alojado de Zoho Catalyst pudiera emitir ante fallos de login en vivo son **`PENDING_LIVE_VERIFICATION`**.
5. **Compatibilidad con React Router y Vite:**
   - **Estado actual verificado del repositorio (`package.json`, `vite.frontend.config.ts`, `src/frontend/CleanSlateApp.tsx`):** actualmente **no** hay paquete `react-router` / `react-router-dom` instalado; la POC utiliza enrutamiento por estado React (`activeView`).
   - **Con Vite y Slate (`dist-frontend`):** como `hostedSignIn('/auth/callback')` realiza navegación completa HTTP `GET https://app.vigorcore.lat/auth/callback` al regresar de Catalyst, **Slate o el servidor web estático debe responder `index.html` (SPA History API fallback)** para `/auth/callback` y `/auth/login` (en caso contrario devolvería `404` al volver de Catalyst; este rewrite SPA en Slate real de `app.vigorcore.lat` queda en **`PENDING_LIVE_VERIFICATION`** antes de integrar UI).
   - **Con React Router (si se adopta en Fase 5.3+):** es totalmente compatible con **`BrowserRouter`** (rutas limpias `/auth/login` y `/auth/callback` sin `#`). Se recomienda evitar `HashRouter` porque los fragmentos `#...` pueden interferir con redirecciones o lecturas de URL del flujo de autenticación.

### 3.2 Conciliación Exacta de Rutas (Sin Ambigüedades entre Entrada, Portal Catalyst y Callback)

| Ruta / URL | Propietario | Rol Exacto en el Flujo | ¿Es callback de retorno de Catalyst? |
| :--- | :--- | :--- | :---: |
| **`https://app.vigorcore.lat/auth/login`** | **Frontend VigorCore (React)** | **Ruta de entrada / inicio de sesión en la SPA y destino post-logout o de error.** Desde aquí el usuario pulsa iniciar sesión -> llama `CatalystHostedAuthBridge.startHostedLogin('/auth/callback')` -> `zcAuth.hostedSignIn('/auth/callback')`. También recibe `signOut('/auth/login')`. | **NO** |
| **`https://app.vigorcore.lat/__catalyst/auth/login?redirect_url=%2Fauth%2Fcallback`** | **Plataforma Zoho Catalyst (reservada)** | **URL alojada de autenticación generada automáticamente por Catalyst (`hostedSignIn`).** No la renderiza ni la gestiona React. | **NO** *(es el portal de login de Catalyst)* |
| **`https://app.vigorcore.lat/auth/callback`** | **Frontend VigorCore (React)** | **Única ruta receptora del retorno tras login exitoso en Hosted Login** (`redirectUrl = '/auth/callback'`). Ejecuta `isUserAuthenticated()` -> `generateAuthToken('functions')` en RAM -> `/exchange` o `/bootstrap-profile`. | **SÍ** |

> **Regla documental obligatoria (corrección explícita de conciliación):** **Nunca presentar `/auth/login` y `/auth/callback` indistintamente como callbacks de Catalyst.**
> - **`https://app.vigorcore.lat/auth/login`** = inicia `hostedSignIn('/auth/callback')` y recibe post-logout/errores.
> - **`https://app.vigorcore.lat/auth/callback`** = recibe el retorno exitoso de Catalyst (`redirect_url`).
> *(Si el asistente web de Native Catalyst Authentication en Catalyst Console solicitara explícitamente una URL de redirección post-login en `Development`, debe consignarse **`https://app.vigorcore.lat/auth/callback`**; si solicitara una URL separada de login/post-logout de la app, consignar **`https://app.vigorcore.lat/auth/login`**. Los nombres exactos de los campos del wizard en consola se mantienen **`PENDING_LIVE_VERIFICATION`**).*

### 3.3 Comparativa Resumida: Hosted Login vs Embedded Login

| Criterio Técnico | **Hosted Login (`zcAuth.hostedSignIn`) — ELEGIDO** | Embedded Login (`zcAuth.signIn` / `#iam_iframe`) — DESCARTADO |
| :--- | :--- | :--- |
| **Mecanismo `@zcatalyst/auth@1.0.0`** | Redirección top-level a `/__catalyst/auth/login?redirect_url=...` | `<iframe id="iam_iframe">` mutando nodos de Zoho IAM o `PopupManager` + **IndexedDB**. |
| **Compatibilidad React 19 / CSP** | Cero mutación DOM; compatible con `X-Frame-Options: DENY` / `frame-ancestors 'none'`. | Frágil ante cambios CSS/DOM de IAM; falla bajo CSP estricta. |
| **Modelo B (`__Host-vigor_session`)** | `ZcrfTokenProtocol` -> `generateAuthToken('functions')` (RAM) -> cookie `HttpOnly; SameSite=Strict`. | Riesgo de persistencia OAuth en IndexedDB (`OAuthTokenProtocol`). |

---

## 4. APROVISIONAMIENTO DE IDENTIDADES INVITADAS (CON PUBLIC SIGNUP DESACTIVADO)

### 4.1 Diagnóstico Exacto del Estado Actual

- **Política activa:** **Public Signup = DESACTIVADO (`Disabled`)**, **Third-party Authentication = DESACTIVADA**, **Social Login = DESACTIVADO**.
- **Comportamiento verificado de `POST /api/v1/admin/invitations` (`src/services/adminGovernanceService.ts:595-637`):** valida permiso (`admin` solo crea invitaciones `athlete`; `superadmin` crea `athlete` o `admin`), genera `inviteId` + `rawToken`, almacena el hash SHA-256 (`tokenHash`), `emailNormalized`, `targetRole`, `status: 'pending'`, `expiresAtEpochSec` (7 días) y `ttlEpochSec` (+1 día) en **`AdminInvitations`**, y registra evento en `AuditLogs`. **NO invoca `UserManagement.registerUser()` en Catalyst Authentication.**
- En consecuencia, como **Public Signup está deshabilitado**, un invitado **no** puede autorregistrarse por cuenta propia en `/__catalyst/auth/login`; toda nueva identidad debe incorporarse mediante un **mecanismo administrativo autorizado** en Catalyst Auth además de su invitación en `AdminInvitations`.

### 4.2 Análisis Comparativo Completo: Alternativa A vs Alternativa B

#### **Alternativa A — Alta administrativa manual mediante Catalyst Console → `Authentication` → `User Management` / `Users`**

1. **Prerrequisitos:**
   - Native Catalyst Authentication configurada en el entorno activo (`Development` inicialmente) con **Hosted Login** y **Public Signup desactivado**.
   - Plan/cuota de usuarios activos (MAU) y envío de correos de activación disponible en `Project-Rainfall` (`136967000000014024`).
   - Backend VigorCore accesible (en Fase 5.3+) si se desea emitir en paralelo `POST /api/v1/admin/invitations`.
2. **Permisos requeridos:**
   - **En Catalyst Console:** operador humano con rol administrativo en `Project-Rainfall` (`Project Owner` / `Admin`).
   - **En VigorCore:** actor autenticado con rol `admin` (invita `athlete`) o `superadmin` (invita `athlete` o `admin`) para emitir la fila en `AdminInvitations`.
3. **Correos de invitación y activación:**
   - Flujo en dos avisos diferenciados: (1) al crear el usuario manualmente en `Authentication → Users` / `User Management`, Catalyst envía el correo nativo de activación/contraseña al correo indicado (`PENDING_LIVE_VERIFICATION` texto y remitente exacto en plan activo); (2) la aplicación o el administrador entrega el `inviteId` y `rawToken` de `AdminInvitations` al destinatario (VigorCore POC no envía SMTP propio hoy).
4. **Confirmación de identidad:**
   - El invitado abre el enlace del correo de Catalyst, define su contraseña y queda con `is_confirmed: true` y `status: 'ACTIVE'` en Catalyst Authentication.
   - Al entrar luego por Hosted Login (`/auth/callback`) -> `POST /api/v1/auth/session/bootstrap-profile`, `CleanSlateAuthGuard` comprueba `is_confirmed === true && status === 'ACTIVE'` antes de crear el documento en `Users`.
5. **Asociación con la invitación de VigorCore (`AdminInvitations`):**
   - La vinculación entre la cuenta Catalyst y `AdminInvitations` se realiza de forma segura por **`emailNormalized` exacto** y **hash SHA-256 (`tokenHash`)**: el usuario autenticado invoca `POST /api/v1/invitations/redeem` (`{ inviteId, token }`), donde `redeemInvitation()` verifica `invite.emailNormalized === caller.normalizedEmail` y `crypto.timingSafeEqual(sha256(token), tokenHash)`, promoviendo `Users.role` al `targetRole` invitado y subiendo `roleVersion`.
6. **Prevención de duplicados:**
   - **En Catalyst Auth:** Catalyst impide registrar dos usuarios con el mismo correo dentro del mismo entorno (`PENDING_LIVE_VERIFICATION` mensaje exacto en UI de consola).
   - **En VigorCore `Users`:** `bootstrapAuthenticatedProfile()` consulta `Users.GSI_Email` con `consistent_read: true` (`409 DUPLICATE_EMAIL_BLOCKED`) sobre clave única `pk = USER#<catalystUserId>`.
   - **En `AdminInvitations`:** si el administrador emite varias invitaciones al mismo correo, coexisten distintos `INVITE#<inviteId>` salvo que se revoquen explícitamente o se valide `GSI_InviteEmailStatus` (`emailNormalized`, `status: 'pending'`).
7. **Reintentos e idempotencia:**
   - **Alta manual en Consola:** no posee clave de idempotencia; antes de reintentar, el operador debe inspeccionar `Authentication → Users` para verificar si el correo ya quedó creado.
   - **Canje en VigorCore:** `redeemInvitation()` sí es atómico e idempotente-seguro mediante lock condicional `status: 'pending' -> 'redeeming'` (`lockHolderOpId`, `lockExpiresAtMs = now + 30_000`) antes de actualizar `Users` y pasar a `'redeemed'`.
8. **Comportamiento cuando una operación tiene éxito y la otra falla (fallo parcial):**
   - **Fallo parcial A1 (Alta en Catalyst Console OK, falla creación en `AdminInvitations`):** el usuario ya puede iniciar sesión en Hosted Login y ejecutar `/bootstrap-profile`, pero quedaría con el rol mínimo por defecto (`'athlete'`) y sin registro de invitación `admin`. *Remedio:* emitir posteriormente la invitación correcta en `POST /api/v1/admin/invitations` para ese correo (si debía ser `admin`), o deshabilitar/eliminar el usuario en Catalyst Console si el alta fue errónea.
   - **Fallo parcial A2 (Invitación en `AdminInvitations` OK, falta alta en Catalyst Console):** el usuario tiene `inviteId`/`rawToken`, pero no puede autenticarse porque `Public Signup` está desactivado. *Remedio:* crear el usuario en Catalyst Console con exactamente el mismo `emailNormalized` antes de que venza la invitación (7 días), o revocar la invitación (`POST /api/v1/admin/invitations/:inviteId/revoke`).

---

#### **Alternativa B — Alta automatizada mediante `UserManagementAdmin.registerUser()` del SDK administrativo de Catalyst**

*(Auditoria real del código en `poc/catalyst-clean-slate/node_modules/@zcatalyst/auth/dist-es/user-management.js:98-117`, `dist-types/user-management.d.ts:111-129` y `dist-types/utils/interface.d.ts:29-43`)*:

- **Comportamiento verificado en el SDK:**
  ```ts
  // @zcatalyst/auth/dist-es/user-management.js:98-117
  registerUser(signupConfig, userDetails) // -> POST /project-user (service: "baas", user: CREDENTIAL_USER.admin)
  ```
  - `signupConfig` requiere `{ platform_type: 'web' }` (acepta `redirect_url` y `template_details`).
  - `userDetails` valida en tiempo de ejecución **`['first_name', 'email_id']`** (`ObjectHasProperties(userDetails, ['first_name', 'email_id'])`, líneas 102–103) y acepta opcionalmente `last_name` y `role_id` *(nota: `user-management.d.ts` omite `first_name` en su comentario `@example`, pero el JS real lo exige obligatoriamente)*.
  - Actualmente en `poc/catalyst-clean-slate/src/`, `UserManagementAdmin` se instancia únicamente para `getUserDetails`, `getAllUsers` y `updateUserStatus`; **no está cableado en `POST /api/v1/admin/invitations`** y **no debe implementarse sin autorización previa ni control de saga**.

1. **Prerrequisitos:**
   - `vigor_api` desplegado en `scope: 'admin'` (`VIGOR_CATALYST_AUTH_MODE=hosted_native` o fallback `external_oauth`).
   - Native Catalyst Authentication configurada (`Hosted Login`, `Public Signup` desactivado).
   - Cuota de usuarios/correos y remitente de plantilla de correo válidos en el proyecto (`PENDING_LIVE_VERIFICATION`).
   - Definición obligatoria en el contrato de invitación del campo `firstName` (requerido por `registerUser` en tiempo de ejecución).
2. **Permisos requeridos:**
   - **En VigorCore:** RBAC `invitations:create` (`admin` -> `athlete`; `superadmin` -> `athlete | admin`).
   - **En Catalyst BaaS:** credencial administrativa **`CREDENTIAL_USER.admin`** (`scope: 'admin'` dentro de `HostedNativeCatalystAuthRuntime` aislado con `AsyncLocalStorage`); jamás con `scope: 'user'`.
3. **Correos de invitación y activación:**
   - Al ejecutar `registerUser({ platform_type: 'web', redirect_url: 'https://app.vigorcore.lat/auth/login', ... }, ...)`, Catalyst BaaS envía el correo de activación/verificación con destino configurable (`PENDING_LIVE_VERIFICATION` comportamiento real de `redirect_url` y `template_details` en correo de invitación Catalyst). Si además se requiere el enlace con `inviteId` y `rawToken`, VigorCore debe incluirlo en el flujo de entrega o plantilla controlada.
4. **Confirmación de identidad:**
   - Igual que en Alternativa A: Catalyst marca `is_confirmed: false` hasta que el usuario confirma por correo; `CleanSlateAuthGuard` rechaza `/bootstrap-profile` con `403 EMAIL_VERIFICATION_REQUIRED` hasta ver `is_confirmed === true && status === 'ACTIVE'`.
5. **Asociación con la invitación de VigorCore (`AdminInvitations`):**
   - Idéntica separación de responsabilidades: `AdminInvitations` conserva el hash SHA-256, `emailNormalized`, `targetRole` y expiración (7 días), y `POST /api/v1/invitations/redeem` valida correo y token antes de modificar `Users.role` + `roleVersion` + `AuditLogs`. **Nunca** se delega RBAC de VigorCore a `role_id` de Catalyst Auth.
6. **Prevención de duplicados:**
   - Consultar antes en VigorCore `AdminInvitations.GSI_InviteEmailStatus` (`emailNormalized`, `status: 'pending'`) y `Users.GSI_Email` (`consistent_read: true`).
   - Si el correo ya existe en Catalyst Authentication (por ejemplo, un atleta existente al que se invita para ascender a `admin`), `registerUser()` devolverá error de usuario/correo ya existente (`PENDING_LIVE_VERIFICATION` código HTTP/mensaje exacto de `POST /project-user`); el orquestador debe distinguir "ya existe en Catalyst" de errores fatales para permitir crear la invitación en `AdminInvitations` sin duplicar cuentas.
7. **Reintentos e idempotencia:**
   - `POST /project-user` **no** garantiza idempotencia nativa con clave cliente comprobada (`PENDING_LIVE_VERIFICATION`).
   - Si se adopta en una fase futura, **exige** envolverse en un registro de saga idempotente en `SystemControl` (`pk = CTRL#SAGA#<idempotencyKey>` con `ttlEpochSec`, igual al patrón existente de VigorCore), evitando generar tokens repetidos o llamar dos veces a `registerUser()` ante timeouts.
8. **Comportamiento cuando una operación tiene éxito y la otra falla (fallo parcial):**
   - **Fallo parcial B1 (Falla `registerUser()` tras insertar `AdminInvitations`):** queda una invitación `pending` en NoSQL sin identidad en Catalyst. Si el fallo es transitorio (timeout/5xx), puede reintentarse con la misma clave de saga o revocarse desde `/admin/invitations/:inviteId/revoke`.
   - **Fallo parcial B2 (Éxito de `registerUser()` y falla `insertItem('AdminInvitations')`):** queda un usuario registrado en Catalyst Auth sin invitación registrada en VigorCore. *Mitigación fail-closed:* compensar con `UserManagementAdmin.deleteUser(userId)` si la política prohíbe todo acceso no invitado, o endurecer `/bootstrap-profile` en Fase 5.3+ para exigir invitación `pending` válida en `AdminInvitations` cuando `Public Signup` está desactivado (aun cuando un usuario existiera en Catalyst Auth sin invitación).

### 4.3 Estrategia Operativa Inicial (`Development`) y Evolución a `Production`

| Horizonte | Mecanismo Elegido | Justificación Técnica y Operativa |
| :--- | :--- | :--- |
| **Inicial en `Development` (Fase 5.2 y primeras pruebas de Fase 5.3)** | **Alternativa A** *(Alta manual controlada en Catalyst Console → `Authentication → Users` + emisión de invitación en `AdminInvitations` cuando exista `vigor_api`)* | Cero cambios de arquitectura ni de código productivo antes de desplegar `vigor_api`; mantiene `Public Signup = Disabled` intacto; permite observar en vivo respuestas reales de activación por correo, `is_confirmed`, `redirect_url` y comportamiento exacto de `POST /project-user`. |
| **Evolución hacia `Production` (Fase 5.3+ / 5.4 tras pruebas en vivo)** | **Alternativa B controlada** *(`UserManagementAdmin.registerUser()` detrás de saga idempotente en `SystemControl` + registro en `AdminInvitations`)* | Se habilitará únicamente tras validar en vivo `Development`: (1) respuesta y error exacto de duplicado de `registerUser()`, (2) entrega real del correo de activación (`redirect_url` / `template_details`), y (3) decisión explícita sobre si `/bootstrap-profile` exigirá invitación `pending` obligatoria en `AdminInvitations` para cerrar también el acceso de atletas no invitados. |

---

## 5. CONFIRMACIÓN DE POLÍTICAS DE REGISTRO Y GOBERNANZA DE ACCESO

Todas las políticas siguientes quedan fijadas como obligatorias para Etapa 2 (`Development`) y heredadas para el futuro despliegue en `Production`:

| Política | Estado Obligatorio | Justificación de Seguridad |
| :--- | :---: | :--- |
| **Modalidad Native Catalyst Authentication** | **Hosted Login (`zcAuth.hostedSignIn`) — APLICADO** | Cero iframes/mutación DOM, compatible con React 19 + CSP estricta y Modelo B. |
| **Public Signup (autorregistro abierto)** | **DESACTIVADO (`Disabled`) — APLICADO** | Evita que terceros en Internet se autorregistren hacia `POST /api/v1/auth/session/bootstrap-profile`. Al estar desactivado, **todo usuario nuevo debe incorporarse mediante un mecanismo administrativo autorizado** (Alternativa A inicial / Alternativa B tras validación en vivo). |
| **Third-party Authentication** | **DESACTIVADA (`Set Up` sin configurar) — APLICADO** | Fuera del alcance Clean-Slate autorizado en Fase 5.2. |
| **Social Login (Google, Apple, Microsoft, Facebook, etc.)** | **TODOS DESACTIVADOS — APLICADO** | Evita ampliar superficie de identidad externa sin autorización de diseño ni pruebas de aislamiento. |
| **Custom User Validation** | **DESACTIVADO (`Disabled`) — APLICADO** | Validación de cuenta confirmada/activa y canje de `AdminInvitations` concentrados en `CleanSlateAuthGuard` y `CatalystHostedAuthBridge`. |
| **Authorized Domain / CORS / iFrame** | **`app.vigorcore.lat` · `CORS: Enabled` · `iFrame: Disabled` (`api.vigorcore.lat` no agregado) — APLICADO** | Refuerza navegación top-level (sin iframe) y limita el dominio autorizado inicial a Slate `app.vigorcore.lat`. |
| **Entorno `Production`** | **SIN MODIFICAR** | Desarrollo estricto *Development First*; `Production` queda fuera de Etapa 2. |

---

## 6. VERIFICACIÓN DIRECTA EJECUTADA EN `Authentication → Users` (`Manage Application Users`: `0` USUARIOS)

Conforme a la regla de evidencia directa establecida en el cierre de Fase 5.1.2 (`docs/27`):
- Haber visto el botón `Set Up` antes de configurar Native Auth **NO** demostraba `0` usuarios, ni tampoco se infirió el número de usuarios a partir de haber desactivado Public Signup.
- **Resultado real observado por el operador inmediatamente después de configurar Native Catalyst Authentication en `Development`:**
  1. Entorno verificado: **`Development`** (`Project-Rainfall`, `136967000000014024`, DC `US`).
  2. Vista inspeccionada directamente: **`Authentication → Users` / `Manage Application Users`**.
  3. Evidencia visual literal en pantalla: **`Add your first user`** -> **`Development users: 0 (empty state observado)`**.
  4. **Cumplimiento de prohibición en Etapa 2:** **NO** se pulsó `Add User`, **NO** se crearon cuentas de prueba y **NO** se ejecutó inicio de sesión real todavía.
  5. **Diferenciación respecto a CLI:** No se ejecutó todavía la consulta CLI remota automatizada (`verify-clean-slate-provisioning.ts --live --confirm-readonly --auth-mode external_oauth --expected-project 136967000000014024 --expected-region us`); el valor `0` queda respaldado por **evidencia visual directa en consola** hasta que el operador decida correr dicho comando read-only en su estación.

---

## 7. RUNBOOK OPERATIVO PASO A PASO PARA EL OPERADOR (SOLO `Development`)

> **REGLAS DE BLOQUEO ANTES DE EJECUTAR:**
> - **NO ejecutar automáticamente desde este entorno; esperar acción explícita del operador autorizado.**
> - Trabajar **EXCLUSIVAMENTE** en **`Development`** de **`Project-Rainfall`** (`136967000000014024`, DC **`US`**).
> - **NO tocar `Production`**, **NO crear usuarios**, **NO habilitar Public Signup**, **NO activar Third-party / Social Login**, **NO crear funciones**, **NO habilitar API Gateway**, **NO tocar Domain Mapping, DNS, Slate (`app.vigorcore.lat`), Firebase ni GCP**.

### Paso 1 — Confirmación de Proyecto, Entorno y Estado Limpio de Etapa 1
1. Entrar en Zoho Catalyst Console (`accounts.zoho.com`, DC **`US`**) -> proyecto **`Project-Rainfall`** (`136967000000014024`).
2. Confirmar que el selector de entorno superior muestra **`Development`**.
3. Verificar brevemente en **NoSQL** que siguen existiendo las `5` tablas de Etapa 1 (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`) con **`0` registros**.

### Paso 2 — Ruta Exacta en Catalyst Console para Native Catalyst Authentication
1. En el menú lateral del entorno **`Development`**, abrir **`Authentication`**.
2. Confirmar que **`Native Catalyst Authentication`** y **`Third-party Authentication`** muestran **`Set Up`**.
3. Pulsar **`Set Up`** **únicamente** en **`Native Catalyst Authentication`**.
   > *Nota de transparencia (`PENDING_LIVE_VERIFICATION`): La redacción literal exacta de cada casilla del asistente web de Zoho Catalyst (`Hosted` vs `Embedded`, switch `Public Signup`, nombre del campo `Redirect URL` / `Default Redirect URL`) puede variar entre revisiones de interfaz web; aplicar exactamente la semántica de la tabla del Paso 3.*

### Paso 3 — Valores Exactos a Configurar dentro de Native Catalyst Authentication (`Development`)

| Opción / Campo en el Asistente | Valor Exacto a Configurar | Rol / Justificación |
| :--- | :--- | :--- |
| **Authentication Type / Modalidad** | **`Hosted Login`** | Evita iframe Zoho IAM, compatible con React 19 + CSP y flujo `ZcrfTokenProtocol`. |
| **Redirect URL / Post-Login Callback URL** *(retorno tras login exitoso)* | **`https://app.vigorcore.lat/auth/callback`** | Destino exacto de `redirect_url` pasado por `zcAuth.hostedSignIn('/auth/callback')`. **No usar `/auth/login` como callback de retorno post-login.** |
| **Login / Post-Logout / App Entry URL** *(solo si la consola solicita campo separado de inicio/salida o plantilla de retorno)* | **`https://app.vigorcore.lat/auth/login`** | Ruta SPA que inicia `hostedSignIn('/auth/callback')` y recibe `signOut('/auth/login')`. |
| **Public Signup / Self-Registration** | **`Disabled` (DESACTIVADO)** | Impide autorregistro abierto; altas nuevas solo mediante mecanismo administrativo autorizado. |
| **Email Verification / Account Confirmation** | **Habilitado (obligatorio)** | `CleanSlateAuthGuard` rechaza con `403 EMAIL_VERIFICATION_REQUIRED` cuentas con `is_confirmed === false`. |

### Paso 4 — Opciones Confirmadas Desactivadas / Intactas (Ejecutado en `Development`)
1. **`Third-party Authentication`:** Sin configurar (permanece en **`Set Up`**).
2. **`Social Login` (Google, Microsoft, Apple, Facebook, etc.):** **Todos desactivados**.
3. **`Public Signup`:** **`Disabled`**.
4. **`Custom User Validation`:** **Desactivado (`Disabled`)**.
5. **`iFrame` / `Embedded Login`:** **`Disabled`** (no utilizado).
6. **`Authorized Domain` y `CORS`:** **`app.vigorcore.lat`** configurado, **`CORS: Enabled`**, **`api.vigorcore.lat`: no agregado**.
7. **`API Gateway`:** Permanece en **`Enable now`** (deshabilitado).
8. **`Domain Mapping`:** Permanece en **`Add Mapping`** (sin mapear `api.vigorcore.lat`).
9. **`Functions` y `Security Rules`:** Permanecen en **`Functions are not created yet!!`**.
10. **Entorno `Production`:** **Sin modificar**.

### Paso 5 — Inspección Visual Ejecutada Posterior a la Configuración (`Development`)
1. Confirmado en consola que **`Native Catalyst Authentication`** quedó habilitada en **`Development`** mediante **Hosted Login**, **`Public Signup: Disabled`**, **`Custom User Validation: Disabled`**, **`Authorized Domain: app.vigorcore.lat`**, **`CORS: Enabled`** e **`iFrame: Disabled`**.
2. Confirmado que **`Third-party Authentication`** sigue sin configurar y **`Social Login`** permanece totalmente desactivado.
3. Inspeccionada directamente la vista **`Manage Application Users`**, observando **`Add your first user`** (**`0` usuarios en `Development`**; sin pulsar `Add User` ni crear cuentas de prueba).
4. Mantenidas intactas las `5` tablas NoSQL y `8` GSIs de Etapa 1, así como `Production` sin modificar (`api.vigorcore.lat` no agregado).
5. La corroboración CLI remota (`--live --confirm-readonly`) **no** se ha ejecutado aún.

### Paso 6 — Condiciones `STOP` Inmediatas y Recuperación

| Condición `STOP` | Acción Inmediata |
| :--- | :--- |
| **`Authentication → Users` muestra `> 0` usuarios** | **DETENERSE inmediatamente.** Documentar correos/IDs visibles sin borrar cuentas sin autorización, auditar origen y no avanzar a Fase 5.3. |
| **Se modificó `Production` por error** | **DETENERSE**, volver a `Development`, inspeccionar qué cambió en `Production` + `Authentication → Users` (`0` usuarios) y esperar instrucción explícita. |
| **No es posible desactivar `Public Signup`** | **DETENERSE** antes de enlazar frontend o desplegar `vigor_api`; documentar el bloqueo de UI y endurecer la validación de invitación en backend antes de exponer rutas. |
| **Se activó por accidente `Third-party` o `Social Login`** | **DETENERSE** y desactivar/revertir inmediatamente en `Development` antes de cerrar Etapa 2. |

### Paso 7 — Separación Estricta: Usuario Final vs `vigor_api` vs Operador CLI

| Plano | Actor | Mecanismo Exacto | Alcance |
| :--- | :--- | :--- | :--- |
| **Usuario Final** | Atleta / Admin en `https://app.vigorcore.lat` | Native Auth (**Hosted Login**) -> `/auth/callback` -> `generateAuthToken('functions')` (RAM) -> `POST /bootstrap-profile` o `/exchange` (`scope: 'user'`, bloquea `x-zc-user-type: admin`) -> **`__Host-vigor_session`** + **`X-Vigor-CSRF`**. | Identidad de usuario final en navegador <-> frontera API. |
| **Backend `vigor_api`** | Servicio Advanced I/O alojado | **`VIGOR_CATALYST_AUTH_MODE=hosted_native`** (`new ZCAuth().init({ headers }, { type: 'advancedio', scope: 'admin' })` con `AsyncLocalStorage`). Fallback documentado: `external_oauth`. | 5 tablas NoSQL y `UserManagementAdmin` (`scope: 'admin'`), con anti-IDOR por `catalystUserId`. |
| **Operador CLI** | Estación PowerShell del operador | `verify-clean-slate-provisioning.ts --live --confirm-readonly --auth-mode external_oauth`. | Lectura exclusiva de tablas, GSIs y conteo `authUsersCount` (`0` escrituras). |

---

## 8. ELEMENTOS PENDIENTES DE VERIFICACIÓN EN VIVO (`PENDING_LIVE_VERIFICATION`)

Ninguno de los puntos siguientes se declara resuelto por la configuración en Catalyst Console, ni por compilaciones o pruebas loopback locales:
1. **Inicio de sesión real con una cuenta autorizada** en `Development`. **`PENDING_LIVE_VERIFICATION`**
2. **Callback real de Hosted Login en Slate** (`/__catalyst/auth/login?redirect_url=%2Fauth%2Fcallback` -> `https://app.vigorcore.lat/auth/callback`, incluyendo manejo de error/cancelación en portal Zoho y correos reales de activación `Alternativa A` / `Alternativa B`). **`PENDING_LIVE_VERIFICATION`**
3. **SPA history fallback en Slate real** para **`/auth/login`** y **`/auth/callback`**. **`PENDING_LIVE_VERIFICATION`**
4. **Intercambio real en vivo de `generateAuthToken('functions')`** en RAM hacia `/api/v1/auth/session/bootstrap-profile` y `/api/v1/auth/session/exchange` (incluyendo formato exacto `Authorization` y passthrough bajo API Gateway). **`PENDING_LIVE_VERIFICATION`**
5. **Emisión y validación real de `__Host-vigor_session` y `X-Vigor-CSRF`**. **`PENDING_LIVE_VERIFICATION`**
6. **Comportamiento real de cookies en navegadores reales** (**Chromium** y **Safari/WebKit**) para `SameSite=Strict`, `HttpOnly`, `Secure` y `Path=/` entre `app.vigorcore.lat` y `api.vigorcore.lat`. **`PENDING_LIVE_VERIFICATION`**
7. **Integración efectiva con API Gateway, Domain Mapping (`api.vigorcore.lat`) y función Advanced I/O `vigor_api`** (además de semántica real en vivo de `UserManagementAdmin.registerUser()` / `POST /project-user`). **`PENDING_LIVE_VERIFICATION`**

---

## 9. VERIFICACIÓN LOCAL EJECUTADA Y DICTAMEN ACTUALIZADO DE ETAPA 2

### Verificaciones Locales (`poc/catalyst-clean-slate/`, `0` operaciones remotas)
- `npm --prefix poc/catalyst-clean-slate run build` (`tsc --noEmit` backend + frontend): **PASS (`0` errores)**
- `npm --prefix poc/catalyst-clean-slate run build:server` (`tsc -p tsconfig.server.json`): **PASS (`0` errores)**
- `npm --prefix poc/catalyst-clean-slate run frontend:build` (`vite build`): **PASS**
- `npm --prefix poc/catalyst-clean-slate test`: **PASS** (incluye `tests/22-phase-5.2-stage-2-native-auth-runbook.test.ts` y `tests/23-phase-5.2-stage-2-closure.test.ts`)

### Dictamen Final Tras Registro de Ejecución Manual (`Development`)
- **Estado previo superado:** `PHASE_5_2_STAGE_2_RUNBOOK_READY_NOT_EXECUTED` (`RUNBOOK_RECONCILED_READY_FOR_DEVELOPMENT_EXECUTION`)
- **Dictamen vigente de Etapa 2:** **`PHASE_5_2_STAGE_2_NATIVE_AUTH_CONFIGURED_PENDING_LIVE_VERIFICATION`** *(Acta completa en `docs/31-phase-5.2-stage-2-native-auth-closure.md`: Native Catalyst Authentication configurada en `Development` bajo Hosted Login, Public Signup `Disabled`, Social/Third-party/Custom User Validation desactivados, Authorized Domain `app.vigorcore.lat`, `CORS: Enabled`, `iFrame: Disabled`, `api.vigorcore.lat` no agregado, `Production` sin modificar, evidencia visual directa de `0` usuarios en `Manage Application Users` -> `"Add your first user"`, cero pruebas CLI `--live` ejecutadas todavía y las 7 integraciones en vivo marcadas explícitamente `PENDING_LIVE_VERIFICATION`)*.
