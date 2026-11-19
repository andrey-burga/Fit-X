# VIGORCORE — FASE 4.1.4: CIERRE ADVERSARIAL DEL MODELO B REFINADO (SECURITY RULES, RUTAS, SESIONES Y CREDENCIALES ADMINISTRATIVAS)

**Fecha:** 2026-11-14  
**Directorio aislado:** `poc/catalyst-clean-slate/`  
**Naturaleza de la fase:** Auditoría adversarial, cierre de arquitectura y especificación de controles en modo estrictamente de solo lectura.  
**Estado de autorización:** El Modelo B Refinado **NO está aprobado para producción ni autorizado para implementación aún**.  
**Estado de código e infraestructura:** **0** archivos de código modificados, **0** cambios en tests/dispatcher/catálogo/guard/política HTTP, **0** cambios en la app raíz, **0** paquetes instalados, **0** tablas/índices/usuarios creados, **0** cambios en Security Rules/DNS/Slate, **0** correos enviados y **0** despliegues remotos.

---

## 1. RESUMEN EJECUTIVO

Esta auditoría cierra adversarialmente los cuatro bloqueos pendientes del **Modelo B Refinado** antes de autorizar cambios de código o aprovisionamiento:

1. **Bloqueo A — Security Rules de Catalyst:**
   - **Hallazgo local (`[VERIFICADO]`):** No existen archivos `catalyst.json`, `catalyst-config.json` ni `security-rules.json` en el repositorio ni punto de entrada Express desplegado; por tanto, la configuración remota actual en consola es **desconocida** sin inspección en consola Catalyst.
   - **Regla arquitectónica (`[VERIFICADO en docs oficiales]`):** Security Rules opera **a nivel completo de función** (`methods` + `authentication: "optional" | "required"`), no por subruta. Si una sola función Advanced I/O tiene `authentication: "required"`, Catalyst **rechaza en el borde** toda petición sin credenciales Catalyst antes de alcanzar Express, bloqueando todas las rutas HMAC-only del Modelo B (e impidiendo eventualmente `OPTIONS` sin auth). Para operar en una sola función, el Modelo B exige **Security Rules `"authentication": "optional"`** (o **API Gateway** con rutas explícitas, lo que desactiva Security Rules) junto con validación interna `fail-closed` en el 100% de rutas de Express.
2. **Bloqueo B — Paridad real de rutas (`30` catálogo vs `dispatch()`):**
   - **Hallazgo (`[VERIFICADO en código]`):** De las **30** rutas declaradas en `CLEAN_SLATE_ENDPOINT_CATALOG` (`src/routes/apiRouterSchema.ts:44-75`), exactamente **14** hacen `MATCH`, **4** tienen `MISMATCH` de path en `/admin/*` (implementadas con body JSON en vez de parámetro `:uid` / `:inviteId`), **12** rutas `/athlete/*` están **`MISSING`** en `CleanSlateApiDispatcher.dispatch()` (pese a existir sus métodos implementados en `AthleteDataService`), y existe **1** ruta global `OPTIONS *` (`EXTRA` en dispatcher). Además, `GET /admin/users` y `GET /admin/audit-logs` en `dispatch()` ignoran los filtros `query` del servicio subyacente. No son rutas opcionales ni intencionadamente futuras: son una **brecha de cableado HTTP** (`BLOCKER`/`HIGH` antes de implementar).
3. **Bloqueo C — Separación `scope: 'user'` vs `scope: 'admin'` y procedencia de `x-zc-admin-cred-*`:**
   - **Hallazgo en SDK (`[VERIFICADO en node_modules/@zcatalyst/*]`):** `HttpClient.send()` (`@zcatalyst/transport`) usa `this.app.credential.getCurrentUser()` (`this.scope`), ignorando `user: CREDENTIAL_USER.admin` fijado por `@zcatalyst/nosql`. Reutilizar una instancia `zcAuth.init(req)` de usuario para NoSQL degrada las llamadas a `scope: 'user'`. Es obligatorio mantener dos instancias aisladas (`scope: 'user'` exclusivamente para `/bootstrap-profile`, `/exchange` y fallback `/me`; `scope: 'admin'` exclusivamente para `@zcatalyst/nosql` y `UserManagementAdmin`).
   - **Riesgo de confianza en cabeceras `x-zc-*` (`BLOCKER` si no se valida en vivo):** `@zcatalyst/auth-admin` lee `x-zc-admin-cred-*` y `x-zc-user-*` directamente de `req.headers` sin verificación criptográfica propia; asume que la pasarela de Catalyst las inyecta y sobrescribe ante cualquier cliente externo (`INT-08` obligatorio).
4. **Bloqueo D — Deshabilitación/eliminación externa en Consola Catalyst y política de `/refresh`:**
   - Deshabilitar un usuario en Consola Catalyst impide nuevos logins, **pero NO revoca sesiones HMAC ya emitidas en `SystemControl`**, dejando un acceso residual de hasta **12 horas** en Modelo B puro.
   - Catalyst Component Event Listeners solo cubre `Sign Up` y `Delete` (**no existe trigger para `Disable`**).
   - **Solución recomendada:** Adoptar `UserManagementAdmin.getUserDetails(uid)` (`scope: 'admin'`) con política **fail-closed** en **`/api/v1/auth/session/refresh`**, en acciones críticas (`set-role`, `redeem`), y mediante **ventana acotada de revalidación** (p. ej. campo `lastCatalystCheckAtEpochSec` en `SESSION#<sid>` revalidado cada <= 15 minutos), más un **límite absoluto de vida de sesión de 24 horas** desde el login inicial (`absoluteExpiresAtEpochSec`) para impedir sesiones renovables indefinidamente.

---

## 2. AUDITORÍA OBLIGATORIA DE CATALYST SECURITY RULES

### 2.1 Distinción de fuentes: Repo local vs Documentación oficial vs Consola remota

| Plano de Evidencia | Estado | Hallazgo Exacto |
| :--- | :---: | :--- |
| **Configuración realmente encontrada en archivos locales** | `[VERIFICADO]` | Búsqueda completa en `/app/applet` y `poc/catalyst-clean-slate/` confirma **cero** archivos `catalyst.json`, `catalyst-config.json` o `security-rules.json` en el repositorio. La carpeta raíz `/functions/` corresponde únicamente a Firebase Cloud Functions (`package.json`, `src/`, `lib/`). La POC en `poc/catalyst-clean-slate/` contiene lógica de dominio, guardas, catálogo y simuladores, sin configuración de despliegue ni punto de entrada HTTP Catalyst Advanced I/O todavía. |
| **Configuración remota en consola Catalyst** | `[NO VERIFICABLE SIN CONSOLA]` | Al no existir función desplegada ni acceso a la consola de Zoho Catalyst desde este entorno, **no puede afirmarse** si la función remota futura tendría `authentication` en `optional` o `required`, ni si API Gateway estaría activo. |
| **Comportamiento documentado por Zoho Catalyst** | `[VERIFICADO EN DOCS OFICIALES]` | Fuente: `https://docs.catalyst.zoho.com/en/serverless/help/security-rules/` y docs de `API Gateway`. Security Rules es un JSON **por función** (no por subruta) con dos parámetros: `methods` (`GET`, `POST`, `DELETE`, `PUT`, `PATCH`; los 5 activos por defecto) y `authentication` (`"optional"` por defecto, o `"required"`). Al habilitar **API Gateway**, Security Rules se **desactiva automáticamente**. |

### 2.2 Evaluación de Security Rules bajo el Modelo B Refinado

1. **¿Qué ocurre si la función Advanced I/O tiene `authentication: "required"`?**
   - **Incompatibilidad total con Modelo B (`BLOCKER`):** Como Security Rules valida la sesión/token de **Catalyst Authentication** en el borde antes de invocar la función Node.js, **toda petición del Modelo B que envíe solo `Cookie: __Host-vigor_session=...` (sin `Authorization: <token>` ni cookies Catalyst) será rechazada por Catalyst antes de ejecutar `CleanSlateAuthGuard`**.
   - **Impacto en `OPTIONS`:** La documentación oficial enumera exclusivamente `GET`, `POST`, `DELETE`, `PUT`, `PATCH` en el campo `methods` de Security Rules y **no documenta explícitamente** si `OPTIONS` se autoriza automáticamente sin token bajo `authentication: "required"`. En arquitectura cross-origin (`app.` -> `api.`), bloquear `OPTIONS` en el borde rompería todo preflight CORS antes de llegar a `HttpSecurityPolicy`.
2. **¿Qué necesita el Modelo B Refinado si usa una sola función Advanced I/O?**
   - **Con Security Rules nativo:** Requiere **`"authentication": "optional"`** a nivel de función (y confirmar en `INT-06` que `OPTIONS` pasa hacia Express con los 5 métodos `GET, POST, PUT, PATCH, DELETE`).
   - **Con CloudScale API Gateway (alternativa cuando API Gateway desactiva Security Rules):** API Gateway permite autenticación **por ruta** (*Catalyst Users Authentication* en `/api/v1/auth/session/bootstrap-profile` y `/exchange`, frente a *No Authentication* en el gateway para el resto de rutas `/api/v1/*`, delegando la verificación HMAC + `consistent_read: true` a Express). Nota de fases previas (`docs/14`): API Gateway tiene coste excediendo 100k req/mes y debe validarse si preserva `Set-Cookie: __Host-vigor_session`, `Origin`, `Sec-Fetch-Site` y `OPTIONS` sin reescritura (`INT-06`).
3. **Mecanismos de protección obligatorios dentro de Express cuando `authentication: "optional"` está activo:**
   Para que `"authentication": "optional"` en el borde **no** convierta la API en un servicio abierto, **toda ruta** dentro de Express debe atravesar un pipeline `fail-closed` sin excepciones:
   - **Capa 1 — CORS y Anti-CSRF (`HttpSecurityPolicy.assertCsrfAndOriginForRequest`):** Rechaza cualquier `Origin` fuera de la allowlist explícita (`403 CORS_ORIGIN_REJECTED`), rechaza `Sec-Fetch-Site: cross-site` (`403 CSRF_CROSS_SITE_REJECTED`), exige `Origin`/`Referer` allowlisted en toda mutación `POST/PUT/PATCH/DELETE`, y responde `OPTIONS` (`204`) únicamente a orígenes permitidos.
   - **Capa 2 — Anti-Spoofing (`assertNoIdentitySpoofing`):** Rechaza cualquier cabecera, query o body controlado por el cliente con `role`, `uid`, `sessionEpoch`, `roleVersion`, `accountStatus`, `x-vigor-*`, `x-user-*`, etc. (`403 IDENTITY_SPOOFING_REJECTED`).
   - **Capa 3 — Frontera de Autenticación Explícita:**
     - En `/bootstrap-profile`, `/exchange` (y `/me` sin cookie): exige identidad Catalyst verificada mediante `zcAuth.init(req, { scope: 'user' })` -> `getCurrentUser()` (`401` si ausente, `403` si no `ACTIVE` o `is_confirmed !== true`).
     - En **todas** las demás rutas (`/athlete/*`, `/invitations/redeem`, `/logout`, `/revoke`, `/refresh`, `/admin/*`): exige cookie `__Host-vigor_session` válida criptográficamente (HMAC-SHA256 tiempo constante), `Users` con `consistent_read: true` (`accountStatus === 'active'`), y `SystemControl` `SESSION#<sid>` con `consistent_read: true` (`status === 'active'`, `!revokedAt`, `expiresAtEpochSec > nowSec`, `sessionEpoch >= Users.sessionEpoch`).
   - **Capa 4 — Enrutamiento Denegado por Defecto (`404` / `403`):** Cualquier ruta no reconocida devuelve `404 ROUTE_NOT_FOUND` después de aplicar `HttpSecurityPolicy`; ningún handler puede ejecutarse sin `actor` verificado.

---

## 3. MATRIZ EXHAUSTIVA DE PARIDAD DE RUTAS (`30` CATÁLOGO VS `dispatch()`)

### 3.1 Investigación de la discrepancia

Al contrastar `CLEAN_SLATE_ENDPOINT_CATALOG` (`src/routes/apiRouterSchema.ts:44-75`) frente a `CleanSlateApiDispatcher.dispatch()` (`lines 89-342`), `AthleteDataService` (`src/services/athleteDataService.ts`) y `AdminGovernanceService` (`src/services/adminGovernanceService.ts`), se verifica lo siguiente:

- **30 rutas declaradas** en `CLEAN_SLATE_ENDPOINT_CATALOG`:
  - **14 rutas `MATCH`** (coinciden método y path exacto).
  - **4 rutas `MISMATCH`** en `/admin/*`: el catálogo define parámetros en path (`:inviteId`, `:uid`), pero `dispatch()` los enruta como paths planos leyendo `req.body.inviteId` / `req.body.targetUid` (`/api/v1/admin/invitations/revoke`, `/api/v1/admin/users/set-role`, `/api/v1/admin/users/set-status`, `/api/v1/admin/users/password-reset`).
  - **12 rutas `MISSING`** en `/athlete/*`: **NO son funcionalidades futuras ni opcionales** — todos sus métodos de negocio ya están implementados en `AthleteDataService` (`completeOnboarding`, `logMeal`, `queryMealsByDateRange`, `syncMealPlanToGroceries`, `startExecutedWorkout`, `logWorkoutSet`, `completeExecutedWorkout`, `addCardioSession`, `createNotification`, `saveRecipe`, `saveMealPlan`, `saveWorkoutRoutine`), tienen validadores en `domainValidators.ts` y aparecen especificados como rutas REST obligatorias en `docs/04`. Se trata de un **error de completitud / cableado incompleto en `CleanSlateApiDispatcher.dispatch()`**.
  - **1 ruta `EXTRA`:** `OPTIONS *` (`apiRouterSchema.ts:98-104`), necesaria para preflight CORS pero no listada en el catálogo.
  - **Defecto adicional en handlers existentes:** `GET /api/v1/admin/users` (`line 219`) llama `listDirectoryUsers(actor)` sin pasar filtros `query` (`role`, `accountStatus`, `limit`, `startKey`); y `GET /api/v1/admin/audit-logs` (`line 318`) fija `{ globalTimeline: true }` ignorando `month`, `targetUid`, `actorUid`, `dateRangeIso`, `limit` y `startKey`. Asimismo `tests/07:415` prueba CSRF sobre `DELETE /api/v1/athlete/recipes/r1`, ruta que no existe ni en el catálogo ni en `dispatch()` (al pasar CSRF caería en `404 ROUTE_NOT_FOUND`).

### 3.2 Matriz Completa de Paridad y Seguridad (30 Rutas + `OPTIONS`)

*(Leyenda: en Modelo B Refinado, `HMAC` = `__Host-vigor_session` + `SESSION#<sid>` + `Users` (`consistent_read: true`); `scope:admin` = instancia separada para NoSQL / `UserManagementAdmin`)*

| # | Método | Path Declarado (Catálogo) | Path Conectado (`dispatch()`) | Estado | Tipo Auth | `scope:user` Catalyst | Sesión HMAC | Rol Admin | Control IDOR / Propiedad | `OPTIONS` | Dictamen de Seguridad |
| :-: | :--- | :--- | :--- | :---: | :--- | :---: | :---: | :---: | :--- | :---: | :--- |
| **-** | `OPTIONS` | *(Global `*`)* | `OPTIONS *` (`:98`) | **EXTRA** | Preflight CORS sin auth | No | No | No | Valida `Origin` contra allowlist | `204` | Seguro en código; falta incluir `Authorization` en `Allow-Headers` y registrar en catálogo |
| **1** | `POST` | `/api/v1/auth/session/bootstrap-profile` | `/api/v1/auth/session/bootstrap-profile` (`:106`) | **MATCH** | `session_bootstrap` | **Sí** | Emite cookie | No | `uid` desde `getCurrentUser()`; bloquea `Users` duplicados (`GSI_Email`) | `204` | **Mejora pendiente:** añadir condición `attribute_not_exists(pk)` en `insertItem('Users')` |
| **2** | `POST` | `/api/v1/auth/session/exchange` | `/api/v1/auth/session/exchange` (`:117`) | **MATCH** | `session_bootstrap` | **Sí** | Emite cookie | No | `uid` desde `getCurrentUser()`; deny-by-default si falta `Users` | `204` | **APTO** (requiere `Authorization` en CORS) |
| **3** | `POST` | `/api/v1/auth/session/refresh` | `/api/v1/auth/session/refresh` (`:133`) | **MATCH** | `session_registered` | No* | **Sí** | No | `sub`/`sid` desde HMAC + `SESSION#<sid>.ownerUserId === claims.sub` | `204` | **Requiere cierre Modelo B:** añadir `getUserDetails(sub)` + límite absoluto 24h |
| **4** | `POST` | `/api/v1/auth/session/logout` | `/api/v1/auth/session/logout` (`:148`) | **MATCH** | `session_registered` | **No** | **Sí** | No | Revoca únicamente `SESSION#<claims.sid>` propio | `204` | **APTO en Modelo B** (funciona tras expirar token Catalyst 1h) |
| **5** | `POST` | `/api/v1/auth/session/revoke` | `/api/v1/auth/session/revoke` (`:162`) | **MATCH** | `session_registered` | **No** | **Sí** | Self o Admin/Superadmin | Self solo sus sesiones; `admin` bloqueado frente a `superadmin` (`:920,963`) | `204` | **APTO en Modelo B** |
| **6** | `GET` | `/api/v1/auth/me` | `/api/v1/auth/me` (`:183`) | **MATCH** | `session_registered` | Solo si no hay cookie | Opcional (cookie prioritaria) | No | Si hay cookie, verifica HMAC+`SESSION#<sid>`+`Users`; si no, Catalyst `scope:user`+`Users` | `204` | **Ajuste Modelo B:** bifurcar resolución cookie vs Catalyst |
| **7** | `GET` | `/api/v1/athlete/workspace` | `/api/v1/athlete/workspace` (`:188`) | **MATCH** | `session_registered` | **No** | **Sí** | No | Partición forzada `pk = USER#<actor.catalystUserId>` | `204` | **APTO en Modelo B** (`NoSQL` en `scope:admin`) |
| **8** | `PATCH` | `/api/v1/athlete/profile` | `/api/v1/athlete/profile` (`:194`) | **MATCH** | `session_registered` | **No** | **Sí** | No | `pk = USER#<actor.catalystUserId>` + `validateProfileSelfUpdate` bloquea `role`/`sessionEpoch`/etc. | `204` | **APTO en Modelo B** |
| **9** | `POST` | `/api/v1/athlete/onboarding/complete` | *(Ninguno)* | **MISSING** | `session_registered` | **No** | **Sí** | No | `AthleteDataService.completeOnboarding`: `pk = USER#<actor.catalystUserId>` | `204` | **BRECHA:** ruta no conectada en `dispatch()`; inaccesible vía HTTP |
| **10** | `POST` | `/api/v1/athlete/meals` | *(Ninguno)* | **MISSING** | `session_registered` | **No** | **Sí** | No | `logMeal`: `pk = USER#<actor.catalystUserId>` (servidor genera o valida `mealLogId`) | `204` | **BRECHA:** ruta no conectada en `dispatch()` |
| **11** | `GET` | `/api/v1/athlete/meals` | *(Ninguno)* | **MISSING** | `session_registered` | **No** | **Sí** | No | `queryMealsByDateRange`: `pk = USER#<actor.catalystUserId>` + SK `BETWEEN` | `204` | **BRECHA:** ruta no conectada en `dispatch()` |
| **12** | `PUT` | `/api/v1/athlete/groceries/sync` | *(Ninguno)* | **MISSING** | `session_registered` | **No** | **Sí** | No | `syncMealPlanToGroceries`: borra/inserta solo en `pk = USER#<actor.catalystUserId>` (`<=25`/lote) | `204` | **BRECHA:** ruta no conectada en `dispatch()` |
| **13** | `POST` | `/api/v1/athlete/workouts/start` | *(Ninguno)* | **MISSING** | `session_registered` | **No** | **Sí** | No | `startExecutedWorkout`: `pk = USER#<actor.catalystUserId>` + fetch previo `consistent_read` | `204` | **BRECHA:** ruta no conectada en `dispatch()` |
| **14** | `POST` | `/api/v1/athlete/workouts/:workoutId/sets` | *(Ninguno)* | **MISSING** | `session_registered` | **No** | **Sí** | No | `logWorkoutSet`: valida padre `WORKOUT#` en **misma** partición `USER#<actor.catalystUserId>` e `in_progress` | `204` | **BRECHA:** ruta no conectada en `dispatch()` |
| **15** | `POST` | `/api/v1/athlete/workouts/:workoutId/complete` | *(Ninguno)* | **MISSING** | `session_registered` | **No** | **Sí** | No | `completeExecutedWorkout`: `pk = USER#<actor.catalystUserId>` + bloqueo condicional `version` | `204` | **BRECHA:** ruta no conectada en `dispatch()` |
| **16** | `POST` | `/api/v1/athlete/cardio` | *(Ninguno)* | **MISSING** | `session_registered` | **No** | **Sí** | No | `addCardioSession`: `pk = USER#<actor.catalystUserId>` | `204` | **BRECHA:** ruta no conectada en `dispatch()` |
| **17** | `POST` | `/api/v1/athlete/notifications` | *(Ninguno)* | **MISSING** | `session_registered` | **No** | **Sí** | No | `createNotification`: `pk = USER#<actor.catalystUserId>` | `204` | **BRECHA:** ruta no conectada en `dispatch()` |
| **18** | `PUT` | `/api/v1/athlete/recipes/:recipeId` | *(Ninguno)* | **MISSING** | `session_registered` | **No** | **Sí** | No | `saveRecipe`: `pk = USER#<actor.catalystUserId>` + budget 350 KB | `204` | **BRECHA:** ruta no conectada en `dispatch()` |
| **19** | `PUT` | `/api/v1/athlete/meal-plans/:weekStart` | *(Ninguno)* | **MISSING** | `session_registered` | **No** | **Sí** | No | `saveMealPlan`: `pk = USER#<actor.catalystUserId>` + budget 350 KB | `204` | **BRECHA:** ruta no conectada en `dispatch()` |
| **20** | `PUT` | `/api/v1/athlete/routines/:routineId` | *(Ninguno)* | **MISSING** | `session_registered` | **No** | **Sí** | No | `saveWorkoutRoutine`: `pk = USER#<actor.catalystUserId>` + budget 350 KB | `204` | **BRECHA:** ruta no conectada en `dispatch()` |
| **21** | `POST` | `/api/v1/invitations/redeem` | `/api/v1/invitations/redeem` (`:203`) | **MATCH** | `session_registered` | **No** | **Sí** | No (auto-elevación controlada) | Exige `invite.emailNormalized === caller.normalizedEmail` + hash SHA-256 `timingSafeEqual` + lock `pending->redeeming` | `204` | **APTO en Modelo B** |
| **22** | `GET` | `/api/v1/admin/users` | `/api/v1/admin/users` (`:214`) | **MATCH** | `admin` | **No** | **Sí** | `admin \| superadmin` | `PERMISSION_MATRIX['users:list']` sobre `actor.role` leído de `Users` | `204` | **Parcial:** `dispatch()` ignora filtros `query` |
| **23** | `GET` | `/api/v1/admin/stats` | `/api/v1/admin/stats` (`:223`) | **MATCH** | `admin` | **No** | **Sí** | `admin \| superadmin` | `PERMISSION_MATRIX['users:stats']` | `204` | **APTO en Modelo B** |
| **24** | `GET` | `/api/v1/admin/users/:uid` | `GET /api/v1/admin/users/:uid` (`:232`) | **MATCH** | `admin` | **No** | **Sí** | `admin \| superadmin` | `PERMISSION_MATRIX['users:detail']`; validar formato `targetUid` sin `/` ni `#` | `204` | **APTO** (añadir sanitización estricta de segmento `:uid`) |
| **25** | `POST` | `/api/v1/admin/invitations` | `/api/v1/admin/invitations` (`:242`) | **MATCH** | `admin` | **No** | **Sí** | `admin \| superadmin` | `admin` restringido a invitar `athlete`; solo `superadmin` invita `admin` | `204` | **APTO en Modelo B** |
| **26** | `POST` | `/api/v1/admin/invitations/:inviteId/revoke` | `POST /api/v1/admin/invitations/revoke` (`:256`) | **MISMATCH** | `admin` | **No** | **Sí** | `admin \| superadmin` | `PERMISSION_MATRIX['invitations:revoke']` + update condicional `pending->revoked` | `204` | **BRECHA:** unificar path `:inviteId/revoke` |
| **27** | `POST` | `/api/v1/admin/users/:uid/status` | `POST /api/v1/admin/users/set-status` (`:288`) | **MISMATCH** | `admin` | **No** | **Sí** | `admin \| superadmin` | Impide auto-suspensión y que `admin` suspenda `superadmin`; usa `scope: 'admin'` para `USER_STATUS` | `204` | **BRECHA:** unificar path `:uid/status` |
| **28** | `POST` | `/api/v1/admin/users/:uid/role` | `POST /api/v1/admin/users/set-role` (`:270`) | **MISMATCH** | `superadmin_verified_only` | **No** (`getUserDetails` en `scope:admin`) | **Sí** | `superadmin` | `PERMISSION_MATRIX['users:setRole']` + contador `CTRL#SUPERADMIN_COUNT` (deshabilitado por defecto) | `204` | **BRECHA:** unificar path `:uid/role` (+ validar `getUserDetails` antes de promover) |
| **29** | `POST` | `/api/v1/admin/users/:uid/password-reset` | `POST /api/v1/admin/users/password-reset` (`:303`) | **MISMATCH** | `admin` | **Revisar SDK** (`resetPassword` usa `user` en SDK) | **Sí** | `admin \| superadmin` | `PERMISSION_MATRIX['users:resetPassword']` | `204` | **BRECHA:** unificar path `:uid/password-reset` + validar envío real en `INT-08` |
| **30** | `GET` | `/api/v1/admin/audit-logs` | `/api/v1/admin/audit-logs` (`:313`) | **MATCH** | `admin` | **No** | **Sí** | `admin \| superadmin` | `PERMISSION_MATRIX['audit:list']` | `204` | **Parcial:** `dispatch()` ignora parámetros de consulta `month`/`targetUid`/`actorUid` |

### 3.3 Propuesta de Fuente Única de Verdad y Prueba de Paridad Futura (Diseño Sin Modificar Código)

1. **Fuente Única de Verdad (`ROUTE_DEFINITIONS`):**
   - Sustituir la separación entre el array descriptivo `CLEAN_SLATE_ENDPOINT_CATALOG` y la cadena de `if` manuales en `dispatch()` por una única tabla tipada de definiciones de ruta donde **cada entrada** declare obligatoriamente:
     - `id`, `method`, `pathPattern` (con compilación de parámetros `:uid`, `:workoutId`, etc.),
     - `authPolicy`: `'catalyst_exchange' | 'hmac_session' | 'catalyst_or_hmac_inspect'`,
     - `requiredRoles?: UserRole[]`,
     - `allowTargetUidForAdmin: boolean`,
     - `requiresCsrf: boolean`,
     - `handler: (ctx) => Promise<EndpointResponse>`,
     - y metadatos de documentación (`replacesFirebaseMechanism`, `limitsAndNotes`).
   - `CLEAN_SLATE_ENDPOINT_CATALOG` se derivaría automáticamente mediante `.map()` desde `ROUTE_DEFINITIONS`, haciendo estructuralmente imposible que exista una ruta en catálogo sin handler o un handler fuera del catálogo.
2. **Prueba automatizada de paridad futura (cuando se autorice la implementación):**
   - Deberá fallar automáticamente si:
     1. Alguna entrada de `CLEAN_SLATE_ENDPOINT_CATALOG` no posee `handler` resoluble en el router/dispatcher.
     2. Algún `handler` registrado en el dispatcher (salvo `OPTIONS` global explícitamente catalogado como política preflight) no figura en `CLEAN_SLATE_ENDPOINT_CATALOG`.
     3. Existe discrepancia de método HTTP o plantilla de path (`:param`) entre catálogo, router y pruebas.
     4. Cualquier ruta distinta de `OPTIONS` carece de `authPolicy` explícita (prohibido `'public'`/`undefined`).
     5. Cualquier ruta bajo `/api/v1/admin/*` carece de `requiredRoles` (`['admin', 'superadmin']` o `['superadmin']`) o `allowTargetUidForAdmin` según corresponda.
     6. Cualquier ruta `POST`/`PUT`/`PATCH`/`DELETE` desactiva la comprobación CSRF (`Origin` + `Sec-Fetch-Site`).

---

## 4. AUDITORÍA DE `scope: 'user'` VS `scope: 'admin'` Y PROCEDENCIA DE CREDENCIALES

### 4.1 Análisis de los paquetes SDK instalados (`@zcatalyst/*`)

| Aspecto Auditado | Evidencia Exacta en `node_modules/@zcatalyst/` | Verificación |
| :--- | :--- | :--- |
| **1. Inicialización `scope: 'user'`** | `zcAuth.init(req, { scope: 'user' })` -> `auth-admin/dist-es/index.js:26` -> `new CatalystCredential(req.headers, 'user')` (`credential.js:246-265`). Exige `x-zc-user-type !== 'admin'` y presencia de `x-zc-user-cred-token` o `x-zc-cookie`. Si faltan, lanza `AUTH_ERROR` o `INVALID_CREDENTIAL`. | `[VERIFICADO]` |
| **2. Inicialización `scope: 'admin'`** | `zcAuth.init(req, { scope: 'admin' })` -> `new CatalystCredential(req.headers, 'admin')` (`credential.js:248-275`). **Solo** requiere `x-zc-projectid`, `x-zc-admin-cred-type` (`token` \| `ticket`) y `x-zc-admin-cred-token`. Funciona aunque el usuario no envíe token ni cookie de Catalyst Auth. | `[VERIFICADO]` |
| **3. Credenciales reales de `admin`** | `AccessTokenCredential(adminToken)` o `TicketCredential(adminToken)` construido desde `x-zc-admin-cred-type` y `x-zc-admin-cred-token` (o `ApplicationDefaultCredential` vía archivo `~/.config/catalyst/application_auth.json` o env `CLIENT_ID`/`CLIENT_SECRET`/`REFRESH_TOKEN` en CLI local, `credential.js:43-82,333-358`). | `[VERIFICADO]` |
| **4. Procedencia de `x-zc-admin-cred-*`** | Constantes en `@zcatalyst/utils/dist-es/constants.js:55-64,69-75`: el runtime gestionado de Zoho Catalyst (pasarela/contenedores serverless) inyecta `x-zc-admin-cred-type`, `x-zc-admin-cred-token`, `x-zc-projectid`, `x-zc-project-key`, `x-zc-project-secret-key`, `x-zc-user-type` y `x-zc-user-cred-*` en `req.headers` antes de invocar Express. | `[VERIFICADO EN SDK]` / Inyección edge `[NO VERIFICADO EN VIVO]` |
| **5. ¿Lee el SDK de un contexto interno confiable o de `req.headers`?** | `auth-admin/dist-es/index.js:25-26` lee **directamente de `options['headers']` (`req.headers`)**, sin firma ni verificación adicional dentro de Node.js. | `[VERIFICADO]` |
| **6. ¿Podría un cliente externo suministrar o falsificar `x-zc-*`?** | **Sí, si un servidor Express quedase expuesto sin proxy de Catalyst o si la pasarela de Catalyst no sobrescribiera/eliminara cabeceras `x-zc-*` enviadas por el cliente.** Por ello: (a) **NUNCA** debe aceptarse `x-zc-*` desde el navegador como contrato de aplicación, (b) el backend nunca debe desplegarse fuera de la pasarela gestionada de Catalyst sin un reverse proxy que limpie `x-zc-*`, y (c) `INT-08` debe comprobar en vivo que Catalyst sobrescribe/descarta `x-zc-*` inyectadas desde `curl`. | `[RIESGO BLOCKER SI NO SE VERIFICA EDGE]` |
| **7. Reutilización accidental de instancia `user` en NoSQL** | `@zcatalyst/nosql/dist-es/table.js:38,56,77,98,116` pasa `user: CREDENTIAL_USER.admin`, pero `@zcatalyst/transport/dist-es/http-handler.js:300-302,358-365` obtiene el token y `X-CATALYST-USER` desde `this.app.credential.getCurrentUser()` (`this.scope`), **ignorando** `request.user`. Si se pasa un `CatalystApp` con `scope: 'user'` a `new NoSQL(app)`, las queries NoSQL viajarán con credenciales/alcance de usuario en vez de `admin`. | `[VERIFICADO EN CÓDIGO SDK]` |
| **8. Obligación de separar instancias** | Es **obligatorio** instanciar `catalystUserApp = zcAuth.init(req, { scope: 'user' })` exclusivamente para `getCurrentUser()`, y `catalystAdminApp = zcAuth.init(req, { scope: 'admin' })` para `NoSQL` y `UserManagementAdmin`. | `[VERIFICADO]` |
| **9. Operaciones que necesitan `scope: 'user'`** | Únicamente `userManagement.getCurrentUser()` (`user-management.js:28`) durante `/bootstrap-profile`, `/exchange` y fallback sin cookie en `/me`. *(Nota: `UserManagement.resetPassword` en línea `47` también usa `CREDENTIAL_USER.user`).* | `[VERIFICADO]` |
| **10. Operaciones que necesitan `scope: 'admin'`** | Todas las lecturas/escrituras `@zcatalyst/nosql` (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`) y `UserManagementAdmin.updateUserStatus()`, `getUserDetails()`, `getAllUsers()`, `deleteUser()` (`user-management.js:57-215`). | `[VERIFICADO]` |

### 4.2 Frontera Estricta y Garantía Anti-IDOR en Rutas con `scope: 'admin'`

Que el servidor use `scope: 'admin'` para conectarse a NoSQL es equivalente a cualquier backend tradicional que conecta con una base de datos usando una cuenta de servicio privilegiada; **nunca** significa que el cliente tenga privilegios administrativos:

1. **Frontera en tres capas:**
   - **Catalyst `scope: 'user'`:** Solo valida identidad externa inicial (`bootstrap-profile`, `exchange`, y consulta inicial `/me` sin cookie).
   - **Sesión HMAC (`__Host-vigor_session` + `SESSION#<sid>` + `Users`):** Establece la identidad verificada de aplicación (`actor.catalystUserId`) y el rol autoritativo (`actor.role`).
   - **Catalyst `scope: 'admin'`:** Ejecuta exclusivamente las consultas parametrizadas por `actor` ya autenticado; el cliente jamás elige `scope`, tabla ni partición.
2. **Controles Anti-IDOR obligatorios en el 100% de rutas:**
   - `actor.catalystUserId` procede únicamente de `getCurrentUser().user_id` (en frontera Catalyst) o de `claims.sub` tras verificar la firma HMAC en tiempo constante con `crypto.timingSafeEqual` (en rutas HMAC) + validación contra `SESSION#<sid>.ownerUserId` y `Users` (`PK = USER#<claims.sub>`).
   - `assertNoIdentitySpoofing()` rechaza cualquier intento de enviar `uid`, `userId`, `pk`, `partitionKey`, `role`, `roleVersion`, `sessionEpoch`, `accountStatus` en headers, query o body (`403 IDENTITY_SPOOFING_REJECTED`).
   - **Partición estricta en `UserData`:** Todo método de `AthleteDataService` deriva `pk = KeyBuilders.userPk(actor.catalystUserId)`, haciendo imposible acceder o mutar la partición de otro usuario aunque se conozcan sus IDs de entidad (`mealId`, `workoutId`, `recipeId`, etc.).
   - **Roles y privilegios:** `actor.role` proviene siempre de `Users` leído con `consistent_read: true` (nunca de cookies ni tokens cliente). Cambios de rol requieren `PERMISSION_MATRIX['users:setRole']` (`superadmin` únicamente), sagas idempotentes, contador `CTRL#SUPERADMIN_COUNT` y hoy permanecen deshabilitados hasta `PASS-INTEGRATION`.

---

## 5. REVOCACIÓN ANTE DESHABILITACIÓN O ELIMINACIÓN EXTERNA EN CATALYST

### 5.1 Análisis del escenario adversarial

Escenario planteado:
1. Usuario inicia sesión en Catalyst -> VigorCore emite `__Host-vigor_session` (12h) y `SESSION#<sid>`.
2. Un operador deshabilita (`DISABLE`) o elimina (`Delete`) al usuario directamente desde la consola web de Catalyst (sin pasar por `POST /api/v1/admin/users/:uid/status`).
3. El usuario conserva su cookie `__Host-vigor_session` vigente en el navegador.

**Respuesta exacta:**
- **Lo que SÍ bloquea automáticamente:** El usuario **no puede volver a iniciar sesión** en Catalyst ni obtener tokens nuevos de `generateAuthToken()` para futuros `/exchange`.
- **Lo que NO ocurre automáticamente:** Deshabilitar o borrar en Catalyst **NO revoca** las sesiones ya emitidas en `SystemControl` (`SESSION#<sid>`) ni actualiza `Users.accountStatus` o `Users.sessionEpoch`. En un Modelo B sin comprobaciones externas adicionales, el usuario mantendría acceso residual **hasta que expire la cookie (máximo 12 horas)**.

### 5.2 Evaluación de los tres mecanismos (A, B y C)

| Alternativa | Mecanismo | Ventana Máxima de Exposición | Coste / Viabilidad Real en Catalyst |
| :--- | :--- | :--- | :--- |
| **A. Comprobación Catalyst en cada petición** | Enviar `Authorization` + `zcAuth.init(req, { scope: 'user' })` -> `getCurrentUser()` en todas las rutas (Modelo A). | `0` a `<= 1 hora` (según validez de JWT de `generateAuthToken()` si BaaS no invalida JWT al vuelo). | Alto coste en latencia (llamada BaaS por request), pierde sesión en `F5`, rompe `/logout` tras 1h. |
| **B. Comprobación administrativa en `/refresh`, operaciones críticas y revalidación acotada** | Backend llama `UserManagementAdmin.getUserDetails(actor.catalystUserId)` usando `scope: 'admin'` (sin token del cliente). | **Configurable y determinista** (p. ej. `<= 15 minutos` si `SESSION#<sid>` guarda `lastCatalystCheckAtEpochSec`, e **inmediata** en `/refresh` y mutaciones críticas). | **Viable con SDK actual (`[VERIFICADO]`)**; solo requiere 1 lectura BaaS puntual cada ventana de 15 min o en `/refresh`. |
| **C. Event Listeners de Catalyst Authentication** | Documentación oficial: Catalyst Event Listeners en *Authentication* **solo soportan `Sign Up` y `Delete`**; **NO existe evento de deshabilitación (`DISABLE`)**. | Para `Delete`: asíncrono tras evento; **para `Disable`: NO CUBIERTO (infinito hasta TTL)**. | Insuficiente por sí solo; útil únicamente como defensa secundaria automática ante `Delete` para suspender `Users` e incrementar `sessionEpoch`. |

### 5.3 Contrato real verificado de `UserManagementAdmin.getUserDetails(uid)`

Inspeccionado en `@zcatalyst/auth/dist-es/user-management.js:69-82`, `dist-types/utils/interface.d.ts:10-28` y `@zcatalyst/transport/dist-es/http-handler.js:51-67`:
1. **Ejecución:** `GET /baas/v1/project/{project_id}/project-user/${id}` usando `CREDENTIAL_USER.admin` (`scope: 'admin'`).
2. **Campos devueltos (`ICatalystUser`):** `user_id`, `zuid`, `org_id`, `status`, `is_confirmed`, `email_id`, `first_name`, `last_name`, `role_details`.
3. **Criterio exacto de usuario habilitado vs deshabilitado/no confirmado:**
   - **Válido:** `details.user_id === actor.catalystUserId && String(details.status).toUpperCase() === 'ACTIVE' && details.is_confirmed === true`.
   - **Deshabilitado:** `details.status === 'DISABLED'` (documentado en Project Users API y reflejado en `MockCatalystAuthRuntime`).
4. **Usuario eliminado / inexistente:** Cuando BaaS responde HTTP `>= 400` (`404` / `400`), `AuthorizedHttpClient` rechaza la promesa con `{ statusCode, code, message }` (p. ej. `INVALID_INPUT` o código de usuario no encontrado). El código exacto HTTP/BaaS para ID borrado debe registrarse en `INT-04`/`INT-08`.
5. **Indisponibilidad de Catalyst o error no verificable:** **OBLIGATORIO `FAIL-CLOSED`.** Si `getUserDetails(uid)` falla por red, timeout o error 5xx al intentar verificar vigencia (en `/refresh`, acción crítica o expiración de la ventana de 15 min), el sistema **debe denegar la operación (`503` / `401`)** y nunca asumir que el usuario sigue activo.

---

## 6. POLÍTICA DE `/api/v1/auth/session/refresh`

### 6.1 Comparativa: Opción 1 vs Opción 2

| Criterio | Opción 1: Cookie HMAC + `Users` + `SESSION#<sid>` + `getUserDetails(uid)` (`scope: 'admin'`) | Opción 2: Exigir además nuevo `Authorization: <generateAuthToken>` del navegador |
| :--- | :--- | :--- |
| **Distinción clave** | Valida administrativamente que la identidad Catalyst sigue `ACTIVE` y confirmada, **sin** pedir nueva autenticación interactiva del navegador. | Obliga a que el navegador siga teniendo sesión web Catalyst viva y emita token de 1h antes de rotar la cookie HMAC. |
| **Seguridad ante baja en Consola** | **Alta (fail-closed):** detecta `DISABLED` o usuario eliminado en BaaS al instante de llamar `/refresh`. | **Alta:** además detecta si el usuario cerró sesión en Catalyst en otro flujo del dominio `app.`. |
| **UX y recargas tras 1 hora** | **Óptima:** permite trabajar en sesiones largas (>1h) sin depender de la duración del token de 1h ni bloquearse si solo caducó el token en RAM. | **Frágil:** si el usuario mantiene pestaña >1h o recarga y el token/sesión web Catalyst falla, `/refresh` falla antes de tiempo. |
| **Dependencia del navegador Catalyst** | **Baja** durante la ventana de sesión VigorCore (hasta el tope absoluto). | **Total** en cada refresh. |
| **Comportamiento ante caída de Catalyst** | **Fail-closed** (devuelve `503` temporal sin revocar ni emitir nueva cookie; si aún no expiró `sid`, reintentable mientras esté dentro de ventana, o denegado en endpoints críticos). | **Fail-closed** (`401`/`503`); además falla en el propio navegador al llamar `generateAuthToken()`. |
| **Rotación `sid` y robo/reutilización** | Misma protección estricta en `SystemControl`: `oldSid` pasa condicionalmente a `status: 'revoked', revocationReason: 'session_rotated'` antes de emitir `newSid`. Si alguien reintenta usar un `sid` ya rotado (`revocationReason === 'session_rotated'`), debe considerarse **posible robo de cookie** y escalar revocando globalmente (`Users.sessionEpoch++`). | Idéntico. |
| **Duración máxima absoluta** | **Obligatoria:** sin tope absoluto permitiría renovación infinita sin volver a verificar contraseña/SSO en el navegador. | Limitada naturalmente por la sesión web Catalyst + tope absoluto explícito. |

### 6.2 Política Recomendada para `/refresh`

Se recomienda **Opción 1 con tope absoluto estricto y detección de reuso**:
1. **Duración de cada cookie emitida:** `12 horas` (`43,200 s`).
2. **Ventana máxima absoluta desde el `/exchange` o `/bootstrap-profile` inicial:** **`24 horas` (`86,400 s`)**, almacenada en el registro `SESSION#<sid>` como `absoluteExpiresAtEpochSec` (heredada en cada rotación `oldSid -> newSid` sin incrementarse nunca en `/refresh`) y opcionalmente en el claim `abs` del token HMAC.
3. Al invocar `POST /api/v1/auth/session/refresh`:
   - Exigir `Origin` / `Sec-Fetch-Site` válido + `__Host-vigor_session` válido + `Users` (`consistent_read: true`, `accountStatus === 'active'`) + `SESSION#<oldSid>` (`consistent_read: true`, `status === 'active'`, `expiresAtEpochSec > nowSec`, **`absoluteExpiresAtEpochSec > nowSec`**).
   - Ejecutar `UserManagementAdmin.getUserDetails(actor.catalystUserId)` (`scope: 'admin'`) en modo **fail-closed**: si `status !== 'ACTIVE'` o `is_confirmed !== true` o usuario borrado -> revocar sesión/suspender acceso (`403`/`401`); si Catalyst no responde -> fallar cerrado (`503 CATALYST_REVALIDATION_UNAVAILABLE`) **sin** emitir nueva cookie.
   - Si pasa todo, marcar condicionalmente `oldSid` como `revoked` (`session_rotated`) con recuperación por timeout (`consistent_read: true`), y crear `newSid` heredando `absoluteExpiresAtEpochSec` y con `expiresAtEpochSec = Math.min(nowSec + 43200, absoluteExpiresAtEpochSec)`.
   - Al alcanzar las **24 horas absolutas**, `/refresh` rechaza con `401 SESSION_MAX_LIFETIME_REACHED` y exige nueva autenticación Catalyst vía `/exchange`.
   - **Detección de robo/reuso:** Si llega una petición con un `sid` cuyo registro en `SystemControl` ya tiene `status === 'revoked'` y `revocationReason === 'session_rotated'` (después de una pequeña ventana de gracia opcional de 0s para cliente estricto), incrementar `Users.sessionEpoch++` para cerrar todas las sesiones de ese usuario.

---

## 7. POLÍTICA DE ADMINISTRACIÓN DE USUARIOS (CATALYST AUTHENTICATION + `Users`)

No existen transacciones ACID distribuidas entre Catalyst Authentication (BaaS/IAM) y Catalyst NoSQL (`Users`). Toda coordinación debe respetar el principio de **primero denegar / restringir en el sistema autoritativo de aplicación o diseñar compensación idempotente**:

1. **Alta normal de usuario (auto-registro / primer acceso):**
   - El usuario se registra y confirma correo en Catalyst Auth (`is_confirmed === true`).
   - Llama `POST /api/v1/auth/session/bootstrap-profile` con `Authorization: <token>`.
   - Si falla la escritura en `Users` o timeout antes de confirmar `SESSION#<sid>`: el cliente no recibe cookie y `CleanSlateAuthGuard` mantiene `403 USER_PROFILE_NOT_REGISTERED`. Reintentar `/bootstrap-profile` es **idempotente** (recomendado añadir condición `attribute_not_exists(pk)` al insertar `Users` para evitar sobrescrituras por doble clic concurrente).
2. **Alta administrativa de usuario invitado (opcional vía `registerUser` + `AdminInvitations`):**
   - Si un admin crea primero la invitación en `AdminInvitations` (NoSQL), el usuario se registra luego en Catalyst Auth y canjea vía `/invitations/redeem` tras `/bootstrap-profile`. Así no hay acoplamiento transaccional entre `registerUser` y `Users` en el mismo paso.
3. **Suspensión (`/admin/users/:uid/status` -> `suspended`):**
   - **Orden estricto (`adminGovernanceService.ts:972-1005`):** Primero actualizar `Users` (`accountStatus: 'suspended'`, `sessionEpoch++`, `roleVersion++`) con actualización condicional (`sessionEpoch == esperado`). Luego invocar `UserManagementAdmin.updateUserStatus(targetUid, USER_STATUS.DISABLE)`.
   - **Fallo parcial:** Si `Users` falla, aborta limpio sin tocar Catalyst. Si `Users` triunfa y `updateUserStatus(DISABLE)` falla por red/timeout, **el usuario ya quedó bloqueado inmediatamente en VigorCore (`Users` `consistent_read: true`)**, el audit/saga marca estado `CATALYST_SYNC_PENDING` (mejora futura recomendada) y la conciliación administrativa reintenta `USER_STATUS.DISABLE` de forma idempotente.
4. **Reactivación (`/admin/users/:uid/status` -> `active`):**
   - **Orden estricto inverso de seguridad recomendado:** En reactivación, primero confirmar/habilitar `UserManagementAdmin.updateUserStatus(targetUid, USER_STATUS.ENABLE)` y luego actualizar `Users.accountStatus = 'active'` (así si falla Catalyst Auth, nunca queda una cuenta inconsistente marcada activa en `Users` pero muerta en Catalyst; y en cualquier caso nunca reactivar `Users` si `getUserDetails` muestra usuario eliminado).
5. **Eliminación de usuario:**
   - En `Users` y `AuditLogs` **no debe borrarse el documento histórico** para preservar trazabilidad de auditoría e integridad referencial: marcar `Users.accountStatus = 'suspended'` (o estado terminal `'deleted'`/`'anonymized'` si se implementa GDPR), incrementar `Users.sessionEpoch++`, invocar `UserManagementAdmin.deleteUser(uid)` en Catalyst Auth, y revocar/dejar expirar sesiones activas.
   - Opcionalmente, configurar un **Event Listener de Catalyst `Authentication -> Delete`** que, ante borrado directo en consola, marque `Users.accountStatus = 'suspended'` e incremente `Users.sessionEpoch++`.
6. **Procedimiento de emergencia cuando se deshabilita desde Consola Catalyst + Conciliación:**
   - **Procedimiento operativo:** Si un operador debe deshabilitar una cuenta de emergencia en Consola Catalyst, debe inmediatamente (a) ejecutar `/admin/users/:uid/status` (`suspended`) desde panel VigorCore o script administrativo offline (para cortar `Users.accountStatus` y subir `sessionEpoch` al instante), o (b) confiar en la ventana acotada `<= 15 min` + `getUserDetails` en `/refresh` si se implementa la revalidación periódica.
   - **Conciliación administrativa:** Disponer de un job/CLI de lectura + reparación controlada que compare `GSI_Directory` (`Users`) frente a `UserManagementAdmin.getAllUsers()`: detectando usuarios `DISABLED`/inexistentes en Catalyst que figuren `active` en `Users`, o `superadmin` en `Users` desincronizados con `CTRL#SUPERADMIN_COUNT`.

---

## 8. REGISTRO DE RIESGOS CLASIFICADOS

| ID | Severidad | Riesgo / Hallazgo | Evidencia | Impacto | Escenario de Explotación o Fallo | Mitigación Recomendada | Prueba Necesaria | Dependencia Integración Real |
| :-: | :---: | :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **R-01** | **BLOCKER** | Desalineación entre Security Rules (`required`) y peticiones HMAC-only del Modelo B (y posible bloqueo `OPTIONS`) | Docs Security Rules + ausencia de config en repo (`docs/14`, Sec. 2) | Bloqueo total de rutas `/athlete/*`, `/admin/*`, `/logout`, `/refresh` antes de llegar a Express | Al desplegar con `authentication: "required"`, Catalyst rechaza peticiones con cookie `__Host-vigor_session` sin token Catalyst | Configurar Security Rules `authentication: "optional"` (o API Gateway por ruta) + pipeline fail-closed interno en Express | `INT-06` + prueba live de `OPTIONS`, `/exchange` y `/athlete/workspace` sin token Catalyst | **Sí (Consola + Live Edge)** |
| **R-02** | **BLOCKER** | Confianza implícita de `@zcatalyst/auth-admin` en cabeceras `x-zc-*` sin validación criptográfica en Node.js | `auth-admin/dist-es/index.js:25-26`, `credential.js:248-252` | Suplantación total de identidad o credenciales admin si el borde no sanitiza `x-zc-*` | Atacante externo envía `x-zc-user-type: user` + `x-zc-user-cred-token` o `x-zc-admin-cred-token` hacia un Express sin gateway | Desplegar **exclusivamente** detrás de Catalyst Advanced I/O gestionado; nunca exponer Node directamente; verificar en vivo que Catalyst sobrescribe toda `x-zc-*` entrante | `INT-08` (petición externa enviando cabeceras `x-zc-*` falsificadas) | **Sí (Live Edge Catalyst)** |
| **R-03** | **BLOCKER** | Preservación de `Authorization: <token>`, `Set-Cookie: __Host-vigor_session`, `Origin` y `Sec-Fetch-Site` en Domain Mapping / API Gateway / Safari ITP | `httpSecurityPolicy.ts:117`, `docs/14`, `docs/15` | Bloqueo CORS (`Authorization` falta hoy), pérdida de cookie o degradación de CSRF | Navegador falla preflight `OPTIONS` por faltar `Authorization`, o proxy L7 añade `Domain=` a `__Host-vigor_session`, o Safari ITP retiene cookie | Añadir `Authorization` en `Allow-Headers`; confirmar por escrito con Zoho Support y validar en `INT-06`/`INT-07` antes de producir | `INT-06`, `INT-07` (`BR-01..BR-20`) | **Sí (Zoho Support + Browsers)** |
| **R-04** | **HIGH** | **12 rutas `/athlete/*` `MISSING` y 4 rutas `/admin/*` `MISMATCH`** entre catálogo y `CleanSlateApiDispatcher.dispatch()` (más filtros `query` ignorados) | `apiRouterSchema.ts:44-75` vs `89-342` vs `athleteDataService.ts:144-500` | Superficie API incompleta (`404`) y riesgo de que rutas futuras se implementen sin paridad o auth uniforme | Cliente llama `POST /api/v1/athlete/meals` o `POST /api/v1/admin/users/:uid/status` y obtiene `404 ROUTE_NOT_FOUND` | Unificar catálogo y dispatcher en `ROUTE_DEFINITIONS` único y añadir suite automatizada de paridad obligatoria | Nueva prueba `PASS-STATIC` / `PASS-UNIT` de paridad de catálogo | No (local), sí E2E después |
| **R-05** | **HIGH** | Reutilización accidental de `CatalystApp` (`scope: 'user'`) para `@zcatalyst/nosql` | `@zcatalyst/transport/dist-es/http-handler.js:300-365` vs `@zcatalyst/nosql/dist-es/table.js` | Fallo de permisos en NoSQL o envío con `X-CATALYST-USER: user` | Pasar `app = zcAuth.init(req)` (user) a `NoSQL(app)` provoca que `HttpClient` use `scope: 'user'` ignorando `request.user = admin` | Mantener fábricas separadas `createUserAuthApp(req)` (`scope: 'user'`) y `createAdminApp(req)` (`scope: 'admin'`) | Unit test de contrato verificando cabeceras de transporte + `INT-08` | **Sí (`INT-08` live NoSQL)** |
| **R-06** | **HIGH** | Ventana residual hasta 12h si un operador deshabilita/borra un usuario directamente en Consola Catalyst | Modelo B sin re-check externo + ausencia de Event Listener para `Disable` | Usuario deshabilitado en Catalyst sigue operando con cookie HMAC hasta expirar | Operador usa Consola Catalyst en emergencia sin ejecutar `/admin/users/:uid/status` | Implementar `UserManagementAdmin.getUserDetails(uid)` fail-closed en `/refresh`, ops críticas y revalidación periódica cada <=15 min en `SESSION#<sid>` + Event Listener `Delete` | `PASS-MOCK` (`getUserDetails` `DISABLED`/404/timeout) + `INT-04` | **Sí (`INT-04`/`INT-08`)** |
| **R-07** | **MEDIUM** | `UserManagement.resetPassword()` en `@zcatalyst/auth` usa `CREDENTIAL_USER.user` y no `admin` | `node_modules/@zcatalyst/auth/dist-es/user-management.js:47` | El endpoint administrativo `/admin/users/:uid/password-reset` podría fallar al ejecutarse con `scope: 'admin'` sin token de usuario | Admin dispara reset de contraseña para un atleta en Modelo B | Verificar en `INT-08` si BaaS acepta `/project-user/forgotpassword` bajo `scope: 'admin'` o `auth: false`, o reemplazar por flujo propio | `INT-08` en cuenta real | **Sí (`INT-08` live Auth)** |
| **R-08** | **MEDIUM** | Ausencia de `condition: attribute_not_exists(pk)` en `insertItem('Users')` y fallo parcial en reactivación/suspensión | `cleanSlateAuthGuard.ts:1052`, `adminGovernanceService.ts:972-1005` | Carrera en alta concurrente inicial o desincronía temporal `Users` vs Catalyst | Dos peticiones paralelas a `/bootstrap-profile` del mismo usuario pasan `GSI_Email` a la vez; o falla `updateUserStatus` tras actualizar `Users` | Añadir `attribute_not_exists(pk)` en `/bootstrap-profile`; invertir orden en reactivación (primero Catalyst `ENABLE`, luego `Users`); flag de conciliación | `PASS-MOCK` de concurrencia y fallo parcial | Parcial (`NoSQL` atomicity `INT-01`) |
| **R-09** | **MEDIUM** | Sin detección automática de robo/reuso de cookie rotada ni límite absoluto de vida de sesión en `/refresh` | `cleanSlateAuthGuard.ts:858-873` | Un ladrón con cookie previa a un refresh o un atacante renovando indefinidamente cada <12h perpetuaría acceso | Atacante reenvía `oldSid` ya rotado o usuario legítimo renueva cada 6h eternamente sin revalidar contraseña | Añadir `absoluteExpiresAtEpochSec` (24h max) en `SESSION#<sid>` y revocación global `sessionEpoch++` ante replay de `sid` revocado por rotación | `PASS-MOCK` en `tests/07` | No (lógica local), sí E2E `BR-19/20` |
| **R-10** | **LOW** | `GET /api/v1/admin/users/:uid` y resto de paths paramétricos sin validación estricta de formato `:uid` / `:id` antes de construir PKs | `apiRouterSchema.ts:232-238` | Mensajes de error `500` si `targetUid` contiene `#` (`KeyBuilders.userPk` lanza Error genérico) | Admin/cliente pasa `%23` o cadena inválida en `:uid` | Validar parámetros de ruta contra regex segura sin `#` ni `/` devolviendo `400 INVALID_IDENTIFIER` | `PASS-UNIT` de router | No |

---

## 9. DICTAMEN EXPLÍCITO (RESPUESTA A LAS 8 PREGUNTAS CLAVE)

1. **¿El Modelo B Refinado puede funcionar con una sola función Advanced I/O?**
   **Sí**, a nivel arquitectónico y de SDK (`zcAuth.init(req, { scope: 'user' })` para intercambio inicial y `zcAuth.init(req, { scope: 'admin' })` para NoSQL/Admin en el resto), **sujeto a** usar Security Rules `"authentication": "optional"` (o API Gateway con políticas por ruta) y confirmar soporte nativo de dominio personalizado en `api.<dominio>` (`docs/14`).
2. **¿Qué política Security Rules necesitaría?**
   Con una única función y Security Rules nativo, **necesita obligatoriamente `"authentication": "optional"`** con `methods: ["GET", "POST", "PUT", "PATCH", "DELETE"]` (y confirmar paso de `OPTIONS` en `INT-06`). Si se habilitase API Gateway, Security Rules se desactivaría automáticamente y cada ruta definiría su propia política en el gateway.
3. **¿Qué sucede si la función requiere Catalyst Authentication para todas sus invocaciones?**
   **El Modelo B deja de funcionar.** Catalyst bloquearía en el borde toda petición normal con `__Host-vigor_session` que no adjunte `Authorization: <generateAuthToken>` o cookies Catalyst (y posiblemente preflights `OPTIONS`), obligando a volver al Modelo A (token de 1h en cada request) o a dividir en dos funciones separadas.
4. **¿Están realmente protegidas las 30 rutas declaradas?**
   **No de forma homogénea en ejecución HTTP actual.** De las 30 rutas declaradas en `CLEAN_SLATE_ENDPOINT_CATALOG`, **14** están conectadas exactamente, **4** rutas admin tienen path distinto en `dispatch()` (`MISMATCH`), y **12** rutas `/athlete/*` están **`MISSING`** en `dispatch()` (aunque protegidas en diseño y en la lógica de `AthleteDataService`, hoy devuelven `404 ROUTE_NOT_FOUND` vía HTTP). Ninguna ruta implementada permite acceso anónimo sin validación, pero el dispatcher está incompleto.
5. **¿Es seguro usar `scope: 'admin'` en las rutas normales con la arquitectura propuesta?**
   **Sí, bajo tres condiciones estrictas:** (1) separación total de instancias `CatalystApp` (`scope: 'user'` nunca mezclado con `scope: 'admin'`), (2) ejecución obligatoria de `HttpSecurityPolicy` + `assertNoIdentitySpoofing` + validación HMAC de `__Host-vigor_session` + `consistent_read: true` en `Users` y `SESSION#<sid>` antes de cualquier llamada NoSQL, derivando siempre `pk` y `role` del servidor, y (3) verificación viva `INT-08` de que la pasarela de Catalyst sobrescribe/descarta cualquier cabecera `x-zc-*` externa.
6. **¿Qué garantía de revocación existe ante deshabilitación externa?**
   - **Suspensión desde VigorCore (`/admin/users/:uid/status`):** revocación **inmediata** en la siguiente petición (`Users.accountStatus` + `sessionEpoch++` + `USER_STATUS.DISABLE`).
   - **Deshabilitación directa en Consola Catalyst:** en Modelo B puro existiría ventana residual hasta **12 horas** (Catalyst Event Listeners NO soporta eventos de `Disable`, solo `Sign Up` y `Delete`). Con la mitigación obligatoria de **`UserManagementAdmin.getUserDetails(uid)` (`scope: 'admin'`, fail-closed)** en `/refresh`, operaciones sensibles y ventana de revalidación acotada en `SESSION#<sid>` (p. ej. **<= 15 minutos**), el acceso residual queda estrictamente acotado y garantizado.
7. **¿Qué política de `/refresh` recomiendas?**
   **Opción 1 acotada:** `/refresh` valida `__Host-vigor_session` + `SESSION#<oldSid>` + `Users` (`consistent_read: true`) + **`UserManagementAdmin.getUserDetails(uid)` activo y confirmado (fail-closed)**, rota `oldSid -> newSid` en `SystemControl`, dispara revocación global si se reusa un `sid` ya rotado, y impone una **duración máxima absoluta de 24 horas** (`absoluteExpiresAtEpochSec`) desde el login Catalyst original antes de exigir nuevo `/exchange`.
8. **¿Qué debe corregirse antes de comenzar la implementación?**
   - Decisión formal del operador sobre Modelo B Refinado + políticas de ventana de revalidación (15 min) y `/refresh` (24h máx).
   - Confirmación escrita de soporte Zoho Catalyst sobre dominio personalizado para Advanced I/O (`docs/14`, Sección 9) + comportamiento de Security Rules `optional` / `OPTIONS` / preservación de `__Host-vigor_session`.
   - Plan de código en fase autorizada para: añadir `Authorization` a `HttpSecurityPolicy`, separar `authenticateViaCatalystExchange` vs `authenticateWithSignedSession` en `CleanSlateAuthGuard`, separar instancias `scope: 'user'` y `scope: 'admin'`, unificar `ROUTE_DEFINITIONS` (resolviendo las 12 rutas `MISSING` y 4 `MISMATCH`), añadir pruebas de paridad y ejecutar `INT-01..INT-08` y `BR-01..BR-20`.

---

## 10. DISEÑO RECOMENDADO Y CAMBIOS FUTUROS NECESARIOS (SOLO ESPECIFICACIÓN — NO APLICADOS)

Cuando el operador autorice una futura fase de implementación sobre `poc/catalyst-clean-slate/`:

1. **`src/security/httpSecurityPolicy.ts`:**
   - Añadir `'Authorization'` a `Access-Control-Allow-Headers` (`línea 117`).
   - Permitir parametrizar `allowedOrigins` con `https://app.<dominio-propio>` mediante configuración de entorno.
2. **`src/auth/cleanSlateAuthGuard.ts`:**
   - Separar explícitamente:
     - `authenticateViaCatalystExchange(req)` para `/bootstrap-profile`, `/exchange` y fallback `/me` sin cookie (exige `scope: 'user'` -> `getCurrentUser()`).
     - `authenticateWithSignedSession(req, options)` para las rutas HMAC-only (verifica firma HMAC en tiempo constante, extrae `claims.sub`, valida `Users` y `SESSION#<sid>` con `consistent_read: true`, y ejecuta revalidación `getUserDetails` según umbral/ruta).
   - Agregar `lastCatalystCheckAtEpochSec` y `absoluteExpiresAtEpochSec` (24h) en `SessionRecordItem` y detección de replay sobre `revocationReason === 'session_rotated'`.
   - Agregar condición `attribute_not_exists(pk)` en el `insertItem('Users')` de `bootstrapAuthenticatedProfile()`.
   - Implementar fábrica live con dos instancias aisladas: `zcAuth.init(req, { scope: 'user' })` frente a `zcAuth.init(req, { scope: 'admin' })`.
3. **`src/routes/apiRouterSchema.ts`:**
   - Migrar a un único registro `ROUTE_DEFINITIONS` que derive automáticamente `CLEAN_SLATE_ENDPOINT_CATALOG` y el despachador HTTP, conectando las 12 rutas `/athlete/*` faltantes, unificando los 4 paths `/admin/*` con parámetros `:uid`/`:inviteId`, pasando los filtros `query` de `/admin/users` y `/admin/audit-logs`, y añadiendo validación de formato para identificadores de path.
   - Registrar explícitamente `OPTIONS` en la política CORS/router.
4. **Tests locales (`poc/catalyst-clean-slate/tests/`):**
   - Añadir prueba automatizada de paridad estricta catálogo <-> dispatcher <-> authPolicy <-> roles <-> CSRF.
   - Añadir pruebas `PASS-MOCK` de Modelo B (rutas sin cabecera Catalyst tras `/exchange`, `getUserDetails` `DISABLED`/404/timeout fail-closed, replay de `sid` rotado, tope absoluto 24h y separación `scope: 'user'`/`'admin'`).

---

## 11. DECISIONES PENDIENTES DEL OPERADOR

1. **Aprobación arquitectónica del Modelo B Refinado** con Security Rules `"authentication": "optional"` (o API Gateway por ruta) y separación estricta `scope: 'user'` / `scope: 'admin'`.
2. **Aprobación de parámetros de sesión y revocación:**
   - Ventana de revalidación periódica contra Catalyst (`getUserDetails` `admin`) en sesiones activas: p. ej. cada **15 minutos** (o solo en `/refresh` y acciones críticas).
   - Política de `/refresh`: **Opción 1** (`getUserDetails` fail-closed + rotación `sid` + tope absoluto **24 horas**) frente a **Opción 2** (exigir token Catalyst nuevo).
3. **Confirmación de Zoho Support (`support@zohocatalyst.com`):** Autorizar el envío de la consulta preparada en `docs/14` añadiendo la verificación explícita de `OPTIONS` bajo Security Rules `"authentication": "optional"` y sanitización de cabeceras `x-zc-*` en Advanced I/O.
4. **Autorización de fase futura de código:** Indicar cuándo abrir una fase separada para aplicar los cambios de la Sección 10 (todavía **prohibido** en esta fase).
