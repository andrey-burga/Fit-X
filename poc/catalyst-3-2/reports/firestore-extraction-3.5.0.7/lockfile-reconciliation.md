# VIGORCORE — INFORME DE CONCILIACIÓN DE LOCKFILES
## AUDITORÍA COMPARATIVA DE PACKAGE.JSON, BUN.LOCK Y PACKAGE-LOCK.JSON

**Fase:** 3.5.0.7  
**Fecha:** 11 de Noviembre de 2026  
**Ámbito:** Raíz del Repositorio y Módulos Secundarios  
**Dictamen Técnico:** `LOCKFILES_AUDIT_COMPLETED_CANONICAL_BUN_VERIFIED`

---

### 1. OBJETIVO DE LA AUDITORÍA

Investigar el archivo no rastreado `package-lock.json` detectado físicamente en Windows en la raíz del repositorio (`?? ../../package-lock.json`), determinar su procedencia, su concordancia con `package.json` y `bun.lock`, y establecer una política inmutable para su preservación y aislamiento sin alterar los pipelines productivos.

---

### 2. MATRIZ COMPARATIVA DE LOCKFILES

| Propiedad | `package.json` (Raíz) | `bun.lock` (Raíz) | `package-lock.json` (Raíz) | `functions/package-lock.json` |
|---|---|---|---|---|
| **Ruta** | `/package.json` | `/bun.lock` | `/package-lock.json` | `/functions/package-lock.json` |
| **Rol en VigorCore** | Manifiesto de especificación | **Lockfile Canónico Raíz** | **Artefacto Colateral Obsoleto** | **Lockfile Canónico Functions** |
| **Gestor Responsable** | npm / bun | **Bun v1.x** | npm (generado por `npx`) | **npm (Node.js 22)** |
| **Tamaño Físico** | 2,575 bytes | 124,735 bytes | 177,558 bytes | 109,940 bytes |
| **Hash SHA-256** | `c21d8487...` | `64001f5ad16fec7a9c46d77ba85374c4e0751a36022124e843a8bb684a364459` | `3247172eace20f71919a4c0eb490dc1ab8000012fc20def72bf0f7e0f49d596e` | `2ff1d70f234104a4764e7884f96b1e0a3698547c6b15f060d6b26b711b0a6e58` |
| **lockfileVersion** | N/A | Version 2 | Version 3 | Version 3 |
| **Nombre Declarado** | `react-example` | `react-example` | `react-example` | `functions` |
| **Versión Declarada** | `0.0.0` | N/A | `0.0.0` | N/A (en `package.json` es privada) |
| **Fecha de Origen** | Activo | 12/11/2026 | 23/10/2026 | 12/11/2026 |
| **Estado Git** | Rastreado | Rastreado | Ignorado por `/.gitignore` | Rastreado |

---

### 3. HALLAZGOS FORENSES Y ANÁLISIS DE PROCEDENCIA

#### 3.1. Origen de `package-lock.json` (Raíz)
1. El archivo reporta fecha de modificación del **23 de octubre de 2026** (fecha en la que se ejecutaron las operaciones de la Fase 6C.2 y los preparativos de la Fase 7D, tal como atestigua el archivo `firestore.rules.backup-20261023-pre-deploy-6c2`).
2. En esa fecha, el operador ejecutó herramientas mediante `npx` (por ejemplo, `npx firebase ...` o `npx tsx ...`).
3. En entornos con npm v7+, cuando `npx` se invoca en un directorio con `package.json` pero sin un `package-lock.json` previo, el cliente npm resuelve el árbol de dependencias local y escribe automáticamente un `package-lock.json` (lockfileVersion 3) de manera colateral.
4. Dado que el proyecto principal utiliza **Bun** como entorno de ejecución, instalación y bundling para el frontend y backend local (`bun install`, `bun.lock`), el archivo `package-lock.json` quedó desacoplado y desactualizado respecto a las adiciones posteriores de dependencias.

#### 3.2. Comparación Programática con `package.json`
- **Nombre y Versión:** Coinciden (`react-example@0.0.0`).
- **Dependencias Directas:** `package.json` declara 13 dependencias de producción y 10 devDependencies.
- **Divergencia Temporal:** El árbol del `package-lock.json` raíz representa la resolución congelada del 23 de octubre de 2026, mientras que `bun.lock` contiene las actualizaciones contemporáneas (226 paquetes instalados por Bun).
- **`functions/package-lock.json`:** Corresponde al subárbol aislado de Cloud Functions v2 en Node.js 22 (`functions/package.json`). Este archivo es estrictamente necesario para `firebase deploy --only functions` y `npm --prefix functions run build`.

---

### 4. POLÍTICA DE GESTIÓN Y AISLAMIENTO

1. **Preservación Física:** No se elimina el archivo `package-lock.json` raíz. Se conserva en el disco local como evidencia forense de las ejecuciones de octubre de 2026.
2. **Aislamiento en Git:** Se mantiene la regla anclada en `/.gitignore`:
   ```gitignore
   /package-lock.json
   ```
   Esta regla evita que Git lo detecte como untracked (`?? ../../package-lock.json`) sin afectar al `functions/package-lock.json` (que no coincide con la ruta anclada a la raíz).
3. **Canonicidad de Bun:** Para cualquier operación en la raíz, el comando oficial de sincronización es `bun install`, garantizando la integridad de `bun.lock`.
4. **Canonicidad de Functions:** Para cualquier operación en Cloud Functions, el comando oficial es `npm --prefix functions ci`, garantizando la integridad de `functions/package-lock.json`.

---

### 5. CONCLUSIÓN

No existe conflicto operativo en el repositorio. Cada lockfile cumple un rol definido en su respectivo dominio, y el archivo colateral de la raíz ha sido neutralizado sin riesgo de regresión ni pérdida de información histórica.
