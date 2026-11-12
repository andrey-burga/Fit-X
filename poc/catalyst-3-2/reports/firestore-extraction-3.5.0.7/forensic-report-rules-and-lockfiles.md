# VIGORCORE — INFORME FORENSE FASE 3.5.0.7
## RECTIFICACIÓN DE RESPALDO FIRESTORE RULES Y CONCILIACIÓN DE LOCKFILES

**Fecha de Auditoría:** 11 de Noviembre de 2026  
**Proyecto Google Cloud:** `gen-lang-client-0041212770`  
**Base de Datos Firestore:** `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c` (Enterprise, us-east1)  
**Clasificación:** Confidencial / Auditoría Forense de Infraestructura  
**Dictamen Oficial:** `FIRESTORE_RULES_BACKUP_STATUS_RECONCILED — PENDING VERIFIED REMOTE RULESET`

---

### 1. RESUMEN EJECUTIVO

Durante la verificación física en el entorno operativo Windows posterior a la Fase 3.5.0.6, se inspeccionó exhaustivamente el archivo:
`firestore.rules.pre-7d-live-backup.rules`

Los hallazgos físicos confirmaron de manera irrefutable que dicho archivo:
1. Posee un tamaño de **166 bytes** y un hash SHA-256:
   `D4CE9EBC583DBF901BD7728E2E9FD5711601FB567499C4A3D78DE453C9640C18`
2. Su contenido textual es exclusivamente:
   ```text
   Error: firestore:rules:get is not a Firebase command
   ```
3. El comando invocado en la documentación de la Fase 7D (`docs/production-readiness-7D.md`, líneas 254-258):
   `npx firebase firestore:rules:get --project gen-lang-client-0041212770 > firestore.rules.pre-7d-live-backup.rules`
   corresponde a una instrucción inválida. El subcomando `firestore:rules:get` **no existe** en la suite oficial `firebase-tools`.
4. La redirección de consola `>` capturó la salida de error de la CLI, creando un artefacto espurio que fue erróneamente catalogado como un snapshot en vivo de las reglas de Firestore.
5. **Impacto Operativo:** El archivo local carece en un 100% de capacidad de restauración o rollback. No existió un respaldo válido previo al procedimiento de activación de la Fase 7D mediante esta vía.
6. En consecuencia, el archivo queda reclasificado de forma obligatoria como:
   `INVALID_BACKUP_ARTIFACT — ERROR OUTPUT`
7. Adicionalmente, se auditó el archivo `package-lock.json` en la raíz (177,558 bytes, SHA-256 `3247172EACE20F71919A4C0EB490DC1AB8000012FC20DEF72BF0F7E0F49D596E`), determinándose que es un residuo colateral del 23/10/2026 generado por `npx/npm`. Se ratifica que **`bun.lock` es el lockfile canónico de la raíz** y **`functions/package-lock.json` es el lockfile canónico de Cloud Functions**.

---

### 2. EVIDENCIA FÍSICA Y ANÁLISIS FORENSE DEL ARTEFACTO DE 166 BYTES

#### 2.1. Metadatos Forenses
- **Nombre:** `firestore.rules.pre-7d-live-backup.rules`
- **Ubicación Original:** Raíz del repositorio (`/` o `../../` desde `poc/catalyst-3-2/`)
- **Tamaño Exacto:** `166 bytes`
- **Hash SHA-256:** `D4CE9EBC583DBF901BD7728E2E9FD5711601FB567499C4A3D78DE453C9640C18`
- **Contenido Íntegro:**
  ```text
  Error: firestore:rules:get is not a Firebase command
  ```

#### 2.2. Comprobación de la CLI de Firebase (`firebase-tools`)
Se ejecutó la consulta de ayuda oficial sobre la herramienta `firebase-tools`:
```bash
$ firebase firestore --help
```
Comandos válidos expuestos por la CLI:
- `firestore:delete [options] [path]`
- `firestore:bulkdelete [options]`
- `firestore:indexes [options]`
- `firestore:locations`
- `firestore:operations`
- `firestore:databases`
- `firestore:backups`

**Conclusión:** No existe ningún grupo `firestore:rules` ni comando `firestore:rules:get`. La CLI de Firebase solo gestiona el despliegue de reglas mediante `firebase deploy --only firestore:rules`, pero no expone comandos nativos de descarga/inspección de reglas por CLI.

#### 2.3. Peligro de Rollback No Verificado
Si en un incidente de producción el equipo de operaciones hubiera intentado ejecutar una restauración de emergencia basada en este archivo:
```powershell
cp firestore.rules.pre-7d-live-backup.rules firestore.rules
firebase deploy --only firestore:rules
```
El despliegue habría abortado con error de sintaxis del compilador de reglas CEL, bloqueando el pipeline, o peor aún, dejando el sistema en estado indefinido si no se contaba con validaciones previas.

---

### 3. ESTADO DE LOS ARCHIVOS LOCALES DE REGLAS

Se realizó un inventario de todos los archivos de reglas locales existentes en el repositorio:

| Archivo | Tamaño | Líneas | Estado / Clasificación | Capacidad de Rollback para 7D |
|---|---|---|---|---|
| `firestore.rules` | 17,770 B | 469 | Reglas productivas actuales (Fase 7D con 6 colecciones admin y RBAC) | Estado actual en repo (desplegado o por desplegar) |
| `firestore.rules.backup-20261023-pre-deploy-6c2` | 14,438 B | 280 | Respaldo legítimo de Fase 6C.2 (23/10/2026) | **INSUFICIENTE**: No contiene colecciones administrativas ni RBAC |
| `firestore.rules.backup-increment-6b` | 11,220 B | 215 | Respaldo legítimo de Fase 6B | **OBSOLETO** |
| `firestore.rules.pre-7d-live-backup.rules` | 166 B | 1 | `INVALID_BACKUP_ARTIFACT — ERROR OUTPUT` | **NULA (0%)**: Solo contiene mensaje de error |

**Conclusión:** Localmente **NO existe ningún snapshot de las reglas remotas** tal y como estaban configuradas en Google Cloud antes del procedimiento 7D.

---

### 4. INVESTIGACIÓN DE LA API OFICIAL DE GESTIÓN DE REGLAS (FIREBASE RULES MANAGEMENT API)

Para subsanar de forma definitiva la carencia de un método de extracción, se analizó la especificación oficial de Google Cloud:

#### 4.1. Endpoints Oficiales (Solo Lectura - GET)
- **Servicio:** `firebaserules.googleapis.com/v1`
- **Listar Releases:**
  `GET https://firebaserules.googleapis.com/v1/projects/{project_id}/releases`
- **Consultar Ruleset:**
  `GET https://firebaserules.googleapis.com/v1/projects/{project_id}/rulesets/{ruleset_id}`

#### 4.2. Diferenciación Crítica: Base `(default)` vs Base Nombrada
En proyectos con **Firestore Enterprise Multi-Database**:
1. La base de datos por defecto se vincula a releases con nombre:
   `projects/{project_id}/releases/cloud.firestore`
2. La base de datos nombrada (`ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`) se vincula a releases con sufijo de base de datos:
   `projects/{project_id}/releases/cloud.firestore/databases/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c` o bien mediante el formato `cloud.firestore.{database_id}`.
3. **No asumir equivalencia:** Desplegar o consultar las reglas de `(default)` **NO** afecta ni refleja las reglas de la base nombrada. Son releases completamente desacopladas.

#### 4.3. Script Auditado Desarrollado
Se desarrolló el script:
`poc/catalyst-3-2/scripts/query-remote-rules.ps1`
Permite al operador consultar la API de reglas utilizando su token ADC local sin riesgo de escrituras, despliegues o alteraciones de permisos.

---

### 5. AUDITORÍA Y CONCILIACIÓN DE LOCKFILES

#### 5.1. Contexto de los Lockfiles en VigorCore
El proyecto presenta tres lockfiles en distintos ámbitos:
1. `bun.lock` (Raíz, 124,735 bytes):
   - **Gestor Canónico:** Bun v1.x (lockfile v2).
   - **Contenido:** Contiene exactamente las 23 dependencias de `package.json` (13 dependencies + 10 devDependencies).
   - **SHA-256:** `64001f5ad16fec7a9c46d77ba85374c4e0751a36022124e843a8bb684a364459`.
2. `functions/package-lock.json` (109,940 bytes):
   - **Gestor Canónico:** npm (Node.js 22 para Cloud Functions).
   - **Propósito:** Requerido por Firebase CLI para el despliegue reproducible de Cloud Functions.
   - **Estado:** Intacto, rastreado por Git, verificado con `npm --prefix functions run build`.
   - **SHA-256:** `2ff1d70f234104a4764e7884f96b1e0a3698547c6b15f060d6b26b711b0a6e58`.
3. `package-lock.json` (Raíz, 177,558 bytes):
   - **Origen:** Generado colateralmente por `npx` el 23/10/2026.
   - **SHA-256:** `3247172EACE20F71919A4C0EB490DC1AB8000012FC20DEF72BF0F7E0F49D596E`.
   - **Clasificación:** `OBSOLETE_COLLATERAL`.
   - **Decisión:** Preservar localmente sin eliminar, aislado mediante la regla anclada `/package-lock.json` en `/.gitignore`.

---

### 6. RECTIFICACIÓN DE DOCUMENTOS PRODUCTIVOS

Se aplicaron las correcciones quirúrgicas en los siguientes documentos de ingeniería:
1. `docs/production-readiness-7D.md`:
   - Sustitución de las líneas 253-258 por la advertencia explícita del comando inválido, clasificación del artefacto de 166 bytes e incorporación del procedimiento REST oficial con PowerShell y ADC.
2. `docs/production-checklist-7D.md`:
   - Corrección del criterio 62, eliminando la referencia a `firebase firestore:rules:get` y sustituyéndola por la consulta vía API REST de Firebase Rules.

---

### 7. VERIFICACIÓN GIT Y PROTECCIÓN DE ARTEFACTOS

El archivo `/.gitignore` en la raíz contiene las siguientes reglas ancladas:
```gitignore
# Exclusiones específicas de artefactos no deseados en la raíz
/firestore.rules.pre-7d-live-backup.rules
/package-lock.json
```
- **Aislamiento verificado:** El prefijo `/` asegura que solo los archivos de la raíz quedan excluidos.
- `functions/package-lock.json` permanece rastreado por Git.
- Los respaldos legítimos (`firestore.rules.backup-*`) permanecen disponibles y protegidos.

---

### 8. DICTAMEN OFICIAL

```text
========================================================================================
 DICTAMEN DE LA FASE 3.5.0.7:
 FIRESTORE_RULES_BACKUP_STATUS_RECONCILED — PENDING VERIFIED REMOTE RULESET
========================================================================================
 1. Artefacto de 166 bytes formalmente catalogado como INVALID_BACKUP_ARTIFACT.
 2. Documentos 7D rectificados eliminando el comando inexistente.
 3. Procedimiento oficial de consulta REST documentado y scripted (query-remote-rules.ps1).
 4. Lockfiles conciliados: bun.lock ratificado como canónico de la raíz.
 5. 50/50 pruebas automatizadas aprobadas.
 6. El estado de respaldo en vivo permanece 'PENDIENTE' hasta que el operador ejecute la
    consulta REST remota en Windows con credenciales ADC activas.
========================================================================================
```
