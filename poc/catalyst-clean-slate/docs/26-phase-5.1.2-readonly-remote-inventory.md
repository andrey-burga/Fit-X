# VIGORCORE — COMPLEMENTO DE CIERRE DE FASE 5.1.2: INVENTARIO REMOTO ASISTIDO Y READ-ONLY DE ZOHO CATALYST

**Alcance:** Exclusivo dentro de `poc/catalyst-clean-slate/`  
**Fecha:** 18 de noviembre de 2026  
**Complementa:** `docs/25-phase-5.1.2-operational-preparation-pack.md`  
**Cierre formal actualizado en:** `docs/27-phase-5.1.2-closure-and-phase-5.2-plan.md` *(tras inspección visual del operador sobre **`Project-Rainfall`**)*  
**Estación del operador soportada:** Windows PowerShell 5.1 + Node.js v24.16.0  
**Dictamen histórico previo a Consola:** `PREPARATION_PARTIAL` *(superado en lo relativo a colisiones de proyecto/tablas/funciones/Security Rules por la inspección visual del operador; dictamen actualizado de cierre de preparación en `docs/27`: **`PHASE_5_1_2_CLOSED_READY_FOR_PHASE_5_2`**, manteniendo **`BLOCKED_PENDING_ZOHO_CLARIFICATION`** para el cutover del dominio personalizado `api.vigorcore.lat`. **La Fase 5.2 aún NO ha sido ejecutada.**)*

---

## 1. Separación Estricta entre Inventario Local e Inventario Remoto

1. **Inventario Local (`VERIFIED_LOCAL_ONLY`):** Manifiesto de 5 tablas y 8 GSIs, 41 rutas, compilación `dist/server/catalystEntry.js`, `tsconfig.server.json`, matriz de 33 variables de entorno, runbooks y `87/87` pruebas locales en `poc/catalyst-clean-slate/`. **Esto NO acredita el estado de la nube.**
2. **Inventario Remoto (`VERIFICADO REMOTAMENTE` / `VERIFIED_REMOTE`):** Únicamente lo observado de forma directa y no destructiva contra DNS público o contra la cuenta/proyecto Zoho Catalyst mediante comandos CLI de solo lectura autorizados o inspección visual en Catalyst Console.
3. **Prohibiciones absolutas en este procedimiento:**
   - NO instalar herramientas globales ni pedir instalación manual de paquetes.
   - NO solicitar, leer, almacenar ni imprimir tokens, contraseñas, claves privadas o secretos.
   - NO ejecutar operaciones de escritura, creación/modificación de recursos, `deploy`, `apig:enable`, `apig:disable`, cambios de Security Rules, cambios de DNS/Dominios/Authorized Domains, bootstrap, creación de usuarios ni migraciones.

---

## 2. Procedimiento en Windows PowerShell 5.1 (Sin `&&` ni `||`, Allowlist Estricta)

> **Compatibilidad garantizada:** Todos los comandos usan sintaxis pura de **Windows PowerShell 5.1** y **Node.js v24.16.0**. **No se utilizan `&&` ni `||`.**

### 2.1 Comprobación previa no destructiva de Catalyst CLI
Ejecuta exactamente en Windows PowerShell 5.1 (no instala nada si falta):

```powershell
$PSVersionTable.PSVersion
node --version
Get-Command catalyst -ErrorAction SilentlyContinue
```

- Si `Get-Command catalyst -ErrorAction SilentlyContinue` devuelve vacío: **NO instalar Catalyst CLI**. Pasar directamente a la **Sección 4 (Catalyst Console)** y ejecutar el script igualmente para capturar la verificación DNS y generar la plantilla de informe local.

### 2.2 Lista permitida explícita de comandos Catalyst CLI (`Allowlist`)
Solo se permiten estos **3 comandos documentados de solo lectura**:
1. `catalyst --version`
2. `catalyst whoami` *(comprobación mínima de sesión autenticada; nunca imprimir tokens ni PII completa)*
3. `catalyst project:list` *(lista de proyectos accesibles **sin** cambiar el proyecto activo)*

> **Nota sobre comandos excluidos y prohibidos:**
> - **NO asumir `catalyst org:list`:** no está documentado en la referencia usada y queda excluido de la lista permitida.
> - **Comandos estrictamente PROHIBIDOS:** `project:use`, `project:reset`, `config:list`, `config:get`, `pull`, `deploy`, `apig:enable`, `apig:disable`, `ds:import`, `init`, `serve`, `login`, y cualquier comando fuera de la lista permitida.

### 2.3 Ejecución del script asistido de inventario (`scripts/phase-5.1.2-readonly-inventory.ps1`)
Desde el directorio `poc/catalyst-clean-slate` en Windows PowerShell 5.1:

```powershell
Set-Location -Path .\poc\catalyst-clean-slate
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\phase-5.1.2-readonly-inventory.ps1
```

*(Opcionalmente, si deseas comprobar de forma no ambigua si un Project ID objetivo ya conocido figura en `project:list` sin cambiar configuración ni usar `project:use`):*

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\phase-5.1.2-readonly-inventory.ps1 -ExpectedProjectId '<PROJECT_ID_PUBLICO>'
```

**Comportamiento garantizado del script:**
- Verifica versión de PowerShell y Node.js.
- Detecta `catalyst` con `Get-Command catalyst -ErrorAction SilentlyContinue`. Si no existe o `whoami` falla, **detiene la parte CLI sin reparar ni pedir login/tokens** e indica completar la Sección 4 en Catalyst Console.
- Rechaza cualquier subcomando fuera de `--version`, `whoami`, `project:list` (`ALLOWED_READONLY_COMMAND_VIOLATION`).
- Enmascara correos y redacta posibles patrones de tokens antes de mostrar o guardar resultados.
- Ejecuta consulta DNS CNAME read-only para `api.vigorcore.lat` y `app.vigorcore.lat`.
- Genera informe local sanitizado en `poc/catalyst-clean-slate/reports/phase-5.1.2-readonly-inventory-report.json` y `phase-5.1.2-readonly-inventory-summary.md`.

---

## 3. Verificación DNS de Solo Lectura (Windows PowerShell 5.1)

Comando compatible con Windows PowerShell 5.1 (solo lectura, sin modificar DNS):

```powershell
Resolve-DnsName -Name 'api.vigorcore.lat' -Type CNAME -DnsOnly -ErrorAction Stop
Resolve-DnsName -Name 'app.vigorcore.lat' -Type CNAME -DnsOnly -ErrorAction Stop
```

### Reglas de interpretación (sin ambigüedad)
- **Error `NXDOMAIN` / `DNS name does not exist` y sin registros `A`/`AAAA`:** el registro CNAME **no existe** → clasificar como **`NOT_CONFIGURED`**.
- **Respuesta con registro `A`/`AAAA` sin CNAME, o múltiples CNAME contradictorios:** respuesta **no concluyente / divergente** → clasificar como **`AMBIGUOUS`**.
- **Timeout, fallo del resolvedor local o bloqueo de red:** **problema de resolución** → clasificar como **`NOT_ACCESSIBLE`** (nunca `NOT_CONFIGURED`).
- **Único destino CNAME devuelto limpiamente:** clasificar como **`VERIFIED_REMOTE`**.

### Evidencia DNS pública observada en solo lectura (2026-11-18T23:35:02Z)
Consulta ejecutada únicamente en modo lectura DNS (`node:dns.promises`):
- **`api.vigorcore.lat`** (`CNAME` y `A`): devolvió `ENOTFOUND` → **`NOT_CONFIGURED`** *(esperado antes de Phase 5.3+; no crear registro DNS durante Phase 5.1.2)*.
- **`app.vigorcore.lat`** (`CNAME`): devolvió **`slate-16391000000005003-us.nimbuspop.com`** → **`VERIFIED_REMOTE`** *(confirma públicamente que `app.vigorcore.lat` apunta a Catalyst Slate en región US y permanece intacto; también confirma que **existe un proyecto Catalyst vivo asociado a Slate**, por lo que la auditoría de recursos preexistentes en Consola es obligatoria antes de Phase 5.2)*.

---

## 4. Checklist de Inventario Read-Only en Zoho Catalyst Console

> **Regla estricta:** Realizar únicamente lecturas visuales y exportaciones de solo lectura. **NO crear, editar, activar, desactivar ni guardar cambios.** **NO copiar ni registrar secretos, API keys, client secrets, refresh tokens ni cookies.**

### A. Proyecto y organización
- [ ] **Nombre del proyecto:** `[registrar nombre público]`
- [ ] **Project ID:** `[registrar identificador público]`
- [ ] **Organización:** `[registrar nombre/ID de organización]`
- [ ] **Centro de datos / región:** `[ej. US / api.catalyst.zoho.com — validar coherencia con DNS Slate US]`
- [ ] **Entornos existentes:** Confirmar existencia de **`Development`** y **`Production`**, más cualquier entorno adicional.

### B. Aplicaciones y funciones
- [ ] **Slate existente:** Confirmar el Slate asociado a `https://app.vigorcore.lat/`, su estado y entorno destino (**sin modificarlo**).
- [ ] **Funciones Basic I/O:** Listar nombre, ID, ruta/URL pública y estado actual (`Enabled`/`Disabled`/versión).
- [ ] **Funciones Advanced I/O:** Comprobar si ya existe `vigor_api` o cualquier otra función Advanced I/O (nombre, ID, runtime Node, rutas, estado).
- [ ] **Otras funciones (Cron, Event, Integration):** Listar nombre, ID, disparador/ruta y estado.

### C. API Gateway
- [ ] **Estado actual:** `Disabled` o `Enabled` (por entorno).
- [ ] **Configuraciones existentes:** Dominios o políticas asociadas si ya estuviera habilitado.
- [ ] **Rutas existentes:** Listar método, `request_url`, tipo de destino y autenticación configurada actualmente.
- [ ] **Recursos afectados por futura activación:** Registrar qué funciones o endpoints hoy dependen de Project Security Rules o de rutas `/server/*` directas.

### D. Seguridad (`Project Security Rules`)
- [ ] **Estado actual de Project Security Rules:** Activas / Inactivas (recordar: activar API Gateway las desactiva **globalmente**).
- [ ] **Exportación / snapshot JSON de solo lectura:** Usar únicamente la función de lectura/exportación de la Consola (o copiar en archivo local fuera de git sin secretos) como respaldo previo a cualquier cambio futuro.
- [ ] **Funciones dependientes:** Identificar explícitamente qué funciones actuales (B) quedarían expuestas o alteradas si Project Security Rules se desactivasen al activar API Gateway.

### E. NoSQL
- [ ] **Tablas existentes:** Listar todas las tablas existentes en `Development` y `Production`.
- [ ] **GSIs y configuración TTL:** Para cada tabla existente, anotar PK, SK, GSIs y si TTL está activo.
- [ ] **Comprobación de colisiones con Clean-Slate (5 tablas objetivo):**
  - `Users` — ¿Existe? (`Sí / No`) · Conteo filas: `[n]`
  - `UserData` — ¿Existe? (`Sí / No`) · Conteo filas: `[n]`
  - `AdminInvitations` — ¿Existe? (`Sí / No`) · Conteo filas: `[n]`
  - `AuditLogs` — ¿Existe? (`Sí / No`) · Conteo filas: `[n]`
  - `SystemControl` — ¿Existe? (`Sí / No`) · Conteo filas: `[n]`

### F. Authentication
- [ ] **Configuración de Catalyst Authentication:** Activa / No configurada, tipos de inicio de sesión habilitados.
- [ ] **Usuarios existentes y cantidad:** Registrar conteo total de usuarios en `Development` y `Production` *(Clean-Slate exige **`0`** usuarios de aplicación antes del bootstrap inicial, o un plan aprobado si el proyecto ya tiene usuarios)*.
- [ ] **Plantillas de recuperación de contraseña:** Revisar redirect URLs y remitente configurados (sin exponer secretos SMTP).
- [ ] **Dominios autorizados en Auth / Redirects:** Verificar que incluye `https://app.vigorcore.lat`.

### G. Dominios (`Domain Mapping` y `Whitelisting`)
- [ ] **CloudScale > Domain Mapping:** Verificar si `api.vigorcore.lat` ya aparece mapeado (entorno, destino, estado).
- [ ] **CNAME:** Confirmar consistencia con la consulta DNS (`NOT_CONFIGURED` vs mapeado pendiente).
- [ ] **Certificado SSL y estado:** Anotar estado de emisión/renovación si existe entrada para `api.vigorcore.lat` o `app.vigorcore.lat`.
- [ ] **CloudScale > Whitelisting > Authorized Domains:** Listar dominios autorizados configurados actualmente (confirmar que no haya `*` wildcard y si `https://app.vigorcore.lat` ya está presente).
- [ ] **Integridad de `app.vigorcore.lat`:** Confirmar visualmente en Consola que `app.vigorcore.lat` permanece intacto y operativo.

---

## 5. Matriz de Resultados (Estado Actual Basado en Evidencia Real)

Taxonomía permitida aplicada estrictamente: `VERIFIED_REMOTE`, `VERIFIED_LOCAL_ONLY`, `NOT_ACCESSIBLE`, `NOT_CONFIGURED`, `AMBIGUOUS`, `PENDING_OPERATOR`. *(Nunca se usa `NOT_CONFIGURED` cuando no se pudo consultar el recurso.)*

| Elemento | Fuente de comprobación | Fecha y hora (UTC) | Resultado | Evidencia no sensible | Limitaciones | Acción de lectura pendiente |
| --- | --- | --- | --- | --- | --- | --- |
| Artefactos Clean-Slate POC (5 tablas, 8 GSIs, 41 rutas, build servidor/frontend, 87 tests) | Ejecución local en `poc/catalyst-clean-slate/` (`build`, `build:server`, `frontend:build`, `test`) | 2026-11-18T01:46Z | `VERIFIED_LOCAL_ONLY` | `87/87 PASS`, `dist/server/catalystEntry.js` emitido, `0` escrituras remotas | No valida estado de recursos remotos en la nube Catalyst | Ninguna |
| Catalyst CLI disponible en estación de ejecución actual (sandbox) | Shell local `which catalyst` y nombres de variables `CATALYST_*` | 2026-11-18T01:45Z | `NOT_ACCESSIBLE` | `NO_CATALYST_CLI` y `0` credenciales Catalyst en contenedor | Este entorno no dispone de sesión Catalyst autenticada | Operador ejecuta `scripts/phase-5.1.2-readonly-inventory.ps1` en Windows PowerShell 5.1 |
| DNS CNAME `app.vigorcore.lat` (Slate) | Consulta DNS pública read-only (`node:dns.promises.resolveCname`) | 2026-11-18T23:35:02Z | `VERIFIED_REMOTE` | `CNAME -> slate-16391000000005003-us.nimbuspop.com` | Solo resolución DNS pública; no expone funciones/tablas internas | Operador confirma estado visual en Catalyst Console (`Sección 4.G`) |
| DNS CNAME `api.vigorcore.lat` (Backend futuro) | Consulta DNS pública read-only (`resolveCname` + `resolve4`) | 2026-11-18T23:35:02Z | `NOT_CONFIGURED` | `ENOTFOUND` en consultas `CNAME` y `A` | Solo resolución DNS pública; confirmar en PowerShell local del operador | Revalidar en Windows PowerShell 5.1 con `Resolve-DnsName`; NO crear en 5.1.2 |
| A. Proyecto, Project ID, Organización, Región/DC y Entornos | Catalyst Console / CLI del operador | 2026-11-18T23:35Z | `PENDING_OPERATOR` | Evidencia indirecta de DC US vía `*-us.nimbuspop.com` en DNS Slate, pero Project ID/Org/Entornos no consultados | Sin acceso CLI ni Consola desde sandbox | Ejecutar `phase-5.1.2-readonly-inventory.ps1` + completar `Sección 4.A` |
| B. Aplicaciones Slate y Funciones (`Basic I/O`, `Advanced I/O`, `Cron`, `Event`) | Catalyst Console (`Serverless > Functions` / `Slate`) | 2026-11-18T23:35Z | `PENDING_OPERATOR` | Slate activo evidenciado por DNS de `app.vigorcore.lat`; funciones internas desconocidas | CLI `project:list` tampoco enumera funciones | Completar inventario read-only en `Sección 4.B` |
| C. Estado de API Gateway y rutas existentes | Catalyst Console (`Cloud Scale > API Gateway`) | 2026-11-18T23:35Z | `PENDING_OPERATOR` | Sin datos remotos en este entorno | No accesible sin sesión de Consola | Completar `Sección 4.C` |
| D. Project Security Rules + Snapshot JSON | Catalyst Console (`Security Rules` export/view) | 2026-11-18T23:35Z | `PENDING_OPERATOR` | No exportado aún | Requiere acceso visual/exportación en Consola | Exportar JSON de solo lectura y listar dependencias (`Sección 4.D`) |
| E. Tablas NoSQL existentes, GSIs y TTL | Catalyst Console (`Cloud Scale > NoSQL`) | 2026-11-18T23:35Z | `PENDING_OPERATOR` | Esquema congelado localmente; estado remoto sin verificar | Sin credenciales Catalyst en este entorno | Verificar tablas/GSIs/TTL y colisiones (`Sección 4.E`) |
| F. Catalyst Authentication (usuarios y plantillas reset) | Catalyst Console (`Authentication > Users` & Templates) | 2026-11-18T23:35Z | `PENDING_OPERATOR` | Sin conteo remoto de usuarios todavía | Sin credenciales Catalyst en este entorno | Verificar conteo `0` o documentar usuarios existentes (`Sección 4.F`) |
| G. CloudScale Domain Mapping, SSL y Authorized Domains | Catalyst Console (`Domain Mapping` / `Whitelisting`) | 2026-11-18T23:35Z | `PENDING_OPERATOR` | DNS público de `api.vigorcore.lat` es `NOT_CONFIGURED` | Configuraciones internas de Domain Mapping y Authorized Domains no visibles por DNS | Completar `Sección 4.G` en Catalyst Console |

---

## 6. Reconciliación contra el Manifiesto de Fase 5.1.2 y Detección de Incompatibilidades

> **Regla:** No modificar ninguna configuración remota ni el manifiesto para forzar coincidencias. Toda discrepancia que aparezca tras completar la Sección 4 debe documentarse aquí con su propuesta de solución antes de solicitar Fase 5.2.

| Área de Reconciliación | Expectativa del Manifiesto Fase 5.1.2 | Riesgo o Colisión a Comprobar | Solución Propuesta *(Solo Documentada — NO Ejecutar)* |
| --- | --- | --- | --- |
| **1. Nombres de tablas NoSQL** | Las 5 tablas (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`) NO existen aún o están vacías con esquema idéntico al congelado. | Que alguna tabla exista con PK/SK distinta, sin alguno de los 8 GSIs, sin `ttlEpochSec (Number)` o con datos residuales de pruebas previas. | **Detener antes de Phase 5.2:** Dado que claves/SKs/GSIs son inmutables en Catalyst NoSQL, usar un proyecto limpio dedicado o recrear la tabla vacía afectada (si es entorno de prueba y autorizado) antes de cualquier escritura. |
| **2. Funciones preexistentes** | Única función backend esperada: `vigor_api` (`advancedio`, `node22`). | Que el proyecto que aloja `app.vigorcore.lat` ya contenga funciones Basic I/O, Advanced I/O o webhooks protegidos hoy por Project Security Rules. | Mantener inventario completo (`Sección 4.B`); incluir rutas explícitas o exclusión deliberada en el diseño del API Gateway antes de futuras fases, sin exponer funciones internas heredadas. |
| **3. Estado actual de API Gateway** | Deshabilitado antes de desplegar `vigor_api`, o habilitado únicamente con rutas reconciliadas. | Si API Gateway ya estuviera `Enabled` con rutas en uso para Slate u otros clientes, sobrescribir rutas causaría indisponibilidad. | Fusionar rutas en `alternative-b-api-gateway.routes.json` respetando rutas existentes con prefijos no colisionantes (`/api/v1/*` vs rutas previas) o validar entorno `Development` aislado primero. |
| **4. Dependencias de Security Rules** | Respaldo JSON previo obligatorio porque `catalyst apig:enable` desactiva Project Security Rules **globalmente**. | Exposición no deseada de funciones existentes que dependían de reglas de Security Rules al activar Gateway. | Obtener snapshot JSON (`Sección 4.D`), auditar equivalencia regla-a-ruta (`buildApiGatewayGlobalImpactAudit`) y verificar que `catalyst apig:disable` revierte de inmediato si hay regresión. |
| **5. Dominios y CORS** | `app.vigorcore.lat` intacto en Slate; `api.vigorcore.lat` CNAME + `Authorized Domains = https://app.vigorcore.lat` + `VIGOR_CORS_MODE=platform_managed`. | Que `Authorized Domains` tenga `*` wildcard, orígenes distintos o falte `https://app.vigorcore.lat`, o que `api.vigorcore.lat` tenga conflicto DNS previo. | Confirmado DNS actual `api.vigorcore.lat = NOT_CONFIGURED` y `app.vigorcore.lat` intacto (`nimbuspop.com` US). Mantener sin cambios hasta fase de despliegue; ajustar solo lista exacta de `Authorized Domains` cuando toque desplegar. |
| **6. Usuarios existentes en Catalyst Auth** | Clean-Slate exige **`0`** usuarios de aplicación antes del bootstrap inicial y separación estricta con Firestore. | Que el proyecto que aloja Slate ya tenga usuarios creados en Authentication. | Si conteo `> 0`, **no aplicar Clean-Slate ciegamente sobre esos usuarios**: decidir en documento de autorización si esos usuarios pertenecen a cuentas de prueba descartables en proyecto dev, o aprovisionar proyecto Catalyst Clean-Slate independiente. |
| **7. Efectos globales de transición futura** | Orden estricto: Inventario + Snapshot Rules → Tablas NoSQL (5.2) → Deploy `vigor_api` + `Authorized Domains` → `apig:enable` + Domain Mapping `api.vigorcore.lat` → Smoke + `INT-01..08`. | Ejecutar despliegue o `apig:enable` antes de resolver puntos 1–6. | Mantener compuerta cerrada: `PREPARATION_PARTIAL` impide avanzar a 5.2 hasta cerrar inventario `4.A–4.G` y confirmar plan de mitigación + rollback (`catalyst apig:disable`). |

---

## 7. Alcance Exacto de `verify-clean-slate-provisioning.ts --live --confirm-readonly` (NO Ejecutar en Fase 5.1.2)

- **Qué hace realmente (`scripts/verify-clean-slate-provisioning.ts`):**
  1. Requiere modo `--auth-mode external_oauth` con `CATALYST_PROJECT_ID`, `CATALYST_PROJECT_KEY`, `CATALYST_ADMIN_CLIENT_ID`, `CATALYST_ADMIN_CLIENT_SECRET`, `CATALYST_ADMIN_REFRESH_TOKEN` (o access token efímero).
  2. Se conecta en solo lectura via `@zcatalyst/nosql` y `@zcatalyst/auth` y **exige que las 5 tablas (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`) y los 8 GSIs ya existan en estado `ONLINE` y vacíos**.
- **Por qué NO es apropiado ejecutarlo antes de Fase 5.2:** Es un **verificador post-aprovisionamiento de Fase 5.2**, no una herramienta de descubrimiento general previo a crear tablas (fallaría con `FAIL_SCHEMA_MISMATCH` sobre tablas inexistentes y además requeriría credenciales OAuth que esta fase no solicita). **No se ejecuta en Fase 5.1.2.**

---

## 8. Cierre del Complemento de Fase 5.1.2

| Pregunta de Cierre | Respuesta Honesta Basada en Evidencia |
| --- | --- |
| **¿Qué información se verificó remotamente?** | Resolución DNS pública de solo lectura (2026-11-18T23:35:02Z): `app.vigorcore.lat` CNAME apunta a `slate-16391000000005003-us.nimbuspop.com` (`VERIFIED_REMOTE`, intacto); `api.vigorcore.lat` devolvió `ENOTFOUND` para CNAME y A (`NOT_CONFIGURED`). |
| **¿Qué información se verificó desde Catalyst Console?** | Ninguna todavía desde este entorno (`PENDING_OPERATOR`); quedaron definidos el script `scripts/phase-5.1.2-readonly-inventory.ps1` y la guía paso a paso `Sección 4 (A–G)` para que el operador los ejecute sin riesgo. |
| **¿Qué información continúa sin comprobarse?** | Identidad CLI (`whoami`), lista de proyectos (`project:list`), Project ID/Organización/entornos, funciones Basic/Advanced I/O/Cron/Event existentes, estado de API Gateway, export JSON de Project Security Rules, estado/colisiones de las 5 tablas NoSQL, conteo de usuarios en Catalyst Auth, Domain Mapping/SSL de `api.vigorcore.lat` y `Authorized Domains`. |
| **¿El proyecto tiene recursos preexistentes?** | **Indicio fuerte confirmado en DNS público:** `app.vigorcore.lat` ya resuelve a Slate en Catalyst US (`nimbuspop.com`), por lo que el entorno remoto **sí contiene al menos una aplicación Slate activa** y debe asumirse que podrían existir funciones, Security Rules o usuarios previos hasta completar `Sección 4`. |
| **¿Existe algún riesgo de colisión?** | **Sí, potencialmente hasta completar la Consola (`Sección 4`):** posibles funciones que dependan de Project Security Rules (impactadas globalmente por `apig:enable`), posible API Gateway ya activo, o eventuales tablas/usuarios existentes en el proyecto vinculado a `app.vigorcore.lat`. |
| **¿Está suficientemente documentado el impacto de API Gateway?** | **Sí:** la desactivación global de Project Security Rules al ejecutar `catalyst apig:enable`, la exigencia de inventario previo + snapshot JSON y el rollback inmediato vía `catalyst apig:disable` están documentados en código (`buildApiGatewayGlobalImpactAudit`), en `docs/24`, `docs/25` y en `Sección 6` de este complemento. |
| **¿Qué bloqueos impiden solicitar la Fase 5.2?** | 1) Falta de ejecución del inventario asistido PowerShell 5.1 + checklist `4.A–4.G` en Catalyst Console;<br>2) Falta de snapshot JSON de Project Security Rules e inventario de funciones previas;<br>3) Falta de confirmación remota de `0` colisiones en nombres de tablas NoSQL y conteo de usuarios en Catalyst Auth;<br>4) Definición pendiente (tras ver el inventario real) de si Fase 5.2 se ejecutará en entorno aislado del proyecto o proyecto dedicado. |

### Dictamen Final *(Histórico pre-inspección visual)*
- **Dictamen previo:** **`PREPARATION_PARTIAL`**
- **Condición para recomendar paso a Fase 5.2:** Únicamente cuando el operador devuelva los resultados sanitizados de `scripts/phase-5.1.2-readonly-inventory.ps1` y de las secciones `4.A–4.G` de Catalyst Console, se reconcilien posibles colisiones mediante plan aprobado y se confirme un procedimiento de recuperación verificable (`snapshot Security Rules` + `catalyst apig:disable`). **No se aprovisiona, despliega ni modifica ningún recurso remoto.**

---

## 9. Actualización Reconciliada Post-Inspección Visual en Consola (`Project-Rainfall`)

> **Expediente completo en `docs/27-phase-5.1.2-closure-and-phase-5.2-plan.md` y `buildPhase512ClosureReport()`.**

El operador completó la inspección visual read-only en Catalyst Console confirmando:
- **DC:** `US` (`accounts.zoho.com`) — coherente con Slate `*-us.nimbuspop.com` (`VERIFIED_REMOTE`).
- **Proyecto:** `Project-Rainfall` con Catalyst Project ID confirmado **`136967000000014024`** (`VERIFIED_REMOTE`; sin contradicción con los placeholders ni con el ID Slate DNS `16391000000005003`; entornos `Development` / `Production` y `Org ID` por anotar antes de `--live`).
- **Functions & Security Rules:** `Functions are not created yet!!` (`VERIFIED_REMOTE`, `0` funciones heredadas previas; esto limita a cero únicamente la exposición de funciones heredadas previas, **sin** eliminar el impacto global de `apig:enable` sobre la futura función `vigor_api`).
- **API Gateway:** `Enable now` (`NOT_CONFIGURED` / deshabilitado).
- **NoSQL:** `Create your first table` (`NOT_CONFIGURED` / `0` tablas, `0` colisiones).
- **Authentication:** Native & Third-party muestran `Set Up` (`NOT_CONFIGURED`). **Evidencia vs inferencia:** aunque `Set Up` sugiere ausencia de flujo configurado (inferencia plausible), el recuento de usuarios en *Authentication > Users* **no se inspeccionó directamente** y debe verificarse de forma directa tras `Set Up` antes del bootstrap.
- **Domain Mapping:** solo `Add Mapping` visible (`PENDING_ZOHO_CLARIFICATION` respecto al destino exacto de API Gateway sin Web Client Hosting; Slate `app.vigorcore.lat` opera independientemente con SSL activo).
- **DNS `api.vigorcore.lat`:** no resuelve (`NOT_CONFIGURED`).
- **Authorized Domains (`Whitelisting`):** permanece `PENDING_OPERATOR` antes de Etapa 4 (API Gateway).

**Dictamen actualizado de cierre (Fase 5.1.2):** **`PHASE_5_1_2_CLOSED_READY_FOR_PHASE_5_2`** (cero operaciones remotas ejecutadas; `api.vigorcore.lat` queda en **`BLOCKED_PENDING_ZOHO_CLARIFICATION`**).

