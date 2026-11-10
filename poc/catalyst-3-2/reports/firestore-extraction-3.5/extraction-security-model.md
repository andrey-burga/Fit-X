# VIGORCORE — FASE 3.5.0: MODELO DE SEGURIDAD Y PRIVACIDAD DEL EXTRACTOR

## 1. PRINCIPIO DE AISLAMIENTO Y PRIVACIDAD CERO-FUGA

El extractor implementa un modelo de seguridad multicapa para garantizar que ninguna información confidencial de los atletas (nombres, correos, UIDs reales de Firebase, métricas corporales, pesos o historiales de entrenamiento) quede expuesta en texto plano, archivos versionados o registros de consola.

---

## 2. CIFRADO EN REPOSO MEDIANTE WINDOWS DPAPI (CURRENTUSER)

El almacenamiento del caché local (`poc/catalyst-3-2/.data/firestore-export/`) se encuentra completamente cifrado mediante la API de Protección de Datos de Windows (DPAPI) a través de `.NET` (`System.Security.Cryptography.ProtectedData`).

### Configuración Técnica
- **Alcance Criptográfico:** `DataProtectionScope.CurrentUser`.
- **Derivación de Clave:** Administrada por el subsistema LSA de Windows vinculada a la credencial de inicio de sesión del usuario Windows ejecutor.
- **Sin Dependencias Externas:** Reutiliza ensamblados estándar de .NET Framework 4.5+ integrados en Windows PowerShell 5.1 y PowerShell 7+.

### Prueba de Ida y Vuelta Preventiva
Antes de autorizar la extracción, el script ejecuta obligatoriamente:
1. Generación de un vector de prueba sintético en memoria (`VIGORCORE_DPAPI_SELFTEST_<GUID>`).
2. Cifrado mediante `ProtectedData::Protect`.
3. Descifrado en memoria mediante `ProtectedData::Unprotect`.
4. Comparación byte a byte.
5. Si la prueba falla o lanza una excepción criptográfica, el extractor se detiene inmediatamente con estado `DPAPI_ERROR`.

### Límites del Modelo de Amenazas de DPAPI CurrentUser
> **ADVERTENCIA FORMAL DE SEGURIDAD:**
> DPAPI con alcance `CurrentUser` protege los datos contra otros usuarios locales de la máquina y contra la inspección física del disco (o robo de la estación si la cuenta no está autenticada).
> Sin embargo, **NO protege frente a procesos maliciosos que se ejecuten dentro de la misma sesión o bajo la misma cuenta de usuario de Windows**, ya que cualquier proceso ejecutado bajo dicho usuario posee la capacidad de invocar `Unprotect`.

---

## 3. PROTECCIÓN Y EXCLUSIÓN DEL DIRECTORIO `.data/`

1. **Exclusión de Git:** Se ha actualizado `poc/catalyst-3-2/.gitignore` incorporando explícitamente:
   ```gitignore
   .data/
   *.bin
   ```
   El script verifica esta exclusión en cada ejecución antes de procesar solicitudes.
2. **Restricción de Permisos del Sistema de Archivos (ACL):**
   - En sistemas Windows, el script aplica reglas de control de acceso (`Set-Acl`) que otorgan `FullControl` exclusivamente a la identidad del usuario actual (`[System.Security.Principal.WindowsIdentity]::GetCurrent().Name`) e inhibe permisos para cuentas genéricas o compartidas.

---

## 4. CICLO DE VIDA DE CREDENCIALES ADC

- **Captura:** El token de autenticación se obtiene exclusivamente mediante el subproceso en memoria:
  `gcloud auth application-default print-access-token`
- **Volatilidad:** El token se almacena únicamente en la variable en memoria `$token` y se transmite en el encabezado `Authorization: Bearer <token>`.
- **Prohibición Absoluta de Persistencia:** Queda terminantemente prohibido almacenar el token en archivos `.env`, logs de ejecución, checkpoints, variables persistentes del sistema o mensajes de error.

---

## 5. SANITIZACIÓN ESTRICTA DE ERRORES

Las respuestas de error de Firestore REST v1 pueden contener detalles internos o rutas con identificadores reales. La función `New-SanitizedError` aplica filtros regex antes de cualquier salida:
- Tokens de acceso (`ya29.[a-zA-Z0-9_-]+`) -> `[REDACTED_ACCESS_TOKEN]`.
- Correos electrónicos (`*@*.*`) -> `[REDACTED_EMAIL]`.
- Cabeceras Bearer -> `Bearer [REDACTED]`.
- UIDs reales en rutas Firestore -> `projects/.../databases/.../documents/users/[REDACTED_UID]`.
- Categorización de errores en taxonomías sanitizadas: `AUTH_ERROR`, `PERMISSION_DENIED`, `BILLING_DISABLED`, `QUOTA_EXCEEDED`, `DPAPI_ERROR`, `SERIALIZATION_ERROR`, `BASELINE_DRIFT`, `HTTP_ERROR`.

---

## 6. ANONIMIZACIÓN DE ARTEFACTOS PÚBLICOS

Los artefactos legibles que quedan en disco (`manifest-audit.json`, `preflight-token.json`, `verify-report.json`) únicamente contienen:
- Alias abstractos: `USER_001` a `USER_005`.
- Conteos numéricos agregados por colección y por usuario.
- Tamaños agregados en bytes.
- Sellos de tiempo UTC.
- Veredictos de consistencia.
- **Cero datos personales, cero UIDs reales y cero hashes individuales de documentos.**
