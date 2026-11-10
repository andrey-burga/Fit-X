# VIGORCORE — FASE 3.5.0.1: REPORTE DE RESULTADOS DE PRUEBAS

## 1. RESUMEN GLOBAL DE EJECUCIÓN

- **Suite Automatizada:** `poc/catalyst-3-2/scripts/test-phase-3.5-extractor.ts`
- **Total de Pruebas Ejecutadas:** 40 casos
- **Aprobadas:** 40 (100%)
- **Fallidas:** 0 (0%)
- **Distribución por Nivel:**
  - `PASS-UNIT`: 11 pruebas (Criptografía, cálculo de SHA-256, sobres seguros, sanitización de credenciales, paginación REST).
  - `PASS-MOCK`: 26 pruebas (Simulaciones de preflight, 73 documentos, mutaciones en vuelo, verificación forense, compuertas de seguridad 1 a 10).
  - `PASS-STATIC`: 3 pruebas (Constantes de subcolecciones, administrativas e invariante baseline).
  - `PASS-LOCAL-WINDOWS`: Protocolo de 11 pasos preparado y documentado para ejecución en la estación Windows del operador.
  - `PASS-INTEGRATION`: **0 pruebas** (Declaración formal de rigor: no se conectó a Firestore ni se descargaron documentos reales).

---

## 2. MATRIZ DETALLADA DE LAS PRUEBAS FASE 3.5.0.1 (SECCIÓN 9)

| ID | Nivel | Componente Evaluado | Escenario Específico y Aserción | Resultado |
| :--- | :--- | :--- | :--- | :---: |
| **9.1** | `PASS-UNIT` | DPAPI Protocol | `executeCryptoSelfTest` ejecuta con éxito los 11 pasos del protocolo DPAPI | **APROBADO** |
| **9.2** | `PASS-UNIT` | DPAPI Anti-Tamper | Rechazo estricto de ciphertext con bits alterados (`DPAPI_ERROR`) | **APROBADO** |
| **9.3** | `PASS-MOCK` | Preflight Auth | Token de preflight autenticado con sobre binario DPAPI supera validación | **APROBADO** |
| **9.4** | `PASS-MOCK` | Preflight Integrity | Token manipulado en JSON sin actualizar firma es rechazado con `TOKEN_TAMPERED` | **APROBADO** |
| **9.5** | `PASS-MOCK` | Preflight Expiry | Token con antigüedad > 60 minutos es rechazado con `TOKEN_EXPIRED` | **APROBADO** |
| **9.6** | `PASS-MOCK` | Preflight Project | Token emitido para otro proyecto GCP es rechazado con `PROJECT_MISMATCH` | **APROBADO** |
| **9.7** | `PASS-MOCK` | Preflight DB | Token emitido para otra base de datos Firestore es rechazado con `DATABASE_MISMATCH` | **APROBADO** |
| **9.8** | `PASS-MOCK` | Gate ADC | `auditExtractGates` bloquea extracción si credencial ADC es inválida (`GATE_ADC_INVALID`) | **APROBADO** |
| **9.9** | `PASS-MOCK` | Gate Operador | `auditExtractGates` bloquea extracción si falta confirmación del operador (`GATE_OPERATOR_NOT_CONFIRMED`) | **APROBADO** |
| **9.10** | `PASS-MOCK` | Gate Mantenimiento | `auditExtractGates` bloquea extracción si no se confirma ventana de mantenimiento (`GATE_MAINTENANCE_NOT_CONFIRMED`) | **APROBADO** |
| **9.11** | `PASS-MOCK` | Gate Git | `auditExtractGates` bloquea extracción si `.data/` no está en `.gitignore` (`GATE_GIT_NOT_PROTECTED`) | **APROBADO** |
| **9.12** | `PASS-MOCK` | Gate Checkpoint | `auditExtractGates` bloquea extracción si el checkpoint previo es inconsistente (`GATE_CHECKPOINT_INCONSISTENT`) | **APROBADO** |
| **9.13** | `PASS-MOCK` | Gate Drift | `auditExtractGates` bloquea extracción si hay drift sin confirmación (`GATE_DRIFT_NOT_ACKNOWLEDGED`) | **APROBADO** |
| **9.14** | `PASS-MOCK` | Gates Exitoso | `auditExtractGates` autoriza la extracción cuando las 10 compuertas están satisfechas | **APROBADO** |

---

## 3. RESUMEN ACUMULATIVO DEL PROYECTO

- **Fase 3.3.1 (REST & Invariantes):** 21/21 PASS-UNIT (100%).
- **Fase 3.4.2 (Cierre de 4 Bloqueos Críticos):** 34/34 PASS-UNIT (100%).
- **Fase 3.5.0 & 3.5.0.1 (Extractor Forense & Seguridad):** 40/40 PASS (100%).
- **Total Acumulado de Pruebas de la POC:** **95 pruebas aprobadas (100% de éxito).**
