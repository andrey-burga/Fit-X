# VIGORCORE — EVALUACIÓN DE SEGURIDAD Y CONTROL DE ROLLBACK (FASE 3.4.2)
## Resolución Definitiva de F-ROL-01: Erradicación del Borrado Destructivo y Política Conservadora

**Fecha de emisión:** 10 de noviembre de 2026  
**Módulo Implementado:** `poc/catalyst-3-2/src/etl/rollbackSafety.ts`  
**Suite de Pruebas:** `poc/catalyst-3-2/scripts/test-phase-3.4.2-closure.ts` (Casos F-ROL-01.1 a F-ROL-01.6)  
**Estado:** **CLOSED / PASS-UNIT**

---

## 1. INVESTIGACIÓN DE CAPACIDADES REALES DE ZOHO CATALYST NOSQL

### A. Capacidades Demostradas en la POC [VERIFIED / PASS-UNIT]:
1. **Eliminación por Clave Exacta:** El SDK `@zcatalyst/nosql` soporta `deleteItems(tableName, ...items)` exigiendo la clave de partición (`pk`) y clave de ordenamiento (`sk`).
2. **Evaluación de Condiciones en Motor Simulado:** La interfaz `INoSQLDeleteItem` contempla un atributo `condition?: INoSQLCondition`. En el motor simulado local (`catalystNosql.ts:275`), las condiciones atómicas se evalúan correctamente.

### B. Limitaciones del Entorno Remoto [NOT VERIFIED]:
1. **Ausencia de Verificación Remota de Condiciones en Atributos Secundarios:**  
   No se cuenta con una prueba de integración remota contra los servidores de producción de Zoho Catalyst que demuestre que una condición atómica compleja sobre un atributo no indexado (ej. `_contentHash == expectedHash`) se evalúa en el servidor de forma transaccional antes del borrado.
2. **Inexistencia de Borrado por Lote por Atributo:**  
   Catalyst NoSQL **no soporta** la sintaxis `DELETE FROM Table WHERE batchId = '...'`. Cualquier borrado requiere conocer previamente las tuplas `(pk, sk)` exactas.

---

## 2. LA POLÍTICA DE ROLLBACK CONSERVADORA OBLIGATORIA

Conforme a la instrucción directiva para escenarios donde no existe evidencia verificable de una operación remota atómica:

### Regla 1: Prohibición de Rollback Automático Post-Activación (Post-Cutover)
- **Si las escrituras de usuarios están habilitadas en producción (`userWritesEnabled === true`), el rollback automático por script está ESTRICTAMENTE PROHIBIDO.**
- El motor `SafeRollbackEngine` aborta inmediatamente con estado `ABORTED_USER_WRITES_ACTIVE` y lanza la alerta:
  ```
  SAFETY_HALT: Automatic rollback is prohibited because user writes are active in production. Manual triage required.
  ```
- *Justificación:* Evitar que un script de compensación destruya datos creados por atletas en vivo mientras se diagnostica un problema técnico.

### Regla 2: Verificación de Contenido Profundo (Anti-False Timestamp Collision)
La igualdad `updatedAt == _migratedAt` **no es suficiente** para autorizar un borrado:
- Un cliente defectuoso o un script de sincronización offline podría mutar un registro sin actualizar el timestamp `updatedAt`.
- **Invariante Implementado:** El motor recalcula el hash canónico del documento actualmente persistido en Catalyst (`currentContentHash = computeCanonicalSha256(current)`) y lo compara con el `transformedHash` registrado en el manifiesto de migración original.
- Si los hashes no coinciden, el documento **NO SE BORRA**, se preserva y se cataloga con causa `CONTENT_HASH_MISMATCH` en el reporte de cuarentena.

### Regla 3: Preservación de Flags de Mutación del Atleta
Si el registro contiene `_userMutatedAfterMigration === true` o pertenece a un lote diferente (`_migrationBatchId !== manifestBatchId`), el documento es intocable y se preserva.

---

## 3. ESPECIFICACIÓN DEL FLUJO DE ROLLBACK SEGURO

```mermaid
flowchart TD
    START["Inicio Safe Rollback"] --> CHK_LIVE{"¿Escrituras de usuarios activas?<br/>(userWritesEnabled == true)"}
    
    CHK_LIVE -->|Sí| ABORT["ABORTAR INMEDIATAMENTE<br/>status: ABORTED_USER_WRITES_ACTIVE<br/>(Cero Borrados)"]
    
    CHK_LIVE -->|No (Pre-Cutover)| LOOP["Iterar Manifiesto de Migración (pk, sk)"]
    
    LOOP --> FETCH["fetchItem(table, pk, sk)"]
    FETCH -->|No existe / Ya borrado| NEXT["Continuar (Sin Acción)"]
    
    FETCH -->|Existe Documento| EVAL1{"¿_userMutatedAfterMigration == true<br/>O batchId no coincide?"}
    EVAL1 -->|Sí| QUAR1["PRESERVAR Y CUARENTENA<br/>reason: POST_MIGRATION_USER_MUTATION"]
    
    EVAL1 -->|No| EVAL2{"¿current.updatedAt > migratedAt?"}
    EVAL2 -->|Sí| QUAR2["PRESERVAR Y CUARENTENA<br/>reason: TIMESTAMP_DIVERGENCE"]
    
    EVAL2 -->|No| EVAL3{"¿computeCanonicalSha256(current) == transformedHash?"}
    EVAL3 -->|No (Contenido Diferente)| QUAR3["PRESERVAR Y CUARENTENA<br/>reason: CONTENT_HASH_MISMATCH"]
    
    EVAL3 -->|Sí (100% Idéntico)| DEL["deleteItem(table, pk, sk)<br/>(Eliminación Segura y Confirmada)"]
    DEL --> OK_CNT["Incrementar deletedCount"]
    
    QUAR1 --> LOOP
    QUAR2 --> LOOP
    QUAR3 --> LOOP
    OK_CNT --> LOOP
    NEXT --> LOOP

    style ABORT fill:#fee2e2,stroke:#ef4444,stroke-width:2px
    style QUAR1 fill:#fef3c7,stroke:#d97706,stroke-width:2px
    style QUAR2 fill:#fef3c7,stroke:#d97706,stroke-width:2px
    style QUAR3 fill:#fef3c7,stroke:#d97706,stroke-width:2px
    style DEL fill:#dcfce7,stroke:#16a34a,stroke-width:2px
```

---

## 4. EVIDENCIA DE PRUEBAS AUTOMATIZADAS (6/6 PASS-UNIT)

Las 6 pruebas unitarias ejecutadas en `scripts/test-phase-3.4.2-closure.ts` demostraron:

| ID de Prueba | Escenario Evaluado | Resultado Observado | Estado |
| :--- | :--- | :--- | :---: |
| **F-ROL-01.1** | Rollback pre-cutover sobre documento idéntico | Eliminación limpia exitosa, estado `COMPLETED_CLEAN`, `deletedCount: 1` | **PASS-UNIT** |
| **F-ROL-01.2** | Intento de rollback con `userWritesEnabled: true` | Aborto inmediato fail-safe, estado `ABORTED_USER_WRITES_ACTIVE`, `deletedCount: 0` | **PASS-UNIT** |
| **F-ROL-01.3** | Documento modificado con `updatedAt > migratedAt` | Preservado intacto, catalogado `TIMESTAMP_DIVERGENCE`, `deletedCount: 0` | **PASS-UNIT** |
| **F-ROL-01.4** | CASO CRÍTICO: `updatedAt == migratedAt` pero contenido mutado | Comprobación de hash canónico profundo salva el dato (`CONTENT_HASH_MISMATCH`) | **PASS-UNIT** |
| **F-ROL-01.5** | Documento con `_userMutatedAfterMigration: true` | Preservado intacto, catalogado `POST_MIGRATION_USER_MUTATION` | **PASS-UNIT** |
| **F-ROL-01.6** | Documento con lote de migración diferente | Preservado intacto, `deletedCount: 0` | **PASS-UNIT** |

---

## 5. CONCLUSIÓN Y GARANTÍAS DE RECUPERACIÓN

1. **Cero Borrado Destructivo:** Ningún registro modificado por un usuario después de la migración puede ser eliminado por un rollback.
2. **Respaldo Dorado Intacto:** Cloud Firestore permanece en modo solo lectura durante todo el proceso, por lo que el estado de origen es 100% inmutable y recuperable.
3. **Auditoría de Cuarentena:** Cualquier discrepancia genera un reporte forense detallado sin interrumpir la operación de los registros legítimos.
