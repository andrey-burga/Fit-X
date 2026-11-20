# VIGORCORE — FASE 5.3: DIAGNÓSTICO FORENSE DEL FALLO DE EXTRACCIÓN DE `vigor_api` EN CATALYST

**Proyecto en Google AI Studio:** `Fit-X` *(trabajo estrictamente aislado en `poc/catalyst-clean-slate/`)*  
**Proyecto Zoho Catalyst:** `Project-Rainfall`  
**Project ID:** `136967000000014024`  
**Data Center:** `US`  
**Entorno:** **`Development`** *(**`Production` intacto y sin modificar**)*  
**Función creada por el operador:** `vigor_api` · Function ID: **`136967000000074001`** · Tipo: **Advanced I/O** · Runtime: **Node 22**  
**Function URL observada:** `https://project-rainfall-943998020.development.catalystserverless.com/server/vigor_api/`  
**Operaciones remotas ejecutadas en esta auditoría:** **`0`**  
**Dictamen:** **`PHASE_5_3_CATALYST_UNZIP_FAILURE_ANALYZED`**

---

## 1. INCIDENTE OBSERVADO Y CONTEXTO DEL ERROR

Al invocar `GET /health` sobre la Function URL de `vigor_api` en `Development`, la plataforma devolvió **`INTERNAL_SERVER_ERROR`** con la siguiente traza exacta en los logs de Catalyst:

```text
initialize customer code: process customer code: Error: Command failed: unzip -o /tmp/customer_code.zip -d /catalyst/
status: 1, signal: null, stdout: null, stderr: null
at /var/runtime/index.js:145
```

### Lectura técnica inmediata de la traza
1. El fallo ocurre en la fase **`initialize customer code`**, **antes** de que Catalyst cargue `package.json`, `catalyst-config.json`, `"type": "module"`, `dist/server/catalystEntry.js` o Express. No es un error de código JavaScript/ESM ni de rutas de VigorCore.
2. En Linux (**Info-ZIP `unzip`**):
   - **`status: 0`**: extracción limpia sin errores ni advertencias.
   - **`status: 1`**: **uno o más avisos (`warning`)**, aun cuando los archivos puedan haberse extraído (`2`/`3` indican corrupción/CRC inválido, `9` archivo no encontrado, `50` disco lleno).
   - El runtime Node.js de Catalyst (`/var/runtime/index.js:145`) invoca `unzip -o /tmp/customer_code.zip -d /catalyst/` mediante ejecución síncrona con flujos no capturados (`stdout: null`, `stderr: null`), de modo que **un código de salida `1` (warning) hace fallar toda la inicialización con `INTERNAL_SERVER_ERROR`**.

---

## 2. AUDITORÍA PROFUNDA DEL ZIP EN REPOSITORIO (`artifacts/vigor_api.zip`) Y SU STAGING (`artifacts/vigor_api/`)

### 2.1 Inventario y métricas medidas directamente
- **Archivo auditado:** `poc/catalyst-clean-slate/artifacts/vigor_api.zip` *(conservado intacto como evidencia)*
- **Tamaño:** **`1,275,008` bytes** (`1.22 MiB`)
- **SHA-256:** **`d0b6e60814f50fb7e47363fb9bef725b3fa5182ae31c826c075e3bab0ec34d64`**
- **Directorio fuente auditado:** `poc/catalyst-clean-slate/artifacts/vigor_api/` (`906` archivos totales)

### 2.2 Resultados de la inspección de cabeceras y estructura interna

| Dimensión auditada | Resultado en `artifacts/vigor_api.zip` (Linux repo) | Resultado en `artifacts/vigor_api/` (staging origen) | Riesgo para Linux `unzip` |
| :--- | :--- | :--- | :--- |
| **Raíz y envoltura** | `package.json`, `package-lock.json`, `catalyst-config.json`, `dist/`, `node_modules/` directo en raíz (`0` entradas `vigor_api/*`). | Misma estructura raíz. | Nulo |
| **Separadores de ruta** | `0` barras invertidas `\` (`100%` `/`). **Nota crítica §3.1 sobre Windows `.NET CreateFromDirectory`.** | Rutas de sistema Linux (`/`). | **CRÍTICO si se empaquetó en Windows PS 5.1** |
| **Entradas duplicadas / Colisión mayúsculas** | `0` duplicados exactos; `0` colisiones case-insensitive. | `0` colisiones. | Nulo |
| **Rutas absolutas / Traversal (`..`)** | `0` entradas empezando con `/` ni segmentos `..`. | Nulo. | Nulo |
| **Método de compresión y versión** | `906/906` DEFLATE (`method=8`), `create_version=20`, `extract_version=20`. | Archivos estándar. | Nulo |
| **Flags (`encryption`, `UTF-8`, `data descriptor`)** | `flag_bits = 0x0` en `906/906` (`0` cifradas, `0` Data Descriptors `0x8`, `0` flags UTF-8 `0x800`). | ASCII puro. | Nulo |
| **ZIP64 / Longitud / Caracteres especiales** | `0` entradas ZIP64; longitud máxima `80` chars (`iframe-confirm-modal.d.ts`); `0` caracteres no-ASCII. | Longitud máx. `80`. | Nulo |
| **Central Directory, LFH y CRC32** | `906/906` validados por `zipfile.testzip()` (`None`) y `unzip -tq` (exit `0`). | Coincidencia byte a byte. | Nulo |
| **Directorios vacíos** | `0` entradas explícitas de directorio. | `0` directorios vacíos. | Nulo |
| **Atributos externos y permisos** | `create_system=3` (Unix): `903` entradas `0x81a40000` (`0644`), `3` entradas `0x81ed0000` (`0755`). | `3` ejecutables (`mime/cli.js`, `mime/src/build.js`, `.bin/mime`). | Bajo |
| **Enlaces simbólicos (`symlinks`) y `.bin/`** | `0` entradas symlink `0120000` en el ZIP (`node_modules/.bin/mime` fue dereferenciado como archivo regular `0755`). | **`1` symlink real:** `node_modules/.bin/mime -> ../mime/cli.js` (`0o120777`). | **Moderado si empaquetador conserva symlink o shim** |
| **Archivos ocultos / `0`-byte / Metadatos OS** | `0` `desktop.ini`/`Thumbs.db`/`.DS_Store`; `1` archivo `0` bytes (`node_modules/mime/.npmignore`); `67` archivos dotfiles ocultos de dev en `node_modules` (`.eslintrc`, `.nycrc`, `.github/*`, `.npmignore`, `.package-lock.json`). | `67` archivos dotfiles + `.bin/`. | Bajo / Innecesarios en runtime |

### 2.3 Pruebas independientes ejecutadas localmente (`UnZip 6.00` + Python `zipfile` + Node `v22.23.2`)

1. **`unzip -t poc/catalyst-clean-slate/artifacts/vigor_api.zip`**: **`exit = 0`** (`No errors detected in compressed data`, `906` archivos `OK`).
2. **Verificación CRC32 exhaustiva (`zipfile.testzip()`)**: **`None`** (`0` errores de CRC ni tamaño en las `906` entradas).
3. **Extracción completa (`unzip -o` en `/tmp/`) + re-extracción sobrescribiendo el mismo directorio**: ambas ejecuciones **`exit = 0`**, `stderr = ''`.
4. **Comparación completa del árbol extraído vs `artifacts/vigor_api/`**: `906/906` archivos idénticos byte a byte (`Byte-for-byte diffs: []`).
5. **Reproducción empírica de `unzip -o` devolviendo `status: 1` con entrada estilo Windows (`\`):**
   - ZIP sintético con entrada `dist\server\catalystEntry.js` (`create_system=0`, `external_attr=0x20`) extraído con Linux `UnZip 6.00`:
   - Resultado observado: **`exit = 1`**, `stderr = "warning:  /tmp/...zip appears to use backslashes as path separators"`.
   - Otros casos probados (`create_system=0` con `/`, `create_system=3` con `attr=0`, `flag_bits=0x8`, re-extracción symlink, bytes extra al final): todos devolvieron **`exit = 0`**.

---

## 3. DIAGNÓSTICO DE CAUSAS: DEMOSTRADAS VS HIPÓTESIS

### 3.1 Causa demostrada localmente (aplicable si el operador subió el ZIP generado en Windows PS 5.1)
1. **Generación de separadores `\` en Windows PowerShell 5.1 (.NET Framework 4.x):**
   - `scripts/prepare-vigor-api-upload.ps1` utilizaba `[System.IO.Compression.ZipFile]::CreateFromDirectory()` bajo Windows PowerShell 5.1 (`powershell.exe` host .NET Framework 4.x), donde el modo histórico `Switch.System.IO.Compression.ZipFile.UseBackslash` provoca que las entradas del ZIP se guarden con **`\`** (`dist\server\catalystEntry.js`) en lugar de **`/`**.
2. **Enmascaramiento en la validación local previa:**
   - La línea `$zipRead.Entries | ForEach-Object { $_.FullName -replace '\\', '/' }` de `prepare-vigor-api-upload.ps1` normalizaba `\` a `/` antes de validar la estructura raíz, permitiendo que el script en Windows reportara `SUCCESS` aun cuando el archivo contenía `\` en sus cabeceras.
3. **Mecanismo exacto del error en Catalyst (`/var/runtime/index.js:145`):**
   - Linux Info-ZIP `unzip -o` extrae archivos con `\` pero **termina con código de salida `1` (`status: 1`)** emitiendo el aviso de separadores. Como el runtime Node.js de Catalyst ejecuta `unzip` de forma estricta (`status !== 0` ⇒ excepción) sin capturar `stdout`/`stderr`, registra exactamente:
     `Command failed: unzip -o /tmp/customer_code.zip -d /catalyst/` (`status: 1, signal: null, stdout: null, stderr: null`).

### 3.2 Otras causas posibles e hipótesis (requieren confirmación del ZIP exacto en Windows o intervención de Zoho)

> **Frontera honesta de evidencia:** en este entorno Linux no existe copia binaria del ZIP generado localmente en la estación Windows del operador ni acceso al archivo `/tmp/customer_code.zip` dentro del contenedor remoto de Catalyst.

- **¿Qué pasa si al inspeccionar el ZIP del operador con `diagnose-vigor-api-zip.ps1` tiene `Backslashes (\): 0` (o si el paquete conservador sigue fallando)?**
  1. **Problema interno del runtime o almacenamiento temporal de Catalyst (`/tmp/` o `/catalyst/`):** *Hipótesis* — aunque disco lleno suele devolver `status: 50` y archivo ausente `status: 9`, un conflicto de permisos/sobrescritura en `/catalyst/` o un wrapper/extractor distinto (p. ej. BusyBox `unzip` ante algún metadato POSIX/symlink) podría retornar `status: 1`.
  2. **Alteración/truncamiento durante carga por consola:** *Hipótesis poco probable para `status: 1`*, ya que un ZIP truncado o con CRC roto produce normalmente `status: 2` o `3` en `unzip`.
  3. **Symlinks / ejecutables / shims en `node_modules/.bin/`:** *Riesgo preventivo mitigado* — en `artifacts/vigor_api/` npm creó el symlink `node_modules/.bin/mime -> ../mime/cli.js`; si bien no es usado por Express ni Node en runtime, conservar symlinks o shims `.cmd`/`.ps1` resulta innecesario y potencialmente problemático según flags del extractor.
  4. **Discrepancia entre estructura esperada y archivo enviado:** *Descartado como causa de `status: 1` en `unzip -o`* porque `unzip` falla en la descompresión misma antes de que Catalyst interprete `package.json` o `catalyst-config.json`.

---

## 4. PAQUETE ALTERNATIVO CONSERVADOR Y TRAZABILIDAD SHA-256

Se mantiene intacto el primer artefacto para trazabilidad forense y se genera un segundo paquete con máxima interoperabilidad Linux (`ZIP 2.0` estándar sin metadatos innecesarios):

| Artefacto | SHA-256 | Tamaño | Entradas | Diferencias técnicas clave |
| :--- | :--- | :---: | :---: | :--- |
| **`artifacts/vigor_api.zip`** *(primer intento conservado intacto)* | `d0b6e60814f50fb7e47363fb9bef725b3fa5182ae31c826c075e3bab0ec34d64` | `1,275,008` B | `906` | Conservado sin sobrescribir (`create_system=3`, incluye `node_modules/.bin/mime` dereferenciado). |
| **`artifacts/vigor_api-portable.zip`** *(paquete alternativo conservador)* | `d009bcc01cb1afa77012f47bfc5307d91a1b75101231982bce4e045eda52b8d8` | `1,274,771` B | `905` | `create_system=0` (MS-DOS portable), `external_attr=0x20`, DEFLATE (`method=8`), `version=20`, `flag_bits=0x0`, `0` ZIP64, `0` extra fields, `100%` `/` forward slashes, `0` symlinks (`node_modules/.bin` excluido), `0` basura OS Windows/macOS. |

### Preservación funcional comprobada del paquete portátil
- Mantiene intactos en raíz: `package.json` (`name: "vigor_api"`, `"type": "module"`, `"main": "dist/server/catalystEntry.js"`, `"engines": { "node": ">=22" }`), `package-lock.json` de producción, `catalyst-config.json` (`advancedio`, `node22`), `dist/server/catalystEntry.js` (+ 15 módulos JS runtime) y las **6 dependencias runtime** en `node_modules/`.
- **Pruebas superadas sobre `vigor_api-portable.zip`:**
  - `unzip -tq` → `exit = 0` (`No errors detected`).
  - `unzip -o` (1ª extracción y 2ª sobrescritura en `/tmp/`) → `exit = 0`, `stderr = ''`.
  - Comparación origen vs extraído → **`905/905` archivos idénticos byte a byte**.
  - Carga ESM real en Node `v22.23.2` directamente desde el directorio extraído → `typeof mod.default === 'function'` y sonda `GET /health` sin entorno → HTTP **`503 SERVER_CONFIGURATION_UNAVAILABLE`**.

---

## 5. SCRIPT DE DIAGNÓSTICO WINDOWS POWERSHELL 5.1 Y FUTURO COMANDO PARA EL OPERADOR

Se creó **`poc/catalyst-clean-slate/scripts/diagnose-vigor-api-zip.ps1`** compatible con **Windows PowerShell 5.1** y **Node.js `v24.16.0`** (`engines.node >=22`):
1. Audita en modo lectura `artifacts\vigor_api.zip` (calcula SHA-256, inspecciona bytes reales de Central Directory y Local File Headers sin normalizar `\`, verifica CRC32 de cada entrada, ZIP64, symlinks, colisiones de mayúsculas/minúsculas y envoltura de directorio).
2. Construye **`artifacts\vigor_api-portable.zip`** entrada por entrada usando `ZipArchive.CreateEntry()` con barras `/` explícitas (evitando el quirk `UseBackslash` de `ZipFile.CreateFromDirectory` en PS 5.1), sin symlinks ni `node_modules/.bin`, re-audita los headers binarios del archivo generado, extrae en carpeta temporal para comparar el árbol completo y valida la carga ESM de `dist/server/catalystEntry.js` en el árbol extraído.
3. **No realiza ninguna operación remota** ni sobrescribe `artifacts\vigor_api.zip`.

**Futuro comando exacto para el operador (NO ejecutar todavía hasta indicación explícita):**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\diagnose-vigor-api-zip.ps1
```

*(Si se ejecuta desde la raíz del repositorio `Fit-X`:)*

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-clean-slate\scripts\diagnose-vigor-api-zip.ps1
```

---

## 6. EXPEDIENTE TÉCNICO PARA ZOHO CATALYST SUPPORT *(SOLO SI PERSISTE TRAS VERIFICAR ZIP SIN `\`)*

Utilizar si `diagnose-vigor-api-zip.ps1` demuestra que el ZIP originalmente subido por el operador **no** contenía barras invertidas `\` (ni anomalías de formato), o si `vigor_api-portable.zip` (con `0` warnings en `UnZip 6.00`) también produjera `status: 1`:

- **Project Name:** `Project-Rainfall`
- **Project ID:** `136967000000014024`
- **Data Center / Region:** `US`
- **Environment:** `Development`
- **Component:** Serverless → Advanced I/O Function (`Node.js 22`)
- **Function Name:** `vigor_api`
- **Function ID:** `136967000000074001`
- **Function URL:** `https://project-rainfall-943998020.development.catalystserverless.com/server/vigor_api/`
- **Observed HTTP / Runtime Failure:**
  - Request: `GET /health`
  - Response: `INTERNAL_SERVER_ERROR`
  - Exact Platform Log:
    `initialize customer code: process customer code: Error: Command failed: unzip -o /tmp/customer_code.zip -d /catalyst/`
    `status: 1, signal: null, stdout: null, stderr: null`
    `at /var/runtime/index.js:145`
- **Local Artifact Evidence:**
  - `vigor_api-portable.zip` (`1,274,771` bytes, `SHA-256: d009bcc01cb1afa77012f47bfc5307d91a1b75101231982bce4e045eda52b8d8`, `905` regular entries, `100%` `/` separators, ZIP 2.0 DEFLATE, zero ZIP64, zero symlinks, `unzip -tq` and `unzip -o` exit `0` locally).
- **Specific Ask to Zoho Support:**
  1. Inspect `/tmp/customer_code.zip` size/SHA-256 and capture the suppressed `stdout`/`stderr` of `unzip -o /tmp/customer_code.zip -d /catalyst/` in `/var/runtime/index.js:145` when `status: 1` occurred.
  2. Confirm whether Catalyst's `unzip` wrapper fails on exit code `1` (warning) or on container filesystem/permission constraints under `/catalyst/`.

---

## 7. DICTAMEN FINAL DE ANÁLISIS FORENSE

**Dictamen:** **`PHASE_5_3_CATALYST_UNZIP_FAILURE_ANALYZED`**

- **Corrección local demostrada para empaquetado Windows PowerShell 5.1:** se demostró empíricamente que el separador Windows `\` (emitido por `.NET Framework` `ZipFile.CreateFromDirectory` en PowerShell 5.1 y ocultado por la normalización `-replace '\\', '/'`) hace que Linux `UnZip 6.00` termine exactamente con **`status: 1`** (`warning: ... appears to use backslashes as path separators`), disparando el fallo en `/var/runtime/index.js:145`. Para mitigarlo definitivamente, se generó **`artifacts/vigor_api-portable.zip`** (con `/` estrictas, formato ZIP 2.0 MS-DOS estándar y cero symlinks/`.bin`) junto al auditor forense **`scripts/diagnose-vigor-api-zip.ps1`**, conservando intacto **`artifacts/vigor_api.zip`**.
- **Alcance honesto frente a plataforma remota:** si la ejecución de `diagnose-vigor-api-zip.ps1` en la máquina del operador confirma que el ZIP subido ya usaba `/` (o si una futura subida autorizada del ZIP portátil mantuviera `status: 1` en Catalyst), se requerirá intervención directa de **Zoho Catalyst Support** usando el expediente técnico de la Sección 6. **Cero operaciones remotas ejecutadas.**
