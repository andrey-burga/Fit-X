# VIGORCORE — FASE 5.3: AUDITORÍA DE RUNTIME LIVE, ENDPOINTS DE SALUD Y VERIFICACIÓN NOSQL DE SOLO LECTURA

**Proyecto AI Studio:** `Fit-X` *(alcance exclusivo en `poc/catalyst-clean-slate/`)*  
**Proyecto Catalyst:** `Project-Rainfall` (`136967000000014024`) · Región `US` (`https://api.catalyst.zoho.com` · `https://accounts.zoho.com`)  
**Función:** `vigor_api` (`136967000000074001` · Advanced I/O · Node.js 22)  
**Entorno objetivo:** **`Development`** *(`Production`, API Gateway, Slate, DNS, Firebase y GCP intactos y sin modificar)*  
**Estado:** **`PHASE_5_3_HEALTH_VERIFIED_NOSQL_READONLY_CHECK_READY`**

---

## 1. AUDITORÍA REAL DEL ENDPOINT DE SALUD (`GET /health` Y `GET /api/v1/health`)

### 1.1 Respuesta live reportada por el operador

- `GET /health`: **HTTP `200`** → `service = vigorcore-advanced-io`, `routeCount = 41`, `status = ok`
- `GET /api/v1/health`: **HTTP `200`** → `service = vigorcore-advanced-io`, `routeCount = 41`, `status = ok`
- Estado de plataforma reportado: despliegue de `vigor_api` actualizado, API Gateway deshabilitado, 10 variables de entorno configuradas en `Development`.

### 1.2 Inspección de código fuente (qué ejecuta y qué NO ejecuta)

Al trazar la ruta completa de ejecución en `src/server/catalystEntry.ts:22-59`, `src/server/advancedIoApp.ts:213-249,439-575` y `src/nosql/providers/baseTableProvider.ts:34-57`:

1. **Inicialización en arranque en frío (`catalystEntry.ts:41` → `createVigorCoreProductionRuntimeFromEnv`):**
   - Valida las variables de configuración (`VIGOR_CATALYST_AUTH_MODE=hosted_native`, `VIGOR_CORS_MODE=platform_managed`, `VIGORCORE_DEPLOYMENT_ENVIRONMENT=Development`, `VIGOR_ENVIRONMENT=development`, `VIGORCORE_CATALYST_PROJECT_ID=136967000000014024`, `VIGORCORE_CATALYST_API_DOMAIN`, `VIGORCORE_CATALYST_ACCOUNTS_URL`, `VIGOR_SESSION_HMAC_SECRET`, `VIGOR_SESSION_ACTIVE_KID`, `VIGOR_ALLOWED_ORIGINS`) y rechaza claves reservadas (`CATALYST_*`).
   - Construye `createTableProviders(() => hostedRuntime!.getActiveRequestNoSQLClient())` (`advancedIoApp.ts:472`). **Ese argumento es un closure perezoso (`() => ...`) que NO se invoca durante el arranque.**
   - El constructor de `BaseCatalystTableProvider` (`baseTableProvider.ts:51-57`) ejecuta únicamente la validación síncrona en memoria `validateSchemaRegistryContracts()` sobre el registro estático `TABLE_SCHEMA_REGISTRY`.
2. **Atención de `GET /health` y `GET /api/v1/health` (`advancedIoApp.ts:238-249`):**
   - Tras normalizar `/server/vigor_api/...`, el middleware responde inmediatamente `200` con `{ success: true, service: 'vigorcore-advanced-io', routeCount: 41, status: 'ok' }`.
   - **Retorna ANTES de `deps.wrapDispatch` (`advancedIoApp.ts:313`)** (por lo que nunca ejecuta `HostedNativeCatalystAuthRuntime.runWithRequestContext`, `ZCAuth.init(...)` ni lectura de cabeceras `x-zc-*`) y **ANTES de `deps.dispatcher.dispatch` (`line 272`)**.

### 1.3 Dictamen técnico honesto sobre HTTP `200`

| Capacidad / Garantía | ¿Verificada por `GET /health` y `GET /api/v1/health`? | Evidencia |
| :--- | :---: | :--- |
| Contenedor Node.js 22 y Express activos | **SÍ** | Respuesta HTTP `200` generada por `createVigorCoreExpressApp` |
| Validación de las 10 env vars en `Development` (incluida entropía Base64URL de `VIGOR_SESSION_HMAC_SECRET`) | **SÍ** | Si faltara o fallara alguna, `catalystEntry.ts:42-55` respondería `503 SERVER_CONFIGURATION_UNAVAILABLE` |
| Catálogo completo de 41 rutas montado en memoria | **SÍ** | `ROUTE_DEFINITIONS.length === 41` |
| Inyección real de `x-zc-admin-cred-*` / `x-zc-project-key` por Catalyst Edge | **NO** | `/health` retorna antes de `wrapDispatch` (`runWithRequestContext`) |
| Inicialización de cliente Catalyst NoSQL (`getActiveRequestNoSQLClient()`) | **NO** | Closure perezoso nunca invocado en `/health` |
| Resolución de metadatos de tablas, IDs físicos o consultas NoSQL | **NO** | Cero llamadas `NoSQL.getAllTable()`, `NoSQL.getTable()`, `fetchItem()`, `queryTable()` o `queryIndex()` |

**Conclusión:** HTTP `200` en `/health` y `/api/v1/health` demuestra salud del runtime Express y validez de la configuración de entorno, **no conectividad ni autorización efectiva contra Catalyst NoSQL**.

---

## 2. AUDITORÍA DEL ACCESO NOSQL Y PREPARACIÓN DE VERIFICACIÓN ESTRICTAMENTE DE SOLO LECTURA

### 2.1 Auditoría de `createTableProviders()`, `getActiveRequestNoSQLClient()` y `@zcatalyst/nosql@1.0.0`

Inspección directa en `src/nosql/providers/tableProviders.ts:482-499`, `src/nosql/providers/baseTableProvider.ts:34-46`, `src/sdk/catalystSdkBridge.ts:1200-1214` y `node_modules/@zcatalyst/nosql/dist-es/{index.js,table.js}`:

- **`getActiveRequestNoSQLClient()`:** Instancia `new NoSQL(this.getActiveRequestAdminApp())` leyendo el `CatalystApp` aislado por petición en `AsyncLocalStorage` (creado por `runWithRequestContext`). Falla cerrado (`503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE`) si se invoca fuera de petición o si Catalyst Edge no inyectó `x-zc-admin-cred-type/token`.
- **`createTableProviders()`:** Crea los 5 proveedores sobre `createCatalystLiveNoSQLAdapter(source)` sin `tableIdResolver` personalizado, por lo que `NoSQL.table(tableName)` construye un `NoSQLTable` con `tableId = tableName` (p. ej. `'Users'`), sin llamada de red previa y sin `tableDetails`. En peticiones de datos llama a `/nosqltable/${tableId}/item/...` con `CREDENTIAL_USER.admin`.
- **`NoSQL.getTable(tableId)`:** Ejecuta `GET /nosqltable/${tableId}` (`service: 'baas'`, `user: CREDENTIAL_USER.admin`) y devuelve un `NoSQLTable` con `tableDetails` (`toJSON()`).
- **`NoSQL.getAllTable()`:** Ejecuta `GET /nosqltable` (`service: 'baas'`, `user: CREDENTIAL_USER.admin`) y devuelve la lista completa de `NoSQLTable` con metadatos (`id`, `name`, `status`, `project_details`, `partition_key`, `sort_key`, `additional_sort_keys`, `ttl_enabled`, `ttl_attribute`, `global_index`, `metrics`).

### 2.2 Mecanismo existente seleccionado (sin endpoints nuevos ni escrituras)

Se utiliza el mecanismo oficial documentado en el repositorio: **`scripts/verify-clean-slate-provisioning.ts`** apoyado en **`src/provisioning/postProvisioningVerifier.ts`**.

- **Por qué NO se añade un endpoint nuevo en `vigor_api`:** exponer rutas diagnósticas sin autenticar o relajar guardias para probar tablas viola las invariantes de seguridad Clean-Slate.
- **Por qué el CLI usa `--auth-mode external_oauth`:** `verify-clean-slate-provisioning.ts:116-120` corre en la estación del operador (fuera del contenedor Advanced I/O donde Catalyst Edge inyecta `x-zc-admin-cred-token`), por lo que falla cerrado ante `hosted_native` (`HOSTED_NATIVE_UNAVAILABLE_OUTSIDE_ADVANCED_IO`). Esto es exclusivamente para el operador CLI y **no** cambia `VIGOR_CATALYST_AUTH_MODE=hosted_native` en `vigor_api`.
- **Garantía de 0 escrituras (`writeOperationsExecuted: 0`):** `createReadOnlyEnvironmentFromProvider()` (`postProvisioningVerifier.ts:166-190`) envuelve los clientes y expone exclusivamente:
  1. `nosql.getAllTable()` (`GET /nosqltable`)
  2. `fetchItem()` (`POST /nosqltable/:id/item/fetch` con `consistent_read: true`)
  3. `queryTable()` (`POST /nosqltable/:id/item/query` con `consistent_read: true`)
  4. `queryIndex()` (`POST /nosqltable/:id/index/:idx/item/query` con `consistent_read: true`)
  5. `auth.getAllUsers()` (`GET /project/:id/project-user`)
- **Refuerzo añadido en esta auditoría (`--verify-dev-table-ids`):** `verifySchemaAgainstRegistry()`, `probeCleanSlateEmptyAndContracts()` y `verify-clean-slate-provisioning.ts` ahora registran `tableId` en `tableMatrix` y permiten pasar `--verify-dev-table-ids` (bloqueado estrictamente a `VIGORCORE_DEPLOYMENT_ENVIRONMENT=Development`, falla cerrado si es `Production`) para contrastar cada `meta.id` remoto contra el inventario de Etapa 1 (`PHASE_5_2_STAGE_1_DEV_INVENTORY`):

| Tabla | ID físico esperado (`Development`) | Partition Key | Primary Sort Key | Additional Sort Keys | GSIs esperados | TTL (`ttlEpochSec`) |
| :--- | :---: | :--- | :--- | :--- | :---: | :--- |
| `Users` | `136967000000065001` | `pk` (`String`) | *Omitida* | *Ninguna* | `3` (`GSI_Email`, `GSI_Directory`, `GSI_RoleStatus`) | Desactivado |
| `UserData` | `136967000000067007` | `pk` (`String`) | `sk` (`String`) | `entityType`, `updatedAt` | `1` (`GSI_UserEntityDate`) | Desactivado |
| `AdminInvitations` | `136967000000067014` | `pk` (`String`) | *Omitida* | *Ninguna* | `1` (`GSI_InviteEmailStatus`) | Activado (`ttlEpochSec`) |
| `AuditLogs` | `136967000000067021` | `pk` (`String`) | `sk` (`String`) | `action`, `timestamp` | `3` (`GSI_AuditActor`, `GSI_AuditTarget`, `GSI_GlobalChronology`) | Desactivado |
| `SystemControl` | `136967000000067034` | `pk` (`String`) | *Omitida* | *Ninguna* | `0` | Activado (`ttlEpochSec`)* |

\* Nota SDK conocida (`SDK_KNOWN_LIMITATIONS`): `@zcatalyst/nosql@1.0.0` reporta `ttl_attribute: 'ttlEpochSec'` (`string`), no su tipo (`Number`), el cual ya fue confirmado visualmente en Catalyst Console (`docs/29`). Asimismo, cuando Catalyst devuelve `project_details.id`, el verificador exige igualdad estricta con `136967000000014024`.

### 2.3 Aislamiento estricto contra `Production`

El CLI exige preflight previo (`runCatalystConfigPreflight`, `verify-clean-slate-provisioning.ts:122-133`) y `CatalystAdminAppProvider.fromEnvironment` (`catalystSdkBridge.ts:435-445`):
- Requiere `VIGORCORE_DEPLOYMENT_ENVIRONMENT=Development` + `VIGOR_ENVIRONMENT=development`.
- Cualquier mezcla con `Production` o `production` aborta antes de red con `ENVIRONMENT_SEPARATION_VIOLATION`.
- `--verify-dev-table-ids` aborta adicionalmente con `DEV_TABLE_IDS_REQUIRE_DEVELOPMENT_ENV` si `getEnvironment() !== 'Development'`.
- El operador debe obtener `CATALYST_PROJECT_KEY` y token OAuth efímero (`CATALYST_ADMIN_ACCESS_TOKEN` de solo lectura o credenciales OAuth) **exclusivamente del entorno `Development`** de `Project-Rainfall`.

---

## 3. AUDITORÍA DE RUTA PROTEGIDA SIN AUTENTICACIÓN

Ruta inofensiva seleccionada (solo lectura, `requiresCsrf: false`, `requiresCatalystLiveCheck: false`, `0` escrituras):

- **Método y ruta:** **`GET /api/v1/athlete/workspace`** *(equivalente en rechazo sin credenciales a `GET /api/v1/auth/me`)*
- **URL directa de `vigor_api` en `Development`:** `https://project-rainfall-943998020.development.catalystserverless.com/server/vigor_api/api/v1/athlete/workspace`

### 3.1 Comportamiento exacto esperado sin credenciales

Dado que `vigor_api` opera con `VIGOR_CATALYST_AUTH_MODE=hosted_native`, la petición sin cookies ni tokens recorre:

1. `normalizeCatalystPath('/server/vigor_api/api/v1/athlete/workspace')` → `/api/v1/athlete/workspace`.
2. `advancedIoApp.ts:313` → `HostedNativeCatalystAuthRuntime.runWithRequestContext(headers, executeDispatch)` (`catalystSdkBridge.ts:1042-1122`).
3. Dos resultados válidos y seguros posibles según si el Edge de Catalyst inyecta cabeceras `x-zc-*` en la Function URL directa con API Gateway deshabilitado:
   - **Escenario A — Catalyst Edge SÍ inyecta `x-zc-admin-cred-type/token`, `x-zc-project-key` y contexto `Development` (`136967000000014024`):**
     - `runWithRequestContext` valida `x-zc-projectid` y `x-zc-environment=Development` sin discrepancia y entra al dispatcher.
     - `CleanSlateAuthGuard.authenticate` (`cleanSlateAuthGuard.ts:1049-1050`) detecta ausencia de cookie `__Host-vigor_session`, consulta `HostedNativeCatalystAuthRuntime.getCurrentUserFromRequest(req)` (no hay `x-zc-user-cred-token` ni `x-zc-cookie` → devuelve `null`), y lanza `AuthGuardError(401, 'UNAUTHENTICATED', ...)`.
     - **Respuesta:** **HTTP `401`** · `{"success":false,"error":"UNAUTHENTICATED","message":"Valid Catalyst Auth session required."}` · **`0` consultas NoSQL.**
   - **Escenario B — Catalyst Edge NO inyecta `x-zc-admin-cred-type/token` (o `x-zc-project-key`) en la URL directa sin API Gateway:**
     - `buildHostedAdminAppFromHeaders` falla cerrado antes de entrar al dispatcher (`catalystSdkBridge.ts:1081-1096`).
     - **Respuesta:** **HTTP `503`** · `{"success":false,"error":"HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE", ...}` · **`0` consultas NoSQL.**
   - **Nota diagnóstica:** Cualquiera de los dos (`401` o `503`) confirma rechazo *fail-closed* sin fuga de secretos ni escrituras. Si devolviera `503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE`, quedará confirmado empíricamente que la Function URL directa sin API Gateway no recibe `x-zc-admin-cred-*` (hallazgo clave para decidir API Gateway o `external_oauth` antes de `INT-01`). Si devolviera `403 PROJECT_CONTEXT_MISMATCH`, indicaría discrepancia de proyecto o entorno entre Edge y variables de entorno.

---

## 4. PROCEDIMIENTO OPERATIVO EN WINDOWS POWERSHELL 5.1 (SIN PERSISTIR SECRETOS)

> **No ejecutar aún desde este agente:** este procedimiento debe ser corrido manualmente por el operador en su estación Windows PowerShell 5.1 cuando decida validar el runtime live en `Development`. Nunca guardar `CATALYST_PROJECT_KEY` ni tokens en disco o archivos del repositorio.

### Paso 1 — Prueba de solo lectura de ruta protegida sin autenticación (`GET /api/v1/athlete/workspace`)

En Windows PowerShell 5.1, `Invoke-WebRequest` lanza `System.Net.WebException` ante códigos `4xx`/`5xx`, por lo que se captura el código y cuerpo de forma limpia:

```powershell
$protectedUrl = 'https://project-rainfall-943998020.development.catalystserverless.com/server/vigor_api/api/v1/athlete/workspace'
try {
    $resp = Invoke-WebRequest -Uri $protectedUrl -Method Get -UseBasicParsing -ErrorAction Stop
    Write-Output ("UNEXPECTED_2XX: {0} {1}" -f $resp.StatusCode, $resp.Content)
}
catch [System.Net.WebException] {
    $httpResp = [System.Net.HttpWebResponse]$_.Exception.Response
    if ($null -eq $httpResp) {
        throw
    }
    $reader = New-Object System.IO.StreamReader($httpResp.GetResponseStream())
    $bodyText = $reader.ReadToEnd()
    $reader.Dispose()
    Write-Output ("STATUS={0}" -f [int]$httpResp.StatusCode)
    Write-Output $bodyText
}
```

### Paso 2 — Verificación NoSQL estrictamente de solo lectura (`Development` · 5 Table IDs · 0 escrituras)

Solicita únicamente en memoria (`Read-Host -AsSecureString` / limpieza en `finally`) el `CATALYST_PROJECT_KEY` de `Development` y un `CATALYST_ADMIN_ACCESS_TOKEN` efímero (o credenciales OAuth de operador):

```powershell
$prevProjectId = $env:VIGORCORE_CATALYST_PROJECT_ID
$prevDepEnv    = $env:VIGORCORE_DEPLOYMENT_ENVIRONMENT
$prevVigorEnv  = $env:VIGOR_ENVIRONMENT
$prevApiDomain = $env:VIGORCORE_CATALYST_API_DOMAIN
$prevAccounts  = $env:VIGORCORE_CATALYST_ACCOUNTS_URL
$prevAuthMode  = $env:VIGOR_CATALYST_AUTH_MODE
$prevProjKey   = $env:CATALYST_PROJECT_KEY
$prevAccessTok = $env:CATALYST_ADMIN_ACCESS_TOKEN

function ConvertFrom-SecureToPlain([System.Security.SecureString]$sec) {
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

try {
    $env:VIGORCORE_CATALYST_PROJECT_ID     = '136967000000014024'
    $env:VIGORCORE_DEPLOYMENT_ENVIRONMENT  = 'Development'
    $env:VIGOR_ENVIRONMENT                 = 'development'
    $env:VIGORCORE_CATALYST_API_DOMAIN     = 'https://api.catalyst.zoho.com'
    $env:VIGORCORE_CATALYST_ACCOUNTS_URL   = 'https://accounts.zoho.com'
    $env:VIGOR_CATALYST_AUTH_MODE          = 'external_oauth'

    $secKey = Read-Host 'CATALYST_PROJECT_KEY (Development, oculto)' -AsSecureString
    $secTok = Read-Host 'CATALYST_ADMIN_ACCESS_TOKEN efímero (oculto)' -AsSecureString
    $env:CATALYST_PROJECT_KEY        = ConvertFrom-SecureToPlain $secKey
    $env:CATALYST_ADMIN_ACCESS_TOKEN = ConvertFrom-SecureToPlain $secTok

    npx tsx poc/catalyst-clean-slate/scripts/verify-clean-slate-provisioning.ts --live --confirm-readonly --auth-mode external_oauth --expected-project 136967000000014024 --expected-region US --verify-dev-table-ids
}
finally {
    $env:VIGORCORE_CATALYST_PROJECT_ID     = $prevProjectId
    $env:VIGORCORE_DEPLOYMENT_ENVIRONMENT  = $prevDepEnv
    $env:VIGOR_ENVIRONMENT                 = $prevVigorEnv
    $env:VIGORCORE_CATALYST_API_DOMAIN     = $prevApiDomain
    $env:VIGORCORE_CATALYST_ACCOUNTS_URL   = $prevAccounts
    $env:VIGOR_CATALYST_AUTH_MODE          = $prevAuthMode
    $env:CATALYST_PROJECT_KEY              = $prevProjKey
    $env:CATALYST_ADMIN_ACCESS_TOKEN       = $prevAccessTok
}
```

**Criterios de aceptación esperados en el JSON de salida:**
- `"verdict": "PASS_READONLY_CLEAN_SLATE"`
- `"writeOperationsExecuted": 0`
- `"catalystEnvironment": "Development"`
- `"tablesFound"` igual a `["AdminInvitations", "AuditLogs", "SystemControl", "UserData", "Users"]` y `"extraTablesFound": []`
- Cada fila de `"tableMatrix"` con `exists: true`, `status: "ONLINE"`, `tableIdMatch: true` (verificando `136967000000065001`, `136967000000067007`, `136967000000067014`, `136967000000067021`, `136967000000067034`), `emptyProbePassed: true`
- Cada fila de `"indexMatrix"` (`8` GSIs) con `exists: true`, `status: "ONLINE"`, `projectionOk: true`, `includeColumnsOk: true`
- `"authUsersCount": 0`

*(Alternativa si no se dispone de `CATALYST_ADMIN_ACCESS_TOKEN` efímero: reemplazar esa lectura en el bloque `try/finally` por `CATALYST_ADMIN_CLIENT_ID`, `CATALYST_ADMIN_CLIENT_SECRET` y `CATALYST_ADMIN_REFRESH_TOKEN` transitorios y restaurarlos igualmente en `finally`.)*

---

## 5. RESUMEN DE VERIFICACIONES (LIVE VS LOCAL VS PENDIENTE)

| Categoría | Elemento | Estado real |
| :--- | :--- | :--- |
| **Observado en vivo (operador)** | `GET /health` y `GET /api/v1/health` en `Development` | **HTTP `200`** (`service=vigorcore-advanced-io`, `routeCount=41`, `status=ok`) |
| **Verificado en código y pruebas locales** | Auditoría de `/health`, cierre fail-closed `401`/`503` en ruta protegida, validación física de los 5 Table IDs en `verify-clean-slate-provisioning.ts --verify-dev-table-ids`, `0` escrituras | **PASS-UNIT / PASS-LOOPBACK** |
| **Pendiente de ejecución remota por operador** | Probe sin autenticación a `GET /api/v1/athlete/workspace` y corrida `--live --confirm-readonly --verify-dev-table-ids` contra `Project-Rainfall` (`Development`) | **READY / NOT EXECUTED REMOTELY** |

**Dictamen final:** **`PHASE_5_3_HEALTH_VERIFIED_NOSQL_READONLY_CHECK_READY`**
