# VIGORCORE — HOJA DE RUTA DE IMPLEMENTACIÓN DEL PIPELINE ETL (FASE 3.4)
## Plan de Fases Operativas, Procedimientos de Ejecución y Adaptación de la Aplicación

**Fecha de emisión:** 9 de noviembre de 2026  
**Auditor:** Director de Arquitectura de Software & Líder de Proyecto  
**Estado:** Planificación y Especificación de Siguientes Fases

---

## 1. CRONOGRAMA DE FASES TÉCNICAS

```mermaid
gantt
    title VigorCore — Hoja de Ruta de Migración a Zoho Catalyst NoSQL
    dateFormat  YYYY-MM-DD
    section Diseño y Auditoría
    Fase 3.4: Diseño Forense ETL         :done, des1, 2026-11-09, 1d
    section Extracción y Staging
    Fase 3.5: Extracción de 73 Documentos :active, ext1, 2026-11-10, 1d
    Fase 3.6: Validación y Transformación: val1, 2026-11-11, 1d
    section Carga y Reconciliación
    Fase 3.7: Carga Idempotente NoSQL    : load1, 2026-11-12, 1d
    Fase 3.8: Reconciliación 5-Tier Final: rec1, 2026-11-13, 1d
    section Adaptación de Aplicación
    Fase 4.0: Adaptador AppContext NoSQL : app1, 2026-11-14, 2d
```

---

## 2. DETALLE DE FASES OPERATIVAS

### FASE 3.5: EXTRACCIÓN DE DOCUMENTOS COMPLETOS DESDE CLOUD FIRESTORE
- **Objetivo:** Descargar los 73 documentos en formato JSON crudo a la estación local del desarrollador utilizando PowerShell nativo y ADC en memoria.
- **Herramienta Propuesta:** `poc/catalyst-3-2/scripts/extract-firestore.ps1`.
- **Pre-requisito:** Confirmación explícita del usuario en el prompt interactivo de autorización.
- **Entrada:** Las 73 rutas concretas previamente validadas en el inventario Deep.
- **Salida:** Directorio `.data/raw/` con 73 archivos JSON y `manifest-extract.json`.
- **Compuerta de Validación (Gate 3.5):** 73 archivos generados en disco, 0 errores HTTP, 0 bytes vacíos, coincidencia de hashes SHA-256.

### FASE 3.6: MOTOR DE VALIDACIÓN Y TRANSFORMACIÓN TIPADA
- **Objetivo:** Desempaquetar los Typed Maps de Firestore REST, validar los datos con TypeScript/Zod y normalizar las claves compuestas para Catalyst.
- **Herramienta Propuesta:** `poc/catalyst-3-2/scripts/transform-documents.ts`.
- **Pre-requisito:** Finalización con éxito de la Fase 3.5.
- **Salida:** Directorio `.data/transformed/` con los 73 ítems preparados para `@zcatalyst/nosql` y `manifest-transform.json`.
- **Compuerta de Validación (Gate 3.6):** 100% de los documentos superan la validación tipada. Cero documentos en cuarentena no resueltos.

### FASE 3.7: CARGA IDEMPOTENTE EN ZOHO CATALYST NOSQL
- **Objetivo:** Inserción controlada por lotes (máximo 25 ítems) en las tablas `Users` y `UserData` de Zoho Catalyst utilizando `@zcatalyst/nosql`.
- **Herramienta Propuesta:** `poc/catalyst-3-2/scripts/load-catalyst-nosql.ts`.
- **Pre-requisito:** Tablas creadas en la consola de Zoho Catalyst con sus respectivas claves de partición y ordenamiento.
- **Compuerta de Validación (Gate 3.7):** Inserción confirmada de los 73 ítems con checkpoint atómico y cero fallos permanentes.

### FASE 3.8: RECONCILIACIÓN FINAL Y CERTIFICACIÓN
- **Objetivo:** Ejecutar la auditoría en 5 niveles comparando origen vs destino.
- **Herramienta Propuesta:** `poc/catalyst-3-2/scripts/reconcile-migration.ts`.
- **Salida:** Reporte de auditoría `poc/catalyst-3-2/reports/etl-design/audit-3.8-final.md`.
- **Compuerta de Validación (Gate 3.8):** Dictamen oficial `MIGRACIÓN COMPLETA Y RECONCILIADA`.

---

## 3. ESTRATEGIA DE ADAPTACIÓN DEL FRONTEND (`AppContext.tsx`)

Para migrar la aplicación de forma transparente sin reescribir la interfaz de usuario de React 19:

### Patrón Repositorio y Adaptador de Almacenamiento (Storage Adapter Pattern):
1. **Desacoplamiento de Firestore SDK:**
   Actualmente, `AppContext.tsx` utiliza funciones directas de Firebase (`onSnapshot`, `doc`, `collection`, `setDoc`, `updateDoc`, `deleteDoc`).
2. **Definición de Interfaz de Almacenamiento:**
   ```typescript
   export interface IVigorCoreDataRepository {
     getUserProfile(uid: string): Promise<UserProfile | null>;
     getBiometrics(uid: string): Promise<BiometricConfig | null>;
     getGroceries(uid: string): Promise<GroceryItem[]>;
     saveGrocery(uid: string, item: GroceryItem): Promise<void>;
     toggleGrocery(uid: string, id: string, status: 'pending' | 'completed'): Promise<void>;
     getMealLogs(uid: string): Promise<MealLogItem[]>;
     saveMealLog(uid: string, item: MealLogItem): Promise<void>;
     getExecutedWorkouts(uid: string): Promise<ExecutedWorkout[]>;
     saveExecutedWorkout(uid: string, workout: ExecutedWorkout): Promise<void>;
     subscribeToUserData(uid: string, callback: (data: UserAggregateData) => void): () => void;
   }
   ```
3. **Implementación de CatalystRepository:**
   Se implementa el adaptador que consume las API REST / funciones de Catalyst Slate (`https://fit-x-bhnatsxl.onslate.com/server/...`) o el cliente NoSQL.
4. **Bandera de Transición (Feature Flag):**
   Permite alternar entre `FirebaseRepository` y `CatalystRepository` mediante variable de entorno `VITE_BACKEND_PROVIDER='catalyst' | 'firebase'`.

---

## 4. COMANDOS POWERSHELL PREPARADOS PARA LAS SIGUIENTES FASES

*(Para revisión y posterior ejecución en las fases correspondientes)*

```powershell
# Fase 3.5: Extracción segura con prompt interactivo de autorización
powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-3-2\scripts\extract-firestore.ps1

# Fase 3.6: Validación y transformación tipada en Node.js
npx tsx .\poc\catalyst-3-2\scripts\transform-documents.ts

# Fase 3.7: Carga remota en lotes a Zoho Catalyst NoSQL
npx tsx .\poc\catalyst-3-2\scripts\load-catalyst-nosql.ts

# Fase 3.8: Reconciliación forense y verificación de hashes
npx tsx .\poc\catalyst-3-2\scripts\reconcile-migration.ts
```
