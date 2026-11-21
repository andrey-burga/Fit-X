# VIGORCORE — FASE 5.3: AUDITORÍA DE ENTORNO Y CONFIGURACIÓN RUNTIME (FASE 5.3 ENVIRONMENT RUNTIME AUDIT)

**Proyecto en Google AI Studio:** `Fit-X` *(trabajo estrictamente aislado en `poc/catalyst-clean-slate/`)*  
**Proyecto Zoho Catalyst:** `Project-Rainfall`  
**Project ID:** `136967000000014024`  
**Data Center:** `US`  
**Entorno objetivo:** **`Development`** *(**`Production` intacto y sin modificar**)*  
**Función:** `vigor_api` · Function ID: **`136967000000074001`** · Advanced I/O Node 22  
**Operaciones remotas ejecutadas:** **`0`**  
**Dictamen:** **`PHASE_5_3_ENVIRONMENT_RUNTIME_AUDIT_READY_NOT_DEPLOYED`**

---

## 1. AUDITORÍA DE LA FUENTE DE ENTORNO CONFIABLE (`x-zc-environment`)

### Preguntas de Auditoría y Dictamen Técnico
1. **¿`x-zc-environment` es inyectado por Catalyst?**  
   Sí. En el plano de ejecución de Catalyst Advanced I/O, el proxy de plataforma inyecta cabeceras de borde `x-zc-*` (`x-zc-projectid`, `x-zc-environment`, `x-zc-admin-cred-token`, etc.).
2. **¿Está garantizado que representa el entorno de ejecución real?**  
   Parcialmente a nivel de infraestructura, pero **no** se puede asumir como fuente exclusiva incuestionable si se invoca la Function URL directamente sin API Gateway.
3. **¿Catalyst sobrescribe o rechaza una cabecera suministrada por el cliente con el mismo nombre (`x-zc-environment`)?**  
   Depende de si la petición transita por el API Gateway con autenticación configurada o llega a la Function URL nativa. Dado que un atacante podría intentar enviar una cabecera falsificada `x-zc-environment: Production` contra una función desplegada en Development, **VigorCore no confía ciegamente en esta cabecera para seleccionar el entorno**.
4. **¿Está disponible en la Function URL directa de Advanced I/O?**  
   Sí, pero las credenciales administrativas de borde solo se inyectan cuando la plataforma autentica la llamada.
5. **¿Está disponible antes de la inicialización de `ZCAuth`?**  
   Se recibe en el objeto de petición Express (`req.headers`), procesándose dentro del middleware de contexto de `HostedNativeCatalystAuthRuntime.runWithRequestContext()`.

### Conclusión y Marcaje de Confianza
- **Estrategia de VigorCore:** El entorno no se deduce del cliente ni de cabeceras entrantes. Está **fijado server-side** mediante la variable de entorno **`VIGORCORE_DEPLOYMENT_ENVIRONMENT`** (`'Development' | 'Production'`).
- La cabecera `x-zc-environment` se utiliza exclusivamente como **barrera defensiva secundaria de validación cruzada**: si está presente, debe coincidir exactamente con `VIGORCORE_DEPLOYMENT_ENVIRONMENT`. Si difiere, se rechaza de inmediato con **`403 PROJECT_CONTEXT_MISMATCH`**.
- Dado que la no-spoofabilidad absoluta en llamadas directas sin API Gateway requiere pruebas en vivo, este aspecto se mantiene formalmente marcado como **`PENDING_LIVE_VERIFICATION`**.

---

## 2. MANIFESTO EXACTO DE VARIABLES DE ENTORNO

| Clave de Variable | Valor Exacto en Development (`Project-Rainfall`) | Obligatoria / Opcional | Ubicación en el Código | ¿Reservada por Catalyst? | ¿Requiere creación manual en Function Configuration? |
| :--- | :--- | :---: | :--- | :---: | :---: |
| **`VIGORCORE_DEPLOYMENT_ENVIRONMENT`** | `Development` | **Obligatoria** | `src/sdk/catalystSdkBridge.ts` | No | Sí |
| **`VIGOR_ENVIRONMENT`** | `development` | **Obligatoria** | `src/sdk/catalystSdkBridge.ts`, `catalystConfigPreflight.ts` | No | Sí |
| **`CATALYST_PROJECT_ID`** | `136967000000014024` | **Obligatoria** | `src/sdk/catalystSdkBridge.ts`, preflight | No | Sí |
| **`VIGOR_CATALYST_AUTH_MODE`** | `hosted_native` | **Obligatoria** | `src/server/advancedIoApp.ts` | No | Sí |
| **`VIGOR_CORS_MODE`** | `platform_managed` | **Obligatoria** | `src/server/advancedIoApp.ts` | No | Sí |
| **`CATALYST_API_DOMAIN`** | `https://api.catalyst.zoho.com` | **Obligatoria** | `src/sdk/catalystSdkBridge.ts` | No | Sí |
| **`CATALYST_ACCOUNTS_URL`** | `https://accounts.zoho.com` | **Obligatoria** | `src/sdk/catalystSdkBridge.ts` | No | Sí |
| **`VIGOR_SESSION_HMAC_SECRET`** | `[CONFIGURAR_EN_CATALYST]` *(CSPRNG >= 256 bits)* | **Obligatoria** | `src/auth/cleanSlateAuthGuard.ts` | No | Sí |
| **`VIGOR_SESSION_ACTIVE_KID`** | `k1` | **Obligatoria** | `src/auth/cleanSlateAuthGuard.ts` | No | Sí |
| **`VIGOR_ALLOWED_ORIGINS`** | `https://app.vigorcore.lat` | **Obligatoria** | `src/security/httpSecurityPolicy.ts` | No | Sí |
| **`NODE_ENV`** | `production` | **Obligatoria** | Contenedor Catalyst Node.js | No | Opcional (plataforma) |
| **`CATALYST_ENVIRONMENT`** | *Prohibida* | **FORBIDDEN** | `catalystConfigPreflight.ts` (Rechaza `RESERVED_CATALYST_ENV_VAR`) | **Sí** | No configurar |

### Justificación de la Dualidad `VIGORCORE_DEPLOYMENT_ENVIRONMENT` + `VIGOR_ENVIRONMENT`
- **`VIGORCORE_DEPLOYMENT_ENVIRONMENT`** (`Development` | `Production`) controla el acoplamiento con la infraestructura de Zoho Catalyst (proyectos y data centers).
- **`VIGOR_ENVIRONMENT`** (`development` | `staging` | `production` | `test`) controla la política de seguridad y runtime interna de la aplicación VigorCore.
- Mantener ambas proporciona un **doble aislamiento cruzado obligatorio**: si un operador intentara configurar `VIGOR_ENVIRONMENT=production` conectado al proyecto Catalyst de desarrollo, el sistema bloquea el arranque con `ENVIRONMENT_SEPARATION_VIOLATION`. Ninguna de las dos puede eliminarse sin debilitar la seguridad.

---

## 3. AISLAMIENTO Y VERIFICACIÓN DE AISLAMIENTO

- **Project ID Pinning:** Estrictamente fijado a `136967000000014024`.
- **Entorno Runtime:** Development. Cualquier intento de inyectar cabeceras con `Production` contra un runtime de desarrollo es rechazado fail-closed con código `403 PROJECT_CONTEXT_MISMATCH`.
- **Aislamiento Concurrente:** Validado mediante `AsyncLocalStorage` en tests paralelos.

---

## 4. PAQUETE DE DESPLIEGUE Y TRAZABILIDAD SHA-256

- **Artefacto original conservado:** `artifacts/vigor_api.zip`  
  - SHA-256: `d0b6e60814f50fb7e47363fb9bef725b3fa5182ae31c826c075e3bab0ec34d64`
- **Artefacto portable generado:** `artifacts/vigor_api-portable.zip`  
  - SHA-256: `d009bcc01cb1afa77012f47bfc5307d91a1b75101231982bce4e045eda52b8d8`
- **Verificaciones del paquete portable:**
  - Estructura raíz limpia (`package.json`, `package-lock.json`, `catalyst-config.json`, `dist/server/catalystEntry.js`, `node_modules/`).
  - Cero dependencias de desarrollo (`devDependencies` ausentes).
  - Cero barras invertidas `\`, cero symlinks, formato ZIP 2.0 DEFLATE compatible con Info-ZIP `unzip -o` (exit `0`).

---

## 5. RESULTADOS DE LAS PRUEBAS

- Se añadió el conjunto de pruebas **`tests/29-phase-5.3-environment-runtime-audit.test.ts`**.
- **Resultado de la ejecución local:** **127/127 pruebas pasadas con éxito (`PASS 127/127`)**, incluyendo compilación TypeScript, servidor Express, tests unitarios, loopback y auditoría portable.

---

## 6. ELEMENTOS PENDIENTES DE VERIFICACIÓN EN VIVO (`PENDING_LIVE_VERIFICATION`)
1. Comportamiento en vivo de la cabecera `x-zc-environment` inyectada por Catalyst detrás del API Gateway.
2. Invocación exitosa de `GET /health` y `GET /api/v1/health` sobre la Function URL real en `Project-Rainfall` (`Development`).
3. Comprobación del ciclo completo de autenticación nativa hosted con usuario superadministrador bootstrap offline.

---

## 7. DICTAMEN FINAL DE AUDITORÍA

**Dictamen:** **`PHASE_5_3_ENVIRONMENT_RUNTIME_AUDIT_READY_NOT_DEPLOYED`**
