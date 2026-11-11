# INVENTARIO FORENSE Y CONCILIACIÓN DEL CACHÉ LOCAL
## VIGORCORE ETL — FASE 3.5.0.3

**Fecha:** 11 de noviembre de 2026  
**Ruta Inspeccionada:** `poc/catalyst-3-2/.data/firestore-export/`  
**Metodología:** Inspección exclusiva de metadatos del sistema de archivos (Zero Content Decryption)  
**Estado:** AUDITED & CATEGORIZED  

---

### 1. INVESTIGACIÓN DE LA CONDICIÓN "EXISTE PREVIAMENTE"

Durante la ejecución de la Fase 3.5.0.2 en Windows, la consola reportó:
`- Inspeccionando estado del directorio definitivo firestore-export... EXISTE PREVIAMENTE`

Este hallazgo ameritaba una investigación profunda:
1. En la auditoría previa, se asumía que `.data/firestore-export/` debía permanecer sin crear hasta la extracción.
2. Sin embargo, en la estación local de Windows del operador, dicho directorio ya existía, posiblemente como remanente de ejecuciones preliminares, pruebas de concepto previas o creación manual durante el setup.
3. Tratar la presencia del directorio con un mensaje binario simple (`EXISTE PREVIAMENTE` vs `NO CREADO`) resultaba insuficiente para garantizar que no existiesen colisiones de datos o riesgo de sobrescritura de documentos previos.

---

### 2. LOS 5 ESTADOS FORMALES DE CONCILIACIÓN

Para la Fase 3.5.0.3, se implementó en `extract-firestore.ps1` y `firestoreExtractor.ts` una máquina de estados determinista para categorizar el directorio definitivo:

| Estado Formal | Criterio de Clasificación | Acción de Seguridad / Tratamiento |
|---|---|---|
| **`DIRECTORY_ABSENT`** | El directorio no existe en el sistema de archivos (`Test-Path` devuelve `$false`). | Estado ideal de partida antes de la primera extracción. Permite inicialización limpia y aplicación de ACL al crear. |
| **`DIRECTORY_PRESENT_EMPTY`** | El directorio existe pero su conteo de elementos (archivos y carpetas) es 0. | Seguro para iniciar extracción. No hay riesgo de sobrescritura. Requiere verificación de ACL. |
| **`DIRECTORY_PRESENT_WITH_FILES`** | El directorio contiene subdirectorios esperados (ej. `control/`) o metadatos de auditoría, pero no contiene documentos de datos. | Estado seguro tras preparar subdirectorios de control o migrar el preflight binario. |
| **`DIRECTORY_PRESENT_WITH_UNEXPECTED_FILES`** | El directorio contiene archivos con nombres o extensiones ajenas al proceso (ej. `.txt`, `.tmp`, scripts, ejecutables u otros no estándar). | **BLOQUEO INMEDIATO.** El operador debe inspeccionar y sanear el directorio manualmente. |
| **`DIRECTORY_PRESENT_WITH_UNVERIFIED_CACHE`** | El directorio contiene archivos con patrón de documento (`doc-XXXXXX.bin`) o checkpoints previos no validados. | **BLOQUEO ANTI-SOBRESCRITURA.** Prohíbe cualquier extracción destructiva que pueda sobrescribir documentos existentes sin un `-Resume` o verificación formal previa. |

---

### 3. REGLAS ESTRICTAS DE INSPECCIÓN POR METADATOS

La conciliación del directorio definitivo cumple con las siguientes salvaguardas forenses:
1. **Zero Content Decryption:** Ningún archivo dentro de `.data/firestore-export/` es abierto, descifrado ni parseado para inspección de datos. La inspección se realiza exclusivamente mediante llamadas a `Get-ChildItem` e interrogación de propiedades nativas del objeto de sistema de archivos (`FileInfo` / `DirectoryInfo`).
2. **Atributos Recopilados:**
   - Conteo total de archivos (`$cacheFiles.Count`).
   - Conteo total de subcarpetas (`$cacheDirs.Count`).
   - Suma agregada de bytes (`$totalBytes`).
   - Inventario de extensiones únicas (`$defExtensions.Keys`).
   - Lista de nombres opacos (`doc-000001.bin`, `control/`, `checkpoint.bin`).
   - Fechas de creación y última modificación.
   - Atributos del sistema de archivos (`ReadOnly`, `Hidden`, `Archive`).
3. **No Presunción de Inocencia:** No se asume que un archivo `.bin` es válido únicamente por poseer dicha extensión. Cualquier archivo que no cumpla con las expresiones regulares estrictas (`^doc-\d{6}\.bin$` o `^(checkpoint|id-mapping|preflight-token)\.bin$`) es clasificado de inmediato como `UNEXPECTED_FILES`.

---

### 4. PROTECCIÓN ANTI-SOBRESCRITURA

Si en la estación Windows del operador existen documentos previos en `.data/firestore-export/`, el extractor:
- **No borra** ningún archivo.
- **No renombra** ningún archivo existente.
- **No sobrescribe** archivos `doc-XXXXXX.bin`.
- Si se ejecutase un `Extract` sin reanudación controlada, el script aborta inmediatamente con excepción `FAIL-CLOSED` al detectar la presencia de caché previo no conciliado.

---

### 5. CONCLUSIÓN

La conciliación del directorio definitivo garantiza que cualquier estado preexistente en la estación Windows sea detectado, clasificado y protegido de manera exhaustiva antes de considerar autorizable la extracción de datos.
