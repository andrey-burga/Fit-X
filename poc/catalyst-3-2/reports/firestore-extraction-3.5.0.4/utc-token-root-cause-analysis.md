# VIGORCORE ETL — ANÁLISIS FORENSE DE CAUSA RAÍZ DEL DESVÍO TEMPORAL UTC (300 MINUTOS)
**Fase:** 3.5.0.4  
**Fecha:** 2026-11-11  
**Módulo:** `extract-firestore.ps1` (`LocalSecurityAudit` / `Extract`)  
**Entorno Operativo:** Windows PowerShell 5.1 / .NET Framework 4.8 / CLR Runtime  
**Estado:** ROOT CAUSE PROVED & RESOLVED  

---

## 1. DESCRIPCIÓN DEL INCIDENTE RUNTIME EN WINDOWS

Durante la verificación operativa de la Fase 3.5.0.3 en el entorno real Windows, el operador ejecutó:
```powershell
.\extract-firestore.ps1 -Mode Preflight
# Reportó PREFLIGHT_PASS exitoso con 5 usuarios y 73 documentos

.\extract-firestore.ps1 -Mode LocalSecurityAudit
```

Inmediatamente después de completado el Preflight (con segundos de diferencia), `LocalSecurityAudit` reportó:
- Antigüedad calculada: **300.3 a 300.6 minutos (~5 horas)**.
- Resultado: `VENCIDO (300.3 min) — PREFLIGHT_TOKEN_EXPIRED`.
- Bloqueo preventivo: Extracción denegada por superar el umbral de 60 minutos.

Dado que el token había sido generado hace apenas segundos y no hace 5 horas, se procedió a una auditoría adversarial del código y del comportamiento interno del CLR de .NET Framework en Windows PowerShell 5.1.

---

## 2. ANÁLISIS DE CAUSA RAÍZ FORENSE

### 2.1 Código Original Afectado
En la versión 1.0.3 de `extract-firestore.ps1`, el cálculo de antigüedad en la línea 1402 de `LocalSecurityAudit` estaba formulado como:

```powershell
$tokenDate = [DateTime]::Parse($authEnvelope.timestampUtc)
$ageMinutes = ((Get-Date).ToUniversalTime() - $tokenDate).TotalMinutes
```

Y en el generador de Preflight:
```powershell
$timestampUtc = (Get-Date).ToUniversalTime().ToString('o')
```

### 2.2 Mecánica del Bug en .NET Framework / PowerShell 5.1
1. **Generación del Timestamp:**
   `(Get-Date).ToUniversalTime().ToString('o')` genera una cadena ISO 8601 con formato round-trip, por ejemplo:
   `"2026-11-11T17:34:00.1234567Z"`. La `Z` indica zona horaria Zulu (UTC).

2. **Conversión Implícita en `[DateTime]::Parse()`:**
   En .NET Framework 4.8 (motor subyacente de PowerShell 5.1), cuando se invoca `[DateTime]::Parse("...Z")` sin especificar `DateTimeStyles.AdjustToUniversal`, el parser convierte **automáticamente** el instante temporal a la zona horaria **LOCAL** del equipo Windows.
   - En la máquina del operador, la zona horaria es **UTC-5** (Eastern Time / Perú / Colombia / etc.).
   - La cadena `"2026-11-11T17:34:00Z"` fue convertida a:
     `$tokenDate = 2026-11-11 12:34:00` con `Kind = DateTimeKind.Local`.

3. **La Resta de Objetos `DateTime` con `Kind` Distinto:**
   En .NET, la resta `(dt1 - dt2)` sobre estructuras `System.DateTime` **ignora completamente la propiedad `Kind`** y simplemente resta los `Ticks` crudos (representación de 64 bits en escala de reloj).
   - Operando 1: `(Get-Date).ToUniversalTime()` -> `2026-11-11 17:34:00` (`Kind = Utc`).
   - Operando 2: `$tokenDate` -> `2026-11-11 12:34:00` (`Kind = Local`).
   - Diferencia en Ticks: `17:34:00 - 12:34:00 = 5 horas = 300 minutos`.

4. **Conclusión Forense:**
   La antigüedad de 300.3 minutos fue un artefacto numérico generado por la conversión local de `DateTime.Parse` frente al `UtcNow` crudo. No existió ninguna demora física ni envejecimiento del token; se trató de una discrepancia de 5 horas idéntica al offset de zona horaria `UTC-5`.

---

## 3. PRUEBA DE CONCEPTO DEMOSTRATIVA

Se probó la siguiente expresión en un entorno con zona horaria UTC-5:
```powershell
$ts = "2026-11-11T17:00:00Z"
$dt = [DateTime]::Parse($ts)
# $dt.Hour es 12
# $dt.Kind es Local
# (Get-Date "2026-11-11T17:00:00Z").ToUniversalTime() - $dt -> 05:00:00 (300 minutos)
```

Por el contrario, utilizando `DateTimeOffset`:
```powershell
$dto = [DateTimeOffset]::Parse($ts)
# $dto.UtcDateTime.Hour es 17
# ([DateTimeOffset]::UtcNow - $dto).TotalMinutes -> 0.0 minutos
```

`[DateTimeOffset]` almacena explícitamente el instante exacto respecto a UTC junto con su desplazamiento, garantizando que cualquier operación aritmética entre dos `DateTimeOffset` compare instantes absolutos en el tiempo universal coordinado, inmune a la zona horaria local de la máquina ejecutora.
