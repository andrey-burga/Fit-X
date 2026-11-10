# VIGORCORE — REGISTRO DETALLADO DE HALLAZGOS DE AUDITORÍA (FASE 3.4.1)
## Catálogo Completo de Vulnerabilidades, Discrepancias, Clasificaciones y Acciones Correctivas

**Fecha de emisión:** 10 de noviembre de 2026  
**Auditor:** Auditor Técnico Principal de Software  
**Regla de Severidad:**  
- **CRITICAL / BLOCKER:** Impide técnicamente la extracción o carga de datos por riesgo de corrupción, pérdida de datos o brecha de seguridad.
- **HIGH:** Riesgo significativo de inconsistencia o fallo operativo que debe resolverse antes de la carga remota.
- **MEDIUM:** Oportunidad de mejora arquitectónica, simplificación o precisión terminológica.
- **LOW:** Observación cosmética o de documentación menor.

---

### HALLAZGO 1: VINCULACIÓN JIT POR CORREO ELECTRÓNICO SIN VALIDAR ESTADO DE VERIFICACIÓN
- **Identificador:** `F-ID-01`
- **Severidad:** **CRITICAL**
- **Estado de Clasificación:** **BLOCKER**
- **Archivo y Sección Afectados:** `poc/catalyst-3-2/reports/etl-design/identity-mapping-design.md`, Sección 3 ("Mecanismo de Vinculación en el Primer Acceso").
- **Evidencia Técnica:**  
  El diseño especifica vincular la cuenta histórica de Firebase consultando `GSI_Email` con `emailNormalized = req.currentUser.email_id.toLowerCase()`, sin comprobar el atributo booleano `is_confirmed` devuelto por el SDK `@zcatalyst/auth` (`ICatalystUser.is_confirmed` en `src/auth/catalystAuth.ts:12`).
- **Consecuencia:**  
  Vulnerabilidad de apropiación ilegítima de cuenta (Account Takeover). Un tercero malintencionado que conozca el correo de un atleta podría registrarse en Catalyst; si la plataforma emite una sesión previa a la confirmación de email, el atacante obtendría acceso inmediato a la biometría, peso y registros del atleta real.
- **Corrección Recomendada:**  
  Modificar el contrato de vinculación: exigir explícitamente `req.currentUser.is_confirmed === true`. Si es `false`, denegar el enlace con `HTTP 403: EMAIL_CONFIRMATION_REQUIRED`.
- **Prueba para Cerrar el Hallazgo:**  
  Prueba unitaria en `test-identity-guard.ts` que simula un usuario con correo coincidente pero `is_confirmed: false` y verifica que la vinculación es abortada con error.

---

### HALLAZGO 2: AUSENCIA DE DERIVACIÓN ESTRICTA DE LA CLAVE DE PARTICIÓN EN EL BACKEND
- **Identificador:** `F-ID-02`
- **Severidad:** **CRITICAL**
- **Estado de Clasificación:** **BLOCKER**
- **Archivo y Sección Afectados:** `poc/catalyst-3-2/reports/etl-design/identity-mapping-design.md`, Sección 4 ("Prevención de Contaminación y Suplantación Multi-inquilino").
- **Evidencia Técnica:**  
  No se especificó la prohibición formal del parámetro `sourceUid` en el contrato de API del frontend. Si el cliente envía `{ sourceUid: 'usr_victima' }` en el cuerpo de una solicitud REST, una implementación ingenua podría usar ese valor en lugar del resuelto por el backend.
- **Consecuencia:**  
  Vulnerabilidad de Referencia Directa Insegura a Objetos (IDOR / Broken Object Level Authorization). Un atleta podría leer o mutar la despensa y entrenamientos de otro atleta modificando el payload de su navegador.
- **Corrección Recomendada:**  
  Establecer que el middleware `authGuard` inyecta `req.actor.partitionKey` de forma forzada y que los controladores de Express ignoran cualquier clave de partición o identificador enviado por el cliente.
- **Prueba para Cerrar el Hallazgo:**  
  Prueba de análisis estático o unitaria donde se envía un `sourceUid` manipulado en el body y se confirma que el backend ejecuta la consulta utilizando exclusivamente la partición del usuario autenticado en la cookie.

---

### HALLAZGO 3: PÉRDIDA DE PRECISIÓN EN ENTEROS DE 64 BITS Y TRUNCAMIENTO DE TIMESTAMPS
- **Identificador:** `F-SER-01`
- **Severidad:** **CRITICAL**
- **Estado de Clasificación:** **BLOCKER**
- **Archivo y Sección Afectados:** `poc/catalyst-3-2/reports/etl-design/etl-transformation-rules.md`, Sección 1 ("Reglas de Desempaquetado del Formato Firestore REST").
- **Evidencia Técnica:**  
  La regla indica: `integerValue: string -> Number(v)`. En JavaScript, `Number.MAX_SAFE_INTEGER` es $9,007,199,254,740,991$. Si un wearable o Firestore genera una marca temporal en microsegundos o un ID numérico de 64 bits, la conversión a `Number` descarta los dígitos menos significativos. Asimismo, convertir `timestampValue` con nanosegundos mediante `new Date().toISOString()` trunca de 9 a 3 decimales.
- **Consecuencia:**  
  Corrupción silenciosa e irreversible de métricas de alta precisión y divergencia matemática entre el hash del documento fuente y el hash del documento transformado, haciendo fracasar la reconciliación del Nivel 4.
- **Corrección Recomendada:**  
  Implementar la función `deserializeFirestoreInteger` con `BigInt` para validar el rango seguro y almacenar el string textual si excede `MAX_SAFE_INTEGER`. Preservar la cadena RFC 3339 completa en `_sourceTimestampNano`.
- **Prueba para Cerrar el Hallazgo:**  
  Prueba unitaria procesando un mock con `integerValue: "9223372036854775807"` (int64 max) y un timestamp con nanosegundos `.123456789Z`, validando que no se pierda un solo dígito.

---

### HALLAZGO 4: PROCEDIMIENTO DE ROLLBACK CIEGO POR BATCH ID DESTRUCTIVO
- **Identificador:** `F-ROL-01`
- **Severidad:** **CRITICAL**
- **Estado de Clasificación:** **BLOCKER**
- **Archivo y Sección Afectados:** `poc/catalyst-3-2/reports/etl-design/etl-risk-register.md`, Sección 2 ("Plan de Contingencia y Estrategia de Rollback").
- **Evidencia Técnica:**  
  Se estipuló que el rollback eliminaría todos los registros con `_migrationBatchId == 'MIG-20261109-01'` mediante `deleteItems`.
- **Consecuencia:**  
  Si un atleta utiliza la aplicación tras la migración, registra series o añade alimentos, y posteriormente se ejecuta un rollback técnico para corregir un fallo en otro usuario, el script eliminaría el registro completo del atleta, destruyendo sus modificaciones legítimas.
- **Corrección Recomendada:**  
  El rollback debe incorporar obligatoriamente la condición de guardia: solo se eliminan registros cuyo `updatedAt == _migratedAt` o donde `_userMutatedAfterMigration` sea falso.
- **Prueba para Cerrar el Hallazgo:**  
  Prueba unitaria en `test-rollback-safety.ts` con un registro importado y posteriormente mutado por el usuario, comprobando que el rollback lo preserva intacto.

---

### HALLAZGO 5: AMBIGÜEDAD Y CONFUSIÓN EN LA DEFINICIÓN DE HASHES CRIPTOGRÁFICOS
- **Identificador:** `F-SER-02`
- **Severidad:** **HIGH**
- **Estado de Clasificación:** **PROPOSED**
- **Archivo y Sección Afectados:** `poc/catalyst-3-2/reports/etl-design/etl-reconciliation-plan.md`, Sección 1 (Nivel 4).
- **Evidencia Técnica:**  
  Se indicaba comparar el hash de Firestore con el hash de Catalyst NoSQL sin aclarar que el JSON de origen de Firestore REST tiene una estructura completamente diferente (campos con envoltorios `{ stringValue: ... }`) a la del modelo de destino.
- **Consecuencia:**  
  Imposibilidad matemática de que el hash del JSON crudo de Firestore coincida con el hash del JSON plano de Catalyst.
- **Corrección Recomendada:**  
  Formalizar el modelo tripartito: `Hash_Source` (integridad de extracción cruda), `Hash_Transformed` (huella canónica pre-carga) y `Hash_Target` (huella canónica recuperada de Catalyst). La reconciliación compara `Hash_Transformed == Hash_Target`.
- **Prueba para Cerrar el Hallazgo:**  
  Verificación en `test-serialization-precision.ts` demostrando que `Hash_Transformed` derivado de un payload plano es idéntico al regenerado tras la lectura.

---

### HALLAZGO 6: RIESGO DE COLISIÓN Y SINTAXIS INVÁLIDA EN CLAVES COMPUESTAS
- **Identificador:** `F-SCH-02`
- **Severidad:** **HIGH**
- **Estado de Clasificación:** **PROPOSED**
- **Archivo y Sección Afectados:** `poc/catalyst-3-2/reports/etl-design/catalyst-nosql-schema.md`, Sección 2 (Tabla `UserData`).
- **Evidencia Técnica:**  
  Patrones como `MEAL#<dateTimeIso>#<id>` y `SET#<workoutId>#<id>` asumen que `dateTimeIso` es siempre homogénea y que `workoutId` nunca es nulo ni contiene `#`. En `WorkoutSessionRecord`, `executedWorkoutId` es opcional; si falta, la clave contendría `SET#undefined#<id>`.
- **Consecuencia:**  
  Colisiones de ordenamiento en NoSQL o imposibilidad de ejecutar consultas de rango por fecha debido a formatos heterogéneos.
- **Corrección Recomendada:**  
  Sanitizar los segmentos reemplazando `#` por `_`, normalizar fechas a ISO UTC canónico y utilizar `'UNLINKED'` cuando `executedWorkoutId` sea nulo o indefinido.
- **Prueba para Cerrar el Hallazgo:**  
  Prueba unitaria generando claves compuestas para registros con campos opcionales nulos o caracteres `#`.

---

### HALLAZGO 7: AUSENCIA DE ESPECIFICACIÓN DE VENTANA DE MANTENIMIENTO FRÍA
- **Identificador:** `F-CON-01`
- **Severidad:** **HIGH**
- **Estado de Clasificación:** **PROPOSED**
- **Archivo y Sección Afectados:** `poc/catalyst-3-2/reports/etl-design/etl-architecture-3.4.md`, Sección 4 (D10).
- **Evidencia Técnica:**  
  El diseño clasificó la migración en frío como PROPOSED pero no estableció cómo se garantiza la ausencia de escrituras concurrentes de atletas durante los 5 minutos de extracción.
- **Consecuencia:**  
  Riesgo de discrepancias de volumen (ej: el inventario vio 73 documentos pero se extraen 74 o uno cambia de estado), invalidando el conteo de conciliación.
- **Corrección Recomendada:**  
  Formalizar el protocolo de ventana de mantenimiento con comunicación a los usuarios o activación temporal de modo solo lectura en las reglas de seguridad.
- **Prueba para Cerrar el Hallazgo:**  
  Comprobación estática de la ventana de tiempo y confirmación antes del inicio de la Fase 3.5.

---

### HALLAZGO 8: TERMINOLOGÍA ERRÓNEA "ZERO DATA" ANTE EXTRACCIÓN REAL DE ARCHIVOS
- **Identificador:** `F-PRV-01`
- **Severidad:** **MEDIUM**
- **Estado de Clasificación:** **PROPOSED**
- **Archivo y Sección Afectados:** `poc/catalyst-3-2/reports/etl-design/etl-security-model.md`, Sección 1.
- **Evidencia Técnica:**  
  El diseño utiliza repetidamente el término "Zero Data Architecture" para referirse a un proceso que descarga 73 documentos con nombres, correos y biometría al disco local del desarrollador en `.data/raw/`.
- **Consecuencia:**  
  Confusión conceptual en auditorías de cumplimiento legal. Los datos existen localmente y requieren medidas activas de custodia.
- **Corrección Recomendada:**  
  Adoptar la terminología técnica correcta: **Minimización de Datos y Privacidad por Diseño (Data Minimization & Privacy by Design)**, limitando el concepto de "Zero Data" exclusivamente a los reportes versionados en Git y salidas de consola.
- **Prueba para Cerrar el Hallazgo:**  
  Actualización documental de la terminología en los informes de seguridad.

---

### HALLAZGO 9: ASIGNACIÓN PREMATURA DE TABLAS ADMINISTRATIVAS NO REQUERIDAS
- **Identificador:** `F-SCH-01`
- **Severidad:** **MEDIUM**
- **Estado de Clasificación:** **PROPOSED**
- **Archivo y Sección Afectados:** `poc/catalyst-3-2/reports/etl-design/catalyst-nosql-schema.md`, Sección 1 y 2.
- **Evidencia Técnica:**  
  Se propuso crear `AdminDirectory`, `AdminInvitations`, `AuditLogs` y `SystemLocks` cuando en Firestore las 6 colecciones administrativas tienen 0 documentos históricos.
- **Consecuencia:**  
  Complejidad innecesaria en el aprovisionamiento de Zoho Catalyst para la migración de los 73 documentos actuales.
- **Corrección Recomendada:**  
  Reducir el alcance inicial de aprovisionamiento en Catalyst NoSQL a dos tablas operativas: `Users` y `UserData`. Las tablas administrativas se crearán cuando se desplieguen las funciones que las consumen.
- **Prueba para Cerrar el Hallazgo:**  
  Aprobación de la matriz simplificada de tablas.

---

### HALLAZGO 10: CLASIFICACIÓN ERRÓNEA DE PRUEBAS DE INVENTARIO COMO EVIDENCIA ETL
- **Identificador:** `F-EVI-01`
- **Severidad:** **HIGH**
- **Estado de Clasificación:** **PROPOSED**
- **Archivo y Sección Afectados:** `poc/catalyst-3-2/POC_REPORT.md` e informe de Fase 3.4.
- **Evidencia Técnica:**  
  Las 21 pruebas unitarias aprobadas en `test-inventory-logic.ts` evalúan consultas con proyección estricta `__name__` y BFS de rutas. No prueban deserialización de datos, validación de esquemas completos, cálculo de hashes canónicos ni inserción en Catalyst.
- **Consecuencia:**  
  Falsa sensación de seguridad si se asume que el pipeline ETL está probado porque las pruebas de inventario pasaron.
- **Corrección Recomendada:**  
  Crear una suite de pruebas específica para el ETL (`test-etl-logic.ts`) que evalúe la deserialización de Typed Value Maps, normalización de esquemas y generación de claves antes de la carga remota.
- **Prueba para Cerrar el Hallazgo:**  
  Suite unitaria de ETL independiente creada y ejecutada con 100% de éxito.
