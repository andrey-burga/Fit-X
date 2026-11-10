# VIGORCORE — COMPUERTA REVISADA DE AUTORIZACIÓN PARA FASE 3.5 (FASE 3.4.2)
## Readiness Gate 3.5 (Revisada): Estado de Requisitos, Bloqueos Cerrados y Condiciones Pendientes

**Fecha de emisión:** 10 de noviembre de 2026  
**Auditor:** Oficial de Aseguramiento de Calidad (QA) & Auditor Técnico  
**Estado de la Compuerta:** **TECNICAMENTE LISTA / PENDIENTE DE APROBACIÓN OPERATIVA DEL USUARIO**

---

## 1. EVALUACIÓN REVISADA DE LOS 9 REQUISITOS (REQ-01 A REQ-09)

| # | Requisito de Entrada | Estado en Fase 3.4.1 | Estado en Fase 3.4.2 | Evidencia Demostrada de Cierre |
| :-: | :--- | :---: | :---: | :--- |
| **REQ-01** | **Blindaje Criptográfico de Vinculación JIT:** Exigir `is_confirmed == true` y prueba de posesión (PoP) con token Firebase. | PENDIENTE (BLOCKER) | **CERRADO (VERIFIED)** | Motor `SecureIdentityLinker` implementado. 10 pruebas unitarias aprobadas (F-ID-01.1 a F-ID-01.10). |
| **REQ-02** | **Aislamiento Estricto del Contexto de Autorización:** Derivar `partitionKey = 'USER#' + sourceUid` en backend y rechazar spoofing. | PENDIENTE (BLOCKER) | **CERRADO (VERIFIED)** | Motor `BackendPartitionGuard` implementado. 7 pruebas anti-IDOR aprobadas (F-ID-02.1 a F-ID-02.7). |
| **REQ-03** | **Conservación de Precisión en Tipos Numéricos y Fechas:** Enteros 64-bit con `BigInt` y timestamps con nanosegundos en RFC 3339. | PENDIENTE (BLOCKER) | **CERRADO (VERIFIED)** | Motor `serializationPrecision.ts` implementado. 11 pruebas unitarias aprobadas (F-SER-01.1 a F-SER-01.11). |
| **REQ-04** | **Especificación del Rollback Seguro:** Política conservadora que prohíbe borrado post-cutover y valida integridad profunda por hash. | PENDIENTE (BLOCKER) | **CERRADO (VERIFIED)** | Motor `SafeRollbackEngine` implementado. 6 pruebas unitarias aprobadas (F-ROL-01.1 a F-ROL-01.6). |
| **REQ-05** | **Ventana de Mantenimiento / Consistencia:** Operación de extracción en modo frío de solo lectura (5-10 minutos). | PENDIENTE (HIGH) | **LISTO PARA OPERACIÓN** | Especificación formal completada. Requiere que el usuario confirme la ventana antes de ejecutar la Fase 3.5. |
| **REQ-06** | **Aislamiento en `.gitignore`:** Exclusión estricta de `.data/`, `reports/` y `checkpoint*.json`. | VERIFIED | **CERRADO (VERIFIED)** | Verificado en `poc/catalyst-3-2/.gitignore` (líneas con `.data/` y `.data/**`). |
| **REQ-07** | **Manejo de Credenciales ADC en Memoria:** Captura en memoria volátil sin guardar claves en disco. | VERIFIED | **CERRADO (VERIFIED)** | Arquitectura probada en Fase 3.2.2 y 3.3.4 con `$rawToken` en memoria volátil. |
| **REQ-08** | **Sanitización de Sort Keys:** Reemplazo de `#` por `_` y fechas homogéneas ISO UTC. | PENDIENTE (HIGH) | **CERRADO (VERIFIED)** | Función `canonicalizeValue` y sanitizador de claves compuestas implementados. |
| **REQ-09** | **Prompt Interactivo de Consentimiento Explícito:** Aprobación interactiva del usuario antes de descargar datos. | PENDIENTE (MEDIUM) | **LISTO PARA SCRIPT 3.5** | Contrato de consentimiento interactivo preparado para la plantilla del runner `extract-firestore.ps1`. |

---

## 2. ESTADO ACTUAL DE LOS CUATRO BLOQUEOS CRÍTICOS

- **`F-ID-01` (Vinculación Segura PoP):** **CERRADO [PASS-UNIT]**
- **`F-ID-02` (Derivación Forzada en Backend):** **CERRADO [PASS-UNIT]**
- **`F-SER-01` (Serialización BigInt y Nanosegundos):** **CERRADO [PASS-UNIT]**
- **`F-ROL-01` (Rollback Seguro Conservador):** **CERRADO [PASS-UNIT]**

---

## 3. CONDICIONES PREVIAS OBLIGATORIAS ANTES DE LA FASE 3.5

Aunque los cuatro bloqueos técnicos de diseño y código han sido cerrados satisfactoriamente con 34 pruebas aprobadas, **la Fase 3.5 NO DEBE INICIARSE HASTA QUE SE CUMPLAN LAS SIGUIENTES CONDICIONES OPERATIVAS:**

1. **Aprobación Formal del Desarrollador/Usuario:** El usuario debe revisar este informe de cierre y autorizar expresamente el paso a la Fase 3.5.
2. **Definición de la Ventana de Mantenimiento Fría:** Acordar el momento en que se ejecutará la extracción en la estación Windows (duración estimada: 15 a 30 segundos para los 73 documentos), asegurando que ningún atleta esté registrando datos en vivo en ese instante.
3. **Generación del Script de Extracción en Fase 3.5:** El script `poc/catalyst-3-2/scripts/extract-firestore.ps1` se generará en la siguiente fase incorporando el prompt de consentimiento interactivo y los algoritmos de hashing validados.

---

## 4. ADVERTENCIA DIRECTIVA

# **ESTA FASE NO AUTORIZA LA EXTRACCIÓN DE DATOS HISTÓRICOS.**
**Cero llamadas a la API de Firestore para descargar documentos de negocio se han ejecutado en este turno.**  
**Cero datos reales han sido modificados.**
