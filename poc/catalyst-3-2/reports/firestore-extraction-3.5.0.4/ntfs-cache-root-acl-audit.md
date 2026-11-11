# VIGORCORE ETL — AUDITORÍA Y ENDURECIMIENTO DE ACL NTFS DEL DIRECTORIO RAÍZ DE CACHÉ
**Fase:** 3.5.0.4  
**Fecha:** 2026-11-11  
**Directorio Auditado:** `.data/firestore-export/`  
**Script Creado:** `poc/catalyst-3-2/scripts/secure-firestore-cache-root.ps1`  
**Estado:** AUDITED & HARDENING SCRIPT READY  

---

## 1. ANTECEDENTES Y HALLAZGOS EN WINDOWS

Durante la auditoría runtime de la Fase 3.5.0.3 en Windows:
- El subdirectorio `.data/firestore-export/control/` demostró una ACL correctamente protegida (herencia desactivada, acceso exclusivo para el operador actual y administradores).
- Sin embargo, el directorio raíz contenedor `.data/firestore-export/`:
  - Se encontraba presente previamente con 0 archivos y 1 subdirectorio (`control/`).
  - Mantenía la **herencia de permisos NTFS activa** procedente del directorio padre del proyecto.
  - Como consecuencia de la herencia activa, el grupo estándar `BUILTIN\Users` conservaba permisos implícitos de lectura y listado sobre `.data/firestore-export/`.

Esto representaba un incumplimiento de la directriz de seguridad de datos forenses de VigorCore, que exige que **todo el árbol de caché local esté aislado y sea inaccesible para cualquier usuario distinto de la cuenta que ejecuta el proceso ETL**.

---

## 2. ESPECIFICACIÓN DEL ENDURECIMIENTO

Se diseñó e implementó el script `secure-firestore-cache-root.ps1` con las siguientes salvaguardas:

### 2.1 Verificaciones Previas de Seguridad
1. Comprueba la existencia del directorio `.data/firestore-export/`.
2. Inspecciona el contenido: **0 archivos permitidos**.
3. Inspecciona los subdirectorios: **únicamente `control/` permitido**. Si existiera cualquier otro elemento, el script aborta inmediatamente para evitar daños a datos.

### 2.2 Respaldo Doble de la ACL Previa
Antes de modificar cualquier permiso, el script extrae y almacena la configuración original en dos formatos dentro de `control/`:
- `cache-root-acl-backup.xml`: Objeto CLIXML completo exportado mediante `Export-Clixml`.
- `cache-root-sddl-backup.txt`: Cadena SDDL pura para restauración nativa con `SetSecurityDescriptorSddlForm`.

### 2.3 Deshabilitación de Herencia y Principio de Privilegio Mínimo
- Invoca `$acl.SetAccessRuleProtection($true, $false)`:
  - Primer parámetro `$true` (isProtected): desactiva la herencia de permisos del directorio padre.
  - Segundo parámetro `$false` (preserveInheritance): **elimina** todas las ACEs heredadas (incluyendo `BUILTIN\Users`).
- Configura permisos explícitos de `FullControl` con propagación `ContainerInherit, ObjectInherit` únicamente para:
  1. `[System.Security.Principal.WindowsIdentity]::GetCurrent().Name` (Usuario operador en ejecución).
  2. `NT AUTHORITY\SYSTEM` (Servicios centrales del sistema operativo).
  3. `BUILTIN\Administrators` (Administradores locales del equipo).

### 2.4 Aplicación No Recursiva
La llamada se ejecuta mediante:
```powershell
[System.IO.Directory]::SetAccessControl($resolvedCacheRoot, $targetAcl)
```
Sin parámetros de recursión, garantizando que el subdirectorio `control/` y sus archivos internos no sufran ninguna modificación.

### 2.5 Prueba Funcional de Sondeo (Probe I/O)
Crea un archivo temporal `.probe-<guid>.tmp`, escribe datos de prueba, los lee para verificar integridad de acceso y elimina el archivo inmediatamente.
