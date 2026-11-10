# VIGORCORE — FASE 3.5.0: PROCEDIMIENTO DE PREFLIGHT

## 1. OBJETIVO DEL PREFLIGHT

El modo `Preflight` tiene como finalidad exclusiva auditar y verificar el estado actual del proyecto GCP y de la base de datos Firestore sin descargar ningún campo de datos privados.

Es una compuerta previa obligatoria: ningún proceso de extracción puede autorizarse sin un Preflight exitoso emitido dentro de los 60 minutos previos.

---

## 2. PROCEDIMIENTO TÉCNICO PASO A PASO

### Paso 1: Validación de Conectividad y ADC
- Ejecuta `gcloud auth application-default print-access-token` en memoria.
- Verifica que el token sea válido y esté asociado al proyecto `gen-lang-client-0041212770`.

### Paso 2: Enumeración de Usuarios Raíz (`users`)
- Invoca el endpoint REST:
  `POST https://firestore.googleapis.com/v1/projects/gen-lang-client-0041212770/databases/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c/documents:runQuery`
- Cuerpo estructurado con proyección estricta:
  ```json
  {
    "structuredQuery": {
      "select": { "fields": [{ "fieldPath": "__name__" }] },
      "from": [{ "collectionId": "users" }],
      "orderBy": [{ "field": { "fieldPath": "__name__" }, "direction": "ASCENDING" }],
      "limit": 100
    }
  }
  ```
- **Failsafe de Privacidad:** Si la respuesta de Firestore contiene `document.fields`, el script aborta inmediatamente con violación crítica de privacidad.
- Asocia en memoria los identificadores a los alias deterministas `USER_001` a `USER_005`. Los UIDs reales nunca se imprimen en consola ni se graban en logs públicos.

### Paso 3: Inspección de las 11 Subcolecciones Candidatas
Para cada usuario (`USER_001` .. `USER_005`), el extractor consulta mediante `runQuery` (proyección `__name__`) las siguientes 11 subcolecciones:
1. `biometrics`
2. `preferences`
3. `groceries`
4. `mealLogs`
5. `notifications`
6. `workoutSessions`
7. `cardioSessions`
8. `recipes`
9. `mealPlans`
10. `workoutRoutines`
11. `executedWorkouts`

- **Tratamiento de Errores:** Si una subcolección devuelve un código de error HTTP (ej. 403 o 500), su conteo se registra como `null` (desconocido) y **nunca se convierte en cero**.

### Paso 4: Comprobación de Colecciones Administrativas Raíz
Consulta las 6 colecciones de control:
1. `adminUserDirectory`
2. `adminRoleState`
3. `adminInvitations`
4. `accountAccess`
5. `adminAuditLogs`
6. `adminInvitationOperations`

### Paso 5: Conciliación Contra el Baseline Histórico
- **Baseline Esperado:** 5 usuarios y 73 documentos totales.
- Si `totalDiscovered == 73` y `usersCount == 5` y `errors == 0` -> `PREFLIGHT_PASS`.
- Si `totalDiscovered != 73` o `usersCount != 5` -> `BASELINE_DRIFT`.
- Si `errors > 0` -> `PREFLIGHT_FAILED`.

---

## 3. ARTEFACTO GENERADO: `preflight-token.json`

Ubicación: `poc/catalyst-3-2/reports/firestore-extraction-3.5/preflight-token.json`

Estructura:
```json
{
  "extractorVersion": "1.0.0",
  "executionId": "b1f85e42-1234-4567-89ab-cdef01234567",
  "timestampUtc": "2026-11-10T17:30:00.0000000Z",
  "projectId": "gen-lang-client-0041212770",
  "databaseId": "ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c",
  "usersDiscovered": 5,
  "totalDocumentsDiscovered": 73,
  "historicalBaselineTotal": 73,
  "status": "PREFLIGHT_PASS",
  "driftReason": "",
  "countsByUser": {
    "USER_001": { "biometrics": 1, "groceries": 10, ... },
    ...
  },
  "administrativeCounts": {
    "adminUserDirectory": 0,
    ...
  },
  "totalRequestsExecuted": 62,
  "errors": []
}
```

### Validez Temporal
El archivo `preflight-token.json` tiene una caducidad de 60 minutos. Trascurridos 60 minutos desde `timestampUtc`, el modo `Extract` rechaza la ejecución hasta que se ejecute un nuevo Preflight.
