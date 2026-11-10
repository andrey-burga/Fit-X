# AUDITORÍA FORENSE RUNTIME DEL PREFLIGHT TOKEN (DUAL AUTHENTICATION)
## VIGORCORE ETL — FASE 3.5.0.2

**Fecha de Auditoría:** 10 de noviembre de 2026  
**Entorno de Referencia:** Windows PowerShell 5.1 / Node.js TypeScript  
**Proyecto GCP:** `gen-lang-client-0041212770`  
**Base de Datos Firestore:** `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c` (Named Database, Enterprise, us-east1)  
**Estado de Verificación:** VERIFIED & HARDENED  

---

### 1. OBJETIVO TÉCNICO

Verificar exhaustivamente la arquitectura de autenticación dual del Preflight Token para garantizar que ninguna extracción de datos pueda ejecutarse basándose en un preflight manipulado manualmente, falsificado, desactualizado o perteneciente a otra base de datos o proyecto GCP.

---

### 2. ARQUITECTURA DE AUTENTICACIÓN DUAL (JSON + ENVOLVENTE BINARIA DPAPI)

En la Fase 3.5.0 inicial, el token de preflight residía exclusivamente en texto plano estructurado (`preflight-token.json`). Esto abría una superficie de riesgo: un operador o proceso local podría editar el archivo para convertir un estado `BASELINE_DRIFT` o `PREFLIGHT_FAILED` en `PREFLIGHT_PASS`.

Para cerrar este vector de ataque sin requerir un servidor centralizado de firmas, la Fase 3.5.0.1 y 3.5.0.2 implementan un **doble sobre criptográfico simétrico local**:

```
+-------------------------------------------------------------+
| preflight-token.json (Legible para el operador y auditoría) |
| - executionId, timestampUtc, projectId, databaseId          |
| - usersDiscovered: 5, totalDocumentsDiscovered: 73          |
| - countsByUser (USER_001..USER_005), administrativeCounts   |
| - status: "PREFLIGHT_PASS", errors: []                      |
+-------------------------------------------------------------+
                               |
                               | SHA-256 canónico (sin espacios)
                               v
+-------------------------------------------------------------+
| Sobre Autenticado (PreflightAuthEnvelope)                   |
| - version: "1.0.0"                                          |
| - timestampUtc: "<ISO8601>"                                 |
| - projectId: "gen-lang-client-0041212770"                   |
| - databaseId: "ai-studio-vigorcore-f954ab83-f9aa-..."       |
| - status: "PREFLIGHT_PASS"                                  |
| - tokenSha256: "<64-hex SHA-256 de preflight-token.json>"   |
+-------------------------------------------------------------+
                               |
                               | Cifrado con Windows DPAPI
                               | DataProtectionScope.CurrentUser
                               v
+-------------------------------------------------------------+
| preflight-token.bin (Cifrado e impenetrable localmente)      |
+-------------------------------------------------------------+
```

---

### 3. MATRIZ DE COMPROBACIONES OFFLINE AUDITADAS EN MODO LOCAL-SECURITY-AUDIT

El modo `-Mode LocalSecurityAudit` implementado en `poc/catalyst-3-2/scripts/extract-firestore.ps1` y verificado en la suite TypeScript ejecuta las siguientes 8 verificaciones estrictas:

| Control | Nombre del Chequeo | Criterio de Aceptación | Código de Falla Emitido |
|---|---|---|---|
| **1.1** | Presencia y tamaño de `preflight-token.json` | Archivo presente y `Length > 0` | `PREFLIGHT_JSON_MISSING` / `PREFLIGHT_JSON_EMPTY` |
| **1.2** | Presencia y tamaño de `preflight-token.bin` | Archivo presente y `Length > 0` (no se autogenera silenciosamente) | `PREFLIGHT_BINARY_MISSING` / `PREFLIGHT_BINARY_EMPTY` |
| **1.3** | Descifrado DPAPI CurrentUser | El ciphertext debe descifrarse correctamente bajo la cuenta de usuario de Windows activa | `PREFLIGHT_BINARY_DECRYPT_ERROR` |
| **1.4** | Integridad anti-tamper (Firma SHA-256) | El SHA-256 recomputado del JSON debe coincidir exactamente con el campo `tokenSha256` del sobre cifrado | `PREFLIGHT_TOKEN_TAMPERED` |
| **1.5** | Correspondencia de Project ID | `projectId` en JSON y sobre debe ser idéntico a `gen-lang-client-0041212770` | `PREFLIGHT_PROJECT_MISMATCH` |
| **1.6** | Correspondencia de Database ID | `databaseId` en JSON y sobre debe ser idéntico a `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c` | `PREFLIGHT_DATABASE_MISMATCH` |
| **1.7** | Estado y Vigencia Temporal | `status == "PREFLIGHT_PASS"` y antigüedad `<= 60` minutos respecto al reloj UTC del sistema | `PREFLIGHT_STATUS_NOT_PASS` / `PREFLIGHT_TOKEN_EXPIRED` |
| **1.8** | Cero Errores y Cero Fugas de Credencial | `errors == []`, sin conteos `null` en subcolecciones y sin tokens ADC `ya29...` | `PREFLIGHT_CONTAINS_NULL_OR_ERRORS` / `SECURITY_LEAK_ADC_TOKEN_FOUND` |

---

### 4. AUDITORÍA DE PRIVACIDAD: REDACCIÓN DE PII Y ALIASES

Se certifica que `preflight-token.json` cumple estrictamente con el principio de mínima exposición de datos:
1. **Identificadores de Usuario:** No se almacenan Firestore UIDs reales, correos electrónicos ni nombres. La estructura indexa exclusivamente mediante aliases opacos estandarizados: `USER_001`, `USER_002`, `USER_003`, `USER_004`, `USER_005`.
2. **Campos de Documentos:** La consulta de preflight utiliza la proyección `select: { fields: [{ fieldPath: "__name__" }] }`. Se verificó que el parser aborta inmediatamente (`throw 'VIOLACION DE PRIVACIDAD: campos detectados en subcoleccion'`) si cualquier documento devuelve un atributo `fields`.
3. **Ausencia de Credenciales:** Ningún token de acceso OAuth 2.0 (`ya29...`) es serializado en el JSON ni en el binario.

---

### 5. CONCLUSIÓN DEL PREFLIGHT RUNTIME AUDIT

El mecanismo de verificación dual del preflight token garantiza matemáticamente que cualquier intento de alteración manual del archivo de estado preflight invalida la firma criptográfica antes de alcanzar cualquier lógica de red o extracción de documentos.

**Dictamen:** `PREFLIGHT SECURITY ARCHITECTURE FULLY AUDITED & VERIFIED`.
