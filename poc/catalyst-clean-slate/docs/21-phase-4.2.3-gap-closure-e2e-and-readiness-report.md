# FASE 4.2.3 — CIERRE DE BRECHAS FUNCIONALES, VALIDACIÓN E2E EN CHROMIUM Y PREPARACIÓN DE INTEGRACIÓN

**Alcance:** Exclusivo dentro de `poc/catalyst-clean-slate/`  
**Estado:** `CIERRE LOCAL COMPLETO (41/41 RUTAS EN FUENTE ÚNICA · 61/61 PRUEBAS INCLUYENDO [PASS-BROWSER-E2E])`  
**Veredicto de integración remota:** **Preparado localmente para Fase 5 condicionada a confirmación de soporte Zoho Catalyst e `INT-01..INT-08`** (`PENDING_LIVE_VERIFICATION`; **NO** equivale a `[PASS-LIVE]`).  
**Restricción remota preservada:** Cero modificaciones en el frontend raíz (`/src/**`), `package.json` raíz, Zoho Catalyst Slate publicado, DNS/dominios (`app.vigorcore.lat`, `api.vigorcore.lat`), tablas NoSQL remotas, Firebase/Firestore/GCP, usuarios o secretos reales.

---

## 1. Reconciliación de las 11 Operaciones sin Contrato API (`30 → 41` Rutas Canónicas)

Las once operaciones de atleta que permanecían únicamente en memoria local en Fase 4.2.2 fueron reconciliadas e implementadas extremo a extremo en `src/types/cleanSlate.ts`, `src/nosql/cleanSlateEngine.ts`, `src/services/athleteDataService.ts`, `src/routes/routeContracts.ts`, `src/routes/apiRouterSchema.ts`, `src/frontend/contracts/cleanSlateModels.ts`, `src/frontend/adapters/CatalystHttpAthleteRepository.ts`, `src/frontend/mocks/InMemoryCleanSlateRepository.ts` y `src/frontend/views/*`:

| # | Operación UI | Método y Ruta Canónica Añadida | Garantías Backend y Reglas de Negocio |
| --- | --- | --- | --- |
| 1 | `saveBiometrics` | `PUT /api/v1/athlete/biometrics` | Valida rangos fisiológicos (`[20..350] kg`, `[90..260] cm`, `[12..120]` años, PAL `[1.0..2.5]`, deuda/metas) y recalcula calorías/macros en servidor antes de persistir `BIO#CURRENT` en `UserData`. |
| 2 | `savePreferences` | `PUT /api/v1/athlete/preferences` | Valida `weightUnit`, `heightUnit`, días/comidas/equipamiento/preferencias y persiste `PREF#SETTINGS` bajo propiedad exclusiva del actor. |
| 3 | `deleteMeal` | `DELETE /api/v1/athlete/meals/:mealId` | Valida `:mealId` con `SAFE_IDENTIFIER_RE`, busca registro propio del actor (`404 MEAL_NOT_FOUND` si no existe o pertenece a otro atleta — anti-IDOR) y ejecuta borrado condicionado. |
| 4 | `deleteRecipe` | `DELETE /api/v1/athlete/recipes/:recipeId` | Valida `:recipeId` con `SAFE_IDENTIFIER_RE`, exige propiedad exclusiva (`404 RECIPE_NOT_FOUND` en caso contrario) y elimina `RECIPE#<id>`. |
| 5 | `toggleGroceryStatus` | `PATCH /api/v1/athlete/groceries/:groceryId` | Valida `:groceryId` y `status ∈ {'pending','bought'}`; verifica propiedad del actor (`404 GROCERY_NOT_FOUND` ante inexistente/ajeno). |
| 6 | `addManualGrocery` | `PUT /api/v1/athlete/groceries/:groceryId` | Valida `:groceryId`, rechaza inconsistencia `body.id !== params.groceryId` (`400 PARAM_BODY_MISMATCH`), valida límites y persiste ítem individual `GROCERY#<id>`. |
| 7 | `deleteGrocery` | `DELETE /api/v1/athlete/groceries/:groceryId` | Valida `:groceryId` y propiedad del actor (`404 GROCERY_NOT_FOUND`), eliminando `GROCERY#<id>` individualmente sin tocar el resto del plan. |
| 8 | `setDefaultRoutine` | `POST /api/v1/athlete/routines/:routineId/default` | Valida `:routineId`, verifica existencia y propiedad (`404 ROUTINE_NOT_FOUND`), desactiva `isDefault` en rutinas previas y marca la seleccionada como predeterminada. |
| 9 | `deleteCardioSession` | `DELETE /api/v1/athlete/cardio/:cardioId` | Valida `:cardioId`, verifica propiedad del actor (`404 CARDIO_NOT_FOUND`) y elimina el registro `CARDIO#<id>`. |
| 10 | `markNotificationRead` | `PATCH /api/v1/athlete/notifications/:notificationId/read` | Valida `:notificationId`, exige propiedad del actor (`404 NOTIFICATION_NOT_FOUND`) y actualiza estado booleano `read` (`true` por defecto o explícito). |
| 11 | `markAllNotificationsRead` | `POST /api/v1/athlete/notifications/read-all` | Recorre exclusivamente notificaciones del actor autenticado y marca todas las pendientes como leídas, devolviendo `{ updatedCount }`. |

### Excepción administrativa explícita sin ruta de catálogo (`501`)

- **`adminRepo.listInvitations`**: se mantiene explícitamente sin endpoint inventado en `ROUTE_CONTRACT_SPECS` / `CLEAN_SLATE_ENDPOINT_CATALOG`.
- `CatalystHttpAdminRepository.listInvitations()` rechaza **fail-closed** con `CleanSlateRepositoryError('UNSUPPORTED_CONTRACT_ENDPOINT', ..., 501, { origin: 'client_synthetic' })`.
- `AdminConsoleView` captura específicamente `UNSUPPORTED_CONTRACT_ENDPOINT` en modo HTTP y renderiza el aviso visible `"Contrato pendiente (501)"` sin ningún fallback silencioso a datos mock.

---

## 2. Hardening CSRF de Primer Intercambio y Tokens Ligados a Sesión

1. **Política `pre_session_catalyst_exchange` (sin endpoint `/api/v1/auth/csrf` ficticio):**
   - `POST /api/v1/auth/session/bootstrap-profile` y `POST /api/v1/auth/session/exchange` operan antes de existir cookie `__Host-vigor_session`.
   - `HttpSecurityPolicy.validateMutationOriginAndCsrf()` exige para `csrfPolicy: 'pre_session_catalyst_exchange'`:
     - `Origin` exacto en la lista permitida (rechaza ausencia de `Origin` y orígenes externos con `403 ORIGIN_NOT_ALLOWED`).
     - Fetch Metadata no `cross-site` (`Sec-Fetch-Site: cross-site` → `403 CROSS_SITE_REQUEST_BLOCKED`).
     - Cabecera personalizada obligatoria `X-Vigor-Requested-With: VigorCore-CleanSlate` (`403 CSRF_HEADER_REQUIRED` si falta o difiere) para forzar preflight CORS y bloquear envíos simples HTML `<form>`.
     - Credenciales verificadas de Catalyst Authentication (`authPolicy: 'catalyst_exchange'`).
   - El antiguo concepto de `GET /api/v1/auth/csrf` permanece **ausente** (`404 ROUTE_NOT_FOUND`).

2. **Tokens CSRF HMAC emitidos por servidor y ligados a `(sub, sid, ep)` (`signed_session_bound`):**
   - `ServerSessionTokenManager.issueCsrfToken(sub, sid, ep, exp)` firma un token compacto HMAC-SHA256 (`typ: 'csrf'`, `kid`, `iss`, `aud`, `env`, `sub`, `sid`, `ep`, `iat`, `exp`) usando la clave HMAC del servidor.
   - `ServerSessionTokenManager.verifyCsrfToken(raw, { userId, sessionId, sessionEpoch })` verifica en tiempo constante (`crypto.timingSafeEqual`) la firma y valida la coincidencia exacta con la sesión autenticada activa: cualquier token de otro usuario (`sub`), otro dispositivo (`sid`), época revocada (`ep`), token de sesión usado como CSRF (`typ !== 'csrf'`), clave incorrecta o expirado falla con `403` (`CSRF_TOKEN_INVALID` / `CSRF_TOKEN_SESSION_MISMATCH` / `CSRF_TOKEN_EXPIRED`).
   - **Pre-guard antes de revocación:** tanto `POST /api/v1/auth/session/refresh` como `POST /api/v1/auth/session/logout` validan la sesión y verifican el token CSRF ligado **antes** de revocar `SESSION#<sid>` en `SystemControl`.
   - **Almacenamiento exclusivo en RAM e hidratación post-recarga:** `ServerCsrfTokenProvider` y `CatalystHttpTransport` almacenan el CSRF únicamente en memoria JavaScript a partir de respuestas del servidor (`X-Vigor-CSRF-Token` / `{ csrfToken }`). Tras un `page.reload()`, `WorkspaceContext` invoca `GET /api/v1/auth/me` con `credentials: 'include'` para rehidratar el CSRF ligado a la cookie `__Host-vigor_session` sin tocar `localStorage`, `sessionStorage` ni `document.cookie`.

---

## 3. Cierre Completo del Ciclo de Vida de Sesión (Fase 4.1.5)

Implementado íntegramente en `CleanSlateAuthGuard` y `CleanSlateApiDispatcher`:

1. **Inactividad máxima (`12h`) y vida absoluta máxima (`24h`):**
   - `issueSignedSession()` registra `issuedAtEpochSec`, `initialAuthAtEpochSec`, `expiresAtEpochSec` (`<= +12h`) y `absoluteExpiresAtEpochSec` (`initialAuthAtEpochSec + 24h`), acotando `TTL` al menor entre `12h` y el remanente hasta `24h`.
   - `authenticate()` verifica explícitamente `expiresAtEpochSec > nowSec` y `absoluteExpiresAtEpochSec > nowSec` (`401 SESSION_MAX_LIFETIME_REACHED`), sin depender de la recolección asíncrona TTL de NoSQL.
2. **Rotación de `sid` en `refreshSignedSession` y ventana de gracia `<= 5s` vs replay:**
   - Al rotar en `/api/v1/auth/session/refresh`, `SESSION#<oldSid>` pasa atómicamente a `status: 'revoked'`, `revocationReason: 'session_rotated'` y `rotatedAtEpochSec: nowSec` antes de emitir `SESSION#<newSid>`.
   - Reutilizar `oldSid` en lecturas/peticiones normales dentro de `<= 5s` recibe `401 SESSION_ROTATED_RETRY` sin invalidación global (gracia para peticiones en vuelo).
   - Reutilizar `oldSid` pasado el umbral de `> 5s` **o** en `/session/refresh` dispara detección de replay: incrementa atómicamente `Users.sessionEpoch` (`sessionEpoch++`), limpia la cookie (`Max-Age=0`) y responde `401 SESSION_REPLAY_DETECTED`.
3. **Revalidación periódica contra Catalyst (`getUserDetails` cada `<= 15 minutos`):**
   - `authenticate()` opera en modo **cookie-only** (`authPolicy: 'hmac_session'`) para todas las rutas protegidas de rutina sin requerir cabeceras Catalyst en cada petición.
   - Si transcurrieron `>= 900s` desde `lastCatalystCheckAtEpochSec` (o si la ruta tiene `requiresCatalystLiveCheck: true`, como `/auth/session/refresh`), ejecuta `enforceCatalystLiveRevalidation()`.
   - **Coalescing concurrente:** `inFlightCatalystChecks` comparte una única llamada `getUserDetails(userId)` entre peticiones paralelas de la misma sesión (`userId:sid`).
   - **Fail-closed en fallo transitorio (`503`):** errores de comunicación con Catalyst devuelven `503 CATALYST_REVALIDATION_UNAVAILABLE` sin limpiar la cookie y sin adelantar `lastCatalystCheckAtEpochSec`.
   - **Cuenta eliminada o deshabilitada:** `null` (`401 CATALYST_USER_DELETED`) o estado distinto de `ACTIVE` (`403 CATALYST_USER_DISABLED`) revocan la sesión, incrementan `Users.sessionEpoch` y emiten `Set-Cookie` de limpieza (`Max-Age=0`).
   - **Seguridad ante carreras con `logout` o rotación:** `lastCatalystCheckAtEpochSec` se actualiza condicionalmente en `SystemControl` exigiendo `status === 'active'`. Si `logout` cerró la sesión mientras `getUserDetails` estaba en vuelo, la actualización falla y la petición en curso devuelve `401 SESSION_REVOKED_REAUTH_REQUIRED`. Además, `logoutSession` pasa `skipCatalystLiveRevalidation: true` para garantizar que el usuario siempre pueda cerrar su sesión local incluso si Catalyst está lento o temporalmente caído, y `enforceCatalystLiveRevalidation` omite la escritura redundante de `lastCatalystCheckAtEpochSec` cuando `isRefreshRequest === true` porque `refreshSignedSession` revoca inmediatamente `oldSid`.

---

## 4. Validación E2E en Navegador Real Chromium (`[PASS-BROWSER-E2E]`)

La suite `tests/14-browser-e2e.test.ts` ejecuta **Chromium headless real (`playwright-core`)** contra el bundle compilado `dist-frontend/` servido por un servidor Express local efímero (`http://localhost:<puerto>`), conectado a `CleanSlateApiDispatcher`, `CleanSlateInMemoryNoSQLAdapter` y `MockCatalystAuthRuntime`:

- **Aclaración explícita de alcance (`[PASS-BROWSER-E2E]`, NO `[PASS-LIVE]`):** esta prueba valida el SPA compilado, cookies reales del navegador, CSRF en RAM, DOM, formularios, eventos React y protocolo HTTP real contra el backend Clean-Slate en **localhost** con runtime Catalyst mock y NoSQL en memoria; **no** sustituye ni simula pruebas contra el entorno remoto Zoho Slate / Advanced I/O / `api.vigorcore.lat`.
- **Cobertura verificada en Chromium:**
  1. **Modo Mock Dev UI (`/`):** navegación completa de vistas, cambio a persona administrativa (`AdminConsoleView` + `Invitaciones RBAC` y `Directorio de Usuarios`), simulador de fallos (`empty_workspace`, `network_error`, restauración), viewport móvil `375x812` con apertura del cajón lateral y aserción de **cero desbordamiento horizontal** (`scrollWidth <= innerWidth + 1`) y **cero errores** `pageerror` / `console.error`.
  2. **Modo HTTP Adaptador (`/?mode=http`):**
     - Arranque no autenticado muestra estado de fallo controlado (`401`, botón `Reintentar carga`) con **cero fallback silencioso a mock**.
     - Bootstrap real (`POST /api/v1/auth/session/bootstrap-profile` con `X-Vigor-Requested-With`), limpieza inmediata de identidad Catalyst en request para demostrar operación **100% cookie-only** (`hmac_session`).
     - Verificación en el jar de cookies de Chromium de `__Host-vigor_session` (`httpOnly: true`, `sameSite: Strict`, `path: '/'`), `document.cookie === ''`, `localStorage.length === 0`, `sessionStorage.length === 0`.
     - Ocultamiento de controles dev (`Selector de persona`) y navegación administrativa para atleta.
     - Ejecución real en navegador de las brechas reconciliadas y flujos críticos: perfil, biometría, preferencias, prueba de bloqueo de spoofing de rol, crear/eliminar comida, agregar/alternar/eliminar artículo en compras, crear/eliminar cardio, generar mesociclo, iniciar sesión de entrenamiento, registrar serie, completar sesión y comprobar bloqueo inmutable `409`, crear notificaciones, marcar individual y marcar todas como leídas.
     - **`page.reload()` completo:** preserva datos desde backend y rehidrata el CSRF ligado vía `GET /api/v1/auth/me` manteniendo `localStorage` y `sessionStorage` vacíos.
     - Llamada directa a `/api/v1/admin/stats` como atleta devuelve `403 PERMISSION_DENIED`.
     - Botón `Cerrar sesión` revoca la sesión en servidor, elimina la cookie del navegador y bloquea la recarga posterior (`401`).
     - Flujo Admin en `?mode=http` renderiza `Consola Administrativa · Adaptador HTTP Clean-Slate (/api/v1/admin/*)` y muestra el banner honesto `"Contrato pendiente (501)"` para `listInvitations`.

---

## 5. Estado Consolidado de Catálogo, Compilación y Verificación

- **Paridad de Fuente Única de Verdad:** `41 / 41` rutas únicas en `ROUTE_CONTRACT_SPECS`, `ROUTE_DEFINITIONS`, `CLEAN_SLATE_ENDPOINT_CATALOG` y `CLEAN_SLATE_UI_ENDPOINT_MAP`, con `0` rutas huérfanas, `0` desfases y `1` operación cliente explícitamente `501 UNSUPPORTED_CONTRACT_ENDPOINT` (`adminRepo.listInvitations`).
- **Resultados reproducidos al cierre de Fase 4.2.3:**
  - `npm --prefix poc/catalyst-clean-slate run frontend:build` (Vite v8.3.4): **PASS** (`dist-frontend/` compilado sin errores).
  - `npm --prefix poc/catalyst-clean-slate run build` (`tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.frontend.json`): **PASS** (`0` errores TypeScript en backend y frontend).
  - `npm --prefix poc/catalyst-clean-slate test` (`14` archivos de prueba): **61 / 61 PASS (`0` fallos)** cubriendo `tests/01` .. `tests/14`, incluyendo:
    - `tests/12`: matriz completa de paridad y seguridad de las 41 rutas + loopback HTTP real (`[PASS-UNIT]` / `[PASS-MOCK / LOOPBACK]`).
    - `tests/13`: matriz adversarial de CSRF de primer intercambio, CSRF ligado, ventana `12h`/`24h`, rotación y gracia `<=5s` vs replay, coalescing `getUserDetails`, `503` fail-closed y carrera de `logout` (`[PASS-UNIT / MOCK]`).
    - `tests/14`: E2E real en Chromium headless (`[PASS-BROWSER-E2E]`).

---

## 6. Matriz de Seguridad Verificada (41 Rutas + Preflight `OPTIONS`)

| Control de Seguridad | Cobertura Verificada | Evidencia Local |
| --- | --- | --- |
| **CORS Estricto y Preflight `OPTIONS`** | Exactitud de origen permitido (cero wildcard con credenciales); permite `Content-Type`, `X-Vigor-CSRF`, `X-Vigor-Requested-With`; rechaza `Authorization` y orígenes ajenos (`403 ORIGIN_NOT_ALLOWED`). | `tests/07`, `tests/12`, `tests/13` |
| **Cookie `__Host-vigor_session`** | Atributos `HttpOnly; Secure; SameSite=Strict; Path=/` en emisión y `Max-Age=0` en cierre/revocación; ilegible desde `document.cookie`. | `tests/07`, `tests/13`, `tests/14` |
| **CSRF Dual (Primer Intercambio + Sesión Ligada)** | `pre_session_catalyst_exchange` exige `Origin` + Fetch Metadata no `cross-site` + `X-Vigor-Requested-With`; mutaciones autenticadas exigen CSRF HMAC ligado a `(sub, sid, ep)` y fail-closed en cliente antes de `fetch`. | `tests/11`, `tests/12`, `tests/13`, `tests/14` |
| **Anti-Spoofing de Identidad** | Rechaza cabeceras/query/body forjados (`role`, `uid`, `userId`, `sessionEpoch`, `roleVersion`, `x-vigor-session-*`, etc.) con `403 IDENTITY_SPOOFING_REJECTED`. | `tests/01`, `tests/12` |
| **Anti-IDOR entre Atletas** | Todas las mutaciones y borrados individuales (`DELETE /meals/:id`, `/recipes/:id`, `/groceries/:id`, `/cardio/:id`, `PATCH /groceries/:id`, `/notifications/:id/read`, `POST /routines/:id/default`, `workouts/*`) exigen pertenencia estricta al `sub` autenticado (`404` / `403`). | `tests/01`, `tests/12` |
| **RBAC y Bloqueo Superadmin (`403`)** | Atleta bloqueado en todas las rutas `/admin/*` (`403 PERMISSION_DENIED`); rutas de rol y objetivos superadmin bloqueadas (`403 SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED`); auto-suspensión bloqueada. | `tests/04`, `tests/12`, `tests/14` |
| **Inmutabilidad Terminal (`409`)** | Entrenamientos `completed` / `abandoned` rechazan registro de series o re-completado (`409`); invitaciones `revoked` / `redeemed` mantienen máquina de estados terminal. | `tests/02`, `tests/12`, `tests/14` |

---

## 7. Hallazgos Técnicos Detectados y Resueltos Durante la Fase

1. **Bug real de navegador en `CatalystHttpTransport` (`Failed to execute 'fetch' on 'Window': Illegal invocation`):**
   - Las pruebas unitarias/loopback en Node no lo detectaron porque usaban implementaciones `fetch` simuladas; Chromium real en `tests/14` lo reveló de inmediato al invocar `this.fetchImpl(...)` con `this` apuntando a `CatalystHttpTransport` en lugar de `globalThis`.
   - **Corrección:** `resolvedFetch.call(globalThis, input, init)` dentro de `src/frontend/adapters/httpTransport.ts`.
2. **Disponibilidad de cierre de sesión (`logoutSession`) ante indisponibilidad de Catalyst:**
   - Se incorporó `skipCatalystLiveRevalidation: true` en `logoutSession` (`CleanSlateAuthGuard`) y en el pre-chequeo de `POST /api/v1/auth/session/logout` (`apiRouterSchema.ts`) para evitar que un fallo/latencia de `getUserDetails` impida cerrar la sesión local o distorsione la ventana de revalidación concurrente.
3. **Evitar escritura NoSQL redundante en `/api/v1/auth/session/refresh`:**
   - Durante `refreshSignedSession`, `enforceCatalystLiveRevalidation` ya no realiza un `updateItem` superfluo de `lastCatalystCheckAtEpochSec` sobre `SESSION#<oldSid>` cuando `isRefreshRequest === true`, puesto que inmediatamente se revoca `oldSid` y se emite `SESSION#<newSid>` con `lastCatalystCheckAtEpochSec = nowSec` (preservando además la recuperación determinística `TIMEOUT_AFTER_APPLY` en `revokeActiveSessionWithTimeoutRecovery`).
4. **Resiliencia UI ante workspace recién creado (`ProfileBiometricsView.tsx`) y accesibilidad:**
   - Se añadieron respaldos defensivos con coalescencia nula al sincronizar `bio` y `pref` parciales en `ProfileBiometricsView.tsx` para prevenir fallos ante propiedades opcionales ausentes.

---

## 8. Dependencias Abiertas y Criterios Bloqueantes en Dominio Real

Antes de pasar de validación local a despliegue o pruebas reales sobre `https://app.vigorcore.lat` y `https://api.vigorcore.lat`, siguen abiertos estos bloqueadores externos/remotos (ver `docs/17`):

1. **Confirmación oficial de Zoho Catalyst Support (`INT-01..INT-04`):**
   - Soporte de dominio personalizado compartido para Catalyst Advanced I/O (`api.vigorcore.lat`) con Slate (`app.vigorcore.lat`).
   - Confirmación empírica de que `__Host-vigor_session` (`Set-Cookie` + reenvío de `Cookie`) no sea filtrada, reescrita ni interferida por el ingress/CDN de Catalyst, incluyendo comportamiento bajo **Safari / WebKit ITP** (`SameSite=Strict` en subdominio hermano `api.` desde `app.`).
2. **Aprovisionamiento manual controlado de las 5 tablas Catalyst NoSQL:**
   - `Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl` con los PK/SK/GSI e índices congelados en `docs/08` y `docs/12` (sigue **prohibido** aprovisionarlas hasta autorización explícita).
3. **Verificación de integración viva en Catalyst (`INT-05..INT-08` y `BR-01..BR-20`):**
   - `resetPassword()` administrativo bajo Modelo B (`INT-08`), atomicidad real de mutaciones `superadmin` en NoSQL remoto, validación de SDK real `@zcatalyst/auth` (`getUserDetails`) en función Advanced I/O desplegada, y ejecución controlada de `tests/06-integration-catalyst-live.spec.ts` en un proyecto/sandbox autorizado.
4. **Contrato administrativo pendiente (`501`):**
   - Definición futura (si el operador la aprueba) de `GET /api/v1/admin/invitations` para listar invitaciones existentes sin exponer tokens ni romper límites de lectura Catalyst.

---

## 9. Veredicto Final de Fase 4.2.3

- **Estado alcanzado:** Cierre funcional y adversarial local completado al 100% dentro de `poc/catalyst-clean-slate/` (`41/41` rutas en fuente única, `0` fallos de compilación, `61/61` pruebas locales aprobadas incluyendo `[PASS-BROWSER-E2E]` en Chromium real, y detección/reparación real de `fetch` en navegador).
- **Veredicto honesto de despliegue:** **Preparado localmente para Fase 5 condicionada a la respuesta de Zoho Catalyst Support e integración viva `INT-01..INT-08`**. No existe autorización para modificar producción, DNS ni recursos remotos.
