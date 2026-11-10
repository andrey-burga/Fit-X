# VIGORCORE — DISEÑO DE ESQUEMA ZOHO CATALYST NOSQL (FASE 3.4)
## Arquitectura de Almacenamiento, Modelado de Claves, Índices y Patrones de Acceso

**Fecha de emisión:** 9 de noviembre de 2026  
**Auditor:** Arquitecto de Base de Datos NoSQL & Especialista en Zoho Catalyst  
**SDK de Referencia:** `@zcatalyst/nosql` v1.0.0 (Instalado y verificado en `poc/catalyst-3-2/`)  
**Dominio de Aplicación:** `https://fit-x-bhnatsxl.onslate.com`

---

## 1. EVALUACIÓN DE ESTRATEGIA DE MODELADO: SINGLE-TABLE VS MULTI-TABLE VS HÍBRIDO

En el diseño de bases de datos NoSQL basadas en clave de partición y clave de ordenamiento (Key-Value / Wide-Column Store como DynamoDB y Zoho Catalyst NoSQL), existen tres enfoques arquitectónicos:

### A. Enfoque Single-Table Puro (Todo en una única tabla)
- *Pros:* Una única tabla que aprovisionar; posibilidad de consultar en una sola petición el perfil del usuario, su biometría y sus preferencias mediante `queryTable(key_condition: pk = USER#<id>)`.
- *Contras:* Complejidad extrema en el diseño de índices secundarios; polución de atributos dispares; riesgo de colisiones de nombres; dificultades para aplicar políticas de retención granular (ej. purga de auditoría sin tocar atletas).

### B. Enfoque Multi-Table Tradicional (Una tabla por cada una de las 12 entidades)
- *Pros:* Espejo directo del modelo relacional; esquemas más simples por tabla.
- *Contras:* Aprovisionamiento de 12 a 18 tablas en Zoho Catalyst; múltiples llamadas de red HTTP independientes en el frontend para renderizar una sola pantalla; mayor consumo de cuota de operaciones.

### C. Enfoque Híbrido por Dominios de Coherencia (RECOMENDADO / SELECCIONADO) [PROPOSED]
Divide el sistema en **4 tablas principales y 2 tablas de control administrativo**, agrupando entidades que comparten ciclo de vida, propietario y patrones de acceso concurrentes:

1. **`Users` (Identidad y Autenticación):** Almacén canónico de perfiles de usuario (1 registro por atleta/coach).
2. **`UserData` (Datos Operativos del Atleta):** Almacén particionado de clave compuesta (`pk` = `USER#<id>`, `sk` = `<PREFIX>#<id>`) que consolida las 11 subcolecciones del atleta (`biometrics`, `preferences`, `groceries`, `mealLogs`, `workoutSessions`, `executedWorkouts`, `cardioSessions`, `notifications`, `recipes`, `mealPlans`, `workoutRoutines`).
3. **`AdminDirectory` (Gobernanza y Roles):** Metadatos de acceso, roles autoritativos, directorio centralizado y suspensión de cuentas.
4. **`AdminInvitations` (Flujo de Invitaciones):** Ciclo de vida de tokens e invitaciones seguras.
5. **`AuditLogs` (Trazabilidad Inmutable):** Registro append-only de eventos de auditoría y seguridad.
6. **`SystemLocks` (Concurrencia Distribuida y Sagas):** Bloqueos de recursos con fencing tokens y estado de operaciones (verificado en la POC 3.2).

---

## 2. ESPECIFICACIÓN DETALLADA DE LAS TABLAS DE CATALYST NOSQL

### TABLA 1: `Users` (Identidad y Perfil Raíz)
- **Propósito:** Almacenar el perfil maestro del usuario y vincular la identidad histórica de Firebase con la identidad nativa de Catalyst.
- **Partition Key (`pk`):** `USER#<userId>` (String, ej: `USER#usr_ABC123`).
- **Sort Key (`sk`):** `PROFILE` (String estático para permitir futuras extensiones de cuenta).
- **Índices Secundarios (GSI):**
  - `GSI_Email`: Partition Key `emailNormalized`, Proyección `ALL`. Permite búsqueda inmediata por correo electrónico durante el login o invitación.
- **Patrones de Lectura:**
  - *Lectura puntual:* `fetchItem('Users', { keys: { pk: 'USER#' + uid, sk: 'PROFILE' }, consistent_read: true })`.
  - *Búsqueda por correo:* `queryTable('Users', { index: 'GSI_Email', key_condition: emailNormalized = '...' })`.
- **Patrones de Escritura:**
  - *Registro:* Inserción con condición `attribute_exists(pk)` negada (`attribute_not_exists`).
  - *Actualización de perfil:* Actualización de `name`, `avatarUrl`, `location`. `role` y `email` son inmutables.
- **Consistencia:** Fuerte (`consistent_read: true`).
- **Límites de Tamaño:** Tamaño de ítem estimado: $< 2 \text{ KB}$ (muy por debajo del límite de $400 \text{ KB}$ por ítem en NoSQL).
- **Idempotencia:** Determinada por el `_payloadHash` del perfil y la unicidad de `pk`.

---

### TABLA 2: `UserData` (Colección Operativa Consolidada del Atleta)
- **Propósito:** Alojar todos los registros personales de las 11 subcolecciones de un atleta bajo una clave de partición unificada.
- **Partition Key (`pk`):** `USER#<userId>` (Garantiza aislamiento físico multi-inquilino absoluto).
- **Sort Key (`sk`):** Clave compuesta jerárquica con prefijo semántico:
  - Biometría: `BIO#current`
  - Preferencias: `PREF#settings`
  - Despensa: `GROCERY#<groceryId>`
  - Comidas: `MEAL#<dateTimeIso>#<mealLogId>`
  - Series Gym: `SET#<executedWorkoutId>#<sessionId>`
  - Sesiones Gym: `WORKOUT#<startedAtIso>#<workoutId>`
  - Cardio: `CARDIO#<dateIso>#<cardioId>`
  - Notificaciones: `NOTIF#<notificationId>`
  - Recetas: `RECIPE#<recipeId>`
  - Menús Semanales: `PLAN#<weekStartIso>`
  - Rutinas: `ROUTINE#<routineId>`
- **Índices Secundarios (GSI / LSI):**
  - `LSI_Category`: Sort Key `entityCategory` (String: `grocery`, `mealLog`, `set`, etc.) para consultas filtradas dentro de la partición del usuario sin escanear todos los registros.
- **Patrones de Lectura:**
  - *Carga de Dashboard Completo del Atleta:* `queryTable('UserData', { key_condition: pk = 'USER#' + uid })` (Devuelve biometría, preferencias, rutinas y notificaciones en un solo viaje de red).
  - *Lectura de Despensa:* `queryTable('UserData', { key_condition: pk = 'USER#' + uid AND sk begins_with 'GROCERY#' })`.
  - *Lectura de Historial de Entrenamientos por Rango:* `queryTable('UserData', { key_condition: pk = 'USER#' + uid AND sk between ['WORKOUT#2026-10-01', 'WORKOUT#2026-10-31'] })`.
  - *Lectura de Series de una Sesión:* `queryTable('UserData', { key_condition: pk = 'USER#' + uid AND sk begins_with 'SET#' + workoutId })`.
- **Patrones de Escritura:**
  - Inserciones individuales y en lote (`insertItems` con hasta 25 ítems por bloque).
  - Actualización atómica de estado de despensa (`toggleGroceryStatus`) mediante `updateItems` con operación `PUT` sobre el campo `status`.
- **Consistencia:**
  - Fuerte para Biometría y Sesiones de entrenamiento activas (`consistent_read: true`).
  - Eventual para Notificaciones leídas.
- **Riesgos de Consultas Ineficientes & Mitigación:**
  - *Riesgo:* Una partición con miles de registros de series históricas podría ralentizar las consultas globales.
  - *Mitigación:* Paginación por cursor mediante `begins_with` y filtros de fecha en la clave de ordenamiento.
- **Límites de Tamaño:** Cada ítem individual mide entre $0.3 \text{ KB}$ (despensa) y $15 \text{ KB}$ (sesión ejecutada con snapshots).

---

### TABLA 3: `AdminDirectory` (Gobernanza y Control de Acceso)
- **Propósito:** Servir a los endpoints de gestión de usuarios sin necesidad de escanear la tabla `Users`.
- **Partition Key (`pk`):** Clave prefijada de recurso:
  - Directorio: `ADMIN_USER#<uid>`
  - Estado de Rol: `ROLE_STATE#<uid>`
  - Control de Acceso: `ACCESS#<uid>`
- **Sort Key (`sk`):** `METADATA`
- **Índices Secundarios (GSI):**
  - `GSI_RoleStatus`: PK `role`, SK `accountStatus`. Permite filtrar instantáneamente todos los atletas suspendidos o administradores activos.
- **Patrones de Lectura:**
  - Listado paginado de usuarios para el panel de control administrativo.
  - Verificación de sesión activa anti-stale-tokens (`authGuard` de Catalyst).
- **Consistencia:** Fuerte (`consistent_read: true`).
- **Idempotencia:** Basada en versiones monótonas (`roleVersion` y `validAfter`).

---

### TABLA 4: `AdminInvitations` (Gestión de Invitaciones)
- **Propósito:** Control del ciclo de vida de invitaciones seguras enviadas por correo electrónico.
- **Partition Key (`pk`):** `INVITE#<inviteId>`.
- **Sort Key (`sk`):** `TOKEN_DATA`.
- **Índices Secundarios (GSI):**
  - `GSI_EmailStatus`: PK `emailNormalized`, SK `status`.
- **Patrones de Escritura:**
  - Creación con expiración a 7 días.
  - Canje atómico mediante `updateItems` condicional: `status == 'pending'`.
- **Consistencia:** Fuerte.

---

### TABLA 5: `AuditLogs` (Registro Inmutable Append-Only)
- **Propósito:** Trazabilidad estricta de todas las acciones privilegiadas del sistema.
- **Partition Key (`pk`):** Partición temporal mensual `AUDIT#YYYY-MM` (ej. `AUDIT#2026-11`) para balancear la distribución y permitir retención por antigüedad.
- **Sort Key (`sk`):** Timestamp inverso + UUID: `<invertedTimestampMs>#<eventId>` (Permite obtener los logs más recientes de forma inmediata sin ordenar en memoria).
- **Índices Secundarios (GSI):**
  - `GSI_Actor`: PK `actorUid`, SK `timestamp`.
  - `GSI_Target`: PK `targetUid`, SK `timestamp`.
- **Patrones de Escritura:** Exclusivamente `insertItems`. Modificación y eliminación prohibidas a nivel de aplicación.
- **Consistencia:** Eventual.

---

### TABLA 6: `SystemLocks` (Concurrencia Distribuida y Fencing Tokens)
- **Propósito:** Coordinación de transacciones distribuidas, orquestación de sagas y prevención del problema del último superadministrador.
- **Partition Key (`pk`):** `LOCK#<resourceId>` (ej. `LOCK#SUPERADMIN_COUNT`).
- **Sort Key (`sk`):** `LEASE` o `SINGLETON`.
- **Estructura Verificada en POC 3.2:**
  - `holderId` (string).
  - `fencingToken` (number monótono).
  - `leaseExpiresAt` (number Unix epoch ms).
  - `acquiredAt` (number).
- **Patrón de Operación:** Adquisición condicional `(attribute_not_exists(pk)) OR (leaseExpiresAt < now)` con incremento atómico de fencing token.

---

## 3. RESUMEN DE PROYECCIÓN DE LOS 73 DOCUMENTOS HISTÓRICOS

| Documentos en Origen | Colección Firestore | Tabla Destino en Catalyst | Clave de Partición (`pk`) | Clave de Ordenamiento (`sk`) |
| :---: | :--- | :--- | :--- | :--- |
| **5** | `/users/{uid}` | `Users` | `USER#<uid>` | `PROFILE` |
| **5** | `/users/{uid}/biometrics/current` | `UserData` | `USER#<uid>` | `BIO#current` |
| **5** | `/users/{uid}/preferences/settings` | `UserData` | `USER#<uid>` | `PREF#settings` |
| **43** | `/users/{uid}/groceries/{id}` | `UserData` | `USER#<uid>` | `GROCERY#<id>` |
| **4** | `/users/{uid}/mealLogs/{id}` | `UserData` | `USER#<uid>` | `MEAL#<dateTime>#<id>` |
| **6** | `/users/{uid}/notifications/{id}` | `UserData` | `USER#<uid>` | `NOTIF#<id>` |
| **3** | `/users/{uid}/workoutSessions/{id}`| `UserData` | `USER#<uid>` | `SET#<workoutId>#<id>` |
| **2** | `/users/{uid}/executedWorkouts/{id}`| `UserData` | `USER#<uid>` | `WORKOUT#<startedAt>#<id>` |
| **73** | **TOTAL DOCUMENTOS** | **2 Tablas Destino** | **68 en `UserData`** | **5 en `Users`** |

---

## 4. ANÁLISIS DE LIMITACIONES DEL SDK `@zcatalyst/nosql`

1. **Sin Soporte Transaccional Multi-Documento Nativo [VERIFIED]:**
   - A diferencia de Firestore `runTransaction()`, Catalyst NoSQL no ofrece commits atómicos cruzados entre múltiples documentos.
   - *Mitigación:* Se implementa el patrón Saga y fencing tokens probados en `poc/catalyst-3-2/src/nosql/testRepository.ts`.
2. **Límite de Operación por Lote [PROPOSED]:**
   - Las operaciones `insertItems` deben acotarse a bloques de hasta 25 elementos para evitar sobrecargar los límites de la API REST de Catalyst.
3. **Filtros de Consulta (`queryTable`) [VERIFIED]:**
   - Requiere obligatoriamente una condición sobre la clave de partición (`pk`). No admite escaneos completos no particionados sin especificar el índice.
