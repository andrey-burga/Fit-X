# Phase 5.7 — Backend Functional Completion & API Contract Verification

**Project:** VigorCore (`Project-Rainfall` · `136967000000014024`)  
**Target Environment:** Zoho Catalyst **Development** (`vigor_api` · `136967000000074001`)  
**Production Environment Status:** UNTOUCHED (zero Production changes or deployments)  
**Scope:** Strictly confined to `poc/catalyst-clean-slate/` (root `src/`, Firebase, Firestore rules, and frozen `.zip` deployment archives untouched)

---

## 1. Executive Summary

Phase 5.7 completes the functional coverage and API contract parity of the Zoho Catalyst Clean Slate backend (`poc/catalyst-clean-slate/`) without altering Zoho Catalyst schema locks (5 frozen NoSQL tables, 8 GSIs), security invariants, or Production.

All 12 previously missing collection/detail/delete endpoints required by the VigorCore application — plus domain computation alignment (server-side Mifflin-St Jeor & Diophantine 4/4/9 macro synthesis, offline workout set replay idempotency, warmup exclusion from volume/1RM, single active workout enforcement, partial grocery editing, multi-batch completed grocery cleanup, `avatarUrl` validation, and admin invitation/directory listing) — are implemented, compiled, and locally verified (`LOCAL_VERIFIED`) across **53/53 canonical routes**.

---

## 2. `BACKEND_IMPLEMENTATION_MATRIX`

Verification honesty strictly separates remote live evidence from local test execution:

- **`LIVE_VERIFIED` (unchanged from Phase 5.3):**
  - `GET /health` -> HTTP `200 OK`
  - `GET /api/v1/health` -> HTTP `200 OK`
  - Anonymous `GET /api/v1/athlete/workspace` -> HTTP `401 UNAUTHENTICATED`
- **`LOCAL_VERIFIED` (Loopback Express + NoSQL mock / unit verification in Phase 5.7):**

| Domain | Method & Path | Route ID | Auth / CSRF Policy | Status |
|---|---|---|---|---|
| Health | `GET /health`, `GET /api/v1/health` | Express health | Public / config-only | `LIVE_VERIFIED` |
| Auth | `POST /api/v1/auth/session/bootstrap-profile` | `auth.session.bootstrapProfile` | `catalyst_exchange` / `pre_session_catalyst_exchange` | `LOCAL_VERIFIED` |
| Auth | `POST /api/v1/auth/session/exchange` | `auth.session.exchange` | `catalyst_exchange` / `pre_session_catalyst_exchange` | `LOCAL_VERIFIED` |
| Auth | `POST /api/v1/auth/session/refresh` | `auth.session.refresh` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Auth | `POST /api/v1/auth/session/logout` | `auth.session.logout` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Auth | `POST /api/v1/auth/session/revoke` | `auth.session.revoke` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Auth | `GET /api/v1/auth/me` | `auth.me` | `catalyst_or_hmac_inspect` / none | `LOCAL_VERIFIED` |
| Athlete Workspace | `GET /api/v1/athlete/workspace` | `athlete.workspace.get` | `hmac_session` (anonymous rejected `LIVE_VERIFIED`) | `LOCAL_VERIFIED` (`anon 401 LIVE_VERIFIED`) |
| Profile / Biometrics / Prefs | `PATCH /api/v1/athlete/profile` | `athlete.profile.update` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Onboarding | `POST /api/v1/athlete/onboarding/complete` | `athlete.onboarding.complete` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Biometrics | `PUT /api/v1/athlete/biometrics` | `athlete.biometrics.put` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Preferences | `PUT /api/v1/athlete/preferences` | `athlete.preferences.put` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Meals | `GET /api/v1/athlete/meals` | `athlete.meals.list` | `hmac_session` / none | `LOCAL_VERIFIED` |
| Meals | `POST /api/v1/athlete/meals` | `athlete.meals.create` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Meals | `DELETE /api/v1/athlete/meals/:mealId` | `athlete.meals.delete` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Recipes **(NEW)** | `GET /api/v1/athlete/recipes` | `athlete.recipes.list` | `hmac_session` / none | `LOCAL_VERIFIED` |
| Recipes | `PUT /api/v1/athlete/recipes/:recipeId` | `athlete.recipes.put` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Recipes | `DELETE /api/v1/athlete/recipes/:recipeId` | `athlete.recipes.delete` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Meal Plans **(NEW)** | `GET /api/v1/athlete/meal-plans` | `athlete.mealPlans.list` | `hmac_session` / none | `LOCAL_VERIFIED` |
| Meal Plans | `PUT /api/v1/athlete/meal-plans/:weekStart` | `athlete.mealPlans.put` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Groceries **(NEW)** | `GET /api/v1/athlete/groceries` | `athlete.groceries.list` | `hmac_session` / none | `LOCAL_VERIFIED` |
| Groceries | `PUT /api/v1/athlete/groceries/sync` | `athlete.groceries.sync` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Groceries | `POST /api/v1/athlete/groceries` | `athlete.groceries.createManual` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Groceries | `PATCH /api/v1/athlete/groceries/:groceryId` | `athlete.groceries.patch` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Groceries **(NEW)** | `DELETE /api/v1/athlete/groceries/completed` | `athlete.groceries.clearCompleted` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Groceries | `DELETE /api/v1/athlete/groceries/:groceryId` | `athlete.groceries.delete` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Routines **(NEW)** | `GET /api/v1/athlete/routines` | `athlete.routines.list` | `hmac_session` / none | `LOCAL_VERIFIED` |
| Routines | `PUT /api/v1/athlete/routines/:routineId` | `athlete.routines.put` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Routines | `POST /api/v1/athlete/routines/:routineId/default` | `athlete.routines.setDefault` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Routines **(NEW)** | `DELETE /api/v1/athlete/routines/:routineId` | `athlete.routines.delete` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Workouts **(NEW)** | `GET /api/v1/athlete/workouts` | `athlete.workouts.list` | `hmac_session` / none | `LOCAL_VERIFIED` |
| Workouts **(NEW)** | `GET /api/v1/athlete/workouts/:workoutId` | `athlete.workouts.getDetail` | `hmac_session` / none | `LOCAL_VERIFIED` |
| Workouts | `POST /api/v1/athlete/workouts/start` | `athlete.workouts.start` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Workouts | `POST /api/v1/athlete/workouts/:workoutId/sets` | `athlete.workouts.logSet` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Workouts | `POST /api/v1/athlete/workouts/:workoutId/complete` | `athlete.workouts.complete` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Cardio **(NEW)** | `GET /api/v1/athlete/cardio` | `athlete.cardio.list` | `hmac_session` / none | `LOCAL_VERIFIED` |
| Cardio | `POST /api/v1/athlete/cardio` | `athlete.cardio.create` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Cardio | `DELETE /api/v1/athlete/cardio/:cardioId` | `athlete.cardio.delete` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Notifications **(NEW)** | `GET /api/v1/athlete/notifications` | `athlete.notifications.list` | `hmac_session` / none | `LOCAL_VERIFIED` |
| Notifications | `POST /api/v1/athlete/notifications` | `athlete.notifications.create` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Notifications | `PATCH /api/v1/athlete/notifications/:notificationId/read` | `athlete.notifications.markRead` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Notifications | `POST /api/v1/athlete/notifications/read-all` | `athlete.notifications.markAllRead` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Notifications **(NEW)** | `DELETE /api/v1/athlete/notifications/:notificationId` | `athlete.notifications.delete` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Invitations | `POST /api/v1/invitations/redeem` | `invitations.redeem` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Admin Directory | `GET /api/v1/admin/users` | `admin.users.list` | `hmac_session` (admin/superadmin) | `LOCAL_VERIFIED` |
| Admin Stats | `GET /api/v1/admin/stats` | `admin.stats.get` | `hmac_session` (admin/superadmin) | `LOCAL_VERIFIED` |
| Admin User Detail | `GET /api/v1/admin/users/:uid` | `admin.users.getDetail` | `hmac_session` (admin/superadmin) | `LOCAL_VERIFIED` |
| Admin Invitations **(NEW)** | `GET /api/v1/admin/invitations` | `admin.invitations.list` | `hmac_session` (admin/superadmin) | `LOCAL_VERIFIED` |
| Admin Invitations | `POST /api/v1/admin/invitations` | `admin.invitations.create` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Admin Invitations | `POST /api/v1/admin/invitations/:inviteId/revoke` | `admin.invitations.revoke` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Admin Users | `POST /api/v1/admin/users/:uid/status` | `admin.users.setStatus` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Admin Users | `POST /api/v1/admin/users/:uid/role` | `admin.users.setRole` | `hmac_session` (superadmin_verified_only) / `signed_session_bound` | `LOCAL_VERIFIED` |
| Admin Users | `POST /api/v1/admin/users/:uid/password-reset` | `admin.users.passwordReset` | `hmac_session` / `signed_session_bound` | `LOCAL_VERIFIED` |
| Admin Audit | `GET /api/v1/admin/audit-logs` | `admin.auditLogs.list` | `hmac_session` (admin/superadmin) | `LOCAL_VERIFIED` |

---

## 3. `DATA_MODEL_COVERAGE_MATRIX`

| Table | Physical Keys | GSIs Used | Entities / Sub-domains Covered | TTL Policy |
|---|---|---|---|---|
| `Users` | `pk = USER#<uid>` | `GSI_NormalizedEmail`, `GSI_RoleStatus`, `GSI_Directory` | User account, `role`, `roleVersion`, `sessionEpoch`, `accountStatus`, `emailVerified`, `avatarUrl`, `location`, `goal`, `onboardingCompleted` | None (permanent) |
| `UserData` | `pk = USER#<uid>`, `sk = <TYPE>#...` | `GSI_UserEntityDate` (active in meals/workouts/cardio/notifications date queries) | All 11 athlete entities: `BIOMETRICS`, `PREFERENCES`, `MEAL_LOG`, `RECIPE`, `MEAL_PLAN`, `GROCERY`, `WORKOUT_ROUTINE`, `EXECUTED_WORKOUT`, `WORKOUT_SET`, `CARDIO_SESSION`, `NOTIFICATION` | None (permanent user data) |
| `AdminInvitations` | `pk = INVITE#<inviteId>` | `GSI_InviteEmailStatus` (active in filtered `listInvitations(email)` and create duplicate check) | Invitation status (`pending`/`redeeming`/`redeemed`/`revoked`/`expired`), SHA-256 `tokenHash`, `targetRole`, `expiresAt` | Conditional (`ttlEpochSec` on terminal records) |
| `AuditLogs` | `pk = AUDIT#<YYYY-MM>`, `sk = <ts>#<eventId>` | `GSI_AuditTarget`, `GSI_GlobalChronology` (quarterly buckets + invitation chronology hydration) | Immutable security/admin audit entries including `invitation_created` hydration metadata | None (permanent) |
| `SystemControl` | `pk = CTRL#...` | None (PK lookup) | `SESSION#<sid>`, `BOOTSTRAP_LOCK`, `SUPERADMIN_COUNT`, `SAGA#...`, `ENV#CONFIG` | Conditional (`ttlEpochSec` on sessions & sagas) |

---

## 4. `FRONTEND_BACKEND_CONTRACT_MATRIX`

| Domain Area | Ownership / Calculation Strategy | Backend Endpoints & Validation |
|---|---|---|
| Energy & Macros (BMR/TDEE/4-4-9) | **Backend-authoritative calculation** (+ matching client preview) | `PUT /biometrics`, `POST /onboarding/complete` apply Mifflin-St Jeor + Diophantine 4/4/9 adjustment (`protein*4 + carbs*4 + fat*9 === targetCalories`) when client omits explicit targets |
| Meal Logging & Nutrition Summaries | **Persisted user input** + client daily rollup / backend date-range query | `POST /meals` accepts `title`/`calories`/`fats` aliases into `name`/`kcal`/`fat`; `GET /meals` queries `GSI_UserEntityDate` |
| Recipes & Weekly Meal Plans | **Persisted user input** (static food catalog remains client-side) | `GET/PUT/DELETE /recipes`, `GET/PUT /meal-plans` preserve `createdAt`, increment `version`, enforce `<350KB` safe limit |
| Groceries & Pantry Sync | **Persisted user input** + multi-batch <=25 orchestration | `GET /groceries`, `PUT /groceries/sync` (<=25 items/call), `POST /groceries`, `PATCH /groceries/:groceryId` (status `'pending'\|'bought'\|'in_pantry'\|'completed'` + partial edits), `DELETE /groceries/completed` (batch <=25 cleanup) |
| Training Routines & Mesocycles | **Persisted user input** + **Client-side domain calculation** for weekly volume/RIR generation | `GET/PUT/DELETE /routines`, `POST /routines/:routineId/default` clear previous default flag cleanly |
| Executed Workouts & Sets | **Backend-authoritative calculation** & concurrency lock | `GET /workouts`, `GET /workouts/:workoutId`, `POST /workouts/start` (`409 ACTIVE_WORKOUT_ALREADY_OPEN`), `POST /workouts/:workoutId/sets` (offline replay idempotency + Epley 1RM, warmup excluded), `POST /workouts/:workoutId/complete` (`404 WORKOUT_NOT_FOUND` + warmup-excluding totals) |
| Strength Progress / ACWR / Biomechanics | **Client-side domain calculation** from persisted `executedWorkouts` & `workoutSets` | Supplied via `GET /workspace`, `GET /workouts`, and `GET /workouts/:workoutId` |
| Cardio & Zone-2 Logs | **Persisted user input** | `POST /cardio` accepts `avgHr`/`maxHr` aliases; `GET /cardio` supports `GSI_UserEntityDate` date range; `DELETE /cardio/:cardioId` |
| Notifications | **Persisted user input** + `unreadOnly` filter | `GET /notifications`, `POST /notifications`, `PATCH /:id/read`, `POST /read-all`, `DELETE /:id` |
| Admin Governance & Invitations | **Backend-authoritative state & RBAC** | `GET /admin/stats` (`pendingInvitations`, `pendingVerificationUsers`, `recentSignups30d`), `GET /admin/users` (pre-slice search, `emailVerified`, sorting), `GET /admin/invitations`, `POST /admin/invitations`, `POST /admin/invitations/:inviteId/revoke`, `POST /invitations/redeem` |
| Offline-only / Browser Notification API | **Not required by current backend** (client browser capability) | Web Push / Notification API remains client UX enhancement; persisted in-app notifications backed in `UserData` |

---

## 5. Authentication & Security Assessment

- All routes fail closed behind `CleanSlateAuthGuard` + `HttpSecurityPolicy`:
  - Session tokens: HMAC-SHA256 `__Host-vigor_session` (`HttpOnly; Secure; SameSite=Lax; Path=/`), 12h sliding / 24h ceiling, `SystemControl SESSION#<sid>` revocation state, `Users.sessionEpoch` replay protection, mandatory `>= 15m` Catalyst live status revalidation.
  - Mutations: Dual CSRF protection (`Origin` + Fetch Metadata `Sec-Fetch-Site` + HMAC-bound `X-Vigor-CSRF` bound to `(sub, sid, epoch)`).
  - Anti-IDOR: Athlete endpoints partition unconditionally by `actor.catalystUserId` (`USER#<uid>`). New `GET /workouts/:workoutId` and all new `GET`/`DELETE` handlers resolve solely within the authenticated athlete's partition (404 cross-tenant).
  - Anti-spoofing: `assertNoIdentitySpoofing` protects all non-admin routes while allowing new benign query parameters (`status`, `startDate`, `endDate`, `unreadOnly`, `limit`, `startKey`, etc.).
  - Privilege safety: `GET /api/v1/admin/invitations` enforces `invitations:list` permission (`admin` | `superadmin`), never returns `tokenHash`, and `admin.users.list` validates filter parameters fail-closed (`400 INVALID_QUERY_PARAMETER`).
  - Documented nuance on invitation redemption: `redeemInvitation` increments `Users.roleVersion` without bumping `sessionEpoch`, allowing an active session to stay valid while `CleanSlateAuthGuard` reads authoritative `Users.role` (`consistent_read: true`) on every authenticated request; explicit session exchange refreshes the client badge state cleanly.

---

## 6. Remaining Infrastructure Prerequisites & Gaps

1. **Deployment prerequisite:** Build & upload a newly authorized `vigor_api` package to Development when the user explicitly authorizes remote deployment (existing Phase 5.3 archives in `artifacts/` were preserved untouched).
2. **Pre-existing artifact & historical Phase 5.3 snapshot checks:** `poc/catalyst-clean-slate/artifacts/vigor_api/` does not include compiled `dist/` or `node_modules/` in this repository checkout (4 baseline assertions in `tests/26`, `tests/27`, `tests/30`), and preserving the frozen Phase 5.3 `.zip` archives byte-for-byte after rebuilding Phase 5.7 `dist/` intentionally causes 3 historical archive-vs-`dist/` parity assertions (`tests/37`, `tests/38`, `tests/39`) to report expected delta until a new Phase 5.7 package is authorized.
3. **Auth bridge follow-up (outside Phase 5.7 scope):** Root frontend integration against Catalyst Development awaits live authenticated-user session exchange verification (`INT-01..INT-08`) and API Gateway / custom domain onboarding when authorized.
4. **Future Frontend Integration Notes:**
   - Wire main `src/` athlete/admin views to `CatalystHttpAthleteRepository` / `CatalystHttpAdminRepository` (`53`-route contract) once live authentication exchange is verified.
   - Surface partial-batch sync recovery UX (`PartialBatchSyncError` / `resumeGrocerySyncBatch`) when syncing >25 grocery items.
   - Update admin invitation dashboard to consume `GET /api/v1/admin/invitations` filters (`status`, `email`, `startKey`) directly.
