# VIGORCORE — INFORME EJECUTIVO DE AUDITORÍA ADVERSARIAL (FASE 3.4.1)
## Auditoría Técnica Independiente y Validación Cruzada del Diseño ETL Firestore → Zoho Catalyst NoSQL

**Fecha de emisión:** 10 de noviembre de 2026  
**Auditor Principal:** Arquitecto de Software Senior & Auditor Especialista en Seguridad NoSQL/IAM  
**Alcance de la Auditoría:** Validación estática, análisis adversarial y contraste de los 9 entregables de la Fase 3.4 contra el código fuente, tipos TypeScript, SDK `@zcatalyst/nosql` y contratos de seguridad.  
**Universo Histórico de Referencia:** 73 documentos (5 en `users` + 68 en subcolecciones) conciliados en Fase 3.3.7.  
**Estado de la Base de Datos:** Intacta (Cero conexiones remotas, Cero descargas, Cero modificaciones en Firestore o Catalyst).

---

## 1. RESUMEN EJECUTIVO

La presente auditoría adversarial fue ejecutada para someter el diseño ETL de la Fase 3.4 a un escrutinio técnico riguroso e independiente, desafiando las asunciones previas y verificando si el sistema está verdaderamente preparado para la extracción de datos en la Fase 3.5.

Aunque la Fase 3.4 estableció una base arquitectónica sólida (desglose por entidad, esquema híbrido `Users`/`UserData`, aislamiento multi-inquilino y preservación del Firebase UID como `sourceUid`), el análisis adversarial ha descubierto **cuatro bloqueos críticos (BLOCKERS)** y **seis riesgos de severidad ALTA** que imposibilitan autorizar la extracción y carga inmediata sin remediación previa:

1. **Bloqueo Crítico en Vinculación de Identidades (F-ID-01 / BLOCKER):**  
   El diseño propone una vinculación Just-In-Time (JIT) en Catalyst basada exclusivamente en `emailNormalized`. Si un atacante registra una cuenta no verificada con el correo de un atleta existente antes de que este inicie sesión en Catalyst, se produciría una apropiación ilegítima de cuenta (Account Takeover) y acceso a todo el historial deportivo y biométrico.
2. **Bloqueo en Autorización Backend y Contexto de Petición (F-ID-02 / BLOCKER):**  
   El diseño no blinda explícitamente el mecanismo de derivación del `sourceUid` en el backend de Catalyst, dejando la puerta abierta a que el cliente web envíe un `sourceUid` arbitrario en parámetros de consulta o payloads, violando el aislamiento multi-inquilino.
3. **Bloqueo en Pérdida de Precisión de Tipos Numéricos y Temporales (F-SER-01 / BLOCKER):**  
   La regla de transformación convierte indiscriminadamente `integerValue` a `Number(v)` de JavaScript, lo cual causa pérdida irreversible de precisión para enteros de 64 bits mayores a `Number.MAX_SAFE_INTEGER` ($2^{53}-1$). Asimismo, la conversión de `timestampValue` de nanosegundos a `Date` de JavaScript descarta los nanosegundos, rompiendo la verificación del hash criptográfico canónico.
4. **Bloqueo en Estrategia de Rollback Destructivo (F-ROL-01 / BLOCKER):**  
   La política de rollback propuesta en `etl-risk-register.md` plantea eliminar todos los registros con `_migrationBatchId == 'MIG-20261109-01'`. Si un atleta modifica un registro importado (ej. actualiza su peso o completa un ítem de despensa) y posteriormente se ejecuta un rollback, se destruirían datos legítimos generados por el usuario.
5. **Inconsistencia Terminológica en Seguridad (F-PRV-01 / HIGH):**  
   El uso del término publicitario "Zero Data" en el diseño es técnicamente incorrecto y peligroso: la extracción descarga documentos completos con nombres, biometría y pesos a la estación local del desarrollador. El término correcto y auditable es **Minimización de Datos y Privacidad por Diseño (Data Minimization & Privacy by Design)**.
6. **Sobredimensionamiento de Infraestructura NoSQL (F-SCH-01 / MEDIUM):**  
   Se diseñaron 6 tablas NoSQL para migrar únicamente 73 documentos pertenecientes a 2 entidades físicas (`users` y subcolecciones). Las 6 colecciones administrativas tienen 0 documentos en Firestore; crear esas 4 tablas adicionales en esta fase es prematuro.

---

## 2. RESUMEN DEL REGISTRO DE HALLAZGOS

| Identificador | Categoría | Severidad | Estado | Resumen del Hallazgo |
| :--- | :--- | :---: | :---: | :--- |
| **F-ID-01** | Identidad / IAM | **CRITICAL** | **BLOCKER** | Vinculación JIT por correo sin exigir verificación criptográfica de email en Catalyst (Riesgo de Account Takeover). |
| **F-ID-02** | Autorización | **CRITICAL** | **BLOCKER** | Ausencia de derivación estricta y obligatoria de `sourceUid` desde el token de sesión en el middleware del backend. |
| **F-SER-01** | Serialización | **CRITICAL** | **BLOCKER** | Pérdida de precisión en enteros de 64 bits y truncamiento de nanosegundos en `timestampValue`. |
| **F-ROL-01** | Recuperación | **CRITICAL** | **BLOCKER** | Rollback ciego por `_migrationBatchId` que podría eliminar mutaciones legítimas posteriores de usuarios. |
| **F-SER-02** | Criptografía | **HIGH** | **PROPOSED** | Ambigüedad en la comparación de hashes: falta separar el hash del documento crudo vs el hash del payload canónico normalizado. |
| **F-SCH-01** | Arquitectura NoSQL | **MEDIUM** | **PROPOSED** | Infraestructura prematura: 4 de las 6 tablas no alojan ningún dato histórico de los 73 documentos inventariados. |
| **F-SCH-02** | Claves Compuestas | **HIGH** | **PROPOSED** | Riesgo de colisión en sort keys (`MEAL#<dateTime>#<id>`) ante formatos de fecha no homogéneos o campos opcionales nulos. |
| **F-CON-01** | Concurrencia ETL | **HIGH** | **PROPOSED** | Falta de un protocolo formal de ventana de mantenimiento con congelamiento de escrituras en Firestore durante la extracción. |
| **F-PRV-01** | Privacidad | **MEDIUM** | **PROPOSED** | Sustitución formal del término publicitario "Zero Data" por "Minimización de Datos y Privacidad por Diseño". |
| **F-EVI-01** | Verificación | **HIGH** | **PROPOSED** | Clasificación errónea de pruebas: las 21 pruebas de inventario de solo nombres no validan el pipeline ETL. |

---

## 3. COMPARATIVA DE ARQUITECTURAS DE IDENTIDAD Y AUTORIZACIÓN

El informe `identity-security-audit.md` evalúa exhaustivamente cuatro alternativas arquitectónicas:

```
[Alternativa A] Firebase UID como Partición Principal Directa (Recomendada con Blindaje Backend)
                Auth Context: Catalyst Token -> Lookup Users (GSI_Email + email_verified) -> SourceUID
                Partition Key: USER#<sourceUid> (Garantiza cero re-escrituras y continuidad total).

[Alternativa B] Catalyst user_id como Partición Principal Directa
                Descartada: Exige que los 5 atletas se registren previamente en Catalyst antes del ETL,
                o requiere un proceso asíncrono de re-particionamiento masivo de 68 registros.

[Alternativa C] Tabla de Correspondencia Aislada Externa
                Descartada: Introduce un salto de red (hop) adicional en cada operación de lectura/escritura.

[Alternativa D] Modelo Híbrido con Puente de Identidad en Tabla Users (SELECCIONADA AUDITADA)
                El registro en 'Users' actúa como enlace autorizado. El backend resuelve el mapeo en memoria
                tras validar la sesión y nunca acepta identificadores provistos por el cliente.
```

---

## 4. DICTAMEN FINAL DE LA AUDITORÍA (FASE 3.4.1)

Conforme a las reglas directivas y al estándar de ingeniería de software para sistemas médicos y deportivos:

# **APPROVED WITH BLOCKERS**

### Justificación Técnica del Dictamen:
1. El diseño general es **viable, maduro y conceptualmente sólido**: la partición de datos por atleta, el mapeo de colecciones y el modelado NoSQL compuesto representan la dirección correcta para Zoho Catalyst.
2. Sin embargo, **NO SE AUTORIZA EL INICIO DE LA EXTRACCIÓN (FASE 3.5)** hasta que los cuatro bloqueos críticos (**F-ID-01, F-ID-02, F-SER-01 y F-ROL-01**) sean formalmente subsanados y acompañados de sus respectivas pruebas unitarias y contratos estáticos.
3. El documento `readiness-gate-3.5.md` detalla la lista de verificación exacta y las evidencias exigidas que permitirán levantar los bloqueos y certificar el paso a la Fase 3.5.
