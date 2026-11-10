# VIGORCORE — FASE 3.5.0.1: AUDITORÍA DE PERMISOS WINDOWS ACL Y EXCLUSIÓN GIT

## 1. OBJETIVO DEL CONTROL DE ACCESO LOCAL

Garantizar que el directorio destinado a alojar el caché de extracción (`poc/catalyst-3-2/.data/firestore-export/`) no sea accesible por cuentas no autorizadas en el sistema operativo local y quede completamente excluido del sistema de control de versiones Git.

---

## 2. EXCLUSIÓN EN GIT (`.gitignore`)

### Configuración en `poc/catalyst-3-2/.gitignore`:
```gitignore
node_modules/
dist/
coverage/
.env*
!.env.example
*.log
reports/
archive/
checkpoint*.json
.data/
*.bin
```

### Comprobación Estática y Dinámica:
1. **Comprobación Estática:** Se verificó la presencia literal de las directivas `.data/` y `*.bin` en el `.gitignore` de la POC.
2. **Comprobación Dinámica en Script:** Antes de inicializar la extracción, `extract-firestore.ps1` lee `$pocGitignorePath` y valida mediante expresión regular (`\.data/|\.data\\`). Si la directiva no está presente, aborta fail-closed con:
   `BLOQUEO: El directorio .data/ no está excluido en .gitignore. Riesgo de fuga a repositorio.`

---

## 3. MODELO DE CONTROL DE ACCESO WINDOWS (ACL / NTFS)

El extractor aplica reglas estrictas del sistema de archivos mediante .NET `System.Security.AccessControl`:

```powershell
$acl = Get-Acl -Path $resolvedCacheDir

# 1. Deshabilitar herencia de permisos de directorios superiores
#    isProtected = $true (bloquea herencia), preserveInheritance = $false (elimina reglas heredadas)
$acl.SetAccessRuleProtection($true, $false)

# 2. Otorgar FullControl exclusivamente a la identidad del usuario actual
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $currentUser,
    'FullControl',
    'ContainerInherit,ObjectInherit',
    'None',
    'Allow'
)

# 3. Reemplazar todas las reglas existentes con la regla exclusiva
$acl.ResetAccessRule($rule)
Set-Acl -Path $resolvedCacheDir -AclObject $acl
```

### Propiedades de Seguridad de esta Configuración:
- **Remoción de Herencia (`SetAccessRuleProtection($true, $false)`):** Impide que grupos genéricos como `Users`, `Authenticated Users` o `Everyone` hereden permisos de lectura desde la raíz de la unidad `C:\` o del perfil de usuario.
- **Acceso Exclusivo:** Solo la cuenta que ejecuta el proceso posee permisos NTFS sobre los archivos `.bin` y el directorio.
- **Tratamiento de Excepciones:** Si el comando `Set-Acl` falla (por ejemplo, si el volumen no es NTFS o la cuenta carece de privilegios para alterar la DACL), el script emite una advertencia formal y se apoya en el cifrado DPAPI como segunda línea de defensa infranqueable.

---

## 4. DISTINCIÓN: COMPROBACIONES ESTÁTICAS VS WINDOWS LOCAL

| Aspecto Evaluado | Entorno de Validación | Nivel Asignado |
| :--- | :--- | :---: |
| **Exclusión de `.data/` y `*.bin` en `.gitignore`** | Entorno de Desarrollo / Linux | `PASS-STATIC` |
| **Lógica de verificación de Git en código PowerShell** | Suite Automatizada TypeScript | `PASS-UNIT` |
| **Simulación de bloqueo si falta `.gitignore`** | Suite Automatizada TypeScript | `PASS-MOCK` |
| **Ejecución real de `Set-Acl` y `SetAccessRuleProtection`** | Estación Windows del Operador | `PASS-LOCAL-WINDOWS` |
| **Ausencia de documentos en texto plano en `.data/`** | Estación Windows del Operador | `PASS-LOCAL-WINDOWS` |
