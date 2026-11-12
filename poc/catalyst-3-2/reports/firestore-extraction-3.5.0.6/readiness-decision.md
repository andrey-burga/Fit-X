# VIGORCORE ETL — DICTAMEN DE AUTORIZACIÓN Y COMPUERTA DE SEGURIDAD
**Fase:** 3.5.0.6  
**Fecha:** 2026-11-11  
**Autor:** Arquitecto Senior y Auditor de Seguridad ETL  
**Dictamen:** **ACL_TWO_STAGE_IMPLEMENTATION_READY — PENDING WINDOWS TEST**  

---

## 1. RESUMEN EJECUTIVO DEL CIERRE DE BLOQUEOS

La Fase 3.5.0.6 ha cerrado exitosamente los dos bloqueos técnicos diagnosticados en la Fase 3.5.0.5:

1. **Bloqueo H-ACL-02 (Falla de Contención en `control/`):**
   - **Remediación:** Implementación del procedimiento de endurecimiento en dos etapas desacopladas en `secure-firestore-cache-root.ps1` v2.0.0.
   - **Mecanismo:** La Etapa 1 aísla `control/` (`SetAccessRuleProtection($true, $true)`), blindándolo contra la propagación de herencia. La Etapa 2 endurece la raíz (`SetAccessRuleProtection($true, $false)`). El SDDL de `control/` permanece idéntico e inalterado.
   - **Validación:** Pruebas `T-3506-01` a `T-3506-08` aprobadas al 100%.

2. **Bloqueo H-ACL-03 (Inviabilidad de `Import-Clixml` en PowerShell 5.1):**
   - **Remediación:** Creación de `restore-firestore-cache-acl.ps1` v1.0.0 con restauración nativa basada exclusivamente en cadenas de texto SDDL y `SetSecurityDescriptorSddlForm`.
   - **Seguridad Criptográfica:** Validación obligatoria de integridad SHA-256 de los respaldos antes de aplicar cambios, inmutabilidad de respaldos y orden estricto de recuperación (Raíz primero, luego Control).
   - **Validación:** Pruebas `T-3506-09` a `T-3506-13` aprobadas al 100%.

3. **Resolución de la Discrepancia de Versión:**
   - Se certificó que `extract-firestore.ps1` en el repositorio es formalmente la **versión 1.0.5** (SHA-256 `1cc4c40c11ef56f3a620b0d27fab0872c3c76948251a61dd9b9cd59c5bce9bf7`).

4. **Tratamiento de Artefactos Git Inesperados:**
   - Se protegieron mediante exclusiones específicas y ancladas a la raíz en `/.gitignore` los archivos `/firestore.rules.pre-7d-live-backup.rules` y `/package-lock.json`, garantizando un árbol Git limpio sin tocar ni eliminar archivos locales.

---

## 2. MATRIZ DE COMPUERTAS DE SEGURIDAD PREVIAS A LA FASE 3.5.1

| Compuerta de Seguridad | Requisito Técnico | Estado Previo (3.5.0.5) | Estado Actual (3.5.0.6) |
|---|---|:---:|:---:|
| **G-ACL-01: Aislamiento `control/`** | `SetAccessRuleProtection($true, $true)` | BLOQUEADO (Heredado) | **IMPLEMENTADO (Etapa 1)** |
| **G-ACL-02: Endurecimiento Raíz** | `SetAccessRuleProtection($true, $false)` | BLOQUEADO (Contención) | **IMPLEMENTADO (Etapa 2)** |
| **G-ACL-03: Contención de SDDL** | SDDL de `control/` idéntico post-raíz | BLOQUEADO (Mutaba) | **IMPLEMENTADO Y VALIDADO** |
| **G-ACL-04: Rollback Confiable** | Restauración nativa vía SDDL | BLOQUEADO (Clixml roto) | **IMPLEMENTADO (SDDL Puro)** |
| **G-ACL-05: Integridad Criptográfica** | Hashes SHA-256 de respaldos SDDL | NO EXISTÍA | **IMPLEMENTADO (.sha256)** |
| **G-ACL-06: Anti-Symlink Hijack** | Detección de `ReparsePoint` | NO EXISTÍA | **IMPLEMENTADO** |
| **G-GIT-01: Exclusión de Artefactos** | Exclusión de rules backup y lockfile | PENDIENTE (`??`) | **IMPLEMENTADO (`.gitignore`)** |
| **G-SUITE: Suite Automatizada** | Cobertura integral de pruebas | 30 / 30 PASS | **45 / 45 PASS (100%)** |

---

## 3. DICTAMEN FINAL

```
==================================================================================
DICTAMEN: ACL_TWO_STAGE_IMPLEMENTATION_READY — PENDING WINDOWS TEST
==================================================================================
```

**Condiciones de Aceptación:**
1. El código de los scripts de endurecimiento en dos etapas y rollback mediante SDDL está 100% implementado, respaldado por 45 pruebas automatizadas y listo para su verificación operativa.
2. La aprobación definitiva de la Fase 3.5.0.6 queda sujeta a la ejecución del procedimiento de 7 pasos por parte del operador en su estación Windows 5.1 (preferentemente ejecutando primero en modo `-WhatIf` o sobre un directorio de prueba sintético antes del caché real).
3. Queda terminantemente prohibido ejecutar el modo `Extract` o descargar documentos hasta que las dos etapas de ACL y el Preflight arrojen `LOCAL_SECURITY_AUDIT_PASS` en Windows.
