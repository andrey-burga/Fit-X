# VIGORCORE — FASE 5.3: FINAL REPRODUCIBLE DEPLOYMENT PACKAGE & ENV AUDIT FOR `vigor_api`

**Proyecto en Google AI Studio:** `Fit-X` *(trabajo estrictamente aislado en `poc/catalyst-clean-slate/`)*  
**Proyecto Zoho Catalyst:** `Project-Rainfall`  
**Project ID:** `136967000000014024`  
**Data Center:** `US`  
**Entorno objetivo:** **`Development`** *(**`Production` intacto y sin modificar**)*  
**Función:** `vigor_api` · Function ID: **`136967000000074001`** · Advanced I/O Node 22  
**Operaciones remotas ejecutadas:** **`0`**  
**Dictamen artefacto reproducible:** **`PHASE_5_3_FINAL_ARTIFACT_RECONCILED_NOT_DEPLOYED`**  
**Dictamen configuración de entorno:** **`PHASE_5_3_ENVIRONMENT_VARIABLE_NAMES_RECONCILED_NOT_DEPLOYED`**

---

## 1. OBJETIVO Y RESUMEN DEL PAQUETE FINAL

Se ha conciliado la reproducibilidad bit-a-bit del paquete de despliegue portable definitivo para la función Advanced I/O Node.js 22 `vigor_api` y se ha auditado línea por línea cada variable de entorno requerida y la codificación exacta de `VIGOR_SESSION_HMAC_SECRET`.

Documentos complementarios de soporte:
- Reconciliación SHA-256 del artefacto: `poc/catalyst-clean-slate/docs/38-phase-5.3-final-artifact-reconciliation.md`
- Checklist operativo de configuración de entorno y secreto HMAC: `poc/catalyst-clean-slate/docs/39-phase-5.3-environment-configuration-checklist.md`

---

## 2. AUDITORÍA EXACTA DE VARIABLES DE ENTORNO (DEVELOPMENT)

Todas las validaciones de configuración ocurren de forma perezosa al recibir la primera petición en `src/server/catalystEntry.ts` (`getOrInitializeAdvancedIoRuntime` → `createVigorCoreProductionRuntimeFromEnv`). Cualquier fallo de configuración responde HTTP **`503 SERVER_CONFIGURATION_UNAVAILABLE`** en todos los endpoints (incluido `GET /health`) con secretos redactados.

| Variable | Valor Exacto (`Development`) | Estado en Runtime / Preflight | Ubicación de Lectura en Runtime | Comportamiento si falta o es inválida | ¿Reservada por Catalyst? |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **`VIGORCORE_DEPLOYMENT_ENVIRONMENT`** | `Development` | **Obligatoria** | `src/sdk/catalystSdkBridge.ts` (`resolveDeploymentEnvironmentFromEnv`) | Lanza `INVALID_DEPLOYMENT_ENVIRONMENT` (`RESERVED_CATALYST_ENV_VAR` si existe `CATALYST_ENVIRONMENT`) → **`503`** | No |
| **`VIGOR_ENVIRONMENT`** | `development` | **Obligatoria** (preflight) / fallback `'development'` o `NODE_ENV` | `src/sdk/catalystSdkBridge.ts`, `src/auth/cleanSlateAuthGuard.ts` | Si falta y `NODE_ENV=production`, falla con `ENVIRONMENT_SEPARATION_VIOLATION` → **`503`**; fija claim `env` del token | No |
| **`VIGORCORE_CATALYST_PROJECT_ID`** | `136967000000014024` | **Obligatoria** | `src/sdk/catalystSdkBridge.ts` (`resolveCatalystProjectIdFromEnv` / `validateHostedNativeConfig`) | Falta → `MISSING_CATALYST_ADMIN_CONFIG`; uso de `CATALYST_PROJECT_ID` → `RESERVED_CATALYST_ENV_VAR` → **`503`** | No *(reemplaza a `CATALYST_PROJECT_ID`)* |
| **`VIGOR_CATALYST_AUTH_MODE`** | `hosted_native` | **Obligatoria en Catalyst** (si falta usa `'external_oauth'`) | `src/server/advancedIoApp.ts` (`resolveCatalystRuntimeAuthMode`) | Si falta cae a `external_oauth` y falla con `MISSING_CATALYST_ADMIN_CONFIG` (`CATALYST_PROJECT_KEY`) → **`503`** | No |
| **`VIGOR_CORS_MODE`** | `platform_managed` | **Operativa obligatoria** (si falta usa `'express_enforced'`) | `src/server/advancedIoApp.ts` (`resolveCorsHandlingMode`) | Valor desconocido lanza `INVALID_CORS_MODE` → **`503`**; omitirla duplicaría cabeceras CORS con CloudScale | No |
| **`VIGORCORE_CATALYST_API_DOMAIN`** | `https://api.catalyst.zoho.com` | **Obligatoria** (preflight) / fallback `CONSTANTS.CATALYST_ORIGIN` US SDK en runtime | `src/sdk/catalystSdkBridge.ts` (`resolveCatalystApiDomainFromEnv` / `validateHostedNativeConfig`) | URL inválida o no HTTPS → **`503`**; uso de `CATALYST_API_DOMAIN` → `RESERVED_CATALYST_ENV_VAR` | No *(reemplaza a `CATALYST_API_DOMAIN`)* |
| **`VIGORCORE_CATALYST_ACCOUNTS_URL`** | `https://accounts.zoho.com` | **Obligatoria** (preflight) / fallback `CONSTANTS.ACCOUNTS_ORIGIN` US SDK en runtime | `src/sdk/catalystSdkBridge.ts` (`resolveCatalystAccountsUrlFromEnv` / `validateHostedNativeConfig`) | URL inválida o no HTTPS → **`503`**; uso de `CATALYST_ACCOUNTS_URL` → `RESERVED_CATALYST_ENV_VAR` | No *(reemplaza a `CATALYST_ACCOUNTS_URL`)* |
| **`VIGOR_SESSION_HMAC_SECRET`** | `[GENERAR_LOCAL_Y_CARGAR_EN_CATALYST]` | **Obligatoria (secreto externo)** | `src/auth/cleanSlateAuthGuard.ts` (`ServerSessionTokenManager.fromEnvironment`), `src/server/advancedIoApp.ts` | Falta → `MISSING_SESSION_HMAC_SECRET`; formato/tamaño/entropía inválidos → `SESSION_SECRET_*` → **`503`** | No |
| **`VIGOR_SESSION_ACTIVE_KID`** | `k1` | **Opcional** (default `'k1'`) | `src/auth/cleanSlateAuthGuard.ts` (`ServerSessionTokenManager.fromEnvironment`), `src/server/advancedIoApp.ts` | Espacios en blanco → `INVALID_KEY_ID` → **`503`**; no requiere registro externo | No |
| **`VIGOR_ALLOWED_ORIGINS`** | `https://app.vigorcore.lat` | **Operativa obligatoria** (fallback `https://fit-x-bhnatsxl.onslate.com`) | `src/server/advancedIoApp.ts` (`parseAllowedOriginsEnv`), `src/security/httpSecurityPolicy.ts` | Si falta, rechaza `https://app.vigorcore.lat` con `403`; `*` o `http://` lanzan `INVALID_CORS_CONFIG` / `INSECURE_CORS_ORIGIN` → **`503`** | No |

**Reglas estrictas sobre claves excluidas / reservadas:**
- **`CATALYST_ENVIRONMENT`, `CATALYST_PROJECT_ID`, `CATALYST_API_DOMAIN`, `CATALYST_ACCOUNTS_URL`:** **NUNCA configurar.** Fueron rechazadas empíricamente en Catalyst Console con `environment_variables must not contain reserved keywords` y están bloqueadas explícitamente en runtime/preflight con **`RESERVED_CATALYST_ENV_VAR`**. Usar exclusivamente **`VIGORCORE_DEPLOYMENT_ENVIRONMENT`**, **`VIGORCORE_CATALYST_PROJECT_ID`**, **`VIGORCORE_CATALYST_API_DOMAIN`** y **`VIGORCORE_CATALYST_ACCOUNTS_URL`**.
- **`NODE_ENV`:** **NO configurar manualmente.** Ningún paquete `@zcatalyst/*` consume `NODE_ENV`, el entrypoint Express no lo requiere y fijar `NODE_ENV=production` sin `VIGOR_ENVIRONMENT=development` provocaría un bloqueo `ENVIRONMENT_SEPARATION_VIOLATION` frente a `VIGORCORE_DEPLOYMENT_ENVIRONMENT=Development`.

---

## 3. CODIFICACIÓN EXACTA DE `VIGOR_SESSION_HMAC_SECRET` Y GENERACIÓN LOCAL SEGURA

Auditado directamente sobre `decodeAndValidateHmacSecret()` y `ServerSessionTokenManager` en `poc/catalyst-clean-slate/src/auth/cleanSlateAuthGuard.ts`:

- **Codificación:** **Base64URL canónico** (`Buffer.from(secret, 'base64url')`, alfabeto `^[A-Za-z0-9_-]+$`, sin relleno `=`, sin `+` ni `/`; no es UTF-8 literal ni hexadecimal).
- **Longitud mínima:** **`32` bytes decodificados (256 bits)** y al menos `16` valores de byte distintos (`43` caracteres Base64URL exactos para `32` bytes).
- **Sin `trim()` en runtime:** `ServerSessionTokenManager.fromEnvironment()` no recorta espacios ni saltos de línea; cualquier espacio o `\r\n` falla inmediatamente con `SESSION_SECRET_MALFORMED` → **`503`**.
- **Sin prefijos:** No usar `base64:`, `base64url:`, `hex:` ni similares.
- **Firma y verificación:** La misma clave decodificada (`keyBytes`) firma y verifica `__Host-vigor_session` y `X-Vigor-CSRF` con HMAC-SHA256 y `crypto.timingSafeEqual`. `VIGOR_SESSION_ACTIVE_KID=k1` se incluye en los claims `kid` en memoria y no requiere tabla ni registro adicional.

### Comando local seguro para Windows PowerShell 5.1 (no imprime el secreto en consola)
```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $rng.GetBytes($bytes)
    $secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    Set-Clipboard -Value $secret
    Write-Host ("Base64URL secret (len={0}) copied to clipboard without newlines. Paste in Catalyst Console and clear clipboard." -f $secret.Length)
}
finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
    $secret = $null
    $rng.Dispose()
}
```
*(No usar `| clip`, ya que `clip.exe` añade `\r\n` y provocaría error `SESSION_SECRET_MALFORMED`).*

---

## 4. RUTA DE CONSOLA CATALYST Y SECUENCIA DE DESPLIEGUE RECOMENDADA

**Ruta exacta en consola:**  
`Catalyst Console` (`https://console.catalyst.zoho.com`, US) → Proyecto **`Project-Rainfall`** (`136967000000014024`) → Selector de entorno **`Development`** *(verificar no estar en `Production`)* → **Serverless → Functions → `vigor_api` (`136967000000074001`) → Configuration → Environment Variables**.

**Secuencia segura recomendada (pendiente de ejecución por operador):**
1. Cargar en `vigor_api` (`Development`) las **9 variables no secretas** con nombres no reservados (`VIGORCORE_CATALYST_PROJECT_ID`, `VIGORCORE_CATALYST_API_DOMAIN`, `VIGORCORE_CATALYST_ACCOUNTS_URL`, etc.), sin `CATALYST_ENVIRONMENT`, `CATALYST_PROJECT_ID`, `CATALYST_API_DOMAIN`, `CATALYST_ACCOUNTS_URL` ni `NODE_ENV`.
2. Generar `VIGOR_SESSION_HMAC_SECRET` localmente en PowerShell 5.1 al portapapeles (`Set-Clipboard -Value`), pegarlo sin espacios ni saltos de línea en Catalyst Console, guardar y limpiar el portapapeles (`Set-Clipboard -Value $null`).
3. Verificar la configuración completa en consola (10 claves presentes, nombres y mayúsculas/minúsculas exactos) sin exponer ni registrar el secreto.
4. Actualizar el código de la función existente `vigor_api` en `Development` usando `artifacts/vigor_api-vars-reconciled-portable.zip` (SHA-256 `cf66836ded6a82297404d0161694d5fa3b1c71a182fb825dfe2376022611c3fc`).
5. Probar `GET https://project-rainfall-943998020.development.catalystserverless.com/server/vigor_api/health` esperando HTTP `200` (`{ "success": true, "routeCount": 41, "status": "ok" }`).

*(Mantener **`Production`** intacto y sin cambios).*

---

## 5. ARTEFACTO REPRODUCIBLE CANÓNICO Y TRAZABILIDAD SHA-256

- **Script de empaquetado TypeScript/Node.js:** `poc/catalyst-clean-slate/scripts/build-vigor-api-portable-package.ts`
- **Artefacto versionado definitivo:** `poc/catalyst-clean-slate/artifacts/vigor_api-vars-reconciled-portable.zip`
- **Métricas verificadas:** `905` entradas · `3,754,947` bytes descomprimidos · `1,277,920` bytes (`1.22 MB`) · SHA-256 **`cf66836ded6a82297404d0161694d5fa3b1c71a182fb825dfe2376022611c3fc`**

### Artefactos históricos preservados sin sobrescribir

| Artefacto | Tamaño | SHA-256 | Estado |
| :--- | ---: | :--- | :--- |
| `artifacts/vigor_api.zip` | `1,275,008` B | `d0b6e60814f50fb7e47363fb9bef725b3fa5182ae31c826c075e3bab0ec34d64` | Preservado intacto |
| `artifacts/vigor_api-portable.zip` | `1,274,771` B | `d009bcc01cb1afa77012f47bfc5307d91a1b75101231982bce4e045eda52b8d8` | Preservado intacto |
| `artifacts/vigor_api-env-audit-portable.zip` | `1,277,498` B | `a7565d2c2c121e0f585e2c65daf5204e1645819737869c0d6edb0e35af3af7a0` | Preservado intacto |
| `artifacts/vigor_api-reproducible-portable.zip` | `1,277,498` B | `31e9b71ea7af48a8483c903e206c625bbe823048bdab6db47567d8ce4cdd52fb` | Preservado intacto |
| `artifacts/vigor_api-vars-reconciled-portable.zip` | `1,277,920` B | `cf66836ded6a82297404d0161694d5fa3b1c71a182fb825dfe2376022611c3fc` | **Artefacto final determinista vigente** |

---

## 6. DICTAMEN FINAL

- **Artefacto:** **`PHASE_5_3_FINAL_ARTIFACT_RECONCILED_NOT_DEPLOYED`**
- **Variables de entorno reconciliadas:** **`PHASE_5_3_ENVIRONMENT_VARIABLE_NAMES_RECONCILED_NOT_DEPLOYED`**
