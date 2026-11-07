# VIGORCORE — PLAN DE PUESTA EN PRODUCCIÓN: SISTEMA DE GESTIÓN DE USUARIOS Y RBAC
## Documento Técnico de Arquitectura, Operaciones y Runbook de Activación (Fase 7D-PRE.3)

---

### 1. ARQUITECTURA DE PRODUCCIÓN Y RUNTIME NODE.JS 22

#### Identificadores Oficiales del Sistema:
- **Google Cloud / Firebase Project ID:** `gen-lang-client-0041212770`
- **Cloud Firestore Named Database ID:** `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`
- **Dominio Público Oficial:** `https://fit-x-bhnatsxl.onslate.com` (Alojado en plataforma OnSlate)
- **Proyecto Aislado de Pruebas Locales:** `demo-vigorcore-rules`
- **Configuración de Emulador:** `firebase.rules-test.json` (Base única `(default)` para Security Rules locales)
- **Configuración Oficial de Despliegue:** `firebase.json` (Base nombrada oficial, índices, runtime `nodejs22` y predeploy hook)
- **Runtime Oficial de Backend:** **Node.js 22 (`nodejs22`)** — *Node.js 20 fue formalmente descontinuado en Google Cloud el 30 de octubre de 2026*.

#### Reproducibilidad del Build y Dependencias de Functions:
- **Árbol de dependencias bloqueado:** `functions/package-lock.json` existe, está sincronizado con `functions/package.json` y versionado en el repositorio (246 paquetes instalados limpiamente).
- **Diagnóstico del error de 23 módulos en Windows:**
  En entornos locales donde se ejecutó `npm --prefix functions run build` directamente sin haber ejecutado previamente la instalación de paquetes (`npm ci`), el compilador TypeScript (`tsc`) emitió 23 errores debido a la ausencia física del directorio `functions/node_modules`.
  Al ejecutar:
  ```powershell
  npm --prefix functions ci
  npm --prefix functions run build
  ```
  El árbol de dependencias se descarga de manera determinista y la compilación finaliza con **0 errores y 0 advertencias**.
- **Distinción entre Node.js Local y Node.js Runtime de Google Cloud:**
  - Si el desarrollador tiene instalado localmente Node.js `v24.16.0` en su máquina Windows, puede compilar localmente con TypeScript sin inconvenientes.
  - Sin embargo, para el despliegue serverless hacia Google Cloud Functions v2, el runtime de destino **debe ser `nodejs22`** (definido en `firebase.json` y `engines.node: "22"` en `functions/package.json`), dado que Node 24 aún no es un runtime LTS oficialmente soportado por Cloud Functions v2.

#### Diagrama de Capas y Flujo de Autorización:
```
                                   +-------------------------------------------------------------+
                                   |                   USUARIO / NAVEGADOR                       |
                                   |       (Frontend React 19 + Vite en OnSlate)                 |
                                   +------------------------------+------------------------------+
                                                                  |
                                      HTTPS Callable / ID Token   |   Direct Firestore Client SDK
                                       (Bearer Custom Claims)     |    (Rules Enforcement)
                                                                  v                               v
                             +----------------------------------------+   +---------------------------------------+
                             |       CLOUD FUNCTIONS V2 (Node 22)     |   |          CLOUD FIRESTORE              |
                             |  Callable Functions con Auth Guard     |   | Base de Datos Nombrada:               |
                             |  - Validación de role y roleVersion    |   | ai-studio-vigorcore-...               |
                             |  - Verificación de accountAccess       |   |                                       |
                             |  - Token anti-stale & revocación       |   | Reglas Evaluadas:                     |
                             +--------------------+-------------------+   | - isOwner / isAccountActive           |
                                                  |                       | - isAdministrativeAccountActive       |
                               Direct GA Client   | (@google-cloud/       | - isAuthoritativeRole & roleVersion   |
                                 new Firestore()  |  firestore)           | - allow write: if false en admin cols |
                                                  v                       +---------------------------------------+
                             +----------------------------------------+                      ^
                             |     CLOUD FIRESTORE (Privilegiado)     |                      |
                             |  - adminRoleState                      |                      |
                             |  - accountAccess                       |                      |
                             |  - adminUserDirectory                  +----------------------+
                             |  - adminInvitations                    | (Misma Base de Datos Nombrada)
                             |  - adminAuditLogs (Append-Only)        |
                             +----------------------------------------+
```

---

### 2. INVENTARIO CANÓNICO DE LAS 11 CLOUD FUNCTIONS V2 (RUNTIME NODE.JS 22)

Todas las funciones están implementadas mediante `firebase-functions/v2/https` (`onCall`), compiladas en `functions/lib/index.js` bajo el runtime **Node.js 22** con target ECMAScript `es2022`.

> **ACLARACIÓN SOBRE DISCREPANCIAS DE NOMBRES:**
> En informes preliminares de diseño aparecían listados hipotéticos en minúsculas (ej. `assignadminrole`, `suspendaccount`). El código base real implementado y consumido por el frontend en `src/services/adminUserService.ts` utiliza exclusivamente las siguientes 11 funciones en notación camelCase:

| # | Nombre Exportado en `index.ts` | Nombre de Despliegue en CLI | Tipo / Trigger | Región | Runtime | Memoria / Timeout | Permisos / Roles Permitidos | Dependencias de Colecciones Firestore | Relación con el Sistema Administrativo |
|:---:|---|---|---|:---:|:---:|:---:|:---:|---|---|
| **1** | `listAdminUsers` | `listAdminUsers` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | `admin`, `superadmin` | `adminUserDirectory`, `adminRoleState`, `accountAccess` | Directorio de usuarios paginado con filtros de rol, estado y búsqueda |
| **2** | `getAdminStats` | `getAdminStats` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | `admin`, `superadmin` | `adminUserDirectory`, `adminInvitations` | Métricas de plataforma (total atletas, admins, activos, invitaciones pendientes) |
| **3** | `getAdminUserDetail` | `getAdminUserDetail` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | `admin`, `superadmin` | `adminUserDirectory`, `accountAccess`, `adminAuditLogs` | Ficha técnica de usuario, historial reciente de auditoría y estado de acceso |
| **4** | `createAdminInvitation` | `createAdminInvitation` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | `admin` (solo atletas), `superadmin` | `adminInvitations`, `adminUserDirectory`, `adminAuditLogs` | Creación de token criptográfico SHA-256 e invitación con caducidad de 7 días |
| **5** | `revokeAdminInvitation` | `revokeAdminInvitation` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | `admin`, `superadmin` | `adminInvitations`, `adminAuditLogs` | Revocación inmediata e invalidación de token de invitación |
| **6** | `acceptAdminInvitation` | `acceptAdminInvitation` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 512 MiB / 120s | Usuario autenticado verificado | `adminInvitations`, `adminInvitationOperations`, `adminRoleState`, `adminUserDirectory`, `accountAccess`, Auth Claims | Canje transaccional seguro con lock de concurrencia, saga fail-closed y asignación de claims |
| **7** | `setAdminUserRole` | `setAdminUserRole` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | **Solo `superadmin`** | `adminRoleState`, `adminUserDirectory`, `adminAuditLogs`, Auth Claims | Promoción/degradación con versionado monotónico (`roleVersion + 1`) y protección del último superadmin |
| **8** | `setAdminUserStatus` | `setAdminUserStatus` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | `admin` (solo atletas), `superadmin` | `accountAccess`, `adminUserDirectory`, `adminAuditLogs`, Auth State | Suspensión/reactivación con revocación de refresh tokens y fijación de `validAfter` |
| **9** | `requestAdminPasswordReset` | `requestAdminPasswordReset` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | `admin`, `superadmin` | `adminUserDirectory`, `adminAuditLogs`, Auth Link | Generación de enlace seguro de restablecimiento de contraseña vía Firebase Auth |
| **10**| `syncCurrentUserDirectory` | `syncCurrentUserDirectory` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | Usuario autenticado (propietario) | `adminUserDirectory`, `accountAccess`, `adminRoleState` | Sincronización automática de perfil al iniciar sesión para mantener el directorio actualizado |
| **11**| `getAdminAuditLogs` | `getAdminAuditLogs` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | `admin`, `superadmin` | `adminAuditLogs` | Bitácora inmutable append-only con filtros por acción, actor, destinatario y fecha |

---

### 3. IDENTIDADES IAM Y RUNTIME SERVICE ACCOUNT EN CLOUD FUNCTIONS V2

Para evitar vulnerabilidades de autorización y errores de ejecución, es crucial distinguir las tres identidades que intervienen en el ciclo de vida del sistema:

#### A. Las Tres Identidades Técnicas:
1. **Identidad del Operador de Despliegue (Deployer Identity):**
   - Cuenta de usuario personal (ej. `jhonyandreyburga@gmail.com`) autenticada mediante `gcloud auth login` o `firebase login`.
   - Requiere permisos administrativos en el proyecto: `roles/cloudfunctions.admin`, `roles/run.admin`, `roles/iam.serviceAccountUser`, `roles/artifactregistry.admin`, `roles/firebaserules.admin`.
2. **Cuenta de Servicio del Pipeline de Compilación (Build Agent Identity):**
   - `PROJECT_NUMBER@cloudbuild.gserviceaccount.com` y `service-PROJECT_NUMBER@gcp-sa-cloudbuild.gserviceaccount.com`.
   - Utilizada internamente por Google Cloud Build para construir las imágenes de contenedor de Node.js 22 y almacenarlas en Artifact Registry.
3. **Cuenta de Servicio de Ejecución en Runtime (Runtime Service Account):**
   - **Identidad Real en Cloud Functions v2:** `PROJECT_NUMBER-compute@developer.gserviceaccount.com` (Compute Engine default service account).
   - *Corrección crítica:* La identidad `PROJECT_ID@appspot.gserviceaccount.com` correspondía a Cloud Functions v1. En v2, que corre sobre infraestructura Cloud Run, la cuenta de ejecución predeterminada es la de Compute Engine.
   - En `functions/src/index.ts` no se ha especificado un parámetro `serviceAccount` personalizado, por lo que las 11 funciones operan bajo la cuenta predeterminada de Compute Engine.

#### B. Permisos Mínimos Requeridos para la Runtime Service Account:
Para que las funciones operen bajo el principio de mínimo privilegio, la cuenta `PROJECT_NUMBER-compute@developer.gserviceaccount.com` debe poseer únicamente:
- **`roles/datastore.user` (Cloud Datastore User):** Permite operaciones de lectura, escritura, transacciones y consultas sobre la base nombrada `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`.
- **`roles/firebaseauth.admin` (Firebase Authentication Admin):** Permite consultar usuarios (`getUser`), revocar refresh tokens, asignar Custom Claims y generar enlaces de password reset.
- **`roles/logging.logWriter` (Logs Writer):** Permite emitir registros estructurados hacia Google Cloud Logging.
- **`roles/artifactregistry.reader` (Artifact Registry Reader):** Permite a Cloud Run extraer la imagen del contenedor.

#### C. Diferencia entre CLI Login y Application Default Credentials (ADC):
- **`gcloud auth login`:** Autentica la herramienta de línea de comandos `gcloud` para operaciones interactivas de administración.
- **`gcloud auth application-default login`:** Genera un archivo de credenciales local (`application_default_credentials.json`) en la máquina del desarrollador para que los scripts locales (`scripts/test_backend_firestore_database.ts`, etc.) puedan invocar APIs de Google Cloud emulando una cuenta de servicio.
- **En Producción (Cloud Functions v2):** No se utiliza ninguno de los dos comandos anteriores; Google Cloud inyecta automáticamente las Application Default Credentials (ADC) en el contenedor a través del servidor de metadatos (`http://metadata.google.internal`).

---

### 4. ACCESO BACKEND A FIRESTORE: IMPLEMENTACIÓN MEDIANTE `@google-cloud/firestore` GA

#### A. Arquitectura Canónica:
El backend de VigorCore utiliza el paquete oficial de Google Cloud **`@google-cloud/firestore` (v9.4.0)**:
```typescript
import { Firestore } from '@google-cloud/firestore';

export function getNamedFirestore(): Firestore {
  return new Firestore({
    projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0041212770',
    databaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
  });
}
```
- **Constructor GA:** `new Firestore({ projectId, databaseId })` es una API en General Availability (GA), sin anotaciones `@beta` ni advertencias de desuso.
- **Aislamiento Multibase de Datos:** Todas las colecciones administrativas y de negocio residen en la base nombrada, garantizando separación total con la base `(default)`.

---

### 5. AUDITORÍA DE FACTURACIÓN, APIS E IAM (CONSULTAS DE SOLO LECTURA)

> **ESTADO DE VERIFICACIÓN:** **`NO VERIFICABLE REMOTAMENTE`**
> Dado que el usuario no tiene una sesión de `gcloud` autenticada en su máquina Windows, los estados de facturación, servicios e IAM permanecen técnicamente sin verificar. No se debe inventar ningún estado.

El operador del proyecto debe ejecutar las siguientes consultas de **solo lectura** en su terminal autorizada o Google Cloud Shell:

```powershell
# 1. Comprobar identidad activa:
gcloud auth list

# 2. Comprobar proyecto activo:
gcloud config get-value project

# 3. Comprobar facturación (debe mostrar billingEnabled: true):
gcloud billing projects describe gen-lang-client-0041212770

# 4. Comprobar servicios y APIs activas:
gcloud services list --enabled --project=gen-lang-client-0041212770

# 5. Comprobar políticas IAM de solo lectura:
gcloud projects get-iam-policy gen-lang-client-0041212770 --format=json
```

#### Servicios Mandatorios para Fase 7D:
- `cloudfunctions.googleapis.com` (Cloud Functions v2)
- `run.googleapis.com` (Cloud Run runtime)
- `cloudbuild.googleapis.com` (Compilación de contenedores)
- `artifactregistry.googleapis.com` (Registro de imágenes)
- `firestore.googleapis.com` (Cloud Firestore)
- `identitytoolkit.googleapis.com` (Firebase Authentication)
- `logging.googleapis.com` (Cloud Logging)

---

### 6. ANÁLISIS CUALITATIVO DE COSTOS Y CUOTAS EN GOOGLE CLOUD

No es viable ni responsable estimar un valor numérico fijo (como "$0.00 USD") sin métricas históricas de usuarios concurrentes, volumen de lecturas, escrituras, almacenamiento o logs. A continuación se detalla la estructura cualitativa de costos:

#### A. Niveles Gratuitos Incluidos (Free Tier mensual):
- **Cloud Functions / Cloud Run:** 2 millones de invocaciones/mes gratuitas, 360,000 GiB-segundos de memoria y 180,000 vCPU-segundos de cómputo.
- **Cloud Firestore:** 50,000 lecturas/día, 20,000 escrituras/día, 20,000 eliminaciones/día y 1 GiB de datos almacenados.
- **Cloud Build:** 120 minutos/día de compilación gratuitos en máquinas estándar `e2-medium`.
- **Cloud Logging:** Primeros 50 GiB/mes de ingesta de logs gratuitos.

#### B. Componentes Facturables y Riesgos de Consumo:
1. **Artifact Registry:** Las imágenes generadas por Cloud Build para las 11 funciones ocupan almacenamiento continuo (~300-500 MiB por despliegue). Sin políticas de ciclo de vida (retención de últimas N versiones), este almacenamiento genera costos recurrentes (~$0.10 USD/GiB/mes).
2. **Cloud Logging:** Si una función entra en bucle de excepciones o genera logs muy verbosos, puede superar los 50 GiB gratuitos ($0.50 USD por GiB adicional).
3. **Egreso de Red (Egress):** Tráfico de salida hacia internet por encima de 10 GiB/mes genera costos variables según la región.
4. **Bases de Datos Nombradas en Firestore:** Verificar en la consola de facturación si la base nombrada consume la cuota gratuita consolidada o aplica tarificación por uso directo.

#### C. Alertas Presupuestarias (Budget Alerts):
- Se recomienda configurar una alerta de presupuesto en la consola de Google Cloud Billing fijada en $25.00 USD con avisos al 50%, 80% y 100%.
- **Aclaración crítica:** Las alertas de presupuesto de Google Cloud **son puramente informativas; NO suspenden el servicio ni limitan automáticamente el gasto**.

---

### 7. PLAN DE RESPALDO (BACKUP) DE CLOUD FIRESTORE

> **ESTADO DE VERIFICACIÓN:** **`BLOQUEADO`**
> Actualmente **no existe un bucket de respaldo verificado** en el proyecto, y la ubicación geográfica exacta de la base nombrada no ha sido comprobada remotamente.

#### A. Inspección Previa de la Base de Datos Nombrada:
Antes de crear cualquier recurso de almacenamiento, el operador debe consultar los metadatos de la base mediante:
```powershell
gcloud firestore databases describe `
    --database="ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c" `
    --project="gen-lang-client-0041212770" `
    --format="json"
```
Esta consulta revelará:
- `locationId`: Región exacta de la base (ej. `us-central1`, `nam5`, etc.).
- `type`: `FIRESTORE_NATIVE`.
- `pointInTimeRecoveryEnablement`: Estado de PITR (`ENABLED` o `DISABLED`).
- `deleteProtectionState`: Protección contra eliminación accidental.

#### B. Creación del Bucket y Permisos:
El bucket de respaldo debe crearse **en la misma región** que la base de datos para evitar costos de egreso interregional y asegurar mínima latencia:
```powershell
# 1. Definir identificador único global (reemplazar REGION con el locationId obtenido):
$BUCKET_NAME = "gs://vigorcore-firestore-backups-gen-lang-client-0041212770"

# 2. Crear el bucket con control de acceso uniforme:
gcloud storage buckets create $BUCKET_NAME `
    --project="gen-lang-client-0041212770" `
    --location="<REGION_OBTENIDA>" `
    --uniform-bucket-level-access

# 3. Otorgar permisos a la cuenta de servicio de Firestore:
$PROJECT_NUMBER = (gcloud projects describe gen-lang-client-0041212770 --format="value(projectNumber)")
gcloud storage buckets add-iam-policy-binding $BUCKET_NAME `
    --member="serviceAccount:service-$PROJECT_NUMBER@gcp-sa-firestore.iam.gserviceaccount.com" `
    --role="roles/storage.admin"
```

#### C. Procedimiento de Exportación y Verificación:
```powershell
# Exportar base completa:
gcloud firestore export $BUCKET_NAME/pre-7d-backup-$(Get-Date -Format "yyyyMMdd-HHmmss") `
    --database="ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c" `
    --project="gen-lang-client-0041212770"
```
- **Verificación:** Listar el contenido del bucket para confirmar la existencia de los archivos `all_namespaces/all_kinds.export_metadata`.
- **Procedimiento de Recuperación (Import):**
  ```powershell
  gcloud firestore import $BUCKET_NAME/<RUTA_EXPORTACION> `
      --database="ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c" `
      --project="gen-lang-client-0041212770"
  ```

---

### 8. PLAN REALISTA DE ROLLBACK DE REGLAS Y CLOUD FUNCTIONS

#### A. Rollback de Security Rules:
- **Inspección de Archivos Locales:** El archivo `firestore.rules.backup-20261023-pre-deploy-6c2` tiene 280 líneas y pertenece a la fase 6C.2 (rutinas, nutrición, biometrías). **No contiene ninguna de las 6 colecciones administrativas de 7D ni soporte de RBAC jerárquico**. No es un rollback equivalente para 7D.
- **Estado:** **`PENDIENTE DE IDENTIFICACIÓN REMOTA`**.
- **Procedimiento Obligatorio Pre-Despliegue:**
  Antes de desplegar las nuevas reglas, el operador debe extraer el snapshot remoto exacto de las reglas en vivo:
  ```powershell
  npx firebase firestore:rules:get --project gen-lang-client-0041212770 > firestore.rules.pre-7d-live-backup.rules
  ```
  En caso de fallo en producción, se restaurará ese archivo capturado en vivo.

#### B. Rollback de Cloud Functions v2:
Dado que es el **primer despliegue** de funciones en producción, no existen revisiones previas a las que volver. Se distinguen formalmente las 4 estrategias de contingencia:
1. **Rollback de Código:** Re-desplegar un commit previo del repositorio. Al ser el primer despliegue, el estado previo es "cero funciones desplegadas".
2. **Desactivación de Endpoints (Recomendado en Incidente):**
   - *Vía IAM:* Revocar la invocación pública de Cloud Run para la función afectada:
     ```powershell
     gcloud run services remove-iam-policy-binding <NOMBRE_FUNCION> `
         --region=us-central1 `
         --member="allUsers" `
         --role="roles/run.invoker" `
         --project=gen-lang-client-0041212770
     ```
   - *Vía Escalamiento a 0 instancias:*
     ```powershell
     gcloud run services update <NOMBRE_FUNCION> `
         --region=us-central1 `
         --max-instances=0 `
         --project=gen-lang-client-0041212770
     ```
     *Comportamiento técnico:* Cloud Run acepta `--max-instances=0`. Al recibir peticiones entrantes, el control plane no puede asignar contenedores y responde de inmediato con HTTP `503 Service Unavailable`, protegiendo la base de datos sin destruir la función.
3. **Rollback de Tráfico:** Desviar tráfico a una revisión previa de Cloud Run. **No aplicable en este despliegue** al no existir revisiones previas.
4. **Eliminación Definitiva:** `npx firebase functions:delete <NOMBRE_FUNCION>` es una acción destructiva de último recurso, no un rollback operativo ordinario.

---

### 9. ESTADO DE SCRIPTS DE BOOTSTRAP Y MIGRACIÓN

- **`scripts/bootstrap_superadmin.ts` (13/13 pruebas unitarias aprobadas):**
  - Requiere `--uid <UID>` obligatorio y explícito.
  - Exige `emailVerified: true` y cuenta no deshabilitada en Firebase Auth.
  - Incrementa monotónicamente `roleVersion` e invalida tokens antiguos.
  - Modo `--dry-run` por defecto; exige `--confirm` explícito.
  - Es 100% idempotente (detecta si ya es superadministrador sin reescribir timestamps de auditoría).
- **`scripts/migrate_existing_users.ts` (Validado):**
  - Paginación segura de 100 usuarios (`auth.listUsers(100)`).
  - Cero operaciones en colecciones personales de atletas (`users/{uid}/*`).
  - **Preservación estricta de suspensiones previas:** Comprueba `accountAccess/{uid}` y mantiene `suspended` o `disabled`.
  - Cuentas con email no verificado reciben el estado `pending_verification`.
  - Modo `--dry-run` por defecto; exige `--no-dry-run --confirm`.

---

### 10. PROTOCOLO DE SMOKE TESTS POST-ACTIVACIÓN (17 COMPROBACIONES)

1. **Smoke Test 00 (Conectividad Real de Red Backend):** Invocación de `getAdminStats` para certificar comunicación de red gRPC entre Cloud Functions v2 y la base nombrada.
2. **Smoke Test 01 (Autenticación Superadmin):** Verificación de claims `{ role: 'superadmin', roleVersion: 1 }` en token JWT.
3. **Smoke Test 02 (Acceso a Consola `/admin`):** Acceso autorizado sin redirección.
4. **Smoke Test 03 (Listado de Directorio):** Carga correcta de atletas migrados con paginación de 20 por página.
5. **Smoke Test 04 (Búsqueda y Filtros):** Filtrado por rol `athlete` y estado `active`.
6. **Smoke Test 05 (Privacidad de Atletas):** Verificación de que el panel administrativo **no tiene acceso de lectura** a biometrías ni registros de entrenamientos privados.
7. **Smoke Test 06 (Emisión de Invitación):** Creación de invitación de prueba con rol `admin`.
8. **Smoke Test 07 (Inmutabilidad Criptográfica):** Inspección de `adminInvitations` confirmando almacenamiento exclusivo de hash SHA-256.
9. **Smoke Test 08 (Canje de Invitación):** Canje exitoso por cuenta autorizada con asignación de lock transaccional.
10. **Smoke Test 09 (Asignación de Roles):** Promoción de cuenta y registro en `adminRoleState`.
11. **Smoke Test 10 (Revocación):** Revocación de invitación y comprobación de bloqueo.
12. **Smoke Test 11 (Suspensión):** Suspensión de cuenta de prueba y deshabilitación en Firebase Auth.
13. **Smoke Test 12 (Bloqueo Hermético):** Comprobación de `PERMISSION_DENIED` en todos los endpoints para cuenta suspendida.
14. **Smoke Test 13 (Reactivación y `validAfter`):** Reactivación y prueba de rechazo de sesiones anteriores.
15. **Smoke Test 14 (Auditoría Append-Only):** Verificación de registros de auditoría en `adminAuditLogs`.
16. **Smoke Test 15 (Acceso Atleta Ordinario):** Verificación de funcionamiento inalterado de rutinas, comidas y entrenamientos para atletas.
17. **Smoke Test 16 (Cloud Logging):** Confirmación de ausencia de excepciones `500` o errores no controlados.
