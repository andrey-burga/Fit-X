# VIGORCORE — FASE 3.5.0.1: AUDITORÍA DE SEGURIDAD DEL PREFLIGHT TOKEN

## 1. REVISIÓN Y ANÁLISIS DE CAMPOS DEL TOKEN

El archivo legible de preflight se genera en:
`poc/catalyst-3-2/reports/firestore-extraction-3.5/preflight-token.json`

### Campos Contenidos:
```json
{
  "extractorVersion": "1.0.0",
  "executionId": "GUID v4 de la ejecución",
  "timestampUtc": "2026-11-10T10:15:30.0000000Z",
  "projectId": "gen-lang-client-0041212770",
  "databaseId": "ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c",
  "usersDiscovered": 5,
  "totalDocumentsDiscovered": 73,
  "historicalBaselineTotal": 73,
  "status": "PREFLIGHT_PASS",
  "driftReason": "",
  "countsByUser": {
    "USER_001": { "biometrics": 1, "groceries": 10, ... },
    "USER_002": { ... }
  },
  "administrativeCounts": {
    "adminUserDirectory": 0,
    ...
  },
  "totalRequestsExecuted": 62,
  "errors": []
}
```

---

## 2. AUDITORÍA FORENSE DE PRIVACIDAD

1. **Ausencia Total de Identificadores Reales (UIDs):** El archivo utiliza exclusivamente alias opacos `USER_001` a `USER_005`. No contiene UIDs de Firebase, correos electrónicos, nombres ni identificadores de recursos.
2. **Ausencia de Datos Personales o Métricas:** Solo se persisten conteos numéricos enteros por colección. No hay biometría, pesajes ni historiales de entrenamiento.
3. **Ausencia de Credenciales o Tokens:** El access token ADC jamás se escribe en este archivo ni en logs.

---

## 3. VULNERABILIDAD IDENTIFICADA Y SOLUCIÓN CRIPTOGRÁFICA

### Riesgo Detectado en la Fase 3.5.0:
Un archivo JSON en texto plano es susceptible de manipulación manual. Un operador o atacante podría abrir `preflight-token.json`, modificar el campo `"status": "BASELINE_DRIFT"` por `"status": "PREFLIGHT_PASS"`, o alterar el `projectId` para engañar a las compuertas del modo `Extract`.

### Solución Implementada en la Fase 3.5.0.1:
Se ha implementado una arquitectura de **Verificación Autenticada Dual**:

```
[ Preflight ] 
      │
      ├──> preflight-token.json  (Legible / Cero PII / Para Auditoría Humana)
      │
      └──> preflight-token.bin   (Sobre Autenticado Cifrado en Reposo con DPAPI)
            Contiene: { tokenSha256, projectId, databaseId, status, timestampUtc }
```

### Protocolo de Validación en Modo `Extract`:
1. El extractor carga simultáneamente `preflight-token.json` y `preflight-token.bin`.
2. Descifra `preflight-token.bin` en memoria mediante DPAPI (`CurrentUser`). Si el archivo fue alterado o no se puede descifrar, aborta con `BLOQUEO CRIPTOGRAFICO`.
3. Calcula de forma independiente el hash SHA-256 canónico de `preflight-token.json`.
4. Compara el hash recomputado contra el `tokenSha256` protegido en el sobre binario. Si no coinciden exactamente, aborta con:
   `BLOQUEO DE INTEGRIDAD: preflight-token.json fue manipulado o no coincide con la firma autenticada DPAPI.`
5. Comprueba que el `projectId` y el `databaseId` del token autenticado coincidan exactamente con los parámetros con los que fue invocado el script.
6. Comprueba que la antigüedad (`timestampUtc`) no supere los 60 minutos.

---

## 4. RESULTADO DE LAS PRUEBAS DE VULNERABILIDAD

En la suite `test-phase-3.5-extractor.ts`, se evaluaron los siguientes vectores de ataque:

| Vector de Ataque Evaluado | Comportamiento Esperado | Resultado |
| :--- | :--- | :---: |
| **Manipulación manual del JSON** (cambiar `BASELINE_DRIFT` a `PREFLIGHT_PASS`) | Rechazo inmediato con `TOKEN_TAMPERED` | **APROBADO** |
| **Token caducado** (antigüedad > 60 minutos) | Rechazo inmediato con `TOKEN_EXPIRED` | **APROBADO** |
| **Token de otro proyecto GCP** | Rechazo inmediato con `PROJECT_MISMATCH` | **APROBADO** |
| **Token de otra base de datos Firestore** | Rechazo inmediato con `DATABASE_MISMATCH` | **APROBADO** |
| **Sobre binario `.bin` corrupto o con clave ajena** | Rechazo inmediato con `TOKEN_CORRUPTED` | **APROBADO** |
