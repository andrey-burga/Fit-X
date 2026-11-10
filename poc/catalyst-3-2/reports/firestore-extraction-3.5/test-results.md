# VIGORCORE — FASE 3.5.0: REPORTE DE RESULTADOS DE PRUEBAS LOCALES

## 1. RESUMEN DE EJECUCIÓN DE PRUEBAS

- **Suite Automatizada:** `poc/catalyst-3-2/scripts/test-phase-3.5-extractor.ts`
- **Motor de Ejecución:** `npx tsx` (TypeScript ESNext / Node.js 22 LTS)
- **Total de Casos Evaluados:** 26 pruebas
- **Aprobadas:** 26 (100%)
- **Fallidas:** 0 (0%)
- **Clasificación Estricta:**
  - `PASS-UNIT`: 9 pruebas (Criptografía, sobres, hashing, sanitización, cursores REST).
  - `PASS-MOCK`: 14 pruebas (Simulaciones de 5 usuarios, 73 documentos, mutaciones en vuelo, fallas DPAPI, checkpoints, límites).
  - `PASS-STATIC`: 3 pruebas (Constantes de subcolecciones, administrativas e invariante baseline).
  - `PASS-INTEGRATION`: **0 pruebas** (Declaración formal: ninguna prueba realizó conexiones remotas a Firestore ni descargó datos reales).

---

## 2. MATRIZ DETALLADA DE PRUEBAS Y RESULTADOS

| ID | Nivel | Categoría | Descripción del Escenario Evaluado | Resultado |
| :--- | :--- | :--- | :--- | :--- |
| **1.1** | `PASS-STATIC` | Modelo | Verificación de las 11 subcolecciones candidatas oficiales de VigorCore | APROBADO |
| **1.2** | `PASS-STATIC` | Modelo | Verificación de las 6 colecciones administrativas examinadas | APROBADO |
| **1.3** | `PASS-STATIC` | Baseline | Invariante del conteo histórico (73 documentos y 5 usuarios) | APROBADO |
| **2.1** | `PASS-UNIT` | Criptografía | MockDpapiProvider roundtrip exitoso con payload arbitrario en memoria | APROBADO |
| **2.2** | `PASS-UNIT` | Criptografía | Rechazo estricto de descifrado ante clave incorrecta o texto cifrado alterado | APROBADO |
| **2.3** | `PASS-UNIT` | Sobre | `buildDocumentEnvelope` genera opaqueId secuencial y calcula SHA-256 canónico | APROBADO |
| **2.4** | `PASS-UNIT` | Identidad | Mismo documentId en padres distintos genera rutas concretas diferenciadas | APROBADO |
| **3.1** | `PASS-UNIT` | Privacidad | `sanitizeErrorMessage` redacta tokens de acceso ADC (`ya29...`) en memoria | APROBADO |
| **3.2** | `PASS-UNIT` | Privacidad | `sanitizeErrorMessage` redacta correos electrónicos de error (`@`) | APROBADO |
| **3.3** | `PASS-UNIT` | Privacidad | `sanitizeErrorMessage` enmascara UIDs reales en rutas Firestore | APROBADO |
| **3.4** | `PASS-UNIT` | Privacidad | `sanitizeErrorMessage` categoriza códigos estándar (`BILLING_DISABLED`, etc.) | APROBADO |
| **4.1** | `PASS-MOCK` | Preflight | `evaluatePreflight` aprueba baseline exacto de 73 documentos y 5 usuarios | APROBADO |
| **4.2** | `PASS-MOCK` | Preflight | `evaluatePreflight` detecta `BASELINE_DRIFT` si el total difiere de 73 | APROBADO |
| **4.3** | `PASS-MOCK` | Preflight | `evaluatePreflight` declara `PREFLIGHT_FAILED` si existen errores de consulta | APROBADO |
| **5.1** | `PASS-MOCK` | Consistencia | `evaluateObservedConsistency` aprueba ventana estricta sin mutaciones | APROBADO |
| **5.2** | `PASS-MOCK` | Consistencia | Detección de documento modificado durante extracción (`updateTime` cambió) | APROBADO |
| **5.3** | `PASS-MOCK` | Consistencia | Detección de documento nuevo agregado en origen (`DOCUMENT_ADDED`) | APROBADO |
| **5.4** | `PASS-MOCK` | Consistencia | Detección de documento eliminado en origen (`DOCUMENT_DELETED`) | APROBADO |
| **6.1** | `PASS-MOCK` | Verify | `verifyEncryptedCache` aprueba caché íntegro y consistente con manifiesto | APROBADO |
| **6.2** | `PASS-MOCK` | Verify | `verifyEncryptedCache` detecta archivo binario corrupto o hash alterado | APROBADO |
| **6.3** | `PASS-MOCK` | Verify | `verifyEncryptedCache` detecta archivo faltante en base a checkpoint | APROBADO |
| **6.4** | `PASS-MOCK` | Verify | `verifyEncryptedCache` detecta archivos no registrados en el directorio | APROBADO |
| **7.1** | `PASS-MOCK` | Recuperación | Checkpoint cifrado permite reanudar desde el índice exacto sin duplicar | APROBADO |
| **8.1** | `PASS-UNIT` | REST | Paginación con StructuredQuery, orden `__name__` y cursor `startAt` sin offset | APROBADO |
| **8.2** | `PASS-MOCK` | Límites | Control de límites `MaxRequests` (500) se detiene fail-closed antes de exceder | APROBADO |
| **8.3** | `PASS-MOCK` | Persistencia | Escritura atómica mediante `.tmp` y reemplazo atómico previene archivos parciales | APROBADO |

---

## 3. CONCLUSIÓN TÉCNICA

Todas las aserciones lógicas, criptográficas, estructurales y de privacidad han sido verificadas localmente con éxito rotundo. El diseño de los componentes está validado para la ejecución en Windows PowerShell.
