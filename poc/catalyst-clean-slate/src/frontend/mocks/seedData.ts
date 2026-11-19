/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Controlled Local In-Memory Mock Seed Data
 * NON-PERSISTENT DEVELOPMENT FIXTURES ONLY. Never represents remote Catalyst data.
 */

import type {
  AdminInvitationModel,
  AuditLogModel,
  BiometricsPayload,
  CardioSessionRecord,
  ExecutedWorkoutRecord,
  GroceryItemRecord,
  MealLogRecord,
  MealPlanRecord,
  NotificationRecord,
  PreferencesPayload,
  RecipeRecord,
  UserAccountModel,
  WorkoutRoutineRecord,
  WorkoutSetRecord,
} from '../contracts/cleanSlateModels';
import {
  calculateFoodPortion,
  computeBiometricTargets,
  getFoodById,
  getRecentDateList,
  getTodayIsoDate,
} from '../domain/nutritionEngine';
import { calculateEpley1RM, generateMesocycleProgram } from '../domain/workoutEngine';

export interface MockDatabaseState {
  users: UserAccountModel[];
  biometricsByUid: Record<string, BiometricsPayload | null>;
  preferencesByUid: Record<string, PreferencesPayload | null>;
  mealLogsByUid: Record<string, MealLogRecord[]>;
  recipesByUid: Record<string, RecipeRecord[]>;
  mealPlansByUid: Record<string, MealPlanRecord[]>;
  groceriesByUid: Record<string, GroceryItemRecord[]>;
  routinesByUid: Record<string, WorkoutRoutineRecord[]>;
  executedWorkoutsByUid: Record<string, ExecutedWorkoutRecord[]>;
  workoutSetsByUid: Record<string, WorkoutSetRecord[]>;
  cardioByUid: Record<string, CardioSessionRecord[]>;
  notificationsByUid: Record<string, NotificationRecord[]>;
  invitations: AdminInvitationModel[];
  auditLogs: AuditLogModel[];
}

function buildRecipe(
  id: string,
  name: string,
  moment: RecipeRecord['suggestedMoment'],
  servings: number,
  prepTimeMinutes: number,
  items: Array<{ foodId: string; grams: number }>,
  instructions: string
): RecipeRecord {
  let calories = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  const ingredients = items.map(item => {
    const food = getFoodById(item.foodId)!;
    const macros = calculateFoodPortion(food, item.grams);
    calories += macros.calories;
    protein += macros.protein;
    carbs += macros.carbs;
    fat += macros.fat;
    return {
      foodId: food.id,
      foodName: food.name,
      grams: item.grams,
      ...macros,
    };
  });

  return {
    id,
    name,
    suggestedMoment: moment,
    servings,
    prepTimeMinutes,
    ingredients,
    totalNutrients: {
      calories: Math.round(calories),
      protein: Math.round(protein * 10) / 10,
      carbs: Math.round(carbs * 10) / 10,
      fat: Math.round(fat * 10) / 10,
    },
    instructions,
    updatedAt: new Date().toISOString(),
  };
}

export function createInitialMockDatabase(): MockDatabaseState {
  const today = getTodayIsoDate();
  const recentDates = getRecentDateList(35, today);
  const weekDates = getRecentDateList(7, today);
  const nowIso = new Date().toISOString();

  const users: UserAccountModel[] = [
    {
      uid: 'usr_athlete_01',
      email: 'camilo.atleta@vigorcore.local',
      normalizedEmail: 'camilo.atleta@vigorcore.local',
      displayName: 'Camilo Ramírez',
      profileLabel: 'Atleta Pro',
      role: 'athlete',
      roleVersion: 1,
      sessionEpoch: 1,
      accountStatus: 'active',
      emailVerified: true,
      authProvider: 'catalyst_auth_mock',
      directorySegment: 'USER_SEG#0',
      onboardingCompleted: true,
      onboardingStep: 6,
      goal: 'hipertrofia',
      location: 'Bogotá, CO',
      createdAt: '2026-09-10T14:20:00.000Z',
      updatedAt: nowIso,
      lastSignInAt: nowIso,
    },
    {
      uid: 'usr_admin_01',
      email: 'laura.coach@vigorcore.local',
      normalizedEmail: 'laura.coach@vigorcore.local',
      displayName: 'Laura Mendoza',
      profileLabel: 'Coach',
      role: 'admin',
      roleVersion: 2,
      sessionEpoch: 1,
      accountStatus: 'active',
      emailVerified: true,
      authProvider: 'catalyst_auth_mock',
      directorySegment: 'USER_SEG#1',
      onboardingCompleted: true,
      onboardingStep: 6,
      goal: 'rendimiento',
      location: 'Medellín, CO',
      createdAt: '2026-08-22T09:15:00.000Z',
      updatedAt: nowIso,
      lastSignInAt: nowIso,
    },
    {
      uid: 'usr_superadmin_01',
      email: 'mateo.root@vigorcore.local',
      normalizedEmail: 'mateo.root@vigorcore.local',
      displayName: 'Mateo Herrera',
      profileLabel: 'Nutricionista',
      role: 'superadmin',
      roleVersion: 3,
      sessionEpoch: 1,
      accountStatus: 'active',
      emailVerified: true,
      authProvider: 'catalyst_auth_mock',
      directorySegment: 'USER_SEG#2',
      onboardingCompleted: true,
      onboardingStep: 6,
      goal: 'recomposicion',
      location: 'Madrid, ES',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: nowIso,
      lastSignInAt: nowIso,
    },
    {
      uid: 'usr_athlete_02',
      email: 'sofia.tri@vigorcore.local',
      normalizedEmail: 'sofia.tri@vigorcore.local',
      displayName: 'Sofía Vargas',
      profileLabel: 'Atleta Pro',
      role: 'athlete',
      roleVersion: 1,
      sessionEpoch: 2,
      accountStatus: 'suspended',
      emailVerified: true,
      authProvider: 'catalyst_auth_mock',
      directorySegment: 'USER_SEG#3',
      onboardingCompleted: true,
      onboardingStep: 6,
      goal: 'resistencia',
      location: 'Ciudad de México, MX',
      suspensionReason: 'Revisión temporal de cuenta de prueba',
      suspendedAt: '2026-10-28T16:00:00.000Z',
      createdAt: '2026-09-25T11:30:00.000Z',
      updatedAt: '2026-10-28T16:00:00.000Z',
      lastSignInAt: '2026-10-27T18:10:00.000Z',
    },
  ];

  const defaultBiometrics = computeBiometricTargets({
    weightKg: 76.5,
    heightCm: 178,
    age: 29,
    bodyFatPct: 14.2,
    palFactor: 1.55,
    targetDeltaKcal: 200,
    proteinPerKg: 2.0,
    fatPerKg: 0.9,
  });

  const defaultPreferences: PreferencesPayload = {
    weightUnit: 'kg',
    heightUnit: 'cm',
    timezone: 'America/Bogota',
    trainingDaysPerWeek: 4,
    sessionDurationMinutes: 65,
    trainingExperience: 'intermedio',
    availableEquipment: ['barra', 'mancuerna', 'polea', 'maquina', 'peso_corporal'],
    trainingGoal: 'hipertrofia',
    muscleFocus: ['pecho', 'espalda', 'cuadriceps'],
    mealsPerDay: 4,
    dietaryPreference: 'omnivoro',
    onboardingStep: 6,
    onboardingCompleted: true,
    notificationPreferences: {
      mealReminders: true,
      workoutAlerts: true,
      groceryAlerts: true,
      systemUpdates: true,
    },
  };

  const recipes: RecipeRecord[] = [
    buildRecipe(
      'rec_avena_proteica',
      'Bowl de Avena, Yogur Griego y Arándanos',
      'desayuno',
      1,
      10,
      [
        { foodId: 'usda-avena-hojuelas', grams: 65 },
        { foodId: 'usda-yogur-griego', grams: 220 },
        { foodId: 'usda-arandanos', grams: 80 },
        { foodId: 'usda-almendras', grams: 15 },
      ],
      'Hidratar la avena 5 min, mezclar con yogur griego frío y añadir arándanos y almendras.'
    ),
    buildRecipe(
      'rec_pollo_basmati',
      'Pechuga de Pollo a la Plancha con Basmati y Brócoli',
      'almuerzo',
      1,
      20,
      [
        { foodId: 'usda-pechuga-pollo', grams: 180 },
        { foodId: 'usda-arroz-basmati', grams: 90 },
        { foodId: 'usda-brocoli', grams: 160 },
        { foodId: 'usda-aove', grams: 10 },
      ],
      'Cocinar el arroz basmati, sellar la pechuga en plancha y saltear brócoli con AOVE al final.'
    ),
    buildRecipe(
      'rec_salmon_papa',
      'Salmón Atlántico con Papa Cocida y Aguacate',
      'cena',
      1,
      25,
      [
        { foodId: 'usda-salmon-salvaje', grams: 160 },
        { foodId: 'usda-papa-cocida', grams: 260 },
        { foodId: 'usda-espinaca', grams: 100 },
        { foodId: 'usda-aguacate', grams: 70 },
      ],
      'Hornear el salmón 12 min a 190°C y acompañar con papa hervida y ensalada de espinaca y aguacate.'
    ),
    buildRecipe(
      'rec_huevos_pavo',
      'Revuelto de Huevos con Pavo y Banano Post-Entreno',
      'merienda',
      1,
      12,
      [
        { foodId: 'usda-huevo-entero', grams: 100 },
        { foodId: 'usda-claras-huevo', grams: 120 },
        { foodId: 'usda-pavo-lomo', grams: 80 },
        { foodId: 'usda-banano', grams: 120 },
      ],
      'Cuajar claras, huevos y pavo a fuego bajo; acompañar con banano.'
    ),
  ];

  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];
  const dayNames = ['Día 1', 'Día 2', 'Día 3', 'Día 4', 'Día 5', 'Día 6', 'Día 7'];
  const days: MealPlanRecord['days'] = {};
  weekDates.forEach((dateStr, idx) => {
    days[dateStr] = {
      date: dateStr,
      dayLabel: `${dayNames[idx]} (${dateStr.slice(5)})`,
      dayType: idx % 2 === 0 ? 'alta_demanda' : idx === 6 ? 'descanso' : 'estandar',
      meals: {
        desayuno: {
          recipeId: recipes[0].id,
          recipeName: recipes[0].name,
          calories: recipes[0].totalNutrients.calories,
          protein: recipes[0].totalNutrients.protein,
          carbs: recipes[0].totalNutrients.carbs,
          fat: recipes[0].totalNutrients.fat,
          servings: 1,
        },
        almuerzo: {
          recipeId: recipes[1].id,
          recipeName: recipes[1].name,
          calories: recipes[1].totalNutrients.calories,
          protein: recipes[1].totalNutrients.protein,
          carbs: recipes[1].totalNutrients.carbs,
          fat: recipes[1].totalNutrients.fat,
          servings: 1,
        },
        cena: {
          recipeId: recipes[2].id,
          recipeName: recipes[2].name,
          calories: recipes[2].totalNutrients.calories,
          protein: recipes[2].totalNutrients.protein,
          carbs: recipes[2].totalNutrients.carbs,
          fat: recipes[2].totalNutrients.fat,
          servings: 1,
        },
      },
    };
  });

  const mealPlan: MealPlanRecord = {
    weekStart,
    weekEnd,
    label: `Semana ${weekStart} a ${weekEnd}`,
    days,
    updatedAt: nowIso,
  };

  const yesterday = weekDates[5];
  const mealLogs: MealLogRecord[] = [
    {
      id: 'meal_01',
      dateTime: `${today}T08:15`,
      moment: 'desayuno',
      name: recipes[0].name,
      description: '65g avena + 220g yogur griego + arándanos + 15g almendras',
      portion: '380 g',
      kcal: recipes[0].totalNutrients.calories,
      protein: recipes[0].totalNutrients.protein,
      carbs: recipes[0].totalNutrients.carbs,
      fat: recipes[0].totalNutrients.fat,
      source: 'Receta',
    },
    {
      id: 'meal_02',
      dateTime: `${today}T13:20`,
      moment: 'almuerzo',
      name: recipes[1].name,
      description: '180g pechuga + 90g basmati seco + 160g brócoli + 10g AOVE',
      portion: '440 g',
      kcal: recipes[1].totalNutrients.calories,
      protein: recipes[1].totalNutrients.protein,
      carbs: recipes[1].totalNutrients.carbs,
      fat: recipes[1].totalNutrients.fat,
      source: 'Plan',
    },
    {
      id: 'meal_03',
      dateTime: `${yesterday}T20:10`,
      moment: 'cena',
      name: recipes[2].name,
      description: '160g salmón + 260g papa cocida + 100g espinaca + 70g aguacate',
      portion: '590 g',
      kcal: recipes[2].totalNutrients.calories,
      protein: recipes[2].totalNutrients.protein,
      carbs: recipes[2].totalNutrients.carbs,
      fat: recipes[2].totalNutrients.fat,
      source: 'Receta',
    },
  ];

  const groceries: GroceryItemRecord[] = [
    { id: 'groc_seed_1', name: 'Pechuga de Pollo (cruda)', quantity: 1.26, unit: 'kg', department: 'carnes', status: 'pending', origin: 'plan', planKey: 'usda-pechuga-pollo__crudo', foodId: 'usda-pechuga-pollo', recipeSource: 'Plan semanal (7 tomas)' },
    { id: 'groc_seed_2', name: 'Arroz Basmati (en seco)', quantity: 630, unit: 'g', department: 'carbohidratos', status: 'bought', origin: 'plan', planKey: 'usda-arroz-basmati__seco', foodId: 'usda-arroz-basmati', recipeSource: 'Plan semanal (7 tomas)' },
    { id: 'groc_seed_3', name: 'Café Molido Espresso (Manual)', quantity: 500, unit: 'g', department: 'grasas', status: 'pending', origin: 'manual', notes: 'Agregado manualmente' },
  ];

  const mesocycleRoutine = generateMesocycleProgram({
    name: 'Torso / Pierna Periodizado (4 Días)',
    goal: 'hipertrofia',
    experience: 'intermedio',
    daysPerWeek: 4,
    durationWeeks: 6,
    availableEquipment: ['barra', 'mancuerna', 'polea', 'maquina', 'peso_corporal'],
    includeDeloadWeek: true,
  });
  mesocycleRoutine.id = 'routine_meso_4d';

  // Generate 5 weeks (35 days) of completed workouts & sets so ACWR + 1RM trends work cleanly
  const executedWorkouts: ExecutedWorkoutRecord[] = [];
  const workoutSets: WorkoutSetRecord[] = [];
  const sampleDates = [recentDates[2], recentDates[6], recentDates[10], recentDates[14], recentDates[18], recentDates[22], recentDates[26], recentDates[31], recentDates[33]];

  sampleDates.forEach((dStr, idx) => {
    const wId = `wk_hist_${idx + 1}`;
    const isUpper = idx % 2 === 0;
    const benchWeight = 80 + Math.floor(idx / 2) * 2.5;
    const squatWeight = 110 + Math.floor(idx / 2) * 2.5;
    const startedAt = `${dStr}T17:30:00.000Z`;
    const completedAt = `${dStr}T18:35:00.000Z`;

    const exId = isUpper ? 'barbell_bench_press' : 'barbell_back_squat';
    const exName = isUpper ? 'Press de Banca Plano con Barra' : 'Sentadilla Trasera con Barra';
    const mGroup = isUpper ? 'pecho' : 'cuadriceps';
    const weight = isUpper ? benchWeight : squatWeight;

    const sessionSets: WorkoutSetRecord[] = [
      {
        id: `${wId}_s0`,
        executedWorkoutId: wId,
        exerciseId: exId,
        exerciseName: exName,
        muscleGroup: mGroup,
        setNumber: 1,
        type: 'warmup',
        weightKg: Math.round(weight * 0.5),
        reps: 10,
        rir: 5,
        completed: true,
        estimated1RM: calculateEpley1RM(Math.round(weight * 0.5), 10),
        completedAt,
      },
      ...[1, 2, 3].map(n => ({
        id: `${wId}_s${n}`,
        executedWorkoutId: wId,
        exerciseId: exId,
        exerciseName: exName,
        muscleGroup: mGroup as WorkoutSetRecord['muscleGroup'],
        setNumber: n + 1,
        type: 'effective' as const,
        weightKg: weight,
        reps: 7 + (idx >= 6 ? 1 : 0),
        rir: 2,
        completed: true,
        estimated1RM: calculateEpley1RM(weight, 7 + (idx >= 6 ? 1 : 0)),
        completedAt,
      })),
    ];

    workoutSets.push(...sessionSets);

    const effTonnage = sessionSets
      .filter(s => s.type !== 'warmup')
      .reduce((acc, s) => acc + Math.round(s.weightKg * s.reps), 0);

    executedWorkouts.push({
      id: wId,
      routineId: mesocycleRoutine.id,
      routineName: mesocycleRoutine.name,
      routineDayId: isUpper ? 'd1' : 'd2',
      routineDayName: isUpper ? 'Día 1: Torso Fuerza' : 'Día 2: Pierna Fuerza',
      status: 'completed',
      startedAt,
      completedAt,
      durationSeconds: 3900,
      totalTonnageKg: effTonnage,
      totalCompletedSets: 3,
      totalReps: sessionSets.filter(s => s.type !== 'warmup').reduce((a, s) => a + s.reps, 0),
      averageRir: 2.0,
      sessionRpe: 8,
      exercisesSnapshot: [
        {
          exerciseId: exId,
          exerciseName: exName,
          muscleGroup: mGroup,
          equipment: 'barra',
          targetRepsMin: 6,
          targetRepsMax: 8,
          targetRir: 2,
          targetWeightKg: weight,
          plannedSets: 3,
        },
      ],
    });
  });

  const cardioSessions: CardioSessionRecord[] = [
    {
      id: 'cardio_01',
      date: recentDates[33],
      title: 'Caminadora Inclinada Zona 2',
      protocolType: 'zone2',
      durationMinutes: 40,
      avgHeartRate: 134,
      maxHeartRate: 141,
      zone2Minutes: 37,
      caloriesBurned: 340,
      notes: '11% inclinación @ 4.8 km/h',
    },
    {
      id: 'cardio_02',
      date: recentDates[30],
      title: 'Assault Bike HIIT (10x 20s/40s)',
      protocolType: 'hiit',
      durationMinutes: 22,
      avgHeartRate: 158,
      maxHeartRate: 181,
      zone2Minutes: 8,
      caloriesBurned: 285,
      notes: 'Intervalos anaeróbicos sin fatiga excéntrica',
    },
  ];

  const notifications: NotificationRecord[] = [
    {
      id: 'notif_01',
      title: 'Sincronización lista en Lista de Compras',
      message: 'Tu plan semanal genera artículos agrupados automáticamente en lotes <= 25 ítems.',
      category: 'compras',
      severity: 'info',
      read: false,
      createdAt: nowIso,
      actionView: 'shopping-list',
    },
    {
      id: 'notif_02',
      title: 'Progresión detectada en Press de Banca',
      message: 'Completaste 8 reps con RIR 2; disponible incremento de +2.5 kg en próxima sesión.',
      category: 'entrenamiento',
      severity: 'success',
      read: false,
      createdAt: nowIso,
      actionView: 'training-progress',
    },
    {
      id: 'notif_03',
      title: 'Recordatorio de registro vespertino',
      message: 'Registra tu cena para mantener un seguimiento completo sin valores nulos ficticios.',
      category: 'nutricion',
      severity: 'warning',
      read: true,
      createdAt: `${yesterday}T19:00:00.000Z`,
      actionView: 'nutrition-log',
    },
  ];

  const invitations: AdminInvitationModel[] = [
    {
      inviteId: 'inv_mock_01',
      emailNormalized: 'nuevo.atleta@vigorcore.local',
      targetRole: 'athlete',
      status: 'pending',
      rawTokenPreview: 'tok_demo_atleta_7f9a21',
      createdBy: 'usr_admin_01',
      createdByEmail: 'laura.coach@vigorcore.local',
      createdAt: '2026-11-10T10:00:00.000Z',
      expiresAt: '2026-12-30T23:59:59.000Z',
    },
    {
      inviteId: 'inv_mock_02',
      emailNormalized: 'coach.equipo@vigorcore.local',
      targetRole: 'admin',
      status: 'redeemed',
      createdBy: 'usr_superadmin_01',
      createdByEmail: 'mateo.root@vigorcore.local',
      createdAt: '2026-10-05T12:00:00.000Z',
      expiresAt: '2026-10-12T12:00:00.000Z',
      redeemedBy: 'usr_admin_01',
      redeemedAt: '2026-10-06T08:15:00.000Z',
    },
  ];

  const auditLogs: AuditLogModel[] = [
    {
      eventId: 'aud_seed_01',
      action: 'superadmin_bootstrapped_offline',
      actorUid: 'offline_operator_cli',
      actorRole: 'system',
      actorEmail: 'operator@vigorcore.offline',
      targetUid: 'usr_superadmin_01',
      targetEmail: 'mateo.root@vigorcore.local',
      timestamp: '2026-08-01T10:05:00.000Z',
      reason: 'Inicialización única offline (TICKET-001)',
    },
    {
      eventId: 'aud_seed_02',
      action: 'invitation_redeemed',
      actorUid: 'usr_admin_01',
      actorRole: 'admin',
      actorEmail: 'laura.coach@vigorcore.local',
      targetUid: 'usr_admin_01',
      targetEmail: 'laura.coach@vigorcore.local',
      timestamp: '2026-10-06T08:15:00.000Z',
      changes: { before: { role: 'athlete' }, after: { role: 'admin' } },
    },
    {
      eventId: 'aud_seed_03',
      action: 'account_suspended',
      actorUid: 'usr_admin_01',
      actorRole: 'admin',
      actorEmail: 'laura.coach@vigorcore.local',
      targetUid: 'usr_athlete_02',
      targetEmail: 'sofia.tri@vigorcore.local',
      timestamp: '2026-10-28T16:00:00.000Z',
      reason: 'Revisión temporal de cuenta de prueba',
    },
  ];

  const biometricsByUid: MockDatabaseState['biometricsByUid'] = {};
  const preferencesByUid: MockDatabaseState['preferencesByUid'] = {};
  const mealLogsByUid: MockDatabaseState['mealLogsByUid'] = {};
  const recipesByUid: MockDatabaseState['recipesByUid'] = {};
  const mealPlansByUid: MockDatabaseState['mealPlansByUid'] = {};
  const groceriesByUid: MockDatabaseState['groceriesByUid'] = {};
  const routinesByUid: MockDatabaseState['routinesByUid'] = {};
  const executedWorkoutsByUid: MockDatabaseState['executedWorkoutsByUid'] = {};
  const workoutSetsByUid: MockDatabaseState['workoutSetsByUid'] = {};
  const cardioByUid: MockDatabaseState['cardioByUid'] = {};
  const notificationsByUid: MockDatabaseState['notificationsByUid'] = {};

  for (const u of users) {
    biometricsByUid[u.uid] = { ...defaultBiometrics };
    preferencesByUid[u.uid] = { ...defaultPreferences };
    mealLogsByUid[u.uid] = u.uid === 'usr_athlete_01' ? [...mealLogs] : [];
    recipesByUid[u.uid] = [...recipes];
    mealPlansByUid[u.uid] = [{ ...mealPlan }];
    groceriesByUid[u.uid] = u.uid === 'usr_athlete_01' ? [...groceries] : [];
    routinesByUid[u.uid] = [{ ...mesocycleRoutine }];
    executedWorkoutsByUid[u.uid] = u.uid === 'usr_athlete_01' ? [...executedWorkouts] : [];
    workoutSetsByUid[u.uid] = u.uid === 'usr_athlete_01' ? [...workoutSets] : [];
    cardioByUid[u.uid] = u.uid === 'usr_athlete_01' ? [...cardioSessions] : [];
    notificationsByUid[u.uid] = [...notifications];
  }

  return {
    users,
    biometricsByUid,
    preferencesByUid,
    mealLogsByUid,
    recipesByUid,
    mealPlansByUid,
    groceriesByUid,
    routinesByUid,
    executedWorkoutsByUid,
    workoutSetsByUid,
    cardioByUid,
    notificationsByUid,
    invitations,
    auditLogs,
  };
}
