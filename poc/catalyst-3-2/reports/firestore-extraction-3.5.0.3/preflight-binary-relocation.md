# REUBICACIÓN ARQUITECTÓNICA DEL PREFLIGHT BINARIO
## VIGORCORE ETL — FASE 3.5.0.3

**Fecha:** 11 de noviembre de 2026  
**Proyecto GCP:** `gen-lang-client-0041212770`  
**Base de Datos Firestore:** `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`  
**Estado:** REMEDIATION IMPLEMENTED — WINDOWS VERIFICATION PENDING  

---

### 1. ANTECEDENTES Y HALLAZGOS EN WINDOWS

Durante la ejecución de la Fase 3.5.0.2 en la estación física Windows mediante:
`extract-firestore.ps1 -Mode LocalSecurityAudit`

La consola técnica de PowerShell reportó:
- `preflight-token.json`: 4839 bytes, presente en `reports/firestore-extraction-3.5/`.
- `preflight-token.bin`: 534 bytes, detectado en `reports/firestore-extraction-3.5/`.
- Descifrado DPAPI: correcto bajo `DataProtectionScope.CurrentUser`.
- Hash SHA-256: coincidente.
- Detección de binario fuera de `.data/`: `poc/catalyst-3-2/reports/firestore-extraction-3.5/preflight-token.bin`.
- Dictamen de terminal: `PARTIALLY VERIFIED — BLOCKERS REMAIN`.

El informe emitido evidenció una anomalía arquitectónica: la envolvente binaria autenticada `preflight-token.bin` residía dentro del directorio de reportes (`reports/`), el cual está destinado exclusivamente a resúmenes y metadatos públicos en JSON/Markdown. Aunque el archivo estuviera cifrado con DPAPI, su ubicación violaba la política de confinamiento de artefactos binarios confidenciales en el almacenamiento protegido `.data/`.

---

### 2. NUEVA POLÍTICA DE ALMACENAMIENTO DE CONTROL

A partir de la Fase 3.5.0.3 se establece la siguiente separación canónica de rutas:

| Artefacto | Nueva Ubicación de Referencia | Naturaleza | Política de Control |
|---|---|---|---|
| **Preflight Token (Legible)** | `poc/catalyst-3-2/reports/firestore-extraction-3.5/preflight-token.json` | Texto plano JSON | Inspección de operador y auditoría estática. Cero secretos, cero tokens ADC, UIDs anonimizados (`USER_001`..`USER_005`). |
| **Sobre Cifrado (Binario)** | `poc/catalyst-3-2/.data/firestore-export/control/preflight-token.bin` | Binario DPAPI | Confinado en `.data/` bajo subdirectorio de control con herencia NTFS desactivada y permisos exclusivos al usuario ejecutor. |
| **Checkpoint de Extracción** | `poc/catalyst-3-2/.data/firestore-export/control/checkpoint.bin` | Binario DPAPI | Estado de reanudación y cursor posicional. Confinado en `.data/.../control/`. |
| **Mapeo de Identidades** | `poc/catalyst-3-2/.data/firestore-export/control/id-mapping.bin` | Binario DPAPI | Mapeo invertible y confidencial. Confinado en `.data/.../control/`. |

---

### 3. AUDITORÍA DE REFERENCIAS OPERATIVAS ACTUALIZADAS

Se auditaron y actualizaron todas las referencias dentro del script principal `poc/catalyst-3-2/scripts/extract-firestore.ps1`:

1. **Definición de Rutas (Líneas 108–122):**
   ```powershell
   $controlDir = Join-Path $resolvedCacheDir 'control'
   $preflightTokenPath          = Join-Path $resolvedReportDir 'preflight-token.json'
   $preflightTokenBinPath       = Join-Path $controlDir 'preflight-token.bin'
   $legacyPreflightTokenBinPath = Join-Path $resolvedReportDir 'preflight-token.bin'
   ```
2. **Generación en Modo Preflight (Líneas 580–600):**
   - Asegura la creación de `$controlDir` con permisos restrictivos antes de la escritura.
   - Escribe el ciphertext exclusivamente en `$preflightTokenBinPath` (`.data/firestore-export/control/preflight-token.bin`).
3. **Validación en Modo Extract (Control 2, Líneas 648–658):**
   - Busca `preflight-token.bin` estrictamente en `$controlDir`.
   - Si detecta que permanece en la ruta antigua `reports/`, bloquea la ejecución de inmediato solicitando al operador ejecutar la migración o un nuevo Preflight.
4. **Modo LocalSecurityAudit (Líneas 1290–1330):**
   - Verifica la presencia en `control/`. Si el binario sigue en `reports/`, registra `UNALLOWED_BINARY_LOCATION` y `PREFLIGHT_BINARY_MISSING`.

---

### 4. GARANTÍA DE MIGRACIÓN SIN ALTERACIÓN DE BYTES

Para trasladar el binario generado previamente en Windows sin requerir descifrarlo ni alterar un solo bit, se implementó el script complementario:
`poc/catalyst-3-2/scripts/migrate-preflight-binary.ps1`

Dicho script calcula el hash SHA-256 antes del movimiento y tras el movimiento, asegurando integridad criptográfica absoluta y purga segura del archivo antiguo de `reports/`.

---

### 5. CONCLUSIÓN

La reubicación del preflight binario en `.data/firestore-export/control/preflight-token.bin` cumple a cabalidad con el aislamiento de artefactos confidenciales y elimina toda referencia operativa residual a la ruta anterior.
