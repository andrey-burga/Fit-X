# VIGORCORE — FASE 5.3: RECONCILIACIÓN DE NOMBRES DE VARIABLES RESERVADAS EN CATALYST

**Proyecto:** `Fit-X` *(directorio aislado `poc/catalyst-clean-slate/`)*  
**Proyecto Catalyst:** `Project-Rainfall` (`136967000000014024`) · Región `US`  
**Función:** `vigor_api` (`136967000000074001` · Advanced I/O · Node.js 22)  
**Entorno objetivo:** **`Development`** *(`Production` intacto y sin modificar)*  
**Operaciones remotas ejecutadas:** **`0`**  
**Dictamen:** **`PHASE_5_3_ENVIRONMENT_VARIABLE_NAMES_RECONCILED_NOT_DEPLOYED`**

---

## 1. EVIDENCIA OBSERVADA DE PALABRAS RESERVADAS EN CATALYST CONSOLE

| Variable / Prefijo | Resultado observado en Catalyst Console (`Development`) | Evidencia SDK local (`@zcatalyst/*` v1.1.0) |
| :--- | :--- | :--- |
| `VIGOR_CATALYST_AUTH_MODE`, `VIGOR_ALLOWED_ORIGINS`, `VIGOR_ENVIRONMENT`, `VIGORCORE_DEPLOYMENT_ENVIRONMENT`, `VIGOR_CORS_MODE`, `VIGOR_SESSION_ACTIVE_KID` | **Aceptadas (6/6)** sin error | Variables propiedad de VigorCore; sin colisión con plataforma |
| `CATALYST_ENVIRONMENT` | **Rechazada** (`environment_variables must not contain reserved keywords`) | `@zcatalyst/*` no publica lista exhaustiva de keywords reservados en consola; internamente lee `X_ZOHO_CATALYST_*`, `CATALYST_PORTAL_DOMAIN` y cabeceras `x-zc-*` |
| `CATALYST_PROJECT_ID` | **Rechazada** (`environment_variables must not contain reserved keywords`) | Comparte el prefijo `CATALYST_*` rechazado en los 4 casos observados; no debe asumirse una lista oficial pública más allá de esta evidencia empírica |
| `CATALYST_API_DOMAIN` | **Rechazada** (`environment_variables must not contain reserved keywords`) | `@zcatalyst/utils@1.1.0` define `CONSTANTS.CATALYST_ORIGIN = "https://api.catalyst.zoho.com"` |
| `CATALYST_ACCOUNTS_URL` | **Rechazada** (`environment_variables must not contain reserved keywords`) | `@zcatalyst/utils@1.1.0` define `CONSTANTS.ACCOUNTS_ORIGIN = "https://accounts.zoho.com"` |

---

## 2. RECONCILIACIÓN ADOPTADA Y COMPORTAMIENTO FAIL-CLOSED

Se adoptan los tres nombres personalizados propiedad de la aplicación y libres del prefijo reservado `CATALYST_*`:

| Clave reservada retirada | Nueva variable canónica VigorCore | Valor `Development` | Protección Fail-Closed |
| :--- | :--- | :--- | :--- |
| `CATALYST_PROJECT_ID` | **`VIGORCORE_CATALYST_PROJECT_ID`** | `136967000000014024` | Pinning obligatorio de proyecto (`503 MISSING_CATALYST_ADMIN_CONFIG` si falta; `403 PROJECT_CONTEXT_MISMATCH` si `x-zc-projectid` difiere; nunca controlado por cliente) |
| `CATALYST_API_DOMAIN` | **`VIGORCORE_CATALYST_API_DOMAIN`** | `https://api.catalyst.zoho.com` | Preflight exige declaración HTTPS US explícita; runtime valida HTTPS y puede caer de forma segura a `CONSTANTS.CATALYST_ORIGIN` US si se omite |
| `CATALYST_ACCOUNTS_URL` | **`VIGORCORE_CATALYST_ACCOUNTS_URL`** | `https://accounts.zoho.com` | Preflight exige coherencia regional US con `VIGORCORE_CATALYST_API_DOMAIN`; runtime valida HTTPS y puede caer de forma segura a `CONSTANTS.ACCOUNTS_ORIGIN` US si se omite |

Cualquier presencia de `CATALYST_PROJECT_ID`, `CATALYST_API_DOMAIN`, `CATALYST_ACCOUNTS_URL` o `CATALYST_ENVIRONMENT` es rechazada de inmediato en `src/sdk/catalystSdkBridge.ts` y `src/provisioning/catalystConfigPreflight.ts` con **`RESERVED_CATALYST_ENV_VAR`**.

---

## 3. NUEVO ARTEFACTO PORTABLE DETERMINISTA Y COMANDO WINDOWS

Para reflejar los nuevos lectores en `dist/sdk/catalystSdkBridge.js` preservando intactos los cuatro ZIPs anteriores:

- **Comando exacto en Windows PowerShell (desde la raíz del repositorio):**
  ```powershell
  npx tsx poc/catalyst-clean-slate/scripts/build-vigor-api-portable-package.ts
  ```
- **Artefacto generado:** `poc/catalyst-clean-slate/artifacts/vigor_api-vars-reconciled-portable.zip`
- **Entradas:** `905` · **Descomprimido:** `3,754,947` bytes · **Tamaño ZIP:** `1,277,920` bytes (`1.22 MB`)
- **SHA-256 esperado:** **`cf66836ded6a82297404d0161694d5fa3b1c71a182fb825dfe2376022611c3fc`**

Los artefactos previos (`vigor_api.zip`, `vigor_api-portable.zip`, `vigor_api-env-audit-portable.zip`, `vigor_api-reproducible-portable.zip`) permanecen preservados bit-a-bit sin sobrescribirse.

---

## 4. DICTAMEN

**`PHASE_5_3_ENVIRONMENT_VARIABLE_NAMES_RECONCILED_NOT_DEPLOYED`**
