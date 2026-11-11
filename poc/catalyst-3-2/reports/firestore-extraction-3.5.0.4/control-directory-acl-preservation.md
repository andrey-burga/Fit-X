# VIGORCORE ETL — PRESERVACIÓN DE ACL Y NO-REGRESIÓN EN EL SUBDIRECTORIO CONTROL
**Fase:** 3.5.0.4  
**Fecha:** 2026-11-11  
**Subdirectorio Analizado:** `.data/firestore-export/control/`  
**Estado:** ACL PRESERVED & INDEPENDENT  

---

## 1. OBJETIVO DE LA VERIFICACIÓN DE CONTENCIÓN

En la Fase 3.5.0.3, el subdirectorio `.data/firestore-export/control/` fue creado y protegido para alojar el token de autenticación cifrado `preflight-token.bin`.
La auditoría de dicha fase confirmó:
- `control/` tiene `AreAccessRulesProtected = True`.
- Cero ACEs para `BUILTIN\Users`.
- Acceso exclusivo concedido al usuario operador de Windows.

Al aplicar un nuevo endurecimiento de ACL sobre el directorio raíz contenedor `.data/firestore-export/`, existía el riesgo potencial de que una operación recursiva mal formulada (como `icacls /reset /t`) sobrescribiera la ACL especializada de `control/` o alterara la herencia.

---

## 2. MECANISMO DE PROTECCIÓN Y NO-REGRESIÓN

### 2.1 Aislamiento de Objeto Directorio
En Windows, cuando un subdirectorio ya posee la herencia deshabilitada (`AreAccessRulesProtected = $true` o flag `P` en SDDL `D:P...`), las modificaciones de ACL aplicadas sobre el directorio padre **no se propagan automáticamente** al subdirectorio a menos que se fuerce explícitamente una propagación recursiva destructiva (`/reset` o `SetAccessRuleProtection($false, ...)`).

El script `secure-firestore-cache-root.ps1` respeta rigurosamente esta frontera:
1. Lee y almacena el SDDL exacto de `control/` antes de realizar cualquier cambio en el padre:
   ```powershell
   $initialControlAcl = Get-Acl -Path $controlDir
   $initialControlSddl = $initialControlAcl.Sddl
   ```
2. Aplica la nueva ACL sobre el directorio raíz únicamente con:
   ```powershell
   [System.IO.Directory]::SetAccessControl($resolvedCacheRoot, $targetAcl)
   ```
3. Reinspecciona el SDDL de `control/` post-aplicación:
   ```powershell
   $postControlAcl = Get-Acl -Path $controlDir
   $postControlSddl = $postControlAcl.Sddl

   if ($postControlSddl -ne $initialControlSddl) {
       throw 'FALLA DE CONTENCION: La ACL del subdirectorio control\ no se mantuvo identica.'
   }
   ```

### 2.2 Prueba Automatizada de Regresión
La prueba automatizada `T-3504-13` en `test-phase-3.5-extractor.ts` valida que el SDDL de `control/` sea idéntico antes y después del endurecimiento de la raíz, garantizando que los respaldos criptográficos y el token binario `preflight-token.bin` permanezcan permanentemente seguros e inalterados.
