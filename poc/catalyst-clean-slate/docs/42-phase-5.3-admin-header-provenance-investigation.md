# VIGORCORE — FASE 5.3: RECONCILIACIÓN DE PROCEDENCIA DE CABECERAS CATALYST (`x-zc-user-type=admin` EN PETICIÓN LIVE)

**Proyecto AI Studio:** `Fit-X` *(alcance exclusivo en `poc/catalyst-clean-slate/`)*  
**Proyecto Catalyst:** `Project-Rainfall` (`136967000000014024`) · Región `US`  
**Entorno objetivo:** **`Development`** *(`Production`, API Gateway, Slate, DNS, Firebase y GCP intactos)*  
**Función:** `vigor_api` (`136967000000074001` · Advanced I/O · Node.js 22)  
**Estado:** **`PHASE_5_3_ADMIN_HEADER_PROVENANCE_UNDER_INVESTIGATION`**

---

## 1. EVIDENCIA LIVE REPORTADA POR EL OPERADOR

Navegación directa de nivel superior desde Chrome/Brave (`sec-fetch-site: none`) sobre:

- `GET /server/vigor_api/api/v1/athlete/workspace`
- API Gateway: **deshabilitado**
- **Cabeceras de petición salientes del navegador (DevTools):**
  - **NO** incluyó `x-zc-user-type`
  - **NO** incluyó `Authorization`
  - **SÍ** envió cookies del navegador *(valores omitidos por seguridad)*
- **Respuesta recibida del servidor:**
  - HTTP **`403 Forbidden`**
  - `error`: **`CATALYST_ADMIN_HEADER_SPOOFED`**
  - `message`: `Incoming x-zc-user-type=admin is strictly prohibited on user authentication endpoints.`
  - Cabeceras de respuesta presentes: `x-catalyst-function-id: 136967000000074001` y `x-catalyst-function-name: vigor_api`

---

## 2. AUDITORÍA EXACTA DEL CAMINO DE MIDDLEWARE Y PUNTO EXACTO DE GENERACIÓN

Inspección directa línea a línea de `src/server/catalystEntry.ts`, `src/server/advancedIoApp.ts`, `src/routes/apiRouterSchema.ts`, `src/auth/cleanSlateAuthGuard.ts`, `src/sdk/catalystSdkBridge.ts` y `node_modules/@zcatalyst/auth-admin@1.1.0`:

### 2.1 Cadena secuencial completa de la petición

1. **`catalystAdvancedIoEntry(req, res)` (`src/server/catalystEntry.ts:35-59`):**
   - Obtiene `VigorCoreRuntimeBundle` ya inicializado (`VIGOR_CATALYST_AUTH_MODE=hosted_native`) y delega a Express `runtime.app(req, res)`.
2. **Middlewares globales de Express (`src/server/advancedIoApp.ts:173-211`):**
   - `lines 173-180`: fija cabeceras de respuesta (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cache-Control`, `Pragma`). **No toca `req.headers`.**
   - `lines 182-211`: `express.json({ limit: '1mb' })` + manejador de errores JSON. **No toca `req.headers`.**
3. **Middleware principal de despacho (`advancedIoApp.ts:213-362`):**
   - `normalizeCatalystPath(req.originalUrl || req.url || req.path)` (`line 217`): convierte `/server/vigor_api/api/v1/athlete/workspace` → `/api/v1/athlete/workspace`.
   - Fast-path `/health` (`lines 238-249`): **no aplica** a `/api/v1/athlete/workspace`.
   - `normalizeIncomingHeaders(req.headers)` (`lines 120-132, 261`): itera `Object.entries(req.headers)` normalizando únicamente claves a minúsculas (y uniendo arrays con `', '`). **No lee `req.rawHeaders`, no reescribe cookies a cabeceras y no añade ninguna cabecera `x-zc-*`.**
   - `parseCookieHeader(headers.cookie)` (`lines 105-118, 262`): extrae pares `cookies` sin alterar `headers`.
   - Construye `incomingReq = { headers, cookies, query, body }` (`lines 264-269`).
4. **Envoltorio `deps.wrapDispatch` (`advancedIoApp.ts:313-314` → `HostedNativeCatalystAuthRuntime.runWithRequestContext` en `src/sdk/catalystSdkBridge.ts:1192-1198`):**
   - Llama a **`buildHostedAdminAppFromHeaders(headers, config)`** (`catalystSdkBridge.ts:1042-1122`), que:
     - Valida pinning de `x-zc-projectid` (`=== 136967000000014024`) y `x-zc-environment` (`=== 'Development'`); si difieren lanza `403 PROJECT_CONTEXT_MISMATCH`.
     - Valida presencia obligatoria de **`x-zc-admin-cred-type`** y **`x-zc-admin-cred-token`** (`lines 1073-1087`); si faltan lanza `503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE`.
     - Valida **`effectiveProjectKey = config.projectKey ?? reqProjectKey`** (`lines 1089-1096`); como `CATALYST_PROJECT_KEY` no está en las 10 env vars de `Development`, exige **`x-zc-project-key`** en `req.headers` (si falta lanza `503`).
     - Construye un objeto local nuevo `sanitizedAdminHeaders` (sin mutar `incomingReq.headers`), inicializa `new ZCAuth().init({ headers: sanitizedAdminHeaders }, { type: 'advancedio', scope: 'admin' })` y lo almacena en `AsyncLocalStorage` (`this.adminStorage.run(adminApp, fn)`).
5. **Despachador de rutas (`CleanSlateApiDispatcher.dispatch`, `src/routes/apiRouterSchema.ts:1148-1186`):**
   - `buildCorsHeaders(req)` (`line 1155`): al no haber cabecera `Origin`, devuelve `{ Vary: 'Origin' }`.
   - `matchCompiledRoute('GET', '/api/v1/athlete/workspace')` (`line 1165`) → `athlete.workspace.get` (`apiRouterSchema.ts:354-362`).
   - `assertCsrfAndOriginForRequest('GET', req, 'none_safe_get')` (`line 1175`) → pasa (`GET`).
   - Invoca `authenticateForSpec(ctx)` (`line 163`) → `authGuard.authenticate(ctx.req, { requireSignedSession: true, authPolicy: 'hmac_session', ... })`.
6. **`CleanSlateAuthGuard.authenticate` (`src/auth/cleanSlateAuthGuard.ts:995-1050`):**
   - **`assertNoIdentitySpoofing(req, ...)` (`line 1008`, definido en `lines 672-737`):** normaliza cada clave de cabecera con `k.toLowerCase().replace(/[-_]/g, '')`. La clave `'x-zc-user-type'` se transforma en `'xzcusertype'`, que **no** pertenece a `FORBIDDEN_IDENTITY_KEYS` ni empieza por `xuser*`, `xauth*`, `xactor*`, `xrole*`, `xvigorsession*` o `xvigorrole*`. Por tanto `assertNoIdentitySpoofing` **pasa sin error**.
   - **`extractSignedSessionCookie(req)` (`line 1014`):** la cookie propia `__Host-vigor_session` no está presente (`undefined`).
   - **Camino 2 (`lines 1049-1050`):** entra a `resolveVerifiedCatalystIdentity(req)` → `HostedNativeCatalystAuthRuntime.getCurrentUserFromRequest(req)` (`catalystSdkBridge.ts:1221`).
7. **PUNTO EXACTO DE GENERACIÓN DE `403 CATALYST_ADMIN_HEADER_SPOOFED` (`src/sdk/catalystSdkBridge.ts:1251-1258`):**
   - `lines 1224-1249`: revalida `x-zc-projectid`, `x-zc-project-key` y `x-zc-environment`.
   - **`lines 1251-1258`:**
     ```ts
     const reqUserType = readHeaderCaseInsensitive(incomingHeaders, CONSTANTS.CREDENTIAL_HEADER.user); // 'x-zc-user-type'
     if (reqUserType && reqUserType.toLowerCase() === CONSTANTS.CREDENTIAL_USER.admin) {
       throw new AuthGuardError(
         403,
         'CATALYST_ADMIN_HEADER_SPOOFED',
         'Incoming x-zc-user-type=admin is strictly prohibited on user authentication endpoints.'
       );
     }
     ```

### 2.2 Relación temporal exacta respecto a inicializaciones y acceso a datos

| Hito del ciclo de petición | ¿Ocurre ANTES o DESPUÉS de `CATALYST_ADMIN_HEADER_SPOOFED`? | Evidencia exacta |
| :--- | :---: | :--- |
| Extracción y validación de cabeceras Catalyst en `buildHostedAdminAppFromHeaders` (`x-zc-admin-cred-*`, `x-zc-project-key`, `x-zc-projectid`, `x-zc-environment`) | **ANTES** *(y tuvo éxito)* | `advancedIoApp.ts:313-314` → `catalystSdkBridge.ts:1042-1122` |
| Inicialización `ZCAuth.init(..., { type: 'advancedio', scope: 'admin' })` | **ANTES** *(y tuvo éxito en `wrapDispatch`)* | `catalystSdkBridge.ts:1113-1116` |
| Ejecución de `CleanSlateApiDispatcher.dispatch()` y matching de ruta | **ANTES** | `apiRouterSchema.ts:1148-1177` |
| Ejecución de `assertNoIdentitySpoofing()` | **ANTES** *(pasa porque `'xzcusertype'` no está en su lista)* | `cleanSlateAuthGuard.ts:1008` |
| Inicialización `ZCAuth.init(..., { type: 'advancedio', scope: 'user' })` | **NO OCURRE (abortado ANTES)** | `catalystSdkBridge.ts:1308` nunca se alcanza |
| Llamada `UserManagement.getCurrentUser()` a Zoho BaaS | **NO OCURRE (abortado ANTES)** | `catalystSdkBridge.ts:1319` nunca se alcanza |
| Inicialización o consulta de NoSQL (`getActiveRequestNoSQLClient()`, `Users`, `UserData`, `SystemControl`) | **NO OCURRE (abortado ANTES)** | `providers` perezoso (`advancedIoApp.ts:472`) nunca es invocado |

---

## 3. RECONCILIACIÓN ENTRE LO OBSERVADO EN EL NAVEGADOR Y EN EL SERVIDOR

### 3.1 Por qué el navegador NO envió `x-zc-user-type`, pero Express SÍ lo recibió

Al cruzar el código de VigorCore con el código oficial de `@zcatalyst/auth-admin@1.1.0` (`node_modules/@zcatalyst/auth-admin/dist-es/credential.js:245-265`) y `@zcatalyst/utils@1.1.0` (`constants.js:55-75`):

1. **Ni Express ni el código de VigorCore generan `x-zc-user-type` en `req.headers`:**
   - `normalizeIncomingHeaders` (`advancedIoApp.ts:120-132`) solo copia `req.headers` con claves en minúsculas (nunca `req.rawHeaders`, nunca añade `x-zc-*`).
   - `buildHostedAdminAppFromHeaders` sí escribe `x-zc-user-type: 'admin'` dentro de un objeto local privado `sanitizedAdminHeaders` (`catalystSdkBridge.ts:1109`), pero ese objeto se pasa únicamente a `new ZCAuth().init(...)` en `wrapDispatch` y **jamás** muta `incomingReq.headers`.
2. **Qué sí demuestra la evidencia live sobre el proxy de borde de Zoho Catalyst:**
   - El hecho de que `buildHostedAdminAppFromHeaders` **no** fallara con `503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE` demuestra que el runtime Node.js **recibió en `req.headers` desde el proxy/plataforma de Catalyst** al menos `x-zc-admin-cred-type`, `x-zc-admin-cred-token` y `x-zc-project-key` (y, si estaban presentes, `x-zc-projectid=136967000000014024` y `x-zc-environment=Development`).
   - En `@zcatalyst/auth-admin/dist-es/credential.js:253-261`, el SDK oficial de Zoho implementa explícitamente este contrato para funciones Advanced I/O alojadas:
     ```js
     this.userType =
         credObj[CREDENTIAL_HEADER.user] === CREDENTIAL_USER.admin
             ? CREDENTIAL_USER.admin
             : CREDENTIAL_USER.user;
     this.scope = scope || this.userType;
     if (this.scope === CREDENTIAL_USER.user) {
         if (this.userType === CREDENTIAL_USER.admin) {
             throw new CatalystAuthError('AUTH_ERROR', 'User not authenticated. Please login to proceed with user scope', ...);
         }
     ```
   - Esto confirma que **el plano de plataforma / reverse proxy de Catalyst Advanced I/O inyectó `x-zc-user-type: admin`** (junto con `x-zc-admin-cred-*` y `x-zc-project-key`) antes de entregar la petición HTTP al contenedor Node.js de `vigor_api`.
3. **Qué permanece sin determinar entre dos hipótesis de origen en Catalyst Edge (hasta ejecutar la comparación A vs B):**
   - **Hipótesis H1 (derivada de sesión/cookies Zoho Console):** El borde de Catalyst inspeccionó las cookies de sesión Zoho enviadas por el navegador del operador (autenticado en Zoho Console) y tradujo esa sesión administrativa/propietario a `x-zc-user-type: admin`.
   - **Hipótesis H2 (valor por defecto de plataforma en ausencia de sesión de usuario final Catalyst):** El borde de Catalyst inyecta `x-zc-user-type: admin` por defecto en invocaciones directas sin sesión de usuario final de Catalyst Authentication (lo cual explicaría el mensaje propio del SDK de Zoho en `credential.js:260`: *"User not authenticated. Please login to proceed with user scope"*).

### 3.2 Diferenciación estricta de las 4 capas de cabeceras

| Capa | Quién la construye / observa | Qué contiene en esta petición live |
| :--- | :--- | :--- |
| **1. Cabeceras salientes del navegador** | Chrome/Brave (DevTools Network) | URL destino, `sec-fetch-site: none`, cookies del navegador hacia el dominio Catalyst/Zoho. **Sin** `x-zc-user-type`, **sin** `Authorization`. |
| **2. Cabeceras inyectadas por el borde Catalyst** | Proxy/infraestructura Zoho Catalyst antes del contenedor Node.js | Inyecta contexto de ejecución en plataforma: `x-zc-admin-cred-type`, `x-zc-admin-cred-token`, `x-zc-project-key`, `x-zc-projectid`, `x-zc-environment`, `x-zc-user-type` *(y en sesiones de usuario final Catalyst, `x-zc-user-cred-*` / `x-zc-cookie`)*. |
| **3. `req.headers` del runtime Node.js / Express** | Contenedor Node.js 22 de `vigor_api` (`advancedIoApp.ts:120-132`) | Unión de cabeceras reenviadas + cabeceras inyectadas por el borde Catalyst, normalizadas en minúsculas por Node.js/Express sin añadir claves nuevas. |
| **4. Cabeceras internas del SDK** | `catalystSdkBridge.ts` y `@zcatalyst/auth-admin` | Objetos aislados `sanitizedAdminHeaders` (`scope: 'admin'`) y `sanitizedUserHeaders` (`scope: 'user'`), más cabeceras salientes `PROJECT_ID`, `X-Catalyst-Environment`, `Authorization` hacia `api.catalyst.zoho.com` vía `addDefaultAppHeaders()`. Nunca modifican `incomingReq.headers`. |

---

## 4. INVENTARIO DE CABECERAS DE CONTEXTO DE PLATAFORMA EN `HostedNativeCatalystAuthRuntime`

| Cabecera (`CONSTANTS`) | Clasificación en `HostedNativeCatalystAuthRuntime` | Comportamiento verificado en código (`catalystSdkBridge.ts`) | Evidencia inferida de la respuesta live `403 CATALYST_ADMIN_HEADER_SPOOFED` |
| :--- | :--- | :--- | :--- |
| **`x-zc-admin-cred-type`** | **Requerida** para runtime admin | Leída en `buildHostedAdminAppFromHeaders` (`line 1073`) y `getCurrentUserFromRequest` (`line 1269`). Si falta en `wrapDispatch` → **`503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE`**. | **Presente** en el contenedor (de lo contrario habría devuelto `503` antes del dispatcher). |
| **`x-zc-admin-cred-token`** | **Requerida** para runtime admin *(secreto efímero; nunca registrar)* | Leída en `line 1077` y `line 1273`. Si falta → **`503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE`**. | **Presente** en el contenedor (de lo contrario habría devuelto `503`). |
| **`x-zc-project-key`** | **Requerida** en `wrapDispatch` si falta `CATALYST_PROJECT_KEY` env *(sensible)* | Leída en `line 1055` / `line 1089`. Como `CATALYST_PROJECT_KEY` no está definida como env var en `Development`, si falta `x-zc-project-key` → **`503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE`**. | **Presente** en el contenedor. |
| **`x-zc-projectid`** | **Validación cruzada (pinning)** *(opcional si omitida, obligatoria coincidencia si presente)* | Leída en `line 1046` / `line 1224`. Si está presente y difiere de `136967000000014024` → **`403 PROJECT_CONTEXT_MISMATCH`**. | Ausente o igual a `136967000000014024`. |
| **`x-zc-environment`** | **Validación cruzada (pinning)** *(opcional si omitida, obligatoria coincidencia si presente)* | Leída en `line 1064` / `line 1242`. Si está presente y difiere de `'Development'` → **`403 PROJECT_CONTEXT_MISMATCH`**. | Ausente o igual a `'Development'`. |
| **`x-zc-user-type`** | **Metadato de identidad / scope de usuario** | Leída únicamente en `getCurrentUserFromRequest()` (`line 1251`). Si vale `'admin'` → **`403 CATALYST_ADMIN_HEADER_SPOOFED`**. | **Presente con valor `'admin'`** en `req.headers` dentro del contenedor. |

### Riesgo arquitectónico secundario detectado en Camino 3 (`__Host-vigor_session`)

En `src/auth/cleanSlateAuthGuard.ts:1087-1099` (Camino 3, cuando el cliente sí envía la cookie propia `__Host-vigor_session`):
- Tras validar criptográficamente el HMAC de `__Host-vigor_session`, la línea `1092` ejecuta `optionalCatalystUser = await this.authRuntime.getCurrentUserFromRequest(req)`.
- Si el borde de Catalyst inyecta `x-zc-user-type: admin` por defecto en peticiones sin token Catalyst de usuario final (Hipótesis H2), entonces **incluso peticiones legítimas autenticadas con `__Host-vigor_session` dispararían `403 CATALYST_ADMIN_HEADER_SPOOFED` dentro de `getCurrentUserFromRequest`, convertido en `401 AUTH_SESSION_INVALID` en la línea `1094`**.
- Esta condición crítica depende directamente de distinguir H1 vs H2 en la comparación controlada A vs B antes de modificar ningún guardia.

---

## 5. DISEÑO DE VERIFICACIÓN CONTROLADA (COMPARACIÓN A VS B) — NO EJECUTAR AUTOMÁTICAMENTE

**Endpoint objetivo (solo lectura, `0` escrituras, `requiresCsrf: false`):**  
`GET https://project-rainfall-943998020.development.catalystserverless.com/server/vigor_api/api/v1/athlete/workspace`

### Escenarios a comparar por el operador

- **Escenario A:** Petición directa desde ventana de navegador estándar donde el operador mantiene sesión abierta en Zoho Catalyst Console (envía cookies Zoho).
- **Escenario B:** Petición directa desde ventana privada/incógnito limpia (cero cookies Zoho, cero extensiones) o cliente HTTP limpio sin cookies ni cabeceras `x-zc-*` ni `Authorization`.

### Matriz de interpretación rigurosa de resultados posibles

| Resultado observado en B (o en A) | Qué establece con certeza | Qué NO establece por sí solo |
| :--- | :--- | :--- |
| **A = `403 CATALYST_ADMIN_HEADER_SPOOFED` y B = `401 UNAUTHENTICATED`** | **Confirma Hipótesis H1:** el borde Catalyst solo inyecta `x-zc-user-type=admin` cuando detecta cookies de sesión Zoho (operador/consola), mientras que en tráfico anónimo limpio inyecta `x-zc-admin-cred-*` + `x-zc-project-key` sin `x-zc-user-type=admin` (y la app rechaza limpio con `401`). | **No** prueba todavía que un atacante externo no pueda enviar manualmente `x-zc-user-type: admin` si Catalyst no lo sobrescribe. |
| **A = `403 CATALYST_ADMIN_HEADER_SPOOFED` y B = `403 CATALYST_ADMIN_HEADER_SPOOFED`** | **Confirma Hipótesis H2:** Catalyst Edge inyecta `x-zc-user-type=admin` por defecto en peticiones directas sin usuario final Catalyst (inclusive anónimas sin cookies). Demuestra también que el guardia actual bloquea tanto a consola como a anónimos antes de `401`, y confirma el riesgo de bloqueo sobre Camino 3 (`__Host-vigor_session`). | **No** prueba por sí solo si Catalyst sobrescribe una cabecera `x-zc-user-type` falsificada por un cliente externo, ni prueba funcionamiento con usuario final autenticado. |
| **B = `503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE`** | En peticiones sin cookies Zoho, la Function URL directa **no** recibe `x-zc-admin-cred-*` o `x-zc-project-key`, por lo que `HostedNativeCatalystAuthRuntime` falla cerrado antes del dispatcher *(explicando que en A solo se inyectaron gracias a las cookies Zoho)*. | **No** valida el comportamiento detrás de API Gateway ni el flujo de usuario final en `app.vigorcore.lat`. |

### Guía de ejecución manual limpia para Escenario B (Windows PowerShell 5.1, sin cookies)

```powershell
$url = 'https://project-rainfall-943998020.development.catalystserverless.com/server/vigor_api/api/v1/athlete/workspace'
try {
    $r = Invoke-WebRequest -Uri $url -Method Get -UseBasicParsing -ErrorAction Stop
    Write-Output ("UNEXPECTED_2XX={0}" -f $r.StatusCode)
}
catch [System.Net.WebException] {
    $resp = [System.Net.HttpWebResponse]$_.Exception.Response
    if ($null -eq $resp) { throw }
    $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $body = $sr.ReadToEnd()
    $sr.Dispose()
    Write-Output ("SCENARIO_B_STATUS={0}" -f [int]$resp.StatusCode)
    Write-Output $body
}
```

---

## 6. INVARIANTES DE SEGURIDAD Y PROPUESTA DE PROCEDENCIA VERIFICABLE

### 6.1 Invariantes preservados (sin cambios ni relajaciones en código productivo)

- No se elimina ni debilita `assertNoIdentitySpoofing()` ni la comprobación de `x-zc-user-type=admin`.
- Nunca se convierte una identidad administrativa de Zoho Console (`x-zc-user-type=admin`) en identidad de atleta/admin en `Users` ni se emite `__Host-vigor_session` desde ella.
- No se confía ciegamente en prefijos `x-zc-*`, no se exponen tokens ni cabeceras crudas, no se añaden endpoints diagnósticos ni escrituras NoSQL.

### 6.2 Estrategia de distinción basada en contexto verificable de plataforma (no solo nombre de cabecera)

Como la procedencia verificable de `x-zc-*` en la Function URL directa aún no está comprobada empíricamente (`HOSTED_VS_EXTERNAL_AUTH_ADR.residualLiveVerificationRequired.hostedHeaderOverwriteAndInjectionVerified = 'PENDING-LIVE-VERIFICATION'`), **se mantiene el comportamiento fail-closed actual** y se documentan las condiciones estrictas para una futura resolución segura:

1. **Verificar empíricamente sobrescritura de borde (`edge overwrite`):** confirmar si Catalyst sobrescribe/elimina incondicionalmente cualquier `x-zc-user-type`, `x-zc-admin-cred-*`, `x-zc-projectid`, `x-zc-environment` enviado por el cliente tanto en la Function URL como detrás del API Gateway.
2. **Acoplamiento a contexto verificable de plataforma (Gateway o `external_oauth`):**
   - Si el tráfico público se canaliza únicamente mediante **API Gateway** (donde el borde de plataforma garantiza el saneado y solo enruta invocaciones validadas) **o** si se opera en modo `external_oauth` (donde el backend no depende de `x-zc-admin-cred-*` de `req.headers`), un `x-zc-user-type=admin` de plataforma **sin** `x-zc-user-cred-token` ni `x-zc-cookie` representa únicamente **"ausencia de sesión de usuario final Catalyst"** (como modela `CatalystCredential`), **nunca** autenticación válida:
     - En rutas con `__Host-vigor_session` válido (Camino 3), solo se debe intentar cruce con Catalyst cuando exista evidencia explícita de usuario final (`x-zc-user-cred-token` o `x-zc-cookie`), evitando que una cabecera de plataforma por defecto anule cookies `__Host-vigor_session` válidas *(siempre que la sobrescritura del borde esté confirmada o la ruta no acepte elevación desde `x-zc-*`)*.
     - En ausencia de `__Host-vigor_session`, debe seguir rechazando fail-closed (`401 UNAUTHENTICATED` o `403 CATALYST_ADMIN_HEADER_SPOOFED`).
3. **Si la sobrescritura de borde en Function URL directa NO puede garantizarse por completo:** mantener rechazo `403` ante `x-zc-user-type=admin` y no exponer la Function URL directa como origen público de autenticación sin API Gateway / límite confiable.

---

## 7. VERIFICACIÓN LOCAL Y DICTAMEN

- Pruebas unitarias y de regresión ejecutadas localmente (`0` llamadas remotas, `0` escrituras NoSQL).
- Estado actualizado de la investigación:

**`PHASE_5_3_ADMIN_HEADER_PROVENANCE_UNDER_INVESTIGATION`**
