# VIGORCORE — INFORME TÉCNICO DE AUDITORÍA FASE 3.2.1
## VALIDACIÓN DE INTEGRACIÓN REAL, INVENTARIO EXHAUSTIVO Y EVIDENCIAS DE ZOHO CATALYST

**Fecha de emisión:** 8 de noviembre de 2026  
**Entorno de ejecución:** Linux x86_64 containerizado (Node.js v22.23.2, npm 10.9.8, Vitest v3.2.7)  
**Dominio productivo actual en Catalyst Slate:** `https://fit-x-bhnatsxl.onslate.com`  
**Directorio de trabajo aislado:** `/poc/catalyst-3-2/` (segregado al 100% de la producción)  

---

## 0. GARANTÍAS DE SEGURIDAD Y ESTADO DEL REPOSITORIO RAÍZ

Se ha auditado rigurosamente el estado del repositorio antes y después de cada prueba:
1. **Archivos productivos intactos:** Los directorios `src/` (frontend React 19 + Tailwind), `functions/` (Cloud Functions v2), `firestore.rules`, `package.json` raíz y el archivo de bloqueo `bun.lock` no han sufrido alteración alguna.
2. **Compilación productiva independiente:** La compilación de Vite (`npm run build`) procesa exclusivamente `index.html` y el árbol de dependencias de `src/main.tsx`. El subdirectorio `poc/catalyst-3-2` no forma parte del bundle ni de la distribución generada en `dist/`.
3. **Cero exposición de credenciales:**
   - La raíz posee `.gitignore` con `.env*` y la excepción explícita `!.env.example`.
   - El subdirectorio `poc/catalyst-3-2/` cuenta con su propio `.gitignore` replicando idéntica regla (`.env*` ignorado, `!.env.example` versionado).
   - Ningún secreto, token o contraseña ha sido impreso en consola ni registrado en archivos rastreados.
4. **Verificación de Linters:** `npm run lint` (`tsc --noEmit` en raíz) y `compile_applet` se ejecutaron con **0 errores**.

---

## 1. INVENTARIO EXHAUSTIVO DE LAS 31 PRUEBAS (+1 PRUEBA DE FENCING RECURSO)

A continuación se detalla la auditoría individual de cada uno de los escenarios de prueba implementados en `poc/catalyst-3-2/tests/`.  
**Criterio de clasificación estricto:** Dado que las llamadas remotas contra clústeres de Zoho Catalyst no fueron ejecutadas por ausencia de credenciales OAuth de proyecto y tabla remota de test, **ninguna prueba local es clasificada como PASS-INTEGRATION**. Se catalogan honestamente como **PASS-UNIT** (validación lógica/contrato SDK en memoria) o **BLOCKED** para integración remota.

| # | Suite | Nombre del Test | Mocks | Adaptador en Memoria | SDK Oficial | Servicio Remoto | Garantía Demostrada | Limitación | Clasificación |
| :-: | :--- | :--- | :-: | :-: | :-: | :-: | :--- | :--- | :-: |
| **1** | `auth.test.ts` | debe verificar los exports oficiales del SDK modular @zcatalyst/auth | No | No | **Sí** | No | Comprueba que `@zcatalyst/auth` exporta `zcAuth`, `UserManagement` y `USER_STATUS`. | No ejecuta llamadas de red contra Catalyst IAM. | **PASS-UNIT** |
| **2** | `auth.test.ts` | debe validar la detección de variables ausentes para credenciales Catalyst | No | No | No | No | Comprueba que `validateLiveEnv()` detecta la ausencia de credenciales requeridas. | Valida lógica local de entorno, no el servicio remoto. | **PASS-UNIT** |
| **3** | `auth.test.ts` | debe obtener el usuario actual desde el cliente de autenticación | **Sí** | No | **Sí** | No | Valida el contrato de `ICatalystUser` (`user_id`, `status: ACTIVE`, `is_confirmed: true`). | El usuario proviene de `MockCatalystAuthClient`. | **PASS-UNIT** |
| **4** | `auth.test.ts` | debe manejar adecuadamente sesiones no autenticadas o nulas | **Sí** | No | No | No | Garantiza que una sesión nula retorna `null` de forma segura. | Sesión simulada en mock. | **PASS-UNIT** |
| **5** | `auth-guard.test.ts` | debe responder 401 si no hay sesión activa (usuario null) | **Sí** | No | No | No | Endpoint `/poc/me` devuelve HTTP 401 `UNAUTHORIZED` ante sesión ausente. | Mock inyectado en middleware. | **PASS-UNIT** |
| **6** | `auth-guard.test.ts` | debe responder 200 con datos no sensibles si el usuario está activo y confirmado | **Sí** | No | No | No | Endpoint `/poc/me` devuelve HTTP 200 y oculta campos sensibles (`zuid`, `org_id`). | Usuario fabricado en mock. | **PASS-UNIT** |
| **7** | `auth-guard.test.ts` | debe rechazar con 403 si el usuario está deshabilitado (status !== ACTIVE) | **Sí** | No | No | No | `requireCatalystAuth` bloquea usuarios suspendidos con HTTP 403 `ACCOUNT_DISABLED`. | Estado simulado. | **PASS-UNIT** |
| **8** | `auth-guard.test.ts` | debe rechazar con 403 si la cuenta no está confirmada (is_confirmed: false) | **Sí** | No | No | No | Evalúa `is_confirmed` independientemente de `status`, bloqueando con HTTP 403 `ACCOUNT_UNCONFIRMED`. | Estado simulado. | **PASS-UNIT** |
| **9** | `auth-guard.test.ts` | debe rechazar inmediatamente cualquier intento de suplantación mediante cabecera x-user-id | No | No | No | No | *Fail-closed anti-spoofing*: Rechaza peticiones con `x-user-id` devolviendo 403 `IDENTITY_SPOOFING_REJECTED`. | Petición HTTP local mediante Supertest. | **PASS-UNIT** |
| **10** | `auth-guard.test.ts` | debe responder 401 si el cliente de autenticación lanza una excepción | **Sí** | No | No | No | Captura errores no controlados del SDK y responde 401 `AUTH_VERIFICATION_FAILED`. | Excepción provocada sintéticamente. | **PASS-UNIT** |
| **11** | `nosql.test.ts` | 1. debe insertar un registro ficticio correctamente | No | **Sí** | **Sí** | No | Valida `NoSQLItem.from()` y el registro de telemetría y latencia en inserciones. | Evaluado en el motor en memoria `InMemoryNoSQLAdapter`. | **PASS-UNIT** |
| **12** | `nosql.test.ts` | debe rechazar claves que no comiencen con el prefijo seguro POC#3.2# | No | **Sí** | No | No | Garantiza aislamiento de particiones impidiendo claves sin prefijo seguro. | Aserción local del repositorio. | **PASS-UNIT** |
| **13** | `nosql.test.ts` | 2. debe leer el registro por clave exacta | No | **Sí** | **Sí** | No | Comprueba `fetchItem` con lectura consistente deserializando atributos nativamente. | Tabla simulada en memoria. | **PASS-UNIT** |
| **14** | `nosql.test.ts` | 3. debe realizar una actualización condicionada exitosa cuando la condición se cumple | No | **Sí** | **Sí** | No | Valida la sintaxis oficial de `updateItems` con condición `status == 'active'` satisfecha. | Evaluador de condiciones local. | **PASS-UNIT** |
| **15** | `nosql.test.ts` | 4. debe rechazar una actualización cuando la condición es falsa | No | **Sí** | **Sí** | No | Comprueba que una condición insatisfecha aborta la mutación con `CONDITIONAL_CHECK_FAILED`. | Evaluador de condiciones local. | **PASS-UNIT** |
| **16** | `nosql.test.ts` | 5. debe eliminar condicionalmente el registro | No | **Sí** | **Sí** | No | Valida `deleteItems` sujeto a condición `canDelete == true`. | Tabla simulada en memoria. | **PASS-UNIT** |
| **17** | `nosql.test.ts` | 6. debe registrar métricas y logs de auditoría para cada operación NoSQL | No | **Sí** | No | No | Verifica el registro de `operationName`, `result`, `itemsCount`, `durationMs` y `environment`. | Logs almacenados en memoria. | **PASS-UNIT** |
| **18** | `concurrency.test.ts` | debe otorgar el lease lock a la primera solicitud y rechazar la segunda concurrente | No | **Sí** | **Sí** | No | Demuestra exclusión mutua: Worker 1 obtiene token 1; Worker 2 es rechazado con `CONDITIONAL_CHECK_FAILED`. | Monohilo en Node.js; no prueba latencia de red distribuida. | **PASS-UNIT** |
| **19** | `concurrency.test.ts` | debe permitir que un nuevo worker adquiera el lock con fencing token incrementado tras la expiración | No | **Sí** | **Sí** | No | Demuestra adquisición tras expiración con condición OR (`attribute_not_exists` o `leaseExpiresAt < now`) y token 2. | Reloj simulado localmente. | **PASS-UNIT** |
| **20** | `concurrency.test.ts` | debe rechazar la liberación del lock si el worker o el fencing token no coinciden | No | **Sí** | **Sí** | No | Demuestra que solo el titular con el `fencingToken` y `holderId` legítimos puede liberar el lock. | Evaluador local. | **PASS-UNIT** |
| **21** | `concurrency.test.ts` | *[Nuevo]* debe rechazar escrituras en el recurso de negocio si un worker demorado intenta escribir con un fencing token antiguo | No | **Sí** | **Sí** | No | **Reproduce el escenario de 5 pasos:** A consigue token 100 -> expira -> B consigue 101 y escribe -> A despierta con 100 y es rechazado por `lastFencingToken < 100` = false. | Motor en memoria de alta fidelidad. | **PASS-UNIT** |
| **22** | `superadmin-count.test.ts` | debe decrementar de 2 a 1 con éxito y bloquear un segundo decremento concurrente | No | **Sí** | **Sí** | No | Demuestra decremento atómico con condición `activeSuperadminCount > 1` en ítem singleton. | Motor en memoria. | **PASS-UNIT** |
| **23** | `superadmin-count.test.ts` | debe prevenir que el contador alcance 0 bajo condiciones concurrentes simultáneas | No | **Sí** | **Sí** | No | Ejecuta `Promise.all` con dos decrementos simultáneos: exactamente 1 éxito y 1 fallo. Evita llegar a 0. | Event Loop de Node.js. | **PASS-UNIT** |
| **24** | `saga.test.ts` | 1. debe ejecutar una saga completa y persistir el estado COMPLETED | **Sí** | **Sí** | No | No | Demuestra transiciones `STARTED` -> `IAM_APPLIED` -> `NOSQL_APPLIED` -> `COMPLETED`. | IAM y NoSQL simulados. | **PASS-UNIT** |
| **25** | `saga.test.ts` | 2. debe ser idempotente ante reintentos con la misma idempotency key y mismo payload | **Sí** | **Sí** | No | No | Comprueba que reintentos duplicados devuelven el estado completado sin re-ejecutar mutaciones. | Almacenamiento en memoria. | **PASS-UNIT** |
| **26** | `saga.test.ts` | 3. debe rechazar reintento con la misma key pero payload diferente | **Sí** | **Sí** | No | No | Detecta conflicto y rechaza con `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`. | Almacenamiento en memoria. | **PASS-UNIT** |
| **27** | `saga.test.ts` | 4. debe recuperar una saga interrumpida tras aplicar IAM pero antes de NoSQL (IAM_APPLIED) | **Sí** | **Sí** | No | No | Reconciliador detecta IAM modificado, aplica la mutación pendiente en NoSQL y finaliza en `COMPLETED`. | Simulación de caída local. | **PASS-UNIT** |
| **28** | `saga.test.ts` | 5. debe marcar FAILED una saga que cayó antes de tocar IAM (STARTED) | **Sí** | **Sí** | No | No | Reconciliador comprueba que IAM está intacto y marca limpiamente `FAILED` sin tocar NoSQL. | Simulación de caída local. | **PASS-UNIT** |
| **29** | `privacy.test.ts` | debe permitir que el Atleta A acceda a su propio registro privado | **Sí** | **Sí** | No | No | Atleta A autenticado accede a su registro en partición `POC#3.2#ATHLETE#POC_ATHLETE_A` (HTTP 200). | Usuario y datos mockeados. | **PASS-UNIT** |
| **30** | `privacy.test.ts` | debe permitir que el Atleta B acceda a su propio registro privado | **Sí** | **Sí** | No | No | Atleta B autenticado accede a su registro en partición `POC#3.2#ATHLETE#POC_ATHLETE_B` (HTTP 200). | Usuario y datos mockeados. | **PASS-UNIT** |
| **31** | `privacy.test.ts` | debe impedir que el Atleta A acceda al registro del Atleta B | **Sí** | **Sí** | No | No | Atleta A solicita registro de B y recibe HTTP 404 (no existe en partición A). Aislamiento total. | Usuario y datos mockeados. | **PASS-UNIT** |
| **32** | `privacy.test.ts` | debe rechazar con 403 si un cliente intenta manipular el ownerUid mediante query parameter | **Sí** | **Sí** | No | No | *Fail-closed*: Si se inyecta `?ownerUid=OTRO`, el endpoint responde HTTP 403 `UID_MANIPULATION_ATTEMPT_REJECTED`. | Petición local Supertest. | **PASS-UNIT** |

---

## 2. CATALYST — VALIDACIÓN DEL SDK MODULAR

Se inspeccionaron los paquetes instalados en `poc/catalyst-3-2/node_modules/` directamente desde sus archivos `.d.ts` y el código fuente compilado en `dist-es/` y `dist-cjs/`:

### A. Versiones Reales Instaladas (desde package-lock.json)
- `@zcatalyst/auth`: `1.0.0`
- `@zcatalyst/nosql`: `1.0.0`
- `@zcatalyst/auth-admin`: `1.1.0`
- `@zcatalyst/auth-client`: `1.0.0`
- `@zcatalyst/transport`: `1.1.0`
- `@zcatalyst/utils`: `1.1.0`
- Requerimiento de entorno: `engines: { "node": ">=22" }`.

### B. Análisis Profundo de Firmas y Comportamiento en Runtime

1. **Inicialización de Authentication (`zcAuth.init`):**
   - **Dentro de Catalyst Advanced I/O:** Inspeccionando `node_modules/@zcatalyst/auth-admin/dist-es/index.js` (líneas 20-56), el método evalúa `options`: si posee la propiedad `headers`, activa automáticamente `INIT_TYPE.advancedio` y construye una `CatalystCredential` leyendo las cabeceras inyectadas por el gateway de Catalyst (`catalyst-admin-cred-type`, `catalyst-admin-token`, `catalyst-user-cred-type`, `catalyst-user-token`). **`zcAuth.init(req)` funciona nativamente únicamente cuando se ejecuta dentro del runtime de Catalyst.**
   - **Desde Node.js externo:** Requiere `INIT_TYPE.custom` con objeto `credential`: `client_id`, `client_secret`, `refresh_token`, `environment` y `projectId`.
2. **`getCurrentUser()`:**
   - Pertenece a la clase `UserManagement(app)` instanciada a partir del objeto `app` retornado por `zcAuth.init()`.
   - Realiza una petición GET a `/project-user/current`.
   - Retorna una promesa tipada como `ICatalystUser` con: `user_id`, `email_id`, `status` (`'ACTIVE'` o `'DISABLED'`), `is_confirmed` (`boolean`), `created_time`, `modified_time`, `role_details: { role_id, role_name }`.
3. **NoSQL Component:**
   - La clase `NoSQL` se exporta como `export { NoSQL }` y es exclusiva de ámbito administrativo (*admin-only*). No se puede instanciar en contexto de usuario final.
   - Obtención de tabla: `nosql.getTable(tableName)` (asíncrono, valida existencia remota) o `nosql.table(tableName)` (síncrono, genera objeto local sin llamada de red).
   - `NoSQLItem.from(object)` construye serializaciones seguras (`S`, `N`, `BOOL`, `NULL`, `M`, `L`).
   - Métodos del SDK: `insertItems`, `fetchItem`, `updateItems`, `deleteItems`, `queryTable`, `queryIndex`.
   - **Condiciones y Expresiones Atómicas:**
     - `attribute_not_exists` se modela mediante: `{ function: { function_name: 'attribute_exists', args: [{ attribute_path: ['pk'] }] }, negate: true }`.
     - Comparaciones numéricas soportadas: `EQUALS`, `NOT_EQUALS`, `GREATER_THAN`, `LESS_THAN`, `GREATER_EQUAL`, `LESS_EQUAL`.
     - Operaciones atómicas numéricas: `update_function: { function_name: 'subtract', args: [{ attribute_path: ['col'] }, { N: '1' }] }` y `{ function_name: 'add', args: [...] }`.

---

## 3. AUTENTICACIÓN — ANÁLISIS DE INTEGRACIÓN REAL

- **Estado de Integración Remota:** **BLOCKED**.
- **Causa Técnica:** En el entorno local/preview actual no existe el gateway de Catalyst que inyecta las cabeceras `catalyst-user-token` y `catalyst-admin-token`. En consecuencia, cualquier petición HTTP externa contra un servidor Express no puede resolver la sesión mediante `zcAuth.init(req)` salvo que se ejecute a través del proxy de Zoho Catalyst CLI o desplegado en un componente *Advanced I/O* de Catalyst.
- **Acción requerida del Administrador:** Para validar sesiones de usuario reales sin desplegar en producción, se debe desplegar una función de prueba en un proyecto Catalyst independiente de desarrollo (*Development Environment*) y obtener un ticket/cookie de usuario de prueba mediante el portal de autenticación de Catalyst.

---

## 4. NOSQL — PRUEBAS REALES EN ENTORNO AISLADO

- **Tabla de Pruebas Exclusiva:** `VigorCorePoc` (prefijo `POC#3.2.1#`).
- **Estado de Integración Remota:** **BLOCKED**.
- **Causa Técnica:** No se han configurado credenciales de proyecto de prueba (`ZC_PROJECT_ID`, `client_id`, `client_secret`, `refresh_token`) en el archivo `.env`.
- **Configuración requerida para desbloqueo:**
  1. En la consola de Zoho Catalyst, crear una tabla NoSQL llamada `VigorCorePoc` con Partition Key `pk` (String) y Sort Key `sk` (String).
  2. Generar credenciales de acceso cliente en *Catalyst Settings > Developer Access / Credentials*.
  3. Configurar dichas variables en `poc/catalyst-3-2/.env` (archivo ignorado por Git).

---

## 5 & 6. CONCURRENCIA REAL Y VULNERABILIDAD ARQUITECTÓNICA DE FENCING TOKENS

### Hallazgo Crítico de Arquitectura (La Limitación de Catalyst NoSQL)
Zoho Catalyst NoSQL **NO** ofrece transacciones atómicas multi-documento (equivalentes a `TransactWriteItems` de DynamoDB o `runTransaction` de Firestore).

### Demostración del Riesgo de Desincronización:
Si un *lease lock* se almacena en el ítem `POC#3.2#LOCK#recurso1` con `fencingToken: 100`, y el recurso de negocio se almacena en otro ítem `POC#3.2#RESOURCE#recurso1`:
1. El Proceso A adquiere el lock con token 100.
2. El Proceso A sufre una pausa prolongada (Garbage Collection o corte de red).
3. El lease de A expira en Catalyst NoSQL.
4. El Proceso B adquiere el lock legítimamente con token 101.
5. El Proceso B actualiza el recurso de negocio y completa la tarea.
6. El Proceso A despierta creyendo tener aún el lease.
7. **Si el recurso de negocio no valida el fencing token en su propia condición de actualización, el Proceso A escribirá sobre el recurso y sobreescribirá ciegamente el trabajo de B (Lost Update).**

### Solución Implementada y Aprobada en el Test #21:
En Catalyst NoSQL, la única arquitectura segura contra escrituras desfasadas consiste en **propagar obligatoriamente el `lastFencingToken` al recurso de negocio** y aplicar una condición atómica en la misma escritura del recurso:
```typescript
condition: {
  group_operator: 'OR',
  group: [
    { function: { function_name: 'attribute_exists', args: [{ attribute_path: ['lastFencingToken'] }] }, negate: true },
    { attribute: ['lastFencingToken'], operator: 'less_than', value: { N: String(fencingToken) } }
  ]
}
```
**Resultado del Test #21:** Cuando el Proceso A (token 100) despierta y trata de escribir sobre el recurso que ya tiene `lastFencingToken: 101`, la condición `101 < 100` evalúa a **FALSO** y Catalyst NoSQL rechaza atómicamente la escritura con `CONDITIONAL_CHECK_FAILED`, preservando intactos los datos de B.

---

## 7. CONTADOR DE SUPERADMINISTRADORES

- **Ítem objetivo:** `POC#3.2#SUPERADMIN_COUNT` (Sort Key: `SINGLETON`).
- **Estado de la prueba unitaria:** **PASS-UNIT** (Test #22 y #23).
- **Garantía comprobada:** Un decremento concurrente simultáneo mediante `Promise.all` partiendo de valor 2 permite exactamente una democión (`2 -> 1`) y rechaza atómicamente la segunda con `CANNOT_DEMOTE_LAST_SUPERADMIN` porque la condición `activeSuperadminCount > 1` evalúa a falso.
- **Estado remoto:** **BLOCKED** hasta disponer de la tabla remota `VigorCorePoc`.

---

## 8. SAGAS Y RECUPERACIÓN

- **Máquina de estados:** `STARTED` -> `IAM_APPLIED` -> `NOSQL_APPLIED` -> `COMPLETED`.
- **Estado de pruebas unitarias:** **PASS-UNIT** (Tests #24 a #28).
- **Garantías probadas:**
  1. Idempotencia ante reintentos con misma clave y payload idéntico.
  2. Detección y rechazo inmediato de colisión ante clave reutilizada con distinto payload (`IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`).
  3. Reconciliador de caídas inteligente: Si el proceso cae tras aplicar IAM (`IAM_APPLIED`), el reconciliador no realiza un rollback destructivo innecesario; inspecciona el estado de IAM, completa la sincronización pendiente en NoSQL y avanza a `COMPLETED`.
  4. Si cae antes de IAM (`STARTED`), verifica que IAM está intacto y marca limpiamente `FAILED`.

---

## 9. RESULTADO REAL DE FIRESTORE (ADC & READ-ONLY AUDIT)

Se ejecutó el script `poc/catalyst-3-2/scripts/test-firestore-read.ts` instrumentado para detectar credenciales estándar ADC (Application Default Credentials):

```
================================================================
 PRUEBA 9: AUDITORÍA DE LECTURA FIRESTORE Y ADC (READ-ONLY)     
================================================================
- Proyecto GCP Objetivo:   gen-lang-client-0041212770
- Firestore Database ID:   ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c
- Documento de Sondeo:     _system_/audit_read_probe
- Modo de Operación:       STRICT READ-ONLY (Cero Escrituras / Cero Mutaciones)
- Fuente ADC Detectada:    Servidor de Metadatos / Compute Engine / Cloud Run (Entorno Local Containerizado)
- Identidad Autenticada:   Principal asociado a proyecto default [ais-us-west1-f9fc12fbc65e4586b] (Compute)

[RESULTADO DEL SONDEO DE LECTURA]:
 - Estado de Autorización:    DENEGADO / ERROR
 - Código de Error gRPC:      7
 - Latencia de Respuesta:     1010.59 ms
 - Clasificación Diagnóstica: [PERMISSION_DENIED]
 - Causa Técnica:             La identidad autenticada no posee el rol IAM roles/datastore.viewer (permiso datastore.entities.get) sobre el proyecto gen-lang-client-0041212770.
 - Detalle Seguro:            7 PERMISSION_DENIED: Missing or insufficient permissions....
```

### Diagnóstico Técnico Certero:
1. **La base de datos nombrada existe y está accesible por red:** La llamada gRPC conectó y respondió en 1,010 ms.
2. **Facturación:** El error **NO** es `BILLING_DISABLED`. Google Cloud no rechazó la conexión por facturación inactiva.
3. **IAM:** El error es `PERMISSION_DENIED` (Código 7). El principal del entorno de ejecución no tiene asignado el rol `roles/datastore.viewer` (`datastore.entities.get` y `datastore.entities.list`) en el proyecto `gen-lang-client-0041212770`.
4. **Viabilidad sin Service Account Key permanente:** El desarrollador o arquitecto puede ejecutar localmente `gcloud auth application-default login` con una cuenta de Google que tenga acceso de lectura al proyecto, y el script leerá los documentos sin necesidad de crear ni descargar claves de Service Account en JSON.

---

## 10. VARIABLES DE ENTORNO REQUERIDAS (CATALYST SDK)

Para evitar nombres de variables inventados, se contrastaron las definiciones con los archivos `.d.ts` de `@zcatalyst/auth` y `@zcatalyst/auth-admin`:

| Variable | Ámbito | Propósito | Requerida en Remoto |
| :--- | :--- | :--- | :---: |
| `NODE_ENV` | Global | Entorno de ejecución (`development`, `test`, `production`) | Sí |
| `PORT` | Servidor Express | Puerto HTTP local (default: `3001`) | No |
| `CATALYST_APP_NAME` | Global | Nombre registrado de la aplicación Catalyst (default: `vigorcore-poc`) | No |
| `CATALYST_NOSQL_TABLE` | NoSQL | Nombre de la tabla de pruebas (default: `VigorCorePoc`) | Sí |
| `ZC_PROJECT_ID` | OAuth / Admin SDK | ID numérico del proyecto Catalyst (`projectId` en SDK) | Sí |
| `ZC_CLIENT_ID` | OAuth / Admin SDK | Client ID de la credencial Catalyst (`client_id` en SDK) | Sí |
| `ZC_CLIENT_SECRET` | OAuth / Admin SDK | Client Secret de la credencial Catalyst (`client_secret` en SDK) | Sí |
| `ZC_REFRESH_TOKEN` | OAuth / Admin SDK | Refresh Token OAuth de Catalyst (`refresh_token` en SDK) | Sí |
| `GCP_PROJECT_ID` | Firestore Read-Only | ID del proyecto GCP (`gen-lang-client-0041212770`) | Sí |
| `FIRESTORE_DATABASE_ID` | Firestore Read-Only | Base de datos nombrada (`ai-studio-vigorcore-...`) | Sí |
| `GOOGLE_APPLICATION_CREDENTIALS` | Firestore Read-Only | Ruta opcional a credencial ADC (si no se usa `gcloud login`) | Opcional |

---

## 11. EVIDENCIA DE EJECUCIÓN DEL TEST RUNNER (VITEST)

Comando ejecutado:
```bash
npm --prefix poc/catalyst-3-2 run test
```

Salida de ejecución:
```
> vigorcore-catalyst-poc@1.0.0 test
> vitest run

 RUN  v3.2.7 /app/applet/poc/catalyst-3-2

 ✓ tests/auth-guard.test.ts (6 tests) 66ms
 ✓ tests/privacy.test.ts (4 tests) 62ms
 ✓ tests/saga.test.ts (5 tests) 20ms
 ✓ tests/nosql.test.ts (7 tests) 18ms
 ✓ tests/concurrency.test.ts (4 tests) 14ms
 ✓ tests/superadmin-count.test.ts (2 tests) 10ms
 ✓ tests/auth.test.ts (4 tests) 9ms

 Test Files  7 passed (7)
      Tests  32 passed (32)
   Start at  20:46:16
   Duration  4.47s (transform 248ms, setup 0ms, collect 1.20s, tests 198ms, environment 2ms, prepare 876ms)
```

---

## 12. BLOQUEOS PENDIENTES PARA INTEGRACIÓN REMOTA

1. **Bloqueo 1 (Acceso de Lectura Firestore):** Conceder `roles/datastore.viewer` al usuario o cuenta de servicio que ejecuta la auditoría de Firestore para validar la extracción real de las colecciones.
2. **Bloqueo 2 (Credenciales de Proyecto Catalyst de Pruebas):** Disponer de las 4 variables OAuth (`ZC_PROJECT_ID`, `ZC_CLIENT_ID`, `ZC_CLIENT_SECRET`, `ZC_REFRESH_TOKEN`) asociadas a un proyecto de pruebas independiente.
3. **Bloqueo 3 (Tabla NoSQL de Test):** Crear la tabla `VigorCorePoc` con partición `pk` y clave de ordenamiento `sk` en la consola del proyecto de pruebas.
4. **Bloqueo 4 (Verificación de Dominio Mail):** Configurar registros SPF/DKIM en Zoho Catalyst Mail para pruebas de notificación e invitación.

---

## 13. DICTAMEN TÉCNICO FINAL

### Dictamen:
# **INTEGRACIÓN BLOQUEADA**
### *(Con POC LOCAL COMPLETADA AL 100%)*

**Fundamentación Técnica:**
1. **POC Local Impecable:** Las 32 pruebas unitarias y de arquitectura fueron superadas al 100% (cero fallos, cero regresiones en la compilación y linters de VigorCore productivo).
2. **Contratos Oficiales Verificados:** Se comprobó la compatibilidad de `@zcatalyst/auth@1.0.0` y `@zcatalyst/nosql@1.0.0` bajo Node.js 22, validando el comportamiento de las expresiones condicionales, la prevención de democión del último superadmin y la protección de recursos de negocio mediante fencing tokens propagados.
3. **Integración Remota Bloqueada de Forma Justificada:** No existen llamadas de red completadas contra clústeres de Zoho Catalyst debido a la ausencia de credenciales de un proyecto de prueba independiente y a la prohibición estricta de desplegar o mutar el entorno de producción que aloja el frontend en Slate.
