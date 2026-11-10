# VIGORCORE — AUDITORÍA DE IDENTIDAD, AUTORIZACIÓN Y AISLAMIENTO (FASE 3.4.1)
## Análisis Forense del Enlace Firebase UID ↔ Catalyst user_id, Mitigación de Account Takeover y Aislamiento Multi-inquilino

**Fecha de emisión:** 10 de noviembre de 2026  
**Auditor:** Especialista en Ciberseguridad, IAM y Arquitectura de Sistemas Distribuidos  
**Entregable Auditado Principal:** `poc/catalyst-3-2/reports/etl-design/identity-mapping-design.md`

---

## 1. EVALUACIÓN CRÍTICA DE LAS 8 PREGUNTAS FUNDAMENTALES DE IDENTIDAD

### 1.1. ¿Cómo se demuestra que una cuenta autenticada en Catalyst corresponde al UID histórico de Firebase?
En el diseño de la Fase 3.4 se propuso una búsqueda por `emailNormalized` en la tabla `Users`.  
**Veredicto Adversarial:** La correspondencia **NO está criptográficamente demostrada** con la sola coincidencia de la cadena de texto de correo si no se valida que la cuenta de Catalyst posea un correo verificado (`is_confirmed == true`).  
Para demostrar la correspondencia legal y técnica se deben cumplir simultáneamente tres condiciones:
1. El correo electrónico en Catalyst (`req.currentUser.email_id`) coincide con `emailNormalized` del registro pre-migrado en `Users`.
2. El proveedor de identidad de Catalyst certifica que el correo ha sido verificado mediante token OTP o enlace firmado (`is_confirmed == true`).
3. El estado de la cuenta en `accountAccess` o `Users` se encuentra en `ACTIVE` y no en `SUSPENDED` o `DISABLED`.

---

### 1.2. ¿Es seguro utilizar el mismo correo electrónico como único criterio de vinculación?
**Veredicto Adversarial:** **NO ES SEGURO** de forma aislada [BLOCKER: F-ID-01].  
- *Vulnerabilidad Detectada:* En flujos de autenticación abierta o registro por contraseña en plataformas SaaS, si un atacante conoce el correo de un atleta (frecuentemente público o visible en perfiles deportivos) y crea una cuenta en Catalyst antes de que el atleta real haga su primer login, si Catalyst no exige verificación previa antes de emitir la sesión, el atacante se apropiaría del registro histórico del atleta.
- *Mitigación Obligatoria:* La vinculación Just-In-Time (JIT) **solo debe ejecutarse si Catalyst confirma expresamente la verificación del correo** (`is_confirmed: true`). Si la cuenta no está confirmada, el acceso a los datos pre-migrados debe ser denegado terminantemente (`HTTP 403: EMAIL_VERIFICATION_REQUIRED`).

---

### 1.3. ¿Qué sucede con correos modificados, duplicados, sin verificar o cuentas deshabilitadas?
1. **Correos Modificados en Firebase antes del ETL:** El script de extracción leerá el correo actual persistido en el documento `/users/{uid}`. La normalización debe transformar minúsculas y trim (`email.trim().toLowerCase()`).
2. **Correos Duplicados:** En Firebase Auth, el correo es unívoco si `linkWithCredential` o `Multiple accounts per email address` está desactivado. Sin embargo, en Firestore se auditará si dos documentos en `/users` tienen el mismo correo. Si existe colisión, el validador del ETL debe enviar ambos documentos a cuarentena (`REJECTED_REVIEW_REQUIRED`) y detener la carga.
3. **Correos Sin Verificar en Origen:** En los 5 usuarios de Firestore, la auditoría del esquema reveló que `emailVerified` es un campo booleano opcional. Si en origen el correo no estaba verificado, la cuenta pre-migrada en Catalyst debe crearse en estado `PENDING_VERIFICATION` y requerir verificación estricta antes de asociar el historial.
4. **Cuentas Deshabilitadas o Suspendidas:** Si el atleta estaba suspendido en `accountAccess/{uid}`, la tabla `Users` en Catalyst debe inicializarse con `accountStatus: 'suspended'`, impidiendo cualquier consulta a `UserData`.

---

### 1.4. ¿Cómo se evita que un usuario reclame el UID de otra persona?
1. **Inmutabilidad del Enlace (Write-Once / Bind-Once):**  
   Una vez que un `sourceUid` ha sido vinculado a un `catalystUserId`, el registro en `Users` transiciona su estado a `linkStatus: 'LINKED_ACTIVE'`. La operación de actualización debe incluir una condición atómica NoSQL:
   ```typescript
   condition: {
     group_operator: AND,
     group: [
       { attribute: ['linkStatus'], operator: EQUALS, value: { S: 'MIGRATED_UNLINKED' } },
       { attribute: ['catalystUserId'], function: { function_name: 'attribute_exists' }, negate: true }
     ]
   }
   ```
2. Si un segundo usuario con otro `catalystUserId` intenta reclamar el mismo `sourceUid`, la condición fallará con `CONDITIONAL_CHECK_FAILED` y la petición será bloqueada y registrada en `AuditLogs` como intento de intrusión.

---

### 1.5. ¿Cómo se recupera una vinculación interrumpida?
Si el proceso de vinculación falla a mitad de camino (ej. se actualizó el registro en memoria pero se cayó la red antes de persistir en Catalyst NoSQL):
- Dado que la condición atómica exige `linkStatus == 'MIGRATED_UNLINKED'`, una operación fallida deja el registro intacto en su estado previo.
- El usuario puede reintentar el login en su siguiente sesión. El proceso es estrictamente idempotente.

---

### 1.6. ¿Cómo se evita que el frontend envíe un `sourceUid` arbitrario para acceder a los datos de otra persona?
**Veredicto Adversarial:** **FALLA DE DISEÑO EN FASE 3.4 [BLOCKER: F-ID-02].**  
- En el diseño preliminar no se especificó con suficiente rigor cómo se prohíbe el paso de `sourceUid` desde el cliente web.
- **Regla Inquebrantable de Autorización:**  
  **El frontend NUNCA debe enviar `sourceUid`, `userId` ni `pk` como parámetro en la URL ni en el body de peticiones de lectura o mutación personal.**
- El cliente React envía exclusivamente la cookie de sesión o el token Bearer emitido por Catalyst Auth.
- El middleware del backend (`authGuard.ts`) inspecciona el token, extrae el `req.currentUser.user_id` verificado criptográficamente, consulta la tabla `Users` en el backend y resuelve internamente el `sourceUid`.
- Cualquier petición que intente inyectar `sourceUid` en los headers o parámetros debe ser rechazada de inmediato con `HTTP 400: MALFORMED_SECURITY_CONTEXT`.

---

### 1.7. ¿Qué información debe comprobar el backend en cada petición?
El middleware `authGuard` de Catalyst debe verificar en cada solicitud:
1. **Firma y Vigencia del Token de Sesión:** Token JWT de Catalyst válido, no expirado y emitido por el proyecto oficial.
2. **Identidad del Usuario:** Extracción segura de `user_id`, `email_id` y `is_confirmed`.
3. **Estado de la Cuenta:** Comprobar que `accountStatus == 'active'`. Si está `suspended`, devolver `HTTP 403: ACCOUNT_SUSPENDED`.
4. **Resolución del Tenant:** Resolver en memoria (con caché de sesión de corta duración, TTL 60s) la tupla:
   $$\text{Session} \longrightarrow (\text{catalystUserId}, \text{sourceUid}, \text{role})$$
5. **Inyección en el Contexto:** Inyectar en `req.actor` el objeto inmutable:
   ```typescript
   req.actor = {
     catalystUserId: user.user_id,
     sourceUid: userMapping.sourceUid,
     partitionKey: `USER#${userMapping.sourceUid}`,
     role: userMapping.role,
     email: user.email_id
   };
   ```
6. **Ejecución en Almacén:** Toda llamada al SDK de NoSQL utiliza **exclusivamente** `req.actor.partitionKey`.

---

### 1.8. ¿Qué sucede si el mapeo entre ambas identidades no existe?
Si un usuario se autentica en Catalyst pero su correo no coincide con ninguno de los 5 atletas históricos pre-migrados:
1. Se trata de un **usuario nuevo** registrado en la plataforma Catalyst tras la migración.
2. El sistema crea un registro nuevo en `Users` donde:
   - `sourceUid`: Se inicializa con el mismo `user_id` de Catalyst (`sourceUid = 'CAT_' + user_id`).
   - `linkStatus`: `'NATIVE_CATALYST'`.
   - `pk`: `USER#CAT_<user_id>`.
3. Se inicializa su perfil mediante el flujo estándar de Onboarding.
4. En ningún caso se le asigna ni se le permite vincular un UID histórico de Firebase.

---

## 2. COMPARATIVA EXHAUSTIVA DE LAS CUATRO ALTERNATIVAS DE IDENTIDAD

| Criterio de Evaluación | Alternativa A: Firebase UID como Partición | Alternativa B: Catalyst user_id como Partición | Alternativa C: Tabla de Mapeo Aislada Externa | Alternativa D: Híbrido con Puente en Tabla Users (SELECCIONADA) |
| :--- | :--- | :--- | :--- | :--- |
| **Complejidad de Migración ETL** | **Mínima:** Los 68 documentos se cargan con `pk = USER#<firebaseUid>`. Cero re-escrituras. | **Extrema:** Exige pre-crear los 5 usuarios en Catalyst antes del ETL o re-particionar 68 registros después. | **Media:** Requiere poblar una tabla adicional de lookup. | **Óptima:** Carga directa de 68 registros en `UserData` y pre-aprovisionamiento en `Users`. |
| **Rendimiento en Lectura** | **Alto:** 1 sola lectura a `UserData`. | **Alto:** 1 sola lectura a `UserData`. | **Pobre:** 2 lecturas consecutivas (Hop a Lookup + Hop a Data). | **Excelente:** Caché de sesión en backend; 1 sola lectura a `UserData`. |
| **Riesgo de Inconsistencia** | Bajo si el backend blindado resuelve el enlace. | Alto si el usuario tarda semanas en registrarse en Catalyst. | Medio si la tabla de mapeo se desincroniza. | Mínimo: el registro en `Users` es la única fuente de verdad. |
| **Impacto en Usuarios Nuevos** | Regular (prefijo heterogéneo). | Óptimo para usuarios nuevos, pésimo para históricos. | Homogéneo pero costoso. | **Perfecto:** Históricos usan `USER#<firebaseUid>`, nuevos usan `USER#CAT_<id>`. |
| **Veredicto Técnico** | Viable pero incompleto. | **RECHAZADA (Inviable operativamente)**. | **RECHAZADA (Sobrecarga de red)**. | **APROBADA Y BLINDADA**. |

---

## 3. ESPECIFICACIÓN DEL MODELO DE AUTORIZACIÓN DEFINITIVO

- **Identidad Utilizada para Autorizar:** `req.currentUser.user_id` (Catalyst Auth) validado contra `Users.catalystUserId`.
- **Identidad Utilizada para Almacenar y Particionar:** `sourceUid` (Firebase UID original para históricos; `CAT_<id>` para nuevos).
- **Invariante de Seguridad:**  
  $$\forall \text{ petición NoSQL}, \quad \text{PartitionKey} = f(\text{Token Criptográfico Validado}) \neq f(\text{Payload Cliente})$$
