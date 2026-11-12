# VIGORCORE ETL — MANIFIESTO DE ARCHIVOS MODIFICADOS Y CREADOS
**Fase:** 3.5.0.6  
**Fecha:** 2026-11-11  
**Alcance de Modificaciones:** Exclusivo a `poc/catalyst-3-2/` y exclusiones específicas en `.gitignore` raíz.  

---

## 1. REGISTRO DE ARCHIVOS DE CÓDIGO Y SCRIPTS

| Archivo | Acción | SHA-256 | Descripción Técnica |
|---|:---:|---|---|
| `poc/catalyst-3-2/scripts/secure-firestore-cache-root.ps1` | Modificado (v2.0.0) | `717e7f1ae40c90c6fc5bd9d507314ec571c40637564f13979fa15799cc3f8859` | Reescritura arquitectónica en dos etapas: `-Stage 1` (aislamiento previo de `control/` con `SetAccessRuleProtection($true, $true)`) y `-Stage 2` (endurecimiento de raíz con `SetAccessRuleProtection($true, $false)`). Verificación de symlinks/reparse points, orden canónico de Deny, respaldos inmutables SDDL con SHA-256 y confirmaciones independientes. |
| `poc/catalyst-3-2/scripts/restore-firestore-cache-acl.ps1` | Creado (v1.0.0) | `e1f35c97cdd3914aab23c33d2f144f671b73bd22b1e9a7fc35fe5618c14c50fb` | Script de reversión nativo sin Clixml. Restaura descriptores SDDL exactos (`root-original-sddl.txt` y `control-original-sddl.txt`) validando hashes SHA-256 antes de aplicar y verificando la igualdad del SDDL resultante. Permite reversión completa ordenada (Raíz primero, luego Control) o reversión aislada de `control/`. |
| `poc/catalyst-3-2/scripts/extract-firestore.ps1` | Verificado (v1.0.5) | `1cc4c40c11ef56f3a620b0d27fab0872c3c76948251a61dd9b9cd59c5bce9bf7` | Confirmada la versión v1.0.5 en el código fuente (resuelve la discrepancia con el informe anterior). Incorpora manejo de arrays unitarios con `@()`, lectura/escritura UTF-8 sin BOM para hashes consistentes y parseo con cultura invariante. |
| `poc/catalyst-3-2/scripts/test-phase-3.5-extractor.ts` | Modificado | `1897186c992f7003b2523be9d9a9c3baa8dab6a57f7dfe33deb5ae1b9935af92` | Incorpora la Sección 13 con 15 pruebas automatizadas específicas para las Etapas 1 y 2, orden canónico, SDDL inalterado, integridad criptográfica de respaldos y detección de reparse points. Total de la suite elevado a 45 pruebas (100% PASS). |
| `/.gitignore` | Modificado | `23e1e9f1556601304481a7a00ef8673a0d079ce78b723f4bfca469d30020d911` | Añadidas exclusiones ancladas a la raíz para `/firestore.rules.pre-7d-live-backup.rules` y `/package-lock.json`, además de `.data/` y `*.bin`. |

---

## 2. AUDITORÍA DE CONTENCIÓN EN PRODUCCIÓN

- `src/`: 0 modificaciones (100% intacto).
- `functions/`: 0 modificaciones (100% intacto, incluyendo `functions/package-lock.json`).
- `firestore.rules`: 0 modificaciones (100% intacto, SHA-256 `9d8f71fd...`).
- `package.json`: 0 modificaciones (100% intacto, SHA-256 `f4390625...`).
- `bun.lock`: 0 modificaciones (100% intacto, SHA-256 `64001f5a...`).
- Archivos locales inesperados en Windows: **NO ELIMINADOS NI MUTADOS** (excluidos por `.gitignore`).
