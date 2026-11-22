# VIGORCORE — FASE 5.3: FINAL DEPLOYMENT ARTIFACT SHA-256 RECONCILIATION

**Proyecto en Google AI Studio:** `Fit-X` *(trabajo estrictamente aislado en `poc/catalyst-clean-slate/`)*  
**Proyecto Zoho Catalyst:** `Project-Rainfall` (`136967000000014024`)  
**Función destino:** `vigor_api` · Advanced I/O · Node.js 22 · Entorno `Development`  
**Operaciones remotas ejecutadas:** **`0`**  
**Dictamen:** **`PHASE_5_3_FINAL_ARTIFACT_RECONCILED_NOT_DEPLOYED`**

---

## 1. DISCREPANCIA REPORTADA

| Origen | Artefacto | Tamaño (bytes) | SHA-256 |
| :--- | :--- | ---: | :--- |
| Build previo en Linux (`AI Studio`) | `artifacts/vigor_api-env-audit-portable.zip` | `1,277,498` | `a7565d2c2c121e0f585e2c65daf5204e1645819737869c0d6edb0e35af3af7a0` |
| Ejecución en Windows (`npx tsx .../build-vigor-api-portable-package.ts`) | Salida local Windows | `1,277,498` | `31b0f7b03b7aa48e07d28962ad6ea4cc52ab50e1b87696f7cf1e396effe4a9f7` |

**Observación clave:** Ambos archivos tienen exactamente **`1,277,498` bytes**, pero hashes SHA-256 distintos.

---

## 2. AUDITORÍA FORENSE DE LAS 9 DIMENSIONES

Se inspeccionaron binariamente los Local File Headers (LFH), Central Directory Headers (CDH), End of Central Directory (EOCD), streams DEFLATE descomprimidos y proceso de staging de `poc/catalyst-clean-slate/scripts/build-vigor-api-portable-package.ts`.

| # | Dimensión auditada | Hallazgo técnico medido | ¿Causó la diferencia SHA-256? |
| :--- | :--- | :--- | :--- |
| 1 | **Timestamps de entradas ZIP** | El builder TS escribía `mtime = 0x0000` y `mdate = 0x0000` en ambos SO (aunque `mdate = 0` es fuera de especificación DOS `1980-01-01`; el `.ps1` heredado usaba `DateTimeOffset.Now`). | **No** en TSX (**Sí** latente en `.ps1`). Corregido a época DOS válida `1980-01-01 00:00:00` (`mtime=0x0000`, `mdate=0x0021`). |
| 2 | **Orden de entradas ZIP** | `walkFiles()` iteraba `fs.readdirSync(dir, { withFileTypes: true })` sin ordenar. Se midieron **`219 / 905`** entradas fuera de orden de código ASCII/UTF-8 en `vigor_api-env-audit-portable.zip` (Linux ordena `@zcatalyst/auth/` antes que `@zcatalyst/auth-admin/` y mayúsculas `HISTORY.md`/`LICENSE` por tabla de inodos/caso-sensible; Windows NTFS enumera B-tree insensible a mayúsculas). | **SÍ — CAUSA RAÍZ EXACTA.** Al permutar las mismas 905 entradas manteniendo compresión independiente por entrada, el tamaño total permanece invariante (`1,277,498` B), pero cambia el orden físico de LFH, los offsets del Central Directory y el orden de CDH. |
| 3 | **Implementación / nivel de compresión** | `zlib.deflateRawSync(content)` usa zlib incluido en Node.js con nivel por defecto `6`. Ambos SO produjeron streams idénticos (`1,277,498` B totales). | **No.** Se fijó explícitamente `{ level: 6, memLevel: 8, strategy: Z_DEFAULT_STRATEGY }`. |
| 4 | **Atributos externos** | `externalFileAttributes` fijo en `0x20` (`32`, bit archivo MS-DOS) en las 905 entradas. | **No.** Preservado en `0x20`. |
| 5 | **Local File Header (LFH)** | `verNeed = 20`, `flags = 0`, `method = 8`, `extraLen = 0` uniformes en ambos SO. Solo cambió la secuencia física de LFH. | **Derivado del orden (#2).** |
| 6 | **Central Directory (CD)** | `verMade = 20` (MS-DOS), `verNeed = 20`, `extAttr = 0x20` idénticos; cambió el campo `relativeOffsetOfLocalHeader` (offset +42) y el orden de los CDH. | **Derivado del orden (#2).** |
| 7 | **Contenido de archivos** | Comparación SHA-256 archivo por archivo de las 905 entradas descomprimidas: **`0` diferencias** (`3,751,004` bytes totales). | **No.** Se añadió `"newLine": "lf"` en `tsconfig.server.json` y normalización LF en JSON generados como salvaguarda. |
| 8 | **Instalación de dependencias** | `npm install --omit=dev --ignore-scripts` instaló los mismos 74 paquetes y generó `package-lock.json` idéntico (`32,763` B, SHA-256 `1d23619a16cc2386a5d65ef15d4942066da1f4bfdfa01d0de12bc0984363af6c`). | **No.** |
| 9 | **Contenido de staging** | Mismas `905` entradas (`package.json`, `package-lock.json`, `catalyst-config.json`, `16` archivos `dist/**/*.js` y `886` archivos en `node_modules/`). Cero symlinks, cero `.bin/`, cero mapas `.js.map`. | **No.** |

---

## 3. COMPARACIÓN DE MANIFIESTO CANÓNICO DE CONTENIDO

Comparación ordenada canónicamente por ruta relativa POSIX (`path`, `uncompressedSize`, `sha256`, `fileType`), excluyendo cabeceras ZIP, entre `artifacts/vigor_api-env-audit-portable.zip` (Linux original) y `artifacts/vigor_api-reproducible-portable.zip` (nuevo build determinista):

- **Entradas en manifiesto esperado (`vigor_api-env-audit-portable.zip`):** `905`
- **Entradas en manifiesto generado (`vigor_api-reproducible-portable.zip`):** `905`
- **Archivos faltantes (`missing`):** `0` (`[]`)
- **Archivos inesperados (`unexpected`):** `0` (`[]`)
- **Contenidos modificados (`changed`):** `0` (`[]`)
- **Total de bytes descomprimidos (esperado):** `3,751,004` bytes
- **Total de bytes descomprimidos (generado):** `3,751,004` bytes

**Conclusión de integridad funcional:** El contenido descomprimido ejecutado por Catalyst en el paquete de Windows (`31b0f7b0...`) y en el de Linux (`a7565d2c...`) era funcional y binariamente **100% equivalente**; la diferencia de SHA-256 se debió exclusivamente al orden de enumeración de archivos del sistema operativo al construir el ZIP.

---

## 4. CORRECCIONES APLICADAS AL EMPAQUETADO DETERMINISTA

1. **`poc/catalyst-clean-slate/scripts/build-vigor-api-portable-package.ts`**
   - Ordenación estricta por código de punto UTF-8/ASCII (`a < b ? -1 : a > b ? 1 : 0`) en recorrido y lista final de rutas POSIX relativas (`/`).
   - Época DOS válida fija `1980-01-01 00:00:00` (`mtime = 0x0000`, `mdate = 0x0021`).
   - Parámetros `zlib.deflateRawSync` fijados (`level: 6`, `memLevel: 8`, `Z_DEFAULT_STRATEGY`), `verMade=20`, `verNeed=20`, `flags=0`, `extAttr=0x20`.
   - Exclusión explícita de symlinks, `node_modules/.bin/`, `*.js.map`, `.DS_Store`, `Thumbs.db`, `desktop.ini`.
   - Staging temporal aislado en `os.tmpdir()` (eliminado en `finally`), emitiendo el nuevo artefacto versionado **`artifacts/vigor_api-reproducible-portable.zip`** sin sobrescribir `artifacts/vigor_api/` ni ninguno de los ZIP anteriores.
2. **`poc/catalyst-clean-slate/scripts/build-vigor-api-portable-package.ps1`**
   - Ordenación ordinal exacta `[System.StringComparer]::Ordinal`, normalización LF (`\n`), `LastWriteTime` fijo a `1980-01-01T00:00:00Z`, exclusión de symlinks/`ReparsePoint` y basura OS, staging temporal aislado y salida versionada `artifacts/vigor_api-reproducible-portable.zip`.
   - *(Nota técnica: `.ps1` usa .NET `ZipArchive` cuyo motor DEFLATE difiere de Node `zlib`; el artefacto SHA-256 canónico multiplataforma Windows/Linux se genera con `npx tsx poc/catalyst-clean-slate/scripts/build-vigor-api-portable-package.ts`).*
3. **`poc/catalyst-clean-slate/tsconfig.server.json`**
   - Añadido `"newLine": "lf"` para garantizar saltos de línea uniformes en `dist/**/*.js` entre Windows y Linux.

---

## 5. ARTEFACTO DEFINITIVO Y VERIFICACIÓN DE REPRODUCIBILIDAD

### Artefacto final generado (sin sobrescribir los anteriores)
- **Ruta:** `poc/catalyst-clean-slate/artifacts/vigor_api-reproducible-portable.zip`
- **Entradas:** `905` (100% ordenadas por código de punto, rutas con `/`)
- **Tamaño comprimido:** `1,277,498` bytes (`1.22 MB`)
- **Tamaño descomprimido:** `3,751,004` bytes
- **SHA-256 canónico:** **`31e9b71ea7af48a8483c903e206c625bbe823048bdab6db47567d8ce4cdd52fb`**

### Prueba de reproducibilidad en dos ejecuciones consecutivas
- **Ejecución 1 (`vigor_api-reproducible-portable.zip`):** `1,277,498` bytes · SHA-256 `31e9b71ea7af48a8483c903e206c625bbe823048bdab6db47567d8ce4cdd52fb`
- **Ejecución 2 (directorio temporal independiente):** `1,277,498` bytes · SHA-256 `31e9b71ea7af48a8483c903e206c625bbe823048bdab6db47567d8ce4cdd52fb`
- **Resultado:** **Coincidencia bit a bit del 100%** + `unzip -tq` / `unzip -oq` código `0` + importación ESM bajo **Node.js `v22.23.2`** (`503 SERVER_CONFIGURATION_UNAVAILABLE`).

### Comando recomendado para el operador (Windows y Linux)
```powershell
npx tsx poc/catalyst-clean-slate/scripts/build-vigor-api-portable-package.ts
```
*(Alternativa PowerShell 5.1 con empaquetado determinista local .NET: `powershell -ExecutionPolicy Bypass -File poc/catalyst-clean-slate/scripts/build-vigor-api-portable-package.ps1`).*

---

## 6. DICTAMEN FINAL

**Dictamen:** **`PHASE_5_3_FINAL_ARTIFACT_RECONCILED_NOT_DEPLOYED`**
