# VIGORCORE — PROCEDIMIENTO OFICIAL DE CONSULTA DE REGLAS REMOTAS
## FIREBASE SECURITY RULES MANAGEMENT API (SOLO LECTURA)

**Fase:** 3.5.0.7  
**Servicio GCP:** Firebase Security Rules API (`firebaserules.googleapis.com/v1`)  
**Proyecto:** `gen-lang-client-0041212770`  
**Base de Datos Nombrada:** `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`  
**Objetivo:** Obtener el snapshot fidedigno de las reglas de seguridad en vivo sin usar comandos inexistentes de Firebase CLI.

---

### 1. ANTECEDENTES TÉCNICOS

1. El comando `firebase firestore:rules:get` **no existe** en la CLI de Firebase.
2. Firebase CLI (`firebase-tools`) no proporciona un comando para descargar o inspeccionar reglas directamente desde la terminal.
3. Para consultar las reglas reales desplegadas en la nube, la vía oficial y autorizada es la **Firebase Rules Management API** de Google Cloud.
4. Este procedimiento es de **estricta solo lectura (HTTP GET)**. No crea rulesets, no publica releases, no modifica IAM ni altera la facturación.

---

### 2. ARQUITECTURA DE REGLAS EN FIRESTORE ENTERPRISE (MULTI-DATABASE)

En Firestore Enterprise, un proyecto puede contener múltiples bases de datos. Las reglas de seguridad se gestionan como **releases** asociadas a cada base de datos:

- **Release de base de datos por defecto:**  
  `projects/gen-lang-client-0041212770/releases/cloud.firestore`
- **Release de base de datos nombrada:**  
  `projects/gen-lang-client-0041212770/releases/cloud.firestore/databases/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`  
  (o bien `projects/gen-lang-client-0041212770/releases/cloud.firestore.ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`).

> **REGLA DE ORO:** Las reglas asignadas a `(default)` **NO protegen ni aplican** a la base nombrada `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c`. Nunca asuma que consultar `cloud.firestore` equivale a auditar la base nombrada.

---

### 3. PROCEDIMIENTO OPERATIVO EN WINDOWS POWERSHELL 5.1

Se ha provisto el script listo para ejecutar:
`poc/catalyst-3-2/scripts/query-remote-rules.ps1`

#### Ejecución Estándar (Inspección en Pantalla):
```powershell
cd poc/catalyst-3-2
.\scripts\query-remote-rules.ps1
```

#### Ejecución con Captura de Snapshot y Hash SHA-256:
```powershell
cd poc/catalyst-3-2
.\scripts\query-remote-rules.ps1 -SaveSnapshot -OutputPath "./firestore.rules.remote-live-snapshot.rules"
```

El script genera automáticamente:
- `firestore.rules.remote-live-snapshot.rules`: Archivo de texto codificado en UTF-8 sin BOM con el contenido exacto de las reglas en vivo.
- `firestore.rules.remote-live-snapshot.rules.sha256`: Hash SHA-256 para validación de integridad inmutable.

---

### 4. PROCEDIMIENTO ALTERNATIVO DIRECTO (REST API / POWERSHELL O CURL)

Si el operador desea ejecutar la consulta de manera manual sin scripts auxiliares:

#### En PowerShell 5.1:
```powershell
# 1. Obtener token de acceso
$token = (gcloud auth print-access-token).Trim()
$headers = @{
    "Authorization" = "Bearer $token"
    "Accept"        = "application/json"
}
$project = "gen-lang-client-0041212770"
$dbName  = "ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c"

# 2. Consultar releases
$releases = Invoke-RestMethod -Uri "https://firebaserules.googleapis.com/v1/projects/$project/releases" -Headers $headers -Method Get

# 3. Identificar release de la base nombrada
$rel = $releases.releases | Where-Object { $_.name -like "*$dbName*" -or $_.name -like "*cloud.firestore*" } | Select-Object -First 1

if ($rel -and $rel.rulesetName) {
    Write-Host "Release: $($rel.name)" -ForegroundColor Green
    Write-Host "Ruleset: $($rel.rulesetName)" -ForegroundColor Green

    # 4. Obtener contenido del ruleset
    $ruleset = Invoke-RestMethod -Uri "https://firebaserules.googleapis.com/v1/$($rel.rulesetName)" -Headers $headers -Method Get
    $content = $ruleset.source.files[0].content

    # 5. Guardar snapshot
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText("$PWD/firestore.rules.remote-live-snapshot.rules", $content, $utf8NoBom)
    Write-Host "Snapshot guardado exitosamente." -ForegroundColor Green
}
```

#### En Bash / cURL:
```bash
# 1. Obtener token
TOKEN=$(gcloud auth print-access-token)
PROJECT="gen-lang-client-0041212770"

# 2. Listar releases
curl -s -X GET \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json" \
  "https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases" | jq .

# 3. Obtener el ruleset referenciado
# Reemplazar {RULESET_ID} con el identificador retornado en el paso anterior
curl -s -X GET \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json" \
  "https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets/{RULESET_ID}" | jq -r '.source.files[0].content' > firestore.rules.remote-live-snapshot.rules
```

---

### 5. MATRIZ DE RESPUESTAS POSIBLES Y ACCIÓN OPERATIVA

| Respuesta de la API | Diagnóstico Técnico | Acción Requerida |
|---|---|---|
| HTTP 200 con release específica de la base nombrada | La base nombrada tiene un ruleset desplegado y activo. | Guardar snapshot, calcular SHA-256 y comparar con `firestore.rules` del repositorio. |
| HTTP 200 con solo release de `(default)` | La base nombrada no tiene release explícita; usa default o hereda comportamiento del proyecto. | Documentar que no hay ruleset específico para la base nombrada; el despliegue de 7D será su primera activación. |
| HTTP 200 con `releases: []` vacía | Nunca se han desplegado reglas mediante Firebase Rules en este proyecto. | Documentar ausencia de reglas previas en la nube. |
| HTTP 403 Forbidden | El token ADC carece del rol `roles/firebaserules.viewer` o el proyecto no tiene habilitada la API. | Solicitar al propietario de GCP la asignación del rol de visor de reglas sobre la Service Account u operador. |
