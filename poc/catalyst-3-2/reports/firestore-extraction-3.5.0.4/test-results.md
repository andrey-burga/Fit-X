# VIGORCORE ETL — INFORME DE RESULTADOS DE PRUEBAS AUTOMATIZADAS
**Fase:** 3.5.0.4  
**Fecha:** 2026-11-11  
**Ejecutor:** TypeScript / tsx Runtime Suite  
**Archivo de Suite:** `poc/catalyst-3-2/scripts/test-phase-3.5-extractor.ts`  
**Resultado Global:** **30 / 30 PASS (100% ÉXITO)**  

---

## 1. TABLA RESUMEN POR SECCIÓN

| Sección | Dominio Evaluado | Pruebas | Resultado |
|---|---|:---:|:---:|
| **Sección 1** | Conciliación Estructural de Inventario (5 usuarios, 68 hijos, 73 total) | 2 | **2 / 2 PASS** |
| **Sección 2** | Seguridad y Detección de Fugas de Tokens ADC | 2 | **2 / 2 PASS** |
| **Sección 3** | REST API v1 Named Database URL y Proyección `__name__` | 2 | **2 / 2 PASS** |
| **Sección 4** | Categorización de Errores HTTP y Precedencia de Cuotas | 2 | **2 / 2 PASS** |
| **Sección 5** | Estructura Inmutable de Sobres Cifrados | 1 | **1 / 1 PASS** |
| **Sección 6** | Atomicidad e Integridad Criptográfica de Lectura Post-Escritura | 1 | **1 / 1 PASS** |
| **Sección 7** | Formato de Checkpoints y Recuperabilidad | 1 | **1 / 1 PASS** |
| **Sección 8** | Compuerta Anti-Sobrescritura de Caché Previo | 1 | **1 / 1 PASS** |
| **Sección 9** | Reubicación de Binario de Preflight y Verificación de Hashing | 2 | **2 / 2 PASS** |
| **Sección 10** | Clasificación Forense de Estados del Directorio Definitivo | 2 | **2 / 2 PASS** |
| **Sección 11** | Escaneo y Detección de Binarios Stray Fuera de `.data/` | 1 | **1 / 1 PASS** |
| **Sección 12** | **Regresión Fase 3.5.0.4: Timestamps UTC y Endurecimiento ACL** | 13 | **13 / 13 PASS** |
| **TOTAL** | **COBERTURA INTEGRAL FASE 3.5.0 A 3.5.0.4** | **30** | **30 / 30 PASS (100%)** |

---

## 2. DETALLE DE PRUEBAS DE LA SECCIÓN 12 (FASE 3.5.0.4)

- **`T-3504-01` [PASS]:** Simulación del bug .NET `DateTime.Parse` (300 min) y su resolución con UTC instant.
- **`T-3504-02` [PASS]:** Aceptación de timestamp ISO 8601 con offset local explícito (`-05:00`).
- **`T-3504-03` [PASS]:** Aceptación de token reciente (5 minutos de antigüedad, cálculo exacto de ~5.0 min).
- **`T-3504-04` [PASS]:** Aceptación en el límite de frescura (59.5 minutos).
- **`T-3504-05` [PASS]:** Rechazo de token vencido a los 61.0 minutos (`PREFLIGHT_TOKEN_EXPIRED`).
- **`T-3504-06` [PASS]:** Rechazo de token de 300.3 minutos (el bug real observado en Windows).
- **`T-3504-07` [PASS]:** Tolerancia de desvío menor hacia el futuro (1 minuto de reloj adelantado aceptado).
- **`T-3504-08` [PASS]:** Rechazo de fecha futura anómala > 2 minutos (`PREFLIGHT_TOKEN_FUTURE`).
- **`T-3504-09` [PASS]:** Rechazo de formato de timestamp corrupto o inválido (`PREFLIGHT_TOKEN_INVALID_TIMESTAMP`).
- **`T-3504-10` [PASS]:** Detección y rechazo de discrepancia entre JSON y BIN (`PREFLIGHT_TIMESTAMP_MISMATCH`).
- **`T-3504-11` [PASS]:** Auditoría ACL: Rechazo de directorio con herencia activa o `BUILTIN\Users`.
- **`T-3504-12` [PASS]:** Auditoría ACL: Aprobación de directorio endurecido con acceso exclusivo.
- **`T-3504-13` [PASS]:** Preservación de ACL de `control/`: Aislamiento no recursivo mantiene SDDL intacto.
