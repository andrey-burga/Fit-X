# VIGORCORE — MODELO DE SEGURIDAD Y PRIVACIDAD ZERO DATA (FASE 3.4)
## Protección de Datos Sensibles, Manejo de Secretos y Políticas de Higiene Criptográfica

**Fecha de emisión:** 9 de noviembre de 2026  
**Auditor:** Oficial de Seguridad de la Información (CISO) & Auditor de Cumplimiento  
**Alcance:** Protocolos de aislamiento de credenciales, protección de datos de salud y destrucción segura.

---

## 1. PRINCIPIO DE PRIVACIDAD ZERO DATA EN AUDITORÍA

Los datos procesados por VigorCore incluyen información de salud, biometría (peso, estatura, grasa corporal), registros calóricos y preferencias de entrenamiento, los cuales constituyen datos personales de categoría especial (sensibles) según regulaciones internacionales de privacidad (GDPR, HIPAA, normativas locales de protección de datos).

### Reglas de Hierro de Zero Data [VERIFIED]:
1. **Cero Datos Sensibles en Reportes Técnicos:**  
   Ningún informe de auditoría, archivo Markdown de seguimiento, resumen JSON de inventario ni commit en el repositorio contendrá jamás nombres de usuarios, direcciones de correo, peso, altura, calorías ni textos de notas personales.
2. **Uso Exclusivo de Alias Deterministas:**  
   En cualquier documento público o reporte de ejecución se utilizarán únicamente los alias canónicos `USER_001`, `USER_002`, `USER_003`, `USER_004` y `USER_005`.
3. **Cero Impresión en Consola:**  
   Los scripts PowerShell y Node.js nunca imprimirán el contenido de los objetos JSON de atletas ni tokens de autenticación en la salida estándar (`stdout`) ni de error (`stderr`).

---

## 2. AISLAMIENTO DEL ALMACENAMIENTO LOCAL Y AUDITORÍA DE GIT

Para asegurar que los archivos crudos descargados durante la fase de extracción jamás sean rastreados ni expuestos accidentalmente a repositorios remotos:

### Configuración del `.gitignore` en `poc/catalyst-3-2/.gitignore`:
```gitignore
# Archivos de entorno y credenciales
.env*
!.env.example

# Datos crudos de extracción y staging temporal (ZERO DATA)
.data/
.data/**
*.tmp
*.raw.json

# Reportes locales con metadatos sensibles y checkpoints
reports/
checkpoint*.json

# Logs y depuración
*.log
npm-debug.log*
```

### Regla de Custodia Local:
- Los documentos extraídos residirán exclusivamente en la estación física del desarrollador dentro de `poc/catalyst-3-2/.data/raw/`.
- Este directorio está estrictamente aislado del contenedor de desarrollo y del control de versiones.

---

## 3. GESTIÓN SEGURA DE CREDENCIALES: MEMORY-ONLY TOKENS Y ADC

### A. Credenciales de Google Cloud / Firebase (Origen):
- **Cero Claves de Cuenta de Servicio en Disco:** No se autoriza la descarga ni almacenamiento de archivos de clave JSON (`serviceAccountKey.json`).
- **Application Default Credentials (ADC) en Memoria:**  
  El token OAuth 2.0 se obtiene directamente del SDK de Google Cloud mediante:
  ```powershell
  $rawToken = & gcloud auth application-default print-access-token 2>&1
  ```
  El token se conserva exclusivamente en una variable volátil en la memoria RAM del proceso PowerShell (`$bearerToken`).
- **Destrucción Inmediata:** Al finalizar la ejecución del script, la variable en memoria se sobrescribe y se libera.

### B. Credenciales de Zoho Catalyst (Destino):
- Las variables de entorno de Catalyst (`ZC_PROJECT_ID`, `ZC_CLIENT_ID`, `ZC_CLIENT_SECRET`, `ZC_REFRESH_TOKEN`) se configuran únicamente a través del archivo `.env` local del desarrollador (nunca versionado) o mediante variables de entorno del sistema operativo.
- El archivo `.env.example` en el repositorio contiene exclusivamente variables de plantilla sin valores confidenciales.

---

## 4. MATRIZ DE AUTORIZACIÓN Y CONSENTIMIENTO EXPLÍCITO

El proceso de extracción masiva de datos completos (Fase 3.5) no debe ejecutarse de forma silenciosa ni automática. Requiere una compuerta de aprobación explícita:

```
[PROMPT DE AUTORIZACIÓN OBLIGATORIO]
========================================================================
 VIGORCORE ETL -- AUTORIZACIÓN DE DESCARGA DE DATOS COMPLETOS
========================================================================
 Base de datos: ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c
 Total Documentos a Descargar: 73
 Destino Local: poc/catalyst-3-2/.data/raw/ (Ignorado por Git)
 
 ¿Confirma la descarga segura de los 73 documentos a su disco local?
 [Y] Sí, autorizo la extracción local  [N] Cancelar operación
========================================================================
```

Si el usuario responde cualquier valor distinto de `Y`, la ejecución se aborta de inmediato sin realizar ninguna solicitud a la API REST.

---

## 5. POLÍTICA DE SANITIZACIÓN Y DESTRUCCIÓN SEGURA DE DATOS TEMPORALES

Una vez completada la migración a Zoho Catalyst NoSQL y certificado el dictamen final de reconciliación en la Fase 3.8:

1. **Protocolo de Purga Local:**  
   Se proporcionará un script de sanitización `purge-local-etl-cache.ps1` que ejecutará una sobrescritura segura (zeroing) y eliminación del directorio temporal `.data/`:
   ```powershell
   Remove-Item -Recurse -Force .\poc\catalyst-3-2\.data\
   ```
2. **Certificado de Destrucción de Cache:**  
   El informe final registrará la fecha y hora de la purga local del caché, garantizando que no queden copias residuales no encriptadas en la estación de trabajo.
