# VIGORCORE — MANIFIESTO DE ARCHIVOS FASE 3.5.0.7
## REGISTRO DE ARCHIVOS MODIFICADOS, CREADOS Y PRESERVADOS

**Fecha:** 11 de Noviembre de 2026  
**Fase:** 3.5.0.7 — Rectificación Forense de Respaldo Firestore Rules y Conciliación de Lockfiles

---

### 1. ARCHIVOS MODIFICADOS

| Archivo | Tipo | Hash SHA-256 | Justificación del Cambio |
|---|---|---|---|
| `docs/production-readiness-7D.md` | Documentación | `32b8aadfaaca567b9a44c191e408a67740a63a679c38bb16614d99b10630031d` | Sustitución de instrucción errónea `firebase firestore:rules:get` por advertencia de comando inválido y procedimiento REST oficial (`firebaserules.googleapis.com/v1`). |
| `docs/production-checklist-7D.md` | Documentación | `6761d72f50eee55906290f96359a31f1bebdc618ebd2f1bb8ec9f981a9c9467f` | Actualización del criterio 62 referenciando la API REST de Firebase Security Rules en lugar del comando inválido. |
| `poc/catalyst-3-2/scripts/test-phase-3.5-extractor.ts` | Test Suite | `3b1f3f8280818db8e9c305ed8d77d2814b789c74d2e7bbd9d55885947700eafb` | Incorporación de la Sección 14 (pruebas `T-3507-01` a `T-3507-05`), elevando el total a 50 escenarios aprobados. |

---

### 2. ARCHIVOS NUEVOS CREADOS

| Archivo | Tipo | Hash SHA-256 | Propósito |
|---|---|---|---|
| `poc/catalyst-3-2/scripts/query-remote-rules.ps1` | Script PowerShell 5.1 | `712da4202237512fc14b6cee193daea6723e6ac9326d60be7393c19d164eda8b` | Script de solo lectura (GET) para consultar releases y rulesets en vivo mediante Firebase Rules API y guardar snapshot. |
| `poc/catalyst-3-2/scripts/audit-package-lock.ts` | Script Node.js | `b92b2cd39c82d5c06d06fee0799f2c7e7cd73d45da912e39f7c4858d076eaf38` | Script para auditar y conciliar programáticamente los lockfiles del proyecto (`package.json`, `bun.lock`, `package-lock.json`). |
| `poc/catalyst-3-2/reports/firestore-extraction-3.5.0.7/forensic-report-rules-and-lockfiles.md` | Informe | `3f09ff9d2b790af4fc0d858d8fd590666ce0f46ca62b9a5d2f4b3d1c5cedc48d` | Informe pericial completo sobre el artefacto de 166 bytes, clasificación y resolución. |
| `poc/catalyst-3-2/reports/firestore-extraction-3.5.0.7/remote-rules-query-procedure.md` | Especificación | `6b0ad99ef8099d822428ec8f934b9fc05a51a2a313019ce40d5fb6c2bc8bf484` | Procedimiento operativo paso a paso para la consulta de reglas vía REST en Windows y Bash. |
| `poc/catalyst-3-2/reports/firestore-extraction-3.5.0.7/lockfile-reconciliation.md` | Informe | `44fb2f83d0e17ed21f6cab51741b92a34d590253b626cc32c3cf11a0fe332d4d` | Análisis comparativo de dependencias, roles de cada lockfile y justificación del estado obsoleto de la raíz. |
| `poc/catalyst-3-2/reports/firestore-extraction-3.5.0.7/evidence-and-limitations-matrix.md` | Matriz | `77d9fdd5bf84faef3ced5053ebe19994620bfacbab3ef65bc3b5aa81a07c3db1` | Matriz de evidencias físicas, limitaciones del entorno y límites de seguridad cumplidos. |
| `poc/catalyst-3-2/reports/firestore-extraction-3.5.0.7/file-change-manifest.md` | Manifiesto | (Este archivo) | Registro de integridad de todos los artefactos de la fase. |

---

### 3. ARCHIVOS PRESERVADOS E INTACTOS

| Archivo | Hash SHA-256 | Estado | Observación |
|---|---|---|---|
| `/firestore.rules` | (17,770 bytes) | **INTACTO** | Reglas productivas actuales sin modificaciones |
| `/bun.lock` | `64001f5ad16fec7a9c46d77ba85374c4e0751a36022124e843a8bb684a364459` | **INTACTO** | Lockfile canónico de la raíz |
| `/package.json` | (2,575 bytes) | **INTACTO** | Manifiesto principal de la aplicación |
| `/functions/package-lock.json` | `2ff1d70f234104a4764e7884f96b1e0a3698547c6b15f060d6b26b711b0a6e58` | **INTACTO** | Lockfile de Cloud Functions v2 |
| `/firestore.rules.pre-7d-live-backup.rules` | `D4CE9EBC583DBF901BD7728E2E9FD5711601FB567499C4A3D78DE453C9640C18` | **PRESERVADO** | Artefacto de error conservado físicamente |
| `/package-lock.json` (Raíz en Windows) | `3247172EACE20F71919A4C0EB490DC1AB8000012FC20DEF72BF0F7E0F49D596E` | **PRESERVADO** | Artefacto colateral conservado físicamente |
| `src/` (Directorio) | Múltiples | **INTACTO** | Código fuente del frontend sin alteraciones |
| `functions/src/` (Directorio) | Múltiples | **INTACTO** | Código fuente de Cloud Functions sin alteraciones |
