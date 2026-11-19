# VIGORCORE — FASE 4.0: INFORME DE ARQUITECTURA CLEAN-SLATE EN ZOHO CATALYST

> **ACTUALIZACIÓN FASE 4.0.1:** Este documento base fue auditado y endurecido en **`docs/06-adversarial-audit-4.0.1.md`** y **`docs/07-manual-catalyst-tables-runbook.md`**, que prevalecen como especificación definitiva (eliminación de Sort Keys redundantes en tablas 1-ítem, adición de `GSI_GlobalChronology`, eliminación de `auth_time_sec`, denegación por defecto y bootstrap offline).

**Fecha:** 13 de noviembre de 2026  
**Estado / Dictamen:** `CLEAN_SLATE_ARCHITECTURE_DESIGNED — SUPERSEDED BY 4.0.1 AUDIT`  
**Directorio Aislado:** `poc/catalyst-clean-slate/`  
**Política de Datos:** **CERO MIGRACIÓN DE DOCUMENTOS DE FIRESTORE (Base Catalyst NoSQL inicia 100% vacía)**

---

## 1. DECISIÓN ESTRATÉGICA Y Pila Tecnológica Destino

Se adopta formalmente una arquitectura **Clean-Slate** para VigorCore sobre **Zoho Catalyst**:

| Capa | Tecnología Actual (Firebase - Intacta durante diseño) | Tecnología Destino (Zoho Catalyst Clean-Slate) |
| :--- | :--- | :--- |
| **Frontend SPA** | React 19 + TypeScript + Vite 8 + Tailwind CSS v4 | React 19 + TypeScript + Vite 8 + Tailwind CSS v4 en **Zoho Catalyst Slate** (`https://fit-x-bhnatsxl.onslate.com`) |
| **Autenticación** | Firebase Auth (Google OAuth + Email/Password) | **Zoho Catalyst Authentication** (`catalystWebSDK.js` / `/__catalyst/sdk/init.js` en cliente; `@zcatalyst/auth` `zcAuth.init(req)` en servidor) |
| **Backend API & Seguridad** | Cloud Functions v2 (solo admin) + acceso directo cliente a Firestore controlado por `firestore.rules` | **Zoho Catalyst Advanced I/O Functions** (`@zcatalyst/auth`, `@zcatalyst/nosql`) actuando como puerta de enlace única Zero-Trust |
| **Base de Datos** | Cloud Firestore (`ai-studio-vigorcore-...`) | **Zoho Catalyst NoSQL** (5 tablas limpias, partición nativa `USER#<catalyst_user_id>`, **0 documentos migrados**) |
| **Control de Código** | Repositorio actual | **GitHub** + despliegue controlado hacia Catalyst |

---

## 2. POR QUÉ CLEAN-SLATE ELIMINA LOS BLOQUEADORES DE LAS FASES 3.x

El análisis forense de las Fases 3.3–3.5 demostró que la base Firestore de `gen-lang-client-0041212770` contiene únicamente 73 documentos de prueba (5 usuarios de desarrollo). Al renunciar a migrar registros históricos:

1. **Eliminación total de F-ID-01 (Account Takeover en vinculación JIT):** Ya no existe vinculación por correo con UIDs históricos de Firebase ni puente `sourceUid`. El primer inicio de sesión verificado en Catalyst crea un perfil limpio cuyo identificador primario es directamente `catalystUserId` (`req.user.user_id`).
2. **Eliminación total de F-ID-02 (Deriva de partición `sourceUid`):** El backend deriva `pk = USER#<catalystUserId>` directamente de la sesión verificada por `zcAuth`.
3. **Eliminación total de F-SER-01 y F-ROL-01:** No hay extracción REST de Firestore, serialización `int64`/nanosegundos ni rollbacks destructivos de lotes ETL.
4. **Congelación de `poc/catalyst-3-2/`:** La carpeta `poc/catalyst-3-2/` queda preservada íntegra únicamente como evidencia histórica.

---

## 3. GARANTÍAS DE NO INTERFERENCIA

- **Producción React/Firebase raíz:** `src/`, `functions/`, `firestore.rules`, `package.json`, `bun.lock` y `firebase-applet-config.json` permanecen **100% intactos**.
- **Sitio Slate vivo:** No se ha desplegado ningún cambio sobre `https://fit-x-bhnatsxl.onslate.com`.
- **Infraestructura Firebase/GCP:** No se elimina Firestore, no se desactiva IAM ni facturación.
- **Consola Catalyst:** No se han creado tablas, usuarios ni funciones remotas.

---

## 4. ENTREGABLE 11: MATRIZ DE RIESGOS CLEAN-SLATE

| ID | Riesgo Arquitectónico | Probabilidad | Impacto | Mitigación Incorporada en Diseño |
| :--- | :--- | :---: | :---: | :--- |
| **R-CS-01** | **Ausencia de `onSnapshot` nativo en Catalyst NoSQL** (el cliente actual usa 11 suscripciones tiempo real en `AppContext.tsx`). | Alta | Medio | Hidratación inicial en 1 sola lectura particionada (`GET /api/v1/athlete/workspace`) + actualizaciones optimistas + revalidación al recuperar foco (`visibilitychange`) y post-mutación. |
| **R-CS-02** | **Límite estricto de 400 KB por ítem en Catalyst NoSQL** (riesgo en `MesocycleRoutine` multi-semana o `mealPlans` extensos). | Media | Alto | Guardián servidor `assertPayloadSizeBudget()` con techo suave de **350 KB** (HTTP 413 antes del límite duro de 400 KB) y particionado semanal/por rutina. |
| **R-CS-03** | **Límite de 25 ítems por lote en Catalyst NoSQL** (`syncMealPlanToGroceries` puede superar 25 ingredientes). | Alta | Medio | Fragmentación automática (*chunking*) en bloques de 25 ítems en `AthleteDataService` + verificación unitaria (60 ítems -> 3 lotes). |
| **R-CS-04** | **Ausencia de transacciones multi-documento ACID** (riesgo en canje de invitaciones, onboarding o cambios de rol). | Alta | Alto | Unificación de `Users + adminRoleState + accountAccess + adminUserDirectory` en un solo ítem atómico en `Users`; bloqueo condicional (`pending -> redeeming`) con `lockHolderOpId` en `AdminInvitations`; contador atómico `SUPERADMIN_COUNT`. |
| **R-CS-05** | **Purga TTL asíncrona (cada ~24h) en Catalyst NoSQL** (una invitación expirada podría seguir siendo leída hasta la siguiente barrida TTL). | Media | Alto | Validación explícita en tiempo de lectura (`expiresAtEpochSec <= nowSec`) antes de permitir canje, además de `ttlEpochSec` para recolección de basura. |
| **R-CS-06** | **Dependencia de SDK heredado (`zcatalyst-sdk-node`)**. | Baja | Medio | Estandarización estricta sobre **Catalyst Modular SDK** (`@zcatalyst/auth`, `@zcatalyst/nosql`, `@zcatalyst/mail`, `@zcatalyst/cache`). |
| **R-CS-07** | **Exposición accidental de tabla o escaneo completo (`Scan`)**. | Baja | Crítico | `CleanSlateInMemoryNoSQLAdapter` y capa de repositorio prohíben consultas sin `PK` exacta o `GSI` registrado en `TABLE_SCHEMA_REGISTRY`. |

---

## 5. ENTREGABLE 12: INSTRUCCIONES OPERATIVAS Y SIGUIENTE PASO (COMPUERTA DE APROBACIÓN)

**No ejecutar cambios en producción ni crear tablas en Catalyst todavía.** El flujo aprobado requiere:

1. **Revisión y Aprobación del Operador:** Aprobar el esquema de **5 tablas** (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`) documentado en `docs/03-nosql-data-model-and-indexes.md` y el diseño de endpoints en `docs/04-equivalence-auth-endpoints-security.md`.
2. **Fase 4.1 (Post-aprobación): Provisionamiento Controlado en Catalyst Console / CLI:**
   - Crear las 5 tablas NoSQL con sus Claves de Partición, Sort Keys, Índices Secundarios y atributo TTL `ttlEpochSec` (en `AdminInvitations` y `SystemControl`).
   - Configurar Catalyst Authentication (Email/Password + Google Workspace OAuth + dominios autorizados en Slate).
3. **Fase 4.2: Implementación del Backend Advanced I/O y Adaptador Frontend:**
   - Desplegar las funciones Advanced I/O con el SDK modular `@zcatalyst/*` validado en este POC.
   - Sustituir `src/firebase.ts` y las llamadas Firestore de `AppContext.tsx` / `adminUserService.ts` por el cliente REST hacia Advanced I/O y `catalystWebSDK.js`.
4. **Fase 4.3: Bootstrap del Primer Superadministrador y Pruebas `PASS-INTEGRATION`:**
   - Registrar y verificar el correo del operador en Catalyst Auth.
   - Ejecutar `bootstrapFirstSuperadmin` (bloqueo único `CTRL#BOOTSTRAP`).
   - Ejecutar la batería de integración contra la instancia viva de Catalyst antes de promover a producción en Slate.
