# AUDITORÍA RUNTIME DE PERMISOS NTFS ACL EN DIRECTORIO SINTÉTICO
## VIGORCORE ETL — FASE 3.5.0.2

**Fecha de Auditoría:** 10 de noviembre de 2026  
**Sistema de Archivos:** NTFS (Windows 10/11 / Windows Server)  
**Directorio Sintético de Prueba:** `poc/catalyst-3-2/.data/security-selftest/`  
**Directorio de Extracción Definitivo:** `poc/catalyst-3-2/.data/firestore-export/`  
**Estado:** AUDITED & VALIDATED  

---

### 1. OBJETIVO DE SEGURIDAD NTFS

Comprobar operativamente que el entorno local de ejecución Windows del operador es capaz de:
1. Deshabilitar la herencia de permisos del sistema de archivos NTFS sobre el almacenamiento local.
2. Eliminar completamente todas las reglas heredadas (incluidas las reglas por defecto para `BUILTIN\Users`, `Everyone` o usuarios secundarios del sistema).
3. Establecer una lista de control de acceso (DACL) restrictiva y exclusiva con `FullControl` únicamente para la identidad Windows en sesión (`[System.Security.Principal.WindowsIdentity]::GetCurrent().Name`).
4. Realizar pruebas efectivas de escritura, lectura y eliminación de archivos protegidos.
5. Limpiar completamente el entorno de prueba sintético sin dejar rastros.
6. **Preservar el directorio definitivo de extracción (`firestore-export/`) completamente sin crear**, respetando la regla que prohíbe inicializar la infraestructura de almacenamiento antes de la autorización explícita de la Fase 3.5.

---

### 2. PROTOCOLO OPERATIVO DEL DIRECTORIO SINTÉTICO

Para evitar la creación prematura de `poc/catalyst-3-2/.data/firestore-export/`, el script `extract-firestore.ps1` en su modo `-Mode LocalSecurityAudit` utiliza un directorio temporal efímero:
`$syntheticAclDir = Join-Path $pocDir '.data\security-selftest'`

#### Secuencia de Comprobación:
1. **Inspección del directorio definitivo:**  
   Se consulta `Test-Path $resolvedCacheDir`. Se verifica y documenta que dicho directorio permanece **NO CREADO**.
2. **Creación del directorio sintético:**  
   Se crea efímeramente `.data\security-selftest`.
3. **Invocación de SetAccessRuleProtection:**  
   Se ejecuta `$acl.SetAccessRuleProtection($true, $false)`:
   - Primer argumento `$true` (`isProtected`): Corta la propagación de permisos desde el directorio padre.
   - Segundo argumento `$false` (`preserveInheritance`): Purga de inmediato todas las entradas de control de acceso heredadas (eliminando permisos a grupos generales).
4. **Asignación de Control Exclusivo:**  
   Se construye una regla explícita:
   ```powershell
   $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
   $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
       $currentUser,
       'FullControl',
       'ContainerInherit,ObjectInherit',
       'None',
       'Allow'
   )
   $acl.ResetAccessRule($rule)
   Set-Acl -Path $syntheticAclDir -AclObject $acl
   ```
5. **Verificación de Get-Acl:**  
   Se re-inspecciona el directorio con `Get-Acl`:
   - Se valida que `AreAccessRulesProtected` sea `$true`.
   - Se valida que no exista ninguna regla asignada a `Everyone`, `Todos`, `Users`, `Usuarios` o `BUILTIN\Users`.
6. **Prueba de E/S Local:**  
   Se escribe un payload de prueba (`VIGORCORE_ACL_TEST`), se lee de vuelta comparando longitud y contenido, y se elimina el archivo de prueba.
7. **Limpieza y Destrucción:**  
   En el bloque `finally`, se ejecuta `Remove-Item -Path $syntheticAclDir -Recurse -Force`. Se confirma mediante `Test-Path` que el directorio sintético fue totalmente eliminado.

---

### 3. RESULTADOS DE LA AUDITORÍA DE ACL

| Control | Parámetro Inspeccionado | Resultado Obtenido | Estado |
|---|---|---|---|
| **ACL-01** | Estado de `firestore-export` definitivo | No existe en disco (preservado sin crear) | **PASS** |
| **ACL-02** | Creación y protección sintética | `SetAccessRuleProtection($true, $false)` aplicado | **PASS** |
| **ACL-03** | `AreAccessRulesProtected` en Get-Acl | `$true` (herencia formalmente desactivada) | **PASS** |
| **ACL-04** | Exclusión de `BUILTIN\Users` / `Everyone` | Reglas genéricas purgadas de la DACL | **PASS** |
| **ACL-05** | Identidad con acceso concedido | Únicamente `WindowsIdentity::GetCurrent().Name` | **PASS** |
| **ACL-06** | E/S bajo contexto restringido | Escritura, lectura y borrado 100% operativos | **PASS** |
| **ACL-07** | Limpieza final y destrucción | `.data\security-selftest` eliminado en `finally` | **PASS** |

---

### 4. RECOMENDACIONES DE ENDURECIMIENTO COMPLEMENTARIO

1. **Volúmenes FAT32 / exFAT:**  
   Si el repositorio se encontrara ubicado en un volumen formateado con FAT32 o exFAT (como unidades USB o particiones compartidas), las llamadas a `Set-Acl` generarán una advertencia no bloqueante (`[WARN] No se pudieron ajustar ACLs avanzadas`). En este caso, la confidencialidad de los documentos continúa garantizada por la capa criptográfica obligatoria de **Windows DPAPI** (`DataProtectionScope.CurrentUser`), la cual opera a nivel de bytes cifrados independientemente del sistema de archivos subyacente.
2. **Sesiones Multi-Usuario:**  
   Al eliminar `BUILTIN\Users`, otros usuarios locales que inicien sesión en la misma estación Windows recibirán un error nativo `Access Denied` del kernel al intentar listar o entrar en el directorio del caché local.

---

### 5. CONCLUSIÓN

La capacidad del sistema operativo Windows para aislar el directorio del caché mediante ACLs nativas de NTFS y supresión de herencia ha quedado plenamente comprobada en tiempo de ejecución, manteniendo la integridad del entorno y sin crear prematuramente los directorios definitivos de extracción.
