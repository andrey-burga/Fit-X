# VIGORCORE — ACTA DE EJECUCIÓN Y CIERRE DE FASE 5.2, ETAPA 2 (NATIVE CATALYST AUTHENTICATION EN `Development`)

**Proyecto en Google AI Studio:** `Fit-X` *(trabajo estrictamente aislado dentro de `poc/catalyst-clean-slate/`)*  
**Proyecto Zoho Catalyst:** `Project-Rainfall`  
**CATALYST_PROJECT_ID:** `136967000000014024`  
**Data Center:** `US` (`accounts.zoho.com` · `https://api.catalyst.zoho.com`)  
**Entorno configurado:** **`Development`** *(**`Production` sin modificar**)*  
**Línea base heredada (Etapa 1):** **`PHASE_5_2_STAGE_1_NOSQL_PROVISIONING_COMPLETED`** (`docs/29`, `phase52Stage1Inventory.ts`)  
**Estado previo del runbook:** `PHASE_5_2_STAGE_2_RUNBOOK_READY_NOT_EXECUTED` (`docs/30`)  
**Dictamen de ejecución de Etapa 2:** **`PHASE_5_2_STAGE_2_NATIVE_AUTH_CONFIGURED_PENDING_LIVE_VERIFICATION`**  
**Operaciones remotas ejecutadas por este agente en el registro:** **`0`** *(registro documental, conciliación de código y verificación local únicamente)*

---

## 1. CONFIGURACIÓN REAL APLICADA EN ZOHO CATALYST CONSOLE (`Development`)

El operador ejecutó manualmente la configuración de **Native Catalyst Authentication** en el entorno **`Development`** de **`Project-Rainfall`** (`136967000000014024`, DC **`US`**) con los siguientes parámetros confirmados:

| Parámetro en Zoho Catalyst Console (`Development`) | Valor Aplicado | Clasificación / Coherencia Clean-Slate |
| :--- | :---: | :--- |
| **Native Catalyst Authentication** | **Configurada mediante `Hosted Login`** | Coincide con `zcAuth.hostedSignIn()` y Modelo B Refinado. |
| **Public Signup** | **`Disabled`** | Bloquea autorregistro público abierto; altas nuevas solo por vía administrativa. |
| **Social Login** | **Todos desactivados** | Ningún proveedor social habilitado. |
| **Third-party Authentication** | **Sin configurar** *(permanece en `Set Up`)* | Fuera de alcance Clean-Slate en Fase 5.2. |
| **Custom User Validation** | **Desactivado (`Disabled`)** | Sin función Basic I/O interceptora; la validación de correo confirmado e invitación vive en `CleanSlateAuthGuard` y `AdminInvitations`. |
| **Authorized Domain** | **`app.vigorcore.lat`** | Dominio Slate autorizado para el flujo de autenticación frontend. |
| **CORS** | **`Enabled`** | Habilitado en la configuración de autenticación para el dominio autorizado. |
| **iFrame** | **`Disabled`** | Deshabilita incrustación/Embedded `#iam_iframe`; refuerza navegación top-level de Hosted Login. |
| **`api.vigorcore.lat`** | **No agregado** | Correcto en Etapa 2: `api.vigorcore.lat` corresponde al Domain Mapping de API Gateway/Advanced I/O (Fase 5.3) y aún no existe. |
| **Entorno `Production`** | **Sin modificar** | Cumplimiento estricto de estrategia *Development First*. |

---

## 2. EVIDENCIA VISUAL DIRECTA DE USUARIOS EN `Development`

Al finalizar la configuración en Catalyst Console (`Development`), el operador accedió directamente a la vista:

- **Ruta observada en consola:** **`Manage Application Users`** (`Authentication → Users`)
- **Estado visual observado literalmente:** **`Add your first user`**
- **Recuento registrado:** **`Development users: 0 (empty state observado)`**
- **Acciones abstinentes confirmadas:**
  - **No** se crearon cuentas de prueba.
  - **No** se pulsó el botón `Add User`.
  - **No** se ejecutó consulta CLI remota automatizada (`verify-clean-slate-provisioning.ts --live --confirm-readonly`).

> **Diferenciación explícita:** El valor **`0` usuarios en `Development`** queda respaldado por **evidencia visual directa** en **`Manage Application Users`** (**`"Add your first user"`**), y **NO** por una consulta CLI/SDK automatizada ejecutada en remoto.

---

## 3. DIFERENCIACIÓN ESTRICTA DE EVIDENCIA Y VERIFICACIONES

| Plano de Evidencia | Qué está demostrado exactamente | Alcance / Limitación Explícita |
| :--- | :--- | :--- |
| **1. Configuración aplicada en Consola** *(comunicada por el operador)* | `Hosted Login`, `Public Signup: Disabled`, `Social Login: todos desactivados`, `Third-party: sin configurar`, `Custom User Validation: Disabled`, `Authorized Domain: app.vigorcore.lat`, `CORS: Enabled`, `iFrame: Disabled`, `api.vigorcore.lat: no agregado`, `Production: sin modificar`. | Configuración de plataforma aplicada manualmente en **`Development`** (`Project-Rainfall`, `136967000000014024`). |
| **2. Evidencia visual directa de usuarios** *(observada por el operador)* | Vista **`Manage Application Users`** mostrando **`Add your first user`** -> **`0` usuarios en `Development`**, sin cuentas de prueba ni clics en `Add User`. | Evidencia visual humana en Catalyst Console; distinta de verificación programática remota. |
| **3. Consulta remota CLI automatizada** | **NO ejecutada todavía.** No se ha corrido `verify-clean-slate-provisioning.ts --live --confirm-readonly` contra Zoho Catalyst. | Pendiente de ejecución opcional read-only en estación Windows del operador (`--auth-mode external_oauth`). |
| **4. Conciliación y pruebas locales del código** | Paridad de `CatalystHostedAuthBridge.ts`, registro tipado `phase52Stage2Inventory.ts`, compilación TypeScript/Vite y suite automatizada local (incluyendo pruebas loopback Express y guardas estáticas). | Ejecutado en local dentro de `poc/catalyst-clean-slate/` con **`0` operaciones remotas**. |

---

## 4. CONCILIACIÓN DE `CatalystHostedAuthBridge.ts` CONTRA LA CONFIGURACIÓN APLICADA

Se inspeccionó y concilió `poc/catalyst-clean-slate/src/frontend/adapters/CatalystHostedAuthBridge.ts` frente a cada parámetro aplicado en Catalyst Console:

| Ajuste Aplicado en Consola | Comportamiento Verificado en `CatalystHostedAuthBridge.ts` | Resultado de Conciliación |
| :--- | :--- | :---: |
| **`Native Catalyst Authentication: Hosted Login`** | Expone e invoca únicamente `sdk.hostedSignIn(safeCallbackPath)`; omite por contrato `signIn()` (Embedded) y `signUp()` (`ICatalystWebAuthSdk`). | **CONCILIADO** |
| **`Public Signup: Disabled`** | No expone flujos de autorregistro; toda alta en `Development` sigue Alternativa A manual + `AdminInvitations` (`POST /api/v1/invitations/redeem`). | **CONCILIADO** |
| **`Custom User Validation: Disabled`** | Al no existir función validadora custom en Catalyst, `establishVigorSession()` valida fail-closed `is_confirmed !== false` (`403 EMAIL_VERIFICATION_REQUIRED`) y `status === 'ACTIVE'` (`403 CATALYST_ACCOUNT_NOT_ACTIVE`) antes de llamar `generateAuthToken('functions')`, además de validar `AdminInvitations`/NoSQL en backend. | **CONCILIADO** |
| **`iFrame: Disabled`** | `NATIVE_HOSTED_AUTH_PROFILE` registra `iframe: 'disabled'` y `startHostedLogin()` rechaza fail-closed (`403 HOSTED_LOGIN_IFRAME_FORBIDDEN`) si se invocara desde un contexto enmarcado (`window.self !== window.top`), garantizando navegación top-level exclusivamente. | **CONCILIADO** |
| **`Authorized Domain: app.vigorcore.lat` + `CORS: Enabled`** | `resolveSafeSameOriginRedirect()` valida estrictamente HTTPS y el mismo origen configurado en `expectedOrigin` (inyectado dinámicamente en runtime desde el entorno Slate, sin hardcodear literales de dominio dentro de `src/frontend/` para respetar `tests/10`). El comportamiento CORS real del edge Slate/Catalyst sigue en `PENDING_LIVE_VERIFICATION`. | **CONCILIADO** |
| **`api.vigorcore.lat: no agregado`** | `CatalystHostedAuthBridge` solo gestiona redirecciones de origen de la SPA y delega peticiones HTTP API a `CatalystHttpAuthRepository` (`baseUrl` inyectado externamente). No agrega `api.vigorcore.lat` al dominio autorizado de Native Auth; esa integración corresponde al futuro `vigor_api` + API Gateway (Fase 5.3). | **CONCILIADO** |
| **Separación `/auth/login` vs `/auth/callback`** | `DEFAULT_POST_LOGOUT_PATH = '/auth/login'` (iniciador / salida) y `DEFAULT_HOSTED_LOGIN_CALLBACK_PATH = '/auth/callback'` (único callback `redirect_url`). `startHostedLogin()` bloquea explícitamente (`/auth/login` -> `400 INVALID_HOSTED_CALLBACK_PATH`) para impedir confusión entre iniciador y callback. | **CONCILIADO** |

*(El frontend raíz fuera de `poc/catalyst-clean-slate/` permanece intacto y no se ha modificado).*

---

## 5. ELEMENTOS `PENDING_LIVE_VERIFICATION` (INTEGRACIÓN EN VIVO PENDIENTE)

Ninguno de los siete (7) puntos siguientes se considera verificado todavía por pruebas locales o configuración visual de consola:

| ID | Elemento de Integración en Vivo | Estado Explícito |
| :--- | :--- | :---: |
| **`LIVE-01`** | **Inicio de sesión real con una cuenta autorizada** en Native Catalyst Authentication (`Development`). | **`PENDING_LIVE_VERIFICATION`** |
| **`LIVE-02`** | **Callback real de Hosted Login en Slate** (`/__catalyst/auth/login?redirect_url=%2Fauth%2Fcallback` -> `https://app.vigorcore.lat/auth/callback`). | **`PENDING_LIVE_VERIFICATION`** |
| **`LIVE-03`** | **SPA history fallback** en Slate (`app.vigorcore.lat`) para servir la aplicación ante navegación directa a **`/auth/login`** y **`/auth/callback`**. | **`PENDING_LIVE_VERIFICATION`** |
| **`LIVE-04`** | **Intercambio real de `generateAuthToken('functions')`** en RAM hacia `/api/v1/auth/session/bootstrap-profile` y `/api/v1/auth/session/exchange`. | **`PENDING_LIVE_VERIFICATION`** |
| **`LIVE-05`** | **Emisión y validación real en vivo** de la cookie **`__Host-vigor_session`** y de la cabecera **`X-Vigor-CSRF`**. | **`PENDING_LIVE_VERIFICATION`** |
| **`LIVE-06`** | **Comportamiento de cookies en navegadores reales** (**Chromium** y **Safari/WebKit**) para `SameSite=Strict`, `HttpOnly`, `Secure` y `Path=/` entre `app.vigorcore.lat` y `api.vigorcore.lat`. | **`PENDING_LIVE_VERIFICATION`** |
| **`LIVE-07`** | **Integración efectiva con API Gateway y `vigor_api`** (incluyendo passthrough de `Authorization`, `X-Vigor-CSRF`, `Cookie`, `Set-Cookie`, CORS `platform_managed` y Domain Mapping de `api.vigorcore.lat`). | **`PENDING_LIVE_VERIFICATION`** |

---

## 6. INVENTARIO DE RECURSOS INTACTOS FUERA DE ETAPA 2

- **NoSQL (`Development`, Etapa 1):** `5` tablas (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`) y `8` GSIs `Active` intactos con `0` registros y `0` bytes.
- **Entorno `Production`:** Sin modificar (`NOT_PROMOTED`).
- **Backend `vigor_api`, `Functions` y `Security Rules`:** Sin crear (`Functions are not created yet!!`).
- **API Gateway:** Deshabilitado (`Enable now`).
- **Domain Mapping y DNS:** Sin mapeos (`Add Mapping`); `api.vigorcore.lat` sin agregar ni resolver.
- **Frontend Slate (`app.vigorcore.lat`), frontend raíz, Firebase y GCP:** Intactos, sin redespliegues ni cambios.

---

## 7. VERIFICACIONES LOCALES Y DICTAMEN DE CIERRE DE ETAPA 2

### 7.1 Verificaciones locales en `poc/catalyst-clean-slate/` (`0` llamadas remotas)
- `npm --prefix poc/catalyst-clean-slate run build` — **OK (`0` errores)**
- `npm --prefix poc/catalyst-clean-slate run build:server` — **OK (`0` errores)**
- `npm --prefix poc/catalyst-clean-slate run frontend:build` — **OK**
- `npm --prefix poc/catalyst-clean-slate test` — **PASS** (incluye `tests/22` y `tests/23`, validando `CatalystHostedAuthBridge.ts`, `phase52Stage2Inventory.ts`, `docs/30` y `docs/31`).

### 7.2 Dictamen Final de Ejecución de Fase 5.2, Etapa 2
**`PHASE_5_2_STAGE_2_NATIVE_AUTH_CONFIGURED_PENDING_LIVE_VERIFICATION`**

- **Qué queda completado y cerrado en Etapa 2 (`Development`):** Native Catalyst Authentication configurada en `Development` mediante **Hosted Login**, `Public Signup: Disabled`, `Social Login` desactivados, `Third-party Authentication` sin configurar, `Custom User Validation: Disabled`, `Authorized Domain: app.vigorcore.lat`, `CORS: Enabled`, `iFrame: Disabled`, `api.vigorcore.lat` no agregado, `Production` sin modificar y evidencia visual directa de **`0` usuarios** en **`Manage Application Users`** (`"Add your first user"`).
- **Qué queda pendiente (`PENDING_LIVE_VERIFICATION` / siguientes autorizaciones):** Verificación CLI read-only opcional (`--live --confirm-readonly`), las 7 validaciones de integración en vivo (`LIVE-01`..`LIVE-07`), y la futura **Fase 5.3** (creación/despliegue de `vigor_api`, API Gateway, Domain Mapping y enlace real con Slate), aún **no** autorizada ni iniciada.
