# VIGORCORE ETL — ESPECIFICACIÓN TÉCNICA DE LA CORRECCIÓN TEMPORAL UTC
**Fase:** 3.5.0.4  
**Fecha:** 2026-11-11  
**Módulo:** `extract-firestore.ps1`  
**Objetivo:** Migración integral a `[DateTimeOffset]` para eliminación absoluta de dependencias de zona horaria local  
**Estado:** IMPLEMENTED & TESTED  

---

## 1. ESPECIFICACIÓN DE LA SOLUCIÓN

Para erradicar la ambigüedad de `System.DateTime.Kind` en PowerShell 5.1 y garantizar idempotencia en cualquier zona horaria mundial (UTC-12 a UTC+14), se sustituyeron todas las invocaciones temporales por el tipo canónico de .NET: `System.DateTimeOffset`.

### 1.1 Reglas Implementadas
1. **Generación:**
   Todo timestamp de Preflight, checkpoints y manifiestos debe generarse mediante:
   ```powershell
   [DateTimeOffset]::UtcNow.ToString('o')
   ```
   Esto produce una cadena ISO 8601 canónica con precisión de ticks y sufijo explícito `Z` (o `+00:00`).

2. **Lectura y Parseo:**
   El parseo debe realizarse mediante:
   ```powershell
   $tokenOffset = [DateTimeOffset]::Parse($authEnvelope.timestampUtc)
   ```
   Si la cadena contiene una sintaxis inválida, debe capturarse de forma explícita y emitir `PREFLIGHT_TOKEN_INVALID_TIMESTAMP`.

3. **Cálculo de Antigüedad:**
   La antigüedad en minutos se computa como:
   ```powershell
   $ageMinutes = ([DateTimeOffset]::UtcNow - $tokenOffset).TotalMinutes
   ```
   Al restar dos `DateTimeOffset`, .NET normaliza ambos a UTC antes de calcular el intervalo `TimeSpan`, independientemente de la configuración regional de Windows.

4. **Detección de Fechas Futuras:**
   Para prevenir manipulación de reloj o timestamps anómalos:
   - Si `$ageMinutes < -2.0` (más de 2 minutos en el futuro, permitiendo 120 segundos de desvío menor entre relojes de hardware), el sistema rechaza la ejecución emitiendo `PREFLIGHT_TOKEN_FUTURE`.

5. **Expiración Estricta:**
   - Si `$ageMinutes > 60.0`, el sistema rechaza la ejecución emitiendo `PREFLIGHT_TOKEN_EXPIRED`.

6. **Correspondencia Criptográfica JSON vs BIN:**
   Antes de evaluar la antigüedad, se comprueba la igualdad de cadenas estricta:
   ```powershell
   if ($authEnvelope.timestampUtc -ne $tokenContent.timestampUtc) {
       throw 'BLOQUEO: timestampUtc en JSON y sobre DPAPI difieren.'
   }
   ```
   Si difieren, se emite `PREFLIGHT_TIMESTAMP_MISMATCH`.

---

## 2. MODIFICACIONES EN EL CÓDIGO FUENTE

### 2.1 En Modo Preflight (Generación)
```powershell
# extract-firestore.ps1 (Líneas 560-565)
$timestampUtc = [DateTimeOffset]::UtcNow.ToString('o')

$tokenContent = [ordered]@{
    version      = '1.0.4'
    projectId    = $ProjectId
    databaseId   = $DatabaseId
    status       = $status
    timestampUtc = $timestampUtc
    ...
}
```

### 2.2 En Modo Extract (Compuerta Control 4)
```powershell
# extract-firestore.ps1 (Líneas 684-700)
$preflightOffset = [DateTimeOffset]::MinValue
try {
    $preflightOffset = [DateTimeOffset]::Parse($authEnvelope.timestampUtc)
} catch {
    throw ('BLOQUEO: Formato de timestamp inválido en preflight: ' + $authEnvelope.timestampUtc)
}
if ($authEnvelope.timestampUtc -ne $tokenContent.timestampUtc) {
    throw 'BLOQUEO: timestampUtc en JSON y sobre DPAPI difieren.'
}
$ageMinutes = ([DateTimeOffset]::UtcNow - $preflightOffset).TotalMinutes
if ($ageMinutes -lt -2.0) {
    throw ('BLOQUEO: El token de preflight tiene fecha en el futuro ({0:F1} min).' -f [Math]::Abs($ageMinutes))
}
if ($ageMinutes -gt 60.0) {
    throw ('BLOQUEO: El token de preflight tiene {0:F1} minutos de antigüedad (> 60 min). Ejecute un nuevo Preflight.' -f $ageMinutes)
}
```

### 2.3 En Modo LocalSecurityAudit (Auditoría Pasiva)
```powershell
# extract-firestore.ps1 (Líneas 1400-1435)
Write-Host ' - Comprobando correspondencia de timestampUtc en JSON y BIN...' -NoNewline
if ($authEnvelope.timestampUtc -ne $tokenContent.timestampUtc) {
    Write-Host ' DISCREPANCIA' -ForegroundColor Red
    $auditFailed = $true
    $auditErrors += ('PREFLIGHT_TIMESTAMP_MISMATCH: JSON ({0}) y sobre BIN ({1}) difieren.' -f $tokenContent.timestampUtc, $authEnvelope.timestampUtc)
} else {
    Write-Host ' OK' -ForegroundColor Green
}

Write-Host ' - Comprobando frescura temporal (< 60 min)...' -NoNewline
$preflightOffset = [DateTimeOffset]::MinValue
$parseSuccess = $false
try {
    $preflightOffset = [DateTimeOffset]::Parse($authEnvelope.timestampUtc)
    $parseSuccess = $true
} catch {
    Write-Host ' FORMATO INVALIDO' -ForegroundColor Red
    $auditFailed = $true
    $auditErrors += ('PREFLIGHT_TOKEN_INVALID_TIMESTAMP: Formato de timestamp inválido: ' + $authEnvelope.timestampUtc)
}

if ($parseSuccess) {
    $ageMinutes = ([DateTimeOffset]::UtcNow - $preflightOffset).TotalMinutes
    if ($ageMinutes -lt -2.0) {
        Write-Host (' FECHA EN EL FUTURO ({0:F1} min)' -f [Math]::Abs($ageMinutes)) -ForegroundColor Red
        $auditFailed = $true
        $auditErrors += ('PREFLIGHT_TOKEN_FUTURE: El token de preflight tiene fecha en el futuro ({0:F1} min).' -f [Math]::Abs($ageMinutes))
    } elseif ($ageMinutes -gt 60.0) {
        Write-Host (' VENCIDO ({0:F1} min)' -f $ageMinutes) -ForegroundColor Red
        $auditFailed = $true
        $auditErrors += ('PREFLIGHT_TOKEN_EXPIRED: Antigüedad de {0:F1} min supera el umbral de 60 min.' -f $ageMinutes)
    } else {
        Write-Host (' OK ({0:F1} min de antigüedad)' -f $ageMinutes) -ForegroundColor Green
    }
}
```

### 2.4 En Checkpoints y Manifiesto de Extracción
Las llamadas `(Get-Date).ToUniversalTime().ToString('o')` en la creación de sobres confidenciales, checkpoints periódicos y el manifiesto final de auditoría fueron actualizadas a `[DateTimeOffset]::UtcNow.ToString('o')`.
