# FASE 4.2.2 — PARIDAD COMPLETA DEL BACKEND, ROUTE DISPATCHER Y HARDENING DE CONTRATOS

**Alcance:** Exclusivo dentro de `poc/catalyst-clean-slate/`  
**Estado:** `PARIDAD COMPLETA (30/30 RUTAS CABLEADAS EN CLEAN_SLATE_ENDPOINT_CATALOG / ROUTE_DEFINITIONS / CLEAN_SLATE_UI_ENDPOINT_MAP)`  
**Restricción remota:** Sin modificaciones al frontend raíz (`/src/**`), Zoho Slate, DNS, `app.vigorcore.lat`, `api.vigorcore.lat`, tablas Catalyst NoSQL remotas, Firebase/Firestore/GCP ni credenciales reales.

---

## 1. Fuente Única de Verdad de Rutas (`ROUTE_CONTRACT_SPECS` → `ROUTE_DEFINITIONS` → `CLEAN_SLATE_ENDPOINT_CATALOG` & `CLEAN_SLATE_UI_ENDPOINT_MAP`)

1. **`src/routes/routeContracts.ts`** (módulo isomórfico puro sin dependencias Node):
   - Define `ROUTE_CONTRACT_SPECS` con exactamente **30 contratos canónicos** (`id`, `method`, `path`, `pathParams`, `auth`, `authPolicy`, `requiresCsrf`, `requiresCatalystLiveCheck`, `allowedRoles`, `rbacPermissions`, `allowTargetUidForAdmin`, `antiIdorRule`, `inputSchemaSummary`, `outputSchemaSummary`, `replacesFirebaseMechanism`, `limitsAndNotes`, `purpose`, `verificationScope`) y `OPTIONS_PREFLIGHT_CONTRACT`.
2. **`src/routes/apiRouterSchema.ts`**:
   - Define `ROUTE_DEFINITIONS` vinculando 1:1 cada una de las 30 especificaciones de `ROUTE_CONTRACT_SPECS` con su handler ejecutable, compilador de rutas estáticas antes que paramétricas, validación de duplicados y `validateSafeIdentifier` en todos los parámetros `:param`.
   - Deriva `CLEAN_SLATE_ENDPOINT_CATALOG` directamente desde `ROUTE_DEFINITIONS.map(...)` eliminando la duplicación manual previa.
3. **`src/frontend/contracts/cleanSlateModels.ts`**:
   - Deriva `CLEAN_SLATE_UI_ENDPOINT_MAP` directamente desde `ROUTE_CONTRACT_SPECS`, alcanzando `30/30 wired_match` (`0` desfases de path y `0` rutas pendientes).

---

## 2. Resolución de Desfases Admin (4 rutas) y Cableado de Atleta + Filtros (12 + 2 rutas)

### 2.1 Unificación canónica de rutas Admin (desfases eliminados)

Los 4 paths planos heredados se eliminaron de `CleanSlateApiDispatcher` (devuelven `404 ROUTE_NOT_FOUND`):

| Ruta Canónica Activada | Ruta Plana Eliminada (`404`) | Protección Adicional |
| --- | --- | --- |
| `POST /api/v1/admin/invitations/:inviteId/revoke` | `/api/v1/admin/invitations/revoke` | Valida `:inviteId` con `SAFE_IDENTIFIER_RE` + rechaza `body.inviteId !== params.inviteId` (`400 PARAM_BODY_MISMATCH`). |
| `POST /api/v1/admin/users/:uid/status` | `/api/v1/admin/users/set-status` | Valida `:uid`, `newStatus ∈ {'active','suspended'}`, rechaza `body.targetUid !== params.uid`, bloquea auto-suspensión y suspensión de superadmin por admin. |
| `POST /api/v1/admin/users/:uid/role` | `/api/v1/admin/users/set-role` | Restringida exclusivamente a `superadmin`; mutaciones de rol `superadmin` permanecen bloqueadas por defecto (`403 SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED`). |
| `POST /api/v1/admin/users/:uid/password-reset` | `/api/v1/admin/users/password-reset` | Valida `:uid`, rechaza `body.targetUid !== params.uid`; ejecución remota de `resetPassword()` permanece pendiente de `INT-08`. |

Se eliminó `routeCompatibilityMode` (`'dispatcher_current'`) de `CatalystHttpAdminRepository`; el adaptador admin solo consume los 4 paths canónicos.

### 2.2 Cableado de las 12 rutas pendientes de Atleta + filtros Admin

Se conectaron todas las rutas pendientes en `ROUTE_DEFINITIONS`:
- `POST /api/v1/athlete/onboarding/complete`
- `POST /api/v1/athlete/meals` y `GET /api/v1/athlete/meals` (`startDate`, `endDate`, `limit` 1..100, `startKey`)
- `PUT /api/v1/athlete/groceries/sync` (tope estricto `<= 25` ítems por HTTP request; `400 BATCH_LIMIT_EXCEEDED` si supera 25)
- `POST /api/v1/athlete/workouts/start` (forzado inicial `in_progress` + fetch-before-insert)
- `POST /api/v1/athlete/workouts/:workoutId/sets` (consistente padre `in_progress` mediante `findExecutedWorkoutById` aunque falte `workoutStartedAt`)
- `POST /api/v1/athlete/workouts/:workoutId/complete` (bloqueo optimista de versión + inmutabilidad terminal `completed` / `abandoned`)
- `POST /api/v1/athlete/cardio`, `POST /api/v1/athlete/notifications`
- `PUT /api/v1/athlete/recipes/:recipeId`, `PUT /api/v1/athlete/meal-plans/:weekStart`, `PUT /api/v1/athlete/routines/:routineId` (con verificación de consistencia ID path vs body y techo 350 KB / 400 KB)
- Filtros query reales en `GET /api/v1/admin/users` (`role`, `accountStatus`, `searchQuery`, `limit`, `startKey`) y `GET /api/v1/admin/audit-logs` (`month`, `targetUid`, `actorUid`, `action`, `startDate`, `endDate`, `limit`, `startKey`).

---

## 3. Hardening de Seguridad, Sesiones y Adaptadores HTTP

1. **Límite absoluto de sesión de 24 horas (`CleanSlateAuthGuard`)**:
   - `SessionRecordItem` incorpora `initialAuthAtEpochSec` y `absoluteExpiresAtEpochSec` (`initialAuthAtEpochSec + 24h`).
   - `refreshSignedSession` rota `sid` y recorta el TTL restante para no superar nunca las 24h absolutas; si expiró, devuelve `401 SESSION_MAX_LIFETIME_REACHED`.
2. **Hardening CSRF (`HttpSecurityPolicy` & `CatalystHttpTransport`)**:
   - `CatalystHttpTransport` falla **fail-closed** (`403 CSRF_TOKEN_MISSING`, `origin: 'client_synthetic'`) antes de invocar `fetch` cuando una petición mutante (`POST`, `PUT`, `PATCH`, `DELETE`) carece de `csrfProvider` o recibe token vacío / con CR-LF.
   - `HttpSecurityPolicy` rechaza tokens `X-Vigor-CSRF` malformados y soporta `requireCsrfHeaderOnMutations`.
3. **Distinción explícita de origen de errores (`RepositoryErrorOrigin`)**:
   - `CleanSlateRepositoryError` expone `origin: 'client_synthetic' | 'http_server'`, `isSyntheticClientError` y `httpStatusReceived`.
4. **Reintentos seguros e `AbortSignal`**:
   - `CatalystHttpTransport` reintenta únicamente métodos idempotentes (`GET`, `PUT` o `idempotent: true`) ante fallos transitorios (`NETWORK_ERROR`, `429`, `502`, `503`, `504`), nunca en errores de validación/auth/CSRF ni cuando `AbortSignal` aborta durante el backoff.
5. **Sincronización multi-lote honesta e idempotente (`> 25` ítems de compras)**:
   - Cuando `replaceExisting: false` en lotes de continuación o reintento, `AthleteDataService.syncMealPlanToGroceries` borra y reinserta solo las claves determinísticas `GROCERY#<id>` del lote entrante, evitando borrar el lote 0 o crear duplicados.
   - Si falla un lote posterior (`batchIndex > 0`), `CatalystHttpAthleteRepository.syncGroceries` lanza `PartialBatchSyncError` (`atomic: false`, `persistedCount`, `completedBatches`, `remainingItems`) y `resumeGrocerySyncBatch` permite reanudar limpiamente.

---

## 4. Verificación y Límites Honestos

- **Verificación local (`PASS-UNIT` / `PASS-MOCK` / Loopback Express `127.0.0.1:0`):**
  - Las 30 rutas del catálogo + `OPTIONS` preflight, matriz RBAC completa, anti-IDOR, conflictos 409, límite 24h, CSRF fail-closed, adaptadores HTTP y recuperación multi-lote verificados sin mocks silenciosos.
- **Pendiente de verificación remota viva (`PENDING_LIVE_VERIFICATION`):**
  - `tests/06-integration-catalyst-live.spec.ts` no se ejecuta ni se simula como aprobado.
  - La respuesta de soporte Zoho sobre dominio personalizado para Advanced I/O y cookies `__Host-vigor_session` continúa pendiente.
  - La mutación automática del rol `superadmin` permanece bloqueada (`403 SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED`) y el envío real de `resetPassword()` en Modelo B continúa pendiente de `INT-08`.
