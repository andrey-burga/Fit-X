import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, ReactNode } from 'react';
import {
  NavigationPath,
  AuthStatus,
  isPrivatePath,
  PUBLIC_NAVIGATION_PATHS,
  GroceryItem,
  MealLogItem,
  BiometricConfig,
  MealMomentPartition,
  WorkoutExercise,
  WorkoutSessionRecord,
  CardioSession,
  ToastMessage,
  GroceryDepartment,
  MealMoment,
} from '../types';
import {
  Recipe,
  WeeklyMealPlan,
  PlannedMealSlot,
  DayMealPlan,
} from '../types/nutrition';
import {
  TEMPLATE_RECIPES,
  createDefaultWeeklyPlan,
} from '../data/templateRecipes';
import {
  aggregateWeeklyMealPlan,
  computeIdempotentGrocerySync,
  SyncSummary,
} from '../services/groceryAggregation';
import {
  getLocalDateString,
  getTodayLocalDateString,
  formatSpanishDate,
  getWeekStartEnd,
} from '../services/dateUtils';
import {
  WorkoutRoutine,
  PlannedExerciseConfig,
  ExecutedWorkout,
  LiveExerciseSession,
  LiveWorkoutSet,
  WorkoutSetType,
  RoutineDay,
} from '../types/workout';
import {
  instantiateRoutineFromTemplate,
} from '../data/workoutTemplates';
import {
  calculateEpley1RM,
  calculateSessionTonnage,
  calculateAverageRir,
} from '../utils/workoutCalculations';
import { getExerciseById } from '../data/exerciseCatalog';
import { createDemoExecutedWorkoutsHistory } from '../data/demoWorkoutsSeed';
import {
  UserProfile,
  AppNotification,
  NotificationPreferences,
  AthletePreferences,
  DEFAULT_ATHLETE_PREFERENCES,
} from '../types/auth';
import { MesocycleRoutine } from '../types/mesocycle';
import { updateMesocycleWeekProgress } from '../services/mesocycleGeneratorService';
import {
  enqueueOfflineSet,
  syncOfflineSetsForUser,
  getOfflinePendingSets,
  migrateLegacyPendingSets,
} from '../services/workoutSyncQueue';
import { UserRole } from '../types/admin';
import {
  authRepo,
  athleteRepo,
  authBridge,
  parseAppRoute,
  navigateBrowserPath,
  CleanSlateRepositoryError,
  ROUTE_CHANGE_EVENT,
  type ParsedAppRoute,
} from '../services/catalystClient';
import {
  DEFAULT_AVATAR_URL,
  buildProfileSelfPatch,
  fromCleanBiometrics,
  fromCleanCardioSession,
  fromCleanExecutedWorkout,
  fromCleanGrocery,
  fromCleanMealLog,
  fromCleanMealPlan,
  fromCleanNotification,
  fromCleanPreferences,
  fromCleanProfile,
  fromCleanRecipe,
  fromCleanWorkoutRoutine,
  fromCleanWorkoutSet,
  resolveUserRole,
  toCleanActionView,
  toCleanBiometrics,
  toCleanCardioSession,
  toCleanExercisesSnapshot,
  toCleanGrocery,
  toCleanMealLog,
  toCleanMealPlan,
  toCleanMuscleGroup,
  toCleanPreferences,
  toCleanRecipe,
  toCleanWorkoutRoutine,
} from '../services/catalystMappers';
import type { UserAccountModel } from '../../poc/catalyst-clean-slate/src/frontend/contracts/cleanSlateModels';

interface AppContextType {
  currentPath: NavigationPath;
  navigate: (path: NavigationPath) => void;

  // Auth System & RBAC (Increment 7D)
  currentUser: UserProfile | null;
  currentUserRole: UserRole;
  refreshUserClaims: () => Promise<UserRole>;
  isAuthenticated: boolean;
  isDemoMode: boolean;
  authStatus: AuthStatus;
  authError: string | null;
  unverifiedEmail: string | null;
  isLoggingOut: boolean;
  loginWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  completeCatalystSession: () => Promise<{ success: boolean; error?: string }>;
  loginWithEmail: (email: string, password: string) => Promise<{ success: boolean; error?: string; verificationRequired?: boolean }>;
  registerWithEmail: (email: string, password: string, fullName: string, role?: 'Atleta Pro' | 'Coach' | 'Nutricionista') => Promise<{ success: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  checkEmailVerification: () => Promise<{ verified: boolean; error?: string }>;
  sendVerificationEmail: () => Promise<{ success: boolean; error?: string }>;
  startDemoMode: (role?: 'Atleta Pro' | 'Coach' | 'Nutricionista', name?: string, email?: string) => void;
  logout: () => Promise<{ success: boolean; error?: string }>;
  redirectPath: NavigationPath | null;
  setRedirectPath: (path: NavigationPath | null) => void;
  isAuthModalOpen: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;

  // Template Loader
  loadDemoTemplates: () => Promise<void>;

  // Notification System
  notifications: AppNotification[];
  unreadNotificationCount: number;
  markNotificationAsRead: (id: string) => void;
  markAllNotificationsAsRead: () => void;
  deleteNotification: (id: string) => void;
  notificationPreferences: NotificationPreferences;
  updateNotificationPreferences: (prefs: Partial<NotificationPreferences>) => void;
  requestPushPermission: () => Promise<boolean>;
  sendPushAlert: (title: string, message: string, category: AppNotification['category']) => void;
  isNotificationPanelOpen: boolean;
  openNotificationPanel: () => void;
  closeNotificationPanel: () => void;
  isPreferencesModalOpen: boolean;
  openPreferencesModal: () => void;
  closePreferencesModal: () => void;

  // Athlete Preferences & Onboarding (Increment 7A)
  athletePreferences: AthletePreferences;
  updateAthleteProfile: (updates: Partial<UserProfile>) => Promise<{ success: boolean; error?: string }>;
  updateAthletePreferences: (updates: Partial<AthletePreferences>) => Promise<{ success: boolean; error?: string }>;
  saveOnboardingStep: (step: number, partialData?: { profile?: Partial<UserProfile>; preferences?: Partial<AthletePreferences>; biometrics?: Partial<BiometricConfig> }) => Promise<void>;
  completeOnboarding: (data: { profile: Partial<UserProfile>; biometrics: Partial<BiometricConfig>; preferences: Partial<AthletePreferences> }) => Promise<{ success: boolean; error?: string }>;

  // Biometrics & Nutrition Target
  biometrics: BiometricConfig;
  updateBiometrics: (updates: Partial<BiometricConfig>) => void;
  resetBiometricsToExcel: () => void;
  revertToPreviousBiometrics: () => Promise<boolean>;
  mealPartition: MealMomentPartition;
  updateMealPartition: (updates: Partial<MealMomentPartition>) => void;

  // Grocery List
  groceries: GroceryItem[];
  toggleGroceryStatus: (id: string) => void;
  addGrocery: (item: Omit<GroceryItem, 'id' | 'status'>) => void;
  editGrocery: (id: string, name: string, quantity: number, unit: string, department?: GroceryDepartment, notes?: string) => Promise<void>;
  resetGroceryToPlan: (id: string) => Promise<void>;
  deleteGrocery: (id: string) => void;
  clearCompletedGroceries: () => void;
  regenerateFromMenu: () => void;

  // Meal Logging
  mealLogs: MealLogItem[];
  addMealLog: (item: Omit<MealLogItem, 'id'>) => void;
  deleteMealLog: (id: string) => void;
  duplicateMealLog: (id: string) => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  selectedDateFormatted: string;
  selectedDaySummary: {
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
    waterLiters: number;
    mealCount: number;
  };
  todaySummary: {
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
    waterLiters: number;
    mealCount?: number;
  };
  hasBiometricsConfigured: boolean;

  // Modals
  isMealDrawerOpen: boolean;
  mealDrawerMoment?: MealMoment;
  openMealDrawer: (moment?: MealMoment | unknown) => void;
  closeMealDrawer: () => void;
  isWorkoutModalOpen: boolean;
  openWorkoutModal: () => void;
  closeWorkoutModal: () => void;

  // Mobile sidebar
  isMobileSidebarOpen: boolean;
  toggleMobileSidebar: () => void;
  closeMobileSidebar: () => void;

  // Notifications Toast
  toast: ToastMessage | null;
  showToast: (text: string, type?: 'success' | 'info' | 'warning') => void;

  // Cardio & Live Workout
  activeWorkout: WorkoutExercise;
  commitActiveSet: (weight: number, reps: number, rir: number) => void;
  workoutHistory: WorkoutSessionRecord[];
  restTimerSeconds: number;
  isRestTimerRunning: boolean;
  adjustRestTimer: (delta: number) => void;
  resetRestTimer: (customSeconds?: number) => void;
  toggleRestTimer: () => void;
  cardioSessions: CardioSession[];
  addCardioSession: (session: Omit<CardioSession, 'id'>) => Promise<void>;

  // Workout Routines (Increment 6B)
  workoutRoutines: WorkoutRoutine[];
  activeRoutine: WorkoutRoutine | null;
  activeRoutineId: string | null;
  routineSyncStatus: 'synced' | 'saving' | 'error' | 'idle';
  setActiveRoutineId: (id: string) => void;
  createRoutineFromTemplate: (templateId: string, customName?: string) => Promise<string>;
  createCustomRoutine: (routine: Omit<WorkoutRoutine, 'id' | 'userId' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  updateWorkoutRoutine: (id: string, updates: Partial<WorkoutRoutine>) => Promise<void>;
  deleteWorkoutRoutine: (id: string) => Promise<void>;
  addExerciseToRoutineDay: (routineId: string, dayId: string, exerciseId: string, config?: Partial<PlannedExerciseConfig>) => Promise<void>;
  removeExerciseFromRoutineDay: (routineId: string, dayId: string, configId: string) => Promise<void>;
  reorderExercisesInRoutineDay: (routineId: string, dayId: string, startIndex: number, endIndex: number) => Promise<void>;
  updateRoutineExerciseConfig: (routineId: string, dayId: string, configId: string, updates: Partial<PlannedExerciseConfig>) => Promise<void>;
  saveMesocycleRoutine: (program: MesocycleRoutine, activateNow?: boolean) => Promise<string>;
  advanceMesocycleWeek: (routineId: string, targetWeek: number) => Promise<void>;

  // Live Workout Execution Engine (Increment 6C)
  activeLiveWorkout: ExecutedWorkout | null;
  executedWorkoutsHistory: ExecutedWorkout[];
  hasRecoveredLiveSession: boolean;
  startLiveWorkout: (routine: WorkoutRoutine, day: RoutineDay) => Promise<string>;
  startQuickLiveWorkout: (name?: string) => Promise<string>;
  commitLiveSet: (exerciseIndex: number, weightKg: number, reps: number, rir: number, setType: WorkoutSetType) => Promise<void>;
  addExtraLiveSet: (exerciseIndex: number, type?: WorkoutSetType) => void;
  finishLiveWorkout: (notes?: string, sessionRpe?: number, finalDurationSeconds?: number) => Promise<{ success: boolean; error?: string }>;
  abandonLiveWorkout: () => Promise<void>;
  resumeRecoveredLiveSession: () => void;
  discardRecoveredLiveSession: () => void;
  updateLiveSessionDuration: (seconds: number) => void;
  pendingOfflineSetsCount: number;
  syncPendingOfflineSets: () => Promise<void>;

  // Recipe Library & Weekly Plans (Increment 4)
  recipes: Recipe[];
  addRecipe: (recipe: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  updateRecipe: (id: string, updates: Partial<Recipe>) => Promise<void>;
  deleteRecipe: (id: string) => Promise<void>;
  mealPlans: Record<string, WeeklyMealPlan>;
  currentMealPlan: WeeklyMealPlan;
  activeWeekStart: string;
  setActiveWeekStart: (weekStart: string) => void;
  assignRecipeToSlot: (date: string, moment: MealMoment, recipeId: string, servings?: number) => Promise<void>;
  removeSlotFromPlan: (date: string, moment: MealMoment) => Promise<void>;
  logPlannedMeal: (date: string, moment: MealMoment, recipeId: string) => Promise<void>;
  syncMealPlanToGroceries: (weekPlan?: WeeklyMealPlan) => Promise<SyncSummary>;

  // Modals for Recipes & Assigning
  isRecipeModalOpen: boolean;
  recipeModalData: { mode: 'create' | 'edit'; recipe?: Recipe; initialMoment?: MealMoment } | null;
  openRecipeModal: (options?: { recipe?: Recipe; initialMoment?: MealMoment }) => void;
  closeRecipeModal: () => void;

  isAssignModalOpen: boolean;
  assignModalSlot: { date: string; moment: MealMoment; currentRecipeId?: string } | null;
  openAssignModal: (date: string, moment: MealMoment, currentRecipeId?: string) => void;
  closeAssignModal: () => void;
}

const defaultUser: UserProfile = {
  id: 'usr_camilo_demo',
  name: 'Camilo R. (Demo)',
  email: 'camilo@vigor.co',
  avatarUrl: DEFAULT_AVATAR_URL,
  role: 'Atleta Pro',
  location: 'Bogotá (UTC-5)',
  joinedDate: 'Octubre 2024',
};

const templateNotifications: AppNotification[] = [
  {
    id: 'notif-1',
    title: 'Cena programada pendiente',
    message: 'Salmón fresco con puré de batata (595 kcal) listo para registrar a las 20:30.',
    timestamp: 'Hace 15 min',
    category: 'nutricion',
    read: false,
    severity: 'info',
    actionPath: 'menu-semanal',
  },
  {
    id: 'notif-2',
    title: '¡Nuevo Récord Personal Validado!',
    message: 'Press de Banca Plano: 85.0 kg x 8 reps @ RIR 1 (+2.5 kg). 1RM pico estimado: 107.5 kg.',
    timestamp: 'Hoy, 09:12 AM',
    category: 'entrenamiento',
    read: false,
    severity: 'success',
    actionPath: 'progreso-del-entrenamiento',
  },
  {
    id: 'notif-3',
    title: 'Insumos pendientes en Lista de Compras',
    message: '12 artículos pendientes de adquisición para abastecer el Menú Semanal 43.',
    timestamp: 'Ayer, 18:30',
    category: 'compras',
    read: true,
    severity: 'warning',
    actionPath: 'lista-de-compras',
  },
];

const defaultBiometrics: BiometricConfig = (() => {
  const weightKg = 74.5;
  const heightCm = 178;
  const age = 30;
  const bodyFatPct = 15.2;
  const palFactor = 1.55;
  const targetDeltaKcal = -400;
  const proteinPerKg = 2.0;
  const fatPerKg = 0.8;

  const bmr = Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + 5);
  const tdee = Math.round(bmr * palFactor);
  const targetCalories = tdee + targetDeltaKcal;
  const targetProteinG = Math.round(weightKg * proteinPerKg);
  const targetFatG = Math.round(weightKg * fatPerKg);
  const targetCarbsG = Math.round((targetCalories - targetProteinG * 4 - targetFatG * 9) / 4);

  return {
    weightKg,
    heightCm,
    bodyFatPct,
    age,
    palFactor,
    targetDeltaKcal,
    proteinPerKg,
    fatPerKg,
    bmr,
    tdee,
    targetCalories,
    targetProteinG,
    targetFatG,
    targetCarbsG,
  };
})();

const templateGroceries: GroceryItem[] = [
  {
    id: 'meat-1',
    name: 'Pollo en filetes (Pechuga magra)',
    quantity: 1.75,
    unit: 'kg',
    department: 'carnes',
    status: 'completed',
    notes: 'Pechuga desgrasada en filetes homogéneos',
    recipeSource: 'Calculado de: 7 tomas de almuerzo (250g c/u)',
    nutritionInfo: 'Aporte: 402g Prot • 0g Carb • 21g Gras',
  },
  {
    id: 'meat-2',
    name: 'Salmón fresco salvaje',
    quantity: 400,
    unit: 'g',
    department: 'carnes',
    status: 'pending',
    notes: 'Lomos sin espinas, rico en Omega-3 EPA/DHA',
    recipeSource: 'Calculado de: 2 cenas programadas (Martes/Viernes)',
    nutritionInfo: 'Rico en Omega-3 EPA/DHA',
  },
  {
    id: 'dairy-1',
    name: 'Huevos campesinos (Grado AA)',
    quantity: 14,
    unit: 'unid',
    department: 'huevos',
    status: 'completed',
    notes: 'Huevos de pastoreo ricos en colina y luteína',
    recipeSource: 'Calculado de: Desayunos Lunes-Domingo (2 c/u)',
    nutritionInfo: 'Aporte: 84g Prot • 70g Gras',
  },
  {
    id: 'veg-1',
    name: 'Espinacas baby frescas',
    quantity: 300,
    unit: 'g',
    department: 'verduras',
    status: 'pending',
    notes: 'Listas para consumo en ensalada y batidos',
    recipeSource: 'Calculado de: Cenas Lunes, Miércoles, Sábado',
    nutritionInfo: 'Ricas en folato, hierro y nitratos',
  },
  {
    id: 'carb-1',
    name: 'Avena en copos integral',
    quantity: 1,
    unit: 'kg',
    department: 'carbohidratos',
    status: 'completed',
    notes: 'Copos gruesos no procesados sin azúcares añadidos',
    recipeSource: 'Calculado de: 7 desayunos (80g c/u)',
    nutritionInfo: 'Rica en betaglucanos y fibra soluble',
  },
  {
    id: 'fat-1',
    name: 'Aceite de Oliva Virgen Extra (AOVE)',
    quantity: 500,
    unit: 'ml',
    department: 'grasas',
    status: 'completed',
    notes: 'Acidez <0.4% prensado en frío',
    recipeSource: 'Calculado de: Aderezos diarios (20ml/día)',
    nutritionInfo: 'Ácido oleico y polifenoles antioxidantes',
  },
];

const templateMealLogs: MealLogItem[] = [
  {
    id: 'log-1',
    dateTime: '2024-10-24T08:15',
    moment: 'desayuno',
    title: 'Bowl de avena integral con frutos rojos y whey protein',
    description: 'Avena 80g, Frutos rojos 100g, Aislado de suero 30g, Semillas de chía 10g',
    portion: '320 g',
    calories: 520,
    protein: 38.5,
    carbs: 62.0,
    fats: 9.8,
    source: 'Plantilla',
    verified: true,
  },
  {
    id: 'log-2',
    dateTime: '2024-10-24T13:30',
    moment: 'almuerzo',
    title: 'Pechuga a la plancha con arroz jazmín y aguacate',
    description: 'Pechuga 220g, Arroz jazmín cocido 180g, Aguacate hass 50g, Brócoli al vapor',
    portion: '430 g',
    calories: 680,
    protein: 58.2,
    carbs: 64.0,
    fats: 16.5,
    source: 'Manual',
    verified: true,
  },
  {
    id: 'log-3',
    dateTime: '2024-10-24T17:00',
    moment: 'merienda',
    title: 'Yogur griego natural con nueces y miel',
    description: 'Yogur griego 0% 200g, Nueces de nogal 25g, Miel pura 10g',
    portion: '235 g',
    calories: 310,
    protein: 24.0,
    carbs: 22.0,
    fats: 14.0,
    source: 'Receta',
    verified: true,
  },
];

const initialWorkout: WorkoutExercise = {
  id: 'pendlay-1',
  name: 'Remo con Barra Pendlay (90°)',
  category: 'Espalda / Dorsal & Romboide',
  targetMuscles: 'Dorsal Ancho, Trapecio medio, Romboides, Erectores espinales',
  tempo: '2-0-1-0',
  cue: 'Torso estrictamente paralelo al suelo, inicio muerto en cada repetición desde tarima, tracción violenta al esternón bajo sin hiperextender cuello.',
  historicalRecord: '72.5 kg x 8, 8, 7, 7 reps (RIR 1)',
  sets: [
    { setNumber: 1, type: 'Aprox.', weightKg: 40.0, reps: 10, rir: 5, completed: true, estimated1RM: 53.3 },
    { setNumber: 2, type: 'Efectiva 1', weightKg: 75.0, reps: 8, rir: 2, completed: true, estimated1RM: 95.0 },
    { setNumber: 3, type: 'Efectiva 2', weightKg: 75.0, reps: 8, rir: 1, completed: true, estimated1RM: 95.0 },
    { setNumber: 4, type: 'Efectiva 3', weightKg: 75.0, reps: 7, rir: 1, completed: false, estimated1RM: 92.5 },
    { setNumber: 5, type: 'Efectiva 4', weightKg: 75.0, reps: 7, rir: 1, completed: false, estimated1RM: 92.5 },
  ],
};

const initialCardioSessions: CardioSession[] = [
  {
    id: 'cardio-1',
    date: 'Hoy, 07:15',
    title: 'Caminadora Inclinada Z2',
    details: '12% inclinación · 4.8 km/h',
    durationMinutes: 45,
    avgHr: 133,
    maxHr: 139,
    zone2Minutes: 42.3,
    zone2Percentage: 94,
    caloriesBurned: 380,
    device: 'Registro manual',
  },
  {
    id: 'cardio-2',
    date: 'Ayer, 18:30',
    title: 'Bicicleta de Aire HIIT 10x(20/40)',
    details: 'Intervalos de alta intensidad (20s / 40s)',
    durationMinutes: 15,
    avgHr: 164,
    maxHr: 183,
    zone2Minutes: 0,
    zone2Percentage: 0,
    caloriesBurned: 210,
    device: 'Registro manual',
  },
];

const initialNotificationPreferences: NotificationPreferences = {
  mealReminders: true,
  workoutAlerts: true,
  groceryAlerts: true,
  systemSync: true,
  soundEnabled: true,
  pushEnabled: false,
  pushPermission: typeof window !== 'undefined' && 'Notification' in window ? (Notification.permission as any) : 'default',
};

const defaultMealPartition: MealMomentPartition = {
  desayunoPct: 25,
  almuerzoPct: 35,
  meriendaPct: 15,
  cenaPct: 25,
};

const loadScopedPreference = <T,>(baseKey: string, scopeKey: string, fallback: T): T => {
  try {
    const scopedVal = localStorage.getItem(scopeKey);
    if (scopedVal) return JSON.parse(scopedVal);
    const legacyVal = localStorage.getItem(baseKey);
    if (legacyVal) return JSON.parse(legacyVal);
  } catch {}
  return fallback;
};

function isNetworkOrUnavailableError(err: unknown): boolean {
  if (err instanceof CleanSlateRepositoryError) {
    return (
      err.statusCode === 0 ||
      err.statusCode === 401 ||
      err.statusCode === 502 ||
      err.statusCode === 503 ||
      err.code === 'UNAUTHENTICATED' ||
      err.code === 'SESSION_EXPIRED' ||
      err.code === 'NETWORK_ERROR' ||
      err.code === 'CATALYST_USER_NOT_AUTHENTICATED' ||
      err.code === 'CATALYST_WEB_SDK_UNAVAILABLE'
    );
  }
  return false;
}

function resolveEffectiveAuthRoute(): ParsedAppRoute {
  if (typeof window === 'undefined') {
    return parseAppRoute({ pathname: '/', search: '', origin: 'http://localhost' });
  }
  const directRoute = parseAppRoute(window.location);
  if (directRoute.routeId === 'auth-login' || directRoute.routeId === 'auth-callback') {
    return directRoute;
  }

  const rawHash = (window.location.hash || '').replace(/^#/, '');
  if (rawHash) {
    const normalizedHash = rawHash.startsWith('/') ? rawHash : `/${rawHash}`;
    const qIndex = normalizedHash.indexOf('?');
    const hashPathname = qIndex >= 0 ? normalizedHash.slice(0, qIndex) : normalizedHash;
    const hashSearch = qIndex >= 0 ? normalizedHash.slice(qIndex) : '';
    const hashRoute = parseAppRoute({
      pathname: hashPathname,
      search: hashSearch,
      origin: window.location.origin,
    });
    if (hashRoute.routeId === 'auth-login' || hashRoute.routeId === 'auth-callback') {
      return hashRoute;
    }
  }

  return directRoute;
}

function resolveTargetPathFromSafeNext(safeNextPath: string): NavigationPath {
  const cleanCandidate = (safeNextPath || '/')
    .split('?')[0]
    .replace(/^#?\/+/, '')
    .trim();
  if (cleanCandidate && isPrivatePath(cleanCandidate)) {
    return cleanCandidate;
  }
  return 'dashboard-nutricional';
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const getInitialPath = (): NavigationPath => {
    if (typeof window !== 'undefined') {
      const parsed = resolveEffectiveAuthRoute();
      if (parsed.routeId === 'auth-login') return 'login';
      if (parsed.routeId === 'auth-callback') {
        return resolveTargetPathFromSafeNext(parsed.safeNextPath);
      }
      if (window.location.hash) {
        const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0];
        if (!hash) return 'landing';
        if (isPrivatePath(hash) || PUBLIC_NAVIGATION_PATHS.includes(hash as any)) {
          return hash as NavigationPath;
        }
      }
    }
    return 'landing';
  };

  const [currentPath, setCurrentPath] = useState<NavigationPath>(getInitialPath);
  const [redirectPath, setRedirectPath] = useState<NavigationPath | null>(null);
  const callbackAttemptedRef = useRef<string | null>(null);

  // Catalyst Auth State (replaces Firebase User)
  const [sessionUid, setSessionUid] = useState<string | null>(null);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(() => {
    return localStorage.getItem('vigor_is_demo') === 'true';
  });
  const [authStatus, setAuthStatus] = useState<AuthStatus>('initializing');
  const [authError, setAuthError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [pendingOfflineSetsCount, setPendingOfflineSetsCount] = useState<number>(0);

  useEffect(() => {
    migrateLegacyPendingSets();
  }, []);

  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    const isDemo = localStorage.getItem('vigor_is_demo') === 'true';
    if (isDemo) {
      const saved = localStorage.getItem('vigor_demo_user');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {}
      }
    }
    return null;
  });

  const [currentUserRole, setCurrentUserRole] = useState<UserRole>('athlete');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Notifications State
  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    const saved = localStorage.getItem('vigor_notifications');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return templateNotifications;
  });

  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(() => {
    const isDemo = localStorage.getItem('vigor_is_demo') === 'true';
    const savedUser = localStorage.getItem('vigor_auth_user');
    let uid = 'demo_camilo';
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        if (parsed?.id) uid = isDemo ? parsed.id : `uid_${parsed.id}`;
      } catch {}
    }
    return loadScopedPreference('vigor_notif_prefs', `vigor_notif_prefs_${uid}`, initialNotificationPreferences);
  });
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
  const [isPreferencesModalOpen, setIsPreferencesModalOpen] = useState(false);

  // Biometrics & Nutrition
  const [biometrics, setBiometrics] = useState<BiometricConfig>(defaultBiometrics);
  const [mealPartition, setMealPartition] = useState<MealMomentPartition>(() => {
    const isDemo = localStorage.getItem('vigor_is_demo') === 'true';
    const savedUser = localStorage.getItem('vigor_auth_user');
    let uid = 'demo_camilo';
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        if (parsed?.id) uid = isDemo ? parsed.id : `uid_${parsed.id}`;
      } catch {}
    }
    return loadScopedPreference('vigor_meal_partition', `vigor_meal_partition_${uid}`, defaultMealPartition);
  });

  const [athletePreferences, setAthletePreferences] = useState<AthletePreferences>(() => {
    const isDemo = localStorage.getItem('vigor_is_demo') === 'true';
    const savedUser = localStorage.getItem('vigor_auth_user');
    let uid = 'demo_camilo';
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        if (parsed?.id) uid = isDemo ? parsed.id : `uid_${parsed.id}`;
      } catch {}
    }
    return loadScopedPreference('vigor_athlete_prefs', `vigor_athlete_prefs_${uid}`, DEFAULT_ATHLETE_PREFERENCES);
  });

  // Groceries & Meals
  const [groceries, setGroceries] = useState<GroceryItem[]>(() => {
    const saved = localStorage.getItem('vigor_groceries');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return templateGroceries;
  });

  const [mealLogs, setMealLogs] = useState<MealLogItem[]>(() => {
    const isDemo = localStorage.getItem('vigor_is_demo') === 'true';
    const savedUser = localStorage.getItem('vigor_auth_user');
    let uid = 'demo-user-athlete';
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        if (parsed?.id) uid = parsed.id;
      } catch {}
    }
    const scopedKey = isDemo ? `vigor_meal_logs_${uid}` : 'vigor_meal_logs';
    const saved = localStorage.getItem(scopedKey) || localStorage.getItem('vigor_meal_logs');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return templateMealLogs;
  });

  // Workout
  const [activeWorkout, setActiveWorkout] = useState<WorkoutExercise>(initialWorkout);
  const [workoutHistory, setWorkoutHistory] = useState<WorkoutSessionRecord[]>(() => {
    const isDemo = localStorage.getItem('vigor_is_demo') === 'true';
    if (isDemo) {
      try {
        const savedUser = localStorage.getItem('vigor_auth_user');
        let uid = 'demo_camilo';
        if (savedUser) {
          try {
            const parsed = JSON.parse(savedUser);
            if (parsed?.id) uid = parsed.id;
          } catch {}
        }
        const saved = localStorage.getItem(`vigor_workout_sessions_${uid}`) || localStorage.getItem('vigor_workout_sessions_demo');
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return [];
  });
  const [restTimerSeconds, setRestTimerSeconds] = useState<number>(105);
  const [isRestTimerRunning, setIsRestTimerRunning] = useState<boolean>(true);
  const [cardioSessions, setCardioSessions] = useState<CardioSession[]>(initialCardioSessions);

  // Live Workout Execution Engine
  const [activeLiveWorkout, setActiveLiveWorkout] = useState<ExecutedWorkout | null>(() => {
    try {
      const saved = localStorage.getItem('vigor_active_live_session');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.id && parsed.status === 'in_progress') {
          return parsed as ExecutedWorkout;
        }
      }
    } catch {}
    return null;
  });

  const [hasRecoveredLiveSession, setHasRecoveredLiveSession] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('vigor_active_live_session');
      if (saved) {
        const parsed = JSON.parse(saved);
        return !!(parsed?.id && parsed.status === 'in_progress');
      }
    } catch {}
    return false;
  });

  const [executedWorkoutsHistory, setExecutedWorkoutsHistory] = useState<ExecutedWorkout[]>(() => {
    const isDemo = localStorage.getItem('vigor_is_demo') === 'true';
    if (isDemo) {
      try {
        const savedUser = localStorage.getItem('vigor_auth_user');
        let uid = 'demo_camilo';
        if (savedUser) {
          try {
            const parsed = JSON.parse(savedUser);
            if (parsed?.id) uid = parsed.id;
          } catch {}
        }
        const saved = localStorage.getItem(`vigor_executed_workouts_${uid}`) || localStorage.getItem('vigor_executed_workouts_demo');
        if (saved) return JSON.parse(saved);
        const demoSeed = createDemoExecutedWorkoutsHistory(uid);
        localStorage.setItem(`vigor_executed_workouts_${uid}`, JSON.stringify(demoSeed));
        return demoSeed;
      } catch {}
    }
    return [];
  });

  // Workout Routines
  const [workoutRoutines, setWorkoutRoutines] = useState<WorkoutRoutine[]>(() => {
    const isDemo = localStorage.getItem('vigor_is_demo') === 'true';
    if (isDemo) {
      const savedUser = localStorage.getItem('vigor_auth_user');
      let uid = 'demo_camilo';
      if (savedUser) {
        try {
          const parsed = JSON.parse(savedUser);
          if (parsed?.id) uid = parsed.id;
        } catch {}
      }
      const demoKey = `vigor_workout_routines_${uid}`;
      const saved = localStorage.getItem(demoKey) || localStorage.getItem('vigor_workout_routines_demo');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {}
      }
      const defaultDemo = instantiateRoutineFromTemplate('template_torso_pierna_4d', uid);
      return [defaultDemo];
    }
    return [];
  });

  const [activeRoutineIdState, setActiveRoutineIdState] = useState<string | null>(() => {
    const isDemo = localStorage.getItem('vigor_is_demo') === 'true';
    if (isDemo) {
      const savedUser = localStorage.getItem('vigor_auth_user');
      let uid = 'demo_camilo';
      if (savedUser) {
        try {
          const parsed = JSON.parse(savedUser);
          if (parsed?.id) uid = parsed.id;
        } catch {}
      }
      const savedActive = localStorage.getItem(`vigor_active_routine_${uid}`);
      return savedActive || null;
    }
    return null;
  });

  const [routineSyncStatus, setRoutineSyncStatus] = useState<'synced' | 'saving' | 'error' | 'idle'>('idle');

  const activeRoutine = useMemo<WorkoutRoutine | null>(() => {
    if (workoutRoutines.length === 0) return null;
    if (activeRoutineIdState) {
      const found = workoutRoutines.find(r => r.id === activeRoutineIdState);
      if (found) return found;
    }
    const def = workoutRoutines.find(r => r.isDefault);
    return def || workoutRoutines[0];
  }, [workoutRoutines, activeRoutineIdState]);

  const setActiveRoutineId = (id: string) => {
    setActiveRoutineIdState(id);
    if (id) {
      setWorkoutRoutines(prev => prev.map(r => ({ ...r, isDefault: r.id === id })));
    }
    if (sessionUid && !isDemoMode && id) {
      athleteRepo
        .setDefaultRoutine(sessionUid, id)
        .then(updated => {
          if (Array.isArray(updated) && updated.length > 0) {
            setWorkoutRoutines(updated.map(r => fromCleanWorkoutRoutine(r, sessionUid)));
          }
        })
        .catch(err => console.warn('Aviso al establecer rutina predeterminada:', err));
    } else if (currentUser?.id && id) {
      localStorage.setItem(`vigor_active_routine_${currentUser.id}`, id);
    }
  };

  // Date Selection for Nutrition & Diary
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const isDemo = localStorage.getItem('vigor_is_demo') === 'true';
    return isDemo ? '2024-10-24' : getTodayLocalDateString();
  });
  const [hasBiometricsConfigured, setHasBiometricsConfigured] = useState<boolean>(() => {
    return localStorage.getItem('vigor_is_demo') === 'true';
  });
  const [mealDrawerMoment, setMealDrawerMoment] = useState<MealMoment | undefined>(undefined);

  // Recipe Library & Weekly Meal Plans
  const [recipes, setRecipes] = useState<Recipe[]>(() => {
    const isDemo = localStorage.getItem('vigor_is_demo') === 'true';
    if (isDemo) {
      const saved = localStorage.getItem('vigor_recipes_demo');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {}
      }
    }
    return TEMPLATE_RECIPES;
  });

  const [activeWeekStart, setActiveWeekStart] = useState<string>(() => {
    const { weekStart } = getWeekStartEnd('2024-10-24');
    return weekStart;
  });

  const [mealPlans, setMealPlans] = useState<Record<string, WeeklyMealPlan>>(() => {
    const default2024 = createDefaultWeeklyPlan('2024-10-21', '2024-10-27', 'usr_camilo_demo', TEMPLATE_RECIPES);
    return {
      '2024-10-21': default2024,
      [default2024.id]: default2024,
    };
  });

  // Modals
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [recipeModalData, setRecipeModalData] = useState<{
    mode: 'create' | 'edit';
    recipe?: Recipe;
    initialMoment?: MealMoment;
  } | null>(null);

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [assignModalSlot, setAssignModalSlot] = useState<{
    date: string;
    moment: MealMoment;
    currentRecipeId?: string;
  } | null>(null);

  const [isMealDrawerOpen, setIsMealDrawerOpen] = useState(false);
  const [isWorkoutModalOpen, setIsWorkoutModalOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = useCallback((text: string, type: 'success' | 'info' | 'warning' = 'success') => {
    const id = Date.now().toString();
    setToast({ id, text, type });
    setTimeout(() => {
      setToast(current => (current?.id === id ? null : current));
    }, 3000);
  }, []);

  const navigate = useCallback(
    (path: NavigationPath) => {
      if (isPrivatePath(path) && authStatus !== 'authenticated') {
        setRedirectPath(path);
        setCurrentPath('login');
        if (typeof window !== 'undefined') {
          window.location.hash = '#/login';
        }
        setIsMobileSidebarOpen(false);
        return;
      }

      if (authStatus === 'authenticated' && currentUser?.onboardingCompleted === false && path !== 'onboarding') {
        setCurrentPath('onboarding');
        if (typeof window !== 'undefined') {
          window.location.hash = '#/onboarding';
        }
        setIsMobileSidebarOpen(false);
        showToast('Por favor completa la configuración inicial para ingresar a tu dashboard personalizado.', 'info');
        return;
      }

      setCurrentPath(path);
      if (typeof window !== 'undefined') {
        window.location.hash = path === 'landing' ? '#/' : `#/${path}`;
      }
      setIsMobileSidebarOpen(false);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [authStatus, currentUser?.onboardingCompleted, showToast]
  );

  useEffect(() => {
    const handleHashChange = () => {
      const effectiveAuthRoute = resolveEffectiveAuthRoute();
      if (effectiveAuthRoute.routeId === 'auth-login') {
        if (authStatus === 'authenticated') {
          const target: NavigationPath =
            currentUser?.onboardingCompleted === false ? 'onboarding' : 'dashboard-nutricional';
          navigateBrowserPath('/', { replace: true });
          window.location.hash = `#/${target}`;
          setCurrentPath(target);
        } else {
          setCurrentPath('login');
        }
        return;
      }

      if (effectiveAuthRoute.routeId === 'auth-callback') {
        setCurrentPath(resolveTargetPathFromSafeNext(effectiveAuthRoute.safeNextPath));
        return;
      }

      const rawHash = window.location.hash.replace(/^#\/?/, '').split('?')[0];
      if (!rawHash) {
        setCurrentPath('landing');
        return;
      }
      const hash = rawHash as NavigationPath;

      if (isPrivatePath(hash)) {
        if (authStatus === 'unauthenticated') {
          setRedirectPath(hash);
          setCurrentPath('login');
          window.location.hash = '#/login';
          return;
        }
        if (currentUser?.onboardingCompleted === false && hash !== 'onboarding') {
          setCurrentPath('onboarding');
          window.location.hash = '#/onboarding';
          return;
        }
      }

      if (isPrivatePath(hash) || PUBLIC_NAVIGATION_PATHS.includes(hash as any)) {
        setCurrentPath(hash);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [authStatus, currentUser?.onboardingCompleted]);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      if (isPrivatePath(currentPath)) {
        setRedirectPath(currentPath);
        setCurrentPath('login');
        if (typeof window !== 'undefined') {
          window.location.hash = '#/login';
        }
      }
    } else if (authStatus === 'authenticated') {
      if (currentUser?.onboardingCompleted === false) {
        setCurrentPath('onboarding');
        if (typeof window !== 'undefined') {
          window.location.hash = '#/onboarding';
        }
      } else if (
        currentPath === 'login' ||
        currentPath === 'registro' ||
        currentPath === 'recuperar-password' ||
        currentPath === 'onboarding'
      ) {
        const target =
          redirectPath && isPrivatePath(redirectPath) && redirectPath !== 'onboarding'
            ? redirectPath
            : 'dashboard-nutricional';
        setRedirectPath(null);
        setCurrentPath(target);
        if (typeof window !== 'undefined') {
          window.location.hash = `#/${target}`;
        }
      }
    }
  }, [authStatus, currentUser?.onboardingCompleted, currentPath, redirectPath]);

  const hydrateRemoteWorkspace = useCallback(async (uid: string, actorFallback?: Record<string, unknown>) => {
    const snap = await athleteRepo.hydrateWorkspace(uid);
    const mappedProfile = fromCleanProfile(snap.profile);
    const role = resolveUserRole(snap.profile as unknown as Record<string, unknown>) || resolveUserRole(actorFallback);

    setSessionUid(uid);
    setIsDemoMode(false);
    localStorage.setItem('vigor_is_demo', 'false');
    localStorage.removeItem('vigor_demo_user');

    setCurrentUser(mappedProfile);
    setCurrentUserRole(role);
    setUnverifiedEmail(null);

    if (snap.biometrics) {
      setBiometrics(fromCleanBiometrics(snap.biometrics));
      setHasBiometricsConfigured(true);
    } else {
      setBiometrics(defaultBiometrics);
      setHasBiometricsConfigured(false);
    }

    const fallbackNotif = loadScopedPreference(
      'vigor_notif_prefs',
      `vigor_notif_prefs_uid_${uid}`,
      initialNotificationPreferences
    );
    const fallbackPart = loadScopedPreference(
      'vigor_meal_partition',
      `vigor_meal_partition_uid_${uid}`,
      defaultMealPartition
    );
    const fallbackAthlete = loadScopedPreference(
      'vigor_athlete_prefs',
      `vigor_athlete_prefs_uid_${uid}`,
      {
        ...DEFAULT_ATHLETE_PREFERENCES,
        onboardingCompleted: mappedProfile.onboardingCompleted ?? true,
        onboardingStep: mappedProfile.onboardingStep ?? 1,
        timezone: mappedProfile.location || 'America/Bogota',
      }
    );

    if (snap.preferences) {
      const mappedPrefs = fromCleanPreferences(
        snap.preferences,
        fallbackAthlete,
        fallbackNotif,
        fallbackPart
      );
      setAthletePreferences(mappedPrefs.athletePreferences);
      setNotificationPreferences(mappedPrefs.notificationPreferences);
      setMealPartition(mappedPrefs.mealPartition);
      localStorage.setItem(`vigor_athlete_prefs_uid_${uid}`, JSON.stringify(mappedPrefs.athletePreferences));
      localStorage.setItem(`vigor_notif_prefs_uid_${uid}`, JSON.stringify(mappedPrefs.notificationPreferences));
      localStorage.setItem(`vigor_meal_partition_uid_${uid}`, JSON.stringify(mappedPrefs.mealPartition));
    } else {
      setAthletePreferences(fallbackAthlete);
      setNotificationPreferences(fallbackNotif);
      setMealPartition(fallbackPart);
    }

    setGroceries(snap.groceries.map(fromCleanGrocery));
    setMealLogs(snap.mealLogs.map(fromCleanMealLog));

    const mappedRecipes = snap.recipes.length > 0 ? snap.recipes.map(r => fromCleanRecipe(r, uid)) : TEMPLATE_RECIPES;
    setRecipes(mappedRecipes);

    const mappedPlans: Record<string, WeeklyMealPlan> = {};
    for (const p of snap.mealPlans) {
      const plan = fromCleanMealPlan(p, uid, mappedRecipes);
      mappedPlans[plan.weekStart] = plan;
      mappedPlans[plan.id] = plan;
    }
    setMealPlans(mappedPlans);

    const mappedRoutines = snap.workoutRoutines.map(r => fromCleanWorkoutRoutine(r, uid));
    setWorkoutRoutines(mappedRoutines);
    const defRoutine = mappedRoutines.find(r => r.isDefault) || mappedRoutines[0] || null;
    setActiveRoutineIdState(defRoutine?.id || null);
    setRoutineSyncStatus('synced');

    setWorkoutHistory(snap.workoutSets.map(s => fromCleanWorkoutSet(s, uid)));
    const mappedExecuted = snap.executedWorkouts.map(w =>
      fromCleanExecutedWorkout(w, snap.workoutSets, uid)
    );
    setExecutedWorkoutsHistory(mappedExecuted);

    const remoteInProgress = mappedExecuted.find(w => w.status === 'in_progress');
    if (remoteInProgress) {
      setActiveLiveWorkout(prev => prev ?? remoteInProgress);
      setHasRecoveredLiveSession(true);
    }

    if (snap.cardioSessions.length > 0) {
      setCardioSessions(snap.cardioSessions.map(fromCleanCardioSession));
    }

    setNotifications(snap.notifications.map(fromCleanNotification));
    setAuthStatus('authenticated');
    setAuthError(null);
    return mappedProfile;
  }, []);

  const refreshUserClaims = async (): Promise<UserRole> => {
    if (!sessionUid || isDemoMode) {
      setCurrentUserRole('athlete');
      return 'athlete';
    }
    try {
      const me = await authRepo.getMe();
      const verifiedRole = resolveUserRole(me.actor);
      setCurrentUserRole(verifiedRole);
      return verifiedRole;
    } catch {
      return 'athlete';
    }
  };

  const handleHostedCallbackRoute = useCallback(
    async (route: ParsedAppRoute, isStillMounted: () => boolean = () => true) => {
      const attemptKey = `${route.pathname}${route.search}`;
      if (callbackAttemptedRef.current === attemptKey) {
        return;
      }
      callbackAttemptedRef.current = attemptKey;

      if (route.cancelled) {
        if (!isStillMounted()) return;
        setSessionUid(null);
        setCurrentUser(null);
        setCurrentUserRole('athlete');
        setIsDemoMode(false);
        setAuthStatus('unauthenticated');
        setAuthError('Inicio de sesión cancelado en Zoho Catalyst.');
        navigateBrowserPath('/', { replace: true });
        if (typeof window !== 'undefined') {
          window.location.hash = '#/login';
        }
        setCurrentPath('login');
        showToast('Inicio de sesión cancelado en Zoho Catalyst.', 'info');
        return;
      }

      if (route.catalystErrorCode) {
        if (!isStillMounted()) return;
        const msg =
          route.catalystErrorMessage ||
          `Error en autenticación Catalyst (${route.catalystErrorCode}).`;
        setAuthError(msg);
        setAuthStatus('error');
        navigateBrowserPath('/', { replace: true });
        return;
      }

      setAuthStatus('initializing');
      setAuthError(null);

      try {
        let sessionResult;
        try {
          sessionResult = await authBridge.establishVigorSession({ mode: 'exchange' });
        } catch (exchangeErr) {
          if (
            exchangeErr instanceof CleanSlateRepositoryError &&
            exchangeErr.code === 'USER_PROFILE_NOT_REGISTERED'
          ) {
            sessionResult = await authBridge.establishVigorSession({ mode: 'bootstrap' });
          } else {
            throw exchangeErr;
          }
        }

        if (!isStillMounted()) return;
        const uid = String(sessionResult.actor?.uid || sessionResult.actor?.user_id || '');
        if (!uid) {
          throw new CleanSlateRepositoryError(
            'INVALID_SESSION_RESPONSE',
            'La sesión devuelta por Catalyst no contiene UID de usuario.',
            502
          );
        }

        const profile = await hydrateRemoteWorkspace(uid, sessionResult.actor);
        if (!isStillMounted()) return;

        const targetPath: NavigationPath =
          profile.onboardingCompleted === false
            ? 'onboarding'
            : resolveTargetPathFromSafeNext(route.safeNextPath);

        navigateBrowserPath('/', { replace: true });
        if (typeof window !== 'undefined') {
          window.location.hash = `#/${targetPath}`;
        }
        setRedirectPath(null);
        setCurrentPath(targetPath);
        showToast('¡Sesión verificada con Zoho Catalyst!', 'success');
      } catch (err: any) {
        if (!isStillMounted()) return;
        if (err instanceof CleanSlateRepositoryError && err.code === 'EMAIL_VERIFICATION_REQUIRED') {
          setUnverifiedEmail(null);
          setCurrentUser(null);
          setAuthStatus('email_verification_required');
          setAuthError(null);
          navigateBrowserPath('/', { replace: true });
          return;
        }
        const errorMsg =
          err?.message || 'No se pudo completar el intercambio de sesión con Zoho Catalyst.';
        setSessionUid(null);
        setCurrentUser(null);
        setCurrentUserRole('athlete');
        setAuthStatus('unauthenticated');
        setAuthError(errorMsg);
        navigateBrowserPath('/', { replace: true });
        if (typeof window !== 'undefined') {
          window.location.hash = '#/login';
        }
        setCurrentPath('login');
        showToast(errorMsg, 'warning');
      }
    },
    [hydrateRemoteWorkspace, showToast]
  );

  // Initial Auth Session Hydration (Catalyst HTTP + Hosted Login Callback)
  useEffect(() => {
    let isMounted = true;
    const isStillMounted = () => isMounted;

    const initAuthSession = async () => {
      const route = typeof window !== 'undefined' ? resolveEffectiveAuthRoute() : null;

      // 1. Handle Catalyst Hosted Login return callback (`/auth/callback` or `#/auth/callback`)
      if (route?.routeId === 'auth-callback') {
        await handleHostedCallbackRoute(route, isStillMounted);
        return;
      }

      // 2. Explicit local Demo Mode
      const isExplicitDemo = localStorage.getItem('vigor_is_demo') === 'true';
      const savedDemo = localStorage.getItem('vigor_demo_user');
      if (isExplicitDemo && savedDemo) {
        try {
          const parsed = JSON.parse(savedDemo);
          if (parsed?.id) {
            if (!isMounted) return;
            setSessionUid(null);
            setCurrentUser(parsed);
            setCurrentUserRole('athlete');
            setIsDemoMode(true);
            setAuthStatus('authenticated');
            setAuthError(null);
            return;
          }
        } catch {}
      }

      // 3. Check existing HTTP HMAC session cookie (`GET /api/v1/auth/me`)
      try {
        const me = await authRepo.getMe();
        if (!isMounted) return;
        const uid = String(me.actor?.uid || '');
        if (!uid) {
          throw new CleanSlateRepositoryError('UNAUTHENTICATED', 'Sesión sin UID.', 401);
        }
        const profile = await hydrateRemoteWorkspace(uid, me.actor);
        if (!isMounted) return;
        if (route?.routeId === 'auth-login') {
          const targetPath: NavigationPath =
            profile.onboardingCompleted === false
              ? 'onboarding'
              : resolveTargetPathFromSafeNext(route.safeNextPath);
          navigateBrowserPath('/', { replace: true });
          window.location.hash = `#/${targetPath}`;
          setCurrentPath(targetPath);
        }
      } catch (err) {
        if (!isMounted) return;
        if (err instanceof CleanSlateRepositoryError && err.code === 'EMAIL_VERIFICATION_REQUIRED') {
          setUnverifiedEmail(null);
          setCurrentUser(null);
          setAuthStatus('email_verification_required');
          setAuthError(null);
          return;
        }

        // Anonymous landing or unauthenticated session — never trap landing in error wall
        if (!isNetworkOrUnavailableError(err)) {
          console.warn('Session check status:', err);
        }
        setSessionUid(null);
        setCurrentUser(null);
        setCurrentUserRole('athlete');
        setIsDemoMode(false);
        localStorage.removeItem('vigor_is_demo');
        localStorage.removeItem('vigor_auth_user');
        localStorage.removeItem('vigor_demo_user');
        setAuthStatus('unauthenticated');
        setAuthError(null);
        if (route?.routeId === 'auth-login') {
          navigateBrowserPath('/', { replace: true });
          window.location.hash = '#/login';
          setCurrentPath('login');
        }
      }
    };

    void initAuthSession();

    const handleRuntimeAuthNavigation = () => {
      if (!isMounted) return;
      const route = resolveEffectiveAuthRoute();
      if (route.routeId === 'auth-callback') {
        void handleHostedCallbackRoute(route, isStillMounted);
      } else if (route.routeId === 'auth-login') {
        navigateBrowserPath('/', { replace: true });
        window.location.hash = '#/login';
        setCurrentPath('login');
      }
    };

    window.addEventListener('popstate', handleRuntimeAuthNavigation);
    window.addEventListener('hashchange', handleRuntimeAuthNavigation);
    window.addEventListener(ROUTE_CHANGE_EVENT, handleRuntimeAuthNavigation);

    return () => {
      isMounted = false;
      window.removeEventListener('popstate', handleRuntimeAuthNavigation);
      window.removeEventListener('hashchange', handleRuntimeAuthNavigation);
      window.removeEventListener(ROUTE_CHANGE_EVENT, handleRuntimeAuthNavigation);
    };
  }, [handleHostedCallbackRoute, hydrateRemoteWorkspace]);

  // Synchronize local state backup for offline demo resilience and user isolation
  useEffect(() => {
    if (currentUser && !isDemoMode) {
      localStorage.setItem('vigor_auth_user', JSON.stringify(currentUser));
    } else if (!currentUser) {
      localStorage.removeItem('vigor_auth_user');
    }
  }, [currentUser, isDemoMode]);

  useEffect(() => {
    if (isDemoMode && currentUser?.id) {
      localStorage.setItem(`vigor_groceries_${currentUser.id}`, JSON.stringify(groceries));
    }
  }, [groceries, isDemoMode, currentUser?.id]);

  useEffect(() => {
    if (isDemoMode && currentUser?.id) {
      localStorage.setItem(`vigor_meal_logs_${currentUser.id}`, JSON.stringify(mealLogs));
    }
  }, [mealLogs, isDemoMode, currentUser?.id]);

  useEffect(() => {
    if (currentUser?.id) {
      const scopeKey = isDemoMode
        ? `vigor_notif_prefs_${currentUser.id}`
        : `vigor_notif_prefs_uid_${currentUser.id}`;
      localStorage.setItem(scopeKey, JSON.stringify(notificationPreferences));
    }
  }, [notificationPreferences, currentUser?.id, isDemoMode]);

  useEffect(() => {
    if (currentUser?.id) {
      const scopeKey = isDemoMode
        ? `vigor_meal_partition_${currentUser.id}`
        : `vigor_meal_partition_uid_${currentUser.id}`;
      localStorage.setItem(scopeKey, JSON.stringify(mealPartition));
    }
  }, [mealPartition, currentUser?.id, isDemoMode]);

  // Rest Timer Interval
  useEffect(() => {
    let interval: any;
    if (isRestTimerRunning && restTimerSeconds > 0) {
      interval = setInterval(() => {
        setRestTimerSeconds(prev => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRestTimerRunning, restTimerSeconds]);

  // Explicit Template Loader
  const loadDemoTemplates = async () => {
    if (sessionUid && !isDemoMode) {
      showToast('Importando plantilla maestra a tu cuenta Zoho Catalyst...');
      try {
        await athleteRepo.syncGroceries(
          sessionUid,
          templateGroceries.map(g => toCleanGrocery({ ...g, origin: 'manual' })),
          { replaceExisting: false }
        );
        const createdLogs: MealLogItem[] = [];
        for (const log of templateMealLogs) {
          const saved = await athleteRepo.logMeal(sessionUid, toCleanMealLog(log));
          createdLogs.push(fromCleanMealLog(saved));
        }
        setGroceries(prev => {
          const existingIds = new Set(prev.map(i => i.id));
          const additions = templateGroceries.filter(t => !existingIds.has(t.id));
          return [...additions, ...prev];
        });
        setMealLogs(prev => [...createdLogs, ...prev]);
        showToast('¡Plantilla de comidas e insumos importada en Zoho Catalyst!', 'success');
      } catch (err: any) {
        showToast(err?.message || 'Error al importar plantillas en el servidor.', 'warning');
      }
    } else {
      setGroceries(templateGroceries);
      setMealLogs(templateMealLogs);
      showToast('Plantilla de demostración cargada localmente');
    }
  };

  const completeCatalystSession = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    try {
      setIsDemoMode(false);
      localStorage.setItem('vigor_is_demo', 'false');
      let sessionResult;
      try {
        sessionResult = await authBridge.establishVigorSession({ mode: 'exchange' });
      } catch (exchangeErr) {
        if (
          exchangeErr instanceof CleanSlateRepositoryError &&
          exchangeErr.code === 'USER_PROFILE_NOT_REGISTERED'
        ) {
          sessionResult = await authBridge.establishVigorSession({ mode: 'bootstrap' });
        } else {
          throw exchangeErr;
        }
      }

      const uid = String(sessionResult.actor?.uid || sessionResult.actor?.user_id || '');
      if (!uid) {
        throw new CleanSlateRepositoryError(
          'INVALID_SESSION_RESPONSE',
          'La sesión devuelta por Catalyst no contiene UID de usuario.',
          502
        );
      }

      const profile = await hydrateRemoteWorkspace(uid, sessionResult.actor);
      const targetPath: NavigationPath =
        profile.onboardingCompleted === false
          ? 'onboarding'
          : redirectPath && isPrivatePath(redirectPath)
          ? redirectPath
          : 'dashboard-nutricional';

      setRedirectPath(null);
      setCurrentPath(targetPath);
      if (typeof window !== 'undefined') {
        window.location.hash = `#/${targetPath}`;
      }
      showToast('¡Sesión verificada con Zoho Catalyst!', 'success');
      return { success: true };
    } catch (err: any) {
      if (err instanceof CleanSlateRepositoryError && err.code === 'EMAIL_VERIFICATION_REQUIRED') {
        setUnverifiedEmail(null);
        setCurrentUser(null);
        setAuthStatus('email_verification_required');
        setAuthError(null);
        return {
          success: false,
          error: 'Tu correo electrónico aún requiere verificación en Zoho Catalyst.',
        };
      }
      const message =
        err?.message || 'No se pudo completar el intercambio de sesión con Zoho Catalyst.';
      setAuthError(message);
      return { success: false, error: message };
    }
  }, [hydrateRemoteWorkspace, redirectPath, showToast]);

  const loginWithGoogle = async (): Promise<{ success: boolean; error?: string }> => {
    try {
      setIsDemoMode(false);
      localStorage.setItem('vigor_is_demo', 'false');
      await authBridge.startHostedLogin('/auth/callback');
      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Error al iniciar Zoho Catalyst Hosted Login.',
      };
    }
  };

  const loginWithEmail = async (
    _email: string,
    _password: string
  ): Promise<{ success: boolean; error?: string; verificationRequired?: boolean }> => {
    try {
      setIsDemoMode(false);
      localStorage.setItem('vigor_is_demo', 'false');
      await authBridge.startHostedLogin('/auth/callback');
      return { success: true, verificationRequired: false };
    } catch (err: any) {
      return {
        success: false,
        error:
          err?.message ||
          'El inicio de sesión se realiza mediante Zoho Catalyst Hosted Login (navegación top-level).',
      };
    }
  };

  const registerWithEmail = async (
    _email: string,
    _password: string,
    _fullName: string,
    _role: 'Atleta Pro' | 'Coach' | 'Nutricionista' = 'Atleta Pro'
  ): Promise<{ success: boolean; error?: string }> => {
    return {
      success: false,
      error:
        'El registro público está deshabilitado. Accede mediante Zoho Catalyst Hosted Login o con una invitación de administrador.',
    };
  };

  const resetPassword = async (_email: string): Promise<{ success: boolean; error?: string }> => {
    return {
      success: false,
      error:
        'La recuperación de contraseña se gestiona directamente en el portal seguro de Zoho Catalyst Hosted Login.',
    };
  };

  const checkEmailVerification = async (): Promise<{ verified: boolean; error?: string }> => {
    try {
      let sessionResult;
      try {
        sessionResult = await authBridge.establishVigorSession({ mode: 'exchange' });
      } catch (err) {
        if (err instanceof CleanSlateRepositoryError && err.code === 'USER_PROFILE_NOT_REGISTERED') {
          sessionResult = await authBridge.establishVigorSession({ mode: 'bootstrap' });
        } else {
          throw err;
        }
      }
      const uid = String(sessionResult.actor?.uid || '');
      if (!uid) {
        return { verified: false, error: 'No se pudo identificar la cuenta verificada.' };
      }
      await hydrateRemoteWorkspace(uid, sessionResult.actor);
      showToast('¡Correo verificado con éxito! Sesión activa en Zoho Catalyst.', 'success');
      return { verified: true };
    } catch (err: any) {
      return {
        verified: false,
        error: err?.message || 'Aún no hemos detectado la confirmación del correo en Zoho Catalyst.',
      };
    }
  };

  const sendVerificationEmail = async (): Promise<{ success: boolean; error?: string }> => {
    return {
      success: false,
      error:
        'El correo de confirmación se envía automáticamente desde Zoho Catalyst Authentication al activar tu cuenta.',
    };
  };

  const startDemoMode = (
    role: 'Atleta Pro' | 'Coach' | 'Nutricionista' = 'Atleta Pro',
    name: string = 'Camilo R. (Demo)',
    email: string = 'camilo@vigor.co'
  ) => {
    if (sessionUid && !isDemoMode) {
      authRepo.logout().catch(() => {});
    }
    setSessionUid(null);
    setIsDemoMode(true);
    localStorage.setItem('vigor_is_demo', 'true');
    const demoId = name.toLowerCase().includes('sof') ? 'demo_sofia' : 'demo_camilo';
    const demoProfile: UserProfile = {
      id: demoId,
      name,
      email,
      avatarUrl: DEFAULT_AVATAR_URL,
      role,
      location: 'Bogotá (UTC-5)',
      joinedDate: 'Octubre 2024',
      onboardingCompleted: true,
      onboardingStep: 6,
      goal: 'ganancia_muscular',
    };
    setCurrentUser(demoProfile);
    setCurrentUserRole('athlete');

    const savedGroceries = localStorage.getItem(`vigor_groceries_${demoId}`);
    setGroceries(savedGroceries ? JSON.parse(savedGroceries) : templateGroceries);

    const savedMealLogs = localStorage.getItem(`vigor_meal_logs_${demoId}`);
    setMealLogs(savedMealLogs ? JSON.parse(savedMealLogs) : templateMealLogs);

    const savedNotif = localStorage.getItem(`vigor_notif_prefs_${demoId}`);
    setNotificationPreferences(savedNotif ? JSON.parse(savedNotif) : initialNotificationPreferences);

    const savedMeal = localStorage.getItem(`vigor_meal_partition_${demoId}`);
    setMealPartition(savedMeal ? JSON.parse(savedMeal) : defaultMealPartition);

    const savedRoutines = localStorage.getItem(`vigor_workout_routines_${demoId}`);
    if (savedRoutines) {
      try {
        setWorkoutRoutines(JSON.parse(savedRoutines));
      } catch {
        setWorkoutRoutines([instantiateRoutineFromTemplate('template_torso_pierna_4d', demoId)]);
      }
    } else {
      const defaultDemo = instantiateRoutineFromTemplate('template_torso_pierna_4d', demoId);
      setWorkoutRoutines([defaultDemo]);
      localStorage.setItem(`vigor_workout_routines_${demoId}`, JSON.stringify([defaultDemo]));
    }
    const savedActive = localStorage.getItem(`vigor_active_routine_${demoId}`);
    localStorage.setItem(`vigor_active_routine_${demoId}`, savedActive || '');
    setActiveRoutineIdState(savedActive || null);
    setRoutineSyncStatus('synced');

    const savedExecuted = localStorage.getItem(`vigor_executed_workouts_${demoId}`);
    if (savedExecuted) {
      try {
        setExecutedWorkoutsHistory(JSON.parse(savedExecuted));
      } catch {
        setExecutedWorkoutsHistory(createDemoExecutedWorkoutsHistory(demoId));
      }
    } else {
      const demoHistory = createDemoExecutedWorkoutsHistory(demoId);
      setExecutedWorkoutsHistory(demoHistory);
      localStorage.setItem(`vigor_executed_workouts_${demoId}`, JSON.stringify(demoHistory));
    }

    setHasBiometricsConfigured(true);
    setSelectedDate('2024-10-24');

    localStorage.setItem('vigor_demo_user', JSON.stringify(demoProfile));
    setAuthStatus('authenticated');
    setAuthError(null);

    const target = redirectPath && isPrivatePath(redirectPath) ? redirectPath : 'dashboard-nutricional';
    setRedirectPath(null);
    setCurrentPath(target);
    if (typeof window !== 'undefined') {
      window.location.hash = `#/${target}`;
    }

    showToast(`Modo Demostración activo como ${name} (${role})`);
  };

  const logout = async (): Promise<{ success: boolean; error?: string }> => {
    if (isLoggingOut) {
      return { success: false, error: 'Cierre de sesión ya en curso' };
    }
    setIsLoggingOut(true);

    try {
      if (sessionUid && !isDemoMode) {
        try {
          await authBridge.logoutAll('/auth/login');
        } catch {
          await authRepo.logout().catch(() => {});
        }
      }

      setSessionUid(null);
      setCurrentUser(null);
      setCurrentUserRole('athlete');
      setUnverifiedEmail(null);
      setIsDemoMode(false);
      setAuthStatus('unauthenticated');
      setAuthError(null);

      localStorage.removeItem('vigor_is_demo');
      localStorage.removeItem('vigor_auth_user');
      localStorage.removeItem('vigor_demo_user');
      localStorage.removeItem('vigor_active_live_session');

      setGroceries([]);
      setMealLogs([]);
      setWorkoutHistory([]);
      setWorkoutRoutines([]);
      setExecutedWorkoutsHistory([]);
      setActiveLiveWorkout(null);
      setActiveRoutineIdState(null);
      setRoutineSyncStatus('idle');
      setRecipes([]);
      setMealPlans({});
      setNotifications([]);
      setHasBiometricsConfigured(false);

      setRedirectPath(null);
      setCurrentPath('login');
      if (typeof window !== 'undefined') {
        window.location.hash = '#/login';
      }

      showToast('Sesión cerrada correctamente', 'info');
      return { success: true };
    } catch (err: any) {
      console.error('Error during logout:', err);
      showToast(`Error al cerrar sesión: ${err?.message || 'Error de red'}`, 'warning');
      return { success: false, error: err?.message || 'Error al cerrar sesión' };
    } finally {
      setIsLoggingOut(false);
    }
  };

  // Notifications Operations
  const unreadNotificationCount = notifications.filter(n => !n.read).length;

  const markNotificationAsRead = async (id: string) => {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));
    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.markNotificationRead(sessionUid, id, true);
      } catch (err) {
        console.warn('Error marcando notificación como leída:', err);
      }
    }
  };

  const markAllNotificationsAsRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    showToast('Todas las notificaciones marcadas como leídas');
    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.markAllNotificationsRead(sessionUid);
      } catch (err) {
        console.warn('Error marcando todas las notificaciones como leídas:', err);
      }
    }
  };

  const deleteNotification = async (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    showToast('Notificación descartada');
    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.deleteNotification(sessionUid, id);
      } catch (err) {
        console.warn('Error eliminando notificación:', err);
      }
    }
  };

  const updateNotificationPreferences = (prefs: Partial<NotificationPreferences>) => {
    setNotificationPreferences(prev => {
      const next = { ...prev, ...prefs };
      const scopeKey = currentUser?.id
        ? isDemoMode
          ? `vigor_notif_prefs_${currentUser.id}`
          : `vigor_notif_prefs_uid_${currentUser.id}`
        : 'vigor_notif_prefs_guest';
      localStorage.setItem(scopeKey, JSON.stringify(next));

      if (sessionUid && !isDemoMode) {
        athleteRepo
          .savePreferences(sessionUid, toCleanPreferences(athletePreferences, next, mealPartition))
          .catch(err => console.warn('Error guardando preferencias de notificación:', err));
      }
      return next;
    });
    showToast('Preferencias de notificación guardadas');
  };

  const requestPushPermission = async (): Promise<boolean> => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const permission = await Notification.requestPermission();
        const granted = permission === 'granted';
        setNotificationPreferences(prev => ({
          ...prev,
          pushEnabled: granted,
          pushPermission: permission as any,
        }));
        if (granted) {
          showToast('Notificaciones en el navegador activadas');
          new Notification('Vigor Core - Alertas Activas', {
            body: 'Recibirás avisos locales de comidas y descansos en tiempo real.',
            icon: '/vite.svg',
          });
        } else {
          showToast('Permiso de notificaciones denegado en el navegador', 'warning');
        }
        return granted;
      } catch {
        showToast('Error al solicitar permiso de notificaciones', 'warning');
        return false;
      }
    }
    showToast('Tu navegador no soporta Notification API web', 'info');
    return false;
  };

  const sendPushAlert = async (title: string, message: string, category: AppNotification['category']) => {
    const tempId = `notif-${Date.now()}`;
    const newNotif: AppNotification = {
      id: tempId,
      title,
      message,
      timestamp: 'Ahora mismo',
      category,
      read: false,
      severity: 'info',
    };
    setNotifications(prev => [newNotif, ...prev]);

    if (sessionUid && !isDemoMode) {
      try {
        const saved = await athleteRepo.createNotification(sessionUid, {
          title,
          message,
          category,
          severity: 'info',
          actionView: toCleanActionView(newNotif.actionPath),
        });
        const mapped = fromCleanNotification(saved);
        setNotifications(prev => prev.map(n => (n.id === tempId ? mapped : n)));
      } catch (err) {
        console.warn('Error guardando notificación remota:', err);
      }
    }

    if (
      notificationPreferences.pushEnabled &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      try {
        new Notification(title, {
          body: message,
          icon: '/vite.svg',
        });
      } catch {}
    }

    showToast(title, 'info');
  };

  // Biometrics calculation logic & Catalyst Persist
  const updateBiometrics = async (updates: Partial<BiometricConfig>) => {
    const merged = { ...biometrics, ...updates };
    const bmr = Math.round(10 * merged.weightKg + 6.25 * merged.heightCm - 5 * merged.age + 5);
    const tdee = Math.round(bmr * merged.palFactor);
    const targetCalories = tdee + merged.targetDeltaKcal;
    const targetProteinG = Math.round(merged.weightKg * merged.proteinPerKg);
    const targetFatG = Math.round(merged.weightKg * merged.fatPerKg);
    const targetCarbsG = Math.round((targetCalories - targetProteinG * 4 - targetFatG * 9) / 4);

    const calculated: BiometricConfig = {
      ...merged,
      bmr,
      tdee,
      targetCalories,
      targetProteinG,
      targetFatG,
      targetCarbsG,
    };

    setBiometrics(calculated);
    setHasBiometricsConfigured(true);
    showToast('Parámetros recalculados');

    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.saveBiometrics(sessionUid, toCleanBiometrics(calculated));
      } catch (err) {
        console.warn('Error guardando biometría:', err);
      }
    }
  };

  const resetBiometricsToExcel = async () => {
    setBiometrics(defaultBiometrics);
    showToast('Parámetros restablecidos al libro maestro');
    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.saveBiometrics(sessionUid, toCleanBiometrics(defaultBiometrics));
      } catch (err) {
        console.warn('Error restableciendo biometría:', err);
      }
    }
  };

  const revertToPreviousBiometrics = async (): Promise<boolean> => {
    const prev = biometrics.lastAppliedPeriodization?.previousTargets;
    if (!prev) {
      showToast('No existen metas nutricionales anteriores para revertir', 'warning');
      return false;
    }
    const reverted: BiometricConfig = {
      ...biometrics,
      targetCalories: prev.targetCalories,
      targetProteinG: prev.targetProteinG,
      targetCarbsG: prev.targetCarbsG,
      targetFatG: prev.targetFatG,
      proteinPerKg: prev.proteinPerKg,
      fatPerKg: prev.fatPerKg,
      targetDeltaKcal: prev.targetDeltaKcal,
      lastAppliedPeriodization: undefined,
    };
    setBiometrics(reverted);
    showToast('¡Metas nutricionales revertidas a la configuración anterior con éxito!', 'success');

    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.saveBiometrics(sessionUid, toCleanBiometrics(reverted));
      } catch (err) {
        console.warn('Error revirtiendo biometría:', err);
      }
    }
    return true;
  };

  const updateMealPartition = (updates: Partial<MealMomentPartition>) => {
    setMealPartition(prev => {
      const next = { ...prev, ...updates };
      const scopeKey = currentUser?.id
        ? isDemoMode
          ? `vigor_meal_partition_${currentUser.id}`
          : `vigor_meal_partition_uid_${currentUser.id}`
        : 'vigor_meal_partition_guest';
      localStorage.setItem(scopeKey, JSON.stringify(next));

      if (sessionUid && !isDemoMode) {
        athleteRepo
          .savePreferences(sessionUid, toCleanPreferences(athletePreferences, notificationPreferences, next))
          .catch(err => console.warn('Error guardando distribución de momentos:', err));
      }
      return next;
    });
    showToast('Distribución de momentos actualizada');
  };

  // Athlete Profile & Onboarding Operations
  const updateAthleteProfile = async (updates: Partial<UserProfile>): Promise<{ success: boolean; error?: string }> => {
    const uid = sessionUid || currentUser?.id;
    if (!uid || !currentUser) return { success: false, error: 'No hay usuario autenticado.' };

    const merged: UserProfile = { ...currentUser, ...updates };
    setCurrentUser(merged);

    if (sessionUid && !isDemoMode) {
      try {
        const patch = buildProfileSelfPatch(updates);
        if (Object.keys(patch).length > 0) {
          const updatedModel = await athleteRepo.updateOwnProfile(uid, patch);
          setCurrentUser(fromCleanProfile(updatedModel));
        }
        showToast('Perfil actualizado en Zoho Catalyst', 'success');
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err?.message || 'Error al actualizar perfil.' };
      }
    } else {
      localStorage.setItem('vigor_demo_user', JSON.stringify(merged));
      showToast('Perfil actualizado en modo demostración', 'success');
      return { success: true };
    }
  };

  const updateAthletePreferences = async (
    updates: Partial<AthletePreferences>
  ): Promise<{ success: boolean; error?: string }> => {
    const uid = sessionUid || currentUser?.id;
    if (!uid) return { success: false, error: 'No hay usuario autenticado.' };

    const merged: AthletePreferences = {
      ...athletePreferences,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    setAthletePreferences(merged);

    const scopeKey = isDemoMode ? `vigor_athlete_prefs_${uid}` : `vigor_athlete_prefs_uid_${uid}`;
    localStorage.setItem(scopeKey, JSON.stringify(merged));

    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.savePreferences(
          uid,
          toCleanPreferences(merged, notificationPreferences, mealPartition)
        );
        showToast('Preferencias guardadas en Zoho Catalyst', 'success');
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err?.message || 'Error guardando preferencias.' };
      }
    } else {
      showToast('Preferencias guardadas en modo demo', 'success');
      return { success: true };
    }
  };

  const saveOnboardingStep = async (
    step: number,
    partialData?: {
      profile?: Partial<UserProfile>;
      preferences?: Partial<AthletePreferences>;
      biometrics?: Partial<BiometricConfig>;
    }
  ) => {
    const uid = sessionUid || currentUser?.id;
    if (!uid) return;

    let nextPrefs = athletePreferences;
    if (partialData?.preferences) {
      nextPrefs = {
        ...athletePreferences,
        ...partialData.preferences,
        onboardingStep: step,
      };
      setAthletePreferences(nextPrefs);
    }
    if (partialData?.profile && currentUser) {
      setCurrentUser(prev =>
        prev
          ? {
              ...prev,
              ...partialData.profile,
              onboardingStep: step,
            }
          : null
      );
    }
    if (partialData?.biometrics) {
      setBiometrics(prev => ({
        ...prev,
        ...partialData.biometrics,
      }));
    }

    if (sessionUid && !isDemoMode) {
      try {
        const profilePatch = buildProfileSelfPatch({
          ...(partialData?.profile || {}),
          onboardingStep: step,
        });
        if (Object.keys(profilePatch).length > 0) {
          await athleteRepo.updateOwnProfile(uid, profilePatch);
        }
        await athleteRepo.savePreferences(
          uid,
          toCleanPreferences(nextPrefs, notificationPreferences, mealPartition)
        );
      } catch (e) {
        console.warn('Partial onboarding step save notice:', e);
      }
    }
  };

  const completeOnboarding = async (data: {
    profile: Partial<UserProfile>;
    biometrics: Partial<BiometricConfig>;
    preferences: Partial<AthletePreferences>;
  }): Promise<{ success: boolean; error?: string }> => {
    try {
      const uid = sessionUid || currentUser?.id;
      if (!uid) {
        return { success: false, error: 'No hay usuario autenticado' };
      }

      const mergedBio = { ...biometrics, ...data.biometrics };
      const bmr = Math.round(10 * mergedBio.weightKg + 6.25 * mergedBio.heightCm - 5 * mergedBio.age + 5);
      const tdee = Math.round(bmr * mergedBio.palFactor);
      const targetCalories = tdee + mergedBio.targetDeltaKcal;
      const targetProteinG = Math.round(mergedBio.weightKg * mergedBio.proteinPerKg);
      const targetFatG = Math.round(mergedBio.weightKg * mergedBio.fatPerKg);
      const targetCarbsG = Math.max(0, Math.round((targetCalories - targetProteinG * 4 - targetFatG * 9) / 4));

      const updatedBio: BiometricConfig = {
        ...mergedBio,
        bmr,
        tdee,
        targetCalories,
        targetProteinG,
        targetFatG,
        targetCarbsG,
      };

      const updatedAthletePrefs: AthletePreferences = {
        ...athletePreferences,
        ...data.preferences,
        onboardingCompleted: true,
        onboardingStep: 6,
        updatedAt: new Date().toISOString(),
      };

      let updatedProfile: UserProfile = {
        ...(currentUser || defaultUser),
        ...data.profile,
        id: uid,
        onboardingCompleted: true,
        onboardingStep: 6,
      };

      if (sessionUid && !isDemoMode) {
        const result = await athleteRepo.completeOnboarding(uid, {
          displayName: (updatedProfile.name || 'Atleta Vigor').trim(),
          goal: (data.profile.goal || updatedAthletePrefs.trainingGoal || 'ganancia_muscular') as UserAccountModel['goal'],
          biometrics: toCleanBiometrics(updatedBio),
          preferences: toCleanPreferences(updatedAthletePrefs, notificationPreferences, mealPartition),
        });
        updatedProfile = {
          ...fromCleanProfile(result.profile),
          onboardingCompleted: true,
          onboardingStep: 6,
        };
      }

      setBiometrics(updatedBio);
      setAthletePreferences(updatedAthletePrefs);
      setCurrentUser(updatedProfile);
      setHasBiometricsConfigured(true);

      const scopeKey = isDemoMode ? `vigor_athlete_prefs_${uid}` : `vigor_athlete_prefs_uid_${uid}`;
      localStorage.setItem(scopeKey, JSON.stringify(updatedAthletePrefs));
      if (isDemoMode) {
        localStorage.setItem('vigor_demo_user', JSON.stringify(updatedProfile));
      } else {
        localStorage.setItem('vigor_auth_user', JSON.stringify(updatedProfile));
      }

      showToast('¡Configuración completada con éxito! Bienvenido a VigorCore.', 'success');
      navigate('dashboard-nutricional');
      return { success: true };
    } catch (err: any) {
      console.error('Error completing onboarding:', err);
      return {
        success: false,
        error: err?.message || 'Error al persistir la configuración en Zoho Catalyst',
      };
    }
  };

  // Groceries CRUD
  const toggleGroceryStatus = async (id: string) => {
    const item = groceries.find(g => g.id === id);
    if (!item) return;
    const nextStatus = item.status === 'completed' ? 'pending' : 'completed';

    setGroceries(prev => prev.map(g => (g.id === id ? { ...g, status: nextStatus } : g)));

    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.toggleGroceryStatus(sessionUid, id, {
          status: nextStatus === 'completed' ? 'bought' : 'pending',
        });
      } catch (err) {
        console.warn('Error actualizando estado de compra:', err);
      }
    }
  };

  const addGrocery = async (itemData: Omit<GroceryItem, 'id' | 'status'>) => {
    const id = `item-${Date.now()}`;
    const newItem: GroceryItem = {
      ...itemData,
      id,
      status: 'pending',
      origin: itemData.origin ?? 'manual',
    };
    setGroceries(prev => [newItem, ...prev]);
    showToast(`"${newItem.name}" añadido a la lista`);

    if (sessionUid && !isDemoMode) {
      try {
        const saved = await athleteRepo.addManualGrocery(sessionUid, toCleanGrocery(newItem));
        if (saved.id && saved.id !== id) {
          const mapped = fromCleanGrocery(saved);
          setGroceries(prev => prev.map(g => (g.id === id ? mapped : g)));
        }
      } catch (err) {
        console.warn('Error añadiendo insumo remoto:', err);
      }
    }
  };

  const editGrocery = async (
    id: string,
    name: string,
    quantity: number,
    unit: string,
    department?: GroceryDepartment,
    notes?: string
  ) => {
    setGroceries(prev =>
      prev.map(item => {
        if (item.id !== id) return item;
        return {
          ...item,
          name,
          quantity,
          unit,
          department: department || item.department,
          notes: notes !== undefined ? notes : item.notes,
          isCustomized: true,
        };
      })
    );
    showToast('Insumo personalizado y guardado');

    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.toggleGroceryStatus(sessionUid, id, {
          name,
          quantity,
          unit,
          isCustomized: true,
          ...(department ? { department } : {}),
          ...(notes !== undefined ? { notes } : {}),
        });
      } catch (err) {
        console.warn('Error editando insumo remoto:', err);
      }
    }
  };

  const resetGroceryToPlan = async (id: string) => {
    const item = groceries.find(g => g.id === id);
    if (!item || item.calculatedQuantity === undefined) return;

    const revertedQuantity = item.calculatedQuantity;
    setGroceries(prev =>
      prev.map(g => (g.id === id ? { ...g, quantity: revertedQuantity, isCustomized: false } : g))
    );
    showToast(`Cantidad de "${item.name}" restablecida al cálculo del menú (${revertedQuantity} ${item.unit})`);

    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.toggleGroceryStatus(sessionUid, id, {
          quantity: revertedQuantity,
          isCustomized: false,
        });
      } catch (err) {
        console.warn('Error restableciendo insumo remoto:', err);
      }
    }
  };

  const deleteGrocery = async (id: string) => {
    setGroceries(prev => prev.filter(item => item.id !== id));
    showToast('Insumo eliminado de la lista');

    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.deleteGrocery(sessionUid, id);
      } catch (err) {
        console.warn('Error eliminando insumo remoto:', err);
      }
    }
  };

  const clearCompletedGroceries = async () => {
    setGroceries(prev => prev.filter(item => item.status !== 'completed'));
    showToast('Insumos completados eliminados');

    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.clearCompletedGroceries(sessionUid);
      } catch (err) {
        console.warn('Error limpiando compras completadas:', err);
      }
    }
  };

  const regenerateFromMenu = async () => {
    await syncMealPlanToGroceries(currentMealPlan);
  };

  // Meal Logs CRUD
  const addMealLog = async (itemData: Omit<MealLogItem, 'id'>) => {
    const tempId = `log-${Date.now()}`;
    const newLog: MealLogItem = {
      ...itemData,
      id: tempId,
    };
    setMealLogs(prev => [newLog, ...prev]);
    showToast('¡Comida registrada exitosamente!');

    sendPushAlert(
      'Comida registrada exitosamente',
      `${newLog.title} (${newLog.calories} kcal) añadida al Registro Diario.`,
      'nutricion'
    );

    if (sessionUid && !isDemoMode) {
      try {
        const saved = await athleteRepo.logMeal(sessionUid, toCleanMealLog(newLog));
        if (saved.id && saved.id !== tempId) {
          const mapped = fromCleanMealLog(saved);
          setMealLogs(prev => prev.map(m => (m.id === tempId ? mapped : m)));
        }
      } catch (err) {
        console.warn('Error guardando comida en Catalyst:', err);
      }
    }
  };

  const deleteMealLog = async (id: string) => {
    setMealLogs(prev => prev.filter(item => item.id !== id));
    showToast('Registro de comida eliminado');

    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.deleteMeal(sessionUid, id);
      } catch (err) {
        console.warn('Error eliminando comida en Catalyst:', err);
      }
    }
  };

  const duplicateMealLog = async (id: string) => {
    const item = mealLogs.find(m => m.id === id);
    if (!item) return;
    const now = new Date();
    const dateTime = now.toISOString().slice(0, 16);
    const tempId = `log-${Date.now()}`;
    const duplicated: MealLogItem = {
      ...item,
      id: tempId,
      dateTime,
      title: `${item.title} (Copia)`,
      source: 'Manual',
    };
    setMealLogs(prev => [duplicated, ...prev]);
    showToast('Comida duplicada al día actual');

    if (sessionUid && !isDemoMode) {
      try {
        const saved = await athleteRepo.logMeal(sessionUid, toCleanMealLog(duplicated));
        if (saved.id && saved.id !== tempId) {
          const mapped = fromCleanMealLog(saved);
          setMealLogs(prev => prev.map(m => (m.id === tempId ? mapped : m)));
        }
      } catch (err) {
        console.warn('Error duplicando comida en Catalyst:', err);
      }
    }
  };

  const selectedDaySummary = (() => {
    const dayLogs = mealLogs.filter(m => getLocalDateString(m.dateTime) === selectedDate);
    let calories = 0;
    let protein = 0;
    let carbs = 0;
    let fats = 0;
    dayLogs.forEach(item => {
      calories += item.calories || 0;
      protein += item.protein || 0;
      carbs += item.carbs || 0;
      fats += item.fats || 0;
    });
    return {
      calories: Math.round(calories),
      protein: Math.round(protein * 10) / 10,
      carbs: Math.round(carbs * 10) / 10,
      fats: Math.round(fats * 10) / 10,
      waterLiters: 0,
      mealCount: dayLogs.length,
    };
  })();

  const todaySummary = selectedDaySummary;
  const selectedDateFormatted = formatSpanishDate(selectedDate);

  // Recipe Library & Weekly Meal Plans
  const currentMealPlan = useMemo<WeeklyMealPlan>(() => {
    if (mealPlans[activeWeekStart]) {
      return mealPlans[activeWeekStart];
    }
    const { weekEnd } = getWeekStartEnd(activeWeekStart);
    return createDefaultWeeklyPlan(
      activeWeekStart,
      weekEnd,
      currentUser?.id || 'demo_user',
      recipes
    );
  }, [mealPlans, activeWeekStart, currentUser?.id, recipes]);

  const addRecipe = async (recipeData: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> => {
    const id = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = new Date().toISOString();
    const newRecipe: Recipe = {
      ...recipeData,
      id,
      userId: currentUser?.id,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    setRecipes(prev => [newRecipe, ...prev]);
    showToast(`Receta "${newRecipe.name}" guardada con éxito`, 'success');

    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.saveRecipe(sessionUid, toCleanRecipe(newRecipe));
      } catch (err) {
        console.warn('Error guardando receta en Catalyst:', err);
      }
    } else {
      localStorage.setItem('vigor_recipes_demo', JSON.stringify([newRecipe, ...recipes]));
    }

    return id;
  };

  const updateRecipe = async (id: string, updates: Partial<Recipe>): Promise<void> => {
    const nowIso = new Date().toISOString();
    const fullUpdates = { ...updates, updatedAt: nowIso };
    const targetExisting = recipes.find(r => r.id === id);

    setRecipes(prev => prev.map(r => (r.id === id ? { ...r, ...fullUpdates } : r)));

    setMealPlans(prevPlans => {
      const updated = { ...prevPlans };
      let anyPlanChanged = false;

      for (const [key, plan] of Object.entries(updated)) {
        if (!plan?.days) continue;
        let planModified = false;
        const newDays = { ...plan.days };

        for (const [dayKey, dayPlan] of Object.entries(newDays)) {
          if (!dayPlan?.meals) continue;
          let dayModified = false;
          const newMeals = { ...dayPlan.meals };

          for (const [mKey, slot] of Object.entries(newMeals)) {
            if (slot && slot.recipeId === id) {
              const servings = slot.servings || 1;
              const newIngredients = updates.ingredients
                ? updates.ingredients.map(ing => ({
                    foodId: ing.foodId,
                    foodName: ing.foodName,
                    grams: ing.grams * servings,
                    state: ing.preparationState,
                  }))
                : slot.ingredients;

              newMeals[mKey as MealMoment] = {
                ...slot,
                recipeName: updates.name || slot.recipeName,
                imageUrl: updates.imageUrl !== undefined ? updates.imageUrl : slot.imageUrl,
                prepTimeMinutes: updates.prepTimeMinutes !== undefined ? updates.prepTimeMinutes : slot.prepTimeMinutes,
                calories: updates.totalNutrients ? Math.round(updates.totalNutrients.calories * servings) : slot.calories,
                protein: updates.totalNutrients ? Math.round(updates.totalNutrients.protein * servings * 10) / 10 : slot.protein,
                carbs: updates.totalNutrients ? Math.round(updates.totalNutrients.carbs * servings * 10) / 10 : slot.carbs,
                fats: updates.totalNutrients ? Math.round(updates.totalNutrients.fats * servings * 10) / 10 : slot.fats,
                ingredients: newIngredients,
              };
              dayModified = true;
            }
          }

          if (dayModified) {
            newDays[dayKey] = { ...dayPlan, meals: newMeals };
            planModified = true;
          }
        }

        if (planModified) {
          updated[key] = { ...plan, days: newDays, updatedAt: nowIso };
          anyPlanChanged = true;
        }
      }

      return anyPlanChanged ? updated : prevPlans;
    });

    showToast('Receta actualizada con éxito', 'success');

    if (sessionUid && !isDemoMode && targetExisting) {
      try {
        await athleteRepo.saveRecipe(sessionUid, toCleanRecipe({ ...targetExisting, ...fullUpdates }));
      } catch (err) {
        console.warn('Error actualizando receta en Catalyst:', err);
      }
    } else {
      const updatedList = recipes.map(r => (r.id === id ? { ...r, ...fullUpdates } : r));
      localStorage.setItem('vigor_recipes_demo', JSON.stringify(updatedList));
    }
  };

  const deleteRecipe = async (id: string): Promise<void> => {
    setRecipes(prev => prev.filter(r => r.id !== id));
    showToast('Receta eliminada de la biblioteca');

    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.deleteRecipe(sessionUid, id);
      } catch (err) {
        console.warn('Error eliminando receta en Catalyst:', err);
      }
    } else {
      const filtered = recipes.filter(r => r.id !== id);
      localStorage.setItem('vigor_recipes_demo', JSON.stringify(filtered));
    }
  };

  const assignRecipeToSlot = async (
    date: string,
    moment: MealMoment,
    recipeId: string,
    servings: number = 1
  ): Promise<void> => {
    const recipe = recipes.find(r => r.id === recipeId);
    if (!recipe) {
      showToast('Receta no encontrada en la biblioteca', 'warning');
      return;
    }

    const { weekStart, weekEnd } = getWeekStartEnd(date);
    const planId = `plan_${weekStart.replace(/-/g, '_')}`;

    const existingPlan =
      mealPlans[weekStart] ||
      createDefaultWeeklyPlan(weekStart, weekEnd, currentUser?.id || 'demo_user', recipes);

    const existingDayPlan = existingPlan.days[date] || {
      date,
      dayLabel: date,
      meals: {},
    };

    const slot: PlannedMealSlot = {
      recipeId: recipe.id,
      recipeName: recipe.name,
      calories: Math.round(recipe.totalNutrients.calories * servings),
      protein: Math.round(recipe.totalNutrients.protein * servings * 10) / 10,
      carbs: Math.round(recipe.totalNutrients.carbs * servings * 10) / 10,
      fats: Math.round(recipe.totalNutrients.fats * servings * 10) / 10,
      servings,
      imageUrl: recipe.imageUrl,
      prepTimeMinutes: recipe.prepTimeMinutes,
      ingredients: recipe.ingredients.map(ing => ({
        foodId: ing.foodId,
        foodName: ing.foodName,
        grams: ing.grams * servings,
        state: ing.preparationState,
      })),
    };

    const updatedPlan: WeeklyMealPlan = {
      ...existingPlan,
      id: planId,
      userId: currentUser?.id || 'demo_user',
      weekStart,
      weekEnd,
      updatedAt: new Date().toISOString(),
      days: {
        ...existingPlan.days,
        [date]: {
          ...existingDayPlan,
          meals: {
            ...existingDayPlan.meals,
            [moment]: slot,
          },
        },
      },
    };

    setMealPlans(prev => ({
      ...prev,
      [weekStart]: updatedPlan,
      [planId]: updatedPlan,
    }));
    showToast(`"${recipe.name}" asignada a ${moment}`, 'success');

    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.saveMealPlan(sessionUid, toCleanMealPlan(updatedPlan));
      } catch (err) {
        console.warn('Error guardando plan semanal en Catalyst:', err);
      }
    }
  };

  const removeSlotFromPlan = async (date: string, moment: MealMoment): Promise<void> => {
    const { weekStart, weekEnd } = getWeekStartEnd(date);
    const planId = `plan_${weekStart.replace(/-/g, '_')}`;

    const existingPlan =
      mealPlans[weekStart] ||
      createDefaultWeeklyPlan(weekStart, weekEnd, currentUser?.id || 'demo_user', recipes);

    const existingDayPlan = existingPlan.days[date];
    if (!existingDayPlan) return;

    const nextMeals = { ...existingDayPlan.meals };
    delete nextMeals[moment];

    const updatedPlan: WeeklyMealPlan = {
      ...existingPlan,
      id: planId,
      userId: currentUser?.id || 'demo_user',
      weekStart,
      weekEnd,
      updatedAt: new Date().toISOString(),
      days: {
        ...existingPlan.days,
        [date]: {
          ...existingDayPlan,
          meals: nextMeals,
        },
      },
    };

    setMealPlans(prev => ({
      ...prev,
      [weekStart]: updatedPlan,
      [planId]: updatedPlan,
    }));
    showToast(`Horario ${moment} desasignado`);

    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.saveMealPlan(sessionUid, toCleanMealPlan(updatedPlan));
      } catch (err) {
        console.warn('Error actualizando plan semanal en Catalyst:', err);
      }
    }
  };

  const logPlannedMeal = async (date: string, moment: MealMoment, recipeId: string): Promise<void> => {
    const recipe = recipes.find(r => r.id === recipeId);
    if (!recipe) {
      showToast('Receta no encontrada en la biblioteca', 'warning');
      return;
    }

    const isAlreadyLogged = mealLogs.some(
      m => getLocalDateString(m.dateTime) === date && m.moment === moment && m.title === recipe.name
    );
    if (isAlreadyLogged) {
      showToast(`"${recipe.name}" ya se encuentra registrada como consumida en tu diario para ${moment}.`, 'info');
      return;
    }

    const defaultTimes: Record<MealMoment, string> = {
      desayuno: '08:00',
      almuerzo: '13:00',
      merienda: '17:00',
      cena: '20:30',
      snack: '11:00',
    };

    const dateTime = `${date}T${defaultTimes[moment] || '12:00'}`;
    const totalGrams = Math.round(recipe.ingredients.reduce((acc, i) => acc + i.grams, 0));

    await addMealLog({
      dateTime,
      moment,
      title: recipe.name,
      description: recipe.description || `Preparación de receta: ${recipe.name}`,
      portion: `${recipe.servings} porción (${totalGrams} g)`,
      calories: Math.round(recipe.totalNutrients.calories),
      protein: Math.round(recipe.totalNutrients.protein * 10) / 10,
      carbs: Math.round(recipe.totalNutrients.carbs * 10) / 10,
      fats: Math.round(recipe.totalNutrients.fats * 10) / 10,
      source: 'Receta',
      verified: true,
      grams: totalGrams,
    });
  };

  const syncMealPlanToGroceries = async (planToSync?: WeeklyMealPlan): Promise<SyncSummary> => {
    const targetPlan = planToSync || currentMealPlan;
    if (!targetPlan || !targetPlan.days) {
      showToast('No hay plan semanal para sincronizar', 'warning');
      return {
        addedCount: 0,
        updatedCount: 0,
        preservedCompletedCount: 0,
        manualPreservedCount: 0,
        retiredCount: 0,
        totalItems: groceries.length,
      };
    }

    const aggregated = aggregateWeeklyMealPlan(targetPlan, recipes);
    const { updatedGroceries, syncSummary } = computeIdempotentGrocerySync(groceries, aggregated);

    setGroceries(updatedGroceries);

    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.syncGroceries(
          sessionUid,
          updatedGroceries.map(toCleanGrocery),
          { replaceExisting: true }
        );
      } catch (err) {
        console.warn('Error sincronizando compras en Catalyst:', err);
      }
    } else if (currentUser?.id) {
      localStorage.setItem(`vigor_groceries_${currentUser.id}`, JSON.stringify(updatedGroceries));
    }

    if (syncSummary.addedCount === 0 && syncSummary.updatedCount === 0 && syncSummary.retiredCount === 0) {
      showToast(`Lista de compras al día con el menú (${syncSummary.totalItems} insumos verificados)`, 'info');
    } else {
      const messages: string[] = [];
      if (syncSummary.addedCount > 0) messages.push(`${syncSummary.addedCount} nuevos`);
      if (syncSummary.updatedCount > 0) messages.push(`${syncSummary.updatedCount} actualizados`);
      if (syncSummary.retiredCount > 0) messages.push(`${syncSummary.retiredCount} retirados`);
      if (syncSummary.preservedCompletedCount > 0) messages.push(`${syncSummary.preservedCompletedCount} comprados conservados`);
      messages.push(`${syncSummary.manualPreservedCount} manuales intactos`);
      showToast(`Sincronización: ${messages.join(' · ')}`, 'success');
    }

    return syncSummary;
  };

  const openRecipeModal = (options?: { recipe?: Recipe; initialMoment?: MealMoment }) => {
    if (options?.recipe) {
      setRecipeModalData({ mode: 'edit', recipe: options.recipe });
    } else {
      setRecipeModalData({ mode: 'create', initialMoment: options?.initialMoment });
    }
    setIsRecipeModalOpen(true);
  };

  const closeRecipeModal = () => {
    setIsRecipeModalOpen(false);
    setRecipeModalData(null);
  };

  const openAssignModal = (date: string, moment: MealMoment, currentRecipeId?: string) => {
    setAssignModalSlot({ date, moment, currentRecipeId });
    setIsAssignModalOpen(true);
  };

  const closeAssignModal = () => {
    setIsAssignModalOpen(false);
    setAssignModalSlot(null);
  };

  // Workout Gym Mode commit
  const commitActiveSet = async (weight: number, reps: number, rir: number) => {
    const e1rm = Math.round(weight * (1 + reps / 30) * 10) / 10;
    let recordedSetNumber = 1;
    setActiveWorkout(prev => {
      const nextSets = [...prev.sets];
      const activeIdx = nextSets.findIndex(s => !s.completed);
      if (activeIdx !== -1) {
        recordedSetNumber = nextSets[activeIdx].setNumber;
        nextSets[activeIdx] = {
          ...nextSets[activeIdx],
          weightKg: weight,
          reps,
          rir,
          completed: true,
          estimated1RM: e1rm,
        };
      }
      return { ...prev, sets: nextSets };
    });
    setRestTimerSeconds(150);
    setIsRestTimerRunning(true);
    showToast(`Serie registrada (${weight}kg x ${reps} @ RIR ${rir}) • 150s descanso iniciado`);

    const sessionId = `set-${Date.now()}`;
    const newRecord: WorkoutSessionRecord = {
      id: sessionId,
      userId: sessionUid || 'demo_user',
      exerciseId: activeWorkout.id,
      exerciseName: activeWorkout.name,
      date: new Date().toISOString(),
      weightKg: weight,
      reps,
      rir,
      estimated1RM: e1rm,
      completed: true,
      createdAt: new Date().toISOString(),
      executedWorkoutId: activeLiveWorkout?.id,
      setNumber: recordedSetNumber,
      setType: 'effective',
    };

    setWorkoutHistory(prev => [newRecord, ...prev]);

    if (e1rm >= 95) {
      sendPushAlert(
        '¡Hito de Sobrecarga Progresiva!',
        `Serie completada a ${weight}kg x ${reps} reps (1RM estimado: ${e1rm}kg).`,
        'entrenamiento'
      );
    }

    if (sessionUid && !isDemoMode && activeLiveWorkout?.id) {
      try {
        await athleteRepo.logWorkoutSet(sessionUid, {
          id: sessionId,
          executedWorkoutId: activeLiveWorkout.id,
          exerciseId: activeWorkout.id,
          exerciseName: activeWorkout.name,
          muscleGroup: 'espalda',
          setNumber: recordedSetNumber,
          type: 'effective',
          weightKg: weight,
          reps,
          rir,
          completed: true,
        });
      } catch (err) {
        enqueueOfflineSet(newRecord, false);
        setPendingOfflineSetsCount(getOfflinePendingSets(sessionUid, false).length);
        console.warn('Serie encolada localmente tras fallo de red:', err);
      }
    }
  };

  const addCardioSession = async (session: Omit<CardioSession, 'id'>) => {
    const tempId = `cardio-${Date.now()}`;
    const newSession: CardioSession = { ...session, id: tempId };
    setCardioSessions(prev => [newSession, ...prev]);
    showToast(`Sesión de cardio "${session.title}" guardada con éxito`);

    if (sessionUid && !isDemoMode) {
      try {
        const saved = await athleteRepo.addCardioSession(sessionUid, toCleanCardioSession(session));
        const mapped = fromCleanCardioSession(saved);
        setCardioSessions(prev => prev.map(c => (c.id === tempId ? mapped : c)));
      } catch (err) {
        console.warn('Error guardando sesión de cardio en Catalyst:', err);
      }
    }
  };

  const adjustRestTimer = (delta: number) => {
    setRestTimerSeconds(prev => Math.max(0, Math.min(600, prev + delta)));
  };

  const resetRestTimer = (customSeconds: number = 180) => {
    setRestTimerSeconds(customSeconds);
    setIsRestTimerRunning(true);
  };

  const toggleRestTimer = () => {
    setIsRestTimerRunning(prev => !prev);
  };

  // Workout Routines Operations
  const createRoutineFromTemplate = async (templateId: string, customName?: string): Promise<string> => {
    const uid = sessionUid || currentUser?.id || 'demo_camilo';
    const newRoutine = instantiateRoutineFromTemplate(templateId, uid, customName);

    setWorkoutRoutines(prev => [newRoutine, ...prev.filter(r => r.id !== newRoutine.id)]);
    setActiveRoutineIdState(newRoutine.id);

    if (isDemoMode || !sessionUid) {
      const demoKey = `vigor_workout_routines_${uid}`;
      const updated = [newRoutine, ...workoutRoutines.filter(r => r.id !== newRoutine.id)];
      localStorage.setItem(demoKey, JSON.stringify(updated));
      localStorage.setItem(`vigor_active_routine_${uid}`, newRoutine.id);
      setRoutineSyncStatus('synced');
      showToast(`Rutina "${newRoutine.name}" creada`, 'success');
      return newRoutine.id;
    }

    setRoutineSyncStatus('saving');
    try {
      await athleteRepo.saveWorkoutRoutine(sessionUid, toCleanWorkoutRoutine(newRoutine));
      setRoutineSyncStatus('synced');
      showToast(`Rutina "${newRoutine.name}" guardada en la nube`, 'success');
      return newRoutine.id;
    } catch (err) {
      setRoutineSyncStatus('error');
      throw err;
    }
  };

  const createCustomRoutine = async (
    routineData: Omit<WorkoutRoutine, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
  ): Promise<string> => {
    const uid = sessionUid || currentUser?.id || 'demo_camilo';
    const now = new Date().toISOString();
    const newId = `routine_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newRoutine: WorkoutRoutine = {
      ...routineData,
      id: newId,
      userId: uid,
      createdAt: now,
      updatedAt: now,
    };

    setWorkoutRoutines(prev => [newRoutine, ...prev]);
    setActiveRoutineIdState(newRoutine.id);

    if (isDemoMode || !sessionUid) {
      const demoKey = `vigor_workout_routines_${uid}`;
      const updated = [newRoutine, ...workoutRoutines];
      localStorage.setItem(demoKey, JSON.stringify(updated));
      localStorage.setItem(`vigor_active_routine_${uid}`, newRoutine.id);
      setRoutineSyncStatus('synced');
      showToast(`Rutina "${newRoutine.name}" creada`, 'success');
      return newRoutine.id;
    }

    setRoutineSyncStatus('saving');
    try {
      await athleteRepo.saveWorkoutRoutine(sessionUid, toCleanWorkoutRoutine(newRoutine));
      setRoutineSyncStatus('synced');
      showToast(`Rutina "${newRoutine.name}" guardada en la nube`, 'success');
      return newRoutine.id;
    } catch (err) {
      setRoutineSyncStatus('error');
      throw err;
    }
  };

  const updateWorkoutRoutine = async (id: string, updates: Partial<WorkoutRoutine>): Promise<void> => {
    const now = new Date().toISOString();
    let updatedTarget: WorkoutRoutine | null = null;
    const updatedList = workoutRoutines.map(r => {
      if (r.id === id) {
        updatedTarget = { ...r, ...updates, updatedAt: now };
        return updatedTarget;
      }
      return r;
    });
    setWorkoutRoutines(updatedList);

    const uid = sessionUid || currentUser?.id || 'demo_camilo';
    if (isDemoMode || !sessionUid) {
      const demoKey = `vigor_workout_routines_${uid}`;
      localStorage.setItem(demoKey, JSON.stringify(updatedList));
      setRoutineSyncStatus('synced');
      return;
    }

    if (!updatedTarget) return;
    setRoutineSyncStatus('saving');
    try {
      await athleteRepo.saveWorkoutRoutine(sessionUid, toCleanWorkoutRoutine(updatedTarget));
      setRoutineSyncStatus('synced');
    } catch (err) {
      setRoutineSyncStatus('error');
      throw err;
    }
  };

  const deleteWorkoutRoutine = async (id: string): Promise<void> => {
    const target = workoutRoutines.find(r => r.id === id);
    const filtered = workoutRoutines.filter(r => r.id !== id);
    setWorkoutRoutines(filtered);
    if (activeRoutineIdState === id) {
      setActiveRoutineIdState(filtered[0]?.id || null);
    }

    const uid = sessionUid || currentUser?.id || 'demo_camilo';
    if (isDemoMode || !sessionUid) {
      const demoKey = `vigor_workout_routines_${uid}`;
      localStorage.setItem(demoKey, JSON.stringify(filtered));
      showToast(`Rutina "${target?.name || ''}" eliminada`, 'info');
      return;
    }

    setRoutineSyncStatus('saving');
    try {
      await athleteRepo.deleteWorkoutRoutine(sessionUid, id);
      setRoutineSyncStatus('synced');
      showToast(`Rutina "${target?.name || ''}" eliminada de la nube`, 'info');
    } catch (err) {
      setRoutineSyncStatus('error');
      throw err;
    }
  };

  const addExerciseToRoutineDay = async (
    routineId: string,
    dayId: string,
    exerciseId: string,
    config?: Partial<PlannedExerciseConfig>
  ): Promise<void> => {
    const routine = workoutRoutines.find(r => r.id === routineId);
    if (!routine) return;

    const targetDay = routine.days.find(d => d.id === dayId);
    if (!targetDay) return;

    const nextOrder = targetDay.exercises.length + 1;
    const newConfig: PlannedExerciseConfig = {
      id: `cfg_${routine.id}_${dayId}_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      exerciseId,
      orderIndex: nextOrder,
      sets: config?.sets ?? 3,
      repsMin: config?.repsMin ?? 8,
      repsMax: config?.repsMax ?? 10,
      targetRir: config?.targetRir ?? 2,
      restSeconds: config?.restSeconds ?? 90,
      tempo: config?.tempo ?? '2-0-1-0',
      notes: config?.notes ?? '',
    };

    const updatedDays = routine.days.map(d => {
      if (d.id === dayId) {
        return {
          ...d,
          isRestDay: false,
          exercises: [...d.exercises, newConfig],
        };
      }
      return d;
    });

    await updateWorkoutRoutine(routineId, { days: updatedDays });
    showToast('Ejercicio añadido a la rutina', 'success');
  };

  const removeExerciseFromRoutineDay = async (
    routineId: string,
    dayId: string,
    configId: string
  ): Promise<void> => {
    const routine = workoutRoutines.find(r => r.id === routineId);
    if (!routine) return;

    const updatedDays = routine.days.map(d => {
      if (d.id === dayId) {
        const filtered = d.exercises.filter(ex => ex.id !== configId);
        const reindexed = filtered.map((ex, idx) => ({ ...ex, orderIndex: idx + 1 }));
        return { ...d, exercises: reindexed };
      }
      return d;
    });

    await updateWorkoutRoutine(routineId, { days: updatedDays });
    showToast('Ejercicio retirado de la rutina', 'info');
  };

  const reorderExercisesInRoutineDay = async (
    routineId: string,
    dayId: string,
    startIndex: number,
    endIndex: number
  ): Promise<void> => {
    const routine = workoutRoutines.find(r => r.id === routineId);
    if (!routine) return;

    const targetDay = routine.days.find(d => d.id === dayId);
    if (
      !targetDay ||
      startIndex < 0 ||
      endIndex < 0 ||
      startIndex >= targetDay.exercises.length ||
      endIndex >= targetDay.exercises.length
    ) {
      return;
    }

    const updatedDays = routine.days.map(d => {
      if (d.id === dayId) {
        const list = [...d.exercises];
        const [moved] = list.splice(startIndex, 1);
        list.splice(endIndex, 0, moved);
        const reindexed = list.map((ex, idx) => ({ ...ex, orderIndex: idx + 1 }));
        return { ...d, exercises: reindexed };
      }
      return d;
    });

    await updateWorkoutRoutine(routineId, { days: updatedDays });
  };

  const updateRoutineExerciseConfig = async (
    routineId: string,
    dayId: string,
    configId: string,
    updates: Partial<PlannedExerciseConfig>
  ): Promise<void> => {
    const routine = workoutRoutines.find(r => r.id === routineId);
    if (!routine) return;

    const updatedDays = routine.days.map(d => {
      if (d.id === dayId) {
        const updatedExercises = d.exercises.map(ex => {
          if (ex.id === configId) {
            return { ...ex, ...updates };
          }
          return ex;
        });
        return { ...d, exercises: updatedExercises };
      }
      return d;
    });

    await updateWorkoutRoutine(routineId, { days: updatedDays });
    showToast('Configuración del ejercicio actualizada', 'success');
  };

  const saveMesocycleRoutine = async (program: MesocycleRoutine, activateNow: boolean = true): Promise<string> => {
    const uid = sessionUid || currentUser?.id || 'demo_camilo';
    const now = new Date().toISOString();
    const routineId = program.id || `meso_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const finalizedProgram: MesocycleRoutine = {
      ...program,
      id: routineId,
      userId: uid,
      isDefault: activateNow ? true : Boolean(program.isDefault),
      createdAt: program.createdAt || now,
      updatedAt: now,
    };

    const updatedList = activateNow
      ? [finalizedProgram, ...workoutRoutines.filter(r => r.id !== finalizedProgram.id).map(r => ({ ...r, isDefault: false }))]
      : [finalizedProgram, ...workoutRoutines.filter(r => r.id !== finalizedProgram.id)];

    setWorkoutRoutines(updatedList);
    if (activateNow) {
      setActiveRoutineIdState(finalizedProgram.id);
    }

    if (isDemoMode || !sessionUid) {
      const demoKey = `vigor_workout_routines_${uid}`;
      localStorage.setItem(demoKey, JSON.stringify(updatedList));
      if (activateNow) {
        localStorage.setItem(`vigor_active_routine_${uid}`, finalizedProgram.id);
      }
      setRoutineSyncStatus('synced');
      showToast(`Mesociclo "${finalizedProgram.name}" guardado`, 'success');
      return finalizedProgram.id;
    }

    setRoutineSyncStatus('saving');
    try {
      await athleteRepo.saveWorkoutRoutine(sessionUid, toCleanWorkoutRoutine(finalizedProgram));
      if (activateNow) {
        await athleteRepo.setDefaultRoutine(sessionUid, finalizedProgram.id).catch(() => {});
      }
      setRoutineSyncStatus('synced');
      showToast(`Mesociclo "${finalizedProgram.name}" persistido en Zoho Catalyst`, 'success');
      return finalizedProgram.id;
    } catch (err) {
      setRoutineSyncStatus('error');
      throw err;
    }
  };

  const advanceMesocycleWeek = async (routineId: string, targetWeek: number): Promise<void> => {
    const routine = workoutRoutines.find(r => r.id === routineId) as MesocycleRoutine | undefined;
    if (!routine || !routine.isMesocycle || !routine.mesocycleConfig) return;

    const targetWeekObj = routine.mesocycleConfig.weeks.find(w => w.weekNumber === targetWeek);
    if (!targetWeekObj) return;

    const now = new Date().toISOString();
    const updatedRoutine: MesocycleRoutine = {
      ...routine,
      days: targetWeekObj.days,
      mesocycleConfig: {
        ...routine.mesocycleConfig,
        currentWeek: targetWeek,
      },
      updatedAt: now,
    };

    const updatedList = workoutRoutines.map(r => (r.id === routineId ? updatedRoutine : r));
    setWorkoutRoutines(updatedList);

    const uid = sessionUid || currentUser?.id || 'demo_camilo';
    if (isDemoMode || !sessionUid) {
      const demoKey = `vigor_workout_routines_${uid}`;
      localStorage.setItem(demoKey, JSON.stringify(updatedList));
      showToast(`Semana cambiada a: ${targetWeekObj.name}`, 'info');
      return;
    }

    try {
      await athleteRepo.saveWorkoutRoutine(sessionUid, toCleanWorkoutRoutine(updatedRoutine));
      showToast(`Semana actualizada a: ${targetWeekObj.name}`, 'success');
    } catch (err) {
      console.warn('Error actualizando semana de mesociclo:', err);
    }
  };

  // Live Workout Execution Engine
  const startLiveWorkout = async (routine: WorkoutRoutine, day: RoutineDay): Promise<string> => {
    const uid = sessionUid || currentUser?.id || 'demo_camilo';
    let workoutId = `ewk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = new Date().toISOString();

    const exercisesSnapshot: LiveExerciseSession[] = day.exercises.map(cfg => {
      const exItem = getExerciseById(cfg.exerciseId);
      const sets: LiveWorkoutSet[] = [];

      for (let s = 1; s <= cfg.sets; s++) {
        sets.push({
          id: `set_init_${cfg.id}_${s}_${Math.random().toString(36).substring(2, 6)}`,
          setNumber: s,
          type: 'effective',
          targetRepsMin: cfg.repsMin,
          targetRepsMax: cfg.repsMax,
          targetRir: cfg.targetRir ?? 2,
          weightKg: cfg.targetWeightKg && cfg.targetWeightKg > 0 ? cfg.targetWeightKg : 60,
          reps: cfg.repsMin,
          rir: cfg.targetRir ?? 2,
          completed: false,
          estimated1RM: 0,
        });
      }

      return {
        configId: cfg.id,
        exerciseId: cfg.exerciseId,
        exerciseName: exItem?.name || cfg.exerciseId,
        muscleGroup: exItem?.muscleGroup || 'pecho',
        movementPattern: exItem?.movementPattern || 'empuje_horizontal',
        equipment: exItem?.equipment || 'barra',
        tempo: cfg.tempo || '2-0-1-0',
        restSeconds: cfg.restSeconds || 120,
        notes: cfg.notes || '',
        cue: exItem?.instructions?.[0] || 'Control excéntrico estricto y retracción escapular activa.',
        historicalRecord: workoutHistory.find(h => h.exerciseId === cfg.exerciseId)
          ? `${workoutHistory.find(h => h.exerciseId === cfg.exerciseId)!.weightKg} kg × ${workoutHistory.find(h => h.exerciseId === cfg.exerciseId)!.reps} reps`
          : '80.0 kg × 8 reps',
        sets,
      };
    });

    if (sessionUid && !isDemoMode) {
      try {
        const created = await athleteRepo.startExecutedWorkout(sessionUid, {
          id: workoutId,
          routineId: routine.id,
          routineName: routine.name,
          routineDayId: day.id,
          routineDayName: day.shortName || day.name,
          exercisesSnapshot: toCleanExercisesSnapshot(exercisesSnapshot),
          startedAt: nowIso,
        });
        if (created?.id) {
          workoutId = created.id;
        }
      } catch (err) {
        console.warn('Error iniciando sesión en Catalyst:', err);
      }
    }

    const newWorkout: ExecutedWorkout = {
      id: workoutId,
      userId: uid,
      routineId: routine.id,
      routineName: routine.name,
      routineDayId: day.id,
      routineDayName: day.shortName || day.name,
      status: 'in_progress',
      startedAt: nowIso,
      durationSeconds: 0,
      totalTonnageKg: 0,
      totalCompletedSets: 0,
      totalReps: 0,
      averageRir: 0,
      exercisesSnapshot,
    };

    setActiveLiveWorkout(newWorkout);
    setHasRecoveredLiveSession(false);
    localStorage.setItem('vigor_active_live_session', JSON.stringify(newWorkout));

    showToast(`¡Sesión en vivo "${day.shortName || day.name}" iniciada!`, 'success');
    navigate('registro-de-entrenamiento');
    return workoutId;
  };

  const startQuickLiveWorkout = async (name: string = 'Entrenamiento Libre'): Promise<string> => {
    const uid = sessionUid || currentUser?.id || 'demo_camilo';
    let workoutId = `ewk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = new Date().toISOString();

    const defaultExIds = ['ex_press_banca_plano_barra', 'ex_remo_barra_pendlay', 'ex_press_militar_ohp'];
    const exercisesSnapshot: LiveExerciseSession[] = defaultExIds.map((exId, idx) => {
      const item = getExerciseById(exId);
      return {
        configId: `cfg_quick_${idx}`,
        exerciseId: exId,
        exerciseName: item?.name || exId,
        muscleGroup: item?.muscleGroup || 'pecho',
        movementPattern: item?.movementPattern || 'empuje_horizontal',
        equipment: item?.equipment || 'barra',
        tempo: '2-0-1-0',
        restSeconds: 120,
        cue: item?.instructions?.[0] || 'Técnica estricta y control de la fase excéntrica.',
        historicalRecord: '80.0 kg × 8 reps',
        sets: [
          {
            id: `set_quick_${idx}_1`,
            setNumber: 1,
            type: 'effective',
            targetRepsMin: 8,
            targetRepsMax: 10,
            targetRir: 2,
            weightKg: 75,
            reps: 8,
            rir: 2,
            completed: false,
            estimated1RM: 0,
          },
          {
            id: `set_quick_${idx}_2`,
            setNumber: 2,
            type: 'effective',
            targetRepsMin: 8,
            targetRepsMax: 10,
            targetRir: 2,
            weightKg: 75,
            reps: 8,
            rir: 2,
            completed: false,
            estimated1RM: 0,
          },
          {
            id: `set_quick_${idx}_3`,
            setNumber: 3,
            type: 'effective',
            targetRepsMin: 8,
            targetRepsMax: 10,
            targetRir: 1,
            weightKg: 75,
            reps: 7,
            rir: 1,
            completed: false,
            estimated1RM: 0,
          },
        ],
      };
    });

    if (sessionUid && !isDemoMode) {
      try {
        const created = await athleteRepo.startExecutedWorkout(sessionUid, {
          id: workoutId,
          routineName: name,
          routineDayName: 'Sesión Rápida',
          exercisesSnapshot: toCleanExercisesSnapshot(exercisesSnapshot),
          startedAt: nowIso,
        });
        if (created?.id) {
          workoutId = created.id;
        }
      } catch (err) {
        console.warn('Error iniciando sesión rápida en Catalyst:', err);
      }
    }

    const newWorkout: ExecutedWorkout = {
      id: workoutId,
      userId: uid,
      routineName: name,
      routineDayName: 'Sesión Rápida',
      status: 'in_progress',
      startedAt: nowIso,
      durationSeconds: 0,
      totalTonnageKg: 0,
      totalCompletedSets: 0,
      totalReps: 0,
      averageRir: 0,
      exercisesSnapshot,
    };

    setActiveLiveWorkout(newWorkout);
    setHasRecoveredLiveSession(false);
    localStorage.setItem('vigor_active_live_session', JSON.stringify(newWorkout));

    showToast(`¡${name} iniciado en vivo!`, 'success');
    navigate('registro-de-entrenamiento');
    return workoutId;
  };

  const commitLiveSet = async (
    exerciseIndex: number,
    weightKg: number,
    reps: number,
    rir: number,
    setType: WorkoutSetType
  ): Promise<void> => {
    if (!activeLiveWorkout) return;
    const targetEx = activeLiveWorkout.exercisesSnapshot[exerciseIndex];
    if (!targetEx) return;

    const targetSetIndex = targetEx.sets.findIndex(s => !s.completed);
    let isNewSet = false;
    let targetSet: LiveWorkoutSet;

    if (targetSetIndex === -1) {
      isNewSet = true;
      const nextNum = targetEx.sets.length + 1;
      targetSet = {
        id: `set_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        setNumber: nextNum,
        type: setType,
        weightKg,
        reps,
        rir,
        completed: false,
        estimated1RM: 0,
      };
    } else {
      targetSet = targetEx.sets[targetSetIndex];
    }

    const epley = calculateEpley1RM(weightKg, reps);
    const completedAt = new Date().toISOString();
    const updatedSet: LiveWorkoutSet = {
      ...targetSet,
      weightKg,
      reps,
      rir,
      type: setType,
      completed: true,
      estimated1RM: epley.value,
      completedAt,
    };

    const updatedSets = isNewSet
      ? [...targetEx.sets, updatedSet]
      : targetEx.sets.map((s, idx) => (idx === targetSetIndex ? updatedSet : s));

    const updatedExercises = activeLiveWorkout.exercisesSnapshot.map((ex, idx) =>
      idx === exerciseIndex ? { ...ex, sets: updatedSets } : ex
    );

    const allCompletedSets = updatedExercises.flatMap(ex => ex.sets.filter(s => s.completed));
    const totalTonnageKg = calculateSessionTonnage(allCompletedSets);
    const totalCompletedSets = allCompletedSets.length;
    const totalReps = allCompletedSets.reduce((sum, s) => sum + s.reps, 0);
    const averageRir = calculateAverageRir(allCompletedSets);

    const updatedWorkout: ExecutedWorkout = {
      ...activeLiveWorkout,
      exercisesSnapshot: updatedExercises,
      totalTonnageKg,
      totalCompletedSets,
      totalReps,
      averageRir,
    };

    setActiveLiveWorkout(updatedWorkout);
    localStorage.setItem('vigor_active_live_session', JSON.stringify(updatedWorkout));

    setRestTimerSeconds(targetEx.restSeconds || 120);
    setIsRestTimerRunning(true);

    const setId = `set_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const sessionRecord: WorkoutSessionRecord = {
      id: setId,
      userId: sessionUid || currentUser?.id || 'demo_camilo',
      exerciseId: targetEx.exerciseId,
      exerciseName: targetEx.exerciseName,
      date: completedAt,
      weightKg,
      reps,
      rir,
      estimated1RM: epley.value,
      completed: true,
      createdAt: completedAt,
      executedWorkoutId: activeLiveWorkout.id,
      setNumber: updatedSet.setNumber,
      setType,
    };

    setWorkoutHistory(prev => [sessionRecord, ...prev]);

    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.logWorkoutSet(sessionUid, {
          id: setId,
          executedWorkoutId: activeLiveWorkout.id,
          exerciseId: targetEx.exerciseId,
          exerciseName: targetEx.exerciseName,
          muscleGroup: toCleanMuscleGroup(targetEx.muscleGroup),
          setNumber: updatedSet.setNumber,
          type: setType,
          weightKg,
          reps,
          rir,
          completed: true,
        });
      } catch (err) {
        enqueueOfflineSet(sessionRecord, false);
        setPendingOfflineSetsCount(getOfflinePendingSets(sessionUid, false).length);
        console.warn('Serie encolada localmente tras fallo de sincronización:', err);
      }
    } else {
      const demoUid = currentUser?.id || 'demo_camilo';
      const existingSets = localStorage.getItem(`vigor_workout_sessions_${demoUid}`);
      const list = existingSets ? JSON.parse(existingSets) : [];
      localStorage.setItem(`vigor_workout_sessions_${demoUid}`, JSON.stringify([sessionRecord, ...list]));
    }

    if (epley.value >= 100) {
      sendPushAlert(
        '¡Hito de Sobrecarga Progresiva!',
        `${targetEx.exerciseName}: ${weightKg} kg × ${reps} reps (1RM estimado: ${epley.value} kg).`,
        'entrenamiento'
      );
    }

    const typeLabel = setType === 'warmup' ? 'Aproximación' : `Serie ${updatedSet.setNumber}`;
    showToast(
      `${typeLabel} registrada: ${weightKg} kg × ${reps} reps (1RM: ${epley.value} kg) • Descanso ${targetEx.restSeconds || 120}s`,
      'success'
    );
  };

  const addExtraLiveSet = (exerciseIndex: number, type: WorkoutSetType = 'effective') => {
    if (!activeLiveWorkout) return;
    const targetEx = activeLiveWorkout.exercisesSnapshot[exerciseIndex];
    if (!targetEx) return;

    const nextSetNumber = targetEx.sets.length + 1;
    const lastSet = targetEx.sets[targetEx.sets.length - 1];
    const newSet: LiveWorkoutSet = {
      id: `set_extra_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      setNumber: nextSetNumber,
      type,
      targetRepsMin: lastSet?.targetRepsMin || 8,
      targetRepsMax: lastSet?.targetRepsMax || 10,
      targetRir: 1,
      weightKg: lastSet?.weightKg || 60,
      reps: lastSet?.reps || 8,
      rir: 1,
      completed: false,
      estimated1RM: 0,
    };

    const updatedExercises = activeLiveWorkout.exercisesSnapshot.map((ex, idx) =>
      idx === exerciseIndex ? { ...ex, sets: [...ex.sets, newSet] } : ex
    );

    const updatedWorkout: ExecutedWorkout = {
      ...activeLiveWorkout,
      exercisesSnapshot: updatedExercises,
    };

    setActiveLiveWorkout(updatedWorkout);
    localStorage.setItem('vigor_active_live_session', JSON.stringify(updatedWorkout));
    showToast(`Serie extra (${type === 'dropset' ? 'Drop set' : 'Back-off'}) añadida`, 'info');
  };

  const finishLiveWorkout = async (
    notes?: string,
    sessionRpe?: number,
    finalDurationSeconds?: number
  ): Promise<{ success: boolean; error?: string }> => {
    if (!activeLiveWorkout) return { success: false, error: 'No active session' };
    const nowIso = new Date().toISOString();
    const duration = Math.max(
      0,
      Math.min(86400, finalDurationSeconds !== undefined ? finalDurationSeconds : activeLiveWorkout.durationSeconds)
    );

    const allCompletedSets = activeLiveWorkout.exercisesSnapshot.flatMap(ex => ex.sets.filter(s => s.completed));
    const totalTonnageKg = calculateSessionTonnage(allCompletedSets);
    const totalCompletedSets = allCompletedSets.length;
    const totalReps = allCompletedSets.reduce((sum, s) => sum + s.reps, 0);
    const averageRir = calculateAverageRir(allCompletedSets);

    const completedWorkout: ExecutedWorkout = {
      ...activeLiveWorkout,
      status: 'completed',
      completedAt: nowIso,
      durationSeconds: duration,
      totalTonnageKg,
      totalCompletedSets,
      totalReps,
      averageRir,
      sessionRpe: sessionRpe ?? 8.5,
      notes: notes ?? '',
    };

    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.completeExecutedWorkout(sessionUid, completedWorkout.id, 'completed', {
          durationSeconds: duration,
          sessionRpe: Math.max(1, Math.min(10, sessionRpe ?? 8.5)),
          notes: (notes ?? '').slice(0, 2000),
          startedAt: activeLiveWorkout.startedAt,
        });
      } catch (err: any) {
        showToast('Error al registrar la finalización en la nube. La sesión se mantiene en curso para reintentar.', 'warning');
        return { success: false, error: err?.message || 'Error al persistir cabecera' };
      }
    } else {
      const demoUid = currentUser?.id || 'demo_camilo';
      const existing = localStorage.getItem(`vigor_executed_workouts_${demoUid}`);
      const list = existing ? JSON.parse(existing) : [];
      localStorage.setItem(`vigor_executed_workouts_${demoUid}`, JSON.stringify([completedWorkout, ...list]));
    }

    setExecutedWorkoutsHistory(prev => [completedWorkout, ...prev]);
    localStorage.removeItem('vigor_active_live_session');
    setActiveLiveWorkout(null);
    setHasRecoveredLiveSession(false);

    if (completedWorkout.routineId) {
      const parentMeso = workoutRoutines.find(r => r.id === completedWorkout.routineId) as MesocycleRoutine | undefined;
      if (parentMeso?.isMesocycle && parentMeso.mesocycleConfig) {
        const curWeek = parentMeso.mesocycleConfig.currentWeek || 1;
        const dayId = completedWorkout.routineDayId || parentMeso.days[0]?.id;
        if (dayId) {
          const updatedMeso = updateMesocycleWeekProgress(parentMeso, curWeek, dayId, completedWorkout.id);
          setWorkoutRoutines(prev => prev.map(r => (r.id === updatedMeso.id ? updatedMeso : r)));

          if (sessionUid && !isDemoMode) {
            athleteRepo
              .saveWorkoutRoutine(sessionUid, toCleanWorkoutRoutine(updatedMeso))
              .catch(e => console.warn('Aviso de actualización de progreso del mesociclo:', e));
          } else {
            const uid = sessionUid || currentUser?.id || 'demo_camilo';
            const demoKey = `vigor_workout_routines_${uid}`;
            const updatedAll = workoutRoutines.map(r => (r.id === updatedMeso.id ? updatedMeso : r));
            localStorage.setItem(demoKey, JSON.stringify(updatedAll));
          }
        }
      }
    }

    showToast(
      `¡Entrenamiento finalizado con éxito! Tonelaje: ${totalTonnageKg.toLocaleString()} kg en ${Math.round(duration / 60)} min.`,
      'success'
    );
    return { success: true };
  };

  const abandonLiveWorkout = async (): Promise<void> => {
    if (!activeLiveWorkout) return;
    const workoutId = activeLiveWorkout.id;
    const nowIso = new Date().toISOString();

    const abandonedWorkout: ExecutedWorkout = {
      ...activeLiveWorkout,
      status: 'abandoned',
      completedAt: nowIso,
    };

    setExecutedWorkoutsHistory(prev => [abandonedWorkout, ...prev]);

    if (sessionUid && !isDemoMode) {
      try {
        await athleteRepo.completeExecutedWorkout(sessionUid, workoutId, 'abandoned', {
          durationSeconds: Math.max(0, Math.min(86400, activeLiveWorkout.durationSeconds || 0)),
          startedAt: activeLiveWorkout.startedAt,
        });
      } catch (err) {
        console.warn('Error registrando sesión abandonada en Catalyst:', err);
      }
    } else {
      const demoUid = currentUser?.id || 'demo_camilo';
      const existing = localStorage.getItem(`vigor_executed_workouts_${demoUid}`);
      const list = existing ? JSON.parse(existing) : [];
      localStorage.setItem(`vigor_executed_workouts_${demoUid}`, JSON.stringify([abandonedWorkout, ...list]));
    }

    localStorage.removeItem('vigor_active_live_session');
    setActiveLiveWorkout(null);
    setHasRecoveredLiveSession(false);
    showToast('Sesión cancelada y registrada como abandonada', 'info');
    navigate('rutina-de-entrenamiento');
  };

  const resumeRecoveredLiveSession = () => {
    setHasRecoveredLiveSession(false);
    navigate('registro-de-entrenamiento');
    showToast('Sesión en vivo reanudada', 'success');
  };

  const discardRecoveredLiveSession = () => {
    localStorage.removeItem('vigor_active_live_session');
    setActiveLiveWorkout(null);
    setHasRecoveredLiveSession(false);
    showToast('Sesión anterior descartada', 'info');
  };

  const updateLiveSessionDuration = (seconds: number) => {
    setActiveLiveWorkout(prev => (prev ? { ...prev, durationSeconds: seconds } : null));
  };

  const syncPendingOfflineSets = async (): Promise<void> => {
    const activeUid = sessionUid;
    if (!activeUid || isDemoMode) return;
    try {
      const summary = await syncOfflineSetsForUser(activeUid, async pendingSet => {
        if (!pendingSet.executedWorkoutId) return;
        const exItem = getExerciseById(pendingSet.exerciseId);
        await athleteRepo.logWorkoutSet(activeUid, {
          id: pendingSet.id,
          executedWorkoutId: pendingSet.executedWorkoutId,
          exerciseId: pendingSet.exerciseId,
          exerciseName: pendingSet.exerciseName,
          muscleGroup: toCleanMuscleGroup(exItem?.muscleGroup),
          setNumber: pendingSet.setNumber ?? 1,
          type: (pendingSet.setType as WorkoutSetType) || 'effective',
          weightKg: pendingSet.weightKg,
          reps: pendingSet.reps,
          rir: pendingSet.rir,
          completed: true,
        });
      });
      const remaining = getOfflinePendingSets(activeUid, false);
      setPendingOfflineSetsCount(remaining.length);
      if (summary.syncedCount > 0) {
        showToast(`Se sincronizaron ${summary.syncedCount} series pendientes en Zoho Catalyst`, 'success');
      }
    } catch (err: any) {
      console.error('Error syncing offline sets:', err);
    }
  };

  useEffect(() => {
    if (sessionUid && !isDemoMode) {
      const pending = getOfflinePendingSets(sessionUid, false);
      setPendingOfflineSetsCount(pending.length);
    } else {
      setPendingOfflineSetsCount(0);
    }
  }, [sessionUid, isDemoMode]);

  return (
    <AppContext.Provider
      value={{
        currentPath,
        navigate,

        currentUser,
        currentUserRole,
        refreshUserClaims,
        isAuthenticated: authStatus === 'authenticated' && !!currentUser,
        isDemoMode,
        authStatus,
        authError,
        unverifiedEmail,
        isLoggingOut,
        loginWithGoogle,
        completeCatalystSession,
        loginWithEmail,
        registerWithEmail,
        resetPassword,
        checkEmailVerification,
        sendVerificationEmail,
        startDemoMode,
        logout,
        redirectPath,
        setRedirectPath,
        isAuthModalOpen,
        openAuthModal: () => setIsAuthModalOpen(true),
        closeAuthModal: () => setIsAuthModalOpen(false),

        loadDemoTemplates,

        notifications,
        unreadNotificationCount,
        markNotificationAsRead,
        markAllNotificationsAsRead,
        deleteNotification,
        notificationPreferences,
        updateNotificationPreferences,
        requestPushPermission,
        sendPushAlert,
        isNotificationPanelOpen,
        openNotificationPanel: () => setIsNotificationPanelOpen(true),
        closeNotificationPanel: () => setIsNotificationPanelOpen(false),
        isPreferencesModalOpen,
        openPreferencesModal: () => setIsPreferencesModalOpen(true),
        closePreferencesModal: () => setIsPreferencesModalOpen(false),

        athletePreferences,
        updateAthleteProfile,
        updateAthletePreferences,
        saveOnboardingStep,
        completeOnboarding,

        biometrics,
        updateBiometrics,
        resetBiometricsToExcel,
        revertToPreviousBiometrics,
        mealPartition,
        updateMealPartition,

        groceries,
        toggleGroceryStatus,
        addGrocery,
        editGrocery,
        resetGroceryToPlan,
        deleteGrocery,
        clearCompletedGroceries,
        regenerateFromMenu,

        mealLogs,
        addMealLog,
        deleteMealLog,
        duplicateMealLog,
        selectedDate,
        setSelectedDate,
        selectedDateFormatted,
        selectedDaySummary,
        todaySummary,
        hasBiometricsConfigured,

        isMealDrawerOpen,
        mealDrawerMoment,
        openMealDrawer: (moment?: MealMoment | unknown) => {
          const isMoment =
            typeof moment === 'string' &&
            ['desayuno', 'almuerzo', 'merienda', 'cena', 'snack'].includes(moment);
          setMealDrawerMoment(isMoment ? (moment as MealMoment) : undefined);
          setIsMealDrawerOpen(true);
        },
        closeMealDrawer: () => {
          setMealDrawerMoment(undefined);
          setIsMealDrawerOpen(false);
        },
        isWorkoutModalOpen,
        openWorkoutModal: () => setIsWorkoutModalOpen(true),
        closeWorkoutModal: () => setIsWorkoutModalOpen(false),

        isMobileSidebarOpen,
        toggleMobileSidebar: () => setIsMobileSidebarOpen(prev => !prev),
        closeMobileSidebar: () => setIsMobileSidebarOpen(false),

        toast,
        showToast,

        activeWorkout,
        commitActiveSet,
        workoutHistory,
        restTimerSeconds,
        isRestTimerRunning,
        adjustRestTimer,
        resetRestTimer,
        toggleRestTimer,
        cardioSessions,
        addCardioSession,

        workoutRoutines,
        activeRoutine,
        activeRoutineId: activeRoutineIdState,
        routineSyncStatus,
        setActiveRoutineId,
        createRoutineFromTemplate,
        createCustomRoutine,
        updateWorkoutRoutine,
        deleteWorkoutRoutine,
        addExerciseToRoutineDay,
        removeExerciseFromRoutineDay,
        reorderExercisesInRoutineDay,
        updateRoutineExerciseConfig,
        saveMesocycleRoutine,
        advanceMesocycleWeek,

        activeLiveWorkout,
        executedWorkoutsHistory,
        hasRecoveredLiveSession,
        startLiveWorkout,
        startQuickLiveWorkout,
        commitLiveSet,
        addExtraLiveSet,
        finishLiveWorkout,
        abandonLiveWorkout,
        resumeRecoveredLiveSession,
        discardRecoveredLiveSession,
        updateLiveSessionDuration,
        pendingOfflineSetsCount,
        syncPendingOfflineSets,

        recipes,
        addRecipe,
        updateRecipe,
        deleteRecipe,
        mealPlans,
        currentMealPlan,
        activeWeekStart,
        setActiveWeekStart,
        assignRecipeToSlot,
        removeSlotFromPlan,
        logPlannedMeal,
        syncMealPlanToGroceries,

        isRecipeModalOpen,
        recipeModalData,
        openRecipeModal,
        closeRecipeModal,
        isAssignModalOpen,
        assignModalSlot,
        openAssignModal,
        closeAssignModal,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
