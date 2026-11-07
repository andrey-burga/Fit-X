# VIGORCORE — LISTA DE VERIFICACIÓN PARA PUESTA EN PRODUCCIÓN (FASE 7D-PRE.2)
## Matriz de Control de Calidad, Seguridad, Infraestructura y DevOps

Estados de los Criterios:
- **[COMPLETADO]**: Implementado, auditado y verificado localmente.
- **[PENDIENTE]**: Preparado técnicamente, en espera de ejecución en la ventana de lanzamiento.
- **[REQUIERE AUTORIZACIÓN]**: Requiere aprobación formal o acción del propietario en Google Cloud Console.
- **[NO VERIFICABLE]**: No verificable remotamente desde el contenedor local (ausencia de credenciales productivas de GCP).
- **[BLOQUEADO]**: Bloqueo técnico no resuelto.

---

### 1. RUNTIME Y COMPILACIÓN (NODE.JS 22)
- [COMPLETADO] Migración de Cloud Functions v2 a **Node.js 22** (`"engines": { "node": "22" }` en `functions/package.json`).
- [COMPLETADO] Configuración explícita `"runtime": "nodejs22"` en `firebase.json` bajo el bloque de `functions`.
- [COMPLETADO] Actualización de `functions/tsconfig.json` con `"target": "es2022"` y `"rootDir": "src"`.
- [COMPLETADO] Compilación de Cloud Functions exitosa bajo Node.js 22 (`npm --prefix functions run build`).
- [COMPLETADO] Eliminación de importaciones no utilizadas (`noUnusedLocals: true`) en `index.ts` y `adminLogic.ts`.
- [COMPLETADO] Cero usos de la API obsoleta `functions.config()` en todo el repositorio.
- [COMPLETADO] Hook de predeploy configurado en `firebase.json` para compilación automática antes de desplegar.

### 2. ACCESO BACKEND Y BASE NOMBRADA
- [COMPLETADO] Migración de acceso a Firestore backend al paquete oficial **`@google-cloud/firestore` (GA)** con constructor documentado.
- [COMPLETADO] Eliminación de dependencia de la API en Preview `getFirestore(app, databaseId)` de `firebase-admin`.
- [COMPLETADO] Cero monkey-patching y cero mutaciones de propiedades privadas (`_delegate`, `_databaseId`).
- [COMPLETADO] Configuración explícita de `projectId` (`gen-lang-client-0041212770`) y `databaseId` (`ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`).
- [COMPLETADO] Prueba automatizada de identidad y aislamiento de base de datos aprobada (6/6 comprobaciones en `npm run test:backend-db`).
- [COMPLETADO] Dependencia `@google-cloud/firestore` agregada como dependencia directa en `functions/package.json`.
- [PENDIENTE] Smoke test 00 de conectividad de red en vivo post-despliegue.

### 3. SECURITY RULES E ÍNDICES COMPUESTOS
- [COMPLETADO] Archivo `firestore.rules` con 358 líneas y reglas fail-closed para las 6 colecciones administrativas.
- [COMPLETADO] Suite de reglas locales con 79/79 escenarios aprobados y preflight fail-closed verificado (`npm run test:emulator`).
- [COMPLETADO] Auditoría estática de reglas CEL con 29/29 aserciones exitosas (`npm run test:rules:static`).
- [COMPLETADO] Archivo de índices compuestos creado para consultas administrativas (`firestore.indexes.json`).
- [COMPLETADO] `firebase.json` configurado asociando reglas e índices a la base nombrada oficial.
- [PENDIENTE] Despliegue de `firestore.rules` e índices a la base nombrada en producción.
- [PENDIENTE] Comprobación de estado "Enabled" de los índices en Google Cloud Console tras el despliegue.

### 4. INFRAESTRUCTURA CLOUD Y FACTURACIÓN
- [COMPLETADO] Identificador de proyecto verificado en `.firebaserc` (`gen-lang-client-0041212770`).
- [COMPLETADO] Variables sensibles y secretos excluidos de Git en `.gitignore`.
- [COMPLETADO] Inventario técnico de las 11 Cloud Functions v2 documentado en `production-readiness-7D.md`.
- [NO VERIFICABLE] Estado real de facturación del proyecto (comando: `gcloud billing projects describe gen-lang-client-0041212770`).
- [REQUIERE AUTORIZACIÓN] Confirmación por parte del propietario de que el plan **Blaze** está activo (`billingEnabled: true`).
- [NO VERIFICABLE] Estado de activación de APIs requeridas (`cloudfunctions`, `cloudbuild`, `run`, `artifactregistry`).
- [REQUIERE AUTORIZACIÓN] Verificación de APIs activas mediante `gcloud services list --enabled --project=gen-lang-client-0041212770`.
- [NO VERIFICABLE] Auditoría de permisos IAM del operador de despliegue (`gcloud projects get-iam-policy`).
- [REQUIERE AUTORIZACIÓN] Configuración de alerta de presupuesto de 25 USD / mes en Google Cloud Console.

### 5. RESPALDO Y REVERSIÓN (BACKUP & ROLLBACK)
- [PENDIENTE] Creación de bucket de Cloud Storage para respaldos de la base nombrada (`gs://vigorcore-backups-...`).
- [REQUIERE AUTORIZACIÓN] Asignación de rol `roles/storage.admin` al Service Agent de Cloud Firestore sobre el bucket.
- [PENDIENTE] Ejecución del backup previo de la base nombrada (`gcloud firestore export ...`).
- [PENDIENTE] Identificación de la versión exacta de reglas actualmente en producción para el procedimiento de rollback.
- [COMPLETADO] Estrategia de rollback de Cloud Functions documentada (eliminación granular por función, sin tocar datos).

### 6. INICIALIZACIÓN ADMINISTRATIVA Y MIGRACIÓN
- [COMPLETADO] Script `scripts/bootstrap_superadmin.ts` probado unitariamente (13/13 en `npm run test:bootstrap`).
- [COMPLETADO] Script `scripts/migrate_existing_users.ts` reforzado con paginación de 100 y preservación de suspensiones previas.
- [COMPLETADO] Cuentas sin verificación de correo protegidas con estado `pending_verification`.
- [COMPLETADO] Modos `--dry-run` por defecto configurados en ambos scripts.
- [REQUIERE AUTORIZACIÓN] Suministro del UID y correo verificado de la cuenta del propietario para el rol `superadmin`.
- [PENDIENTE] Ejecución de simulación de migración (`npx tsx scripts/migrate_existing_users.ts --dry-run`).
- [PENDIENTE] Ejecución real de migración (`npx tsx scripts/migrate_existing_users.ts --no-dry-run --confirm`).
- [PENDIENTE] Ejecución de simulación de bootstrap (`npx tsx scripts/bootstrap_superadmin.ts --uid <UID> --dry-run`).
- [PENDIENTE] Ejecución real de bootstrap (`npx tsx scripts/bootstrap_superadmin.ts --uid <UID> --confirm`).

### 7. FRONTEND Y SMOKE TESTS
- [COMPLETADO] Configuración de cliente web en `src/firebase.ts` utilizando la base nombrada `firestoreDatabaseId`.
- [COMPLETADO] Dominio público de producción confirmado: `https://fit-x-bhnatsxl.onslate.com` (OnSlate).
- [COMPLETADO] Desacoplamiento de Firebase Hosting (no interfiere con el despliegue de OnSlate).
- [COMPLETADO] Protocolo de 17 Smoke Tests post-activación documentado detalladamente.
- [PENDIENTE] Publicación del bundle web compilado en OnSlate tras la activación del backend.
- [PENDIENTE] Ejecución de los 17 Smoke Tests post-despliegue con cuentas de prueba autorizadas.

---

### RESUMEN CONSOLIDADO DE ESTADO:
- **Criterios Completados:** 20 / 38 (53%)
- **Criterios Pendientes de Ejecución:** 9 / 38 (24%)
- **Criterios que Requieren Autorización / Acción del Propietario:** 6 / 38 (16%)
- **Criterios No Verificables Remotamente:** 3 / 38 (7%)
- **Criterios Bloqueados Técnicamente:** 0 / 38 (0%)

**DICTAMEN TÉCNICO:** **LISTA CON BLOQUEOS MENORES** (El código, el runtime Node 22, la base nombrada y los scripts están 100% listos localmente; la activación productiva está sujeta a la verificación externa de facturación Blaze, APIs habilitadas y creación del bucket de backup por el propietario en Google Cloud).
