# VIGORCORE — FASE 5.3: FINAL REPRODUCIBLE DEPLOYMENT PACKAGE FOR `vigor_api`

**Proyecto en Google AI Studio:** `Fit-X` *(trabajo estrictamente aislado en `poc/catalyst-clean-slate/`)*  
**Proyecto Zoho Catalyst:** `Project-Rainfall`  
**Project ID:** `136967000000014024`  
**Data Center:** `US`  
**Entorno objetivo:** **`Development`** *(**`Production` intacto y sin modificar**)*  
**Función:** `vigor_api` · Function ID: **`136967000000074001`** · Advanced I/O Node 22  
**Operaciones remotas ejecutadas:** **`0`**  
**Dictamen:** **`PHASE_5_3_FINAL_ARTIFACT_RECONCILED_NOT_DEPLOYED`**

---

## 1. OBJETIVO Y RESUMEN DEL PAQUETE FINAL

Se ha conciliado la reproducibilidad bit-a-bit del paquete de despliegue portable definitivo para la función Advanced I/O Node.js 22 `vigor_api`, incorporando la configuración de entorno (`VIGORCORE_DEPLOYMENT_ENVIRONMENT`), la mitigación del keyword reservado `CATALYST_ENVIRONMENT`, aislamiento estricto por `AsyncLocalStorage`, las 41 rutas canónicas de VigorCore y empaquetado determinista multiplataforma.

El informe técnico completo de la investigación de causa raíz SHA-256 y la comparación de manifiestos de contenido se encuentra en:
- `poc/catalyst-clean-slate/docs/38-phase-5.3-final-artifact-reconciliation.md`

---

## 2. MANIFIESTO EXACTO DE CONFIGURACIÓN DE ENTORNO

Para ejecutar la función en `Project-Rainfall` (`Development`), se deben configurar en la consola de Catalyst (Function Configuration → Environment Variables / Secrets) las siguientes variables obligatorias:

1. **`VIGORCORE_DEPLOYMENT_ENVIRONMENT`** = `Development`
2. **`VIGOR_ENVIRONMENT`** = `development`
3. **`CATALYST_PROJECT_ID`** = `136967000000014024`
4. **`VIGOR_CATALYST_AUTH_MODE`** = `hosted_native`
5. **`VIGOR_CORS_MODE`** = `platform_managed`
6. **`CATALYST_API_DOMAIN`** = `https://api.catalyst.zoho.com`
7. **`CATALYST_ACCOUNTS_URL`** = `https://accounts.zoho.com`
8. **`VIGOR_SESSION_ACTIVE_KID`** = `k1`
9. **`VIGOR_ALLOWED_ORIGINS`** = `https://app.vigorcore.lat`
10. **`VIGOR_SESSION_HMAC_SECRET`** = *[Secreto externo CSPRNG configurado en Catalyst Secrets — nunca incluido en el ZIP ni en repositorio]*

*(Nota: `CATALYST_ENVIRONMENT` no se configura por ser keyword reservado de la plataforma; `NODE_ENV` tampoco se fuerza manualmente).*

---

## 3. ARTEFACTO REPRODUCIBLE CANÓNICO Y SHA-256

- **Script de empaquetado TypeScript/Node.js (reproducible multiplataforma):**  
  `poc/catalyst-clean-slate/scripts/build-vigor-api-portable-package.ts`
- **Script PowerShell 5.1 equivalente (reproducible en Windows):**  
  `poc/catalyst-clean-slate/scripts/build-vigor-api-portable-package.ps1`
- **Comando canónico de compilación y empaquetado (Windows y Linux, desde la raíz de `Fit-X`):**
  ```powershell
  npx tsx poc/catalyst-clean-slate/scripts/build-vigor-api-portable-package.ts
  ```
- **Artefacto versionado definitivo:**  
  `poc/catalyst-clean-slate/artifacts/vigor_api-reproducible-portable.zip`
- **Métricas verificadas del artefacto definitivo:**
  - **Entradas ZIP:** `905` archivos (`0` entradas de directorio, `0` symlinks)
  - **Tamaño descomprimido total:** `3,751,004` bytes
  - **Tamaño comprimido:** `1,277,498` bytes (`1.22 MB`)
  - **SHA-256 reproducible (Linux & Windows via TSX):** **`31e9b71ea7af48a8483c903e206c625bbe823048bdab6db47567d8ce4cdd52fb`**

### Artefactos históricos preservados sin sobrescribir

| Artefacto | Tamaño | SHA-256 | Estado |
| :--- | ---: | :--- | :--- |
| `artifacts/vigor_api.zip` | `1,275,008` B | `d0b6e60814f50fb7e47363fb9bef725b3fa5182ae31c826c075e3bab0ec34d64` | Preservado intacto |
| `artifacts/vigor_api-portable.zip` | `1,274,771` B | `d009bcc01cb1afa77012f47bfc5307d91a1b75101231982bce4e045eda52b8d8` | Preservado intacto |
| `artifacts/vigor_api-env-audit-portable.zip` | `1,277,498` B | `a7565d2c2c121e0f585e2c65daf5204e1645819737869c0d6edb0e35af3af7a0` | Preservado intacto (contenido 100% equivalente; orden OS-dependiente) |
| `artifacts/vigor_api-reproducible-portable.zip` | `1,277,498` B | `31e9b71ea7af48a8483c903e206c625bbe823048bdab6db47567d8ce4cdd52fb` | **Artefacto final determinista recomendado** |

---

## 4. VALIDACIONES Y RESULTADOS DE PRUEBAS

- **Pruebas unitarias y de integración (`tests/01..31`):** Ejecución completa de todas las suites, incluida **`tests/31-phase-5.3-final-artifact-reconciliation.test.ts`**.
- **Compatibilidad de extracción Linux Catalyst:** Validado con `unzip -tq` y `unzip -oq` con código de salida `0`.
- **Evidencia independiente en Node.js v22 (`v22.23.2`):** Importación ESM de `dist/server/catalystEntry.js` desde el ZIP extraído responde fail-closed `503 SERVER_CONFIGURATION_UNAVAILABLE` sin exponer secretos.
- **Compilación y lint:** `npm run build`, `npm run build:server`, `npm run frontend:build`, `compile_applet` y `lint_applet` aprobados sin errores.

---

## 5. DICTAMEN FINAL

**Dictamen:** **`PHASE_5_3_FINAL_ARTIFACT_RECONCILED_NOT_DEPLOYED`**
