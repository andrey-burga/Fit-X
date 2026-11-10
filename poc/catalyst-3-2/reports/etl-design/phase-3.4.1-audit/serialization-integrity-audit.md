# VIGORCORE — AUDITORÍA DE SERIALIZACIÓN, PRECISIÓN Y CANONICALIZACIÓN (FASE 3.4.1)
## Análisis Riguroso de Tipos Firestore REST v1, Pérdida de Precisión Numérica y Criptografía

**Fecha de emisión:** 10 de noviembre de 2026  
**Auditor:** Especialista en Motores de Serialización, Tipificación IEEE 754 y Criptografía Aplicada  
**Entregable Auditado Principal:** `poc/catalyst-3-2/reports/etl-design/etl-transformation-rules.md`

---

## 1. AUDITORÍA EXHAUSTIVA DE LOS 11 TIPOS DE FIRESTORE REST API v1

| Tipo Firestore REST | Formato de Entrada JSON | Tratamiento en Diseño 3.4 | Hallazgo Crítico / Veredicto Adversarial | Regla Corregida y Canónica |
| :--- | :--- | :--- | :--- | :--- |
| **`stringValue`** | `{"stringValue": "texto"}` | String primitivo UTF-8. | **PASS-STATIC:** Preservación sin alteraciones. Cero mutación de caracteres. | Conservar string exacto sin modificar saltos de línea ni diacríticos. |
| **`integerValue`** | `{"integerValue": "12345"}` | `Number(v)` de JavaScript. | **CRITICAL [BLOCKER: F-SER-01]:** JavaScript `Number` utiliza IEEE 754 de 64 bits con solo 53 bits de mantisa. Enteros $> 2^{53}-1$ (9,007,199,254,740,991) pierden precisión silenciosamente. | Comprobar con `BigInt(v)`. Si $|v| \le \text{Number.MAX\_SAFE\_INTEGER}$, convertir a `number`; si lo excede, almacenar como string prefijado con validador de 64 bits. |
| **`doubleValue`** | `{"doubleValue": 74.5}` | `number` primitivo. | **MEDIUM [PROPOSED]:** Riesgo de valores especiales no admitidos en JSON estricto (`NaN`, `Infinity`, `-Infinity`). | Validar `Number.isFinite(v)`. Si es `NaN` o `Infinity`, enviar a cuarentena (`REJECTED_REVIEW_REQUIRED`). |
| **`booleanValue`** | `{"booleanValue": true}` | `boolean` primitivo. | **PASS-STATIC:** Booleano nativo conforme. | Conservar `true` / `false`. |
| **`nullValue`** | `{"nullValue": null}` | `null`. | **PASS-STATIC:** Se preserva el `null` explícito; no se convierte en `undefined`. | Conservar `null`. |
| **`timestampValue`** | `{"timestampValue": "2026-10-24T18:30:00.123456789Z"}` | `new Date(v).toISOString()`. | **CRITICAL [BLOCKER: F-SER-01]:** `Date` trunca los nanosegundos a milisegundos (`.123Z`), alterando permanentemente el timestamp y rompiendo el hash canónico. | Conservar la cadena RFC 3339 / ISO 8601 completa con sus nanosegundos en un campo de metadatos `_sourceTimestampNano`. En el modelo de negocio, proveer tanto la cadena canónica como epoch ms. |
| **`mapValue`** | `{"mapValue": {"fields": {...}}}` | Objeto JavaScript plano. | **HIGH [PROPOSED]:** El orden de inserción de las propiedades en un objeto JS no está estandarizado al re-serializar con `JSON.stringify`. | Ordenamiento alfabético canónico estricto de todas las claves antes de serializar o hashear. |
| **`arrayValue`** | `{"arrayValue": {"values": [...]}}` | Array JavaScript plano. | **HIGH [PROPOSED]:** Arrays vacíos pueden venir como `{}` o sin la clave `values`. Si se procesa sin validación, puede generar `undefined`. | Si `values` no existe o no es array, normalizar obligatoriamente a array vacío `[]`. Preservar estrictamente el orden original de los elementos (los arrays son posicionales). |
| **`referenceValue`**| `{"referenceValue": "projects/.../databases/.../documents/users/usr_1"}` | Omitido en diseño 3.4. | **HIGH [BLOCKER: F-SER-03]:** No contemplado explícitamente. Las referencias completas de GCP acoplan el documento al proyecto de origen. | Función de extracción que aísla la ruta documental relativa (`/users/usr_1`) y valida su existencia en el grafo de dependencias. |
| **`bytesValue`** | `{"bytesValue": "aGVsbG8="}` | Omitido en diseño 3.4. | **MEDIUM [PROPOSED]:** Buffer binario codificado en Base64. | Preservar la cadena Base64 exacta sin intentar decodificarla en el payload JSON. |
| **`geoPointValue`** | `{"geoPointValue": {"latitude": 4.6, "longitude": -74.0}}` | Omitido en diseño 3.4. | **MEDIUM [PROPOSED]:** No utilizado en VigorCore actualmente, pero debe contemplarse fail-closed. | Desempaquetar como `{ latitude: number, longitude: number }`. Si está presente en un documento no esperado, registrar alerta. |

---

## 2. ANÁLISIS ADVERSARIAL DE PRECISIÓN NUMÉRICA Y TEMPORAL

### A. Enteros de 64 Bits y Timestamps de Época
En bases de datos de alto rendimiento y métricas de salud (como recuentos de pasos de wearables, nanosegundos de telemetría de pulsómetros o tokens de cercado), los identificadores y marcas de tiempo suelen representarse como enteros de 64 bits.
- **Riesgo:** Si un valor en Firestore REST es `"1731174000123456789"`, al evaluarlo como `Number("1731174000123456789")` en JavaScript, el valor se corrompe silenciosamente a `1731174000123456800` (error de 11 unidades).
- **Solución Canónica:**
  ```typescript
  export function deserializeFirestoreInteger(valStr: string): number | string {
    const big = BigInt(valStr);
    if (big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(big);
    }
    // Si excede el rango seguro, preservar como string exacto para evitar corrupción
    return valStr;
  }
  ```

### B. Timestamps con Precisión de Nanosegundos
Firestore soporta marcas de tiempo con precisión de hasta 9 dígitos fraccionarios (ej: `2026-11-10T12:00:00.123456789Z`).
- El método `new Date("2026-11-10T12:00:00.123456789Z").toISOString()` devuelve `"2026-11-10T12:00:00.123Z"`, eliminando irreversibly los 456,789 nanosegundos.
- **Solución Canónica:** Preservar la cadena de texto original en el atributo técnico `_sourceUpdateTime` y utilizarla para el cálculo del hash canónico del documento fuente.

---

## 3. ARQUITECTURA DE TRES HASHES CRIPTOGRÁFICOS INDEPENDIENTES

El diseño preliminar de la Fase 3.4 confundía el hash del documento crudo con el hash del payload transformado. Para una auditoría forense rigurosa, se establecen **tres hashes diferenciados**:

```
[1. HASH CRUDA ORIGEN]          [2. HASH TRANSFORMADA ETL]        [3. HASH DESTINO VERIFICADA]
      Hash_Source                         Hash_Transformed                     Hash_Target
          │                                      │                                  │
          ▼                                      ▼                                  ▼
SHA-256(Raw Firestore REST)           SHA-256(Canonical Transformed)       SHA-256(Canonical Fetch)
(Calculado en Fase 3.5 al descargar)  (Calculado en Fase 3.6 al mapear)    (Calculado en Fase 3.8 al leer)
```

### Definición y Comparación de los Tres Hashes:
1. **`Hash_Source` (Hash del Documento Fuente):**
   - Se calcula sobre el JSON textual crudo recibido desde la API REST de Firestore en el instante exacto de la descarga en la Fase 3.5.
   - *Propósito:* Demostrar que el archivo almacenado en `.data/raw/` no sufrió corrupción de disco ni manipulación externa.
2. **`Hash_Transformed` (Hash del Documento Transformado):**
   - Se calcula sobre el objeto JavaScript resultante de la deserialización y normalización, aplicando ordenamiento alfabético canónico recursivo de todas las propiedades de negocio (excluyendo metadatos transitorios).
   - *Propósito:* Servir como huella digital inmutable de los datos antes de enviarlos a Zoho Catalyst NoSQL.
3. **`Hash_Target` (Hash del Documento Recuperado de Catalyst):**
   - Se calcula tras ejecutar un `fetchItem` consistente desde Catalyst NoSQL en la Fase 3.8 sobre el registro recién insertado, serializándolo con exactamente el mismo algoritmo de canonicalización.
   - *Comparación Vital:*  
     $$\text{Integridad Demostrada} \iff \text{Hash\_Transformed} \equiv \text{Hash\_Target}$$
   - Si $\text{Hash\_Transformed} \neq \text{Hash\_Target}$, se demuestra que Zoho Catalyst NoSQL alteró, truncó o mutó algún tipo de dato durante la persistencia.

---

## 4. ESPECIFICACIÓN DEL ALGORITMO DETERMINISTA DE CANONICALIZACIÓN

```typescript
import crypto from 'node:crypto';

export function canonicalizeValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val !== 'object') return val;

  if (Array.isArray(val)) {
    // Los arrays preservan su orden posicional exacto; no se ordenan alfabéticamente
    return val.map(canonicalizeValue);
  }

  // Objeto: ordenar alfabéticamente todas las claves y excluir metadatos ETL transitorios
  const record = val as Record<string, unknown>;
  const sortedKeys = Object.keys(record)
    .filter(k => !k.startsWith('_') && k !== 'pk' && k !== 'sk')
    .sort();

  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    result[key] = canonicalizeValue(record[key]);
  }
  return result;
}

export function computeCanonicalSha256(payload: Record<string, unknown>): string {
  const canonicalObj = canonicalizeValue(payload);
  const jsonString = JSON.stringify(canonicalObj);
  return 'sha256:' + crypto.createHash('sha256').update(jsonString, 'utf8').digest('hex');
}
```

---

## 5. REVERSIBILIDAD DE LAS TRANSFORMACIONES

- **Datos 100% Reversibles:** Cadenas, booleanos, enteros dentro del rango seguro, decimales estándar, arrays planos, objetos anidados.
- **Pérdida Controlada si no se Preserva Metadato:**
  - Si un timestamp trunca nanosegundos, no es invertible a la cadena exacta de Firestore. **Mitigación:** Se preserva `_sourceTimestampNano` en metadatos técnicos.
  - Tipos `referenceValue` de Firestore pierden el prefijo del proyecto GCP (`projects/.../databases/.../documents/`). **Mitigación:** Se documenta que en Catalyst NoSQL la referencia se almacena de forma relativa (`users/<uid>`), lo cual es una mejora de diseño arquitectónico.
