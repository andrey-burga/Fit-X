# VIGORCORE — COMPUERTA DE VALIDACIÓN Y CRITERIOS DE ENTRADA A FASE 3.5 (FASE 3.4.1)
## Readiness Gate 3.5: Lista Verificable de Requisitos, Evidencias Exigidas y Criterios de Aprobación

**Fecha de emisión:** 10 de noviembre de 2026  
**Auditor:** Oficial de Aseguramiento de Calidad (QA) & Arquitecto Principal  
**Objetivo de la Compuerta:** Determinar objetivamente si se autoriza o bloquea la ejecución de la Fase 3.5 (Extracción de los 73 documentos de Firestore a almacenamiento local).

---

## 1. ESTADO ACTUAL DE LA COMPUERTA READINESS GATE 3.5

# **ESTADO: CONDICIONALMENTE BLOQUEADA (BLOCKED PENDING EVIDENCE)**

La extracción de datos reales de Firestore (Fase 3.5) **NO DEBE COMENZAR** hasta que los siguientes requisitos obligatorios hayan sido satisfechos y verificados con evidencia reproducible.

---

## 2. LISTA DE REQUISITOS VERIFICABLES (CHECKLIST)

| # | Requisito de Entrada | Estado Actual | Bloqueo Asociado | Evidencia Exigida para Desbloquear |
| :-: | :--- | :---: | :---: | :--- |
| **REQ-01** | **Blindaje Criptográfico de Vinculación JIT:** La vinculación por email en Catalyst debe exigir estrictamente `is_confirmed == true`. | **PENDIENTE** | **F-ID-01 (CRITICAL)** | Actualización formal en `identity-mapping-design.md` y prueba unitaria en `test-identity-guard.ts` validando el rechazo de usuarios sin confirmar. |
| **REQ-02** | **Aislamiento Estricto del Contexto de Autorización:** El backend de Catalyst debe derivar `sourceUid` exclusivamente del token de sesión validado. | **PENDIENTE** | **F-ID-02 (CRITICAL)** | Especificación del middleware `authGuard.ts` garantizando que cualquier parámetro `sourceUid` enviado en body o query string sea ignorado o rechazado. |
| **REQ-03** | **Conservación de Precisión en Tipos Numéricos y Fechas:** El deserializador de Firestore REST debe usar `BigInt` para enteros de 64 bits y preservar nanosegundos en `_sourceTimestampNano`. | **PENDIENTE** | **F-SER-01 (CRITICAL)** | Implementación y prueba unitaria en `test-serialization-precision.ts` validando que enteros $> 2^{53}-1$ y nanosegundos no sufran truncamiento. |
| **REQ-04** | **Especificación del Rollback Seguro:** Reemplazar la eliminación ciega por `_migrationBatchId` por la comprobación de no mutación del atleta (`_userMutatedAfterMigration == false`). | **PENDIENTE** | **F-ROL-01 (CRITICAL)** | Actualización formal en `etl-risk-register.md` y lógica verificada en `test-rollback-safety.ts`. |
| **REQ-05** | **Ventana de Mantenimiento / Consistencia:** Confirmación de que durante los 5 minutos de extracción en la Fase 3.5 la base de Firestore permanecerá en modo de solo lectura. | **PENDIENTE** | **F-CON-01 (HIGH)** | Plan de ventana de mantenimiento acordado con el usuario o verificación de ausencia de escrituras concurrentes. |
| **REQ-06** | **Aislamiento en `.gitignore` Verificado:** El directorio `.data/` y todos sus subdirectorios deben estar rigurosamente ignorados por Git. | **VERIFIED** | Ninguno (Cerrado) | Verificado en `poc/catalyst-3-2/.gitignore` (líneas con `.data/` y `.data/**`). |
| **REQ-07** | **Manejo de Credenciales ADC en Memoria:** El runner de extracción no debe persistir tokens ni claves JSON en el sistema de archivos. | **VERIFIED** | Ninguno (Cerrado) | Validado en la arquitectura del runner PowerShell que almacena `$rawToken` en memoria volátil. |
| **REQ-08** | **Sanitización de Sort Keys:** Validar que los campos `id`, fechas o referencias no contengan caracteres `#` sin sanitizar. | **PENDIENTE** | **F-SCH-02 (HIGH)** | Función `sanitizeKeySegment` añadida al generador de claves compuestas con pruebas de caracteres conflictivos. |
| **REQ-09** | **Prompt Interactivo de Consentimiento Explícito:** El runner de la Fase 3.5 debe requerir la aprobación interactiva del usuario antes de descargar datos. | **PENDIENTE** | **F-PRV-01 (MEDIUM)** | Inclusión obligatoria del bloque `Read-Host "¿Autoriza la descarga local de los 73 documentos? [Y/N]"` en `extract-firestore.ps1`. |

---

## 3. DECISIONES TÉCNICAS PENDIENTES ANTES DE LA FASE 3.5

1. **Aprobación de la Política de Identidad Híbrida Blindada:**  
   Confirmar que el backend de Catalyst usará `req.currentUser.user_id` para autorizar y `USER#<sourceUid>` para particionar en `UserData`.
2. **Definición de Alcance de Tablas Iniciales:**  
   Aprobar que en la Fase 3.7 solo se aprovisionarán las dos tablas requeridas por los datos históricos (`Users` y `UserData`), postergando las tablas administrativas vacías (`AdminDirectory`, `AdminInvitations`, `AuditLogs`) hasta que existan funcionalidades administrativas que las demanden.
3. **Formalización de la Estrategia de Hashes Tripartita:**  
   Aprobar la separación formal entre `Hash_Source`, `Hash_Transformed` y `Hash_Target`.

---

## 4. CRITERIOS DE APROBACIÓN PARA LEVANTAR EL BLOQUEO Y PASAR A FASE 3.5

La compuerta cambiará de **BLOCKED** a **APPROVED FOR PHASE 3.5** cuando:
1. Se hayan cerrado los 4 bloqueos críticos (**F-ID-01, F-ID-02, F-SER-01 y F-ROL-01**) mediante la actualización técnica de los documentos correspondientes.
2. Se cuente con un script de prueba estático `test-etl-contracts.ts` ejecutado localmente con resultado **100% PASS-UNIT** validando:
   - Deserialización segura de enteros $> 2^{53}-1$.
   - Preservación de nanosegundos en timestamps.
   - Rechazo de vinculación por correo sin confirmar (`is_confirmed == false`).
   - Generación de sort keys libres de colisiones con delimitadores `#`.
   - Rollback seguro que preserva modificaciones del usuario.
3. El usuario autorice formalmente el inicio de la Fase 3.5 tras revisar este informe de auditoría.
