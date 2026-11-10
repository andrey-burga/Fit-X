# VIGORCORE — AUDITORÍA DE CLAVES, TABLAS E ÍNDICES CATALYST NOSQL (FASE 3.4.1)
## Validación de Patrones de Acceso, Colisiones en Sort Keys, Tipificación de Fechas y Racionalización de Tablas

**Fecha de emisión:** 10 de noviembre de 2026  
**Auditor:** Arquitecto de Base de Datos NoSQL & Ingeniero de Rendimiento de Consultas  
**Entregable Auditado Principal:** `poc/catalyst-3-2/reports/etl-design/catalyst-nosql-schema.md`

---

## 1. RACIONALIZACIÓN DE LAS SEIS TABLAS PROPUESTAS

En la Fase 3.4 se propuso la creación de 6 tablas: `Users`, `UserData`, `AdminDirectory`, `AdminInvitations`, `AuditLogs` y `SystemLocks`.

### Dictamen de Necesidad Real para la Migración Histórica:
A partir del resultado certificado en la Fase 3.3.7, donde se demostró que **las 6 colecciones administrativas contienen exactamente 0 documentos en Firestore**:

| Tabla Propuesta | ¿Contiene Datos en Origen? | Necesaria para Migrar los 73 Documentos | Clasificación Auditoría | Justificación Técnica |
| :--- | :---: | :---: | :---: | :--- |
| **`Users`** | **Sí (5 docs)** | **SÍ (CRÍTICA)** | **VERIFIED** | Aloja los 5 perfiles de atleta y el puente de identidad (`sourceUid` $\leftrightarrow$ `catalystUserId`). |
| **`UserData`** | **Sí (68 docs)** | **SÍ (CRÍTICA)** | **VERIFIED** | Aloja los 68 documentos de las 7 subcolecciones activas bajo clave compuesta `pk`/`sk`. |
| **`AdminDirectory`** | **No (0 docs)** | **NO (FUTURA)** | **PROPOSED** | No hay registros administrativos que migrar. Es infraestructura para funciones v2 futuras de administración. |
| **`AdminInvitations`**| **No (0 docs)** | **NO (FUTURA)** | **PROPOSED** | Cero invitaciones activas en Firestore. Solo se requerirá cuando se invite a nuevos entrenadores en Catalyst. |
| **`AuditLogs`** | **No (0 docs)** | **NO (FUTURA)** | **PROPOSED** | Cero logs históricos que migrar. Los logs del propio ETL se almacenan en reportes de auditoría locales. |
| **`SystemLocks`** | **No (0 docs)** | **OPCIONAL** | **PROPOSED** | Estructura validada en POC 3.2 para fencing tokens y sagas; solo se utilizará si la carga remota requiere bloqueos. |

**Conclusión Arquitectónica:**  
Para la migración de los 73 documentos históricos, **únicamente se requiere el aprovisionamiento de dos tablas: `Users` y `UserData`**. Crear las 4 tablas restantes es una sobrecarga operativa innecesaria para la Fase 3.5/3.7.

---

## 2. AUDITORÍA EXHAUSTIVA DE LOS PATRONES DE SORT KEY (`sk`)

Se auditaron los 7 patrones de clave de ordenamiento propuestos para la tabla `UserData` contra las definiciones reales de TypeScript en `src/types/`:

| Patrón Propuesto | Modelo Fuente | Campo(s) Fuente Requeridos | Riesgo Detectado | Regla de Resolución Canónica / Failsafe |
| :--- | :--- | :--- | :--- | :--- |
| **`BIO#current`** | `BiometricConfig` | Constante estática `'current'` | Ninguno. Documento singleton garantizado. | **PASS-STATIC:** Unicidad garantizada dentro de la partición del usuario. |
| **`PREF#settings`** | `AthletePreferences` | Constante estática `'settings'` | Ninguno. Documento singleton garantizado. | **PASS-STATIC:** Unicidad garantizada dentro de la partición del usuario. |
| **`GROCERY#<id>`** | `GroceryItem` | `id` (string) | Si `id` contiene el delimitador `#`, rompería la sintaxis de parseo de la clave. | Sanear `id`: reemplazar cualquier carácter `#` por `_` (`id.replace(/#/g, '_')`). |
| **`MEAL#<dateTime>#<id>`** | `MealLogItem` | `dateTime` (string) e `id` (string) | **ALTO [F-SCH-02]:** En `src/types/index.ts:81`, `dateTime` se define como: `// ISO string or '2024-10-24T13:30'`. Formatos heterogéneos sin segundos o sin zona horaria rompen el ordenamiento léxico de NoSQL. | Normalización obligatoria a ISO 8601 estricto con UTC (`YYYY-MM-DDTHH:mm:ss.000Z`) antes de ensamblar la clave. |
| **`NOTIF#<id>`** | `AppNotification` | `id` (string) | `id` puede ser un slug con guiones o timestamps. | Sanear `id.replace(/#/g, '_')`. Unicidad garantizada por ID de notificación. |
| **`SET#<workoutId>#<id>`** | `WorkoutSessionRecord` | `executedWorkoutId` (opcional) e `id` (string) | **ALTO [F-SCH-02]:** En `src/types/index.ts:173`, `executedWorkoutId?: string` es opcional. Si es `null` o `undefined`, la clave se ensamblaría como `SET#undefined#set1`, provocando colisiones. | Si `executedWorkoutId` no existe, está vacío o es nulo, la clave debe formarse como `SET#UNLINKED#<id>`. |
| **`WORKOUT#<startedAt>#<id>`**| `ExecutedWorkout` | `startedAt` (string ISO) e `id` (string) | En `src/types/workout.ts:134`, `startedAt` es obligatorio, pero si contiene microsegundos o formatos no estándar, el ordenamiento léxico falla. | Normalización estricta a formato canónico `YYYY-MM-DDTHH:mm:ss.000Z`. |

---

## 3. ANÁLISIS DE COLISIONES, DELIMITADORES Y ORDENAMIENTO CRONOLÓGICO

### A. Política de Delimitadores
- Se selecciona el carácter almohadilla (`#`) como delimitador universal de segmentos jerárquicos en NoSQL.
- **Invariante:** Ningún valor dinámico inyectado en un segmento de sort key puede contener `#`.
- Todo identificador o fecha pasa por un sanitizador:
  ```typescript
  export function sanitizeKeySegment(segment: string): string {
    if (!segment) return 'EMPTY';
    return segment.replace(/#/g, '_').trim();
  }
  ```

### B. Ordenamiento Cronológico Natural en Consultas de Rango
En Zoho Catalyst NoSQL, las consultas por clave de ordenamiento soportan operadores como `begins_with`, `between`, `>`, `<`.
- Al utilizar fechas en formato `YYYY-MM-DDTHH:mm:ss.000Z` inmediatamente después del prefijo semántico:
  - `MEAL#2026-10-24T13:30:00.000Z#meal_1`
  - `MEAL#2026-10-24T20:15:00.000Z#meal_2`
  - `MEAL#2026-10-25T08:00:00.000Z#meal_3`
- La consulta:
  ```typescript
  key_condition: {
    attribute: ['sk'],
    operator: GREATER_EQUAL,
    value: { S: 'MEAL#2026-10-24' }
  }
  ```
  devuelve automáticamente todas las comidas del día 24 de octubre en adelante ordenadas cronológicamente, sin necesidad de ordenar en memoria en el servidor.

---

## 4. ANÁLISIS DE TAMAÑOS DE REGISTRO Y LÍMITES DE LOTE

### A. Distribución de Tamaños de los 73 Documentos
- **`UserProfile` (5 docs):** $\approx 0.8 \text{ KB}$ por documento.
- **`BiometricConfig` (5 docs):** $\approx 1.2 \text{ KB}$ por documento.
- **`AthletePreferences` (5 docs):** $\approx 1.5 \text{ KB}$ por documento.
- **`GroceryItem` (43 docs):** $\approx 0.4 \text{ KB}$ por documento.
- **`MealLogItem` (4 docs):** $\approx 0.9 \text{ KB}$ por documento.
- **`AppNotification` (6 docs):** $\approx 0.5 \text{ KB}$ por documento.
- **`WorkoutSessionRecord` (3 docs):** $\approx 0.6 \text{ KB}$ por documento.
- **`ExecutedWorkout` (2 docs):** $\approx 8.5 \text{ KB}$ por documento (incluye el snapshot de series y ejercicios de USER_002).
- **Volumen Total de Datos a Migrar:** Menor a $100 \text{ KB}$ en toda la base de datos.
- **Límite de Ítem de Catalyst NoSQL:** $400 \text{ KB}$. **Margen de seguridad: $> 95\%$ libre**.

### B. Estrategia de Inserción por Lote (Batching)
- El SDK `@zcatalyst/nosql` soporta llamadas en bloque (`insertItems(tableName, ...items)`).
- Para evitar tiempos de espera de red (timeouts) o errores de límite de carga útil (payload limit), los 68 ítems de `UserData` se dividen en **3 bloques de 25, 25 y 18 ítems**, con una pausa obligatoria de 150 ms entre llamadas.
- La tabla `Users` se procesa en **1 solo bloque de 5 ítems**.
