# VIGORCORE — FASE 5.3: CONCILIACIÓN Y RECONOCIMIENTO DE ENTORNO NATIVO CATALYST

**Proyecto en Google AI Studio:** `Fit-X` *(trabajo estrictamente aislado en `poc/catalyst-clean-slate/`)*  
**Proyecto Zoho Catalyst:** `Project-Rainfall`  
**Project ID:** `136967000000014024`  
**Data Center:** `US`  
**Entorno objetivo:** **`Development`** *(**`Production` intacto y sin modificar**)*  
**Función:** `vigor_api` · Function ID: **`136967000000074001`** · Advanced I/O Node 22  
**Operaciones remotas ejecutadas:** **`0`**  
**Dictamen histórico:** **`PHASE_5_3_ENVIRONMENT_CONFIGURATION_RECONCILED_NOT_DEPLOYED`**  
**Dictamen vigente (tras reconciliación de nombres reservados):** **`PHASE_5_3_ENVIRONMENT_VARIABLE_NAMES_RECONCILED_NOT_DEPLOYED`**

---

## 1. INCIDENTE Y DIAGNÓSTICO DEL RESERVED KEYWORD

Durante el despliegue inicial en el entorno de desarrollo de Catalyst (`Project-Rainfall`), la función `vigor_api` comenzó a ejecutarse correctamente (resolviendo el fallo previo de extracción `unzip -o` `status: 1`), pero respondió inmediatamente con:

`INVALID_CATALYST_ENVIRONMENT: CATALYST_ENVIRONMENT must be 'Development' or 'Production'.`

Cuando el operador intentó configurar la variable de entorno `CATALYST_ENVIRONMENT` en **Catalyst Console → Function Configuration → Environment Variables**, Zoho Catalyst rechazó la clave con:

`environment_variables must not contain reserved keywords`

### Hallazgo técnico clave
- Zoho Catalyst reserva formalmente el prefijo y las claves asociadas a la plataforma dentro de su consola BaaS.
- `@zcatalyst/auth-admin@1.1.0` y `@zcatalyst/utils@1.1.0` analizan las cabeceras HTTP inyectadas (`x-zc-environment`, `x-zc-projectid`, etc.) pero no leen `CATALYST_ENVIRONMENT` de `process.env` (su fallback por defecto lee `process.env['x-zc-environment']` con un silencioso `'Development'`, lo cual es inseguro para aislamiento estricto en producción).
- Para resolver este bloqueo de consola sin comprometer la seguridad ni violar la separación de entornos, se introduce el selector personalizado y no reservado de VigorCore: **`VIGORCORE_DEPLOYMENT_ENVIRONMENT`** (`'Development' | 'Production'`).

---

## 2. ESTRATEGIA DE RECONCILIACIÓN ADOPTADA

1. **Selector principal no reservado:** Se define **`VIGORCORE_DEPLOYMENT_ENVIRONMENT`** como variable obligatoria en `vigor_api` (`'Development'` o `'Production'`). Catalyst Console la acepta sin restricciones de keywords reservados.
2. **Protección Fail-Closed contra `CATALYST_ENVIRONMENT`:** Si se detecta la presencia de la variable legada o reservada `CATALYST_ENVIRONMENT`, el SDK bridge y el preflight la interceptan y fallan de inmediato con el código de error explícito **`RESERVED_CATALYST_ENV_VAR`**, indicando al operador que debe eliminarla y configurar `VIGORCORE_DEPLOYMENT_ENVIRONMENT`.
3. **Triple validación cruzada obligatoria:**
   - `VIGORCORE_DEPLOYMENT_ENVIRONMENT` (configurado en plataforma).
   - `VIGOR_ENVIRONMENT` (`development` o `production`).
   - `x-zc-environment` (cabecera inyectada por el plano de plataforma Catalyst en cada petición autenticada).
   - Cualquier discrepancia entre estos tres valores bloquea la ejecución de inmediato (`ENVIRONMENT_SEPARATION_VIOLATION` o `PROJECT_CONTEXT_MISMATCH`).

---

## 3. PRUEBAS LOCALES Y VERIFICACIÓN COMPLETA

La suite de pruebas incluye el nuevo archivo **`tests/28-phase-5.3-environment-reconciliation.test.ts`** que verifica:
1. Detección válida de `'Development'` con `VIGOR_ENVIRONMENT=development`.
2. Detección válida de `'Production'` con `VIGOR_ENVIRONMENT=production`.
3. Ausencia de `VIGORCORE_DEPLOYMENT_ENVIRONMENT` o presencia exclusiva de la clave reservada `CATALYST_ENVIRONMENT` -> rechazo fail-closed (`RESERVED_CATALYST_ENV_VAR`).
4. Valores inválidos (`'staging'`, `'dev'`, vacíos) -> rechazo fail-closed (`INVALID_DEPLOYMENT_ENVIRONMENT`).
5. Discrepancia de proyecto (`x-zc-projectid` incorrecto) -> `403 PROJECT_CONTEXT_MISMATCH`.
6. Discrepancia de entorno (`x-zc-environment` incorrecto o cruce `production` ↔ `Development`) -> `403 PROJECT_CONTEXT_MISMATCH` / `ENVIRONMENT_SEPARATION_VIOLATION`.
7. Aislamiento concurrente mediante `AsyncLocalStorage` en peticiones paralelas.
8. Arranque de preflight y validación de manifiesto sin fugas de secretos.

---

## 4. EXTENSIÓN POR KEYWORDS RESERVADOS (`CATALYST_PROJECT_ID`, `CATALYST_API_DOMAIN`, `CATALYST_ACCOUNTS_URL`)

Catalyst Console rechazó igualmente estas tres claves con `environment_variables must not contain reserved keywords` (mientras aceptó 6 variables con prefijo `VIGOR_` / `VIGORCORE_`). Todas fueron migradas de forma estricta a nombres propiedad de la aplicación (ver `docs/40-phase-5.3-reserved-env-vars-reconciliation.md`):
- `CATALYST_PROJECT_ID` → **`VIGORCORE_CATALYST_PROJECT_ID`** (`136967000000014024`)
- `CATALYST_API_DOMAIN` → **`VIGORCORE_CATALYST_API_DOMAIN`** (`https://api.catalyst.zoho.com`)
- `CATALYST_ACCOUNTS_URL` → **`VIGORCORE_CATALYST_ACCOUNTS_URL`** (`https://accounts.zoho.com`)

## 5. DICTAMEN FINAL

**Dictamen:** **`PHASE_5_3_ENVIRONMENT_VARIABLE_NAMES_RECONCILED_NOT_DEPLOYED`**
- Cero operaciones remotas ejecutadas.
- Entorno `Production` intacto y sin modificar.
- Código, manifiestos, documentación y pruebas actualizados y listos para validación local.
