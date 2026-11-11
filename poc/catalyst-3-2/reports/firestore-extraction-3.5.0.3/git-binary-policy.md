# POLÍTICA DE CONTENCIÓN DE ARTEFACTOS BINARIOS Y CONTROL DE VERSIONES GIT
## VIGORCORE ETL — FASE 3.5.0.3

**Fecha:** 11 de noviembre de 2026  
**Ámbito:** Repositorio Git y árbol de directorios `poc/catalyst-3-2/`  
**Estado:** AUDITED & HARDENED  

---

### 1. POLÍTICA DE CONFINAMIENTO DE ARCHIVOS BINARIOS

El principio fundamental de seguridad del ETL de VigorCore establece que:
**"Todo artefacto que contenga información protegida o cifrada debe residir exclusivamente dentro de la frontera de exclusión de `.data/`."**

Cualquier archivo con extensión `.bin` ubicado fuera de `.data/` representa un riesgo potencial de exposición y viola el estándar de segregación de responsabilidades.

---

### 2. TAXONOMÍA ESTRICTA DEL ESCÁNER DE BINARIOS

Para la Fase 3.5.0.3, el escáner implementado en PowerShell (`extract-firestore.ps1`) y TypeScript clasifica cualquier archivo binario encontrado según tres categorías formales:

```
                               ¿Ruta contiene '/.data/'?
                                      /        \
                                     /          \
                                   SÍ            NO
                                  /                \
          ¿Nombre cumple patrón permitido?          \
                    /        \                       \
                   /          \                       \
                 SÍ            NO                      \
                 |              |                       |
                 v              v                       v
          [ PERMITIDO ]   [ SOSPECHOSO ]         [ NO PERMITIDO ]
          doc-*.bin       SUSPICIOUS_BINARY      UNALLOWED_BINARY_LOCATION
          checkpoint.bin  DETECTED               (ej. en reports/)
          id-mapping.bin
          preflight-token.bin
```

#### Detalle de Categorías:
1. **Binarios Permitidos (`ALLOWED`):**
   - Archivos de datos: `doc-\d{6}\.bin` dentro de `.data/firestore-export/`.
   - Archivos de control: `checkpoint.bin`, `id-mapping.bin`, `preflight-token.bin` dentro de `.data/firestore-export/control/` o `.data/firestore-export/`.
2. **Binarios en Ubicación No Permitida (`UNALLOWED_BINARY_LOCATION`):**
   - Todo archivo `.bin` ubicado fuera de `.data/`, independientemente de que su contenido sea conocido o cifrado legítimamente.
   - **Caso concreto de Windows:** `poc/catalyst-3-2/reports/firestore-extraction-3.5/preflight-token.bin` es clasificado como `UNALLOWED_BINARY_LOCATION`. El hecho de estar cifrado con DPAPI no exime al archivo de cumplir con la política de ubicación.
3. **Binarios Sospechosos (`SUSPICIOUS_BINARY_DETECTED`):**
   - Todo archivo `.bin` ubicado dentro de `.data/` pero cuyo nombre no coincida con el catálogo oficial de artefactos esperados (ej. `dump_backup.bin`, `temp_test.bin`, etc.).

---

### 3. EXCLUSIÓN EN GIT Y DEFENSA EN PROFUNDIDAD

El archivo `poc/catalyst-3-2/.gitignore` mantiene activas las directivas complementarias:
```gitignore
.data/
*.bin
```

#### Análisis de Capas:
- **Capa Directiva:** La regla `.data/` impide que Git examine o añada ningún archivo del caché o control.
- **Capa de Extensión:** La regla `*.bin` previene que cualquier archivo binario huérfano (incluso si se crea fuera de `.data/` por error del operador) sea indexado por `git add -A`.
- **Capa Criptográfica:** Incluso en el escenario extremo de que un archivo binario fuese forzado al repositorio (`git add -f`), el contenido en reposo permanece cifrado con Windows DPAPI bajo la cuenta de usuario específica de la máquina local, resultando matemáticamente indescifrable para cualquier tercero o servidor remoto de Git.

---

### 4. REGLAS DE AUDITORÍA SIN MODIFICACIÓN DE ÍNDICE

Se ratifica que durante la auditoría de Git:
1. No se ejecutan comandos de escritura (`git commit`, `git add`, `git reset`, `git checkout`).
2. Se ejecuta exclusivamente la comprobación pasiva de estado (`git status --porcelain`) si la herramienta Git está disponible en la terminal.
3. No se ocultan excepciones ni errores de detección mediante bloques `try {} catch {}` silenciosos.

---

### 5. CONCLUSIÓN

La política de contención de binarios es innegociable: la presencia de `preflight-token.bin` en `reports/` es una violación de frontera que debe ser subsanada mediante la migración a `.data/firestore-export/control/` antes de que la estación Windows pueda alcanzar la certificación completa.
