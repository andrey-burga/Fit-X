# VIGORCORE ETL — MANIFIESTO DE ARCHIVOS MODIFICADOS Y CREADOS
**Fase:** 3.5.0.4  
**Fecha:** 2026-11-11  
**Alcance de Modificaciones:** Exclusivo a `poc/catalyst-3-2/`  
**Estado del Código Productivo:** Intacto (Cero modificaciones en producción)  

---

## 1. REGISTRO DE ARCHIVOS DE CÓDIGO Y SCRIPTS

| Archivo | Acción | Descripción Técnica |
|---|:---:|---|
| `poc/catalyst-3-2/scripts/extract-firestore.ps1` | Modificado | Migración de `(Get-Date).ToUniversalTime()` y `[DateTime]::Parse()` a `[DateTimeOffset]::UtcNow.ToString('o')` y `[DateTimeOffset]::Parse()`. Incorporación de verificaciones de fecha futura (`PREFLIGHT_TOKEN_FUTURE`), discrepancia JSON/BIN (`PREFLIGHT_TIMESTAMP_MISMATCH`), formato inválido (`PREFLIGHT_TOKEN_INVALID_TIMESTAMP`) y comprobación de ACL de `.data\firestore-export` con reporte de falla si la herencia permanece activa (`DEFINITIVE_CACHE_ACL_INSUFFICIENT`). |
| `poc/catalyst-3-2/scripts/secure-firestore-cache-root.ps1` | Creado | Script de endurecimiento de permisos NTFS sobre `.data\firestore-export`. Deshabilita herencia (`SetAccessRuleProtection($true, $false)`), elimina `BUILTIN\Users`, concede `FullControl` a CurrentUser, SYSTEM y Administrators. Realiza respaldo doble previo en `control\` (XML y SDDL), valida no-regresión en `control\` y ejecuta prueba de sondeo I/O. |
| `poc/catalyst-3-2/scripts/migrate-preflight-binary.ps1` | Creado | Script utilitario para traslado y verificación de integridad SHA-256 de `preflight-token.bin` hacia `.data\firestore-export\control\`. |
| `poc/catalyst-3-2/scripts/test-phase-3.5-extractor.ts` | Creado / Actualizado | Suite automatizada de pruebas unitarias y de integración. Incorpora la Sección 12 con 13 pruebas específicas para la Fase 3.5.0.4 (timestamps UTC, simulación del bug de 300 min, offsets locales, caducidad, fechas futuras y evaluación de ACL NTFS). |

---

## 2. REGISTRO DE ENTREGABLES Y REPORTES DOCUMENTALES

| Reporte | Ruta | Propósito |
|---|---|---|
| **Reporte 1** | `poc/catalyst-3-2/reports/firestore-extraction-3.5.0.4/utc-token-root-cause-analysis.md` | Demostración formal de causa raíz del bug de 300 minutos en `.NET DateTime.Parse` y resta de ticks entre kinds locales y UTC. |
| **Reporte 2** | `poc/catalyst-3-2/reports/firestore-extraction-3.5.0.4/utc-token-correction.md` | Especificación de la migración a `[DateTimeOffset]` y nuevas compuertas de validación temporal. |
| **Reporte 3** | `poc/catalyst-3-2/reports/firestore-extraction-3.5.0.4/ntfs-cache-root-acl-audit.md` | Diagnóstico de herencia activa en el directorio raíz y diseño del endurecimiento con respaldo doble. |
| **Reporte 4** | `poc/catalyst-3-2/reports/firestore-extraction-3.5.0.4/control-directory-acl-preservation.md` | Garantía de no-regresión y preservación de la ACL de `control\` mediante aplicación strictly no recursiva. |
| **Reporte 5** | `poc/catalyst-3-2/reports/firestore-extraction-3.5.0.4/test-results.md` | Resultados de la suite automatizada (30/30 PASS, 100% éxito). |
| **Reporte 6** | `poc/catalyst-3-2/reports/firestore-extraction-3.5.0.4/windows-verification-procedure.md` | Guía de 3 pasos para la ejecución y validación por parte del operador en Windows PowerShell 5.1. |
| **Reporte 7** | `poc/catalyst-3-2/reports/firestore-extraction-3.5.0.4/readiness-decision.md` | Dictamen final `LOCAL SECURITY RECONCILED — FINAL EXTRACTION REVIEW READY`. |
| **Reporte 8** | `poc/catalyst-3-2/reports/firestore-extraction-3.5.0.4/file-change-manifest.md` | Manifiesto de archivos creados, modificados y preservados. |

---

## 3. AUDITORÍA DE CONTENCIÓN EN PRODUCCIÓN

- `src/`: 0 archivos modificados (100% intacto).
- `functions/`: 0 archivos modificados (100% intacto).
- `firestore.rules`: 0 archivos modificados (100% intacto).
- `package.json`: 0 modificaciones (100% intacto).
- `bun.lock`: 0 modificaciones (100% intacto).
