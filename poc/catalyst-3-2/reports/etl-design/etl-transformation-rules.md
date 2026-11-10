# VIGORCORE — REGLAS DE TRANSFORMACIÓN Y NORMALIZACIÓN ETL (FASE 3.4)
## Desempaquetado REST, Normalización de Tipos, Versionado y Hashing Criptográfico

**Fecha de emisión:** 9 de noviembre de 2026  
**Auditor:** Ingeniero de Datos & Especialista en Serialización JSON  
**Alcance:** Transformación canónica de los 73 documentos existentes y reglas preventivas para las entidades funcionales y administrativas.

---

## 1. REGLAS DE DESEMPAQUETADO DEL FORMATO FIRESTORE REST

Cloud Firestore API REST v1 devuelve los documentos con un envoltorio tipado por atributo (`Typed Value Map`). El motor de transformación debe deserializar recursivamente cada valor a un tipo JavaScript/TypeScript primitivo conforme a la siguiente tabla:

| Formato Firestore REST v1 | Tipo Primitivo Destino | Regla de Conversión y Validación | Ejemplo de Entrada | Resultado Desempaquetado |
| :--- | :--- | :--- | :--- | :--- |
| `{ stringValue: string }` | `string` | Preserva cadenas UTF-8 exactas. | `{"stringValue": "Atleta Pro"}` | `"Atleta Pro"` |
| `{ integerValue: string }` | `number` | Firestore envía enteros como strings de 64 bits para evitar desbordamiento; convertir con `Number(v)` o `BigInt` si excede `MAX_SAFE_INTEGER`. | `{"integerValue": "178"}` | `178` |
| `{ doubleValue: number }` | `number` | Flotante IEEE 754. Preservar precisión decimal sin redondear. | `{"doubleValue": 74.5}` | `74.5` |
| `{ booleanValue: boolean }`| `boolean` | Booleano nativo `true` / `false`. | `{"booleanValue": true}` | `true` |
| `{ timestampValue: string }`| `string (ISO 8601)` | Cadena ISO 8601 con zona horaria UTC (`Z`). | `{"timestampValue": "2026-10-24T18:30:00Z"}` | `"2026-10-24T18:30:00.000Z"` |
| `{ mapValue: { fields: Object } }`| `Record<string, unknown>` | Llamada recursiva a la función de desempaquetado para cada clave interna. | `{"mapValue": {"fields": {"a": {"integerValue": "1"}}}}` | `{ a: 1 }` |
| `{ arrayValue: { values: Array } }`| `Array<unknown>` | Mapeo recursivo de los elementos de `values`. Si `values` no existe o es vacío, devolver `[]`. | `{"arrayValue": {"values": [{"stringValue": "barra"}]}}` | `["barra"]` |
| `{ nullValue: null }` | `null` | Preservar `null` explícito; no convertir a `undefined`. | `{"nullValue": null}` | `null` |

---

## 2. NORMALIZACIÓN DE TIPOS Y CAMPOS POR ENTIDAD

### 2.1. Normalización de `UserProfile` (Tabla `Users`)
- `id` $\rightarrow$ Preservado como `sourceUid` y reflejado en `pk = 'USER#' + id`.
- `name` $\rightarrow$ String trimmeado sin espacios redundantes.
- `email` $\rightarrow$ Preservado en `email` y duplicado en `emailNormalized` en minúsculas para búsquedas seguras en `GSI_Email`.
- `role` $\rightarrow$ Validación contra `'Atleta Pro' | 'Coach' | 'Nutricionista'`.
- `joinedDate` $\rightarrow$ Normalizado a ISO 8601 UTC.
- `onboardingCompleted` $\rightarrow$ Booleano; si no existe, inferir `true` si existen documentos de biometría y preferencias.

### 2.2. Normalización de `BiometricConfig` (Tabla `UserData`, `SK = BIO#current`)
- `weightKg`, `heightCm`, `bodyFatPct` $\rightarrow$ Forzados a `number` flotante con hasta 2 decimales.
- `targetCalories`, `targetProteinG`, `targetFatG`, `targetCarbsG` $\rightarrow$ Forzados a `number` entero (calorías/macros).
- `lastAppliedPeriodization` $\rightarrow$ Si existe, normalizar las fechas internas en `appliedAt` a ISO 8601 y preservar `previousTargets`.

### 2.3. Normalización de `AthletePreferences` (Tabla `UserData`, `SK = PREF#settings`)
- `availableEquipment`, `muscleFocus` $\rightarrow$ Arrays de strings asegurados. Si Firestore omite el array, forzar `[]`.
- `excludedFoods` $\rightarrow$ Array de strings. Si no está presente, forzar `[]`.
- `weightUnit` $\rightarrow$ `'kg'` o `'lbs'`. Si está indefinido, defecto `'kg'`.
- `heightUnit` $\rightarrow$ `'cm'` o `'in'`. Si está indefinido, defecto `'cm'`.

### 2.4. Normalización de `GroceryItem` (Tabla `UserData`, `SK = GROCERY#<id>`)
- `id` $\rightarrow$ Preservado id original en el sort key `GROCERY#<id>`.
- `quantity` $\rightarrow$ Número flotante $\ge 0$.
- `department` $\rightarrow$ Validado en `['carnes', 'huevos', 'verduras', 'carbohidratos', 'grasas']`.
- `status` $\rightarrow$ Normalizado estrictamente a `'pending' | 'completed'`.
- `origin` $\rightarrow$ Si no existe, defecto `'manual'`.
- `isCustomized` $\rightarrow$ Booleano; si no existe, inferir `false`.

### 2.5. Normalización de `MealLogItem` (Tabla `UserData`, `SK = MEAL#<dateTimeIso>#<id>`)
- `dateTime` $\rightarrow$ Normalizada a formato estándar `YYYY-MM-DDTHH:mm:ss.sssZ` para que la clave de ordenamiento permita ordenamiento cronológico natural en NoSQL.
- `moment` $\rightarrow$ Validado en `['desayuno', 'almuerzo', 'merienda', 'cena', 'snack']`.
- `calories`, `protein`, `carbs`, `fats` $\rightarrow$ Números redondeados a 1 decimal.
- `verified` $\rightarrow$ Booleano estricto.

### 2.6. Normalización de `AppNotification` (Tabla `UserData`, `SK = NOTIF#<id>`)
- `category` $\rightarrow$ Validada en `['nutricion', 'entrenamiento', 'compras', 'sistema']`.
- `read` $\rightarrow$ Booleano estricto (`true` / `false`).
- `timestamp` $\rightarrow$ Preservado el string relativo o ISO original.

### 2.7. Normalización de `WorkoutSessionRecord` (Tabla `UserData`, `SK = SET#<executedWorkoutId>#<id>`)
- `weightKg`, `reps`, `rir`, `estimated1RM` $\rightarrow$ Números estrictos.
- `completed` $\rightarrow$ Booleano estricto.
- `executedWorkoutId` $\rightarrow$ Si no existe o es vacío, utilizar `'UNLINKED'` en la clave de ordenamiento (`SET#UNLINKED#<id>`).

### 2.8. Normalización de `ExecutedWorkout` (Tabla `UserData`, `SK = WORKOUT#<startedAtIso>#<id>`)
- `startedAt` $\rightarrow$ Normalizada a ISO 8601 UTC para ordenar cronológicamente.
- `status` $\rightarrow$ Validado en `['in_progress', 'completed', 'abandoned']`.
- `durationSeconds`, `totalTonnageKg`, `totalCompletedSets`, `totalReps` $\rightarrow$ Números $\ge 0$.
- `exercisesSnapshot` $\rightarrow$ Array de `LiveExerciseSession` preservado íntegramente con sus listas de `sets`.

---

## 3. METADATOS ETL Y ESQUEMA DE VERSIONADO

Cada documento transformado antes de cargarse en Zoho Catalyst NoSQL debe incorporar un bloque estándar de auditoría técnica:

```typescript
export interface EtlDocumentMetadata {
  _etlVersion: string;         // '1.0.0'
  _sourcePath: string;         // 'projects/.../databases/.../documents/users/usr_1/groceries/g_1'
  _sourceCreateTime: string;   // Timestamp original de creación en Firestore
  _sourceUpdateTime: string;   // Timestamp original de modificación en Firestore
  _transformedAt: number;      // Epoch ms del momento de transformación
  _contentHash: string;        // Hash SHA-256 canónico del contenido de negocio
  _migrationBatchId: string;   // 'MIG-20261109-01'
}
```

---

## 4. ESPECIFICACIÓN DEL HASH CRIPTOGRÁFICO CANÓNICO (CANONICAL SHA-256)

Para que el hash de contenido sea estrictamente determinista e independiente del orden de las claves en el JSON [VERIFIED]:

1. **Exclusión de Metadatos Volátiles:** Se excluyen del hash las propiedades que comienzan con guion bajo (`_etlVersion`, `_transformedAt`, etc.) y la clave de partición generada.
2. **Ordenamiento Canónico de Claves:** Todas las claves de objetos y objetos anidados se ordenan alfabéticamente antes de la serialización (`JSON.stringify(sortKeysRecursively(payload))`).
3. **Cálculo del Hash:** Se aplica el algoritmo `SHA-256` sobre la cadena UTF-8 resultante, generando un digest hexadecimal de 64 caracteres prefijado con `sha256:`.

```typescript
import crypto from 'node:crypto';

export function computeCanonicalPayloadHash(data: Record<string, unknown>): string {
  function sortObject(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sortObject);
    return Object.keys(obj)
      .filter(k => !k.startsWith('_'))
      .sort()
      .reduce((acc: any, key: string) => {
        acc[key] = sortObject(obj[key]);
        return acc;
      }, {});
  }

  const canonicalJson = JSON.stringify(sortObject(data));
  const hash = crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
  return `sha256:${hash}`;
}
```
