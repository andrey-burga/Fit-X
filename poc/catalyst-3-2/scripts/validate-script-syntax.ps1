# VigorCore -- Validador Sintáctico Oficial mediante Parser de Windows PowerShell
# Ejecuta System.Management.Automation.Language.Parser::ParseFile

[CmdletBinding()]
param (
    [string]$TargetScript = 'extract-firestore.ps1'
)

$targetPath = if ([System.IO.Path]::IsPathRooted($TargetScript)) {
    $TargetScript
} else {
    Join-Path $PSScriptRoot $TargetScript
}

Write-Host '========================================================================' -ForegroundColor Cyan
Write-Host ' VALIDACION SINTACTICA POWERSHELL (PARSER FILE CHECK)                   ' -ForegroundColor Cyan
Write-Host (' Analizando: ' + $targetPath) -ForegroundColor Gray
Write-Host '========================================================================' -ForegroundColor Cyan

if (-not (Test-Path -Path $targetPath)) {
    Write-Host 'ERROR: No se encuentra el archivo objetivo.' -ForegroundColor Red
    exit 1
}

$tokens = $null
$parseErrors = $null

[System.Management.Automation.Language.Parser]::ParseFile(
    $targetPath,
    [ref]$tokens,
    [ref]$parseErrors
) | Out-Null

if ($parseErrors -and $parseErrors.Count -gt 0) {
    Write-Host ('FALLO: Se encontraron ' + $parseErrors.Count + ' errores de parser:') -ForegroundColor Red
    foreach ($err in $parseErrors) {
        Write-Host ('  Linea ' + $err.Extent.StartLineNumber + ', Col ' + $err.Extent.StartColumnNumber + ': ' + $err.Message) -ForegroundColor Red
    }
    $parseErrors | Format-List *
    exit 1
} else {
    Write-Host 'PASS: PowerShell Parser sin errores (Sintaxis 100% valida en Windows PowerShell 5.1/7+)' -ForegroundColor Green
    exit 0
}
