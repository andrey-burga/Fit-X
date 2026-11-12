# VIGORCORE ETL — ESPECIFICACIÓN DEL PROCEDIMIENTO DE ROLLBACK NATIVO MEDIANTE SDDL
**Fase:** 3.5.0.6  
**Fecha:** 2026-11-11  
**Módulo:** `poc/catalyst-3-2/scripts/restore-firestore-cache-acl.ps1` (v1.0.0)  
**Objetivo:** Erradicar la dependencia rota de `Import-Clixml` (bloqueo H-ACL-03) e implementar restauración idempotente de ACLs mediante SDDL puro en Windows PowerShell 5.1.  

---

## 1. RESOLUCIÓN DEL BLOQUEO H-ACL-03 (`Import-Clixml`)

En la Fase 3.5.0.5 se demostró que en Windows PowerShell 5.1, `Import-Clixml` deserializa los objetos de seguridad como `Deserialized.System.Security.AccessControl.DirectorySecurity`, lo que provoca que el cmdlet `Set-Acl` aborte con una excepción terminal de incompatibilidad de tipos (`Cannot convert Deserialized... to ObjectSecurity`).

### 1.1 Sustitución por SDDL Nativo
El descriptor de seguridad en formato SDDL (Security Descriptor Definition Language) es una cadena de texto estandarizada por Microsoft que codifica íntegramente:
- **`O:`** Propietario (*Owner SID*).
- **`G:`** Grupo primario (*Group SID*).
- **`D:`** Discretionary Access Control List (DACL), flags de herencia (`AI` auto-heredado vs `P` protegido) y cada una de las ACEs con sus derechos y calificadores.

Al almacenar el SDDL en un archivo de texto con codificación UTF-8 sin BOM y hash SHA-256 de control, la restauración se realiza invocando:
```powershell
$sddl = [System.IO.File]::ReadAllText($backupPath, (New-Object System.Text.UTF8Encoding($false)))
$acl = Get-Acl -Path $targetDir
$acl.SetSecurityDescriptorSddlForm($sddl)
Set-Acl -Path $targetDir -AclObject $acl
```
Este método es 100% nativo, no utiliza deserialización Clixml y funciona en cualquier versión de PowerShell (5.1 a 7.x).

---

## 2. MODOS DE RECUPERACIÓN Y ORDEN ESTRICTO

El script `restore-firestore-cache-acl.ps1` admite tres objetivos mediante el parámetro `-Target`:

### 2.1 `-Target All` (Reversión de Ambas Etapas)
- **Orden Obligatorio:** **Raíz primero, luego Control.**
  1. Si se restaurara `control/` primero a su estado heredado mientras la raíz sigue endurecida, `control/` heredaría inmediatamente la DACL restringida de la raíz, impidiendo una reversión limpia.
  2. Al restaurar la raíz en primer lugar (`root-original-sddl.txt`), la raíz recupera su flag `D:AI` y sus reglas heredadas del proyecto.
  3. A continuación se restaura `control/` (`control-original-sddl.txt`), retornando ambos directorios al estado base exacto.

### 2.2 `-Target ControlOnly` (Reversión si solo se ejecutó Etapa 1)
- Si por cualquier motivo la Etapa 1 fue ejecutada pero la Etapa 2 no procedió, este modo restaura exclusivamente `control/` utilizando `control-original-sddl.txt`, sin alterar la raíz.

### 2.3 `-Target RootOnly`
- Restaura únicamente la raíz si se requiriera de forma puntual, verificando previamente los hashes SHA-256.

---

## 3. SALVAGUARDAS Y VERIFICACIONES DE SEGURIDAD

1. **Inmutabilidad de Respaldos:** El script de reversión es estrictamente de lectura sobre los archivos `.txt` y `.sha256`; **jamás sobrescribe los respaldos**.
2. **Validación Criptográfica Previa:** Antes de aplicar cualquier cambio, calcula el SHA-256 del contenido leído y lo contrasta con el archivo `.sha256`. Si hay discrepancia, aborta con `ERROR CRITICO: Corrupcion de hash`.
3. **Verificación Post-Restauración:** Tras aplicar el SDDL con `Set-Acl`, ejecuta un `(Get-Acl $path).Sddl` pasivo y comprueba que sea idéntico al SDDL esperado. Si difiere, arroja `FALLA DE ROLLBACK`.
4. **Confirmación Obligatoria:** Requiere el switch `-ConfirmRollback` o el ingreso interactivo de la palabra `"CONFIRMAR_ROLLBACK"`.
