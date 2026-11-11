# GUÍA OPERATIVA DE REMEDIACIÓN Y VERIFICACIÓN EN WINDOWS
## VIGORCORE ETL — FASE 3.5.0.3

**Destinatario:** Operador del Sistema / Desarrollador Windows  
**Entorno Requerido:** Windows PowerShell 5.1 / PowerShell 7+ con ADC autenticado  
**Ámbito de Trabajo:** `poc/catalyst-3-2/`  
**Estado:** INSTRUCTIONS VERIFIED  

---

### 1. OBJETIVO DEL PROCEDIMIENTO

Guiar al operador en la estación Windows para:
1. Migrar con total seguridad el ciphertext de `preflight-token.bin` desde `reports/` hacia `.data/firestore-export/control/` mediante `migrate-preflight-binary.ps1`.
2. Generar un nuevo token de preflight fresco (`-Mode Preflight`) para subsanar la condición de vencimiento (antigüedad de 300.6 min).
3. Ejecutar la auditoría final `-Mode LocalSecurityAudit` para obtener la certificación de seguridad completa.

---

### 2. PASO 1: MIGRACIÓN SEGURA DEL PREFLIGHT BINARIO

Abra una consola de Windows PowerShell 5.1 como usuario estándar (el mismo con el que inició sesión) y ejecute:

```powershell
# 1. Navegar a la POC
cd poc\catalyst-3-2

# 2. Ejecutar el script seguro de migración
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\migrate-preflight-binary.ps1
```

#### Salida Esperada en Consola:
```text
========================================================================
 VIGORCORE -- FASE 3.5.0.3: MIGRACION SEGURA DEL PREFLIGHT BINARIO       
========================================================================
 - Directorio POC:  ...poc\catalyst-3-2
 - Archivo origen:  ...reports\firestore-extraction-3.5\preflight-token.bin
 - Destino seguro:  ...data\firestore-export\control\preflight-token.bin
------------------------------------------------------------------------
 [1/12] Verificando existencia del binario antiguo en reports/... OK
 [2/12] Verificando tamaño de archivo origen... OK (534 bytes)
 [3/12] Calculando hash SHA-256 inicial del ciphertext... OK
 [4/12] Comprobando que no exista archivo de destino previo... OK (Destino libre)
 [5/12] Creando subdirectorio control si es necesario... OK
 [6/12] Aplicando ACL restrictiva al subdirectorio control... OK (Herencia removida y acceso exclusivo)
 [7/12] Comprobando capacidad de E/S en subdirectorio control... OK
 [8/12] Moviendo ciphertext a destino... OK
 [9/12] Verificando archivo de destino... OK (534 bytes)
 [10/12] Verificando coincidencia exacta de SHA-256... OK (SHA-256 idéntico)
 [11/12] Verificando remoción de binario en reports/... OK (Removido de reports/)
 [12/12] Certificando migración... OK
========================================================================
 MIGRACION EXITOSA -- PREFLIGHT BINARIO REUBICADO CORRECTAMENTE         
========================================================================
```

---

### 3. PASO 2: RENOVACIÓN EXPLÍCITA DEL PREFLIGHT TOKEN

Dado que el preflight anterior tiene más de 300 minutos de antigüedad (umbral máximo permitido: 60 minutos), se debe ejecutar una nueva verificación estructural contra Firestore REST v1 para emitir un token vigente:

```powershell
# Ejecutar el Preflight estructural (solo proyecciones __name__, 0 descargas de datos)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\extract-firestore.ps1 -Mode Preflight
```

#### Verificaciones Clave:
- Usuarios descubiertos: **5**
- Documentos secundarios: **68**
- Total de documentos: **73** (100% Coincidente con baseline histórico)
- Errores reportados: **0**
- Estado emitido: **PREFLIGHT_PASS**
- Destino del JSON: `reports\firestore-extraction-3.5\preflight-token.json`
- Destino del BIN: `.data\firestore-export\control\preflight-token.bin`

---

### 4. PASO 3: AUDITORÍA RUNTIME FINAL DE SEGURIDAD LOCAL

Una vez migrado el binario y renovado el token de preflight, ejecute:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\extract-firestore.ps1 -Mode LocalSecurityAudit
```

#### Salida Esperada en Consola:
- **[1/3] AUDITORIA DE INTEGRIDAD Y AUTENTICIDAD DEL PREFLIGHT TOKEN:**
  - `preflight-token.json en reports/... OK`
  - `preflight-token.bin en control/... OK (en control/)`
  - `Descifrando sobre binario autenticado con DPAPI CurrentUser... OK`
  - `Firma SHA-256... OK`
  - `ProjectId... OK (gen-lang-client-0041212770)`
  - `DatabaseId... OK (ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c)`
  - `Estado... OK (PREFLIGHT_PASS)`
  - `Frescura temporal (< 60 min)... OK`
  - `Conteos íntegros y cero errores... OK`
  - `Cero tokens ADC... OK`
- **[2/3] CONCILIACION DEL DIRECTORIO DEFINITIVO Y AUDITORIA DE ACL:**
  - `Estado del directorio definitivo firestore-export... DIRECTORY_PRESENT_WITH_FILES` (o `EMPTY`)
  - `ACL del directorio definitivo (Get-Acl pasivo)... OK`
  - `ACL del subdirectorio control (Get-Acl pasivo)... OK`
  - `Directorio sintético de prueba... OK (Herencia removida y limpio)`
- **[3/3] AUDITORIA DE EXCLUSION GIT Y ESCANEO DE BINARIOS:**
  - `.data/ y *.bin excluidos en .gitignore... OK`
  - `Escaneo de binarios en la POC... OK (Cero binarios fuera de .data/)`
- **DICTAMEN FINAL:**
  - `ESTADO: REMEDIATION IMPLEMENTED — WINDOWS VERIFICATION PENDING` (o `LOCAL SECURITY VERIFIED — EXTRACTION REVIEW READY`).

---

### 5. CONCLUSIÓN

Siguiendo esta secuencia estricta, la estación Windows quedará completamente remediada, conciliada y certificada sin comprometer la seguridad ni exponer secretos.
