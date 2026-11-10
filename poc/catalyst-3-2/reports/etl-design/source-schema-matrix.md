# VIGORCORE — MATRIZ DE ESQUEMA FUENTE FIRESTORE (FASE 3.4)
## Auditoría Exhaustiva de Entidades, Modelos TypeScript, Reglas y Dependencias

**Fecha de emisión:** 9 de noviembre de 2026  
**Auditor:** Arquitecto de Software Principal & Ingeniero de Datos  
**Alcance:** Todas las entidades del dominio de VigorCore (8 activas con 73 documentos, 4 funcionales sin documentos históricos y 6 administrativas).

---

## 1. RESUMEN DEL INVENTARIO POR ENTIDAD

| # | Entidad de Dominio | Ruta en Firestore | Documentos Reales | Estado en Base de Datos |
| :-: | :--- | :--- | :---: | :---: |
| **1** | `UserProfile` | `/users/{userId}` | **5** | **ACTIVA — 100% Cobertura** |
| **2** | `BiometricConfig` | `/users/{userId}/biometrics/current` | **5** | **ACTIVA — 100% Cobertura** |
| **3** | `AthletePreferences` | `/users/{userId}/preferences/settings` | **5** | **ACTIVA — 100% Cobertura** |
| **4** | `GroceryItem` | `/users/{userId}/groceries/{id}` | **43** | **ACTIVA — U2 (21), U4 (1), U5 (21)** |
| **5** | `MealLogItem` | `/users/{userId}/mealLogs/{id}` | **4** | **ACTIVA — U4 (3), U5 (1)** |
| **6** | `AppNotification` | `/users/{userId}/notifications/{id}` | **6** | **ACTIVA — U2 (1), U4 (4), U5 (1)** |
| **7** | `WorkoutSessionRecord` | `/users/{userId}/workoutSessions/{id}` | **3** | **ACTIVA — U4 (1), U5 (2)** |
| **8** | `ExecutedWorkout` | `/users/{userId}/executedWorkouts/{id}` | **2** | **ACTIVA — U2 (2)** |
| **9** | `CardioSession` | `/users/{userId}/cardioSessions/{id}` | **0** | **FUNCIONAL — 0 Registros** |
| **10** | `Recipe` | `/users/{userId}/recipes/{id}` | **0** | **FUNCIONAL — 0 Registros** |
| **11** | `WeeklyMealPlan` | `/users/{userId}/mealPlans/{id}` | **0** | **FUNCIONAL — 0 Registros** |
| **12** | `WorkoutRoutine` | `/users/{userId}/workoutRoutines/{id}` | **0** | **FUNCIONAL — 0 Registros** |
| **13-18**| Colecciones Administrativas | `/adminUserDirectory`, `/adminRoleState`, etc. | **0** | **FUNCIONAL — 0 Registros** |
| **TOTAL** | **Universo Completo** | — | **73** | **CONCILIADO EN FASE 3.3.7** |

---

## 2. ESPECIFICACIÓN DETALLADA: 8 ENTIDADES POBLADAS (73 DOCUMENTOS)

### 2.1. `UserProfile` (Colección Raíz: 5 Documentos)
1. **Tipo TypeScript & Archivo:** `UserProfile` en `src/types/auth.ts`.
2. **Campos Obligatorios:** `id` (string), `name` (string), `email` (string), `avatarUrl` (string), `role` (`'Atleta Pro' | 'Coach' | 'Nutricionista'`), `location` (string), `joinedDate` (string ISO).
3. **Campos Opcionales:** `emailVerified` (boolean), `authProvider` (`'google.com' | 'password' | 'demo'`), `onboardingCompleted` (boolean), `onboardingStep` (number), `goal` (AthleteGoal enum).
4. **Tipos de Datos:** Strings UTF-8, booleanos nativos, números enteros.
5. **Identificador:** Firebase Auth UID (`request.auth.uid`), cadena alfanumérica de 28 caracteres.
6. **Relaciones:** Padre jerárquico de todas las subcolecciones del usuario (`biometrics`, `preferences`, `groceries`, etc.). Mapea 1:1 con Firebase Authentication y directorio admin.
7. **Validadores:** `firestore.rules:72-76` (`isValidUserProfile`): nombre de 2 a 100 caracteres, email $\le 120$ caracteres, rol restringido.
8. **Reglas de Firestore:** `match /users/{userId}`: creación restringida a rol 'Atleta Pro' con email verificado; actualización con rol y email inmutables; eliminación prohibida (`allow delete: if false`).
9. **Servicio que la Lee:** `AppContext.tsx` (`fetchUserProfile`, `onSnapshot`).
10. **Servicio que la Escribe:** `AppContext.tsx` (`registerWithEmailAndPassword`, `completeOnboarding`, `updateProfile`).
11. **Dependencias Frontend:** `AuthGuard`, barra de navegación superior, pantalla de perfil de atleta, dashboard nutricional.
12. **Riesgos de Transformación:** El campo `id` debe mantenerse consistente con el UID de origen; `role` y `email` deben normalizarse sin perder el rol deportivo asignado.

---

### 2.2. `BiometricConfig` (Subcolección: 5 Documentos, 1 por Usuario)
1. **Tipo TypeScript & Archivo:** `BiometricConfig` en `src/types/index.ts`.
2. **Campos Obligatorios:** `weightKg` (number), `heightCm` (number), `bodyFatPct` (number), `age` (number), `palFactor` (number), `targetDeltaKcal` (number), `proteinPerKg` (number), `fatPerKg` (number), `bmr` (number), `tdee` (number), `targetCalories` (number), `targetProteinG` (number), `targetFatG` (number), `targetCarbsG` (number).
3. **Campos Opcionales:** `lastAppliedPeriodization` (objeto con `phase`, `athleteGoal`, `appliedAt`, `isDietBreak`, `previousTargets`).
4. **Tipos de Datos:** Números de punto flotante de doble precisión y enteros; objeto anidado para periodización.
5. **Identificador:** Documento singleton con ID canónico estático: `'current'`. Ruta: `/users/{userId}/biometrics/current`.
6. **Relaciones:** Vinculado al `userId` del padre. Provee los requerimientos calóricos y de macronutrientes para el cálculo de menús y balance energético.
7. **Validadores:** `firestore.rules:78-84` (`isValidBiometrics`): `weightKg` entre 0 y 500, `heightCm` entre 50 y 300, `targetCalories` entre 500 y 10000.
8. **Reglas de Firestore:** `match /biometrics/{docId}`: `isOwner(userId)` estricto, creación y actualización requieren validación de rangos biométricos.
9. **Servicio que la Lee:** `AppContext.tsx` (`onSnapshot` de biometría en línea 1243).
10. **Servicio que la Escribe:** `AppContext.tsx` (`updateBiometrics`, `saveNutritionalPeriodization`).
11. **Dependencias Frontend:** Dashboard Nutricional, Configuración Nutricional, Indicadores de Progreso, Calculadora BMR/TDEE.
12. **Riesgos de Transformación:** Preservación de precisión en decimales de peso y macros (evitar redondeos involuntarios de punto flotante durante la serialización JSON).

---

### 2.3. `AthletePreferences` (Subcolección: 5 Documentos, 1 por Usuario)
1. **Tipo TypeScript & Archivo:** `AthletePreferences` en `src/types/auth.ts`.
2. **Campos Obligatorios:** `weightUnit` (`'kg' | 'lbs'`), `heightUnit` (`'cm' | 'in'`), `timezone` (string), `trainingDaysPerWeek` (number), `trainingExperience` (`'principiante' | 'intermedio' | 'avanzado'`), `availableEquipment` (string[]), `trainingGoal` (AthleteGoal), `muscleFocus` (string[]), `mealsPerDay` (number), `dietaryPreference` (`'omnivoro' | 'vegetariano' | 'vegano' | 'pescetariano' | 'sin_gluten'`), `onboardingStep` (number), `onboardingCompleted` (boolean).
3. **Campos Opcionales:** `daysPerWeek` (number), `sessionDurationMinutes` (number), `equipmentType` (string), `excludedFoods` (string[]), `updatedAt` (string ISO).
4. **Tipos de Datos:** Cadenas de caracteres, listas de strings, enums tipados, números enteros.
5. **Identificador:** Documento singleton con ID canónico estático: `'settings'`. Ruta: `/users/{userId}/preferences/settings`.
6. **Relaciones:** Define las pautas de generación para el generador de mesociclos y la planificación semanal de comidas.
7. **Validadores:** En reglas de Firestore: validación de propiedad `incoming().userId == userId`.
8. **Reglas de Firestore:** `match /preferences/{prefId}`: lectura y escritura exclusivas para el propietario autenticado.
9. **Servicio que la Lee:** `AppContext.tsx` (suscripción reactiva en línea 1342).
10. **Servicio que la Escribe:** `AppContext.tsx` (`updateAthletePreferences`, `completeOnboarding`).
11. **Dependencias Frontend:** Flujo de Onboarding, Guía y Ajustes, Generador de Rutinas, Filtros de Recetas.
12. **Riesgos de Transformación:** Los arrays vacíos (`excludedFoods: []`) deben mantenerse como arrays vacíos en Catalyst NoSQL y no serializarse como `null` o omitirse.

---

### 2.4. `GroceryItem` (Subcolección: 43 Documentos)
1. **Tipo TypeScript & Archivo:** `GroceryItem` en `src/types/index.ts`.
2. **Campos Obligatorios:** `id` (string), `name` (string), `quantity` (number), `unit` (string), `department` (`'carnes' | 'huevos' | 'verduras' | 'carbohidratos' | 'grasas'`), `status` (`'pending' | 'completed'`).
3. **Campos Opcionales:** `notes` (string), `recipeSource` (string), `nutritionInfo` (string), `origin` (`'plan' | 'manual'`), `planKey` (string), `foodId` (string), `preparationState` (string), `warning` (string), `isCustomized` (boolean), `calculatedQuantity` (number).
4. **Tipos de Datos:** Cadenas, flotantes/enteros para cantidades, booleanos.
5. **Identificador:** Cadena alfanumérica única (UUID o timestamp slug, ej: `groc_1730000000_abc`).
6. **Relaciones:** Pertenece a un usuario. Opcionalmente vincula a un alimento del catálogo (`foodId`) o a una receta (`recipeSource`).
7. **Validadores:** `firestore.rules:92-99` (`isValidGrocery`): nombre $\le 150$, cantidad $\ge 0$, departamento y status restringidos a enums.
8. **Reglas de Firestore:** `match /groceries/{groceryId}`: CRUD completo para el propietario.
9. **Servicio que la Lee:** `AppContext.tsx` (suscripción reactiva en línea 1260).
10. **Servicio que la Escribe:** `AppContext.tsx` (`addGroceryItem`, `toggleGroceryStatus`, `updateGroceryQuantity`, `removeGroceryItem`, agregación desde menú semanal).
11. **Dependencias Frontend:** Lista de Compras, Panel de Despensa, Generador de Menú Semanal.
12. **Riesgos de Transformación:** 43 documentos distribuidos en USER_002 (21), USER_004 (1) y USER_005 (21). Es fundamental preservar el estado `pending`/`completed` y los metadatos de agregación `planKey`.

---

### 2.5. `MealLogItem` (Subcolección: 4 Documentos)
1. **Tipo TypeScript & Archivo:** `MealLogItem` en `src/types/index.ts`.
2. **Campos Obligatorios:** `id` (string), `dateTime` (string ISO o formato fecha-hora), `moment` (`'desayuno' | 'almuerzo' | 'merienda' | 'cena' | 'snack'`), `title` (string), `description` (string), `portion` (string), `calories` (number), `protein` (number), `carbs` (number), `fats` (number), `source` (`'Manual' | 'Plantilla' | 'Receta'`), `verified` (boolean).
3. **Campos Opcionales:** `foodId` (string), `foodFdcId` (number), `grams` (number), `fiber` (number).
4. **Tipos de Datos:** Cadenas de texto, números con decimales, booleanos.
5. **Identificador:** Identificador único del registro (ej: `meal_1730000000_123`).
6. **Relaciones:** Pertenece al usuario. Los totales de macronutrientes impactan el consumo diario del dashboard nutricional.
7. **Validadores:** `firestore.rules:85-90` (`isValidMealLog`): momento en lista permitida, calorías entre 0 y 5000, título no vacío $\le 150$.
8. **Reglas de Firestore:** `match /mealLogs/{mealLogId}`: CRUD completo por propietario.
9. **Servicio que la Lee:** `AppContext.tsx` (suscripción en línea 1276).
10. **Servicio que la Escribe:** `AppContext.tsx` (`addMealLog`, `removeMealLog`, `duplicateMealLog`).
11. **Dependencias Frontend:** Registro de Comidas, Registro Diario, Resumen de Calorías del Día.
12. **Riesgos de Transformación:** 4 documentos presentes en USER_004 (3) y USER_005 (1). La normalización de `dateTime` debe preservar la hora local del atleta para que el registro aparezca en el día correcto en el calendario.

---

### 2.6. `AppNotification` (Subcolección: 6 Documentos)
1. **Tipo TypeScript & Archivo:** `AppNotification` en `src/types/auth.ts`.
2. **Campos Obligatorios:** `id` (string), `title` (string), `message` (string), `timestamp` (string), `category` (`'nutricion' | 'entrenamiento' | 'compras' | 'sistema'`), `read` (boolean).
3. **Campos Opcionales:** `actionPath` (string), `severity` (`'info' | 'success' | 'warning'`).
4. **Tipos de Datos:** Cadenas de caracteres, booleanos.
5. **Identificador:** ID alfanumérico único (ej: `notif_1730000000_xyz`).
6. **Relaciones:** Dirigidas al usuario propietario.
7. **Validadores:** `firestore.rules:117-123` (`isValidNotification`): título $\le 150$, mensaje $\le 500$, categoría válida, `read` booleano.
8. **Reglas de Firestore:** `match /notifications/{notificationId}`: lectura, creación, actualización (marcar leída) y eliminación por propietario.
9. **Servicio que la Lee:** `AppContext.tsx` (suscripción en línea 1326).
10. **Servicio que la Escribe:** `AppContext.tsx` (`markNotificationAsRead`, `markAllNotificationsAsRead`, `removeNotification`, generación de alertas del sistema).
11. **Dependencias Frontend:** Centro de notificaciones flotante (campana en cabecera).
12. **Riesgos de Transformación:** USER_002 (1), USER_004 (4), USER_005 (1). Deben preservarse los enlaces de navegación rápida en `actionPath`.

---

### 2.7. `WorkoutSessionRecord` (Subcolección: 3 Documentos)
1. **Tipo TypeScript & Archivo:** `WorkoutSessionRecord` en `src/types/index.ts`.
2. **Campos Obligatorios:** `id` (string), `userId` (string), `exerciseId` (string), `exerciseName` (string), `date` (string), `weightKg` (number), `reps` (number), `rir` (number), `estimated1RM` (number), `completed` (boolean), `createdAt` (string ISO).
3. **Campos Opcionales:** `executedWorkoutId` (string), `setNumber` (number), `setType` (string).
4. **Tipos de Datos:** Cadenas, números enteros y de punto flotante, booleanos.
5. **Identificador:** ID de la serie de entrenamiento (ej: `set_1730000000_1`).
6. **Relaciones:** Se vincula obligatoriamente al documento de cabecera en `executedWorkouts` mediante el campo `executedWorkoutId`. Referencia el ejercicio del catálogo (`exerciseId`).
7. **Validadores:** `firestore.rules:101-108` (`isValidWorkoutSession`) y `canModifyExistingSet()`. Requiere vinculación con sesión activa en curso (`isLinkedWorkoutActive()`).
8. **Reglas de Firestore:** `match /workoutSessions/{sessionId}`: creación y modificación condicionadas al estado `in_progress` de la cabecera ejecutada vinculada.
9. **Servicio que la Lee:** `AppContext.tsx` (suscripción en línea 1292).
10. **Servicio que la Escribe:** `AppContext.tsx` (`logWorkoutSet`, `logLiveWorkoutSet`, `syncOfflineSetsQueue`).
11. **Dependencias Frontend:** Registro de Entrenamiento en Vivo, Historial de Series, Gráficos de Progresión de 1RM.
12. **Riesgos de Transformación:** USER_004 (1) y USER_005 (2). Es crítico preservar la integridad referencial con `executedWorkoutId`.

---

### 2.8. `ExecutedWorkout` (Subcolección: 2 Documentos)
1. **Tipo TypeScript & Archivo:** `ExecutedWorkout` en `src/types/workout.ts`.
2. **Campos Obligatorios:** `id` (string), `userId` (string), `routineName` (string), `routineDayName` (string), `status` (`'in_progress' | 'completed' | 'abandoned'`), `startedAt` (string ISO), `durationSeconds` (number), `totalTonnageKg` (number), `totalCompletedSets` (number), `totalReps` (number), `exercisesSnapshot` (LiveExerciseSession[]).
3. **Campos Opcionales:** `routineId` (string), `routineDayId` (string), `completedAt` (string ISO), `averageRir` (number o null), `sessionRpe` (number), `notes` (string).
4. **Tipos de Datos:** Cadenas, números enteros, flotantes para tonelaje, arrays de objetos con las series planificadas y ejecutadas.
5. **Identificador:** ID alfanumérico único de la sesión (ej: `workout_1730000000_abc`).
6. **Relaciones:** Cabecera contenedora del entrenamiento. Es el destino referencial de las series en `workoutSessions`.
7. **Validadores:** `firestore.rules:147-155` (`isValidExecutedWorkout`): status restringido, tonelaje $\ge 0$, duración $\ge 0$, sets $\ge 0$.
8. **Reglas de Firestore:** `match /executedWorkouts/{workoutId}`: creación obligatoria en `'in_progress'`; eliminación prohibida (`allow delete: if false`).
9. **Servicio que la Lee:** `AppContext.tsx` (suscripción en línea 1420).
10. **Servicio que la Escribe:** `AppContext.tsx` (`startLiveWorkout`, `finishLiveWorkout`, `cancelLiveWorkout`).
11. **Dependencias Frontend:** Temporizador de entrenamiento en vivo, Progreso del Entrenamiento, Resumen de Tonelaje Semanal.
12. **Riesgos de Transformación:** 2 documentos pertenecientes a USER_002. El snapshot anidado `exercisesSnapshot` contiene matrices de series completas que deben deserializarse y mantenerse intactas sin truncar arrays anidados.

---

## 3. ESPECIFICACIÓN DETALLADA: 4 ENTIDADES FUNCIONALES (0 DOCUMENTOS EN BD)

Aunque no existen documentos históricos en la base de datos de producción para estas colecciones, la arquitectura de VigorCore en `src/` implementa su lógica de negocio completa y el backend en Zoho Catalyst NoSQL debe prever su soporte integral:

### 3.1. `CardioSession` (Ruta: `/users/{userId}/cardioSessions/{id}`)
- **Modelo:** `CardioSession` en `src/types/index.ts`.
- **Campos:** `id`, `date`, `title`, `details`, `durationMinutes`, `avgHr`, `maxHr`, `zone2Minutes`, `zone2Percentage`, `caloriesBurned`, `device`.
- **Reglas:** `firestore.rules:110-115` (`isValidCardioSession`).
- **Servicio:** `AppContext.tsx:1307` (`saveCardioSession`).
- **Destino NoSQL:** Tabla `UserData` con `SK = CARDIO#<date>#<id>`.

### 3.2. `Recipe` (Ruta: `/users/{userId}/recipes/{id}`)
- **Modelo:** `Recipe` en `src/types/nutrition.ts`.
- **Campos:** `id`, `userId`, `name`, `description`, `suggestedMoment`, `servings`, `prepTimeMinutes`, `ingredients` (array con `foodId`, `grams`, `nutrients`), `totalNutrients`, `instructions`, `imageUrl`, `createdAt`, `updatedAt`.
- **Reglas:** `firestore.rules:125-131` (`isValidRecipe`).
- **Servicio:** `AppContext.tsx:1367` (`saveCustomRecipe`, `deleteCustomRecipe`).
- **Destino NoSQL:** Tabla `UserData` con `SK = RECIPE#<id>`.

### 3.3. `WeeklyMealPlan` (Ruta: `/users/{userId}/mealPlans/{id}`)
- **Modelo:** `WeeklyMealPlan` en `src/types/nutrition.ts`.
- **Campos:** `id`, `userId`, `weekStart` (YYYY-MM-DD), `weekEnd` (YYYY-MM-DD), `label`, `days` (objeto con 7 días y comidas planificadas), `createdAt`, `updatedAt`.
- **Reglas:** `firestore.rules:133-137` (`isValidMealPlan`).
- **Servicio:** `AppContext.tsx:1383` (`saveWeeklyMealPlan`, `generateSmartMealPlan`).
- **Destino NoSQL:** Tabla `UserData` con `SK = PLAN#<weekStart>`.

### 3.4. `WorkoutRoutine` (Ruta: `/users/{userId}/workoutRoutines/{id}`)
- **Modelo:** `WorkoutRoutine` en `src/types/workout.ts`.
- **Campos:** `id`, `userId`, `name`, `description`, `goal`, `frequencyDays`, `days` (array de `RoutineDay` con `exercises`), `isDefault`, `createdAt`, `updatedAt`.
- **Reglas:** `firestore.rules:139-145` (`isValidWorkoutRoutine`).
- **Servicio:** `AppContext.tsx:1401` (`saveWorkoutRoutine`, `setDefaultRoutine`, `generateMesocycleRoutine`).
- **Destino NoSQL:** Tabla `UserData` con `SK = ROUTINE#<id>`.

---

## 4. ESPECIFICACIÓN DETALLADA: 6 ENTIDADES ADMINISTRATIVAS (0 DOCUMENTOS)

| Entidad | Modelo TypeScript | Ruta Firestore | Propósito en Arquitectura | Destino en Catalyst |
| :--- | :--- | :--- | :--- | :--- |
| `adminUserDirectory` | `AdminUserSummary` (`admin.ts`) | `/adminUserDirectory/{uid}` | Directorio centralizado de usuarios para gestión sin recorrer `/users` | Tabla `AdminDirectory` (`PK = ADMIN_USER#<uid>`) |
| `adminRoleState` | `AdminRoleStateRecord` (`admin.ts`) | `/adminRoleState/{uid}` | Estado autoritativo de roles anti-stale-tokens | Tabla `AdminDirectory` (`PK = ROLE_STATE#<uid>`) |
| `adminInvitations` | `AdminInvitation` (`admin.ts`) | `/adminInvitations/{id}` | Invitaciones seguras por correo con token hash | Tabla `AdminInvitations` (`PK = INVITE#<id>`) |
| `accountAccess` | `AccountAccessRecord` (`admin.ts`) | `/accountAccess/{uid}` | Control de suspensión y revocación inmediata de sesiones | Tabla `AdminDirectory` (`PK = ACCESS#<uid>`) |
| `adminAuditLogs` | `AdminAuditLog` (`admin.ts`) | `/adminAuditLogs/{id}` | Registro inmutable de eventos de seguridad y gobernanza | Tabla `AuditLogs` (`PK = AUDIT#<timestamp>#<id>`) |
| `adminInvitationOperations` | `AdminInvitationOperation` (`admin.ts`) | `/adminInvitationOperations/{opId}`| Control de concurrencia y orquestación de sagas | Tabla `SystemLocks` (`PK = SAGA#<opId>`) |

---

## 5. CONCLUSIÓN DE AUDITORÍA DE ESQUEMA

El modelo de datos de VigorCore se caracteriza por una jerarquía clara:
1. Una entidad raíz de identidad (`users`).
2. Colecciones privadas centradas exclusivamente en el atleta (`users/{uid}/*`).
3. Alta consistencia relacional interna (las series dependen de las sesiones ejecutadas; los alimentos de la lista de compras provienen de planes de nutrición).
4. El mapeo hacia Zoho Catalyst NoSQL debe estructurarse para garantizar que estas 12 entidades mantengan exactamente los mismos contratos tipados que el frontend de React 19 consume actualmente a través de `AppContext.tsx`.
