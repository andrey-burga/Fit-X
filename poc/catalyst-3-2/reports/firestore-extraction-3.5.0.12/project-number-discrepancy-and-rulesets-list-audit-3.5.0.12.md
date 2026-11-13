# VIGORCORE — INFORME PERICIAL FASE 3.5.0.12
## DIAGNÓSTICO DE DISCREPANCIA ENTRE PROJECT NUMBER Y RULESET ATTACHMENT POINT + AUDITORÍA DE `projects.rulesets.list`

**Fecha de Emisión:** 13 de Noviembre de 2026  
**Proyecto Google Cloud Objetivo:** `gen-lang-client-0041212770`  
**Número Previo Configurado:** `510844325101`  
**Número Observado en Attachment Point Remoto:** `955230563489`  
**Base de Datos Firestore Nombrada:** `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`  
**Release Canónica Encontrada en Vivo:** `projects/gen-lang-client-0041212770/releases/cloud.firestore/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`  
**Ruleset Asociado Observado:** `projects/gen-lang-client-0041212770/rulesets/40671e7f-14ef-4cca-885d-af9c292b9e1a`  
**Dictamen Oficial:** `PROJECT_NUMBER_MAPPING_DIAGNOSIS — PENDING WINDOWS VERIFICATION`

---

### 1. EVIDENCIA OPERATIVA Y ANÁLISIS FORENSE DE ORIGEN EN EL REPOSITORIO

Durante la ejecución real en Windows PowerShell 5.1 de `query-remote-rules.ps1` (Fase 3.5.0.11), el script identificó de forma exacta la release y el ruleset en Firebase Rules API y **detuvo correctamente la ejecución** (mecanismo *fail-closed*) al detectar que el `attachment_point` remoto declaraba el número de proyecto `955230563489` en lugar del valor esperado `510844325101`:

- **Attachment point recibido:**  
  `firestore.googleapis.com/projects/955230563489/databases/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`
- **Attachment point esperado por el script:**  
  `firestore.googleapis.com/projects/510844325101/databases/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`

#### 1.1. Trazabilidad de Ambos Números en el Repositorio Local
Una inspección de solo lectura del código y artefactos de configuración del repositorio revela dos orígenes distintos:

1. **Evidencia asociada a `955230563489`:**
   En el archivo raíz `firebase-applet-config.json` (configuración web de Firebase del proyecto `gen-lang-client-0041212770`), figuran los siguientes valores:
   - `"projectId": "gen-lang-client-0041212770"`
   - `"appId": "1:955230563489:web:efc77af5ff4ba7a2ed94e0"`
   - `"messagingSenderId": "955230563489"`
   - `"oAuthClientId": "955230563489-1avokj0nj0lju821ct6snt0invfgso4j.apps.googleusercontent.com"`
   - `"firestoreDatabaseId": "ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c"`
   
   En configuraciones estándar de Firebase/GCP, `messagingSenderId` y el prefijo numérico de `appId`/`oAuthClientId` coinciden típicamente con el `projectNumber` del proyecto Firebase.

2. **Evidencia asociada a `510844325101`:**
   El número `510844325101` aparece únicamente dentro de `poc/catalyst-3-2/` (a partir de la Fase 3.5.0.9) y en los metadatos de alojamiento Cloud Run del entorno de desarrollo (`https://ais-dev-...-510844325101.us-west1.run.app`). No figura en `firebase-applet-config.json`, `.firebaserc`, `functions/`, `src/` ni en `docs/production-readiness-7D.md`.

#### 1.2. Hipótesis a Verificar Objetivamente (Sin Asunciones)
- **Hipótesis A:** El `projectNumber` real de `gen-lang-client-0041212770` en Cloud Resource Manager es `955230563489`, y el valor `510844325101` incorporado en Fase 3.5.0.9 provenía del proyecto de runtime Cloud Run sin haber sido contrastado con `gcloud projects describe`.
- **Hipótesis B:** El `projectNumber` real de `gen-lang-client-0041212770` es `510844325101` (u otro distinto) y el ruleset `40671e7f-14ef-4cca-885d-af9c292b9e1a` fue creado o vinculado haciendo referencia a otro proyecto (`955230563489`).

**Regla de Neutralidad:** Ninguna hipótesis se da por comprobada hasta ejecutar la verificación directa contra Google Cloud Resource Manager en la estación Windows del operador. No se realiza ninguna autocorrección ni aceptación dual de números, y `query-remote-rules.ps1` mantiene su validación estricta intacta.

---

### 2. SCRIPT DE VERIFICACIÓN SOLO LECTURA (`verify-ruleset-attachment-project.ps1`)

Se creó `poc/catalyst-3-2/scripts/verify-ruleset-attachment-project.ps1` (compatible con Windows PowerShell 5.1, `Set-StrictMode -Version Latest`, acceso defensivo `Get-SafePropertyValue`) con las siguientes garantías:

1. **Consulta exclusiva a Google Cloud Resource Manager vía `gcloud` (Cero Firebase Rules API):**
   - Paso 1: `gcloud projects describe gen-lang-client-0041212770 --format=json` para extraer `projectId`, `projectNumber` y `lifecycleState` y compararlos tanto con `510844325101` como con `955230563489`.
   - Paso 2: `gcloud projects list --filter="projectNumber=955230563489" --format=json` para inspeccionar si el proyecto `955230563489` es visible para la cuenta activa.
   - Paso 3 (auxiliar si hay discrepancia): `gcloud projects list --filter="projectNumber=510844325101" --format=json` para determinar si `510844325101` pertenece a otro proyecto visible para la cuenta activa.
2. **Clasificación Estríctamente Diferenciada de Resultados y Errores:**
   - Resultado vacío (`[]` con código 0): clasificado como **`PROJECT_NOT_VISIBLE_TO_ACTIVE_ACCOUNT`** (nunca como prueba de inexistencia del proyecto).
   - Errores de autenticación (`Reauthentication`, `UNAUTHENTICATED`, `invalid_rapt`, credenciales expiradas): **`AUTH_ERROR`**.
   - Errores de autorización (`PERMISSION_DENIED`, HTTP `403`, `does not have permission`): **`PERMISSION_DENIED`**.
   - Errores del servicio/red (`API_NOT_ENABLED`, HTTP `5xx`, salida distinta de cero): **`API_ERROR`**.
   - Salida vacía con código 0: **`EMPTY_RESPONSE`**.
   - Salida no JSON válida: **`MALFORMED_JSON`**.
3. **Cero Exposición de Credenciales y Reporte JSON Local:**
   - No invoca `print-access-token`, no envía cabeceras `Authorization` manuales y sanitiza cualquier cadena tipo `ya29.*` o `Bearer *` antes de registrar errores.
   - Escribe atómicamente en UTF-8 sin BOM el informe estructurado `poc/catalyst-3-2/reports/firestore-extraction-3.5.0.12/ruleset-attachment-project-verification.json` incluyendo las limitaciones metodológicas explícitas.

---

### 3. AUDITORÍA COMPLEMENTARIA DEL FLUJO `projects.rulesets.list` (FIREBASE RULES API V1)

#### 3.1. Especificación Oficial Documentada vs. Evidencia Empírica
De acuerdo con la documentación oficial de Firebase Rules REST API v1:
- **Endpoint:** `GET https://firebaserules.googleapis.com/v1/projects/{projectId}/rulesets` (`projects.rulesets.list`)
- **Respuesta (`ListRulesetsResponse`):** Devuelve objetos `Ruleset` de metadatos (incluyendo `name`, `createTime`, `metadata`) y `nextPageToken`, **omitiendo por diseño el payload `source`** (`source.files[].content`), cuya descarga completa requiere `projects.rulesets.get`.
- **Campo `attachment_point` en el recurso `Ruleset`:** El esquema REST de `Ruleset` define el campo `attachment_point` (por ejemplo, `firestore.googleapis.com/projects/<project number>/databases/<database ID>`).

**Limitación Epistémica Declarada (Sin Afirmaciones No Verificadas):**  
Debido a la prohibición estricta de ejecutar solicitudes a Firebase Rules API durante esta fase, **no se ha comprobado en vivo** si la respuesta real de `projects.rulesets.list` en `gen-lang-client-0041212770` incluye efectivamente `attachment_point` poblado en el elemento correspondiente al ruleset `40671e7f-14ef-4cca-885d-af9c292b9e1a`, o si el servicio lo omite en la proyección resumida de lista.

#### 3.2. Viabilidad del Flujo Seguro Pre-Descarga
Es arquitectónicamente viable y recomendable implementar en una fase posterior el flujo de pre-validación en dos niveles antes de descargar `source`:

1. Obtener la release exacta mediante `projects.releases.list` (coincidencia canónica).
2. Extraer `rulesetName`.
3. Consultar únicamente metadatos mediante `projects.rulesets.list` (paginando hasta localizar el `Ruleset.name` exacto; este endpoint omite `source`).
4. Evaluar `attachment_point` sobre el objeto de metadatos retornado por `rulesets.list`.
5. **Regla Fail-Closed Obligatoria:** Si `attachment_point` está ausente o vacío en el objeto de `rulesets.list`, abortar inmediatamente con **`ATTACHMENT_POINT_UNVERIFIABLE_WITH_METADATA_LIST`** y **PROHIBIR** la ejecución automática de `projects.rulesets.get`.
6. Autorizar `projects.rulesets.get` exclusivamente tras validar que `attachment_point` coincide con el `projectNumber` verificado y `databaseId` esperado.

*(Nota: Este flujo no se ha activado automáticamente en `query-remote-rules.ps1` en la Fase 3.5.0.12 para respetar el congelamiento de diagnóstico previo a la verificación en Windows).*

---

### 4. TAXONOMÍA DE PRUEBAS ACTUALIZADA (103 ESCENARIOS)

Se añadieron 12 pruebas en la **Sección 18** (`T-3512-01` a `T-3512-12`) en `poc/catalyst-3-2/scripts/test-phase-3.5-extractor.ts`:

| Categoría | Total | Cobertura Verificada | Estado |
|---|---|---|---|
| **PASS-UNIT** | **75** | Coincidencia y discrepancia de project number sin autocorrección, visibilidad/ausencia (`PROJECT_NOT_VISIBLE_TO_ACTIVE_ACCOUNT`), errores `PERMISSION_DENIED`, `AUTH_ERROR`, `API_ERROR`, `EMPTY_RESPONSE`, `MALFORMED_JSON`, bloqueo `ATTACHMENT_POINT_UNVERIFIABLE_WITH_METADATA_LIST` y prohibición de `rulesets.get` previo a validación de destino. | **APROBADO** |
| **PASS-MOCK** | **15** | Simulación ACL SDDL en dos etapas y Reparse Points (Fases previas). | **APROBADO** |
| **PASS-STATIC** | **13** | Análisis estático de `verify-ruleset-attachment-project.ps1` (PS 5.1, cero REST/Rules API, cero escritura, sanitización), preservación estricta de `query-remote-rules.ps1` y correlación de `firebase-applet-config.json`. | **APROBADO** |

> **Transparencia de Ejecución:** Todas las pruebas ejecutadas en el contenedor AI Studio son **UNIT, MOCK y STATIC** (cero llamadas remotas ejecutadas).

---

### 5. AISLAMIENTO DE PRODUCCIÓN

- `src/`: **INTACTO** (sin modificaciones).
- `functions/`: **INTACTO** (sin modificaciones).
- `firestore.rules`: **INTACTO** (sin modificaciones).
- `package.json` raíz y `bun.lock` raíz: **INTACTOS** (sin modificaciones).
- `poc/catalyst-3-2/scripts/query-remote-rules.ps1`: **INTACTO** (conserva validación estricta de `510844325101`).

---

### 6. INSTRUCCIONES EXACTAS PARA EL OPERADOR EN WINDOWS POWERSHELL 5.1

Ejecutar desde `poc/catalyst-3-2/` en Windows PowerShell 5.1 (sin `-SaveSnapshot` ni `-AllowOverwrite` y sin invocar `query-remote-rules.ps1`):

```powershell
# 1. Validación sintáctica estricta en PowerShell 5.1
$errors = @()
$null = [System.Management.Automation.Language.Parser]::ParseFile("scripts/verify-ruleset-attachment-project.ps1", [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { throw "Error sintáctico: $($errors[0].Message)" }
Write-Host ">>> SINTAXIS POWERSHELL 5.1: PASS" -ForegroundColor Green

# 2. Ejecutar suite completa (103 pruebas)
npx tsx scripts/test-phase-3.5-extractor.ts

# 3. Ejecutar verificación de solo lectura contra Google Cloud Resource Manager
.\scripts\verify-ruleset-attachment-project.ps1
```

Al finalizar, revisar la salida en consola y el archivo generado:
`poc/catalyst-3-2/reports/firestore-extraction-3.5.0.12/ruleset-attachment-project-verification.json`

---

### 7. DICTAMEN OFICIAL

```text
PROJECT_NUMBER_MAPPING_DIAGNOSIS — PENDING WINDOWS VERIFICATION
```
