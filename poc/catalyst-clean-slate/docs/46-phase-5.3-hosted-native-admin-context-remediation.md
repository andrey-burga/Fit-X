# VigorCore Phase 5.3 — Forensic Finding and Hosted-Native Authentication Remediation (`vigor_api`)

- **Scope:** `poc/catalyst-clean-slate/` only (`vigor_api`, Project-Rainfall `136967000000014024`, Catalyst Development, Node.js 22)
- **Remote Operations Executed:** **0** (strictly local SDK audit, minimal source remediation, deterministic artifact packaging, and local `127.0.0.1:0` verification)
- **Final Status:** **`HOSTED_NATIVE_ADMIN_CONTEXT_REMEDIATION_READY_FOR_REVIEW`**

---

## 1. Confirmed Live Evidence & Installed SDK / Platform Contract Proof

### Confirmed Live Catalyst Application Log (`phase-5.3-403-forensic-diag-v2`)
An anonymous PowerShell/curl request to Catalyst Development (`GET /api/v1/athlete/workspace`) returned `403 CATALYST_ADMIN_HEADER_SPOOFED` and logged:
- `xZcUserTypeIsAdmin: true`
- `hasXZcUserCredToken: true`
- `userCredentialTokenClass: "nonempty_opaque"`
- `hasXZcCookie: false`, `recognizedCookieNames: []`, `matchedCookieRules: ["none"]`, `hasSanitizedZcCookieCredential: false`

The live 403 was caused solely by Catalyst Edge sending a nonempty opaque `x-zc-user-cred-token` value alongside `x-zc-user-type=admin` on an anonymous request.

### Verified Installed SDK Source Contract
Inspection of installed packages inside `poc/catalyst-clean-slate/node_modules/@zcatalyst/` confirms:

1. **`@zcatalyst/auth-admin@1.1.0` (`dist-es/credential.js:245-317`, `CatalystCredential`):**
   - Reads `x-zc-user-type`, `x-zc-user-cred-token`, `x-zc-user-cred-type`, `x-zc-cookie`, `x-zc-admin-cred-type`, and `x-zc-admin-cred-token` from Advanced I/O incoming request headers.
   - Line 253–257: `this.userType = credObj['x-zc-user-type'] === CREDENTIAL_USER.admin ? CREDENTIAL_USER.admin : CREDENTIAL_USER.user; this.scope = scope || this.userType;`
   - Line 258–264:
     ```js
     if (this.scope === CREDENTIAL_USER.user) {
       if (this.userType === CREDENTIAL_USER.admin) {
         throw new CatalystAuthError('AUTH_ERROR', 'User not authenticated. Please login to proceed with user scope', ...);
       }
       if (this.userToken === undefined && this.cookieStr === undefined) {
         throw new CatalystAuthError('INVALID_CREDENTIAL', 'missing user credentials', ...);
       }
     }
     ```
   - Line 295–296: When `scope === 'admin'`, `getToken()` returns `this.adminCred.getToken()` and ignores `this.userToken`.
   - **Why `x-zc-user-cred-token` can be nonempty anonymously without breaking Catalyst SDK:** Internal Catalyst Edge proxy code is outside the npm tarball, but `CatalystCredential` explicitly ignores `userToken` under `scope: 'admin'` and rejects `this.userType === 'admin'` under `scope: 'user'` **before** inspecting `userToken` or `cookieStr`.

2. **`@zcatalyst/transport@1.1.0` (`dist-es/http-handler.js:300-302`):**
   - Outbound SDK requests set `X-CATALYST-USER = this.app.credential.getCurrentUserType()` (`'admin'` when admin execution context applies).

3. **`@zcatalyst/auth@1.0.0` (`dist-es/user-management.js:22-32`):**
   - `UserManagement.getCurrentUser()` performs `GET /project-user/current` with `expectingType: ['USER']` under `scope: 'user'`. When initialized against an admin execution context, `CatalystCredential` immediately throws `"User not authenticated. Please login to proceed with user scope"`.

4. **Official Zoho Catalyst Documentation (FAQ):**
   - Confirms that if the client portal user is not authenticated before triggering an Advanced I/O function, Catalyst falls back to admin authentication and `getCurrentUser()` returns `null`.

**Contract Conclusion:** The official `@zcatalyst/*` SDK contract directly distinguishes an authenticated Catalyst project user (`x-zc-user-type !== 'admin'`) from an unauthenticated Advanced I/O admin fallback context (`x-zc-user-type === 'admin'`) regardless of `x-zc-user-cred-token` content.

---

## 2. Minimal `hosted_native` Remediation & Edge `x-zc-*` Trust Boundary

### Source Changes (`src/sdk/catalystSdkBridge.ts`)
1. **`HostedNativeCatalystAuthRuntime.getCurrentUserFromRequest()`:**
   - Continues validating `x-zc-projectid`, `x-zc-project-key`, and `x-zc-environment` against server-pinned config (`403 PROJECT_CONTEXT_MISMATCH`).
   - Checks `x-zc-user-type` before inspecting `x-zc-user-cred-token` / `x-zc-cookie`: when `x-zc-user-type` equals `'admin'` (case-insensitive), immediately returns `null` without constructing `ZCAuth` (`scope: 'user'`) and without calling `UserManagement.getCurrentUser()`.
   - `CleanSlateAuthGuard` Path 1 (`catalyst_exchange`) and Path 2 (no `__Host-vigor_session`) fail closed with `401 UNAUTHENTICATED` and `0` NoSQL reads/writes.
2. **`HostedNativeCatalystAuthRuntime.hasRequestCatalystUserCredential()`:**
   - Returns `false` immediately when `x-zc-user-type` equals `'admin'` (case-insensitive).
   - Path 3 requests carrying `__Host-vigor_session` plus Catalyst Edge's admin context + nonempty opaque `x-zc-user-cred-token` skip `UserManagement.getCurrentUser()` (`0` BaaS hits) while executing full HMAC-SHA256 verification, `Users` (`consistent_read`), `SystemControl` `SESSION#<sid>` (`consistent_read`), expiry, revocation, `sessionEpoch`, RBAC, `X-Vigor-CSRF`, and periodic BaaS live revalidation (`15 min` window via `getUserDetails()`).
3. **`CatalystSeparatedAuthRuntime` (`external_oauth`) Preserved Unchanged:**
   - Because `external_oauth` may run behind non-Catalyst proxies where an incoming `x-zc-user-type=admin` header alongside user credentials represents an anomalous client/proxy header contradiction, `CatalystSeparatedAuthRuntime` keeps strict `403 CATALYST_ADMIN_HEADER_SPOOFED` enforcement while still returning `null` when `x-zc-user-type=admin` appears without user credentials.

### Edge `x-zc-*` Trust Boundary & Threat Analysis
- **What client-side inspection proves vs cannot prove:** SDK source proves how `@zcatalyst/auth-admin` interprets `x-zc-*` headers, whereas whether Catalyst Edge strips or overwrites client-supplied `x-zc-*` headers on direct Function URL calls cannot be proven from local client code alone without live gateway testing.
- **Why returning `null` on `x-zc-user-type=admin` is strictly fail-closed even under spoofing:**
  - If an external attacker injects `x-zc-user-type: admin` (with or without `x-zc-user-cred-token`), `HostedNativeCatalystAuthRuntime.getCurrentUserFromRequest()` returns `null` -> Path 1 & Path 2 reject `401 UNAUTHENTICATED` (`0` BaaS calls, `0` NoSQL calls) and Path 3 ignores Catalyst headers and relies strictly on server-verified HMAC + `Users`/`SystemControl`.
  - Authoritative role elevation NEVER reads `x-zc-user-type`; roles (`athlete` / `coach` / `admin`) come exclusively from authoritative `Users` records keyed by verified identity.

---

## 3. Access Log Item `136967000000014007` & Timestamp Correlation Evidence Gap Audit

- **Inspection Scope:** Searched the entire workspace for `136967000000014007` (`0` matches in source, manifests, configs, or docs).
- **Evidence Gap Observed in Operator Input:**
  1. Neither the **Catalyst Access Log table/column headers** nor the **Access Log row** containing `136967000000014007` were included in the task prompt.
  2. Neither the **Access Log timestamp** nor the **Application Log timestamp** were supplied in the task prompt (only the Application Log JSON payload fields `event`, `buildId`, `authRuntimeMode`, `method`, `route`, etc. were provided).
- **Documented Zoho Catalyst Access Log Reference (for operator comparison in Console):**
  - Catalyst Console Access Logs normally display columns including `Function Name`, `User ID`, `Invocation URL`, `Time of Execution`, `Request Method`, `Host Address`, `HTTP Response Status`, and `Response Time`.
  - Note: `136967000000014007` is numeric/distinct from Function ID `136967000000074001` and Project ID `136967000000014024` (same org/project ID prefix range `136967000000014xxx`).
- **Strict Non-Inference Statement:** Because the exact column header above `136967000000014007` and both log timestamps are missing from the supplied evidence, VigorCore **does not** infer whether `136967000000014007` represents an anonymous Zoho/Catalyst execution principal ID, a `User ID` column value, or another column, and **does not** claim exact 1:1 request correlation between the Access Log entry and the Application Log entry until both column header and timestamps are supplied.

---

## 4. Reproducible Deployment Candidate Artifact & Preservation

Both prior deployment candidates remain **untouched and byte-identical**:
- `artifacts/vigor_api-auth-reconciled-portable.zip`: SHA-256 `d268c7bfa12ed4ec8d4765e38516e416957120ccc9d47a8c32a6f6ccffc20319` (preserved)
- `artifacts/vigor_api-auth-forensic-diagnostic-portable.zip`: SHA-256 `c9ade1264bc340560d1b503544162df50d78cf41949ecb37642a416caf8b2839` (preserved)

New separate remediated deployment candidate built with the existing deterministic portable builder (`scripts/build-vigor-api-portable-package.ts`):
- **ZIP:** `artifacts/vigor_api-hosted-admin-remediated-portable.zip`
- **Manifest:** `artifacts/vigor_api-hosted-admin-remediated-portable.manifest.json`
- **Entry Count:** `905` files (strict code-point order, `1980-01-01 00:00:00` DOS epoch, DEFLATE level 6)
- **Uncompressed Size:** `3,768,912` bytes
- **ZIP Size:** `1,281,449` bytes (`1.22` MB)
- **SHA-256 (verified twice deterministically):** `6b64d440aafbfc7c6e19ea4f5a8617b84056fc7f2494307e6685e04b76de618f`
- **Exact Compiled Delta vs `vigor_api-auth-forensic-diagnostic-portable.zip`:** `0` missing, `0` unexpected, **`1` modified file** (`dist/sdk/catalystSdkBridge.js`).

---

## 5. Final Verdict

**Status:** **`HOSTED_NATIVE_ADMIN_CONTEXT_REMEDIATION_READY_FOR_REVIEW`**
