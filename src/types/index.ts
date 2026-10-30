export type AuthStatus = 'initializing' | 'authenticated' | 'unauthenticated' | 'error';

export type NavigationPath =
  | 'login'
  | 'registro'
  | 'recuperar-password'
  | 'dashboard-nutricional'
  | 'configuracion-nutricional'
  | 'menu-semanal'
  | 'registro-de-comidas'
  | 'registro-diario'
  | 'lista-de-compras'
  | 'sustituciones'
  | 'guia-y-ajustes'
  | 'rutina-de-entrenamiento'
  | 'registro-de-entrenamiento'
  | 'cardio-y-hiit'
  | 'progreso-del-entrenamiento';

export const PRIVATE_NAVIGATION_PATHS: NavigationPath[] = [
  'dashboard-nutricional',
  'configuracion-nutricional',
  'menu-semanal',
  'registro-de-comidas',
  'registro-diario',
  'lista-de-compras',
  'sustituciones',
  'guia-y-ajustes',
  'rutina-de-entrenamiento',
  'registro-de-entrenamiento',
  'cardio-y-hiit',
  'progreso-del-entrenamiento',
];

export const PUBLIC_NAVIGATION_PATHS: NavigationPath[] = [
  'login',
  'registro',
  'recuperar-password',
];

export function isPrivatePath(path: string): path is NavigationPath {
  return PRIVATE_NAVIGATION_PATHS.includes(path as NavigationPath);
}

export type GroceryDepartment = 'carnes' | 'huevos' | 'verduras' | 'carbohidratos' | 'grasas';

export interface GroceryItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  department: GroceryDepartment;
  status: 'pending' | 'completed';
  notes?: string;
  recipeSource?: string;
  nutritionInfo?: string;
  // Campos de trazabilidad e idempotencia (Incremento 5)
  origin?: 'plan' | 'manual';
  planKey?: string;
  foodId?: string;
  preparationState?: string;
  warning?: string;
  isCustomized?: boolean;
  calculatedQuantity?: number;
}

export type MealMoment = 'desayuno' | 'almuerzo' | 'merienda' | 'cena' | 'snack';

export interface MealLogItem {
  id: string;
  dateTime: string; // ISO string or '2024-10-24T13:30'
  moment: MealMoment;
  title: string;
  description: string;
  portion: string; // e.g. '430 g'
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  source: 'Manual' | 'Plantilla' | 'Receta';
  verified: boolean;
  // Campos opcionales de trazabilidad nutricional verificada (Incremento 2)
  foodId?: string;
  foodFdcId?: number;
  grams?: number;
  fiber?: number;
}

export interface BiometricConfig {
  weightKg: number; // 74.5
  heightCm: number; // 178
  bodyFatPct: number; // 15.2
  age: number; // 30
  palFactor: number; // 1.55
  targetDeltaKcal: number; // -400 (deficit)
  proteinPerKg: number; // 2.0
  fatPerKg: number; // 0.8
  // Calculated:
  bmr: number;
  tdee: number;
  targetCalories: number;
  targetProteinG: number;
  targetFatG: number;
  targetCarbsG: number;
}

export interface MealMomentPartition {
  desayunoPct: number; // 25
  almuerzoPct: number; // 35
  meriendaPct: number; // 15
  cenaPct: number; // 25
}

export interface WorkoutSet {
  setNumber: number;
  type: 'Aprox.' | 'Efectiva 1' | 'Efectiva 2' | 'Efectiva 3' | 'Efectiva 4';
  weightKg: number;
  reps: number;
  rir: number;
  completed: boolean;
  estimated1RM?: number;
}

export interface WorkoutExercise {
  id: string;
  name: string;
  category: string;
  targetMuscles: string;
  tempo: string;
  cue: string;
  historicalRecord: string;
  sets: WorkoutSet[];
}

export interface WorkoutSessionRecord {
  id: string;
  userId: string;
  exerciseId: string;
  exerciseName: string;
  date: string;
  weightKg: number;
  reps: number;
  rir: number;
  estimated1RM: number;
  completed: boolean;
  createdAt: string;
  executedWorkoutId?: string;
  setNumber?: number;
  setType?: string;
}

export interface CardioSession {
  id: string;
  date: string;
  title: string;
  details: string;
  durationMinutes: number;
  avgHr: number;
  maxHr: number;
  zone2Minutes: number;
  zone2Percentage: number;
  caloriesBurned: number;
  device: string;
}

export interface ToastMessage {
  id: string;
  text: string;
  type?: 'success' | 'info' | 'warning';
}

export * from './nutrition';
export * from './workout';
export * from './auth';
