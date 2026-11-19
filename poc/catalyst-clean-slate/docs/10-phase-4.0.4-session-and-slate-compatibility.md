# VIGORCORE — FASE 4.0.4: VALIDACIÓN DEL CICLO DE VIDA DE SESIONES, COOKIES, CSRF/CORS Y COMPATIBILIDAD CON SLATE

**Fecha de Auditoría:** 2026-11-13  
**Directorio aislado:** `poc/catalyst-clean-slate/`  
**Frontend evaluado:** `https://fit-x-bhnatsxl.onslate.com`  
**Backend destino:** Zoho Catalyst Advanced I/O Functions  
**Dictamen:** **`CLEAN_SLATE_SESSION_AND_BROWSER_COMPATIBILITY_DESIGNED — PENDING LIVE INTEGRATION`**  
**Estado de Infraestructura:** **CERO** tablas, índices o usuarios creados; **CERO** despliegues o cambios en Slate, Firebase o GCP.

---

## 1. AUDITORÍA HONESTA DEL ALCANCE REAL DE `sessionEpoch` VS. REVOCACIÓN INDIVIDUAL (OBJETIVO 1)

### 1.1 Alcance exacto de `token.ep >= Users.sessionEpoch` (Auditoría de Fase 4.0.3)
En la Fase 4.0.3, `ServerSessionTokenManager` emitía el campo `sid` únicamente como identificador informativo del token firmado, sin almacenarlo ni consultarlo en servidor. En consecuencia:
- **A. Revocar TODAS las sesiones anteriores de un usuario (`GLOBAL`):** **SÍ.** Al incrementar `Users.sessionEpoch` (+1), cualquier cookie previamente emitida (`claims.ep < Users.sessionEpoch`) queda invalidada inmediatamente en la siguiente petición mediante lectura consistente (`consistent_read: true`).
- **B. Revocar UNA sesión individual identificada por `sid` (`INDIVIDUAL`):** **NO (solo con `sessionEpoch`).** Incrementar `Users.sessionEpoch` invalida indistintamente **todas** las sesiones activas de ese usuario en todos sus dispositivos. **No es posible** cerrar sesión de un dispositivo o hacer logout selectivo comparando únicamente `token.ep >= Users.sessionEpoch`.

### 1.2 Solución Diseñada e Implementada: Modelo Híbrido sin 6.ª Tabla (`SystemControl` `SESSION#<sid>`)
Para habilitar logout real y revocación selectiva sin romper el congelamiento físico de 5 tablas ni agregar GSIs adicionales:
- Se reutiliza la tabla **`SystemControl`** (`pk: String`, `sortKey: null`, TTL `ttlEpochSec`, `0` GSIs) almacenando registros **`SESSION#<sid>`** (`SessionRecordItem`):
  - `pk`: `SESSION#<sid>`
  - `sid`, `ownerUserId`, `sessionEpoch`, `issuedAt`, `issuedAtEpochSec`, `expiresAt`, `expiresAtEpochSec`, `revokedAt?`, `revocationReason?`, `status: 'active' | 'revoked'`, `ttlEpochSec`.
- **Lectura consistente obligatoria:** `CleanSlateAuthGuard.authenticate()` ejecuta `fetchItem('SystemControl', { pk: KeyBuilders.sessionPk(claims.sid) }, { consistent_read: true })` cuando existe cookie firmada.
- **Independencia del TTL:** El atributo `ttlEpochSec` (`expiresAtEpochSec + 86400`) se usa **únicamente para recolección de basura asíncrona** en Catalyst NoSQL; toda petición valida explícitamente `sessionRec.expiresAtEpochSec > nowSec` y `sessionRec.status === 'active'`.

### 1.3 Evaluación Técnica: Latencia, Costo, Paginación y Límites de Tabla
1. **Latencia:** Agrega 1 lectura puntual `O(1)` por clave primaria (`fetchItem` con `consistent_read: true` sobre `SystemControl`) en paralelo lógico/secuencial tras validar `Users`. Estimación en memoria: despreciable (`< 1 ms` en harness); latencia real sobre red Catalyst permanece **`PENDING (PASS-INTEGRATION)`** (`INT-08`).
2. **Costo de Operaciones:** +1 write (`insertItem`) por emisión de cookie (`/bootstrap-profile`, `/exchange`, `/refresh`), +1 `updateItem` condicional en `/logout` o `/revoke`, +1 `fetchItem` (`consistent_read: true`) por request autenticada.
3. **Paginación y Límites:** Al ser registros puntuales `PK = SESSION#<sid>` con `ttlEpochSec`, no generan *hot partitions* ni requieren escaneos/paginación en ruta caliente. No consumen *Additional Sort Keys* ni *GSIs* (0/20 GSIs usados en `SystemControl`).
4. **Limpieza:** TTL purga sesiones vencidas de forma asíncrona sin afectar seguridad.

### 1.4 Recomendación Arquitectónica Razonada
Se adopta el **Modelo Híbrido** implementado en `CleanSlateAuthGuard`:
- **`Users.sessionEpoch`:** Para revocación global inmediata en suspensión de cuenta, cambio de rol o "cerrar sesión en todos los dispositivos".
- **`SystemControl` `SESSION#<sid>`:** Para `/api/v1/auth/session/logout`, rotación en `/refresh` (revoca `sid` anterior condicionalmente) y `/revoke` selectivo por dispositivo.

---

## 2. COMPATIBILIDAD REAL DE COOKIES EN NAVEGADORES Y SLATE (OBJETIVO 2)

### 2.1 Comparación de Orígenes y Sitios
- **Origen Frontend:** `https://fit-x-bhnatsxl.onslate.com` (esquema `https`, dominio registrable eTLD+1: `onslate.com`).
- **Origen Backend Destino:** **PENDIENTE DE DEFINIR EN DESPLIEGUE (`PENDING_BACKEND_ORIGIN`).** No se inventa ni asume ningún subdominio hasta configurar el proyecto/proxy real de Catalyst Advanced I/O.

### 2.2 Matriz de Comportamiento por Topología (`evaluateBrowserCookieCompatibility`)

| Topología Posible | Relación Navegador | Envío automático de `__Host-vigor_session` (`SameSite=Strict`) | `fetch(..., { credentials: 'include' })` + CORS | Veredicto |
| :--- | :---: | :--- | :--- | :--- |
| Proxy reverso / BFF bajo `https://fit-x-bhnatsxl.onslate.com/api/*` | **`same-origin`** | **SÍ.** Navegador envía cookies `SameSite=Strict` en toda petición. | CORS no aplica (o trivial *same-origin*). | **Recomendada (Opción A)** |
| Dominio personalizado compartido (ej. `app.tudominio.com` + `api.tudominio.com`) | **`same-site`** | **SÍ** en peticiones subrecurso XHR/`fetch` con `credentials: 'include'` (verificar Safari ITP/Chromium en vivo). | Requiere `Access-Control-Allow-Origin` exacto + `Access-Control-Allow-Credentials: true`. | **Válida con dominio propio (Opción B)** |
| Frontend `*.onslate.com` llamando directo a `*.catalystserverless.*` | **`cross-site`** | **NO.** Navegadores bloquean cookies `SameSite=Strict` en `fetch()` *cross-site* aunque exista `credentials: 'include'`. | Falla silenciosamente envío de cookie de sesión en el navegador. | **INCOMPATIBLE** |

### 2.3 Reglas de `__Host-vigor_session` y Cabeceras Requeridas
- Prefijo `__Host-` exige obligatoriamente: `Secure`, `Path=/`, **ausencia total de `Domain=`**, y transmisión exclusiva por HTTPS. Se añade `HttpOnly` (inaccesible a `document.cookie` / XSS) y `SameSite=Strict`.
- **Prohibición cumplida:** NO se degrada automáticamente `SameSite=Strict` a `SameSite=None` bajo ninguna circunstancia.
- **Estado de compatibilidad en navegador y Slate:** Declarado explícitamente **`PENDING (PASS-INTEGRATION)`** hasta ejecutar las pruebas reales `INT-06` e `INT-07` en Chromium y Safari/WebKit desde `https://fit-x-bhnatsxl.onslate.com`.

---

## 3. PROTECCIÓN CSRF, ORIGIN ALLOWLIST Y POLÍTICA CORS ESTRICTA (OBJETIVO 3)

Implementada en `src/security/httpSecurityPolicy.ts` e integrada en todas las rutas de `CleanSlateApiDispatcher.dispatch()`:
1. **Allowlist explícita de `Origin`:** `['https://fit-x-bhnatsxl.onslate.com']` por defecto. Rechaza con `403 CORS_ORIGIN_REJECTED` cualquier otro origen y prohíbe configurar `'*'` cuando se usan credenciales (`INVALID_CORS_CONFIG`).
2. **Cabeceras CORS estrictas:** Emite `Access-Control-Allow-Origin: <origen_exacto_permitido>`, `Access-Control-Allow-Credentials: true`, `Vary: Origin`.
3. **Validación CSRF en TODOS los métodos que cambian estado (`POST`, `PUT`, `PATCH`, `DELETE`):**
   - Protege explícitamente `/api/v1/auth/session/bootstrap-profile`, `/exchange`, `/refresh`, `/logout`, `/revoke`, `/athlete/*`, `/invitations/redeem` y `/admin/*`.
   - Exige `Origin` (o fallback `Referer`) presente y perteneciente a la allowlist (`403 CSRF_ORIGIN_REQUIRED` / `403 CSRF_ORIGIN_REJECTED`).
   - Evalúa Fetch Metadata: si `Sec-Fetch-Site` está presente y es `'cross-site'` (o valor distinto a `same-origin` / `same-site` / `none`), rechaza inmediatamente con `403 CSRF_CROSS_SITE_REJECTED`.
4. **Qué cubre `SameSite=Strict` y qué NO cubre:**
   - **Cubre:** Evita que sitios externos disparen envío de `__Host-vigor_session` en formularios, `<img>` o navegaciones *cross-site*.
   - **NO cubre:** Peticiones maliciosas *same-site* desde otros subdominios bajo un dominio multi-inquilino compartido (ej. otros subdominios `*.onslate.com` de terceros si compartieran dominio registrable), ni navegadores heredados sin soporte completo de `SameSite`. Por ello, la verificación obligatoria de `Origin` exacto + `Sec-Fetch-Site` + CORS sin wildcard es defensa en profundidad indispensable.

---

## 4. HARDENING CRIPTOGRÁFICO HMAC-SHA256 (OBJETIVO 4 — ACTUALIZADO EN FASE 4.0.5)

Implementado en `ServerSessionTokenManager` (`src/auth/cleanSlateAuthGuard.ts`):
- **Generación y validación de secretos:** `generateStrongSecret(32)` genera 32 bytes (256 bits) vía CSPRNG en formato Base64URL canónico (`crypto.randomBytes(32).toString('base64url')`). `decodeAndValidateHmacSecret()` valida formato Base64URL canónico, longitud **decodificada** `>= 32` bytes (rechazando cadenas de 32 caracteres que solo equivalen a 24 bytes) y entropía mínima (`>= 16` bytes distintos). Eliminado todo secreto hardcoded en código fuente.
- **Rotación controlada:** Soporta `activeKeyId` + `previousSecrets: [{ kid, secret }]`, validando unicidad de `kid` y exigiendo que el `kid` firmado coincida con la clave verificada.
- **Decodificación canónica y comparación constante:** Verifica formato base64url estricto (`/^[A-Za-z0-9_-]+$/`), longitud exacta de digest crudo de 32 bytes (`providedDigest.length === 32 && providedDigest.toString('base64url') === providedSig`) y `crypto.timingSafeEqual(providedDigest, expectedDigest)` **antes** de confiar en cualquier dato del payload JSON.
- **Claims validados:** `v === 1`, `kid`, `iss`, `aud`, `env` (separación absoluta entre `development`, `staging` y `production`), `sub === expectedUserId`, `sid` válido sin `#`, `ep >= 1`, rechazo de tokens futuros (`iat > nowSec + 60`), cota máxima de vida (`exp - iat <= maxTtlSec`), y expiración (`exp <= nowSec`).
- **Cero exposición en logs/errores:** Ni el secreto HMAC, ni la firma ni tokens crudos se incluyen en `Error.message`, cuerpos JSON de respuesta ni registros.
- *(La evaluación ampliada de alternativas de dominio A/B/C, ciclo de vida completo con recuperación ante timeout y hashes definitivos de Fase 4.0.5 constan en `docs/11-phase-4.0.5-pre-provisioning-closure.md`.)*

---

## 5. CICLO DE VIDA COMPLETO DE 12 PASOS VERIFICADO EN `tests/07` (OBJETIVO 5)

| Paso | Fase del Ciclo | Comportamiento Verificado (`CleanSlateAuthGuard` + `CleanSlateApiDispatcher`) |
| :---: | :--- | :--- |
| 1 | Registro en Catalyst Auth | Usuario sin confirmar email (`is_confirmed: false`) bloqueado con `403 EMAIL_VERIFICATION_REQUIRED`. |
| 2 | Confirmación de correo | `is_confirmed: true` y `status: 'ACTIVE'` requeridos en `ICatalystAuthRuntime.getCurrentUserFromRequest()`. |
| 3 | `bootstrap-profile` | Crea registro en `Users` (`role: 'athlete'`, `sessionEpoch: 1`), valida `GSI_Email` anti-duplicado, inserta `SESSION#<sid>`. |
| 4 | Emisión de cookie | Emite `Set-Cookie: __Host-vigor_session=...; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200` (nunca en JSON body). |
| 5 | Consulta `/api/v1/auth/me` | Verifica Catalyst + `Users` (`consistent_read: true`) + `SESSION#<sid>` (`consistent_read: true`) y expone `actor.sessionId`. |
| 6 | Renovación `/session/refresh` | Autentica cookie actual, marca condicionalmente `SESSION#<oldSid>` como `revoked`, inserta `SESSION#<newSid>` y rota `Set-Cookie`. |
| 7 | Cambio de rol | `AdminGovernanceService.setUserRole` actualiza `Users.role` + incrementa `sessionEpoch`; lectura consistente revoca privilegios de inmediato. |
| 8 | Suspensión de cuenta | `accountStatus: 'suspended'` + `USER_STATUS.DISABLE` bloquean en el siguiente request (`403 ACCOUNT_SUSPENDED` / `CATALYST_USER_DISABLED`). |
| 9 | Revocación de sesión | Soporta revocación individual (`POST /session/revoke`, `scope: 'individual'`) sin afectar otros dispositivos, y global (`scope: 'all'`, bump `sessionEpoch`). |
| 10 | Logout + anti-replay | `POST /session/logout` marca `SESSION#<sid>` como `revoked` y responde `Set-Cookie` con `Max-Age=0`; reenviar la cookie anterior falla con `401`. |
| 11 | Token expirado | Rechazado tanto por `claims.exp <= nowSec` como por `sessionRec.expiresAtEpochSec <= nowSec` independientemente del TTL. |
| 12 | Reautenticación | `POST /api/v1/auth/session/exchange` tras sesión válida en Catalyst emite nuevo `sid` y restaura acceso bajo estado actualizado en `Users`. |

---

## 6. INFORME DE LIMITACIONES PENDIENTES DE VERIFICACIÓN EN VIVO

Las siguientes garantías **NO pueden demostrarse** en entorno local/mock y permanecen explícitamente en **`PENDING (PASS-INTEGRATION)`**:
1. **Envío real de `__Host-vigor_session` (`SameSite=Strict`) desde `https://fit-x-bhnatsxl.onslate.com`** hacia el dominio final desplegado de Zoho Catalyst Advanced I/O en Chrome y Safari/WebKit (`INT-06`, `INT-07`).
2. **Interacción real con cookies propias de `zcAuth.init(req)`** dentro del entorno hospedado de Catalyst Serverless / AppSail.
3. **Latencia real p95 y atomicidad distribuida** de lectura consistente doble (`Users` + `SystemControl` `SESSION#<sid>`) y actualizaciones condicionales bajo contención (`INT-01`..`INT-08`).

---

## 7. INVENTARIO DE ENTREGABLES Y HASHES SHA-256 (FASE 4.0.4)

| Archivo | SHA-256 |
| :--- | :--- |
| `src/types/cleanSlate.ts` | `c6f13a3cab647bed33ab380055fee0537bf5f465ddd9f5f18e4da1b0d3eede97` |
| `src/security/httpSecurityPolicy.ts` | `a0c41d257bbdc1e9c25eb4a59ea79cd0e5a939f8d3040beec1e58f8e10aab6e4` |
| `src/auth/cleanSlateAuthGuard.ts` | `25ef16469c4cb80bf7c99ffe3dbb9ede427c1a572d2789bd9c535af8f8a6d2e4` |
| `src/routes/apiRouterSchema.ts` | `766b151bf261ea9b01d603d1e24345768b713cf8861e4d591f643bcab28a1d96` |
| `src/nosql/catalystModularAdapter.ts` | `e35427bee470a59e24736e88889f5f95bcdd81defac9c69e36c0679d50b6f220` |
| `src/nosql/cleanSlateEngine.ts` | `4631050fefc926c97fd48e6215729000f5756159d593e9c6ef263eeea2275a5b` |
| `src/services/adminGovernanceService.ts` | `913a0e1139d308b539ecd059dbb86fd5d8d130c116a885bab059305cbac5540a` |
| `src/services/athleteDataService.ts` | `185f5eaa9e0c8cb1b3e03ea1ac6512018e90190aec04e2d1eb8a29a4e16193f4` |
| `src/validators/domainValidators.ts` | `a7763424f0b8035f697ff30aeb235a3470cb25110303e493fead7c59c0891e16` |
| `tests/01-auth-and-anti-idor.test.ts` | `c841af4af63e6486d2c582db88ecaed3aaca1e782e26a42b42c182d3d9301bdb` |
| `tests/02-domain-validators-and-invariants.test.ts` | `b1b7dc6be03e8b92df2f665820f39a4d585773b133aecd3baf9b005bea152070` |
| `tests/03-nosql-schema-indexes-and-limits.test.ts` | `2899a61f96518a9cb27faa72c31a06e30a59746c6267c5a0482b2b5d8507c251` |
| `tests/04-admin-rbac-bootstrap-and-saga.test.ts` | `f478f70eeb3e23af7f4b7d165b5b1ec2477ad4b33ed0179aea899f49054c249a` |
| `tests/05-static-isolation-and-clean-slate.test.ts` | `55a3dbc446bb3ac5b0417f932973c36995a0b10abb83295cf028ffbe4e9b0b4b` |
| `tests/06-integration-catalyst-live.spec.ts` | `3c091ed235642f62eab7c7c012265b243ddfd22ce5f7c6d7d45326c96bbb4f07` |
| `tests/07-session-lifecycle-and-http-security.test.ts` | `0308536f0405a780efa41c594b79e7ec5f8e38c821a8a9d4664c033d4d2fef6b` |
| `docs/01-clean-slate-architecture-report.md` | `9cb831754ccc9f0df985675f2ebbe09074edbaf94b47497d86c3c6757e5182db` |
| `docs/02-functional-inventory.md` | `450c96b2d343956e2c5cad9c3e653f5bee79ad00595b4ea5275becee5df728b4` |
| `docs/03-nosql-data-model-and-indexes.md` | `9daa4f1668ebc36b186bb00b94e86e66f290ef980e41ea1a461dd94ef08be107` |
| `docs/04-equivalence-auth-endpoints-security.md` | `9d7cb20791150c4cf50f60ff9940c4a806136ed57027c11b88e6b7fe5b2f77bb` |
| `docs/05-verification-and-test-report.md` | `c59d6124802706c7fc171b3a43a590a35c888a3d81e166087d5c0556c5f5dfaf` |
| `docs/06-adversarial-audit-4.0.1.md` | `449e8c6c4587234fbb75ff2eeca2eea47f11585314ca0ed71570f9e12c3fb90b` |
| `docs/07-manual-catalyst-tables-runbook.md` | `744552daa126ae4ffb639cab5143d799cb3dde1c34e8fd1637097247647a9112` |
| `docs/08-phase-4.0.2-schema-freeze-and-guarantees.md` | `422802d7ffc8440715a468e4e4aa368e8c53f7637a15ff30c5795ac89148960e` |
| `docs/09-phase-4.0.3-auth-and-sdk-audit.md` | `152f2b400e3390478057d6a9e86d80f3a8b1bf3117559125e21ff6d62f826a76` |

*(Nota: el hash SHA-256 propio de `docs/10-phase-4.0.4-session-and-slate-compatibility.md` se reporta tras finalizar esta escritura en el resumen de cierre).*
