# VIGORCORE — FASE 3.5.0.1: VALIDACIÓN CRIPTOGRÁFICA LOCAL DPAPI (CURRENTUSER)

## 1. OBJETIVO Y CONTEXTO

La Fase 3.5.0.1 exige verificar de forma fehaciente que el mecanismo de protección en reposo del extractor forense no dependa de abstracciones simuladas (mocks), sino que implemente un procedimiento de auto-prueba criptográfica real ejecutado directamente sobre el subsistema **Windows Data Protection API (DPAPI)** con alcance `CurrentUser` (`System.Security.Cryptography.ProtectedData`).

---

## 2. PROTOCOLO OPERACIONAL DE 11 PASOS (`-Mode CryptoSelfTest`)

El script `poc/catalyst-3-2/scripts/extract-firestore.ps1` implementa el modo autónomo `-Mode CryptoSelfTest` que ejecuta secuencialmente los 11 controles estipulados:

```
[1/11] Comprobación de Ensamblado System.Security (.NET 4.5+ / Windows PowerShell 5.1/7+)
  ↓
[2/11] Generación de Payload Sintético Aleatorio (GUID v4 + Sello de Ticks UTC)
  ↓
[3/11] Cifrado Criptográfico con DataProtectionScope::CurrentUser
  ↓
[4/11] Escritura Atómica en Archivo Temporal Protegido (.tmp)
  ↓
[5/11] Lectura del Ciphertext desde Disco Local
  ↓
[6/11] Descifrado bajo la misma Identidad de Usuario Windows Autenticada
  ↓
[7/11] Comparación Byte a Byte (Verificación de Identidad Estricta al 100%)
  ↓
[8/11] Inspección Anti-Fuga: Verificación de que el Ciphertext no Contiene Texto Plano
  ↓
[9/11] Prueba Adversarial Anti-Tampering: Alteración de Bits y Rechazo Fail-Closed
  ↓
[10/11] Eliminación Segura y Limpieza de Archivos Temporales
  ↓
[11/11] Emisión de Dictamen Sanitizado Cero-Secreto
```

### Detalles de Cada Paso:

1. **Paso 1 (Disponibilidad de Ensamblado):** Carga `System.Security` y comprueba la disponibilidad de `[System.Security.Cryptography.ProtectedData]`. Falla con `DPAPI_ERROR` si no está disponible en el entorno.
2. **Paso 2 (Payload Aleatorio):** Genera una cadena no predecible `VIGORCORE_DPAPI_VERIFY_<GUID>_<TICKS>` convertida a `byte[]` UTF-8.
3. **Paso 3 (Cifrado DPAPI):** Invoca `[System.Security.Cryptography.ProtectedData]::Protect($plainBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)`.
4. **Paso 4 (Persistencia Temporal):** Escribe el arreglo de bytes cifrados en `poc/catalyst-3-2/.data/firestore-export/selftest-<GUID>.tmp`.
5. **Paso 5 (Lectura de Disco):** Lee mediante `[System.IO.File]::ReadAllBytes` y valida que la longitud leída coincida con la generada.
6. **Paso 6 (Descifrado):** Invoca `[System.Security.Cryptography.ProtectedData]::Unprotect($readBackBytes, $null, $scope)`.
7. **Paso 7 (Comparación Byte a Byte):** Itera todos los índices para validar coincidencia exacta (`$plainBytes[$i] -eq $decryptedBytes[$i]`).
8. **Paso 8 (Cero Fuga en Ciphertext):** Decodifica el ciphertext a texto y ejecuta `$cipherString.Contains($testGuid)`. Si el GUID aleatorio aparece en texto legible dentro del ciphertext, aborta con `DPAPI_SECURITY_LEAK`.
9. **Paso 9 (Resistencia a Manipulación - Anti-Tampering):** Invierte el último byte del ciphertext (`$tampered[-1] ^= 0xFF`) e intenta ejecutar `Unprotect`. Comprueba que el subsistema lance una `CryptographicException` y lo capture como manipulación detectada. Si el descifrado tuviera éxito con un ciphertext alterado, aborta con falla de integridad.
10. **Paso 10 (Limpieza):** Elimina el archivo temporal `.tmp` con `Remove-Item -Force`.
11. **Paso 11 (Veredicto):** Reporta `DPAPI_LOCAL_SECURITY_VERIFIED` sin exponer claves ni payloads en consola.

---

## 3. MODELO DE AMENAZAS Y LÍMITES DE SEGURIDAD

| Vector de Amenaza | ¿Protegido por DPAPI CurrentUser? | Justificación Técnica |
| :--- | :---: | :--- |
| **Robo físico de disco / Inspección offline** | **SÍ** | La clave maestra de DPAPI está vinculada al hash de la credencial de login y al LSA de Windows; sin la contraseña del usuario, los datos no son descifrables. |
| **Acceso por otro usuario local de Windows** | **SÍ** | `DataProtectionScope.CurrentUser` restringe el descifrado al SID del usuario que lo cifró. Otra cuenta local recibirá `CryptographicException: Access denied`. |
| **Fuga accidental a repositorios Git** | **SÍ** | `.data/` y `*.bin` están excluidos en `.gitignore`; además, los archivos `.bin` solo son legibles en la máquina del operador. |
| **Proceso malicioso bajo la misma cuenta activa** | **NO** | Cualquier ejecutable o script que corra en el contexto de seguridad del mismo usuario puede invocar `ProtectedData::Unprotect`. Este límite inherente exige restringir las herramientas ejecutadas en la estación del operador. |

---

## 4. COMANDO POWERSHELL PARA EJECUCIÓN EN WINDOWS

Para ejecutar la verificación criptográfica real DPAPI en la estación Windows del operador:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-3-2\scripts\extract-firestore.ps1 -Mode CryptoSelfTest
```

**Resultado Esperado en Consola:**
```
========================================================================
 RESULTADO DEL SELF-TEST CRIPTOGRAFICO REAL DPAPI
========================================================================
 - Proveedor:        Windows DPAPI (CurrentUser)
 - Integridad:       11/11 Pasos Aprobados (100% PASS-LOCAL-WINDOWS)
 - Fuga de Texto:    CERO (Validado ausente)
 - Anti-Tampering:   VALIDADO (Ciphertext alterado rechazado)
 - Veredicto:        DPAPI_LOCAL_SECURITY_VERIFIED
========================================================================
```
