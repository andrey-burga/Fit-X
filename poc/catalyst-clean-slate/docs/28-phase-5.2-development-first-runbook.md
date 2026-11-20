# VIGORCORE — FASE 5.2 (DEVELOPMENT FIRST): RUNBOOK OPERATIVO, AUDITORÍA DE ESQUEMAS, ENTORNOS Y AUTENTICACIÓN NATIVA

**Proyecto en Google AI Studio:** `Fit-X` (trabajo aislado exclusivamente en `poc/catalyst-clean-slate/`)  
**Proyecto Zoho Catalyst:** `Project-Rainfall`  
**Catalyst Project ID:** `136967000000014024`  
**Data Center:** `US` (`accounts.zoho.com` · `https://api.catalyst.zoho.com`)  
**Línea base heredada:** Fase 5.1.2 cerrada con dictamen `PHASE_5_1_2_CLOSED_READY_FOR_PHASE_5_2` (`docs/27`) · Cutover de dominio `api.vigorcore.lat` mantenido en `BLOCKED_PENDING_ZOHO_CLARIFICATION` · Línea base inicial de este runbook previo a ejecución: `PHASE_5_2_RUNBOOK_READY_NOT_EXECUTED`  
**Estado actualizado (Cierre documental Etapa 1 — `Development`):** **`PHASE_5_2_STAGE_1_NOSQL_PROVISIONING_COMPLETED`** *(Verificado por registro manual del operador en `Development`: 5 tablas vacías + 8 índices `Active`; `0` operaciones remotas automatizadas ejecutadas desde este cierre documental. **Etapa 2 — Native Catalyst Authentication**, **verificación CLI `--live --confirm-readonly`**, y **promoción a `Production`** permanecen pendientes de autorización independiente. `api.vigorcore.lat` / Slate `https://app.vigorcore.lat/`, `API Gateway`, `Functions`, `Third-party Auth`, DNS, Firebase y GCP intactos)*

---

## 1. AUDITORÍA DEL MANIFIESTO APROBADO Y DEFINICIÓN EXACTA DE LAS 5 TABLAS Y 8 GSIs

Se auditaron línea a línea `src/types/cleanSlate.ts` (`TABLE_SCHEMA_REGISTRY`, `CATALYST_PLATFORM_LIMITS`), `src/provisioning/operationalPreparationManifest.ts` (`buildConsolidatedProvisioningManifest()`, `validateConsolidatedProvisioningManifest()`), `src/provisioning/postProvisioningVerifier.ts` (`verifySchemaAgainstRegistry()`) y `docs/07-manual-catalyst-tables-runbook.md`.

**Resultado de auditoría (Development First):** **NO existe ninguna contradicción técnica ni estructural** entre el esquema congelado (`5` tablas / `8` GSIs) y el aprovisionamiento **Development First** en `Project-Rainfall` (`136967000000014024`). El esquema congelado se conserva íntegramente sin modificar ninguna tabla, clave, tipo, índice o regla de TTL.

### 1.1 Resumen Estructural e Inmutabilidad Post-Creación

> **Advertencia crítica de inmutabilidad en Catalyst NoSQL:** Una vez creada una tabla en Zoho Catalyst NoSQL, el **nombre de la tabla**, el **Partition Key (nombre y tipo)**, la presencia/nombre/tipo de la **Primary Sort Key**, las **Additional Sort Keys**, y la definición de los **Global Secondary Indexes (claves y proyección)** **NO deben asumirse editables in-place**; en la práctica, un error en estos parámetros obliga a **eliminar la tabla vacía (mientras tenga 0 documentos) y recrearla** antes de iniciar cargas o despliegues. Por ello, cada tabla cuenta con checklist visual inmediato y condición `STOP`.

| Orden | Tabla | Partition Key | Primary Sort Key | Additional Sort Keys (`<=5` SK totales) | GSIs (`8` totales) | TTL (`ttlEpochSec: Number`) |
| :-: | :--- | :--- | :--- | :--- | :---: | :--- |
| **1** | `Users` (`136967000000065001`) | `pk` (`String`) | **Omitida (`null`)** | Ninguna (`0 / 5`) | `3` (`GSI_Email` [`136967000000065003`], `GSI_Directory` [`136967000000067001`], `GSI_RoleStatus` [`136967000000067004`]) | **DESACTIVADO** |
| **2** | `UserData` (`136967000000067007`) | `pk` (`String`) | `sk` (`String`) | `entityType` (`String`), `updatedAt` (`String`) *(total `3 / 5`)* | `1` (`GSI_UserEntityDate` [`136967000000067011`]) | **DESACTIVADO** |
| **3** | `AdminInvitations` (`136967000000067014`) | `pk` (`String`) | **Omitida (`null`)** | Ninguna (`0 / 5`) | `1` (`GSI_InviteEmailStatus` [`136967000000067016`]) | **ACTIVADO** (`ttlEpochSec: Number`) |
| **4** | `AuditLogs` (`136967000000067021`) | `pk` (`String`) | `sk` (`String`) | `action` (`String`), `timestamp` (`String`) *(total `3 / 5`)* | `3` (`GSI_AuditActor` [`136967000000067025`], `GSI_AuditTarget` [`136967000000067028`], `GSI_GlobalChronology` [`136967000000067031`]) | **DESACTIVADO** *(bitácora inmutable append-only)* |
| **5** | `SystemControl` (`136967000000067034`) | `pk` (`String`) | **Omitida (`null`)** | Ninguna (`0 / 5`) | `0` | **ACTIVADO CONDICIONAL** (`ttlEpochSec: Number` **solo** en `CTRL#SAGA#*` y `SESSION#<sid>`; **PROHIBIDO** en `CTRL#BOOTSTRAP` y `CTRL#SUPERADMIN_COUNT`) |

### 1.2 Definición Individual Exacta por Tabla y por Índice Secundario Global

#### Tabla 1 (Orden 1): `Users`
- **Nombre de tabla:** `Users`
- **Partition Key:** `pk` — Tipo: **`String`** (`DataType.S`) *(patrón runtime: `USER#<catalystUserId>`)*
- **Sort Key Primaria:** **Omitida / No habilitar (`null`)** *(un único documento por usuario)*
- **Additional Sort Keys:** Ninguna (`0 / 5`)
- **TTL:** **Desactivado** (`ttl_enabled: false`)
- **Global Secondary Indexes (`3 / 20`):**
  1. **`GSI_Email`**
     - Partition Key: `normalizedEmail` (`String`)
     - Sort Key: *Omitida / Ninguna*
     - Proyección: **`ALL`** (`AttribType.all`)
     - Restricción plataforma: `isUniqueConstraint: false` *(unicidad verificada por aplicación vía `consistent_read: true`)*
  2. **`GSI_Directory`**
     - Partition Key: `directorySegment` (`String`) *(valores determinísticos `USER_SEG#0`..`USER_SEG#3`)*
     - Sort Key: `createdAt` (`String`)
     - Proyección: **`SPECIFIC_ATTRIBUTES`** (`AttribType.include` / *Include specific attributes*) con exactamente **11 columnas**:
       1. `pk`
       2. `uid`
       3. `email`
       4. `displayName`
       5. `role`
       6. `roleVersion`
       7. `accountStatus`
       8. `emailVerified`
       9. `directorySegment`
       10. `createdAt`
       11. `lastSignInAt`
  3. **`GSI_RoleStatus`**
     - Partition Key: `role` (`String`)
     - Sort Key: `accountStatus` (`String`)
     - Proyección: **`ALL`** (`AttribType.all`)
- **Parámetros inmutables post-creación:** `Users`, `pk (String)`, ausencia de Primary SK / Additional SKs, estado TTL desactivado de diseño, y las definiciones exactas de `GSI_Email`, `GSI_Directory` (incluidas las 11 columnas exactas) y `GSI_RoleStatus`.

#### Tabla 2 (Orden 2): `UserData`
- **Nombre de tabla:** `UserData`
- **Partition Key:** `pk` — Tipo: **`String`** (`DataType.S`) *(patrón runtime: `USER#<catalystUserId>`, aislamiento multi-tenant estricto)*
- **Sort Key Primaria:** `sk` — Tipo: **`String`** (`DataType.S`) *(11 entidades por prefijo: `BIO#`, `PREF#`, `GROCERY#`, `MEAL#`, `RECIPE#`, `PLAN#`, `ROUTINE#`, `WORKOUT#`, `SET#`, `CARDIO#`, `NOTIF#`)*
- **Additional Sort Keys (`2` adicionales; total `3 / 5`):**
  1. `entityType` (`String`)
  2. `updatedAt` (`String`)
- **TTL:** **Desactivado** (`ttl_enabled: false`)
- **Global Secondary Indexes (`1 / 20`):**
  4. **`GSI_UserEntityDate`**
     - Partition Key: `pk` (`String`)
     - Sort Key: `entityDateKey` (`String`) *(patrón runtime: `<ENTITY_TYPE>#<ISO_DATE>#<id>`)*
     - Proyección: **`ALL`** (`AttribType.all`)
- **Parámetros inmutables post-creación:** `UserData`, `pk (String)`, `sk (String)`, Additional SKs `entityType (String)` y `updatedAt (String)`, y `GSI_UserEntityDate`.

#### Tabla 3 (Orden 3): `AdminInvitations`
- **Nombre de tabla:** `AdminInvitations`
- **Partition Key:** `pk` — Tipo: **`String`** (`DataType.S`) *(patrón runtime: `INVITE#<inviteId>`)*
- **Sort Key Primaria:** **Omitida / No habilitar (`null`)**
- **Additional Sort Keys:** Ninguna (`0 / 5`)
- **TTL:** **Activado** (`ttl_enabled: true`) — Atributo: **`ttlEpochSec`**, Tipo: **`Number`** (`DataType.N`, segundos Unix epoch; asignado en ítems `INVITE#<inviteId>` = `expiresAtEpochSec + 86400`; validez autoritativa comprobada siempre en servidor con `expiresAtEpochSec > nowSec`)
- **Global Secondary Indexes (`1 / 20`):**
  5. **`GSI_InviteEmailStatus`**
     - Partition Key: `emailNormalized` (`String`)
     - Sort Key: `status` (`String`)
     - Proyección: **`ALL`** (`AttribType.all`)
- **Parámetros inmutables post-creación:** `AdminInvitations`, `pk (String)`, ausencia de SKs, `GSI_InviteEmailStatus`, y atributo/tipo TTL **`ttlEpochSec` (`Number`)**.

#### Tabla 4 (Orden 4): `AuditLogs`
- **Nombre de tabla:** `AuditLogs`
- **Partition Key:** `pk` — Tipo: **`String`** (`DataType.S`) *(patrón runtime: `AUDIT#<YYYY-MM>`)*
- **Sort Key Primaria:** `sk` — Tipo: **`String`** (`DataType.S`) *(patrón runtime: `<invertedEpochMs>#<eventId>`)*
- **Additional Sort Keys (`2` adicionales; total `3 / 5`):**
  1. `action` (`String`)
  2. `timestamp` (`String`)
- **TTL:** **Desactivado** (`ttl_enabled: false` — retención histórica inmutable *append-only*)
- **Global Secondary Indexes (`3 / 20`):**
  6. **`GSI_AuditActor`**
     - Partition Key: `actorUid` (`String`)
     - Sort Key: `timestamp` (`String`)
     - Proyección: **`ALL`** (`AttribType.all`)
  7. **`GSI_AuditTarget`**
     - Partition Key: `targetUid` (`String`)
     - Sort Key: `timestamp` (`String`)
     - Proyección: **`ALL`** (`AttribType.all`)
  8. **`GSI_GlobalChronology`**
     - Partition Key: `auditPeriodBucket` (`String`) *(patrón runtime: `AUDIT_Q#<YYYY>-Q<1..4>`)*
     - Sort Key: `globalChronologyKey` (`String`) *(patrón runtime: `<ISO_TIMESTAMP>#<eventId>`)*
     - Proyección: **`ALL`** (`AttribType.all`)
- **Parámetros inmutables post-creación:** `AuditLogs`, `pk (String)`, `sk (String)`, Additional SKs `action (String)` y `timestamp (String)`, y los 3 GSIs (`GSI_AuditActor`, `GSI_AuditTarget`, `GSI_GlobalChronology`).

#### Tabla 5 (Orden 5): `SystemControl`
- **Nombre de tabla:** `SystemControl`
- **Partition Key:** `pk` — Tipo: **`String`** (`DataType.S`) *(claves reservadas: `CTRL#BOOTSTRAP`, `CTRL#SUPERADMIN_COUNT`, `CTRL#SAGA#<idempotencyKey>`, `SESSION#<sid>`)*
- **Sort Key Primaria:** **Omitida / No habilitar (`null`)**
- **Additional Sort Keys:** Ninguna (`0 / 5`)
- **Global Secondary Indexes:** Ninguno (`0 / 20`)
- **TTL:** **Activado Condicional** (`ttl_enabled: true`) — Atributo: **`ttlEpochSec`**, Tipo: **`Number`** (`DataType.N`)
  - **Permitido únicamente en:** `CTRL#SAGA#<idempotencyKey>` y `SESSION#<sid>`.
  - **ESTRICTAMENTE PROHIBIDO en:** `CTRL#BOOTSTRAP` y `CTRL#SUPERADMIN_COUNT` *(si llevaran `ttlEpochSec`, Catalyst borraría los candados maestros del sistema)*.
- **Parámetros inmutables post-creación:** `SystemControl`, `pk (String)`, ausencia de SKs, 0 GSIs, y atributo/tipo TTL **`ttlEpochSec` (`Number`)**.

---

## 2. MODELO DE ENTORNOS EN ZOHO CATALYST (`Development` -> `Production`)

### 2.1 Separación Física de Entornos en `Project-Rainfall` (`136967000000014024`)

1. **Aislamiento de almacenamiento e identidad por entorno:**
   - En Zoho Catalyst, **`Development`** y **`Production`** son entornos independientes dentro del mismo proyecto (`136967000000014024`).
   - Cada entorno mantiene su propio almacén **NoSQL** (tablas y documentos separados), su propia base de usuarios en **Catalyst Authentication** (`Authentication > Users`), y sus propios despliegues/variables de funciones y API Gateway.
   - El código de VigorCore refuerza este aislamiento de forma *fail-closed* en `CatalystAdminAppProvider` (`src/sdk/catalystSdkBridge.ts:301-311`), `validateHostedNativeConfig()` (`lines 854-866`) y `runCatalystConfigPreflight()`:
     - `VIGOR_ENVIRONMENT=development` exige `CATALYST_ENVIRONMENT=Development` (bloquea `Production` con `ENVIRONMENT_SEPARATION_VIOLATION`).
     - `VIGOR_ENVIRONMENT=production` exige `CATALYST_ENVIRONMENT=Production` (bloquea `Development` con `ENVIRONMENT_SEPARATION_VIOLATION`).
2. **Por qué se ejecuta Fase 5.2 en `Development` primero (*Development First*):**
   - Permite crear las 5 tablas vacías, validar visualmente los 8 GSIs, las 11 columnas de `GSI_Directory`, el TTL `ttlEpochSec (Number)`, configurar **Native Catalyst Authentication** y probar `vigor_api` / `INT-01..INT-08` en **Fase 5.3** sin exponer ni comprometer el entorno `Production` ni interferir con el Slate publicado en `https://app.vigorcore.lat/`.

### 2.2 Promoción / Migración de `Development` a `Production` (Sin Suposiciones No Verificadas)

> **Principio de honestidad operativa:** Este entorno no tiene acceso a una cuenta Catalyst live ni a la herramienta de despliegue web de consola para comprobar empíricamente cada casilla del asistente de promoción de Catalyst. Por tanto, el procedimiento de promoción a `Production` se diseña bajo **verificación explícita obligatoria**, **sin asumir jamás** que una promoción automática preserva TTL, tipos `Number` o las 11 columnas exactas de `Users.GSI_Directory` sin comprobarlo después.

1. **Qué NO migra entre `Development` y `Production`:**
   - **Los documentos/filas NoSQL NO se copian** entre `Development` y `Production`.
   - **Los usuarios de Catalyst Authentication creados en `Development` NO se copian** a `Production` (cada entorno requiere verificar `0` usuarios reales antes del bootstrap limpio de `Production`).
2. **Cómo se traslada la infraestructura a `Production` (dos mecanismos posibles en Catalyst):**
   - **Vía A — Despliegue/Promoción desde Catalyst Console / CLI en etapa posterior (no ejecutado aquí):** Cuando Catalyst promueve/despliega recursos de `Development` hacia `Production`, puede propagar definiciones de componentes del proyecto (p. ej. esquemas de tablas o funciones cuando se despliega el proyecto hacia `Production`), **pero puede requerir configuración específica por entorno** en Authentication (redirect URLs, remitentes de correo, plantillas) y variables de entorno.
   - **Vía B — Verificación / Replicación controlada directamente en el selector de entorno `Production`:** Si alguna tabla, GSI, proyección de 11 columnas, o ajuste de `ttlEpochSec (Number)` no apareciera con paridad exacta tras promover, **detenerse (`STOP`)**, recrear la tabla vacía discrepante directamente en `Production` con el mismo procedimiento exacto de la Sección 6 antes de insertar una sola fila, y repetir el verificador `--live --confirm-readonly` apuntando a `CATALYST_ENVIRONMENT=Production` y `VIGOR_ENVIRONMENT=production`.

---

## 3. AUDITORÍA DE `scripts/verify-clean-slate-provisioning.ts`

Inspeccionado íntegramente (`scripts/verify-clean-slate-provisioning.ts:1-170`, `src/provisioning/postProvisioningVerifier.ts:166-190`, `src/provisioning/catalystConfigPreflight.ts:430-626`, `src/sdk/catalystSdkBridge.ts:280-388`):

| Aspecto Auditado | Evidencia Exacta en Código | Dictamen |
| :--- | :--- | :--- |
| **Rol de `--auth-mode external_oauth`** | En `verify-clean-slate-provisioning.ts:111-120`, el CLI corre en la estación del operador (fuera del contenedor Advanced I/O donde Catalyst Edge inyecta `x-zc-admin-cred-token`). Por ello rechaza `--auth-mode hosted_native` con `HOSTED_NATIVE_UNAVAILABLE_OUTSIDE_ADVANCED_IO` y exige `--auth-mode external_oauth`. | **Es exclusivamente la autenticación administrativa OAuth del operador/CLI local.** NO activa ni altera Catalyst Authentication ni cambia `VIGOR_CATALYST_AUTH_MODE=hosted_native` en `vigor_api`. |
| **Propósito exacto de `CATALYST_PROJECT_KEY`** | En `catalystSdkBridge.ts:324,357`, `catalystConfigPreflight.ts:62` y `@zcatalyst/auth-admin/dist-es/index.js:221`, el SDK oficial envía `CATALYST_PROJECT_KEY` en la cabecera HTTP **`PROJECT_ID`** (`addDefaultAppHeaders()`), mientras que `CATALYST_PROJECT_ID=136967000000014024` viaja en la ruta URL `/baas/v1/project/136967000000014024/...` (corregido en Fase 5.0.1, Tests 64 y 65). | Obligatoria para `--live --confirm-readonly` (`external_oauth`); **no** es el `CATALYST_PROJECT_ID` numérico sino la clave de aplicación del proyecto Catalyst (`Project Key`). |
| **Credenciales mínimas y permisos del operador** | Requiere variables públicas (`CATALYST_PROJECT_ID=136967000000014024`, `CATALYST_ENVIRONMENT`, `VIGOR_ENVIRONMENT`, `CATALYST_API_DOMAIN=https://api.catalyst.zoho.com`, `CATALYST_ACCOUNTS_URL=https://accounts.zoho.com`), `CATALYST_PROJECT_KEY`, y **una** de estas credenciales administrativas OAuth:<br>• **Opción mínima recomendada (efímera read-only en Dev):** `CATALYST_ADMIN_ACCESS_TOKEN` de corta duración con permisos mínimos para leer metadatos/ítems NoSQL y listar usuarios en `Project-Rainfall` (`--live` lo acepta con warning no bloqueante para diagnóstico `provisioning_readonly`, prohibido en `production` server runtime).<br>• **Opción persistente controlada:** `CATALYST_ADMIN_CLIENT_ID`, `CATALYST_ADMIN_CLIENT_SECRET`, `CATALYST_ADMIN_REFRESH_TOKEN` de un rol operador/administrador de `Project-Rainfall`. | Principio de mínimo privilegio: usar token efímero únicamente cuando el operador ejecute el chequeo read-only en su estación, sin guardar secretos en archivos versionados. |
| **Garantía estricta de solo lectura** | 1) Sin `--live`: ejecuta `runOfflineSelfCheck()` (`0` red, `0` escrituras).<br>2) `--preflight`: ejecuta `runCatalystConfigPreflight()` (`0` red, `0` escrituras).<br>3) `--live`: exige explícitamente `--confirm-readonly` (`line 105`).<br>4) `createReadOnlyEnvironmentFromProvider()` (`postProvisioningVerifier.ts:166-190`) envuelve los clientes y expone **únicamente** `nosql.getAllTable()`, `fetchItem()`, `queryTable()`, `queryIndex()` y `auth.getAllUsers()`. `writeOperationsExecuted` es tipo literal `0` (`tests/05` valida estáticamente ausencia de llamadas de escritura). | **`0` escrituras, `0` documentos de prueba, `0` creación de usuarios.** |
| **Protección contra fuga de secretos** | `catalystConfigPreflight.ts` enmascara secretos con `[REDACTED:len=N]`, `redactSecretsFromString()` limpia `Zoho-oauthtoken`, `Bearer` y secretos cargados incluso en errores de `catch` (`verify-clean-slate-provisioning.ts:166`). | Cero secretos en pantalla, JSON de salida o archivos del repo. |

---

## 4. AUDITORÍA DE NATIVE CATALYST AUTHENTICATION (HOSTED LOGIN VS EMBEDDED LOGIN)

### 4.1 Evidencia Real en Código Instalado (`@zcatalyst/auth@1.0.0`) y React/Slate

Al inspeccionar directamente `@zcatalyst/auth/dist-es/web.js`, `internal/iframe-signin.js`, `internal/token-manager.js`, la SPA desacoplada (`poc/catalyst-clean-slate/src/frontend/adapters/CatalystHttpAuthRepository.ts`) y la vista heredada raíz (`src/views/LoginView.tsx`), se verifican estos hechos:

1. **El Web SDK `@zcatalyst/auth@1.0.0` NO posee `signInWithEmailAndPassword(email, password)`:**
   - Los formularios propios de `src/views/LoginView.tsx` (que enviaban email/password directamente al SDK cliente de Firebase) **no tienen equivalente directo** en `@zcatalyst/auth/dist-es/web.js`. El usuario final debe autenticarse a través de **Catalyst Authentication** mediante uno de dos mecanismos soportados por el SDK (`web.js:80-126`):
     - **Embedded Login (`zcAuth.signIn(containerId, config)`):** `IframeSignInManager` (`internal/iframe-signin.js:27-182`) inyecta un `<iframe id="iam_iframe">` apuntando a `/accounts/p/${zaid}/signin` en el origen actual y lee `iframeElem.contentWindow.document` para inyectar I18N/MutationObserver/CSS; además consulta `/__catalyst/auth/public-signup`. Si la página corre dentro de otro iframe, dispara `PopupManager` que guarda un OAuth token en **IndexedDB** (`OAuthTokenProtocol`).
     - **Hosted Login (`zcAuth.hostedSignIn(redirectUrl)`):** Redirige en ventana de nivel superior hacia `/__catalyst/auth/login?redirect_url=...` (`web.js:121-126`), gestionado íntegramente por Catalyst en el origen de Slate (`https://app.vigorcore.lat`), y al completar el login devuelve al usuario a `https://app.vigorcore.lat/...` con cookie de sesión Catalyst (`ZD_CSRF_TOKEN` / `ZcrfTokenProtocol`).
2. **Integración idéntica con Modelo B Refinado (`CatalystHttpAuthRepository`):**
   - Independientemente de si el login inicial en Slate fue Hosted o Embedded, una vez el usuario regresa autenticado a `https://app.vigorcore.lat`, la SPA llama a `zcAuth.generateAuthToken('functions')` (`internal/token-manager.js:26-69`), mantiene el `access_token` efímero (1h) **exclusivamente en RAM** (prohibido `localStorage`/`sessionStorage`/IDB), y ejecuta `POST /api/v1/auth/session/bootstrap-profile` o `/exchange` (`preSessionExchange: true`, `credentials: 'include'`) para recibir la cookie propia **`__Host-vigor_session; HttpOnly; Secure; SameSite=Strict; Path=/`** y el token CSRF en memoria **`X-Vigor-CSRF`**.

### 4.2 Comparativa y Decisión Recomendada: **Hosted Login (Recomendado)** vs Embedded Login

| Criterio Técnico | **Hosted Login (`hostedSignIn`) — RECOMENDADO** | Embedded Login (`signIn(id)` / `#iam_iframe`) |
| :--- | :--- | :--- |
| **Acoplamiento DOM y fragilidad SDK** | **Nulo:** navegación top-level limpia a `/__catalyst/auth/login`; no manipula el DOM interno de Zoho IAM. | **Alto:** `iframe-signin.js` accede a `iframeElem.contentWindow.document`, modifica nodos `.signin_container` y depende de clases CSS internas de Zoho IAM. |
| **Compatibilidad CSP y Navegadores (Safari/Chromium)** | **Alta:** evita embedding en iframe y facilita políticas CSP estrictas (`frame-ancestors 'none'`). | Requiere permitir framing same-origin del portal `/accounts/p/{zaid}` y en contextos iframe cae a `PopupManager` + **IndexedDB OAuth**. |
| **Alineación con Modelo B (Zero tokens persistentes en cliente)** | **Total:** usa flujo estándar `ZcrfTokenProtocol` (`ZD_CSRF_TOKEN`) + intercambio único `/exchange` -> `__Host-vigor_session` `HttpOnly`. | Riesgo de caer en `OAuthTokenProtocol` (tokens persistidos en IndexedDB si dispara `PopupManager`). |
| **Control de alta y reset de contraseña** | Redirige limpiamente a `https://app.vigorcore.lat/auth/login` (o ruta callback definida); botón "Iniciar sesión en VigorCore" dentro de React dispara `hostedSignIn('/auth/callback')`. | Mantiene la shell React visible alrededor del iframe, pero requiere CSS custom para encajar con Tailwind/tema oscuro y probar `public-signup` + `forgotPassword`. |

**Decisión recomendada para Fase 5.2 (y validable al integrar frontend):**
- Activar **únicamente `Native Catalyst Authentication`** (`Set Up`) en Catalyst Console y mantener **`Third-party Authentication` desactivado (`Set Up`)** (sin Google OAuth / SSO externo en esta fase Clean-Slate).
- Seleccionar **Hosted Login** como flujo primario recomendado para `app.vigorcore.lat` (`hostedSignIn()`), configurando la URL de redirección post-login/reset hacia **`https://app.vigorcore.lat/auth/login`** (con path de callback limpio en la fase frontend). *(Nota: Embedded Login podría evaluarse únicamente si el operador decidiera priorizar mantener la tarjeta visual de React alrededor de `#iam_iframe` y verificara en vivo `https://app.vigorcore.lat/accounts/p/<ZAID>/signin` sin activar `PopupManager`/IDB).*

### 4.3 Separación Estricta: Autenticación de Usuario Final vs Autenticación Administrativa de `vigor_api`

| Plano | Quién se autentica | Mecanismo Exacto | Credenciales / Tokens |
| :--- | :--- | :--- | :--- |
| **1. Usuario Final (Atleta / Admin en navegador)** | Persona humana en `https://app.vigorcore.lat/` | **Native Catalyst Authentication** (Hosted Login recomendado) -> `generateAuthToken('functions')` -> `POST /bootstrap-profile` o `/exchange` -> cookie **`__Host-vigor_session`** + **`X-Vigor-CSRF`**. | Solo identidad de usuario Catalyst (`scope: 'user'` en `/bootstrap-profile` y `/exchange`) + cookie HMAC `HttpOnly SameSite=Strict` en el resto de la API. Nunca posee permisos NoSQL ni `CATALYST_PROJECT_KEY`. |
| **2. Backend `vigor_api` (Advanced I/O alojado)** | Servicio servidor Node 22 en Catalyst | **`VIGOR_CATALYST_AUTH_MODE=hosted_native`** (`HostedNativeCatalystAuthRuntime`: `new ZCAuth().init({ headers }, { type: 'advancedio', scope: 'admin' })`). | Usa credenciales efímeras de plataforma inyectadas por Catalyst (`x-zc-admin-cred-token` / `x-zc-project-key`) para operar sobre las 5 tablas NoSQL y `UserManagementAdmin` (`updateUserStatus`, `getUserDetails`), **con anti-IDOR estricto por `actor.catalystUserId`**. *(Fallback documentado `external_oauth` solo si Gateway `NO_AUTHENTICATION` no inyectara headers en Fase 5.3).* |
| **3. Operador CLI (`verify-clean-slate-provisioning.ts`)** | Operador humano desde Windows PowerShell | `--live --confirm-readonly --auth-mode external_oauth` (`CatalystAdminAppProvider`). | Credenciales OAuth de operador en memoria/sesión de terminal (`CATALYST_PROJECT_KEY` + `CATALYST_ADMIN_*`); **0 escrituras**. |

### 4.4 Verificación Directa Obligatoria del Conteo Real de Usuarios (`Development` y `Production`)

> **Regla heredada de Fase 5.1.2 (`docs/27`):** Ver el botón **`Set Up`** en Authentication **NO constituye prueba directa** de que existan `0` usuarios. Tras completar **`Set Up`** de Native Catalyst Authentication, el operador **DEBE inspeccionar directamente la lista de usuarios**:

1. **En `Development` (durante Fase 5.2):**
   - Seleccionar entorno **`Development`** en la barra superior de Catalyst Console.
   - Ir a **Authentication → Users** (listado/gestión de usuarios del proyecto en el entorno activo).
   - Comprobar visualmente de forma directa que la tabla de usuarios está vacía (**`0` usuarios registrados**).
   - Corroborar adicionalmente cuando se corra el verificador CLI en `Development`: confirmar `"authUsersCount": 0` en el JSON devuelto por `verify-clean-slate-provisioning.ts --live --confirm-readonly`.
2. **En `Production` (al promover/replicar a Producción):**
   - Cambiar explícitamente el selector de entorno en Catalyst Console a **`Production`**.
   - Volver a abrir **Authentication → Users**.
   - Comprobar visualmente de forma directa **`0` usuarios registrados** (y corroborar `"authUsersCount": 0` al ejecutar `--live --confirm-readonly` contra `CATALYST_ENVIRONMENT=Production` antes del bootstrap offline del primer superadministrador).
3. **Condición `STOP`:** Si el recuento real en `Development` o `Production` es **`> 0`**, **DETENERSE inmediatamente** antes del bootstrap offline, anotar los correos/IDs encontrados sin borrar cuentas sin autorización, y documentar su origen.

---

## 5. REQUISITOS PREVIOS: FACTURACIÓN, CUOTAS, PERMISOS Y RUTAS DE CONSOLA

### 5.1 Requisitos Previos del Operador y Cuenta Zoho Catalyst

1. **Permisos del operador en `Project-Rainfall` (`136967000000014024`):**
   - Rol de **Project Owner / Admin** (o rol equivalente en Catalyst Console con permisos para crear/ver tablas e índices NoSQL, configurar Authentication, ver Project Settings / Project Key, y consultar usuarios).
2. **Facturación, límites de plataforma y cuotas a comprobar en `Project-Rainfall` antes de operar:**
   - **Tablas e índices NoSQL:** 5 tablas y 8 GSIs totales (`Users`: 3 GSIs, `AuditLogs`: 3 GSIs, `UserData`: 1 GSI, `AdminInvitations`: 1 GSI, `SystemControl`: 0 GSIs) están ampliamente dentro del límite técnico por tabla de Catalyst (`<= 20` GSIs/tabla, `<= 5` Sort Keys totales/tabla — máximo usado en VigorCore: `3` GSIs y `3` SKs).
   - **Plan / Cuotas de NoSQL:** Confirmar en Consola (**Billing / Usage / Plan**) que el proyecto `Project-Rainfall` tiene cuota disponible para crear 5 tablas NoSQL en `Development` (y su posterior presencia en `Production`) y conocer los límites diarios/mensuales de operaciones de lectura/escritura (RCU/WCU) y almacenamiento del plan activo.
   - **Cuota de Authentication y correos transaccionales:** Confirmar en el plan activo el límite de **MAU (Monthly Active Users)** y la cuota de correos de confirmación/restablecimiento de contraseña antes de configurar Native Auth y antes de futuras pruebas con usuarios reales.
   - *(Recordatorio fuera de Fase 5.2: API Gateway, Domain Mapping y `vigor_api` NO se tocan ni se activan en esta fase).*

### 5.2 Guía Honesta de Navegación en Zoho Catalyst Console

> **Nota sobre nombres exactos en UI:** Como la interfaz web de Zoho Catalyst puede variar ligeramente entre revisiones de consola (p. ej. agrupación bajo *Cloud Scale* vs *Develop* / *Build*), se indican las secciones funcionales exactas observadas ya por el operador en `Project-Rainfall`:
> 1. **Selector de Proyecto y Entorno (parte superior de Catalyst Console):** Confirmar **`Project-Rainfall`** y seleccionar explícitamente el entorno **`Development`** antes de crear cualquier recurso.
> 2. **NoSQL (`Cloud Scale` / `NoSQL`):** Sección donde en Fase 5.1.2 apareció **`Create your first table`**.
> 3. **Authentication (`Cloud Scale` / `Authentication`):** Sección donde aparecen **`Native Catalyst Authentication` (`Set Up`)** y **`Third-party Authentication` (`Set Up`)**, y la subvista **`Users`** para el recuento directo.
> 4. **Project Settings / Environment / Key:** Sección donde se consultan el `Project ID` (`136967000000014024`), el `Org ID` (si aplica) y, únicamente en estación local al correr `--live --confirm-readonly`, el `Project Key` (`CATALYST_PROJECT_KEY`). **Nunca copiar el Project Key en documentos, chats ni archivos del repositorio.**

---

## 6. PROCEDIMIENTO OPERATIVO PASO A PASO — FASE 5.2 (`DEVELOPMENT FIRST`)

> **COMPILACIÓN DE REGLAS DE EJECUCIÓN:**
> - **NO ejecutar todavía sin autorización explícita de Fase 5.2.**
> - Trabajar **PRIMERO** en entorno **`Development`** de `Project-Rainfall` (`136967000000014024`).
> - Mantener `API Gateway` en `Enable now` (deshabilitado), `Functions` vacío (`0` despliegues), `Third-party Authentication` en `Set Up` (desactivado), `Domain Mapping` intacto (`Add Mapping` sin cambios) y **`app.vigorcore.lat` (Slate) sin tocar**.
> - **Cero inserciones de datos** durante Fase 5.2 (`0` filas en todas las tablas; `0` usuarios en Auth; cero bootstrap).

### Paso 0 — Verificación previa en Consola antes de crear la primera tabla
1. Entrar a Catalyst Console → confirmar proyecto **`Project-Rainfall`** (`136967000000014024`), DC **US** (`accounts.zoho.com`).
2. Seleccionar entorno **`Development`**.
3. Abrir **NoSQL** y confirmar estado vacío (`Create your first table` / `0` tablas).
   - **STOP** si ya existiera alguna de las 5 tablas (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`) o cualquier documento.

### Paso 1 — Crear Tabla 1: `Users` (en `Development`)
1. Iniciar creación de tabla con estos **valores exactos**:
   - **Table Name:** `Users`
   - **Partition Key Name:** `pk` · **Data Type:** `String`
   - **Primary Sort Key:** **Omitir / dejar sin configurar** *(no añadir Sort Key primaria)*
   - **Additional Sort Keys:** **Ninguna** (`0`)
   - **TTL:** **Desactivado** (`Disabled` / sin habilitar)
2. Crear / añadir exactamente los **3 Global Secondary Indexes**:
   - **GSI 1 — `GSI_Email`:**
     - Index Name: `GSI_Email`
     - Partition Key: `normalizedEmail` (`String`)
     - Sort Key: *Ninguna / Omitida*
     - Projected Attributes: **`ALL`**
   - **GSI 2 — `GSI_Directory`:**
     - Index Name: `GSI_Directory`
     - Partition Key: `directorySegment` (`String`)
     - Sort Key: `createdAt` (`String`)
     - Projected Attributes: **`Include / Specific Attributes`** con exactamente estas **11 columnas**:
       `pk`, `uid`, `email`, `displayName`, `role`, `roleVersion`, `accountStatus`, `emailVerified`, `directorySegment`, `createdAt`, `lastSignInAt`
   - **GSI 3 — `GSI_RoleStatus`:**
     - Index Name: `GSI_RoleStatus`
     - Partition Key: `role` (`String`)
     - Sort Key: `accountStatus` (`String`)
     - Projected Attributes: **`ALL`**
3. **Verificación visual inmediata (`Users` — Etapa 1 Registrada en `Development`):**
   - [x] **Table ID:** `136967000000065001` en entorno `Development`.
   - [x] PK = `pk` (`String`), sin Primary SK, `0` Additional SKs, TTL **desactivado** (configuración comunicada por operador).
   - [x] `GSI_Email` (`136967000000065003` — `normalizedEmail: S`, sin SK, `ALL`) = `Active` (`0` elementos, `0` bytes).
   - [x] `GSI_Directory` (`136967000000067001` — `directorySegment: S`, SK `createdAt: S`, **exactas 11 columnas** listadas arriba) = `Active` (`0` elementos, `0` bytes).
   - [x] `GSI_RoleStatus` (`136967000000067004` — `role: S`, SK `accountStatus: S`, `ALL`) = `Active` (`0` elementos, `0` bytes).
   - [x] Consola = **`0` registros y `0` bytes**.
4. **Condición `STOP`:** Si Catalyst obliga a crear Primary Sort Key, no permite omitir SK en `GSI_Email`, o faltan columnas en `GSI_Directory`, **DETENERSE** y eliminar/recrear la tabla vacía antes de seguir.

### Paso 2 — Crear Tabla 2: `UserData` (en `Development`)
1. Crear tabla con estos **valores exactos**:
   - **Table Name:** `UserData`
   - **Partition Key Name:** `pk` · **Data Type:** `String`
   - **Primary Sort Key Name:** `sk` · **Data Type:** `String`
   - **Additional Sort Keys (`2` adicionales):**
     1. `entityType` (`String`)
     2. `updatedAt` (`String`)
   - **TTL:** **Desactivado** (`Disabled`)
2. Crear / añadir exactamente **1 Global Secondary Index**:
   - **GSI 4 — `GSI_UserEntityDate`:**
     - Index Name: `GSI_UserEntityDate`
     - Partition Key: `pk` (`String`)
     - Sort Key: `entityDateKey` (`String`)
     - Projected Attributes: **`ALL`**
3. **Verificación visual inmediata (`UserData` — Etapa 1 Registrada en `Development`):**
   - [x] **Table ID:** `136967000000067007` en `Development`.
   - [x] PK = `pk` (`String`), Primary SK = `sk` (`String`), Additional SKs = `entityType` (`String`), `updatedAt` (`String`).
   - [x] TTL **desactivado** (configuración comunicada por operador).
   - [x] `GSI_UserEntityDate` (`136967000000067011` — `pk: S`, SK `entityDateKey: S`, `ALL`) = `Active` (`0` elementos, `0` bytes).
   - [x] Consola = **`0` registros y `0` bytes**.
4. **Condición `STOP`:** Detener si no quedan exactamente las 3 SKs (`sk` + `entityType` + `updatedAt`) o si el GSI falla.

### Paso 3 — Crear Tabla 3: `AdminInvitations` (en `Development`)
1. Crear tabla con estos **valores exactos**:
   - **Table Name:** `AdminInvitations`
   - **Partition Key Name:** `pk` · **Data Type:** `String`
   - **Primary Sort Key:** **Omitir / dejar sin configurar**
   - **Additional Sort Keys:** **Ninguna** (`0`)
   - **TTL:** **Activado (`Enabled`)** — Attribute Name: **`ttlEpochSec`** · Data Type: **`Number`**
2. Crear / añadir exactamente **1 Global Secondary Index**:
   - **GSI 5 — `GSI_InviteEmailStatus`:**
     - Index Name: `GSI_InviteEmailStatus`
     - Partition Key: `emailNormalized` (`String`)
     - Sort Key: `status` (`String`)
     - Projected Attributes: **`ALL`**
3. **Verificación visual inmediata (`AdminInvitations` — Etapa 1 Registrada en `Development`):**
   - [x] **Table ID:** `136967000000067014` en `Development`.
   - [x] PK = `pk` (`String`), sin Primary SK ni Additional SKs.
   - [x] TTL **activado** con atributo exacto **`ttlEpochSec`** y tipo **`Number`** *(confirmado por el operador)*.
   - [x] `GSI_InviteEmailStatus` (`136967000000067016` — `emailNormalized: S`, SK `status: S`, `ALL`) = `Active` (`0` elementos, `0` bytes).
   - [x] Consola = **`0` registros y `0` bytes**.
4. **Condición `STOP`:** Si la consola fuerza SK primaria o no permite **`ttlEpochSec` tipo `Number`**, **DETENERSE** antes de continuar.

### Paso 4 — Crear Tabla 4: `AuditLogs` (en `Development`)
1. Crear tabla con estos **valores exactos**:
   - **Table Name:** `AuditLogs`
   - **Partition Key Name:** `pk` · **Data Type:** `String`
   - **Primary Sort Key Name:** `sk` · **Data Type:** `String`
   - **Additional Sort Keys (`2` adicionales):**
     1. `action` (`String`)
     2. `timestamp` (`String`)
   - **TTL:** **Desactivado** (`Disabled` — retención permanente *append-only*)
2. Crear / añadir exactamente los **3 Global Secondary Indexes**:
   - **GSI 6 — `GSI_AuditActor`:**
     - Index Name: `GSI_AuditActor`
     - Partition Key: `actorUid` (`String`)
     - Sort Key: `timestamp` (`String`)
     - Projected Attributes: **`ALL`**
   - **GSI 7 — `GSI_AuditTarget`:**
     - Index Name: `GSI_AuditTarget`
     - Partition Key: `targetUid` (`String`)
     - Sort Key: `timestamp` (`String`)
     - Projected Attributes: **`ALL`**
   - **GSI 8 — `GSI_GlobalChronology`:**
     - Index Name: `GSI_GlobalChronology`
     - Partition Key: `auditPeriodBucket` (`String`)
     - Sort Key: `globalChronologyKey` (`String`)
     - Projected Attributes: **`ALL`**
3. **Verificación visual inmediata (`AuditLogs` — Etapa 1 Registrada en `Development`):**
   - [x] **Table ID:** `136967000000067021` en `Development`.
   - [x] PK = `pk` (`String`), Primary SK = `sk` (`String`), Additional SKs = `action` (`String`), `timestamp` (`String`).
   - [x] TTL **desactivado** (configuración comunicada por operador).
   - [x] `GSI_AuditActor` (`136967000000067025`), `GSI_AuditTarget` (`136967000000067028`), `GSI_GlobalChronology` (`136967000000067031`) = `Active` (`0` elementos, `0` bytes; todos `ALL`).
   - [x] Consola = **`0` registros y `0` bytes**.
4. **Condición `STOP`:** Detener si se activara TTL por error o faltara cualquiera de los 3 GSIs o Additional SKs.

### Paso 5 — Crear Tabla 5: `SystemControl` (en `Development`)
1. Crear tabla con estos **valores exactos**:
   - **Table Name:** `SystemControl`
   - **Partition Key Name:** `pk` · **Data Type:** `String`
   - **Primary Sort Key:** **Omitir / dejar sin configurar**
   - **Additional Sort Keys:** **Ninguna** (`0`)
   - **Global Secondary Indexes:** **Ninguno** (`0`)
   - **TTL:** **Activado (`Enabled`)** — Attribute Name: **`ttlEpochSec`** · Data Type: **`Number`**
2. **Verificación visual inmediata (`SystemControl` — Etapa 1 Registrada en `Development`):**
   - [x] **Table ID:** `136967000000067034` en `Development`.
   - [x] PK = `pk` (`String`), sin Primary SK, sin Additional SKs, **`0` GSIs**.
   - [x] TTL **activado** con atributo exacto **`ttlEpochSec`** y tipo **`Number`** *(confirmado por el operador)*.
   - [x] Consola = **`0` registros y `0` bytes** *(ningún ítem `CTRL#*` ni `SESSION#*` creado todavía)*.
3. **Recordatorio obligatorio para fases posteriores:** Cuando la aplicación escriba en `SystemControl`, `ttlEpochSec` se asignará **exclusivamente** en `CTRL#SAGA#<idempotencyKey>` y `SESSION#<sid>`; queda **prohibido** incluir `ttlEpochSec` en `CTRL#BOOTSTRAP` y `CTRL#SUPERADMIN_COUNT`.

### Paso 6 — Configurar `Native Catalyst Authentication` en `Development` (sin usuarios todavía)
1. En Catalyst Console (con entorno **`Development`** seleccionado), abrir **Authentication**.
2. Hacer **`Set Up`** **únicamente** en **Native Catalyst Authentication**:
   - Seleccionar tipo **Hosted Login** (recomendado según Sección 4; *Embedded* solo si se justificara expresamente el framing del portal IAM).
   - Configurar **URL de redirección / login** apuntando a `https://app.vigorcore.lat/auth/login` *(o la ruta de callback acordada para Slate en fase de integración frontend)*.
   - **Public Signup:** Deshabilitado o restringido conforme a política de acceso por invitación / alta controlada (nota: `bootstrap-profile` exige usuario confirmado en Catalyst y no expone `/bootstrap-superadmin`).
   - Revisar plantilla de correo de verificación / reset de contraseña (remitente válido en plan activo, URL de retorno `https://app.vigorcore.lat/auth/login`).
   - **NO activar `Third-party Authentication`** (dejar en `Set Up`).
3. **Verificación directa obligatoria del conteo de usuarios:**
   - Entrar a **Authentication → Users** dentro del entorno **`Development`**.
   - Confirmar visualmente de forma directa que la lista muestra **`0` usuarios**.
   - Anotar el `ZAID` público del proyecto/entorno si la consola lo muestra en los ajustes del Web SDK (valor público no secreto; **no** copiar secretos SMTP ni OAuth secrets al repo).

### Paso 7 — Verificación Automatizada de Solo Lectura (Estación Windows PowerShell 5.1 del Operador)

> **Compatibilidad garantizada:** Todos los comandos usan **Windows PowerShell 5.1** sin operadores `&&` ni `||`. Ejecutar desde la raíz del repositorio en la estación local del operador **únicamente después** de completar los Pasos 1–6 en `Development`.

#### 7.1 Comprobación local sin red (`0` llamadas remotas, `0` credenciales)
```powershell
Set-Location -Path .\poc\catalyst-clean-slate
npx tsx scripts/verify-clean-slate-provisioning.ts
```
- Debe devolver `"mode": "OFFLINE_SELF_CHECK"`, `"verdict": "PASS_SELF_CHECK"`, `"writeOperationsExecuted": 0`.

#### 7.2 Preflight local de variables en sesión temporal (sin guardar en archivos versionados)
Define en memoria de la sesión actual de PowerShell únicamente las variables requeridas (`[CONFIGURAR_EN_ESTACION]` = introducir el valor real en consola local, nunca en disco versionado):

```powershell
$env:VIGOR_CATALYST_AUTH_MODE = 'external_oauth'
$env:CATALYST_PROJECT_ID = '136967000000014024'
$env:CATALYST_PROJECT_KEY = '<CONFIGURAR_EN_ESTACION>'
$env:CATALYST_ENVIRONMENT = 'Development'
$env:VIGOR_ENVIRONMENT = 'development'
$env:CATALYST_API_DOMAIN = 'https://api.catalyst.zoho.com'
$env:CATALYST_ACCOUNTS_URL = 'https://accounts.zoho.com'
# Usar preferiblemente token efímero read-only (1h) o credenciales OAuth del operador:
$env:CATALYST_ADMIN_ACCESS_TOKEN = '<CONFIGURAR_EN_ESTACION>'

npx tsx scripts/verify-clean-slate-provisioning.ts --preflight --auth-mode external_oauth --expected-project 136967000000014024 --expected-region us
```
- Debe devolver `"verdict": "PASS"`, `"networkCallsExecuted": 0`, `"writeOperationsExecuted": 0` y secretos redactados (`[REDACTED:len=...]`).

#### 7.3 Verificación remota estrictamente de solo lectura (`--live --confirm-readonly`)
```powershell
npx tsx scripts/verify-clean-slate-provisioning.ts --live --confirm-readonly --auth-mode external_oauth --expected-project 136967000000014024 --expected-region us
```
- **Criterios obligatorios de aceptación (`PASS`):**
  1. `"verdict": "PASS_READONLY_CLEAN_SLATE"` y `"writeOperationsExecuted": 0`.
  2. `"tablesFound"` = exactamente `["AdminInvitations", "AuditLogs", "SystemControl", "UserData", "Users"]` y `"extraTablesFound": []`.
  3. Las 5 entradas en `"tableMatrix"` y las 8 entradas en `"indexMatrix"` con `exists: true`, `status: "ONLINE"`, `partitionKeyOk: true`, `sortKeyOk: true`, `additionalSortKeysOk: true`, `ttlOk: true`, `emptyProbePassed: true`.
  4. `Users.GSI_Directory`: `includeColumnsOk: true` (exactamente las 11 columnas).
  5. `"authUsersCount": 0`.
  6. `"discrepancies": []`.
- **Limpieza inmediata de credenciales en la sesión PowerShell tras terminar:**
```powershell
Remove-Item Env:CATALYST_ADMIN_ACCESS_TOKEN, Env:CATALYST_ADMIN_CLIENT_ID, Env:CATALYST_ADMIN_CLIENT_SECRET, Env:CATALYST_ADMIN_REFRESH_TOKEN, Env:CATALYST_PROJECT_KEY -ErrorAction SilentlyContinue
```

### Paso 8 — Promoción y Verificación en `Production` (Solo Cuando Se Autorice Paso a Producción)
1. Confirmar que `Development` superó **al 100%** los Pasos 1–7 (`PASS_READONLY_CLEAN_SLATE`) y que existe autorización explícita para replicar/promover a **`Production`**.
2. Cambiar el selector de entorno en Catalyst Console a **`Production`** (o ejecutar la acción oficial de promoción/despliegue hacia `Production` cuando corresponda a la fase de proyecto).
3. **No asumir fidelidad automática:** inspeccionar **una por una** las 5 tablas y los 8 GSIs en `Production`:
   - Confirmar los 5 nombres exactos, `ONLINE`, `0` documentos en Data Browser.
   - Confirmar `ttlEpochSec` tipo **`Number`** en `AdminInvitations` y `SystemControl`, y TTL desactivado en `Users`, `UserData`, `AuditLogs`.
   - Confirmar las **11 columnas** exactas en `Users.GSI_Directory`.
   - Si cualquier parámetro difiriera o faltara alguna tabla/GSI en `Production`, **detenerse (`STOP`)**, corregir/recrear la tabla vacía en `Production` con los Pasos 1–5 antes de insertar datos.
4. En `Production`, configurar **Native Catalyst Authentication** (`Hosted Login`, redirect `https://app.vigorcore.lat/auth/login`, Third-party desactivado) e inspeccionar directamente **Authentication → Users** confirmando **`0` usuarios**.
5. Ejecutar `--live --confirm-readonly` contra `Production` (`CATALYST_ENVIRONMENT='Production'`, `VIGOR_ENVIRONMENT='production'` — usar OAuth `CATALYST_ADMIN_CLIENT_ID`/`SECRET`/`REFRESH_TOKEN` si se evalúa en modo completo o access token efímero en `--preflight`/read-only `provisioning_readonly`) y validar `PASS_READONLY_CLEAN_SLATE` + `authUsersCount: 0` antes de autorizar Fase 5.3 (`vigor_api`) o bootstrap.

---

## 7. CONDICIONES `STOP` INMEDIATAS Y DICTAMEN DE PREPARACIÓN

### Condiciones Hard-`STOP`
1. Presencia previa de cualquiera de las 5 tablas con filas residuales o esquema distinto.
2. Consola obliga a añadir Sort Key en `Users`, `AdminInvitations` o `SystemControl`.
3. Consola impide configurar `ttlEpochSec` con tipo **`Number`** en `AdminInvitations` o `SystemControl`.
4. `Users.GSI_Directory` no proyecta exactamente las 11 columnas especificadas.
5. `Authentication → Users` (inspección directa en `Development` o `Production`) devuelve **`> 0` usuarios**.
6. `verify-clean-slate-provisioning.ts --live --confirm-readonly` devuelve `FAIL_SCHEMA_MISMATCH`, `FAIL_NON_EMPTY_STATE` o `discrepancies.length > 0`.

### Dictamen de Preparación y Actualización tras Cierre de Etapa 1
- **Estado base del runbook previo a ejecución:** `PHASE_5_2_RUNBOOK_READY_NOT_EXECUTED`
- **Estado actualizado tras cierre documental de Etapa 1 (`Development`):** **`PHASE_5_2_STAGE_1_NOSQL_PROVISIONING_COMPLETED`** *(registrado en `docs/29-phase-5.2-stage-1-nosql-provisioning-closure.md` y `src/provisioning/phase52Stage1Inventory.ts`)*
- **Diferenciación estricta de evidencia en este cierre:**
  - **Evidencia observada en la consola (reportada por el operador):** 5 Table IDs, 8 Index IDs en estado `Active`, 0 registros/elementos y 0 bytes en `Development`.
  - **Configuración comunicada por el operador:** claves/proyecciones exactas, ausencia de datos de prueba y TTL `ttlEpochSec` como `Number` en `AdminInvitations` y `SystemControl`.
  - **Validaciones locales del código:** conciliación exacta contra `TABLE_SCHEMA_REGISTRY`, unicidad de los 13 identificadores sin colisión con `136967000000014024` ni `16391000000005003`, builds y suite de tests locales.
  - **Consultas remotas automatizadas:** **NO ejecutadas** en este cierre documental (`0` llamadas remotas durante el cierre).
- **Alcance pendiente de autorización independiente:**
  - **Etapa 2 (`Paso 6` — Native Catalyst Authentication)** en `Development`.
  - Verificación CLI `--live --confirm-readonly` (`Paso 7`) cuando el operador decida correrla desde su estación.
  - Promoción y verificación en **`Production`** (`Paso 8`), `vigor_api` (Fase 5.3) y `api.vigorcore.lat` (`BLOCKED_PENDING_ZOHO_CLARIFICATION`).
