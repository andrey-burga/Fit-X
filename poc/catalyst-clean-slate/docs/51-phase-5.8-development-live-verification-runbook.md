# Phase 5.8 — Development Live Verification Runbook (`Project-Rainfall` / `vigor_api`)

> **MANDATORY ENVIRONMENT GUARDRAILS:**
> - **Exclusive Target:** Zoho Catalyst `Project-Rainfall` (`136967000000014024`) -> **`Development` ONLY**.
> - **Function Target:** `vigor_api` (`136967000000074001`, Stack: `node22`, URL: `https://project-rainfall-943998020.development.catalystserverless.com/server/vigor_api`).
> - **Production Environment:** **COMPLETELY OUT OF SCOPE.** Never upload, promote, migrate, enable API Gateway, change DNS, modify CORS, or touch Production in this workflow.
> - **Secret Hygiene:** Never print or commit `VIGOR_SESSION_HMAC_SECRET`, `__Host-vigor_session`, `csrfToken`, `x-zc-*` tokens, or passwords to terminal logs, files, or screenshots.

---

## 1. Pre-Upload Verification Checklist (Local Artifact Integrity)

Before any operator-authorized upload to Development, verify the exact Phase 5.8 candidate archive:

1. **Candidate File:** `poc/catalyst-clean-slate/artifacts/vigor_api-phase-5.8-development-candidate.zip`
2. **Expected Size:** `1,288,500` bytes (`905` entries, `3,826,002` bytes uncompressed)
3. **Expected SHA-256:** `75db5ec6a516f6d5b349b80bf97ec443a798cf3b68cdc17a661d3e648e1d8354`
4. **Verify Locally:**
   - PowerShell 5.1: `(Get-FileHash .\poc\catalyst-clean-slate\artifacts\vigor_api-phase-5.8-development-candidate.zip -Algorithm SHA256).Hash.ToLowerInvariant()`
   - Linux/macOS: `sha256sum poc/catalyst-clean-slate/artifacts/vigor_api-phase-5.8-development-candidate.zip`
5. **Confirm Historical Rollback Archive Is Intact:** `vigor_api-hosted-admin-remediated-portable.zip` (`6b64d440aafbfc7c6e19ea4f5a8617b84056fc7f2494307e6685e04b76de618f`).

---

## 2. Operator Development Upload Procedure (Executed Only Upon Explicit Operator Action)

> **Status Note:** Zero uploads were performed in Phase 5.8 (`READY_FOR_DEVELOPMENT_OPERATOR_REVIEW`). Perform this section only when an authorized Development operator triggers upload.

1. Open **Zoho Catalyst Console** -> **`Project-Rainfall`** -> **`Development`** -> **Serverless** -> **Functions** -> **`vigor_api`** (`136967000000074001`).
2. Confirm existing `Development` environment variables remain intact (especially `VIGOR_CATALYST_AUTH_MODE=hosted_native`, `VIGOR_CORS_MODE=platform_managed`, `VIGOR_ALLOWED_ORIGINS`, `VIGOR_SESSION_HMAC_SECRET`, `VIGOR_SESSION_ACTIVE_KID`, and keep `VIGOR_ALLOW_SUPERADMIN_MUTATIONS` unset/`false` and `VIGOR_ALLOW_RESET_WITHOUT_INT08` unset/`false`).
3. Upload **`vigor_api-phase-5.8-development-candidate.zip`** as the new code bundle for `vigor_api` in **`Development`** (never Production) without altering ZIP internal layout (`dist/server/catalystEntry.js` at archive root).
4. Wait for Catalyst build/activation status = `Active` on Node.js 22 (`node22`).

---

## 3. Verification Channel Taxonomy (Strict Separation)

Do **not** conflate unauthenticated CLI checks with browser-origin cookie flows:

| Channel | What It Can Verify Live | What It CANNOT Verify Without Further Topology |
| :--- | :--- | :--- |
| **A. Anonymous HTTP CLI (`PowerShell` / `curl`)** | `/health`, `/api/v1/health` (`routeCount: 53`), anonymous `401 UNAUTHENTICATED`, spoof/admin header safety (`0` false `403`s), CSRF/origin blocks on unauthenticated mutations | Cannot verify authenticated user identity, HMAC cookie persistence in browsers, or real NoSQL reads/writes |
| **B. Authenticated Browser Session (Same-Origin / Custom Domain Dependency)** | Catalyst Hosted Login (`/auth/login` -> `/auth/callback`), `POST /bootstrap-profile`, `POST /exchange`, `__Host-vigor_session; SameSite=Strict`, `GET /workspace`, all 53 routes with `X-Vigor-CSRF`, `/refresh`, `/logout`, `/revoke` | Blocked across cross-site `app.vigorcore.lat` -> `*.catalystserverless.com` (`SameSite=Strict` + `Sec-Fetch-Site: cross-site`) unless API Gateway + `api.vigorcore.lat` or a same-origin proxy on `app.vigorcore.lat` is enabled (`INT-01..INT-08`) |
| **C. Test Admin User (`Users.role = admin`)** | Admin directory, user stats, user detail, invitation listing/creation/revocation, status toggles, audit logs; confirms athlete receives `403`, superadmin mutations stay locked (`false`), reset stays `INT-08`-gated | Cannot elevate to `superadmin` without explicit Development operator fixture in NoSQL; `allowSuperadminMutations` remains `false` |
| **D. Remote Catalyst NoSQL Persistence** | Cross-request durability across `Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`, and all 8 GSIs (`GSI_UserEntityDate`, `GSI_InviteEmailStatus`, etc.) | Requires successful Channel B / Channel C writes against live Development |

---

## 4. Phase-by-Phase Live Development Execution Runbook

### Stage 4A — Anonymous HTTP CLI Smoke (`Channel A` · Safe Immediately After Upload)

```powershell
$DevBase = 'https://project-rainfall-943998020.development.catalystserverless.com/server/vigor_api'

# 1. Health & 53-route contract check
$h1 = Invoke-RestMethod -Method GET -Uri "$DevBase/health"
$h2 = Invoke-RestMethod -Method GET -Uri "$DevBase/api/v1/health"
# Assert: status = 'ok', routeCount = 53, environment = 'development'
Write-Output ("HEALTH_1={0}/{1} HEALTH_2={2}/{3}" -f $h1.status, $h1.routeCount, $h2.status, $h2.routeCount)

# 2. Anonymous rejection parity across private athlete & admin endpoints (Expect 401 UNAUTHENTICATED)
foreach ($p in @('/api/v1/auth/me', '/api/v1/athlete/workspace', '/api/v1/athlete/workouts', '/api/v1/admin/users', '/api/v1/admin/invitations')) {
  try {
    Invoke-RestMethod -Method GET -Uri "$DevBase$p" -ErrorAction Stop
    throw "UNEXPECTED_200:$p"
  } catch [System.Net.WebException] {
    $code = [int]([System.Net.HttpWebResponse]$_.Exception.Response).StatusCode
    Write-Output ("ANON {0} => HTTP {1}" -f $p, $code) # Expect 401
  }
}
```

### Stage 4B — Same-Origin / Custom-Domain Prerequisite Before Browser Authentication

Before executing authenticated browser flows from `https://app.vigorcore.lat`:
1. Confirm **Architecture A** (`https://api.vigorcore.lat` via API Gateway + CloudScale Custom Domain Mapping) or **Architecture B** (same-origin `/server/vigor_api/*` or `/api/*` reverse proxy under `https://app.vigorcore.lat`) is configured in Development.
2. Verify whether Catalyst Edge / API Gateway forwards browser `Authorization` (`zcAuth.generateAuthToken('functions')`) or project-user cookies (`JWT_AUTH`, `user_cred`, `ZD_CSRF_TOKEN`) into `x-zc-user-cred-token` / `x-zc-cookie` (`x-zc-user-type` != `'admin'`). If `POST /api/v1/auth/session/exchange` returns `401 UNAUTHENTICATED`, stop and inspect API Gateway auth-mode wiring (`INT-01..INT-08`).

### Stage 4C — Authenticated Browser Athlete End-to-End Verification (`Channel B` + `Channel D`)

Execute using a provisioned non-privileged `Development` test user (`Public Signup = Disabled`):
1. **Hosted Login & Bootstrap / Exchange:**
   - Navigate `/auth/login` -> Catalyst Hosted Sign-In -> `/auth/callback`.
   - Call `POST /api/v1/auth/session/exchange`; on first login (`403 USER_PROFILE_NOT_REGISTERED`), submit explicit `POST /api/v1/auth/session/bootstrap-profile` (`role: 'athlete'`).
   - Verify `Set-Cookie: __Host-vigor_session=...; HttpOnly; Secure; SameSite=Strict; Path=/` (no `Domain=`) and RAM `csrfToken`.
2. **Workspace & Profile Hydration:**
   - `GET /api/v1/auth/me` -> verify `actor` + rotated/bound `csrfToken`.
   - `GET /api/v1/athlete/workspace` -> verify complete hydrated payload (`profile`, `biometrics`, `preferences`, `meals`, `recipes`, `mealPlans`, `groceries`, `routines`, `executedWorkouts`, `workoutSets`, `cardioSessions`, `notifications`).
3. **CSRF Guard & Domain Mutations (Pass bound `X-Vigor-CSRF`):**
   - Negative check: send `PATCH /api/v1/athlete/profile` without `X-Vigor-CSRF` -> expect `403 CSRF_TOKEN_MISSING`.
   - Positive writes & reads across all athlete sub-domains:
     - Profile / onboarding / biometrics / preferences (`PATCH /profile`, `POST /onboarding/complete`, `PUT /biometrics`, `PUT /preferences`) -> verify server-synthesized BMR/TDEE & 4/4/9 macro targets.
     - Nutrition (`POST /meals`, `GET /meals?startDate=...&endDate=...`, `DELETE /meals/:mealId`, `PUT/GET/DELETE /recipes`, `PUT/GET /meal-plans`).
     - Groceries (`POST /groceries`, `PUT /groceries/sync`, `PATCH /groceries/:groceryId`, `GET /groceries?status=...`, `DELETE /groceries/completed`, `DELETE /groceries/:groceryId`).
     - Training & Concurrency (`PUT/GET/POST default/DELETE /routines`, `POST /workouts/start` -> retry `POST /workouts/start` while active expecting `409 ACTIVE_WORKOUT_ALREADY_OPEN`, `POST /workouts/:id/sets` with duplicate client set replay verifying idempotent `200`, `POST /workouts/:id/complete` verifying warmup exclusion, `GET /workouts`, `GET /workouts/:id`).
     - Cardio & Notifications (`POST/GET/DELETE /cardio`, `POST/GET/PATCH read/POST read-all/DELETE /notifications`).
4. **Remote Persistence Cross-Check (`Channel D`):**
   - Reload session or call `GET /api/v1/athlete/workspace` cleanly in a fresh request and confirm all committed `UserData` mutations and `Users` metadata match persisted Catalyst NoSQL tables (`Users`, `UserData`, `SystemControl`, `AuditLogs`, `AdminInvitations`).
5. **Session Lifecycle (`refresh`, `logout`, `revoke`):**
   - Call `POST /api/v1/auth/session/refresh` with current bound CSRF -> confirm new `sid` + new `__Host-vigor_session` + new `csrfToken`; replay old cookie after >5s grace expecting `401 SESSION_REPLAY_DETECTED` and epoch bump (`re-auth`).
   - Establish new session, verify `POST /api/v1/auth/session/logout` clears cookie (`Max-Age=0`) and subsequent `GET /api/v1/auth/me` fails `401 SESSION_REVOKED_REAUTH_REQUIRED`.
   - Verify `POST /api/v1/auth/session/revoke` (`scope: 'individual'` and `scope: 'all'`) invalidates active sessions immediately.

### Stage 4D — Admin RBAC, Invitations & Fail-Closed Gates (`Channel C` + `Channel D`)

1. Confirm athlete token receives `403` on `GET /api/v1/admin/users`, `GET /api/v1/admin/stats`, `GET /api/v1/admin/invitations`, `GET /api/v1/admin/audit-logs`.
2. Sign in as designated `Development` test admin (`Users.role = 'admin'`):
   - Verify `GET /api/v1/admin/stats`, `GET /api/v1/admin/users` (filters/sorting), `GET /api/v1/admin/users/:uid`, `GET /api/v1/admin/audit-logs`.
   - Create invitation `POST /api/v1/admin/invitations`, verify `GET /api/v1/admin/invitations` (confirm `tokenHash` is NEVER exposed), revoke invitation `POST /api/v1/admin/invitations/:inviteId/revoke`, and test valid `POST /api/v1/invitations/redeem` (single-use atomic lock + replay `409`).
   - Verify `POST /api/v1/admin/users/:uid/status` toggles cleanly while superadmin role change (`POST /api/v1/admin/users/:uid/role`) remains fail-closed (`403`) and password reset (`POST /api/v1/admin/users/:uid/password-reset`) remains gated behind `INT-08`.

---

## 5. Rollback Procedure (Development ONLY)

If any regression, unexpected runtime error, or authentication failure is observed after operator-authorized Development upload of `vigor_api-phase-5.8-development-candidate.zip`:

1. Do **NOT** modify NoSQL schemas, GSIs, or Production.
2. In **Zoho Catalyst Console -> `Project-Rainfall` -> `Development` -> `Functions` -> `vigor_api`**, re-upload the untouched rollback baseline:
   - **Rollback Archive:** `poc/catalyst-clean-slate/artifacts/vigor_api-hosted-admin-remediated-portable.zip`
   - **Verified SHA-256:** `6b64d440aafbfc7c6e19ea4f5a8617b84056fc7f2494307e6685e04b76de618f`
   - **Verified Size:** `1,281,449` bytes
3. Confirm `GET /health` returns HTTP `200 OK` (`routeCount: 41`) and anonymous `GET /api/v1/athlete/workspace` returns HTTP `401 UNAUTHENTICATED`.
4. Capture non-secret Catalyst Application Log metadata (`statusCode`, `error`, `event`, sanitized timestamps) for offline analysis.
