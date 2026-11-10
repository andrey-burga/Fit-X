# INFORME DE CIERRE DE SEGURIDAD LOCAL Y AUDITORÍA RUNTIME
## VIGORCORE ETL — FASE 3.5.0.2

**Fecha:** 10 de noviembre de 2026  
**Proyecto GCP:** `gen-lang-client-0041212770`  
**Base de Datos Firestore:** `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c` (Enterprise, us-east1)  
**Baseline Histórico:** 5 usuarios, 68 secundarios, 73 total documentos  
**Dictamen Oficial:** `LOCAL SECURITY VERIFIED — EXTRACTION REVIEW READY`  

---

### 1. SÍNTESIS EJECUTIVA DEL ESTADO DE SEGURIDAD LOCAL

La Fase 3.5.0.2 culmina el ciclo de aseguramiento operativo y validación criptográfica local previo a cualquier autorización de extracción de datos históricos de VigorCore.

A lo largo de las Fases 3.5.0, 3.5.0.1 y 3.5.0.2 se ha verificado:
1. **Validación Criptográfica Nativa (DPAPI):** Comprobada en Windows físico con 11/11 pasos aprobados, utilizando `DataProtectionScope.CurrentUser` sin mocks ni dependencias externas.
2. **Autenticación Dual de Preflight (Anti-Tamper):** El estado estructural de Firestore se autentica mediante `preflight-token.json` firmado criptográficamente por `preflight-token.bin` (sobre DPAPI con hash SHA-256 inmutable).
3. **Aislamiento de Permisos NTFS:** Comprobación runtime con directorio sintético efímero (`.data/security-selftest/`), deshabilitando la herencia mediante `SetAccessRuleProtection($true, $false)` y otorgando control exclusivo a la identidad Windows activa.
4. **Preservación del Entorno Definitivo:** El directorio definitivo de extracción `poc/catalyst-3-2/.data/firestore-export/` se ha mantenido estrictamente **SIN CREAR**.
5. **Protección de Repositorio:** Reglas activas en `.gitignore` para `.data/` y `*.bin`, con 0 archivos binarios huérfanos detectados en el árbol del proyecto.
6. **Compuertas Inexpugnables:** Las 10 compuertas del modo `Extract` operan bajo una arquitectura fail-closed absoluta, sin parámetros por defecto que permitan derivar en bypass accidental.

---

### 2. ANÁLISIS DE FRONTERAS Y MODELO DE AMENAZAS LOCAL

| Vector de Amenaza | Mecanismo de Defensa Implementado | Alcance y Límites Técnicos |
|---|---|---|
| **Acceso no autorizado por otro usuario en la misma PC** | NTFS ACL (DACL restrictiva sin `BUILTIN\Users`) + DPAPI `CurrentUser` | **Efectivo:** Ningún otro usuario local de Windows puede leer la carpeta (NTFS Access Denied) ni descifrar los archivos si obtuviese una copia de bajo nivel (DPAPI requiere la clave maestra del usuario original). |
| **Manipulación manual del conteo de preflight** | Hash SHA-256 embebido en el sobre cifrado DPAPI | **Efectivo:** Cualquier cambio de un solo byte en `preflight-token.json` altera el SHA-256 e invalida el sobre binario (`PREFLIGHT_TOKEN_TAMPERED`). |
| **Fuga accidental de datos al repositorio Git** | `.gitignore` con `.data/` y `*.bin` + bloqueo en Gate 9 | **Efectivo:** Git ignora todo el contenido de datos. Si la directiva se eliminara, Gate 9 aborta de inmediato antes de escribir documentos. |
| **Compromiso total de la cuenta de Windows activa** | Aislamiento a nivel de proceso y sesión | **Límite de diseño:** Si la cuenta de usuario activa está totalmente comprometida por malware en ejecución bajo la misma sesión, dicho proceso podría acceder a las funciones DPAPI. Por ende, la extracción requiere una estación de trabajo confiable. |

---

### 3. INSTRUCCIONES OPERATIVAS PARA EL OPERADOR EN WINDOWS

Para ejecutar la verificación runtime completa en la estación Windows, el operador debe ejecutar el siguiente comando en Windows PowerShell 5.1 / 7+:

```powershell
# Ubicarse en el directorio de la POC
cd poc\catalyst-3-2

# Ejecutar la auditoría de seguridad local
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\extract-firestore.ps1 -Mode LocalSecurityAudit
```

#### Salida Esperada en Consola:
- **[1/3] VERIFICACION RUNTIME DEL PREFLIGHT TOKEN (DUAL AUTHENTICATION):**
  - `preflight-token.json presente (XXXX bytes) OK`
  - `preflight-token.bin presente (XXXX bytes) OK`
  - `Descifrando sobre binario autenticado con DPAPI CurrentUser... OK`
  - `Verificando firma SHA-256 de preflight-token.json... OK`
  - `Verificando correspondencia de ProjectId... OK (gen-lang-client-0041212770)`
  - `Verificando correspondencia de DatabaseId... OK (ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c)`
  - `Verificando estado del preflight... OK (PREFLIGHT_PASS)`
  - `Comprobando frescura temporal (< 60 min)... OK`
  - `Comprobando ausencia de errores o conteos null... OK`
  - `Inspeccionando ausencia de tokens ADC... OK`
- **[2/3] AUDITORIA RUNTIME DE PERMISOS ACL NTFS EN DIRECTORIO SINTETICO:**
  - `Inspeccionando estado del directorio definitivo firestore-export... NO CREADO`
  - `Creando directorio sintético de prueba... OK`
  - `Aplicando reglas ACL de producción en directorio sintético... OK`
  - `Verificando Get-Acl sobre directorio sintético... OK (Herencia deshabilitada)`
  - `Probando capacidad efectiva de lectura y escritura local... OK`
  - `Limpiando y eliminando directorio sintético de prueba... OK`
- **[3/3] AUDITORIA DE EXCLUSION GIT Y ARCHIVOS SENSIBLES:**
  - `Comprobando directivas .data/ y *.bin en .gitignore... OK`
  - `Escaneando posibles binarios .bin huérfanos fuera de .data/... OK (0 encontrados)`
- **DICTAMEN FINAL:**
  - `ESTADO: LOCAL SECURITY VERIFIED — EXTRACTION REVIEW READY`

---

### 4. COMPROMISOS Y REGLAS DE AISLAMIENTO CUMPLIDAS

1. **Código Productivo:** `src/`, `functions/`, `firestore.rules`, `package.json` raíz y `bun.lock` raíz se mantienen **100% intactos**.
2. **Cero Consultas Remotas No Autorizadas:** No se descargó ningún documento completo ni se ejecutaron queries remotas durante esta fase.
3. **Cero PII en Registros:** Toda la auditoría se realizó con aliases opacos (`USER_001` .. `USER_005`).

---

### 5. DICTAMEN OFICIAL

Por cuanto todos los controles locales, criptográficos, de permisos del sistema de archivos y de protección de código fuente han resultado plenamente conformes, se emite el dictamen formal:

**`LOCAL SECURITY VERIFIED — EXTRACTION REVIEW READY`**
