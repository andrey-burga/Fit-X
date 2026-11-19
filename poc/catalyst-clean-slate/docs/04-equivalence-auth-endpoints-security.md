# VIGORCORE — ENTREGABLES 6, 7, 8 Y 9: EQUIVALENCIA FUNCIONAL, AUTENTICACIÓN, ENDPOINTS Y SEGURIDAD

> **ACTUALIZACIÓN FASE 4.0.1 (DEFINITIVA):** Los flujos de bootstrap público, auto-alta silenciosa, `attribute_not_exists` en `insertItems` y `validAfterSec` de esta sección inicial quedaron corregidos y sustituidos en **`docs/06-adversarial-audit-4.0.1.md`** (bootstrap offline obligatorio, denegación por defecto `403 USER_PROFILE_NOT_REGISTERED` + `/auth/session/bootstrap-profile`, revocación por `updateUserStatus(DISABLE)` + `sessionEpoch`, y bloqueo por defecto de mutaciones automáticas de superadmin).

---

## 1. ENTREGABLE 6: MATRIZ DE EQUIVALENCIA FUNCIONAL FIREBASE -> ZOHO CATALYST

| Capacidad VigorCore | Implementación Actual (Firebase) | Equivalente Clean-Slate (Zoho Catalyst) | Cambio de Flujo / Contrato |
| :--- | :--- | :--- | :--- |
| **Autenticación Email / Google** | `firebase/auth` (`signInWithEmailAndPassword`, `signInWithPopup`) | **Catalyst Authentication** via `catalystWebSDK.js` + `/__catalyst/sdk/init.js` (cookies HTTP de primera parte en mismo origen Slate) | Registro limpio; sin mapeo de UIDs históricos |
| **Verificación de Correo** | `sendEmailVerification()` + `emailVerified` gate | Catalyst Auth confirmation link + `is_confirmed === true` verificado en servidor | Bloqueo `403 EMAIL_VERIFICATION_REQUIRED` en `CleanSlateAuthGuard` |
| **Recuperación de Clave** | `sendPasswordResetEmail()` / Admin `generatePasswordResetLink()` | `catalyst.auth.forgotPassword()` / `UserManagement.resetPassword()` | Gestionado nativamente por Catalyst Auth + `@zcatalyst/mail` |
| **Roles y Claims** | Custom Claims `{ role, roleVersion }` en JWT Firebase | Campo autoritativo `role` + `roleVersion` en tabla `Users` leído en servidor vía `zcAuth.init(req)` -> `user_id` | Sin latencia de propagación ni dependencia de refresco de JWT cliente |
| **Hidratación Tiempo Real (`AppContext.tsx`)** | 11 listeners `onSnapshot` directos desde navegador | `GET /api/v1/athlete/workspace` (1 consulta particionada `pk=USER#<id>`) + estado optimista + revalidación por evento/foco | Eliminación total de SDK de base de datos en el navegador |
| **Operaciones por Lote (`writeBatch`)** | `completeOnboarding` y `syncMealPlanToGroceries` (hasta 500 ops) | Advanced I/O endpoints con *chunking* automático en lotes de `<= 25` ítems en `UserData` + actualización final en `Users` | Validación en servidor antes de persistir |
| **Cola Offline (`workoutSyncQueue.ts`)** | Sube series pendientes a Firestore cuando vuelve la red | Misma cola aislada en `localStorage` por `uid`, enviando `POST /api/v1/athlete/workouts/:id/sets` | Conserva cuarentena de huérfanos y guardas multi-tenant |
| **Funciones Administrativas (`functions/`)** | 10 Firebase Cloud Functions `onCall` | 10+ rutas REST en **Catalyst Advanced I/O Functions** con `@zcatalyst/auth` y `@zcatalyst/nosql` | Misma `PERMISSION_MATRIX`, auditoría inmutable y protección superadmin |

---

## 2. ENTREGABLE 7: PLAN DE SUSTITUCIÓN DE FIREBASE AUTHENTICATION

### A. Flujo de Registro e Inicio de Sesión Limpio
1. El usuario se registra o autentica con Google/Correo en **Zoho Catalyst Authentication** desde el frontend alojado en Slate.
2. En cada solicitud hacia Advanced I/O Functions, el navegador envía la cookie de sesión administrada por Catalyst (sin exponer secretos ni tokens manipulables).
3. El backend ejecuta `zcAuth.init(req)` y `userManagement.getCurrentUser()` (`@zcatalyst/auth`) obteniendo `user_id`, `email_id`, `status`, `is_confirmed`.
4. **Asociación directa sin puente:** En el primer login autenticado y confirmado (`is_confirmed === true`), `CleanSlateAuthGuard.authenticate()` auto-provisiona de forma atómica (`attribute_not_exists(pk)`) el registro en la tabla `Users` con `pk = USER#<user_id>`, `role = 'athlete'`, `roleVersion = 1`, `accountStatus = 'active'`. **No se busca ni vincula ningún registro previo por correo.**

### B. Bootstrap Seguro del Primer Superadministrador (Base Vacía)
Con la base limpia, el primer superadministrador se inicializa una única vez mediante `AdminGovernanceService.bootstrapFirstSuperadmin()`:
1. El operador registra su cuenta normal en Catalyst Auth y confirma su correo electrónico (`is_confirmed === true`).
2. Se ejecuta la rutina controlada de bootstrap (CLI/endpoint protegido con frase secreta de entorno `SUPERADMIN_BOOTSTRAP_CONFIRM_PHRASE`).
3. El sistema inserta condicionalmente `CTRL#BOOTSTRAP / SINGLETON` (`attribute_not_exists(pk)`): **garantía criptográfica-lógica de ejecución única**. Cualquier segundo intento devuelve `409 BOOTSTRAP_ALREADY_COMPLETED`.
4. Inicializa `CTRL#SUPERADMIN_COUNT / SINGLETON` con `activeSuperadminCount: 1`, eleva el registro del operador a `role: 'superadmin'`, `roleVersion: 2`, y escribe el evento `superadmin_bootstrapped` en `AuditLogs`.

### C. Conservación del Último Superadministrador y Ciclo de Vida de Sesiones
- **Último Superadministrador:** Toda degradación (`setUserRole` saliendo de `'superadmin'`) o suspensión (`setUserStatus(..., 'suspended')`) sobre un superadmin activo ejecuta una actualización condicional en `SystemControl` (`pk = CTRL#SUPERADMIN_COUNT`, condición `activeSuperadminCount > 1`, decremento `-1`). Si el conteo es `1`, Catalyst NoSQL rechaza la mutación (`409 LAST_SUPERADMIN_PROTECTED`).
- **Revocación Inmediata (`validAfterSec`):** Al suspender una cuenta, `Users.validAfterSec` se actualiza a `nowSec + 1` y se puede invocar `UserManagement.updateUserStatus(..., DISABLED)`. `CleanSlateAuthGuard` rechaza toda sesión emitida antes de `validAfterSec` (`401 SESSION_REVOKED_REAUTH_REQUIRED`).

---

## 3. ENTREGABLE 8: DISEÑO DE ENDPOINTS BACKEND (CATALYST ADVANCED I/O FUNCTIONS)

Implementación de referencia verificada en `poc/catalyst-clean-slate/src/routes/apiRouterSchema.ts`:

| Método | Ruta REST | Auth / Rol | Reemplaza | Garantía Clave |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/auth/me` | Sesión activa | `onAuthStateChanged` + Claims | Auto-alta limpia `athlete`, retorna `roleVersion` |
| `GET` | `/api/v1/athlete/workspace` | Sesión activa | 11 `onSnapshot` en `AppContext` | Lectura única particionada `USER#<id>` |
| `PATCH` | `/api/v1/athlete/profile` | Sesión activa | `updateDoc(users/{uid})` | Bloquea mutación de `role`, `email`, `validAfterSec` |
| `POST` | `/api/v1/athlete/onboarding/complete` | Sesión activa | `writeBatch completeOnboarding` | Valida biometría + preferencias y cierra onboarding |
| `POST` | `/api/v1/athlete/meals` | Sesión activa | `addDoc(mealLogs)` | Clave `MEAL#<dateTime>#<id>` bajo PK del actor |
| `GET` | `/api/v1/athlete/meals` | Sesión activa | Filtro `mealLogs` por fecha | `query(pk, sk BETWEEN)` sin escaneo |
| `PUT` | `/api/v1/athlete/groceries/sync` | Sesión activa | `writeBatch syncMealPlanToGroceries` | Fragmentado en lotes `<= 25` ítems |
| `POST` | `/api/v1/athlete/workouts/start` | Sesión activa | `setDoc(executedWorkouts)` | Crea sesión en `status = 'in_progress'` |
| `POST` | `/api/v1/athlete/workouts/:id/sets` | Sesión activa | `isLinkedWorkoutActive` + `workoutSessions` | Verifica padre existente y `in_progress` |
| `POST` | `/api/v1/athlete/workouts/:id/complete` | Sesión activa | Cierre `executedWorkouts` | Bloqueo optimista `version`; transición terminal inmutable |
| `PUT` | `/api/v1/athlete/recipes/:id` | Sesión activa | `recipes` | Guardián de tamaño `< 350 KB` |
| `PUT` | `/api/v1/athlete/meal-plans/:week` | Sesión activa | `mealPlans` | Guardián de tamaño `< 350 KB` |
| `PUT` | `/api/v1/athlete/routines/:id` | Sesión activa | `workoutRoutines` | Guardián de tamaño `< 350 KB` |
| `POST` | `/api/v1/invitations/redeem` | Sesión activa | `acceptAdminInvitation` | Bloqueo `pending -> redeeming` + SHA-256 `timingSafeEqual` |
| `GET` | `/api/v1/admin/users` | `admin \| superadmin` | `listAdminUsers` | Usa `GSI_Directory` / `GSI_RoleStatus` |
| `POST` | `/api/v1/admin/invitations` | `admin \| superadmin` | `createAdminInvitation` | `admin` solo invita `athlete`; `superadmin` invita `admin` |
| `POST` | `/api/v1/admin/users/:uid/status` | `admin \| superadmin` | `setAdminUserStatus` | Impide auto-suspensión y suspensión de `superadmin` por `admin` |
| `POST` | `/api/v1/admin/users/:uid/role` | `superadmin` | `setAdminUserRole` | Incrementa `roleVersion` + protege último superadmin |
| `GET` | `/api/v1/admin/audit-logs` | `admin \| superadmin` | `getAdminAuditLogs` | Consulta mensual o por `GSI_AuditActor` / `GSI_AuditTarget` |
| `POST` | `/api/v1/admin/bootstrap-superadmin` | Operador + lock único | `bootstrap_superadmin.ts` | Ejecutable exactamente 1 vez en toda la vida del sistema |

---

## 4. ENTREGABLE 9: ANÁLISIS DE SEGURIDAD, ANTI-IDOR Y REEMPLAZO DE `firestore.rules`

1. **Cero Acceso Directo del Navegador a NoSQL:** El navegador no tiene SDK ni credenciales de base de datos. Todas las reglas de `firestore.rules` residen ahora en `src/validators/domainValidators.ts` y `src/auth/cleanSlateAuthGuard.ts`.
2. **Defensa Anti-IDOR Estricta (`assertNoIdentitySpoofing`):** Cualquier cabecera (`x-user-id`, `x-role`, `x-auth-uid`, `x-actor-*`), parámetro query o atributo JSON (`uid`, `userId`, `pk`, `sourceUid`, `catalystUserId`, `role`) enviado en endpoints de atleta es rechazado inmediatamente con `403 IDENTITY_SPOOFING_REJECTED`.
3. **Invariantes Stateful Migrados desde `firestore.rules`:**
   - **Regla de Serie Activa (`isLinkedWorkoutActive`):** `AthleteDataService.logWorkoutSet()` lee fuertemente el documento padre `WORKOUT#<startedAt>#<executedWorkoutId>` dentro de la misma partición `USER#<actor.catalystUserId>` y aborta con `409 PARENT_WORKOUT_NOT_ACTIVE` si no existe o si su estado ya es `'completed'` o `'abandoned'`.
   - **Inmutabilidad Terminal y No Borrado:** No existen endpoints `DELETE` para perfiles `Users`, cabeceras `executedWorkouts` ni `AuditLogs`. Una vez cerrado un entrenamiento (`completed` o `abandoned`), `assertExecutedWorkoutMutable()` rechaza cualquier modificación posterior.
   - **Inmutabilidad de Campos Privilegiados:** `validateProfileSelfUpdate()` bloquea con `403 IMMUTABLE_SECURITY_FIELD` cualquier intento de enviar `role`, `roleVersion`, `accountStatus`, `validAfterSec` o `emailVerified` al actualizar el perfil.
