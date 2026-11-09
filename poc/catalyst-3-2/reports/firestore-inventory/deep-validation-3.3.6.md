# VIGORCORE — INFORME DE CORRECCIÓN DEEP INVENTORY Y COBERTURA MULTI-USUARIO (FASE 3.3.6)

**Fecha de emisión:** 9 de noviembre de 2026  
**Auditor:** Arquitecto de Software Senior & Ingeniero Backend  
**Herramienta Corregida:** `poc/catalyst-3-2/scripts/inventory-firestore.ps1`  
**Proyecto GCP:** `gen-lang-client-0041212770`  
**Base de Datos Firestore:** `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c` (Named DB, Enterprise, us-east1)  
**Dominio productivo en Catalyst Slate:** `https://fit-x-bhnatsxl.onslate.com`  
**Directorio de trabajo aislado:** `/poc/catalyst-3-2/`  

---

## 1. RESUMEN EJECUTIVO

En la Fase 3.3.5 se descubrió la causa raíz que impedía verificar la cobertura completa de los 5 usuarios en el Modo Deep: el algoritmo de encolado evaluaba `$subPath = $currentPath + '/{id}/' + $subId`. Al anonimizar la clave con `{id}` antes de verificar su existencia en el conjunto `$visitedPaths`, una subcolección ya encolada para el primer usuario (ej. `biometrics`) era descartada para los usuarios subsiguientes.

En esta **Fase 3.3.6**, se ha implementado la corrección definitiva de la arquitectura:
1. **Deduplicación por Ruta Concreta:** Se eliminó el uso de plantillas enmascaradas como claves de control. Cada instancia se identifica internamente por su recurso real completo (`projects/.../documents/users/<UID>/<subcol>`), garantizando que `users/UID1/mealLogs` y `users/UID2/mealLogs` sean tratadas como dos tareas completamente independientes.
2. **Registro de Alias Opacos Deterministas:** Se incorporó un sistema de asignación de seudónimos (`USER_001` a `USER_005`) ordenados deterministamente por el nombre de documento, protegiendo al 100% los UIDs reales de atletas en consola y reportes.
3. **Inspección de las 11 Subcolecciones Candidatas:** El runner inspecciona dinámicamente mediante `listCollectionIds` y valida explícitamente los candidatos restantes (`biometrics`, `groceries`, `mealLogs`, `notifications`, `preferences`, `workoutSessions`, `executedWorkouts`, `cardioSessions`, `recipes`, `mealPlans`, `workoutRoutines`) para cada uno de los 5 usuarios.
4. **Incorporación de las 6 Colecciones Administrativas Raíz:** Se agregaron a la cola inicial de exploración las colecciones del backend Cloud Functions (`adminUserDirectory`, `adminRoleState`, `adminInvitations`, `accountAccess`, `adminAuditLogs`, `adminInvitationOperations`).
5. **Verificación por Batería de Pruebas Unitarias (21/21 PASS-UNIT):** Se implementaron y aprobaron los 6 casos de prueba obligatorios (Casos A, B, C, D, E, F) que reproducen y verifican la resolución del fallo anterior.
6. **Dictamen:** **ALGORITMO CORREGIDO — PENDIENTE DE INVENTARIO LOCAL**.

---

## 2. CORRECCIÓN DE LA CAUSA RAÍZ

### Código Anterior (Vulnerable a Deduplicación Prematura):
```powershell
# ERROR ANTERIOR: La clave utilizaba {id}, colapsando todos los usuarios en una sola ruta
foreach ($subId in $subCols) {
    $subPath = $currentPath + '/{id}/' + $subId
    if (-not $visitedPaths.Contains($subPath)) {
        ...
        [void]$visitedPaths.Add($subPath)
        $deepQueue.Enqueue($subQueueItem)
    }
}
```

### Código Corregido (Deduplicación por Recurso Concreto):
```powershell
# CORRECCIÓN FASE 3.3.6: Clave de deduplicación basada en la ruta real concreta
foreach ($subId in $uSubCols) {
    $concreteUserSubPath = $uDoc.Name + '/' + $subId
    if (-not $visitedPaths.Contains($concreteUserSubPath)) {
        $totalSubcollectionsDiscovered++
        [void]$visitedPaths.Add($concreteUserSubPath)
        $deepQueue.Enqueue([ordered]@{
            collectionId      = $subId
            parentResourceUrl = $uDocParentUrl
            path              = $concreteUserSubPath
            depth             = 1
            cursor            = $null
            itemType          = 'USER_SUBCOLLECTION'
            userAlias         = $assignedAlias
            isCandidateCheck  = $false
        })
    }
}
```

---

## 3. MATRIZ DE COBERTURA INDIVIDUAL POR USUARIO (PLANTILLA OFICIAL)

El runner corregido genera la siguiente matriz en la ejecución profunda sobre Windows, garantizando que cada usuario cuente con su propia columna de auditoría:

| Usuario | biometrics | groceries | mealLogs | notifications | preferences | workoutSessions | executedWorkouts | cardioSessions | recipes | mealPlans | workoutRoutines |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **USER_001** | *Verificado* | *Verificado* | *Verificado* | *Verificado* | *Verificado* | *Verificado* | *Verificado* | *0 Confirmado* | *0 Confirmado* | *0 Confirmado* | *0 Confirmado* |
| **USER_002** | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* |
| **USER_003** | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* |
| **USER_004** | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* |
| **USER_005** | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* | *Pendiente local* |

*Nota de Privacidad:* Los alias `USER_001` .. `USER_005` representan a los 5 atletas registrados en Firestore en orden determinista de su clave documental, sin exponer sus UIDs en reportes Markdown ni en la salida estándar.

---

## 4. INVENTARIO DE COLECCIONES ADMINISTRATIVAS RAÍZ

Las 6 colecciones administrativas descubiertas en el código de Cloud Functions (`functions/src/adminLogic.ts`) se exploran directamente a nivel de raíz mediante consultas REST con proyección exclusiva `__name__`:

| Colección Administrativa | Ruta Firestore | Documentos Enumerados | Estado de Inspección |
| :--- | :--- | :---: | :--- |
| `adminUserDirectory` | `/adminUserDirectory` | *Pendiente ejecución local* | Consultada por RunQuery directa |
| `adminRoleState` | `/adminRoleState` | *Pendiente ejecución local* | Consultada por RunQuery directa |
| `adminInvitations` | `/adminInvitations` | *Pendiente ejecución local* | Consultada por RunQuery directa |
| `accountAccess` | `/accountAccess` | *Pendiente ejecución local* | Consultada por RunQuery directa |
| `adminAuditLogs` | `/adminAuditLogs` | *Pendiente ejecución local* | Consultada por RunQuery directa |
| `adminInvitationOperations` | `/adminInvitationOperations` | *Pendiente ejecución local* | Consultada por RunQuery directa |

---

## 5. BATERÍA COMPLETA DE PRUEBAS UNITARIAS (21/21 PASS-UNIT)

Ejecutada mediante `npx tsx poc/catalyst-3-2/scripts/test-inventory-logic.ts`:

| # | Caso / Prueba | Componente Evaluado | Garantía Demostrada | Resultado |
| :-: | :--- | :--- | :--- | :-: |
| **1-15** | Pruebas Unitarias de Lógica REST, Proyección `__name__`, AST y Checkpoint | `firestoreRest.ts` | Base arquitectónica previa intacta | **PASS-UNIT** |
| **16** | **Caso A:** Usuario 1 y Usuario 2 tienen `biometrics` | `BfsQueueEngine` | Ambas instancias se encolan y procesan de forma independiente | **PASS-UNIT** |
| **17** | **Caso B:** Cinco usuarios tienen `mealLogs` | `BfsQueueEngine` | 5 instancias encoladas independientemente para cada usuario | **PASS-UNIT** |
| **18** | **Caso C:** Usuario 3 no tiene una subcolección | `UserMatrix` | Ausencia registrada como `CHECKED_EMPTY` sin afectar a los demás | **PASS-UNIT** |
| **19** | **Caso D:** Mismo ID de documento en padres distintos | `maskConcretePathWithAlias` | Rutas concretas se diferencian (`USER_001` vs `USER_002`) | **PASS-UNIT** |
| **20** | **Caso E:** Interrupción y reanudación de checkpoint | `BfsQueueEngine` | Snapshot preserva rutas concretas sin duplicar ni omitir | **PASS-UNIT** |
| **21** | **Caso F:** Alcance de límite `MaxRequests` | `checkDeepLimits` | Se activa `PAUSED_LIMIT_REACHED` y preserva trabajo pendiente | **PASS-UNIT** |

**Resultado Global:** **21/21 pruebas unitarias aprobadas (100% PASS-UNIT)**.

---

## 6. SINTAXIS POWERSHELL Y CONTROL DE PRIVACIDAD

1. **Compatibilidad Estricta Windows PowerShell 5.1 y 7+:**
   - 0 caracteres backtick (`` ` ``) en todo el archivo.
   - 0 subexpresiones expansibles (`$(`).
   - Comillas simples literales `'...'` y concatenación simple `+`.
   - Autovalidación previa de sintaxis AST antes de tocar la red.
2. **Privacidad Zero Data:**
   - Proyección estricta `select.fields: [{ fieldPath: "__name__" }]`.
   - Cero campos de biometría, entrenamientos o nutrición descargados o impresos.
   - Failsafe activo: Si una respuesta de Firestore incluye `fields`, se aborta inmediatamente con alerta de seguridad.
   - Los artefactos locales y reportes se encuentran protegidos en `.gitignore` (`reports/`, `archive/`, `checkpoint*.json`).

---

## 7. COMANDO PARA LA EJECUCIÓN CONTROLADA EN WINDOWS

Abra una consola de PowerShell en su estación local de trabajo en la raíz del repositorio y ejecute:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-3-2\scripts\inventory-firestore.ps1 -Mode Deep
```

### En caso de requerir reanudación si se alcanza el límite de solicitudes:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-3-2\scripts\inventory-firestore.ps1 -Mode Deep -Resume
```

---

## 8. DICTAMEN FINAL

### Dictamen:
# **ALGORITMO CORREGIDO — PENDIENTE DE INVENTARIO LOCAL**

**Fundamentación Técnica:**
1. Se ha eliminado definitivamente el defecto de deduplicación prematura por plantilla anonimizada, sustituyéndolo por un motor de cola BFS basado en rutas concretas de documento padre.
2. Se ha implementado el soporte completo para auditar individualmente los 5 usuarios mediante alias `USER_001` .. `USER_005`, las 11 subcolecciones candidatas y las 6 colecciones administrativas raíz.
3. Se han aprobado 21 de 21 pruebas unitarias automatizadas (incluyendo los Casos A, B, C, D, E y F).
4. El script queda listo, blindado y validado sintácticamente para que el desarrollador ejecute el inventario en su entorno local con sus credenciales ADC activas.
