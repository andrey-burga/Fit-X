# VIGORCORE — INFORME DE CAUSA RAÍZ Y HARDENING FASE 3.5.0.10
## CORRECCIÓN DEL PROCESAMIENTO DE RESPUESTAS FIREBASE RULES API EN POWERSHELL 5.1

**Fecha de Emisión:** 12 de Noviembre de 2026  
**Proyecto Google Cloud:** `gen-lang-client-0041212770`  
**Base de Datos Firestore Nombrada:** `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c` (Enterprise, us-east1)  
**Entorno Operativo:** Windows PowerShell 5.1 con `Set-StrictMode -Version Latest`  
**Dictamen Final:** `REMOTE_RULES_RESPONSE_PARSING_HARDENED — PENDING WINDOWS VERIFICATION`

---

### 1. DIAGNÓSTICO FORENSE Y ANÁLISIS DE CAUSA RAÍZ

#### 1.1. Evidencia del Fallo en Windows
Durante la primera ejecución operativa real del script en la estación Windows, se produjo la siguiente excepción fatal:
```text
[PASO 1/5] Obteniendo token de autorización Application Default (ADC)...
[OK] Token de acceso ADC disponible en memoria (no persistido ni expuesto).

[PASO 2/5] Consultando releases registradas en Firebase Rules API (GET con paginación)...
query-remote-rules.ps1: No se encuentra la propiedad "nextPageToken" en este objeto.
Compruebe que la propiedad existe.
```

#### 1.2. Causa Raíz Técnica
1. **Comportamiento de `Set-StrictMode -Version Latest`:**  
   En PowerShell 5.1, la activación del modo estricto prohíbe terminantemente la evaluación de propiedades que no hayan sido instanciadas en un objeto. Si el código evalúa `$objeto.propiedad` y `propiedad` no existe en la definición del objeto, el motor de PowerShell 5.1 no retorna `$null` de forma permisiva, sino que arroja una excepción terminante:
   `PropertyNotFoundException: No se encuentra la propiedad "..." en este objeto.`

2. **Deserialización de `Invoke-RestMethod`:**  
   Cuando la API REST de Google Cloud Firebase Rules (`https://firebaserules.googleapis.com/v1/projects/{projectId}/releases`) devuelve una respuesta cuya cantidad de releases no supera el tamaño de página (o se encuentra en la última página), el JSON retornado **no incluye la clave `nextPageToken`**:
   ```json
   {
     "releases": [ ... ]
   }
   ```
   Al deserializar este JSON, `Invoke-RestMethod` crea un `[PSCustomObject]` que contiene exclusivamente la propiedad `releases`.

3. **Línea Defectuosa:**  
   La línea 130 de la versión previa ejecutaba:
   ```powershell
   $pageToken = $releasesData.nextPageToken
   ```
   Al no existir la propiedad en el objeto, `Set-StrictMode` detuvo la ejecución inmediatamente.

4. **Extensión a Otras Propiedades Opcionales:**  
   El mismo riesgo existía para:
   - `releasesData.releases` (si el proyecto tiene cero releases o estructura mínima).
   - `rel.name`, `rel.rulesetName`, `rel.updateTime`.
   - `rulesetData.source`, `source.files`.
   - `rulesFile.content`, `rulesFile.name`.
   - `attachment_point` / `attachmentPoint`.

---

### 2. ARQUITECTURA DE LA SOLUCIÓN IMPLEMENTADA

#### 2.1. Helper Defensivo `Get-SafePropertyValue`
Se introdujo una función auxiliar nativa de PowerShell 5.1 que inspecciona la colección `PSObject.Properties` antes de intentar leer cualquier valor:
```powershell
function Get-SafePropertyValue {
    param(
        [Parameter(Mandatory = $false)]
        $Target,
        [Parameter(Mandatory = $true)]
        [string]$PropertyName
    )

    if ($null -eq $Target) {
        return $null
    }

    if ($Target.PSObject -and $null -ne $Target.PSObject.Properties[$PropertyName]) {
        return $Target.PSObject.Properties[$PropertyName].Value
    }

    return $null
}
```

#### 2.2. Matriz de Diferenciación de Respuestas
El script ahora categoriza y maneja rigurosamente cada estado de respuesta:

| Estado de Respuesta de la API | Comportamiento del Script | Diagnóstico / Dictamen |
|---|---|---|
| **Válida con releases y sin `nextPageToken`** | Extrae releases de la página, establece `$pageToken = $null` y finaliza paginación de forma limpia. | `[OK] Paginación finalizada: N releases recuperadas.` |
| **Válida con `nextPageToken`** | Extrae releases de la página, asigna `$pageToken = [string]$nextPageVal` y realiza el siguiente GET. | `nextPageToken presente, continuando paginación...` |
| **Válida sin releases (vacía)** | Detecta `$allReleases.Count -eq 0` tras completar paginación y emite diagnóstico. | `NO_MATCH — RELEASE_NOT_FOUND_FOR_NAMED_DATABASE` (exit 3) |
| **Error HTTP (403, 429, 500, etc.)** | Captura la excepción, preserva el código HTTP si existe en el WebResponse y sanitiza el mensaje sin fugar credenciales. | `[!] Error HTTP al consultar releases (Página X): <Mensaje>` (exit 2) |
| **JSON inválido o estructura no-objeto** | Verifica que `$releasesData -and $releasesData.PSObject`. Si es inválido, aborta de inmediato. | `API_RESPONSE_SCHEMA_INVALID` (exit 2) |
| **Release canónica inexistente** | Tras buscar coincidencia exacta `$rel.name -eq $canonicalReleaseName`, si no hay coincidencias emite reporte. | `NO_MATCH — RELEASE_NOT_FOUND_FOR_NAMED_DATABASE` (exit 3) |
| **Releases canónicas duplicadas** | Si `$exactMatches.Count -gt 1`, aborta por ambigüedad crítica. | `AMBIGUOUS_RELEASES_DETECTED` (exit 3) |

---

### 3. TAXONOMÍA RIGUROSA DE LA SUITE DE PRUEBAS (81 ESCENARIOS)

Se añadieron 10 escenarios específicos en la **Sección 16** (`T-3510-01` a `T-3510-10`) que modelan la semántica estricta de objetos de PowerShell 5.1:

| Categoría | Total | Descripción Metodológica | Entorno | Estado |
|---|---|---|---|---|
| **PASS-UNIT** | **55** | Validación unitaria de algoritmos deterministas: inventario (73 docs), sanitización ADC, parseo ISO 8601 UTC, envelope inmutable, hashing SHA-256, checkpoints, tokens ADC vacíos, escape de credenciales en errores, release canónica exacta, coincidencias parciales rechazadas, default rechazada, releases duplicadas, paginación exhaustiva simulada, regex de rulesetName, attachment points válidos y rechazados, project number discrepante, source.files vacío y múltiple (MULTI_FILE_RULESET), UTF-8 sin BOM, anti-sobrescritura, verbos GET exclusivos, respuestas sin `nextPageToken`, `nextPageToken` nulo, paginación multi-página, respuestas sin `releases`, respuestas con `releases` vacío, manejo HTTP 403 y 429, detección de JSON inválido y objetos deserializados con propiedades ausentes. | Contenedor Node.js / Linux | **APROBADO (55/55)** |
| **PASS-MOCK** | **15** | Emulación de transformaciones SDDL de Windows, orden canónico de ACEs, no-mutación de root durante Etapa 1, herencia deshabilitada simulada, reversión en dos etapas y máscaras de bits de Reparse Points. | Contenedor Node.js / Linux | **APROBADO (15/15)** |
| **PASS-STATIC** | **11** | Detección y análisis estático del artefacto CLI de 166 bytes, reglas ancladas en `/.gitignore`, conciliación estática de lockfiles (`package.json`, `bun.lock`, `package-lock.json`) y verificación de aislamiento. | Contenedor Node.js / Linux | **APROBADO (11/11)** |
| **PASS-WINDOWS** | **N/A en Linux** | Ejecuciones operativas en Windows PowerShell 5.1: prueba criptográfica DPAPI `CurrentUser` real (11/11 aprobadas en Fase 3.5.0.1) y ejecución de Preflight local (Fase 3.5.0.4). | Estación Windows del Operador | **EVIDENCIA CONFIRMADA** |
| **PASS-INTEGRATION** | **N/A en Linux** | Consultas REST reales contra Google Cloud Firestore (Preflight con 5 usuarios y 73 docs). | Estación Windows con ADC | **EVIDENCIA CONFIRMADA** |

---

### 4. MANIFIESTO DE INTEGRIDAD DE ARCHIVOS MODIFICADOS (SHA-256)

```text
5b546ed82ce52d7b46e6bcc19490119524d3fa6e0ea6406c183b0714129d33ee  poc/catalyst-3-2/scripts/query-remote-rules.ps1
8e76a924f343feac0208ac49facab309434677a32a00ae4dc389dfd7343f59a6  poc/catalyst-3-2/scripts/test-phase-3.5-extractor.ts
(Creado)                                                            poc/catalyst-3-2/reports/firestore-extraction-3.5.0.10/root-cause-and-hardening-report-3.5.0.10.md
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

#### Paso 2: Ejecución de la Suite Completa de Pruebas (81 Aprobadas):
```powershell
npx tsx scripts/test-phase-3.5-extractor.ts
```

#### Paso 3: Consulta Remota Operativa (Modo Inspección en Pantalla):
```powershell
.\scripts\query-remote-rules.ps1
```

#### Paso 4: Consulta Remota con Guardado de Snapshot Verificado:
```powershell
.\scripts\query-remote-rules.ps1 -SaveSnapshot
```

---

### 6. DICTAMEN OFICIAL FINAL

```text
========================================================================================
 DICTAMEN DE AUTORIZACIÓN:
 REMOTE_RULES_RESPONSE_PARSING_HARDENED — PENDING WINDOWS VERIFICATION
========================================================================================
 - Causa raíz identificada y remediada mediante helper defensivo Get-SafePropertyValue.
 - Respuestas sin nextPageToken y con propiedades opcionales ausentes procesadas limpiamente.
 - Comportamiento fail-closed ante errores HTTP y esquemas inválidos verificado.
 - 81/81 pruebas automatizadas aprobadas.
 - Cero solicitudes remotas ejecutadas en esta fase de desarrollo.
========================================================================================
```
