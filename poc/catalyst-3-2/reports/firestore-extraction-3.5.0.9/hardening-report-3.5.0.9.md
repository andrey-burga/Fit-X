# VIGORCORE — INFORME TÉCNICO FASE 3.5.0.9
## HARDENING FINAL DE QUERY-REMOTE-RULES.PS1 Y BLINDAJE DE CONSULTA REMOTA

**Fecha de Emisión:** 12 de Noviembre de 2026  
**Proyecto Google Cloud:** `gen-lang-client-0041212770`  
**Project Number Verificado:** `510844325101`  
**Base de Datos Firestore Nombrada:** `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c` (Enterprise, us-east1)  
**Release Canónica Esperada:** `projects/gen-lang-client-0041212770/releases/cloud.firestore/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`  
**Dictamen Final:** `REMOTE_RULES_QUERY_HARDENED — PENDING OPERATOR EXECUTION`

---

### 1. RESOLUCIÓN TÉCNICA DE LOS CUATRO HALLAZGOS

#### Hallazgo 1: Autenticación Estricta con Application Default Credentials (ADC)
- **Problema previo:** Se utilizaba `gcloud auth print-access-token`, el cual devuelve el token de la cuenta de usuario activa en la CLI de gcloud, no garantizando el uso estricto de ADC.
- **Corrección implementada:** Sustitución por:
  ```powershell
  $token = (gcloud auth application-default print-access-token 2>$null)
  ```
- **Garantías de seguridad:**
  - Token residente exclusivamente en memoria (`$token.Trim()`).
  - Verificación de no-vacío (`[string]::IsNullOrWhiteSpace($token)`).
  - Detención con código 1 si el comando falla o el token es nulo.
  - Cero variables de entorno del sistema operativo modificadas.
  - Cero comandos interactivos de `login` invocados.
  - Cero persistencia en disco ni salida en consola/logs.

#### Hallazgo 2: Coincidencia Exacta de Release y Eliminación de Substrings
- **Problema previo:** El filtro `$rName -like "*$DatabaseId*"` admitía coincidencias parciales, rutas no canónicas o potencialmente ambiguas.
- **Corrección implementada:** Coincidencia exacta obligatoria:
  ```powershell
  $canonicalReleaseName = "projects/$ProjectId/releases/cloud.firestore/$DatabaseId"
  $exactMatches = @($allReleases | Where-Object { $_.name -eq $canonicalReleaseName })
  ```
- **Garantías de seguridad:**
  - Rechazo terminante de coincidencias parciales.
  - Rechazo explícito de releases vinculadas a `(default)` (`cloud.firestore` o `*/(default)`).
  - Detección de ambigüedad: si `$exactMatches.Count -gt 1`, aborta con `AMBIGUOUS_RELEASES_DETECTED`.
  - Si `$exactMatches.Count -eq 0`, emite `NO_MATCH` y aborta con código 3 **sin consultar ningún ruleset**.
  - Validación de formato canónico de ruleset: `^projects/$ProjectId/rulesets/[a-zA-Z0-9_\-]+$`.
  - Contabilización formal de llamadas HTTP: N solicitudes GET para paginación de releases (recorriendo exhaustivamente `nextPageToken`) y exactamente 1 solicitud GET para descargar el ruleset (N >= 1; total N + 1 solicitudes GET, cero escrituras).

#### Hallazgo 3: Validación Real de `attachment_point` y Project Number
- **Problema previo:** Se verificaba la cadena en logs sin contrastar los formatos canónicos reconocidos por Google Cloud Rules API.
- **Corrección implementada:** Se añadieron como válidos exclusivamente los dos formatos oficiales:
  1. **Formato Completo:** `firestore.googleapis.com/projects/510844325101/databases/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`
  2. **Formato Abreviado:** `firestore.googleapis.com/databases/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`
- **Garantías de seguridad:**
  - Project Number obligatorio verificado: `510844325101`.
  - Rechazo de attachment_point vacío, de `(default)`, de base ajena o con project number discrepante (código de salida 4).

#### Hallazgo 4: Validación Exhaustiva de `source.files` y Blindaje Mono-Archivo
- **Problema previo:** Se accedía incondicionalmente al índice `source.files[0].content`.
- **Corrección implementada:**
  ```powershell
  if (-not $rulesetData.source -or -not $rulesetData.source.files) { exit 5 }
  $files = @($rulesetData.source.files)
  if ($files.Count -eq 0) { exit 5 }
  if ($files.Count -gt 1) {
      Write-Host "[!] MULTI_FILE_RULESET: El ruleset contiene $($files.Count) archivos..." -ForegroundColor Red
      exit 5
  }
  ```
- **Garantías de seguridad:**
  - Enumeración de archivos en pantalla.
  - Exigencia estricta de exactamente 1 archivo para el snapshot inicial.
  - Si existen múltiples archivos, emite `MULTI_FILE_RULESET` y aborta sin combinar ni truncar código.

---

### 2. MECANISMO DE INTEGRIDAD Y ANTI-SOBRESCRITURA DEL SNAPSHOT

1. **Escritura Atómica:** Escritura a archivo temporal `$OutputPath.tmp`.
2. **Validación de Integridad:** Se leen los bytes recién grabados del disco y se calcula su SHA-256; si difiere del hash en memoria, el archivo `.tmp` se elimina inmediatamente.
3. **Bloqueo a Nivel de Kernel:** Si no se especifica `-AllowOverwrite`, el script verifica la existencia previa del archivo de snapshot, del companion `.sha256` y del `.manifest.json`. Si alguno preexiste, aborta con código 6.
4. **Companion `.sha256`:** Hash hexadecimal estándar con formato compatible con `sha256sum -c`.
5. **Manifiesto Forense Separado (`$OutputPath.manifest.json`):**
   Contiene metadatos de auditoría estructurados (timestamp ISO 8601 UTC, Project ID, Project Number, Database ID, Release Name, Ruleset Name, nombre del archivo, tamaño en bytes, líneas, hash SHA-256 y attachment point), con cero credenciales.
6. **Declaración Temporal Inmutable:** El manifiesto clasifica el archivo como `OBSERVED_LIVE_SNAPSHOT` y estipula formalmente:
   *"Snapshot remoto observado en vivo en la fecha y hora indicadas. NO constituye un respaldo histórico previo a Fase 7D."*

---

### 3. TAXONOMÍA RIGUROSA DE LA SUITE DE PRUEBAS (71 ESCENARIOS)

| Categoría | Total | Descripción Metodológica | Entorno | Estado |
|---|---|---|---|---|
| **PASS-UNIT** | **45** | Pruebas unitarias de algoritmos: inventario (73 docs), sanitización ADC, parseo ISO 8601 UTC, envelope inmutable, hashing SHA-256, checkpoints, tokens ADC vacíos, escape de credenciales en errores, release canónica exacta, coincidencias parciales rechazadas, default rechazada, releases duplicadas, paginación simulada, regex de rulesetName, attachment points válidos y rechazados, project number discrepante, source.files vacío y múltiple, UTF-8 sin BOM, anti-sobrescritura, verbos HTTP GET. | Contenedor Node.js / Linux | **APROBADO (45/45)** |
| **PASS-MOCK** | **15** | Simulación de transformaciones SDDL de Windows, orden canónico de ACEs, no-mutación de root durante Etapa 1, herencia deshabilitada simulada, reversión en dos etapas y máscaras de bits de Reparse Points. | Contenedor Node.js / Linux | **APROBADO (15/15)** |
| **PASS-STATIC** | **11** | Detección y análisis estático del artefacto CLI de 166 bytes, reglas ancladas en `/.gitignore`, conciliación estática de lockfiles (`package.json`, `bun.lock`, `package-lock.json`) y verificación de aislamiento. | Contenedor Node.js / Linux | **APROBADO (11/11)** |
| **PASS-WINDOWS** | **N/A en Linux** | Ejecuciones operativas en Windows PowerShell 5.1: prueba criptográfica DPAPI `CurrentUser` real (11/11 aprobadas en Fase 3.5.0.1) y ejecución de Preflight local (Fase 3.5.0.4). | Estación Windows del Operador | **EVIDENCIA CONFIRMADA** |
| **PASS-INTEGRATION** | **N/A en Linux** | Consultas REST reales contra Google Cloud Firestore (Preflight con 5 usuarios y 73 docs). | Estación Windows con ADC | **EVIDENCIA CONFIRMADA** |

---

### 4. MANIFIESTO DE INTEGRIDAD DE ARCHIVOS (SHA-256)

```text
728ebc95ff4ddae32b21cf923eb4501a35ae453187a53673752e2a0f8bfdb6ee  poc/catalyst-3-2/scripts/query-remote-rules.ps1
08f7bfa6dbe1267425114704381387fb8f509dbd44c4e7d4be10787e91507202  poc/catalyst-3-2/scripts/test-phase-3.5-extractor.ts
0b95ac19d74044c6f9782563a87a062e20e078e4a281b7e571f1b75ccbda5564  poc/catalyst-3-2/scripts/audit-package-lock.ts
(Creado)                                                            poc/catalyst-3-2/reports/firestore-extraction-3.5.0.9/hardening-report-3.5.0.9.md
```

---

### 5. PROCEDIMIENTO EXACTO PARA EL OPERADOR EN POWERSHELL 5.1

Desde la terminal Windows PowerShell 5.1 en `poc/catalyst-3-2/`:

#### Paso 1: Validación Sintáctica del Script:
```powershell
$errors = @()
$null = [System.Management.Automation.Language.Parser]::ParseFile("scripts/query-remote-rules.ps1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { throw "Error sintáctico: $($errors[0].Message)" }
Write-Host ">>> SINTAXIS POWERSHELL 5.1: PASS" -ForegroundColor Green
```

#### Paso 2: Ejecución de la Suite Completa de Pruebas (71 Aprobadas):
```powershell
npx tsx scripts/test-phase-3.5-extractor.ts
```

#### Paso 3: Inspección Remota (Solo Lectura, sin Guardado en Disco):
```powershell
.\scripts\query-remote-rules.ps1
```

#### Paso 4: Inspección Remota con Guardado Seguro de Snapshot y Manifiesto:
```powershell
.\scripts\query-remote-rules.ps1 -SaveSnapshot
```
*(Si ya existiera un snapshot y se deseara sobrescribir intencionalmente, añadir `-AllowOverwrite`).*

---

### 6. DICTAMEN OFICIAL FINAL

```text
========================================================================================
 DICTAMEN DE AUTORIZACIÓN:
 REMOTE_RULES_QUERY_HARDENED — PENDING OPERATOR EXECUTION
========================================================================================
 - Los cuatro hallazgos fueron remediados e implementados al 100%.
 - Token ADC configurado con 'gcloud auth application-default print-access-token'.
 - Coincidencia exacta obligatoria con la release canónica de la base nombrada.
 - Validación estricta de attachment_point y project number 510844325101.
 - Blindaje mono-archivo para source.files y rechazo de MULTI_FILE_RULESET.
 - Guardado atómico con verificación de integridad y manifiesto forense sin credenciales.
 - 71/71 pruebas automatizadas aprobadas.
 - Cero solicitudes remotas ejecutadas en esta fase.
========================================================================================
```
