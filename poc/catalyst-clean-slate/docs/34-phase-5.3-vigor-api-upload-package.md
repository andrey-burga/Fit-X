# VIGORCORE — FASE 5.3: PREPARACIÓN DEL PAQUETE DE DESPLIEGUE DE `vigor_api`

**Proyecto en Google AI Studio:** `Fit-X` *(trabajo estrictamente aislado en `poc/catalyst-clean-slate/`)*  
**Proyecto Zoho Catalyst:** `Project-Rainfall`  
**Project ID:** `136967000000014024`  
**Data Center:** `US` (`accounts.zoho.com` · `https://api.catalyst.zoho.com`)  
**Entorno objetivo:** **`Development`** *(**`Production` intacto y sin modificar**)*  
**Dictamen heredado:** **`PHASE_5_3_PREDEPLOYMENT_RECONCILIATION_READY_NOT_EXECUTED`** (`docs/33-phase-5.3-predeployment-reconciliation.md`)  
**Operaciones remotas ejecutadas:** **`0`** *(solo compilación local, empaquetado en staging aislado, pruebas locales de verificación ZIP/ESM y auditoría técnica)*  
**Dictamen final:** **`PHASE_5_3_UPLOAD_PACKAGE_READY_NOT_DEPLOYED`**

---

## REGLAS DE ALCANCE Y HONESTIDAD DE VERIFICACIÓN

1. **Cero operaciones remotas:** en esta etapa **NO** se ha creado ni subido `vigor_api` en Zoho Catalyst Console, **NO** se ha desplegado por CLI, **NO** se ha habilitado API Gateway (`Enable now`), **NO** se ha tocado `api.vigorcore.lat`, **NO** se han creado usuarios en `Development` (`0` usuarios), **NO** se han insertado datos en NoSQL, **NO** se ha modificado el frontend Slate (`https://app.vigorcore.lat`) ni `Production`, y **NO** se han modificado archivos fuera de `poc/catalyst-clean-slate/`.
2. **Conciliación de versiones Node.js (`v24.16.0` operador vs `Node v22.23.2` local vs `Node.js 22` remoto):**
   - **Entorno local Windows del operador (`Windows PowerShell 5.1` + `Node.js v24.16.0`):** `prepare-vigor-api-upload.ps1` permite preparar el staging y el ZIP usando `Node.js 24` porque cumple **`engines.node >=22`**. Sin embargo, ejecutar el empaquetado y las validaciones locales bajo **Node.js 24 NO equivale a probar el runtime remoto Node.js 22 de Zoho Catalyst**.
   - **Evidencia independiente conservada en `Node v22.23.2`:** se conserva explícitamente como evidencia local independiente la importación ESM real de `artifacts/vigor_api/dist/server/catalystEntry.js` ejecutada bajo **`Node v22.23.2`** (`typeof mod.default === 'function'` y sonda fail-closed `503 SERVER_CONFIGURATION_UNAVAILABLE`).
   - **Plataforma viva (`PENDING_LIVE_VERIFICATION`):** la aceptación del ZIP por el formulario File Upload de Catalyst Console, el arranque en el runtime **remoto Node.js 22** de Catalyst Advanced I/O y la inspección real de las Security Rules generadas al crear la función permanecen **`PENDING_LIVE_VERIFICATION`**.
3. **Prohibición de secretos:** cero secretos HMAC, claves de proyecto, tokens OAuth, cookies o archivos `.env*` en el staging o en el ZIP.

---

## 1. STAGING LIMPIO AISLADO Y ESTRUCTURA EXACTA DE `vigor_api`

### 1.1 Artefactos generados localmente
- **Directorio aislado de staging:** `poc/catalyst-clean-slate/artifacts/vigor_api/` *(ignorado en Git mediante `poc/catalyst-clean-slate/.gitignore` junto con `*.zip`)*.
- **Paquete ZIP de carga:** `poc/catalyst-clean-slate/artifacts/vigor_api.zip` *(generado **únicamente** después de superar las 8 validaciones locales)*.
- **Script reproducible Windows PowerShell 5.1:** `poc/catalyst-clean-slate/scripts/prepare-vigor-api-upload.ps1`.

### 1.2 Inventario exacto incluido en staging (`906` archivos, `3,748,650` bytes descomprimidos)

| Ruta en la raíz del staging / ZIP | Contenido exacto | Tamaño medido | Regla cumplida |
| :--- | :--- | :---: | :--- |
| **`package.json`** | `"name": "vigor_api"`, `"version": "1.0.0"`, `"private": true`, `"type": "module"`, `"main": "dist/server/catalystEntry.js"`, `"engines": { "node": ">=22" }`, y exclusivamente las **6** dependencias runtime. Sin `devDependencies` ni `scripts`. | `482` B | Nombre de función, ESM explícito, entrypoint y runtime Node 22 declarados. |
| **`package-lock.json`** | Lockfile generado **limpiamente dentro del staging** mediante `npm install --omit=dev --ignore-scripts --package-lock` (`74` paquetes transitivos/directos). | `32,763` B | Separado del lockfile raíz (`54,142` B); libre de `devDependencies`. |
| **`catalyst-config.json`** | `deployment: { name: "vigor_api", type: "advancedio", stack: "node22" }`, `execution: { main: "dist/server/catalystEntry.js" }`. | `164` B | Ubicado directamente en la raíz del ZIP. |
| **`dist/` (`16` archivos `.js`)** | Exclusivamente los **9** subdirectorios runtime requeridos por `dist/server/catalystEntry.js`: `dist/auth/`, `dist/nosql/` (+ `providers/`), `dist/routes/`, `dist/sdk/`, `dist/security/`, `dist/server/`, `dist/services/`, `dist/types/`, `dist/validators/`. | `386,613` B | Excluye `dist/provisioning/`, `dist/frontend/` y source maps `.js.map`. |
| **`node_modules/` (`887` archivos)** | Exclusivamente las **6** dependencias runtime y sus dependencias transitivas (`74` paquetes, `0` vulnerabilidades reportadas por npm). | `3,328,628` B | Sin `typescript`, `tsx`, `playwright-core`, `@types/node` ni `@types/express`. |
| **Total staging descomprimido** | `906` archivos totales | **`3,748,650` B (`3.57 MiB` / `3.75 MB`)** | Estructura plana en raíz; cero carpetas contenedoras `vigor_api/`. |
| **Archivo `vigor_api.zip`** | Archivo ZIP comprimido directamente desde el contenido raíz del staging. | **`1,275,008` B (`1.22 MiB` / `1.28 MB`)** | Verificado sin carpeta padre envolvente y con integridad `unzip -tq` intacta. |

### 1.3 Exclusiones obligatorias verificadas
Quedan **estrictamente excluidos** del directorio de staging y del ZIP:
- `devDependencies`: `@types/express`, `@types/node`, `playwright-core`, `tsx`, `typescript`.
- Pruebas: `tests/`.
- Frontend: `src/frontend/`, `frontend/`, `dist-frontend/`, `vite.frontend.config.ts`.
- Documentación: `docs/`.
- Scripts operativos: `scripts/`.
- Candidatos y configuraciones no aplicadas: `config/candidates/`.
- Código no-runtime de aprovisionamiento/inventario: `src/provisioning/` y `dist/provisioning/`.
- Source maps: `*.js.map`.
- Secretos y variables de entorno: `.env*`, claves privadas, tokens, credenciales.
- Artefactos ajenos a Catalyst: cualquier archivo de Firebase o Google Cloud Platform (GCP).

### 1.4 Regla sobre `package-lock.json`
El `poc/catalyst-clean-slate/package-lock.json` raíz vincula `"name": "vigorcore-catalyst-clean-slate"` e incluye las 5 `devDependencies` (`54,142` B). **No debe copiarse** al directorio de staging. En su lugar, el staging reescribe `package.json` con `"name": "vigor_api"` y únicamente las 6 dependencias runtime, y ejecuta `npm install --omit=dev --ignore-scripts --package-lock` dentro de `artifacts/vigor_api/`, produciendo un `package-lock.json` propio de producción (`32,763` B).

---

## 2. CUMPLIMIENTO CON ZOHO CATALYST ADVANCED I/O (NODE.JS 22 — FILE UPLOAD)

| Requisito de Zoho Catalyst Advanced I/O | Configuración preparada en `vigor_api.zip` | Estado de verificación |
| :--- | :--- | :---: |
| **Function Type** | **`Advanced I/O`** (`catalyst-config.json`: `"deployment.type": "advancedio"`) | **`VERIFIED_LOCAL`** / `PENDING_LIVE_VERIFICATION` en Consola |
| **Function Name** | **`vigor_api`** (`package.json`: `"name": "vigor_api"`, `catalyst-config.json`: `"deployment.name": "vigor_api"`) | **`VERIFIED_LOCAL`** |
| **Stack / Runtime** | **`Node.js 22`** (`catalyst-config.json`: `"deployment.stack": "node22"`, `package.json`: `"engines.node": ">=22"`) | **`VERIFIED_LOCAL`** / `PENDING_LIVE_VERIFICATION` en runtime remoto |
| **Bundle / Método de carga** | **`File Upload`** mediante `artifacts/vigor_api.zip` sin carpeta padre envolvente | **`VERIFIED_LOCAL`** |
| **Express como dependencia runtime** | `"express": "^4.22.3"` presente en `dependencies` del staging `package.json` y en `node_modules/express` | **`VERIFIED_LOCAL`** |
| **Entrypoint declarado y exportado** | `"main": "dist/server/catalystEntry.js"` en `package.json` y `"execution.main"` en `catalyst-config.json`; exporta `default` y `catalystAdvancedIoEntry(req, res)` | **`VERIFIED_LOCAL`** |
| **`catalyst-config.json` en raíz del ZIP** | Presente exactamente como `catalyst-config.json` en la raíz del ZIP | **`VERIFIED_LOCAL`** |
| **Ausencia de carpeta contenedora en ZIP** | La raíz del ZIP contiene directamente `package.json`, `package-lock.json`, `catalyst-config.json`, `dist/...`, `node_modules/...` (cero prefijo `vigor_api/...`) | **`VERIFIED_LOCAL`** |
| **Tamaño frente a límites de plataforma** | ZIP = **`1.22 MiB` (`1,275,008` B)**; descomprimido = **`3.57 MiB` (`3,748,650` B)** — paquete compacto muy por debajo de límites típicos de carga web | **`VERIFIED_LOCAL`** *(límite exacto del uploader File Upload en `Project-Rainfall` queda `PENDING_LIVE_VERIFICATION`)* |

> **Separación explícita Node 24 (`v24.16.0`) / Node 22 local (`v22.23.2`) / Node 22 remoto Catalyst:**
> - El paquete declara `"type": "module"` porque todo `dist/**/*.js` fue compilado con `tsconfig.server.json` (`"module": "NodeNext"`), y `"engines": { "node": ">=22" }`.
> - El operador puede ejecutar `scripts/prepare-vigor-api-upload.ps1` en **Windows PowerShell 5.1 con Node.js `v24.16.0`** (mayor o igual a `22`), obteniendo el ZIP reproducible; ello **NO equivale** a verificar el runtime remoto Node.js 22 de Catalyst.
> - Como evidencia independiente adicional, la carga ESM dinámica de `artifacts/vigor_api/dist/server/catalystEntry.js` ya se verificó bajo **`Node v22.23.2`** (`PASS LOCAL`).
> - La carga efectiva de `"type": "module"` + `export default catalystAdvancedIoEntry` por el cargador real de Catalyst Advanced I/O **Node.js 22** en `Project-Rainfall` permanece **`PENDING_LIVE_VERIFICATION`**.

---

## 3. RESULTADOS DE LAS 8 PRUEBAS OBLIGATORIAS DE VALIDACIÓN DEL PAQUETE

| # | Prueba obligatoria | Evidencia y resultado observado | Veredicto |
| :-: | :--- | :--- | :---: |
| **1** | **Inspección recursiva del contenido de staging** | Listados los `906` archivos: exactamente `package.json`, `package-lock.json`, `catalyst-config.json`, `16` archivos `.js` bajo `dist/` (solo los 9 directorios runtime) y `887` archivos bajo `node_modules/`. | **`PASS LOCAL`** |
| **2** | **Validación de las 6 dependencias runtime** | `package.json` y `node_modules/` contienen exactamente `@zcatalyst/auth`, `@zcatalyst/auth-admin`, `@zcatalyst/nosql`, `@zcatalyst/transport`, `@zcatalyst/utils` y `express`, sin paquetes extra en `dependencies`. | **`PASS LOCAL`** |
| **3** | **Ausencia total de `devDependencies`** | Cero clave `devDependencies` en staging `package.json` y `package-lock.json`; confirmada ausencia física de `@types/express`, `@types/node`, `playwright-core`, `tsx` y `typescript` en `node_modules/`. | **`PASS LOCAL`** |
| **4** | **Validación del entrypoint `dist/server/catalystEntry.js`** | Archivo presente en `artifacts/vigor_api/dist/server/catalystEntry.js`, referenciado por `"main"` en `package.json` y `"execution.main"` en `catalyst-config.json`. | **`PASS LOCAL`** |
| **5** | **Importación ESM local (`Node v22.23.2` independiente + compatibilidad `Node >=22`)** | Evidencia independiente preservada en **`Node v22.23.2`**: `await import(pathToFileURL(stagedEntry))` resuelve sin errores, expone `typeof mod.default === 'function'` y `typeof mod.catalystAdvancedIoEntry === 'function'`, no abre puertos TCP y responde fail-closed `503 SERVER_CONFIGURATION_UNAVAILABLE`. `prepare-vigor-api-upload.ps1` acepta **`Node.js v24.16.0`** (`>=22`) para empaquetado local sin sustituir la prueba del runtime remoto Node.js 22. | **`PASS LOCAL`** *(runtime remoto `node22` = `PENDING_LIVE_VERIFICATION`)* |
| **6** | **Cero llamadas remotas** | Cero peticiones HTTP hacia Zoho/Catalyst, cero invocaciones CLI remotas (`deploy`, `init`, `apig:enable`, `ds:import`, `token:generate`) en `prepare-vigor-api-upload.ps1`, staging y `tests/26`. | **`PASS LOCAL`** |
| **7** | **Escaneo de secretos y archivos prohibidos** | Escaneo recursivo negativo para `.env*`, secretos HMAC reales, claves OAuth, tokens `1000.*`, `tests/`, `frontend/`, `docs/`, `scripts/`, `config/candidates/`, `provisioning/`, `.js.map` y referencias de archivos Firebase/GCP. | **`PASS LOCAL`** |
| **8** | **Integridad del ZIP y verificación de estructura raíz** | `unzip -tq artifacts/vigor_api.zip` (`No errors detected`), inspección central/lectura de entradas confirma `package.json`, `package-lock.json`, `catalyst-config.json` y `dist/server/catalystEntry.js` en raíz exacta sin carpeta envolvente `vigor_api/`. | **`PASS LOCAL`** |

---

## 4. AUDITORÍA DE LÍMITE DE EJECUCIÓN DE 30 SEGUNDOS (41 ENDPOINTS)

`CATALYST_PLATFORM_LIMITS.ADVANCED_IO_TIMEOUT_MS` fija el techo duro de ejecución por petición HTTP en **`30,000 ms` (`30s`)**. Sin introducir cambios arquitectónicos innecesarios antes de medir el comportamiento vivo en `Development`, se auditaron los **41 endpoints** reales en `routeContracts.ts`, `athleteDataService.ts`, `adminGovernanceService.ts` y `cleanSlateAuthGuard.ts`:

### 4.1 Clasificación completa de los 41 endpoints frente al límite de `30s`

| Categoría de riesgo | Endpoints exactos (`id`) | Patrón de E/S real en código | Evaluación frente a `30s` |
| :--- | :--- | :--- | :--- |
| **1. Operación puntual O(1) / Consulta acotada (`25` rutas)** — **Riesgo BAJO** | `auth.session.bootstrapProfile`, `auth.session.exchange`, `auth.session.logout`, `auth.me`, `athlete.profile.patch`, `athlete.onboarding.complete`, `athlete.meals.create`, `athlete.meals.list` (`limit 1..100`), `athlete.workouts.start`, `athlete.workouts.logSet`, `athlete.workouts.complete`, `athlete.cardio.create`, `athlete.notifications.create`, `athlete.recipes.put`, `athlete.recipes.delete`, `athlete.mealPlans.put`, `athlete.routines.put`, `athlete.biometrics.put`, `athlete.preferences.put`, `athlete.groceries.create`, `athlete.groceries.patchStatus`, `athlete.groceries.delete`, `admin.users.detail`, `admin.invitations.create`, `admin.invitations.revoke` | `1–3` operaciones puntuales (`fetchItem`/`insertItem`/`updateItem`/`deleteItem` o `queryTable`/`queryIndex` de una sola página `<= 100` ítems). Las rutas `bootstrapProfile` y `exchange` suman 1 llamada `getCurrentUser()`. | Muy por debajo de `30s` en operación normal. |
| **2. Rutas con revalidación en vivo de Catalyst (`6` rutas)** — **Riesgo BAJO-MODERADO** *(dependiente de red BaaS externa)* | `auth.session.refresh`, `auth.session.revoke`, `invitations.redeem`, `admin.users.setStatus`, `admin.users.setRole`, `admin.users.passwordReset` *(nota: `setRole`/`setStatus` superadmin y `passwordReset` permanecen bloqueados por política pre-live)* | Ejecutan `requiresCatalystLiveCheck: true` (`UserManagement.getUserDetails()`), además de lectura/escritura en `Users`, `SystemControl` (`CTRL#SAGA#<key>` en `setRole`, `SESSION#<sid>` en `refresh`/`revoke`) y `AuditLogs`. Además, cualquier ruta `hmac_session` dispara revalidación cada `>= 15 min` con coalescing en memoria (`inFlightCatalystChecks`). | Seguras bajo latencia normal de Catalyst US (`< 2–5s`); si Catalyst BaaS se degrada, deben fallar cerrado con `503` antes de colgar `30s`. |
| **3. Paginadas o escaneos acotados de partición única (`7` rutas)** — **Riesgo MODERADO a largo plazo** | `athlete.workspace.get` (`maxPages 1..10` × `100` ítems = máx. `1,000` ítems), `athlete.meals.delete`, `athlete.cardio.delete`, `athlete.notifications.markRead`, `athlete.routines.setDefault`, `admin.users.list` (`4` segmentos `GSI_Directory` × `100`), `admin.auditLogs.list` (`AUDIT#YYYY-MM` o trimestres `GSI_GlobalChronology` × `100`) | `workspace.get` está explícitamente acotado con `maxPages` y `cursor`. `admin.users.list` y `admin.auditLogs.list` limitan lecturas a `MAX_QUERY_READ_ITEMS = 100` por segmento/bucket. En cambio, `deleteMeal`, `deleteCardioSession` y `markNotificationRead` iteran `do..while (cursor)` hasta hallar `entityId` dentro de `USER#<uid>`, y `setDefaultRoutine` lee todos los `ROUTINE#` y aplica `deleteBatch`+`insertBatch` en bloques `<= 25`. | Seguras en `Development` y uso típico (`<=` decenas/cientos de registros por prefijo). Solo crecerían linealmente en cuentas con miles de comidas/notificaciones acumuladas. |
| **4. Escaneos completos o lotes secuenciales múltiples (`3` rutas)** — **Riesgo ALTO a escala / Principal foco de atención** | **`admin.stats.get`** (`GET /api/v1/admin/stats`), **`athlete.groceries.sync`** (`PUT /api/v1/athlete/groceries/sync`), **`athlete.notifications.markAllRead`** (`POST /api/v1/athlete/notifications/read-all`) | Ver análisis detallado en §4.2. | Mayor probabilidad de acercarse a `30s` si crecen los volúmenes de datos sin paginación o agregación incremental. |

### 4.2 Análisis específico de rutas con riesgo de duración elevada
1. **`GET /api/v1/admin/stats` (`adminGovernanceService.ts:1051-1097`):** ejecuta un bucle `do..while (startKey)` **sin límite `maxPages`** sobre los **4 segmentos** de `GSI_Directory` (`USER_SEG#0..3`) para leer la totalidad de usuarios + consulta de invitaciones pendientes. Con `0` usuarios actuales en `Development` tarda milisegundos, pero en un proyecto con miles de usuarios es la **única ruta de lectura global sin cota superior de páginas** capaz de exceder **`30s`**.
2. **`PUT /api/v1/athlete/groceries/sync` (`athleteDataService.ts:309-375`):** con `replaceExisting: true`, lee toda la partición `GROCERY#` en bucle `do..while`, ejecuta `deleteBatch` en bloques `<= 25` y luego `insertBatch` en bloques `<= 25`. Aunque el frontend ya trocea en lotes `<= 25` (`replaceExisting: false` en lotes `1..N`), un reemplazo masivo en lote inicial con cientos de artículos previos encadena múltiples round-trips HTTP secuenciales y vuelve no-atómica la sincronización multi-lote (`atomicBatch: false`).
3. **`POST /api/v1/athlete/notifications/read-all` (`athleteDataService.ts:907-956`):** lee toda la partición `NOTIF#` en bucle `do..while` y ejecuta `deleteBatch` + `insertBatch` en lotes de `<= 25` para cada notificación no leída. Cientos de notificaciones no leídas simultáneas multiplican los viajes secuenciales contra NoSQL.

### 4.3 Tareas asíncronas, reintentos e idempotencia (sin cambios arquitectónicos prematuros)
- **Decisión de alcance:** **NO** se introducen en este momento colas, Catalyst Jobs ni rediseños de `admin.stats.get` o `markAllNotificationsRead`; mantener la arquitectura actual intacta evita complejidad innecesaria en `Development` (`0` usuarios) y permite medir latencias reales tras el primer despliegue. Para escalado futuro a miles de usuarios, `admin.stats.get` sería el primer candidato a contadores precalculados o cálculo asíncrono.
- **Reintentos e idempotencia bajo corte de `30s`:**
  - `admin.users.setRole` dispone de `idempotencyKey` (`CTRL#SAGA#<key>`) y recuperación `consistent_read: true`.
  - `issueSignedSession`, `revokeActiveSessionWithTimeoutRecovery`, `completeExecutedWorkout`, `revokeInvitation`, `redeemInvitation`, `toggleGroceryStatus` y `markNotificationRead` usan condiciones optimistas (`version`/`status`) o verificación previa `consistent_read: true`.
  - Las escrituras `POST` sin ID determinista en el cliente (`meals.create`, `cardio.create`, `notifications.create`) podrían duplicar si se reintenta ciegamente un timeout de `30s`, por lo que los clientes solo deben reintentar con el mismo `id` explícito (`SafeId`) o tras leer el estado actual; los lotes `groceries.sync` con `replaceExisting: false` ya realizan borrado previo de sus propias claves deterministas para evitar duplicados al reintentar un bloque.

---

## 5. SECURITY RULES PREDETERMINADAS DE ADVANCED I/O Y CHECKLIST PREVIO A PRUEBAS HTTP

### 5.1 Valores predeterminados documentados por Zoho para Security Rules Advanced I/O
Según la documentación oficial de Zoho Catalyst para funciones **Advanced I/O** recién creadas, la regla predeterminada generada por la plataforma utiliza:
- **Pattern:** `.*`
- **Métodos permitidos:** **`GET`**, **`POST`**, **`DELETE`**, **`PUT`**, **`PATCH`**
- **Authentication:** **`optional`**
- **`OPTIONS`:** **NO incluido entre los métodos admitidos** por Security Rules predeterminadas.

### 5.2 Implicaciones directas para `vigor_api` en Function URL vs API Gateway
1. **La Function URL se prueba con los controles internos fail-closed de Express:**
   - Aunque la regla predeterminada tenga `Pattern: .*` y `Authentication: optional`, Catalyst Security Rules **no** sustituye la seguridad de la aplicación.
   - Todas las rutas protegidas de `vigor_api` deben verificarse directamente contra Express confirmando rechazo **`401`/`403`** fail-closed sin `__Host-vigor_session`, bloqueo de spoofing (`x-zc-user-type: admin`, `uid`, `role`), `X-Vigor-CSRF`, RBAC sobre `Users` (`consistent_read: true`) y anti-IDOR (`USER#<uid>`).
2. **Las pruebas de preflight del navegador (`OPTIONS`) quedan pendientes de API Gateway:**
   - Dado que `OPTIONS` **no está incluido** en los métodos admitidos de Security Rules predeterminadas de Advanced I/O (y la Function URL `*.catalystserverless.com` es cross-site respecto a `https://app.vigorcore.lat` con cookies `SameSite=Strict`), **las pruebas de preflight CORS `OPTIONS` desde navegador y E2E desde Slate quedan pendientes de la fase de API Gateway** (`alternative-b-api-gateway.routes.json`).

### 5.3 Checklist obligatorio tras crear `vigor_api` (antes de cualquier prueba HTTP)
> **Orden obligatorio:** cuando en un paso futuro autorizado el operador cree `vigor_api` en Catalyst Console → Serverless → Functions (`Development`), deberá completar esta lista **antes** de ejecutar pruebas HTTP contra la Function URL:

- [ ] **1. Contrastar en consola las Security Rules creadas:** inspeccionar la pestaña **Security Rules** (que previamente mostraba `Functions are not created yet!!`) y verificar si coinciden con el patrón predeterminado (`.*`, `GET/POST/DELETE/PUT/PATCH`, `Authentication: optional`, sin `OPTIONS`).
- [ ] **2. Confirmar alcance de los métodos en Function URL:** validar que **`GET`**, **`POST`**, **`PUT`**, **`PATCH`** y **`DELETE`** llegan a `vigor_api`; registrar que **`OPTIONS` / preflight de navegador queda pendiente de API Gateway**.
- [ ] **3. Verificar ausencia de apertura CORS insegura:** confirmar que no exista ninguna regla con `Access-Control-Allow-Origin: *` combinada con credenciales y que Express mantenga control estricto de `VIGOR_ALLOWED_ORIGINS` (`https://app.vigorcore.lat`).
- [ ] **4. Confirmar mediante prueba negativa que Express retiene el control fail-closed completo:** invocar `GET /health` (esperado `200`) y rutas protegidas sin sesión (`GET /api/v1/athlete/workspace`, `GET /api/v1/admin/users`) esperando **`401`/`403`** emitidos por Express (`CleanSlateAuthGuard` / `HttpSecurityPolicy`). **Prohibido** asumir que `Authentication: optional` o Security Rules otorgan autorización de negocio.
- [ ] **5. Mantener bloqueados API Gateway y dominio personalizado:** verificar visualmente que **API Gateway** continúa mostrando **`Enable now`** (deshabilitado), **Domain Mapping** sigue en **`Add Mapping`** sin `api.vigorcore.lat` (`BLOCKED_PENDING_ZOHO_CLARIFICATION`), y **`Production`** permanece completamente intacto.

---

## 6. COMANDOS REPRODUCIBLES DE STAGING LOCAL (WINDOWS POWERSHELL 5.1 + NODE.JS v24.16.0)

Compatibilidad verificada para **Windows PowerShell 5.1** y **Node.js `v24.16.0`** (`engines.node >=22`):
- Anclaje exclusivo por `$PSScriptRoot` + `Join-Path` hacia `poc/catalyst-clean-slate/` (permite ejecución desde cualquier directorio de trabajo).
- Invocación segura de `npm`/`node` frente a avisos en `stderr` bajo PS 5.1 con verificación estricta de `$LASTEXITCODE` y código de salida explícito (`exit 0` en éxito).
- Escritura JSON UTF-8 sin BOM, carga explícita de `System.IO.Compression` + `System.IO.Compression.FileSystem`, validación de descompresión de entradas críticas del ZIP y cero llamadas remotas.

**Comando PowerShell exacto a ejecutar por el operador (desde `poc/catalyst-clean-slate/`):**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-vigor-api-upload.ps1
```

*(Opcional si ya está posicionado en la raíz de `Fit-X`:)*

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-clean-slate\scripts\prepare-vigor-api-upload.ps1
```

Comandos posteriores de validación local completa (desde `poc/catalyst-clean-slate/`):

```powershell
npm test
npm run build
npm run build:server
npm run frontend:build
```

---

## 7. DICTAMEN FINAL DE EMPAQUETADO PRE-DESPLIEGUE

**Dictamen:** **`PHASE_5_3_UPLOAD_PACKAGE_READY_NOT_DEPLOYED`**

- `prepare-vigor-api-upload.ps1` está conciliado para operar en **Windows PowerShell 5.1** con **Node.js `v24.16.0`** (`engines.node >=22`), sin afirmar que empaquetar en Node.js 24 sustituya la prueba del runtime remoto Node.js 22, y conservando la evidencia independiente de importación ESM obtenida en **`Node v22.23.2`**.
- El directorio de staging limpio `poc/catalyst-clean-slate/artifacts/vigor_api/` (`906` archivos, `3.57 MiB`) y el archivo `poc/catalyst-clean-slate/artifacts/vigor_api.zip` (`1,275,008` bytes = `1.22 MiB`) superan las **8 validaciones locales obligatorias** manteniendo identificados los **3 endpoints críticos** ante el límite de `30s` (`admin.stats.get`, `athlete.groceries.sync`, `athlete.notifications.markAllRead`).
- Permanecen **`PENDING_LIVE_VERIFICATION`**: subida real en Catalyst Console (`Development`), carga ESM del ZIP en el runtime remoto **Node.js 22**, inspección de Security Rules predeterminadas (`.*`, `GET/POST/DELETE/PUT/PATCH`, `optional`, sin `OPTIONS`) y pruebas de preflight del navegador (`OPTIONS`) hasta habilitar **API Gateway**. **Cero operaciones remotas ejecutadas.**
