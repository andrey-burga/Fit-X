# VIGORCORE — ENTREGABLE 2: INVENTARIO FUNCIONAL COMPLETO BASADO EN CÓDIGO FUENTE

Este inventario mapea al 100% las colecciones, listeners, escrituras, servicios, vistas, funciones Cloud y reglas de seguridad extraídas directamente del código fuente actual (`src/`, `functions/`, `firestore.rules`, `scripts/`).

---

## 1. SUBCOLECCIONES DE USUARIO EN FIRESTORE (`users/{uid}/...`)

Documento raíz: **`users/{uid}`** (`UserProfile` en `src/types/auth.ts`: `uid`, `name`, `email`, `role` informativo UI, `goal`, `location`, `onboardingCompleted`, `onboardingStep`, `createdAt`, `updatedAt`).

| # | Subcolección Firestore | Patrón de ID | Operaciones en `AppContext.tsx` | Reglas en `firestore.rules` |
| :-: | :--- | :--- | :--- | :--- |
| **1** | `biometrics` | Singleton `current` | `onSnapshot`, `setDoc` (directo y en `completeOnboarding`) | `isValidBiometrics`: rango peso/altura/edad/grasa/PAL/delta kcal/proteína/grasa |
| **2** | `preferences` | Singleton `settings` | `onSnapshot`, `setDoc` (`notificationPreferences`, `mealPartition`, `athletePreferences`) | `isValidPreferences` |
| **3** | `groceries` | `{groceryId}` | `onSnapshot`, `writeBatch` en `syncMealPlanToGroceries`, `updateDoc` (toggle), `deleteDoc` | `isValidGrocery` |
| **4** | `mealLogs` | `{mealLogId}` | `onSnapshot`, `addDoc`, `updateDoc`, `deleteDoc` | `isValidMealLog` (regex `dateTime`, macros `>= 0`) |
| **5** | `workoutSessions` | `{sessionId}` | `onSnapshot`, `setDoc`/`addDoc`, `updateDoc`, `deleteDoc`, cola offline `workoutSyncQueue.ts` | `isValidWorkoutSession` + **`isLinkedWorkoutActive`**: exige `executedWorkoutId` existente en estado `'in_progress'`; bloquea update/delete si padre no está `'in_progress'` |
| **6** | `cardioSessions` | `{cardioId}` | `onSnapshot`, `addDoc`, `deleteDoc` | `isValidCardioSession` |
| **7** | `notifications` | `{notificationId}` | `onSnapshot`, `addDoc`, `updateDoc` (read), `deleteDoc` | `isValidNotification` |
| **8** | `recipes` | `{recipeId}` | `onSnapshot`, `addDoc`, `updateDoc` (propaga en memoria a `mealPlans`), `deleteDoc` | `isValidRecipe` |
| **9** | `mealPlans` | `plan_{YYYY-MM-DD}` | `onSnapshot`, `setDoc` (mapa semanal `days`) | `isValidMealPlan` |
| **10** | `workoutRoutines` | `{routineId}` | `onSnapshot`, `setDoc`/`addDoc`, `updateDoc`, `deleteDoc` (incluye `MesocycleRoutine`) | `isValidWorkoutRoutine` |
| **11** | `executedWorkouts` | `{workoutId}` | `onSnapshot`, `setDoc`, `updateDoc` (`in_progress -> completed/abandoned`) | `isValidExecutedWorkout`; **terminal inmutable** una vez `'completed'` o `'abandoned'`; **`allow delete: if false`** |

---

## 2. ESTRUCTURAS ADMINISTRATIVAS RAÍZ (`functions/` + `firestore.rules`)

Escritura desde cliente **completamente prohibida** (`allow write: if false`). Lectura restringida por RBAC servidor:

| # | Colección Raíz | Propósito en Producción Actual | Operaciones Backend (`functions/src/adminLogic.ts`) |
| :-: | :--- | :--- | :--- |
| **1** | `adminRoleState/{uid}` | Fuente autoritativa anti-stale-token (`role`, `roleVersion`, `updatedAt`) | Lectura en cada llamada admin (`authGuard.ts`) y actualización transaccional en `setAdminUserRole` / `acceptAdminInvitation` |
| **2** | `adminUserDirectory/{uid}` | Directorio searchable y paginado para el panel admin | Sincronizado por `syncUserToDirectory`, actualizado al cambiar rol/estado |
| **3** | `adminInvitations/{inviteId}` | Invitaciones con hash SHA-256 (`tokenHash`), expiración 7d y bloqueo (`redeeming`) | `createAdminInvitation`, `revokeAdminInvitation`, `acceptAdminInvitation` |
| **4** | `accountAccess/{uid}` | Control de suspensión y revocación (`status`, `validAfter` epoch seg) | `setAdminUserStatus` + verificación en `firestore.rules` (`isAccountActive()`) |
| **5** | `adminAuditLogs/{eventId}` | Bitácora inmutable *append-only* de eventos de seguridad | Escritura exclusiva servidor en acciones administrativas y bootstrap |
| **6** | `adminInvitationOperations/{opId}` | Máquina de estados Saga para canje de invitaciones (`reserved -> ... -> completed`) | Garantiza idempotencia y recuperación en `acceptAdminInvitation` |

---

## 3. SERVICIOS FRONTEND (`src/services/`) — LÓGICA PURA PORTABLE AL 100%

Los 11 servicios de cálculo y dominio son agnósticos del motor de base de datos y se reutilizan directamente en Catalyst:

1. `nutritionMath.ts`: Cálculo BMR/TDEE, metas de macros y calorías.
2. `nutritionalPeriodizationService.ts`: Periodización nutricional adaptativa.
3. `groceryAggregation.ts`: Agregación de ingredientes del menú semanal hacia `groceries`.
4. `mesocycleGeneratorService.ts`: Generación de mesociclos multi-semana (`MesocycleRoutine`).
5. `workoutAnalyticsService.ts`: Analítica ACWR, volumen semanal y carga neuromuscular.
6. `workoutAutoregulationService.ts`: Autorregulación por RIR/fatiga.
7. `workoutExportService.ts`: Exportación local JSON/CSV de entrenamientos.
8. `unitConversion.ts`: Conversión canónica `kg/lb` y `cm/ft-in`.
9. `dateUtils.ts`: Utilidades de fechas y semanas ISO.
10. `workoutSyncQueue.ts`: Cola offline en `localStorage` aislada por `uid` con cuarentena de huérfanos (`ORPHAN_QUARANTINE_KEY`) — en Catalyst apuntará al endpoint `POST /api/v1/athlete/workouts/:id/sets`.
11. `adminUserService.ts`: Cliente RPC hacia Cloud Functions — en Catalyst apuntará a los endpoints REST `/api/v1/admin/*` y `/api/v1/invitations/*`.

---

## 4. VISTAS (`src/views/` — 18 VISTAS) Y CLOUD FUNCTIONS (`functions/src/index.ts` — 10 ENDPOINTS)

- **Vistas Públicas / Autenticación / Onboarding (3):** `LoginView`, `AcceptInvitationView`, `OnboardingView`.
- **Vistas Nutrición (6):** `NutritionalDashboardView`, `NutritionalConfigView`, `WeeklyMenuView`, `MealLogView`, `DailyLogView`, `ShoppingListView`, `SubstitutionsView`.
- **Vistas Entrenamiento y Perfil (8):** `WorkoutRoutineView`, `WorkoutLogView`, `CardioHiitView`, `TrainingProgressView`, `MesocyclePlanningView`, `AthleteProfileView`, `GuideSettingsView`.
- **Vistas Administración (1):** `AdminUsersView` (protegida por rol `admin`/`superadmin`).
- **Cloud Functions v2 (10):** `listAdminUsers`, `getAdminStats`, `getAdminUserDetail`, `createAdminInvitation`, `revokeAdminInvitation`, `acceptAdminInvitation`, `setAdminUserRole`, `setAdminUserStatus`, `requestAdminPasswordReset`, `syncCurrentUserDirectory`, `getAdminAuditLogs` + CLI `scripts/bootstrap_superadmin.ts`.
