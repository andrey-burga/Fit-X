# VIGORCORE — MATRIZ DE RIESGOS TÉCNICOS Y PLAN DE CONTINGENCIA (FASE 3.4)
## Registro de Riesgos, Evaluación de Impacto, Mitigaciones y Procedimientos de Rollback

**Fecha de emisión:** 9 de noviembre de 2026  
**Auditor:** Oficial de Gestión de Riesgos de TI & Arquitecto de Infraestructura  
**Alcance:** Pipeline de migración histórica de 73 documentos desde Cloud Firestore hacia Zoho Catalyst NoSQL.

---

## 1. MATRIZ DE EVALUACIÓN DE RIESGOS

| ID | Categoría | Descripción del Riesgo | Causa Raíz Potencial | Probabilidad | Impacto | Nivel Severidad | Mitigación Implementada | Riesgo Residual |
| :-: | :--- | :--- | :--- | :---: | :---: | :---: | :--- | :---: |
| **RSK-01** | Integridad de Datos | Pérdida de documentos de subcolecciones en usuarios activos (USER_002 y USER_005). | Deduplicación errónea por rutas genéricas en lugar de recursos concretos. | Baja | Crítico | **ALTO** | Corregido en Fase 3.3.6: uso exclusivo de rutas concretas ($uDoc.Name + '/' + $subId) y validación de 73 documentos exactos. | **BAJO** |
| **RSK-02** | Privacidad | Fuga de datos biométricos, peso o correos electrónicos en commits o consola. | Logs no sanitizados o ausencia de reglas en `.gitignore`. | Media | Crítico | **CRÍTICO** | Regla Zero Data: `.gitignore` estricto en `.data/` y `reports/`, uso de alias deterministas `USER_001..USER_005` y cero `stdout` de payloads. | **MUY BAJO** |
| **RSK-03** | Autenticación | Desconexión de atletas históricos por falta de correspondencia con Catalyst Auth. | Reemplazar el Firebase UID original por el ID numérico de Catalyst. | Media | Alto | **ALTO** | Tabla de Correspondencia e Identidad Híbrida: el Firebase UID se conserva en `sourceUid` y `pk = USER#<uid>`, enlazando Catalyst JIT en el login. | **BAJO** |
| **RSK-04** | Red / Cuota | Error HTTP 429 (`RESOURCE_EXHAUSTED`) durante la extracción o carga masiva. | Peticiones simultáneas o ráfagas sin control de tasa. | Media | Medio | **MEDIO** | Throttling forzado de 100 ms entre peticiones y reintentos con retroceso exponencial (Exponential Backoff con Jitter). | **BAJO** |
| **RSK-05** | Formato de Datos | Redondeo involuntario de decimales en calorías, peso o tonelaje de entrenamiento. | Conversión incorrecta de tipos en desempaquetado de Firestore REST. | Media | Alto | **MEDIO** | Normalizador de tipos TypeScript que preserva flotantes IEEE 754 y valida con `Zod` antes de persistir. | **BAJO** |
| **RSK-06** | Concurrencia | Escritura duplicada o registros huérfanos por interrupción a mitad de la carga. | Fallo eléctrico, desconexión de red o crash del proceso. | Media | Alto | **MEDIO** | Motor de Checkpoint Atómico (`checkpoint-load.json`) y condiciones de inserción idempotentes (`_payloadHash`). | **BAJO** |
| **RSK-07** | SDK NoSQL | Incompatibilidad de batch writes en Catalyst NoSQL remoto. | Operaciones en bloque exceden el límite de 25 ítems de la API REST. | Alta | Alto | **ALTO** | Chunking obligatorio en lotes de máximo 25 ítems por llamada `insertItems`. | **BAJO** |
| **RSK-08** | Inconsistencia | Modificación de datos en Firestore mientras se ejecuta la migración (Dirty Read). | Usuarios interactuando con la aplicación durante el ETL. | Baja | Alto | **MEDIO** | Ventana de Mantenimiento / Migración en frío: 5 minutos de pausa de escrituras en frontend o modo solo lectura. | **MUY BAJO** |

---

## 2. PLAN DE CONTINGENCIA Y ESTRATEGIA DE ROLLBACK

A diferencia de sistemas relacionales con transacciones globales, una operación en NoSQL no se revierte automáticamente con un simple `ROLLBACK`. Se debe diseñar una estrategia de compensación explícita:

### Principios de Reversibilidad [VERIFIED]:
1. **Firestore es de Solo Lectura (Zero Mutación en Origen):**  
   Durante todo el pipeline ETL, Cloud Firestore jamás recibe peticiones `POST`, `PATCH` ni `DELETE`. Esto garantiza que los 73 documentos originales permanecen intactos al 100% como respaldo dorado (Golden Backup).
2. **Rollback en Destino (Catalyst NoSQL):**  
   Si la carga en Catalyst falla en un estado no recuperable o la reconciliación matemática detecta inconsistencias irreparables:
   - Se ejecuta el procedimiento de compensación `rollback-catalyst-migration.ts`.
   - El script consulta todos los registros que posean el metadato `_migrationBatchId == 'MIG-20261109-01'`.
   - Se eliminan atómicamente por lotes (`deleteItems`) exclusivamente los ítems creados por el lote fallido, preservando cualquier registro preexistente de pruebas.
3. **Restauración del Frontend:**  
   En caso de abortar la migración, el frontend de React 19 permanece configurado con el proveedor original de Firebase sin requerir cambios de versión ni redespliegues complejos.
