# VIGORCORE — PRUEBAS DE SERIALIZACIÓN, PRECISIÓN NUMÉRICA Y CANONICALIZACIÓN (FASE 3.4.2)
## Resolución Definitiva de F-SER-01: Conservación Exacta de Tipos Firestore y Tres Hashes

**Fecha de emisión:** 10 de noviembre de 2026  
**Módulo Implementado:** `poc/catalyst-3-2/src/etl/serializationPrecision.ts`  
**Suite de Pruebas:** `poc/catalyst-3-2/scripts/test-phase-3.4.2-closure.ts` (Casos F-SER-01.1 a F-SER-01.11)  
**Estado:** **CLOSED / PASS-UNIT**

---

## 1. EL PROBLEMA TÉCNICO RESUELTO

En el informe de auditoría Fase 3.4.1 se demostró que el diseño preliminar introducía pérdida irreversible de datos y divergencia criptográfica:
1. **Desbordamiento de Enteros de 64 Bits:** La conversión de `integerValue: string` a `Number(v)` de JavaScript causaba pérdida silenciosa de precisión en valores mayores a $2^{53}-1$ (9,007,199,254,740,991). Por ejemplo, el entero `9007199254740993` se convertía erróneamente en `9007199254740992`.
2. **Truncamiento de Nanosegundos:** El uso de `new Date().toISOString()` truncaba los nanosegundos (9 decimales) a milisegundos (3 decimales), destruyendo marcas temporales de telemetría y alterando permanentemente el cálculo de hashes canónicos.
3. **Falta de Serialización para BigInt:** `JSON.stringify()` en JavaScript falla con `TypeError: Do not know how to serialize a BigInt`.

---

## 2. ESPECIFICACIÓN DE LA SOLUCIÓN IMPLEMENTADA

### A. Deserialización y Serialización de Enteros de 64 Bits con BigInt
- **Función:** `deserializeFirestoreInteger(value: string): bigint`
- **Contrato de Validación:**
  - Valida que la cadena sea estrictamente decimal (`/^-?\d+$/`).
  - Rechaza flotantes (`123.45`), cadenas hexadecimales (`0x12`), alfanuméricos y cadenas vacías.
  - Comprueba los límites de enteros con signo de 64 bits:
    $$\text{INT64\_MIN} = -9223372036854775808n \le \text{valor} \le \text{INT64\_MAX} = 9223372036854775807n$$
  - Si el valor excede el rango, lanza un error `RangeError: INTEGER_OUT_OF_BOUNDS`.
- **Serialización Compatible con JSON:**  
  Para que el objeto sea serializable de forma transparente y reversible en JSON sin perder su tipo, se diseñó la representación etiquetada canónica:
  ```json
  {
    "@type": "int64",
    "value": "9007199254740995"
  }
  ```

### B. Deserialización de Timestamps con Precisión de Nanosegundos
- **Función:** `deserializeFirestoreTimestamp(rfc3339Str: string): PrecisionTimestamp`
- **Estructura Conservada:**
  ```typescript
  export interface PrecisionTimestamp {
    '@type': 'timestamp';
    seconds: bigint;      // Segundos de época UTC
    nanoseconds: number;  // 0 a 999,999,999 (9 dígitos exactos)
    rfc3339: string;      // Formato canónico ISO UTC exacto
  }
  ```
- **Soporte de Zonas Horarias:** Convierte y normaliza de forma exacta offsets como `+05:00` o `-03:00` a UTC (`Z`), preservando el valor absoluto del instante temporal.

### C. Deserialización de los 11 Tipos de Firestore REST v1
El deserializador `deserializeFirestoreValue` maneja exhaustivamente toda la gramática de Firestore REST:
1. `stringValue`: Preservado en UTF-8 nativo.
2. `integerValue`: Convertido a objeto etiquetado BigInt (`@type: 'int64'`).
3. `doubleValue`: Flotante verificado con `Number.isFinite()`. Rechaza `NaN` e `Infinity`.
4. `booleanValue`: Booleano nativo `true` / `false`.
5. `nullValue`: Preservado como `null` explícito.
6. `timestampValue`: Convertido a objeto de precisión (`@type: 'timestamp'`).
7. `mapValue`: Mapeado recursivo a objeto plano.
8. `arrayValue`: Mapeado recursivo preservando el orden posicional de los elementos.
9. `referenceValue`: Convertido a `{ '@type': 'reference', fullPath, relativePath }`.
10. `bytesValue`: Preservado como `{ '@type': 'bytes', base64 }`.
11. `geoPointValue`: Convertido a `{ '@type': 'geopoint', latitude, longitude }`.

---

## 3. MOTOR DE CANONICALIZACIÓN DETERMINISTA

La función `toCanonicalJson(val)` garantiza que dos objetos con el mismo contenido semántico produzcan exactamente la misma cadena de texto:
1. **Orden Alfabético Recursivo:** Todas las claves de objetos se ordenan alfabéticamente.
2. **Preservación de Arrays:** Los arrays no se ordenan (el orden en listas de series de ejercicios o ingredientes es posicional y semántico).
3. **Normalización Unicode:** Todas las cadenas se normalizan a la forma canónica **Unicode NFC** (`val.normalize('NFC')`), evitando discrepancias entre caracteres precompuestos y combinados (ej. `é`).
4. **Exclusión de Metadatos Transitorios:** Se excluyen las propiedades que comienzan con guion bajo (`_etlVersion`, `_transformedAt`) y las claves de partición `pk`/`sk`.

---

## 4. LA ARQUITECTURA DE TRES HASHES CRIPTOGRÁFICOS

Para eliminar la ambigüedad detectada en la Fase 3.4.1, se implementaron tres funciones de huella digital SHA-256 independientes:

```
1. computeSourceHash(rawFirestoreJson)
   -> Huella del archivo crudo descargado de Firestore.
   -> Garantiza integridad en disco local (.data/raw/).

2. computeTransformedHash(transformedRecord)
   -> Huella del objeto normalizado canónico en staging.
   -> Se registra en el manifiesto de migración (manifest-transform.json).

3. computeDestinationHash(catalystFetchedItem)
   -> Huella del objeto recuperado tras lectura consistente en Catalyst NoSQL.
   -> Se compara directamente: transformedHash === destinationHash.
```

**Demostración Criptográfica:**  
La prueba `F-SER-01.11` demostró empíricamente que:
$$\text{computeTransformedHash}(payload) \equiv \text{computeDestinationHash}(catalystItem)$$
incluso cuando el registro en Catalyst posee atributos adicionales como `pk`, `sk` y metadatos técnicos `_migratedAt`.

---

## 5. EVIDENCIA DE PRUEBAS AUTOMATIZADAS (11/11 PASS-UNIT)

Las 11 pruebas unitarias ejecutadas en `scripts/test-phase-3.4.2-closure.ts` demostraron:

| ID de Prueba | Escenario Evaluado | Resultado Observado | Estado |
| :--- | :--- | :--- | :---: |
| **F-SER-01.1** | Deserialización exacta de `INT64_MAX` | `9223372036854775807n` preservado sin mutación | **PASS-UNIT** |
| **F-SER-01.2** | Deserialización exacta de `INT64_MIN` | `-9223372036854775808n` preservado sin mutación | **PASS-UNIT** |
| **F-SER-01.3** | Comparativa de precisión BigInt vs JS Number | `Number` falla en `9007199254740993`; BigInt conserva los 16 dígitos | **PASS-UNIT** |
| **F-SER-01.4** | Rechazo de entero que excede 64 bits con signo | Lanza `RangeError: INTEGER_OUT_OF_BOUNDS` fail-closed | **PASS-UNIT** |
| **F-SER-01.5** | Rechazo de formatos decimales inválidos | Rechaza `123.45`, `0x12`, `abc`, `""` | **PASS-UNIT** |
| **F-SER-01.6** | Preservación de 9 dígitos de nanosegundos | `123456789` nanosegundos conservados exactamente | **PASS-UNIT** |
| **F-SER-01.7** | Normalización de offset de zona horaria | `17:30:00+05:00` normalizado correctamente a `12:30:00Z` | **PASS-UNIT** |
| **F-SER-01.8** | Deserialización de los 11 tipos oficiales | Documento con 11 tipos deserializado 100% conforme | **PASS-UNIT** |
| **F-SER-01.9** | Canonicalización determinista | Objetos con claves en distinto orden generan idéntico JSON | **PASS-UNIT** |
| **F-SER-01.10**| Normalización Unicode NFC | Cadena compuesta y combinada (`\u00E9` vs `e\u0301`) generan idéntico JSON | **PASS-UNIT** |
| **F-SER-01.11**| Tres hashes independientes | `transformedHash === destinationHash` probado con éxito | **PASS-UNIT** |
