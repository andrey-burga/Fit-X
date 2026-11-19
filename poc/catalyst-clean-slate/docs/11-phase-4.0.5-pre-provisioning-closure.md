# VIGORCORE — FASE 4.0.5: CIERRE DE COMPATIBILIDAD DE SESIONES Y PREPARACIÓN PARA APROVISIONAMIENTO

**Fecha:** 2026-11-13  
**Directorio aislado:** `poc/catalyst-clean-slate/`  
**Dictamen:** **`CLEAN_SLATE_PRE_PROVISIONING_READY — PENDING OPERATOR APPROVAL`**  
**Estado de Infraestructura:** **0** tablas creadas, **0** índices creados, **0** usuarios creados, **0** escrituras/despliegues remotos. Slate (`https://fit-x-bhnatsxl.onslate.com`), Firebase, GCP y código raíz (`src/`, `functions/`, manifiestos) 100% intactos.

---

## 1. INFORME DE COMPATIBILIDAD DE DOMINIOS (ENTREGABLE 1 — OBJETIVO 3)

### 1.1 Diagnóstico de Bloqueo Cross-Site con Dominio Predeterminado Catalyst
- **Frontend actual:** `https://fit-x-bhnatsxl.onslate.com` (*registrable domain* / eTLD+1: `onslate.com`).
- **Formato oficial predeterminado de Catalyst Advanced I/O:** `https://project_domain_name.catalystserverless.com/server/function_name/` (*registrable domain*: `catalystserverless.com`).
- **Consecuencia en navegador:** `onslate.com` != `catalystserverless.com` (**`cross-site`**). Por especificación RFC / navegadores modernos (Chromium y Safari/WebKit), una cookie **`SameSite=Strict`** NO se envía en peticiones `fetch(..., { credentials: 'include' })` *cross-site*.
- **Reglas cumplidas:** NO se inventa ningún dominio final de Catalyst; NO se asume que un dominio personalizado de Slate aplique automáticamente a Advanced I/O; NO se degrada `SameSite=Strict` a `SameSite=None`.
- **Estado de compatibilidad real en navegador:** **BLOQUEADA PARA URL CROSS-SITE POR DEFECTO / `PENDING (PASS-INTEGRATION)`** hasta que el operador elija una de las tres alternativas siguientes, despliegue y ejecute **`INT-06`, `INT-07` y `BR-01..BR-20`** en Chromium y Safari/WebKit reales.

### 1.2 Matriz Comparativa Obligatoria: Alternativas A, B y C

| Criterio | Alternativa A: Dominio personalizado compartido (*same-site*) | Alternativa B: API Gateway / Proxy oficial *same-site* (si soportado y verificable) | Alternativa C: Proxy inverso dedicado (*same-origin*, preferida) |
| :--- | :--- | :--- | :--- |
| **Arquitectura de dominios** | Subdominios hermanos bajo un mismo dominio propio: UI Slate en `https://app.<tudominio>` y Catalyst Advanced I/O en `https://api.<tudominio>` (solo si Catalyst permite custom domain en Advanced I/O o vía DNS CNAME verificado). | Gateway/enrutador gestionado en el mismo *registrable domain* o subruta oficial que reenvía `/api/v1/*` hacia la función Advanced I/O ocultando `*.catalystserverless.com`. | Reverse proxy HTTPS dedicado (ej. Cloudflare Worker / NGINX / ALB) en el origen del cliente que enruta `/` a Slate y `/api/v1/*` a Catalyst Advanced I/O. |
| **Origin real del frontend** | `https://app.<tudominio>` (o subdominio bajo el mismo eTLD+1 que el API). | `https://app.<tudominio>` (si apunta al gateway) o `https://fit-x-bhnatsxl.onslate.com` (solo si Zoho soporta proxy nativo bajo ese host; **no asumible sin verificar**). | `https://<tudominio-app>` (ej. dominio propio del cliente). |
| **Origin real del endpoint API** | `https://api.<tudominio>` | `https://api.<tudominio>` o mismo origen `https://<app-origin>` | **Mismo origen:** `https://<tudominio-app>/api/v1/*` |
| ***Registrable domain* (eTLD+1)** | Idéntico (`<tudominio>`) -> relación **`same-site`**. | Idéntico -> **`same-site`** o **`same-origin`**. | Idéntico (origen completo igual) -> **`same-origin`**. |
| **Envío de `__Host-vigor_session` (`SameSite=Strict`)** | Enviada en `fetch(..., { credentials: 'include' })` entre subdominios *same-site* (requiere validación viva en Safari ITP y Chromium). | Depende de soporte oficial sin reescritura destructiva de `Set-Cookie` (debe validarse `Set-Cookie` sin `Domain=` en vivo). | **Garantizado por estándar (`same-origin`)** en Chrome y Safari sin exponer cookies a terceros ni restricciones ITP *cross-site*. |
| **CORS** | **Requerido:** `Access-Control-Allow-Origin` exacto + `Access-Control-Allow-Credentials: true` + `Vary: Origin` (sin `*`). | Requerido si difieren subdominios; opcional si es *same-origin*. | **No requerido en navegador** para `/api/v1/*` (se mantiene política `HttpSecurityPolicy` en backend como barrera). |
| **CSRF** | Indispensable validar `Origin` + `Sec-Fetch-Site` en `POST/PUT/PATCH/DELETE` (`SameSite=Strict` no protege contra subdominios hermanos). | Indispensable validar `Origin` exacto y `Sec-Fetch-Site` tras preservar cabecera `Origin` en gateway. | Indispensable validar `Origin` + `Sec-Fetch-Site`; el proxy debe reenviar `Origin` real sin falsificarlo. |
| **Limitaciones de Catalyst** | El dominio personalizado configurado en Zoho Slate **NO** cubre automáticamente funciones `catalystserverless.com`; debe comprobarse en consola Catalyst si Advanced I/O admite mapeo directo de dominio personalizado o requiere proxy frontal. | Solo utilizable si la documentación/consola oficial de Zoho Catalyst / Zoho confirma soporte explícito de enrutamiento *same-site* preservando cookies `__Host-*` y cabeceras `Origin`/`Cookie`. | El proxy no debe exceder timeout de Catalyst Advanced I/O (`30s`), debe reenviar `Cookie`, `Origin`, `Sec-Fetch-Site`, y preservar `Set-Cookie` íntegro sin añadir atributo `Domain=`. |
| **Requisitos DNS y SSL** | Dominio propio, registros DNS (`CNAME`/`A`), certificados TLS válidos para `app.<tudominio>` y `api.<tudominio>`. | Dominio propio o configuración TLS oficial validada en plataforma Zoho. | Dominio propio, DNS apuntando al proxy TLS y certificado HTTPS válido. |
| **Costes o servicios adicionales** | Compra/gestión de dominio propio; posibles cargos por *custom domain* si aplica plan. | Posible tier/cuota de API Gateway si aplica fuera del plan base. | Infraestructura ligera de reverse proxy / CDN edge (ej. Workers/ALB) + dominio propio. |

---

## 2. DISEÑO FINAL DE COOKIE (ENTREGABLE 2)

- **Nombre obligatorio:** `__Host-vigor_session`
- **Formato de emisión (`Set-Cookie`):**
  `__Host-vigor_session=<base64url_payload>.<base64url_hmac>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`
- **Atributos exigidos y verificados por `assertStrictCookieAttributes()`:**
  - Prefijo `__Host-`: impide sobrescritura desde subdominios no confiables y obliga HTTPS + `Path=/` + ausencia total de `Domain=`.
  - `HttpOnly`: bloquea lectura/exfiltración desde `document.cookie` / XSS.
  - `Secure`: transmisión exclusiva sobre TLS.
  - `SameSite=Strict`: nunca degradado automáticamente a `SameSite=None`.
  - `Path=/`: alcance uniforme en `/api/v1/*`.
  - **Sin `Domain=`** (prohibido explícitamente).
- **Cierre de sesión (`POST /api/v1/auth/session/logout`):** Emite `Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT` con los mismos atributos estrictos (`HttpOnly; Secure; SameSite=Strict; Path=/`), revocando previamente `SESSION#<sid>` en `SystemControl`.

---

## 3. CONTRATO Y GENERACIÓN SEGURA DEL SECRETO HMAC (ENTREGABLE 3 — OBJETIVO 2)

Implementado y verificado en `src/auth/cleanSlateAuthGuard.ts`:
1. **Generación CSPRNG:** `ServerSessionTokenManager.generateStrongSecret(byteLength >= 32)` utiliza `crypto.randomBytes(32).toString('base64url')` (256 bits reales = 43 caracteres Base64URL canónicos).
2. **Validación estricta de bytes decodificados (`decodeAndValidateHmacSecret()`):**
   - Rechaza formatos no canónicos, espacios, padding `=` o caracteres fuera de `[A-Za-z0-9_-]`.
   - Decodifica a `Buffer` y exige **`keyBytes.length >= 32` (256 bits reales)** — por ejemplo, rechaza cadenas de 32 caracteres cuya decodificación Base64URL produce solo 24 bytes (`SESSION_SECRET_INSUFFICIENT_BYTES`).
   - Rechaza patrones repetitivos o baja entropía (`distinctBytes < 16` -> `SESSION_SECRET_LOW_ENTROPY`).
   - El HMAC-SHA256 opera directamente sobre el `Buffer` binario de 32+ bytes.
3. **Ausencia de valores predeterminados inseguros y consistencia multi-instancia:**
   - En `production` y `staging`, `ServerSessionTokenManager.fromEnvironment()` y `CleanSlateAuthGuard` fallan cerrado (`MISSING_SESSION_HMAC_SECRET` / `MISSING_ENV_SESSION_SECRET`) si falta `VIGOR_SESSION_HMAC_SECRET`.
   - Todas las instancias dentro del mismo entorno comparten el mismo `VIGOR_SESSION_HMAC_SECRET` inyectado por variable segura de entorno.
   - **Separación absoluta de entornos:** Claves distintas por entorno + verificación obligatoria del claim firmado `env` (`development` vs `staging` vs `production`), impidiendo validar un token de desarrollo en producción incluso ante error de configuración.
4. **Rotación documentada:** Mediante `VIGOR_SESSION_ACTIVE_KID` (`activeKeyId`) y `VIGOR_SESSION_PREVIOUS_SECRETS_JSON` (`previousSecrets: [{ kid, secret }]`). El proceso mantiene el secreto anterior durante máximo una ventana TTL de cookie (12h) antes de retirarlo.
5. **Confidencialidad:** Cero secretos o tokens crudos persistidos en el repositorio, respuestas JSON o mensajes de error.

---

## 4. REVISIÓN EXHAUSTIVA DEL CICLO DE VIDA DE SESIONES (ENTREGABLE 4 — OBJETIVO 4)

Auditoría sobre `src/auth/cleanSlateAuthGuard.ts`:
- **`issueSignedSession()`:** Persiste `SESSION#<sid>` en `SystemControl` con condición `{ type: 'attribute_not_exists', attr: 'pk' }` **antes** de devolver `Set-Cookie`. Si ocurre `CatalystTimeoutError`, ejecuta lectura consistente (`consistent_read: true`) y solo entrega la cookie si confirma existencia activa del `sid` perteneciente al mismo usuario; en caso contrario falla cerrado sin entregar cookie.
- **Unicidad usuario-`sid`:** `pk = SESSION#<sid>` es único por partición, `sid` tiene 128 bits CSPRNG, ninguna ruta cambia `ownerUserId`, y `authenticate()` valida `sessionRec.sid === claims.sid && sessionRec.ownerUserId === sessionUser.user_id`. Un `sid` jamás puede pertenecer ni ser usado por dos usuarios.
- **`CleanSlateAuthGuard.authenticate()`:** Lee `Users` y `SystemControl` `SESSION#<sid>` con `consistent_read: true`. Si falta el registro (`!sessionRec`), rechaza con `401 INVALID_SIGNED_SESSION`. Verifica `status === 'active'`, ausencia de `revokedAt`, `sessionRec.sessionEpoch >= userItem.sessionEpoch` y **`expiresAtEpochSec > nowSec`**, rechazando sesiones expiradas incluso cuando la limpieza asíncrona TTL de Catalyst todavía no haya eliminado el ítem.
- **`logoutSession()`:** Revoca condicionalmente `SESSION#<sid>` (`status: 'active' -> 'revoked'`) con recuperación por `consistent_read: true` ante timeout **antes** de devolver `loggedOut: true` y `Max-Age=0`. Un `sid` revocado no puede volver a usarse (no existe transición `'revoked' -> 'active'`).
- **`refreshSignedSession()`:** Verifica sesión activa, revoca condicionalmente `SESSION#<oldSid>` antes de emitir `SESSION#<newSid>`. Si ocurre timeout / respuesta perdida durante el refresh, la lectura consistente bloquea una segunda emisión sobre el `oldSid` revocado (`401 SESSION_REVOKED_REAUTH_REQUIRED`), eliminando estados ambiguos o duplicados.
- **`revokeIndividualSession()`:** Actualiza únicamente `SESSION#<targetSid>`; las demás sesiones activas del usuario en otros dispositivos permanecen válidas.
- **`revokeAllUserSessionsGlobally()`:** Incrementa condicionalmente `Users.sessionEpoch`, invalidando de inmediato todas las cookies emitidas anteriormente para ese usuario.

---

## 5. ESQUEMA TTL DEFINITIVO (ENTREGABLE 5 — OBJETIVO 1)

| Tabla | TTL Activo | Atributo Exacto (Tipo) | Reglas de Uso y Seguridad |
| :--- | :---: | :--- | :--- |
| **`Users`** | **No** | *N/A* | Retención permanente de cuentas/RBAC (`sessionEpoch` en lugar de TTL). |
| **`UserData`** | **No** | *N/A* | Datos históricos deportivos/nutricionales sin expiración automática. |
| **`AdminInvitations`** | **Sí** | `ttlEpochSec` (`Number`) | Limpieza ~24h tras expirar (`expiresAtEpochSec + 86400`). Validez comprobada en backend por `expiresAtEpochSec > nowSec`. |
| **`AuditLogs`** | **No** | *N/A* | Bitácora administrativa inmutable *append-only*. |
| **`SystemControl`** | **Sí** | **`ttlEpochSec` (`Number`)** | **Único atributo TTL.** Usado **exclusivamente** en `CTRL#SAGA#*` (7 días) y `SESSION#<sid>` (`expiresAtEpochSec + 86400`). **PROHIBIDO** asignar `ttlEpochSec` en `CTRL#BOOTSTRAP` o `CTRL#SUPERADMIN_COUNT`. La expiración autoritativa de sesión se comprueba en backend mediante **`expiresAtEpochSec > nowSec`**. |

*(Confirmado alineamiento idéntico en `docs/03-nosql-data-model-and-indexes.md`, `docs/05-verification-and-test-report.md`, `docs/07-manual-catalyst-tables-runbook.md`, `docs/08-phase-4.0.2-schema-freeze-and-guarantees.md` y `docs/10-phase-4.0.4-session-and-slate-compatibility.md`.)*

---

## 6 & 7. SUITE AMPLIADA Y CLASIFICACIÓN ESTRICTA (ENTREGABLES 6 & 7 — OBJETIVO 5)

- **`PASS-UNIT` / `PASS-MOCK` (`tests/01`, `02`, `03`, `04`, `07`):** Lógica de dominio, compilación contra `.d.ts` reales `@zcatalyst/nosql@1.0.0` y `@zcatalyst/auth@1.0.0`, entropía 256-bit Base64URL, separación de entornos, recuperación de timeouts, ciclo de 12 pasos, CORS con credenciales, atributos `__Host-` y protección CSRF en **`POST`, `PUT`, `PATCH` y `DELETE`**.
- **`PASS-STATIC` (`tests/05`):** Cero artefactos Firestore/ETL, cero secretos hardcoded, cero `SameSite=None`, cero `Access-Control-Allow-Origin: *`, alineación documental 5 tablas + `ttlEpochSec`, y presencia de los 20 casos en `BROWSER_E2E_MATRIX`.
- **`PENDING (PASS-INTEGRATION)` (`tests/06-integration-catalyst-live.spec.ts`):** `INT-01..INT-08` y **`BR-01..BR-20`** (Chromium + Safari/WebKit). No se declara compatibilidad real de cookies ni integración viva sobre simulaciones.

---

## 8. INVENTARIO DE ENTREGABLES Y HASHES SHA-256 (ENTREGABLE 8)

| Archivo (`poc/catalyst-clean-slate/...`) | SHA-256 |
| :--- | :--- |
| `src/types/cleanSlate.ts` | `c6f13a3cab647bed33ab380055fee0537bf5f465ddd9f5f18e4da1b0d3eede97` |
| `src/security/httpSecurityPolicy.ts` | `779a61e0f25ac3bddaa7518ef36f90f4b5624b2f4425fb44b9c05f29571e8e98` |
| `src/auth/cleanSlateAuthGuard.ts` | `3a6b13c4516fbad570bcc09bcf78b61619573582ccd7de343ef892a8f2581412` |
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
| `tests/05-static-isolation-and-clean-slate.test.ts` | `1db951610e6d3eadd0633c7779f8f4e68c8de2ff739a23248b5513debabf24db` |
| `tests/06-integration-catalyst-live.spec.ts` | `ca9ecb83e6717b98745819e0a2777552d247e608f13de9f309a9a34b83d72471` |
| `tests/07-session-lifecycle-and-http-security.test.ts` | `5ea6fad5fccda7aba9be9da602c8cdefb6d2228928bcd9ca45cbeb1c61ed94af` |
| `docs/01-clean-slate-architecture-report.md` | `9cb831754ccc9f0df985675f2ebbe09074edbaf94b47497d86c3c6757e5182db` |
| `docs/02-functional-inventory.md` | `450c96b2d343956e2c5cad9c3e653f5bee79ad00595b4ea5275becee5df728b4` |
| `docs/03-nosql-data-model-and-indexes.md` | `d6a538addeed254b3b39872e58470d0c6ea9a84c593a752b113ca892fbfd03c8` |
| `docs/04-equivalence-auth-endpoints-security.md` | `9d7cb20791150c4cf50f60ff9940c4a806136ed57027c11b88e6b7fe5b2f77bb` |
| `docs/05-verification-and-test-report.md` | `4caa37a5295093196e225152761be2108217bd97ca02d288b8b4b2e6906a8b69` |
| `docs/06-adversarial-audit-4.0.1.md` | `449e8c6c4587234fbb75ff2eeca2eea47f11585314ca0ed71570f9e12c3fb90b` |
| `docs/07-manual-catalyst-tables-runbook.md` | `649658d745824c3e1964381a607ab2cfb25b0eadb96f6910ec0c9cbd0ec3441b` |
| `docs/08-phase-4.0.2-schema-freeze-and-guarantees.md` | `8e7c1f7b2b54f5f11c5f2f6cb423739915260c94936749c87a0f00bd6a18de0a` |
| `docs/09-phase-4.0.3-auth-and-sdk-audit.md` | `152f2b400e3390478057d6a9e86d80f3a8b1bf3117559125e21ff6d62f826a76` |
| `docs/10-phase-4.0.4-session-and-slate-compatibility.md` | `87622265d6b7c881cb568969ce9a50c398d5f49776f22e9c646955deae5c458b` |

*(Nota: el hash SHA-256 final propio de `docs/11-phase-4.0.5-pre-provisioning-closure.md` se verifica y reporta tras guardar esta tabla).*

---

## 9. RUNBOOK OPERATIVO ACTUALIZADO (ENTREGABLE 9)

Actualizado íntegramente en `poc/catalyst-clean-slate/docs/07-manual-catalyst-tables-runbook.md` con la especificación exacta de las 5 tablas, `ttlEpochSec` (`Number`) en `AdminInvitations` y `SystemControl`, generación/rotación de `VIGOR_SESSION_HMAC_SECRET` Base64URL 256-bit y secuencia previa al aprovisionamiento.

---

## 10. LISTA DE REQUISITOS PENDIENTES DEL OPERADOR (ENTREGABLE 10)

Para pasar de **`CLEAN_SLATE_PRE_PROVISIONING_READY — PENDING OPERATOR APPROVAL`** a aprovisionamiento e integración viva (`PASS-INTEGRATION`), el operador debe:
1. Aprobar explícitamente la creación de las 5 tablas congeladas en Zoho Catalyst Console (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`) con sus GSIs y TTL `ttlEpochSec` (`Number`) únicamente en `AdminInvitations` y `SystemControl`.
2. Seleccionar la topología de dominios (**Alternativa A**, **B** oficial verificable, o **C** proxy inverso *same-origin*) para resolver el bloqueo *cross-site* de `SameSite=Strict` desde Slate.
3. Configurar registros DNS y certificados TLS/HTTPS del dominio personalizado / proxy elegido.
4. Generar e inyectar secretos `VIGOR_SESSION_HMAC_SECRET` independientes (`crypto.randomBytes(32).toString('base64url')`) por entorno (`staging` y `production`), asegurando el mismo valor en todas las instancias de un mismo entorno.
5. Desplegar el entorno de pruebas en Catalyst Advanced I/O (manteniendo `liveAtomicityVerifiedForSuperadminMutations: false`).
6. Ejecutar la suite viva de Catalyst (`INT-01`..`INT-08`) y verificar la matriz real de navegador en **Chromium y Safari/WebKit** (`BR-01`..`BR-20`).
7. Tras obtener `PASS-INTEGRATION`, dar de alta al propietario (`POST /api/v1/auth/session/bootstrap-profile`) y ejecutar el bootstrap offline único (`executeOfflineAdminBootstrap()`).
