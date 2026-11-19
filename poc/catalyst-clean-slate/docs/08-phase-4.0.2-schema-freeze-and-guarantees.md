# VIGORCORE — FASE 4.0.2: CONGELACIÓN DEL MODELO FÍSICO, GARANTÍAS Y TRAZABILIDAD CLEAN-SLATE

**Fecha:** 13 de noviembre de 2026  
**Dictamen:** **`CLEAN_SLATE_SCHEMA_FREEZE — PENDING OPERATOR APPROVAL`**  
**Estado de Infraestructura:** 0 tablas creadas, 0 índices creados, 0 usuarios creados, 0 despliegues; Firebase/GCP y sitio Slate (`https://fit-x-bhnatsxl.onslate.com`) 100% intactos.

---

## 1. INFORME FINAL DE GARANTÍAS Y LIMITACIONES (ENTREGABLE 1)

### A. Contratos Oficiales de Zoho Catalyst NoSQL Incorporados (Ref. 13/nov/2026)
1. **Atomicidad de un solo ítem:** `updateItems` aplica condiciones atómicamente sobre un único ítem por clave (`keys.length === 1` exigido por `buildSingleItemUpdatePayload()`). **No existen transacciones ACID entre ítems ni entre tablas (`SystemControl` y `Users`).**
2. **Inspección obligatoria de `data.update[i].status` (HTTP 200 != Éxito):**
   - `assertCatalystUpdateApplied()` comprueba `httpStatus === 200 && data.update[0].status === 'Success'`.
   - Si el clúster devuelve HTTP 200 con `ConditionMismatch` o `CriteriaMismatch`, la aplicación **aborta obligatoriamente** (`409` / `LAST_SUPERADMIN_PROTECTED` / `WORKOUT_CONCURRENCY_CONFLICT`).
3. **Timeout -> Lectura consistente antes de reintentar:**
   - Ante `CatalystTimeoutError`, `reserveSuperadminSlotWithTimeoutRecovery()` y `setUserRole()` ejecutan **`fetchItem(..., { consistent_read: true })`** antes de decidir si reintentar o continuar, evitando decrementos duplicados si la escritura remota sí se aplicó antes del timeout.
4. **Contador `CTRL#SUPERADMIN_COUNT` inexistente:**
   - `assertNoSuperadminCounterDrift()` falla cerrado con `409 SUPERADMIN_COUNTER_NOT_PROVISIONED` si falta el registro. Jamás se reserva ni se crea silenciosamente desde un endpoint HTTP; requiere `provisionSuperadminCounterFromOperator()`.
5. **`insertItems` ignora condiciones sin dato previo:** Confirmado y modelado; prohibido usarlo como lock de exclusión.

### B. Revocación de Sesión y Unicidad de Identidad (Objetivo 4 — Actualizado a Contratos 4.0.3–4.0.5)
- **Campos reales `@zcatalyst/auth` (`getCurrentUser()`):** Únicamente `user_id`, `zuid`, `org_id`, `status` (`ACTIVE`/`NOT_CONFIRMED`/`DISABLED`), `is_confirmed`, `email_id`, `first_name`, `last_name`, `created_time`, `modified_time`, `role_details`. Cero campos no documentados.
- **Comparación autoritativa en CADA petición (`CleanSlateAuthGuard.authenticate`):**
  1. Rechaza cabeceras/parámetros manipulables por el cliente (`403 IDENTITY_SPOOFING_REJECTED`).
  2. Verifica `user.status === 'ACTIVE'` e `is_confirmed === true`.
  3. Lee `Users` con **`consistent_read: true`** (si falta -> `403 USER_PROFILE_NOT_REGISTERED`; si `accountStatus !== 'active'` -> `403 ACCOUNT_SUSPENDED`).
  4. Valida cookie firmada `__Host-vigor_session` (HMAC-SHA256 de 256 bits) contra `Users.sessionEpoch` (revocación global) **y** contra `SystemControl` `SESSION#<sid>` con **`consistent_read: true`** (revocación individual, `/logout`, `/refresh` y expiración explícita `expiresAtEpochSec > nowSec`).
  5. Un cambio de `role` o `accountStatus` en `Users` toma efecto inmediato en el siguiente request por lectura consistente.
- **Unicidad de correo (`GSI_Email`):** Un índice secundario **NO impone `UNIQUE`**. La unicidad entre Google OAuth y Email/Password se apoya en Catalyst Authentication y **NO queda declarada verificada hasta ejecutar `INT-03` en vivo (`PENDING PASS-INTEGRATION`)**. Como defensa en profundidad, `bootstrapAuthenticatedProfile` consulta `GSI_Email` con `consistent_read: true` y bloquea con `409 DUPLICATE_EMAIL_ANOMALY` si otro `user_id` comparte el correo.

---

## 2. DISEÑO DEFINITIVO DE LAS 5 TABLAS CONGELADAS (ENTREGABLE 2 — OBJETIVO 6)

*(Las claves principales, Sort Keys adicionales y claves de índices son inmutables tras crearse en Catalyst Console.)*

| Tabla | PK (Tipo) | SK Primaria (Tipo) | Additional SKs (Tipo, máx 5) | TTL (Tipo) | Consultas Atendidas | Consultas NO Soportadas Directamente | Paginación |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`Users`** | `pk` (`String`: `USER#<uid>`) | *Ninguna* | *Ninguna* (0/5) | No | Lookup directo `USER#<uid>`, búsqueda por correo (`GSI_Email`), listado por segmento (`GSI_Directory`), filtro por rol/estado (`GSI_RoleStatus`) | Búsqueda de subcadena libre (`contains` sobre `displayName`) sin escanear página | Cursor `startKey` + cursor compuesto base64 (`limit <= 100`) |
| **`UserData`** | `pk` (`String`: `USER#<uid>`) | `sk` (`String`: prefijo de dominio) | `entityType` (`String`), `updatedAt` (`String`) (3/5) | No | Workspace completo por atleta (`pk`), rango por fecha de comidas (`SK BETWEEN`), sets por entrenamiento (`SK BEGINS_WITH SET#<wId>`), cronología por tipo (`GSI_UserEntityDate`) | Consultas *cross-user* (prohibidas por aislamiento multi-tenant) o búsqueda full-text | Cursor `startKey` en `queryTable` (`<= 100` ítems/página, techo 5–10 páginas/invocación) |
| **`AdminInvitations`** | `pk` (`String`: `INVITE#<id>`) | *Ninguna* | *Ninguna* (0/5) | `ttlEpochSec` (`Number`) | Lookup puntual al canjear/revocar, búsqueda por correo+estado (`GSI_InviteEmailStatus`) | Listado global ordenado sin filtro de correo | `startKey` (`<= 100`) |
| **`AuditLogs`** | `pk` (`String`: `AUDIT#<YYYY-MM>`) | `sk` (`String`: `<invertedEpochMs>#<eventId>`) | `action` (`String`), `timestamp` (`String`) (3/5) | No | Partición mensual compartida (`AUDIT#YYYY-MM`) descendente, cronología por actor/objetivo, cronología global multi-mes vía buckets trimestrales (`GSI_GlobalChronology`) | Full-text en `reason`/`changes` sin leer página | `startKey` mensual o cursor compuesto multi-trimestre (`<= 100`) |
| **`SystemControl`** | `pk` (`String`: `CTRL#BOOTSTRAP \| CTRL#SUPERADMIN_COUNT \| CTRL#SAGA#<key> \| SESSION#<sid>`) | *Ninguna* | *Ninguna* (0/5) | `ttlEpochSec` (`Number`, **solo** en `CTRL#SAGA#*` y `SESSION#<sid>`; prohibido en `CTRL#BOOTSTRAP` y `CTRL#SUPERADMIN_COUNT`) | Lectura/actualización condicional puntual (`consistent_read: true`) + verificación explícita `expiresAtEpochSec > nowSec` en `SESSION#<sid>` | Listado masivo de sagas/sesiones (no requerido) | Lookup O(1) por PK exacto |

---

## 3. DISEÑO DEFINITIVO DE ÍNDICES Y ANÁLISIS DE DISTRIBUCIÓN (ENTREGABLE 3 — OBJETIVO 3)

| Tabla | Índice | PK Índice (Tipo) | SK Índice (Tipo) | Proyección | Riesgo de Hot Partition y Estrategia Elegida |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`Users`** | `GSI_Email` | `normalizedEmail` (`String`) | *Ninguna* | `ALL` | Alta cardinalidad por correo; cero riesgo de partición caliente. **No es `UNIQUE`.** |
| **`Users`** | `GSI_Directory` | **`directorySegment`** (`String`: `USER_SEG#0..3`) | `createdAt` (`String`) | **`SPECIFIC_ATTRIBUTES`** (11 columnas) | **Elimina constante única `'USER'`:** sharding determinista en **4 segmentos** (`sha256(uid) % 4`) con lectura paralela (`Promise.all`) y *merge* ordenado descendente. Soporta >100k usuarios con <25k/partición a baja complejidad. |
| **`Users`** | `GSI_RoleStatus` | `role` (`String`) | `accountStatus` (`String`) | `ALL` | `superadmin`/`admin` (<50 cuentas): uso frecuente con `consistent_read: true`. `athlete` (~99%): solo paginado de directorio; sin mutaciones en cada login. |
| **`UserData`** | `GSI_UserEntityDate` | `pk` (`String`) | `entityDateKey` (`String`) | `ALL` | Aislado por partición individual de cada atleta (`USER#<uid>`). |
| **`AdminInvitations`** | `GSI_InviteEmailStatus` | `emailNormalized` (`String`) | `status` (`String`) | `ALL` | Cardinalidad por correo invitado; carga despreciable. |
| **`AuditLogs`** | `GSI_AuditActor` | `actorUid` (`String`) | `timestamp` (`String`) | `ALL` | Distribuido por UID del administrador actor. |
| **`AuditLogs`** | `GSI_AuditTarget` | `targetUid` (`String`) | `timestamp` (`String`) | `ALL` | Distribuido por UID objetivo. |
| **`AuditLogs`** | `GSI_GlobalChronology` | **`auditPeriodBucket`** (`String`: `AUDIT_Q#YYYY-Q#`) | `globalChronologyKey` (`String`: `<ISO>#<eventId>`) | `ALL` | **Elimina constante eterna `'AUDIT_GLOBAL'`:** acota la partición a un **bucket trimestral** (`AUDIT_Q#2026-Q4`). Mismo trimestre = 1 query; rango multi-mes/multi-trimestre = `Promise.all` sobre los buckets cubiertos + *merge* ordenado. La tabla base conserva `pk = AUDIT#YYYY-MM` como partición mensual compartida. Capacidad prevista: 50–500 eventos admin/mes (~150–1,500/trimestre). |

---

## 4. RUNBOOK DE BOOTSTRAP OFFLINE Y APROVISIONAMIENTO (ENTREGABLE 4 — OBJETIVO 2)

1. **Quién está autorizado:** Exclusivamente el propietario de infraestructura (administrador del proyecto Zoho Catalyst). Prohibido para usuarios finales o endpoints HTTP.
2. **Autenticación del operador:** Consola de Catalyst / CLI local autenticada con credenciales administrativas OAuth de Zoho del proyecto (nunca token web público).
3. **Comprobación de estado inicial:** Lectura consistente (`consistent_read: true`) de `SystemControl` (`CTRL#BOOTSTRAP`, `CTRL#SUPERADMIN_COUNT`), `Users` (`USER#<targetUid>`) y `GSI_RoleStatus` (`role = 'superadmin'`).
4. **Preparación de `CTRL#BOOTSTRAP`:** Se inserta `{ pk: 'CTRL#BOOTSTRAP', status: 'CLAIMED', claimedByUid, operatorTicketId, claimedAt }`. **No** se usa `insertItems` condicional sobre partición vacía como lock distribuido porque Catalyst ignora la condición sin dato previo.
5. **Inicialización de `CTRL#SUPERADMIN_COUNT`:** Se inserta `{ pk: 'CTRL#SUPERADMIN_COUNT', activeSuperadminCount: 1, version: 1, updatedAt }`. (Existe además `provisionSuperadminCounterFromOperator()` para reconciliación explícita por operador.)
6. **Exclusión de segundo operador simultáneo:** Exclusión **procedimental** en ventana controlada previa al tráfico público (ausencia total de ruta HTTP pública); si un segundo operador ejecuta después, la lectura consistente de `CTRL#BOOTSTRAP` y `GSI_RoleStatus` aborta con `409 BOOTSTRAP_ALREADY_COMPLETED` / `409 SUPERADMIN_ALREADY_EXISTS`.
7. **Recuperación ante respuesta perdida:** Si la CLI falla a mitad, re-ejecutar `executeOfflineAdminBootstrap()` con **idéntico `(operatorTicketId, targetCatalystUserId)`** detecta `isSameOperatorRecovery`, completa los pasos faltantes y audita `superadmin_bootstrap_recovered_offline`. Cualquier otro ticket o usuario falla cerrado.
8. **Comprobación del resultado final:** Lectura consistente obligatoria post-escritura verificando `Users.role === 'superadmin'`, `CTRL#BOOTSTRAP.status === 'CLAIMED'`, `CTRL#SUPERADMIN_COUNT.activeSuperadminCount === 1` y `GSI_RoleStatus('superadmin','active').length === 1`.
9. **Registro en `AuditLogs`:** Inserta evento inmutable `superadmin_bootstrapped_offline` (o `superadmin_bootstrap_recovered_offline`) con `operatorTicketId`, `targetUid` y `timestamp`.

---

## 5. ESTADO DE HABILITACIÓN DE MUTACIONES ADMINISTRATIVAS (ENTREGABLE 5)

| Categoría de Operación | Estado en Despliegue Inicial Clean-Slate | Condición de Habilitación |
| :--- | :---: | :--- |
| Creación / revocación / canje de invitaciones (`athlete`, `admin`) | **HABILITADO** | N/A (single-item `AdminInvitations` + `Users` no-superadmin) |
| Suspensión / reactivación / reset password de `athlete` y `admin` | **HABILITADO** | Sincroniza `Users` (`sessionEpoch++`) + `updateUserStatus()` |
| Promoción / degradación / suspensión / baja de **`superadmin`** vía API | **DESHABILITADO POR DEFECTO (`HTTP 403 SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED`)** | Solo tras superar `INT-01` (`PASS-INTEGRATION`) en vivo demostrando atomicidad condicional de `updateItems` bajo contención real |

---

## 6. MATRIZ COMPLETA DE TRAZABILIDAD FUNCIONAL — 11 SUBCOLECCIONES (ENTREGABLE 6 — OBJETIVO 5)

| # | Subcolección Firebase | Prefijo `UserData.sk` | Servicio Catalyst | Endpoint REST | Operaciones R/W | Índice | Paginación | Validaciones de Seguridad |
| :-: | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | `biometrics` | `BIO#current` | `AthleteDataService` | `GET /athlete/workspace`, `POST /athlete/onboarding/complete` | `queryTable`, `insertBatch` | Tabla base (`pk`, `sk`) | Incluido en workspace (`<=100`) | `validateBiometricsPayload`: rangos peso `[20,350]`, altura `[90,260]`, edad `[12,120]`, grasa `[2,70]`, PAL `[1.0,2.5]` |
| **2** | `preferences` | `PREF#settings` | `AthleteDataService` | `GET /athlete/workspace`, `POST /athlete/onboarding/complete` | `queryTable`, `insertBatch` | Tabla base (`pk`, `sk`) | Incluido en workspace | `validatePreferencesPayload`: objeto válido, techo `350 KB` |
| **3** | `groceries` | `GROCERY#<id>` | `AthleteDataService` | `GET /athlete/workspace`, `PUT /athlete/groceries/sync` | `queryTable` (`GROCERY#`), `deleteBatch`, `insertBatch` (`<=25`) | Tabla base (`pk`, `sk`) | `startKey` (`<=100`) | `validateGroceryPayload` + chunking `<=25` ítems |
| **4** | `mealLogs` | `MEAL#<dateTimeIso>#<id>` | `AthleteDataService` | `POST /athlete/meals`, `GET /athlete/meals` | `insertItem`, `queryTable` (`SK BETWEEN`) | Tabla base (`pk`, `sk`) + `GSI_UserEntityDate` | `startKey` (`<=100`) | `validateMealLogPayload`: regex ISO `dateTime`, macros/kcal no negativos |
| **5** | **`workoutSessions`** | **`SET#<executedWorkoutId>#<id>`** | `AthleteDataService` | `POST /athlete/workouts/:workoutId/sets` | `fetchItem` padre + `insertItem` hijo | Tabla base (`pk`, `sk`) | Workspace / `SK BEGINS_WITH SET#<wId>` | **`isLinkedWorkoutActive`:** lectura consistente de `WORKOUT#<startedAt>#<workoutId>`; rechaza `409` si padre no existe o `status !== 'in_progress'`; peso/reps/RIR acotados |
| **6** | `cardioSessions` | `CARDIO#<dateIso>#<id>` | `AthleteDataService` | `POST /athlete/cardio`, `GET /athlete/workspace` | `insertItem`, `queryTable` | Tabla base + `GSI_UserEntityDate` | `startKey` (`<=100`) | `validateCardioPayload`: duración `[1,600]`, FC `[35,240]` |
| **7** | `notifications` | `NOTIF#<createdAtIso>#<id>` | `AthleteDataService` | `POST /athlete/notifications`, `GET /athlete/workspace` | `insertItem`, `queryTable` | Tabla base + `GSI_UserEntityDate` | `startKey` (`<=100`) | `validateNotificationPayload`: `title` (`<=200`), `message` (`<=1000`) |
| **8** | `recipes` | `RECIPE#<id>` | `AthleteDataService` | `PUT /athlete/recipes/:recipeId` | `insertItem`, `queryTable` | Tabla base (`pk`, `sk`) | `startKey` (`<=100`) | `validateRecipePayload`: ingredientes array + techo `350 KB` |
| **9** | `mealPlans` | `PLAN#<weekStartIso>` | `AthleteDataService` | `PUT /athlete/meal-plans/:weekStart` | `insertItem`, `queryTable` | Tabla base (`pk`, `sk`) | `startKey` (`<=100`) | `validateMealPlanPayload`: formato `YYYY-MM-DD`, mapa `days` + techo `350 KB` |
| **10** | `workoutRoutines` | `ROUTINE#<id>` | `AthleteDataService` | `PUT /athlete/routines/:routineId` | `insertItem`, `queryTable` | Tabla base (`pk`, `sk`) | `startKey` (`<=100`) | `validateWorkoutRoutinePayload`: techo `350 KB` (límite Catalyst `400 KB`) |
| **11** | **`executedWorkouts`** | **`WORKOUT#<startedAtIso>#<id>`** | `AthleteDataService` | `POST /athlete/workouts/start`, `POST /athlete/workouts/:workoutId/complete` | `fetchItem` previo, `insertItem`, `updateItem` condicional (`version`) | Tabla base (`pk`, `sk`) + `GSI_UserEntityDate` | `startKey` (`<=100`) | **`WORKOUT_ALREADY_EXISTS`** (`409`) si ya existe; **`assertExecutedWorkoutMutable`**: una vez `completed`/`abandoned` es **terminal inmutable**; inspección `data.update[0].status === 'Success'`; sin endpoint DELETE |

---

## 7. MATRIZ DE DISPOSICIÓN DE LAS CLOUD FUNCTIONS V2 ORIGINALES (ENTREGABLE 7 — OBJETIVO 5)

*(En `functions/src/index.ts` existen las 10 funciones administrativas troncales más 1 función de sincronización de directorio `syncCurrentUserDirectory`, totalizando las 11 exportaciones `onCall` del archivo fuente; todas quedan con destino explícito.)*

| # | Función Cloud v2 Original | Disposición | Destino Exacto en Zoho Catalyst Clean-Slate |
| :-: | :--- | :--- | :--- |
| **1** | `listAdminUsers` | **Reimplementada como endpoint** | `GET /api/v1/admin/users` (`AdminGovernanceService.listDirectoryUsers` — 4 segmentos `GSI_Directory` o `GSI_RoleStatus`) |
| **2** | `getAdminStats` | **Reimplementada como endpoint** | `GET /api/v1/admin/stats` (`AdminGovernanceService.getAdminStats` — agregación sobre segmentos `GSI_Directory`) |
| **3** | `getAdminUserDetail` | **Reimplementada como endpoint** | `GET /api/v1/admin/users/:uid` (`AdminGovernanceService.getAdminUserDetail` — `Users` + `GSI_AuditTarget`) |
| **4** | `createAdminInvitation` | **Reimplementada como endpoint** | `POST /api/v1/admin/invitations` (`AdminGovernanceService.createInvitation`) |
| **5** | `revokeAdminInvitation` | **Reimplementada como endpoint** | `POST /api/v1/admin/invitations/:inviteId/revoke` (`AdminGovernanceService.revokeInvitation` — condicional `pending -> revoked`) |
| **6** | `acceptAdminInvitation` | **Reimplementada como endpoint** | `POST /api/v1/invitations/redeem` (`AdminGovernanceService.redeemInvitation` — lock condicional + SHA-256 `timingSafeEqual`) |
| **7** | `setAdminUserRole` | **Reimplementada como endpoint (bloqueo superadmin por defecto)** | `POST /api/v1/admin/users/:uid/role` (`AdminGovernanceService.setUserRole`; mutaciones superadmin bloqueadas hasta `PASS-INTEGRATION`) |
| **8** | `setAdminUserStatus` | **Reimplementada como endpoint (bloqueo superadmin por defecto)** | `POST /api/v1/admin/users/:uid/status` (`AdminGovernanceService.setUserStatus`; actualiza `Users.sessionEpoch` + Catalyst `updateUserStatus()`) |
| **9** | `requestAdminPasswordReset` | **Reemplazada por funcionalidad diferente (+ endpoint puente)** | Delegado a Catalyst Auth (`forgotPassword` / `UserManagement.resetPassword()` + `@zcatalyst/mail`) y auditable vía `POST /api/v1/admin/users/:uid/password-reset` |
| **10** | `getAdminAuditLogs` | **Reimplementada como endpoint** | `GET /api/v1/admin/audit-logs` (`AdminGovernanceService.listAuditLogs` — `AUDIT#YYYY-MM` o `GSI_GlobalChronology` trimestral) |
| **11** | `syncCurrentUserDirectory` *(exportada adicionalmente en `functions/src/index.ts`)* | **Ya no necesaria** | Eliminada al fusionar perfil y directorio en `Users` creado en `POST /api/v1/auth/session/bootstrap-profile` |
