# FASES 5.0 y 5.0.1 — INTEGRACIÓN REAL DEL SDK CATALYST, PROVEEDORES NoSQL, ADAPTADOR EXPRESS ADVANCED I/O Y REMEDIACIÓN `PROJECT_ID`

**Alcance:** Exclusivo dentro de `poc/catalyst-clean-slate/`  
**Estado de verificación local:** `PASS (69 / 69 pruebas locales · TypeScript backend + frontend 0 errores · Vite frontend build PASS)`  
**Veredicto de integración operativa remota:** **`LOCAL_SDK_VERIFIED_PENDING_LIVE_INFRA` (`INT-01..INT-08` permanecen `PENDING-LIVE-VERIFICATION`)**  
**Aislamiento remoto preservado:** Cero modificaciones en `/src/**` raíz, `package.json` raíz, Zoho Slate publicado, DNS (`app.vigorcore.lat`, `api.vigorcore.lat`), tablas NoSQL remotas, Firebase/Firestore/GCP, usuarios o secretos reales. Zero monkey-patching en `node_modules/@zcatalyst/*`.

---

## 1. Diagnóstico y Causa Raíz Exacta — Fase 5.0.1 (Tests 64 y 65)

La inspección directa de los paquetes instalados en `poc/catalyst-clean-slate/node_modules/@zcatalyst/*` (`@zcatalyst/auth@1.0.0`, `@zcatalyst/auth-admin@1.1.0`, `@zcatalyst/nosql@1.0.0`, `@zcatalyst/transport@1.1.0`, `@zcatalyst/utils@1.1.0`) reveló el contrato HTTP exacto de `projectId` vs `projectKey` en el SDK oficial:

1. **Constante del SDK (`@zcatalyst/utils/dist-es/constants.js:47`):**
   ```js
   PROJECT_KEY_NAME: 'PROJECT_ID'
   ```
2. **Inyección de cabeceras (`@zcatalyst/auth-admin/dist-es/index.js:220-223`):**
   ```js
   export function addDefaultAppHeaders(headers, values) {
     headers[PROJECT_KEY_NAME] = values?.projectKey; // HTTP header "PROJECT_ID" = values.projectKey
     headers[ENVIRONMENT_KEY_NAME] = values?.environment;
     headers[ENVIRONMENT] = values?.environment;
   ```
3. **Construcción de petición HTTP (`@zcatalyst/transport/dist-es/http-handler.js:301, 322-323`):**
   - `req.headers = addDefaultAppHeaders(req.headers, this.app.config)` → establece la cabecera HTTP **`PROJECT_ID`** con **`projectKey`**.
   - `req.path = getServicePath(req.service) + '/project/' + this.app.config.projectId + req.path` → establece **`projectId`** en la ruta URL (`/baas/v1/project/<projectId>/...`).

### Causa raíz y remediación aplicada

- **Fallo Test 65 (`TypeError: Invalid value "undefined" for header "PROJECT_ID"`):**
  - `CatalystAdminAppProvider` (`src/sdk/catalystSdkBridge.ts`) definía `projectKey?: string` como opcional y `catalyst-function.template.json` / `domainGatewayConfigs.ts` marcaban `CATALYST_PROJECT_KEY` como no obligatoria. Al instanciar el proveedor sin `projectKey`, `app.config.projectKey` quedaba `undefined` y `addDefaultAppHeaders()` asignaba `headers['PROJECT_ID'] = undefined`, haciendo fallar `http.request()` dentro de Node/transport.
  - **Corrección:** `projectKey` es ahora **obligatorio y fail-closed** en `CatalystAdminConfigInput`, `buildValidatedAdminApp()` (vía `validateNonPlaceholder(cfg.projectKey, 'CATALYST_PROJECT_KEY')`), `getRequiredServerEnvSpecs()` (`required: true`) y `config/candidates/catalyst-function.template.json` (`requiredEnvVars`).
- **Fallo Test 64 (`Expected: proj_real_777, Actual: proj_key_777` en `headers.project_id`):**
  - El SDK oficial de Catalyst envía **`projectId` (`proj_real_777`) en la URL** (`/baas/v1/project/proj_real_777/project-user/current`) y **`projectKey` (`proj_key_777`) en la cabecera HTTP `PROJECT_ID`** (`req.headers.project_id` en Node). La aserción anterior del Test 64 confundía esa cabecera `PROJECT_ID` con `projectId`.
  - **Corrección:** Se actualizó Test 64 para verificar el contrato oficial completo del SDK (URL con `proj_real_777` **y** cabecera `project_id: 'proj_key_777'`), además de añadir validación fail-closed de spoofing de `x-zc-project-key` (`403 PROJECT_CONTEXT_MISMATCH`) y prueba explícita de que `x-zc-admin-cred-*` en peticiones entrantes nunca eleva permisos ni altera la credencial de admin del servidor.

---

## 2. Auditoría de Compatibilidad y APIs Públicas Oficiales Utilizadas

| ID | Paquete | Hallazgo Verificado en `node_modules/@zcatalyst/*` | Mitigación con API Pública Oficial (Sin Parches en `node_modules`) |
| --- | --- | --- | --- |
| `SDK-01` | `@zcatalyst/auth-admin@1.1.0` | `zcAuth.init(options, { type: 'custom' })` envuelve la credencial en `ApplicationCustomCredential`, pero `CatalystApp.authenticateRequest(req)` omite `instanceof ApplicationCustomCredential`, enviando peticiones admin **sin** cabecera `Authorization`. | `CatalystAdminAppProvider` instancia directamente `new CatalystApp({ ..., credential: new RefreshTokenCredential(...) \| new AccessTokenCredential(...) })` (exportaciones públicas documentadas en `@zcatalyst/auth-admin`). Reproducido automáticamente en Test 62 (`verifyRawSdkCustomInitOmitsAuthHeader`). |
| `SDK-02` | `@zcatalyst/auth@1.0.0` | `Node.d.ts` documenta claves planas mientras `zcAuth.init(..., { type: 'custom' })` espera `options.credential` y muta el objeto de entrada. | `CatalystAdminAppProvider` valida inmutabilidad de configuración en servidor y nunca muta objetos del llamador. |
| `SDK-03` | `@zcatalyst/auth-admin@1.1.0` | `ZCAuth.getDefaultCredentials()` evalúa `!isNonEmptyString(!projectId)` (negación doble defectuosa). | Prohibido invocar `getDefaultCredentials()`. Todas las variables `CATALYST_*` se validan explícitamente en `CatalystAdminAppProvider.fromEnvironment()`. |
| `SDK-04` | `@zcatalyst/auth@1.0.0` | `UserManagement.resetPassword()` codifica `user: 'user'` hacia `/project-user/forgotpassword`, mientras el administrador opera con credenciales admin. | Bloqueado por defecto tras el interruptor `requireLiveInt08ForPasswordReset: true` (`INT_08_LIVE_VERIFICATION_PENDING`) hasta comprobar comportamiento real en `INT-08`. |
| `SDK-05` | `@zcatalyst/auth-admin@1.1.0` | `CatalystCredential(..., 'user')` confía en cabeceras `x-zc-projectid` / `x-zc-project-key` / `zc-api-domain` si se pasan sin filtrar. | `CatalystSeparatedAuthRuntime` valida `x-zc-projectid` y `x-zc-project-key` (`403 PROJECT_CONTEXT_MISMATCH`), rechaza `x-zc-user-type: admin` (`403 CATALYST_ADMIN_HEADER_SPOOFED`) y fija dominio, proyecto y `scope: 'user'`. |

---

## 3. Arquitectura Final Implementada (`CatalystAdminAppProvider`, 5 Proveedores NoSQL y Express Advanced I/O)

1. **`CatalystAdminAppProvider` (`src/sdk/catalystSdkBridge.ts`):**
   - Instancia única compartida bajo `appName = 'vigorcore-admin'`. Independiente por completo de `req.headers`.
   - Requiere `CATALYST_PROJECT_ID`, `CATALYST_PROJECT_KEY`, `CATALYST_ENVIRONMENT` coherente con `VIGOR_ENVIRONMENT` (prohíbe mezcla `production` ↔ `Development`), orígenes HTTPS fuera de loopback explícito de test y credenciales sin placeholders.
   - Expone `createNoSQLClient()` (`new NoSQL(adminApp)`), `createUserManagementAdmin()` (`new UserManagement(adminApp)`), rotación atómica de credenciales (`rotateCredentials()`) y redacción estricta (`redactSecretsFromString`, `redactSensitiveObject`, `toRedactedSummary`).
2. **Cinco Proveedores Tipados por Tabla (`src/nosql/providers/`):**
   - Comparten `createTableProviders(adminProvider.createNoSQLClient())` sobre `CatalystLiveNoSQLAdapter` y `@zcatalyst/nosql@1.0.0`:
     - `UsersTableProvider` (`GSI_Email`, `GSI_Directory` 4 segmentos con proyección `SPECIFIC_ATTRIBUTES`, `GSI_RoleStatus`, `consistent_read: true`, recuperación de timeout en `bumpSessionEpoch`).
     - `UserDataTableProvider` (`PK: USER#<uid>`, `SK`, `GSI_UserEntityDate`, paginación con cursor `start_key: {}` → `undefined`, lotes `<= 25`, techo de 350 KB, escrituras versionadas).
     - `AdminInvitationsTableProvider` (`GSI_InviteEmailStatus`, transiciones condicionales, `ttlEpochSec`).
     - `AuditLogsTableProvider` (append-only, `GSI_AuditActor`, `GSI_AuditTarget`, `GSI_GlobalChronology`).
     - `SystemControlTableProvider` (sesiones `__Host-vigor_session`, contadores atómicos `PUT` con `update_function` `add`/`subtract` sin colisión de clave en `update_attributes`, bloqueos y sagas).
   - `CatalystLiveNoSQLAdapter` corrige también la deserialización de cursores vacíos `start_key: {}` → `undefined` y normaliza errores HTTP `408`/`504`/red a `CatalystTimeoutError`.
3. **Servidor Express para Advanced I/O (`src/server/advancedIoApp.ts` y `src/server/catalystEntry.ts`):**
   - Conecta las **41 rutas canónicas** mediante `CleanSlateApiDispatcher`, normaliza el prefijo de montaje `/server/<functionName>` bloqueando traversal (`..`, `%2e%2e`, `\`, `\0` → `400 INVALID_REQUEST_PATH`), valida atributos estrictos de `__Host-vigor_session`, aplica `HttpSecurityPolicy` (CORS sin `*`, Fetch Metadata, CSRF pre-sesión y CSRF HMAC ligado a sesión) e inicializa de forma diferida (`catalystAdvancedIoEntry`, devolviendo `503 SERVER_CONFIGURATION_UNAVAILABLE` sin exponer secretos si falta entorno).
   - **Corrección adicional detectada en Test Suite 16:** `createVigorCoreProductionRuntimeFromEnv` ahora inyecta también `VIGOR_SESSION_HMAC_SECRET` y `VIGOR_SESSION_PREVIOUS_SECRETS_JSON` al redactor de errores/logs HTTP (`redactSecretsFromString`) para garantizar que ningún secreto HMAC pueda aparecer en respuestas `500`/`503` o logs operacionales.
4. **Plantillas Candidatas NO Aplicadas (`src/provisioning/domainGatewayConfigs.ts` y `config/candidates/*.json`):**
   - Documentan Alternativa A (`api.vigorcore.lat` directo sobre Advanced I/O con Security Rules `optional`) y Alternativa B (CloudScale API Gateway con `NO_AUTHENTICATION` y advertencia operativa explícita de desactivación automática de Security Rules). Permanecen marcados `applied: false` / `CANDIDATE_NOT_APPLIED`.

---

## 4. Archivos Modificados y Creados en Fases 5.0 y 5.0.1

- `poc/catalyst-clean-slate/package.json` (`@zcatalyst/*`, `express`, `@types/express`)
- `poc/catalyst-clean-slate/src/sdk/catalystSdkBridge.ts`
- `poc/catalyst-clean-slate/src/nosql/catalystModularAdapter.ts`
- `poc/catalyst-clean-slate/src/nosql/cleanSlateEngine.ts`
- `poc/catalyst-clean-slate/src/nosql/providers/baseTableProvider.ts`
- `poc/catalyst-clean-slate/src/nosql/providers/tableProviders.ts`
- `poc/catalyst-clean-slate/src/nosql/providers/index.ts`
- `poc/catalyst-clean-slate/src/server/advancedIoApp.ts`
- `poc/catalyst-clean-slate/src/server/catalystEntry.ts`
- `poc/catalyst-clean-slate/src/provisioning/domainGatewayConfigs.ts`
- `poc/catalyst-clean-slate/config/candidates/alternative-a-advanced-io.security-rules.json`
- `poc/catalyst-clean-slate/config/candidates/alternative-b-api-gateway.routes.json`
- `poc/catalyst-clean-slate/config/candidates/catalyst-function.template.json`
- `poc/catalyst-clean-slate/tests/15-sdk-bridge-and-nosql-providers.test.ts`
- `poc/catalyst-clean-slate/tests/16-express-advanced-io-server.test.ts`
- `poc/catalyst-clean-slate/docs/22-phase-5.0-catalyst-sdk-and-nosql-integration-readiness.md`

---

## 5. Resultados de Pruebas y Estado de Verificación

| Suite / Comando | Cobertura | Resultado | Clasificación |
| --- | --- | --- | --- |
| `npm --prefix poc/catalyst-clean-slate run build` | `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.frontend.json` | **PASS (`0` errores)** | `[PASS-UNIT]` |
| `npm --prefix poc/catalyst-clean-slate run frontend:build` | Vite v8.3.4 build limpio (`dist-frontend/`) | **PASS** | `[PASS-UNIT]` |
| Suites `tests/01` .. `tests/14` | Regresión completa Clean-Slate + CSRF ligado + ciclo 12h/24h + Chromium E2E | **61 / 61 PASS** | `[PASS-UNIT]` / `[PASS-MOCK]` / `[PASS-BROWSER-E2E]` |
| Test 62 (`tests/15`) | Defecto `ApplicationCustomCredential` vs `CatalystAdminAppProvider` + redacción + rotación | **PASS** | `[PASS-SDK-CONTRACT]` |
| Test 63 (`tests/15`) | Fail-closed ante `CATALYST_PROJECT_ID`, `CATALYST_PROJECT_KEY`, placeholders y cruce dev/prod | **PASS** | `[PASS-UNIT]` |
| Test 64 (`tests/15`) | Separación user/admin, URL `/project/<projectId>`, cabecera `PROJECT_ID=<projectKey>`, anti-spoofing | **PASS** | `[PASS-SDK-CONTRACT]` |
| Test 65 (`tests/15`) | Los 5 proveedores `@zcatalyst/nosql` reales sobre BaaS loopback (`consistent_read`, GSIs, batch `<=25`, `update_function`, cursor `{}` → `undefined`, 504 timeout) | **PASS** | `[PASS-LOOPBACK]` |
| Tests 66–69 (`tests/16`) | Express loopback real: `/server/<fn>`, traversal HTTP raw (`%2e%2e`), 41/41 rutas, cookies `__Host-vigor_session`, redacción HMAC en 503, `catalystEntry` lazy fail-closed y plantillas candidatas sin secretos | **4 / 4 PASS** | `[PASS-UNIT]` / `[PASS-LOOPBACK]` |
| `INT-01..INT-08` (`tests/06-integration-catalyst-live.spec.ts`) | BaaS Catalyst remoto, `UserManagement.resetPassword`, Custom Domain CORS `OPTIONS` y Safari WebKit cookie same-site | **PENDIENTE** | `[PENDING-LIVE-VERIFICATION]` |

**Total verificado localmente al cierre de Fase 5.0.1:** **`69 / 69` pruebas PASS (`0` fallos, `0` omitidas)** en `16` suites.

---

## 6. Riesgos Abiertos y Pruebas Remotas Pendientes (`INT-01..INT-08`)

1. **`INT-01` (`PENDING-LIVE-VERIFICATION`):** Verificar en BaaS real las 5 tablas (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`) creadas manualmente con lectura fuertemente consistente y GSIs congelados.
2. **`INT-02 / INT-03` (`PENDING-LIVE-VERIFICATION`):** Confirmar límites de tamaño `350 KB` / rechazo de condición (`ConditionMismatch` vs código HTTP exacto en batch parcial) frente al motor NoSQL remoto real.
3. **`INT-04 / INT-05` (`PENDING-LIVE-VERIFICATION`):** Validar `OAuth` refresh real con `RefreshTokenCredential` contra `accounts.zoho.com` (o dominio regional) y `bumpSessionEpoch` / `atomicIncrementSuperadminCount` tras latencia o timeout real.
4. **`INT-06 / INT-07` (`PENDING-LIVE-VERIFICATION`):** Confirmar respuesta de soporte Zoho sobre dominio personalizado `api.vigorcore.lat` en Advanced I/O (Alternativa A vs Alternativa B) y comprobar `OPTIONS` preflight + `SameSite=Strict` en Chromium y WebKit/Safari reales entre `https://app.vigorcore.lat` y `https://api.vigorcore.lat`.
5. **`INT-08` (`PENDING-LIVE-VERIFICATION`):** Verificar si `/project-user/forgotpassword` acepta o rechaza `UserManagement.resetPassword()` invocado desde `CatalystApp` admin (mantener `VIGOR_ALLOW_RESET_WITHOUT_INT08` desactivado hasta confirmarlo).

---

## 7. Comandos PowerShell de Verificación Local

```powershell
# Desde la raíz del repositorio
npm --prefix poc/catalyst-clean-slate run build
npm --prefix poc/catalyst-clean-slate run frontend:build
npm --prefix poc/catalyst-clean-slate test

# Suites específicas de Fase 5.0 / 5.0.1
npx tsx --test poc/catalyst-clean-slate/tests/15-sdk-bridge-and-nosql-providers.test.ts
npx tsx --test poc/catalyst-clean-slate/tests/16-express-advanced-io-server.test.ts
```

**Conclusión honesta:** La capa SDK (`CatalystAdminAppProvider`, `CatalystSeparatedAuthRuntime`, los 5 proveedores `@zcatalyst/nosql` y el servidor Express Advanced I/O) queda completa, tipada y verificada localmente (`69/69 PASS`, incluyendo detección y corrección exacta de Tests 64 y 65 en el contrato `PROJECT_ID` = `projectKey`). La activación operativa en Catalyst continúa legítimamente bloqueada en `PENDING-LIVE-VERIFICATION` hasta contar con la confirmación de soporte Zoho, el aprovisionamiento manual de las 5 tablas y la ejecución controlada de `INT-01..INT-08`.
