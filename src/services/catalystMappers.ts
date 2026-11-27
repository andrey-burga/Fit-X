/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Domain Mappers between Main Frontend (`src/types/*`)
 * and Zoho Catalyst Clean-Slate Contracts (`cleanSlateModels.ts`).
 */

import type {
  BiometricsPayload,
  CardioSessionRecord,
  EquipmentRequired as CleanEquipmentRequired,
  ExecutedWorkoutRecord,
  GroceryItemRecord,
  MealLogRecord,
  MealPlanRecord,
  MuscleGroup as CleanMuscleGroup,
  NotificationRecord,
  PreferencesPayload,
  RecipeRecord,
  UserAccountModel,
  ViewId,
  WorkoutRoutineRecord,
  WorkoutSetRecord,
} from '../../poc/catalyst-clean-slate/src/frontend/contracts/cleanSlateModels';
import type {
  BiometricConfig,
  CardioSession,
  GroceryDepartment,
  GroceryItem,
  MealLogItem,
  MealMoment,
  MealMomentPartition,
  NavigationPath,
  WorkoutSessionRecord,
} from '../types';
import type {
  AppNotification,
  AthleteGoal,
  AthletePreferences,
  NotificationPreferences,
  UserProfile,
} from '../types/auth';
import type { UserRole } from '../types/admin';
import type { DayMealPlan, Recipe, RecipeIngredient, WeeklyMealPlan } from '../types/nutrition';
import type {
  EquipmentRequired,
  ExecutedWorkout,
  LiveExerciseSession,
  LiveWorkoutSet,
  MuscleGroup,
  PlannedExerciseConfig,
  RoutineDay,
  WorkoutRoutine,
  WorkoutSetType,
} from '../types/workout';
import type { MesocycleRoutine } from '../types/mesocycle';
import { getExerciseById } from '../data/exerciseCatalog';
import { getTodayLocalDateString, getWeekStartEnd } from './dateUtils';

export const DEFAULT_AVATAR_URL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuC3zYYPzD9Eg1BywRiP3hzgyQ9n12VK96fEiziXHs-SE5lgZckF16Ex8AnLcoP5xUVQI23OuQeC85_8rc9LQh3Mno4oDFfLAbBhhd-74a0Ecng6QNtWpExkHXOQK3860qtFG_389p9yG0FUrVX5ddZJNrZijrnRwe_fFwtE2CwikU5Ei4pARC6kHkQUykjTboNxyLz-v-3LFdaY9XK72BdUBEqTBZUv94DHR1WdVYUO';

const CLEAN_MUSCLE_GROUPS: ReadonlySet<CleanMuscleGroup> = new Set([
  'pecho',
  'espalda',
  'hombros',
  'biceps',
  'triceps',
  'cuadriceps',
  'isquios',
  'gluteos',
  'gemelos',
  'core',
]);

const CLEAN_EQUIPMENTS: ReadonlySet<CleanEquipmentRequired> = new Set([
  'barra',
  'mancuerna',
  'polea',
  'maquina',
  'peso_corporal',
  'bandas',
]);

const FORBIDDEN_PROFILE_KEYS = new Set([
  'role',
  'roleVersion',
  'sessionEpoch',
  'accountStatus',
  'validAfterSec',
  'uid',
  'pk',
  'sk',
  'email',
  'normalizedEmail',
  'emailVerified',
  'suspendedAt',
  'suspendedBy',
]);

export function toCleanMuscleGroup(group?: string): CleanMuscleGroup {
  if (group && CLEAN_MUSCLE_GROUPS.has(group as CleanMuscleGroup)) {
    return group as CleanMuscleGroup;
  }
  return 'pecho';
}

export function toCleanEquipment(eq?: string): CleanEquipmentRequired {
  if (eq && CLEAN_EQUIPMENTS.has(eq as CleanEquipmentRequired)) {
    return eq as CleanEquipmentRequired;
  }
  if (eq === 'kettlebell') return 'mancuerna';
  return 'barra';
}

export function resolveUserRole(actorOrProfile: Record<string, unknown> | null | undefined): UserRole {
  const role = actorOrProfile?.role;
  if (role === 'superadmin' || role === 'admin') return role;
  return 'athlete';
}

export function fromCleanProfile(model: UserAccountModel): UserProfile {
  return {
    id: model.uid,
    name: model.displayName || 'Atleta Vigor',
    email: model.email || '',
    avatarUrl: model.avatarUrl || DEFAULT_AVATAR_URL,
    role: model.profileLabel || 'Atleta Pro',
    location: model.location || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Bogotá (UTC-5)',
    joinedDate: model.createdAt
      ? new Date(model.createdAt).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
      : 'Octubre 2024',
    emailVerified: Boolean(model.emailVerified),
    authProvider: model.authProvider === 'google.com' ? 'google.com' : 'password',
    onboardingCompleted: Boolean(model.onboardingCompleted),
    onboardingStep: typeof model.onboardingStep === 'number' ? model.onboardingStep : 1,
    goal: (model.goal as AthleteGoal | undefined) || 'ganancia_muscular',
  };
}

export function buildProfileSelfPatch(
  updates: Partial<UserProfile> & { onboardingStep?: number; onboardingCompleted?: boolean }
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (typeof updates.name === 'string' && updates.name.trim()) {
    patch.displayName = updates.name.trim().slice(0, 120);
  }
  if (updates.role === 'Atleta Pro' || updates.role === 'Coach' || updates.role === 'Nutricionista') {
    patch.profileLabel = updates.role;
  }
  if (typeof updates.location === 'string') {
    patch.location = updates.location.slice(0, 160);
  }
  if (typeof updates.avatarUrl === 'string') {
    const trimmed = updates.avatarUrl.trim();
    if (trimmed === '' || (trimmed.startsWith('https://') && trimmed.length <= 512)) {
      patch.avatarUrl = trimmed;
    }
  }
  if (typeof updates.goal === 'string' && updates.goal.trim()) {
    patch.goal = updates.goal.trim().slice(0, 80);
  }
  if (typeof updates.onboardingStep === 'number' && Number.isFinite(updates.onboardingStep)) {
    patch.onboardingStep = Math.max(1, Math.min(6, Math.round(updates.onboardingStep)));
  }
  if (typeof updates.onboardingCompleted === 'boolean') {
    patch.onboardingCompleted = updates.onboardingCompleted;
  }

  for (const key of Object.keys(patch)) {
    if (FORBIDDEN_PROFILE_KEYS.has(key)) {
      delete patch[key];
    }
  }

  return patch;
}

export function fromCleanBiometrics(payload: BiometricsPayload): BiometricConfig {
  return {
    weightKg: payload.weightKg,
    heightCm: payload.heightCm,
    bodyFatPct: payload.bodyFatPct,
    age: payload.age,
    palFactor: payload.palFactor,
    targetDeltaKcal: payload.targetDeltaKcal,
    proteinPerKg: payload.proteinPerKg,
    fatPerKg: payload.fatPerKg,
    bmr: payload.bmr,
    tdee: payload.tdee,
    targetCalories: payload.targetCalories,
    targetProteinG: payload.targetProteinG,
    targetFatG: payload.targetFatG,
    targetCarbsG: payload.targetCarbsG,
    lastAppliedPeriodization: payload.lastAppliedPeriodization,
  };
}

export function toCleanBiometrics(bio: BiometricConfig): BiometricsPayload {
  return {
    weightKg: Math.max(20, Math.min(350, Number(bio.weightKg) || 74.5)),
    heightCm: Math.max(90, Math.min(260, Number(bio.heightCm) || 178)),
    bodyFatPct: Math.max(2, Math.min(70, Number(bio.bodyFatPct) || 15.2)),
    age: Math.max(12, Math.min(120, Math.round(Number(bio.age) || 30))),
    palFactor: Math.max(1.0, Math.min(2.5, Number(bio.palFactor) || 1.55)),
    targetDeltaKcal: Math.max(-2000, Math.min(2000, Math.round(Number(bio.targetDeltaKcal) || 0))),
    proteinPerKg: Math.max(0.5, Math.min(4.5, Number(bio.proteinPerKg) || 2.0)),
    fatPerKg: Math.max(0.3, Math.min(3.0, Number(bio.fatPerKg) || 0.8)),
    bmr: Math.max(500, Math.min(10000, Math.round(Number(bio.bmr) || 1700))),
    tdee: Math.max(500, Math.min(15000, Math.round(Number(bio.tdee) || 2600))),
    targetCalories: Math.max(500, Math.min(15000, Math.round(Number(bio.targetCalories) || 2200))),
    targetProteinG: Math.round(Number(bio.targetProteinG) || 150),
    targetFatG: Math.round(Number(bio.targetFatG) || 60),
    targetCarbsG: Math.max(0, Math.round(Number(bio.targetCarbsG) || 250)),
    ...(bio.lastAppliedPeriodization
      ? {
          lastAppliedPeriodization: {
            ...bio.lastAppliedPeriodization,
            athleteGoal: bio.lastAppliedPeriodization.athleteGoal as AthleteGoal,
          },
        }
      : {}),
  };
}

export type ExtendedPreferencesPayload = PreferencesPayload & {
  mealPartition?: MealMomentPartition;
  excludedFoods?: string[];
  soundEnabled?: boolean;
  pushEnabled?: boolean;
};

export function toCleanPreferences(
  athletePrefs: AthletePreferences,
  notifPrefs: NotificationPreferences,
  mealPartition?: MealMomentPartition
): ExtendedPreferencesPayload {
  return {
    weightUnit: athletePrefs.weightUnit || 'kg',
    heightUnit: athletePrefs.heightUnit || 'cm',
    timezone: athletePrefs.timezone || 'America/Bogota',
    trainingDaysPerWeek: athletePrefs.trainingDaysPerWeek || athletePrefs.daysPerWeek || 4,
    sessionDurationMinutes: athletePrefs.sessionDurationMinutes || 60,
    trainingExperience: athletePrefs.trainingExperience || 'intermedio',
    availableEquipment: (athletePrefs.availableEquipment || ['barra', 'mancuerna', 'polea', 'maquina', 'peso_corporal'])
      .map(eq => toCleanEquipment(eq)),
    trainingGoal: athletePrefs.trainingGoal || 'hipertrofia',
    muscleFocus: (athletePrefs.muscleFocus || ['pecho', 'espalda', 'cuadriceps', 'hombros'])
      .map(mg => toCleanMuscleGroup(mg)),
    mealsPerDay: athletePrefs.mealsPerDay || 4,
    dietaryPreference: athletePrefs.dietaryPreference || 'omnivoro',
    onboardingStep: Math.max(1, Math.min(6, athletePrefs.onboardingStep || 1)),
    onboardingCompleted: Boolean(athletePrefs.onboardingCompleted),
    notificationPreferences: {
      mealReminders: Boolean(notifPrefs.mealReminders),
      workoutAlerts: Boolean(notifPrefs.workoutAlerts),
      groceryAlerts: Boolean(notifPrefs.groceryAlerts),
      systemUpdates: Boolean(notifPrefs.systemSync),
    },
    ...(mealPartition ? { mealPartition } : {}),
    ...(athletePrefs.excludedFoods ? { excludedFoods: athletePrefs.excludedFoods } : {}),
    soundEnabled: Boolean(notifPrefs.soundEnabled),
    pushEnabled: Boolean(notifPrefs.pushEnabled),
  };
}

export function fromCleanPreferences(
  raw: PreferencesPayload,
  fallbackAthlete: AthletePreferences,
  fallbackNotif: NotificationPreferences,
  fallbackPartition: MealMomentPartition
): {
  athletePreferences: AthletePreferences;
  notificationPreferences: NotificationPreferences;
  mealPartition: MealMomentPartition;
} {
  const ext = raw as ExtendedPreferencesPayload;
  return {
    athletePreferences: {
      ...fallbackAthlete,
      weightUnit: raw.weightUnit ?? fallbackAthlete.weightUnit,
      heightUnit: raw.heightUnit ?? fallbackAthlete.heightUnit,
      timezone: raw.timezone ?? fallbackAthlete.timezone,
      trainingDaysPerWeek: raw.trainingDaysPerWeek ?? fallbackAthlete.trainingDaysPerWeek,
      sessionDurationMinutes: raw.sessionDurationMinutes ?? fallbackAthlete.sessionDurationMinutes,
      trainingExperience: raw.trainingExperience ?? fallbackAthlete.trainingExperience,
      availableEquipment: Array.isArray(raw.availableEquipment)
        ? raw.availableEquipment
        : fallbackAthlete.availableEquipment,
      trainingGoal: raw.trainingGoal ?? fallbackAthlete.trainingGoal,
      muscleFocus: Array.isArray(raw.muscleFocus) ? raw.muscleFocus : fallbackAthlete.muscleFocus,
      mealsPerDay: raw.mealsPerDay ?? fallbackAthlete.mealsPerDay,
      dietaryPreference: raw.dietaryPreference ?? fallbackAthlete.dietaryPreference,
      excludedFoods: Array.isArray(ext.excludedFoods) ? ext.excludedFoods : fallbackAthlete.excludedFoods,
      onboardingStep: typeof raw.onboardingStep === 'number' ? raw.onboardingStep : fallbackAthlete.onboardingStep,
      onboardingCompleted:
        typeof raw.onboardingCompleted === 'boolean'
          ? raw.onboardingCompleted
          : fallbackAthlete.onboardingCompleted,
    },
    notificationPreferences: {
      ...fallbackNotif,
      mealReminders: raw.notificationPreferences?.mealReminders ?? fallbackNotif.mealReminders,
      workoutAlerts: raw.notificationPreferences?.workoutAlerts ?? fallbackNotif.workoutAlerts,
      groceryAlerts: raw.notificationPreferences?.groceryAlerts ?? fallbackNotif.groceryAlerts,
      systemSync: raw.notificationPreferences?.systemUpdates ?? fallbackNotif.systemSync,
      soundEnabled: typeof ext.soundEnabled === 'boolean' ? ext.soundEnabled : fallbackNotif.soundEnabled,
      pushEnabled: typeof ext.pushEnabled === 'boolean' ? ext.pushEnabled : fallbackNotif.pushEnabled,
    },
    mealPartition: ext.mealPartition ?? fallbackPartition,
  };
}

export function toCleanMealLog(item: Omit<MealLogItem, 'id'> & { id?: string }): Omit<MealLogRecord, 'id'> & { id?: string } {
  const normalizedDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(item.dateTime || '')
    ? item.dateTime.slice(0, 16)
    : `${getTodayLocalDateString()}T12:00`;

  return {
    ...(item.id ? { id: item.id } : {}),
    dateTime: normalizedDateTime,
    moment: item.moment,
    name: (item.title || 'Comida').trim().slice(0, 200),
    description: item.description || '',
    portion: item.portion || '1 porción',
    kcal: Math.max(0, Math.min(10000, Math.round(Number(item.calories) || 0))),
    protein: Math.max(0, Math.min(1000, Math.round((Number(item.protein) || 0) * 10) / 10)),
    carbs: Math.max(0, Math.min(1500, Math.round((Number(item.carbs) || 0) * 10) / 10)),
    fat: Math.max(0, Math.min(1000, Math.round((Number(item.fats) || 0) * 10) / 10)),
    ...(typeof item.fiber === 'number' ? { fiber: item.fiber } : {}),
    source: item.source === 'Plantilla' ? 'Plan' : item.source,
    ...(item.foodId ? { foodId: item.foodId } : {}),
    ...(typeof item.grams === 'number' ? { grams: item.grams } : {}),
  };
}

export function fromCleanMealLog(rec: MealLogRecord & { title?: string; calories?: number; fats?: number }): MealLogItem {
  const rawSource = rec.source;
  const source: MealLogItem['source'] =
    rawSource === 'Plan' ? 'Plantilla' : rawSource === 'Receta' ? 'Receta' : 'Manual';

  return {
    id: rec.id,
    dateTime: rec.dateTime,
    moment: rec.moment,
    title: rec.name ?? rec.title ?? 'Comida',
    description: rec.description || '',
    portion: rec.portion || '1 porción',
    calories: rec.kcal ?? rec.calories ?? 0,
    protein: rec.protein ?? 0,
    carbs: rec.carbs ?? 0,
    fats: rec.fat ?? rec.fats ?? 0,
    source,
    verified: true,
    foodId: rec.foodId,
    grams: rec.grams,
    fiber: rec.fiber,
  };
}

export function toCleanGrocery(item: GroceryItem): GroceryItemRecord {
  const normalizedStatus: GroceryItemRecord['status'] =
    item.status === 'completed' ? 'bought' : 'pending';

  return {
    id: item.id,
    name: (item.name || 'Artículo').trim().slice(0, 200),
    quantity: Math.max(0, Math.min(100000, Number(item.quantity) || 0)),
    ...(typeof item.calculatedQuantity === 'number'
      ? { calculatedQuantity: Math.max(0, Math.min(100000, item.calculatedQuantity)) }
      : {}),
    unit: (item.unit || 'unid').trim().slice(0, 40),
    department: item.department || 'verduras',
    status: normalizedStatus,
    origin: item.origin === 'plan' ? 'plan' : 'manual',
    ...(item.planKey ? { planKey: item.planKey } : {}),
    ...(item.foodId ? { foodId: item.foodId } : {}),
    ...(item.recipeSource ? { recipeSource: item.recipeSource } : {}),
    ...(item.notes !== undefined ? { notes: item.notes.slice(0, 500) } : {}),
    ...(item.isCustomized !== undefined ? { isCustomized: Boolean(item.isCustomized) } : {}),
  };
}

export function fromCleanGrocery(rec: GroceryItemRecord): GroceryItem {
  const status: GroceryItem['status'] =
    rec.status === 'bought' || rec.status === 'in_pantry' || rec.status === 'completed'
      ? 'completed'
      : 'pending';

  return {
    id: rec.id,
    name: rec.name,
    quantity: rec.quantity,
    calculatedQuantity: rec.calculatedQuantity,
    unit: rec.unit || 'unid',
    department: (rec.department as GroceryDepartment) || 'verduras',
    status,
    origin: rec.origin,
    planKey: rec.planKey,
    foodId: rec.foodId,
    recipeSource: rec.recipeSource,
    notes: rec.notes,
    isCustomized: rec.isCustomized,
  };
}

export function toCleanRecipe(recipe: Recipe): RecipeRecord {
  const safeIngredients =
    recipe.ingredients.length > 0
      ? recipe.ingredients.map(ing => ({
          foodId: ing.foodId,
          foodName: ing.foodName,
          grams: ing.grams,
          calories: Math.round(ing.nutrients?.calories ?? 0),
          protein: Math.round((ing.nutrients?.protein ?? 0) * 10) / 10,
          carbs: Math.round((ing.nutrients?.carbs ?? 0) * 10) / 10,
          fat: Math.round((ing.nutrients?.fats ?? 0) * 10) / 10,
        }))
      : [
          {
            foodId: 'ing_default',
            foodName: recipe.name,
            grams: 100,
            calories: Math.round(recipe.totalNutrients?.calories ?? 0),
            protein: Math.round((recipe.totalNutrients?.protein ?? 0) * 10) / 10,
            carbs: Math.round((recipe.totalNutrients?.carbs ?? 0) * 10) / 10,
            fat: Math.round((recipe.totalNutrients?.fats ?? 0) * 10) / 10,
          },
        ];

  return {
    id: recipe.id,
    name: (recipe.name || 'Receta').trim().slice(0, 200),
    suggestedMoment: recipe.suggestedMoment || 'almuerzo',
    servings: Math.max(1, Number(recipe.servings) || 1),
    prepTimeMinutes: Math.max(1, Number(recipe.prepTimeMinutes) || 15),
    ingredients: safeIngredients,
    totalNutrients: {
      calories: Math.round(recipe.totalNutrients?.calories ?? 0),
      protein: Math.round((recipe.totalNutrients?.protein ?? 0) * 10) / 10,
      carbs: Math.round((recipe.totalNutrients?.carbs ?? 0) * 10) / 10,
      fat: Math.round((recipe.totalNutrients?.fats ?? 0) * 10) / 10,
    },
    ...(recipe.instructions ? { instructions: recipe.instructions } : {}),
    updatedAt: recipe.updatedAt || new Date().toISOString(),
  };
}

export function fromCleanRecipe(rec: RecipeRecord, userId?: string): Recipe {
  const ingredients: RecipeIngredient[] = (rec.ingredients || []).map((ing: any) => {
    const calories = ing.nutrients?.calories ?? ing.calories ?? 0;
    const protein = ing.nutrients?.protein ?? ing.protein ?? 0;
    const carbs = ing.nutrients?.carbs ?? ing.carbs ?? 0;
    const fats = ing.nutrients?.fats ?? ing.fat ?? 0;
    return {
      foodId: ing.foodId,
      foodName: ing.foodName,
      grams: ing.grams,
      preparationState: ing.preparationState,
      sourceFdcId: ing.sourceFdcId ?? 0,
      nutrients: {
        calories,
        protein,
        carbs,
        fats,
        fiber: ing.nutrients?.fiber ?? 0,
      },
    };
  });

  const tot: any = rec.totalNutrients || {};
  return {
    id: rec.id,
    userId,
    name: rec.name,
    suggestedMoment: rec.suggestedMoment || 'almuerzo',
    servings: rec.servings || 1,
    prepTimeMinutes: rec.prepTimeMinutes ?? 15,
    ingredients,
    totalNutrients: {
      calories: tot.calories ?? 0,
      protein: tot.protein ?? 0,
      carbs: tot.carbs ?? 0,
      fats: tot.fats ?? tot.fat ?? 0,
      fiber: tot.fiber ?? 0,
    },
    instructions: rec.instructions,
    createdAt: (rec as any).createdAt || rec.updatedAt || new Date().toISOString(),
    updatedAt: rec.updatedAt || new Date().toISOString(),
  };
}

export function toCleanMealPlan(plan: WeeklyMealPlan): MealPlanRecord {
  const mappedDays: Record<string, MealPlanRecord['days'][string]> = {};

  for (const [dateKey, day] of Object.entries(plan.days || {})) {
    const mappedMeals: MealPlanRecord['days'][string]['meals'] = {};
    for (const [momentKey, slot] of Object.entries(day.meals || {})) {
      if (!slot) continue;
      mappedMeals[momentKey as MealMoment] = {
        recipeId: slot.recipeId,
        recipeName: slot.recipeName,
        calories: slot.calories,
        protein: slot.protein,
        carbs: slot.carbs,
        fat: slot.fats,
        servings: slot.servings || 1,
      };
    }

    const dayTypeNormalized =
      day.dayType === 'alta_demanda' || day.dayType === 'estandar' || day.dayType === 'descanso'
        ? day.dayType
        : undefined;

    mappedDays[dateKey] = {
      date: day.date,
      dayLabel: day.dayLabel,
      ...(dayTypeNormalized ? { dayType: dayTypeNormalized } : {}),
      meals: mappedMeals,
    };
  }

  return {
    weekStart: plan.weekStart,
    weekEnd: plan.weekEnd,
    label: plan.label,
    days: mappedDays,
    updatedAt: plan.updatedAt || new Date().toISOString(),
  };
}

export function fromCleanMealPlan(
  rec: MealPlanRecord,
  userId: string,
  recipes: Recipe[]
): WeeklyMealPlan {
  const recipeMap = new Map(recipes.map(r => [r.id, r]));
  const mappedDays: Record<string, DayMealPlan> = {};

  for (const [dateKey, day] of Object.entries(rec.days || {})) {
    const mappedMeals: DayMealPlan['meals'] = {};
    for (const [momentKey, slot] of Object.entries(day.meals || {})) {
      if (!slot) continue;
      const s = slot as any;
      const linkedRecipe = recipeMap.get(s.recipeId);
      mappedMeals[momentKey as MealMoment] = {
        recipeId: s.recipeId,
        recipeName: s.recipeName,
        calories: s.calories ?? 0,
        protein: s.protein ?? 0,
        carbs: s.carbs ?? 0,
        fats: s.fats ?? s.fat ?? 0,
        servings: s.servings || 1,
        imageUrl: s.imageUrl ?? linkedRecipe?.imageUrl,
        prepTimeMinutes: s.prepTimeMinutes ?? linkedRecipe?.prepTimeMinutes,
        ingredients:
          s.ingredients ??
          linkedRecipe?.ingredients.map(ing => ({
            foodId: ing.foodId,
            foodName: ing.foodName,
            grams: ing.grams * (s.servings || 1),
            state: ing.preparationState,
          })),
      };
    }

    mappedDays[dateKey] = {
      date: day.date,
      dayLabel: day.dayLabel,
      dayType: day.dayType,
      meals: mappedMeals,
    };
  }

  const { weekEnd } = getWeekStartEnd(rec.weekStart);
  return {
    id: (rec as any).id || `plan_${rec.weekStart.replace(/-/g, '_')}`,
    userId,
    weekStart: rec.weekStart,
    weekEnd: rec.weekEnd || weekEnd,
    label: rec.label || `Semana ${rec.weekStart}`,
    days: mappedDays,
    createdAt: (rec as any).createdAt || rec.updatedAt || new Date().toISOString(),
    updatedAt: rec.updatedAt || new Date().toISOString(),
  };
}

function toCleanRoutineDays(days: RoutineDay[]): WorkoutRoutineRecord['days'] {
  return (days || []).map(day => ({
    id: day.id,
    name: day.name,
    shortName: day.shortName,
    focusDescription: day.focusDescription || '',
    ...(day.isRestDay !== undefined ? { isRestDay: Boolean(day.isRestDay) } : {}),
    exercises: (day.exercises || []).map(cfg => {
      const catItem = getExerciseById(cfg.exerciseId);
      return {
        id: cfg.id,
        exerciseId: cfg.exerciseId,
        exerciseName: catItem?.name || cfg.exerciseId,
        muscleGroup: toCleanMuscleGroup(catItem?.muscleGroup),
        equipment: toCleanEquipment(catItem?.equipment),
        sets: Math.max(1, Number(cfg.sets) || 3),
        repsMin: Math.max(1, Number(cfg.repsMin) || 8),
        repsMax: Math.max(1, Number(cfg.repsMax) || 12),
        targetRir: Math.max(0, Math.min(10, Number(cfg.targetRir ?? 2))),
        targetWeightKg: Math.max(0, Number(cfg.targetWeightKg ?? 0)),
        restSeconds: Math.max(15, Number(cfg.restSeconds) || 90),
      };
    }),
  }));
}

function fromCleanRoutineDays(days: WorkoutRoutineRecord['days']): RoutineDay[] {
  return (days || []).map((day: any) => ({
    id: day.id,
    name: day.name,
    shortName: day.shortName,
    dayOfWeek: day.dayOfWeek,
    focusDescription: day.focusDescription,
    isRestDay: day.isRestDay,
    exercises: (day.exercises || []).map((cfg: any, idx: number): PlannedExerciseConfig => ({
      id: cfg.id,
      exerciseId: cfg.exerciseId,
      orderIndex: typeof cfg.orderIndex === 'number' ? cfg.orderIndex : idx + 1,
      sets: cfg.sets ?? 3,
      repsMin: cfg.repsMin ?? 8,
      repsMax: cfg.repsMax ?? 10,
      targetRir: cfg.targetRir ?? 2,
      targetWeightKg: cfg.targetWeightKg ?? 0,
      restSeconds: cfg.restSeconds ?? 90,
      tempo: cfg.tempo ?? '2-0-1-0',
      notes: cfg.notes ?? '',
    })),
  }));
}

export function toCleanWorkoutRoutine(routine: WorkoutRoutine | MesocycleRoutine): WorkoutRoutineRecord {
  const meso = routine as Partial<MesocycleRoutine>;
  const durationWeeksRaw = meso.mesocycleConfig?.durationWeeks;
  const durationWeeks: 4 | 6 | 8 = durationWeeksRaw === 6 || durationWeeksRaw === 8 ? durationWeeksRaw : 4;

  const base: WorkoutRoutineRecord = {
    id: routine.id,
    name: (routine.name || 'Rutina').trim().slice(0, 200),
    description: routine.description || '',
    goal: routine.goal || 'hipertrofia',
    frequencyDays: Math.max(1, Number(routine.frequencyDays) || 4),
    isDefault: Boolean(routine.isDefault),
    days: toCleanRoutineDays(routine.days),
    updatedAt: routine.updatedAt || new Date().toISOString(),
  };

  if (meso.isMesocycle && meso.mesocycleConfig) {
    base.isMesocycle = true;
    base.mesocycleConfig = {
      durationWeeks,
      splitName: meso.mesocycleConfig.splitStructureName || 'Personalizado',
      includeDeloadWeek: Boolean(meso.mesocycleConfig.hasDeloadWeek),
      currentWeek: meso.mesocycleConfig.currentWeek || 1,
      weeks: (meso.mesocycleConfig.weeks || []).map(w => ({
        weekNumber: w.weekNumber,
        name: w.name,
        isDeload: Boolean(w.isDeload),
        volumeMultiplier: w.volumeMultiplier,
        intensityRirTarget: w.intensityRirTarget,
        days: toCleanRoutineDays(w.days),
      })),
    };
  }

  return base;
}

export function fromCleanWorkoutRoutine(
  rec: WorkoutRoutineRecord & Record<string, any>,
  userId: string
): WorkoutRoutine | MesocycleRoutine {
  const base: WorkoutRoutine = {
    id: rec.id,
    userId,
    name: rec.name,
    description: rec.description || '',
    goal: rec.goal || 'hipertrofia',
    frequencyDays: rec.frequencyDays || 4,
    days: fromCleanRoutineDays(rec.days || []),
    isDefault: Boolean(rec.isDefault),
    sourceTemplateId: rec.sourceTemplateId,
    createdAt: rec.createdAt || rec.updatedAt || new Date().toISOString(),
    updatedAt: rec.updatedAt || new Date().toISOString(),
  };

  if (rec.isMesocycle && rec.mesocycleConfig) {
    const mc = rec.mesocycleConfig as Record<string, any>;
    const mesoResult: MesocycleRoutine = {
      ...base,
      isMesocycle: true,
      mesocycleConfig: {
        durationWeeks: mc.durationWeeks || 4,
        splitStructure: mc.splitStructure || 'torso_pierna_4d',
        splitStructureName: mc.splitStructureName || mc.splitName || 'Mesociclo',
        athleteGoal: mc.athleteGoal || base.goal,
        experience: mc.experience || 'intermedio',
        targetSessionDurationMinutes: mc.targetSessionDurationMinutes || 60,
        availableEquipment: mc.availableEquipment || ['barra', 'mancuerna', 'polea', 'maquina'],
        musclePriorities: mc.musclePriorities,
        hasDeloadWeek: mc.hasDeloadWeek ?? mc.includeDeloadWeek ?? true,
        deloadWeekIndex: mc.deloadWeekIndex,
        currentWeek: mc.currentWeek || 1,
        weeks: (mc.weeks || []).map((w: any) => ({
          weekNumber: w.weekNumber,
          name: w.name,
          focus: w.focus || (w.isDeload ? 'Descarga activa' : 'Progresión'),
          isDeload: Boolean(w.isDeload),
          volumeMultiplier: w.volumeMultiplier ?? 1,
          intensityRirTarget: w.intensityRirTarget ?? 2,
          loadIncrementStrategy: w.loadIncrementStrategy || (w.isDeload ? 'deload_recovery' : 'reps_progression'),
          days: fromCleanRoutineDays(w.days || []),
          actualVolumeReductionPct: w.actualVolumeReductionPct,
        })),
        completedSessions: Array.isArray(mc.completedSessions) ? mc.completedSessions : [],
      },
    };
    return mesoResult;
  }

  return base;
}

export function toCleanExercisesSnapshot(
  exercises: LiveExerciseSession[]
): ExecutedWorkoutRecord['exercisesSnapshot'] {
  return exercises.map(ex => {
    const firstSet = ex.sets[0];
    return {
      exerciseId: ex.exerciseId,
      exerciseName: ex.exerciseName,
      muscleGroup: toCleanMuscleGroup(ex.muscleGroup),
      equipment: toCleanEquipment(ex.equipment),
      targetRepsMin: firstSet?.targetRepsMin ?? 8,
      targetRepsMax: firstSet?.targetRepsMax ?? 10,
      targetRir: firstSet?.targetRir ?? 2,
      targetWeightKg: firstSet?.weightKg ?? 60,
      plannedSets: Math.max(1, ex.sets.length),
    };
  });
}

export function fromCleanExecutedWorkout(
  rec: ExecutedWorkoutRecord & Record<string, any>,
  allSets: WorkoutSetRecord[],
  userId: string
): ExecutedWorkout {
  const workoutSets = allSets.filter(s => s.executedWorkoutId === rec.id);

  const exercisesSnapshot: LiveExerciseSession[] = (rec.exercisesSnapshot || []).map(
    (snap: any, idx: number) => {
      // If snapshot already has embedded sets (legacy shape), keep them; otherwise reconstruct from workoutSets
      if (Array.isArray(snap.sets) && snap.sets.length > 0 && 'completed' in snap.sets[0]) {
        return snap as LiveExerciseSession;
      }

      const exCatalog = getExerciseById(snap.exerciseId);
      const matchingSets = workoutSets
        .filter(s => s.exerciseId === snap.exerciseId)
        .sort((a, b) => a.setNumber - b.setNumber);

      const plannedCount = Math.max(matchingSets.length, snap.plannedSets ?? 3);
      const builtSets: LiveWorkoutSet[] = [];

      for (let i = 0; i < plannedCount; i++) {
        const matched = matchingSets[i];
        if (matched) {
          builtSets.push({
            id: matched.id,
            setNumber: matched.setNumber,
            type: matched.type as WorkoutSetType,
            targetRepsMin: snap.targetRepsMin ?? 8,
            targetRepsMax: snap.targetRepsMax ?? 10,
            targetRir: snap.targetRir ?? 2,
            weightKg: matched.weightKg,
            reps: matched.reps,
            rir: matched.rir,
            completed: Boolean(matched.completed),
            estimated1RM: matched.estimated1RM,
            completedAt: matched.completedAt,
          });
        } else {
          builtSets.push({
            id: `set_init_${rec.id}_${idx}_${i + 1}`,
            setNumber: i + 1,
            type: 'effective',
            targetRepsMin: snap.targetRepsMin ?? 8,
            targetRepsMax: snap.targetRepsMax ?? 10,
            targetRir: snap.targetRir ?? 2,
            weightKg: snap.targetWeightKg ?? 60,
            reps: snap.targetRepsMin ?? 8,
            rir: snap.targetRir ?? 2,
            completed: false,
            estimated1RM: 0,
          });
        }
      }

      return {
        configId: snap.configId || `cfg_${rec.id}_${idx}`,
        exerciseId: snap.exerciseId,
        exerciseName: snap.exerciseName || exCatalog?.name || snap.exerciseId,
        muscleGroup: (snap.muscleGroup || exCatalog?.muscleGroup || 'pecho') as MuscleGroup,
        movementPattern: exCatalog?.movementPattern || 'empuje_horizontal',
        equipment: (snap.equipment || exCatalog?.equipment || 'barra') as EquipmentRequired,
        tempo: snap.tempo || '2-0-1-0',
        restSeconds: snap.restSeconds ?? 120,
        notes: snap.notes || '',
        cue: exCatalog?.instructions?.[0] || 'Control excéntrico estricto y técnica consistente.',
        sets: builtSets,
      };
    }
  );

  return {
    id: rec.id,
    userId,
    routineId: rec.routineId,
    routineName: rec.routineName || 'Entrenamiento',
    routineDayId: rec.routineDayId,
    routineDayName: rec.routineDayName || 'Sesión',
    status: rec.status,
    startedAt: rec.startedAt,
    completedAt: rec.completedAt,
    durationSeconds: rec.durationSeconds ?? 0,
    totalTonnageKg: rec.totalTonnageKg ?? 0,
    totalCompletedSets: rec.totalCompletedSets ?? 0,
    totalReps: rec.totalReps ?? 0,
    averageRir: rec.averageRir ?? 0,
    sessionRpe: rec.sessionRpe,
    notes: rec.notes,
    exercisesSnapshot,
  };
}

export function fromCleanWorkoutSet(s: WorkoutSetRecord, userId: string): WorkoutSessionRecord {
  return {
    id: s.id,
    userId,
    exerciseId: s.exerciseId,
    exerciseName: s.exerciseName,
    date: s.completedAt || new Date().toISOString(),
    weightKg: s.weightKg,
    reps: s.reps,
    rir: s.rir,
    estimated1RM: s.estimated1RM,
    completed: Boolean(s.completed),
    createdAt: s.completedAt || new Date().toISOString(),
    executedWorkoutId: s.executedWorkoutId,
    setNumber: s.setNumber,
    setType: s.type,
  };
}

export function toCleanCardioSession(session: Omit<CardioSession, 'id'>): Omit<CardioSessionRecord, 'id'> {
  const rawDate = (session.date || '').trim();
  let isoDate = getTodayLocalDateString();
  if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
    isoDate = rawDate.slice(0, 10);
  } else if (rawDate.toLowerCase().includes('ayer')) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    isoDate = yesterday.toISOString().slice(0, 10);
  }

  const lowerTitle = (session.title || '').toLowerCase();
  const protocolType: CardioSessionRecord['protocolType'] =
    lowerTitle.includes('hiit') || lowerTitle.includes('interval')
      ? 'hiit'
      : lowerTitle.includes('tempo')
        ? 'tempo'
        : lowerTitle.includes('recuper')
          ? 'recovery'
          : 'zone2';

  const avgHeartRate =
    typeof session.avgHr === 'number' && session.avgHr >= 35 && session.avgHr <= 240
      ? Math.round(session.avgHr)
      : undefined;
  const maxHeartRate =
    typeof session.maxHr === 'number' && session.maxHr >= 40 && session.maxHr <= 250
      ? Math.round(session.maxHr)
      : undefined;

  return {
    date: isoDate,
    title: (session.title || 'Sesión Cardio').trim().slice(0, 200),
    protocolType,
    durationMinutes: Math.max(1, Math.min(600, Math.round(Number(session.durationMinutes) || 30))),
    ...(avgHeartRate !== undefined ? { avgHeartRate } : {}),
    ...(maxHeartRate !== undefined ? { maxHeartRate } : {}),
    ...(typeof session.zone2Minutes === 'number'
      ? { zone2Minutes: Math.max(0, Math.min(600, session.zone2Minutes)) }
      : {}),
    caloriesBurned: Math.max(0, Math.min(10000, Math.round(Number(session.caloriesBurned) || 0))),
    ...(session.details ? { notes: `${session.details}${session.device ? ` · ${session.device}` : ''}`.slice(0, 500) } : {}),
  };
}

export function fromCleanCardioSession(rec: CardioSessionRecord & Record<string, any>): CardioSession {
  const duration = Math.max(1, rec.durationMinutes || 1);
  const z2Min = rec.zone2Minutes ?? (rec.protocolType === 'zone2' ? duration : 0);
  const z2Pct =
    typeof rec.zone2Percentage === 'number'
      ? rec.zone2Percentage
      : Math.min(100, Math.round((z2Min / duration) * 100));

  return {
    id: rec.id,
    date: rec.date,
    title: rec.title,
    details: rec.notes || rec.details || rec.protocolType?.toUpperCase() || 'Sesión cardiovascular',
    durationMinutes: duration,
    avgHr: rec.avgHeartRate ?? rec.avgHr ?? 135,
    maxHr: rec.maxHeartRate ?? rec.maxHr ?? 155,
    zone2Minutes: z2Min,
    zone2Percentage: z2Pct,
    caloriesBurned: rec.caloriesBurned ?? 0,
    device: rec.device || 'Sincronizado',
  };
}

const VIEW_TO_NAV: Partial<Record<ViewId, NavigationPath>> = {
  dashboard: 'dashboard-nutricional',
  'profile-biometrics': 'perfil-atleta',
  'nutrition-log': 'registro-de-comidas',
  'meal-plan': 'menu-semanal',
  'recipes-substitutions': 'sustituciones',
  'shopping-list': 'lista-de-compras',
  'routines-mesocycle': 'rutina-de-entrenamiento',
  'live-workout': 'registro-de-entrenamiento',
  'training-progress': 'progreso-del-entrenamiento',
  'cardio-hiit': 'cardio-y-hiit',
  notifications: 'guia-y-ajustes',
  'admin-console': 'admin-usuarios',
};

const NAV_TO_VIEW: Partial<Record<NavigationPath, ViewId>> = {
  'dashboard-nutricional': 'dashboard',
  'perfil-atleta': 'profile-biometrics',
  'configuracion-nutricional': 'profile-biometrics',
  'registro-de-comidas': 'nutrition-log',
  'registro-diario': 'nutrition-log',
  'menu-semanal': 'meal-plan',
  sustituciones: 'recipes-substitutions',
  'lista-de-compras': 'shopping-list',
  'rutina-de-entrenamiento': 'routines-mesocycle',
  'planificador-mesociclo': 'routines-mesocycle',
  'registro-de-entrenamiento': 'live-workout',
  'progreso-del-entrenamiento': 'training-progress',
  'cardio-y-hiit': 'cardio-hiit',
  'guia-y-ajustes': 'notifications',
  'admin-usuarios': 'admin-console',
};

export function toCleanActionView(actionPath?: string): ViewId | undefined {
  if (!actionPath) return undefined;
  return NAV_TO_VIEW[actionPath as NavigationPath];
}

export function fromCleanNotification(rec: NotificationRecord & Record<string, any>): AppNotification {
  let timestamp = rec.timestamp || 'Ahora mismo';
  if (!rec.timestamp && rec.createdAt) {
    try {
      timestamp = new Date(rec.createdAt).toLocaleString('es-ES', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      timestamp = rec.createdAt;
    }
  }

  return {
    id: rec.id,
    title: rec.title,
    message: rec.message,
    timestamp,
    category: rec.category || 'sistema',
    read: Boolean(rec.read),
    severity: rec.severity || 'info',
    actionPath: rec.actionPath || (rec.actionView ? VIEW_TO_NAV[rec.actionView] : undefined),
  };
}
