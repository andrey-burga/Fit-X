# VIGORCORE — FASE 5.3: CONCILIACIÓN DE CONTEXTO `hosted_native` Y IDENTIDAD DE USUARIO EN CATALYST ADVANCED I/O

**Proyecto:** `Fit-X` *(aislado estrictamente en `poc/catalyst-clean-slate/`)*  
**Proyecto Catalyst:** `Project-Rainfall` · **Project ID:** `136967000000014024`  
**Entorno:** `Development` · **Función:** `vigor_api` (`136967000000074001`)  
**Modo de autenticación:** `VIGOR_CATALYST_AUTH_MODE=hosted_native` · **API Gateway:** Deshabilitado  
**Operaciones remotas ejecutadas:** `0` *(cero redespliegues, cero escrituras en NoSQL/Auth/DNS, cero cambios en Production/Slate/Firebase/GCP)*  
**Dictamen:** **`PHASE_5_3_HOSTED_NATIVE_AUTH_CONTEXT_RECONCILED_NOT_DEPLOYED`**

---

## 1. RESUMEN DE EVIDENCIA EN VIVO Y CONTRATO OFICIAL DE CATALYST

Dos pruebas independientes contra la Function URL activa de `vigor_api` en `Development` produjeron **HTTP `403 CATALYST_ADMIN_HEADER_SPOOFED`**:

1. **Navegador (Chrome/Brave)** `GET /server/vigor_api/api/v1/athlete/workspace`, sin `x-zc-user-type` ni `Authorization` en las cabeceras salientes del navegador, enviando cookies del navegador.
2. **Windows PowerShell 5.1** `GET` a la misma Function URL, sin cookies de navegador ni cabeceras de identidad suministradas por el cliente.

### Contrato verificado en `@zcatalyst/auth-admin@1.1.0` y documentación oficial de Zoho Catalyst

En `poc/catalyst-clean-slate/node_modules/@zcatalyst/auth-admin/dist-es/credential.js` (`lines 253-264`):

- Cuando el cliente **no está autenticado** como usuario final del proyecto en Catalyst Authentication, la infraestructura Advanced I/O ejecuta la función en **contexto administrativo de plataforma**, inyectando:
  - `x-zc-admin-cred-type`, `x-zc-admin-cred-token`, `x-zc-project-key`
  - `x-zc-projectid`, `x-zc-environment`
  - **`x-zc-user-type: admin`**
  - Sin `x-zc-user-cred-token` ni sesión de usuario final Catalyst.
- En ese escenario, `CatalystCredential` modela `userType = 'admin'` y ante `scope: 'user'` (`UserManagement.getCurrentUser()`) el SDK nativo devuelve error / `null` porque **no hay usuario final autenticado**, no porque el cliente haya falsificado una cabecera.

---

## 2. DEFECTO EXACTO CORREGIDO

### Comportamiento previo defectuoso (`catalystSdkBridge.ts`)

En `HostedNativeCatalystAuthRuntime.getCurrentUserFromRequest()` y `CatalystSeparatedAuthRuntime.getCurrentUserFromRequest()`, el orden previo era:

1. Validar `x-zc-projectid`, `x-zc-project-key`, `x-zc-environment`.
2. **Rechazar inmediatamente `x-zc-user-type === 'admin'` con `403 CATALYST_ADMIN_HEADER_SPOOFED`** *antes* de comprobar si existían credenciales de usuario final (`x-zc-user-cred-token` o cookies Catalyst válidas).
3. Pasar `x-zc-cookie` sin filtrar hacia `ZCAuth.init(..., { scope: 'user' })`.

**Consecuencias del defecto:**
- Peticiones completamente anónimas (PowerShell sin cookies y navegador no autenticado) devolvían `403 CATALYST_ADMIN_HEADER_SPOOFED` en lugar de `401 UNAUTHENTICATED`.
- Cualquier sesión legítima `__Host-vigor_session` (Camino 3) corría riesgo de fallar en `cleanSlateAuthGuard.ts:1092` al invocar incondicionalmente `getCurrentUserFromRequest(req)` aunque Catalyst Edge hubiera inyectado `x-zc-user-type: admin` o cookies ajenas.
- Cookies de aplicación (`__Host-vigor_session`) o de Zoho Console (`_zcsr_tmp`) presentes en `x-zc-cookie` no se aislaban antes de pasarse a `ZCAuth`.

---

## 3. ARQUITECTURA DE AUTENTICACIÓN RECONCILIADA Y AISLAMIENTO DE COOKIES

### 3.1 Orden exacto en `getCurrentUserFromRequest()` (`HostedNativeCatalystAuthRuntime` y `CatalystSeparatedAuthRuntime`)

1. **Pinning estricto de proyecto y entorno (`403 PROJECT_CONTEXT_MISMATCH`):**
   - `x-zc-projectid` != configurado → `403 PROJECT_CONTEXT_MISMATCH`
   - `x-zc-project-key` != configurado → `403 PROJECT_CONTEXT_MISMATCH`
   - `x-zc-environment` != `VIGORCORE_DEPLOYMENT_ENVIRONMENT` → `403 PROJECT_CONTEXT_MISMATCH`
2. **Extracción y sanitización de credenciales Catalyst de usuario final (`extractCatalystUserCredentialsFromHeaders`):**
   - Lee `x-zc-user-cred-token` (`x-zc-user-cred-type`, rechazando caracteres de control `\r\n\0` con `401 AUTH_SESSION_INVALID`).
   - Lee **únicamente** `x-zc-cookie` (`extractSanitizedCatalystUserCookie`) — **nunca** `req.headers.cookie` (`Cookie`).
   - Dentro de `x-zc-cookie` conserva exclusivamente cookies reconocidas de sesión de usuario Catalyst (`JWT_AUTH`, `user_cred`, `zccpn`, `_iamadt*`/`iamadt*`, `_iambdt*`/`iambdt*`, `_zohoportal_*`, más `ZD_CSRF_TOKEN` requerido por `CookieCredential.getZCSRFHeader()` **solo** si acompaña al menos una cookie de sesión Catalyst).
   - **Elimina estrictamente** `__Host-vigor_session`, prefijos `vigor_*` / `x-vigor-*`, `stratus_jwt`, `JWT_EXPIRES_AT`, cookies de consola Zoho (`_zcsr_tmp`, `zalb_*`, `JSESSIONID`, etc.) y cookies arbitrarias.
3. **Evaluación conjunta de credenciales y `x-zc-user-type`:**
   - **Sin credenciales Catalyst de usuario final (`!hasUserCredential`):** devuelve **`null`** limpiamente (tanto si `x-zc-user-type` falta, vale `'user'` o vale `'admin'`). `CleanSlateAuthGuard` rechaza fail-closed con **`401 UNAUTHENTICATED`** y **`0`** lecturas/escrituras NoSQL. `x-zc-user-type=admin` por sí solo **jamás** otorga identidad ni privilegios.
   - **Con credenciales Catalyst de usuario final + `x-zc-user-type=admin` contradictorio:** falla cerrado con **`403 CATALYST_ADMIN_HEADER_SPOOFED`** sin llamar a `UserManagement.getCurrentUser()` ni tocar NoSQL.
   - **Con credenciales Catalyst de usuario final válidas (sin `admin`):** inicializa `new ZCAuth().init({ headers: sanitizedUserHeaders }, { type: 'advancedio', scope: 'user' })` con `x-zc-user-type: 'user'`, dominios/proyecto fijados por servidor y cookies estrictamente sanitizadas.

### 3.2 Contrato exacto de cookies y cabeceras (`@zcatalyst/auth@1.0.0` y `@zcatalyst/auth-admin@1.1.0`)

| Artefacto / Cabecera / Cookie | Origen | Propósito | ¿Se envía a `ZCAuth` (`scope: 'user'`)? |
| :--- | :--- | :--- | :---: |
| **`__Host-vigor_session`** | Servidor VigorCore (`Set-Cookie`) | Sesión firmada HMAC-SHA256 verificada en `CleanSlateAuthGuard` (Camino 3) | **NUNCA** |
| **`X-Vigor-CSRF`** | Servidor VigorCore -> Header cliente | Protección CSRF ligada a `(sub, sid, ep)` | **NUNCA** |
| **`Cookie` (`req.headers.cookie`)** | Navegador | Transporta `__Host-vigor_session` + posibles cookies de terceros/consola | **NUNCA** |
| **`_zcsr_tmp`, `zalb_*`, `JSESSIONID`** | Zoho Console / LB | Cookies operativas ajenas a usuario final del proyecto | **NUNCA** |
| **`x-zc-user-cred-token` / `type`** | Borde Catalyst | Token OAuth/Ticket de usuario final del proyecto | **SÍ** *(como `user`)* |
| **`JWT_AUTH`, `user_cred`, `_iamadt*`, `_iambdt*`, `zccpn`, `_zohoportal_*` + `ZD_CSRF_TOKEN`** *(dentro de `x-zc-cookie`)* | Borde Catalyst (`CookieCredential`) | Sesión portal de usuario final Catalyst (`ZD_CSRF_TOKEN` alimenta `X-ZCSRF-TOKEN: zd_csrparam=...`) | **SÍ** *(únicamente la lista permitida)* |

### 3.3 Camino 3 (`__Host-vigor_session`) en `CleanSlateAuthGuard.authenticate()` (`cleanSlateAuthGuard.ts`)

- Cuando `__Host-vigor_session` está presente:
  1. Valida criptográficamente el token HMAC-SHA256.
  2. Consulta `this.authRuntime.hasRequestCatalystUserCredential?.(req)`:
     - En peticiones **solo HMAC** (aunque Catalyst Edge inyecte `x-zc-user-type: admin` o el navegador envíe `_zcsr_tmp` / otras cookies), **NO invoca `UserManagement.getCurrentUser()`** (`0` llamadas user-scope a Catalyst).
     - Solo si existen credenciales Catalyst de usuario final independientes y reconocidas ejecuta el cruce de sujeto (`claims.sub === optionalCatalystUser.user_id`), preservando `403 CATALYST_ADMIN_HEADER_SPOOFED` y `403 PROJECT_CONTEXT_MISMATCH`.
  3. Valida **`Users`** (`consistent_read: true`), **`SystemControl SESSION#<sid>`** (`consistent_read: true`), ventanas de 12h/24h, ventana de revalidación admin de 15 min (`scope: 'admin'`), RBAC y `X-Vigor-CSRF`.

---

## 4. ACLARACIÓN ARQUITECTURAL (`hosted_native` VS `external_oauth`)

Se actualizó la cabecera documental obsoleta de `src/sdk/catalystSdkBridge.ts` que afirmaba incorrectamente que toda operación administrativa usaba exclusivamente `CatalystAdminAppProvider`:

- **`VIGOR_CATALYST_AUTH_MODE=external_oauth` (`CatalystAdminAppProvider` + `CatalystSeparatedAuthRuntime`):** usa credenciales OAuth administrativas del servidor independientes de la petición (`RefreshTokenCredential`, CLI `--live --confirm-readonly` y bootstrap superadmin offline).
- **`VIGOR_CATALYST_AUTH_MODE=hosted_native` (`HostedNativeCatalystAuthRuntime`, obligatorio en `vigor_api`):** usa `AsyncLocalStorage` por petición con `new ZCAuth().init({ headers: sanitizedAdminHeaders }, { type: 'advancedio', scope: 'admin' })` a partir de `x-zc-admin-cred-*` y `x-zc-project-key` validados y fijados contra `VIGORCORE_CATALYST_PROJECT_ID`, `VIGORCORE_DEPLOYMENT_ENVIRONMENT`, `VIGORCORE_CATALYST_API_DOMAIN` y `VIGORCORE_CATALYST_ACCOUNTS_URL` (fallando cerrado con `503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE` si faltan).

---

## 5. INVARIANTES DE SEGURIDAD PRESERVADOS

- `VIGOR_CATALYST_AUTH_MODE=hosted_native` sin fallback silencioso a `external_oauth`.
- Firma HMAC-SHA256, bandera estricta `__Host-vigor_session` (`HttpOnly; Secure; SameSite=Strict; Path=/`, sin `Domain`), y token CSRF ligado a `(sub, sid, ep)`.
- `consistent_read: true` en `Users` y `SystemControl SESSION#<sid>`.
- RBAC autoritativo en `Users`, anti-IDOR `USER#<uid>`, pinning estricto de proyecto/entorno y bootstrap superadmin 100% offline.
- Redacción completa de secretos/tokens/cookies en respuestas HTTP y logs.

---

## 6. VERIFICACIÓN HONESTA: LOCAL VS PENDIENTE EN VIVO

| Ámbito | Estado | Alcance exacto |
| :--- | :--- | :--- |
| **Compilación TS servidor, `dist/`, frontend Vite y 12 escenarios de prueba (`tests/36` + `tests/01..35`)** | **`[PASS-UNIT]` / `[PASS-LOOPBACK]`** | Validado localmente contra `@zcatalyst/auth@1.0.0`, `@zcatalyst/auth-admin@1.1.0`, servidores HTTP loopback y adaptador NoSQL en memoria. |
| **Despliegue de este cambio en `vigor_api` (`Development`)** | **`NOT_DEPLOYED`** | **Cero** redespliegues ejecutados en este turno; el paquete/función remota activa aún contiene la compilación anterior hasta autorización explícita. |
| **Cabeceras reales de Catalyst Edge en `Project-Rainfall` (`Development`) con usuario autenticado, API Gateway y navegador** | **`PENDING_LIVE_VERIFICATION`** | La sobrescritura de `x-zc-user-*` por el borde en vivo, el passthrough de `x-zc-cookie` / `x-zc-user-cred-token` y el comportamiento real en Chromium/Safari detrás del futuro API Gateway siguen requiriendo verificación remota autorizada. |

---

## 7. DICTAMEN FINAL

**Estado actual:** **`PHASE_5_3_HOSTED_NATIVE_AUTH_CONTEXT_RECONCILED_NOT_DEPLOYED`**
