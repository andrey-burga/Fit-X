# VIGORCORE — ENVIRONMENT CONFIGURATION CHECKLIST (`vigor_api` · Development)

**Project:** `Fit-X` (`poc/catalyst-clean-slate/` only)  
**Catalyst Target:** `Project-Rainfall` (`136967000000014024`) · **`Development`** ONLY (`Production` untouched)  
**Function:** `vigor_api` (`136967000000074001` · Advanced I/O · Node.js 22)  
**Artifact ZIP:** `artifacts/vigor_api-vars-reconciled-portable.zip` (`cf66836ded6a82297404d0161694d5fa3b1c71a182fb825dfe2376022611c3fc`)  
**Remote Operations Executed:** `0`  
**Status:** **`PHASE_5_3_ENVIRONMENT_VARIABLE_NAMES_RECONCILED_NOT_DEPLOYED`**

---

## 1. Console Navigation Path

`Catalyst Console (US)` → **`Project-Rainfall`** (`136967000000014024`) → Top Environment Selector: **`Development`** → **Serverless** → **Functions** → **`vigor_api`** (`136967000000074001`) → **Configuration** → **Environment Variables**

---

## 2. Ten Required Environment Variables (Development)

Configure the 9 non-secret variables first, then add `VIGOR_SESSION_HMAC_SECRET`:

- [ ] `VIGORCORE_DEPLOYMENT_ENVIRONMENT` = `Development` *(already created in Console; non-reserved replacement for `CATALYST_ENVIRONMENT`)*
- [ ] `VIGOR_ENVIRONMENT` = `development` *(already created in Console)*
- [ ] `VIGORCORE_CATALYST_PROJECT_ID` = `136967000000014024` *(non-reserved replacement for `CATALYST_PROJECT_ID`)*
- [ ] `VIGOR_CATALYST_AUTH_MODE` = `hosted_native` *(already created in Console; omitting falls back to `external_oauth` and fails `503`)*
- [ ] `VIGOR_CORS_MODE` = `platform_managed` *(already created in Console)*
- [ ] `VIGORCORE_CATALYST_API_DOMAIN` = `https://api.catalyst.zoho.com` *(non-reserved replacement for `CATALYST_API_DOMAIN`)*
- [ ] `VIGORCORE_CATALYST_ACCOUNTS_URL` = `https://accounts.zoho.com` *(non-reserved replacement for `CATALYST_ACCOUNTS_URL`)*
- [ ] `VIGOR_SESSION_ACTIVE_KID` = `k1` *(already created in Console)*
- [ ] `VIGOR_ALLOWED_ORIGINS` = `https://app.vigorcore.lat` *(already created in Console; omitting falls back to `.onslate.com`, blocking `app.vigorcore.lat` with `403`)*
- [ ] `VIGOR_SESSION_HMAC_SECRET` = *(generated locally on operator workstation, canonical Base64URL, 32+ decoded bytes = 43 chars, NO whitespace/newlines, pasted directly into Catalyst Console)*

### Prohibited / Reserved Catalyst Variables
- [ ] **Verify `CATALYST_ENVIRONMENT`, `CATALYST_PROJECT_ID`, `CATALYST_API_DOMAIN`, and `CATALYST_ACCOUNTS_URL` are NOT present** (rejected by Catalyst Console as reserved keywords; runtime throws `RESERVED_CATALYST_ENV_VAR` → `503`).
- [ ] **Verify `NODE_ENV` is NOT manually configured** (not read by `@zcatalyst/*`; setting `NODE_ENV=production` without `VIGOR_ENVIRONMENT` triggers `ENVIRONMENT_SEPARATION_VIOLATION` → `503`).

---

## 3. Local HMAC Secret Generation (Windows PowerShell 5.1)

Requirements enforced by `src/auth/cleanSlateAuthGuard.ts` (`decodeAndValidateHmacSecret`):
- Canonical Base64URL (`^[A-Za-z0-9_-]+$`, no `=`, `+`, `/`, prefixes, or whitespace — runtime does **not** `.trim()`).
- Decoded length `>= 32` bytes (`256` bits, `43` Base64URL chars) and `>= 16` distinct byte values.
- Same decoded key signs and verifies HMAC-SHA256 (`__Host-vigor_session` and `X-Vigor-CSRF`); `kid=k1` needs no external registry.

Run locally on Windows PowerShell 5.1 (copies directly to clipboard without printing to console or appending `\r\n`):

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $rng.GetBytes($bytes)
    $secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    Set-Clipboard -Value $secret
    Write-Host ("Base64URL secret (len={0}) placed on clipboard." -f $secret.Length)
}
finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
    $secret = $null
    $rng.Dispose()
}
```

After pasting into Catalyst Console (`VIGOR_SESSION_HMAC_SECRET`), clear clipboard:
```powershell
Set-Clipboard -Value $null
```

---

## 4. Safe Deployment Order

1. [ ] Add the remaining **3 non-secret `VIGORCORE_CATALYST_*` variables** (`VIGORCORE_CATALYST_PROJECT_ID`, `VIGORCORE_CATALYST_API_DOMAIN`, `VIGORCORE_CATALYST_ACCOUNTS_URL`) alongside the 6 already-created `VIGOR_` / `VIGORCORE_` variables in `Project-Rainfall` → **`Development`** → `vigor_api` → Environment Variables.
2. [ ] Generate `VIGOR_SESSION_HMAC_SECRET` locally via PowerShell 5.1, paste directly in Catalyst Console, save, and clear clipboard.
3. [ ] Audit all **10 key names and non-secret values** in Catalyst Console without printing or exporting the HMAC secret; confirm `Production` was not touched.
4. [ ] Build locally (`npx tsx poc/catalyst-clean-slate/scripts/build-vigor-api-portable-package.ts`), verify SHA-256 of `artifacts/vigor_api-vars-reconciled-portable.zip` (`cf66836ded6a82297404d0161694d5fa3b1c71a182fb825dfe2376022611c3fc`), and update existing function `vigor_api` (`Development`).
5. [ ] Smoke-test `GET https://project-rainfall-943998020.development.catalystserverless.com/server/vigor_api/health` → expect HTTP `200` (`"status": "ok"`, `"routeCount": 41`).

**Status:** **`PHASE_5_3_ENVIRONMENT_VARIABLE_NAMES_RECONCILED_NOT_DEPLOYED`**
