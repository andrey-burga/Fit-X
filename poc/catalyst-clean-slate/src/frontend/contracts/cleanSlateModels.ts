/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Browser-Safe Clean-Slate Domain Contracts
 * Mirrors `src/types/cleanSlate.ts` (5 Catalyst NoSQL tables & 11 UserData entity types)
 * without importing Node built-ins (`node:crypto`), allowing strict Vite/browser bundling
 * while preserving 1:1 structural parity with the frozen backend contracts.
 */

import { ROUTE_CONTRACT_SPECS } from '../../routes/routeContracts.js';

export type UserRole = 'athlete' | 'admin' | 'superadmin';
export type AccountStatus = 'active' | 'suspended';
export type InviteStatus = 'pending' | 'redeeming' | 'redeemed' | 'revoked' | 'expired';

export type UserDataEntityType =
  | 'BIOMETRICS'
  | 'PREFERENCES'
  | 'GROCERY'
  | 'MEAL_LOG'
  | 'RECIPE'
  | 'MEAL_PLAN'
  | 'WORKOUT_ROUTINE'
  | 'EXECUTED_WORKOUT'
  | 'WORKOUT_SET'
  | 'CARDIO_SESSION'
  | 'NOTIFICATION';

export const CATALYST_BUDGET_LIMITS = {
  MAX_ITEM_BYTES: 400 * 1024,
  SAFE_PAYLOAD_BUDGET_BYTES: 350 * 1024,
  MAX_BATCH_WRITE_ITEMS: 25,
  MAX_QUERY_READ_ITEMS: 100,
  SESSION_INACTIVITY_HOURS: 12,
  SESSION_ABSOLUTE_HOURS: 24,
  CATALYST_REVALIDATION_MINUTES: 15,
} as const;

export type WeightUnit = 'kg' | 'lbs';
export type HeightUnit = 'cm' | 'in';
export type AthleteGoal =
  | 'hipertrofia'
  | 'fuerza'
  | 'recomposicion'
  | 'definicion'
  | 'mantenimiento'
  | 'resistencia'
  | 'perdida_grasa'
  | 'ganancia_muscular'
  | 'rendimiento'
  | 'salud_general';

export type TrainingExperience = 'principiante' | 'intermedio' | 'avanzado';
export type DietaryPreference = 'omnivoro' | 'vegetariano' | 'vegano' | 'pescetariano' | 'sin_gluten';
export type MealMoment = 'desayuno' | 'almuerzo' | 'merienda' | 'cena' | 'snack';
export type GroceryDepartment = 'carnes' | 'huevos' | 'verduras' | 'carbohidratos' | 'grasas';
export type GroceryStatus = 'pending' | 'bought' | 'in_pantry' | 'completed';

export interface UserAccountModel {
  uid: string;
  email: string;
  normalizedEmail: string;
  displayName: string;
  avatarUrl?: string;
  profileLabel?: 'Atleta Pro' | 'Coach' | 'Nutricionista';
  role: UserRole;
  roleVersion: number;
  sessionEpoch: number;
  accountStatus: AccountStatus;
  emailVerified: boolean;
  authProvider: string;
  directorySegment: 'USER_SEG#0' | 'USER_SEG#1' | 'USER_SEG#2' | 'USER_SEG#3';
  onboardingCompleted: boolean;
  onboardingStep: number;
  goal?: AthleteGoal;
  location?: string;
  suspensionReason?: string;
  suspendedAt?: string;
  createdAt: string;
  updatedAt: string;
  lastSignInAt: string;
}

export interface BiometricsPayload {
  weightKg: number;
  heightCm: number;
  bodyFatPct: number;
  age: number;
  palFactor: number;
  targetDeltaKcal: number;
  proteinPerKg: number;
  fatPerKg: number;
  bmr: number;
  tdee: number;
  targetCalories: number;
  targetProteinG: number;
  targetFatG: number;
  targetCarbsG: number;
  lastAppliedPeriodization?: {
    phase: string;
    athleteGoal: AthleteGoal;
    appliedAt: string;
    isDietBreak?: boolean;
    previousTargets?: {
      targetCalories: number;
      targetProteinG: number;
      targetFatG: number;
      targetCarbsG: number;
      proteinPerKg: number;
      fatPerKg: number;
      targetDeltaKcal: number;
    };
  };
}

export interface NotificationPreferencesModel {
  mealReminders: boolean;
  workoutAlerts: boolean;
  groceryAlerts: boolean;
  systemUpdates: boolean;
}

export interface PreferencesPayload {
  weightUnit: WeightUnit;
  heightUnit: HeightUnit;
  timezone: string;
  trainingDaysPerWeek: number;
  sessionDurationMinutes: number;
  trainingExperience: TrainingExperience;
  availableEquipment: EquipmentRequired[];
  trainingGoal: AthleteGoal;
  muscleFocus: MuscleGroup[];
  mealsPerDay: number;
  dietaryPreference: DietaryPreference;
  onboardingStep: number;
  onboardingCompleted: boolean;
  notificationPreferences: NotificationPreferencesModel;
}

export interface MealLogRecord {
  id: string;
  dateTime: string; // YYYY-MM-DDTHH:mm
  moment: MealMoment;
  name: string;
  description: string;
  portion: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  source: 'Manual' | 'Receta' | 'Plan';
  foodId?: string;
  grams?: number;
}

export type FoodCategory =
  | 'carnes_aves'
  | 'pescados_mariscos'
  | 'huevos'
  | 'lacteos'
  | 'cereales_granos'
  | 'tuberculos_raices'
  | 'legumbres'
  | 'frutas'
  | 'verduras_hortalizas'
  | 'grasas_aceites'
  | 'frutos_secos_semillas';

export interface FoodCatalogItem {
  id: string;
  name: string;
  category: FoodCategory;
  state: 'crudo' | 'cocido' | 'seco' | 'fresco';
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fiberPer100g: number;
  commonPortionG: number;
}

export interface RecipeIngredient {
  foodId: string;
  foodName: string;
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface RecipeRecord {
  id: string;
  name: string;
  suggestedMoment: MealMoment;
  servings: number;
  prepTimeMinutes: number;
  ingredients: RecipeIngredient[];
  totalNutrients: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  instructions?: string;
  updatedAt: string;
}

export interface PlannedMealSlot {
  recipeId: string;
  recipeName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  servings: number;
}

export interface DayMealPlan {
  date: string; // YYYY-MM-DD
  dayLabel: string;
  dayType?: 'alta_demanda' | 'estandar' | 'descanso';
  meals: Partial<Record<MealMoment, PlannedMealSlot>>;
}

export interface MealPlanRecord {
  weekStart: string; // YYYY-MM-DD
  weekEnd: string;
  label: string;
  days: Record<string, DayMealPlan>;
  updatedAt: string;
}

export interface GroceryItemRecord {
  id: string;
  name: string;
  quantity: number;
  calculatedQuantity?: number;
  unit: string;
  department: GroceryDepartment;
  status: GroceryStatus;
  origin: 'plan' | 'manual';
  planKey?: string;
  foodId?: string;
  recipeSource?: string;
  notes?: string;
  isCustomized?: boolean;
}

export type MuscleGroup =
  | 'pecho'
  | 'espalda'
  | 'hombros'
  | 'biceps'
  | 'triceps'
  | 'cuadriceps'
  | 'isquios'
  | 'gluteos'
  | 'gemelos'
  | 'core';

export type EquipmentRequired =
  | 'barra'
  | 'mancuerna'
  | 'polea'
  | 'maquina'
  | 'peso_corporal'
  | 'bandas';

export interface ExerciseCatalogItem {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  equipment: EquipmentRequired;
  pattern: string;
  defaultRepsMin: number;
  defaultRepsMax: number;
  defaultRestSeconds: number;
}

export interface PlannedExerciseConfig {
  id: string;
  exerciseId: string;
  exerciseName: string;
  muscleGroup: MuscleGroup;
  equipment: EquipmentRequired;
  sets: number;
  repsMin: number;
  repsMax: number;
  targetRir: number;
  targetWeightKg: number;
  restSeconds: number;
}

export interface RoutineDay {
  id: string;
  name: string;
  shortName: string;
  focusDescription: string;
  isRestDay?: boolean;
  exercises: PlannedExerciseConfig[];
}

export type MesocycleDurationWeeks = 4 | 6 | 8;

export interface MesocycleWeekPrescription {
  weekNumber: number;
  name: string;
  isDeload: boolean;
  volumeMultiplier: number;
  intensityRirTarget: number;
  days: RoutineDay[];
}

export interface WorkoutRoutineRecord {
  id: string;
  name: string;
  description: string;
  goal: 'hipertrofia' | 'fuerza' | 'recomposicion' | 'resistencia';
  frequencyDays: number;
  isDefault: boolean;
  isMesocycle?: boolean;
  mesocycleConfig?: {
    durationWeeks: MesocycleDurationWeeks;
    splitName: string;
    includeDeloadWeek: boolean;
    currentWeek: number;
    weeks: MesocycleWeekPrescription[];
  };
  days: RoutineDay[];
  updatedAt: string;
}

export type WorkoutSetType = 'warmup' | 'effective' | 'dropset' | 'failure';

export interface WorkoutSetRecord {
  id: string;
  executedWorkoutId: string;
  exerciseId: string;
  exerciseName: string;
  muscleGroup: MuscleGroup;
  setNumber: number;
  type: WorkoutSetType;
  weightKg: number;
  reps: number;
  rir: number;
  completed: boolean;
  estimated1RM: number;
  completedAt: string;
}

export interface ExecutedWorkoutRecord {
  id: string;
  routineId?: string;
  routineName: string;
  routineDayId?: string;
  routineDayName: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  startedAt: string;
  completedAt?: string;
  durationSeconds: number;
  totalTonnageKg: number;
  totalCompletedSets: number;
  totalReps: number;
  averageRir: number | null;
  sessionRpe?: number;
  notes?: string;
  exercisesSnapshot: Array<{
    exerciseId: string;
    exerciseName: string;
    muscleGroup: MuscleGroup;
    equipment: EquipmentRequired;
    targetRepsMin: number;
    targetRepsMax: number;
    targetRir: number;
    targetWeightKg: number;
    plannedSets: number;
  }>;
}

export interface CardioSessionRecord {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  protocolType: 'zone2' | 'hiit' | 'tempo' | 'recovery';
  durationMinutes: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  zone2Minutes?: number;
  caloriesBurned: number;
  notes?: string;
}

export type NotificationCategory = 'nutricion' | 'entrenamiento' | 'compras' | 'sistema';

export interface NotificationRecord {
  id: string;
  title: string;
  message: string;
  category: NotificationCategory;
  severity: 'info' | 'success' | 'warning';
  read: boolean;
  createdAt: string;
  actionView?: ViewId;
}

export interface AdminInvitationModel {
  inviteId: string;
  emailNormalized: string;
  targetRole: 'athlete' | 'admin';
  status: InviteStatus;
  rawTokenPreview?: string; // Mock-only preview token for UI testing
  createdBy: string;
  createdByEmail: string;
  createdAt: string;
  expiresAt: string;
  redeemedBy?: string;
  redeemedAt?: string;
  revokedBy?: string;
  revokedAt?: string;
  revokeReason?: string;
}

export interface AuditLogModel {
  eventId: string;
  action: string;
  actorUid: string;
  actorRole: UserRole | 'system';
  actorEmail: string;
  targetUid: string;
  targetEmail?: string;
  timestamp: string;
  reason?: string;
  changes?: Record<string, unknown>;
}

export interface AdminStatsModel {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  superadmins: number;
  admins: number;
  pendingInvitations: number;
  pendingVerificationUsers?: number;
  recentSignups30d?: number;
}

export type ViewId =
  | 'dashboard'
  | 'profile-biometrics'
  | 'nutrition-log'
  | 'meal-plan'
  | 'recipes-substitutions'
  | 'shopping-list'
  | 'routines-mesocycle'
  | 'live-workout'
  | 'training-progress'
  | 'cardio-hiit'
  | 'notifications'
  | 'admin-console'
  | 'preauth-contracts';

export type DispatcherParityStatus =
  | 'wired_match'
  | 'wired_path_mismatch'
  | 'service_ready_not_wired_in_dispatcher';

export interface ApiContractMetadata {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  auth: 'session_bootstrap' | 'session_registered' | 'admin' | 'superadmin_verified_only';
  purpose: string;
  dispatcherStatus: DispatcherParityStatus;
  dispatcherPath?: string;
}

export const CLEAN_SLATE_UI_ENDPOINT_MAP: ApiContractMetadata[] = ROUTE_CONTRACT_SPECS.map(spec => ({
  method: spec.method,
  path: spec.path,
  auth: spec.auth,
  purpose: spec.purpose,
  dispatcherStatus: 'wired_match',
}));

