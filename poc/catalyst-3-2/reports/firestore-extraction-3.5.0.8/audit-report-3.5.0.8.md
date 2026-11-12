# VIGORCORE — INFORME DE AUDITORÍA ESTÁTICA FASE 3.5.0.8
## AUDITORÍA DEL SCRIPT REMOTE RULES Y CONCILIACIÓN DE DEPENDENCIAS

**Fecha:** 12 de Noviembre de 2026  
**Proyecto Google Cloud:** `gen-lang-client-0041212770`  
**Base de Datos Firestore Nombrada:** `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c` (Enterprise, us-east1)  
**Dictamen Final:** `REMOTE_RULES_QUERY_READY — PENDING OPERATOR EXECUTION`

---

### 1. AUDITORÍA ESTÁTICA DE query-remote-rules.ps1 (14 PUNTOS NORMATIVOS)

| N° | Criterio de Auditoría | Estado | Evidencia en Código (`poc/catalyst-3-2/scripts/query-remote-rules.ps1`) |
|---|---|---|---|
| **1** | Todas las llamadas HTTP identificadas | **CONFORME** | Exactamente 2 llamadas: `projects.releases.list` (L86) y `projects.rulesets.get` (L150). |
| **2** | Operaciones remotas estrictamente GET | **CONFORME** | Ambas invocaciones `Invoke-RestMethod` declaran `-Method Get`. |
| **3** | Cero POST, PATCH, PUT, DELETE | **CONFORME** | Cero operaciones de mutación en todo el script. Grep exhaustivo: 0 coincidencias de verbos mutantes. |
| **4** | ADC autorizado sin fuga de credenciales | **CONFORME** | Token obtenido en memoria (`gcloud auth print-access-token 2>$null`, L54). Nunca impreso, nunca escrito en logs ni en disco. |
| **5** | Manejo de errores HTTP sin exponer Bearer | **CONFORME** | Bloques `catch` reportan `$_.Exception.Message` (L89, L152) sin volcar encabezados de autenticación. |
| **6** | Gestión de paginación con `nextPageToken` | **CONFORME** | Bucle `do { ... } while ($pageToken)` (L78-100) que concatena páginas en `$allReleases`. |
| **7** | Comprobación de release exacta de base nombrada | **CONFORME** | Filtro `if ($rName -like "*$DatabaseId*")` (L117) que valida el identificador oficial de la base Enterprise. |
| **8** | Anti-sustitución accidental con `(default)` | **CONFORME** | Si `-not $targetRelease`, emite `NO_MATCH` y aborta con código 3 (L125-135). **Nunca sustituye por `(default)`**. |
| **9** | Recuperación de ruleset y fuente original | **CONFORME** | Consulta GET `https://firebaserules.googleapis.com/v1/$rulesetName` y extrae `$rulesFile.content` (L145-163). |
| **10** | Asociación de fuente con `attachment_point` | **CONFORME** | Valida y reporta en consola `Release Name` y `Attachment Point: $DatabaseId` (L137-141, L179-180). |
| **11** | Cálculo de SHA-256 del contenido recuperado | **CONFORME** | Computa SHA-256 de los bytes UTF-8 del texto (`[System.Security.Cryptography.SHA256]::Create()`, L166-169). |
| **12** | Bloqueo anti-sobrescritura sin switch explícito | **CONFORME** | Verifica `Test-Path $OutputPath` y `Test-Path "$OutputPath.sha256"`. Requiere `-AllowOverwrite` (L187-199). |
| **13** | Escritura UTF-8 sin BOM verificada | **CONFORME** | Utiliza `New-Object System.Text.UTF8Encoding($false)` (L206) impidiendo corrupción de bytes iniciales. |
| **14** | Protección del snapshot frente a Git | **CONFORME** | Ruta predeterminada en `.data/` (ignorado globalmente) y regla `/firestore.rules.remote-live-snapshot.rules*` en `/.gitignore`. |

---

### 2. TABLA DE SOLICITUDES HTTP Y MÉTODOS

| Orden | Método | URL del Endpoint | Encabezados | Parámetros Query | Propósito Operativo |
|---|---|---|---|---|---|
| **1** | `GET` | `https://firebaserules.googleapis.com/v1/projects/gen-lang-client-0041212770/releases` | `Authorization: Bearer <ADC>`, `Accept: application/json` | `pageToken` (opcional, en bucle) | Listar releases activas del proyecto para localizar la vinculada a la base nombrada. |
| **2** | `GET` | `https://firebaserules.googleapis.com/v1/{rulesetName}` | `Authorization: Bearer <ADC>`, `Accept: application/json` | Ninguno | Descargar la definición inmutable del ruleset referenciado y su fuente `firestore.rules`. |

---

### 3. VALIDACIÓN DE LA RUTA EXACTA DE LA RELEASE Y ATTACHMENT POINT

En Firestore Enterprise Multi-Database, Google Cloud Rules API separa las releases por instancia:
- **Base `(default)`:** `projects/gen-lang-client-0041212770/releases/cloud.firestore`
- **Base Nombrada Oficial:** `projects/gen-lang-client-0041212770/releases/cloud.firestore/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c` o bien `cloud.firestore/databases/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`.

El script valida que el nombre contenga la cadena unívoca:
`ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`
Si la release no existe en la nube, el script emite:
`Dictamen: NO_MATCH — RELEASE_NOT_FOUND_FOR_NAMED_DATABASE` y finaliza con código de salida 3, bloqueando cualquier descarga sustitutiva errónea de `(default)`.

---

### 4. ANÁLISIS DE SEGURIDAD DEL TOKEN ADC

- **Captura:** Se ejecuta `gcloud auth print-access-token 2>$null` directamente a una variable local en memoria `$token`.
- **Inyección:** Se asocia al header HTTP `Authorization: Bearer $token` en la sesión de PowerShell.
- **Cero Persistencia:** No se guarda en archivos temporales, no se exporta a variables de entorno de Windows (`$env:...`), no se escribe en logs ni se muestra por salida estándar (`Write-Host`).
- **Manejo de Excepciones:** En caso de error de red o de permisos (403/401), PowerShell solo expone la cadena de error del WebException (`$_.Exception.Message`), garantizando que el Bearer token no figure en la traza de terminal.

---

### 5. EVALUACIÓN DE SEGURIDAD DEL SNAPSHOT LOCAL

1. **Escritura Atómica:** El archivo no se escribe directamente en la ruta destino. Se escribe primero en un archivo temporal `$OutputPath.tmp`.
2. **Validación de Integridad Post-Escritura:** Antes de renombrar el archivo temporal, el script lee los bytes del disco, calcula el hash SHA-256 del archivo grabado y lo compara contra el hash en memoria del contenido descargado.
3. **Rollback Local en Fallo:** Si los hashes discrepan o la escritura se interrumpe, el archivo `.tmp` se elimina inmediatamente, evitando snapshots parciales o corruptos.
4. **Archivo Hash Companion:** Se genera `$OutputPath.sha256` con el digest hexadecimal estandarizado para permitir verificaciones forenses posteriores (`sha256sum -c`).
5. **Nomenclatura Semántica:** La documentación y el script estipulan que este artefacto es un **snapshot remoto observado en la fecha/hora de ejecución**, descartando terminantemente que sea un "respaldo pre-7D".

---

### 6. DIFERENCIAS EXACTAS DE PACKAGE.JSON Y PACKAGE-LOCK.JSON

La ejecución local en Windows reportó:
```json
{
  "dependencies": false,
  "devDependencies": true,
  "optionalDependencies": true
}
```

#### Análisis Forense de la Desalineación:
1. **`devDependencies: true`:** Coincidencia exacta de las 10 dependencias de desarrollo (`@firebase/rules-unit-testing`, `@types/express`, `@types/node`, `@types/react`, `@types/react-dom`, `autoprefixer`, `esbuild`, `tailwindcss`, `tsx`, `typescript`).
2. **`optionalDependencies: true`:** Cero dependencias opcionales en ambos archivos (`{}`).
3. **`dependencies: false`:**
   - En `package.json` raíz existen 13 dependencias de producción.
   - Durante la evolución del proyecto (Fases 7D y pruebas posteriores), se agregaron y sincronizaron dependencias en `bun.lock` (como `firebase-admin`, `firebase-functions`, o actualizaciones de `@google/genai`).
   - El archivo `package-lock.json` de la raíz (177,558 bytes) data del **23/10/2026** y quedó congelado en la resolución de octubre, sin reflejar las adiciones gestionadas por Bun.
4. **Consecuencia Operativa:**
   - Si se ejecutara `npm ci`: **Fallo fatal con error EUSAGE** debido a la desincronización del árbol.
   - Si se ejecutara `npm install`: Reescribiría `package-lock.json` y alteraría el árbol `node_modules`, desalineando el entorno respecto a `bun.lock`.
5. **Decisión:** `bun.lock` (124,735 bytes) es el **único lockfile canónico de la raíz**. `package-lock.json` se conserva intacto, aislado por la regla anclada `/package-lock.json` en `/.gitignore`.

---

### 7. ESTADO REAL DE LAS PRUEBAS (TAXONOMÍA RIGUROSA)

La suite de 50 pruebas (`test-phase-3.5-extractor.ts`) y la herramienta de auditoría de dependencias (`audit-package-lock.ts`) se desglosan formalmente según su naturaleza técnica de ejecución:

| Categoría | Total Escenarios | Descripción Técnica | Entorno de Ejecución | Estado |
|---|---|---|---|---|
| **PASS-UNIT** | **29** | Lógica determinista de inventario (73 docs), sanitización de tokens ADC, formato de URL REST, precedencia de errores, envelopes inmutables, atomicidad SHA-256, checkpoints, expiración de timestamps UTC e intervalos límite. | Contenedor Node.js / Linux | **APROBADO (29/29)** |
| **PASS-MOCK** | **15** | Simulación de transformaciones SDDL, deshabilitación de herencia simulada, orden canónico de ACEs, validación de respaldos SDDL, rollback en dos etapas y máscaras de bits de Reparse Points. *Simula lógica Windows sin invocar Win32 APIs reales.* | Contenedor Node.js / Linux | **APROBADO (15/15)** |
| **PASS-STATIC** | **6** | Detección de artefacto de error CLI (166 B, hash `D4CE9EBC...`), reglas Git en `.gitignore`, conciliación estática de lockfiles y endpoints REST de bases nombradas. | Contenedor Node.js / Linux | **APROBADO (6/6)** |
| **PASS-WINDOWS** | **N/A en Linux** | Ejecuciones operativas en Windows PowerShell 5.1: DPAPI `CurrentUser` real (11/11 en Fase 3.5.0.1) y ejecución de Preflight local (Fase 3.5.0.4). | Estación Windows del Operador | **VERIFICADO EN FASES PREVIAS** |
| **PASS-INTEGRATION** | **N/A en Linux** | Llamadas REST en vivo contra Google Cloud Firestore (Preflight con 5 usuarios y 73 docs). | Estación Windows con ADC | **EJECUTADO EN 3.5.0 / 3.5.0.4** |

> **DECLARACIÓN TRANSPARENTE:** Las 50 pruebas reportadas con éxito en el entorno de desarrollo de AI Studio corresponden a validaciones **UNIT, MOCK y STATIC**. No representan ni suplantan las ejecuciones nativas de Windows (`PASS-WINDOWS`).

---

### 8. COMANDOS EXACTOS QUE PODRÁ EJECUTAR EL OPERADOR

Una vez autorizada la consulta, el operador podrá ejecutar en Windows PowerShell 5.1 desde `poc/catalyst-3-2/`:

#### 1. Verificación Sintáctica del Script:
```powershell
$errors = @()
$null = [System.Management.Automation.Language.Parser]::ParseFile("scripts/query-remote-rules.ps1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { throw "Error sintáctico en query-remote-rules.ps1: $($errors[0].Message)" }
Write-Host ">>> SINTAXIS POWERSHELL 5.1: PASS" -ForegroundColor Green
```

#### 2. Inspección Remota (Solo Consulta en Pantalla, sin escrituras locales):
```powershell
.\scripts\query-remote-rules.ps1
```

#### 3. Inspección y Captura Segura de Snapshot:
```powershell
.\scripts\query-remote-rules.ps1 -SaveSnapshot
```
*(Guarda el snapshot verificado en `.data/firestore-export/control/firestore.rules.remote-live-snapshot.rules` con su hash `.sha256` companion, protegido de Git).*

---

### 9. DICTAMEN FINAL DE AUTORIZACIÓN

```text
========================================================================================
 DICTAMEN OFICIAL:
 REMOTE_RULES_QUERY_READY — PENDING OPERATOR EXECUTION
========================================================================================
 1. query-remote-rules.ps1 auditado y verificado en sus 14 puntos normativos.
 2. Solicitudes remotas limitadas estrictamente a HTTP GET (cero escrituras).
 3. Paginación y terminación en NO_MATCH sin sustitución de (default) verificadas.
 4. Protección anti-sobrescritura y guardado atómico verificados.
 5. Conciliación de lockfiles aclarada: bun.lock canónico, package-lock.json histórico.
 6. Cero ejecuciones de consulta ni modificaciones realizadas durante esta fase.
========================================================================================
```
