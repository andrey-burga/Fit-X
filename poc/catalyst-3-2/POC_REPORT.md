# VIGORCORE — INFORME TÉCNICO DE AUDITORÍA FASES 3.2.2 Y 3.3
## VALIDACIÓN DE INTEGRACIÓN FIRESTORE (PASS-INTEGRATION) E INVENTARIO ESTRUCTURAL PARA MIGRACIÓN A ZOHO CATALYST

**Fecha de emisión:** 8 de noviembre de 2026  
**Entorno de desarrollo:** Windows (Estación local del desarrollador con Google Cloud CLI y ADC)  
**Entorno de compilación:** Linux x86_64 containerizado (Node.js v22.23.2, npm 10.9.8, Vitest v3.2.7)  
**Dominio productivo actual en Catalyst Slate:** `https://fit-x-bhnatsxl.onslate.com`  
**Directorio de trabajo aislado:** `/poc/catalyst-3-2/` (segregado al 100% de la producción)  
**Resultado de Sonda Firestore (Fase 3.2.2):** **PASS-INTEGRATION** (HTTP 200 OK, 378.48 ms)  
**Herramienta de Inventario (Fase 3.3):** `poc/catalyst-3-2/scripts/inventory-firestore.ps1` (Lista para ejecución)  

---

## 0. GARANTÍAS DE SEGURIDAD Y ESTADO DEL REPOSITORIO RAÍZ

Se ha verificado la integridad absoluta del repositorio:
1. **Archivos productivos intactos:** Los directorios `src/` (frontend React 19 + Tailwind), `functions/` (Cloud Functions v2), `firestore.rules`, `package.json` raíz y el archivo de bloqueo `bun.lock` no han sufrido alteración alguna (fechas preservadas al 100%).
2. **Compilación productiva independiente:** La compilación de Vite (`npm run build`) procesa exclusivamente `index.html` y el árbol de dependencias de `src/main.tsx`. El subdirectorio `poc/catalyst-3-2` no forma parte del bundle ni de la distribución generada en `dist/`.
3. **Cero exposición de credenciales:**
   - La raíz posee `.gitignore` con `.env*` y la excepción explícita `!.env.example`.
   - El subdirectorio `poc/catalyst-3-2/` cuenta con su propio `.gitignore` replicando idéntica regla (`.env*` ignorado, `!.env.example` versionado).
   - Ningún secreto, token o contraseña ha sido impreso en consola ni registrado en archivos rastreados.
4. **Verificación de Linters:** `npm run lint` (`tsc --noEmit` en raíz) y `compile_applet` se ejecutaron con **0 errores**.

---

## 1. RESOLUCIÓN DE ENTORNO: DISCREPANCIA AI STUDIO VS ESTACIÓN LOCAL

### A. Diagnóstico del Problema de Resolución del SDK
Al intentar ejecutar el script de Node.js en la estación de trabajo local del desarrollador:
```bash
npx tsx ./scripts/test-firestore-read.ts
```
Se produjo el error `ERR_MODULE_NOT_FOUND: Cannot find package '@google-cloud/firestore'`.

**Causa Raíz Identificada:**
- Las instalaciones de npm realizadas previamente mediante herramientas de agente se ejecutaron en el sistema de archivos virtualizado del contenedor de Google AI Studio (`/app/applet/poc/catalyst-3-2/node_modules/`).
- La estación Windows física del desarrollador sincroniza los archivos de código fuente, pero su carpeta local `node_modules` no contenía dichos paquetes al no haberse ejecutado un `npm install` local.
- Para evitar obligar al usuario a instalar paquetes pesados en su ordenador o lidiar con discrepancias de dependencias, se cambió la estrategia a una solución **cero dependencias**.

### B. Cambio de Estrategia: API REST Oficial y PowerShell Nativo
Se implementó un script independiente en PowerShell nativo:
`poc/catalyst-3-2/scripts/test-firestore-read.ps1`

**Características de la Solución REST:**
1. **Cero Dependencias npm:** No requiere `@google-cloud/firestore`, `google-auth-library` ni `node_modules`. Funciona directamente con `Invoke-WebRequest` o `Invoke-RestMethod` nativo de PowerShell (compatible con Windows PowerShell 5.1 y PowerShell 7+).
2. **Autenticación ADC en Memoria:** Obtiene el token de acceso ejecutando internamente:
   ```powershell
   $rawToken = & gcloud auth application-default print-access-token 2>&1
   ```
   **Regla de Seguridad Estricta:** El token se almacena exclusivamente en una variable volátil en memoria. **Nunca** se imprime en pantalla, no se guarda en disco ni se incluye en logs.
3. **Detección Automática de Quota Project:** Si el archivo local `%APPDATA%\gcloud\application_default_credentials.json` define un `quota_project_id`, el script lo detecta e incluye la cabecera `x-goog-user-project` automáticamente.
4. **Endpoint REST Oficial:**
   ```
   GET https://firestore.googleapis.com/v1/projects/gen-lang-client-0041212770/databases/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c/documents/_system_/audit_read_probe?mask.fieldPaths=__meta_probe_only__
   ```
5. **Invariante de Privacidad de Datos:** La llamada utiliza una máscara de campos (`mask.fieldPaths`) y nunca extrae ni muestra contenidos, campos de atletas, biometría ni entrenamientos. Solo valida el estado HTTP, existencia y latencia.

---

## 2. INVENTARIO EXHAUSTIVO DE LAS 32 PRUEBAS AUTOMATIZADAS

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
| **21** | `concurrency.test.ts` | debe rechazar escrituras en el recurso de negocio si un worker demorado intenta escribir con un fencing token antiguo | No | **Sí** | **Sí** | No | **Reproduce el escenario de 5 pasos:** A consigue token 100 -> expira -> B consigue 101 y escribe -> A despierta con 100 y es rechazado por `lastFencingToken < 100` = false. | Motor en memoria de alta fidelidad. | **PASS-UNIT** |
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

## 3. RESULTADO CONFIRMADO DE INTEGRACIÓN LOCAL (FASE 3.2.2)

La prueba de lectura autorizada de Cloud Firestore desde la estación Windows del desarrollador mediante PowerShell y Application Default Credentials (ADC) fue ejecutada exitosamente:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-3-2\scripts\test-firestore-read.ps1
```

### Resultados de la Ejecución Real:
- **Código de Estado HTTP:** `200 OK`
- **Documento Comprobado:** `_system_/audit_read_probe` (EXISTENTE)
- **Latencia de Respuesta:** `378.48 ms`
- **Identidad Autorizada (IAM):** `jhonyandreyburga@gmail.com`
- **Proyecto Quota:** `gen-lang-client-0041212770`
- **Base de Datos Firestore:** `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c` (Named DB, `ENTERPRISE`, `us-east1`)
- **Estado de Facturación GCP:** Cero errores `BILLING_DISABLED`. El plano de datos (*Data Plane*) para operaciones GET de lectura se encuentra abierto y accesible bajo el rol de propietario (`roles/owner`).
- **Operaciones de Escritura:** Cero escrituras, mutaciones o alteraciones.
- **Clasificación Obtenida:** **`PASS-INTEGRATION`**

---

## 4. FASE 3.3.1: CORRECCIÓN TÉCNICA DEL INVENTARIO Y PROYECCIÓN SEGURA

Durante la primera ejecución local del modo Shallow de la Fase 3.3, se detectaron fallos de especificación en la API REST de Firestore que motivaron la presente auditoría correctiva.

### A. Diagnóstico y Causa Raíz del Error HTTP 400
- **URL Ejecutada:** `documents/users?pageSize=100&showMissing=true&mask.fieldPaths=__none__`
- **Error Obtenido:** `HTTP 400 — INVALID_ARGUMENT: Invalid reserved name in field path __none__`
- **Causa Raíz:** Según la especificación oficial de Google Cloud Firestore REST (`DocumentMask`), los nombres que inician y terminan con doble guion bajo (`__`) están reservados exclusivamente para campos del sistema (como `__name__`). La cadena `__none__` fue rechazada por el analizador sintáctico de Firestore como un nombre reservado ilegal.

### B. Solución Arquitectónica: StructuredQuery con Proyección Estricta de `__name__`
Se reemplazó la invocación de `GET /documents/{colId}` con máscara inválida por una consulta estructurada oficial:
- **Método y Endpoint:** `POST https://firestore.googleapis.com/v1/projects/{projectId}/databases/{databaseId}/documents:runQuery`
- **Cuerpo StructuredQuery:**
  ```json
  {
    "structuredQuery": {
      "select": {
        "fields": [
          { "fieldPath": "__name__" }
        ]
      },
      "from": [
        { "collectionId": "users" }
      ],
      "orderBy": [
        {
          "field": { "fieldPath": "__name__" },
          "direction": "ASCENDING"
        }
      ],
      "limit": 100
    }
  }
  ```
- **Invariante de Privacidad (Zero Data Leakage):** Al seleccionar únicamente `__name__`, la respuesta de Firestore contiene únicamente la referencia del documento (`name`), marca temporal de creación (`createTime`) y actualización (`updateTime`). El objeto de datos `fields` no se transmite por la red.
- **Paginación Determinista:** Se implementó paginación por cursores con ordenamiento explícito por `__name__`:
  ```json
  "startAt": {
    "values": [
      { "referenceValue": "projects/.../databases/.../documents/users/ultimo_id" }
    ],
    "before": false
  }
  ```
  El atributo `before: false` garantiza semántica de inicio estricto posterior al cursor (*startAfter*), evitando lecturas duplicadas sin depender de offsets no escalables.

### C. Investigación de Discrepancia: `_system_` frente a `users`
- **Contexto:** En la Fase 3.2.2, la sonda GET `_system_/audit_read_probe` respondió `HTTP 200 OK`. Sin embargo, en la ejecución de la Fase 3.3, `listCollectionIds` en la raíz devolvió únicamente `users` y omitió `_system_`.
- **Comprobación de Consistencia Implementada:**
  El script ejecuta ahora una rutina de consistencia en 3 pasos:
  1. Re-listado dinámico de colecciones raíz mediante `POST :listCollectionIds`.
  2. Consulta StructuredQuery sobre `_system_` proyectando `__name__`.
  3. Verificación puntual del documento `_system_/audit_read_probe` vía GET directo.
- **Dictamen Preliminar:** En Cloud Firestore, las colecciones prefijadas con guion bajo (`_`) frecuentemente son omitidas por el índice de metadatos de colecciones estándar o corresponden a colecciones creadas puntualmente sin registrar metadatos de catálogo. Para resolver esto, el script ahora incluye una lista obligatoria de inspección (`_system_`, `users`, `athletes`, `trainers`, `invitations`, `security_audit`, `locks`) garantizando que ninguna colección crítica quede sin auditar. Los resultados se registran en `consistency-check.json`.

### D. Tratamiento de Estados Incompletos y Conteo de Documentos
- **Regla Estricta:** Si una consulta de enumeración falla (HTTP 400, 403, 500):
  - `DocumentsEnumerated` se establece en `null` (nunca en `0`).
  - `EnumerationComplete` se marca como `false`.
  - `HasMore` se establece en `null`.
  - El resultado global se clasifica inmediatamente como **`PARTIAL_FAILURE`**.
- Solo se asigna conteo `0` cuando una consulta StructuredQuery se ejecuta exitosamente (`HTTP 200`) y el array de resultados devuelto está vacío.

### E. Corrección de Rutas de Reportes y Archivado Preventivo
- **Problema Detectado:** Los reportes se almacenaron anteriormente en `C:\reports\firestore-inventory` debido a una resolución incorrecta de la ruta con barras oblicuas en Windows.
- **Corrección:** Se reescribió la resolución mediante `Split-Path -Parent $PSScriptRoot` y `Join-Path`, anclando la salida garantizada en:
  `poc/catalyst-3-2/reports/firestore-inventory/`
- **Archivado Automático:** Si existen reportes de una ejecución previa, el script los respalda automáticamente en `archive/run-<timestamp>/` antes de generar los nuevos, preservando la evidencia histórica.

### F. Limitación Arquitectónica: Padres Inexistentes (Missing Parents)
En Firestore, si existen subcolecciones bajo una ruta donde el documento padre no fue creado o fue eliminado, una consulta sobre la colección padre no retornará dichos identificadores. Identificar estos nodos fantasma requeriría consultas globales `allDescendants: true`, las cuales están restringidas en este momento para evitar posibles transferencias accidentales de campos privados. Esta limitación se documenta formalmente y no se declarará el inventario profundo completo hasta resolver de forma segura este mapeo.

---

## 5. BATERÍA DE PRUEBAS UNITARIAS DE LÓGICA REST (FASE 3.3.1)

Se creó la suite de pruebas unitarias `poc/catalyst-3-2/scripts/test-inventory-logic.ts` ejecutada mediante `tsx`:

| # | Prueba Unitaria | Componente Evaluado | Resultado |
| :-: | :--- | :--- | :-: |
| **1** | Generación de proyección exclusiva `__name__` | `buildRunQueryBody` | **PASS-UNIT** |
| **2** | Generación de cursor `startAt` con `referenceValue` y `before: false` | `buildRunQueryBody` | **PASS-UNIT** |
| **3** | Rechazo *fail-closed* ante `collectionId` vacío | `buildRunQueryBody` | **PASS-UNIT** |
| **4** | Parseo de respuesta StructuredQuery y stream sin `fields` | `parseRunQueryResponse` | **PASS-UNIT** |
| **5** | Detección *failsafe* ante presencia anómala de campos privados | `parseRunQueryResponse` | **PASS-UNIT** |
| **6** | Invariante de estado ante fallo (`DocumentsEnumerated = null`) | `recordCollectionResult` | **PASS-UNIT** |
| **7** | Clasificación `PARTIAL_FAILURE` y total indeterminado ante errores | `evaluateOverallSummary` | **PASS-UNIT** |
| **8** | Clasificación `COMPLETED_SUCCESS` cuando todas las consultas triunfan | `evaluateOverallSummary` | **PASS-UNIT** |

**Resultado:** **8/8 pruebas unitarias aprobadas (100% PASS-UNIT)**.

---

## 6. COMANDO OFICIAL PARA EL DESARROLLADOR EN WINDOWS

Abra PowerShell en la raíz del proyecto y ejecute el inventario corregido en Modo Shallow:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-3-2\scripts\inventory-firestore.ps1 -Mode Shallow
```

*O mediante el comando de npm:*
```bash
npm --prefix poc/catalyst-3-2 run inventory-firestore:shallow
```

---

## 7. CLASIFICACIÓN GENERAL DE RESULTADOS

| Componente / Prueba | Estado | Detalle y Evidencia |
| :--- | :---: | :--- |
| **Pruebas Unitarias de Arquitectura Catalyst (32 tests)** | **PASS-UNIT** | 32/32 tests aprobados en Vitest |
| **Pruebas Unitarias de Lógica REST Firestore (8 tests)** | **PASS-UNIT** | 8/8 tests aprobados en `test-inventory-logic.ts` |
| **Sonda Individual Firestore Data Plane (Fase 3.2.2)** | **PASS-INTEGRATION** | HTTP 200 OK en `_system_/audit_read_probe` (378.48 ms) |
| **Inventario Superficial Ejecución 1 (Fase 3.3)** | **PARTIAL** | Bloqueado por HTTP 400 (`__none__`); mitigado en Fase 3.3.1 |
| **Inventario Superficial Ejecución 2 (Fase 3.3.1)** | **PENDING RUN** | Script corregido con `runQuery (__name__)`, listo para ejecución |
| **Integridad del Repositorio de Producción** | **100% INTACTA** | `src/`, `functions/`, `package.json` raíz y `firestore.rules` inalterados |
| **Compilación y Linters** | **0 ERRORES** | `npm run build` y `npm run lint` aprobados limpiamente |

---

## 8. DICTAMEN TÉCNICO

### Dictamen:
# **PARTIAL — HERRAMIENTA CORREGIDA Y VALIDADA EN MOCK / LISTA PARA SEGUNDA EJECUCIÓN REAL**

**Fundamentación:**
La causa raíz del error HTTP 400 fue aislada y eliminada reemplazando la máscara sintáctica inválida `__none__` por la consulta estructurada oficial `runQuery` con proyección `__name__` y cursores `startAt`. Las 8 pruebas unitarias demuestran la preservación de la privacidad y el tratamiento honesto de estados incompletos. La herramienta se encuentra lista en su ubicación definitiva para que el usuario ejecute la segunda prueba de inventario superficial en su estación local.


