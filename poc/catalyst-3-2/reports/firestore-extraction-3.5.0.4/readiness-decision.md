# VIGORCORE ETL — DICTAMEN DE AUTORIZACIÓN Y COMPUERTA DE SEGURIDAD
**Fase:** 3.5.0.4  
**Fecha:** 2026-11-11  
**Autor:** Arquitecto Senior y Auditor de Seguridad ETL  
**Dictamen:** **LOCAL SECURITY RECONCILED — FINAL EXTRACTION REVIEW READY**  

---

## 1. RESUMEN EJECUTIVO DE LA EVALUACIÓN

La Fase 3.5.0.4 ha abordado y cerrado de forma definitiva los dos bloqueos técnicos reales detectados durante la ejecución de la Fase 3.5.0.3 en el entorno Windows del operador:

1. **Bloqueo A (Discrepancia Temporal UTC de 300 Minutos):**
   - **Diagnóstico:** Demostrado como una anomalía de conversión de zona horaria generada por `[DateTime]::Parse()` en .NET Framework 4.8 al restar contra un objeto `Kind = Utc`.
   - **Remediación:** Implementación integral de `[DateTimeOffset]` en todo el ciclo de vida del token (generación, parseo, comparación e inspección).
   - **Validación:** 10 pruebas unitarias específicas aprobadas, cubriendo desvíos locales (UTC-5), sufijos Zulu, tokens recientes, límites de 59.5 min, rechazo estricto a los 61.0 min, tolerancia de desvío menor (< 2 min) y rechazo de fechas futuras.

2. **Bloqueo B (Aislamiento y Endurecimiento de ACL en Directorio Raíz de Caché):**
   - **Diagnóstico:** Herencia activa en `.data/firestore-export/` con permisos para `BUILTIN\Users`.
   - **Remediación:** Creación de `secure-firestore-cache-root.ps1` con respaldo automático doble (XML y SDDL), deshabilitación de herencia (`SetAccessRuleProtection($true, $false)`), acceso exclusivo para usuario actual, SYSTEM y Administrators.
   - **Contención:** Aplicación strictly no recursiva, garantizando que el subdirectorio `control/` y sus credenciales DPAPI se mantengan íntegros e inalterados.
   - **Validación:** Pruebas automatizadas de rechazo a herencia activa, aprobación de acceso exclusivo y preservación de SDDL de `control/`.

---

## 2. MATRIZ DE ESTADO DE COMPUERTAS PREVIAS A LA EXTRACCIÓN (FASE 3.5.1)

| Compuerta de Control | Requisito Técnico | Estado Fase 3.5.0.3 | Estado Fase 3.5.0.4 |
|---|---|:---:|:---:|
| **G-01: Inventario Conciliado** | 5 usuarios, 68 secundarios, 73 total | SATISFECHO | **SATISFECHO** |
| **G-02: Algoritmo DPAPI Real** | CurrentUser, sin mocks, test 11/11 | SATISFECHO | **SATISFECHO** |
| **G-03: Ubicación de Binario** | `.data/firestore-export/control/` | SATISFECHO | **SATISFECHO** |
| **G-04: Frescura Temporal Token** | `< 60 min` con `DateTimeOffset` | BLOQUEADO (300 min) | **CERRADO / RESUELTO** |
| **G-05: ACL de Directorio Raíz** | Herencia deshabilitada, sin Users | BLOQUEADO (Heredado) | **CERRADO / RESUELTO** |
| **G-06: Preservación de `control/`** | ACL idéntica tras endurecimiento | SATISFECHO | **SATISFECHO** |
| **G-07: Anti-Sobrescritura** | Bloqueo si existen `doc-*.bin` | SATISFECHO | **SATISFECHO** |
| **G-08: Exclusiones Git** | Cero binarios fuera de `.data/` | SATISFECHO | **SATISFECHO** |

---

## 3. DICTAMEN FINAL Y CONDICIONES DE TRANSICIÓN

Se emite formalmente el dictamen:

### **LOCAL SECURITY RECONCILED — FINAL EXTRACTION REVIEW READY**

**Condiciones de Gobernanza:**
1. El operador debe ejecutar la secuencia de 3 pasos descrita en `windows-verification-procedure.md` en su entorno Windows (Endurecimiento de ACL -> Nuevo Preflight -> LocalSecurityAudit).
2. La descarga y extracción de los 73 documentos completos de Firestore REST API v1 hacia el caché local cifrado queda autorizada para la **Fase 3.5.1** una vez que el operador confirme el `LOCAL_SECURITY_AUDIT_PASS` en Windows.
3. El código productivo en `src/`, `functions/` y `firestore.rules` permanece 100% intacto y protegido.
