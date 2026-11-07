# VIGORCORE — PLAN DE PUESTA EN PRODUCCIÓN: SISTEMA DE GESTIÓN DE USUARIOS Y RBAC
## Documento Técnico de Arquitectura, Operaciones y Runbook de Activación (Fase 7D-PRE.2)

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

### 2. INVENTARIO COMPLETO DE CLOUD FUNCTIONS V2 (RUNTIME NODE.JS 22)

Todas las funciones están implementadas mediante `firebase-functions/v2/https` (`onCall`), compiladas en `functions/lib/index.js` bajo el runtime **Node.js 22** con target ECMAScript `es2022`.

| # | Nombre Exportado en `index.ts` | Tipo / Trigger | Región Predeterminada | Runtime | Memoria / Timeout | Permisos / Roles Permitidos | Dependencias de Colecciones Firestore | Relación con el Sistema Administrativo |
|:---:|---|---|:---:|:---:|:---:|:---:|---|---|
| **1** | `listAdminUsers` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | `admin`, `superadmin` | `adminUserDirectory`, `adminRoleState`, `accountAccess` | Directorio de usuarios paginado con filtros de rol, estado y búsqueda |
| **2** | `getAdminStats` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | `admin`, `superadmin` | `adminUserDirectory`, `adminInvitations` | Métricas de plataforma (total atletas, admins, activos, invitaciones pendientes) |
| **3** | `getAdminUserDetail` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | `admin`, `superadmin` | `adminUserDirectory`, `accountAccess`, `adminAuditLogs` | Ficha técnica de usuario, historial reciente de auditoría y estado de acceso |
| **4** | `createAdminInvitation` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | `admin` (solo atletas), `superadmin` | `adminInvitations`, `adminUserDirectory`, `adminAuditLogs` | Creación de token criptográfico SHA-256 e invitación con caducidad de 7 días |
| **5** | `revokeAdminInvitation` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | `admin`, `superadmin` | `adminInvitations`, `adminAuditLogs` | Revocación inmediata e invalidación de token de invitación |
| **6** | `acceptAdminInvitation` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 512 MiB / 120s | Usuario autenticado verificado | `adminInvitations`, `adminInvitationOperations`, `adminRoleState`, `adminUserDirectory`, `accountAccess`, Auth Claims | Canje transaccional seguro con lock de concurrencia, saga fail-closed y asignación de claims |
| **7** | `setAdminUserRole` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | **Solo `superadmin`** | `adminRoleState`, `adminUserDirectory`, `adminAuditLogs`, Auth Claims | Promoción/degradación con versionado monotónico (`roleVersion + 1`) y protección del último superadmin |
| **8** | `setAdminUserStatus` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | `admin` (solo atletas), `superadmin` | `accountAccess`, `adminUserDirectory`, `adminAuditLogs`, Auth State | Suspensión/reactivación con revocación de refresh tokens y fijación de `validAfter` |
| **9** | `requestAdminPasswordReset` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | `admin`, `superadmin` | `adminUserDirectory`, `adminAuditLogs`, Auth Link | Generación de enlace seguro de restablecimiento de contraseña vía Firebase Auth |
| **10**| `syncCurrentUserDirectory` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | Usuario autenticado (propietario) | `adminUserDirectory`, `accountAccess`, `adminRoleState` | Sincronización automática de perfil al iniciar sesión para mantener el directorio actualizado |
| **11**| `getAdminAuditLogs` | HTTPS Callable (`onCall`) | `us-central1` | Node 22 | 256 MiB / 60s | `admin`, `superadmin` | `adminAuditLogs` | Bitácora inmutable append-only con filtros por acción, actor, destinatario y fecha |

---

### 3. ACCESO BACKEND A FIRESTORE: IMPLEMENTACIÓN FINAL MEDIANTE `@google-cloud/firestore` GA

#### A. Eliminación de la API en Preview de Firebase Admin:
Para evitar la función `getFirestore(app, databaseId)` de `firebase-admin` (marcada como `@beta`/Preview), el backend de VigorCore fue refactorizado para utilizar directamente el paquete oficial **`@google-cloud/firestore` (v9.4.0)**, cuya parametrización multibase de datos es **General Availability (GA)** en Google Cloud:
```typescript
import { Firestore, Query, FieldValue } from '@google-cloud/firestore';

export function getNamedFirestore(appOrCustomDb?: any): Firestore {
  if (appOrCustomDb) {
    if (typeof appOrCustomDb.firestore === 'function') return appOrCustomDb.firestore();
    if (typeof appOrCustomDb.collection === 'function') return appOrCustomDb as Firestore;
  }
  return new Firestore({
    projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || VIGORCORE_PROJECT_ID,
    databaseId: VIGORCORE_DATABASE_ID,
  });
}
```

#### B. Garantías de Seguridad Arquitectónica:
1. **Dependencia Directa:** `@google-cloud/firestore` está declarado explícitamente en `functions/package.json` y `package.json`.
2. **Constructor Oficial GA:** Emplea `new Firestore({ projectId, databaseId })`.
3. **Application Default Credentials (ADC):** En Cloud Functions v2, las credenciales son inyectadas automáticamente por el entorno de Google Cloud; **cero archivos de claves de servicio JSON en el repositorio**.
4. **Cero Monkey-Patching:** Se erradicó la mutación reflexiva `(defaultFs as any).databaseId`.
5. **Autenticación con Firebase Admin:** `firebase-admin/auth` (`getAuth()`) continúa gestionando Custom Claims, usuarios y tokens.

#### C. Matriz de Distinción entre Validación Estática, Identidad y Conexión de Red:
- **Inspección de Configuración:** `databaseId === 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c'` (**Verificado en código**).
- **Identificación del Recurso (ARN):** `formattedName === 'projects/gen-lang-client-0041212770/databases/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c'` (**Verificado**).
- **Prueba Unitaria de SDK:** 6/6 comprobaciones pasadas en `npm run test:backend-db` (**Verificado localmente**).
- **Conexión de Red en Producción:** **No ejecutada en esta fase** (requiere credenciales activas en la nube y autorización explícita). Queda preparada como Smoke Test 00 post-despliegue.

---

### 4. AUDITORÍA DE FACTURACIÓN (CLOUD BILLING) Y SERVICIOS EXTERNOS

#### Estado Real de Verificación:
- **Estado:** **NO VERIFICABLE REMOTAMENTE DESDE EL CONTENEDOR LOCAL** (El entorno local de desarrollo carece de credenciales de Google Cloud y del binario `gcloud`).
- **Comando de Inspección de Solo Lectura para el Propietario (PowerShell / Cloud Shell):**
  ```powershell
  gcloud billing projects describe gen-lang-client-0041212770
  ```
- **Criterio de Aprobación:** La propiedad `billingEnabled` debe ser `true`. Si devuelve `billingEnabled: false`, el despliegue de Cloud Functions v2 fallará inmediatamente con error de cuota/facturación.

#### Modelo Económico y Estructura de Costos del Plan Blaze:
1. **Nivel Gratuito de Google Cloud:**
   - Cloud Functions: 2 millones de invocaciones/mes gratuitas.
   - Cloud Run: 2 millones de solicitudes/mes gratuitas, 360.000 GB-segundos y 180.000 vCPU-segundos.
   - Cloud Build: 120 minutos de compilación/día gratuitos.
   - Cloud Firestore: 50.000 lecturas, 20.000 escrituras y 20.000 eliminaciones diarias gratuitas.
2. **Consumo Facturable:**
   - Invocaciones por encima de la cuota gratuita (~0.40 USD por millón).
   - Almacenamiento de artefactos en Artifact Registry (~0.10 USD / GB / mes).
3. **Alertas de Presupuesto (Recomendación Operativa):**
   - Se recomienda fijar una alerta de presupuesto de 25 USD / mes en la consola de Google Cloud con avisos al 50%, 80% y 100%.
   - *Aclaración técnica:* Las alertas presupuestarias envían notificaciones por correo electrónico, pero **no detienen el tráfico ni constituyen un límite automático de gasto**.

---

### 5. ESTADO DE APIS DE GOOGLE CLOUD

#### Matriz de Evaluación de Servicios:

| Servicio | Necesario para 7D | Estado Real en Entorno Local | Acción Pendiente del Propietario |
|---|:---:|:---:|---|
| `cloudfunctions.googleapis.com` | **SÍ** (Cloud Functions v2) | **No verificable remotamente** | Ejecutar verificación con `gcloud services list` |
| `cloudbuild.googleapis.com` | **SÍ** (Compilación de contenedores) | **No verificable remotamente** | Ejecutar verificación con `gcloud services list` |
| `artifactregistry.googleapis.com` | **SÍ** (Almacenamiento de imágenes de Functions) | **No verificable remotamente** | Ejecutar verificación con `gcloud services list` |
| `run.googleapis.com` | **SÍ** (Runtime de Functions v2) | **No verificable remotamente** | Ejecutar verificación con `gcloud services list` |
| `firestore.googleapis.com` | **SÍ** (Base de datos nombrada) | **No verificable remotamente** | Confirmado por uso activo de la aplicación |
| `identitytoolkit.googleapis.com` | **SÍ** (Firebase Authentication) | **No verificable remotamente** | Confirmado por uso activo de la aplicación |
| `logging.googleapis.com` | **SÍ** (Auditoría y Cloud Logging) | **No verificable remotamente** | Habilitada por defecto en proyectos de Google Cloud |
| `secretmanager.googleapis.com` | **NO** (0 secretos en Secret Manager) | **No necesario** | No se requiere en esta fase |
| `eventarc.googleapis.com` | **NO** (Todas las funciones son `onCall`) | **No necesario** | No se requiere para HTTPS Callable |

#### Comando de Comprobación para el Propietario:
```powershell
gcloud services list --enabled --project=gen-lang-client-0041212770
```

---

### 6. AUDITORÍA IAM DE SOLO LECTURA Y PRINCIPIO DE PRIVILEGIO MÍNIMO

- **Estado:** **NO VERIFICABLE REMOTAMENTE** (Requiere ejecución autenticada en Cloud Shell o terminal autorizada).
- **Comando de Comprobación:**
  ```powershell
  gcloud projects get-iam-policy gen-lang-client-0041212770 --format=json
  ```
- **Matriz de Roles Requeridos para el Operador de Despliegue:**
  - `roles/firebase.admin` (Gestión de reglas e índices)
  - `roles/cloudfunctions.admin` (Despliegue de funciones)
  - `roles/cloudbuild.builds.editor` (Compilación en Cloud Build)
  - `roles/run.admin` (Creación de servicios en Cloud Run)
  - `roles/iam.serviceAccountUser` (Impersonación de la cuenta de servicio de Functions)

---

### 7. PLAN DE RESPALDO (BACKUP) Y REVERSIÓN

#### A. Estado del Bucket de Respaldo:
- **Estado Actual:** **PENDIENTE DE CONFIGURACIÓN DEL BUCKET**.
- En el repositorio no existe un nombre de bucket de respaldo confirmado ni se deben inventar identificadores.
- **Procedimiento de Creación y Respaldo para el Propietario:**
  ```powershell
  # 1. Crear bucket de respaldo en la misma multi-región o región de Firestore:
  gcloud storage buckets create gs://vigorcore-backups-gen-lang-client-0041212770 `
      --location=us-central1 `
      --project=gen-lang-client-0041212770

  # 2. Asignar rol de escritura a la cuenta de servicio de Firestore:
  $PROJECT_NUMBER = (gcloud projects describe gen-lang-client-0041212770 --format="value(projectNumber)")
  gcloud storage buckets add-iam-policy-binding gs://vigorcore-backups-gen-lang-client-0041212770 `
      --member="serviceAccount:service-$PROJECT_NUMBER@gcp-sa-firestore.iam.gserviceaccount.com" `
      --role="roles/storage.admin"

  # 3. Ejecutar exportación de la base nombrada:
  gcloud firestore export gs://vigorcore-backups-gen-lang-client-0041212770/pre7d-$(Get-Date -Format "yyyyMMdd-HHmmss") `
      --database="ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c" `
      --project="gen-lang-client-0041212770"
  ```
- **Consideraciones:** La exportación requiere facturación habilitada, genera operaciones de lectura sobre los documentos exportados y no bloquea el tráfico de los atletas.

#### B. Rollback Real de Firestore Rules:
- **Inspección de Archivos Locales:** El archivo `firestore.rules.backup-20261023-pre-deploy-6c2` contiene las reglas del Incremento 6C (280 líneas) sin colecciones administrativas ni `isAccountActive`.
- **Estado:** **PENDIENTE DE IDENTIFICACIÓN DE VERSIÓN REMOTA**. Antes de desplegar, el operador debe guardar una copia local del estado actual de producción desde Firebase Console (`Rules` -> `Historial de versiones`).
- **Comando de Rollback de Reglas:**
  ```powershell
  npx firebase deploy --only firestore:ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c --project gen-lang-client-0041212770
  ```

#### C. Rollback de Cloud Functions v2:
- **Diagnóstico:** Dado que las 11 funciones administrativas constituyen el **primer despliegue** del módulo en producción, **no existen revisiones previas activas en Cloud Run** hacia las cuales desviar tráfico.
- **Estrategia de Mitigación en Caso de Incidente:**
  Si una función presenta un comportamiento inesperado tras el despliegue, la acción segura consiste en deshabilitar o eliminar exclusivamente dicha función mediante Firebase CLI, **sin afectar los datos de atletas ni tocar otras funciones**:
  ```powershell
  npx firebase functions:delete [NOMBRE_FUNCION] --region=us-central1 --project=gen-lang-client-0041212770
  ```

---

### 8. AUDITORÍA DE SCRIPTS DE MIGRACIÓN Y BOOTSTRAP

- **`scripts/bootstrap_superadmin.ts` (13/13 pruebas unitarias aprobadas):**
  - Exige `--uid` explícito; no asume cuentas por defecto.
  - Exige `emailVerified: true` y cuenta no deshabilitada en Firebase Auth.
  - Incrementa monotónicamente `roleVersion` e invalida tokens antiguos.
  - Modo `--dry-run` por defecto; exige `--confirm` explícito.
  - Es 100% idempotente (no duplica si ya es superadministrador).
- **`scripts/migrate_existing_users.ts` (Validado):**
  - Paginación segura de 100 usuarios (`auth.listUsers(100)`).
  - Cero operaciones en colecciones personales de atletas (`users/{uid}/*`).
  - **Preservación estricta de suspensiones previas:** Comprueba `accountAccess/{uid}` y mantiene `suspended` o `disabled`.
  - Cuentas no verificadas se marcan como `pending_verification`, nunca como `active`.
  - Modo `--dry-run` por defecto; exige `--no-dry-run --confirm`.

---

### 9. COMANDOS POWERSHELL VERIFICABLES PARA LA VENTANA DE ACTIVACIÓN

> **ADVERTENCIA:** Los siguientes comandos están preparados y verificados sintácticamente. **NO DEBEN EJECUTARSE** hasta recibir la autorización formal del propietario de VigorCore.

```powershell
# =========================================================================
# FASE 1: VERIFICACIONES DE INFRAESTRUCTURA (SOLO LECTURA)
# =========================================================================
# 1.1 Iniciar sesión y fijar proyecto activo:
npx firebase login
npx firebase use gen-lang-client-0041212770

# 1.2 Comprobar estado de facturación (debe reportar billingEnabled: true):
gcloud billing projects describe gen-lang-client-0041212770

# 1.3 Comprobar APIs habilitadas:
gcloud services list --enabled --project=gen-lang-client-0041212770

# =========================================================================
# FASE 2: RESPALDO DE SEGURIDAD (CLOUD FIRESTORE)
# =========================================================================
gcloud firestore export gs://[BUCKET_DE_BACKUP]/pre7d-$(Get-Date -Format "yyyyMMdd-HHmmss") `
    --database="ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c" `
    --project="gen-lang-client-0041212770"

# =========================================================================
# FASE 3: DESPLIEGUE DE SECURITY RULES E ÍNDICES
# =========================================================================
npx firebase deploy `
    --only firestore:ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c `
    --project gen-lang-client-0041212770

# =========================================================================
# FASE 4: DESPLIEGUE DE CLOUD FUNCTIONS V2 (NODE.JS 22)
# =========================================================================
npx firebase deploy `
    --only functions:listAdminUsers,functions:getAdminStats,functions:getAdminUserDetail,functions:createAdminInvitation,functions:revokeAdminInvitation,functions:acceptAdminInvitation,functions:setAdminUserRole,functions:setAdminUserStatus,functions:requestAdminPasswordReset,functions:syncCurrentUserDirectory,functions:getAdminAuditLogs `
    --project gen-lang-client-0041212770

# =========================================================================
# FASE 5: INICIALIZACIÓN ADMINISTRATIVA Y MIGRACIÓN
# =========================================================================
# 5.1 Simulación obligatoria previa de migración:
npx tsx scripts/migrate_existing_users.ts --dry-run

# 5.2 Ejecución real de migración de directorio:
npx tsx scripts/migrate_existing_users.ts --no-dry-run --confirm

# 5.3 Simulación de bootstrap del superadministrador (reemplazar UID_DEL_PROPIETARIO):
npx tsx scripts/bootstrap_superadmin.ts --uid "<UID_DEL_PROPIETARIO>" --dry-run

# 5.4 Ejecución real de bootstrap:
npx tsx scripts/bootstrap_superadmin.ts --uid "<UID_DEL_PROPIETARIO>" --confirm
```

---

### 10. PROTOCOLO DE SMOKE TESTS POST-ACTIVACIÓN

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
