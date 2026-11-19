# VIGORCORE — FASE 4.0.1: INFORME DE AUDITORÍA ADVERSARIAL DE CONCURRENCIA, RBAC Y ESQUEMA CATALYST NOSQL

**Fecha:** 13 de noviembre de 2026  
**Dictamen:** **`CLEAN_SLATE_SECURITY_AND_SCHEMA_AUDIT — PENDING OPERATOR APPROVAL`**  
**Estado de Infraestructura:** 0 tablas creadas, 0 usuarios creados, 0 despliegues, producción Firebase y sitio Slate intactos.

---

## 1. RESUMEN EJECUTIVO DE AUDITORÍA (HALLAZGOS CRÍTICOS CONTRA LA FASE 4.0)

La auditoría adversarial de la propuesta inicial de Fase 4.0 expuso **seis bloqueadores arquitectónicos y de seguridad** que hacían inseguro autorizar la creación inmediata de tablas e índices sin corrección previa:

1. **BLOQUEADOR 1 (Fallo real de SDK en Bootstrap):** `adminGovernanceService.ts` y `cleanSlateEngine.ts` simularon semántica de DynamoDB asumiendo que `insertItems` con `attribute_not_exists(pk)` falla atómicamente si no existe el registro. **La documentación oficial de Zoho Catalyst NoSQL establece lo contrario:** *"If there is no existing data, the conditions are ignored and the items are inserted."* Dos peticiones concurrentes de bootstrap sobre una tabla vacía pueden sobrescribirse.
2. **BLOQUEADOR 2 (Condición de carrera sin transacción en Último Superadmin):** `Users` y `SystemControl` son tablas separadas sin transacciones ACID multi-documento en Catalyst NoSQL. Si la función cae o excede los **30 segundos** entre ambos writes, o si llegan dos degradaciones/eliminaciones simultáneas, se produce **desfase permanente del contador (`counter drift`)** y riesgo de dejar 0 superadmins o bloquear legítimos.
3. **BLOQUEADOR 3 (Campo ficticio `auth_time_sec` y auto-alta silenciosa):** La Fase 4.0 inventó `auth_time_sec` en `CatalystSessionUser` (que NO existe en `getCurrentUser()` de `@zcatalyst/auth`), anulando silenciosamente la revocación por `validAfterSec`. Además, hacía auto-registro silencioso si faltaba `Users` en cualquier endpoint.
4. **BLOQUEADOR 4 (Sort Keys redundantes y hueco en cronología multimensual de `AuditLogs`):** Las tablas `Users`, `AdminInvitations` y `SystemControl` tenían sort keys fijas innecesarias (`PROFILE`, `METADATA`, `SINGLETON`) pese a almacenar 1 ítem por partición. Asimismo, `AuditLogs` con `pk = AUDIT#YYYY-MM` no resolvía una cronología global entre meses distintos.
5. **BLOQUEADOR 5 (`GSI_Email` tratado implícitamente como unicidad):** Un índice secundario en Catalyst NoSQL **no** es una restricción `UNIQUE`. La unicidad real por correo recae en **Catalyst Authentication (IdP)**, nunca en el GSI.
6. **BLOQUEADOR 6 (Límites de SDK y Advanced I/O de 30s):** El timeout duro de **30 segundos** (no configurable), lecturas máximas de **100 ítems** por query y lotes de **25 ítems** exigen paginación por cursor (`startKey`) en hidratación de workspace y directorios.

---

## 2. GARANTÍAS DEMOSTRADAS VS SUPUESTOS (ENTREGABLE 5)

| Aspecto | ¿Demostrado localmente (`UNIT`/`MOCK`/`STATIC`)? | Lo que NO demuestra un Mock (Requiere `PASS-INTEGRATION` en vivo) |
| :--- | :--- | :--- |
| Validadores de dominio y anti-IDOR en servidor | **SÍ (`PASS-UNIT`/`MOCK`)** | N/A (lógica pura en aplicación) |
| Límite de `400 KB`, chunking `<= 25` y paginación `<= 100` | **SÍ (`PASS-UNIT`/`MOCK`)** | Latencia real y tamaño exacto de cabeceras de serialización de Catalyst NoSQL |
| Rechazo por falta de `Users`, `is_confirmed === false`, `status !== ACTIVE` | **SÍ (`PASS-MOCK`)** | Formato exacto de respuesta HTTP ante cookie expirada en `zcAuth.init(req)` |
| Detección de *counter drift*, recuperación de saga idempotente y bloqueo por defecto | **SÍ (`PASS-MOCK`)** | **Atomicidad real distribuida de `updateItems` condicional (`condition` + `return`) en el clúster remoto de Catalyst NoSQL bajo contención concurrente** |
| Unicidad de correo en registro Catalyst Auth | **NO (supuesto documentado de Catalyst Auth)** | Comportamiento real de Catalyst Auth al mezclar proveedor Google OAuth y Email/Password |

**Regla estricta:** Mientras no exista verificación `PASS-INTEGRATION` contra el servicio real de Catalyst NoSQL, **ninguna** operación automática crítica (bootstrap público ni degradación/eliminación automática de superadmins) puede depender de supuesta atomicidad remota no verificada.

---

## 3. DISEÑO SEGURO DEL BOOTSTRAP ADMINISTRATIVO (ENTREGABLE 6 — BLOQUEADOR 1)

- **Eliminación de garantía ficticia:** `CleanSlateInMemoryNoSQLAdapter.insertItem()` ya modela fielmente que `insertItems` ignora condiciones cuando no hay datos previos (`conditionIgnoredBecauseAbsent: true`).
- **Eliminación del endpoint público:** `POST /api/v1/admin/bootstrap-superadmin` ha sido **eliminado** del catálogo HTTP público (`apiRouterSchema.ts`).
- **Procedimiento Administrativo Seguro (Fuera de Endpoints Públicos):**
  1. Antes de habilitar tráfico público, el operador crea su cuenta en Catalyst Authentication y confirma su correo (`is_confirmed === true`).
  2. El operador completa el perfil inicial mediante flujo de alta (`POST /api/v1/auth/session/bootstrap-profile` -> rol inicial `athlete`).
  3. **Inicialización Offline / Consola Controlada (`executeOfflineAdminBootstrap`):** Un operador de infraestructura ejecuta localmente con credenciales admin OAuth (o directamente en Catalyst Console Data Explorer) la verificación de que existen **0 superadministradores** (`GSI_RoleStatus`), actualiza ese único registro en `Users` a `role = 'superadmin'`, crea `CTRL#BOOTSTRAP` (`status: 'CLAIMED'`) y `CTRL#SUPERADMIN_COUNT` (`activeSuperadminCount: 1`), dejando evento inmutable en `AuditLogs`.

---

## 4. DISEÑO SEGURO DE PROTECCIÓN DEL ÚLTIMO SUPERADMINISTRADOR (ENTREGABLE 7 — BLOQUEADOR 2)

Ante la ausencia de transacciones ACID entre `Users` y `SystemControl` y la falta de prueba de contención en vivo:
1. **Deshabilitación por defecto en API automática:** `AdminGovernanceService` arranca con `liveAtomicityVerifiedForSuperadminMutations: false`. Cualquier intento de degradar, suspender o eliminar un `superadmin` desde endpoints web devuelve **`403 SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED`**. Los cambios de superadministradores solo los realiza el propietario desde CLI/Consola durante esta etapa.
2. **Sagas idempotentes + Reconciliación para futuras fases:** Cuando se habilite tras `PASS-INTEGRATION`, toda mutación de rol exige `idempotencyKey` + `payloadHash` en `CTRL#SAGA#<idempotencyKey>`:
   - Si una función cae tras actualizar `Users` (o tras timeout de 30s o pérdida de respuesta), el reintento con la misma `idempotencyKey` **recupera la saga hacia adelante** sincronizando `CTRL#SUPERADMIN_COUNT` sin volver a mutar `Users`.
   - Antes de cualquier cambio superadmin, `assertNoSuperadminCounterDrift()` compara `CTRL#SUPERADMIN_COUNT` contra la lectura real de `Users` (`GSI_RoleStatus`, `role='superadmin'`, `accountStatus='active'`). Si hay discrepancia, falla cerrado con `409 SUPERADMIN_COUNTER_DRIFT_DETECTED`.

---

## 5. CONFIRMACIÓN, REVOCACIÓN Y UNICIDAD DE IDENTIDAD (BLOQUEADORES 3 Y 5)

- **Campos reales `@zcatalyst/auth` (`UserManagement.getCurrentUser()`):** Únicamente `user_id`, `zuid`, `org_id`, `status` (`ACTIVE`/`DISABLED`/`NOT_CONFIRMED`), `is_confirmed`, `email_id`, `first_name`, `last_name`, `created_time`, `modified_time`, `role_details`. Eliminado `auth_time_sec`.
- **Contexto por petición:** Siempre `const app = zcAuth.init(req); const user = await app.userManagement().getCurrentUser();`. Nunca se acepta `userId`/`uid`/`role` del cliente.
- **Denegación por defecto:** Si `fetchItem('Users', { pk: 'USER#' + user.user_id }, { consistentRead: true })` retorna `null`, **todos** los endpoints protegidos devuelven **`403 USER_PROFILE_NOT_REGISTERED`**. Únicamente `POST /api/v1/auth/session/bootstrap-profile` puede crear el registro con `role = 'athlete'`.
- **Revocación Inmediata Real:** Al suspender una cuenta se ejecutan dos acciones complementarias:
  1. `app.userManagement().updateUserStatus(targetUid, USER_STATUS.DISABLE)` en Catalyst Auth.
  2. Actualización fuerte en `Users` de `accountStatus = 'suspended'` e incremento de `sessionEpoch` (verificado en **cada** petición HTTP vía `consistentRead: true`).
- **Unicidad de Identidad (`GSI_Email`):** Catalyst Auth es la autoridad única que impide duplicados nativos de correo. `GSI_Email` en NoSQL es **no único**; si `queryIndex('GSI_Email')` detecta un correo en un `user_id` distinto durante el registro, aborta con `409 DUPLICATE_EMAIL_ANOMALY`.

---

## 6. MODELO FÍSICO DEFINITIVO DE LAS 5 TABLAS (ENTREGABLE 4 — BLOQUEADOR 4)

*(Ver especificaciones completas de consola en `docs/07-manual-catalyst-tables-runbook.md`)*

### Tabla 1: `Users` (Sin Sort Key redundante — 1 ítem por partición)
- **PK:** `pk` (String, `USER#<catalystUserId>`) | **SK:** *Ninguna* | **Additional SK:** 0 | **TTL:** No
- **GSIs (3/20, `isUniqueConstraint: false`):**
  1. `GSI_Email`: PK `normalizedEmail` (String) — Proyección: `All Attributes`.
  2. `GSI_Directory`: PK `directoryScope` (String = `'USER'`), SK `createdAt` (String) — Proyección: `Specific Attributes` (`pk, uid, email, displayName, role, roleVersion, accountStatus, emailVerified, createdAt, lastSignInAt`).
  3. `GSI_RoleStatus`: PK `role` (String), SK `accountStatus` (String) — Proyección: `All Attributes`.
- **Consultas eficientes / no eficientes:** Eficiente: lookup por `user_id`, búsqueda exacta de correo, directorio paginado por fecha o rol/estado. **No eficiente:** búsqueda por subcadena de nombre (`contains` sin clave), mitigada filtrando sobre página `<= 100` ítems.
- **Hot partition / tamaño:** `GSI_Directory` usa PK constante `'USER'`; seguro para miles de usuarios (baja tasa de escritura); ítems `< 4 KB`.

### Tabla 2: `UserData` (Cubre las 11 áreas funcionales del frontend)
- **PK:** `pk` (String, `USER#<catalystUserId>`) | **SK:** `sk` (String) | **Additional SK (2, total 3/5):** `entityType` (String), `updatedAt` (String) | **TTL:** No
- **GSIs (1/20):** `GSI_UserEntityDate` (PK `pk` String, SK `entityDateKey` String, Proyección `All Attributes`).
- **Cobertura exacta de las 11 áreas en `sk`:**
  1. `biometrics` -> `BIO#current`
  2. `preferences` -> `PREF#settings`
  3. `groceries` -> `GROCERY#<id>`
  4. `mealLogs` -> `MEAL#<dateTimeIso>#<id>`
  5. `workoutSessions` -> `SET#<executedWorkoutId>#<id>`
  6. `cardioSessions` -> `CARDIO#<dateIso>#<id>`
  7. `notifications` -> `NOTIF#<createdAtIso>#<id>`
  8. `recipes` -> `RECIPE#<id>`
  9. `mealPlans` -> `PLAN#<weekStartIso>`
  10. `workoutRoutines` -> `ROUTINE#<id>`
  11. `executedWorkouts` -> `WORKOUT#<startedAtIso>#<id>`
- **Riesgo tamaño 400 KB:** Mesociclos extensos (`workoutRoutines`) y menús semanales (`mealPlans`) limitados a **350 KB** en servidor (`HTTP 413`).
- **Consultas no eficientes:** Búsqueda global de texto libre entre múltiples entidades; se resuelve en memoria sobre el snapshot hidratado en el cliente.

### Tabla 3: `AdminInvitations` (Sin Sort Key redundante)
- **PK:** `pk` (String, `INVITE#<inviteId>`) | **SK:** *Ninguna* | **Additional SK:** 0 | **TTL:** `ttlEpochSec` (Number)
- **GSI (1/20):** `GSI_InviteEmailStatus` (PK `emailNormalized` String, SK `status` String, Proyección `All Attributes`).
- **Nota TTL:** Como la purga TTL corre periódicamente (~24h), `redeemInvitation` verifica siempre `expiresAtEpochSec <= nowSec` en servidor antes de aceptar canjes.

### Tabla 4: `AuditLogs` (Partición mensual + Cronología global entre meses)
- **PK:** `pk` (String, `AUDIT#<YYYY-MM>`) | **SK:** `sk` (String, `<invertedEpochMs>#<eventId>`) | **Additional SK (2, total 3/5):** `action` (String), `timestamp` (String) | **TTL:** No
- **GSIs (3/20, Proyección `All Attributes`):**
  1. `GSI_AuditActor`: PK `actorUid` (String), SK `timestamp` (String).
  2. `GSI_AuditTarget`: PK `targetUid` (String), SK `timestamp` (String).
  3. **`GSI_GlobalChronology`**: PK `auditScope` (String = `'AUDIT_GLOBAL'`), SK `globalChronologyKey` (String = `<ISO_TIMESTAMP>#<eventId>`). Permite consultar y paginar con `start_key` una cronología global continua entre `AUDIT#2026-10`, `AUDIT#2026-11`, `AUDIT#2026-12`, etc.
- **Riesgo de partición caliente:** `GSI_GlobalChronology` concentra escrituras admin en `'AUDIT_GLOBAL'`; aceptable porque solo registra acciones administrativas/seguridad (no telemetría de atletas).

### Tabla 5: `SystemControl` (Sin Sort Key redundante)
- **PK:** `pk` (String, `CTRL#BOOTSTRAP | CTRL#SUPERADMIN_COUNT | CTRL#SAGA#<idempotencyKey>`) | **SK:** *Ninguna* | **Additional SK:** 0 | **GSIs:** 0 | **TTL:** `ttlEpochSec` (Number — asignado únicamente a ítems `CTRL#SAGA#*`, jamás a `CTRL#BOOTSTRAP` ni `CTRL#SUPERADMIN_COUNT`).

---

## 7. VERIFICACIÓN SDK MODULAR `@zcatalyst/*` Y MATRIZ DE 22 ENDPOINTS (ENTREGABLE 8 — BLOQUEADOR 6)

- **SDK Autorizado:** `@zcatalyst/auth` (`zcAuth.init(req)`, `app.userManagement().getCurrentUser()`, `updateUserStatus()`) y `@zcatalyst/nosql` (`NoSQL.getInstance()` / `new NoSQL()`, `table.fetchItem()`, `table.insertItems()`, `table.updateItems()`, `table.deleteItems()`, `table.queryTable()`, `table.queryIndex()`). Prohibido `zcatalyst-sdk-node` heredado.
- **Control estricto del Timeout de 30s de Advanced I/O:** Lecturas limitadas a páginas de `<= 100` ítems (`startKey`) y escrituras masivas fragmentadas en bloques de `<= 25` ítems.
- **Matriz definitiva (22 rutas en `src/routes/apiRouterSchema.ts`):** Cubre Auth explícito (`POST /api/v1/auth/session/bootstrap-profile`, `GET /api/v1/auth/me`), Perfil (`PATCH /api/v1/athlete/profile`), Nutrición (`POST/GET /meals`, `PUT /groceries/sync`, `PUT /recipes/:id`, `PUT /meal-plans/:week`), Entrenamiento (`POST /workouts/start`, `POST /workouts/:id/sets`, `POST /workouts/:id/complete`, `PUT /routines/:id`, `POST /cardio`), Notificaciones (`POST /notifications`), Invitaciones (`POST /invitations/redeem`, `POST /admin/invitations`), Administración (`GET /admin/users`, `POST /admin/users/:uid/status`, `POST /admin/users/:uid/role` bloqueado hasta `PASS-INTEGRATION`) y Auditoría (`GET /admin/audit-logs`). **Bootstrap público eliminado.**
