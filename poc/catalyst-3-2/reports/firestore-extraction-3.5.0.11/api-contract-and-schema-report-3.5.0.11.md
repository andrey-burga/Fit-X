# VIGORCORE — INFORME DE AUDITORÍA Y CONTRATO DE API FASE 3.5.0.11
## RECONCILIACIÓN DEL ESQUEMA REAL DE GOOGLE FIREBASE RULES API REST V1

**Fecha de Emisión:** 12 de Noviembre de 2026  
**Proyecto Google Cloud:** `gen-lang-client-0041212770`  
**Project Number Verificado:** `510844325101`  
**Base de Datos Firestore Nombrada:** `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c` (Enterprise, us-east1)  
**Release Canónica Esperada:** `projects/gen-lang-client-0041212770/releases/cloud.firestore/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`  
**Dictamen Final:** `FIREBASE_RULES_API_SCHEMA_RECONCILED — PENDING WINDOWS VERIFICATION`

---

### 1. DIAGNÓSTICO DEL CONTRATO DE ESQUEMA (RELEASE VS RULESET)

#### 1.1. Especificación Oficial de Google Cloud Firebase Rules API v1
En la API oficial de Google Cloud (`firebaserules.googleapis.com/v1`):

1. **Objeto `Release` (retornado por `projects.releases.list` y `projects.releases.get`):**
   - `name`: Nombre del recurso de la release (`projects/{project}/releases/{release_id}`).
   - `rulesetName`: Nombre del recurso del ruleset asociado (`projects/{project}/rulesets/{ruleset_id}`).
   - `createTime`: Marca temporal de creación.
   - `updateTime`: Marca temporal de actualización.
   - **El objeto `Release` NO contiene el campo `attachment_point` ni `attachmentPoint`.**

2. **Objeto `Ruleset` (retornado por `projects.rulesets.get`):**
   - `name`: Nombre del ruleset.
   - `source`: Objeto que encapsula `files` con `name` y `content`.
   - `createTime`: Marca temporal inmutable de creación.
   - `metadata`: Metadatos auxiliares del servicio.
   - **`attachment_point`**: Cadena que vincula físicamente el ruleset a la base de datos de Firestore.

#### 1.2. Hallazgo en Versiones Previas del Script
- En la versión previa, el script intentaba leer `attachment_point` tanto de `$targetRelease` como de `$rulesetData`, introduciendo una suposición errónea sobre el objeto `Release`.
- Además, la validación de `attachment_point` se ejecutaba después de la inspección de `source.files`, y si el campo venía nulo, el script no abortaba de forma fail-closed.

---

### 2. REORDENAMIENTO Y BLINDAJE DE LA SECUENCIA DE EJECUCIÓN

Se implementó de forma estricta la secuencia canónica establecida en el estándar de seguridad VigorCore:

1. **Obtención de Releases con Paginación:**  
   Se consulta `projects.releases.list` recorriendo todas las páginas con `nextPageToken` mediante solicitudes HTTP GET seguras.
2. **Coincidencia Exacta con la Release Canónica:**  
   Se busca exclusivamente la release que coincida de forma unívoca con:  
   `projects/gen-lang-client-0041212770/releases/cloud.firestore/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`.  
   - Si no existe coincidencia exacta: se emite `NO_MATCH` y se detiene la ejecución inmediatamente (`exit 3`) **sin realizar ninguna consulta a rulesets**.
   - Se rechazan coincidencias parciales y la release de `(default)`.
   - Si existen duplicados: se emite `AMBIGUOUS_RELEASES_DETECTED` (`exit 3`).
3. **Extracción y Validación de `rulesetName`:**  
   Se extrae `rulesetName` del objeto `Release` verificado y se valida que cumpla el patrón:  
   `^projects/gen-lang-client-0041212770/rulesets/[a-zA-Z0-9_\-]+$`.
4. **Descarga del Ruleset (GET):**  
   Se ejecuta una única solicitud GET a `https://firebaserules.googleapis.com/v1/$rulesetName`.
5. **Validación Estricta de `attachment_point` en Ruleset:**  
   Se extrae `attachment_point` exclusivamente de `$rulesetData`.  
   - Si `attachment_point` está ausente o vacío: **ABORTA INMEDIATAMENTE** con `ATTACHMENT_POINT_MISSING` (`exit 4`).
   - Se exige que coincida exactamente con alguna de las dos formas documentadas:
     - Formato Completo: `firestore.googleapis.com/projects/510844325101/databases/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`
     - Formato Abreviado: `firestore.googleapis.com/databases/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`
   - Si apunta a otra base de datos o contiene un project number discrepante: **ABORTA** (`exit 4`).
6. **Extracción y Validación de `source.files`:**  
   **Únicamente tras validar con éxito `attachment_point`**, se accede a `source.files`.  
   - Se verifica que exista y no esté vacío.
   - Se exige que contenga **exactamente 1 archivo**. Si contiene más de uno, se aborta con `MULTI_FILE_RULESET` (`exit 5`) para impedir pérdida o mezcla de archivos.
7. **Guardado Atómico y Manifiesto:**  
   Se calcula el hash SHA-256 en memoria, se valida contra el archivo grabado en disco y se genera el manifiesto forense sin credenciales.

---

### 3. TAXONOMÍA RIGUROSA DE LA SUITE DE PRUEBAS (91 ESCENARIOS)

Se añadieron 10 escenarios específicos en la **Sección 17** (`T-3511-01` a `T-3511-10`) con fixtures JSON fieles al contrato oficial de Google Cloud:

| Categoría | Total | Descripción Metodológica | Entorno | Estado |
|---|---|---|---|---|
| **PASS-UNIT** | **65** | Algoritmos deterministas: conteo de inventario (73 docs), sanitización ADC, parseo UTC, envelope inmutable, hashing SHA-256, checkpoints, tokens vacíos, release exacta, coincidencia parcial rechazada, default rechazada, releases duplicadas, paginación exhaustiva, regex de rulesetName, attachments válidos/rechazados, project number discrepante, source.files vacío y múltiple (MULTI_FILE_RULESET), UTF-8 sin BOM, anti-sobrescritura, ausencia de nextPageToken, **Release sin `attachment_point` procesada con éxito**, **Release sin `rulesetName` rechazada**, **Ruleset con attachment_point correcto (completo y abreviado) aceptado**, **Ruleset con otra base o project number discrepante rechazado**, **Ruleset sin attachment_point rechazado con ATTACHMENT_POINT_MISSING**, **Ruleset sin source.files rechazado**, **secuencia estricta de validación previa a source.files** y **ausencia de snapshots residuales ante error**. | Contenedor Node.js / Linux | **APROBADO (65/65)** |
| **PASS-MOCK** | **15** | Emulación de transformaciones SDDL de Windows, orden canónico de ACEs, no-mutación de root durante Etapa 1, herencia deshabilitada simulada, reversión en dos etapas y máscaras de bits de Reparse Points. | Contenedor Node.js / Linux | **APROBADO (15/15)** |
| **PASS-STATIC** | **11** | Detección y análisis estático del artefacto CLI de 166 bytes, reglas ancladas en `/.gitignore`, conciliación estática de lockfiles (`package.json`, `bun.lock`, `package-lock.json`) y verificación de aislamiento. | Contenedor Node.js / Linux | **APROBADO (11/11)** |
| **PASS-WINDOWS** | **N/A en Linux** | Ejecuciones operativas exclusivas de la estación Windows: prueba criptográfica DPAPI `CurrentUser` real (11/11 aprobadas en Fase 3.5.0.1) y ejecución de Preflight local (Fase 3.5.0.4). | Estación Windows del Operador | **EVIDENCIA CONFIRMADA** |
| **PASS-INTEGRATION** | **N/A en Linux** | Consultas REST reales contra Google Cloud Firestore (Preflight con 5 usuarios y 73 docs). | Estación Windows con ADC | **EVIDENCIA CONFIRMADA** |

> **Declaración Transparente de Integridad:** Las 91 pruebas evaluadas en el contenedor de desarrollo de AI Studio corresponden a validaciones **UNIT, MOCK y STATIC**. No se presentan como ejecuciones reales de Windows ni de integración en vivo contra Google Cloud.

---

### 4. MANIFIESTO DE INTEGRIDAD DE ARCHIVOS MODIFICADOS (SHA-256)

```text
7c5e2634fb61922c2a0db4c6fa11ee6ba6bc4fa679e0a0a52df2467d01859c2b  poc/catalyst-3-2/scripts/query-remote-rules.ps1
08f758ba82d8c36ec3ba30248adcfc20fbf21a5eb23b081eb5343d922bb765b2  poc/catalyst-3-2/scripts/test-phase-3.5-extractor.ts
(Creado)                                                            poc/catalyst-3-2/reports/firestore-extraction-3.5.0.11/api-contract-and-schema-report-3.5.0.11.md
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

#### Paso 2: Ejecución de la Suite Completa de Pruebas (91 Aprobadas):
```powershell
npx tsx scripts/test-phase-3.5-extractor.ts
```

#### Paso 3: Consulta Remota en Modo Inspección (Solo Lectura en Pantalla):
```powershell
.\scripts\query-remote-rules.ps1
```

#### Paso 4: Consulta Remota con Guardado Seguro de Snapshot y Manifiesto:
```powershell
.\scripts\query-remote-rules.ps1 -SaveSnapshot
```

---

### 6. DICTAMEN OFICIAL FINAL

```text
========================================================================================
 DICTAMEN DE AUTORIZACIÓN:
 FIREBASE_RULES_API_SCHEMA_RECONCILED — PENDING WINDOWS VERIFICATION
========================================================================================
 - Contrato oficial de Firebase Rules API REST v1 reconciliado plenamente.
 - Objeto Release evaluado sin exigir el campo inexistente attachment_point.
 - Objeto Ruleset validado rigurosamente exigiendo attachment_point previo a source.files.
 - Comportamiento fail-closed ante propiedades ausentes, esquemas inválidos y errores HTTP.
 - 91/91 pruebas automatizadas aprobadas.
 - Cero solicitudes remotas ni mutaciones ejecutadas durante el desarrollo de esta fase.
========================================================================================
```
