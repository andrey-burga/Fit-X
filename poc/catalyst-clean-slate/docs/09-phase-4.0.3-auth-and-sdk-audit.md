# VIGORCORE — FASE 4.0.3: AUDITORÍA Y HARDENING DE AUTENTICACIÓN, SESIONES Y CONTRATOS SDK MODULARES

**Estado:** **`CLEAN_SLATE_AUTH_AND_SDK_CONTRACTS_VERIFIED — PENDING LIVE INTEGRATION`**  
**Directorio:** `poc/catalyst-clean-slate/`  
**Recursos remotos creados en Catalyst / Slate / Firebase:** **0 (CERO)**.

---

## ENTREGABLE 1 — AUDITORÍA EXHAUSTIVA DE CABECERAS DE SESIÓN Y DISEÑO DE REVOCACIÓN HONESTA

### 1.1 Hallazgo crítico en `src/auth/cleanSlateAuthGuard.ts` (pre-4.0.3)
En la versión de Fase 4.0.2, `CleanSlateAuthGuard.authenticate()` leía `x-vigor-session-epoch` (`readOptionalNumericHeader`) y `req.clientSessionEpoch`, así como `x-vigor-role-version` y `req.clientRoleVersion`, comparándolos contra `Users.sessionEpoch` y `Users.roleVersion`.
- **Riesgo demostrado:** Ambos valores provenían de cabeceras HTTP o propiedades de petición **libremente manipulables por el cliente/navegador**. Un cliente malicioso con una sesión antigua válida podía enviar `x-vigor-session-epoch: 999999` o `x-vigor-role-version: 999999` para eludir la comprobación de época/versión de cabecera.

### 1.2 Remediación implementada (Cero confianza en cabeceras del cliente)
1. **Eliminación total** de `readOptionalNumericHeader`, `req.clientSessionEpoch`, `req.clientRoleVersion`, y de toda confianza en `x-vigor-session-epoch` y `x-vigor-role-version`.
2. **Rechazo explícito Anti-Spoofing (`403 IDENTITY_SPOOFING_REJECTED`):** Si un cliente envía `x-vigor-session-epoch`, `x-vigor-role-version`, `clientSessionEpoch`, `clientRoleVersion`, `role`, `roleVersion`, `sessionEpoch`, `accountStatus`, `uid` o `userId` en cabeceras, query o body, el guard rechaza la petición inmediatamente.
3. **Separación estricta entre revocación de privilegios y revocación de sesión:**
   - **A. Revocación inmediata de privilegios:** Cada petición protegida resuelve `user_id` exclusivamente desde `@zcatalyst/auth` (`ICatalystUser` real), ejecuta `fetchItem('Users', { pk }, { consistent_read: true })`, verifica `status === 'ACTIVE'`, `is_confirmed === true`, y `Users.accountStatus === 'active'`, y toma `role` **exclusivamente desde `Users`**. Un cambio de rol en `Users` degrada al usuario en la siguiente petición sin depender de ninguna cabecera ni recarga de token.
   - **B. Revocación individual de sesión (`ServerSessionTokenManager` HMAC-SHA256):** Tras autenticar por Catalyst Auth (`POST /api/v1/auth/session/bootstrap-profile` o `POST /api/v1/auth/session/exchange`), el backend emite una cookie `HttpOnly; Secure; SameSite=Strict; Path=/` (`__Host-vigor_session`) firmada con secreto exclusivo del servidor (`HMAC-SHA256`, verificación constante `crypto.timingSafeEqual`) sobre `{ sub: user_id, ep: Users.sessionEpoch, sid, iat, exp }`.
     - Token alterado/forjado/sujeto distinto/expirado -> `401 INVALID_SIGNED_SESSION`.
     - Cookie legítima emitida anteriormente cuyo `ep < Users.sessionEpoch` (tras suspensión/cambio de rol) -> `401 SESSION_REVOKED_REAUTH_REQUIRED`.
     - Petición a ruta protegida (`/api/v1/athlete/*`, `/api/v1/invitations/*`, `/api/v1/admin/*`) sin `__Host-vigor_session` -> `401 SIGNED_SESSION_REQUIRED`.
4. **Limitación documentada de Catalyst Auth nativo:** Los mocks locales NO prueban el ciclo de vida ni revocación individual de las cookies nativas internas gestionadas por Zoho Catalyst IAM cuando el usuario permanece `ACTIVE`. Por ello:
   - La suspensión total de cuenta invoca `USER_STATUS.DISABLE` real de `@zcatalyst/auth` (lo que hace fallar `status === 'ACTIVE'` en `getCurrentUser()`).
   - La invalidación por sesión individual en la capa de aplicación se apoya en `__Host-vigor_session` firmada por servidor + `Users.sessionEpoch` con `consistent_read: true`, y queda pendiente de verificación en vivo (`INT-04`).

---

## ENTREGABLE 2 & 3 — ADAPTADOR MODULAR REAL `@zcatalyst/nosql@1.0.0` Y CONTRATO `updateItems()`

Inspección directa de `node_modules/@zcatalyst/nosql@1.0.0` (`dist-types/*` y `dist-es/*`) e implementación en `src/nosql/catalystModularAdapter.ts` y `src/nosql/cleanSlateEngine.ts`:

| Elemento | Diseño Previo (Fase 4.0.2) | Contrato Real `@zcatalyst/nosql@1.0.0` (Fase 4.0.3) | Archivo Corregido |
| :--- | :--- | :--- | :--- |
| Incremento / decremento | `operation_type: 'ADD'`, `update_value: delta` (**inválido**) | `operation_type: NoSQLUpdateOperationType.PUT` + `update_function: { function_name: delta > 0 ? 'add' : 'subtract', args: [{ attribute_path: [k] }, NoSQLMarshall.makeNumber(Math.abs(delta))] }` | `src/nosql/catalystModularAdapter.ts` |
| Claves en `INoSQLUpdateItem` | Array `keys: [key]` (**inválido**) | Único `keys: NoSQLItem` (`INoSQLUpdateItem.keys`) | `src/nosql/catalystModularAdapter.ts` |
| Valores en `PUT` | Sin marshalling (`update_value: raw`) | `update_value: NoSQLMarshall.make(...)` (`TNoSQLAttribute`) | `src/nosql/catalystModularAdapter.ts` |
| Operadores en `INoSQLCondition` | Mayúsculas (`'EQUALS'`, `attribute_path`) | `attribute: [attr]`, `operator: NoSQLEnum.NoSQLOperator` en minúsculas (`'equals'`, `'greater_than'`, etc.), `value: NoSQLMarshall.make(...)` | `src/nosql/catalystModularAdapter.ts` |
| No existencia de atributo | `function_name: 'attribute_not_exists'` (**inválido**) | `function: { function_name: 'attribute_exists', args: [{ attribute_path: [attr] }] }, negate: true` | `src/nosql/catalystModularAdapter.ts` |
| Respuesta de `updateItems` | Objeto mock `{ data: { update } }` | Instancia real `NoSQLResponse` creada por `NoSQLTable.updateItems()` (`response.update[0].status`: `'Success' | 'ConditionMismatch' | 'CriteriaMismatch'`) | `src/nosql/cleanSlateEngine.ts` |
| Estado usuario Auth | Literales `'ENABLE' | 'DISABLE'` | Enum real `USER_STATUS.ENABLE` (`'enable'`) / `USER_STATUS.DISABLE` (`'disable'`) de `@zcatalyst/auth` | `src/auth/cleanSlateAuthGuard.ts`, `src/services/adminGovernanceService.ts` |

---

## ENTREGABLE 4 — CONTRATO REAL DE `consistent_read` Y RECUPERACIÓN DE CONTADOR

- Verificado en `@zcatalyst/nosql/dist-types/utils/types.d.ts`:
  - `INoSQLFetchItem.consistent_read?: boolean` (`fetchItem`)
  - `INoSQLQuery.consistent_read?: boolean` (`queryTable`, `queryIndex`)
- **Nombres unificados en todo el código:** Se eliminó por completo `consistentRead` camelCase en favor de `consistent_read: true` en `src/nosql/`, `src/auth/`, `src/services/` y `tests/`.
- **Reglas del contador `CTRL#SUPERADMIN_COUNT` mantenidas:**
  - Mutaciones automáticas sobre `superadmin` **deshabilitadas por defecto** (`liveAtomicityVerifiedForSuperadminMutations: false`).
  - Actualización condicional de un único ítem inspeccionando `NoSQLResponse.update[0].status === 'Success'`.
  - Tras timeout (`CatalystTimeoutError`), ejecución obligatoria de `consistent_read: true` antes de cualquier reintento.
  - Verificación de deriva (`SUPERADMIN_COUNTER_DRIFT_DETECTED`), guarda estricta `activeSuperadminCount >= 0` (`SUPERADMIN_COUNTER_NEGATIVE_OR_CORRUPT`), e idempotencia (`idempotencyKey` + `payloadHash`).

---

## ENTREGABLE 5 — RESUMEN DEL BOOTSTRAP OFFLINE

Documentado íntegramente (10 puntos + advertencia de que NO es exclusión mutua distribuida automática) en `docs/07-manual-catalyst-tables-runbook.md`. Sin endpoint HTTP público ni ejecución remota.

---

## ENTREGABLE 7 — HASHES SHA-256 Y VERIFICACIÓN EJECUTADA EN FASE 4.0.3

- `npx tsc -p poc/catalyst-clean-slate/tsconfig.json --noEmit` resolviendo los `.d.ts` reales de `@zcatalyst/nosql@1.0.0` y `@zcatalyst/auth@1.0.0`: **PASS (0 errores)**.
- Suite local completa (`tests/01-*.test.ts` .. `tests/05-*.test.ts`): **28/28 PASS** (`PASS-UNIT` / `PASS-MOCK` / `PASS-STATIC`).
- Suite viva (`tests/06-integration-catalyst-live.spec.ts` `INT-01..INT-05`): **`PENDING (PASS-INTEGRATION)`**.

| Artefacto (`poc/catalyst-clean-slate/...`) | SHA-256 |
| :--- | :--- |
| `src/auth/cleanSlateAuthGuard.ts` | `bc93fc74222a108ddbe5ee51a733f07405fa01508c992f421eec25e5ed80067a` |
| `src/nosql/catalystModularAdapter.ts` | `e35427bee470a59e24736e88889f5f95bcdd81defac9c69e36c0679d50b6f220` |
| `src/nosql/cleanSlateEngine.ts` | `4631050fefc926c97fd48e6215729000f5756159d593e9c6ef263eeea2275a5b` |
| `src/routes/apiRouterSchema.ts` | `704e741e59cfe2783dec4e60a6396abae62bc3dec79f4d0b62849d0feb03a713` |
| `src/services/adminGovernanceService.ts` | `913a0e1139d308b539ecd059dbb86fd5d8d130c116a885bab059305cbac5540a` |
| `src/services/athleteDataService.ts` | `185f5eaa9e0c8cb1b3e03ea1ac6512018e90190aec04e2d1eb8a29a4e16193f4` |
| `src/types/cleanSlate.ts` | `2bbdf0beb65bf91dde377c35d38e612872e9c29a2e354b2c062851a2819001aa` |
| `src/validators/domainValidators.ts` | `a7763424f0b8035f697ff30aeb235a3470cb25110303e493fead7c59c0891e16` |
| `tests/01-auth-and-anti-idor.test.ts` | `eed2c5cf6828fd87220ce1f4549d2d3e48f6f2c983bdc0417a7991e0ad5144c0` |
| `tests/02-domain-validators-and-invariants.test.ts` | `b1b7dc6be03e8b92df2f665820f39a4d585773b133aecd3baf9b005bea152070` |
| `tests/03-nosql-schema-indexes-and-limits.test.ts` | `2899a61f96518a9cb27faa72c31a06e30a59746c6267c5a0482b2b5d8507c251` |
| `tests/04-admin-rbac-bootstrap-and-saga.test.ts` | `f478f70eeb3e23af7f4b7d165b5b1ec2477ad4b33ed0179aea899f49054c249a` |
| `tests/05-static-isolation-and-clean-slate.test.ts` | `245cae21e9a98b8b66f3b1ed40c8c22dceb4c1957cc422d4339cf3ba142a5f66` |
| `tests/06-integration-catalyst-live.spec.ts` | `4e408b416ff888a951c34afb1535ec9dd4b705f6080ba2104044135731f46552` |
| `docs/05-verification-and-test-report.md` | `5952e7a3787a5a6b5b542304e0c2d28cd85ed5f0cd0a7bb77db6dcbced1911f7` |
| `docs/07-manual-catalyst-tables-runbook.md` | `a333e31d7414ddee679b4d72e96dd43857d65cbbf7bdec4c0896472dd4a4572d` |

