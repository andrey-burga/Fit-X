# VIGORCORE — FASE 5.1.2: PREPARACIÓN OPERATIVA DE ZOHO CATALYST (SIN APROVISIONAMIENTO NI DESPLIEGUE)

**Alcance:** Exclusivo dentro de `poc/catalyst-clean-slate/`  
**Fecha:** 17 de noviembre de 2026  
**Estado de ejecución:** Fase 5.1.2 autorizada únicamente como preparación operativa. **La Fase 5.2 NO está autorizada ni iniciada.**  
**Dictamen final honesto:** **`PREPARATION_PARTIAL`** *(Todo el código local, manifiesto consolidado de 5 tablas y 8 GSIs, matriz exhaustiva de variables de entorno, empaquetado/compilación `dist/server/catalystEntry.js`, auditoría 41/41 del API Gateway, scripts locales con separación estricta `inspect` / `preflight` / `plan` y bloqueo fail-closed de `apply`, runbooks de aprovisionamiento/despliegue/verificación/recuperación y suite automatizada local han quedado completados y verificados; sin embargo, este entorno carece de CLI `catalyst` y credenciales Catalyst configuradas, por lo que el inventario remoto vivo del proyecto, funciones preexistentes, Security Rules vigentes, tablas/GSIs remotos, Domain Mapping, Authorized Domains e `INT-01..INT-08` / `BR-01..BR-20` permanecen como **`[NO COMPROBABLE SIN ACCESO REMOTO]`** y **`PENDING-LIVE-VERIFICATION`**).*

---

## 1. Inventario de Recursos Zoho Catalyst (Clasificación Estricta de Evidencia)

### 1.1 `[VERIFICADO REMOTAMENTE]`
- **Cantidad:** `0` elementos verificados en nube desde este contenedor.
- **Motivo fáctico comprobado localmente:** Al inspeccionar el entorno de ejecución (`which catalyst` y nombres de variables de entorno `CATALYST_*`, `VIGOR_*`, `ZC_*`, `X_ZOHO_*`, `ZAID`), se comprobó `NO_CATALYST_CLI` y ausencia total de credenciales o `catalyst.json`. No se ejecutó ninguna llamada de red ni lectura remota.

### 1.2 `[SOLO LOCAL / DOCUMENTACIÓN]`
| Recurso / Evidencia Local | Estado Verificado Localmente | Fuente en POC |
| --- | --- | --- |
| **Topología objetivo congelada (ADR Zoho Support 2026-11-17)** | Slate en `https://app.vigorcore.lat/`; Backend Advanced I/O en `https://api.vigorcore.lat/` vía API Gateway + CloudScale Domain Mapping (`Production` + `CNAME`, sin Web Client Hosting) | `docs/24`, `domainGatewayConfigs.ts`, `alternative-b-api-gateway.routes.json` |
| **Autenticación dual (`ADR-002`)** | Primario alojado `hosted_native` (`zcAuth.init(req, { scope })`, zero `CATALYST_ADMIN_*`); fallback `external_oauth` (`CatalystAdminAppProvider`) | `src/sdk/catalystSdkBridge.ts`, `src/server/advancedIoApp.ts` |
| **Esquema NoSQL congelado (`5` tablas / `8` GSIs)** | `TABLE_SCHEMA_REGISTRY` + 5 proveedores + validación automática 5/8 y TTL condicional | `src/types/cleanSlate.ts`, `operationalPreparationManifest.ts` |
| **Paridad de API & Frontend** | **41** endpoints canónicos + `/health` + `OPTIONS`, `ROUTE_CONTRACT_SPECS`, `ROUTE_DEFINITIONS`, SPA Slate desacoplado (`vite build`) | `src/routes/routeContracts.ts`, `apiRouterSchema.ts`, `frontend/` |
| **SDK Catalyst & Runtime Node** | `@zcatalyst/auth@1.0.0`, `@zcatalyst/auth-admin@1.1.0`, `@zcatalyst/nosql@1.0.0`, `@zcatalyst/transport@1.1.0`, `@zcatalyst/utils@1.1.0`, `express@4.22.3`, Node `>=22` | `package.json`, `tsconfig.server.json` |
| **Plantillas candidatas NO aplicadas** | `applied: false` / `CANDIDATE_NOT_APPLIED` sin IDs reales ni secretos | `config/candidates/*.json`, `.env.example` |

### 1.3 `[NO COMPROBABLE SIN ACCESO REMOTO]` *(Con Consultas Seguras de Solo Lectura para el Operador)*
| Recurso Remoto a Inventariar | Consulta Segura de Solo Lectura (Operador) |
| --- | --- |
| Organización Catalyst, `CATALYST_PROJECT_ID` real y entornos (`Development` / `Production`) | `catalyst whoami` y `catalyst project:list` (o Catalyst Console → *Project Settings → General*; ver `docs/26`) |
| Estado de las **5 tablas NoSQL** y **8 GSIs** (confirmar vacío `0` documentos antes de Phase 5.2) | Catalyst Console → *Cloud Scale → NoSQL* (tras Phase 5.2: `npx tsx scripts/verify-clean-slate-provisioning.ts --live --confirm-readonly`) |
| Usuarios actuales en Catalyst Authentication y plantillas de *Reset Password* | Catalyst Console → *Authentication → Users* (confirmar `0` usuarios de app en clean-slate) |
| Funciones preexistentes en el proyecto (`Basic I/O`, `Advanced I/O`, `Cron`, `Event`) | Catalyst Console → *Serverless → Functions* (inventario obligatorio previo a `apig:enable`) |
| Estado de API Gateway y snapshot JSON actual de **Project Security Rules** | Catalyst Console → *Cloud Scale → API Gateway* y *Security Rules → Export JSON* |
| Configuraciones previas en *CloudScale → Domain Mapping* (`api.vigorcore.lat`) y DNS `CNAME` | Catalyst Console → *Cloud Scale → Domain Mapping* y PowerShell `Resolve-DnsName -Name api.vigorcore.lat -Type CNAME` (`scripts/phase-5.1.2-readonly-inventory.ps1`) |
| Configuraciones de *CloudScale → Whitelisting → Authorized Domains* | Catalyst Console → *Cloud Scale → Security / Whitelisting → Authorized Domains* |
| Estado de despliegue actual del Slate en `https://app.vigorcore.lat/` | Catalyst Console → *Cloud Scale → Slate* (sin modificarlo) |

---

## 2. Manifiesto Consolidado de Aprovisionamiento (Exactamente 5 Tablas y 8 GSIs)

Validado programáticamente por `buildConsolidatedProvisioningManifest()` y `validateConsolidatedProvisioningManifest()` (**prohíbe explícitamente una 6.ª tabla o un 9.º GSI**; todo cambio posterior en claves/SKs/GSIs es **inmutable** tras crearse en Catalyst).

| Orden | Tabla | Partition Key | Primary Sort Key | Additional Sort Keys (`<=5` total SK) | Global Secondary Indexes (`8` total) | TTL (`ttlEpochSec: Number`) | Dependencias |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **1** | `Users` | `pk` (`String`) | **Omitida (`null`)** | Ninguna (`0/5`) | 1. `GSI_Email` (`normalizedEmail: S` → `ALL`)<br>2. `GSI_Directory` (`directorySegment: S`, `createdAt: S` → `SPECIFIC_ATTRIBUTES` **exacto 11 cols**)<br>3. `GSI_RoleStatus` (`role: S`, `accountStatus: S` → `ALL`) | **DESACTIVADO** | Proyecto Catalyst limpio (`0` filas) |
| **2** | `UserData` | `pk` (`String`) | `sk` (`String`) | `entityType` (`String`), `updatedAt` (`String`) *(total 3/5)* | 4. `GSI_UserEntityDate` (`pk: S`, `entityDateKey: S` → `ALL`) | **DESACTIVADO** | Depende de `Users` (`pk=USER#<uid>`) |
| **3** | `AdminInvitations` | `pk` (`String`) | **Omitida (`null`)** | Ninguna (`0/5`) | 5. `GSI_InviteEmailStatus` (`emailNormalized: S`, `status: S` → `ALL`) | **ACTIVADO**: `ttlEpochSec` (`Number`) en ítems `INVITE#<id>` | Depende de `Users` |
| **4** | `AuditLogs` | `pk` (`String`) | `sk` (`String`) | `action` (`String`), `timestamp` (`String`) *(total 3/5)* | 6. `GSI_AuditActor` (`actorUid: S`, `timestamp: S` → `ALL`)<br>7. `GSI_AuditTarget` (`targetUid: S`, `timestamp: S` → `ALL`)<br>8. `GSI_GlobalChronology` (`auditPeriodBucket: S`, `globalChronologyKey: S` → `ALL`) | **DESACTIVADO** *(bitácora inmutable append-only)* | Depende de `Users` y `AdminInvitations` |
| **5** | `SystemControl` | `pk` (`String`) | **Omitida (`null`)** | Ninguna (`0/5`) | **Ninguno (`0/20`)** | **ACTIVADO CONDICIONAL**: `ttlEpochSec` (`Number`) **SOLO** en `CTRL#SAGA#*` y `SESSION#<sid>`; **PROHIBIDO** en `CTRL#BOOTSTRAP` y `CTRL#SUPERADMIN_COUNT` | Depende de `Users` y `AdminInvitations` |

### Detalle exacto de los 11 atributos proyectados en `Users.GSI_Directory` (`SPECIFIC_ATTRIBUTES`)
`pk`, `uid`, `email`, `displayName`, `role`, `roleVersion`, `accountStatus`, `emailVerified`, `directorySegment`, `createdAt`, `lastSignInAt`.

### Particionamiento sharded anti-hotspot congelado
- `Users.GSI_Directory`: `directorySegment = USER_SEG#0..3` (SHA-256 determinístico sobre `catalystUserId`).
- `AuditLogs`: `pk = AUDIT#YYYY-MM` y `GSI_GlobalChronology.auditPeriodBucket = AUDIT_Q#YYYY-Q1..4`.

---

## 3. Matriz Exhaustiva de Variables de Entorno (Local vs Advanced I/O Alojado)

Audita **33** variables detectadas en catálogo y código (`auditEnvironmentVariableCoverage()` = `PASS`, `0` faltantes). Todos los secretos reales están excluidos del repositorio y marcados como `[CONFIGURAR_EN_CATALYST]`.

| Variable | Categoría | Secreto | Valor / Marcador | Express Local | Advanced I/O `hosted_native` | Advanced I/O `external_oauth` | CLI `--live --confirm-readonly` | Regla de Validación |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `VIGOR_CATALYST_AUTH_MODE` | Política Auth/CORS | No | `hosted_native` | Opcional | **Requerida** (`hosted_native`) | **Requerida** (`external_oauth`) | Opcional | Selecciona `ZCAuth.init` vs OAuth admin externo |
| `VIGOR_CORS_MODE` | Política Auth/CORS | No | `platform_managed` | Opcional | **Requerida** | **Requerida** | Opcional | Evita duplicar `Access-Control-*` con Authorized Domains |
| `CATALYST_PROJECT_ID` | ID Público | No | `[CONFIGURAR_EN_CATALYST]` | Requerida | **Requerida** | Requerida | Requerida | Pinning anti-spoof de `x-zc-projectid` |
| `CATALYST_ENVIRONMENT` | ID Público | No | `Development` \| `Production` | Requerida | **Requerida** | Requerida | Requerida | Debe coincidir con entorno real y `VIGOR_ENVIRONMENT` |
| `VIGOR_ENVIRONMENT` | Política Auth/CORS | No | `development` \| `staging` \| `production` | Requerida | **Requerida** | Requerida | Requerida | Bloquea cruce dev/prod |
| `CATALYST_API_DOMAIN` | ID Público | No | `https://api.catalyst.zoho.com` | Requerida | **Requerida** | Requerida | Requerida | Coherente con DC Zoho; neutraliza `zc-api-domain` |
| `CATALYST_ACCOUNTS_URL` | ID Público | No | `https://accounts.zoho.com` | Requerida | **Requerida** | Requerida | Requerida | Mismo DC TLD que `CATALYST_API_DOMAIN` |
| `CATALYST_PROJECT_KEY` | Secreto App | **Sí** | `[CONFIGURAR_EN_CATALYST]` | Requerida | **Opcional** *(edge `x-zc-project-key`)* | Requerida | Requerida | Header `PROJECT_ID` en `@zcatalyst/auth-admin` |
| `CATALYST_PROJECT_SECRET_KEY` | Secreto App | **Sí** | `[CONFIGURAR_EN_CATALYST]` | Opcional | Opcional | Opcional | Opcional | Rechazada si es placeholder |
| `CATALYST_ADMIN_CLIENT_ID` | OAuth Fallback | No | `[CONFIGURAR_EN_CATALYST]` | Requerida | **NO REQUERIDA (Opcional)** | Requerida | Requerida | `hosted_native` NO depende de OAuth admin externo |
| `CATALYST_ADMIN_CLIENT_SECRET` | OAuth Fallback | **Sí** | `[CONFIGURAR_EN_CATALYST]` | Requerida | **NO REQUERIDA (Opcional)** | Requerida | Requerida | `hosted_native` NO depende de OAuth admin externo |
| `CATALYST_ADMIN_REFRESH_TOKEN` | OAuth Fallback | **Sí** | `[CONFIGURAR_EN_CATALYST]` | Requerida | **NO REQUERIDA (Opcional)** | Requerida | Requerida | `hosted_native` NO depende de OAuth admin externo |
| `CATALYST_ADMIN_ACCESS_TOKEN` | OAuth Fallback | **Sí** | `[CONFIGURAR_EN_CATALYST]` | Opcional dev | **Prohibida en prod** | **Prohibida en prod** | Opcional dev | Solo diagnóstico efímero de lectura en desarrollo |
| `VIGOR_SESSION_HMAC_SECRET` | Sesión/CSRF | **Sí** | `[CONFIGURAR_EN_CATALYST]` | Requerida | **Requerida** | Requerida | Opcional | CSPRNG >= 256-bit Base64URL firma `__Host-vigor_session` y CSRF |
| `VIGOR_SESSION_ACTIVE_KID` | Sesión/CSRF | No | `k1` | Opcional | **Requerida** | Requerida | Opcional | Identificador de clave activa HMAC |
| `VIGOR_SESSION_PREVIOUS_SECRETS_JSON` | Sesión/CSRF | **Sí** | `[]` | Opcional | Opcional | Opcional | Opcional | Lista `[{ kid, secret }]` para rotación sin caída |
| `VIGOR_ALLOWED_ORIGINS` | Sesión/CSRF | No | `https://app.vigorcore.lat` | Requerida | **Requerida** | Requerida | Opcional | Lista HTTPS explícita (prohibido `*`) |
| `CATALYST_FUNCTION_NAME` | ID Público | No | `vigor_api` | Opcional | Opcional | Opcional | Opcional | Etiqueta `/health` |
| `CATALYST_PROJECT_DOMAIN` | ID Público | No | `[CONFIGURAR_EN_CATALYST]` | Opcional | Opcional | Opcional | Opcional | Metadato opcional |
| `CATALYST_RESET_REDIRECT_URL` | ID Público | No | `https://app.vigorcore.lat/auth/login` | Opcional | Opcional | Opcional | Opcional | URL de retorno en `resetPassword` tras `INT-08` |
| `X_ZOHO_CATALYST_ORG_ID` | ID Público | No | `[CONFIGURAR_EN_CATALYST]` | Opcional | Opcional | Opcional | Opcional | Cabecera opcional `CATALYST-ORG` |
| `X_ZOHO_CATALYST_LISTEN_PORT` | Listener/Runtime | No | `PLATFORM_INJECTED` | Opcional | **Inyectada por Catalyst** | Inyectada por Catalyst | No aplica | Puerto dinámico de escucha Advanced I/O |
| `PORT` / `NODE_ENV` | Listener/Runtime | No | `3002` / `production` | Opcional | `NODE_ENV=production` | `NODE_ENV=production` | Opcional | Puerto fallback local y modo Node |
| `VIGOR_ALLOW_RESET_WITHOUT_INT08` | Safety Guard | No | `false` (no activar en prod) | Opcional | **Prohibida en prod** | **Prohibida en prod** | Prohibida | Mantiene `password-reset` protegido hasta `INT-08` live |
| `ZC_SECURE` | Safety Guard | No | *No definir (`override` prohibido)* | **Prohibida `override`** | **Prohibida `override`** | **Prohibida `override`** | **Prohibida `override`** | Impide desactivar verificación TLS en `@zcatalyst/transport` |
| `ZAID` | Cliente Slate | No | `[PUBLIC_WEB_SDK_ZAID]` | Solo Slate | No usada por servidor | No usada por servidor | No usada | Identificador público Web SDK navegador |
| `ZC_PROJECT_ID`, `ZC_PROJECT_KEY`, `ZC_CLIENT_ID`, `ZC_CLIENT_SECRET`, `ZC_REFRESH_TOKEN`, `ZC_ENVIRONMENT` | Legado deprecado | Mixto | `DEPRECATED` | Prohibidas | Prohibidas | Prohibidas | Prohibidas | Bloqueadas ante conflicto con `CATALYST_*` |

---

## 4. Manifiesto de Función Advanced I/O, Endpoints y Empaquetado

- **Función única:** `vigor_api` (`type: "advancedio"`, `stack: "node22"`).
- **Entrypoint de producción:** `dist/server/catalystEntry.js` (compilado mediante `tsconfig.server.json` con `"noEmit": false` y `"outDir": "./dist"` mediante `npm --prefix poc/catalyst-clean-slate run build:server` — **nota de auditoría:** se detectó que `tsconfig.json` tenía `"noEmit": true`, por lo que se creó `tsconfig.server.json` y el script `build:server` para garantizar la emisión real de `dist/server/catalystEntry.js`).
- **Dependencias modulares de runtime:** `@zcatalyst/auth@^1.0.0`, `@zcatalyst/auth-admin@^1.1.0`, `@zcatalyst/nosql@^1.0.0`, `@zcatalyst/transport@^1.1.0`, `@zcatalyst/utils@^1.1.0`, `express@^4.22.3`.
- **Superficie HTTP:** **41** rutas canónicas (`/api/v1/*`) + `/health` / `/api/v1/health` (sin privilegios ni secretos) + `OPTIONS /api/v1/*`.
- **Reescritura automática del Gateway:** `normalizeCatalystPath()` (`src/server/advancedIoApp.ts`) elimina el prefijo `/server/<fnName>` cuando API Gateway reescribe `/api/v1/*` → `/server/vigor_api/api/v1/*`.
- **Contenido del paquete futuro (fase posterior de despliegue):** `dist/` (solo servidor, excluye `src/frontend`), `package.json` (`"type": "module"`, `engines.node >= 22`), y `node_modules` de dependencias de producción.
- **Mecanismo futuro de rollback de función:** Mantener etiqueta/paquete anterior compilado y, ante fallo en Gateway o Edge, ejecutar `catalyst apig:disable` (inmediato) o restaurar versión anterior de `vigor_api`.

---

## 5. Auditoría de Cobertura de Rutas y Reescritura API Gateway (`41 / 41`)

Resultados verificados por `detectRouteAndManifestAnomalies()`, `verifyGatewayRewriteCoverage('vigor_api')` y `verifyGatewayAuthMatrixCompleteness()`:
- **Rutas canónicas (`ROUTE_CONTRACT_SPECS`):** **`41 / 41`**
- **Rutas mapeadas a tablas/índices (`ROUTE_TO_SCHEMA_MAPPING`):** **`41 / 41`**
- **Cobertura de reescritura `/server/vigor_api/api/v1/...` → `/api/v1/...`:** **`41 / 41`** (`allMatched: true`)
- **Matriz de autenticación Gateway (`ROUTE_GATEWAY_AUTH_MATRIX`):** **`41 / 41`** (`zeroOAuthExecuteForced: true`; `CATALYST_USERS_AUTHENTICATION` recomendado en `bootstrap-profile` y `exchange` con fallback `NO_AUTHENTICATION`; `NO_AUTHENTICATION` + HMAC `__Host-vigor_session` + CSRF ligado + RBAC en las 39 rutas restantes)
- **Rutas huérfanas, sin mapear, tablas desconocidas o colisiones `(method, path)`:** **`0`**

---

## 6. Análisis de Impacto Global de API Gateway (Restricción Crítica)

Confirmado por Zoho Catalyst Support el 17-nov-2026 y modelado en `buildApiGatewayGlobalImpactAudit()` (`applied: false`):
- **Regla crítica:** Ejecutar `catalyst apig:enable` **desactiva automáticamente las Project Security Rules a nivel global de todo el proyecto Catalyst**, pudiendo alterar URLs públicas o exponer funciones previas si no están protegidas en el Gateway.
- **Plan de transición seguro (NO ejecutado en 5.1.2):**
  1. Inventariar todas las funciones existentes (`Basic I/O`, `Advanced I/O`, `Cron`, `Event`, `Integration`) y exportar/respaldar el JSON de Project Security Rules vigente.
  2. Confirmar que toda ruta/función previa tiene equivalencia en `alternative-b-api-gateway.routes.json` o queda excluida de exposición pública.
  3. Configurar `CloudScale > Whitelisting > Authorized Domains` exclusivamente con `https://app.vigorcore.lat` (cero `*`).
  4. Desplegar `vigor_api` con `VIGOR_CORS_MODE=platform_managed` y `VIGOR_SESSION_HMAC_SECRET`.
  5. Activar API Gateway (`catalyst apig:enable`) cargando únicamente las rutas validadas.
  6. Configurar `CloudScale > Domain Mapping` (`api.vigorcore.lat`, `Production`, registro DNS `CNAME`).
- **Instrucción de rollback documentada (solo para fase futura post-activación, NO ejecutar ahora):** `catalyst apig:disable` desactiva API Gateway de inmediato y **reactiva automáticamente las Project Security Rules globales previas**.

---

## 7. Runbook Futuro — Aprovisionamiento Manual Ordenado de 5 Tablas (Fase 5.2, Requiere Autorización Separada)

1. Confirmar autorización explícita de Fase 5.2 e inventario remoto limpio (`0` tablas homónimas existentes, `0` usuarios Catalyst Auth).
2. Crear manualmente en orden estricto (deteniéndose ante cualquier anomalía por inmutabilidad de claves/GSIs):
   - **Paso 1 (`Users`)**: PK `pk (String)`, **sin Sort Key**, TTL **desactivado**, crear `GSI_Email`, `GSI_Directory` (exactas **11 columnas** en `SPECIFIC_ATTRIBUTES`), `GSI_RoleStatus`. Verificar `ONLINE` y `0` filas.
   - **Paso 2 (`UserData`)**: PK `pk (String)`, Primary SK `sk (String)`, Additional SKs `entityType (String)`, `updatedAt (String)`, TTL **desactivado**, crear `GSI_UserEntityDate`. Verificar `ONLINE`.
   - **Paso 3 (`AdminInvitations`)**: PK `pk (String)`, **sin Sort Key**, TTL **activado** en `ttlEpochSec (Number)`, crear `GSI_InviteEmailStatus`. Verificar `ONLINE`.
   - **Paso 4 (`AuditLogs`)**: PK `pk (String)`, Primary SK `sk (String)`, Additional SKs `action (String)`, `timestamp (String)`, TTL **desactivado**, crear `GSI_AuditActor`, `GSI_AuditTarget`, `GSI_GlobalChronology`. Verificar `ONLINE`.
   - **Paso 5 (`SystemControl`)**: PK `pk (String)`, **sin Sort Key**, **0 GSIs**, TTL **activado** en `ttlEpochSec (Number)` *(en runtime: prohibido en `CTRL#BOOTSTRAP` y `CTRL#SUPERADMIN_COUNT`)*. Verificar `ONLINE`.
3. Ejecutar verificación remota estrictamente read-only:
   ```bash
   npx --prefix poc/catalyst-clean-slate tsx scripts/verify-clean-slate-provisioning.ts --live --confirm-readonly
   ```
4. Confirmar visualmente en Consola Catalyst que `ttlEpochSec` es tipo **`Number`** (limitación conocida de `@zcatalyst/nosql@1.0.0`, que solo expone el nombre del atributo TTL).

---

## 8. Runbook Futuro — Compilación, Empaquetado y Despliegue (Fases Posteriores)

1. **Compilación limpia y verificación local:**
   ```bash
   npm --prefix poc/catalyst-clean-slate run build
   npm --prefix poc/catalyst-clean-slate run build:server
   npm --prefix poc/catalyst-clean-slate run frontend:build
   npm --prefix poc/catalyst-clean-slate test
   ```
2. **Validación pre-empaquetado (`dist/server/catalystEntry.js` presente):** Confirmar que `package.json` + `dist/` + `node_modules` de producción contienen los paquetes `@zcatalyst/*` y `express`, sin archivos `.env` ni secretos reales.
3. **Configuración de entorno en Catalyst Console / Secrets:** Cargar variables según Sección 3 (`VIGOR_CATALYST_AUTH_MODE=hosted_native`, `VIGOR_CORS_MODE=platform_managed`, `CATALYST_PROJECT_ID`, `CATALYST_ENVIRONMENT`, `VIGOR_ENVIRONMENT`, `CATALYST_API_DOMAIN`, `CATALYST_ACCOUNTS_URL`, `VIGOR_SESSION_HMAC_SECRET=[CONFIGURAR_EN_CATALYST]`, `VIGOR_SESSION_ACTIVE_KID=k1`, `VIGOR_ALLOWED_ORIGINS=https://app.vigorcore.lat`).
4. **Respaldo de Security Rules + `Authorized Domains` + Despliegue `vigor_api` + API Gateway + Domain Mapping (`api.vigorcore.lat` CNAME).**
5. **Rollback inmediato si falla smoke check:** `catalyst apig:disable` y/o reversión al paquete anterior de `vigor_api`.

---

## 9. Runbook Futuro — Verificación Post-Despliegue y Recuperación

| Verificación Live (`PENDING-LIVE-VERIFICATION`) | Criterio de Aceptación | Plan de Recuperación si Falla |
| --- | --- | --- |
| `GET https://api.vigorcore.lat/health` | `200 OK` con `routeCount: 41`, sin secretos ni contexto admin | Revisar logs de función / rollback `vigor_api` |
| `OPTIONS /api/v1/*` desde `https://app.vigorcore.lat` (Chromium y Safari/WebKit) | `204`/`200`, una sola `Access-Control-Allow-Origin: https://app.vigorcore.lat` (sin duplicados ni `*`) | Confirmar `Authorized Domains` y `VIGOR_CORS_MODE=platform_managed` |
| `POST /api/v1/auth/session/bootstrap-profile` y `/exchange` | Verifica usuario Catalyst, emite `Set-Cookie: __Host-vigor_session=...; HttpOnly; Secure; SameSite=Strict; Path=/` + `csrfToken` | Si `CATALYST_USERS_AUTHENTICATION` en Gateway falla con cookies, activar fallback `NO_AUTHENTICATION` verificado |
| Rutas `NO_AUTHENTICATION` con NoSQL en `hosted_native` | Gateway inyecta `x-zc-admin-cred-token` y responde `200`/`401` (nunca `503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE`) | Cambiar `VIGOR_CATALYST_AUTH_MODE=external_oauth` con credenciales `[CONFIGURAR_EN_CATALYST]` sin rediseño |
| Passthrough de `Origin`, `Referer`, `Sec-Fetch-Site` y `X-Vigor-CSRF` | Mutaciones con CSRF válido pasan; `cross-site` o CSRF ausente/forjado fallan `403` | `X-Vigor-CSRF` criptográfico ligado a `(sub,sid,ep)` mantiene protección incluso si edge normaliza cabeceras |
| Protección de recursos ajenos tras `apig:enable` | Funciones no-VigorCore no expuestas públicamente sin auth | `catalyst apig:disable` inmediato para restaurar Security Rules |

---

## 10. Scripts y Herramientas Locales de Validación (Modo Dual Seguro)

1. **`scripts/prepare-catalyst-phase-5.1.2.ts`** (nuevo en Fase 5.1.2, cero red, cero escrituras, cumple estáticamente `tests/05`):
   - `--mode inspect` → Inventario local vs remoto no comprobable en sandbox (`networkCallsExecuted: 0`, `writeOperationsExecuted: 0`).
   - `--mode preflight` → Valida manifiesto 5/8, TTL, anomalías 41/41 y env sin fugas (`networkCallsExecuted: 0`, `writeOperationsExecuted: 0`).
   - `--mode plan` → Genera el manifiesto completo `PLAN_READY_NON_APPLIED` (`applied: false`, `phase52Authorized: false`).
   - `--mode apply` / `--apply` → **Bloqueado de forma fail-closed** con excepción `ApplyModeForbiddenError` (`PHASE_5_1_2_APPLY_FORBIDDEN`, código de salida `1`).
2. **`scripts/verify-clean-slate-provisioning.ts`** (auditado en Fase 5.1.2):
   - Confirmado: solo admite offline self-check, `--preflight`, o `--live --confirm-readonly` (estrictamente solo lectura; falla si falta `--confirm-readonly` o si se pasa `--auth-mode hosted_native` en CLI local). No existe ningún script capaz de escribir/aprovisionar en remoto.

---

## 11. Resultados de Compilación, Pruebas y No-Regresión (Post-Cambios Fase 5.1.2)

*(Los conteos exactos de ejecución corresponden al cierre verificado de esta fase en terminal local):*
- **`npm --prefix poc/catalyst-clean-slate run build`** (`tsc --noEmit` backend + frontend): **PASS (`0` errores)**.
- **`npm --prefix poc/catalyst-clean-slate run build:server`** (`tsc -p tsconfig.server.json` emitiendo `dist/server/catalystEntry.js`): **PASS (`0` errores)**.
- **`npm --prefix poc/catalyst-clean-slate run frontend:build`** (`vite build`): **PASS**.
- **`npm --prefix poc/catalyst-clean-slate test`** (`tests/01`..`tests/19`): **100% PASS (`0` fallos, `0` omitidos)** — incluye no-regresión de las 81 pruebas previas + nuevas pruebas `tests/19-phase-5.1.2-operational-preparation.test.ts`.
- **CLI offline `scripts/prepare-catalyst-phase-5.1.2.ts`**: `--mode inspect`, `--mode preflight` y `--mode plan` verificados con `applied: false`, `networkCallsExecuted: 0`, `writeOperationsExecuted: 0`; `--mode apply` bloqueado (`PHASE_5_1_2_APPLY_FORBIDDEN`, exit code `1`).
- **Aislamiento del proyecto raíz:** `compile_applet` + `lint_applet` sin modificaciones en `src/`, `functions/`, `package.json`, Firestore, GCP, Slate o DNS.

---

## 12. Bloqueadores, Supuestos, Operación Remota y Dictamen Final

### Bloqueadores y Verificaciones Pendientes (`PENDING-LIVE-VERIFICATION`)
1. Ausencia de CLI `catalyst` y credenciales Catalyst en este sandbox → inventario real del proyecto remoto clasificado honestamente como `[NO COMPROBABLE SIN ACCESO REMOTO]`.
2. Inyección real de `x-zc-admin-cred-token` en rutas `NO_AUTHENTICATION` bajo API Gateway.
3. Sobrescritura/passthrough de `x-zc-*`, `Origin`, `Referer` y `Sec-Fetch-Site` en el edge real.
4. Preflight `OPTIONS`, ausencia de cabeceras CORS duplicadas y entrega real de cookie `__Host-vigor_session; SameSite=Strict` en Chromium y Safari/WebKit (`app.vigorcore.lat` → `api.vigorcore.lat`).
5. Suite de integración live `INT-01..INT-08` (incluyendo atomicidad superadmin, `ttlEpochSec` tipo `Number` y `resetPassword` admin) y E2E en navegador real `BR-01..BR-20`.

### OPERACIONES REMOTAS REALIZADAS
- **Ninguna operación remota de escritura, creación, modificación, activación, desactivación o despliegue realizada.**
- **Ninguna lectura remota ejecutada desde este entorno**, dado que la comprobación local read-only (`which catalyst` y nombres de variables de entorno) confirmó `NO_CATALYST_CLI` y `0` credenciales Catalyst configuradas.

### OPERACIONES REMOTAS NO REALIZADAS
- No se consultó en vivo la organización/proyecto remoto Catalyst, tablas/índices remotos, usuarios de Catalyst Auth, funciones desplegadas, Security Rules actuales, API Gateway remoto, Domain Mapping ni Authorized Domains.
- No se crearon las 5 tablas (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`) ni sus 8 GSIs.
- No se crearon usuarios ni credenciales administrativas ni se ejecutó bootstrap offline.
- No se ejecutó `verify-clean-slate-provisioning.ts --live --confirm-readonly`.
- No se habilitó ni deshabilitó API Gateway (`catalyst apig:enable` / `apig:disable`).
- No se desplegó `vigor_api`, no se tocó DNS, no se tocó `https://app.vigorcore.lat/` ni se modificó Firebase/Firestore/GCP.

### Dictamen Final y Preparación para Fase 5.2
- **Dictamen:** **`PREPARATION_PARTIAL`**
- **Preparación para solicitar autorización independiente de Fase 5.2:** **SÍ (en el plano técnico y documental local).** Para iniciar la Fase 5.2 (aprovisionamiento manual de las 5 tablas vacías + `--live --confirm-readonly`), el operador únicamente deberá ejecutar primero el inventario remoto de solo lectura de la Sección 1.3 en su terminal autenticada con Catalyst CLI / Consola Catalyst y otorgar autorización explícita e independiente para Fase 5.2. **Fase 5.2 no se inicia ni se ejecuta aquí.**
