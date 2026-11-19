# VIGORCORE — ENTREGABLES 3, 4 Y 5 (CONGELACIÓN 4.0.5): MODELO DE DATOS, TABLAS, CLAVES, ÍNDICES Y TTL EN ZOHO CATALYST NOSQL

> **ESTADO CONGELADO (FASE 4.0.5 — PRE-APROVISIONAMIENTO):**  
> Este documento refleja de forma exacta la especificación física definitiva en `src/types/cleanSlate.ts` (`TABLE_SCHEMA_REGISTRY`) y el runbook operativo `docs/07-manual-catalyst-tables-runbook.md`.  
> **Cero tablas, índices o usuarios creados en Zoho Catalyst hasta aprobación explícita del operador.**

---

## 1. EVALUACIÓN EXPLÍCITA DE LA PROPUESTA PREVIA (`Users` + `UserData` EN 2 TABLAS)

En fases ETL anteriores se evaluó usar únicamente **2 tablas** (`Users` + `UserData`).

**Veredicto Arquitectónico Clean-Slate: MODIFICAR — 2 tablas son INSUFICIENTES para producción Clean-Slate; se congela un Modelo Definitivo de 5 Tablas.**

### Por qué 2 tablas (`Users` + `UserData`) NO bastan en Clean-Slate:
1. **Aislamiento de TTL:** Catalyst NoSQL configura el atributo TTL a nivel de tabla (`ttlEpochSec`, tipo `Number`). `AdminInvitations` y `SystemControl` (`CTRL#SAGA#*` y `SESSION#<sid>`) utilizan `ttlEpochSec` como recolección de basura asíncrona, mientras que `Users`, `UserData` y `AuditLogs` tienen TTL completamente desactivado.
2. **Consultas globales administrativas vs. partición de inquilino:** `AuditLogs` requiere particionado mensual (`AUDIT#<YYYY-MM>`) e índices por actor, objetivo y cronología trimestral (`GSI_AuditActor`, `GSI_AuditTarget`, `GSI_GlobalChronology`).
3. **Unificación atómica frente a falta de transacciones ACID multi-ítem:** Catalyst NoSQL solo garantiza atomicidad condicional sobre un ítem individual. Fusionar perfil + rol autoritativo + acceso + segmento de directorio en un único ítem en `Users` elimina condiciones de carrera y *split-brain* al suspender o cambiar roles.

---

## 2. ESPECIFICACIÓN FÍSICA DEFINITIVA DE LAS 5 TABLAS CONGELADAS (NOMBRES, CLAVES, ÍNDICES Y TTL)

Límites oficiales de Zoho Catalyst NoSQL respetados:
- **Sort Keys por tabla:** máximo **5** (1 primaria + hasta 4 adicionales). Todas nuestras tablas usan entre **0 y 3**.
- **Índices Secundarios por tabla:** máximo **20**. Todas nuestras tablas usan entre **0 y 3**.
- **Tamaño máximo por ítem:** **400 KB** (techo suave en aplicación: **350 KB**).
- **Lotes máximos (`insertItems` / `updateItems` / `deleteItems`):** **25 ítems** por invocación; lecturas paginadas `<= 100` ítems.

### Tabla 1: `Users` (Identidad, Perfil, RBAC Autoritativo, `sessionEpoch` y Segmento de Directorio)
- **Partition Key (`pk`, String):** `USER#<catalystUserId>`
- **Sort Key Primaria:** **Omitida (`null`)** — un único ítem por partición.
- **Additional Sort Keys:** **Ninguna (`0 / 5`)**
- **TTL:** **Desactivado**
- **Secondary Indexes (`3 / 20`):**
  1. `GSI_Email` — PK: `normalizedEmail` (`String`), SK: *Ninguna*, Proyección: `ALL` (**no impone unicidad**; la app consulta con `consistent_read: true` y bloquea duplicados `409 DUPLICATE_EMAIL_ANOMALY`).
  2. `GSI_Directory` — PK: `directorySegment` (`String`: `USER_SEG#0..3`), SK: `createdAt` (`String`), Proyección: `SPECIFIC_ATTRIBUTES` (`pk`, `uid`, `email`, `displayName`, `role`, `roleVersion`, `accountStatus`, `emailVerified`, `directorySegment`, `createdAt`, `lastSignInAt`).
  3. `GSI_RoleStatus` — PK: `role` (`String`), SK: `accountStatus` (`String`), Proyección: `ALL`.
- **Atributos autoritativos clave:** `uid`, `email`, `normalizedEmail`, `displayName`, `role` (`athlete|admin|superadmin`), `roleVersion`, **`sessionEpoch`** (revocación global de sesiones del usuario), `accountStatus` (`active|suspended`), `emailVerified`, `directorySegment`.

### Tabla 2: `UserData` (Las 11 Áreas Operativas del Atleta)
- **Partition Key (`pk`, String):** `USER#<catalystUserId>` (aislamiento estricto multi-tenant)
- **Sort Key Primaria (`sk`, String):** Clave jerárquica compuesta:
  - Biometría: `BIO#current`
  - Preferencias: `PREF#settings`
  - Despensa: `GROCERY#<groceryId>`
  - Comidas: `MEAL#<dateTimeIso>#<mealLogId>`
  - Recetas: `RECIPE#<recipeId>`
  - Menú Semanal: `PLAN#<weekStartIso>`
  - Rutinas / Mesociclos: `ROUTINE#<routineId>`
  - Entrenamiento Ejecutado: `WORKOUT#<startedAtIso>#<workoutId>`
  - Series Gym: `SET#<executedWorkoutId>#<sessionId>`
  - Cardio / HIIT: `CARDIO#<dateIso>#<cardioId>`
  - Notificaciones: `NOTIF#<createdAtIso>#<notificationId>`
- **Additional Sort Keys (`2` adicionales -> Total SK = `3 / 5`):** `entityType` (`String`), `updatedAt` (`String`).
- **TTL:** **Desactivado**
- **Secondary Indexes (`1 / 20`):**
  1. `GSI_UserEntityDate` — PK: `pk` (`String`), SK: `entityDateKey` (`String`: `<ENTITY_TYPE>#<ISO_DATE>#<id>`), Proyección: `ALL`.

### Tabla 3: `AdminInvitations` (Ciclo de Vida de Invitaciones)
- **Partition Key (`pk`, String):** `INVITE#<inviteId>`
- **Sort Key Primaria:** **Omitida (`null`)** — un único ítem por partición.
- **Additional Sort Keys:** **Ninguna (`0 / 5`)**
- **Secondary Indexes (`1 / 20`):**
  1. `GSI_InviteEmailStatus` — PK: `emailNormalized` (`String`), SK: `status` (`String`), Proyección: `ALL`.
- **TTL:** **`ttlEpochSec` (`Number`, Unix epoch en segundos)**.
  - Regla de autorización: la expiración real se comprueba siempre en backend mediante `expiresAtEpochSec > nowSec`; `ttlEpochSec` (`expiresAtEpochSec + 86400`) se usa exclusivamente para purga asíncrona.

### Tabla 4: `AuditLogs` (Trazabilidad Administrativa Inmutable *Append-Only*)
- **Partition Key (`pk`, String):** `AUDIT#<YYYY-MM>` (partición mensual compartida)
- **Sort Key Primaria (`sk`, String):** `<invertedEpochMs>#<eventId>` (orden descendente nativo)
- **Additional Sort Keys (`2` adicionales -> Total SK = `3 / 5`):** `action` (`String`), `timestamp` (`String`).
- **Secondary Indexes (`3 / 20`):**
  1. `GSI_AuditActor` — PK: `actorUid` (`String`), SK: `timestamp` (`String`), Proyección: `ALL`.
  2. `GSI_AuditTarget` — PK: `targetUid` (`String`), SK: `timestamp` (`String`), Proyección: `ALL`.
  3. `GSI_GlobalChronology` — PK: `auditPeriodBucket` (`String`: `AUDIT_Q#<YYYY>-Q<1..4>`), SK: `globalChronologyKey` (`String`: `<ISO_TIMESTAMP>#<eventId>`), Proyección: `ALL`.
- **TTL:** **Desactivado** (retención inmutable).

### Tabla 5: `SystemControl` (Bootstrap Único, Contador Superadmin, Sagas y Registro Individual de Sesiones)
- **Partition Key (`pk`, String):**
  - `CTRL#BOOTSTRAP` (registro de bootstrap único offline)
  - `CTRL#SUPERADMIN_COUNT` (contador atómico de superadmins activos)
  - `CTRL#SAGA#<idempotencyKey>` (estado de idempotencia/recuperación de sagas administrativas)
  - `SESSION#<sid>` (registro individual de sesión para `/logout`, `/refresh` y revocación selectiva)
- **Sort Key Primaria:** **Omitida (`null`)** — un único ítem por partición.
- **Additional Sort Keys:** **Ninguna (`0 / 5`)**
- **Secondary Indexes:** **`0 / 20`** (acceso exclusivamente `O(1)` por PK exacto con `consistent_read: true`).
- **TTL DEFINITIVO DE `SystemControl`:** Único atributo TTL de la tabla: **`ttlEpochSec` (`Number`, Unix epoch en segundos)**.
  - **SÍ utilizado en:** `CTRL#SAGA#*` (ej. retención 7 días) y `SESSION#<sid>` (`expiresAtEpochSec + 86400`).
  - **PROHIBIDO asignar en:** `CTRL#BOOTSTRAP` y `CTRL#SUPERADMIN_COUNT` (jamás deben expirar ni purgarse).
  - **Regla obligatoria de seguridad:** La autorización y expiración de `SESSION#<sid>` se verifica en el backend mediante **`expiresAtEpochSec > nowSec`** (además de `status === 'active'` y ausencia de `revokedAt`), **nunca** delegando la validez de sesión a la limpieza asíncrona TTL de Catalyst.
