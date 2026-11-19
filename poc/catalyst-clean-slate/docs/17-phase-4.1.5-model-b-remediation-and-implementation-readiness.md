# VIGORCORE — FASE 4.1.5: PLAN DEFINITIVO DE REMEDIACIÓN Y PREPARACIÓN PARA IMPLEMENTAR EL MODELO B REFINADO

**Fecha:** 2026-11-14  
**Directorio aislado:** `poc/catalyst-clean-slate/`  
**Naturaleza de la fase:** Plan definitivo de remediación, diseño detallado y preparación de implementación (modo estrictamente de solo lectura sobre código e infraestructura).  
**Estado de autorización:** Decisión provisional del operador sobre el **Modelo B Refinado**. Esta fase **NO autoriza** modificar código, crear tablas, habilitar API Gateway ni desplegar en producción.  
**Estado de artefactos:** **0** archivos de código modificados, **0** cambios en tests/dispatcher/guard/política HTTP/app raíz, **0** paquetes instalados, **0** secretos o variables de entorno creadas, **0** tablas/índices/usuarios remotos creados, **0** cambios en Security Rules/DNS/Slate y **0** despliegues o correos enviados.

---

## 1. RESUMEN EJECUTIVO

La Fase 4.1.4 (`docs/16`) identificó cuatro bloqueos estructurales antes de poder implementar el **Modelo B Refinado** sobre `poc/catalyst-clean-slate/`. Esta Fase 4.1.5 fija el plan exacto de remediación, evalúa las alternativas soportadas por Catalyst y define las condiciones verificables que deben cumplirse antes y durante la futura fase de implementación:

1. **Bloqueador 1 — Procedencia y suplantación de cabeceras administrativas `x-zc-*` (`BLOCKER`):**
   - `@zcatalyst/auth-admin` lee `x-zc-projectid`, `x-zc-admin-cred-type`, `x-zc-admin-cred-token` (para `scope: 'admin'`) y `x-zc-user-type`, `x-zc-user-cred-*`, `x-zc-cookie` (para `scope: 'user'`) **directamente desde `req.headers`** sin validación criptográfica dentro de Node.js.
   - No existe en `docs.catalyst.zoho.com` una garantía pública documentada que certifique que el borde de Catalyst elimina o sobrescribe todas las cabeceras `x-zc-*` enviadas por un atacante. Si el borde no las sobrescribiera (o si Node quedase expuesto directamente), un atacante podría ejecutar un ataque *Confused Deputy / Cross-Tenant Injection* enviando su propio `x-zc-projectid` + `x-zc-admin-cred-token`.
   - **Remediación obligatoria:** Confirmación por escrito de Zoho Support + prueba adversarial viva `INT-08` **Y**, si no existe garantía de sanitización en borde, **alternativa nativa soportada en SDK (`type: 'custom'` con `RefreshTokenCredential` server-only)** que desacopla `NoSQL` y `UserManagementAdmin` completamente de `req.headers`, combinada con fijación estricta de `CATALYST_PROJECT_ID` en el servidor.
2. **Bloqueador 2 — Security Rules, `OPTIONS` y API Gateway (`BLOCKER` hasta confirmación Zoho / `INT-06`):**
   - **Security Rules (`authentication: "optional"`):** Permite pasar peticiones HMAC-only hacia Express y es gratuito, pero su especificación solo documenta `GET`, `POST`, `PUT`, `PATCH`, `DELETE` en `methods` (no documenta `OPTIONS`).
   - **API Gateway (`ANY` / por ruta):** Permite `No Authentication` por ruta y desactiva Security Rules al activarse (reversible con `catalyst apig:disable`), con 100,000 req/mes gratis y US$0.000001/req adicional, pero tampoco documenta públicamente si `ANY` incluye `OPTIONS` ni si conserva `Origin`, `Set-Cookie` (`__Host-`) y `Sec-Fetch-Site`.
   - **Decisión:** Mantener como estrategia primaria **Security Rules `"authentication": "optional"`** con defensa `fail-closed` integral en Express, condicionada a validación viva (`INT-06`) y consulta oficial a Zoho Support; conservar **API Gateway** como plan de contingencia documentado si `OPTIONS` no pasara bajo Security Rules.
3. **Bloqueador 3 — Paridad de las 30 rutas (`HIGH` local, remediable en código futuro):**
   - Se diseña la fuente única de verdad **`ROUTE_DEFINITIONS`** que genera automáticamente `CLEAN_SLATE_ENDPOINT_CATALOG` y el despachador HTTP, conectando las **12** rutas `/athlete/*` ausentes en `dispatch()`, unificando los **4** paths `/admin/*` con parámetros `:uid` / `:inviteId`, conectando los filtros `query` de `/admin/users` y `/admin/audit-logs`, registrando la política `OPTIONS`, e imponiendo una prueba automática de paridad estricta en CI/local.
4. **Bloqueador 4 — Política definitiva de sesiones, revalidación de 15 min y rotación de SID (`HIGH` local, remediable en código futuro):**
   - Formaliza **idle 12 h**, **vida absoluta 24 h**, **revalidación `UserManagementAdmin.getUserDetails(uid)` `<= 15 min` en TODAS las rutas protegidas** (y obligatoria en `/refresh` y mutaciones críticas), comportamiento `fail-closed` diferenciando caída temporal de Catalyst (`503` sin renovar ventana ni borrar cookie) frente a usuario `DISABLED`/eliminado (`401`/`403` + revocación + borrado de cookie), coordinación atómica de `lastCatalystCheckAtEpochSec` ante concurrencia y distinción determinista entre micro-ventana de reintento/concurrencia y replay real con escalado `Users.sessionEpoch++`.

---

## 2. MATRIZ DE BLOQUEOS

| ID | Bloqueo | Clasificación Actual | Causa Raíz Verificada | Remediación Definida en este Plan | Condición para Cerrar el Bloqueo |
| :-: | :--- | :---: | :--- | :--- | :--- |
| **B-01** | Procedencia y sanitización de cabeceras `x-zc-*` en `scope: 'admin'` y `scope: 'user'` | **BLOCKER** | `@zcatalyst/auth-admin` lee `req.headers['x-zc-*']` sin firma; docs públicas no garantizan sanitización edge. | Test adversarial local + `INT-08` vivo + pregunta Zoho + fijar `CATALYST_PROJECT_ID` + plan de respaldo `RefreshTokenCredential` (`type: 'custom'`). | Evidencia viva `INT-08` + respuesta Zoho **o** adopción de `RefreshTokenCredential` server-only. |
| **B-02** | Security Rules (`optional`) vs API Gateway (`OPTIONS`, headers, cookies) | **BLOCKER** | Docs no confirman si `OPTIONS` pasa con Security Rules ni si `ANY` en API Gateway cubre `OPTIONS` y preserva `Set-Cookie` / `Sec-Fetch-Site` / `Origin`. | Estrategia primaria Security Rules `optional` + contingencia API Gateway por ruta + lista exacta a Zoho Support. | Respuesta Zoho Support + verificación viva `INT-06` (Advanced I/O + Domain Mapping + `OPTIONS`). |
| **B-03** | Paridad de las 30 rutas (`12 MISSING`, `4 MISMATCH`, `query` ignorados) | **HIGH** | Catálogo descriptivo desacoplado de `if` manuales en `CleanSlateApiDispatcher.dispatch()`. | Diseño de fuente única `ROUTE_DEFINITIONS` + validadores de path + prueba automática de paridad. | Implementación autorizada en código + prueba `PASS-STATIC`/`PASS-UNIT` en verde (30/30 + `OPTIONS`). |
| **B-04** | Política definitiva de sesiones (12h/24h, revalidación 15m universal, concurrencia y rotación `sid`) | **HIGH** | Implementación actual usa Token Catalyst por request (Modelo A), no registra `lastCatalystCheckAtEpochSec` ni `absoluteExpiresAtEpochSec` ni distingue reuso de `sid` rotado. | Especificación de máquina de estados de `SESSION#<sid>`, separación `authenticateViaCatalystExchange` vs `authenticateWithSignedSession`, manejo `503` vs `403`, y escalado `sessionEpoch++`. | Implementación autorizada + suite `PASS-MOCK` adversarial aprobada + `INT-04`/`INT-08`. |

---

## 3. BLOQUEADOR 1 — PROCEDENCIA DE CREDENCIALES ADMINISTRATIVAS (`x-zc-*`)

### 3.1 Auditoría exacta de los paquetes instalados (`@zcatalyst/*`)

Inspeccionado directamente en `poc/catalyst-clean-slate/node_modules/`:

1. **Cabeceras requeridas para `scope: 'admin'` (`@zcatalyst/auth-admin` v1.1.0 + `@zcatalyst/utils` v1.1.0):**
   - **Obligatorias para inicializar (`index.js:102,110` y `credential.js:248-249,266-275`):**
     - `x-zc-projectid` (`PROJECT_HEADER.id`) — falla con `PROJECT_ERROR` si falta.
     - `x-zc-admin-cred-type` (`CREDENTIAL_HEADER.admin_cred_type`: `'token'` o `'ticket'`) — falla con `INVALID_CREDENTIAL` si falta o difiere.
     - `x-zc-admin-cred-token` (`CREDENTIAL_HEADER.admin_token`) — falla con `INVALID_CREDENTIAL` si falta.
   - **Leídas para configuración y dominios de llamada saliente (`index.js:103-124,147-152,220-230`):**
     - `x-zc-project-key` -> reenviada como cabecera `PROJECT_ID`.
     - `x-zc-environment` -> reenviada como `X-Catalyst-Environment` y `Environment`.
     - `x-zc-project-domain`, `x-zc-project-secret-key`.
     - `zc-api-domain` (validada con `isCatalystApiDomain`), `za-portal-domain` (validada con `isCatalystAuthPortalDomain`), `zc-stratus-suffix`, `zc-served-by-cli`.
2. **Cabeceras adicionales para `scope: 'user'` (`credential.js:250-265,276-291`):**
   - `x-zc-user-type` (`CREDENTIAL_HEADER.user`: `'admin'` o `'user'`; en `scope: 'user'` si vale `'admin'` lanza `AUTH_ERROR`).
   - `x-zc-user-cred-type` (`'token'` | `'ticket'`) y `x-zc-user-cred-token`, **o** `x-zc-cookie` (junto con extracción de `ZD_CSRF_TOKEN` para `X-ZCSRF-TOKEN`).
3. **¿Cómo las consume `@zcatalyst/transport` v1.1.0 y `@zcatalyst/nosql` v1.0.0?**
   - `NoSQL` (`@zcatalyst/nosql/dist-es/index.js:47,59`, `table.js:38,56,77,98,116`) incluye `user: CREDENTIAL_USER.admin` en el objeto `request`.
   - Sin embargo, `HttpClient.send()` (`@zcatalyst/transport/dist-es/http-handler.js:300-302`) consulta `this.app.credential.getCurrentUser()` (`this.scope` del `CatalystCredential`) y `this.app.authenticateRequest()` envía el token correspondiente a `this.scope` (`auth-admin/dist-es/index.js:188-218`), ignorando `request.user`.
   - De forma análoga, `UserManagementAdmin` (`@zcatalyst/auth/dist-es/user-management.js:57-215`) solo funciona como `admin` si el `app` fue inicializado con `scope: 'admin'` (salvo la excepción documentada de `resetPassword()` en línea `47`, que marca `user: CREDENTIAL_USER.user` aunque tampoco impide que `HttpClient` use `scope` del `app`!).

### 3.2 Respuestas exactas a las 6 cuestiones de procedencia y confianza

1. **¿Qué cabeceras son necesarias para operaciones `scope: 'admin'`?** Exclusivamente `x-zc-projectid`, `x-zc-admin-cred-type` y `x-zc-admin-cred-token` (más opcionales de proyecto/entorno `x-zc-project-key`, `x-zc-environment`, `x-zc-project-secret-key`, `zc-api-domain`) cuando se usa `zcAuth.init(req, { scope: 'admin' })`.
2. **¿Catalyst las inyecta en el contexto de ejecución?** Sí: el runtime gestionado de Zoho Catalyst (pasarela de entrada hacia Advanced I/O / Basic I/O) inyecta las cabeceras `x-zc-*` en `req.headers` antes de entregar la petición HTTP al servidor Node.js.
3. **¿La infraestructura de Catalyst elimina o sobrescribe las cabeceras homónimas enviadas por un usuario externo?** **`[NO VERIFICADO EN VIVO / NO GARANTIZADO EN DOCS]`**. En un entorno Catalyst gestionado, la pasarela normalmente sobrescribe `x-zc-*` al autenticar y enrutar hacia el contenedor de la función; sin embargo, no tenemos evidencia empírica en el proyecto ni especificación pública que asegure que **todas** (`x-zc-admin-cred-type`, `x-zc-admin-cred-token`, `x-zc-projectid`, `x-zc-project-key`, `x-zc-project-secret-key`, `x-zc-user-type`, `x-zc-user-cred-*`, `x-zc-cookie`, `zc-api-domain`) se eliminan o sobrescriben incondicionalmente incluso en peticiones anónimas bajo `authentication: "optional"` o detrás de un dominio personalizado / API Gateway.
4. **¿Existe documentación oficial que garantice ese comportamiento?** **No.** La búsqueda exhaustiva en `docs.catalyst.zoho.com` muestra el contrato de código `zcAuth.init(req)` / `catalyst.initialize(req)`, pero **no** publica un documento de seguridad que garantice qué cabeceras HTTP externas limpia o sobrescribe la pasarela de Advanced I/O o API Gateway.
5. **¿Puede un atacante falsificar esos valores desde una solicitud HTTP directa?**
   - **Dentro de Node.js (`@zcatalyst/auth-admin`), SÍ es vulnerable por diseño** si una cabecera del cliente sobrevive hasta `req.headers`, porque `auth-admin` no verifica firmas sobre `x-zc-*`.
   - **Impacto exacto en VigorCore si sobrevivieran cabeceras del atacante:**
     - *Escenario 1 (Suplantación de identidad/rol en VigorCore en rutas HMAC):* **No** otorga rol `admin` ni bypass de `__Host-vigor_session`, porque VigorCore deriva `actor.catalystUserId` del token HMAC y el rol desde la tabla `Users`.
     - *Escenario 2 (Confused Deputy / Cross-Tenant DB Injection — CRÍTICO):* Si un atacante enviara su propio `x-zc-projectid` + `x-zc-project-key` + `x-zc-admin-cred-token` pertenecientes a **otro proyecto Catalyst controlado por el atacante**, y Express pasara `req` tal cual a `zcAuth.init(req, { scope: 'admin' })`, el backend de VigorCore consultaría las tablas `Users` y `SystemControl` **del proyecto del atacante**, aceptando un usuario `superadmin` fabricado por el atacante en su propia base NoSQL.
     - *Escenario 3 (DoS o falsificación en `/exchange` si además falsifica proyecto):* Enviando `x-zc-projectid` + `x-zc-user-cred-token` falsos hacia un proyecto propio, falsificaría `getCurrentUser()`.
6. **¿Cómo verificarlo de forma segura en un entorno real sin exponer credenciales (`INT-08`)?**
   - Mediante un endpoint temporal de diagnóstico privado **solo en entorno Development/Staging** (protegido por token HMAC administrativo o clave de prueba de operador, nunca en producción ni loggeando valores en claro) o mediante inspección controlada durante `INT-08`:
     1. El cliente envía desde fuera (sin sesión Catalyst) valores centinela inocuos en `x-zc-projectid: attacker_proj_000`, `x-zc-admin-cred-type: token`, `x-zc-admin-cred-token: attacker_fake_tok`, `x-zc-user-type: user`, `x-zc-user-cred-type: token`, `x-zc-user-cred-token: attacker_user_tok`, `x-zc-cookie: fake=1`, `zc-api-domain: https://evil.example`.
     2. La función comprueba en memoria (sin imprimir nunca ni devolver el valor real de `x-zc-admin-cred-token` ni `x-zc-cookie`) únicamente propiedades booleanas/hashes parciales seguros:
        - `projectIdMatchesExpected`: `req.headers['x-zc-projectid'] === process.env.CATALYST_PROJECT_ID` (esperado: `true`, nunca `'attacker_proj_000'`).
        - `adminTokenOverwrittenOrAbsent`: `req.headers['x-zc-admin-cred-token'] !== 'attacker_fake_tok'`.
        - `userTokenStrippedOrOverwritten`: `req.headers['x-zc-user-cred-token'] !== 'attacker_user_tok'` y `req.headers['x-zc-cookie'] !== 'fake=1'`.
        - `userTypeNotSpoofed`: en petición anónima, `req.headers['x-zc-user-type'] !== 'user'` (o si es `'user'`, sin token del atacante).
        - Ningún valor secreto real sale en JSON ni logs.

### 3.3 Diseño del test adversarial para cabeceras `x-zc-*` falsas

Se especifican dos niveles complementarios (implementación diferida a fase autorizada):

1. **Test local adversarial (`PASS-UNIT / PASS-MOCK` — sin red):**
   - Simula un adaptador HTTP + `CleanSlateAuthGuard` recibiendo peticiones HTTP directas con cabeceras forjadas:
     - `x-zc-user-type: admin`, `x-zc-admin-cred-type: token`, `x-zc-admin-cred-token: ATTACKER_TOKEN`, `x-zc-projectid: ATTACKER_PROJECT_ID`, `x-zc-user-cred-token: ATTACKER_USER_TOKEN`, `x-zc-cookie: attacker=1`.
   - **Afirmaciones obligatorias que debe demostrar el test:**
     - **Aserción 1 (Frontera `/api/v1/admin/*` sin cookie `__Host-vigor_session`):** Devuelve `401 SIGNED_SESSION_REQUIRED` aunque el atacante envíe `x-zc-user-type: admin` y `x-zc-admin-cred-*`.
     - **Aserción 2 (Atleta autenticado con cookie válida + cabeceras `x-zc-*` falsas):**
       - El handler de Express **rechaza (`403 PROJECT_CONTEXT_MISMATCH`)** si `x-zc-projectid` no coincide con `CATALYST_PROJECT_ID` fijado en servidor (bloquea *Cross-Tenant Injection*).
       - Incluso ante cabeceras `x-zc-admin-cred-*` o `x-zc-user-type: admin` inyectadas, el atleta recibe `403 INSUFFICIENT_PRIVILEGES` al intentar `/api/v1/admin/*`.
     - **Aserción 3 (Aislamiento `scope: 'user'` vs `scope: 'admin'`):** Si el conector live usa la fábrica separada `createAdminApp(req)` / `RefreshTokenCredential`, las consultas NoSQL nunca utilizan `x-zc-user-cred-*` y un `x-zc-projectid` distinto al configurado aborta antes de instanciar `@zcatalyst/auth-admin`.
     - **Aserción 4 (Anti-spoofing de cabecera `x-vigor-*` / `x-user-*` / `x-auth-*`):** Sigue devolviendo `403 IDENTITY_SPOOFING_REJECTED`.
2. **Test adversarial en vivo (`INT-08` — contra función desplegada en Catalyst Development):**
   - Petición HTTP real (`curl` / `fetch`) desde Internet hacia el endpoint desplegado de la función inyectando los valores centinela `attacker_*` en todas las cabeceras `x-zc-*` y `zc-*` hacia:
     - `/api/v1/admin/users` (sin cookie) -> debe responder `401` y la telemetría booleana segura del diagnóstico debe demostrar que el edge sobrescribió/descartó las cabeceras `attacker_*`.
     - `/api/v1/auth/session/exchange` (con `x-zc-user-cred-token: attacker_fake_tok`) -> debe responder `401 AUTH_SESSION_INVALID`.

### 3.4 Evaluación de alternativas si Catalyst no garantiza sanitización de `x-zc-*`

| Alternativa | Mecanismo Oficial en `@zcatalyst/auth-admin` | Protección frente a `x-zc-*` falsificadas | Viabilidad y Coste / Tradeoff | Veredicto |
| :--- | :--- | :--- | :--- | :--- |
| **Alt. 1 — Contexto server-only independiente de `req.headers` (`ApplicationCustomCredential` / `RefreshTokenCredential`)** | Verificado en `@zcatalyst/auth-admin/dist-es/index.js:35-44` y `credential.js:173-200,360-382`: `zcAuth.init({ projectId, projectKey, environment, projectDomain, credential: { client_id, client_secret, refresh_token } }, { type: 'custom', appName: 'vigor-admin-server' })`. Instancia singleton en proceso Node para `NoSQL` y `UserManagementAdmin`. | **100% inmune** para toda operación `scope: 'admin'` (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`, `getUserDetails`, `updateUserStatus`), porque **jamás lee `req.headers`**. Combinado con validación `x-zc-projectid === CATALYST_PROJECT_ID` (opcional) y `isCatalystApiDomain` en `scope: 'user'`. | **Oficialmente soportado** por Catalyst (mismo patrón para apps externas en Node/Python). Requiere registrar un Self-Client OAuth en Zoho API Console y gestionar `CATALYST_ADMIN_CLIENT_ID`, `CATALYST_ADMIN_CLIENT_SECRET`, `CATALYST_ADMIN_REFRESH_TOKEN` como secretos de entorno; `RefreshTokenCredential` cachea el `access_token` en memoria y lo renueva automáticamente al expirar. *(Nota: NO usar `getDefaultCredentials()` debido al bug `!isNonEmptyString(!projectId)` en `auth-admin/dist-es/index.js:131`).* | **PLAN DE RESPALDO PRIMARIO (y defensa en profundidad ideal)** si Zoho no certifica o `INT-08` falla. |
| **Alt. 2 — Función interna separada para operaciones administrativas** | Segunda función Advanced I/O o Basic I/O separada. | **Insuficiente por sí sola** si esa segunda función sigue recibiendo tráfico HTTP público y usando `zcAuth.init(req)` sobre `req.headers`. | Añade latencia hop-to-hop (presión sobre el límite de 30s de Advanced I/O), duplica despliegues/reglas y no elimina el vector de cabeceras salvo que se invoque con secreto propio + `RefreshTokenCredential`. | **No recomendada** frente a Alt. 1. |
| **Alt. 3 — Fijación de `projectId`/`apiDomain` + sanitización edge confirmada** | Envolver `req.headers` antes de `zcAuth.init(req, { scope })` sobrescribiendo `x-zc-projectid`, `x-zc-project-key`, `x-zc-environment`, `zc-api-domain` desde variables de entorno del servidor, mientras `x-zc-admin-cred-*` solo se aceptan tras verificar en `INT-08` que Catalyst los inyecta/sobrescribe en el edge. | Mitiga *Cross-Tenant Project Injection* y SSRF de dominio API en Node.js aunque el atacante envíe `x-zc-projectid` falso; sigue dependiendo del edge para `x-zc-admin-cred-token` y `x-zc-user-*`. | Cero secretos OAuth adicionales; menor latencia; requiere confirmación en `INT-08` y Zoho Support. | **Apta solo tras `PASS` en `INT-08` + confirmación Zoho.** |

**Clasificación obligatoria del Bloqueador 1:** Permanece como **`BLOCKER`** hasta completar `INT-08` + respuesta oficial de Zoho (o decidir usar `RefreshTokenCredential` `type: 'custom'` para `scope: 'admin'`).

---

## 4. BLOQUEADOR 2 — SECURITY RULES, `OPTIONS` Y API GATEWAY

### 4.1 Comparación documental y operativa: Opción A vs Opción B

Fuentes consultadas: `https://docs.catalyst.zoho.com/en/serverless/help/security-rules/` y `https://docs.catalyst.zoho.com/en/cloud-scale/help/api-gateway/`.

| Dimensión Evaluada | Opción A: Función Advanced I/O única con Security Rules (`authentication: "optional"`) | Opción B: API Gateway con autenticación opcional y rutas `ANY` / explícitas |
| :--- | :--- | :--- |
| **Mecanismo de borde** | Archivo JSON por función con `methods` (`GET, POST, PUT, PATCH, DELETE`) y `authentication` (`optional` \| `required`). | Proxy HTTP de CloudScale delante de la función con definición de rutas (`/api/v1/...`), método HTTP y tipo de autenticación por ruta (`No Authentication`, `API Key`, `Catalyst Users Authentication`, `OAuth`). |
| **¿Llega `OPTIONS` a Express? / ¿Se incluye en métodos?** | Docs oficiales solo listan `GET`, `POST`, `PUT`, `PATCH`, `DELETE` dentro de `methods` (no listan `OPTIONS`). No está documentado explícitamente si Catalyst pasa `OPTIONS` automáticamente a Advanced I/O o si responde en el borde. Requiere validación `INT-06` y pregunta a Zoho. | Docs oficiales definen `ANY` como agregación exclusiva de los **5 métodos** (`GET`, `PUT`, `POST`, `DELETE`, `PATCH`). Tampoco documentan explícitamente `OPTIONS` dentro de `ANY` ni cómo gestiona API Gateway los preflights CORS si el dominio autorizado está configurado. |
| **¿Se puede desactivar auth en rutas HMAC?** | Sí, globalmente para la función fijando `"authentication": "optional"` (valor por defecto en Security Rules). | Sí, **por ruta**: configurando `No Authentication` en rutas HMAC (`/athlete/*`, `/admin/*`, `/refresh`, `/logout`, `/revoke`) y opcionalmente `Catalyst Users Authentication` (o `No Authentication` + `scope: 'user'` en Express) en `/bootstrap-profile` y `/exchange`. |
| **Preservación de `Origin`, `Set-Cookie` y `Sec-Fetch-Site`** | En Advanced I/O nativo con Domain Mapping aún debe confirmarse en `INT-06` que no reescribe `Set-Cookie: __Host-vigor_session` (sin añadir `Domain=`) ni filtra `Sec-Fetch-Site`/`Origin`. | **No documentado públicamente** en docs de API Gateway si el gateway reescribe `Set-Cookie`, elimina cabeceras `Sec-Fetch-*` o altera `Origin`. Riesgo adicional si el Gateway termina TLS o modifica cookies. |
| **Prevención de política equivocada entre bootstrap y rutas HMAC** | Express aplica un pipeline obligatorio **antes** del router (`ROUTE_DEFINITIONS`) que bifurca estrictamente según `authPolicy` (`catalyst_exchange` vs `hmac_session` vs `catalyst_or_hmac_inspect`), sin rutas anónimas salvo `OPTIONS`. | Aunque API Gateway distinga rutas, Express **nunca debe confiar en que el Gateway autenticó** sin verificar en servidor (`scope: 'user'` para exchange; HMAC + `consistent_read` para sesión); además, en API Gateway un error de orden entre rutas wildcard/`ANY` y rutas exactas podría exponer `scope: 'user'` sin chequeo o bloquear HMAC si se aplicara auth al prefijo incorrecto. |
| **Coste y límites actuales** | Sin coste de puerta de enlace adicional; sujeto a límites propios de Advanced I/O (timeout 30s). | Componente de pago por uso: **100,000 requests/mes gratis**, luego **US$0.000001 por request**; máximo **1,000 APIs por proyecto**. |
| **Reversibilidad** | Inmediata modificando el JSON de Security Rules y redesplegando la configuración. | **100% reversible:** desactivar con `catalyst apig:disable` o desde Consola **reactiva automáticamente Security Rules** conservando intactas las APIs guardadas. |

### 4.2 Decisión recomendada y tratamiento de `OPTIONS`

1. **Arquitectura recomendada (primaria):** **Opción A — Función Advanced I/O única con Security Rules `"authentication": "optional"`** y validación `fail-closed` al 100% dentro de Express.
   - Ventajas: cero coste extra de gateway, menor complejidad de enrutado duplicado, misma superficie de defensa en profundidad dentro de Express y menos capas intermedias susceptibles de alterar `Set-Cookie: __Host-vigor_session` o `Sec-Fetch-Site`.
2. **Plan de contingencia documentado (Opción B):** Si Zoho Support o `INT-06` demostraran que Security Rules bloquea o intercepta `OPTIONS` de modo incompatible con `Access-Control-Allow-Headers: Content-Type, Authorization, X-Vigor-CSRF` y `Access-Control-Allow-Credentials: true` (aun configurando *Authorized Domains* en Catalyst), habilitar API Gateway con rutas explícitas (nunca antes sin probar `INT-06` sobre `Set-Cookie`, `Origin` y `Sec-Fetch-Site`).
3. **Tratamiento obligatorio de `OPTIONS` en Express:**
   - Toda petición `OPTIONS` hacia cualquier `/api/v1/*` debe ser evaluada por `HttpSecurityPolicy.buildCorsHeaders(req)`:
     - Sin cabecera `Origin`: devolver `204` mínimo con `Vary: Origin` (sin emitir `Access-Control-Allow-Origin`).
     - Con `Origin` fuera de allowlist: `403 CORS_ORIGIN_REJECTED`.
     - Con `Origin` en allowlist (`https://app.<dominio>` / entorno configurado): `204` con `Access-Control-Allow-Origin: <origin_exacto>`, `Access-Control-Allow-Credentials: true`, `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`, `Access-Control-Allow-Headers: Content-Type, Authorization, X-Vigor-CSRF`, `Vary: Origin`.
   - Si en Catalyst el borde respondiera automáticamente a `OPTIONS` gracias a *Authorized Domains*, se debe comprobar en `INT-06` qué cabeceras emite exactamente (en particular si incluye `Access-Control-Allow-Headers: Authorization, Content-Type` y `Access-Control-Allow-Credentials: true`). Si Catalyst emitiera `Access-Control-Allow-Origin: *` o omitiera `Authorization` / `Allow-Credentials: true`, **bloquearía el modelo y exigiría ajuste con Zoho o proxy**.

### 4.3 Preguntas concretas obligatorias para Zoho Support (bloque de texto listo para añadir a la consulta de `docs/14`)

1. **Custom Domain + Advanced I/O (ya en `docs/14`):** ¿Soporta Catalyst Domain Mapping mapear `https://api.<dominio-propio>` directamente a una función Advanced I/O en producción/staging sin reescribir la respuesta?
2. **Security Rules y `OPTIONS`:** Cuando una función Advanced I/O tiene Security Rules con `authentication: "optional"` (y `methods: ["GET","POST","PUT","PATCH","DELETE"]`), ¿el preflight `OPTIONS` llega al código Express de la función, o lo responde Catalyst en el borde? Si lo responde Catalyst mediante *Authorized Domains / CORS*, ¿emite `Access-Control-Allow-Credentials: true` y permite la cabecera `Authorization` y `Content-Type` para un origen exacto (sin `*`)?
3. **API Gateway (`ANY` y cabeceras/cookies):** En CloudScale API Gateway, ¿el método `ANY` reenvía `OPTIONS` al backend o solo `GET, POST, PUT, DELETE, PATCH`? ¿API Gateway preserva íntegramente `Origin`, `Sec-Fetch-Site`, `Authorization` y los atributos exactos de respuesta `Set-Cookie: __Host-vigor_session=...; HttpOnly; Secure; SameSite=Strict; Path=/` (sin inyectar `Domain=`)?
4. **Sanitización de cabeceras `x-zc-*`:** En Advanced I/O (tanto detrás de dominio personalizado como detrás de API Gateway), ¿la infraestructura de Catalyst elimina o sobrescribe **siempre** cualquier cabecera entrante `x-zc-admin-cred-*`, `x-zc-user-*`, `x-zc-cookie`, `x-zc-projectid`, `x-zc-project-key` y `zc-api-domain` enviada por un cliente HTTP externo antes de invocar la función Node.js, incluso cuando `authentication` es `"optional"` / `"No Authentication"`?

---

## 5. BLOQUEADOR 3 — PARIDAD DE LAS 30 RUTAS Y DISEÑO DE `ROUTE_DEFINITIONS`

### 5.1 Auditoría consolidada de brechas en `poc/catalyst-clean-slate/src/`

Contrastando `CLEAN_SLATE_ENDPOINT_CATALOG` (`src/routes/apiRouterSchema.ts:44-75`) frente a `CleanSlateApiDispatcher.dispatch()` (`lines 89-342`), `AthleteDataService` (`athleteDataService.ts`) y `AdminGovernanceService` (`adminGovernanceService.ts`):

- **14 rutas `MATCH`** (método y path exactos).
- **12 rutas `MISSING` en `dispatch()`** bajo `/api/v1/athlete/*`: todas poseen métodos y validadores ya implementados en `AthleteDataService` y `domainValidators.ts`. Su ausencia impide operar onboarding, comidas, compras, entrenamientos, cardio, notificaciones, recetas, planes y rutinas vía HTTP.
- **4 rutas `MISMATCH` en `/admin/*`:** el catálogo exige parámetros de ruta (`:inviteId/revoke`, `:uid/status`, `:uid/role`, `:uid/password-reset`), mientras `dispatch()` usa rutas planas leyendo el ID del body JSON.
- **2 rutas `MATCH` con parámetros `query` desconectados:**
  - `GET /api/v1/admin/users` ignora `role`, `accountStatus`, `limit`, `startKey` soportados por `listDirectoryUsers(actor, filter)`.
  - `GET /api/v1/admin/audit-logs` fija `{ globalTimeline: true }` ignorando `month`, `targetUid`, `actorUid`, `dateRangeIso`, `limit`, `startKey` soportados por `listAuditLogs(actor, query)`.
- **1 ruta `EXTRA`:** `OPTIONS *` (necesaria para CORS preflight, actualmente fuera de catálogo).

### 5.2 Matriz definitiva de las 30 rutas + política `OPTIONS`

| # | Método | Path Canónico Objetivo | Tipo de Auth (`authPolicy`) | Roles Permitidos | Control IDOR / Propiedad | Permiso / Escritura | Estado Actual |
| :-: | :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **0** | `OPTIONS` | `*` (preflight CORS) | `cors_preflight` | Público allowlisted `Origin` | Valida `Origin` contra allowlist; nunca lee/escribe datos | Lectura config CORS (`204`) | `EXTRA` |
| **1** | `POST` | `/api/v1/auth/session/bootstrap-profile` | `catalyst_exchange` (`scope:'user'`) | Usuario Catalyst `ACTIVE` + verificado | `uid` desde `getCurrentUser()`; `GSI_Email` + cond. `attribute_not_exists(pk)` | Crea `Users` + `SESSION#<sid>` | `MATCH` |
| **2** | `POST` | `/api/v1/auth/session/exchange` | `catalyst_exchange` (`scope:'user'`) | Usuario registrado en `Users` (`active`) | `uid` desde `getCurrentUser()`; deny-by-default si falta `Users` | Crea `SESSION#<sid>` | `MATCH` |
| **3** | `POST` | `/api/v1/auth/session/refresh` | `hmac_session` | `athlete \| admin \| superadmin` | `sub`/`sid` HMAC + `SESSION#<sid>.ownerUserId === claims.sub` + `getUserDetails` | Rota `oldSid -> newSid` (<=24h abs) | `MATCH` |
| **4** | `POST` | `/api/v1/auth/session/logout` | `hmac_session` | `athlete \| admin \| superadmin` | Solo revoca `SESSION#<claims.sid>` propio | Revoca `SESSION#<sid>` + limpia cookie | `MATCH` |
| **5** | `POST` | `/api/v1/auth/session/revoke` | `hmac_session` | Self o `admin \| superadmin` | Self solo suyo; `admin` bloqueado ante `superadmin`; `getUserDetails` si tercero | Revoca `SESSION#<sid>` o `sessionEpoch++` | `MATCH` |
| **6** | `GET` | `/api/v1/auth/me` | `catalyst_or_hmac_inspect` | Autenticado (`active`) | Si hay cookie: verifica HMAC+`SESSION`+`Users`+ventana 15m; si no: `scope:'user'`+`Users` | Solo lectura | `MATCH` |
| **7** | `GET` | `/api/v1/athlete/workspace` | `hmac_session` | `athlete \| admin \| superadmin` | `pk = USER#<actor.catalystUserId>` (ignora query `uid`) | Solo lectura paginada `<=100` | `MATCH` |
| **8** | `PATCH` | `/api/v1/athlete/profile` | `hmac_session` | `athlete \| admin \| superadmin` | `pk = USER#<actor.catalystUserId>` + rechaza campos de privilegio | Actualiza `Users` propio | `MATCH` |
| **9** | `POST` | `/api/v1/athlete/onboarding/complete` | `hmac_session` | `athlete \| admin \| superadmin` | `pk = USER#<actor.catalystUserId>` en `UserData` y `Users` | `insertBatch` (`BIO`,`PREF`) + `Users` | **`MISSING`** |
| **10** | `POST` | `/api/v1/athlete/meals` | `hmac_session` | `athlete \| admin \| superadmin` | `pk = USER#<actor.catalystUserId>`; ID generado/sanitizado sin `#` | Inserta `MEAL#` en `UserData` | **`MISSING`** |
| **11** | `GET` | `/api/v1/athlete/meals` | `hmac_session` | `athlete \| admin \| superadmin` | `pk = USER#<actor.catalystUserId>` + `SK BETWEEN` fechas | Solo lectura paginada `<=100` | **`MISSING`** |
| **12** | `PUT` | `/api/v1/athlete/groceries/sync` | `hmac_session` | `athlete \| admin \| superadmin` | `pk = USER#<actor.catalystUserId>`; chunks `<=25` | Reemplaza `GROCERY#` del usuario | **`MISSING`** |
| **13** | `POST` | `/api/v1/athlete/workouts/start` | `hmac_session` | `athlete \| admin \| superadmin` | `pk = USER#<actor.catalystUserId>` + fetch previo `consistent_read` | Inserta `WORKOUT#` (`in_progress`) | **`MISSING`** |
| **14** | `POST` | `/api/v1/athlete/workouts/:workoutId/sets` | `hmac_session` | `athlete \| admin \| superadmin` | Verifica padre `WORKOUT#` en `pk = USER#<actor.catalystUserId>` e `in_progress` | Inserta `SET#` en `UserData` | **`MISSING`** |
| **15** | `POST` | `/api/v1/athlete/workouts/:workoutId/complete` | `hmac_session` | `athlete \| admin \| superadmin` | `pk = USER#<actor.catalystUserId>` + lock condicional `version` | Actualiza `WORKOUT#` terminal | **`MISSING`** |
| **16** | `POST` | `/api/v1/athlete/cardio` | `hmac_session` | `athlete \| admin \| superadmin` | `pk = USER#<actor.catalystUserId>` | Inserta `CARDIO#` en `UserData` | **`MISSING`** |
| **17** | `POST` | `/api/v1/athlete/notifications` | `hmac_session` | `athlete \| admin \| superadmin` | `pk = USER#<actor.catalystUserId>` | Inserta `NOTIF#` en `UserData` | **`MISSING`** |
| **18** | `PUT` | `/api/v1/athlete/recipes/:recipeId` | `hmac_session` | `athlete \| admin \| superadmin` | `pk = USER#<actor.catalystUserId>` + `:recipeId` válido + budget 350 KB | Inserta/guarda `RECIPE#` | **`MISSING`** |
| **19** | `PUT` | `/api/v1/athlete/meal-plans/:weekStart` | `hmac_session` | `athlete \| admin \| superadmin` | `pk = USER#<actor.catalystUserId>` + regex `YYYY-MM-DD` + budget 350 KB | Inserta/guarda `PLAN#` | **`MISSING`** |
| **20** | `PUT` | `/api/v1/athlete/routines/:routineId` | `hmac_session` | `athlete \| admin \| superadmin` | `pk = USER#<actor.catalystUserId>` + `:routineId` válido + budget 350 KB | Inserta/guarda `ROUTINE#` | **`MISSING`** |
| **21** | `POST` | `/api/v1/invitations/redeem` | `hmac_session` | `athlete \| admin \| superadmin` | `invite.emailNormalized === caller.normalizedEmail` + SHA-256 `timingSafeEqual` + `getUserDetails` | Bloqueo `pending->redeeming` + `Users.role` + `AuditLogs` | `MATCH` |
| **22** | `GET` | `/api/v1/admin/users` | `hmac_session` | `admin \| superadmin` | `allowTargetUidForAdmin: true`; pasa `query` validada a `listDirectoryUsers` | Solo lectura (`GSI_Directory`/`RoleStatus`) | `MATCH` (query fix) |
| **23** | `GET` | `/api/v1/admin/stats` | `hmac_session` | `admin \| superadmin` | `PERMISSION_MATRIX['users:stats']` | Solo lectura agregada | `MATCH` |
| **24** | `GET` | `/api/v1/admin/users/:uid` | `hmac_session` | `admin \| superadmin` | `:uid` validado contra `SAFE_IDENTIFIER_RE` (sin `#` ni `/`) | Solo lectura `Users` + `AuditLogs` | `MATCH` |
| **25** | `POST` | `/api/v1/admin/invitations` | `hmac_session` | `admin \| superadmin` | `admin` solo invita `athlete`; `superadmin` puede `admin` | Inserta `AdminInvitations` + `AuditLogs` | `MATCH` |
| **26** | `POST` | `/api/v1/admin/invitations/:inviteId/revoke` | `hmac_session` | `admin \| superadmin` | `:inviteId` en path validado (`SAFE_IDENTIFIER_RE`); rechazo `body.inviteId` discrepante | `pending->revoked` + `AuditLogs` | **`MISMATCH`** |
| **27** | `POST` | `/api/v1/admin/users/:uid/status` | `hmac_session` | `admin \| superadmin` | Impide auto-suspensión; `admin` bloqueado ante `superadmin`; `getUserDetails` | Actualiza `Users` + Catalyst `DISABLE`/`ENABLE` | **`MISMATCH`** |
| **28** | `POST` | `/api/v1/admin/users/:uid/role` | `hmac_session` | **`superadmin` únicamente** | Contador `CTRL#SUPERADMIN_COUNT` + saga + `getUserDetails` (deshabilitado por defecto) | Actualiza `Users` + `SystemControl` + `AuditLogs` | **`MISMATCH`** |
| **29** | `POST` | `/api/v1/admin/users/:uid/password-reset` | `hmac_session` | `admin \| superadmin` | `:uid` validado; verifica existencia `Users` + `getUserDetails` | Dispara reset (validar `INT-08`) + `AuditLogs` | **`MISMATCH`** |
| **30** | `GET` | `/api/v1/admin/audit-logs` | `hmac_session` | `admin \| superadmin` | Pasa `month`/`targetUid`/`actorUid`/`dateRangeIso`/`limit`/`startKey` validados | Solo lectura (`AuditLogs`) | `MATCH` (query fix) |

### 5.3 Diseño exacto de la Fuente Única de Verdad (`ROUTE_DEFINITIONS`)

*(Especificación de diseño; prohibido implementarlo en esta fase.)*

1. **Estructura declarativa tipada:**
   ```ts
   export type RouteAuthPolicy =
     | 'cors_preflight'          // Solo OPTIONS *
     | 'catalyst_exchange'       // scope: 'user' -> getCurrentUser()
     | 'hmac_session'            // Cookie __Host-vigor_session + SESSION#<sid> + Users + revalidación 15m
     | 'catalyst_or_hmac_inspect'; // Solo GET /auth/me (cookie prioritaria; fallback scope: 'user')

   export interface RouteDefinition {
     id: string;
     method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'OPTIONS';
     pathPattern: string; // e.g. '/api/v1/athlete/workouts/:workoutId/sets' o '*'
     authPolicy: RouteAuthPolicy;
     requiresCatalystLiveCheck: boolean; // true en /refresh, set-role, set-status, revoke, redeem, password-reset
     requiresCsrf: boolean; // obligatorio true para POST/PUT/PATCH/DELETE
     allowedRoles: readonly UserRole[] | 'ANY_AUTHENTICATED' | 'PREFLIGHT_ALLOWLIST_ONLY';
     allowTargetUidForAdmin: boolean;
     idorBoundary: string;
     writePermissions: string;
     replacesFirebaseMechanism: string;
     limitsAndNotes: string;
     handler: (ctx: DispatchedRouteContext) => Promise<EndpointResponse>;
   }
   ```
2. **Derivación automática del catálogo y del router compilado:**
   - `ROUTE_DEFINITIONS` es la **única lista autoritativa** de los 30 endpoints REST (más la política explícita `OPTIONS` separada o identificada como `authPolicy: 'cors_preflight'`).
   - `CLEAN_SLATE_ENDPOINT_CATALOG` se genera automáticamente mediante `.filter(r => r.method !== 'OPTIONS').map(...)` desde `ROUTE_DEFINITIONS`, eliminando cualquier posibilidad de desfase documental.
   - `CompiledRouteTable` compila cada `pathPattern` una sola vez a regex anclada `^...$`, extrae los segmentos `:param`, **valida cada parámetro con `SAFE_IDENTIFIER_RE = /^[A-Za-z0-9._:-]{1,128}$/`** (prohibiendo explícitamente `#` y `/`, devolviendo `400 INVALID_PATH_PARAMETER` si falla), y rechaza en el arranque duplicados exactos `(method, normalizedPattern)`.
3. **Pipeline único e ineludible en `dispatch(method, path, req)`:**
   - Paso 1: `HttpSecurityPolicy.assertCsrfAndOriginForRequest(method, req)` (si `route.requiresCsrf` o método mutante, `Origin` + `Sec-Fetch-Site`).
   - Paso 2: Si `method === 'OPTIONS'` -> ejecuta política `cors_preflight` (`204`).
   - Paso 3: Resolver ruta en `CompiledRouteTable`; si no hay match -> `404 ROUTE_NOT_FOUND`.
   - Paso 4: Validar `assertNoIdentitySpoofing(req, route.allowTargetUidForAdmin)` + `assertPinnedCatalystProject(req)`.
   - Paso 5: Autenticación obligatoria según `route.authPolicy`:
     - `'catalyst_exchange'` -> `authGuard.authenticateViaCatalystExchange(req)` (`scope: 'user'`).
     - `'hmac_session'` -> `authGuard.authenticateWithSignedSession(req, { forceCatalystCheck: route.requiresCatalystLiveCheck })`.
     - `'catalyst_or_hmac_inspect'` -> si trae cookie `__Host-vigor_session`, valida `'hmac_session'`; si no trae cookie, `'catalyst_exchange'`.
   - Paso 6: Autorización de rol (`actor.role` desde `Users`) contra `route.allowedRoles`.
   - Paso 7: Ejecución de `route.handler(ctx)`.
4. **Detalles específicos para las 12 rutas `/athlete/*` y 2 filtros `/admin/*`:**
   - `POST /athlete/meals`, `POST /athlete/workouts/start`, `POST /athlete/workouts/:workoutId/sets`, `POST /athlete/cardio`, `POST /athlete/notifications`: generar identificador en servidor si el cliente no envía `id` seguro, o validar `SAFE_IDENTIFIER_RE` (sin `#`).
   - `POST /athlete/workouts/:workoutId/sets` y `/complete`: el path aporta `workoutId`; validar que coincida con `body.executedWorkoutId` si viene presente (`400 WORKOUT_ID_MISMATCH` si difiere) y exigir `startedAt` para construir `SK = WORKOUT#<startedAt>#<workoutId>`.
   - `PUT /athlete/meal-plans/:weekStart`: validar formato `^\d{4}-\d{2}-\d{2}$`.
   - `GET /athlete/meals`: leer `query.startDate` y `query.endDate` (obligatorios, formato ISO), `limit` (`<= 100`) y `startKey`.
   - `GET /admin/users` y `GET /admin/audit-logs`: parsear y validar explícitamente los parámetros `query` permitidos y pasarlos a `listDirectoryUsers` / `listAuditLogs`.
   - Nota de tests existentes: corregir en fase autorizada la ruta usada en `tests/07:415` (actualmente prueba CSRF sobre `DELETE /api/v1/athlete/recipes/r1` inexistente en catálogo; cambiar a una ruta mutante real del catálogo, p. ej. `PUT /api/v1/athlete/recipes/r1`).

### 5.4 Especificación de la prueba de paridad estricta

Una nueva prueba en `poc/catalyst-clean-slate/tests/` deberá **fallar automáticamente** si ocurre cualquiera de las siguientes condiciones:
1. `CLEAN_SLATE_ENDPOINT_CATALOG.length !== 30` o falta cualquiera de los 30 endpoints esperados.
2. Existe cualquier clave `(method, pathPattern)` duplicada en `ROUTE_DEFINITIONS` o en `CLEAN_SLATE_ENDPOINT_CATALOG`.
3. Existe algún handler en `CleanSlateApiDispatcher` que no corresponda 1:1 con `ROUTE_DEFINITIONS` (salvo el preflight `OPTIONS`).
4. Alguna entrada de `ROUTE_DEFINITIONS` distinta de `OPTIONS` carece de `authPolicy` válido, carece de `handler` ejecutable o tiene `allowedRoles` vacío.
5. Alguna ruta `POST`, `PUT`, `PATCH` o `DELETE` tiene `requiresCsrf !== true`.
6. Alguna ruta bajo `/api/v1/admin/*` permite `'athlete'`, o `/api/v1/admin/users/:uid/role` permite `'admin'`.
7. Alguna petición sin cookie ni credenciales Catalyst hacia cualquiera de las **29** rutas protegidas (`30` excluyendo preflight `OPTIONS`; incluso `/bootstrap-profile` y `/exchange` deben exigir `scope: 'user'`) devuelve `2xx` (todas deben devolver `401`/`403` antes de ejecutar servicio alguno).

---

## 6. BLOQUEADOR 4 — POLÍTICA DEFINITIVA DE SESIONES, REVALIDACIÓN Y ROTACIÓN DE `sid`

### 6.1 Parámetros normativos de la sesión Modelo B Refinado

| Parámetro | Valor Normativo | Campo / Almacenamiento | Comprobación Exacta |
| :--- | :---: | :--- | :--- |
| **Idle Expiration (ventana por cookie/sesión)** | **12 horas (`43,200 s`)** | `SESSION#<sid>.expiresAtEpochSec` y claim `exp` en HMAC | `sessionRec.expiresAtEpochSec > nowSec` **y** `claims.exp > nowSec` (nunca delegar al TTL asíncrono). |
| **Absolute Expiration (vida máxima total)** | **24 horas (`86,400 s`)** desde autenticación inicial | `SESSION#<sid>.initialAuthAtEpochSec` y `absoluteExpiresAtEpochSec` (= `initialAuthAtEpochSec + 86400`), más claim `abs` opcional en token HMAC | `sessionRec.absoluteExpiresAtEpochSec > nowSec`. En `/refresh`, `absoluteExpiresAtEpochSec` **se hereda intacto** y `newExp = Math.min(nowSec + 43200, absoluteExpiresAtEpochSec)`. |
| **Revalidación de estado Catalyst** | **Máximo 15 minutos (`900 s`)** de antigüedad en **TODAS** las rutas protegidas | `SESSION#<sid>.lastCatalystCheckAtEpochSec` + llamada `UserManagementAdmin.getUserDetails(uid)` (`scope: 'admin'`) | En ruta normal HMAC: si `(nowSec - sessionRec.lastCatalystCheckAtEpochSec) > 900`, revalidar en vivo contra Catalyst `scope: 'admin'`. |
| **Revalidación forzada obligatoria** | **Siempre (`0 s` de caché)** | Ejecución directa de `getUserDetails(uid)` (`scope: 'admin'`) | Obligatoria en `/api/v1/auth/session/refresh`, `/admin/users/:uid/role`, `/admin/users/:uid/status`, `/admin/users/:uid/password-reset`, `/invitations/redeem` y `/auth/session/revoke` sobre tercero. |
| **Criterio de identidad válida en Catalyst** | `ACTIVE` + confirmada | Respuesta `ICatalystUser` de `getUserDetails(uid)` | `details.user_id === uid && String(details.status).toUpperCase() === 'ACTIVE' && details.is_confirmed === true`. |
| **Limpieza de almacenamiento (`TTL`)** | Asíncrono `ttlEpochSec` | `SystemControl.ttlEpochSec` | `ttlEpochSec = absoluteExpiresAtEpochSec + 86400` (solo limpieza de almacenamiento; nunca seguridad). |

### 6.2 Coordinación de solicitudes concurrentes y actualización de `lastCatalystCheckAtEpochSec`

Cuando un usuario mantiene abierta la aplicación tras 15 minutos de inactividad y el frontend dispara múltiples peticiones simultáneas (p. ej. carga de workspace + lectura de comidas + perfil):

1. **Regla de seguridad sobre condición de escritura:**
   - Al completar con éxito `getUserDetails(uid)` (`ACTIVE` y `is_confirmed === true`), el servidor actualiza `SESSION#<sid>` **únicamente con condición `status == 'active'`** (`equals('status', 'active')`) y fijando `lastCatalystCheckAtEpochSec = nowSec`.
   - **Por qué es obligatorio el `status == 'active'` condicional:** impide que una actualización tardía de `lastCatalystCheckAtEpochSec` sobrescriba o reactive accidentalmente un `SESSION#<sid>` que otra petición simultánea (`/logout`, `/revoke` o `/refresh`) acaba de marcar `'revoked'`. Si `updateItem` devuelve `ConditionMismatch` / `CriteriaMismatch`, el servidor re-lee `SESSION#<sid>` con `consistent_read: true`; si está `'revoked'`, rechaza con `401 SESSION_REVOKED_REAUTH_REQUIRED`.
2. **Coalescing en memoria (por instancia Node.js) + tolerancia en concurrencia entre instancias:**
   - Dentro de una misma instancia Node.js, mantener un mapa acotado `inFlightCatalystChecks: Map<string, Promise<CatalystCheckOutcome>>` indexado por `${uid}:${sid}` (limpiado en `finally`) evita enviar 10 llamadas redundantes a `getUserDetails(uid)` si llegan 10 requests en el mismo milisegundo.
   - Entre distintas instancias serverless concurrentes: si dos instancias llaman a `getUserDetails(uid)` al vencerse los 900 s y ambas escriben `lastCatalystCheckAtEpochSec` con condición `status == 'active'` (sin requerir igualdad estricta de `lastCatalystCheckAtEpochSec` anterior), ambas operaciones son **seguras e idempotentes**: no bloquean al usuario legítimo por falsos `409`, y si en paralelo otra petición cambió `status` a `'revoked'`, la condición `status == 'active'` protege la revocación.
   - Además, usar condición compuesta opcional o monotonicidad `lastCatalystCheckAtEpochSec < nowSec` garantiza que nunca retroceda el sello temporal.

### 6.3 Comportamiento estricto ante fallo temporal de Catalyst vs identidad deshabilitada

El código debe distinguir de forma determinista el origen del error al invocar `UserManagementAdmin.getUserDetails(uid)`:

| Resultado de `getUserDetails(uid)` | Significado Autoritativo | Acción sobre `SystemControl` / `Users` | Acción sobre Cookie `__Host-vigor_session` | Código HTTP de Salida |
| :--- | :--- | :--- | :--- | :--- |
| **`status === 'DISABLED'` o `is_confirmed !== true`** | Identidad explícitamente deshabilitada o no confirmada en Catalyst. | Marcar `SESSION#<sid>` como `revoked` (`reason: 'catalyst_user_disabled'`) e incrementar `Users.sessionEpoch++` (revocación inmediata global) con log en `AuditLogs`. | **Borrar cookie** (`Set-Cookie` con `Max-Age=0`) en la respuesta de rechazo. | `403 CATALYST_USER_DISABLED` o `EMAIL_VERIFICATION_REQUIRED` |
| **HTTP `404` / código BaaS explícito de usuario inexistente/eliminado** *(confirmar código exacto en `INT-04`/`INT-08`)* | Usuario eliminado en Catalyst Console. | Marcar `SESSION#<sid>` `revoked` (`reason: 'catalyst_user_deleted'`), marcar `Users.accountStatus = 'suspended'`, `Users.sessionEpoch++`, y auditar. | **Borrar cookie** (`Set-Cookie` con `Max-Age=0`). | `401 CATALYST_USER_NOT_FOUND` |
| **Timeout, error de red (`ECONNREFUSED`, `ETIMEDOUT`) o HTTP `5xx` de Catalyst** | Caída o indisponibilidad temporal de Catalyst BaaS (identidad **no verificable**). | **NO modificar `lastCatalystCheckAtEpochSec`** (prohibido extender artificialmente la ventana de 15 min) y **NO** revocar la sesión por un error transitorio. | **NO borrar la cookie** `__Host-vigor_session`, permitiendo al usuario recuperar sin relogin cuando Catalyst vuelva dentro de la ventana 12h/24h. | **`503 CATALYST_REVALIDATION_UNAVAILABLE`** |

**Reglas absolutas cuando Catalyst no está disponible:**
- Si una ruta protegida normal tiene `(nowSec - lastCatalystCheckAtEpochSec) <= 900`: pasa usando la ventana vigente (hasta completar 15 min máximo).
- Si `(nowSec - lastCatalystCheckAtEpochSec) > 900`, **O** si la ruta es `/refresh` o una mutación crítica: la llamada a `getUserDetails(uid)` es **obligatoria**, y ante caída temporal **DEBE denegar con `503`** (`fail-closed`), sin renovar `lastCatalystCheckAtEpochSec` y sin emitir `Max-Age=0` que destruya la sesión del usuario inocente.

### 6.4 Política de `/api/v1/auth/session/refresh` y rotación segura de `sid`

Se adopta **Opción 1 acotada y fail-closed** en `POST /api/v1/auth/session/refresh`:
1. Exige validación `Origin` + `Sec-Fetch-Site` + `__Host-vigor_session` válido + `Users` (`consistent_read: true`, `accountStatus === 'active'`) + `SESSION#<oldSid>` (`consistent_read: true`).
2. Comprueba `sessionRec.expiresAtEpochSec > nowSec` (idle 12h) **y** `sessionRec.absoluteExpiresAtEpochSec > nowSec` (límite absoluto 24h desde login inicial). Si superó las 24h, rechaza con **`401 SESSION_MAX_LIFETIME_REACHED`** y exige nuevo `/exchange` interactivo con Catalyst.
3. Ejecuta **siempre** `UserManagementAdmin.getUserDetails(uid)` (`scope: 'admin'`) en modo `fail-closed` (aplica tabla 6.3).
4. **Rotación atómica de `sid` y análisis adversarial de falsos positivos vs replay real:**

| Escenario | Qué ocurre en `SystemControl` (`SESSION#<oldSid>`) y `Users` | Respuesta HTTP al Cliente | ¿Dispara `sessionEpoch++` global? | Justificación de Seguridad |
| :--- | :--- | :--- | :---: | :--- |
| **1. Refresh normal exitoso** | `SESSION#<oldSid>` pasa condicionalmente (`status == 'active'`) a `status: 'revoked', revocationReason: 'session_rotated', rotatedAtEpochSec: nowSec`. Luego se inserta `SESSION#<newSid>` heredando `initialAuthAtEpochSec` y `absoluteExpiresAtEpochSec` y con `expiresAtEpochSec = Math.min(nowSec + 43200, absoluteExpiresAtEpochSec)`. | `200` + `Set-Cookie: __Host-vigor_session=<new>` | No | Rotación limpia con vida máxima heredada (máx 24h). |
| **2. Timeout de NoSQL durante `updateItem(oldSid)`** | Lee `SESSION#<oldSid>` con `consistent_read: true`. Si sigue `active`, reintenta condicionalmente. Si ya pasó a `revoked` (`session_rotated`) por efecto del request justo antes del timeout y aún no se emitió `newSid`, aborta seguro (`401 SESSION_ROTATION_UNCERTAIN`). | `401` (exige `/exchange` si no llegó cookie) | No | Evita doble emisión de sesiones activas desde un único `oldSid`. |
| **3. Petición paralela en el navegador (p. ej. `GET /workspace` enviada 200 ms antes de que llegara el `Set-Cookie` de `/refresh`)** | El backend ve `SESSION#<oldSid>` con `status === 'revoked'`, `revocationReason === 'session_rotated'` y **`(nowSec - rotatedAtEpochSec) <= 5`** (micro-ventana de concurrencia de vuelo de **5 s**, aplicada **solo en lecturas/endpoints no-refresh**). | `401 SESSION_ROTATED_RETRY` (**NO** borra cookie si ya pudiera estar actualizándose, **NO** re-emite `newSid`) | **No** (solo en esta micro-ventana `<= 5s` en rutas no-refresh) | Evita cerrar todas las pestañas de un usuario legítimo por una condición de carrera de red en el navegador (que además debe usar un mutex `refreshInFlightPromise` en el cliente). |
| **4. Reintento de red sobre `POST /refresh` cuando `Set-Cookie` de `newSid` se perdió, o envío de `oldSid` > 5 s después de rotar** | `SESSION#<oldSid>` ya figura `status === 'revoked'` y `revocationReason === 'session_rotated'`. Si alguien envía **`POST /refresh`** otra vez con `oldSid`, **o** usa `oldSid` pasada la micro-ventana de **5 s**: **jamás** se re-emite `newSid` ante quien presenta `oldSid` (un atacante que robó `oldSid` podría interceptar el reintento). Se trata como **posible replay / robo de cookie**. | `401 SESSION_REPLAY_DETECTED` + borra cookie (`Max-Age=0`) | **SÍ (`Users.sessionEpoch++`)** | Garantiza detección real de robo de cookie rotada: cierra toda sesión del usuario y exige reautenticación Catalyst en `/exchange`. *(Nota de UX: si una respuesta `/refresh` se pierde en red, el usuario simplemente se reautentica vía Catalyst `scope:'user'`; nunca se sacrifica la detección de robo).* |
| **5. Revocación individual (`POST /auth/session/revoke` / `/logout`)** | `SESSION#<targetSid>` pasa condicionalmente (`status == 'active'`) a `status: 'revoked'` (`user_logout` \| `individual_session_revoked`). Reintentos posteriores de `/logout` devuelven idempotencia limpia solo si `revocationReason === 'user_logout'`; cualquier petición operativa con `targetSid` devuelve `401`. | `200` en primer logout / `401` en uso posterior | No (solo afecta al dispositivo `targetSid`) | Permite cerrar una sola pestaña/dispositivo sin desconectar otros dispositivos del usuario. |
| **6. Revocación global (`scope: 'all'`, suspensión o cambio de rol)** | Incrementa condicionalmente `Users.sessionEpoch++` (esperando `sessionEpoch` actual). | `200` (revocador) / `401` (todas las sesiones antiguas en siguiente request) | **SÍ** | Revocación `O(1)` inmediata en todas las sesiones activas tras `consistent_read: true`. |

---

## 7. ADMINISTRACIÓN DE USUARIOS Y CATALYST SIGNALS

### 7.1 Flujos operativos normales y coordinación sin ACID distribuido

1. **Altas desde VigorCore:**
   - **Auto-registro:** Usuario crea cuenta y verifica email en Catalyst Authentication (`is_confirmed === true`) -> frontend llama `POST /api/v1/auth/session/bootstrap-profile` (`scope: 'user'`). El backend verifica `GSI_Email` + inserta `Users` con condición `attribute_not_exists(pk)` (evitando carreras por doble clic) + crea `SESSION#<sid>`.
   - **Invitación administrativa:** Admin/Superadmin crea invitación en `AdminInvitations` (`POST /api/v1/admin/invitations`) -> atleta se registra en Catalyst + completa `/bootstrap-profile` + canjea en `POST /api/v1/invitations/redeem` (verificando correo normalizado y SHA-256 `timingSafeEqual` + revalidación `getUserDetails` `scope: 'admin'`).
2. **Suspensiones desde VigorCore (`POST /api/v1/admin/users/:uid/status` -> `'suspended'`):**
   - **Orden estricto (cortar primero en sistema autoritativo):** (1) Verificar `getUserDetails(uid)` y `PERMISSION_MATRIX`, (2) actualizar condicionalmente `Users` (`accountStatus: 'suspended'`, `sessionEpoch++`, `roleVersion++`) — protegiendo al último superadmin con `CTRL#SUPERADMIN_COUNT`, (3) invocar `UserManagementAdmin.updateUserStatus(targetUid, USER_STATUS.DISABLE)` (`scope: 'admin'`), (4) registrar en `AuditLogs`.
   - **Recuperación si falla el paso (3):** El usuario ya queda bloqueado inmediatamente en toda la API por `Users` (`consistent_read: true`); registrar marcador `catalystSyncPending: true` en `Users`/audit para que la conciliación reintente `USER_STATUS.DISABLE` de forma idempotente.
3. **Reactivaciones desde VigorCore (`POST /api/v1/admin/users/:uid/status` -> `'active'`):**
   - **Orden estricto inverso (evitar cuenta activa fantasma):** (1) Verificar `getUserDetails(targetUid)` (`scope: 'admin'`) para confirmar que no fue borrado en Catalyst, (2) ejecutar `UserManagementAdmin.updateUserStatus(targetUid, USER_STATUS.ENABLE)`, (3) si tiene éxito, actualizar `Users` (`accountStatus: 'active'`, `sessionEpoch++`, `roleVersion++`) + `AuditLogs`. Si falla Catalyst en (2), abortar con `502`/`503` sin habilitar `Users`.
4. **Conciliación con Catalyst Authentication:**
   - Procedimiento administrativo CLI/job offline que pagina `GSI_Directory` (`USER_SEG#0..3`) frente a `UserManagementAdmin.getAllUsers()` (`scope: 'admin'`) y `CTRL#SUPERADMIN_COUNT`, reportando y reparando bajo ticket de operador:
     - Cuentas `DISABLED` o ausentes en Catalyst que sigan `active` en `Users` -> suspender en `Users` + `sessionEpoch++`.
     - Cuentas con `catalystSyncPending: true` -> re-aplicar `USER_STATUS.DISABLE` / `ENABLE`.
     - Desviación entre `Users` (`GSI_RoleStatus` `superadmin/active`) y `CTRL#SUPERADMIN_COUNT`.
5. **Procedimiento de emergencia para suspensión directa desde Catalyst Console:**
   - **Paso 1 (Emergencia):** El operador deshabilita (`DISABLE`) al usuario en Consola Catalyst (corta inmediatamente nuevos logins y emisión de tokens en `/exchange`).
   - **Paso 2 (Cierre instantáneo si hay panel):** Ejecutar `POST /api/v1/admin/users/:uid/status` (`suspended`) o CLI de emergencia (sube `Users.sessionEpoch++` en `<1 s`).
   - **Paso 3 (Cobertura automática garantizada incluso sin Paso 2):** La revalidación periódica obligatoria de `<= 15 min` (y obligatoria inmediata en `/refresh` y mutaciones críticas) detecta `status === 'DISABLED'` vía `getUserDetails(uid)` (`scope: 'admin'`), revoca `SESSION#<sid>`, incrementa `Users.sessionEpoch++` y borra la cookie.

### 7.2 Limitación documentada de Catalyst Signals

- **Hecho verificado en `docs.catalyst.zoho.com` (Catalyst Signals — Authentication):** El catálogo oficial de eventos publicados por **Authentication** en Catalyst Signals contempla únicamente:
  1. **`user_signedup`** (registro de usuario),
  2. **`user_confirmed`** (confirmación de email/cuenta), y
  3. **`user_deleted`** (eliminación de cuenta).
- **Ausencia crítica:** La **deshabilitación externa (`DISABLE`) en Catalyst Console NO dispone de un evento documentado en Catalyst Signals** ni en Event Listeners heredados. Por tanto, **no existe mecanismo push nativo de Zoho para reaccionar instantáneamente a un `DISABLE` en consola**, lo que vuelve indispensable la política de revalidación activa `<= 15 minutos` + `getUserDetails(uid)` en `/refresh` y mutaciones críticas definida en la Sección 6. (Opcionalmente, suscribirse a `user_deleted` aporta defensa secundaria ante borrado directo en consola).

---

## 8. AUDITORÍA ADICIONAL DEL SOPORTE SDK (MODULAR VS LEGADO)

Verificado directamente en `poc/catalyst-clean-slate/package.json` y `node_modules/@zcatalyst/*/package.json`:

| Paquete | Versión Declarada | Versión Instalada | Origen Oficial | Alcance (`Scope`) y Entorno | Estado frente a Docs Oficiales (`2026-11`) |
| :--- | :---: | :---: | :--- | :--- | :--- |
| `@zcatalyst/auth` | `^1.0.0` | **`1.0.0`** | `catalystbyzoho/zcatalyst-sdk-js` (`packages/auth`) | Node + Browser (`Admin + User`). En Node (`dist-es/node.js:25`), `UserManagement` exporta `UserManagementAdmin`. | **Vigente (SDK JavaScript modular actual)**; reemplaza al monolítico `zcatalyst-sdk-node` v2 (que entró en mantenimiento/deprecación en oct 2026). |
| `@zcatalyst/nosql` | `^1.0.0` | **`1.0.0`** | `catalystbyzoho/zcatalyst-sdk-js` (`packages/nosql`) | Node únicamente (`Admin-only`, `"server-only-package": true`). | **Vigente (SDK JavaScript modular actual)**. |
| `@zcatalyst/auth-admin` | *(transitiva)* | **`1.1.0`** | `catalystbyzoho/zcatalyst-sdk-js` (`packages/auth-admin`) | Node únicamente (`"server-only-package": true`). | **Vigente** (`ZCAuth`, `CatalystCredential`, `RefreshTokenCredential`, `ApplicationCustomCredential`). |
| `@zcatalyst/transport` | *(transitiva)* | **`1.1.0`** | `catalystbyzoho/zcatalyst-sdk-js` (`packages/transport`) | Node / Browser dual export. | **Vigente**. |
| `@zcatalyst/utils` | *(transitiva)* | **`1.1.0`** | `catalystbyzoho/zcatalyst-sdk-js` (`packages/utils`) | Node (`>=22`). | **Vigente**. |

### Diferencias y peculiaridades críticas verificadas en el SDK modular frente al SDK antiguo (`zcatalyst-sdk-node`)

1. **No confundir `catalyst.initialize(req)` (legado) con `zcAuth.init(req, { scope })` (modular):**
   - El SDK antiguo (`zcatalyst-sdk-node`) usaba `catalyst.initialize(req)` síncrono y `app.datastore()` / `app.userManagement()`. En `@zcatalyst/auth`, `zcAuth.init(req, { scope })` es **asíncrono** (`Promise<CatalystApp>`), requiere `node >= 22`, y los componentes se instancian explícitamente con `new NoSQL(adminApp)` y `new UserManagement(app)`.
2. **Trampa de `scope` único en `HttpClient.send()` (`@zcatalyst/transport:300-302`):**
   - Aunque `@zcatalyst/nosql` etiqueta `user: CREDENTIAL_USER.admin` en cada request, `HttpClient.send()` toma las credenciales y `X-CATALYST-USER` exclusivamente de `this.app.credential.getCurrentUser()` (`scope`). Pasar un `userApp` a `new NoSQL(userApp)` **rompe los privilegios admin en NoSQL**. Regla inviolable: dos instancias separadas (`userApp` vs `adminApp`).
3. **Peculiaridad de `UserManagement.resetPassword()` (`@zcatalyst/auth/dist-es/user-management.js:47`):**
   - Marca `user: CREDENTIAL_USER.user` en la petición hacia `/project-user/forgotpassword` (al estar definido en la clase padre `UserManagement` y no en `UserManagementAdmin`). Aunque `HttpClient` usa la credencial de `app` (`scope`), debe comprobarse en `INT-08` que el endpoint BaaS `/project-user/forgotpassword` acepta `admin` + `Zoho-oauthtoken` en Modelo B para `POST /api/v1/admin/users/:uid/password-reset`.
4. **Bug real detectado en `ZCAuth.getDefaultCredentials()` (`@zcatalyst/auth-admin/dist-es/index.js:131`):**
   - `_loadOptionsFromEnvVar` evalúa `if (!isNonEmptyString(!projectId)) return {};` (pasa un booleano `!projectId` a `isNonEmptyString`). Por tanto, **prohibido usar `getDefaultCredentials()`**: si se emplea credencial server-only sin `req.headers`, debe usarse **`zcAuth.init({ projectId, projectKey, environment, projectDomain, credential: { client_id, client_secret, refresh_token } }, { type: 'custom', appName: '...' })`** (`ApplicationCustomCredential`).
5. **Revisión de versiones parche antes de implementar:** Antes de abrir `PASS-INTEGRATION`, revisar `npm view @zcatalyst/auth version` y `@zcatalyst/nosql version` para verificar si existen correcciones `1.x` sobre `@zcatalyst/auth-admin` (como la v1.1.0 ya instalada transitivamente).

---

## 9. PRUEBAS ADVERSARIALES Y PLAN DE VERIFICACIÓN COMPLETO

1. **Suite local obligatoria antes de `PASS-INTEGRATION` (`tests/` cuando se autorice código):**
   - **T-ADV-01 (`x-zc-*` spoofing):** Peticiones directas con `x-zc-admin-cred-token`, `x-zc-admin-cred-type`, `x-zc-projectid`, `x-zc-user-type: admin`, `x-zc-user-cred-token`, `x-zc-cookie` hacia rutas `/admin/*`, `/athlete/*` y `/exchange` demuestran rechazo (`401`/`403`) y aislamiento total de `Users`/`SystemControl`.
   - **T-ADV-02 (`scope: 'user'` vs `scope: 'admin'`):** Espía de transporte demuestra que llamadas `NoSQL` y `getUserDetails` usan exclusivamente credenciales `admin` y que ningún token de usuario en `/exchange` se reutiliza para NoSQL.
   - **T-ADV-03 (Paridad estricta de 30 rutas + `OPTIONS`):** Valida 30/30 en catálogo = `ROUTE_DEFINITIONS`, 0 duplicados, 0 rutas sin `authPolicy`, CSRF en todas las mutaciones, y rechazo `401`/`403` sin credenciales en las 29 rutas aplicables.
   - **T-ADV-04 (Revalidación 15 min + Concurrencia + Caída Catalyst):**
     - `t = +14m59s` -> permite sin llamar `getUserDetails`.
     - `t = +15m01s` con Catalyst `ACTIVE` -> llama `getUserDetails` una sola vez en ráfaga concurrente (coalescing), actualiza `lastCatalystCheckAtEpochSec` con condición `status == 'active'`.
     - `t = +15m01s` con `DISABLED` o `404` -> `403`/`401`, revoca sesión/suspende y borra cookie (`Max-Age=0`).
     - `t = +15m01s` con caída `5xx`/timeout Catalyst -> **`503`**, **NO** actualiza `lastCatalystCheckAtEpochSec` y **NO** emite `Max-Age=0`; al recuperarse Catalyst en `t = +16m`, el siguiente request vuelve a funcionar.
   - **T-ADV-05 (Refresh 24h max + Rotación `sid` + Replay vs Micro-ventana):**
     - Múltiples `/refresh` acumulan máx `24h` (`absoluteExpiresAtEpochSec`); a las `24h+1s` responde `401 SESSION_MAX_LIFETIME_REACHED`.
     - `oldSid` usado en lectura `<= 5s` tras rotar -> `401 SESSION_ROTATED_RETRY` sin subir `sessionEpoch`.
     - `oldSid` usado en `/refresh` o `> 5s` tras rotar -> `401 SESSION_REPLAY_DETECTED`, sube `Users.sessionEpoch++` y tumba todas las sesiones del usuario.
2. **Pruebas vivas obligatorias en Catalyst Development (`INT-06` e `INT-08` antes de producción):**
   - **`INT-06` (CORS, `OPTIONS`, Domain Mapping / API Gateway):** Preflight `OPTIONS` con `Origin: https://app.<dominio>` y `Access-Control-Request-Headers: authorization, content-type`; verificar `204`, `Access-Control-Allow-Credentials: true`, ausencia de `*`, y recepción real de `Set-Cookie: __Host-vigor_session=...; HttpOnly; Secure; SameSite=Strict; Path=/` (sin `Domain=`) y `Sec-Fetch-Site: same-site` en Chromium y WebKit/Safari (`BR-01..BR-20`).
   - **`INT-08` (Sanitización edge `x-zc-*` + `scope` real + `getUserDetails` + `resetPassword`):**
     - Enviar cabeceras centinela `x-zc-admin-cred-token: attacker_*` y `x-zc-projectid: attacker_*` desde el exterior hacia la función desplegada y verificar mediante diagnóstico booleano seguro que el borde las sobrescribió/eliminó.
     - Verificar `getUserDetails(uid)` real para usuario `ACTIVE`, `DISABLED` y usuario eliminado (anotando código HTTP/BaaS exacto de usuario borrado).
     - Verificar `resetPassword()` bajo configuración real de `adminApp`.

---

## 10. DEPENDENCIAS DE SOPORTE ZOHO Y SECUENCIA DE IMPLEMENTACIÓN FUTURA

### 10.1 Dependencias externas bloqueantes (Zoho)
1. Confirmación escrita de Zoho Support (`support@zohocatalyst.com`) sobre las 4 preguntas de la Sección 4.3 (Domain Mapping para Advanced I/O, `OPTIONS` en Security Rules/API Gateway, preservación de `Set-Cookie`/`Origin`/`Sec-Fetch-Site`, y sanitización edge de `x-zc-*`).
2. Adquisición de dominio propio (`<dominio-propio>`) y verificación en Chromium/Safari (`INT-06`, `INT-07`) cuando el operador lo autorice.

### 10.2 Secuencia ordenada de implementación futura *(SOLO cuando el operador lo autorice expresamente)*

| Paso | Fase Futura Sugerida | Alcance Exacto | Bloqueos Previos Requeridos |
| :-: | :--- | :--- | :--- |
| **1** | **Consulta Zoho Support + Decisión Auth** | Enviar ticket combinado (`docs/14` + Sec. 4.3). Decidir si `scope: 'admin'` usa edge sanitizado + `CATALYST_PROJECT_ID` fijo o `RefreshTokenCredential` (`type: 'custom'`). | Aprobación del operador (esta fase). |
| **2** | **Remediación de código POC (`poc/catalyst-clean-slate/src/` y `tests/`)** | (a) Añadir `'Authorization'` y env origins en `HttpSecurityPolicy`; (b) Implementar `ROUTE_DEFINITIONS` (30 rutas + `OPTIONS`, 12 `/athlete/*`, 4 `/admin/*` `:id`, filtros `query`); (c) Implementar `CleanSlateAuthGuard` Modelo B (12h/24h, revalidación 15m universal, concurrencia/503, replay `sid`, fábricas separadas `user`/`admin`, validación `CATALYST_PROJECT_ID`); (d) Agregar pruebas `T-ADV-01..05` y paridad estricta (`tsc` + `node --test`). | Paso 1 aprobado por operador. |
| **3** | **Aprovisionamiento controlado 5 tablas (vacías)** | Ejecutar manualmente `Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl` (runbook `docs/07` / `docs/11`) y verificar con `tests/08` (`--live --confirm-readonly`). | Paso 2 en verde + autorización explícita de aprovisionamiento. |
| **4** | **Despliegue en Development + `INT-01..INT-08` + `BR-01..BR-20`** | Desplegar función Advanced I/O con Security Rules `"authentication": "optional"` (o API Gateway si `OPTIONS` fallara), ejecutar `INT-01..08` (especialmente `INT-06` `OPTIONS`/`Set-Cookie` e `INT-08` `x-zc-*`/`getUserDetails`/`resetPassword`). | Paso 3 + respuesta Zoho. |
| **5** | **Gate de Producción (`PASS-INTEGRATION`)** | Evaluar criterios 1..8 de Sección 11 con evidencia real en verde antes de bootstrap offline de superadmin en producción. | Todos los `INT-*` y `BR-*` en `PASS`. |

---

## 11. CRITERIOS DE ACEPTACIÓN (EVALUACIÓN HONESTA ACTUAL VS OBJETIVO)

| # | Criterio de Aceptación | Estado Actual (Pre-Implementación / Sin Pruebas Vivas) | Evidencia Requerida para Responder **SÍ** Definitivo |
| :-: | :--- | :---: | :--- |
| **1** | **¿Las cabeceras administrativas están protegidas contra suplantación?** | **`BLOCKER` (Parcialmente diseñado, sin prueba edge viva)** | Confirmación Zoho + `INT-08` demostrando sobrescritura edge de `x-zc-*` **o** activación de `RefreshTokenCredential` server-only + `assertPinnedCatalystProject` + `T-ADV-01` en verde. |
| **2** | **¿El preflight (`OPTIONS`) llega a Express?** | **`BLOCKER` (No documentado en docs públicas de Zoho)** | Respuesta de Zoho Support + `INT-06` demostrando `OPTIONS` `204` con `Access-Control-Allow-Credentials: true` y `Authorization` en `Allow-Headers` bajo navegador real. |
| **3** | **¿Todas las rutas tienen handler y política de autorización?** | **`NO` actualmente (`12 MISSING`, `4 MISMATCH`); remediación diseñada** | Implementación de `ROUTE_DEFINITIONS` (30 rutas + `OPTIONS`) + prueba automática de paridad estricta en verde. |
| **4** | **¿El estado Catalyst se revalida con una ventana máxima definida?** | **`NO` en código actual (usa Modelo A); remediación diseñada** | Implementación de `lastCatalystCheckAtEpochSec <= 900 s` en todas las rutas protegidas + chequeo obligatorio en `/refresh` y críticas + `T-ADV-04` + `INT-08`. |
| **5** | **¿El refresh no permite extender indefinidamente las sesiones?** | **`NO` en código actual (`refresh` no fija tope 24h); remediación diseñada** | Implementación de `absoluteExpiresAtEpochSec` (`initialAuth + 86400s`) inmutable al rotar + `T-ADV-05` rechazando `>= 24h` con `401 SESSION_MAX_LIFETIME_REACHED`. |
| **6** | **¿La rotación de SID diferencia los reintentos legítimos del replay?** | **`NO` en código actual; diseño definido en Sec. 6.4** | Implementación de `rotatedAtEpochSec` (micro-ventana `<= 5s` en rutas no-refresh sin escalado) vs escalado global `sessionEpoch++` en `/refresh` repetido o `> 5s` + `T-ADV-05`. |
| **7** | **¿La identidad de usuario procede exclusivamente de una fuente verificada?** | **Condicionado a `B-01` (`SÍ` en lógica HMAC/`Users`, `BLOCKER` en `x-zc-projectid` edge hasta remediación)** | En `/exchange` y `/bootstrap-profile`: `getCurrentUser()` (`scope: 'user'`) + `CATALYST_PROJECT_ID` fijado; en resto: firma HMAC-SHA256 tiempo constante + `Users` y `SESSION#<sid>` (`consistent_read: true`) + `T-ADV-01` y `INT-08`. |
| **8** | **¿Las funciones administrativas no dependen de información manipulable del navegador?** | **Condicionado a `B-01` y `B-03` (`SÍ` en roles/IDOR, pendiente cerrar `:uid` en path y `x-zc-*`)** | `actor.role` leído exclusivamente de `Users`, `assertNoIdentitySpoofing`, rutas `/admin/*` unificadas con `:uid`/`:inviteId` validados, y `scope: 'admin'` protegido contra `x-zc-*` (`T-ADV-01/02/03`). |

**Regla de honestidad técnica:** Mientras los criterios **1** y **2** carezcan de evidencia viva (`INT-06`, `INT-08` / Zoho Support) o alternativa server-only implementada, **permanecen clasificados como `BLOCKER`**. Los criterios **3, 4, 5, 6, 7 y 8** pasarán a **SÍ** únicamente tras ejecutar la fase autorizada de código y pruebas.

---

## 12. DECISIONES QUE REQUIEREN AUTORIZACIÓN EXPLÍCITA DEL OPERADOR

1. **Aprobar el Plan de Remediación de `docs/17`** (Modelo B Refinado con idle **12 h**, vida absoluta **24 h**, revalidación Catalyst universal **`<= 15 min`**, micro-ventana `<= 5s` en lecturas concurrentes y escalado global `sessionEpoch++` ante replay real).
2. **Decidir estrategia de credenciales administrativas ante Bloqueador 1 (`x-zc-*`):**
   - **(A)** Esperar primero resultado de consulta a Zoho Support + `INT-08` fijando `CATALYST_PROJECT_ID` en servidor, **o**
   - **(B)** Adoptar desde el inicio `ApplicationCustomCredential` (`RefreshTokenCredential` server-only) para `scope: 'admin'` de modo que `NoSQL` y `UserManagementAdmin` no dependan en absoluto de cabeceras entrantes.
3. **Autorizar el envío de la consulta técnica combinada a Zoho Support** (`docs/14` + preguntas de la Sección 4.3 sobre `OPTIONS`, `Set-Cookie`, `Sec-Fetch-Site` y sanitización edge de `x-zc-*`).
4. **Autorizar (en una fase separada posterior)** la implementación de los cambios de código y pruebas de remediación dentro de `poc/catalyst-clean-slate/src/` y `tests/` (sin tocar aún infraestructura remota ni tablas hasta completar la suite local).
