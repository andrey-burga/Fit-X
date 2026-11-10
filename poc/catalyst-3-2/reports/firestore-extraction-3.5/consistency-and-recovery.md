# VIGORCORE — FASE 3.5.0: MODELO DE CONSISTENCIA Y RECUPERABILIDAD

## 1. REALIDAD TÉCNICA DE FIRESTORE REST V1

En Google Cloud Firestore, la API REST v1 no provee transacciones multi-colección globales para lecturas masivas paginadas. No existe un mecanismo que garantice un "snapshot freeze" transaccional de toda la base de datos mientras un cliente descarga documentos secuencialmente a través de HTTP.

---

## 2. MODELO DE CONSISTENCIA DE VENTANA OBSERVADA

Para mitigar el riesgo de mutaciones en vuelo sin asumir garantías inexistentes, el extractor implementa el modelo de **Consistencia de Ventana Observada**:

1. **Captura de Metadatos Temporales en Origen:**
   - Para cada documento se registra su `createTime` y `updateTime` provistos por los servidores de Google Cloud.
   - Se registra el instante de lectura local del cliente (`extractedAtUtc`).
2. **Verificación Posterior de Metadatos (Post-Verification Scan):**
   - Una vez finalizada la extracción de los 73 documentos, el script realiza un barrido rápido de metadatos sobre todas las rutas extraídas para consultar su `updateTime` en Firestore.
3. **Detección de Anomalías:**
   - Si se detecta un documento nuevo en Firestore que no fue extraído: `DOCUMENT_ADDED_DURING_EXTRACTION`.
   - Si el `updateTime` de un documento difiere del capturado en el sobre: `DOCUMENT_MODIFIED_DURING_EXTRACTION`.
   - Si un documento ya no existe: `DOCUMENT_DELETED_DURING_EXTRACTION`.

### Dictámenes de Consistencia
- **`CONSISTENCY_DRIFT`:** Se detectó al menos una mutación o adición durante la ventana de extracción. La migración no puede declararse consistente sin conciliación manual.
- **`STABLE_DURING_OBSERVED_WINDOW`:** No se observaron cambios en los metadatos de los documentos durante la ventana transcurrida entre la lectura inicial y la verificación final.
- *Nota Rigurosa:* Este veredicto certifica estabilidad observada, **no un snapshot transaccional atómico**.

---

## 3. VENTANA DE MANTENIMIENTO: ALCANCE Y LIMITACIONES

El modo `Extract` exige la confirmación del operador sobre la suspensión de escrituras en origen (`MaintenanceWindowConfirmed`).

> **DOCUMENTACIÓN EXPRESA DE LIMITACIÓN:**
> La confirmación de ventana de mantenimiento es una **declaración operativa y procedimental humana**, no un bloqueo técnico o bloqueo a nivel de motor en Google Cloud Firestore.
> El script no deshabilita reglas de seguridad ni apaga el proyecto; confía en la coordinación del operador con los clientes frontend de VigorCore para pausar las mutaciones de los atletas durante los 30 segundos que demora la extracción.

---

## 4. CHECKPOINTS CIFRADOS Y RESILIENCIA ANTE FALLAS

Si la conexión de red falla, la cuota se agota o el operador interrumpe el proceso (`Ctrl+C`), el extractor está diseñado para reanudarse de forma idempotente:

1. **Persistencia Atómica del Progreso:**
   - Tras cada documento confirmado y cada bloque de 10 documentos, se serializa el estado en `checkpoint.bin.tmp`, se cifra con DPAPI y se renombra a `checkpoint.bin`.
2. **Reanudación Idempotente (`-Resume`):**
   - El script detecta `checkpoint.bin`, descifra el contenido en memoria y recupera `nextDocIndex` y la lista `confirmedDocIds`.
   - Al procesar la cola de documentos, omite aquellos que ya cuentan con un sobre cifrado verificado en disco.
   - Evita descargas duplicadas y garantiza que los documentos previamente extraídos mantengan su integridad original.
3. **Cero Sobrescrituras Corruptas:**
   - Si un archivo `doc-XXXXXX.bin` ya existe en disco, se verifica su descifrado y hash antes de reutilizarlo. Si el archivo está corrupto, se aísla y se reporta inmediatamente.
