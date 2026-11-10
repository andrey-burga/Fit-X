# VIGORCORE — FASE 3.5.0: INFORME DE PREPARACIÓN DEL EXTRACTOR (READINESS REPORT)

## 1. ESTADO DE COMPATIBILIDAD CON WINDOWS POWERSHELL 5.1 Y 7+

- **Sintaxis PowerShell:** 100% plana, sin backticks de continuación de línea (`` ` ``) y sin expresiones `$()` complejas dentro de comillas dobles.
- **Validación Automática del Parser:** El script incorpora al inicio la auto-validación de su propio archivo fuente mediante `[System.Management.Automation.Language.Parser]::ParseFile`. Cualquier error de token detiene el proceso antes de tocar red o credenciales.
- **Compatibilidad de Plataforma:** Diseñado para funcionar nativamente en Windows PowerShell 5.1 (estándar en Windows 10/11) y en PowerShell 7+ sin requerir módulos externos como `Az` o `GoogleCloud`.

---

## 2. AUDITORÍA DE LO PROBADO VS LO SIMULADO

Para mantener total transparencia técnica y honestidad forense:

### A. Lo que se ha probado realmente en esta fase
1. **Lógica de Construcción y Manipulación de Sobres:** Probada al 100% en TypeScript (`buildDocumentEnvelope`).
2. **Validación de Integridad SHA-256:** Probada en memoria con datos sintéticos y canónicos.
3. **Mapeo de Rutas Concretas y Prevención de Colisiones:** Probado con documentos que comparten el mismo ID (`preferences/default`) en usuarios diferentes.
4. **Sanitización de Errores y Regex:** Probado con cadenas de error reales de Google Cloud conteniendo tokens `ya29`, correos electrónicos y rutas completas de Firestore.
5. **Algoritmo de Detección de Baseline Drift:** Probado ante conteos exactos de 73 y ante desviaciones a 74 o fallas parciales.
6. **Mecanismo de Consistencia Observada:** Probado ante modificaciones de `updateTime`, adición de nuevos documentos y eliminación de documentos durante la ventana observada.
7. **Parser Syntax Check:** Probado mediante `validate-script-syntax.ps1`.
8. **Compilación y Linting:** `compile_applet` exitoso y `lint_applet` (`tsc --noEmit`) con cero errores en todo el espacio de trabajo.

### B. Lo que está simulado en pruebas automatizadas
1. **Respuestas REST de Firestore:** Las llamadas a `runQuery` y `GET` se simularon mediante fixtures sintéticos representativos del esquema de VigorCore.
2. **DPAPI en Entornos Linux de Desarrollo:** La suite de TypeScript utiliza un proveedor mock (`MockDpapiProvider`) que simula la encriptación AES-256-GCM y los controles de integridad de DPAPI. En la estación Windows real, el script ejecutará las llamadas nativas a `System.Security.Cryptography.ProtectedData`.

### C. Lo que depende de la estación local Windows del operador
1. **Cifrado Real DPAPI:** La ejecución de `[System.Security.Cryptography.ProtectedData]::Protect` con el alcance `CurrentUser`.
2. **Credenciales ADC Locales:** La ejecución exitosa de `gcloud auth application-default print-access-token` para obtener el token temporal en memoria.
3. **Restricción de Permisos ACL:** La aplicación de directivas de seguridad locales en `poc/catalyst-3-2/.data/firestore-export/`.

### D. Lo que depende de Firestore remoto
1. **Disponibilidad de la Red y Latencia:** La respuesta de Google Cloud APIs desde la conexión a Internet del operador.
2. **Cuota y Facturación:** La verificación de que la base de datos `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c` no tenga cuotas de lectura excedidas.

### E. Lo que permanece sin verificar hasta la ejecución del Preflight
- **El conteo real y actual en Firestore:** Si bien el baseline histórico es de 73 documentos, solo la ejecución real del Preflight por parte del operador confirmará si los datos se han mantenido intactos o si ha ocurrido un `BASELINE_DRIFT`.

---

## 3. COMANDOS OPERACIONALES PARA EL DESARROLLADOR

A continuación se presentan los comandos exactos que el operador debe ejecutar en su estación Windows con PowerShell:

### A. Validar Sintaxis del Script (Parser Check)
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-3-2\scripts\validate-script-syntax.ps1 -TargetScript extract-firestore.ps1
```

### B. Ejecutar Pruebas Sintéticas y Simuladas Locales
```powershell
npx tsx poc/catalyst-3-2/scripts/test-phase-3.5-extractor.ts
```

### C. Ejecutar Preflight (Sin Descargar Documentos Completos)
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-3-2\scripts\extract-firestore.ps1 -Mode Preflight
```
*Este comando consultará únicamente nombres y metadatos de documentos vía `runQuery (__name__)`, verificará los conteos y generará `reports/firestore-extraction-3.5/preflight-token.json`.*

### D. Ejecutar Verify (Auditoría Offline del Caché Tras una Futura Extracción)
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-3-2\scripts\extract-firestore.ps1 -Mode Verify
```
*Este comando no toca la red; valida criptográficamente todos los archivos `.bin` contra el manifiesto y checkpoint.*

### E. Modo Extract (Documentado — NO EJECUTAR EN ESTA FASE)
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-3-2\scripts\extract-firestore.ps1 -Mode Extract
```
*Requiere confirmación expresa del operador, preflight previo exitoso y declaración de ventana de mantenimiento.*

---

## 4. DICTAMEN FINAL DE LA FASE 3.5.0

**`EXTRACTOR IMPLEMENTED — READY FOR LOCAL PREFLIGHT`**
