# VIGORCORE — PHASE 5.4: LIVE AUTHENTICATED USER & HMAC SESSION VERIFICATION (`Development`)

- **Project:** `Fit-X` *(work strictly isolated inside `poc/catalyst-clean-slate/`)*
- **Catalyst Project:** `Project-Rainfall` (`136967000000014024` · DC `US`: `https://api.catalyst.zoho.com` · `https://accounts.zoho.com`)
- **Environment Scope:** **`Development` ONLY** *(`Production` untouched and strictly out of scope)*
- **Function:** `vigor_api` (`136967000000074001` · Advanced I/O · Node.js 22 · `VIGOR_CATALYST_AUTH_MODE=hosted_native` · `VIGOR_CORS_MODE=platform_managed` · API Gateway disabled)
- **Live Function Base URL (`Development`):** `https://project-rainfall-943998020.development.catalystserverless.com/server/vigor_api`
- **Remote Operations Executed in This Task:** **`0`**
- **Final Status:** **`PHASE_5_4_AUTHENTICATED_USER_VERIFICATION_READY_FOR_OPERATOR_TEST`**

---

## 0. VERIFICATION TAXONOMY (STRICT NON-INFERENCE)

Every claim in this document is explicitly classified so local simulation is never misrepresented as live Catalyst verification:

| Scope Tag | Meaning | What Applies Today |
| :--- | :--- | :--- |
| **`LIVE_VERIFIED`** | Directly observed by the operator against live `Project-Rainfall` (`Development`) `vigor_api` | `GET /health` -> HTTP `200` (`service=vigorcore-advanced-io`, `routeCount=41`, `status=ok`); `GET /api/v1/health` -> HTTP `200`; anonymous `GET /api/v1/athlete/workspace` -> HTTP `401 UNAUTHENTICATED` (previous `CATALYST_ADMIN_HEADER_SPOOFED` false-positive resolved). |
| **`LOCAL_VERIFIED`** | Directly verified against actual source code, TypeScript/Vite builds, unit tests, and `127.0.0.1:0` loopback Express + mock Catalyst BaaS / NoSQL suites (`tests/01`–`tests/40`) | Complete 11-step lifecycle simulation, HMAC-SHA256 & claim verification, `Users` / `SystemControl` `consistent_read: true`, CSRF binding `(sub, sid, ep)`, refresh rotation & replay bump, `>= 15 min` live revalidation fail-closed behavior, `hosted_native` `x-zc-user-type=admin` guarantees, and zero secret leaks. |
| **`READY_FOR_LIVE_TEST`** | Pre-audited against deployed source contracts and packaged into a reproducible Windows PowerShell 5.1 / browser DevTools operator runbook; awaits operator execution in `Development` | Live authenticated invited `Development` user login, `/bootstrap-profile`, `/exchange`, `__Host-vigor_session` issuance & transport, `X-Vigor-CSRF` mutations, `/refresh`, `/logout`, and post-logout fail-closed rejection against real Catalyst `Development`. |

---

## 1. COMPLETE FRONTEND-TO-BACKEND AUTHENTICATION LIFECYCLE AUDIT (STEPS 1–11)

Audit grounded directly in `poc/catalyst-clean-slate/src/` and `node_modules/@zcatalyst/auth@1.0.0`:

| Step | Stage | Source File(s) & Exact Symbols | Verified Behavior / Policy | Live Integration Status |
| :---: | :--- | :--- | :--- | :--- |
| **1** | **`/auth/login` initiator route** | `src/frontend/adapters/CatalystHostedAuthBridge.ts:28,38,202-231` (`DEFAULT_POST_LOGOUT_PATH = '/auth/login'`, `NATIVE_HOSTED_AUTH_PROFILE`, `startHostedLogin()`) | Intended SPA entry and post-logout destination (`signOut('/auth/login')`). Rejects iframe execution (`window.self !== window.top` -> `403 HOSTED_LOGIN_IFRAME_FORBIDDEN`, matching Catalyst `iFrame: Disabled`). **Gap:** Not yet wired to a URL router or UI login component in `CleanSlateApp.tsx` or `frontend/main.tsx`. | `LOCAL_VERIFIED` (bridge unit); UI route **GAP** (`Section 4`) |
| **2** | **`zcAuth.hostedSignIn('/auth/callback')`** | `node_modules/@zcatalyst/auth/dist-es/web.js:121-126`; `CatalystHostedAuthBridge.ts:89-174,213-230` (`resolveSafeSameOriginRedirect`, `startHostedLogin`) | `resolveSafeSameOriginRedirect` rejects protocol-relative `//`, CRLF/null/backslash, HTTP non-loopback, and cross-origin URLs (`OPEN_REDIRECT_BLOCKED`). `startHostedLogin()` rejects `/auth/login` as callback (`INVALID_HOSTED_CALLBACK_PATH`), calls `sdk.init()` (`GET /__catalyst/sdk/init`), then `zcAuth.hostedSignIn('/auth/callback')` sets top-level `window.location.href = '/__catalyst/auth/login?redirect_url=%2Fauth%2Fcallback'`. | `LOCAL_VERIFIED` (SDK inspection + unit tests) |
| **3** | **`/auth/callback` route handling** | `CatalystHostedAuthBridge.ts:27,39,233-302` (`DEFAULT_HOSTED_LOGIN_CALLBACK_PATH = '/auth/callback'`, `establishVigorSession()`) | Calls `sdk.init()`, then `sdk.isUserAuthenticated()` (`GET /baas/v1/project/{id}/project-user/current`). Rejects `false` (`401 CATALYST_USER_NOT_AUTHENTICATED`), `is_confirmed === false` (`403 EMAIL_VERIFICATION_REQUIRED`), or `status !== 'ACTIVE'` (`403 CATALYST_ACCOUNT_NOT_ACTIVE`). Calls `sdk.generateAuthToken('functions')`, keeps `access_token` solely in local RAM variable `ephemeralFunctionsToken`, clears it in `finally`, and never persists tokens to `localStorage`/`sessionStorage`/`IndexedDB`. **Gap:** No React route handler mounts `/auth/callback` today. | `LOCAL_VERIFIED` (bridge unit + loopback); UI route & Slate SPA fallback **GAP / `READY_FOR_LIVE_TEST`** |
| **4** | **Catalyst hosted-native current-user resolution** | `src/sdk/catalystSdkBridge.ts:575-607,1552-1699` (`extractCatalystUserCredentialsFromHeaders`, `HostedNativeCatalystAuthRuntime.hasRequestCatalystUserCredential`, `getCurrentUserFromRequest`) | (1) Validates incoming `x-zc-projectid`, `x-zc-project-key`, and `x-zc-environment` against server-pinned env config (`403 PROJECT_CONTEXT_MISMATCH`). (2) If `x-zc-user-type` is `'admin'` (case-insensitive), immediately returns `null` (0 BaaS calls, even if `x-zc-user-cred-token` contains Catalyst's nonempty opaque platform token). (3) Otherwise extracts `x-zc-user-cred-token` or sanitized `x-zc-cookie` (`JWT_AUTH`, `user_cred`, `_iam[ab]dt*`, `_zohoportal_*`, optional paired `ZD_CSRF_TOKEN`, stripping `__Host-vigor_session`, console cookies, `stratus_jwt`). (4) Initializes per-request `new ZCAuth().init({ headers: sanitizedUserHeaders }, { type: 'advancedio', scope: 'user' })` with pinned `apiDomain`/`authPortalDomain`/`projectKey` and invokes `new UserManagement(userApp).getCurrentUser()`. **Note:** Does NOT parse HTTP `Authorization` directly (`Section 4`, Gap 2). | `LOCAL_VERIFIED` (`tests/36`, `tests/39`, `tests/40`); anonymous path **`LIVE_VERIFIED`** (`401`); real authenticated end-user **`READY_FOR_LIVE_TEST`** |
| **5** | **First authenticated API request** | `src/frontend/adapters/CatalystHttpAuthRepository.ts:67-142` (`bootstrapProfile`, `exchangeSession`); `src/frontend/adapters/httpTransport.ts:89-92,254-265,344-415` | Sends `POST /api/v1/auth/session/exchange` (existing `Users` record) or `POST /api/v1/auth/session/bootstrap-profile` (first login) with `credentials: 'include'`, `preSessionExchange: true`, `X-Vigor-Requested-With: VigorCore-CleanSlate`, `Content-Type: application/json`, plus pre-session Catalyst credentials. `WorkspaceContext.tsx:183-189` calls `authRepository.getMe()` then `athleteRepo.hydrateWorkspace()` (`GET /api/v1/athlete/workspace`) once session exists. | `LOCAL_VERIFIED`; live end-to-end browser topology subject to **`Section 4`** Gaps |
| **6** | **Catalyst identity validation** | `src/auth/cleanSlateAuthGuard.ts:680-745,798-859` (`assertNoIdentitySpoofing`, `assertValidCatalystSnapshot`, `resolveVerifiedCatalystIdentity`) | Rejects spoofed identity headers/query/body (`uid`, `userId`, `role`, `sessionEpoch`, `roleVersion`, `accountStatus`, `x-user-*`, `x-role-*`, `x-vigor-session-*` -> `403 IDENTITY_SPOOFING_REJECTED`). Requires non-empty `user_id` (`401 UNAUTHENTICATED`), `status.toUpperCase() === 'ACTIVE'` (`403 CATALYST_USER_DISABLED`), `is_confirmed === true` (`403 EMAIL_VERIFICATION_REQUIRED`), and valid `@` `email_id` (`403 MISSING_EMAIL`). | `LOCAL_VERIFIED` |
| **7** | **`Users` bootstrap registration vs exchange** | `src/auth/cleanSlateAuthGuard.ts:1025-1054,1611-1730` (`authenticate` Path 1 `'catalyst_exchange'`, `bootstrapAuthenticatedProfile`) | **`/exchange`** requires an existing `Users` item (`pk = USER#<catalystUserId>`, `consistent_read: true`); rejects absent row with `403 USER_PROFILE_NOT_REGISTERED` (deny-by-default, zero silent auto-registration on normal routes) and inactive account with `403 ACCOUNT_SUSPENDED`. **`/bootstrap-profile`** checks `Users` (`consistent_read: true`) + `Users.GSI_Email` (`consistent_read: true`, rejects cross-UID collision `409 DUPLICATE_EMAIL_ANOMALY`), and inserts `Users` with hardcoded least privilege `role: 'athlete'`, `roleVersion: 1`, `sessionEpoch: 1`, `accountStatus: 'active'`, `emailVerified: true`, `authProvider: 'catalyst_auth'`. | `LOCAL_VERIFIED`; **`READY_FOR_LIVE_TEST`** |
| **8** | **HMAC session issuance** | `src/auth/cleanSlateAuthGuard.ts:264-308,1273-1374` (`issueTokenWithClaims`, `issueSignedSession`); `src/routes/apiRouterSchema.ts:190-251` | Mints HMAC-SHA256 token `{ v: 1, kid, iss: 'vigorcore-auth', aud: 'vigorcore-api', env, sub, ep, sid: 16B hex, iat, exp = iat + min(12h, remaining24h) }`, persists `SystemControl` `pk = SESSION#<sid>` with conditional `attribute_not_exists(pk)` (and `consistent_read: true` timeout recovery) **before** setting `Set-Cookie`, and returns `csrfToken` bound to `(sub, sid, ep)`. | `LOCAL_VERIFIED`; **`READY_FOR_LIVE_TEST`** |
| **9** | **`__Host-vigor_session` cookie & browser acceptance** | `src/auth/cleanSlateAuthGuard.ts:306-308` (`buildHttpOnlySetCookieHeader`); `src/server/advancedIoApp.ts:283-285`; `src/security/httpSecurityPolicy.ts:281-304,347-432` (`assertStrictCookieAttributes`, `evaluateBrowserCookieCompatibility`) | Every issued/cleared cookie passes `assertStrictCookieAttributes`: exact `__Host-vigor_session=...`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, **no `Domain=`**. Browsers accept and resend it with `credentials: 'include'` on **same-origin** or **same-site HTTPS** (`app.vigorcore.lat` <-> `api.vigorcore.lat`). **Critical:** Because API Gateway & Domain Mapping are currently disabled, the raw Function URL (`*.development.catalystserverless.com`) is **cross-site** to `app.vigorcore.lat` (`SameSite=Strict` blocks browser cookie transmission across sites). | `LOCAL_VERIFIED` (Chromium E2E same-origin localhost `tests/14`); cross-site browser note in **`Section 4`** |
| **10** | **CSRF token lifecycle** | `src/security/httpSecurityPolicy.ts:167-275`; `src/auth/cleanSlateAuthGuard.ts:314-355,474-528`; `src/routes/apiRouterSchema.ts:134-161`; `src/frontend/adapters/httpTransport.ts:35-54,254-286,388-414` | **Pre-session (`/bootstrap-profile`, `/exchange`):** `pre_session_catalyst_exchange` checks `Sec-Fetch-Site !== 'cross-site'`, allowlisted `Origin` (`VIGOR_ALLOWED_ORIGINS`), and `X-Vigor-Requested-With: VigorCore-CleanSlate`. **Post-session mutations:** `signed_session_bound` requires server-issued HMAC-SHA256 `X-Vigor-CSRF` (`typ: 'csrf'`, verified in `verifyCsrfToken` against `actor.catalystUserId`, `actor.sessionId`, `actor.sessionEpoch`). Stored strictly in RAM by `ServerCsrfTokenProvider`, rotated on `/refresh`, re-issued on `GET /api/v1/auth/me`, and cleared on `/logout` or session-invalidating `401`. | `LOCAL_VERIFIED`; **`READY_FOR_LIVE_TEST`** |
| **11** | **Refresh / rotation, individual revocation & logout** | `src/auth/cleanSlateAuthGuard.ts:1376-1606`; `src/routes/apiRouterSchema.ts:254-332` | **`/refresh`:** `apiRouterSchema.ts:256-265` validates active HMAC session + bound `X-Vigor-CSRF` **before** revoking old `sid` or calling Catalyst `getUserDetails`; checks 24h `absoluteExpiresAtEpochSec`; atomically revokes `SESSION#<oldSid>` (`session_rotated`, `rotatedAtEpochSec`), issues new `SESSION#<newSid>` + cookie + `csrfToken`. Replay of old cookie `<= 5s` -> `401 SESSION_ROTATED_RETRY`; `> 5s` -> `401 SESSION_REPLAY_DETECTED`, clears cookie, bumps `Users.sessionEpoch++`. **`/logout`:** verifies HMAC + bound CSRF (`skipCatalystLiveRevalidation: true`), marks `SESSION#<sid>` `revoked` (`user_logout`) before returning `Max-Age=0` clear cookie. **`/revoke`:** `scope: 'individual'` revokes target `sid`; `scope: 'all'` bumps `Users.sessionEpoch++` globally. | `LOCAL_VERIFIED`; **`READY_FOR_LIVE_TEST`** |

---

## 2. INVITATION & HOSTED CALLBACK FLOW VERIFICATION (`Development` · `Public Signup: Disabled`)

### 2.1 Official Route Separation (Applied in Catalyst Console & SDK Bridge)
1. **Initiator / Post-Logout Route:** `/auth/login` -> calls `CatalystHostedAuthBridge.startHostedLogin('/auth/callback')` -> invokes `zcAuth.hostedSignIn('/auth/callback')`, which redirects top-level to Catalyst's reserved platform URL `/__catalyst/auth/login?redirect_url=%2Fauth%2Fcallback`.
2. **Post-Login Callback Route:** `/auth/callback` -> **sole** permitted `redirect_url` target (`CatalystHostedAuthBridge.ts:219-226` rejects `/auth/login` as a callback target).
3. **Public Signup Posture (`Disabled`):** Confirmed in `docs/30` & `docs/31`. Unknown third parties cannot self-register via Catalyst Hosted Login.

### 2.2 Invited Development User Password Setup & Onboarding Mechanics
- **`POST /api/v1/admin/invitations` (`src/services/adminGovernanceService.ts:590-637`):** Creates a hashed (`sha256Hex(rawToken)`) record in `AdminInvitations` (`status: 'pending'`, 7-day `expiresAtEpochSec`), **and does NOT call `UserManagementAdmin.registerUser()`**.
- **Consequence for `Development` Phase 5.4 Testing:** With `Public Signup = Disabled`, the single least-privilege Development test user MUST be added administratively via **Catalyst Console -> `Development` -> `Authentication` -> `Users` -> `Add User`** (Alternative A, `docs/30` §4.2), which triggers Catalyst's native activation email for the user to confirm email (`is_confirmed: true`) and set their password (`status: 'ACTIVE'`).
- *(Optional Role Promotion Test Only — NOT needed for standard `athlete` verification):* If also testing `POST /api/v1/invitations/redeem` (`adminGovernanceService.ts:680-768`), the backend uses conditional lock `pending -> redeeming`, checks `expiresAtEpochSec > nowSec` (`409 INVITATION_EXPIRED`), exact `invite.emailNormalized === caller.normalizedEmail` (`403 INVITATION_EMAIL_MISMATCH`), and `constantTimeHexEquals(sha256(token), tokenHash)` (`403 INVITATION_TOKEN_INVALID`).

### 2.3 Fail-Closed Callback & Pre-Session Guarantees (`LOCAL_VERIFIED`)

| Failure / Edge Scenario | Enforcing Component | Observed HTTP / Error Guarantee | NoSQL Impact |
| :--- | :--- | :--- | :---: |
| User cancels at `/__catalyst/auth/login` or navigates unauthenticated to `/auth/callback` | `CatalystHostedAuthBridge.establishVigorSession` / `CleanSlateAuthGuard.authenticate` | Client: `401 CATALYST_USER_NOT_AUTHENTICATED`; Backend: `401 UNAUTHENTICATED` | **0 ops** |
| Invited user has NOT opened email link / set password (`is_confirmed: false`) | `CatalystHostedAuthBridge:246-253` & `assertValidCatalystSnapshot:823-829` | `403 EMAIL_VERIFICATION_REQUIRED` | **0 ops** |
| Account disabled in Catalyst (`status !== 'ACTIVE'`) | `CatalystHostedAuthBridge:255-261` & `assertValidCatalystSnapshot:814-821` | `403 CATALYST_USER_DISABLED` | **0 ops** |
| Authenticated Catalyst user missing from `Users` calls `/exchange` or `/auth/me` directly | `CleanSlateAuthGuard.authenticate:1033-1039,1064-1070` | `403 USER_PROFILE_NOT_REGISTERED` (no HMAC cookie minted) | `Users.fetch` only |
| Suspended `Users` account (`accountStatus === 'suspended'`) | `CleanSlateAuthGuard.authenticate:1040-1042,1149-1155` | `403 ACCOUNT_SUSPENDED` | `Users.fetch` only |
| Client attempts to supply `uid`, `role`, `sessionEpoch`, `roleVersion`, `accountStatus` in headers/query/body | `assertNoIdentitySpoofing:680-745` | `403 IDENTITY_SPOOFING_REJECTED` | **0 ops** |
| Expired invite (`<= nowSec`) or wrong email/token at `/invitations/redeem` | `AdminGovernanceService.redeemInvitation:716-732` | `409 INVITATION_EXPIRED` / `403 INVITATION_EMAIL_MISMATCH` / `403 INVITATION_TOKEN_INVALID` | Lock released; no role change |
| `bootstrapAuthenticatedProfile` role assignment | `CleanSlateAuthGuard.ts:1684-1704` | Hardcodes `role: 'athlete'`, `roleVersion: 1`, `sessionEpoch: 1`, `accountStatus: 'active'` | Least-privilege insert only |

---

## 3. COMPLETE `ROUTE_DEFINITIONS` & `CleanSlateAuthGuard` POLICY MATRIX + `hosted_native` GUARANTEES

Source of truth: `src/routes/routeContracts.ts` (`ROUTE_CONTRACT_SPECS`, 41 routes + `OPTIONS_PREFLIGHT_CONTRACT`), `src/routes/apiRouterSchema.ts` (`ROUTE_DEFINITIONS`, `CleanSlateApiDispatcher`), and `src/server/advancedIoApp.ts` (`/health`, `/api/v1/health`).

### 3.1 Auth Policy Matrix Across All Endpoints

| Endpoint(s) | Method | `authPolicy` | `csrfPolicy` | `requiresCatalystLiveCheck` | `allowedRoles` | Behavior Under `x-zc-user-type=admin` (No `__Host-vigor_session`) | Behavior With Valid `__Host-vigor_session` + `x-zc-user-type=admin` |
| :--- | :---: | :--- | :--- | :---: | :--- | :--- | :--- |
| `/health`, `/api/v1/health` | `GET` | **Unauthenticated runtime probe** | `none` | `false` | Public (`*`) | `200 OK` (`0` NoSQL, `0` BaaS, skips `wrapDispatch`) | `200 OK` (`0` NoSQL, `0` BaaS) |
| `*` (`OPTIONS_PREFLIGHT_CONTRACT`) | `OPTIONS` | `cors_preflight` | `none` | `false` | Allowlisted `Origin` only | `204` (`Origin` in `VIGOR_ALLOWED_ORIGINS`) / `403` otherwise | `204` / `403` |
| `/api/v1/auth/session/bootstrap-profile` | `POST` | `catalyst_exchange` | `pre_session_catalyst_exchange` | `false` | `athlete`, `admin`, `superadmin` | `401 UNAUTHENTICATED` (`0` NoSQL, `0` BaaS) | Uses Path 1 Catalyst verification ONLY (`401` if no Catalyst user creds!) |
| `/api/v1/auth/session/exchange` | `POST` | `catalyst_exchange` | `pre_session_catalyst_exchange` | `false` | `athlete`, `admin`, `superadmin` | `401 UNAUTHENTICATED` (`0` NoSQL, `0` BaaS) | Uses Path 1 Catalyst verification ONLY (`401` if no Catalyst user creds!) |
| `/api/v1/auth/me` | `GET` | `catalyst_or_hmac_inspect` | `none_safe_get` | `false` | `athlete`, `admin`, `superadmin` | `401 UNAUTHENTICATED` (`0` NoSQL, `0` BaaS) | **Path 3:** `200 { actor, csrfToken }` + `X-Vigor-CSRF-Token` (`0` `getCurrentUser()` BaaS calls) |
| `/api/v1/auth/session/refresh` | `POST` | `hmac_session` | `signed_session_bound` | `true` (`getUserDetails`) | `athlete`, `admin`, `superadmin` | `401 UNAUTHENTICATED` (`0` NoSQL) | **Path 3 + CSRF:** Validates bound `X-Vigor-CSRF` -> live `getUserDetails()` -> rotates `sid`, cookie & `csrfToken` |
| `/api/v1/auth/session/logout` | `POST` | `hmac_session` | `signed_session_bound` | `false` (`skipCatalystLiveRevalidation: true`) | `athlete`, `admin`, `superadmin` | `401 UNAUTHENTICATED` (`0` NoSQL) | **Path 3 + CSRF:** Revokes `SESSION#<sid>` -> `Set-Cookie: Max-Age=0` |
| `/api/v1/auth/session/revoke` | `POST` | `hmac_session` | `signed_session_bound` | `true` (`getUserDetails`) | `athlete`, `admin`, `superadmin` | `401 UNAUTHENTICATED` (`0` NoSQL) | **Path 3 + CSRF:** Revokes `sid` or `scope: 'all'` (`Users.sessionEpoch++`) |
| `/api/v1/athlete/workspace`, `/api/v1/athlete/meals` | `GET` | `hmac_session` | `none_safe_get` | `false` (+15m window check) | `athlete`, `admin`, `superadmin` | `401 UNAUTHENTICATED` (`0` NoSQL) | **Path 3:** `200` scoped strictly to `USER#<actor.catalystUserId>` |
| 22 Mutating Athlete Routes (`PATCH /profile`, `POST /onboarding/complete`, `POST/DELETE /meals*`, `PUT/DELETE /recipes*`, `PUT /meal-plans/:weekStart`, `POST/PUT/PATCH/DELETE /groceries*`, `PUT/POST /routines*`, `POST /workouts/*`, `POST/DELETE /cardio*`, `POST/PATCH /notifications*`) | `POST`/`PUT`/`PATCH`/`DELETE` | `hmac_session` | `signed_session_bound` | `false` (+15m window check) | `athlete`, `admin`, `superadmin` | `401 UNAUTHENTICATED` (`0` NoSQL) | **Path 3 + CSRF:** `X-Vigor-CSRF` bound to `(sub, sid, ep)` + strict partition ownership |
| `/api/v1/invitations/redeem` | `POST` | `hmac_session` | `signed_session_bound` | `true` (`getUserDetails`) | `athlete`, `admin`, `superadmin` | `401 UNAUTHENTICATED` (`0` NoSQL) | **Path 3 + CSRF + live check:** SHA-256 + email match + conditional lock |
| Admin Reads (`/api/v1/admin/users`, `/stats`, `/users/:uid`, `/audit-logs`) | `GET` | `hmac_session` | `none_safe_get` | `false` (+15m window check) | `admin`, `superadmin` | `401 UNAUTHENTICATED` (`0` NoSQL) | **Path 3:** `403 PERMISSION_DENIED` for `athlete`; `200` for `admin`/`superadmin` |
| Admin Invitation Mutations (`POST /admin/invitations`, `POST /admin/invitations/:inviteId/revoke`) | `POST` | `hmac_session` | `signed_session_bound` | `false` (+15m window check) | `admin`, `superadmin` | `401 UNAUTHENTICATED` (`0` NoSQL) | **Path 3 + CSRF:** `403 PERMISSION_DENIED` for `athlete` (`admin` capped at `athlete` invites) |
| High-Risk Admin Actions (`POST /admin/users/:uid/status`, `POST /admin/users/:uid/password-reset`) | `POST` | `hmac_session` | `signed_session_bound` | `true` (`getUserDetails`) | `admin`, `superadmin` | `401 UNAUTHENTICATED` (`0` NoSQL) | **Path 3 + CSRF + live check:** `/password-reset` fail-closed `INT-08` unless `VIGOR_ALLOW_RESET_WITHOUT_INT08=true`; `/status` locks superadmin targets unless verified |
| `POST /api/v1/admin/users/:uid/role` | `POST` | `hmac_session` | `signed_session_bound` | `true` (`getUserDetails`) | `superadmin` ONLY | `401 UNAUTHENTICATED` (`0` NoSQL) | **Path 3 + CSRF + live check:** `403` for `athlete`/`admin`; superadmin role changes locked until live atomicity |

### 3.2 `hosted_native` `x-zc-user-type=admin` Invariant Guarantees
Verified directly in `src/sdk/catalystSdkBridge.ts:1552-1699` and `src/auth/cleanSlateAuthGuard.ts:1026-1135`:
1. **`x-zc-user-type=admin` NEVER authenticates an end-user:** `getCurrentUserFromRequest()` returns `null` immediately without instantiating `ZCAuth(..., { scope: 'user' })` and without calling `UserManagement.getCurrentUser()`. Path 1 (`catalyst_exchange`) and Path 2 (no `__Host-vigor_session`) fail closed `401 UNAUTHENTICATED` with `0` NoSQL operations.
2. **`x-zc-user-type=admin` NEVER elevates RBAC privileges:** Roles come solely from `Users.role` (`consistent_read: true`) keyed by `USER#<sub/user_id>`.
3. **`x-zc-user-type=admin` NEVER blocks Path 3 (`__Host-vigor_session`):** `hasRequestCatalystUserCredential()` returns `false` when `x-zc-user-type=admin`, allowing Path 3 to validate the HMAC cookie, `Users`, `SystemControl`, and CSRF cleanly without false `403 CATALYST_ADMIN_HEADER_SPOOFED` errors.

---

## 4. EXPLICIT FRONTEND / BACKEND INTEGRATION GAP ANALYSIS & MINIMAL RECOMMENDATIONS

All findings below come from direct inspection of root `src/` and `poc/catalyst-clean-slate/`. **Root frontend files were NOT modified.**

1. **Gap 1 — Root App (`/src/`) Has Zero Catalyst Clean-Slate Integration:**
   - Grep across root `src/` confirms zero references to `zcAuth`, `hostedSignIn`, `/auth/login`, `/auth/callback`, `CatalystHostedAuthBridge`, or `/api/v1/auth/session/*`. All Clean-Slate code resides strictly inside `poc/catalyst-clean-slate/`.
2. **Gap 2 — POC Frontend Lacks URL Router (`/auth/login`, `/auth/callback`) & Does Not Wire `CatalystHostedAuthBridge`:**
   - `poc/catalyst-clean-slate/src/frontend/CleanSlateApp.tsx:25-66` uses state-only `activeView` switching (`WorkspaceContext.tsx:150`). `frontend/main.tsx:22-53` only enables HTTP mode under `?mode=http` (`baseUrl: window.location.origin`), otherwise boots `InMemoryCleanSlateRepository`.
   - `CatalystHostedAuthBridge.ts` is unit-tested (`tests/22`) **but never imported** by `frontend/main.tsx`, `CleanSlateApp.tsx`, or `WorkspaceContext.tsx`.
   - `WorkspaceContext.tsx:183-189` calls `authRepository.getMe()` and `hydrateWorkspace(activePersonaUid)` directly on boot; receiving `401 UNAUTHENTICATED` sets `loadStatus='error'` rather than routing to `/auth/login` or invoking `startHostedLogin('/auth/callback')`.
   - *Minimal recommendation (for dedicated UI-wiring phase, NOT applied now):* Add minimal `window.location.pathname` handling (`react-router-dom` `BrowserRouter` or thin pathname gate in `CleanSlateApp`/`main.tsx`) for `/auth/login` (button calling `bridge.startHostedLogin('/auth/callback')`) and `/auth/callback` (mounting one-shot `bridge.establishVigorSession({ mode: 'exchange' })` with explicit fallback CTA to `/bootstrap-profile` on `403 USER_PROFILE_NOT_REGISTERED` or retry on `/auth/login` upon `401`), plus Slate SPA history rewrite fallback to `index.html`.
3. **Gap 3 — Pre-Session Credential Transport Mismatch (`Authorization` Header vs Catalyst Edge `x-zc-*` Headers):**
   - `CatalystHostedAuthBridge.ts:266-288` calls `sdk.generateAuthToken('functions')` and puts the token into HTTP `Authorization`.
   - However: (a) `HostedNativeCatalystAuthRuntime.getCurrentUserFromRequest()` (`catalystSdkBridge.ts:575-607,1620`) extracts user credentials **only** from Catalyst Edge `x-zc-user-cred-token` and sanitized `x-zc-cookie` — it does **not** read `req.headers.authorization`; (b) in `express_enforced` mode, `HttpSecurityPolicy.buildCorsHeaders()` (`httpSecurityPolicy.ts:157`) currently lists `Access-Control-Allow-Headers: Content-Type, X-Vigor-CSRF, X-Vigor-Requested-With` (omitting `Authorization`).
   - With API Gateway disabled on `vigor_api` today, whether Catalyst's edge translates `Authorization` into `x-zc-user-cred-token` or requires same-origin Catalyst session cookies / API Gateway remains **`READY_FOR_LIVE_TEST` / unverified live**.
   - *Minimal recommendation:* Do **NOT** relax `HostedNativeCatalystAuthRuntime` to trust raw client `Authorization` without Catalyst Edge/Gateway verification. Instead, verify in live `Development` how `vigor_api` receives end-user identity when proxied on same-origin `/server/vigor_api/*` vs API Gateway (`CATALYST_USERS_AUTHENTICATION` vs `NO_AUTHENTICATION`), and if cross-origin preflight ever needs `Authorization`, add it explicitly only after gateway alignment.
4. **Gap 4 — Cross-Site Cookie Topology (`__Host-vigor_session` `SameSite=Strict` + Current Function URL):**
   - `VIGOR_ALLOWED_ORIGINS` in `Development` is `https://app.vigorcore.lat`, while `vigor_api` currently lives at `https://project-rainfall-943998020.development.catalystserverless.com/server/vigor_api`.
   - As enforced by `evaluateBrowserCookieCompatibility()` (`httpSecurityPolicy.ts:411-431`) and `assertCsrfAndOriginForRequest()` (`lines 180-196`), `app.vigorcore.lat` <-> `*.catalystserverless.com` is **cross-site**: browsers withhold `SameSite=Strict` cookies on cross-site `fetch()`, and `HttpSecurityPolicy` blocks `Sec-Fetch-Site: cross-site` (`403 CSRF_CROSS_SITE_REJECTED`).
   - *Minimal recommendation:* Keep `SameSite=Strict` intact (never downgrade to `SameSite=None`). When moving from operator PowerShell 5.1 verification to live browser SPA verification, deploy/map `vigor_api` via a same-site domain (`api.vigorcore.lat` under API Gateway Custom Domain Mapping, Alternative A) or same-origin proxy under `app.vigorcore.lat` (Alternative B/C).

---

## 5. HMAC PATH 3 SECURITY INVARIANTS VERIFICATION CHECKLIST

| # | Path 3 Security Invariant | Enforced Location | Verification Status |
| :---: | :--- | :--- | :---: |
| 1 | **HMAC-SHA256 verification before trusting claims** | `ServerSessionTokenManager.verifySignedCompactPayload` (`cleanSlateAuthGuard.ts:357-425`) — canonical Base64URL + 32B `crypto.timingSafeEqual` over raw digest before `JSON.parse` | **`LOCAL_VERIFIED`** (`tests/07`, `tests/13`, `tests/40`) |
| 2 | **Claim validation (`v`, `kid`, `iss`, `aud`, `env`, `iat`, `exp`, `sid`, `sub`, `ep`)** | `ServerSessionTokenManager.verifyToken` (`cleanSlateAuthGuard.ts:427-472`) — rejects csrf token reuse (`typ === 'csrf'`), cross-env tokens, clock skew `> 60s`, TTL `> 24h`, expired `exp <= nowSec` | **`LOCAL_VERIFIED`** (`tests/07`, `tests/13`, `tests/40`) |
| 3 | **`Users.sessionEpoch` validation (`consistent_read: true`)** | `CleanSlateAuthGuard.authenticate` Path 3 (`cleanSlateAuthGuard.ts:1136-1148,1200-1206`) — `claims.ep < userItem.sessionEpoch` or `sessionRec.sessionEpoch < userItem.sessionEpoch` -> `401 SESSION_REVOKED_REAUTH_REQUIRED` | **`LOCAL_VERIFIED`** (`tests/07`, `tests/39`, `tests/40`) |
| 4 | **`SystemControl` `SESSION#<sid>` (`consistent_read: true`), owner & expiry** | `CleanSlateAuthGuard.authenticate` Path 3 (`cleanSlateAuthGuard.ts:1158-1233`) — verifies `sid`, `ownerUserId === claims.sub`, `status === 'active'`, `!revokedAt`, `expiresAtEpochSec > nowSec`, `absoluteExpiresAtEpochSec > nowSec` | **`LOCAL_VERIFIED`** (`tests/07`, `tests/39`, `tests/40`) |
| 5 | **Revocation & rotated replay detection (`> 5s` grace bumps `sessionEpoch++`)** | `CleanSlateAuthGuard.authenticate` (`lines 1179-1198`) & `refreshSignedSession` (`lines 1442-1494`) — `<= 5s` returns `401 SESSION_ROTATED_RETRY`; `> 5s` returns `401 SESSION_REPLAY_DETECTED`, clears cookie, bumps `Users.sessionEpoch++` | **`LOCAL_VERIFIED`** (`tests/07`, `tests/13`, `tests/40`) |
| 6 | **`accountStatus === 'active'` enforcement** | `CleanSlateAuthGuard.authenticate` (`cleanSlateAuthGuard.ts:1149-1155`) — rejects suspended/disabled `Users` with `403 ACCOUNT_SUSPENDED` even with valid cookie | **`LOCAL_VERIFIED`** (`tests/01`, `tests/40`) |
| 7 | **Bound CSRF `(sub, sid, ep)` on all mutations** | `apiRouterSchema.ts:134-161` + `verifyCsrfToken` (`cleanSlateAuthGuard.ts:474-528`) + `HttpSecurityPolicy` — rejects missing (`403 CSRF_TOKEN_MISSING`), expired (`403 CSRF_TOKEN_EXPIRED`), or mismatched user/sid/epoch (`403 CSRF_TOKEN_SESSION_MISMATCH`) | **`LOCAL_VERIFIED`** (`tests/13`, `tests/40`) |
| 8 | **Mandatory `>= 15 min` (`900s`) Catalyst live revalidation & critical-route checks** | `CleanSlateAuthGuard.authenticate` (`lines 1235-1252`) + `enforceCatalystLiveRevalidation` (`lines 911-994`) — coalesces `getUserDetails(userId)`, fails closed `503 CATALYST_REVALIDATION_UNAVAILABLE` on BaaS error without extending window, revokes session + bumps epoch + clears cookie if user deleted/disabled | **`LOCAL_VERIFIED`** (`tests/07`, `tests/40`) |

---

## 6. OPERATOR RUNBOOK: CONTROLLED WINDOWS POWERSHELL 5.1 REAL-USER VERIFICATION (`Development` ONLY)

> **STRICT OPERATOR SAFETY RULES:**
> 1. Operate **EXCLUSIVELY** against `Project-Rainfall` (`136967000000014024`) -> **`Development`**. Do **NOT** touch `Production`, NoSQL schemas, Security Rules, API Gateway, Domain Mapping, or env vars.
> 2. Keep **`Public Signup = Disabled`**, **`Third-party Auth = Unconfigured`**, **`Social Login = Disabled`**.
> 3. **NEVER print** passwords, `JWT_AUTH`, `ZD_CSRF_TOKEN`, `x-zc-user-cred-token`, `__Host-vigor_session`, `csrfToken`, or `VIGOR_SESSION_HMAC_SECRET` to stdout, files, or screenshots. Store credentials only in RAM variables and purge them in Step K.
> 4. **Important Live Gateway Note:** Because API Gateway is disabled, `POST /bootstrap-profile` and `/exchange` require Catalyst Edge to recognize an authenticated end-user (`x-zc-user-type` != `admin` with `x-zc-user-cred-token` or Catalyst project-user cookie in `x-zc-cookie`). Step C collects a browser-authenticated Catalyst `project-rainfall-*.development.catalystserverless.com` session cookie jar or verifies at Step D whether Gateway/domain routing is needed before live exchange can complete (`READY_FOR_LIVE_TEST`).

### Base Configuration & Helper Setup (Windows PowerShell 5.1)

```powershell
# Phase 5.4 — Development Target ONLY (NEVER print secrets/tokens/cookies)
$BaseUrl       = 'https://project-rainfall-943998020.development.catalystserverless.com/server/vigor_api'
$AllowedOrigin = 'https://app.vigorcore.lat'
$VigorSession  = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$CsrfSec       = $null
$InitialSid    = $null
$RotatedSid    = $null

function Invoke-VigorJson {
    param(
        [Parameter(Mandatory=$true)][ValidateSet('GET','POST','PATCH','PUT','DELETE')][string]$Method,
        [Parameter(Mandatory=$true)][string]$Path,
        [Microsoft.PowerShell.Commands.WebRequestSession]$WebSession = $null,
        [hashtable]$ExtraHeaders = @{},
        [object]$Body = $null
    )
    $uri = "$BaseUrl$Path"
    $hdrs = @{ 'Accept' = 'application/json' }
    foreach ($k in $ExtraHeaders.Keys) { $hdrs[$k] = $ExtraHeaders[$k] }
    $params = @{
        Uri             = $uri
        Method          = $Method
        Headers         = $hdrs
        UseBasicParsing = $true
        ErrorAction     = 'Stop'
    }
    if ($null -ne $WebSession) { $params['WebSession'] = $WebSession }
    if ($null -ne $Body) {
        $hdrs['Content-Type'] = 'application/json'
        $params['Body'] = ($Body | ConvertTo-Json -Depth 5 -Compress)
    }
    try {
        $r = Invoke-WebRequest @params
        $json = $null
        if ($r.Content) { $json = $r.Content | ConvertFrom-Json }
        return [pscustomobject]@{
            StatusCode = [int]$r.StatusCode
            SetCookie  = [string]$r.Headers['Set-Cookie']
            HasCsrfHdr = [bool]$r.Headers['X-Vigor-CSRF-Token']
            CsrfHdr    = $r.Headers['X-Vigor-CSRF-Token']
            Body       = $json
        }
    }
    catch [System.Net.WebException] {
        $httpResp = [System.Net.HttpWebResponse]$_.Exception.Response
        if ($null -eq $httpResp) { throw }
        $reader = New-Object System.IO.StreamReader($httpResp.GetResponseStream())
        $rawErr = $reader.ReadToEnd()
        $reader.Dispose()
        $errJson = $null
        try { $errJson = $rawErr | ConvertFrom-Json } catch {}
        return [pscustomobject]@{
            StatusCode = [int]$httpResp.StatusCode
            SetCookie  = [string]$httpResp.Headers['Set-Cookie']
            HasCsrfHdr = $false
            CsrfHdr    = $null
            Body       = $errJson
        }
    }
}

function ConvertFrom-SecurePlain([System.Security.SecureString]$s) {
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
```

### Step A — Pre-Test Live Baseline (`GET /health`, `GET /api/v1/health`, Anonymous Fail-Closed `401`)
```powershell
$h1 = Invoke-VigorJson -Method GET -Path '/health'
$h2 = Invoke-VigorJson -Method GET -Path '/api/v1/health'
$anon = Invoke-VigorJson -Method GET -Path '/api/v1/athlete/workspace'
Write-Output ("STEP_A_HEALTH: /health={0} /api/v1/health={1} routeCount={2}" -f $h1.StatusCode, $h2.StatusCode, $h2.Body.routeCount)
Write-Output ("STEP_A_ANON: status={0} error={1}" -f $anon.StatusCode, $anon.Body.error)
# Expect: 200, 200, routeCount=41, STEP_A_ANON status=401 error=UNAUTHENTICATED
```

### Step B — Single Least-Privilege Test User Provisioning in Catalyst Console (`Development` ONLY)
1. In Zoho Catalyst Console (`Project-Rainfall` -> **`Development`** -> **Authentication**), verify **Public Signup = Disabled**, **Social Login = Disabled**, **Third-party = Set Up (unconfigured)**.
2. Open **Users** -> **Add User** and add ONE dedicated test email (least privilege; role in VigorCore will default strictly to `athlete`).
3. Have the test user open Catalyst's activation/invitation email, verify the address (`is_confirmed: true`), and set a password (`status: ACTIVE`). **Never record the password in shell history or files.**

### Step C — Capture Verified End-User Catalyst Auth Context in RAM (Zero Secret Printing)
1. Sign in as the invited Development test user via Catalyst Hosted Login (`/__catalyst/auth/login?redirect_url=%2Fauth%2Fcallback`).
2. Inspect DevTools Network **without pasting raw secrets into logs**. Because API Gateway is disabled, supply the live Catalyst user header/cookie transiently via `[SecureString]` prompt ONLY into RAM for Step D/E/F (or pre-populate `$VigorSession` if Catalyst issued domain cookies on `project-rainfall-943998020.development.catalystserverless.com`):
```powershell
$secUserToken = Read-Host 'Optional ephemeral Catalyst x-zc-user-cred-token or leave blank if using Catalyst session cookies (hidden)' -AsSecureString
$CatalystUserHeaders = @{
    'Origin'                 = $AllowedOrigin
    'Sec-Fetch-Site'         = 'same-site'
    'X-Vigor-Requested-With' = 'VigorCore-CleanSlate'
}
$plainTmp = ConvertFrom-SecurePlain $secUserToken
if (-not [string]::IsNullOrWhiteSpace($plainTmp)) {
    # Note: Catalyst Edge strips/overwrites client x-zc-* headers; if Edge forces x-zc-user-type=admin
    # on direct Function URL calls without same-origin Catalyst auth or API Gateway, Step D will return 401 UNAUTHENTICATED.
    $CatalystUserHeaders['x-zc-user-cred-type']  = 'token'
    $CatalystUserHeaders['x-zc-user-cred-token'] = $plainTmp
}
$plainTmp = $null
```
> **Expected Stop/Diagnostic Criterion:** If Step D returns `401 UNAUTHENTICATED` rather than `403 USER_PROFILE_NOT_REGISTERED` after browser sign-in on `app.vigorcore.lat`, it confirms empirically that the direct Function URL (`*.catalystserverless.com`) with API Gateway disabled has no cross-site Catalyst end-user cookie/token mapping from Edge — proceed to API Gateway / same-site routing enablement before repeating Step D+.

### Step D — Pre-Bootstrap Deny-by-Default Check (`POST /api/v1/auth/session/exchange`)
```powershell
$preEx = Invoke-VigorJson -Method POST -Path '/api/v1/auth/session/exchange' -WebSession $VigorSession -ExtraHeaders $CatalystUserHeaders -Body @{}
Write-Output ("STEP_D_PRE_BOOTSTRAP_EXCHANGE: status={0} error={1}" -f $preEx.StatusCode, $preEx.Body.error)
# Expected once Catalyst user resolves: status=403 error=USER_PROFILE_NOT_REGISTERED
```

### Step E — Explicit First-Login Profile Bootstrap & Session Issuance (`POST /api/v1/auth/session/bootstrap-profile`)
```powershell
$boot = Invoke-VigorJson -Method POST -Path '/api/v1/auth/session/bootstrap-profile' -WebSession $VigorSession -ExtraHeaders $CatalystUserHeaders -Body @{ displayName = 'Dev Verification Athlete' }
if ($boot.StatusCode -eq 200) {
    $InitialSid = $boot.Body.sid
    $rawCsrf = if ($boot.CsrfHdr) { $boot.CsrfHdr } else { [string]$boot.Body.csrfToken }
    $CsrfSec = ConvertTo-SecureString $rawCsrf -AsPlainText -Force
    $rawCsrf = $null

    # Inspect Set-Cookie attributes ONLY (NEVER print cookie value)
    $cookieOk = ($boot.SetCookie -match '(?i)__Host-vigor_session=') -and
                ($boot.SetCookie -match '(?i)\bHttpOnly\b') -and
                ($boot.SetCookie -match '(?i)\bSecure\b') -and
                ($boot.SetCookie -match '(?i)\bSameSite=Strict\b') -and
                ($boot.SetCookie -match '(?i)\bPath=/\b') -and
                (-not ($boot.SetCookie -match '(?i)\bDomain='))
    $jarCookieCount = ($VigorSession.Cookies.GetCookies([Uri]$BaseUrl) | Where-Object { $_.Name -eq '__Host-vigor_session' }).Count

    Write-Output ("STEP_E_BOOTSTRAP: status=200 role={0} status={1} epoch={2} cookieAttrsOk={3} jarStored={4} hasCsrf={5}" -f `
        $boot.Body.actor.role, $boot.Body.actor.accountStatus, $boot.Body.actor.sessionEpoch, $cookieOk, ($jarCookieCount -eq 1), ($null -ne $CsrfSec))
} else {
    Write-Output ("STEP_E_BOOTSTRAP_STOP: status={0} error={1}" -f $boot.StatusCode, $boot.Body.error)
}
# Purge ephemeral Catalyst pre-session headers immediately after exchange/bootstrap
$CatalystUserHeaders.Clear()
```

### Step F — Existing-User Re-Login Exchange (`POST /api/v1/auth/session/exchange`)
*(Optional check while `$CatalystUserHeaders` is still populated, or after Step E before clearing `$CatalystUserHeaders`)*:
`POST /api/v1/auth/session/exchange` with active Catalyst user headers and existing `Users` profile returns `200`, retains `actor.role='athlete'`, and issues a fresh `sid` + `__Host-vigor_session` + `X-Vigor-CSRF`.

### Step G — Path 3 HMAC-Only Authenticated Reads + RBAC Isolation (NO Catalyst User Headers)
```powershell
$meRes = Invoke-VigorJson -Method GET -Path '/api/v1/auth/me' -WebSession $VigorSession
$wsRes = Invoke-VigorJson -Method GET -Path '/api/v1/athlete/workspace' -WebSession $VigorSession
$admRes = Invoke-VigorJson -Method GET -Path '/api/v1/admin/users' -WebSession $VigorSession

Write-Output ("STEP_G_AUTH_ME: status={0} role={1} hasCsrf={2}" -f $meRes.StatusCode, $meRes.Body.actor.role, ([bool]$meRes.Body.csrfToken))
Write-Output ("STEP_G_WORKSPACE: status={0} hasProfile={1}" -f $wsRes.StatusCode, ([bool]$wsRes.Body.workspace.profile))
Write-Output ("STEP_G_ADMIN_DENY: status={0} error={1}" -f $admRes.StatusCode, $admRes.Body.error)
# Expect: /auth/me=200 (role=athlete, hasCsrf=True), /workspace=200, /admin/users=403
```

### Step H — Bound `X-Vigor-CSRF` & Anti-Spoofing Verification on Mutations (`PATCH /api/v1/athlete/profile`)
```powershell
$noCsrf = Invoke-VigorJson -Method PATCH -Path '/api/v1/athlete/profile' -WebSession $VigorSession -ExtraHeaders @{
    'Origin'         = $AllowedOrigin
    'Sec-Fetch-Site' = 'same-site'
} -Body @{ location = 'Bogota' }
Write-Output ("STEP_H_NO_CSRF: status={0} error={1}" -f $noCsrf.StatusCode, $noCsrf.Body.error)

$spoofRole = Invoke-VigorJson -Method PATCH -Path '/api/v1/athlete/profile' -WebSession $VigorSession -ExtraHeaders @{
    'Origin'         = $AllowedOrigin
    'Sec-Fetch-Site' = 'same-site'
    'X-Vigor-CSRF'   = (ConvertFrom-SecurePlain $CsrfSec)
} -Body @{ role = 'admin' }
Write-Output ("STEP_H_SPOOF: status={0} error={1}" -f $spoofRole.StatusCode, $spoofRole.Body.error)

$okMut = Invoke-VigorJson -Method PATCH -Path '/api/v1/athlete/profile' -WebSession $VigorSession -ExtraHeaders @{
    'Origin'         = $AllowedOrigin
    'Sec-Fetch-Site' = 'same-site'
    'X-Vigor-CSRF'   = (ConvertFrom-SecurePlain $CsrfSec)
} -Body @{ location = 'Phase 5.4 Verified' }
Write-Output ("STEP_H_VALID_MUTATION: status={0} role={1}" -f $okMut.StatusCode, $okMut.Body.profile.role)
# Expect: STEP_H_NO_CSRF=403 CSRF_TOKEN_MISSING, STEP_H_SPOOF=403 IDENTITY_SPOOFING_REJECTED, STEP_H_VALID_MUTATION=200
```

### Step I — Session Refresh & `sid` / Cookie / CSRF Rotation (`POST /api/v1/auth/session/refresh`)
```powershell
$refRes = Invoke-VigorJson -Method POST -Path '/api/v1/auth/session/refresh' -WebSession $VigorSession -ExtraHeaders @{
    'Origin'         = $AllowedOrigin
    'Sec-Fetch-Site' = 'same-site'
    'X-Vigor-CSRF'   = (ConvertFrom-SecurePlain $CsrfSec)
} -Body @{}

if ($refRes.StatusCode -eq 200) {
    $RotatedSid = $refRes.Body.sid
    $rawNextCsrf = if ($refRes.CsrfHdr) { $refRes.CsrfHdr } else { [string]$refRes.Body.csrfToken }
    $CsrfSec = ConvertTo-SecureString $rawNextCsrf -AsPlainText -Force
    $rawNextCsrf = $null
    Write-Output ("STEP_I_REFRESH: status=200 rotatedSidChanged={0}" -f ($RotatedSid -ne $InitialSid))
} else {
    Write-Output ("STEP_I_REFRESH_STOP: status={0} error={1}" -f $refRes.StatusCode, $refRes.Body.error)
}
```

### Step J — Session Logout & Post-Logout Fail-Closed Verification (`POST /api/v1/auth/session/logout`)
```powershell
$outRes = Invoke-VigorJson -Method POST -Path '/api/v1/auth/session/logout' -WebSession $VigorSession -ExtraHeaders @{
    'Origin'         = $AllowedOrigin
    'Sec-Fetch-Site' = 'same-site'
    'X-Vigor-CSRF'   = (ConvertFrom-SecurePlain $CsrfSec)
} -Body @{}

$clearedAttrOk = ($outRes.SetCookie -match '(?i)Max-Age=0') -and ($outRes.SetCookie -match '(?i)SameSite=Strict')
Write-Output ("STEP_J_LOGOUT: status={0} loggedOut={1} clearCookieOk={2}" -f $outRes.StatusCode, $outRes.Body.loggedOut, $clearedAttrOk)

$postOutWs = Invoke-VigorJson -Method GET -Path '/api/v1/athlete/workspace' -WebSession $VigorSession
Write-Output ("STEP_J_POST_LOGOUT_WORKSPACE: status={0} error={1}" -f $postOutWs.StatusCode, $postOutWs.Body.error)
# Expect: loggedOut=True, clearCookieOk=True, STEP_J_POST_LOGOUT_WORKSPACE status=401 (UNAUTHENTICATED or SESSION_REVOKED_REAUTH_REQUIRED)
```

### Step K — Credential Cleanup & Post-Test Audit
```powershell
$CsrfSec = $null
$VigorSession = $null
$CatalystUserHeaders = $null
$secUserToken = $null
[GC]::Collect()
Write-Output 'STEP_K_CLEANUP: In-memory session container and CSRF SecureString cleared.'
```
**Post-Test Manual Inspection (`Development` Console ONLY):**
1. Inspect Catalyst Console -> `Users` NoSQL table: verify 1 row for the test athlete (`role: 'athlete'`, `sessionEpoch: 1`).
2. Inspect Catalyst Console -> `SystemControl` NoSQL table: verify `SESSION#<InitialSid>` (`status: 'revoked'`, `revocationReason: 'session_rotated'`) and `SESSION#<RotatedSid>` (`status: 'revoked'`, `revocationReason: 'user_logout'`).
3. Confirm `Production` project environment & tables remain completely untouched (`0` users, `0` records).

---

## 7. FINAL PHASE 5.4 VERDICT

- **Local Source, Lifecycle, Security Invariant & Loopback Verification:** **`LOCAL_VERIFIED`** (`tests/40-phase-5.4-authenticated-user-hmac-verification.test.ts` + full regression suite passing)
- **Live Operator Runbook & Preconditions (`Development` ONLY):** **`READY_FOR_LIVE_TEST`** (remote live authenticated-user execution remains **`LIVE_VERIFIED` pending operator test**)
- **Phase 5.4 Preparation Status:** **`PHASE_5_4_AUTHENTICATED_USER_VERIFICATION_READY_FOR_OPERATOR_TEST`**
