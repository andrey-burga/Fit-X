# MANIFIESTO DE ARCHIVOS Y CERTIFICACIÓN DE AISLAMIENTO
## VIGORCORE ETL — FASE 3.5.0.3

**Fecha:** 11 de noviembre de 2026  
**Ámbito de Operación:** Exclusivamente dentro de `poc/catalyst-3-2/`  
**Estado:** CERTIFIED ISOLATED  

---

### 1. CERTIFICACIÓN DE AISLAMIENTO DEL CÓDIGO PRODUCTIVO

Se certifica formalmente que durante la Fase 3.5.0.3 **ningún archivo de producción** fue modificado, creado ni eliminado:

| Componente Productivo | Estado de Integridad | Verificación |
|---|---|---|
| `src/` (Código de la aplicación web React/TypeScript) | **INTACTO (0 modificaciones)** | Integridad preservada |
| `functions/` (Cloud Functions de producción) | **INTACTO (0 modificaciones)** | Integridad preservada |
| `firestore.rules` (Reglas de seguridad de Firestore) | **INTACTO (0 modificaciones)** | Integridad preservada |
| `package.json` (Raíz del proyecto) | **INTACTO (0 modificaciones)** | Integridad preservada |
| `bun.lock` (Lockfile de dependencias del proyecto raíz) | **INTACTO (0 modificaciones)** | Integridad preservada |

---

### 2. ARCHIVOS MODIFICADOS Y CREADOS EN `poc/catalyst-3-2/`

#### Scripts Operativos
1. **`poc/catalyst-3-2/scripts/extract-firestore.ps1` (Modificado):**
   - Actualización de variables de ruta para situar `preflight-token.bin`, `checkpoint.bin` e `id-mapping.bin` en `$controlDir` (`.data/firestore-export/control/`).
   - Modo `Preflight`: creación protegida de `$controlDir` con ACLs restrictivas antes de escribir el sobre binario.
   - Modo `Extract` (Control 2): detección de binario en ubicación antigua `reports/` y bloqueo fail-closed requiriendo migración.
   - Modo `LocalSecurityAudit`:
     - Parte 1: comprobación de `preflight-token.bin` en `control/`, detección de ubicación antigua en `reports/`, verificación DPAPI y expiración (> 60 min).
     - Parte 2: conciliación forense del directorio definitivo bajo 5 estados formales (`DIRECTORY_ABSENT`, `DIRECTORY_PRESENT_EMPTY`, `DIRECTORY_PRESENT_WITH_FILES`, `DIRECTORY_PRESENT_WITH_UNEXPECTED_FILES`, `DIRECTORY_PRESENT_WITH_UNVERIFIED_CACHE`), inspección pasiva de ACL sin alteraciones automáticas y prueba sintética de ACL.
     - Parte 3: escáner exhaustivo de binarios clasificando permitidos, en ubicación no permitida y sospechosos.

2. **`poc/catalyst-3-2/scripts/migrate-preflight-binary.ps1` (Nuevo):**
   - Script independiente de 12 pasos para trasladar el ciphertext de `preflight-token.bin` desde `reports/` hacia `.data/firestore-export/control/`.
   - Incluye comprobación de tamaño, anti-sobrescritura, ACL en carpeta `control`, prueba de E/S, coincidencia exacta de SHA-256 antes y después, y purga del archivo antiguo.

#### Módulos de Soporte y Pruebas
3. **`poc/catalyst-3-2/src/etl/firestoreExtractor.ts` (Modificado):**
   - Definición de tipos `DefinitiveCacheDirectoryState` y `DefinitiveCacheInventory`.
   - Función `evaluateDefinitiveCacheState()` para clasificar el estado de almacenamiento sin descifrado.
   - Función `simulatePreflightBinaryMigration()` para validar el protocolo de migración.
   - Ampliación de `executeLocalSecurityAudit()` para soportar inventario de caché, ubicación de binario y códigos de escaneo (`UNALLOWED_BINARY_LOCATION`, `SUSPICIOUS_BINARY_DETECTED`).

4. **`poc/catalyst-3-2/scripts/test-phase-3.5-extractor.ts` (Modificado):**
   - Incorporación de la Sección 11 con 16 pruebas unitarias y simuladas (11.1 a 11.16).
   - Incremento de la suite a 68 pruebas (100% de éxito).

#### Entregables Documentales en `poc/catalyst-3-2/reports/firestore-extraction-3.5.0.3/`
5. `preflight-binary-relocation.md`: Reubicación arquitectónica de referencia y actualización de rutas.
6. `existing-cache-forensic-inventory.md`: Investigación de preexistencia y los 5 estados de caché.
7. `ntfs-acl-reconciliation.md`: Separación de los 3 contextos de ACL y procedimiento manual de remediación.
8. `git-binary-policy.md`: Política de confinamiento binario y taxonomía del escáner.
9. `test-results.md`: Matriz consolidada de pruebas (123 TS + 11 Windows = 134 puntos de control).
10. `windows-remediation-procedure.md`: Guía paso a paso para el operador en Windows.
11. `readiness-decision.md`: Justificación del estado y prohibiciones estrictas de extracción.
12. `file-change-manifest.md`: Manifiesto forense de cambios y certificación de aislamiento.

---

### 3. CONCLUSIÓN DE AUDITORÍA

Todas las operaciones se realizaron dentro del perímetro estricto de la POC, manteniendo el código productivo inalterado y preparando el entorno para la remediación en Windows.
