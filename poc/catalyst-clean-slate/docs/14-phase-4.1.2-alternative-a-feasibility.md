# VIGORCORE — FASE 4.1.2: VALIDACIÓN TÉCNICA DE ALTERNATIVA A (SLATE + CATALYST ADVANCED I/O CON DOMINIO PERSONALIZADO COMPARTIDO)

**Fecha:** 2026-11-14  
**Directorio aislado:** `poc/catalyst-clean-slate/`  
**Dictamen Final:** **`VIABLE CON CONDICIONES`** *(sujeto a confirmación oficial de soporte Zoho Catalyst y pruebas vivas `INT-06`/`INT-07`/`BR-01..BR-20` en cuenta real; ni aprobada para producción ni implementada)*  
**Estado de Infraestructura:** **0** archivos de código modificados, **0** cambios en el proyecto raíz, **0** paquetes instalados, **0** dominios comprados, **0** registros DNS/SSL creados, **0** tablas/índices/usuarios creados, **0** correos enviados a soporte Zoho, **0** operaciones remotas.

---

## 1. RESUMEN EJECUTIVO

El operador ha priorizado conservar **Zoho Catalyst Slate** (`https://fit-x-bhnatsxl.onslate.com`, React 19 + Vite + Tailwind, publicación desde GitHub), operar íntegramente sobre infraestructura administrada por Zoho (evitando proxies externos si existe una vía nativa viable), mantener intacta la cookie **`__Host-vigor_session`** (`HttpOnly; Secure; SameSite=Strict; Path=/`, sin `Domain=`), y evaluar si la **Alternativa A** (`https://app.<dominio-propio>` en Slate + `https://api.<dominio-propio>` en Catalyst Advanced I/O) puede implementarse de forma nativa en Zoho Catalyst.

### Conclusiones clave de la investigación y auditoría local
1. **Lado Frontend (`https://app.<dominio-propio>` en Catalyst Slate): `[VERIFICADO]` como compatible nativamente.** La documentación oficial de Catalyst Slate confirma el mapeo de un subdominio personalizado mediante registros CNAME + verificación por hash + SSL automático gratuito, manteniendo intactos el despliegue actual desde GitHub y la URL original `https://fit-x-bhnatsxl.onslate.com`.
2. **Lado Backend (`https://api.<dominio-propio>` en CloudScale Domain Mappings / API Gateway): `[VIABLE CON CONDICIONES — BLOQUEANTES SIN RESOLVER EN DOCUMENTACIÓN PÚBLICA]`.**
   - La documentación pública de **CloudScale Domain Mappings** describe el mapeo de subdominios personalizados (hasta 5 por aplicación, nunca dominio raíz/*apex*, solo en entorno **Production**) hacia la **URL de producción de la aplicación Catalyst** (`https://<project_domain_name>.catalystserverless.com`), remitiendo de manera recurrente al escenario de **Web Client Hosting** junto con rutas de funciones (`/server/<fn>/`) y API Gateway.
   - **No está demostrado públicamente** si CloudScale Domain Mapping permite exponer un proyecto **sin Web Client activo** (porque el frontend vive en Slate) o mapear `https://api.<dominio-propio>/api/v1/*` directamente a una función Advanced I/O sin el prefijo `/server/<function_name>/`, ni si la capa L7 de CloudScale / API Gateway preserva literalmente `Set-Cookie: __Host-vigor_session=...` (sin añadir `Domain=` ni alterarlo), `Origin` y `Sec-Fetch-Site`.
3. **Auditoría crítica del código y SDK local (`[VERIFICADO]` en `poc/catalyst-clean-slate/`):**
   - `HttpSecurityPolicy` y `CleanSlateAuthGuard` cumplen la mayoría de los controles CORS, CSRF (`Origin` + `Sec-Fetch-Site: same-site` permitido y `cross-site` rechazado), `Vary: Origin`, `OPTIONS` sin sesión y cookie host-only `__Host-vigor_session`.
   - **Dos hallazgos técnicos críticos detectados al auditar el código y `@zcatalyst/auth` / `@zcatalyst/auth-admin` instalados localmente:**
     1. **`CleanSlateAuthGuard.authenticate()` invoca `zcAuth.init(req)` -> `getCurrentUser()` en TODAS las peticiones protegidas** (no solo en `/bootstrap-profile` y `/exchange`). En una arquitectura de subdominios separados (`app.` vs `api.`), las cookies nativas de sesión de Catalyst Auth en `app.` no viajan automáticamente a `api.`, por lo que **todas** las peticiones protegidas dependerían de enviar un token cruzado (`catalyst.auth.generateAuthToken()`, válido 1 hora) en `Authorization` o de que la pasarela de Catalyst comparta/acepte el contexto de usuario.
     2. **`HttpSecurityPolicy.buildCorsHeaders()` actualmente declara `Access-Control-Allow-Headers: Content-Type, X-Vigor-CSRF` y NO incluye `Authorization`.** Si en Alternativa A el frontend envía el token de `generateAuthToken()` mediante la cabecera `Authorization`, los navegadores bloquearán el preflight `OPTIONS` hasta que se incorpore `Authorization` en `Access-Control-Allow-Headers` (en una fase futura autorizada de código).
4. **Dictamen final:** **`VIABLE CON CONDICIONES`**. Se debe enviar la consulta formal preparada a `support@zohocatalyst.com` (Sección 9) antes de comprar dominio o aprovisionar infraestructura; si Zoho no confirma mapeo directo y preservación íntegra de cabeceras/cookies, las arquitecturas de respaldo de la Sección 10 preservan intacto `SameSite=Strict`.

---

## 2. ARQUITECTURA OBJETIVO EVALUADA (ALTERNATIVA A)

| Componente | Tecnología | Origen Objetivo | Dominio Registrable (eTLD+1) | Flujo de Despliegue |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend (UI)** | Zoho Catalyst Slate (React 19 + Vite + Tailwind) | `https://app.<dominio-propio>` | `<dominio-propio>` | GitHub CI/CD actual; URL original `https://fit-x-bhnatsxl.onslate.com` permanece activa como URL por defecto |
| **Backend (API)** | Zoho Catalyst Advanced I/O (Express + `@zcatalyst/auth` + `@zcatalyst/nosql`) | `https://api.<dominio-propio>` | `<dominio-propio>` | Catalyst Functions (`NODE_ENV=production`), opcionalmente detrás de CloudScale Domain Mapping / API Gateway |
| **Relación en Navegador** | HTTPS -> HTTPS entre subdominios hermanos | `app.<dominio-propio>` -> `api.<dominio-propio>` | Idéntico (`<dominio-propio>`) | **`same-site`** + **`cross-origin`** |
| **Cookie de Sesión VigorCore** | HMAC-SHA256 + registro `SESSION#<sid>` en `SystemControl` | Emitida por `https://api.<dominio-propio>` | Host-only en `api.<dominio-propio>` | `__Host-vigor_session=<token>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200` (sin `Domain=`) |

---

## 3. EVIDENCIA OFICIAL CONSULTADA CON URLS

Todas las comprobaciones públicas corresponden a la documentación oficial de Zoho Catalyst consultada durante esta fase (14 de noviembre de 2026) y se contrastan además con el código fuente real instalado de `@zcatalyst/auth@1.0.0`, `@zcatalyst/auth-admin` y `@zcatalyst/utils` dentro de `poc/catalyst-clean-slate/node_modules/`:

1. **Catalyst Slate — Documentación y Domain Mapping:**
   - URL: `https://docs.catalyst.zoho.com/en/slate/help/` y sección *Domain Mapping* (`https://docs.catalyst.zoho.com/en/slate/help/domain-mapping/`).
   - Evidencia confirmada: Permite asociar un dominio personalizado propio a una aplicación Slate desde *Deployment Overview -> Domain Mapping -> Add Domain* mediante registros DNS CNAME (incluyendo registro CNAME con clave hash de verificación) y aprovisiona SSL automático sin coste adicional. Admite **un dominio único por aplicación Slate**; la URL de acceso por defecto de Slate (`*.onslate.com`) permanece activa tras mapear el dominio personalizado. Exige que el dominio ya esté activo y usa subdominios (sin soporte directo para dominio raíz/*apex*).
2. **Catalyst CloudScale — Domain Mappings:**
   - URL: `https://docs.catalyst.zoho.com/en/cloud-scale/help/domain-mappings/introduction/` (y sección *Domain Mappings* en `docs.catalyst.zoho.com/en/cloud-scale/help/domain-mappings/`).
   - Evidencia confirmada:
     - Mapea un subdominio personalizado (p. ej., `portal.zylker.com`) a la **Production URL** del proyecto Catalyst (`https://<project_domain_name>.catalystserverless.com`), **no** en entorno `Development`.
     - **Restricción expresa de dominio base:** No soporta dominios raíz/*apex* (p. ej., `zylker.com`); exige subdominio (`app.`, `api.`, `www.`).
     - **Registros DNS requeridos:** Dos registros CNAME en el proveedor DNS: (1) subdominio -> `catalyst.cs.zohohost.com` (o host regional aplicable en el centro de datos) y (2) CNAME adicional con hash único generado en consola (`<hash_key>.<subdominio>`) para verificar propiedad.
     - **SSL:** Provee certificado **Group SSL gratuito** con renovación automática (Catalyst exige usar su certificado gestionado para completar el mapeo, incluso si el cliente ya tuviera un certificado externo).
     - **Límites:** Hasta **5 dominios** por aplicación Catalyst; cada dominio único solo puede asociarse a una aplicación a la vez; las URLs por defecto de producción/desarrollo siguen activas; el mapeo solo puede deshabilitarse desde el entorno **Production**.
     - **Coste:** Componente **gratuito** en Catalyst según documentación de precios.
3. **Catalyst CloudScale — API Gateway:**
   - URL: `https://docs.catalyst.zoho.com/en/cloud-scale/help/api-gateway/introduction/` (y subsecciones en `docs.catalyst.zoho.com/en/cloud-scale/help/api-gateway/`).
   - Evidencia confirmada:
     - Capa proxy inversa gestionada frente a componentes destino (**Basic I/O Functions**, **Advanced I/O Functions** y **Web Client** — **no** enumera *Slate* como componente destino).
     - Permite definir rutas REST personalizadas (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `ANY`), throttling general y por IP (`429 Too Many Requests`), API Keys, OAuth y autenticación Catalyst User, con límite de hasta **1,000 APIs** por proyecto.
     - Una vez configurado Domain Mapping en el proyecto, los endpoints del proyecto/API Gateway pueden invocarse bajo el dominio mapeado, manteniendo las funciones subyacentes su **timeout máximo de 30 segundos** para Advanced I/O.
     - **Coste:** Free tier de **100,000 peticiones/mes**; excedente a **US$0.000001 por petición** (con mínimo mensual de **US$5.00/proyecto** cuando un proyecto excede la capa gratuita y genera facturación).
4. **Catalyst Serverless — Advanced I/O Functions:**
   - URL: `https://docs.catalyst.zoho.com/en/serverless/help/functions/` (documentación de Advanced I/O y endpoints).
   - Evidencia confirmada: Formato de URL de producción por defecto `https://<project_domain_name>.catalystserverless.com/server/<function_name>/`; soporte nativo de Node.js/Express para peticiones y respuestas HTTP completas; timeout máximo de **30 segundos**.
5. **Catalyst CloudScale Authentication — Cross-Domain Access, Authorized Domains y `generateAuthToken()`:**
   - URL: `https://docs.catalyst.zoho.com/en/cloud-scale/help/authentication/` (secciones *Cross-Domain Access* y *Authorized Domains / CORS*).
   - Evidencia confirmada:
     - Exige estar en el **mismo proyecto Catalyst** y registrar tanto el dominio frontend como el backend en **CloudScale -> Authentication -> Whitelisting -> Authorized Domains** habilitando **CORS**.
     - Documenta `catalyst.auth.generateAuthToken()` (Web SDK `>= v4.6.1`, token válido 1 hora / `3600s` por defecto) enviándolo en la cabecera HTTP `Authorization` para invocar funciones desde un dominio distinto.
6. **Catalyst Precios Oficiales (Slate, Domain Mapping, API Gateway):**
   - URL: `https://catalyst.zoho.com/pricing.html`.
   - Evidencia confirmada: Domain Mapping gratuito con Group SSL; API Gateway 100k req/mes gratis y $0.000001/req adicional; Slate con 12 GB-min build/mes, 500 MB CDN, 300k CDN/Origin req/mes y ancho de banda gratuito; mínimo de $5/proyecto cuando supera free tier.
7. **Evidencia SDK local inspeccionada (`poc/catalyst-clean-slate/node_modules/`):**
   - `@zcatalyst/auth/dist-es/web.js` y `internal/token-manager.js`: `generateAuthToken('functions')` consulta `/authentication/custom-token` (con credenciales del usuario en Catalyst Auth), intercambia el JWT en `IAM_DOMAIN/clientoauth/v2/{zaid}/remote/auth` enviando `Origin: window.location.origin`, y devuelve `{ access_token, expires_in_sec }`.
   - `@zcatalyst/auth-admin/dist-es/index.js`, `credential.js` y `@zcatalyst/utils/dist-es/constants.js`: `zcAuth.init(req)` (`INIT_TYPE.advancedio`) exige cabeceras inyectadas por la infraestructura de Catalyst (`x-zc-projectid`, `x-zc-admin-cred-type`, `x-zc-admin-cred-token`, `x-zc-user-type`) y extrae la identidad del usuario bien desde `x-zc-user-cred-type` + `x-zc-user-cred-token` (token/ticket) o bien desde `x-zc-cookie` (reenvío de cookies Zoho/Catalyst + `ZD_CSRF_TOKEN`).

---

## 4. AUDITORÍA DE LOS CONTRATOS DEL CÓDIGO (`poc/catalyst-clean-slate/`)

Se inspeccionaron en modo estricto de solo lectura: `src/security/httpSecurityPolicy.ts`, `src/auth/cleanSlateAuthGuard.ts`, `src/routes/apiRouterSchema.ts`, `tests/05-static-isolation-and-clean-slate.test.ts`, `tests/06-integration-catalyst-live.spec.ts`, `tests/07-session-lifecycle-and-http-security.test.ts` y la documentación `docs/04`, `09`, `10`, `11`, `13`.

| # | Requisito Auditado | Estado | Evidencia Exacta en Código | Observación / Condición para Alternativa A |
| :-: | :--- | :---: | :--- | :--- |
| **1** | **CORS acepta exclusivamente el origen frontend elegido** | **PASA (configurable)** | `HttpSecurityPolicy` (`src/security/httpSecurityPolicy.ts:20,67-119`): recibe `allowedOrigins` y compara origen canónico exacto (`extractCanonicalOrigin`). | `DEFAULT_ALLOWED_ORIGINS` sigue siendo `['https://fit-x-bhnatsxl.onslate.com']`. En despliegue con Alternativa A deberá instanciarse explícitamente con `allowedOrigins: ['https://app.<dominio-propio>']`. |
| **2** | **Credenciales habilitadas (`Access-Control-Allow-Credentials`)** | **PASA** | `buildCorsHeaders()` (`httpSecurityPolicy.ts:115`) emite `'Access-Control-Allow-Credentials': 'true'` cuando `Origin` está en la allowlist. | Requiere que el frontend llame con `fetch(..., { credentials: 'include' })` en todas las rutas `/api/v1/*`. |
| **3** | **`Access-Control-Allow-Origin` nunca es `*` con credenciales** | **PASA** | Constructor (`httpSecurityPolicy.ts:74-76`) lanza `INVALID_CORS_CONFIG` ante `'*'`; línea `114` refleja exactamente el origen validado `canonical`. Verificado en `tests/05` y `tests/07`. | Si Zoho API Gateway gestiona CORS automáticamente delante de Advanced I/O, debe verificarse que el gateway no emita `*` ni sobrescriba la reflexión exacta. |
| **4** | **Inclusión de `Vary: Origin`** | **PASA** | `buildCorsHeaders()` (`httpSecurityPolicy.ts:101,118`) y `CleanSlateApiDispatcher.dispatch()` (`apiRouterSchema.ts:94,325`) emiten siempre `Vary: 'Origin'`. | Protege contra envenenamiento de cachés intermedias entre orígenes. |
| **5** | **`OPTIONS` funciona sin autenticación de sesión** | **PASA CON BRECHA PARA AUTH CRUZADA** | `apiRouterSchema.ts:96-104`: valida `assertCsrfAndOriginForRequest('OPTIONS', req)` (no exige sesión) y retorna HTTP `204` inmediatamente con `corsHeaders`. Orígenes no permitidos reciben `403 CORS_ORIGIN_REJECTED`. | **Hallazgo crítico:** `httpSecurityPolicy.ts:117` fija `'Access-Control-Allow-Headers': 'Content-Type, X-Vigor-CSRF'`. **Falta `'Authorization'`** si Alternativa A requiere enviar el token de `generateAuthToken()` en `Authorization` durante el preflight `OPTIONS`. Además, debe comprobarse si Catalyst/API Gateway intercepta `OPTIONS` antes del contenedor Express. |
| **6** | **CSRF acepta origen exacto y no confunde *same-site* con *same-origin*** | **PASA** | `httpSecurityPolicy.ts:89-92,157-178`: en `POST/PUT/PATCH/DELETE`, compara `Origin` (o `Referer`) contra `this.allowedOriginSet` (`Set` de orígenes exactos `scheme://host[:port]`). | Un subdominio hermano no autorizado (`https://evil.<dominio-propio>`) aunque envíe `Sec-Fetch-Site: same-site` es rechazado con `403 CORS_ORIGIN_REJECTED` / `403 CSRF_ORIGIN_REJECTED`. |
| **7** | **`Sec-Fetch-Site: same-site` no es rechazado incorrectamente** | **PASA (en código; sin caso dedicado en `tests/07`)** | `httpSecurityPolicy.ts:140-153`: rechaza `'cross-site'` (`403 CSRF_CROSS_SITE_REJECTED`) y permite explícitamente `'same-origin'`, `'same-site'` y `'none'`. | **Nota de cobertura:** `tests/07` verifica rechazo de `'cross-site'` y evalúa `evaluateBrowserCookieCompatibility('https://app.vigorcore.example', 'https://api.vigorcore.example')`, pero aún no incluye un caso de `api.dispatch('POST', ..., { headers: { origin: 'https://app.vigorcore.example', 'sec-fetch-site': 'same-site' } })`. |
| **8** | **Rechazo de solicitudes no autorizadas** | **PASA** | `403 CORS_ORIGIN_REJECTED`, `403 CSRF_ORIGIN_REQUIRED`, `403 CSRF_CROSS_SITE_REJECTED`, `403 CSRF_ORIGIN_REJECTED`, `403 IDENTITY_SPOOFING_REJECTED`, `401 UNAUTHENTICATED`, `401 SIGNED_SESSION_REQUIRED`, `403 USER_PROFILE_NOT_REGISTERED`. | Toda ruta protegida exige identidad Catalyst + registro `Users` (`consistent_read: true`) + `__Host-vigor_session` válido cuando `requireSignedSession: true`. |
| **9** | **Cookie host-only sin atributo `Domain`** | **PASA** | `cleanSlateAuthGuard.ts:50,290-296` y `httpSecurityPolicy.ts:187-210`: nombre `__Host-vigor_session`, atributos `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=...` sin `Domain=`. `assertStrictCookieAttributes()` falla si aparece `Domain=` o falta cualquier atributo. | El host de emisión y almacenamiento es exclusivamente `api.<dominio-propio>`; el frontend en `app.<dominio-propio>` nunca puede leer ni sobrescribir la cookie vía JS. |
| **10** | **`Set-Cookie` llega íntegro al navegador** | **PARCIAL (`[VERIFICADO]` en dispatcher / `[NO VERIFICADO]` en red Zoho)** | `apiRouterSchema.ts:108,112,120,123,135,138,150,153` ejecuta `assertStrictCookieAttributes()` y coloca `Set-Cookie` en `EndpointResponse.headers`. | **Pendiente en vivo:** (a) aún no existe el adaptador HTTP Express real que conecte `CleanSlateApiDispatcher` con Advanced I/O (`res.setHeader`), y (b) está `[NO VERIFICADO]` que CloudScale Domain Mapping / API Gateway no modifiquen ni filtren `Set-Cookie`. |
| **11** | **Coherencia de login, logout, refresh y revocación individual/global** | **PASA EN LÓGICA / RIESGO DE ARQUITECTURA EN ALT. A** | `cleanSlateAuthGuard.ts:545-1084`: `issueSignedSession()` persiste `SESSION#<sid>` antes de emitir cookie; `/refresh` revoca `oldSid` con recuperación por `consistent_read: true` ante timeout; `/logout` revoca `sid` antes de emitir `Max-Age=0`; `/revoke` soporta `scope: 'individual'` (`SESSION#<sid>`) y `scope: 'all'` (`Users.sessionEpoch++`). | **Hallazgo crítico en `authenticate()` (`cleanSlateAuthGuard.ts:616-621`):** `authenticate()` llama **siempre** a `resolveVerifiedCatalystIdentity(req)` (`zcAuth.init(req)`) en **todas** las rutas (`/me`, `/workspace`, `/refresh`, `/logout`, `/revoke`, `/admin/*`), no solo en `/bootstrap-profile` y `/exchange`. En Alternativa A, si `zcAuth` no recibe cookies en `api.` sino un token de 1h (`generateAuthToken()`), cada petición tras el login seguirá requiriendo dicho token vigente además de `__Host-vigor_session`. |
| **12** | **Cero confianza en cabeceras manipulables por el cliente** | **PASA** | `assertNoIdentitySpoofing()` (`cleanSlateAuthGuard.ts:447-520`) rechaza `x-vigor-session-epoch`, `x-vigor-role-version`, `x-user-*`, `x-auth-*`, `x-actor-*`, `x-role-*`, `uid`, `userId`, `role`, `roleVersion`, `sessionEpoch`, `accountStatus` en headers/query/body (`403 IDENTITY_SPOOFING_REJECTED`). | Permite `Authorization`, `Cookie`, `Origin`, `Referer`, `Sec-Fetch-Site` y `X-Vigor-CSRF`. En despliegue nativo Advanced I/O debe asumirse/verificarse que el gateway de Catalyst sobrescribe/sanitiza cabeceras internas `x-zc-*` y no acepta `x-zc-*` enviadas directamente desde Internet. |

---

## 5. MATRIZ `VERIFICADO` / `NO VERIFICADO` / `NO COMPATIBLE`

| Elemento / Afirmación Técnica | Clasificación | Detalle de Evidencia o Condición |
| :--- | :---: | :--- |
| URL actual de Slate `https://fit-x-bhnatsxl.onslate.com` pertenece a `onslate.com` (`cross-site` frente a `catalystserverless.com`) | **`[VERIFICADO]`** | `httpSecurityPolicy.ts`, `tests/07`, `docs/11` y `docs/13`. |
| Slate permite mapear un subdominio personalizado (`app.<dominio-propio>`) mediante CNAME + SSL automático gratuito manteniendo activa la URL original y GitHub CI/CD | **`[VERIFICADO]`** | Documentación oficial de Catalyst Slate (*Domain Mapping*): 1 dominio único por app Slate; URL por defecto sigue activa. |
| CloudScale Domain Mappings admite hasta 5 subdominios por aplicación con 2 registros CNAME (`catalyst.cs.zohohost.com` + CNAME hash) y Group SSL gratuito | **`[VERIFICADO]`** | Documentación oficial de Catalyst CloudScale (*Domain Mappings*). |
| CloudScale Domain Mappings **NO** soporta dominios base/*apex* (`<dominio-propio>` sin subdominio) ni se gestiona como entorno `Development` | **`[NO COMPATIBLE]`** | Documentación oficial exige subdominio (`app.`, `api.`) y especifica mapeo sobre la URL de **Production** (deshabilitable solo desde Production). |
| CloudScale Domain Mappings requiere Web Client Hosting o funciona en proyecto API-only (Advanced I/O) con UI separada en Slate | **`[NO VERIFICADO]`** | La documentación pública remite repetidamente a la Production URL / Web Client Hosting; requiere confirmación escrita de soporte Zoho (`support@zohocatalyst.com`) o prueba en cuenta real. |
| Posibilidad de mapear `https://api.<dominio-propio>` directamente a `/server/<function_name>/` (sin prefijo `/server/<fn>/` en la URL pública) vía Domain Mapping o API Gateway | **`[NO VERIFICADO]`** | Docs de Domain Mapping apuntan a la URL base de producción del proyecto; docs de API Gateway permiten rutas personalizadas pero no confirman explícitamente si `api.<dominio-propio>/api/v1/*` evita `/server/<fn>/` sin Web Client. |
| Asignación independiente de `app.<dominio-propio>` (Slate) y `api.<dominio-propio>` (CloudScale/API Gateway) dentro del mismo proyecto Catalyst y en el plan comercial actual | **`[NO VERIFICADO]`** | Docs separan Slate Domain Mapping y CloudScale Domain Mapping; la coexistencia simultánea en un mismo proyecto/plan requiere confirmación de soporte y prueba real. |
| Preservación íntegra de `Set-Cookie: __Host-vigor_session=...; HttpOnly; Secure; SameSite=Strict; Path=/` (sin `Domain=`) a través de CloudScale Domain Mapping y/o API Gateway | **`[NO VERIFICADO]`** | Ninguna página pública de Catalyst garantiza explícitamente paso literal sin reescritura de cookies `__Host-*` a través de API Gateway / CloudScale. |
| Preservación literal de `Origin`, `Referer`, `Sec-Fetch-Site`, `Cookie` y paso de preflight `OPTIONS` hasta Advanced I/O a través de CloudScale / API Gateway | **`[NO VERIFICADO]`** | API Gateway actúa como proxy L7 gestionado con sus propias reglas CORS/Auth; requiere verificación en vivo (`INT-06`). |
| Envío efectivo de `__Host-vigor_session` (`SameSite=Strict`) entre `app.<dominio-propio>` y `api.<dominio-propio>` bajo `fetch(..., { credentials: 'include' })` en Safari/WebKit ITP, Chromium y Firefox reales | **`[NO VERIFICADO]`** | Aunque RFC 6265bis lo permite por ser *same-site*, Safari/WebKit aplica políticas ITP sobre subdominios con CNAME externos distintos. Pendiente `INT-07` / `BR-01..BR-20`. |
| Degradación de `SameSite=Strict` a `SameSite=None` o uso de `Access-Control-Allow-Origin: *` con credenciales | **`[NO COMPATIBLE]`** | Prohibido por política de seguridad VigorCore y rechazado por pruebas estáticas (`tests/05`, `tests/07`) y navegadores con credenciales. |
| Invocación directa desde `https://fit-x-bhnatsxl.onslate.com` hacia `https://<project>.catalystserverless.com` con `SameSite=Strict` | **`[NO COMPATIBLE]`** | Relación *cross-site* (`onslate.com` != `catalystserverless.com`); navegadores omiten la cookie `SameSite=Strict`. |
| Uso de API Gateway apuntando a Catalyst Slate como *Target Component* bajo un único host | **`[NO VERIFICADO]` / `[NO COMPATIBLE según docs actuales]`** | Documentación pública de API Gateway enumera exclusivamente *Basic I/O*, *Advanced I/O* y *Web Client*, sin listar *Slate*. |

---

## 6. ANÁLISIS DE COOKIES, CORS, CSRF Y MATRIZ CONCEPTUAL POR NAVEGADOR

### 6.1 Semántica HTTP en Alternativa A (`https://app.<dominio>` -> `https://api.<dominio>`)
- **Esquema y eTLD+1:** ambos usan `https://` y comparten `<dominio-propio>` -> **`same-site`** según RFC 6265bis y `evaluateBrowserCookieCompatibility()` (`httpSecurityPolicy.ts:297-315`).
- **Origen distinto:** `https://app.<dominio>` != `https://api.<dominio>` -> **toda petición `fetch()` es *cross-origin***.
- **Naturaleza de `__Host-vigor_session`:**
  - Emitida por `https://api.<dominio>` con `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200` y **sin `Domain=`**.
  - El prefijo `__Host-` vincula la cookie únicamente al origen exacto `api.<dominio>`. La UI en `app.<dominio>` no puede leerla (`HttpOnly` + distinto host) ni reescribirla.
  - Para que el navegador almacene el `Set-Cookie` de la respuesta CORS y envíe la cookie en peticiones posteriores, el cliente JS **debe** pasar `{ credentials: 'include' }` en **todas** las llamadas `fetch()` (tanto login/exchange como consultas, refresh y logout).
- **Por qué `SameSite=Strict` NO sustituye la defensa CSRF en Alternativa A:**
  - En una topología *same-site*, otros subdominios bajo `<dominio-propio>` (p. ej., un subdominio de pruebas, documentación o tercero comprometido en `*.<dominio-propio>`) también son *same-site* y sus peticiones `fetch` podrían adjuntar cookies `SameSite=Strict` hacia `api.<dominio-propio>`.
  - Por ello es obligatoria la triple validación de `HttpSecurityPolicy`: (1) `Origin` estricto igual a `https://app.<dominio-propio>`, (2) `Sec-Fetch-Site` distinto de `cross-site` (aceptando `same-site` / `same-origin`), y (3) `Access-Control-Allow-Origin` reflejado únicamente para `https://app.<dominio-propio>` con `Access-Control-Allow-Credentials: true`.

### 6.2 Matriz Conceptual por Navegador (SIN declarar pruebas reales ejecutadas)

> **Advertencia obligatoria:** Ninguna de estas filas representa una prueba ejecutada en navegador real. Todas permanecen en **`PENDING (PASS-INTEGRATION)`** hasta ejecutar `INT-06`, `INT-07` y `BR-01..BR-20`.

| Dimensión Evaluada | Chromium (Chrome/Edge) — Comportamiento Esperado | Safari / WebKit — Comportamiento Esperado y Riesgos | Firefox — Comportamiento Esperado |
| :--- | :--- | :--- | :--- |
| **1. Solicitud cross-origin same-site** | Clasifica `app.<dom>` -> `api.<dom>` como `same-site` y aplica CORS. | Clasifica como `same-site`, pero ITP inspecciona destinos CNAME externos distintos (`Slate` vs `catalyst.cs.zohohost.com`). | Clasifica como `same-site`; Total Cookie Protection particiona por sitio (eTLD+1 `<dominio-propio>`), por lo que comparten partición de sitio. |
| **2. Cookie `SameSite=Strict`** | Envía cookie `__Host-` en subrecursos `fetch` iniciados desde `app.<dom>` hacia `api.<dom>` (mismo eTLD+1). | **Riesgo principal (`[NO VERIFICADO]`):** WebKit ITP puede aplicar restricciones de vida (7 días para cookies creadas vía respuesta subrecurso sin navegación top-level a `api.`) o bloquear almacenamiento si clasifica el CNAME de `api.` como rastreador/tercero encubierto (*CNAME cloaking*). | Envía cookies `SameSite=Strict` en `fetch` *same-site* con `credentials: 'include'`. |
| **3. `credentials: 'include'`** | Indispensable para almacenar y enviar cookies entre `app.` y `api.`. | Indispensable; sin `credentials: 'include'`, WebKit ignora `Set-Cookie` y no adjunta `__Host-vigor_session`. | Indispensable para envío y recepción cross-origin. |
| **4. `Set-Cookie` en respuesta CORS** | Acepta `Set-Cookie` si `Access-Control-Allow-Origin` es exacto y `Allow-Credentials: true`, cumpliendo `__Host-` (`Secure`, `Path=/`, sin `Domain=`). | Igual en especificación, sujeto a las políticas ITP y a que ningún proxy Zoho añada `Domain=` ni degrade atributos. | Aplica estrictamente validación `__Host-`; rechaza silenciosamente si aparece `Domain=` o `Path` != `/`. |
| **5. `OPTIONS` y preflight** | Ejecuta `OPTIONS` en `POST`/`PUT`/`PATCH`/`DELETE`, `application/json` o presencia de cabecera `Authorization`/`X-Vigor-CSRF`. Exige HTTP `2xx` sin redirección y cabecera `Access-Control-Allow-Headers` coincidente. | Muy estricto ante redirecciones HTTP en `OPTIONS` y coincidencia exacta de `Access-Control-Allow-Headers` (bloqueará si falta `Authorization`). | Cachea preflight solo si se envía `Access-Control-Max-Age`; de lo contrario repite `OPTIONS` en cada petición. |
| **6. `Origin` y `Sec-Fetch-Site`** | Envía `Origin: https://app.<dom>` y `Sec-Fetch-Site: same-site`. | Safari moderno (16.4+) envía `Sec-Fetch-Site: same-site` y `Origin: https://app.<dom>`. | Envía `Origin: https://app.<dom>` y `Sec-Fetch-Site: same-site`. |
| **7. Inicio de sesión y persistencia** | `/bootstrap-profile` y `/exchange` guardan `__Host-vigor_session` en jar de `api.<dom>` si Catalyst Auth entrega identidad válida. | Si ITP limita cookies en subdominios API sin navegación de primer nivel, la sesión podría caducar antes de 12h o requerir re-exchange (`[NO VERIFICADO]`). | Persistente hasta `Max-Age=43200` (12h) salvo limpieza de cookies. |
| **8. Logout individual** | `POST /session/logout` con `credentials: 'include'` revoca `SESSION#<sid>` y recibe `Max-Age=0`. | Igual, siempre que `Set-Cookie` de borrado llegue íntegro tras CORS. | Igual. |
| **9. Revocación global** | `POST /session/revoke { scope: 'all' }` incrementa `Users.sessionEpoch`; cualquier navegador con cookie antigua falla `401` al siguiente request. | Idem (validación autoritativa en servidor). | Idem (validación autoritativa en servidor). |
| **10. Refresh (`/session/refresh`)** | Envía cookie actual, revoca `oldSid`, recibe nueva `__Host-vigor_session` vía `Set-Cookie`. | Depende de aceptación continua de `Set-Cookie` en respuesta CORS en WebKit. | Igual que Chromium. |
| **11. Prevención de CSRF** | Bloqueado por `Origin` allowlist + `Sec-Fetch-Site` + `Access-Control-Allow-Origin` exacto. | Idem. | Idem. |

---

## 7. COMPATIBILIDAD CON CATALYST AUTHENTICATION (`generateAuthToken()` Y `zcAuth.init(req)`)

El análisis combinado de `docs.catalyst.zoho.com`, `src/auth/cleanSlateAuthGuard.ts` y los paquetes reales `@zcatalyst/auth@1.0.0` / `@zcatalyst/auth-admin` revela una interacción fundamental:

1. **Cómo funciona `zcAuth.init(req)` en Advanced I/O (`@zcatalyst/auth-admin/dist-es/index.js` y `credential.js`):**
   - `zcAuth.init(req)` lee cabeceras inyectadas por la plataforma Catalyst en el entorno Advanced I/O (`x-zc-projectid`, `x-zc-admin-cred-*`, `x-zc-user-type`) y obtiene la credencial del usuario final desde **`x-zc-user-cred-type` + `x-zc-user-cred-token`** (cuando llega un token de usuario válido) o **`x-zc-cookie`** (cuando la petición incluye cookies de sesión Catalyst en el mismo dominio).
2. **Por qué en Alternativa A NO basta enviar cookies de Catalyst Auth desde `app.` a `api.`:**
   - Al alojar el frontend en `https://app.<dominio-propio>` (Slate) y el backend en `https://api.<dominio-propio>` (Advanced I/O), cualquier cookie host-only emitida por Catalyst Auth bajo `app.<dominio-propio>` **no es enviada por el navegador hacia `api.<dominio-propio>`**.
   - Por eso la documentación oficial de **Cross-Domain Access** en Catalyst obliga a:
     1. Registrar `https://app.<dominio-propio>` y `https://api.<dominio-propio>` en **CloudScale -> Authentication -> Whitelisting -> Authorized Domains** con **CORS** habilitado.
     2. Invocar en el navegador `catalyst.auth.generateAuthToken('functions')` (Web SDK `>= v4.6.1`, que intercambia `/authentication/custom-token` contra `IAM_DOMAIN/clientoauth/v2/{zaid}/remote/auth` y emite un `access_token` de **1 hora / 3600s**).
     3. Adjuntar ese token en la cabecera `Authorization` de las peticiones `fetch` hacia `api.<dominio-propio>`.
3. **Coexistencia con las sesiones HMAC `__Host-vigor_session` de VigorCore (`cleanSlateAuthGuard.ts`):**
   - **No debe sustituirse `__Host-vigor_session` ni `SESSION#<sid>`** porque:
     - `generateAuthToken()` entrega un token en memoria JS (accesible a XSS si se usara solo) sin revocación instantánea individual por `SESSION#<sid>` ni control de `sessionEpoch` en `SystemControl`.
     - `__Host-vigor_session` (`HttpOnly; SameSite=Strict`) aporta cierre de sesión real, revocación por dispositivo (`SESSION#<sid>`), revocación global (`sessionEpoch`), rotación `/refresh` y protección contra XSS (`document.cookie`).
   - **Implicación arquitectónica detectada en `cleanSlateAuthGuard.ts:616-621`:**
     - Actualmente `CleanSlateAuthGuard.authenticate()` llama **incondicionalmente** a `resolveVerifiedCatalystIdentity(req)` (`zcAuth.init(req)`) en **todas** las rutas (`/me`, `/workspace`, `/refresh`, `/logout`, `/revoke`, `/admin/*`), no únicamente en `/bootstrap-profile` y `/exchange`.
     - Consecuencias en Alternativa A:
       - **(a) CORS `Access-Control-Allow-Headers`:** Si el frontend envía `Authorization: <access_token>` en cualquier llamada hacia `api.<dominio-propio>`, `HttpSecurityPolicy` deberá incluir `Authorization` en `Access-Control-Allow-Headers` (actualmente solo tiene `Content-Type, X-Vigor-CSRF`).
       - **(b) Caducidad de 1 hora de `generateAuthToken()`:** El cliente frontend necesitaría refrescar en memoria el token de `generateAuthToken()` cada ~50–55 minutos mientras la sesión de 12h de `__Host-vigor_session` siga activa (o bien el operador tendría que evaluar explícitamente en una fase futura si tras `/exchange` la verificación de rutas protegidas confía en `__Host-vigor_session` + `Users` + `SESSION#<sid>` o mantiene ambas capas activas; **no se propone cambiar esto sin justificación técnica y aprobación explícita**).
       - **(c) Requisitos extra de Catalyst Auth:** Además de `HttpSecurityPolicy` en Express, Catalyst exige configurar **Authorized Domains (CORS)** en la consola de Authentication y añadir las URLs de redirección OAuth/signin de `https://app.<dominio-propio>` (para login con Google/Email en Slate bajo el nuevo dominio).

---

## 8. DICTAMEN EXPRESO SOBRE EL MAPEO DE ADVANCED I/O Y LA LIMITACIÓN DE WEB CLIENT

Resolviendo expresamente la posible limitación señalada por el operador:

1. **¿Admite Catalyst CloudScale Domain Mappings directamente `api.<dominio-propio>` hacia Advanced I/O?**
   - **Parcialmente confirmado en documentación, pero NO verificado sin restricciones para arquitectura desacoplada con Slate.**
   - La documentación oficial indica que CloudScale Domain Mappings mapea un subdominio personalizado (`catalyst.cs.zohohost.com`) a la **Production URL** del proyecto (`https://<project_domain>.catalystserverless.com`), mencionando habitualmente el *Web Client* junto con funciones serverless y API Gateway.
   - **Limitaciones e incógnitas sin resolver en la documentación pública:**
     1. **Dependencia de Web Client Hosting (`[NO VERIFICADO]`):** No existe confirmación explícita de que CloudScale Domain Mapping pueda activarse y enrutar tráfico en un proyecto Catalyst donde el frontend NO usa Web Client Hosting sino Catalyst Slate.
     2. **Formato de ruta de Advanced I/O (`[NO VERIFICADO]`):** Mapear la raíz del proyecto a `api.<dominio-propio>` expone por defecto `/server/<function_name>/...` (ej. `https://api.<dominio-propio>/server/<fn>/api/v1/...`), **no** necesariamente `/api/v1/...` limpio en la raíz, salvo que **API Gateway** traduzca `/api/v1/*` -> Advanced I/O bajo ese dominio mapeado.
     3. **Integridad HTTP a través de CloudScale / API Gateway (`[NO VERIFICADO]`):** No está documentado si CloudScale / API Gateway preserva sin alteración la cabecera `Set-Cookie: __Host-vigor_session=...` (sin añadir `Domain=`), ni si reenvía intactos `Origin`, `Sec-Fetch-Site` y preflights `OPTIONS`.
     4. **Entorno `Development` vs `Production` (`[VERIFICADO como limitación]`):** CloudScale Domain Mappings solo opera en entorno **Production**, lo que impide probar exactamente el mismo esquema de dominio personalizado en un entorno Catalyst `Development` separado del mismo proyecto.
2. **Conclusión sobre Alternativa A:**
   - **No se puede certificar como `VIABLE` sin condiciones hoy.** Es **`VIABLE CON CONDICIONES`** pendientes de respuesta oficial de soporte Zoho Catalyst (`support@zohocatalyst.com`) y de verificación empírica en cuenta real.

---

## 9. CONSULTA FORMAL PARA SOPORTE DE ZOHO (`support@zohocatalyst.com`)

> **Estado:** **NO ENVIADA.** Preparada literalmente para revisión, copia y envío autorizado por el operador.

```text
To: support@zohocatalyst.com
Subject: Technical Inquiry: CloudScale Domain Mapping / API Gateway with Catalyst Slate, Advanced I/O, Custom Subdomains & __Host- Cookies

Hello Zoho Catalyst Support Team,

We are designing a production architecture in Zoho Catalyst with a React/Vite frontend hosted on Catalyst Slate and a Node.js/Express backend running on Catalyst Advanced I/O Functions within the same Catalyst project.

Our goal is to serve the Slate frontend on `https://app.<our-domain>` (via Slate Domain Mapping) and expose our Advanced I/O Express API on `https://api.<our-domain>` (under the same registrable domain) using strict first-party cookies (`__Host-vigor_session` with `HttpOnly; Secure; SameSite=Strict; Path=/` and no `Domain` attribute).

Before purchasing/configuring domains or provisioning production resources, could you please confirm the following 7 technical questions?

1. Does Catalyst CloudScale Domain Mapping support mapping a custom hostname (e.g., `api.<our-domain>`) directly to a Catalyst Advanced I/O Function endpoint, such as `/server/<function_name>/`, or to an API Gateway route—even when the frontend is hosted on Catalyst Slate rather than Catalyst Web Client Hosting?
2. If not directly supported, is there an officially supported way within Zoho Catalyst (without an external third-party reverse proxy) to expose an Advanced I/O Function through a custom subdomain (`api.<our-domain>`) under the same registrable domain used by a Catalyst Slate application (`app.<our-domain>`)?
3. Are `Set-Cookie` response headers—specifically host-only `__Host-` prefixed cookies with `HttpOnly; Secure; SameSite=Strict; Path=/` and NO `Domain` attribute—preserved verbatim without rewriting, stripping, or injecting a `Domain` attribute through CloudScale Domain Mapping and/or Catalyst API Gateway?
4. Does CloudScale Domain Mapping (and/or Catalyst API Gateway) preserve and forward the original client `Host`, `Origin`, `Referer`, `Cookie`, and `Sec-Fetch-Site` headers and pass CORS `OPTIONS` preflight requests intact to the Advanced I/O Express handler?
5. Can a custom domain be assigned independently to a Catalyst Slate application (`app.<our-domain>`) and to an Advanced I/O / API Gateway endpoint (`api.<our-domain>`) within the same Catalyst project?
6. What are the exact DNS (CNAME records, verification hashes, apex/subdomain rules) and SSL certificate requirements (Group SSL vs custom certificates, renewal behavior) for both mappings?
7. Are there any additional charges, subscription tier requirements, environment restrictions (e.g., Production vs Development), rate/throttling limits, or regional data center (US/EU/IN/AU) limitations for this setup?

Thank you for your clarification.

Best regards,
VigorCore Engineering Team
```

---

## 10. ARQUITECTURA DE RESPALDO SI ALTERNATIVA A NO ES VIABLE

Si Zoho responde negativamente a los puntos críticos (o si en pruebas reales CloudScale/API Gateway altera `Set-Cookie`, bloquea `OPTIONS`, exige Web Client o impide operar `zcAuth.init(req)`), **NO debe declararse viable A y NO debe debilitarse `SameSite=Strict` a `SameSite=None`**. Se evalúan por separado las dos opciones de respaldo (sin implementar ninguna en esta fase):

### Opción de Respaldo 1: Proxy Dedicado Exclusivamente para `api.<dominio-propio>` + Slate Nativo en `app.<dominio-propio>`
- **Topología:**
  - `https://app.<dominio-propio>` -> CNAME directo a **Catalyst Slate** (Domain Mapping nativo de Slate; conserva GitHub CI/CD y SSL gratuito de Zoho).
  - `https://api.<dominio-propio>` -> Apunta a un proxy HTTPS ligero (p. ej. Cloudflare Worker / NGINX / ALB) que reenvía `/api/v1/*` hacia `https://<project_domain>.catalystserverless.com/server/<fn>/api/v1/*`.
- **Qué resuelve:**
  - Permite exponer rutas limpias `/api/v1/*` sin `/server/<fn>/` ni depender de CloudScale Domain Mapping / API Gateway.
  - Garantiza control directo sobre preservación literal de `Set-Cookie: __Host-vigor_session`, `Origin`, `Sec-Fetch-Site`, `Vary: Origin`, caché `Cache-Control: no-store` en `/api/v1/*`, y manejo uniforme de `OPTIONS`.
- **Qué NO resuelve:**
  - Sigue siendo **cross-origin (`same-site`)** (`app.` != `api.`), por lo que mantiene requisitos de CORS, `credentials: 'include'`, `generateAuthToken()` + `Authorization` en `Access-Control-Allow-Headers` (si `authenticate()` mantiene `zcAuth.init(req)` en cada llamada), y sigue expuesto al riesgo de **Safari/WebKit ITP** sobre cookies emitidas desde otro subdominio CNAME.

### Opción de Respaldo 2: Proxy Inverso Unificado *Same-Origin* (`/` -> Slate, `/api/v1/*` -> Advanced I/O)
- **Topología:**
  - Único origen público para el navegador: `https://app.<dominio-propio>` (o `https://<dominio-propio>`).
  - El proxy inverso (p. ej. Cloudflare Worker / ALB / NGINX) enruta:
    - `/api/v1/*` -> `https://<project_domain>.catalystserverless.com/server/<fn>/api/v1/*` (con `Cache-Control: no-store`).
    - Todo lo demás (`/`, `/assets/*`, SPA routes) -> `https://fit-x-bhnatsxl.onslate.com` (conservando el despliegue Slate y GitHub CI/CD intactos).
- **Qué resuelve:**
  - Convierte la arquitectura en **`same-origin` estricto**: máxima garantía RFC para `__Host-vigor_session` (`SameSite=Strict`), **inmune a restricciones cross-site de Safari ITP**, elimina preflights `OPTIONS` (ahorrando latencia dentro del límite de 30s de Advanced I/O), y unifica el origen de cookies para Catalyst Auth (`/__catalyst/sdk/*`), reduciendo o eliminando la fricción de `generateAuthToken()` si el proxy sirve también `/__catalyst/*` desde el origen unificado (a verificar en `INT-06`).
- **Qué requiere validar:**
  - Que Slate (`https://fit-x-bhnatsxl.onslate.com`) acepte ser consumido detrás del proxy (cabecera `Host`, rutas `/__catalyst/sdk/*` y OAuth Redirect URIs).
  - Seguridad estricta en el proxy: prohibido cachear `/api/v1/*` o `Set-Cookie`, prohibido sobrescribir `Origin` o `Sec-Fetch-Site`, y nunca reenviar `x-zc-*` falsificados desde clientes.

### Comparativa Respaldo 1 vs. Respaldo 2

| Criterio | Respaldo 1: Proxy solo en `api.<dom>` + Slate nativo `app.<dom>` | Respaldo 2: Proxy unificado `same-origin` (`/` Slate + `/api/v1/*` API) |
| :--- | :--- | :--- |
| **Seguridad** | Alta (`__Host-` + CORS + CSRF), pero subdominios *same-site* requieren CORS y validación constante contra otros subdominios. | **Máxima.** Mismo origen exacto (`same-origin`); `__Host-` aislado al origen único; `Sec-Fetch-Site: same-origin`; sin superficie CORS cross-origin. |
| **Compatibilidad navegadores (`SameSite=Strict`)** | Media–Alta; sujeta a comportamiento real de **Safari/WebKit ITP** ante subdominio `api.` solo para fetch. | **Máxima (Garantizada por estándar)** en Chromium, Safari/WebKit y Firefox sin fricción ITP cross-site. |
| **Compatibilidad con Catalyst Auth** | Requiere puente cross-domain (`generateAuthToken()` + `Authorization` en CORS + renovación cada <1h). | Alta si `/__catalyst/sdk/*` y OAuth se enrutan bajo el mismo origen (requiere verificación `INT-06` frente a Slate). |
| **Latencia y Timeout (30s)** | Penalización por preflights `OPTIONS` en mutaciones (`POST/PUT/PATCH/DELETE`) + 1 salto proxy en API. | **Sin preflights `OPTIONS`** en navegador; 1 salto edge proxy (<10–30 ms típico). |
| **Coste** | Dominio propio + proxy ligero solo para tráfico API (`/api/v1/*`). Activos estáticos servidos gratis dentro de cuota CDN de Slate. | Dominio propio + proxy edge para API y estáticos (en Cloudflare Workers/CDN puede ser free tier o bajo coste; vigilar cuota de requests en estáticos). |
| **Mantenimiento** | Medio: mantiene configuración DNS/SSL separada entre Slate y el proxy de API, más manejo de tokens cross-domain en frontend. | Bajo–Medio: regla única de enrutamiento versionada en Git; no toca DNS de Slate ni requiere lógica `generateAuthToken()` cross-domain si comparte origen. |

---

## 11. CHECKLIST DE PRUEBAS DE INTEGRACIÓN PARA ALTERNATIVA A (`PENDING (PASS-INTEGRATION)`)

Todas las pruebas de `tests/06-integration-catalyst-live.spec.ts` siguen pendientes hasta recibir autorización del operador. Para aprobar **Alternativa A** en cuenta real y navegadores vivos (**Chromium**, **Safari/WebKit** y **Firefox**), deberán superarse:

1. **Pre-requisito Zoho / Infraestructura (`INT-06` extendido):**
   - [ ] Respuesta escrita de `support@zohocatalyst.com` a las 7 preguntas de la Sección 9.
   - [ ] Verificación de que `https://app.<dominio-propio>` (Slate) y `https://api.<dominio-propio>` (CloudScale / API Gateway) operan simultáneamente en el proyecto Catalyst con SSL válido.
   - [ ] Verificación de que `GET`/`POST`/`OPTIONS` a `https://api.<dominio-propio>` no devuelven redirecciones HTTP ni `Access-Control-Allow-Origin: *`.
   - [ ] Inspección de respuesta real de `/auth/session/exchange` confirmando `Set-Cookie: __Host-vigor_session=...; HttpOnly; Secure; SameSite=Strict; Path=/` **sin `Domain=`**.
   - [ ] Confirmación de que `Origin`, `Referer`, `Sec-Fetch-Site: same-site` y `Cookie` llegan íntegros al handler Express dentro de Advanced I/O.
2. **Integración Catalyst NoSQL & Auth (`INT-01` .. `INT-05`, `INT-08`):**
   - [ ] `INT-01` y `INT-02`: Atomicidad condicional real (`Success`, `ConditionMismatch`, `CriteriaMismatch`) en `SystemControl`.
   - [ ] `INT-03` y `INT-04`: Unicidad de correo en Catalyst Auth y propagación de `USER_STATUS.DISABLE` + `consistent_read: true`.
   - [ ] `INT-05` y `INT-08`: Latencia p95 `< 5,000 ms` (margen frente a límite 30s) incluyendo `consistent_read` doble (`Users` + `SESSION#<sid>`) y `generateAuthToken()` si aplica.
3. **Matriz Real de Navegadores (`INT-07` / `BR-01` .. `BR-20` en Chromium, Safari/WebKit y Firefox):**
   - [ ] `BR-01`..`BR-08`: Recepción, almacenamiento en cookie jar HTTPS, cumplimiento estricto `__Host-`, invisibilidad en `document.cookie`, ausencia total de `Domain=`, conservación de `SameSite=Strict` y `Path=/`.
   - [ ] `BR-09`..`BR-14`: Envío real con `credentials: 'include'` entre `app.<dominio>` y `api.<dominio>` (`BR-11`), bloqueo de `cross-site` (`BR-10`), preflight `OPTIONS` `204` (`BR-12`), reflexión exacta de `Origin` (`BR-13`), rechazo `403` de orígenes no autorizados (`BR-14`). *(Validación especial en Safari/WebKit ITP tras 24h/7d y entre pestañas).*
   - [ ] `BR-15`..`BR-20`: CSRF en `POST/PUT/PATCH/DELETE`, logout real (`Max-Age=0`), revocación individual (`SESSION#<sid>`), revocación global (`Users.sessionEpoch++`), rotación `/refresh` y rechazo `401` ante replay de cookie antigua.

---

## 12. RIESGOS Y DECISIONES QUE REQUIEREN AUTORIZACIÓN DEL OPERADOR

### Riesgos principales identificados en Alternativa A
1. **Riesgo de incompatibilidad o limitación no documentada en CloudScale / API Gateway (Alto hasta respuesta de Zoho):** Si CloudScale Domain Mapping exige Web Client Hosting activo, reescribe `Set-Cookie`, añade `Domain=`, o filtra `Sec-Fetch-Site`/`Origin`/`OPTIONS`, la Alternativa A no podrá desplegarse tal cual.
2. **Riesgo Safari/WebKit ITP en CNAME distintos (Medio–Alto):** Aunque `app.<dom>` y `api.<dom>` son `same-site`, apuntar a infraestructuras distintas (`Slate` vs `catalyst.cs.zohohost.com`) puede activar restricciones ITP en Safari/WebKit sobre `__Host-vigor_session`.
3. **Fricción de `zcAuth.init(req)` + token de 1h en cada petición (Medio):** Obliga a mantener renovación periódica de `generateAuthToken()` en el frontend y a ampliar `Access-Control-Allow-Headers` con `Authorization`, duplicando el número de preflights `OPTIONS` en endpoints con cuerpo JSON/headers custom frente a una arquitectura `same-origin`.
4. **Imposibilidad de replicar CloudScale Domain Mapping en entorno `Development` (Medio):** La documentación confirma que Domain Mapping apunta al entorno **Production**.

### Decisiones pendientes exclusivamente del operador
1. **Autorizar envío (por el propio operador) de la consulta formal de la Sección 9 a `support@zohocatalyst.com`.**
2. **Decidir, tras la respuesta de Zoho, si:**
   - Se procede con **Alternativa A** (asumiendo ajuste futuro autorizado de `Access-Control-Allow-Headers: ..., Authorization` + manejo de `generateAuthToken()` y pruebas en Safari/Chromium), **O**
   - Se adopta **Respaldo 2 (Proxy *same-origin*)** o **Respaldo 1 (Proxy solo `api.`)** si Zoho no garantiza mapeo directo e integridad de `__Host-vigor_session`.
3. **Adquirir y designar el dominio registrable propio** (recordando que no puede usarse el dominio apex para mappings directos de Zoho).
4. **Autorizar en una fase posterior e independiente:** creación manual de las 5 tablas NoSQL, desarrollo del adaptador Express Advanced I/O, actualización de `HttpSecurityPolicy.allowedOrigins` y pruebas vivas `INT-01..08` / `BR-01..20`.

---

## 13. DICTAMEN FINAL

**Dictamen:** **`VIABLE CON CONDICIONES`**

- **Por qué NO es `NO VIABLE`:** Zoho Catalyst Slate soporta explícitamente dominios personalizados (`app.<dominio-propio>`), CloudScale Domain Mappings / API Gateway permiten asociar subdominios personalizados al proyecto (`api.<dominio-propio>`), Catalyst Auth provee `generateAuthToken()` + Authorized Domains/CORS para comunicación entre subdominios del mismo proyecto, y RFC 6265bis permite `SameSite=Strict` en peticiones `fetch(..., { credentials: 'include' })` entre subdominios *same-site*.
- **Por qué NO es `VIABLE` incondicional todavía:** Existen **cuatro condiciones bloqueantes `[NO VERIFICADO]`** que deben resolverse antes de comprometer dominio o aprovisionar infraestructura:
  1. Confirmación oficial de soporte Zoho Catalyst sobre el uso de CloudScale Domain Mapping / API Gateway hacia Advanced I/O en un proyecto cuyo frontend reside en **Catalyst Slate** (sin Web Client Hosting) y su formato exacto de rutas.
  2. Garantía de paso íntegro de **`Set-Cookie: __Host-vigor_session`** (sin `Domain=`), `Origin`, `Sec-Fetch-Site` y `OPTIONS` a través de la capa edge de Catalyst.
  3. Adaptación futura autorizada del contrato CORS (`Authorization` en `Access-Control-Allow-Headers`) y estrategia de renovación de `generateAuthToken()` (1h) para `CleanSlateAuthGuard.authenticate()` (`zcAuth.init(req)`).
  4. Validación empírica **`PASS-INTEGRATION`** (`INT-06`, `INT-07`, `BR-01..BR-20`) en **Chromium, Safari/WebKit (ITP) y Firefox** reales.
