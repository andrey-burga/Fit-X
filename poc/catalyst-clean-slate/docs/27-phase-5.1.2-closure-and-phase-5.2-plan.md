# VIGORCORE — CIERRE DE INVENTARIO REMOTO, CONCILIACIÓN FINAL DE FASE 5.1.2 Y PLAN DE EJECUCIÓN DE SIGUIENTE FASE

**Proyecto / Workspace:** Fit-X (Google AI Studio) — exclusivamente dentro de `poc/catalyst-clean-slate/`  
**Fecha de revisión final:** 18 de noviembre de 2026  
**Basado en:** `docs/24` (Fase 5.1.1), `docs/25` (Fase 5.1.2), `docs/26` (Inventario read-only) e inspección visual real del operador en Zoho Catalyst Console sobre **`Project-Rainfall`** (`CATALYST_PROJECT_ID: 136967000000014024`)  
**Operaciones remotas ejecutadas:** **0** *(cero escrituras, cero tablas creadas, cero configuraciones de Auth, cero despliegues, cero cambios en API Gateway o DNS)*  

**Dictamen final de cierre de preparación:**
- **Preparación Fase 5.1.2:** **`PHASE_5_1_2_CLOSED_READY_FOR_PHASE_5_2`** *(Fase 5.1.2 cerrada documental y operativamente; `Project-Rainfall` / `136967000000014024` verificado sin colisiones de NoSQL ni funciones heredadas)*
- **Cutover de dominio API (`api.vigorcore.lat`):** **`BLOCKED_PENDING_ZOHO_CLARIFICATION`** *(mantiene bloqueada la Etapa 5; no bloquea la Fase 5.2 de tablas NoSQL ni la inicialización de Native Auth)*

---

## 1. Registro del Catalyst Project ID (`136967000000014024`) y Verificación de No-Contradicción

- **Proyecto confirmado:** `Project-Rainfall`
- **Catalyst Project ID confirmado:** **`136967000000014024`** *(identificador público no secreto para `CATALYST_PROJECT_ID`, distinto de `CATALYST_PROJECT_KEY`, `X_ZOHO_CATALYST_ORG_ID` y `ZAID`)*.
- **Comprobación cruzada en toda la POC (`poc/catalyst-clean-slate/`):**
  1. `.env.example`, `config/candidates/catalyst-function.template.json` y `config/candidates/alternative-b-api-gateway.routes.json` contenían únicamente el placeholder `<CATALYST_PROJECT_ID>` sin IDs reales hardcodeados.
  2. Las suites de pruebas (`tests/15`, `tests/17`, `tests/19`) solo usaban IDs sintéticos (`'00000000000'`, `'proj_prep_512'`, `'proj_real_777'`).
  3. El único identificador numérico real observado previamente en la POC era `16391000000005003` dentro del CNAME público de **Catalyst Slate** (`slate-16391000000005003-us.nimbuspop.com`). Dicho número pertenece al **recurso de hospedaje Slate**, **no** al `CATALYST_PROJECT_ID` del proyecto (`136967000000014024`), por lo que **no existe contradicción** entre ambos identificadores.
  4. Validado contra `runCatalystConfigPreflight()`: `136967000000014024` pasa la validación de formato no-placeholder para `CATALYST_PROJECT_ID`.

---

## 2. Conciliación con Fases 5.1.1 y 5.1.2 (Evidencia Directa vs Inferencia)

| Dato Observado por el Operador | Evidencia Directa vs Límite de Inferencia | Conciliación con Fase 5.1.1 (`docs/24`) y Fase 5.1.2 (`docs/25` / `docs/26`) |
| --- | --- | --- |
| **Data Center:** `US` (`accounts.zoho.com`) | **Evidencia directa (`VERIFIED_REMOTE`):** DC US confirmado vía `accounts.zoho.com` y coherente con CNAME Slate `*-us.nimbuspop.com`. | Valida `CATALYST_ACCOUNTS_URL=https://accounts.zoho.com` y `CATALYST_API_DOMAIN=https://api.catalyst.zoho.com`. |
| **Proyecto:** `Project-Rainfall` (`136967000000014024`) | **Evidencia directa (`VERIFIED_REMOTE`):** Nombre y Project ID público confirmados. *Pendiente:* confirmar nombres exactos de entornos (`Development`/`Production`) y `Org ID` (si aplica). | Resuelve la ambigüedad multi-proyecto sin contradecir ningún archivo de la POC. |
| **Functions:** `Functions are not created yet!!` | **Evidencia directa (`VERIFIED_REMOTE`):** `0` funciones previas (`Basic I/O`, `Advanced I/O`, `Cron`, `Event`). | Confirma ausencia de funciones heredadas; `vigor_api` se creará en Etapa 3. |
| **Security Rules:** `Functions are not created yet!!` | **Evidencia directa (`VERIFIED_REMOTE`):** Sin funciones heredadas previas ni reglas previas dependientes. **Límite estricto:** NO significa que el impacto de `apig:enable` sea nulo sobre la futura `vigor_api` (ver Sección 4). | Solo descarta exposición de funciones heredadas previas; todos los controles para proteger `vigor_api` permanecen obligatorios. |
| **API Gateway:** `Enable now` | **Evidencia directa (`NOT_CONFIGURED`):** API Gateway deshabilitado (`0` rutas previas). | Confirma ausencia de rutas en conflicto con `alternative-b-api-gateway.routes.json`. |
| **NoSQL:** `Create your first table` | **Evidencia directa (`NOT_CONFIGURED`):** `0` tablas existentes. | Cero colisiones con `Users`, `UserData`, `AdminInvitations`, `AuditLogs` y `SystemControl`; habilita Fase 5.2 (Etapa 1). |
| **Authentication:** Native & Third-party muestran `Set Up` | **Evidencia directa:** Ambos métodos muestran `Set Up` (`NOT_CONFIGURED`). **Corrección crítica (Evidencia vs Inferencia):** aunque `Set Up` hace plausible **inferir** `0` usuarios de aplicación al no existir un flujo configurado, **NO se inspeccionó directamente el recuento/listado de usuarios** (`NOT_DIRECTLY_INSPECTED`). | Exige dos acciones separadas en Etapa 2: (1) configurar únicamente **Native Catalyst Authentication (`Set Up`)**, y (2) inspeccionar directamente **`Authentication > Users`** (en `Development` y `Production`) para verificar `conteo = 0` por evidencia directa antes del bootstrap. |
| **Domain Mapping:** únicamente aparece `Add Mapping` | **Evidencia directa (`PENDING_ZOHO_CLARIFICATION`):** Sin mapeos visibles pese a que `app.vigorcore.lat` opera en Slate. | Prueba que Slate gestiona su dominio fuera de `CloudScale > Domain Mapping`. Mantiene bloqueada Etapa 5 (`api.vigorcore.lat`) hasta aclaración escrita de Zoho. |
| **DNS:** `api.vigorcore.lat` no resuelve | **Evidencia directa (`NOT_CONFIGURED`):** Confirmado por consola y por sonda DNS read-only (`ENOTFOUND`). | Estado esperado previo a Etapa 5. |
| **Frontend Slate:** `app.vigorcore.lat`, dominio existente y SSL activo | **Evidencia directa (`VERIFIED_REMOTE`):** Dominio activo y SSL operativo en Slate (`slate-16391000000005003-us.nimbuspop.com`). | Intacto; cero modificaciones sobre Slate ni sobre el frontend raíz. |
| **Authorized Domains (`Whitelisting`):** no reportado aún | **Estado (`PENDING_OPERATOR`):** No inspeccionado en este pase visual. | Inspeccionar read-only antes de Etapa 4 (exigir `https://app.vigorcore.lat`, cero `*`). |

---

## 3. Análisis de `--auth-mode external_oauth` en `verify-clean-slate-provisioning.ts` vs `VIGOR_CATALYST_AUTH_MODE=hosted_native`

> **Conclusión directa:** En `scripts/verify-clean-slate-provisioning.ts --live --confirm-readonly`, `--auth-mode external_oauth` representa **exclusivamente la autenticación administrativa OAuth del operador/CLI local**; **NO** modifica Catalyst Authentication ni altera el modo de autenticación de la aplicación (`VIGOR_CATALYST_AUTH_MODE=hosted_native` dentro de `vigor_api` ni el inicio de sesión web de Slate).

1. **Por qué `--live --confirm-readonly` exige `external_oauth`:**
   - Según `scripts/verify-clean-slate-provisioning.ts` (líneas 111–145), el verificador CLI corre **fuera** del runtime alojado de Catalyst Advanced I/O (estación del operador).
   - En ese entorno externo, Catalyst Edge no inyecta cabeceras internas de petición (`x-zc-admin-cred-token`, `x-zc-project-key`), por lo que el script **rechaza de forma fail-closed** `--auth-mode hosted_native` con `HOSTED_NATIVE_UNAVAILABLE_OUTSIDE_ADVANCED_IO`.
   - En su lugar, utiliza `CatalystAdminAppProvider` (`@zcatalyst/auth-admin`) con las credenciales administrativas OAuth del operador (`CATALYST_ADMIN_CLIENT_ID` / `SECRET` / `REFRESH_TOKEN` o `CATALYST_ADMIN_ACCESS_TOKEN` efímero + `CATALYST_PROJECT_KEY` + `CATALYST_PROJECT_ID=136967000000014024`) para leer únicamente metadatos de las 5 tablas y 8 GSIs vía `@zcatalyst/nosql`.
2. **Relación con `VIGOR_CATALYST_AUTH_MODE=hosted_native` en producción/despliegue:**
   - La función Advanced I/O alojada `vigor_api` opera independientemente con **`VIGOR_CATALYST_AUTH_MODE=hosted_native`** (`new ZCAuth().init({ headers }, { type: 'advancedio', scope })`), sin requerir secretos `CATALYST_ADMIN_*` del operador.
   - El único escenario en que `vigor_api` cambiaría a `VIGOR_CATALYST_AUTH_MODE=external_oauth` sería si, en pruebas vivas de Etapa 3/4 (Fase 5.3), el API Gateway en rutas `NO_AUTHENTICATION` no inyectara `x-zc-admin-cred-token` (fallback documentado en `ADR-002`); nunca por efecto de ejecutar el verificador CLI de Fase 5.2.
3. **Implicación práctica para Fase 5.2:**
   - Para ejecutar la verificación CLI automatizada tras crear las tablas en Fase 5.2 (`--live --confirm-readonly --auth-mode external_oauth --expected-project 136967000000014024`), el operador requerirá credenciales OAuth administrativas temporales o de servicio en su estación. Si aún no desea generar credenciales OAuth del operador en Fase 5.2, puede completar primero la inspección visual de las tablas en Consola y diferir la corrida `--live --confirm-readonly` hasta emitir las credenciales OAuth read-only del operador.

---

## 4. Alcance Exacto del Impacto de `catalyst apig:enable` sobre Project Security Rules

- **Lo único acotado como nulo (evidencia verificada):** En `Project-Rainfall` (`136967000000014024`) no existen funciones previas (`Functions are not created yet!!`), por lo que el riesgo de que `catalyst apig:enable` desactive reglas preexistentes y exponga **funciones heredadas de terceros** es actualmente cero (sujeto a reconfirmar antes de Etapa 4 que no se hayan creado otras funciones).
- **Por qué el impacto futuro sobre `vigor_api` NO es nulo:** Al ejecutar `catalyst apig:enable`, **Project Security Rules se desactiva globalmente para todo el proyecto Catalyst**. Por tanto, la futura función **`vigor_api` no estará protegida por Project Security Rules** y dependerá íntegramente de:
  1. Rutas explícitas del API Gateway (`alternative-b-api-gateway.routes.json`, 41 rutas + `OPTIONS` + `/health`, sin exponer rutas internas no mapeadas).
  2. Autenticación Gateway `CATALYST_USERS_AUTHENTICATION` (o fallback verificado) en `/api/v1/auth/session/bootstrap-profile` y `/exchange`.
  3. Defensa fail-closed interna en `vigor_api` sobre las 41 rutas: verificación HMAC `__Host-vigor_session`, consulta consistente `SESSION#<sid>` y `Users`, token `X-Vigor-CSRF` ligado a sesión, matriz `RBAC`, `anti-IDOR`, pinning `x-zc-projectid=136967000000014024` y bloqueo `403` ante `x-zc-user-type: admin`.
  4. `CloudScale > Whitelisting > Authorized Domains` limitado a `https://app.vigorcore.lat` (cero `*`), prueba post-activación de exposición directa de `/server/vigor_api/*`, y rollback inmediato mediante `catalyst apig:disable`.

---

## 5. Matriz Actualizada de Inventario Remoto (`Project-Rainfall` — `136967000000014024`)

| ID | Recurso / Área | Estado Reconciliado | Evidencia Observada / Límite | Acción Requerida Antes de Operar |
| --- | --- | --- | --- | --- |
| `CON-DC-US` | Data Center / Región | `VERIFIED_REMOTE` | US (`accounts.zoho.com` + CNAME Slate `*-us.nimbuspop.com`). | Ninguno. |
| `CON-PROJECT` | Proyecto (`Project-Rainfall`) y `CATALYST_PROJECT_ID` | `VERIFIED_REMOTE` | `Project-Rainfall`, ID **`136967000000014024`** (sin contradicción con `16391000000005003` de Slate DNS). | Confirmar entornos exactos (`Development`/`Production`) y `X_ZOHO_CATALYST_ORG_ID` (si aplica). |
| `CON-FUNCTIONS` | Serverless Functions | `VERIFIED_REMOTE` | `Functions are not created yet!!` (`0` funciones heredadas). | Desplegar `vigor_api` en Etapa 3. |
| `CON-SECURITY-RULES` | Project Security Rules | `VERIFIED_REMOTE` | `0` funciones heredadas; impacto futuro sobre `vigor_api` **NO nulo** tras `apig:enable`. | Mantener íntegros los controles Gateway + Express + prueba de exposición directa `/server/vigor_api/*`. |
| `CON-API-GATEWAY` | API Gateway | `NOT_CONFIGURED` | Botón `Enable now` (`Disabled`, `0` rutas previas). | Validar cuotas/costes; mantener deshabilitado hasta Etapa 4. |
| `CON-NOSQL` | CloudScale NoSQL (5 tablas / 8 GSIs) | `NOT_CONFIGURED` | `Create your first table` (`0` tablas). | Autorización explícita Fase 5.2 para crear 5 tablas vacías en `136967000000014024`. |
| `CON-AUTH` | Catalyst Authentication | `NOT_CONFIGURED` | Native & Third-party en `Set Up`. Recuento de usuarios **`NOT_DIRECTLY_INSPECTED`** (inferencia no sustituye evidencia). | Activar solo Native Auth (`Set Up`) en Etapa 2 e inspeccionar directamente `Authentication > Users` confirmando `0` usuarios antes del bootstrap. |
| `CON-DOMAIN-MAPPING` | CloudScale > Domain Mapping (`api.vigorcore.lat`) | **`BLOCKED_PENDING_ZOHO_CLARIFICATION`** | Solo aparece `Add Mapping` (diferenciado de Web Client Hosting y de Slate). | Esperar aclaración escrita de Zoho antes de Etapa 5. |
| `CON-DNS-API` | DNS `api.vigorcore.lat` | `NOT_CONFIGURED` | No resuelve (`ENOTFOUND` / NXDOMAIN). | No crear CNAME hasta Etapa 5 con respuesta de Zoho. |
| `CON-SLATE-APP` | Frontend Slate (`app.vigorcore.lat`) | `VERIFIED_REMOTE` | Dominio existente en Slate y SSL activo. | Intacto; no modificar ni usar Web Client Hosting. |
| `CON-AUTH-DOMAINS` | `CloudScale > Whitelisting > Authorized Domains` | `PENDING_OPERATOR` | No inspeccionado en este pase visual. | Inspeccionar read-only antes de Etapa 4 (`https://app.vigorcore.lat`, cero `*`). |

---

## 6. Diferenciación Explícita de Dominios y Compuerta Abierta (`api.vigorcore.lat`)

1. **Catalyst Slate (`https://app.vigorcore.lat`):** Dominio propio gestionado en Slate (`CNAME -> slate-16391000000005003-us.nimbuspop.com`, SSL activo), independiente de `CloudScale > Domain Mapping`. **No tocar.**
2. **CloudScale > Domain Mapping para Web Client Hosting:** Mapea dominios a una app de Web Client Hosting. **No aplica a VigorCore** y no debe sobrescribir Slate.
3. **Dominio personalizado de API Gateway para Advanced I/O (`https://api.vigorcore.lat`):** Compuerta mantenida como **`BLOCKED_PENDING_ZOHO_CLARIFICATION`** hasta confirmación oficial escrita de Zoho sobre el destino exacto en `CloudScale > Domain Mapping -> Add Mapping` (sin Web Client Hosting), el CNAME US exacto y la no interferencia con Slate (`app.vigorcore.lat`).

---

## 7. Secuencia Técnica de Aprovisionamiento y Prerrequisitos de Fase 5.2

> **Orden estricto (NO ejecutado en Fase 5.1.2):**

| Etapa | Fase | Operación Técnica | Dependencias y Prerrequisitos | Costes y Cuotas | Verificación y Criterio `STOP` |
| --- | --- | --- | --- | --- | --- |
| **Etapa 1** | **Fase 5.2** *(Siguiente)* | Crear 5 tablas NoSQL + 8 GSIs en orden: `Users` → `UserData` → `AdminInvitations` → `AuditLogs` → `SystemControl` en `Project-Rainfall` (`136967000000014024`). | Autorización Fase 5.2; confirmar entornos (`Development` / `Production`) y `X_ZOHO_CATALYST_ORG_ID` (si aplica). | Nivel gratuito inicial cubre tablas vacías; RCU/WCU y almacenamiento según plan. **Claves/GSIs/TTL inmutables.** | Verificar `ttlEpochSec = Number` y 11 cols en `GSI_Directory`; correr `verify-clean-slate-provisioning.ts --live --confirm-readonly --auth-mode external_oauth --expected-project 136967000000014024` (auth admin solo de CLI). `STOP` ante cualquier desvío. |
| **Etapa 2** | **Fase 5.2 / Pre-Deploy Auth** | Activar únicamente **Native Catalyst Authentication** (`Set Up`); dejar Third-party sin activar. | URL retorno reset password hacia `https://app.vigorcore.lat/...`; política de registro controlado y remitente de correo. | MAU y cuota de correos transaccionales/reset según plan. | Inspección **directa** de `Authentication > Users` en `Development` y `Production` verificando **`0` usuarios reales** antes del bootstrap + anotar `ZAID` público si lo usa Slate. |
| **Etapa 3** | **Fase 5.3** *(Backend)* | Compilar `build:server` (`dist/server/catalystEntry.js`) y desplegar `vigor_api` (`Node 22`, `hosted_native`). | Etapas 1–2 completas; cargar `CATALYST_PROJECT_ID=136967000000014024`, `VIGOR_CATALYST_AUTH_MODE=hosted_native`, `VIGOR_CORS_MODE=platform_managed`, `VIGOR_SESSION_HMAC_SECRET`, sin `ZC_SECURE`; tener fallback `external_oauth` fuera del repo. | Invocaciones Advanced I/O, GB-segundos Node 22 y egress según plan. | Probar `GET /health` en `Development` (`200`, `routeCount: 41`, 0 secretos) y verificar presencia de `x-zc-admin-cred-token` / `x-zc-projectid=136967000000014024`. |
| **Etapa 4** | **Fase 5.3** *(Gateway)* | Configurar `Authorized Domains` (`https://app.vigorcore.lat`, 0 `*`) y habilitar **API Gateway**. | Etapa 3 sana; inspeccionar `Authorized Domains`; confirmar 0 funciones de terceros; cargar 41 rutas + `OPTIONS` + `/health`. **Mantener controles completos sobre `vigor_api` tras desactivarse Security Rules.** | Cuota de peticiones API Gateway / CloudScale según plan Catalyst; desactiva Security Rules globalmente. | Validar `INT-06`, `INT-08`, CSRF/Origin y exposición directa `/server/vigor_api/*`. Rollback: `catalyst apig:disable`. |
| **Etapa 5** | **Fase 5.4** *(BLOQUEADA)* | Mapeo personalizado `api.vigorcore.lat` + DNS `CNAME` + SSL. | Etapa 4 operativa **+ respuesta oficial Zoho (`BLOCKED_PENDING_ZOHO_CLARIFICATION`)**. | Cuota de dominios personalizados, SSL y propagación DNS. | Validar `https://api.vigorcore.lat/health`, `app.vigorcore.lat` intacto, y `INT-07` / `BR-01..BR-20` en Chromium y Safari/WebKit. |

---

## 8. Dictamen Final Actualizado

- **¿Sigue cerrada la Fase 5.1.2?** **SÍ.** La Fase 5.1.2 permanece **CERRADA** bajo el dictamen **`PHASE_5_1_2_CLOSED_READY_FOR_PHASE_5_2`** *(cero operaciones remotas realizadas; Project ID `136967000000014024` / `Project-Rainfall` conciliado sin contradicciones; distinción estricta entre evidencia directa e inferencia en Authentication; aclarado que `--auth-mode external_oauth` del verificador CLI es únicamente administrativo del operador y no altera `hosted_native`; acotado el alcance nulo de Security Rules solo a funciones heredadas previas preservando todas las defensas de `vigor_api`; y compuerta de dominio API mantenida en `BLOCKED_PENDING_ZOHO_CLARIFICATION`).*
- **Prerrequisitos para iniciar la Fase 5.2:**
  1. Autorización explícita e independiente del operador para ejecutar Fase 5.2 sobre `Project-Rainfall` (`136967000000014024`).
  2. Confirmar el/los entorno(s) objetivo (`Development` primero / `Production`) y `X_ZOHO_CATALYST_ORG_ID` si aplica.
  3. Crear manualmente en orden estricto las 5 tablas vacías + 8 GSIs sin alterar claves ni tipos (`ttlEpochSec: Number` y 11 columnas de `Users.GSI_Directory`).
  4. Para ejecutar la verificación automatizada post-creación (`verify-clean-slate-provisioning.ts --live --confirm-readonly --auth-mode external_oauth --expected-project 136967000000014024`), disponer en la estación del operador de credenciales OAuth administrativas temporales/de servicio (`external_oauth` exclusivo de CLI, distinto del runtime `hosted_native` de la app) más `CATALYST_PROJECT_KEY`.
  5. Antes de ejecutar bootstrap o Etapa 3: completar `Set Up` de **Native Catalyst Authentication** e inspeccionar directamente **`Authentication > Users`** para comprobar por evidencia directa que el recuento de usuarios es `0`.
