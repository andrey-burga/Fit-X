# VIGORCORE — FASE 4.1.1: EXTRACCIÓN Y EVALUACIÓN TÉCNICA DE ALTERNATIVAS DE DOMINIO, COOKIES Y AUTENTICACIÓN

**Fecha:** 2026-11-14  
**Directorio aislado:** `poc/catalyst-clean-slate/`  
**Documento fuente auditado:** `poc/catalyst-clean-slate/docs/11-phase-4.0.5-pre-provisioning-closure.md` (con contraste directo en código fuente `src/security/httpSecurityPolicy.ts`, `src/auth/cleanSlateAuthGuard.ts`, `src/routes/apiRouterSchema.ts`, `tests/06-integration-catalyst-live.spec.ts`, `tests/07-session-lifecycle-and-http-security.test.ts` y documentación oficial `docs.catalyst.zoho.com`).  
**Estado de Decisión:** **`PENDING EXPLICIT OPERATOR DECISION — NINGUNA ALTERNATIVA HA SIDO SELECCIONADA DEFINITIVAMENTE`**  
**Estado de Infraestructura:** **0** archivos modificados fuera de este informe, **0** tablas/índices/usuarios creados, **0** cambios en DNS/Slate/Catalyst/Firebase/GCP, **0** despliegues u operaciones remotas.

---

## 1. DIAGNÓSTICO BASE VERIFICADO (POR QUÉ LA CONFIGURACIÓN POR DEFECTO ESTÁ BLOQUEADA)

Antes de comparar las alternativas A, B y C, quedan establecidos los hechos técnicos verificables del proyecto:

1. **Origen actual del frontend (`[VERIFICADO]`):** `https://fit-x-bhnatsxl.onslate.com`, cuyo *registrable domain* (eTLD+1) calculado por `extractRegistrableDomain()` (`src/security/httpSecurityPolicy.ts`) es **`onslate.com`**.
2. **Formato URL predeterminado de Zoho Catalyst Advanced I/O (`[VERIFICADO]` en `docs.catalyst.zoho.com` y `docs/11`):**
   - Producción: `https://<project_domain_name>.catalystserverless.com/server/<function_name>/`
   - Desarrollo: `https://<project_domain_name>.development.catalystserverless.com/server/<function_name>/`
   - *Registrable domain* (eTLD+1): **`catalystserverless.com`**.
3. **Contrato estricto de cookie en el backend (`[VERIFICADO]` en `cleanSlateAuthGuard.ts` y `httpSecurityPolicy.ts`):**
   - `ServerSessionTokenManager.buildHttpOnlySetCookieHeader()` emite exactamente:
     `__Host-vigor_session=<payload_b64url>.<hmac_b64url>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`
   - `assertStrictCookieAttributes()` exige presencia de prefijo `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` y **ausencia total del atributo `Domain=`**.
   - Se prohíbe expresamente degradar `SameSite=Strict` a `SameSite=None`.
4. **Consecuencia en navegador entre URLs por defecto (`[NO COMPATIBLE]`):**
   - `onslate.com` != `catalystserverless.com` implica relación **`cross-site`**.
   - `evaluateBrowserCookieCompatibility('https://fit-x-bhnatsxl.onslate.com', 'https://<project>.catalystserverless.com')` retorna `relationship: 'cross-site'`, `sameSiteStrictSentByBrowser: false` y `INCOMPATIBLE_DEFAULT_CATALYST_CROSS_SITE`.
   - En navegadores modernos (Chromium y Safari/WebKit), una cookie **`SameSite=Strict`** NO es enviada en peticiones `fetch(..., { credentials: 'include' })` *cross-site*, provocando rechazo continuo `401` aunque CORS estuviera permitido.
5. **Seguridad de `*.onslate.com` (`[VERIFICADO]` en `docs/10` §3):**
   - `onslate.com` es un sufijo multi-inquilino compartido entre cuentas de Zoho Catalyst Slate, no un dominio privado exclusivo de VigorCore.

---

## 2. EXTRACCIÓN COMPLETA Y VERIFICACIÓN TÉCNICA DE LAS ALTERNATIVAS A, B Y C

> **Convención obligatoria de evidencia:**
> - **`[VERIFICADO]`**: Respaldado por código/tests en `poc/catalyst-clean-slate/` o documentación oficial consultada (`docs.catalyst.zoho.com` / RFC HTTP).
> - **`[NO VERIFICADO]`**: Comportamiento que depende de la cuenta/plan real de Zoho Catalyst o del motor del navegador en vivo y requiere prueba en entorno real.
> - **`[NO COMPATIBLE]`**: Limitación técnica confirmada que impide usar un componente o modo concreto.

---

### ALTERNATIVA A: Dominio Personalizado Compartido (*Same-Site* por Subdominios Hermanos)

#### A.1 Arquitectura y funcionamiento
- El operador adquiere/utiliza un **dominio propio** (ejemplo ilustrativo: `tudominio.com`) y expone frontend y backend como subdominios hermanos separados dentro del mismo eTLD+1:
  - UI alojada en Zoho Catalyst Slate bajo `app.<tudominio>`. `[VERIFICADO]`
  - Backend Advanced I/O alojado en Zoho Catalyst mapeado mediante **CloudScale -> Domain Mappings** bajo `api.<tudominio>`. `[VERIFICADO en docs.catalyst.zoho.com]`
- El navegador realiza llamadas HTTPS entre subdominios distintos (`app.<tudominio>` -> `api.<tudominio>`) usando `fetch(..., { credentials: 'include' })`. `[VERIFICADO]`
- En la inicialización de sesión (`POST /api/v1/auth/session/bootstrap-profile` y `/exchange`), si la autenticación de Catalyst Web SDK en `app.<tudominio>` no comparte cookies host-only con `api.<tudominio>`, el flujo puede requerir obtener un token de autenticación vía `catalyst.auth.generateAuthToken()` o validar en vivo cómo `zcAuth.init(req)` recibe la identidad entre ambos hosts. `[VERIFICADO en docs.catalyst.zoho.com / NO VERIFICADO comportamiento de cookies propias de Catalyst entre dos Domain Mappings distintos]`

#### A.2 Dominio desde el que se sirve el frontend
- `https://app.<tudominio>` (subdominio propio mapeado en **Catalyst Slate -> Deployment Overview -> Domain Mapping**). `[VERIFICADO]`
- *Nota:* Reemplaza en producción al origen `https://fit-x-bhnatsxl.onslate.com` para evitar *cross-site* con `api.<tudominio>`. `[VERIFICADO]`

#### A.3 Dominio desde el que se realizan las llamadas al backend
- `https://api.<tudominio>` (ej. `https://api.<tudominio>/server/<fn>/api/v1/...` o ruta mapeada por API Gateway si se combina). `[VERIFICADO]`
- **Limitación importante:** La documentación de *CloudScale Domain Mappings* indica mapeo hacia la **Production URL** del proyecto y advierte que Catalyst **requiere subdominios** y no soporta mapear dominios raíz (*apex domain*, ej. `tudominio.com`) directamente vía CNAME. `[VERIFICADO]` / `[NO COMPATIBLE con dominio apex]`
- El comportamiento equivalente en ambiente `Development` (`*.development.catalystserverless.com`) con un segundo dominio personalizado es `[NO VERIFICADO]`.

#### A.4 Relación entre dominios y *registrable domain*
- Frontend `app.<tudominio>` -> eTLD+1 = `<tudominio>`. `[VERIFICADO]`
- Backend `api.<tudominio>` -> eTLD+1 = `<tudominio>`. `[VERIFICADO]`
- Relación RFC 6265bis en el navegador: **`same-site`** (mismo *registrable domain*, diferente origen `scheme + host + port`). `[VERIFICADO en httpSecurityPolicy.ts]`

#### A.5 Compatibilidad con la cookie `__Host-vigor_session`
- **`[VERIFICADO]` a nivel de especificación y tests mock (`tests/07`):**
  - El prefijo `__Host-` exige `Secure`, `Path=/` y **ningún atributo `Domain=`** (cookie *host-only*).
  - Como la cookie la emite el backend (`https://api.<tudominio>`), queda vinculada **exclusivamente al host `api.<tudominio>`**. No se comparte ni expone al subdominio `app.<tudominio>`, pero el navegador **sí debe adjuntarla** en las peticiones `fetch('https://api.<tudominio>/...', { credentials: 'include' })` iniciadas desde `https://app.<tudominio>` por tratarse de una petición *same-site*.
- **`[NO VERIFICADO]` en navegador real:** Su comportamiento efectivo bajo **Safari/WebKit (Intelligent Tracking Prevention / ITP)** y Chromium entre dos hosts CNAME distintos (`Slate` + `CloudScale`) requiere ejecutar `INT-06`, `INT-07` y `BR-11`.

#### A.6 Compatibilidad con `SameSite=Strict`, `Secure` y `HttpOnly`
- `Secure`: Compatible (`https://` obligatorio en ambos subdominios). `[VERIFICADO]`
- `HttpOnly`: Compatible (la cookie reside en `api.<tudominio>`; nunca es accesible desde `document.cookie` en `app.<tudominio>`). `[VERIFICADO]`
- `SameSite=Strict`: Teóricamente compatible para peticiones *fetch* *same-site* subrecurso con `credentials: 'include'`. `[VERIFICADO en especificación y mock tests/07]`. Su conservación íntegra a través de Catalyst CloudScale sin alteración de `Set-Cookie` es `[NO VERIFICADO]`.

#### A.7 Configuración CORS y credenciales
- **Obligatoria.** Al diferir el origen (`app.<tudominio>` != `api.<tudominio>`), toda llamada API con cookies es *cross-origin* (*same-site*). `[VERIFICADO]`
- `HttpSecurityPolicy` (`src/security/httpSecurityPolicy.ts`) exige configurar `allowedOrigins: ['https://app.<tudominio>']`, respondiendo en preflight `OPTIONS` (HTTP `204`) y respuestas API:
  - `Access-Control-Allow-Origin: https://app.<tudominio>` (nunca `*`)
  - `Access-Control-Allow-Credentials: true`
  - `Vary: Origin`
  - `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type, X-Vigor-CSRF`
- En el lado de la plataforma Catalyst, puede requerir además registrar `https://app.<tudominio>` en **Cloud Scale Authentication -> Authorized Domains** para que Catalyst permita peticiones CORS hacia SDK/Auth/endpoints. `[VERIFICADO en docs.catalyst.zoho.com / NO VERIFICADO interacción combinada con respuestas personalizadas del dispatcher Advanced I/O]`

#### A.8 Protección CSRF y validación de `Origin`
- **Crítica e indispensable.** `SameSite=Strict` **NO protege** contra peticiones originadas desde otros subdominios bajo `<tudominio>` si existieran (o subdominios de prueba/staging bajo el mismo dominio registrable). `[VERIFICADO]`
- `HttpSecurityPolicy.assertCsrfAndOriginForRequest()` valida en **`POST`, `PUT`, `PATCH` y `DELETE`** que `Origin` (o fallback `Referer`) pertenezca exactamente a la allowlist (`https://app.<tudominio>`) y rechaza con `403 CSRF_CROSS_SITE_REJECTED` si `Sec-Fetch-Site` es `cross-site` (esperando `same-site` en Chrome/WebKit moderno). `[VERIFICADO]`
- *Nota sobre `zcAuth.init(req)`:* Si la infraestructura intermedia de Zoho modifica o filtra `Origin` o `Sec-Fetch-Site` antes de llegar al runtime Node.js de Advanced I/O, podría provocar falsos rechazos `CSRF_ORIGIN_REQUIRED` -> `[NO VERIFICADO]`.

#### A.9 Compatibilidad con Zoho Catalyst Slate y Advanced I/O Functions
- **Slate Custom Domain Mapping:** Soportado oficialmente por CNAME + SSL automático gratuito. `[VERIFICADO en docs.catalyst.zoho.com]`
- **Advanced I/O + CloudScale Domain Mapping:** Soportado oficialmente para mapear un subdominio CNAME a la URL de producción (`catalyst.cs.zohohost.com` + CNAME hash de verificación). `[VERIFICADO en docs.catalyst.zoho.com]`
- **Duda abierta crítica (`[NO VERIFICADO]`):**
  1. Si `https://app.<tudominio>` (Slate) y `https://api.<tudominio>` (CloudScale) pueden mapearse sin conflictos dentro del mismo proyecto Catalyst en el plan actual.
  2. Cómo recibe `zcAuth.init(req)` la identidad del usuario en `/bootstrap-profile` y `/exchange` cuando el usuario inició sesión en Catalyst Auth desde `app.<tudominio>` y llama a `api.<tudominio>` (la documentación oficial recomienda `catalyst.auth.generateAuthToken()` entre dominios distintos). `[VERIFICADO recomendación oficial / NO VERIFICADO flujo concreto en Advanced I/O]`
  3. Límite duro no configurable de 30s en Advanced I/O (`CATALYST_PLATFORM_LIMITS.ADVANCED_IO_TIMEOUT_MS`). `[VERIFICADO]`

#### A.10 Necesidad de DNS, dominio personalizado y certificados SSL
- **Dominio propio:** Obligatorio (comprar o usar un dominio privado exclusivo). `[VERIFICADO]`
- **DNS:** Obligatorio gestionar registros **CNAME** para `app.<tudominio>` (apuntando al destino indicado por Slate) y para `api.<tudominio>` (dos CNAME según docs: `catalyst.cs.zohohost.com` + CNAME de verificación hash). `[VERIFICADO]`
- **SSL/TLS:** Gestionado automáticamente por Zoho Catalyst / Slate mediante certificados gratuitos auto-renovados una vez verificado el DNS. `[VERIFICADO]`

#### A.11 Costes adicionales, dependencias y limitaciones
- **Costes adicionales:** Registro/renovación del dominio propio; verificar si *CloudScale Domain Mappings* o múltiples dominios requieren un tier de pago específico en la cuenta Catalyst (`[NO VERIFICADO en plan actual]`).
- **Dependencias:** Proveedor DNS externo, Zoho Slate Domain Mapping, Zoho CloudScale Domain Mapping.
- **Limitaciones:** No soporta dominio apex/raíz en CloudScale; requiere CORS en el navegador (preflights `OPTIONS` duplican latencia percibida en llamadas mutantes); dependencia crítica de que `Set-Cookie` sin `Domain=` y cabeceras `Origin`/`Sec-Fetch-Site` atraviesen limpiamente la capa de CloudScale.

#### A.12 Complejidad de implementación y mantenimiento
- **Implementación:** Media (requiere configurar DNS + dos Domain Mappings en Catalyst + *Authorized Domains* + actualizar `HttpSecurityPolicy.allowedOrigins` y cliente web con `credentials: 'include'` + resolver intercambio inicial de identidad Catalyst en `/bootstrap-profile` y `/exchange`).
- **Mantenimiento:** Bajo–Medio (SSL renovado automáticamente por Catalyst; sin proxy adicional que parchear/desplegar, pero ligado al comportamiento de dos capas Zoho distintas).

---

### ALTERNATIVA B: API Gateway / Proxy Oficial *Same-Site* o *Same-Origin* de Zoho Catalyst

#### B.1 Arquitectura y funcionamiento
- Utiliza el componente oficial **Catalyst API Gateway** (descrito en `docs.catalyst.zoho.com` como capa de *reverse proxy* gestionado y gestión de APIs delante de componentes del proyecto) para ocultar las rutas crudas `/server/<fn>/` y exponer URLs limpias (`/api/v1/*`) enrutadas hacia las funciones Advanced I/O. `[VERIFICADO existencia del servicio]`
- **Matiz crítico extraído de la verificación oficial (`[NO VERIFICADO]` / potencialmente `[NO COMPATIBLE]` sin dominio propio):**
  - La documentación oficial especifica que API Gateway enruta peticiones hacia **Basic I/O Functions**, **Advanced I/O Functions** y **Web Client** (no documenta explícitamente a **Catalyst Slate** como *Target Component* bajo `*.onslate.com`). `[VERIFICADO en docs.catalyst.zoho.com]`
  - Por defecto, API Gateway expone endpoints bajo el dominio del proyecto **`https://<project_domain_name>.catalystserverless.com/...`** (el cual sigue siendo **`cross-site`** frente a `https://fit-x-bhnatsxl.onslate.com`). `[VERIFICADO]`
  - Para lograr relación *same-site* o *same-origin* usando API Gateway habría que verificar una de dos opciones en cuenta real:
    - *(B1)* Que API Gateway + CloudScale Domain Mapping sirva tanto el **Web Client** (en lugar de Slate en `*.onslate.com`) como `/api/v1/*` bajo el mismo dominio; o
    - *(B2)* Que exista una regla oficial dentro de Slate/Zoho para montar API Gateway bajo `app.<tudominio>/api/v1/*` sin proxy externo (`[NO VERIFICADO]`, sin evidencia pública en docs de Slate).

#### B.2 Dominio desde el que se sirve el frontend
- En caso *same-site* con Slate: `https://app.<tudominio>` (o `https://fit-x-bhnatsxl.onslate.com` únicamente si Zoho soportara proxy nativo en Slate, hecho `[NO VERIFICADO]`).
- En caso Web Client + API Gateway sin dominio propio: `https://<project_domain_name>.catalystserverless.com` (`[VERIFICADO soporte de Target Web Client en API Gateway]`, aunque abandonando el subdominio `*.onslate.com` de Slate).

#### B.3 Dominio desde el que se realizan las llamadas al backend
- `https://api.<tudominio>/api/v1/*` (vía Domain Mapping sobre API Gateway -> Advanced I/O) o `https://<project_domain_name>.catalystserverless.com/api/v1/*` (si el frontend también residiera en Web Client bajo `*.catalystserverless.com`). `[VERIFICADO formato API Gateway]`

#### B.4 Relación entre dominios y *registrable domain*
- Si Slate permanece en `*.onslate.com` y API Gateway en `*.catalystserverless.com`: **`cross-site` (`[NO COMPATIBLE]`)**.
- Si ambos usan subdominios de un dominio propio (`app.<tudominio>` + `api.<tudominio>`): **`same-site` (`[VERIFICADO]`)**.
- Si Web Client + Advanced I/O se unifican bajo API Gateway en un único host (`<tudominio>` o `<project>.catalystserverless.com`): **`same-origin` (`[NO VERIFICADO]` compatibilidad total con Slate y cookies)**.

#### B.5 Compatibilidad con la cookie `__Host-vigor_session`
- **`[VERIFICADO]`** en el diseño backend (`assertStrictCookieAttributes()`): el código del servidor emite `__Host-vigor_session` sin `Domain=` y con `Path=/`.
- **`[NO VERIFICADO]` en el gateway:** La documentación oficial de Catalyst API Gateway **no confirma** si su capa proxy reenvía intactas todas las cabeceras `Set-Cookie` con prefijo `__Host-` desde Advanced I/O, si soporta múltiples `Set-Cookie` sin colapsarlos o si inyecta atributos propios (`Domain=`, etc.), ni cómo interactúa la autenticación de API Gateway (OAuth/API keys/Throttling) con cookies de sesión propias de la aplicación.

#### B.6 Compatibilidad con `SameSite=Strict`, `Secure` y `HttpOnly`
- Si termina operando como *same-site* o *same-origin* sobre HTTPS y API Gateway no reescribe `Set-Cookie`: compatible (`[NO VERIFICADO]`).
- Si API Gateway expone rutas en `*.catalystserverless.com` mientras la UI sigue en `*.onslate.com`: **`[NO COMPATIBLE]`** (los navegadores bloquean `SameSite=Strict`).

#### B.7 Configuración CORS y credenciales
- Si el gateway y el frontend comparten exactamente el mismo origen (*same-origin*): CORS de navegador no es necesario (se conserva `HttpSecurityPolicy` en backend como barrera). `[VERIFICADO]`
- Si operan en subdominios distintos (*same-site*): requiere CORS estricto con `Access-Control-Allow-Credentials: true` + origen exacto + `Vary: Origin`, además de comprobar que API Gateway no sobreescriba `OPTIONS` ni devuelva `*` en preflights (`[NO VERIFICADO]`).

#### B.8 Protección CSRF y validación de `Origin`
- Depende de que **Catalyst API Gateway reenvíe literalmente las cabeceras `Origin`, `Referer`, `Cookie` y `Sec-Fetch-Site` del navegador** hasta la función Advanced I/O. `[NO VERIFICADO]`
- Si API Gateway actúa como proxy L7 y omite o altera `Origin` o `Sec-Fetch-Site`, `HttpSecurityPolicy.assertCsrfAndOriginForRequest()` rechazará legítimamente las mutaciones con `403 CSRF_ORIGIN_REQUIRED`. `[VERIFICADO en código]`

#### B.9 Compatibilidad con Zoho Catalyst Slate y Advanced I/O Functions
- **API Gateway -> Advanced I/O Functions:** Compatible oficialmente. `[VERIFICADO en docs.catalyst.zoho.com]`
- **API Gateway -> Slate (`*.onslate.com`):** **`[NO VERIFICADO]` / no documentado en los targets oficiales de API Gateway** (la documentación lista `Web Client`, `Advanced I/O`, `Basic I/O`, no `Slate`).

#### B.10 Necesidad de DNS, dominio personalizado y certificados SSL
- Si se usa junto a Slate: requiere **dominio personalizado + CNAME + SSL** igual que la Alternativa A. `[VERIFICADO]`
- Si se prescinde de Slate usando únicamente *Web Client* + *API Gateway* bajo `*.catalystserverless.com`: no requiere dominio propio ni DNS externo, aunque tampoco utiliza `https://fit-x-bhnatsxl.onslate.com`. `[VERIFICADO parcial / NO VERIFICADO flujo de cookies]`

#### B.11 Costes adicionales, dependencias y limitaciones
- **Costes y límites:** Depende de cuotas, límites de rutas/reglas y plan comercial de Catalyst API Gateway en la cuenta del operador (`[NO VERIFICADO]`).
- **Limitaciones principales:**
  - Falta de evidencia documental pública de integración directa API Gateway <-> Slate bajo un único origen.
  - Riesgo de manipulación opaca de cabeceras HTTP (`Cookie`, `Set-Cookie`, `Origin`, `Sec-Fetch-Site`, respuestas `OPTIONS`) sobre las que el desarrollador no controla el código fuente del proxy gestionado.

#### B.12 Complejidad de implementación y mantenimiento
- **Implementación:** Media–Alta (configurar rutas 1 a 1 en API Gateway, validar políticas CORS/Auth del gateway sin romper cookies `__Host-`, más DNS/Domain Mapping si se usa dominio propio).
- **Mantenimiento:** Medio (cambios de rutas REST pueden requerir sincronizar definiciones en API Gateway además del router de la función Advanced I/O).

---

### ALTERNATIVA C: Proxy Inverso Dedicado Bajo el Mismo Origen (*Same-Origin*)

#### C.1 Arquitectura y funcionamiento
- Se despliega un **reverse proxy HTTPS controlado por VigorCore** (por ejemplo Cloudflare Workers / Cloudflare Snippets, NGINX, AWS CloudFront/ALB o equivalente) como único punto de entrada público frente al usuario final en un dominio propio (`https://<tudominio-app>`). `[VERIFICADO como patrón estándar y en docs/11]`
- Enrutamiento por *path* en el mismo origen exacto:
  - Todas las peticiones de UI/estáticos (`/`, `/assets/*`, rutas SPA) se reenvían (*origin fetch*) al deployment de **Zoho Catalyst Slate** (`https://fit-x-bhnatsxl.onslate.com` o el host interno asignado).
  - Todas las peticiones de API (`/api/v1/*`) se reenvían a la función **Catalyst Advanced I/O** (`https://<project_domain>.catalystserverless.com/server/<fn>/api/v1/*`).
- Para el navegador del usuario (Chromium, Safari/WebKit, Firefox), tanto la aplicación React como `/api/v1/*` existen bajo **un único esquema + host + puerto** (`https://<tudominio-app>`). `[VERIFICADO]`

#### C.2 Dominio desde el que se sirve el frontend
- `https://<tudominio-app>` (ej. `https://app.<tudominio>` o incluso dominio raíz/apex `https://<tudominio>` si el edge proxy soporta CNAME flattening / proxy A record, como Cloudflare). `[VERIFICADO]`
- *(No se requiere modificar el código ni la publicación interna de Slate en `https://fit-x-bhnatsxl.onslate.com`, ya que el proxy actúa delante consumiéndolo como origen upstream — sujeto a verificar que Slate acepte el `Host`/cabeceras del proxy sin bloquearlo).* `[NO VERIFICADO aceptación de host proxy por Slate CDN]`

#### C.3 Dominio desde el que se realizan las llamadas al backend
- Exactamente el **mismo dominio y origen**: `https://<tudominio-app>/api/v1/*`. `[VERIFICADO]`
- El navegador **no conoce ni contacta directamente** a `*.catalystserverless.com`. `[VERIFICADO]`

#### C.4 Relación entre dominios y *registrable domain*
- Frontend: `https://<tudominio-app>`
- Backend: `https://<tudominio-app>`
- Relación RFC / Navegador: **`same-origin`** estricto (origen bit-a-bit idéntico). `[VERIFICADO en httpSecurityPolicy.ts]`

#### C.5 Compatibilidad con la cookie `__Host-vigor_session`
- **Máxima compatibilidad garantizada por estándar web.** `[VERIFICADO en RFC 6265bis y tests/07]`
- El proxy reenvía la respuesta de Advanced I/O hacia el cliente preservando literalmente `Set-Cookie: __Host-vigor_session=...; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200` sin inyectar `Domain=`.
- Como la cookie pertenece al mismo origen exacto de la app (`<tudominio-app>`), el navegador la almacena y la adjunta automáticamente en todo `fetch('/api/v1/...')` (`same-origin`), tanto para `__Host-vigor_session` como para cualquier cookie de sesión de primera parte emitida por Catalyst Auth (`zcAuth.init(req)`) si también pasa por el mismo origen.
- **No está expuesta a bloqueos cross-site de Safari ITP** (WebKit trata las cookies de servidor *first-party same-origin* sin degradación *cross-site*). `[VERIFICADO a nivel de modelo HTTP; ejecución viva pendiente en INT-07]`

#### C.6 Compatibilidad con `SameSite=Strict`, `Secure` y `HttpOnly`
- `SameSite=Strict`: **100% compatible y en su escenario nativo más estricto (`same-origin`)** sin degradación a `SameSite=None`. `[VERIFICADO]`
- `Secure`: Garantizado (TLS terminado en el edge del reverse proxy + TLS upstream hacia Slate y Catalyst). `[VERIFICADO]`
- `HttpOnly`: Garantizado (`document.cookie` nunca puede leer `__Host-vigor_session`). `[VERIFICADO]`

#### C.7 Configuración CORS y credenciales
- **CORS no es requerido por el navegador** porque las llamadas `/api/v1/*` son `same-origin` (eliminando latencia extra de *preflights* `OPTIONS`). `[VERIFICADO]`
- Aun así, `HttpSecurityPolicy` en el backend se mantiene activo con `allowedOrigins: ['https://<tudominio-app>']` como segunda línea de defensa si alguien invocara el endpoint directo o desde otro origen. `[VERIFICADO]`
- En el cliente web basta `fetch('/api/v1/...', { credentials: 'same-origin' })` (o `'include'`). `[VERIFICADO]`

#### C.8 Protección CSRF y validación de `Origin`
- **Defensa en profundidad óptima:**
  1. `SameSite=Strict` en el mismo origen impide automáticamente que sitios externos y **otros subdominios** envíen `__Host-vigor_session` (al usar prefijo `__Host-` sin `Domain=`, ningún subdominio hermano puede leer, sobrescribir ni recibir la cookie). `[VERIFICADO]`
  2. El proxy debe configurarse explícitamente para **preservar y reenviar** las cabeceras `Origin`, `Referer`, `Cookie` y `Sec-Fetch-Site` (`same-origin`) hacia Advanced I/O y **no falsificarlas** ni ocultar `Set-Cookie`. `[VERIFICADO como requisito en docs/11]`
  3. `HttpSecurityPolicy` valida `Origin` + `Sec-Fetch-Site` en `POST`, `PUT`, `PATCH`, `DELETE`. `[VERIFICADO]`

#### C.9 Compatibilidad con Zoho Catalyst Slate y Advanced I/O Functions
- **Advanced I/O Functions:** Totalmente compatible siempre que el proxy respete un timeout upstream adecuado (Catalyst tiene límite fijo de **30 segundos**) y no altere `Cookie`, `Set-Cookie`, `Origin` ni cuerpos JSON. `[VERIFICADO]`
- **Catalyst Auth (`catalystWebSDK.js` / `/__catalyst/sdk/init.js`):** Si el proxy sirve `/` desde Slate bajo `https://<tudominio-app>`, hay que verificar en vivo (`INT-06`) que `/__catalyst/sdk/*` y OAuth *redirect URIs* funcionen correctamente detrás del proxy (ej. configurando el dominio del proxy como Redirect/Authorized Domain en Catalyst Authentication). `[NO VERIFICADO en vivo]`
- **Slate detrás de proxy inverso:** Debe verificarse que el CDN de `*.onslate.com` responda HTTP `200` cuando recibe peticiones desde un Worker/reverse proxy (cabecera `Host` reescrita a `fit-x-bhnatsxl.onslate.com` para el upstream de UI y redirecciones internas relativas). `[NO VERIFICADO]`

#### C.10 Necesidad de DNS, dominio personalizado y certificados SSL
- **Dominio propio:** Obligatorio (a menos que el sitio dejara de usar `*.onslate.com`, porque Zoho controla el DNS de `onslate.com` y no permite interponer un proxy propio delante de `fit-x-bhnatsxl.onslate.com`). `[VERIFICADO]`
- **DNS y SSL:** DNS apuntando al proxy inverso (ej. Cloudflare DNS / ALB / Edge CDN) con certificado TLS válido gestionado en el proxy. `[VERIFICADO]`

#### C.11 Costes adicionales, dependencias y limitaciones
- **Costes adicionales:** Dominio propio (~10–15 USD/año típico, variable según registrador) + servicio de proxy/edge (ej. Cloudflare Workers posee nivel gratuito para bajo/medio tráfico y planes pagos según volumen/SLA; ALB/NGINX tendría coste de cómputo/tráfico). `[VERIFICADO naturaleza del coste; monto exacto depende de proveedor elegido]`
- **Dependencias:** Un componente de infraestructura adicional fuera de Zoho Catalyst (el proxy inverso / CDN edge) + proveedor DNS.
- **Limitaciones:** Un salto de red adicional (habitualmente < 10–30 ms en edge global) que debe permanecer muy por debajo de los 30s de Advanced I/O; responsabilidad operativa del equipo sobre las reglas del proxy (prohibido cachear respuestas `/api/v1/*` autenticadas o `Set-Cookie`). `[VERIFICADO]`

#### C.12 Complejidad de implementación y mantenimiento
- **Implementación:** Media (desplegar un script de reverse proxy de ~40–60 líneas p. ej. en Cloudflare Workers con reglas estrictas `no-store` en `/api/v1/*`, mapeo DNS + configuración de origin autorizado en `HttpSecurityPolicy` y Redirect URI en Catalyst Auth).
- **Mantenimiento:** Bajo–Medio (reglas de enrutamiento casi estáticas una vez desplegadas; el código del proxy es simple y versionable en el propio repositorio Git).

---

## 3. EVALUACIÓN CON LA INFRAESTRUCTURA ACTUAL Y SOLUCIÓN SIN DEBILITAR SEGURIDAD

### ¿Es viable alguna de las alternativas A, B o C con la infraestructura actual sin cambios adicionales?
**RESPUESTA HONESTA: NO.** Con la infraestructura actual exclusivamente (`https://fit-x-bhnatsxl.onslate.com` tal cual, sin dominio personalizado ni proxy desplegado):
- **Llamada directa a Advanced I/O por defecto (`*.catalystserverless.com`):** **`[NO COMPATIBLE]`** por relación *cross-site* frente a `SameSite=Strict`.
- **Alternativa A:** Requiere adquirir/usar un dominio personalizado propio y configurar DNS CNAME.
- **Alternativa B:** No está verificado que API Gateway pueda inyectar rutas `/api/v1/*` bajo `fit-x-bhnatsxl.onslate.com` ni que soporte Slate como target.
- **Alternativa C:** Imposible sobre `fit-x-bhnatsxl.onslate.com` directamente porque VigorCore no controla el DNS de `onslate.com`.

### Solución alternativa viable SIN comprar dominio personalizado ni debilitar seguridad (`SameSite=Strict` intacto)
Si el operador decide **no adquirir todavía un dominio propio** y **no desplegar un proxy externo**, la única arquitectura técnicamente coherente que mantiene intacta la seguridad (`__Host-vigor_session`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, sin `Domain=`) es:
- **Servir el frontend compilado (React/Vite) directamente desde Zoho Catalyst Web Client Hosting (o API Gateway -> Target: Web Client + Advanced I/O) bajo el dominio único predeterminado del proyecto: `https://<project_domain_name>.catalystserverless.com/`** (`[VERIFICADO]` soporte de Web Client + Advanced I/O en el mismo origen `*.catalystserverless.com`; `[NO VERIFICADO]` comportamiento concreto de `Set-Cookie` `__Host-` con API Gateway o Web Client en cuenta real hasta ejecutar `INT-06`/`INT-07`).
- **Implicación honesta:** Esto sustituye el hosting actual de **Slate (`fit-x-bhnatsxl.onslate.com`)** por **Catalyst Web Client Hosting** como origen activo del navegador para la SPA, logrando **`same-origin` real sin coste de dominio ni proxy externo**. No debilita ninguna política criptográfica ni de cookies.

---

## 4. TABLA COMPARATIVA OBLIGATORIA (ALTERNATIVAS A, B Y C)

| # | Criterio Evaluado | Alternativa A (Dominio propio *same-site*: `app.` + `api.`) | Alternativa B (Catalyst API Gateway *same-site* / *Web Client*) | Alternativa C (Proxy inverso dedicado *same-origin*) |
| :-: | :--- | :--- | :--- | :--- |
| **1** | **Seguridad** | Alta (`HttpOnly` + CORS allowlist + CSRF), pero *same-site* entre subdominios exige confiar en que ningún otro subdominio sea comprometido y en CORS estricto. | Media–Alta en papel, pero comportamiento real de `Set-Cookie`/`Origin`/`Sec-Fetch-Site` en el gateway **no verificado**. | **Máxima.** Mismo origen exacto + `__Host-` *host-only* + `SameSite=Strict` real + `Sec-Fetch-Site: same-origin` + `HttpSecurityPolicy`. |
| **2** | **Compatibilidad con `SameSite=Strict`** | **Media–Alta** (válida por estándar *same-site* con `credentials: 'include'`, pero sujeta a validación Safari ITP y CloudScale). | **Condicionada / No verificada** (si queda en `*.onslate.com` + `*.catalystserverless.com` es **incompatible**; solo viable unificando dominio o pasando a *Web Client*). | **Máxima (Garantizada por RFC).** Es el escenario nativo `same-origin` para `SameSite=Strict`. |
| **3** | **Compatibilidad con Slate** | **Alta** (Slate soporta Domain Mapping por CNAME oficialmente). | **Baja / No verificada** (API Gateway documenta *Web Client* y *Functions*, no *Slate* bajo un único origen). | **Media–Alta** (Slate sirve la SPA tras el proxy; requiere validar *Host header* y rutas `/__catalyst/sdk/*` en `INT-06`). |
| **4** | **Complejidad de implementación** | **Media** (DNS CNAME + 2 Domain Mappings + CORS + intercambio de auth entre subdominios). | **Media–Alta** (mapeo de endpoints 1:1 en API Gateway + reglas CORS/auth + eventual cambio de hosting). | **Media** (1 Worker/reverse proxy con regla `/api/v1/*` -> Advanced I/O y `/` -> Slate + DNS). |
| **5** | **Coste de infraestructura** | **Bajo** (solo dominio propio + eventual plan Catalyst para CloudScale Domain Mapping). | **Bajo–Medio** (depende de cuotas/tier de API Gateway + dominio si usa Slate). | **Bajo** (dominio propio + proxy edge ej. tier gratuito/económico de Cloudflare Workers o ALB). |
| **6** | **Dependencia de servicios externos** | DNS externo + 2 mecanismos internos de dominio en Zoho Catalyst. | Alta dependencia de configuración propietaria de API Gateway / Zoho. | DNS externo + servicio de reverse proxy (p. ej. Cloudflare Workers/CDN). |
| **7** | **Mantenimiento** | Bajo–Medio (sin código de proxy propio; gestión repartida en 2 mappings de consola). | Medio (sincronizar rutas en código Node + consola API Gateway). | Bajo–Medio (archivo de configuración/Worker versionado como código; **prohibido cachear API**). |
| **8** | **Escalabilidad** | Alta (CDN Slate + Serverless Advanced I/O escalan horizontalmente). | Media–Alta (sujeta a límites de *throttling* y cuota de API Gateway). | **Alta** (edge proxy stateless escala globalmente con baja latencia sin cuellos de botella). |
| **9** | **Riesgo operativo** | **Medio** (`zcAuth.init(req)` entre subdominios y Safari ITP requieren validación viva; preflights CORS en mutaciones). | **Alto** (mayor número de incógnitas `[NO VERIFICADO]` sobre Slate, `Set-Cookie: __Host-` y cabeceras CSRF). | **Bajo–Medio** (riesgo técnico controlado mediante reglas explícitas no-cache y preservación de cabeceras). |
| **10** | **Facilidad de pruebas en navegadores reales** | Media (requiere probar `BR-01..BR-20` con atención especial a `BR-11` en Safari ITP y Chrome preflights). | Baja–Media (depende de validar comportamiento interno opaco del gateway antes de `BR-01..20`). | **Alta** (comportamiento determinista idéntico en Chromium y Safari/WebKit al ser `same-origin`, incluso simulable localmente con proxy dev). |

---

## 5. RECOMENDACIÓN TÉCNICA RAZONADA (SIN DECLARAR SELECCIÓN DEFINITIVA)

### Recomendación Principal para Producción Clean-Slate (Manteniendo Catalyst Slate): **Alternativa C — Proxy Inverso Dedicado *Same-Origin***

**Justificación técnica:**
1. **Elimina por arquitectura el problema de cookies *cross-site* e ITP:** Bajo `https://<tudominio-app>`, tanto la UI como `/api/v1/*` son estrictamente **`same-origin`**. Chrome y Safari/WebKit envían `__Host-vigor_session` (`SameSite=Strict`, `HttpOnly`, `Secure`, `Path=/`, sin `Domain=`) de forma predecible sin depender de heurísticas *same-site* entre subdominios CNAME distintos.
2. **Protege el flujo completo de Catalyst Authentication (`bootstrap-profile` / `exchange`):** Al unificar el origen de la UI y del backend, se evitan conflictos de cookies propias de sesión de Catalyst Auth entre `app.` y `api.` que en la Alternativa A exigirían puentes adicionales (`catalyst.auth.generateAuthToken()`).
3. **Elimina preflights `OPTIONS` en producción:** Reduce la latencia efectiva de red en `POST`/`PUT`/`PATCH`/`DELETE`, dando mayor margen bajo el timeout duro de 30s de Advanced I/O.
4. **Control total sobre cabeceras de seguridad:** Garantiza que `Set-Cookie: __Host-vigor_session`, `Origin`, `Referer`, `Cookie` y `Sec-Fetch-Site` lleguen íntegros al código verificado en `HttpSecurityPolicy` y `CleanSlateAuthGuard`, sin riesgo de reescritura opaca de un API Gateway no verificable.

### Cuándo considerar Alternativa A o la Vía Web Client
- **Alternativa A** es una alternativa válida de respaldo si el operador **prohíbe operar cualquier pieza fuera de Zoho** (ni siquiera un Cloudflare Worker ligero), dispone de un dominio propio y acepta validar en fase de integración real (`INT-06`/`INT-07`) el envío de credenciales Catalyst hacia `api.<tudominio>`, CORS y Safari ITP.
- **Vía sin dominio propio (`Web Client Hosting` + `Advanced I/O` en `*.catalystserverless.com`)** es la opción recomendada únicamente si se requiere desplegar/probar de inmediato en vivo sin registrar dominio propio y se acepta servir el frontend desde Catalyst Web Client en lugar de `*.onslate.com`.

---

## 6. DECISIONES QUE REQUIEREN AUTORIZACIÓN EXPLÍCITA DEL OPERADOR

Ninguna de estas decisiones ha sido ejecutada ni asumida. El operador debe confirmar por escrito:

1. **Selección definitiva de topología:** Elegir entre **Alternativa C** (recomendada), **Alternativa A**, **Alternativa B**, o **Web Client *same-origin* sin dominio propio**.
2. **Dominio propio (si elige A, B con Slate, o C):** Confirmar qué dominio registrable propiedad del operador se usará (recordando que `CloudScale Domain Mapping` exige subdominios y no soporta dominio raíz directo).
3. **Proveedor del proxy inverso (si elige C):** Autorizar el servicio elegido (ej. Cloudflare Workers / NGINX / ALB) y su presupuesto/plan.
4. **Verificación en cuenta real Catalyst:** Autorizar posteriormente las comprobaciones sobre capacidades marcadas como `[NO VERIFICADO]` (Domain Mappings en plan actual, CloudScale Dev vs Prod, Redirect URIs de Catalyst Auth, comportamiento de cookies en Safari/Chromium).
5. **Autorización separada para aprovisionamiento e integración:** Esta fase **no** autoriza todavía crear las 5 tablas NoSQL ni desplegar funciones ni modificar Slate.

---

## 7. LISTA DE PRUEBAS DE INTEGRACIÓN SEGÚN LA ALTERNATIVA SELECCIONADA

Todas las pruebas vivas de `tests/06-integration-catalyst-live.spec.ts` permanecen actualmente en **`PENDING (PASS-INTEGRATION)`**. Cuando el operador seleccione una alternativa y autorice su despliegue, se ejecutarán las siguientes pruebas en **Chromium y Safari/WebKit reales**:

### Base Común Obligatoria (Aplicable a A, B, C y Web Client)
- **`INT-01` a `INT-05` e `INT-08`:** Atomicidad condicional en `SystemControl` (`CTRL#SUPERADMIN_COUNT`), detección de `CriteriaMismatch`, unicidad de correo en Catalyst Auth (`INT-03`), propagación de `USER_STATUS.DISABLE` (`INT-04`), latencia p95 `< 5,000 ms` (`INT-05`), y ciclo `SESSION#<sid>` (`INT-08`).
- **`BR-01` a `BR-09`, `BR-15` a `BR-20`:** Recepción real de `Set-Cookie`, cookie jar HTTPS, cumplimiento estricto `__Host-` (sin `Domain=`, `Path=/`, `HttpOnly`, `Secure`, `SameSite=Strict`), bloqueo de `document.cookie`, validación CSRF en los 4 métodos (`POST/PUT/PATCH/DELETE`), logout (`Max-Age=0`), revocación individual vs global, rotación `/refresh` y anti-replay (`401`).

### Pruebas Específicas Adicionales según Alternativa Elegida
- **Si el operador elige Alternativa A (Subdominios *Same-Site* `app.` + `api.`):**
  - **`INT-06` + `BR-11`, `BR-12`, `BR-13`, `BR-14`:** Preflight `OPTIONS` -> `204` sin `*`, reflexión exacta de `https://app.<tudominio>`, `Access-Control-Allow-Credentials: true`, rechazo `403` a orígenes externos, confirmación de que Safari/WebKit ITP y Chromium envían `__Host-vigor_session` de `api.` en peticiones `fetch(..., { credentials: 'include' })` desde `app.`, y verificación de intercambio de identidad Catalyst Auth (`zcAuth.init(req)` / `generateAuthToken()`) en `/bootstrap-profile` y `/exchange`.
- **Si el operador elige Alternativa B (Catalyst API Gateway):**
  - **Validación de pasarela en `INT-06` + `BR-01..BR-15`:** Comprobar explícitamente que API Gateway **no altera ni elimina** `Set-Cookie: __Host-vigor_session`, no añade `Domain=`, reenvía literalmente `Origin`, `Referer`, `Cookie` y `Sec-Fetch-Site` a Advanced I/O, no rompe preflights `OPTIONS` (si es *same-site*) y respeta límites de timeout/throttling.
- **Si el operador elige Alternativa C (Proxy Inverso Dedicado *Same-Origin*):**
  - **`INT-06` + `INT-07` + `BR-01..BR-10`, `BR-14..BR-20`:** Verificar a través del proxy inverso en el dominio final:
    1. Preservación íntegra de `Set-Cookie: __Host-vigor_session` sin `Domain=` ni caché edge (`Cache-Control: no-store`).
    2. Reenvío íntegro de `Origin`, `Cookie` y `Sec-Fetch-Site: same-origin` (sin sobrescritura falsa por el proxy).
    3. Rechazo `403` ante `Sec-Fetch-Site: cross-site` (`BR-10`, `BR-15`).
    4. Funcionamiento completo de login Catalyst Auth (`/__catalyst/sdk/*` y OAuth callbacks) bajo el dominio del proxy y verificación de UI servida desde Slate detrás del proxy.
    5. Sobrecarga de latencia del proxy dentro de margen seguro (`p95 < 5,000 ms` frente a límite 30s de Advanced I/O).
