# VIGORCORE ETL — RESULTADOS DE PRUEBAS AUTOMATIZADAS
**Fase:** 3.5.0.6  
**Fecha:** 2026-11-11  
**Ejecutor:** TypeScript / tsx Runtime Suite  
**Archivo de Suite:** `poc/catalyst-3-2/scripts/test-phase-3.5-extractor.ts`  
**Resultado Global:** **45 / 45 PASS (100% ÉXITO)**  

---

## 1. RESUMEN EJECUTIVO POR SECCIÓN

| Sección | Dominio Evaluado | Pruebas | Resultado |
|---|---|:---:|:---:|
| **Sección 1** | Conciliación Estructural de Inventario (5 usuarios, 68 hijos, 73 total) | 2 | **2 / 2 PASS** |
| **Sección 2** | Detección y Sanitización de Tokens ADC (`ya29.*`) | 2 | **2 / 2 PASS** |
| **Sección 3** | REST API v1 Named Database URL y Proyección `__name__` | 2 | **2 / 2 PASS** |
| **Sección 4** | Categorización de Errores HTTP y Precedencia de Cuotas | 2 | **2 / 2 PASS** |
| **Sección 5** | Estructura Inmutable de Sobres Cifrados | 1 | **1 / 1 PASS** |
| **Sección 6** | Atomicidad e Integridad Criptográfica de Lectura Post-Escritura | 1 | **1 / 1 PASS** |
| **Sección 7** | Formato de Checkpoints y Recuperabilidad | 1 | **1 / 1 PASS** |
| **Sección 8** | Compuerta Anti-Sobrescritura de Caché Previo | 1 | **1 / 1 PASS** |
| **Sección 9** | Reubicación de Binario de Preflight y Verificación de Hashing | 2 | **2 / 2 PASS** |
| **Sección 10** | Clasificación Forense de Estados del Directorio Definitivo | 2 | **2 / 2 PASS** |
| **Sección 11** | Escaneo y Detección de Binarios Stray Fuera de `.data/` | 1 | **1 / 1 PASS** |
| **Sección 12** | Timestamps UTC y Corrección `DateTimeOffset` (Fase 3.5.0.4) | 13 | **13 / 13 PASS** |
| **Sección 13** | **Endurecimiento en Dos Etapas y Rollback SDDL (Fase 3.5.0.6)** | 15 | **15 / 15 PASS** |
| **TOTAL** | **COBERTURA INTEGRAL FASE 3.5.0 A 3.5.0.6** | **45** | **45 / 45 PASS (100%)** |

---

## 2. DETALLE DE PRUEBAS DE LA SECCIÓN 13 (FASE 3.5.0.6)

| ID | Escenario Evaluado | Clasificación | Resultado | Evidencia |
|:---:|---|:---:|:---:|---|
| `T-3506-01` | Etapa 1: `control/` adquiere `AreAccessRulesProtected = true` copiando reglas como explícitas | PASS-STATIC | **PASS** | `test-phase-3.5-extractor.ts` (L431-444) |
| `T-3506-02` | Etapa 1: Detección y rechazo de ACE con identidad inesperada no autorizada | PASS-STATIC | **PASS** | `test-phase-3.5-extractor.ts` (L446-455) |
| `T-3506-03` | Etapa 1: Detección de ACE DENY mal ordenada (violación de orden canónico) | PASS-STATIC | **PASS** | `test-phase-3.5-extractor.ts` (L457-465) |
| `T-3506-04` | Protección efectiva de `control/`: Herencia deshabilitada sin pérdida de acceso para el operador | PASS-STATIC | **PASS** | `test-phase-3.5-extractor.ts` (L467-480) |
| `T-3506-05` | Verificación de no-mutación: La raíz del caché NO cambia durante la Etapa 1 | PASS-STATIC | **PASS** | `test-phase-3.5-extractor.ts` (L482-488) |
| `T-3506-06` | Etapa 2 rechazada si la Etapa 1 no se completó (`control/` desprotegido) | PASS-STATIC | **PASS** | `test-phase-3.5-extractor.ts` (L490-505) |
| `T-3506-07` | Etapa 2 exitosa: Raíz endurecida con herencia deshabilitada y cero ACEs para `BUILTIN\Users` | PASS-STATIC | **PASS** | `test-phase-3.5-extractor.ts` (L507-518) |
| `T-3506-08` | SDDL de `control/` idéntico antes y después de Etapa 2 (bloqueo H-ACL-02 resuelto) | PASS-STATIC | **PASS** | `test-phase-3.5-extractor.ts` (L520-527) |
| `T-3506-09` | Integridad SHA-256 de los respaldos SDDL antes de modificar permisos | PASS-UNIT | **PASS** | `test-phase-3.5-extractor.ts` (L529-536) |
| `T-3506-10` | Rechazo de respaldo SDDL corrupto o manipulado (hash no coincide) | PASS-UNIT | **PASS** | `test-phase-3.5-extractor.ts` (L538-547) |
| `T-3506-11` | Rollback independiente de Etapa 1: Restaura SDDL original de `control/` | PASS-STATIC | **PASS** | `test-phase-3.5-extractor.ts` (L549-556) |
| `T-3506-12` | Rollback completo de ambas etapas: Restaura raíz y control a sus estados originales | PASS-STATIC | **PASS** | `test-phase-3.5-extractor.ts` (L558-568) |
| `T-3506-13` | Orden correcto de restauración: Raíz primero, luego `control/` | PASS-STATIC | **PASS** | `test-phase-3.5-extractor.ts` (L570-581) |
| `T-3506-14` | Rechazo preventivo ante rutas o archivos inesperados en la raíz del caché | PASS-STATIC | **PASS** | `test-phase-3.5-extractor.ts` (L583-588) |
| `T-3506-15` | Detección y rechazo de enlaces simbólicos o reparse points (*anti-symlink hijack*) | PASS-UNIT | **PASS** | `test-phase-3.5-extractor.ts` (L590-600) |

*Nota Metodológica:* Las pruebas anteriores verifican la lógica estática, de serialización y manejo de estados. Las llamadas reales al subsistema NTFS Win32 (`SetAccessRuleProtection`, `Set-Acl`, `SetSecurityDescriptorSddlForm`) están catalogadas como **PASS-WINDOWS (Pendientes de ejecución física en la estación Windows)**.
