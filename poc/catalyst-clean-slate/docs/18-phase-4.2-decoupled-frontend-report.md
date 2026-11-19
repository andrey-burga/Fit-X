# VigorCore — Fase 4.2: Desarrollo Funcional del Frontend Desacoplado de Catalyst

## 1. Objetivo y Frontera de Aislamiento

Este entregable consolida el desarrollo funcional del frontend desacoplado de VigorCore dentro de `poc/catalyst-clean-slate/`, permitiendo avanzar en UX, lógica de dominio y contratos tipados sin esperar la confirmación de soporte de Zoho Catalyst y **sin tocar** la aplicación raíz publicada en Slate (`/src/**`, `/package.json`, `/vite.config.ts`, `/index.html`, Firebase/Firestore, DNS ni recursos remotos).

## 2. Auditoría Inicial del Frontend Raíz (18 Vistas → 13 Vistas Consolidadas)

| Categoría | Vista Raíz (`/src/views/`) | Resolución en Clean-Slate (`src/frontend/views/`) | Motivo de Cambio |
|---|---|---|---|
| Auth / Onboarding | `LoginView`, `AcceptInvitationView`, `OnboardingView` | `PreAuthContractsView` + Wizard embebido en `ProfileBiometricsView` | Desacoplamiento total de credenciales/cookies reales hasta fase auth remota |
| Resumen / Perfil | `DashboardView`, `ProfileView` | `DashboardView`, `ProfileBiometricsView` | Conservión `kg/lbs`, `cm/in`, validación de campos inmutables |
| Nutrición | `DailyLogView`, `MealLogView` | **Consolidado en** `NutritionLogView` | Eliminación de duplicación y de matriz estática hardcoded (`Lun 21`..`Dom 27`) |
| Planificación | `MealPlanView`, `PeriodizationView` | **Consolidado en** `MealPlanPeriodizationView` | Diet Break opcional explícito y paridad 4/4/9 integrados |
| Recetas / Sustituciones | `RecipesView`, `SubstitutionsView` | **Consolidado en** `RecipesSubstitutionsView` | Eliminación de tarjetas estáticas con URLs hardcoded; cálculo isoproteico/isoglucídico/isocalórico vivo + techo 350 KB |
| Compras | `ShoppingListView` | `ShoppingListView` | Sincronización idempotente con conteo de lotes `<= 25` ítems |
| Entrenamiento | `WorkoutsView`, `ProgressView`, `CardioHiitView` | `RoutinesAndMesocycleView`, `LiveWorkoutView`, `TrainingProgressView`, `CardioHiitView` | Separación de planificación vs. ejecución `in_progress -> completed/abandoned` inmutable y exclusión estricta de `warmup` |
| Sistema | Modales `NotificationPanel` / `NotificationPreferencesModal`, `GuideSettingsView` | `NotificationsCenterView`, `PreAuthContractsView` | Ruta dedicada para notificaciones; eliminación de referencias a `Supabase` y `Firestore Live` |
| Administración | `AdminUsersView` | `AdminConsoleView` | Consola RBAC estrictamente local con bloqueo Fase 4.0.2 para Superadmin |

## 3. Arquitectura Desacoplada (`IAthleteWorkspaceRepository` / `IAdminGovernanceRepository`)

- **Contratos seguros para navegador:** `src/frontend/contracts/cleanSlateModels.ts` espeja las 5 tablas y los 11 `UserDataEntityType` de `src/types/cleanSlate.ts` sin importar módulos `node:*`.
- **Validadores alineados 1:1:** `src/frontend/domain/validators.ts` replica límites biométricos, fechas, cardio, techo de 350 KB (400 KB duro), campos de seguridad inmutables y bloqueos de `ExecutedWorkout` inmutable.
- **Motores puros de dominio:**
  - `src/frontend/domain/nutritionEngine.ts`: BMR Mifflin-St Jeor, paridad diofántica 4/4/9, periodización adaptativa, sustituciones USDA y sincronización idempotente de compras.
  - `src/frontend/domain/workoutEngine.ts`: 1RM Epley, exclusión de `warmup`, ACWR 7d/28d con guarda `>= 21 días`, doble progresión RIR, generador de mesociclos 4/6/8 semanas y exportación CSV.
- **Repositorio Mock Local:** `src/frontend/mocks/InMemoryCleanSlateRepository.ts` implementa las interfaces de repositorio en memoria con `isLocalDevMock = true`, simulación de latencia/errores (`network_error`) y estado vacío (`empty_workspace`).

## 4. Sustitución Futura por Zoho Catalyst Advanced I/O

Para conectar el backend real en una fase posterior, basta con implementar `CatalystHttpAthleteRepository` y `CatalystHttpAdminRepository` cumpliendo exactamente `IAthleteWorkspaceRepository` e `IAdminGovernanceRepository` e inyectarlos en `<CleanSlateApp athleteRepository={...} adminRepository={...} />`, sin reescribir ninguna vista React ni los motores de dominio.

## 5. Estado No Implementado Intencionalmente en Fase 4.2

- Autenticación real con Zoho Catalyst Authentication ni cookies `__Host-vigor_session`.
- Cliente HTTP hacia `/api/v1/*` ni cabeceras CSRF reales.
- Persistencia remota en Catalyst NoSQL ni mutaciones reales de rol Superadmin.
