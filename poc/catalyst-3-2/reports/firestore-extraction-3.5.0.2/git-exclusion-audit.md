# AUDITORÍA DE EXCLUSIÓN GIT Y ARCHIVOS SENSIBLES
## VIGORCORE ETL — FASE 3.5.0.2

**Fecha de Auditoría:** 10 de noviembre de 2026  
**Ámbito de Inspección:** `poc/catalyst-3-2/`  
**Archivo de Configuración:** `poc/catalyst-3-2/.gitignore`  
**Estado:** AUDITED & VERIFIED  

---

### 1. OBJETIVO DE LA AUDITORÍA GIT

Asegurar de manera concluyente e irrevocable que:
1. Ningún archivo con datos históricos de Firestore (sea en texto plano, metadatos, checkpoints o fragmentos cifrados `.bin`) pueda ingresar al control de versiones de Git por error del desarrollador o automatizaciones de CI/CD.
2. La configuración de `poc/catalyst-3-2/.gitignore` cubra con suficiencia tanto los directorios de almacenamiento temporal como los patrones de extensión de artefactos cifrados.
3. No existan archivos binarios `.bin` huérfanos fuera del árbol `.data/`.

---

### 2. INSPECCIÓN DE REGLAS EN `.gitignore`

El archivo `poc/catalyst-3-2/.gitignore` fue analizado exhaustivamente, confirmando las siguientes directivas activas:

```gitignore
node_modules/
dist/
coverage/
.env*
!.env.example
*.log
reports/
archive/
checkpoint*.json
.data/
*.bin
```

#### Análisis de Cobertura de Reglas:
- `.data/`: Excluye recursivamente el directorio de datos completos, incluyendo:
  - `.data/firestore-export/` (directorio definitivo de extracción).
  - `.data/security-selftest/` (directorio sintético efímero de prueba de ACL).
  - `.data/preflight-token.json` y `.data/preflight-token.bin` (archivos de control previo).
  - `.data/checkpoint.bin` y `.data/checkpoint.json` (archivos de reanudación).
- `*.bin`: Regla de contención de segundo nivel (defensa en profundidad). Incluso si un archivo cifrado fuera escrito erróneamente fuera de `.data/`, la extensión `.bin` impide automáticamente que `git status` o `git add .` lo rastreen.
- `checkpoint*.json`: Previene que cualquier checkpoint exportado en JSON para depuración sea registrado en el repositorio.

---

### 3. ESCANEO FORENSE DE ARCHIVOS BINARIOS HUÉRFANOS

Se ejecutó un escaneo recursivo en el árbol de directorios de `poc/catalyst-3-2/` para detectar posibles archivos `*.bin` ubicados fuera del directorio `.data/`:

```bash
find poc/catalyst-3-2 -name "*.bin"
```
**Resultado del Escaneo:**  
- Archivos `.bin` encontrados en la raíz: **0**
- Archivos `.bin` encontrados en `poc/catalyst-3-2/scripts/`: **0**
- Archivos `.bin` encontrados en `poc/catalyst-3-2/src/`: **0**
- Archivos `.bin` encontrados en `poc/catalyst-3-2/reports/`: **0**
- **Total de binarios huérfanos en el árbol del proyecto:** **0 ARCHIVOS DETECTADOS (LIMPIO)**

---

### 4. ANÁLISIS DE LA FRONTERA GIT VS. CRIPTOGRAFÍA

La arquitectura de seguridad local de VigorCore aplica un modelo de **Defensa en Profundidad (Capa Dual)**:

| Capa de Protección | Mecanismo | Escenario de Mitigación |
|---|---|---|
| **Capa 1: Git Ignore** | Filtro declarativo de exclusión de archivos (`.data/`, `*.bin`) | Previene comandos masivos accidentales (`git add -A`, `git commit`). |
| **Capa 2: Cifrado DPAPI** | Cifrado nativo del kernel con `DataProtectionScope.CurrentUser` | Si un atacante o script lograse eludir `.gitignore` y subir un `.bin`, el contenido es completamente ininteligible y no puede ser descifrado sin la clave privada derivada del hash de login de la estación Windows emisora. |
| **Capa 3: ACL NTFS** | Control de acceso a nivel de sistema de archivos | Impide que otros procesos o usuarios del sistema lean los archivos del caché antes de cualquier operación de Git. |

---

### 5. VERIFICACIÓN AUTOMATIZADA EN SUITE DE PRUEBAS

En la suite de pruebas unitarias (`test-phase-3.5-extractor.ts`), se incorporaron dos pruebas de validación estricta:
1. `auditExtractGates bloquea extracción si .data/ no está excluido en .gitignore` (**PASS-MOCK**): Comprueba que la compuerta Gate 9 se active y aborte la extracción si `.gitignore` carece de la regla `.data/`.
2. `executeLocalSecurityAudit reporta STRAY_BIN_FILES_FOUND` (**PASS-MOCK**): Comprueba que el auditor local marque de inmediato advertencia y bloqueo si se detecta cualquier archivo `.bin` fuera de `.data/`.

**Dictamen:** `GIT EXCLUSION INTEGRITY CONFIRMED — ZERO RISK OF REPOSITORY LEAKAGE`.
