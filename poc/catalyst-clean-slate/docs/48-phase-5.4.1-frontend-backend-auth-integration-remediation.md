# VIGORCORE — PHASE 5.4.1: FRONTEND / BACKEND AUTHENTICATION INTEGRATION REMEDIATION

- **Project:** `Fit-X` *(strictly isolated inside `poc/catalyst-clean-slate/` — root `src/` untouched)*
- **Catalyst Target:** `Project-Rainfall` (`136967000000014024` · `Development` · Function `vigor_api` `136967000000074001`)
- **Remote Catalyst Operations Executed:** **`0`**
- **Final Status:** **`PHASE_5_4_1_INTEGRATION_REMEDIATION_READY_FOR_REVIEW`**

---

## 0. VERIFICATION SCOPE TAXONOMY (`LOCAL_VERIFIED` VS `LIVE_VERIFIED`)

| Classification | Confirmed Evidence |
| :--- | :--- |
| **`LIVE_VERIFIED`** *(unchanged from Phase 5.3/5.4)* | `GET /health` -> HTTP `200`; `GET /api/v1/health` -> HTTP `200` (`routeCount: 41`); anonymous `GET /api/v1/athlete/workspace` -> HTTP `401 UNAUTHENTICATED` (previous `CATALYST_ADMIN_HEADER_SPOOFED` false-positive resolved). |
| **`LOCAL_VERIFIED`** | Direct inspection of `@zcatalyst/auth@1.0.0`, `@zcatalyst/auth-admin@1.1.0`, `@zcatalyst/transport@1.1.0`; TypeScript + Vite compilation (`frontend:build`, `build`, `build:server`); `tests/01`–`tests/41` including loopback Express + real headless Chromium (`playwright-core`) tests for `/auth/login` -> Hosted Login -> `/auth/callback` -> `/bootstrap-profile` -> `/` -> cross-site cookie check -> `/logout`. |
| **`PENDING_LIVE_VERIFICATION`** | Browser Catalyst Edge forwarding on live `Development` (`app.vigorcore.lat` -> `api.vigorcore.lat` / same-origin proxy), live API Gateway authentication translation, live invited user `/bootstrap-profile` & `/exchange` end-to-end execution. |

---

## 1. PRE-SESSION CATALYST CREDENTIAL CONTRACT DECISION (EVIDENCE-BACKED)

### Selected Decision: **Option A — Native Catalyst Edge User-Context Forwarding (`OPTION_A_NATIVE_CATALYST_EDGE_USER_CONTEXT_FORWARDING`)**

**Primary-Source SDK Inspection (`poc/catalyst-clean-slate/node_modules/@zcatalyst/*`):**
1. **`@zcatalyst/auth@1.0.0` (`dist-es/web.js`, `dist-es/internal/token-manager.js`):**
   - `zcAuth.hostedSignIn('/auth/callback')` sets top-level `window.location.href` to `/__catalyst/auth/login?redirect_url=%2Fauth%2Fcallback`.
   - `zcAuth.isUserAuthenticated()` invokes `GET /baas/v1/project/{projectId}/project-user/current` (`service: 'baas'`, `user: 'user'`).
   - `zcAuth.generateAuthToken('functions')` calls `GET /baas/v1/project/{projectId}/authentication/custom-token?feature=functions` followed by `POST {IAM_DOMAIN}/clientoauth/v2/{zaid}/remote/auth` (`response_type=remote_token`), returning `{ access_token, expires_in_sec }` strictly in browser RAM (zero IndexedDB/Web Storage writes).
2. **`@zcatalyst/auth-admin@1.1.0` (`dist-es/credential.js`, `dist-es/index.js`):**
   - `ZCAuth.init({ headers }, { type: 'advancedio', scope: 'user' })` (`HostedNativeCatalystAuthRuntime`) **only** reads Catalyst Edge-injected `x-zc-user-type`, `x-zc-user-cred-type`, `x-zc-user-cred-token`, and `x-zc-cookie` (`ZD_CSRF_TOKEN` -> `X-ZCSRF-TOKEN`), verifying identity via `GET {apiDomain}/baas/v1/project/{projectId}/project-user/current`.
   - It **never** parses raw HTTP `Authorization` from incoming `req.headers`, and throws `AUTH_ERROR` if `x-zc-user-type === 'admin'`.
   - `ApplicationCustomCredential` leaves `getCurrentUserType()` returning `'admin'`; decoding raw `Authorization` in backend Node.js without Edge user context is **not** a documented user-scope contract for `getCurrentUser()` and is therefore **rejected** (zero guessing).

**Resulting Boundary Rules:**
- Browser JS **never** fabricates `x-zc-*` headers (`PRE_SESSION_CREDENTIAL_CONTRACT.forbidsClientXzcHeaders = true`).
- Browser JS acquires the RAM-only `generateAuthToken('functions')` credential on `/auth/callback` (`CatalystHostedAuthBridge.establishVigorSession`), clears it in `finally`, and delegates user verification to Catalyst Edge + `HostedNativeCatalystAuthRuntime` (`ZCAuth.init(..., { scope: 'user' })`).
- Once Path 1 (`POST /api/v1/auth/session/bootstrap-profile` or `POST /api/v1/auth/session/exchange`) issues `__Host-vigor_session`, all routine requests run via **Path 3 (`hmac_session`)** with `0` `getCurrentUser()` BaaS calls.

**Exact Missing Live Evidence (`PENDING_LIVE_VERIFICATION` — explicitly unguessed):**
1. Whether Catalyst Edge translates browser `Authorization` (`raw` vs `Zoho-oauthtoken` from `generateAuthToken('functions')`) or browser Catalyst session cookies (`JWT_AUTH`, `user_cred`, `ZD_CSRF_TOKEN`) into `x-zc-user-type=user` + `x-zc-user-cred-token` / `x-zc-cookie` when calling `api.vigorcore.lat` (API Gateway `CATALYST_USERS_AUTHENTICATION` vs `NO_AUTHENTICATION`) vs a same-origin proxy on `app.vigorcore.lat`.
2. Whether `HttpSecurityPolicy` in `express_enforced` mode (`src/security/httpSecurityPolicy.ts:157`) also requires `Authorization` in `Access-Control-Allow-Headers` if Gateway ever delegates CORS preflight to Express for cross-domain `generateAuthToken('functions')` (live `Development` currently runs `VIGOR_CORS_MODE=platform_managed`).

---

## 2. ARCHITECTURE & END-TO-END AUTHENTICATION SEQUENCE

1. **Unauthenticated `/` (`mode=http`):** `WorkspaceProvider` calls `GET /api/v1/auth/me` -> receives `401 UNAUTHENTICATED` -> renders fail-closed error panel (`Reintentar carga` + `Ir a Iniciar Sesión`).
2. **`/auth/login` (`AuthRoutesView.tsx`):** Checks `GET /api/v1/auth/me`; if unauthenticated, operator clicks **Iniciar sesión con Catalyst** -> `CatalystHostedAuthBridge.startHostedLogin('/auth/callback')` validates same-origin redirect, rejects iFrames (`403 HOSTED_LOGIN_IFRAME_FORBIDDEN`), dynamically loads `@zcatalyst/auth/web` (`catalystWebSdkAdapter.ts`), calls `zcAuth.init()`, and redirects top-level to `/__catalyst/auth/login?redirect_url=%2Fauth%2Fcallback`.
3. **`/auth/callback` (`AuthRoutesView.tsx`):** Strictly one-shot per attempt (`executedAttemptRef` safe under React 19 `StrictMode`), discards untrusted identity/role query params (`authRouting.ts`), handles cancellation (`?cancelled=1` / `error=access_denied`) without `/exchange`, checks `isUserAuthenticated()` (`EMAIL_VERIFICATION_REQUIRED`, `CATALYST_ACCOUNT_NOT_ACTIVE`), generates ephemeral RAM token via `zcAuth.generateAuthToken('functions')`, and invokes `POST /api/v1/auth/session/exchange`.
4. **First-Login Opt-In (`USER_PROFILE_NOT_REGISTERED`):** `/exchange` rejects missing `Users` rows (`403`); UI shows opt-in registration form calling `POST /api/v1/auth/session/bootstrap-profile` (`role: 'athlete'`, `roleVersion: 1`, `sessionEpoch: 1`, `SystemControl SESSION#<sid>` written **before** `Set-Cookie: __Host-vigor_session=...`). Optional invitation redemption (`inviteId` + `token`) runs **after** session issuance via Path 3 `POST /api/v1/invitations/redeem`.
5. **Routine Workspace & Lifecycle (Path 3):** `reloadWorkspace()` calls `GET /api/v1/auth/me` (hydrates bound `X-Vigor-CSRF` in `ServerCsrfTokenProvider` RAM) + `GET /api/v1/athlete/workspace` -> navigates via `pushState` to `/`. Mutations send bound `X-Vigor-CSRF`; `/refresh` validates active session + CSRF before calling live `getUserDetails()` and rotating `sid`/cookie/`csrfToken`; `/logout` revokes `SESSION#<sid>` and returns `Max-Age=0`.

---

## 3. POC FRONTEND ROUTE IMPLEMENTATION SUMMARY

- `src/frontend/routing/authRouting.ts`: Zero-dependency History API URL router (`parseAppRoute`, `buildPathWithPreservedMode`, `navigateBrowserPath`), same-origin `next` redirect sanitization via `resolveSafeSameOriginRedirect`, explicit stripping of untrusted identity/role/token query parameters.
- `src/frontend/adapters/catalystWebSdkAdapter.ts`: Dynamic `@zcatalyst/auth/web` loader (`PRE_SESSION_CREDENTIAL_CONTRACT` + `createBrowserCatalystWebAuthSdk`), zero eager `/__catalyst/sdk/init` fetches on mock `/`.
- `src/frontend/views/AuthRoutesView.tsx`: Dedicated `/auth/login` and `/auth/callback` views handling authenticated, unauthenticated, cancelled, unconfirmed email (`EMAIL_VERIFICATION_REQUIRED`), disabled/suspended user, missing profile (`USER_PROFILE_NOT_REGISTERED` -> explicit `/bootstrap-profile`), expired/invalid invitation, and backend/network failure states visibly with zero fabricated auth state.
- `src/frontend/adapters/CatalystHttpAuthRepository.ts`: Added Path 3 `redeemInvitation(inviteId, token)` over `POST /api/v1/invitations/redeem`.
- `src/frontend/state/WorkspaceContext.tsx`, `components/UiPrimitives.tsx`, `components/AppShell.tsx`, `CleanSlateApp.tsx`, `frontend/main.tsx`: Integrated URL routing cleanly while preserving `/` Mock Dev mode and `?mode=http` compatibility.

---

## 4. BROWSER COOKIE TOPOLOGY EVALUATION (`__Host-vigor_session; HttpOnly; Secure; SameSite=Strict; Path=/`)

`SameSite=Strict` and `__Host-` prefix invariants are **preserved unconditionally** (never downgraded to `SameSite=None` or given `Domain=`).

| Criterion | **Current Cross-Site Function URL** (`app.vigorcore.lat` -> `*.development.catalystserverless.com`) | **Architecture A: Same-Site Custom API Host** (`https://app.vigorcore.lat` + `https://api.vigorcore.lat`) | **Architecture B: Same-Origin Frontend Proxy** (`https://app.vigorcore.lat` + `/server/vigor_api/*` or `/api/*`) |
| :--- | :--- | :--- | :--- |
| **Site Relationship** | `cross-site` (`compatibleWithStrictCookie: false`) | `same-site` (`compatibleWithStrictCookie: true`) | `same-origin` (`compatibleWithStrictCookie: true`) |
| **`__Host-vigor_session` Browser Transmission** | **Blocked by `SameSite=Strict`!** Browser omits cookie on XHR/`fetch()`. | **Sent by browser** on `credentials: 'include'` (`api.vigorcore.lat` host-locked). | **Sent by browser** automatically on same-origin `app.vigorcore.lat`. |
| **`Sec-Fetch-Site` + Origin/CORS + Bound CSRF** | Blocked (`403 CSRF_CROSS_SITE_REJECTED`). | Passes `Sec-Fetch-Site: same-site`; requires `VIGOR_ALLOWED_ORIGINS=https://app.vigorcore.lat`, CORS `Access-Control-Allow-Credentials: true`, and bound `X-Vigor-CSRF`. | Passes `Sec-Fetch-Site: same-origin`; no cross-origin CORS preflight needed for `/api/v1/*`; retains bound `X-Vigor-CSRF`. |
| **HTTPS / `__Host-` Requirement** | Requires HTTPS; Function URL cannot act as same-site host for `vigorcore.lat`. | Requires valid TLS cert & Zoho Catalyst **API Gateway + CloudScale Custom Domain Mapping** (`api.vigorcore.lat`). | Requires Slate/reverse-proxy route forwarding `/api/v1/*` and `/server/vigor_api/*` cleanly with TLS on `app.vigorcore.lat`. |
| **Pre-Session Catalyst Cookie Forwarding** | Unusable across sites with `SameSite=Strict`. | Must verify in live `Development` how API Gateway maps `generateAuthToken('functions')` -> `x-zc-user-cred-token` cleanly (**`PENDING_LIVE_VERIFICATION`**). | **Recommended if supported by Zoho Slate/AppSail proxy**, or **Architecture A** where API Gateway maps `api.vigorcore.lat` cleanly to Catalyst Functions (`NO_AUTHENTICATION` vs `CATALYST_USERS_AUTHENTICATION` validated once live). |

**Selected Production/Stage Recommendation:** Preserve `__Host-vigor_session; HttpOnly; Secure; SameSite=Strict; Path=/` and adopt **Architecture A (`api.vigorcore.lat` via API Gateway + CloudScale Domain Mapping)** or **Architecture B (Same-Origin Proxy on `app.vigorcore.lat`)** — never deploy browser SPA auth directly against the cross-site `*.catalystserverless.com` Function URL.

---

## 5. COMPLETE 6-ENDPOINT LOGIN/SESSION CONTRACT MATRIX (`LOCAL_VERIFIED`)

| Endpoint | Auth Policy | CSRF Policy | Live Reval | Verified Request / Response Contract |
| :--- | :--- | :--- | :---: | :--- |
| `POST /api/v1/auth/session/bootstrap-profile` | `catalyst_exchange` | `pre_session_catalyst_exchange` | `false` | Body: `{ displayName? }` (rejects client role/uid); creates `Users` (`role: 'athlete'`, `sessionEpoch: 1`) + `SystemControl SESSION#<sid>` before `Set-Cookie(__Host-vigor_session)`; returns `200 { success: true, actor, sid, expiresAt, expiresAtEpochSec, absoluteExpiresAtEpochSec, csrfToken }` + `X-Vigor-CSRF-Token`. |
| `POST /api/v1/auth/session/exchange` | `catalyst_exchange` | `pre_session_catalyst_exchange` | `false` | Body: `{}`; `403 USER_PROFILE_NOT_REGISTERED` if `Users` row absent, `403 ACCOUNT_SUSPENDED` if suspended; else creates `SESSION#<sid>`, sets `__Host-vigor_session`, returns `200 { success: true, actor, sid, csrfToken, ... }`. |
| `GET /api/v1/auth/me` | `catalyst_or_hmac_inspect` | `none_safe_get` | `false` (+15m) | Path 3 inspects `__Host-vigor_session` (`0` `getCurrentUser()` calls) and re-mints bound `csrfToken` in body & `X-Vigor-CSRF-Token` for reload hydration. |
| `POST /api/v1/auth/session/refresh` | `hmac_session` | `signed_session_bound` | `true` (`getUserDetails`) | Verifies cookie + bound `X-Vigor-CSRF` -> live `getUserDetails()` -> 24h ceiling -> atomically revokes old `sid` (`session_rotated`) & issues new `sid`, `__Host-vigor_session`, and `csrfToken`. Replay `> 5s` bumps `Users.sessionEpoch++`. |
| `POST /api/v1/auth/session/logout` | `hmac_session` | `signed_session_bound` | `false` (skip reval) | Verifies cookie + bound `X-Vigor-CSRF`; revokes `SESSION#<sid>` (`user_logout`) and returns `200 { success: true, loggedOut: true, revokedSid }` + `Set-Cookie(__Host-vigor_session=; Max-Age=0; ...)`. |
| `POST /api/v1/auth/session/revoke` | `hmac_session` | `signed_session_bound` | `true` (`getUserDetails`) | `scope: 'individual'` revokes target `sid`; `scope: 'all'` bumps `Users.sessionEpoch++` globally (self or admin for non-superadmin). |

---

## 6. UPDATED WINDOWS POWERSHELL 5.1 OPERATOR RUNBOOK (`Development` ONLY · Topology-Aware)

> **Operator Rules:** Run **only** against `Project-Rainfall` (`136967000000014024` `Development`). Keep `Public Signup = Disabled`. Never print secrets, cookies, or CSRF tokens. **Stop immediately** if executing against the raw cross-site `*.catalystserverless.com` Function URL before API Gateway / same-site domain mapping (`api.vigorcore.lat` or same-origin `app.vigorcore.lat`) is provisioned for browser testing.

```powershell
# Phase 5.4.1 — Windows PowerShell 5.1 Secret-Safe Operator Check (Development ONLY)
$ApiBaseUrl    = 'https://api.vigorcore.lat' # Replace ONLY during direct pre-domain CLI smoke with Function URL; NEVER deploy browser SPA cross-site
$AllowedOrigin = 'https://app.vigorcore.lat'
$SecFetchSite  = 'same-site'                 # Use 'same-origin' if ApiBaseUrl shares https://app.vigorcore.lat
$VigorSession  = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$CsrfSec       = $null

function Invoke-VigorApi {
    param(
        [Parameter(Mandatory=$true)][ValidateSet('GET','POST','PATCH','PUT','DELETE')][string]$Method,
        [Parameter(Mandatory=$true)][string]$Path,
        [Microsoft.PowerShell.Commands.WebRequestSession]$WebSession = $null,
        [hashtable]$ExtraHeaders = @{},
        [object]$Body = $null
    )
    $hdrs = @{ 'Accept' = 'application/json' }
    foreach ($k in $ExtraHeaders.Keys) { $hdrs[$k] = $ExtraHeaders[$k] }
    $params = @{ Uri = "$ApiBaseUrl$Path"; Method = $Method; Headers = $hdrs; UseBasicParsing = $true; ErrorAction = 'Stop' }
    if ($null -ne $WebSession) { $params['WebSession'] = $WebSession }
    if ($null -ne $Body) { $hdrs['Content-Type'] = 'application/json'; $params['Body'] = ($Body | ConvertTo-Json -Depth 5 -Compress) }
    try {
        $r = Invoke-WebRequest @params
        $json = if ($r.Content) { $r.Content | ConvertFrom-Json } else { $null }
        return [pscustomobject]@{ StatusCode = [int]$r.StatusCode; SetCookie = [string]$r.Headers['Set-Cookie']; CsrfHdr = $r.Headers['X-Vigor-CSRF-Token']; Body = $json }
    } catch [System.Net.WebException] {
        $resp = [System.Net.HttpWebResponse]$_.Exception.Response
        if ($null -eq $resp) { throw }
        $sr = New-Object System.IO.StreamReader($resp.GetResponseStream()); $raw = $sr.ReadToEnd(); $sr.Dispose()
        $errJson = $null; try { $errJson = $raw | ConvertFrom-Json } catch {}
        return [pscustomobject]@{ StatusCode = [int]$resp.StatusCode; SetCookie = [string]$resp.Headers['Set-Cookie']; CsrfHdr = $null; Body = $errJson }
    }
}

function ConvertFrom-SecurePlain([System.Security.SecureString]$s) {
    $b = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($b) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

# 1. Pre-check health + anonymous fail-closed 401
$h = Invoke-VigorApi -Method GET -Path '/api/v1/health'
$anon = Invoke-VigorApi -Method GET -Path '/api/v1/athlete/workspace'
Write-Output ("HEALTH={0} ANON_WORKSPACE={1}/{2}" -f $h.StatusCode, $anon.StatusCode, $anon.Body.error)

# 2. Ephemeral pre-session credential in RAM only (never stored or printed)
$secToken = Read-Host 'Paste ephemeral pre-session Authorization or Catalyst user token (hidden, optional if Gateway cookie set)' -AsSecureString
$plainTok = ConvertFrom-SecurePlain $secToken
$PreHeaders = @{ 'Origin' = $AllowedOrigin; 'Sec-Fetch-Site' = $SecFetchSite; 'X-Vigor-Requested-With' = 'VigorCore-CleanSlate' }
if (-not [string]::IsNullOrWhiteSpace($plainTok)) { $PreHeaders['Authorization'] = $plainTok }
$plainTok = $null

$preEx = Invoke-VigorApi -Method POST -Path '/api/v1/auth/session/exchange' -WebSession $VigorSession -ExtraHeaders $PreHeaders -Body @{}
Write-Output ("EXCHANGE_PRE_BOOT={0}/{1}" -f $preEx.StatusCode, $preEx.Body.error)
if ($preEx.StatusCode -eq 401) {
    Write-Output 'STOP: Pre-session Catalyst user context not forwarded on target endpoint (verify API Gateway / same-site routing).'
}

# 3. Bootstrap -> Path 3 GET /auth/me + /workspace -> PATCH + bound CSRF -> /refresh -> /logout
$boot = Invoke-VigorApi -Method POST -Path '/api/v1/auth/session/bootstrap-profile' -WebSession $VigorSession -ExtraHeaders $PreHeaders -Body @{ displayName = 'Dev Athlete' }
$PreHeaders.Clear()
if ($boot.StatusCode -eq 200) {
    $rawCsrf = if ($boot.CsrfHdr) { $boot.CsrfHdr } else { [string]$boot.Body.csrfToken }
    $CsrfSec = ConvertTo-SecureString $rawCsrf -AsPlainText -Force; $rawCsrf = $null
    $me = Invoke-VigorApi -Method GET -Path '/api/v1/auth/me' -WebSession $VigorSession
    $ws = Invoke-VigorApi -Method GET -Path '/api/v1/athlete/workspace' -WebSession $VigorSession
    $ref = Invoke-VigorApi -Method POST -Path '/api/v1/auth/session/refresh' -WebSession $VigorSession -ExtraHeaders @{ 'Origin' = $AllowedOrigin; 'Sec-Fetch-Site' = $SecFetchSite; 'X-Vigor-CSRF' = (ConvertFrom-SecurePlain $CsrfSec) } -Body @{}
    if ($ref.StatusCode -eq 200) {
        $nextCsrf = if ($ref.CsrfHdr) { $ref.CsrfHdr } else { [string]$ref.Body.csrfToken }
        $CsrfSec = ConvertTo-SecureString $nextCsrf -AsPlainText -Force; $nextCsrf = $null
    }
    $out = Invoke-VigorApi -Method POST -Path '/api/v1/auth/session/logout' -WebSession $VigorSession -ExtraHeaders @{ 'Origin' = $AllowedOrigin; 'Sec-Fetch-Site' = $SecFetchSite; 'X-Vigor-CSRF' = (ConvertFrom-SecurePlain $CsrfSec) } -Body @{}
    Write-Output ("BOOT=200 ME={0} WS={1} REFRESH={2} LOGOUT={3}/{4}" -f $me.StatusCode, $ws.StatusCode, $ref.StatusCode, $out.StatusCode, $out.Body.loggedOut)
}
$CsrfSec = $null; $VigorSession = $null; $secToken = $null; [GC]::Collect()
```

---

## 7. REMAINING BLOCKERS BEFORE FIRST INVITED USER & FUTURE ROOT `src/` CHANGES

### Remaining External/Live Blockers (`PENDING_LIVE_VERIFICATION`)
1. **Same-Site / Same-Origin Cookie Topology in Catalyst:** Provision API Gateway + CloudScale Domain Mapping (`api.vigorcore.lat` — Architecture A) or same-origin proxy on `app.vigorcore.lat` (Architecture B) so `__Host-vigor_session; SameSite=Strict` is transmitted by browsers.
2. **Live Edge Credential Translation Verification:** Confirm empirically against live `Development` that `generateAuthToken('functions')` / browser Catalyst cookies resolve to `x-zc-user-type=user` + `x-zc-user-cred-token` or `x-zc-cookie` at the Gateway boundary.
3. **Single-Page App Fallback Routing on Zoho Slate (`app.vigorcore.lat`):** Configure Slate rewrite fallback to serve `index.html` for `/auth/login` and `/auth/callback` deep links.
4. **Controlled Authorized Migration of Root `src/` Frontend:** Apply the future root frontend updates below once approved (root `src/` was NOT touched in Phase 5.4.1).

### Explicit Future Root `src/` Changes Required (Out of Scope Now)
1. Port zero-dependency URL routing (`authRouting.ts`) for `/auth/login` and `/auth/callback` into the production root frontend entrypoint (`src/`).
2. Port `CatalystHostedAuthBridge`, `catalystWebSdkAdapter`, `CatalystHttpAuthRepository`, `CatalystHttpTransport`, `ServerCsrfTokenProvider`, and `AuthRoutesView` into the root app.
3. Remove all remaining direct Firebase Auth / Firestore client SDK dependencies from root `src/` in favor of Path 1 + Path 3 `/api/v1/*` HTTP repositories.
4. Configure production Slate environment variables (`VITE_VIGOR_API_BASE_URL=https://api.vigorcore.lat` or same-origin `/`) and verify live end-to-end with an invited `Development` test user before `Production`.
