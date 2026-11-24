# VigorCore Phase 5.3 — Live Authentication 403 Forensic Diagnostic Candidate (`vigor_api`)

- **Scope:** `poc/catalyst-clean-slate/` only (`vigor_api`, Project-Rainfall `136967000000014024`, Catalyst Development, Node.js 22)
- **Diagnostic Build Identifier (`VIGORCORE_DIAGNOSTIC_BUILD_ID`):** `phase-5.3-403-forensic-diag-v2`
- **Remote Operations Executed:** **0** (strictly local inspection, local diagnostic instrumentation, artifact packaging, and loopback tests only; live Catalyst Edge headers have **not** yet been observed)
- **Final Status:** **`FORENSIC_DIAGNOSTIC_CANDIDATE_READY_PENDING_EXPLICIT_OPERATOR_AUTHORIZATION`**

---

## 1. Exact 403 Trigger & Request Path Audit

Live verification confirmed the uploaded Development artifact (`vigor_api-auth-reconciled-portable.zip`, `1,279,670` B, SHA-256 `d268c7bfa12ed4ec8d4765e38516e416957120ccc9d47a8c32a6f6ccffc20319`) serves exact SHA-matching compiled modules on Catalyst:
- `dist/sdk/catalystSdkBridge.js`: `4f6863eec3a2de47b6462f3a47a26113d5b74fbada9005e1f893a9f3ae0a9d99`
- `dist/auth/cleanSlateAuthGuard.js`: `90607d2238f1af86822588cd84a51b344a5466b9fbb56ba25b6bff112f97288e`

In the deployed Express -> Dispatcher -> `CleanSlateAuthGuard.authenticate()` -> `HostedNativeCatalystAuthRuntime.getCurrentUserFromRequest()` chain:

1. **Express Middleware (`src/server/advancedIoApp.ts`):**
   - `express.json()` parses request bodies only; it never mutates `req.headers`.
   - `normalizeIncomingHeaders()` lowercases keys and joins multi-value string arrays; it never synthesizes `x-zc-user-cred-token` or `x-zc-cookie`.
   - `wrapDispatch` invokes `hostedRuntime.runWithRequestContext(headers, executeDispatch)` -> `buildHostedAdminAppFromHeaders()`, which copies values into an isolated `AsyncLocalStorage<CatalystApp>` admin instance and **never** mutates incoming `req.headers`.
2. **SDK Constant Mapping (`@zcatalyst/utils@1.1.0/dist-es/constants.js`):**
   - `CONSTANTS.CREDENTIAL_HEADER.user` = `'x-zc-user-type'`
   - `CONSTANTS.CREDENTIAL_HEADER.user_cred_type` = `'x-zc-user-cred-type'`
   - `CONSTANTS.CREDENTIAL_HEADER.user_token` = `'x-zc-user-cred-token'`
   - `CONSTANTS.CREDENTIAL_HEADER.admin_cred_type` = `'x-zc-admin-cred-type'`
   - `CONSTANTS.CREDENTIAL_HEADER.admin_token` = `'x-zc-admin-cred-token'`
   - `CONSTANTS.CREDENTIAL_HEADER.cookie` = `'x-zc-cookie'`
   - `CONSTANTS.CSRF_TOKEN_NAME` = `'ZD_CSRF_TOKEN'`
3. **Exact `403 CATALYST_ADMIN_HEADER_SPOOFED` Condition (`src/sdk/catalystSdkBridge.ts`):**
   - Thrown ONLY inside `HostedNativeCatalystAuthRuntime.getCurrentUserFromRequest()` (or `CatalystSeparatedAuthRuntime.getCurrentUserFromRequest()`) when **both**:
     1. `x-zc-user-type` (case-insensitive) equals `'admin'`, **AND**
     2. `hasUserCredential = Boolean(rawToken || sanitizedZcCookie)` evaluates to `true`.
   - Because an anonymous PowerShell `GET /api/v1/athlete/workspace` sends zero browser cookies and zero manual `x-zc-*` headers yet receives `403 CATALYST_ADMIN_HEADER_SPOOFED` on Catalyst Development (while local Node 22 loopback tests return `401 UNAUTHENTICATED`), Catalyst Edge itself must be populating either `x-zc-user-cred-token` or a matched `x-zc-cookie` cookie alongside `x-zc-user-type: admin`.

---

## 2. Ranked Root-Cause Hypotheses

| Rank | Hypothesis | Supporting Code / SDK Evidence | Disconfirming Evidence / Uncertainty |
|---|---|---|---|
| **1 (Most Likely)** | **Catalyst Edge injects a non-empty placeholder / sentinel / admin-fallback string into `x-zc-user-cred-token` alongside `x-zc-user-type: admin` on unauthenticated calls.** | In `@zcatalyst/auth-admin@1.1.0/dist-es/credential.js:248-265`, `CatalystCredential` checks `if (this.scope === 'user' && this.userType === 'admin') throw AUTH_ERROR` *before* inspecting `this.userToken`, and `scope === 'admin'` ignores `userToken` completely. Therefore Catalyst Edge can populate `'null'`, `'undefined'`, `'false'`, `'0'`, or a fallback token string in `x-zc-user-cred-token` without breaking Catalyst's own admin SDK. In our runtime, `readHeaderCaseInsensitive(..., 'x-zc-user-cred-token')` treats ANY trimmed non-empty string as `Boolean(rawToken) === true`. | Live Catalyst Edge headers have not yet been observed because diagnostic instrumentation has not been deployed. |
| **2** | **Catalyst Edge injects `x-zc-cookie` containing an allowlist-matched Zoho/Catalyst cookie rule (`_iamadt*` / `_iambdt*` / `_zohoportal_*`).** | Possible if Catalyst Edge attaches an internal gateway cookie matching `/^_?iam[ab]dt/` or `/^_?zohoportal_/`. | Anonymous PowerShell sent zero cookies; awaits diagnostic log classification (`hasXZcCookie`, `recognizedCookieNames`). |
| **3 (Ruled Out)** | Stale compiled artifact or Express/middleware header mutation. | Operator verified live module SHA-256 parity against `vigor_api-auth-reconciled-portable.zip`, and Express middleware audit confirms `req.headers` is never mutated. | Disproved by SHA-256 verification and source inspection. |

---

## 3. Cookie Allowlist Audit Against Installed `@zcatalyst/*` Sources

Inspection across all installed packages (`@zcatalyst/auth-admin@1.1.0`, `@zcatalyst/auth@1.2.1`, `@zcatalyst/auth-client@1.2.1`, `@zcatalyst/utils@1.1.0`):

| Cookie Pattern | Exact Installed SDK Evidence | Identifies Catalyst Project End User? | Can Appear on Unauthenticated Calls? | Forward to `ZCAuth` `scope: 'user'`? | Action Taken |
|---|---|---|---|---|---|
| **`JWT_AUTH`** | `@zcatalyst/auth-client/dist-es/utils/constants.js:59` (`JWT_COOKIE_PREFIX = 'JWT_AUTH'`); `@zcatalyst/auth/dist-es/web.js:148` (cleared on custom JWT `signOut`). | **Yes** — Catalyst custom JWT auth (`signinWithJwt`). | No. | **Yes** (`exact:JWT_AUTH`). | Retained (SDK-verified). |
| **`user_cred`** | `@zcatalyst/auth/dist-es/web.js:149` (cleared alongside `JWT_AUTH` on `JwtTokenProtocol` `signOut`). | **Yes** — Catalyst user session credential. | No. | **Yes** (`exact:user_cred`). | Retained (SDK-verified). |
| **`ZD_CSRF_TOKEN`** | `@zcatalyst/utils/dist-es/constants.js:48` (`CSRF_TOKEN_NAME = 'ZD_CSRF_TOKEN'`); `@zcatalyst/auth-admin/dist-es/credential.js:239` (`getZCSRFHeader()`). | **No** (CSRF binding token only, never identity alone). | Potentially if set pre-auth. | **Only when paired** with a recognized user session cookie (`csrf_paired:ZD_CSRF_TOKEN`). | Retained strictly paired only. |
| **`zccpn`** | **Zero references** in `@zcatalyst/*` (`dist-es/` or `dist-types/`) and zero tests. | **Unverified** (no SDK basis). | Unknown. | **No** (unsupported assumption). | **Removed** from allowlist. |
| **`_iamadt*`** | **Zero direct string refs** in `@zcatalyst/*`; `CookieCredential` forwards `x-zc-cookie` opaquely to `https://accounts.zohoportal.com`. | **Opaque Portal IAM**. | Possibly in browser Zoho portal sessions. | **Yes (provisional)** (`regex:^_?iam[ab]dt`). | Retained + classified. |
| **`_iambdt*`** | **Zero direct string refs** in `@zcatalyst/*`; opaque portal cookie. | **Opaque Portal IAM**. | Same as `_iamadt*`. | **Yes (provisional)** (`regex:^_?iam[ab]dt`). | Retained + classified. |
| **`_zohoportal_*`** | **Zero direct string refs** in `@zcatalyst/*`; `@zcatalyst/auth-client` sets `IAM_DOMAIN = 'https://accounts.zohoportal.com'`. | **Opaque Portal IAM**. | Same as `_iamadt*`. | **Yes (provisional)** (`regex:^_?zohoportal_`). | Retained + classified. |

---

## 4. Non-Secret Diagnostic Classification & `userCredentialTokenClass`

At the exact `CATALYST_ADMIN_HEADER_SPOOFED` branch in both `HostedNativeCatalystAuthRuntime` and `CatalystSeparatedAuthRuntime`, one structured JSON `console.warn` event (`CATALYST_ADMIN_HEADER_SPOOFED_DIAGNOSTIC`) is emitted per rejection using `VIGORCORE_DIAGNOSTIC_BUILD_ID = 'phase-5.3-403-forensic-diag-v2'`.

### `userCredentialTokenClass` Allowed Values

Deterministically computed via `classifyUserCredentialTokenHeader()` without ever recording the token value, any substring, any hash, or token length:
- `absent`
- `empty`
- `whitespace_only`
- `literal_null`
- `literal_undefined`
- `literal_false`
- `literal_zero`
- `nonempty_opaque`
- `malformed_control_characters`

### Synthetic, Non-Secret Diagnostic Event Examples

Example A (Catalyst Edge sends `x-zc-user-cred-token: null` alongside `x-zc-user-type: admin`):
```json
{"event":"CATALYST_ADMIN_HEADER_SPOOFED_DIAGNOSTIC","buildId":"phase-5.3-403-forensic-diag-v2","authRuntimeMode":"hosted_native","method":"GET","route":"/api/v1/athlete/workspace","xZcUserTypeIsAdmin":true,"hasXZcUserCredToken":true,"userCredentialTokenClass":"literal_null","hasXZcCookie":false,"recognizedCookieNames":[],"matchedCookieRules":["none"],"hasSanitizedZcCookieCredential":false,"hasUserCredential":true}
```

Example B (Matched cookie rule alongside `x-zc-user-type: admin` without user token):
```json
{"event":"CATALYST_ADMIN_HEADER_SPOOFED_DIAGNOSTIC","buildId":"phase-5.3-403-forensic-diag-v2","authRuntimeMode":"hosted_native","method":"GET","route":"/api/v1/athlete/workspace","xZcUserTypeIsAdmin":true,"hasXZcUserCredToken":false,"userCredentialTokenClass":"absent","hasXZcCookie":true,"recognizedCookieNames":["_iamadt_us","ZD_CSRF_TOKEN"],"matchedCookieRules":["regex:^_?iam[ab]dt","csrf_paired:ZD_CSRF_TOKEN"],"hasSanitizedZcCookieCredential":true,"hasUserCredential":true}
```

---

## 5. Threat Analysis: Deferring `x-zc-user-type=admin` Rejection Until After BaaS Validation

Moving the 403 contradiction check until *after* `UserManagement.getCurrentUser()` (`GET /baas/v1/project-user/current`) remains **unsafe without first observing live Edge headers**:
- **Path 3 (`__Host-vigor_session`) impact:** In `CleanSlateAuthGuard.authenticate()`, Path 3 checks `hasRequestCatalystUserCredential(req)`. If Catalyst Edge populates a placeholder `x-zc-user-cred-token` or cookie on every request, valid HMAC browser sessions would invoke `getCurrentUserFromRequest()` -> outbound Catalyst BaaS HTTP calls on every API request -> BaaS rejection (`401 AUTH_SESSION_INVALID`) -> breaking Path 3 browser sessions and creating DoS/latency amplification on anonymous requests.
- **Minimal target fix (after authorized diagnostic run confirms root cause):** Classify the exact observed non-credential Catalyst Edge artifact as `hasUserCredential = false`, preserving `0` outbound BaaS calls, `0` NoSQL hits, `401 UNAUTHENTICATED` for anonymous traffic, fast Path 3 HMAC sessions, and immediate fail-closed `403 CATALYST_ADMIN_HEADER_SPOOFED` on genuine contradiction.

---

## 6. Diagnostic Deployment Candidate Artifact & Traceability

- **Diagnostic Artifact:** `artifacts/vigor_api-auth-forensic-diagnostic-portable.zip`
- **Manifest:** `artifacts/vigor_api-auth-forensic-diagnostic-portable.manifest.json`
- **Entry Count:** `905` files (strict code-point ordinal order, DOS epoch `1980-01-01 00:00:00`, DEFLATE level 6)
- **Uncompressed Size:** `3,767,630` bytes
- **ZIP Size:** `1,280,918` bytes (`1.22` MB)
- **SHA-256 (verified twice via independent clean staging builds):** `c9ade1264bc340560d1b503544162df50d78cf41949ecb37642a416caf8b2839`
- **Untouched Original Candidate Verification:** `artifacts/vigor_api-auth-reconciled-portable.zip` remains byte-identical (`d268c7bfa12ed4ec8d4765e38516e416957120ccc9d47a8c32a6f6ccffc20319`).
- **Exact Delta vs `vigor_api-auth-reconciled-portable.zip` (`0` missing, `0` unexpected, `2` modified compiled ESM files):**
  1. `dist/sdk/catalystSdkBridge.js` (`VIGORCORE_DIAGNOSTIC_BUILD_ID`, `userCredentialTokenClass`, cookie audit removal of `zccpn`, non-secret diagnostic event emission)
  2. `dist/server/advancedIoApp.js` (`method` and normalized `route` forwarding plus `diagnosticLogger` hook)
  *(Note: `src/auth/cleanSlateAuthGuard.ts` added TypeScript-only optional fields `method?: string; route?: string;` on `IncomingHttpRequest`, which erase at compile time so `dist/auth/cleanSlateAuthGuard.js` remains byte-identical.)*

**Final Status:** **`FORENSIC_DIAGNOSTIC_CANDIDATE_READY_PENDING_EXPLICIT_OPERATOR_AUTHORIZATION`**

> **Subsequent Forensic Outcome:** Live log capture confirmed `xZcUserTypeIsAdmin: true` + `userCredentialTokenClass: "nonempty_opaque"` on anonymous calls; remediation is documented in [`46-phase-5.3-hosted-native-admin-context-remediation.md`](./46-phase-5.3-hosted-native-admin-context-remediation.md).
