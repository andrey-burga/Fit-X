# VIGORCORE ETL — DISEÑO TÉCNICO DE ENDURECIMIENTO ACL EN DOS ETAPAS
**Fase:** 3.5.0.6  
**Fecha:** 2026-11-11  
**Módulo:** `poc/catalyst-3-2/scripts/secure-firestore-cache-root.ps1` (v2.0.0)  
**Objetivo:** Eliminar el bloqueo de contención H-ACL-02 desacoplando el aislamiento de `control/` del endurecimiento de la raíz.  

---

## 1. ANTECEDENTES Y RESOLUCIÓN DEL BLOQUEO H-ACL-02

En la Fase 3.5.0.5 se demostró que intentar aplicar `SetAccessRuleProtection($true, $false)` directamente sobre `.data/firestore-export` causaba una excepción fatal de contención (`FALLA DE CONTENCION`), porque el subdirectorio `control/` nació con herencia activa (`AreAccessRulesProtected: False`) y el kernel de NTFS propagaba automáticamente las nuevas ACEs del padre hacia `control/`, mutando su SDDL y haciendo fallar la verificación de igualdad estricta.

### 1.1 Solución Arquitectónica: Desacoplamiento en Dos Etapas

```
[ESTADO INICIAL]
Raíz (.data/firestore-export) -> Herencia Activa (D:AI...)
  └── control/                -> Herencia Activa (D:AI...) [Hereda del padre]

[ETAPA 1: Aislamiento de control/]
  control/ -> SetAccessRuleProtection($true, $true)
              (Deshabilita herencia, copia reglas como explícitas)
              AreAccessRulesProtected = TRUE
  Raíz     -> Sin modificaciones (ACL intacta)

[ETAPA 2: Endurecimiento de la Raíz]
  Pre-requisito: Verifica AreAccessRulesProtected = True en control/
  Raíz     -> SetAccessRuleProtection($true, $false)
              FullControl: CurrentUser, SYSTEM, Administrators
              AreAccessRulesProtected = TRUE
  control/ -> SDDL no muta porque ya tenía herencia deshabilitada
              (Verificación de contención APROBADA)
```

---

## 2. ESPECIFICACIÓN DETALLADA DE LAS ETAPAS

### 2.1 ETAPA 1: AISLAMIENTO EXCLUSIVO DE `control/` (`-Stage 1`)

1. **Inspección Previa de Integridad de Rutas:**
   - Verifica existencia de `.data/firestore-export` y `control/`.
   - Comprueba que ninguno de los dos sea un enlace simbólico ni un punto de reanálisis (*reparse point*):
     `($dirInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0`.
2. **Inspección de ACEs y Orden Canónico:**
   - Inspecciona las ACEs existentes en `control/`.
   - Verifica orden canónico de Windows: Deny explícito antes de Allow explícito, y Deny heredado antes de Allow heredado.
3. **Respaldo Inmutable Doble (SDDL + SHA-256):**
   - Comprueba si existen `root-original-sddl.txt` y `control-original-sddl.txt`. Si no existen, los crea. Si ya existen, **NO los sobrescribe**.
   - Calcula el hash SHA-256 de las cadenas SDDL y lo persiste en `root-original-sddl.sha256` y `control-original-sddl.sha256`.
   - Lee de inmediato los archivos desde disco y valida que su hash recalculado coincida al 100% antes de tocar ningún descriptor.
4. **Confirmación Obligatoria e Independiente:**
   - Requiere el switch `-ConfirmStage1` o solicita por consola interactiva escribir exactamente `"CONFIRMAR_ETAPA_1"`.
5. **Ejecución de Protección:**
   - Invoca `$aclStage1.SetAccessRuleProtection($true, $true)` sobre `control/`.
   - El primer `$true` desvincula la herencia del padre.
   - El segundo `$true` (*preserveInheritance*) convierte todas las ACEs heredadas en explícitas para que ningún usuario autorizado pierda acceso.
   - Aplica mediante `Set-Acl -Path $controlDir -AclObject $aclStage1`.
6. **Verificaciones Post-Etapa 1:**
   - Comprueba `AreAccessRulesProtected = True` en `control/`.
   - Guarda el SDDL resultante en `stage1-control-sddl.txt` y su hash en `stage1-control-sddl.sha256`.
   - Comprueba que la raíz `.data/firestore-export` no haya sufrido ninguna mutación (`$postStage1RootAcl.Sddl -eq $currentRootSddl`).

---

### 2.2 ETAPA 2: ENDURECIMIENTO DE LA RAÍZ (`-Stage 2`)

1. **Validación de Pre-Requisitos de Etapa 1:**
   - Comprueba que `control/` tenga `AreAccessRulesProtected = True`. Si no está protegido, lanza `BLOQUEO: Etapa 2 rechazada`.
   - Valida la integridad SHA-256 del archivo `stage1-control-sddl.txt`.
2. **Inspección de Contenido Estricto:**
   - Verifica que la raíz contenga **0 archivos** y **exactamente 1 subdirectorio** (`control`).
3. **Confirmación Obligatoria Independiente:**
   - Requiere el switch `-ConfirmStage2` o la respuesta interactiva `"CONFIRMAR_ETAPA_2"`.
4. **Construcción y Aplicación de ACL Endurecida:**
   - Invoca `$targetRootAcl.SetAccessRuleProtection($true, $false)`: desvincula herencia y remueve todas las ACEs heredadas.
   - Establece como propietario al usuario en sesión: `$targetRootAcl.SetOwner($currentUserIdentity.User)`.
   - Concede `FullControl` con propagación `ContainerInherit, ObjectInherit` a:
     - Usuario actual (`$currentUserName`).
     - `NT AUTHORITY\SYSTEM`.
     - `BUILTIN\Administrators`.
   - Aplica de forma no recursiva: `[System.IO.Directory]::SetAccessControl($resolvedCacheRoot, $targetRootAcl)`.
5. **Verificación de Seguridad y No-Regresión:**
   - Comprueba `AreAccessRulesProtected = True` en la raíz.
   - Comprueba la ausencia de cualquier ACE asociada a `BUILTIN\Users`, `Everyone` o `Usuarios`.
   - Compara el SDDL de `control/`: verifica que `(Get-Acl $controlDir).Sddl -eq $expectedStage1Sddl`.
   - Ejecuta prueba de sondeo I/O (`.probe-*.tmp`) en la raíz y la elimina.
   - Emite el dictamen: `CACHE_ROOT_HARDENED`.
