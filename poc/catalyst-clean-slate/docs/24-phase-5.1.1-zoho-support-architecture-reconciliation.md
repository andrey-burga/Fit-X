# FASE 5.1.1 — RECONCILIACIÓN OFICIAL CON RESPUESTA DE SOPORTE ZOHO CATALYST, ARQUITECTURA DE AUTENTICACIÓN DUAL Y PREPARACIÓN DEL API GATEWAY

**Alcance:** Exclusivo dentro de `poc/catalyst-clean-slate/`  
**Fecha de reconciliación:** 17 de noviembre de 2026  
**Dictamen final honesto:** **`RECONCILIATION_PARTIAL`** *(Reconciliación arquitectónica, código dual `hosted_native` / `external_oauth`, soporte `platform_managed` CORS, matriz completa 41/41 rutas API Gateway, auditoría de impacto global de `apig:enable`, corrección de paginación `getAdminStats` > 400 usuarios y `81 / 81` pruebas locales completadas; verificación en vivo contra edge Catalyst real, `x-zc-admin-cred-token` en `NO_AUTHENTICATION`, `Origin`/`Referer`/`Sec-Fetch-Site` passthrough, Chromium preflight `OPTIONS` en `api.vigorcore.lat`, Safari/WebKit `SameSite=Strict` e `INT-01..INT-08` permanecen en **`PENDING-LIVE-VERIFICATION`**).*

---

## 1. Resumen Ejecutivo de Cambios Derivados de la Respuesta Oficial de Zoho (17-nov-2026)

1. **Topología de dominio confirmada (Alternativa B oficial):** Zoho Catalyst Slate permanece en `https://app.vigorcore.lat`; el backend Advanced I/O se expone en `https://api.vigorcore.lat` mediante **CloudScale > Domain Mapping** (entorno `Production` + registro DNS `CNAME`) detrás de **API Gateway**, **sin requerir Web Client Hosting**. Al compartir el dominio registrable `vigorcore.lat`, se elimina el bloqueo *cross-site* para cookies `__Host-vigor_session; HttpOnly; Secure; SameSite=Strict; Path=/`.
2. **Reescritura de rutas del API Gateway:** Todo tráfico `/api/v1/*` en `api.vigorcore.lat` se reescribe a `/server/<fnName>/api/v1/*` (y `/health` a `/server/<fnName>/health`). `normalizeCatalystPath()` (`src/server/advancedIoApp.ts`) y `verifyGatewayRewriteCoverage()` (`src/provisioning/domainGatewayConfigs.ts`) verifican las **41 / 41** rutas canónicas.
3. **Autenticación nativa dentro de Advanced I/O (`hosted_native`) vs OAuth externo (`external_oauth`):** Zoho confirmó que `ApplicationCustomCredential` (`SDK-01`) **no es necesario** dentro de una función Advanced I/O alojada en Catalyst, donde el patrón oficial es `zcAuth.init(req, { scope: 'admin' | 'user' })`. VigorCore adopta un **modo dual (`ADR-002`)** con `HostedNativeCatalystAuthRuntime` (`VIGOR_CATALYST_AUTH_MODE=hosted_native`) como primario en servidor alojado y conserva `CatalystAdminAppProvider` (`external_oauth`) para desarrollo externo, CLI `--live --confirm-readonly`, bootstrap offline y fallback operativo.
4. **CORS sin iFrame y modo `platform_managed`:** CloudScale > Whitelisting > Authorized Domains (`https://app.vigorcore.lat`) habilita CORS sin iFrame. Se añade `VIGOR_CORS_MODE=platform_managed` en `HttpSecurityPolicy` para suprimir cabeceras `Access-Control-*` duplicadas manteniendo validación *fail-closed* de `Origin`, `Referer`, Fetch Metadata y `X-Vigor-CSRF`.
5. **Impacto global de activar API Gateway:** Activar API Gateway desactiva **Project Security Rules globalmente**. Se documenta inventario obligatorio, equivalencia regla-a-ruta, transición ordenada, verificación y rollback inmediato (`catalyst apig:disable`) sin ejecutar activación remota.
6. **Corrección de paginación en `getAdminStats`:** `AdminGovernanceService.getAdminStats()` deja de leer una sola página de 100 por shard y recorre todos los cursores `startKey` de `USER_SEG#0..3` en `GSI_Directory`, verificado con > 465 usuarios sintéticos.

---

## 2. Reconciliación de Dominio, CloudScale Domain Mapping y Reescritura API Gateway

| Elemento | Decisión Reconciliada (17-nov-2026) | Referencia en Código / Candidato | Estado |
| --- | --- | --- | --- |
| **Frontend Slate** | Permanece intacto en `https://app.vigorcore.lat` *(no modificado en POC)* | `domainGatewayConfigs.ts` | Confirmado (sin cambios en prod) |
| **Backend API** | `https://api.vigorcore.lat` via **CloudScale > Domain Mapping** (`Production` + `CNAME`) | `buildAlternativeBConfig()` + `config/candidates/alternative-b-api-gateway.routes.json` | **`CANDIDATE_NOT_APPLIED`** (`applied: false`) |
| **Web Client Hosting** | **No requerido** (API Gateway enruta directo a Advanced I/O) | `domainMapping.webClientHostingRequired: false` | Confirmado |
| **Reescritura Gateway** | `/api/v1/*` → `/server/<fnName>/api/v1/*`; `/health` → `/server/<fnName>/health` | `normalizeCatalystPath()` + `verifyGatewayRewriteCoverage('vigor_api')` → **`41 / 41`** | **`[PASS-UNIT]` / `[PASS-LOOPBACK]`** |
| **Cookies Same-Site** | `app.vigorcore.lat` ↔ `api.vigorcore.lat` (`SameSite=Strict`, `__Host-vigor_session`, zero `SameSite=None`) | `assertStrictCookieAttributes()` + `httpSecurityPolicy.ts` | Local `[PASS-LOOPBACK]`; real Safari/Chromium **`PENDING-LIVE-VERIFICATION`** |

---

## 3. ADR de Autenticación: `hosted_native` (`zcAuth.init`) vs `external_oauth` (`CatalystAdminAppProvider`)

Formalizado en `HOSTED_VS_EXTERNAL_AUTH_ADR` (`ADR-002-CATALYST-AUTH-DUAL-MODE`, `src/sdk/catalystSdkBridge.ts`):

| Dimensión | Opción A — `VIGOR_CATALYST_AUTH_MODE=hosted_native` *(Primaria en Advanced I/O)* | Opción B — `VIGOR_CATALYST_AUTH_MODE=external_oauth` *(Obligatoria fuera de Advanced I/O y Fallback)* |
| --- | --- | --- |
| **Mecanismo SDK real** | Instancia fresca aislada `new ZCAuth().init({ headers: sanitizedHeaders }, { type: 'advancedio', scope: 'admin' \| 'user' })` con `AsyncLocalStorage<CatalystApp>` por petición. | `CatalystAdminAppProvider` (`new CatalystApp` + `RefreshTokenCredential` / `AccessTokenCredential`) para admin/NoSQL + `CatalystSeparatedAuthRuntime` para `scope: 'user'`. |
| **Credenciales externas requeridas** | **Elimina** `CATALYST_ADMIN_CLIENT_ID`, `CATALYST_ADMIN_CLIENT_SECRET`, `CATALYST_ADMIN_REFRESH_TOKEN` (y hace opcional `CATALYST_PROJECT_KEY` si el edge inyecta `x-zc-project-key`). | **Requiere** `CATALYST_PROJECT_KEY` + `CATALYST_ADMIN_CLIENT_ID / SECRET / REFRESH_TOKEN`. |
| **Dónde es obligatorio** | Función Advanced I/O desplegada tras confirmar `x-zc-admin-cred-token` en live. | Servidores Node/Express externos, CLI `--live --confirm-readonly`, bootstrap offline superadmin y rutas `NO_AUTHENTICATION` si el Gateway no inyectara `x-zc-admin-cred-token`. |
| **Mitigación `SDK-01..SDK-05`** | No usa `ApplicationCustomCredential` ni `getDefaultCredentials()`, evita estado compartido `[DEFAULT]` / `appOptions` mediante `new ZCAuth()` + `AsyncLocalStorage`, fija `apiDomain`/`accountsUrl`/`projectId`/`projectKey` server-side y bloquea `zc-api-domain` inyectado y `x-zc-user-type: admin`. | Mantiene vigentes `SDK-01..SDK-05` intactos y verificados en Test 62 (`tests/15`) — no se descarta ni se debilita Test 62. |
| **Comportamiento fail-closed** | Si faltan `x-zc-admin-cred-type` / `x-zc-admin-cred-token` → `503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE`. Si `x-zc-projectid` / `key` / `environment` discrepan → `403 PROJECT_CONTEXT_MISMATCH`. Si `x-zc-user-type: admin` entra en `getCurrentUserFromRequest` → `403 CATALYST_ADMIN_HEADER_SPOOFED`. | `CatalystAdminAppProvider` rechaza placeholders, HTTP fuera de loopback y mezcla dev/prod; `CatalystSeparatedAuthRuntime` rechaza `x-zc-user-type: admin` (`403`) y discrepancias de proyecto. |

**Nota crítica sobre `CatalystCredential(..., 'user')` verificada en `node_modules/@zcatalyst/auth-admin@1.1.0/dist-es/credential.js`:**
- Incluso en `scope: 'user'`, el constructor de `CatalystCredential` exige `x-zc-admin-cred-type` y `x-zc-admin-cred-token` además de `x-zc-user-cred-token` / `x-zc-cookie`.
- Las rutas `NO_AUTHENTICATION` que dependen de `NoSQL` en `hosted_native` suponen que API Gateway sigue inyectando `x-zc-admin-cred-token` hacia Advanced I/O. Como esa inyección en `NO_AUTHENTICATION` **no ha sido observada en vivo**, se marca **`PENDING-LIVE-VERIFICATION`** y se mantiene `external_oauth` listo como fallback sin rediseño.

---

## 4. Cabeceras de Seguridad, Anti-Spoofing y Defensa en Profundidad

1. **Nunca confiar ciegamente en `Origin`, `Referer` o `Sec-Fetch-Site` en el edge:** Aunque Zoho declaró que Catalyst sobrescribe determinadas cabeceras `x-zc-*` en la entrada alojada, **no** se asume que `Origin`, `Referer` o `Sec-Fetch-Site` lleguen intactas o no sean normalizadas/eliminadas por el API Gateway (`PENDING-LIVE-VERIFICATION`). Por ello, el token criptográfico **`X-Vigor-CSRF` ligado a `(sub, sid, sessionEpoch, kid)`** permanece obligatorio en todas las mutaciones autenticadas independientemente de Fetch Metadata.
2. **Validación anti-spoofing mantenida:**
   - Pinning estricto de `CATALYST_PROJECT_ID`, `CATALYST_PROJECT_KEY` (si configurado), `CATALYST_ENVIRONMENT`, `CATALYST_API_DOMAIN` y `CATALYST_ACCOUNTS_URL` (neutraliza inyección de `zc-api-domain` o `za-portal-domain`).
   - Rechazo inmediato `403 CATALYST_ADMIN_HEADER_SPOOFED` cuando un caller envía `x-zc-user-type: admin` en endpoints de sesión de usuario (`resolveVerifiedCatalystIdentity` en `cleanSlateAuthGuard.ts` actualizado para preservar códigos explícitos `403`).
   - `/health` y `/api/v1/health` permanecen fuera del contexto administrativo y responden únicamente metadatos no sensibles (`service`, `routeCount`, `status`).

---

## 5. Estrategia Dual CORS, `OPTIONS` y CSRF (`express_enforced` vs `platform_managed`)

Zoho confirmó que **CloudScale > Whitelisting > Authorized Domains (`https://app.vigorcore.lat`)** habilita CORS sin iFrame.

| Aspecto | `VIGOR_CORS_MODE=express_enforced` | `VIGOR_CORS_MODE=platform_managed` *(Reconciliado para CloudScale Authorized Domains)* |
| --- | --- | --- |
| **Validación `Origin` en Express** | Fail-closed (`403 CORS_ORIGIN_REJECTED` si no está en `VIGOR_ALLOWED_ORIGINS`; prohíbe `*`). | Idéntica validación fail-closed (`403 CORS_ORIGIN_REJECTED` para orígenes no autorizados). |
| **Cabeceras emitidas por Express** | `Access-Control-Allow-Origin: https://app.vigorcore.lat`, `Access-Control-Allow-Credentials: true`, `Vary: Origin`, `Allow-Methods`, `Allow-Headers: Content-Type, X-Vigor-CSRF, X-Vigor-Requested-With`. | Únicamente **`Vary: Origin`** (omite `Access-Control-Allow-*` para evitar duplicación con las cabeceras emitidas por CloudScale Authorized Domains). |
| **Preflight `OPTIONS`** | `204` desde Express con cabeceras CORS completas. | `204` con `Vary: Origin` y cero duplicación `Access-Control-*`; edge CloudScale responde CORS al navegador. |
| **CSRF + Fetch Metadata + `X-Vigor-CSRF`** | Obligatorios en `POST`, `PUT`, `PATCH`, `DELETE`. | Obligatorios sin cambios (`CSRF_CROSS_SITE_REJECTED`, `CSRF_TOKEN_MISSING`, firma ligada a `sid/sub/ep`). |

### Matriz de Verificación CORS / `OPTIONS` / Fetch (`credentials: 'include'`)
*(Construida programáticamente en `buildCorsOptionsMatrix()`; pruebas locales `[PASS-LOOPBACK]`, comportamiento Chromium/Safari real contra Gateway **`PENDING-LIVE-VERIFICATION`**)*

- **`OPTIONS`**: `Origin: https://app.vigorcore.lat`, `Access-Control-Request-Method`, `Access-Control-Request-Headers (Content-Type, X-Vigor-CSRF, X-Vigor-Requested-With)` → `204`.
- **`GET`**: `Origin`, `Cookie: __Host-vigor_session`, `credentials: 'include'` → `200` (o `401` si falta/caduca cookie).
- **`POST` / `PUT` / `PATCH` / `DELETE`**: `Origin` (allowlist), `Sec-Fetch-Site` (rechaza `cross-site`), `Content-Type: application/json`, `X-Vigor-Requested-With: XMLHttpRequest` (bootstrap/exchange) o `X-Vigor-CSRF` firmado (mutaciones post-exchange), `Cookie: __Host-vigor_session` (`credentials: 'include'`).

---

## 6. Clasificación de Seguridad de las 41 Rutas en Catalyst API Gateway (`ROUTE_GATEWAY_AUTH_MATRIX`)

Verificado `41 / 41` mediante `verifyGatewayAuthMatrixCompleteness()` (cero rutas omitidas, cero sobrantes, cero imposición global de `OAuth ZohoCatalyst.Functions.Execute`):

| Grupo de Rutas | Rutas Canónicas (41 + `/health` + `OPTIONS`) | Auth Recomendada en API Gateway | Fallback Gateway | Por qué NO se impone `OAuth ZohoCatalyst.Functions.Execute` | Controles Activos en Backend VigorCore |
| --- | --- | --- | --- | --- | --- |
| **Pre-sesión Catalyst User** (`2`) | `POST /api/v1/auth/session/bootstrap-profile`, `POST /api/v1/auth/session/exchange` | `CATALYST_USERS_AUTHENTICATION` | `NO_AUTHENTICATION` *(si edge no inyecta cookie/token correctamente en Gateway Users Auth)* | OAuth M2M de Zoho API no aplica a sesiones web de usuarios Catalyst en Slate (`app.vigorcore.lat`). | Catalyst `scope: 'user'`, bloqueo `x-zc-user-type: admin`, `GSI_Email` único con `consistent_read`, pre-session CSRF, emisión `__Host-vigor_session` + `X-Vigor-CSRF`. |
| **Ciclo de sesión HMAC** (`3`) | `POST /api/v1/auth/session/refresh`, `/logout`, `/revoke` | `NO_AUTHENTICATION` | `NO_AUTHENTICATION` | El cliente autentica con cookie `HttpOnly SameSite=Strict` propia del backend y token CSRF ligado a `sid`. | Firma HMAC-SHA256 `timingSafeEqual`, `SystemControl SESSION#<sid>` consistente, tope 12h/24h, replay guard (`sessionEpoch++`), bound `X-Vigor-CSRF`. |
| **Inspección de perfil** (`1`) | `GET /api/v1/auth/me` | `NO_AUTHENTICATION` | `NO_AUTHENTICATION` | Soporta cookie `__Host-vigor_session` o inspección `catalyst_or_hmac_inspect`. | *Deny-by-default* si falta registro en `Users`; `consistent_read: true`. |
| **Atleta / Workspace** (`25`) | `GET/POST/PUT/PATCH/DELETE /api/v1/athlete/*` (workspace, profile, onboarding, biometrics, preferences, meals, groceries, workouts, sets, cardio, notifications, recipes, meal-plans, routines) | `NO_AUTHENTICATION` | `NO_AUTHENTICATION` | Tráfico autenticado por `__Host-vigor_session` tras `exchange`; requerir `ZohoCatalyst.Functions.Execute` rompería UX browser/cookies. | HMAC cookie + `SESSION#<sid>` + `Users` consistente + anti-IDOR estricto (`pk = USER#<uid>`) + límites `350 KB` / lote `<= 25` + bound `X-Vigor-CSRF`. |
| **Invitación autenticada** (`1`) | `POST /api/v1/invitations/redeem` | `NO_AUTHENTICATION` | `NO_AUTHENTICATION` | Usuario autenticado con sesión VigorCore canjea token de invitación propio. | `emailNormalized === actor.normalizedEmail`, `SHA-256` `timingSafeEqual`, transición condicional `pending -> redeeming`, bound `X-Vigor-CSRF`. |
| **Gobernanza Admin** (`9`) | `GET /admin/users`, `/stats`, `/users/:uid`, `/audit-logs`, `POST /invitations`, `/invitations/:id/revoke`, `/users/:uid/status`, `/users/:uid/role`, `/users/:uid/password-reset` | `NO_AUTHENTICATION` | `NO_AUTHENTICATION` | RBAC `admin` / `superadmin` validado contra tabla `Users` (`consistent_read: true`), saga idempotente y bloqueo superadmin. | HMAC cookie + `PERMISSION_MATRIX` + bloqueo superadmin hasta atomicidad live + `INT-08` bloqueado en `password-reset` + `AuditLogs` inmutable. |
| **Preflight CORS & Liveness** | `OPTIONS /api/v1/*`, `GET /health` | `NO_AUTHENTICATION` (CORS via CloudScale Authorized Domains) | `NO_AUTHENTICATION` | `OPTIONS` del navegador jamás envía cookies ni Bearer OAuth. | Origin allowlist fail-closed; `/health` sin secretos ni contexto admin. |

---

## 7. Auditoría de Impacto Global de Activar API Gateway (`buildApiGatewayGlobalImpactAudit`)

> **Regla operativa obligatoria:** Habilitar API Gateway (`catalyst apig:enable`) **desactiva automáticamente Project Security Rules a nivel global en todo el proyecto** y puede cambiar las URLs públicas de consumidores previos. **No activado en remoto (`APPLIED: false`).**

1. **Checklist de inventario previo:** Inventariar todas las funciones (Basic I/O, Advanced I/O, Cron, Event, Integration), respaldar el JSON actual de Project Security Rules, verificar consumidores de Slate (`app.vigorcore.lat`) u otros clientes `/server/*` o `/baas/*`, y auditar webhooks/Domain Mappings existentes.
2. **Equivalencia regla-a-ruta:** Cada regla previa de Security Rules (`/api/v1/auth/session/*`, `/api/v1/*`, `/health` y cualquier endpoint interno no-VigorCore) debe tener ruta explícita en Gateway o quedar **sin exposición** en la tabla del Gateway para no heredar exposición abierta al desactivarse Security Rules.
3. **Orden seguro de transición:** (1) Snapshot Security Rules → (2) Configurar `Authorized Domains` (`https://app.vigorcore.lat`) → (3) Desplegar `vigor_api` con `VIGOR_CORS_MODE` y `VIGOR_SESSION_HMAC_SECRET` → (4) `catalyst apig:enable` cargando únicamente `alternative-b-api-gateway.routes.json` → (5) Mapear `api.vigorcore.lat` (`Production` + `CNAME`) → (6) Ejecutar verificación smoke y de exposición no intencional.
4. **Plan de rollback inmediato:** Ejecutar `catalyst apig:disable` (reactiva automáticamente las Project Security Rules previas) y revalidar en Consola que `app.vigorcore.lat` y endpoints restringidos recuperaron protección original.

---

## 8. Corrección Realizada en `AdminGovernanceService.getAdminStats` (Paginación `> 400` Usuarios)

- **Archivo modificado:** `poc/catalyst-clean-slate/src/services/adminGovernanceService.ts` (`getAdminStats`).
- **Corrección:** Se sustituyó la lectura de página única `limit: 100` por iteración completa mediante cursor `startKey` por cada uno de los 4 shards `GSI_Directory` (`USER_SEG#0..3`) en paralelo, preservando esquema congelado y firma pública `{ totalUsers, activeUsers, suspendedUsers, superadmins, admins }`.
- **Resiliencia:** Detecta cursors repetidos (`DIRECTORY_PAGINATION_STALLED`, HTTP `504`), acota páginas máximas por segmento (`1000` páginas = hasta `100,000` usuarios/segmento) y deduplica por `pk` entre páginas antes de agregar métricas.
- **Verificación (`Tests 76 y 77`):** Probado con **465** usuarios sintéticos distribuidos en `USER_SEG#0..3` (> 110 usuarios/shard) y fallo cerrado `504` ante cursor atascado.

---

## 9. Actualización de `catalystConfigPreflight.ts`, Plantillas y `docs/23`

- `src/provisioning/catalystConfigPreflight.ts` y `scripts/verify-clean-slate-provisioning.ts`:
  - Soportan `VIGOR_CATALYST_AUTH_MODE` / `--auth-mode hosted_native | external_oauth` y `VIGOR_CORS_MODE` (`express_enforced | platform_managed`).
  - En `hosted_native`: valida `CATALYST_PROJECT_ID`, entornos, coherencia regional de 8 regiones, `VIGOR_SESSION_HMAC_SECRET`, `VIGOR_ALLOWED_ORIGINS` y `ZC_SECURE !== 'override'`, **sin exigir** `CATALYST_PROJECT_KEY` ni `CATALYST_ADMIN_*` (mientras sigue rechazando placeholders si alguno está definido).
  - En `--live --confirm-readonly`: rechaza `--auth-mode hosted_native` *fail-closed* (`HOSTED_NATIVE_UNAVAILABLE_OUTSIDE_ADVANCED_IO`) porque el CLI corre fuera de Catalyst Advanced I/O.
  - Verificado offline sin red con `npx --prefix poc/catalyst-clean-slate tsx poc/catalyst-clean-slate/scripts/verify-clean-slate-provisioning.ts --preflight --auth-mode hosted_native` (`networkCallsExecuted: 0`, `writeOperationsExecuted: 0`, `OPTIONAL_IN_HOSTED_NATIVE`, `OK_HOSTED_NATIVE_NO_EXTERNAL_OAUTH`).
- Plantillas actualizadas sin secretos (`CANDIDATE_NOT_APPLIED`): `config/candidates/alternative-b-api-gateway.routes.json`, `config/candidates/catalyst-function.template.json`, `.env.example`.
- `docs/23-phase-5.1-catalyst-operational-readiness.md`: actualizado en Secciones 1, 3 y 8 para reflejar la paginación de `getAdminStats`, el modo dual `hosted_native`/`external_oauth` y el enlace a `docs/24` sin contradicciones.

---

## 10. Matriz de Validaciones Locales vs Pendientes en Vivo (`PENDING-LIVE-VERIFICATION`)

| Suite / Verificación | Resultado Real Observado | Clasificación Honesta |
| --- | --- | --- |
| `npm --prefix poc/catalyst-clean-slate run build` | `tsc --noEmit` backend + frontend: **PASS (`0` errores)** | **`[PASS-UNIT]`** |
| `npm --prefix poc/catalyst-clean-slate run frontend:build` | Vite bundle: **PASS** | **`[PASS-UNIT]`** |
| Tests 01–75 (`tests/01`..`tests/17`) | Paridad 41 rutas, aislamiento estático `tests/05` (`0` escrituras en `src/provisioning`/`scripts`), RBAC, saga, SDK `SDK-01..05`, 5 proveedores `@zcatalyst/nosql`, Express loopback, Chromium mock+HTTP E2E, preflight & verificador read-only: **PASS (`75 / 75`)** | **`[PASS-UNIT]` / `[PASS-SDK-CONTRACT]` / `[PASS-LOOPBACK]` / `[PASS-BROWSER-E2E]`** |
| Test 76–77 (`tests/18`) | `getAdminStats()` paginando **465** usuarios (>100/shard `USER_SEG#0..3`) + fail-closed `504` cursor estancado: **PASS** | **`[PASS-UNIT]`** |
| Test 78 (`tests/18`) | `HostedNativeCatalystAuthRuntime` (`new ZCAuth().init` real + `@zcatalyst/nosql` real) vía Express loopback `/server/vigor_api/api/v1/...` sin `CATALYST_ADMIN_*`, rechazo `503`/`403`, anti-spoof `zc-api-domain` y aislamiento `AsyncLocalStorage` concurrente: **PASS** | **`[PASS-LOOPBACK]` / `[PASS-SDK-CONTRACT]`** |
| Test 79 (`tests/18`) | `VIGOR_CORS_MODE=platform_managed` (`Vary: Origin`, cero `Access-Control-*` duplicados, bloqueo `403` Origin ajeno & `CSRF_CROSS_SITE_REJECTED`): **PASS** | **`[PASS-LOOPBACK]`** |
| Test 80–81 (`tests/18`) | Cobertura de reescritura Gateway **41/41**, matriz de auth Gateway **41/41**, matriz CORS/OPTIONS, auditoría de impacto global `apig:enable`, preflight `hosted_native` vs `external_oauth` y bloqueo CLI `--live --auth-mode hosted_native`: **PASS** | **`[PASS-UNIT]`** |
| **Total suite `npm --prefix poc/catalyst-clean-slate test`** | **`81 / 81 PASS` (`0` fail, `0` skipped, `23.06s`)** | **Verificado localmente** |
| Inyección real de `x-zc-admin-cred-token` en rutas `NO_AUTHENTICATION` bajo API Gateway | No comprobable fuera de Catalyst alojado | **`PENDING-LIVE-VERIFICATION`** |
| Sobrescritura efectiva de `x-zc-*` y passthrough de `Origin`, `Referer`, `Sec-Fetch-Site`, `X-Vigor-CSRF` en API Gateway real | No comprobable sin despliegue real | **`PENDING-LIVE-VERIFICATION`** |
| Preflight `OPTIONS` en Chromium real contra `https://api.vigorcore.lat` con `Authorized Domains` sin cabeceras duplicadas | No ejecutado contra nube | **`PENDING-LIVE-VERIFICATION`** |
| Transmisión de cookie `__Host-vigor_session; HttpOnly; Secure; SameSite=Strict; Path=/` en Safari/WebKit y Chromium HTTPS real (`app.vigorcore.lat` → `api.vigorcore.lat`) | No ejecutado contra DNS/SSL real | **`PENDING-LIVE-VERIFICATION`** |
| Compatibilidad `UserManagement.resetPassword()` en contexto admin real (`INT-08`) y `INT-01..INT-08` / `BR-01..BR-20` | No ejecutado contra BaaS remoto | **`PENDING-LIVE-VERIFICATION`** |

---

## 11. Restricciones Respetadas, Checklist Pre-Aprovisionamiento y Dictamen Final

### Confirmación explícita de aislamiento y cero operaciones remotas
- Todo el trabajo se ejecutó exclusivamente dentro de `poc/catalyst-clean-slate/`.
- **No** se modificó el frontend raíz publicado, **no** se modificó Zoho Slate (`app.vigorcore.lat`), **no** se creó/alteró DNS, **no** se activó API Gateway en remoto, **no** se crearon las 5 tablas NoSQL ni índices GSIs ni usuarios Catalyst, **no** se ejecutó `--live --confirm-readonly`, **no** se desplegaron funciones y **no** se modificó Firebase, Firestore ni GCP.
- **No** se introdujeron secretos reales ni tokens en ningún archivo.

### Dictamen final: **`RECONCILIATION_PARTIAL`**
La arquitectura de dominio, API Gateway, autenticación dual (`hosted_native` / `external_oauth`), CORS `platform_managed`, seguridad CSRF/anti-spoofing, inventario/rollback de Security Rules, paginación `getAdminStats` y preflight están reconciliados y verificados localmente (`81 / 81 PASS`). El paso a ejecución operativa en Catalyst sigue condicionado a la autorización explícita para aprovisionar las **5 tablas vacías** (`docs/07` + `docs/23`), ejecutar `--live --confirm-readonly` (con `--auth-mode external_oauth`) y validar en vivo los puntos `PENDING-LIVE-VERIFICATION` (`x-zc-*` en `NO_AUTHENTICATION`, `OPTIONS`/`Set-Cookie` real e `INT-01..INT-08`).
