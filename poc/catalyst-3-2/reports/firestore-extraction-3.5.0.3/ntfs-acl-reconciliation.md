# CONCILIACIÓN Y SEPARACIÓN DE CONTEXTOS DE ACL NTFS
## VIGORCORE ETL — FASE 3.5.0.3

**Fecha:** 11 de noviembre de 2026  
**Sistema de Archivos:** NTFS (Windows 10/11 / Windows Server)  
**Estado:** RECONCILED & ISOLATED  

---

### 1. SEPARACIÓN ESTRICTA DE LOS TRES CONTEXTOS DE ACL

En auditorías anteriores existía el riesgo conceptual de extrapolar el éxito de la prueba de ACL en el directorio sintético hacia el directorio definitivo. La Fase 3.5.0.3 separa formal e independientemente los tres contextos:

```
[ CONTEXTO 1: DIRECTORIO SINTÉTICO ]
  Ruta: .data/security-selftest/
  Propósito: Prueba activa y destructiva de capacidades del kernel NTFS.
  Comportamiento: Crea, aplica SetAccessRuleProtection, prueba E/S y destruye.
  Alcance de conclusión: Demuestra que el usuario Windows TIENE PRIVILEGIOS para deshabilitar herencia.

[ CONTEXTO 2: DIRECTORIO DEFINITIVO ]
  Ruta: .data/firestore-export/
  Propósito: Almacenamiento a largo plazo de documentos cifrados.
  Comportamiento: Auditoría 100% PASIVA (Get-Acl). NO MODIFICA ACL automáticamente.
  Alcance de conclusión: Evalúa si los archivos reales están expuestos o protegidos.

[ CONTEXTO 3: SUBDIRECTORIO DE CONTROL ]
  Ruta: .data/firestore-export/control/
  Propósito: Almacenamiento exclusivo de preflight-token.bin, checkpoints y mapeos.
  Comportamiento: Auditoría 100% PASIVA (Get-Acl). Confinamiento criptográfico específico.
  Alcance de conclusión: Evalúa la DACL específica sobre los artefactos de control.
```

**Regla de Oro:** Los resultados de un contexto jamás se transfieren a otro. Que el directorio sintético pase su prueba no implica que el directorio definitivo tenga las ACLs adecuadas.

---

### 2. MATRIZ COMPARATIVA DE REGLAS Y EVALUACIÓN

| Parámetro Evaluado | Contexto 1 (Sintético) | Contexto 2 (Definitivo) | Contexto 3 (Control) |
|---|---|---|---|
| **Ruta Local** | `.data\security-selftest` | `.data\firestore-export` | `.data\firestore-export\control` |
| **Tipo de Acción** | Activa (Crea, Aplica ACL, Borra) | Pasiva (Solo lectura con `Get-Acl`) | Pasiva (Solo lectura con `Get-Acl`) |
| **Herencia Esperada** | Deshabilitada (`AreAccessRulesProtected: $true`) | Deshabilitada (`AreAccessRulesProtected: $true`) | Deshabilitada (`AreAccessRulesProtected: $true`) |
| **Grupos Genéricos (`Users`/`Everyone`)** | Purgados (0 entradas) | Purgados (0 entradas) | Purgados (0 entradas) |
| **Usuario con Acceso** | `WindowsIdentity::GetCurrent()` (`FullControl`) | `WindowsIdentity::GetCurrent()` (`FullControl`) | `WindowsIdentity::GetCurrent()` (`FullControl`) |
| **Modificación Automática en Auditoría** | SÍ (para comprobar capacidad del SO) | **NO (Estrictamente prohibido)** | **NO (Estrictamente prohibido)** |

---

### 3. PROCEDIMIENTO DE REMEDIACIÓN MANUAL DE ACL PARA EL OPERADOR

Si durante la ejecución de `extract-firestore.ps1 -Mode LocalSecurityAudit` se detecta la advertencia:
`[ACCION REQUERIDA]: Ejecutar endurecimiento de ACL sobre .data\firestore-export`

El operador debe aplicar manualmente el siguiente procedimiento PowerShell en Windows para corregir las ACLs sin alterar el contenido de los archivos:

```powershell
# 1. Ubicarse en el directorio de la POC
cd poc\catalyst-3-2

# 2. Definir rutas objetivo
$definitiveCache = [System.IO.Path]::GetFullPath('.data\firestore-export')
$controlCache    = [System.IO.Path]::GetFullPath('.data\firestore-export\control')

# 3. Obtener identidad Windows del usuario actual
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

# 4. Endurecer directorio definitivo (Deshabilitar herencia y purgar BUILTIN\Users)
$aclDef = Get-Acl -LiteralPath $definitiveCache
$aclDef.SetAccessRuleProtection($true, $false) # $true: protegido de herencia, $false: purgar reglas heredadas
$ruleDef = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $currentUser,
    'FullControl',
    'ContainerInherit,ObjectInherit',
    'None',
    'Allow'
)
$aclDef.ResetAccessRule($ruleDef)
Set-Acl -LiteralPath $definitiveCache -AclObject $aclDef

# 5. Endurecer subdirectorio control (si existe)
if (Test-Path -LiteralPath $controlCache) {
    $aclCtrl = Get-Acl -LiteralPath $controlCache
    $aclCtrl.SetAccessRuleProtection($true, $false)
    $ruleCtrl = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $currentUser,
        'FullControl',
        'ContainerInherit,ObjectInherit',
        'None',
        'Allow'
    )
    $aclCtrl.ResetAccessRule($ruleCtrl)
    Set-Acl -LiteralPath $controlCache -AclObject $aclCtrl
}

Write-Host '[ENDURECIMIENTO ACL]: Permisos restringidos exitosamente a ' $currentUser -ForegroundColor Green
```

---

### 4. JUSTIFICACIÓN DE LA NO MODIFICACIÓN AUTOMÁTICA RECURSIVA

Modificar automáticamente y de forma recursiva los permisos del sistema de archivos sobre datos preexistentes durante un modo de auditoría de solo lectura viola el principio de mínima perturbación:
- Podría alterar sellos de tiempo de metadatos del sistema de archivos.
- Podría generar bloqueos de concurrencia si otro proceso legítimo mantiene un descriptor abierto.
- La responsabilidad de corregir permisos de almacenamiento en reposo pertenece al operador de la estación de trabajo bajo un comando consciente y verificado.

---

### 5. CONCLUSIÓN

La separación rigurosa de los tres contextos de ACL garantiza que el estado de protección del almacenamiento real sea auditado objetivamente, sin falsos positivos derivados de pruebas efímeras en carpetas sintéticas.
