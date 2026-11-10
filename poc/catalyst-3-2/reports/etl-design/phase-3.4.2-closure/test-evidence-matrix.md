# VIGORCORE — MATRIZ DE EVIDENCIA DE PRUEBAS DE SEGURIDAD (FASE 3.4.2)
## Catálogo Detallado de las 34 Pruebas Unitarias de Cierre, Niveles de Verificación y Limitaciones

**Fecha de emisión:** 10 de noviembre de 2026  
**Auditor:** Ingeniero de Automatización de Pruebas & Auditor de Seguridad  
**Archivo Ejecutor Principal:** `poc/catalyst-3-2/scripts/test-phase-3.4.2-closure.ts`  
**Resultado Global:** **34/34 APROBADAS (100% PASS-UNIT)**

---

## 1. NIVELES DE VERIFICACIÓN EMPLEADOS

Para garantizar la honestidad técnica y evitar atribuir a una prueba unitaria alcances de integración remota:

- **`PASS-STATIC`:** Análisis de tipos TypeScript (`tsc --noEmit`), firmas de interfaces y contratos sintácticos.
- **`PASS-UNIT`:** Pruebas unitarias ejecutadas en Node.js que validan algoritmos, validadores, parsing y límites en memoria.
- **`PASS-MOCK`:** Pruebas que simulan componentes externos (tokens JWT de Firebase, adaptadores de almacenamiento NoSQL).
- **`PASS-INTEGRATION`:** Pruebas reales contra servicios en la nube de Google Cloud o Zoho Catalyst.
- **`NOT VERIFIED`:** Capacidad o característica no demostrada mediante ejecución en este entorno.

---

## 2. MATRIZ EXHAUSTIVA DE LAS 34 PRUEBAS UNITARIAS DE CIERRE

| ID Prueba | Hallazgo | Escenario Evaluado | Nivel de Prueba | Resultado | Evidencia / Aserción Técnica | Limitación Declarada |
| :--- | :---: | :--- | :---: | :---: | :--- | :--- |
| **F-ID-01.1** | F-ID-01 | Vinculación exitosa con token Firebase y Catalyst confirmado | `PASS-UNIT` | **PASS** | `res.status === 'LINKED'`, mapping en store | Simulación con `MockTokenValidator` en memoria |
| **F-ID-01.2** | F-ID-01 | Token Firebase con firma criptográfica inválida | `PASS-UNIT` | **PASS** | `res.status === 'REJECTED_INVALID_PROOF'` | Verificación local de clave; no llama a Google endpoint |
| **F-ID-01.3** | F-ID-01 | Token Firebase con timestamp de expiración rebasado | `PASS-UNIT` | **PASS** | `claims.exp <= nowSec -> REJECTED_INVALID_PROOF` | Reloj simulado en época Unix |
| **F-ID-01.4** | F-ID-01 | Token Firebase emitido para un proyecto GCP ajeno | `PASS-UNIT` | **PASS** | `claims.aud !== GCP_PROJECT -> REJECTED_TAMPERED` | Validación estricta de audiencia |
| **F-ID-01.5** | F-ID-01 | Cuenta Catalyst con `isConfirmed: false` (Prevención Takeover) | `PASS-UNIT` | **PASS** | `res.status === 'REJECTED_UNCONFIRMED'` | Depende de que Catalyst Auth reporte `is_confirmed` |
| **F-ID-01.6** | F-ID-01 | Coincidencia de email sin token de prueba de posesión | `PASS-UNIT` | **PASS** | `token == '' -> REJECTED_INVALID_PROOF` | Impide enlace ciego por solo correo |
| **F-ID-01.7** | F-ID-01 | Intento de reclamar un Firebase UID ya vinculado a otro usuario | `PASS-UNIT` | **PASS** | `res.status === 'REJECTED_COLLISION'` | Control de unicidad 1:1 en store |
| **F-ID-01.8** | F-ID-01 | Intento de una cuenta Catalyst de vincular un segundo Firebase UID| `PASS-UNIT` | **PASS** | `res.status === 'REJECTED_COLLISION'` | Control de no duplicidad de tenant |
| **F-ID-01.9** | F-ID-01 | Reintento idéntico de una vinculación ya existente | `PASS-UNIT` | **PASS** | `res.status === 'ALREADY_LINKED'`, cero mutación | Idempotencia matemática demostrada |
| **F-ID-01.10**| F-ID-01 | Cuenta Catalyst con estado suspendido o deshabilitado | `PASS-UNIT` | **PASS** | `status === 'SUSPENDED' -> REJECTED_SUSPENDED` | Integración con modelo de acceso |
| **F-ID-02.1** | F-ID-02 | Usuario solicita datos propios legítimamente sin inyectar IDs | `PASS-UNIT` | **PASS** | `context.partitionKey === 'USER#usr_athlete_01'` | Backend deriva clave de partición en memoria |
| **F-ID-02.2** | F-ID-02 | Intento de suplantación mediante cabecera `x-user-id` | `PASS-UNIT` | **PASS** | `result.errorCode === 'SPOOFING_ATTEMPT_DETECTED'` | Inspección estricta de cabeceras prohibidas |
| **F-ID-02.3** | F-ID-02 | Intento de inyectar `{ sourceUid: 'usr_victima' }` en body | `PASS-UNIT` | **PASS** | `result.errorCode === 'SPOOFING_ATTEMPT_DETECTED'` | Bloqueo anti-IDOR en payload JSON |
| **F-ID-02.4** | F-ID-02 | Intento de inyectar `?pk=USER#usr_victima` en query string | `PASS-UNIT` | **PASS** | `result.errorCode === 'SPOOFING_ATTEMPT_DETECTED'` | Bloqueo anti-IDOR en query string |
| **F-ID-02.5** | F-ID-02 | Solicitud de usuario Catalyst sin mapeo previo en base de datos | `PASS-UNIT` | **PASS** | `result.errorCode === 'IDENTITY_MAPPING_NOT_FOUND'` | Fail-closed ante usuarios no pre-migrados |
| **F-ID-02.6** | F-ID-02 | Solicitud de usuario con mapeo en estado `DISPUTED_LOCKED` | `PASS-UNIT` | **PASS** | `result.errorCode === 'IDENTITY_MAPPING_DISABLED'` | Control de disputas de cuenta |
| **F-ID-02.7** | F-ID-02 | Atleta intentando ejecutar operación con `requiredRole = admin` | `PASS-UNIT` | **PASS** | `result.errorCode === 'INSUFFICIENT_ADMIN_PERMISSIONS'` | Control RBAC en servidor |
| **F-SER-01.1**| F-SER-01| Deserialización exacta del límite superior `INT64_MAX` | `PASS-UNIT` | **PASS** | `big === 9223372036854775807n` | Preservación de 64 bits con signo |
| **F-SER-01.2**| F-SER-01| Deserialización exacta del límite inferior `INT64_MIN` | `PASS-UNIT` | **PASS** | `big === -9223372036854775808n` | Preservación de 64 bits con signo |
| **F-SER-01.3**| F-SER-01| Prueba comparativa: BigInt conserva precisión donde `Number` falla| `PASS-UNIT` | **PASS** | `Number("9007199254740993")` muta a `...992`; BigInt OK | Demuestra la necesidad crítica de BigInt |
| **F-SER-01.4**| F-SER-01| Rechazo fail-closed de entero que excede rango de 64 bits | `PASS-UNIT` | **PASS** | Lanza `INTEGER_OUT_OF_BOUNDS` | Protección ante desbordamiento de memoria |
| **F-SER-01.5**| F-SER-01| Rechazo fail-closed de formato decimal inválido (flotante, hex) | `PASS-UNIT` | **PASS** | Lanza `MALFORMED_INTEGER` ante `'123.45'`, `'0x12'` | Parsing estrictamente decimal |
| **F-SER-01.6**| F-SER-01| Deserialización de timestamp con 9 dígitos de nanosegundos | `PASS-UNIT` | **PASS** | `ts.nanoseconds === 123456789`, RFC 3339 intacto | Evita truncamiento de nanosegundos |
| **F-SER-01.7**| F-SER-01| Normalización de offset de zona horaria (`+05:00`) a UTC (`Z`) | `PASS-UNIT` | **PASS** | `ts.rfc3339 === '2026-11-10T12:30:00Z'` | Normalización temporal homogénea |
| **F-SER-01.8**| F-SER-01| Deserialización integral de los 11 tipos oficiales Firestore REST | `PASS-UNIT` | **PASS** | 11/11 tipos convertidos a sus estructuras canónicas | Cobertura total de la gramática Firestore |
| **F-SER-01.9**| F-SER-01| Canonicalización determinista: orden alfabético y arrays | `PASS-UNIT` | **PASS** | Objetos permutados producen `JSON` idéntico | Arrays preservan orden posicional |
| **F-SER-01.10**| F-SER-01| Normalización Unicode NFC en strings canónicas | `PASS-UNIT` | **PASS** | Carácter precompuesto coincide con forma combinatoria | Elimina falsos negativos en hashes UTF-8 |
| **F-SER-01.11**| F-SER-01| Verificación de correspondencia de Tres Hashes Independientes | `PASS-UNIT` | **PASS** | `transformedHash === destinationHash` probado | Base matemática de la reconciliación |
| **F-ROL-01.1**| F-ROL-01| Rollback antes de habilitar escrituras sobre documento idéntico | `PASS-UNIT` | **PASS** | `status === 'COMPLETED_CLEAN'`, `deletedCount === 1` | Eliminación limpia pre-cutover |
| **F-ROL-01.2**| F-ROL-01| Intento de rollback con escrituras de usuarios activas | `PASS-UNIT` | **PASS** | Aborto fail-safe `ABORTED_USER_WRITES_ACTIVE` | Failsafe absoluto post-cutover |
| **F-ROL-01.3**| F-ROL-01| Documento modificado con `updatedAt > migratedAt` | `PASS-UNIT` | **PASS** | Documento NO se borra, catalogado `TIMESTAMP_DIVERGENCE`| Preserva mutación posterior del atleta |
| **F-ROL-01.4**| F-ROL-01| CASO CRÍTICO: `updatedAt == migratedAt` pero contenido mutado | `PASS-UNIT` | **PASS** | Hash canónico detecta cambio; NO se borra (`CONTENT_HASH_MISMATCH`)| Protección ante fallos de timestamp |
| **F-ROL-01.5**| F-ROL-01| Documento con flag `_userMutatedAfterMigration: true` | `PASS-UNIT` | **PASS** | Documento NO se borra, catalogado en cuarentena | Respeto a marcas de modificación de usuario |
| **F-ROL-01.6**| F-ROL-01| Documento perteneciente a otro lote de migración | `PASS-UNIT` | **PASS** | Documento NO se borra, `preservedUserCount === 1` | Aislamiento entre lotes |

---

## 3. RESUMEN DE PRUEBAS DE REGRESIÓN DE INVENTARIO (21/21 PASS-UNIT)

La suite de pruebas preexistente `poc/catalyst-3-2/scripts/test-inventory-logic.ts` fue ejecutada de forma concurrente, confirmando que ninguna modificación introdujo regresiones en la lógica de inventario:
- Casos 1 a 15: StructuredQuery, proyección estricta `__name__`, paginación de cursor, anonimización y límites.
- Casos 16 a 21 (Casos A a F): Deduplicación concreta por padre, matrices de 5 usuarios, rutas anidadas e idempotencia de checkpoints.
- **Resultado de Regresión:** **21/21 APROBADAS (100% PASS-UNIT)**.

**Total Acumulado de Pruebas Automatizadas en la POC:**  
$$34 \text{ (Pruebas de Cierre 3.4.2)} + 21 \text{ (Pruebas de Inventario 3.3.6)} = 55 \text{ PRUEBAS UNITARIAS APROBADAS (100% PASS-UNIT)}$$
