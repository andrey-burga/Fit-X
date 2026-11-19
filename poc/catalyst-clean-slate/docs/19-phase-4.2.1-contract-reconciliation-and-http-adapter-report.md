# FASE 4.2.1 — RECONCILIACIÓN DE CONTRATOS, VALIDACIÓN FUNCIONAL Y ADAPTADOR HTTP CLEAN-SLATE

**Alcance:** Exclusivo dentro de `poc/catalyst-clean-slate/`  
**Estado:** `COMPLETADO EN ENTORNO AISLADO (SIN CONEXIÓN REMOTA CATALYST / SIN DOMINIO / SIN SLATE DE PRODUCCIÓN)`

---

## 1. Reconciliación A — Inventario Exacto de Vistas del Frontend Raíz (`/src/views/` y `/src/App.tsx`)

Auditoría directa de archivos en `/src/views/` y `/src/App.tsx`:

1. El proyecto raíz contiene **exactamente 18 archivos de vista** en `/src/views/`:
   - **Acceso y Onboarding (3):** `LoginView.tsx`, `AcceptInvitationView.tsx`, `OnboardingView.tsx`.
   - **Nutrición (7):** `NutritionalDashboardView.tsx`, `NutritionalConfigView.tsx`, `WeeklyMenuView.tsx`, `MealLogView.tsx`, `DailyLogView.tsx`, `ShoppingListView.tsx`, `SubstitutionsView.tsx`.
   - **Entrenamiento, Perfil y Sistema (7):** `WorkoutRoutineView.tsx`, `WorkoutLogView.tsx`, `CardioHiitView.tsx`, `TrainingProgressView.tsx`, `MesocyclePlanningView.tsx`, `AthleteProfileView.tsx`, `GuideSettingsView.tsx`.
   - **Administración (1):** `AdminUsersView.tsx`.
2. Adicionalmente, `/src/App.tsx` monta **8 modales/drawers globales** (`RegisterMealDrawer`, `ToastNotification`, `AuthModal`, `NotificationPanel`, `NotificationPreferencesModal`, `GlobalSearchModal`, `RecipeModal`, `AssignRecipeModal`), que **no son vistas**.
3. **Discrepancias resueltas respecto a documentación previa:**
   - `docs/02-functional-inventory.md` tenía conteos textuales invertidos (`"Nutrición (6)"` con 7 elementos y `"Entrenamiento y Perfil (8)"` con 7 elementos), aunque la suma sí era `3 + 7 + 7 + 1 = 18`.
   - El resumen anterior de Fase 4.2 usó nombres lógicos inexistentes (`ProfileView`, `PeriodizationView`, `RecipesView`, `WorkoutsView`, `ProgressView`) y mezcló `NotificationPanel`/`NotificationPreferencesModal` dentro de los conteos.
   - En `poc/catalyst-clean-slate/src/frontend/views/`, las 18 vistas raíz + el centro de notificaciones se mantienen consolidadas de forma intencional en **13 vistas limpias** (sin `LoginView` ni `OnboardingView` separados porque Pre-Auth vive en `PreAuthContractsView` y Onboarding como asistente paso-a-paso dentro de `ProfileBiometricsView`).

---

## 2. Reconciliación B — Contratos API (`30` Catálogo vs `26` UI Fase 4.2 vs `CleanSlateApiDispatcher`)

Se compararon línea por línea `CLEAN_SLATE_ENDPOINT_CATALOG` (`src/routes/apiRouterSchema.ts`), `CleanSlateApiDispatcher.dispatch()`, `AthleteDataService`, `AdminGovernanceService` y `CLEAN_SLATE_UI_ENDPOINT_MAP`.

### 2.1 Clasificación exacta de los 30 endpoints del Catálogo (`docs/17` §5 reconciliado)

| Grupo | Cantidad | Estado en `CleanSlateApiDispatcher` | Detalle |
| --- | ---: | --- | --- |
| Paridad exacta (`wired_match`) | **14** | Implementado con mismo método + path | `POST /auth/session/{bootstrap-profile,exchange,refresh,logout,revoke}`, `GET /auth/me`, `GET /athlete/workspace`, `PATCH /athlete/profile`, `POST /invitations/redeem`, `GET /admin/users`, `GET /admin/stats`, `GET /admin/users/:uid`, `POST /admin/invitations`, `GET /admin/audit-logs`. |
| Desfase de ruta Admin (`wired_path_mismatch`) | **4** | Implementado con ruta plana y parámetro en body | Catálogo: `/admin/invitations/:inviteId/revoke`, `/admin/users/:uid/status`, `/admin/users/:uid/role`, `/admin/users/:uid/password-reset`. Dispatcher actual: `/admin/invitations/revoke`, `/admin/users/set-status`, `/admin/users/set-role`, `/admin/users/password-reset`. |
| Servicio listo / pendiente Dispatcher (`service_ready_not_wired_in_dispatcher`) | **12** | Lógica implementada en `AthleteDataService`, falta cablear en `dispatch()` | `POST /athlete/onboarding/complete`, `POST/GET /athlete/meals`, `PUT /athlete/groceries/sync`, `POST /athlete/workouts/{start,:id/sets,:id/complete}`, `POST /athlete/cardio`, `POST /athlete/notifications`, `PUT /athlete/recipes/:recipeId`, `PUT /athlete/meal-plans/:weekStart`, `PUT /athlete/routines/:routineId`. |
| **Total Catálogo** | **30** | — | — |

### 2.2 Los 4 endpoints omitidos previamente en Fase 4.2 (`26 → 30`)

`CLEAN_SLATE_UI_ENDPOINT_MAP` de Fase 4.2 omitía 4 rutas del catálogo; ahora se incluyen las 30 rutas completas con `dispatcherStatus`:
1. `POST /api/v1/auth/session/revoke`
2. `GET /api/v1/auth/me`
3. `GET /api/v1/athlete/meals`
4. `POST /api/v1/admin/users/:uid/password-reset`

### 2.3 Métodos de interfaz frontend sin endpoint en el Catálogo (`501 UNSUPPORTED_CONTRACT_ENDPOINT`)

No se inventaron rutas nuevas para ocultar vacíos. El adaptador HTTP falla explícitamente con `501 UNSUPPORTED_CONTRACT_ENDPOINT` (sin fallback silencioso a mock) en:
- `IAthleteWorkspaceRepository`: `saveBiometrics`, `savePreferences`, `deleteMeal`, `deleteRecipe`, `toggleGroceryStatus`, `addManualGrocery`, `deleteGrocery`, `setDefaultRoutine`, `deleteCardioSession`, `markNotificationRead`, `markAllNotificationsRead`.
- `IAdminGovernanceRepository`: `listInvitations` (`GET /api/v1/admin/invitations` no existe aún en `CLEAN_SLATE_ENDPOINT_CATALOG` ni en `AdminGovernanceService`).

---

## 3. Reconciliación C y D — Copys de Persistencia y Catálogos Locales Simulados

1. El código raíz (`/src/components/Sidebar.tsx`, `/src/views/NutritionalConfigView.tsx`) conserva referencias heredadas a `"Firestore Live"`, `"Excel"` y `"Supabase"` **sin tocar** por aislamiento estricto.
2. Dentro de `poc/catalyst-clean-slate/src/frontend/`:
   - `AppShell.tsx` y `WorkspaceContext.tsx` muestran dinámicamente si opera `InMemoryCleanSlateRepository` (**memoria RAM local**) o `CatalystHttp*Repository` (**adaptador HTTP `/api/v1/*`**), ocultando el simulador de fallos mock cuando hay adaptador HTTP activo y sin usar mock como fallback silencioso ante errores HTTP.
   - `GlobalSearchDialog.tsx`, `NutritionLogView.tsx`, `RecipesSubstitutionsView.tsx`, `ShoppingListView.tsx`, `ProfileBiometricsView.tsx`, `NotificationsCenterView.tsx`, `AdminConsoleView.tsx` y `PreAuthContractsView.tsx` declaran explícitamente que:
     - El catálogo de alimentos (`FOOD_CATALOG`), el catálogo de ejercicios (`EXERCISE_CATALOG`) y las recetas semilla son **catálogos estáticos locales simulados** (sin llamadas externas a USDA ni APIs de terceros).
     - En desarrollo local los cambios viven **en memoria RAM** y no persisten en Catalyst ni emiten cookies reales.

---

## 4. Arquitectura del Adaptador HTTP (`src/frontend/adapters/`)

1. **`CatalystHttpTransport` (`httpTransport.ts`)**:
   - Exige `baseUrl` inyectable explícito (`MISSING_BASE_URL` si falta; sin dominio por defecto como `vigorcore.lat`).
   - Restringe rutas a `/api/v1/*` (`INVALID_CONTRACT_PATH`).
   - Envía `credentials: 'include'` en todas las peticiones para compatibilidad futura con `__Host-vigor_session`.
   - Inyecta `X-Vigor-CSRF` en métodos mutantes únicamente mediante `ICsrfTokenProvider` desacoplado (nunca inventa tokens).
   - Parsea `204` / `Content-Length: 0` / cuerpos vacíos, detecta HTML o JSON inválido (`502 INVALID_JSON_RESPONSE`), propaga `AbortSignal` (`408 REQUEST_ABORTED`) y fallos de red (`503 NETWORK_ERROR`), y mapea `400/401/403/404/409/413/429/5xx` a `CleanSlateRepositoryError` sin fallback silencioso a mock.
2. **`CatalystHttpAthleteRepository` (`CatalystHttpAthleteRepository.ts`)**:
   - Ejecuta validadores de dominio antes de enviar red (`validateProfileSelfUpdateInput`, `validateMealLogInput`, `validateRecipeInput`, `validateMealPlanInput`, `validateWorkoutRoutineInput`, `validateWorkoutSetInput`, `validateCardioInput`, `validateNotificationInput`, `validateGroceryInput`, `validateBiometricsInput`).
   - Particiona `syncGroceries` en lotes secuenciales de `<= 25` ítems por llamada a `PUT /api/v1/athlete/groceries/sync`.
   - Expone `queryMealsByDateRange` conectado a `GET /api/v1/athlete/meals`.
3. **`CatalystHttpAdminRepository` (`CatalystHttpAdminRepository.ts`)**:
   - Separado estrictamente del repositorio de atleta.
   - Configurable mediante `routeCompatibilityMode: 'catalog_canonical' | 'dispatcher_current'` (por defecto `'catalog_canonical'`, usando `'dispatcher_current'` solo al probar el `CleanSlateApiDispatcher` actual hasta autorizar la unificación de rutas).
