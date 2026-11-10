# VIGORCORE — AUDITORÍA DE CONSISTENCIA, CONCURRENCIA, IDEMPOTENCIA Y ROLLBACK (FASE 3.4.1)
## Análisis de Estados de Carrera, Reanudación Atómica y Rollback Seguro sin Pérdida de Datos

**Fecha de emisión:** 10 de noviembre de 2026  
**Auditor:** Especialista en Transacciones Distribuidas, Concurrencia y Recuperación ante Desastres  
**Entregables Auditados Principales:** `poc/catalyst-3-2/reports/etl-design/etl-reconciliation-plan.md` y `etl-risk-register.md`

---

## 1. AUDITORÍA DE CONSISTENCIA DURANTE LA EXTRACCIÓN

### A. Evaluación Adversarial de Mutaciones Concurrentes en Firestore
Si la aplicación VigorCore continuara recibiendo tráfico de escritura mientras el script de extracción descarga datos:

1. **Nuevos Documentos Creados:** Si USER_002 agrega un alimento a su despensa mientras el script lee la colección, o si USER_004 inicia una nueva serie de entrenamiento:
   - En una extracción sin bloqueo, el inventario previo (Fase 3.3.7) reportó 73 documentos, pero la extracción descargaría 74.
   - La reconciliación matemática fallaría de inmediato ($74 \neq 73$).
2. **Documentos Modificados Durante la Paginación:** Si un atleta completa un set (`completed: true`) a mitad de la extracción, se podrían generar lecturas inconsistentes (series que apuntan a estados de sesión no coincidentes).
3. **Documentos Eliminados:** Una petición `GET` a una ruta previamente inventariada devolvería `HTTP 404 Not Found`, provocando el aborto fail-closed del pipeline.

---

### B. Comparativa de Estrategias de Consistencia

| Criterio | Estrategia A: Ventana de Mantenimiento Fría (RECOMENDADA) | Estrategia B: Extracción Inicial + Conciliación Delta | Estrategia C: Doble Escritura Controlada (Dual-Write) |
| :--- | :--- | :--- | :--- |
| **Descripción** | Deshabilitar temporalmente escrituras en el frontend de VigorCore durante 5 a 10 minutos. | Extraer lote base y luego consultar documentos modificados después de `_extractedAt`. | El frontend escribe en Firestore y Catalyst simultáneamente durante una semana. |
| **Complejidad** | **Mínima:** Un banner de mantenimiento en el cliente o regla temporal en Firestore. | **Alta:** Requiere campos `updatedAt` homogéneos en los 73 documentos y CDC. | **Extrema:** Requiere transacciones distribuidas 2PC o sagas complejas en el cliente React. |
| **Riesgo de Datos** | **Cero:** Se toma una fotografía estática inmutable. | Medio: Riesgo de omitir eliminaciones lógicas (tombstones). | Crítico: Riesgo de estado split-brain y escrituras parciales. |
| **Idoneidad para VigorCore** | **100% Óptima:** Con solo 73 documentos y 5 usuarios, la extracción toma menos de 10 segundos. | Innecesaria para este volumen de datos. | Totalmente desaconsejada. |

**Dictamen de Consistencia [VERIFIED]:**  
Para la Fase 3.5 se aprueba **exclusivamente la Estrategia A (Ventana de Mantenimiento Fría)**. Se informará a los 5 usuarios o se activará un modo de solo lectura en la aplicación durante la ventana de migración de 10 minutos.

---

## 2. AUDITORÍA DE LAS 7 SITUACIONES CRÍTICAS DE IDEMPOTENCIA Y CARGA

| # | Situación Crítica | Comportamiento del Diseño 3.4 | Riesgo Identificado | Solución y Regla de Invariante Auditada |
| :-: | :--- | :--- | :--- | :--- |
| **1** | El lote se carga en Catalyst, pero el ETL se interrumpe antes de guardar el checkpoint. | Al reanudar, el worker intentará reinsertar los mismos ítems. | Error potencial de clave duplicada si la inserción no es condicional. | **Condición Idempotente:** El insert evalúa `attribute_not_exists(pk)` o compara `_payloadHash`. Si ya existe con el mismo hash, retorna éxito (`SKIPPED_EXISTING`) sin error. |
| **2** | El mismo documento se procesa dos veces por reintento de cola. | Se intenta sobreescribir el ítem en `UserData`. | Duplicación de operaciones de red. | Inserción con `upsert` condicional idempotente. El sort key es determinista (`sk = BIO#current`); no se generan ítems repetidos. |
| **3** | Un documento ya existe en Catalyst pero con contenido diferente. | Conflicto de versiones. | Posible sobreescritura destructiva de cambios locales. | El worker detecta discrepancia de `_payloadHash`. Si el registro destino no tiene `_migrationBatchId`, se bloquea la inserción y se envía a cuarentena. |
| **4** | Un usuario modifica un registro después de su importación inicial. | El registro en Catalyst actualiza su `updatedAt` y su contenido. | Si el ETL se re-ejecuta, sobreescribiría los cambios del usuario con el histórico viejo. | **Regla Anti-Sobrescritura:** La condición de actualización del ETL exige: `(attribute_not_exists(userModifiedAt)) OR (userModifiedAt <= _migratedAt)`. Si el usuario modificó el dato, el ETL no lo toca. |
| **5** | Se solicita un Rollback después de que los usuarios hicieron modificaciones posteriores. | El diseño 3.4 proponía: `DELETE WHERE _migrationBatchId == '...'`. | **CRITICAL [BLOCKER: F-ROL-01]:** Destruiría los entrenamientos o comidas creadas por el atleta después de la migración. | **Rollback Seguro y Filtrado:** El rollback solo puede eliminar un registro si `updatedAt == _migratedAt` (es decir, el registro no ha sufrido ninguna mutación posterior por parte del atleta). |
| **6** | Un lote de 25 ítems termina parcialmente (ej: 15 insertados, 10 fallidos por timeout de red). | Fallo de red transitorio en Catalyst. | Estado de carga parcial en el lote. | Catalyst NoSQL evalúa los ítems individualmente en el lote. El checkpoint registra la lista de claves confirmadas individualmente, no solo el índice del lote. |
| **7** | Se reanuda el trabajo desde un checkpoint antiguo no sincronizado. | Intento de re-ejecutar tareas ya concluidas. | Inconsistencia de contadores. | El checkpoint se valida contra el estado real de la base de datos mediante una consulta previa de existencia (`fetchItem`) antes de reiniciar el bucle de carga. |

---

## 3. AUDITORÍA DEL PROCEDIMIENTO DE ROLLBACK SEGURO

### Fallo Crítico Detectado en el Diseño 3.4 [BLOCKER: F-ROL-01]:
En el archivo `etl-risk-register.md` se afirmó:
> *"Se consultan todos los registros que posean el metadato `_migrationBatchId == 'MIG-20261109-01'` y se eliminan atómicamente por lotes."*

Esta afirmación es técnicamente deficiente y peligrosa:
1. En Zoho Catalyst NoSQL, **no existe la operación `DELETE WHERE attribute == value`**. Todas las eliminaciones exigen especificar la clave de partición (`pk`) y la clave de ordenamiento (`sk`) exacta de cada registro.
2. Si un usuario ya inició sesión y agregó 3 ítems a su despensa o completó un entrenamiento, un script que busque registros por `_migrationBatchId` podría desvincular o corromper el árbol de datos del usuario.

### Especificación Corregida del Rollback Seguro:
```typescript
export async function executeSafeMigrationRollback(
  manifest: ExtractionManifest,
  storage: INoSQLStorageAdapter
): Promise<RollbackReport> {
  const report: RollbackReport = { deleted: 0, preservedUserModifications: 0, errors: [] };

  for (const item of manifest.documents) {
    const pk = `USER#${item.sourceUid}`;
    const sk = item.sortKey;

    // 1. Obtener estado actual en Catalyst
    const current = await storage.fetchItem('UserData', { keys: { pk, sk }, consistent_read: true });
    if (!current.item) continue;

    // 2. Comprobar si el registro fue modificado por el usuario tras la migración
    const migratedAt = Number(current.item._migratedAt || 0);
    const lastUpdatedAt = Number(current.item.updatedAt || current.item._sourceUpdateTimeEpoch || 0);

    if (current.item._userMutatedAfterMigration === true || lastUpdatedAt > migratedAt) {
      // PRESERVAR: El atleta ha generado datos después de la importación
      report.preservedUserModifications++;
      continue;
    }

    // 3. Eliminar condicionalmente solo si el hash no ha cambiado
    const delRes = await storage.deleteItems('UserData', {
      keys: { pk, sk },
      condition: {
        attribute: ['_contentHash'],
        operator: EQUALS,
        value: { S: item.payloadHash }
      }
    });

    if (delRes.success) report.deleted++;
    else report.errors.push({ pk, sk, error: delRes.error });
  }

  return report;
}
```
