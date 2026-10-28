import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import {
  NavigationPath,
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
import { getFoodById } from '../services/nutritionMath';
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
  MasterWorkoutTemplate,
  ExecutedWorkout,
  LiveExerciseSession,
  LiveWorkoutSet,
  WorkoutSetType,
  RoutineDay,
} from '../types/workout';
import {
  MASTER_WORKOUT_TEMPLATES,
  instantiateRoutineFromTemplate,
} from '../data/workoutTemplates';
import {
  calculateEpley1RM,
  calculateSessionTonnage,
  calculateAverageRir,
} from '../utils/workoutCalculations';
import { getExerciseById } from '../data/exerciseCatalog';
import { createDemoExecutedWorkoutsHistory } from '../data/demoWorkoutsSeed';
import { UserProfile, AppNotification, NotificationPreferences } from '../types/auth';
import {
  auth,
  db,
  googleProvider,
  signInWithPopup,
  fbSignOut,
  handleFirestoreError,
  OperationType,
} from '../firebase';
import {
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  onSnapshot,
  getDoc,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';

interface AppContextType {
  currentPath: NavigationPath;
  navigate: (path: NavigationPath) => void;

  // Auth System
  currentUser: UserProfile | null;
  isAuthenticated: boolean;
  isDemoMode: boolean;
  loginWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  startDemoMode: (role?: 'Atleta Pro' | 'Coach' | 'Nutricionista', name?: string, email?: string) => void;
  logout: () => void;
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

  // Biometrics & Nutrition Target
  biometrics: BiometricConfig;
  updateBiometrics: (updates: Partial<BiometricConfig>) => void;
  resetBiometricsToExcel: () => void;
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
  avatarUrl:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuC3zYYPzD9Eg1BywRiP3hzgyQ9n12VK96fEiziXHs-SE5lgZckF16Ex8AnLcoP5xUVQI23OuQeC85_8rc9LQh3Mno4oDFfLAbBhhd-74a0Ecng6QNtWpExkHXOQK3860qtFG_389p9yG0FUrVX5ddZJNrZijrnRwe_fFwtE2CwikU5Ei4pARC6kHkQUykjTboNxyLz-v-3LFdaY9XK72BdUBEqTBZUv94DHR1WdVYUO',
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
    details: '12% inclinación @ 4.8 km/h',
    durationMinutes: 45,
    avgHr: 133,
    maxHr: 139,
    zone2Minutes: 42.3,
    zone2Percentage: 94,
    caloriesBurned: 380,
    device: 'Polar H10',
  },
  {
    id: 'cardio-2',
    date: 'Ayer, 18:30',
    title: 'Assault Bike HIIT 10x(20/40)',
    details: 'Potencia promedio 520W (Max effort)',
    durationMinutes: 15,
    avgHr: 164,
    maxHr: 183,
    zone2Minutes: 0,
    zone2Percentage: 0,
    caloriesBurned: 210,
    device: 'Watch Ultra',
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

const getScopedKey = (baseKey: string, user: UserProfile | null, isDemo: boolean): string => {
  if (isDemo || !user || !user.id) {
    const demoId = (user?.name || '').toLowerCase().includes('sof') ? 'demo_sofia' : 'demo_camilo';
    return `${baseKey}_${demoId}`;
  }
  return `${baseKey}_uid_${user.id}`;
};

const loadScopedPreference = <T,>(baseKey: string, scopeKey: string, fallback: T): T => {
  try {
    const scopedVal = localStorage.getItem(scopeKey);
    if (scopedVal) return JSON.parse(scopedVal);
    // Safe legacy fallback without overwriting other accounts: only if legacy key exists
    const legacyVal = localStorage.getItem(baseKey);
    if (legacyVal) return JSON.parse(legacyVal);
  } catch {}
  return fallback;
};

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentPath, setCurrentPath] = useState<NavigationPath>('dashboard-nutricional');

  // Firebase Auth State
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(() => {
    return localStorage.getItem('vigor_is_demo') === 'true';
  });

  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    const saved = localStorage.getItem('vigor_auth_user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return defaultUser;
  });

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

  // Live Workout Execution Engine (Increment 6C)
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
        // Default Demo Seed (Increment 6F)
        const demoSeed = createDemoExecutedWorkoutsHistory(uid);
        localStorage.setItem(`vigor_executed_workouts_${uid}`, JSON.stringify(demoSeed));
        return demoSeed;
      } catch {}
    }
    return [];
  });

  // Workout Routines (Increment 6B)
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
      // Demo initial routine
      const defaultDemo = instantiateRoutineFromTemplate('template_torso_pierna_4d', uid);
      return [defaultDemo];
    }
    return [];
  });

  const [activeRoutineId, setActiveRoutineId] = useState<string | null>(() => {
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
    if (activeRoutineId) {
      const found = workoutRoutines.find(r => r.id === activeRoutineId);
      if (found) return found;
    }
    const def = workoutRoutines.find(r => r.isDefault);
    return def || workoutRoutines[0];
  }, [workoutRoutines, activeRoutineId]);

  // Date Selection for Nutrition & Diary
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const isDemo = localStorage.getItem('vigor_is_demo') === 'true';
    return isDemo ? '2024-10-24' : getTodayLocalDateString();
  });
  const [hasBiometricsConfigured, setHasBiometricsConfigured] = useState<boolean>(() => {
    const isDemo = localStorage.getItem('vigor_is_demo') === 'true';
    return isDemo;
  });
  const [mealDrawerMoment, setMealDrawerMoment] = useState<MealMoment | undefined>(undefined);

  // Recipe Library & Weekly Meal Plans (Increment 4)
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

  // Modals for Recipes & Assigning
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

  // Modals & Feedback
  const [isMealDrawerOpen, setIsMealDrawerOpen] = useState(false);
  const [isWorkoutModalOpen, setIsWorkoutModalOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = (text: string, type: 'success' | 'info' | 'warning' = 'success') => {
    const id = Date.now().toString();
    setToast({ id, text, type });
    setTimeout(() => {
      setToast(current => (current?.id === id ? null : current));
    }, 3000);
  };

  const navigate = (path: NavigationPath) => {
    setCurrentPath(path);
    setIsMobileSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 1. Firebase Auth State Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async user => {
      setFbUser(user);
      if (user) {
        setIsDemoMode(false);
        localStorage.setItem('vigor_is_demo', 'false');

        const userRef = doc(db, 'users', user.uid);
        try {
          const snap = await getDoc(userRef);
          if (snap.exists()) {
            const data = snap.data();
            const prof: UserProfile = {
              id: user.uid,
              name: data.name || user.displayName || 'Atleta Vigor',
              email: data.email || user.email || '',
              avatarUrl: data.avatarUrl || user.photoURL || defaultUser.avatarUrl,
              role: data.role || 'Atleta Pro',
              location: data.location || 'Bogotá (UTC-5)',
              joinedDate: data.createdAt || 'Octubre 2024',
            };
            setCurrentUser(prof);
          } else {
            // New user registration
            const newProfile: UserProfile = {
              id: user.uid,
              name: user.displayName || user.email?.split('@')[0] || 'Atleta Vigor',
              email: user.email || '',
              avatarUrl: user.photoURL || defaultUser.avatarUrl,
              role: 'Atleta Pro',
              location: 'Bogotá (UTC-5)',
              joinedDate: new Date().toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }),
            };
            await setDoc(userRef, {
              ...newProfile,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
            // Seed base biometrics for new profile so calculations work
            await setDoc(doc(db, 'users', user.uid, 'biometrics', 'current'), {
              ...defaultBiometrics,
              userId: user.uid,
              updatedAt: new Date().toISOString(),
            });
            setCurrentUser(newProfile);
          }

          // Load isolated preferences for this specific user from Firestore
          try {
            const prefRef = doc(db, 'users', user.uid, 'preferences', 'settings');
            const prefSnap = await getDoc(prefRef);
            if (prefSnap.exists()) {
              const pdata = prefSnap.data();
              if (pdata.notificationPreferences) {
                setNotificationPreferences(pdata.notificationPreferences);
                localStorage.setItem(`vigor_notif_prefs_uid_${user.uid}`, JSON.stringify(pdata.notificationPreferences));
              }
              if (pdata.mealPartition) {
                setMealPartition(pdata.mealPartition);
                localStorage.setItem(`vigor_meal_partition_uid_${user.uid}`, JSON.stringify(pdata.mealPartition));
              }
            } else {
              // Initial user preferences setup
              const currentNotif = loadScopedPreference('vigor_notif_prefs', `vigor_notif_prefs_uid_${user.uid}`, initialNotificationPreferences);
              const currentMeal = loadScopedPreference('vigor_meal_partition', `vigor_meal_partition_uid_${user.uid}`, defaultMealPartition);
              setNotificationPreferences(currentNotif);
              setMealPartition(currentMeal);
              await setDoc(prefRef, {
                notificationPreferences: currentNotif,
                mealPartition: currentMeal,
                userId: user.uid,
                updatedAt: new Date().toISOString(),
              });
              localStorage.setItem(`vigor_notif_prefs_uid_${user.uid}`, JSON.stringify(currentNotif));
              localStorage.setItem(`vigor_meal_partition_uid_${user.uid}`, JSON.stringify(currentMeal));
            }
          } catch (prefErr) {
            console.error('Error fetching user preferences from Firestore:', prefErr);
          }
        } catch (err) {
          console.error('Error in user profile verification:', err);
        }
      } else {
        // No Firebase user
        if (!isDemoMode) {
          // If not explicitly in demo mode, set as guest or fallback
          const saved = localStorage.getItem('vigor_auth_user');
          if (saved) {
            try {
              setCurrentUser(JSON.parse(saved));
            } catch {
              setCurrentUser(defaultUser);
            }
          }
        }
      }
    });

    return () => unsubscribe();
  }, [isDemoMode]);

  // 2. Real-time Firestore Listeners (Attached ONLY when authenticated with real UID)
  useEffect(() => {
    const activeUid = fbUser?.uid;
    if (!activeUid || isDemoMode) {
      return;
    }

    // A. Biometrics
    const bioRef = doc(db, 'users', activeUid, 'biometrics', 'current');
    const unsubBio = onSnapshot(
      bioRef,
      snap => {
        if (snap.exists()) {
          setBiometrics(snap.data() as BiometricConfig);
          setHasBiometricsConfigured(true);
        } else {
          setHasBiometricsConfigured(false);
        }
      },
      error => {
        handleFirestoreError(error, OperationType.GET, `users/${activeUid}/biometrics/current`);
      }
    );

    // B. Groceries (Reads ONLY real user data, does NOT auto-seed when empty)
    const grocRef = collection(db, 'users', activeUid, 'groceries');
    const unsubGroc = onSnapshot(
      grocRef,
      snap => {
        const list: GroceryItem[] = [];
        snap.forEach(docSnap => {
          list.push({ id: docSnap.id, ...docSnap.data() } as GroceryItem);
        });
        setGroceries(list);
      },
      error => {
        handleFirestoreError(error, OperationType.LIST, `users/${activeUid}/groceries`);
      }
    );

    // C. Meal Logs (Reads ONLY real user data, does NOT auto-seed when empty)
    const mealsRef = collection(db, 'users', activeUid, 'mealLogs');
    const unsubMeals = onSnapshot(
      mealsRef,
      snap => {
        const list: MealLogItem[] = [];
        snap.forEach(docSnap => {
          list.push({ id: docSnap.id, ...docSnap.data() } as MealLogItem);
        });
        setMealLogs(list);
      },
      error => {
        handleFirestoreError(error, OperationType.LIST, `users/${activeUid}/mealLogs`);
      }
    );

    // D. Workout Sessions
    const workoutRef = collection(db, 'users', activeUid, 'workoutSessions');
    const unsubWorkout = onSnapshot(
      workoutRef,
      snap => {
        const list: WorkoutSessionRecord[] = [];
        snap.forEach(docSnap => {
          list.push({ id: docSnap.id, ...docSnap.data() } as WorkoutSessionRecord);
        });
        setWorkoutHistory(list);
      },
      error => {
        handleFirestoreError(error, OperationType.LIST, `users/${activeUid}/workoutSessions`);
      }
    );

    // E. Cardio Sessions
    const cardioRef = collection(db, 'users', activeUid, 'cardioSessions');
    const unsubCardio = onSnapshot(
      cardioRef,
      snap => {
        if (!snap.empty) {
          const list: CardioSession[] = [];
          snap.forEach(docSnap => {
            list.push({ id: docSnap.id, ...docSnap.data() } as CardioSession);
          });
          setCardioSessions(list);
        }
      },
      error => {
        handleFirestoreError(error, OperationType.LIST, `users/${activeUid}/cardioSessions`);
      }
    );

    // F. Notifications
    const notifsRef = collection(db, 'users', activeUid, 'notifications');
    const unsubNotifs = onSnapshot(
      notifsRef,
      snap => {
        const list: AppNotification[] = [];
        snap.forEach(docSnap => {
          list.push({ id: docSnap.id, ...docSnap.data() } as AppNotification);
        });
        setNotifications(list);
      },
      error => {
        handleFirestoreError(error, OperationType.LIST, `users/${activeUid}/notifications`);
      }
    );

    // G. Preferences Real-time Sync
    const prefRef = doc(db, 'users', activeUid, 'preferences', 'settings');
    const unsubPref = onSnapshot(
      prefRef,
      snap => {
        if (snap.exists()) {
          const pdata = snap.data();
          if (pdata.notificationPreferences) {
            setNotificationPreferences(pdata.notificationPreferences);
            localStorage.setItem(`vigor_notif_prefs_uid_${activeUid}`, JSON.stringify(pdata.notificationPreferences));
          }
          if (pdata.mealPartition) {
            setMealPartition(pdata.mealPartition);
            localStorage.setItem(`vigor_meal_partition_uid_${activeUid}`, JSON.stringify(pdata.mealPartition));
          }
        }
      },
      error => {
        handleFirestoreError(error, OperationType.GET, `users/${activeUid}/preferences/settings`);
      }
    );

    // H. Recipe Library (Increment 4)
    const recipesRef = collection(db, 'users', activeUid, 'recipes');
    const unsubRecipes = onSnapshot(
      recipesRef,
      snap => {
        const list: Recipe[] = [];
        snap.forEach(docSnap => {
          list.push({ id: docSnap.id, ...docSnap.data() } as Recipe);
        });
        setRecipes(list.length > 0 ? list : TEMPLATE_RECIPES);
      },
      error => {
        handleFirestoreError(error, OperationType.LIST, `users/${activeUid}/recipes`);
      }
    );

    // I. Weekly Meal Plans (Increment 4)
    const mealPlansRef = collection(db, 'users', activeUid, 'mealPlans');
    const unsubMealPlans = onSnapshot(
      mealPlansRef,
      snap => {
        const plans: Record<string, WeeklyMealPlan> = {};
        snap.forEach(docSnap => {
          const plan = { id: docSnap.id, ...docSnap.data() } as WeeklyMealPlan;
          plans[plan.weekStart] = plan;
          plans[plan.id] = plan;
        });
        setMealPlans(plans);
      },
      error => {
        handleFirestoreError(error, OperationType.LIST, `users/${activeUid}/mealPlans`);
      }
    );

    // J. Workout Routines (Increment 6B)
    const routinesRef = collection(db, 'users', activeUid, 'workoutRoutines');
    const unsubRoutines = onSnapshot(
      routinesRef,
      snap => {
        const list: WorkoutRoutine[] = [];
        snap.forEach(docSnap => {
          list.push({ id: docSnap.id, ...docSnap.data() } as WorkoutRoutine);
        });
        setWorkoutRoutines(list);
        setRoutineSyncStatus('synced');
      },
      error => {
        handleFirestoreError(error, OperationType.LIST, `users/${activeUid}/workoutRoutines`);
        setRoutineSyncStatus('error');
      }
    );

    // K. Executed Workouts History (Increment 6C)
    const executedRef = collection(db, 'users', activeUid, 'executedWorkouts');
    const unsubExecuted = onSnapshot(
      executedRef,
      snap => {
        const list: ExecutedWorkout[] = [];
        snap.forEach(docSnap => {
          list.push({ id: docSnap.id, ...docSnap.data() } as ExecutedWorkout);
        });
        setExecutedWorkoutsHistory(list);
      },
      error => {
        handleFirestoreError(error, OperationType.LIST, `users/${activeUid}/executedWorkouts`);
      }
    );

    return () => {
      unsubBio();
      unsubGroc();
      unsubMeals();
      unsubWorkout();
      unsubCardio();
      unsubNotifs();
      unsubPref();
      unsubRecipes();
      unsubMealPlans();
      unsubRoutines();
      unsubExecuted();
    };
  }, [fbUser, isDemoMode]);

  // Synchronize local state backup for offline demo resilience and user isolation
  useEffect(() => {
    localStorage.setItem('vigor_auth_user', JSON.stringify(currentUser));
  }, [currentUser]);

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

  // Explicit Template Loader (Only invoked when user explicitly requests sample data)
  const loadDemoTemplates = async () => {
    if (fbUser?.uid && !isDemoMode) {
      showToast('Cargando plantilla maestra a tu cuenta Cloud Firestore...');
      try {
        // Groceries
        for (const item of templateGroceries) {
          await setDoc(doc(db, 'users', fbUser.uid, 'groceries', item.id), {
            ...item,
            userId: fbUser.uid,
            createdAt: new Date().toISOString(),
          });
        }
        // Meal logs
        for (const log of templateMealLogs) {
          await setDoc(doc(db, 'users', fbUser.uid, 'mealLogs', log.id), {
            ...log,
            userId: fbUser.uid,
            createdAt: new Date().toISOString(),
          });
        }
        showToast('¡Plantilla de comidas e insumos importada en Cloud Firestore!', 'success');
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${fbUser.uid}/templates`);
      }
    } else {
      setGroceries(templateGroceries);
      setMealLogs(templateMealLogs);
      showToast('Plantilla de demostración cargada localmente');
    }
  };

  // Authentication Operations
  const loginWithGoogle = async (): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      setIsDemoMode(false);
      localStorage.setItem('vigor_is_demo', 'false');
      showToast(`¡Sesión iniciada con Google (${user.displayName || user.email})!`, 'success');
      return { success: true };
    } catch (err: any) {
      console.error('Google Sign In error:', err);
      return { success: false, error: err.message || 'Error al iniciar sesión con Google' };
    }
  };

  const startDemoMode = (
    role: 'Atleta Pro' | 'Coach' | 'Nutricionista' = 'Atleta Pro',
    name: string = 'Camilo R. (Demo)',
    email: string = 'camilo@vigor.co'
  ) => {
    // Terminate any active Firebase session immediately to avoid remote write crosstalk
    fbSignOut(auth).catch(() => {});
    setFbUser(null);
    setIsDemoMode(true);
    localStorage.setItem('vigor_is_demo', 'true');
    const demoId = name.toLowerCase().includes('sof') ? 'demo_sofia' : 'demo_camilo';
    const demoProfile: UserProfile = {
      id: demoId,
      name,
      email,
      avatarUrl: defaultUser.avatarUrl,
      role,
      location: 'Bogotá (UTC-5)',
      joinedDate: 'Octubre 2024',
    };
    setCurrentUser(demoProfile);

    // Isolated demo groceries and meal logs
    const savedGroceries = localStorage.getItem(`vigor_groceries_${demoId}`);
    setGroceries(savedGroceries ? JSON.parse(savedGroceries) : templateGroceries);

    const savedMealLogs = localStorage.getItem(`vigor_meal_logs_${demoId}`);
    setMealLogs(savedMealLogs ? JSON.parse(savedMealLogs) : templateMealLogs);

    // Isolated preferences per demo profile
    const savedNotif = localStorage.getItem(`vigor_notif_prefs_${demoId}`);
    setNotificationPreferences(savedNotif ? JSON.parse(savedNotif) : initialNotificationPreferences);

    const savedMeal = localStorage.getItem(`vigor_meal_partition_${demoId}`);
    setMealPartition(savedMeal ? JSON.parse(savedMeal) : defaultMealPartition);

    // Isolated demo workout routines per demo profile
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
    setActiveRoutineId(savedActive || null);
    setRoutineSyncStatus('synced');

    setHasBiometricsConfigured(true);
    setSelectedDate('2024-10-24');

    showToast(`Modo Demostración activo como ${name} (${role})`);
  };

  const logout = async () => {
    try {
      await fbSignOut(auth);
    } catch {}
    setFbUser(null);
    setIsDemoMode(false);
    localStorage.setItem('vigor_is_demo', 'false');
    setCurrentUser(null);
    setGroceries([]);
    setMealLogs([]);
    setWorkoutHistory([]);
    setWorkoutRoutines([]);
    setActiveRoutineId(null);
    setRoutineSyncStatus('idle');
    setNotificationPreferences(initialNotificationPreferences);
    setMealPartition(defaultMealPartition);
    showToast('Sesión cerrada correctamente');
  };

  // Notifications Operations
  const unreadNotificationCount = notifications.filter(n => !n.read).length;

  const markNotificationAsRead = async (id: string) => {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));
    if (fbUser?.uid && !isDemoMode) {
      try {
        await updateDoc(doc(db, 'users', fbUser.uid, 'notifications', id), { read: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${fbUser.uid}/notifications/${id}`);
      }
    }
  };

  const markAllNotificationsAsRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    showToast('Todas las notificaciones marcadas como leídas');
    if (fbUser?.uid && !isDemoMode) {
      notifications.forEach(n => {
        updateDoc(doc(db, 'users', fbUser.uid, 'notifications', n.id), { read: true }).catch(() => {});
      });
    }
  };

  const deleteNotification = async (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    showToast('Notificación descartada');
    if (fbUser?.uid && !isDemoMode) {
      try {
        await deleteDoc(doc(db, 'users', fbUser.uid, 'notifications', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `users/${fbUser.uid}/notifications/${id}`);
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

      if (fbUser?.uid && !isDemoMode) {
        setDoc(
          doc(db, 'users', fbUser.uid, 'preferences', 'settings'),
          {
            notificationPreferences: next,
            userId: fbUser.uid,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        ).catch(err => {
          handleFirestoreError(err, OperationType.WRITE, `users/${fbUser.uid}/preferences/settings`);
        });
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
    const id = `notif-${Date.now()}`;
    const newNotif: AppNotification = {
      id,
      title,
      message,
      timestamp: 'Ahora mismo',
      category,
      read: false,
      severity: 'info',
    };
    setNotifications(prev => [newNotif, ...prev]);

    if (fbUser?.uid && !isDemoMode) {
      try {
        await setDoc(doc(db, 'users', fbUser.uid, 'notifications', id), {
          ...newNotif,
          userId: fbUser.uid,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error('Failed to save notification to Firestore:', err);
      }
    }

    // Browser Notification API for local alert
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

  // Biometrics calculation logic & Firestore Persist
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
    showToast('Parámetros recalculados');

    if (fbUser?.uid && !isDemoMode) {
      try {
        await setDoc(
          doc(db, 'users', fbUser.uid, 'biometrics', 'current'),
          {
            ...calculated,
            userId: fbUser.uid,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${fbUser.uid}/biometrics/current`);
      }
    }
  };

  const resetBiometricsToExcel = async () => {
    setBiometrics(defaultBiometrics);
    showToast('Parámetros restablecidos al libro maestro');
    if (fbUser?.uid && !isDemoMode) {
      try {
        await setDoc(doc(db, 'users', fbUser.uid, 'biometrics', 'current'), {
          ...defaultBiometrics,
          userId: fbUser.uid,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${fbUser.uid}/biometrics/current`);
      }
    }
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

      if (fbUser?.uid && !isDemoMode) {
        setDoc(
          doc(db, 'users', fbUser.uid, 'preferences', 'settings'),
          {
            mealPartition: next,
            userId: fbUser.uid,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        ).catch(err => {
          handleFirestoreError(err, OperationType.WRITE, `users/${fbUser.uid}/preferences/settings`);
        });
      }
      return next;
    });
    showToast('Distribución de momentos actualizada');
  };

  // Groceries CRUD with Firestore
  const toggleGroceryStatus = async (id: string) => {
    const item = groceries.find(g => g.id === id);
    if (!item) return;
    const nextStatus = item.status === 'completed' ? 'pending' : 'completed';

    setGroceries(prev => prev.map(g => (g.id === id ? { ...g, status: nextStatus } : g)));

    if (fbUser?.uid && !isDemoMode) {
      try {
        await updateDoc(doc(db, 'users', fbUser.uid, 'groceries', id), {
          status: nextStatus,
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${fbUser.uid}/groceries/${id}`);
      }
    }
  };

  const addGrocery = async (itemData: Omit<GroceryItem, 'id' | 'status'>) => {
    const id = `item-${Date.now()}`;
    const newItem: GroceryItem = {
      ...itemData,
      id,
      status: 'pending',
    };
    setGroceries(prev => [newItem, ...prev]);
    showToast(`"${newItem.name}" añadido a la lista`);

    if (fbUser?.uid && !isDemoMode) {
      try {
        await setDoc(doc(db, 'users', fbUser.uid, 'groceries', id), {
          ...newItem,
          userId: fbUser.uid,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `users/${fbUser.uid}/groceries/${id}`);
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

    if (fbUser?.uid && !isDemoMode) {
      try {
        const updatePayload: Record<string, any> = {
          name,
          quantity,
          unit,
          isCustomized: true,
        };
        if (department) updatePayload.department = department;
        if (notes !== undefined) updatePayload.notes = notes;

        await updateDoc(doc(db, 'users', fbUser.uid, 'groceries', id), updatePayload);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${fbUser.uid}/groceries/${id}`);
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

    if (fbUser?.uid && !isDemoMode) {
      try {
        await updateDoc(doc(db, 'users', fbUser.uid, 'groceries', id), {
          quantity: revertedQuantity,
          isCustomized: false,
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${fbUser.uid}/groceries/${id}`);
      }
    }
  };

  const deleteGrocery = async (id: string) => {
    setGroceries(prev => prev.filter(item => item.id !== id));
    showToast('Insumo eliminado de la lista');

    if (fbUser?.uid && !isDemoMode) {
      try {
        await deleteDoc(doc(db, 'users', fbUser.uid, 'groceries', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `users/${fbUser.uid}/groceries/${id}`);
      }
    }
  };

  const clearCompletedGroceries = async () => {
    const toDelete = groceries.filter(item => item.status === 'completed');
    setGroceries(prev => prev.filter(item => item.status !== 'completed'));
    showToast('Insumos completados eliminados');

    if (fbUser?.uid && !isDemoMode) {
      toDelete.forEach(item => {
        deleteDoc(doc(db, 'users', fbUser.uid, 'groceries', item.id)).catch(() => {});
      });
    }
  };

  const regenerateFromMenu = async () => {
    await syncMealPlanToGroceries(currentMealPlan);
  };

  // Meal Logs CRUD with Firestore
  const addMealLog = async (itemData: Omit<MealLogItem, 'id'>) => {
    const id = `log-${Date.now()}`;
    const newLog: MealLogItem = {
      ...itemData,
      id,
    };
    setMealLogs(prev => [newLog, ...prev]);
    showToast('¡Comida registrada exitosamente!');

    sendPushAlert(
      'Comida registrada exitosamente',
      `${newLog.title} (${newLog.calories} kcal) añadida al Registro Diario.`,
      'nutricion'
    );

    if (fbUser?.uid && !isDemoMode) {
      try {
        await setDoc(doc(db, 'users', fbUser.uid, 'mealLogs', id), {
          ...newLog,
          userId: fbUser.uid,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `users/${fbUser.uid}/mealLogs/${id}`);
      }
    }
  };

  const deleteMealLog = async (id: string) => {
    setMealLogs(prev => prev.filter(item => item.id !== id));
    showToast('Registro de comida eliminado');

    if (fbUser?.uid && !isDemoMode) {
      try {
        await deleteDoc(doc(db, 'users', fbUser.uid, 'mealLogs', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `users/${fbUser.uid}/mealLogs/${id}`);
      }
    }
  };

  const duplicateMealLog = async (id: string) => {
    const item = mealLogs.find(m => m.id === id);
    if (!item) return;
    const now = new Date();
    const dateTime = now.toISOString().slice(0, 16);
    const newId = `log-${Date.now()}`;
    const duplicated: MealLogItem = {
      ...item,
      id: newId,
      dateTime,
      title: `${item.title} (Copia)`,
      source: 'Manual',
    };
    setMealLogs(prev => [duplicated, ...prev]);
    showToast('Comida duplicada al día actual');

    if (fbUser?.uid && !isDemoMode) {
      try {
        await setDoc(doc(db, 'users', fbUser.uid, 'mealLogs', newId), {
          ...duplicated,
          userId: fbUser.uid,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `users/${fbUser.uid}/mealLogs/${newId}`);
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

  // Recipe Library & Weekly Meal Plans (Increment 4)
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

    if (fbUser?.uid && !isDemoMode) {
      try {
        await setDoc(doc(db, 'users', fbUser.uid, 'recipes', id), {
          ...newRecipe,
          userId: fbUser.uid,
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `users/${fbUser.uid}/recipes/${id}`);
      }
    } else {
      localStorage.setItem('vigor_recipes_demo', JSON.stringify([newRecipe, ...recipes]));
    }

    return id;
  };

  const updateRecipe = async (id: string, updates: Partial<Recipe>): Promise<void> => {
    const nowIso = new Date().toISOString();
    const fullUpdates = { ...updates, updatedAt: nowIso };

    setRecipes(prev => prev.map(r => (r.id === id ? { ...r, ...fullUpdates } : r)));

    // Propagar las modificaciones de la receta a los slots planificados en los menús semanales
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

    if (fbUser?.uid && !isDemoMode) {
      try {
        await updateDoc(doc(db, 'users', fbUser.uid, 'recipes', id), fullUpdates);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${fbUser.uid}/recipes/${id}`);
      }
    } else {
      const updatedList = recipes.map(r => (r.id === id ? { ...r, ...fullUpdates } : r));
      localStorage.setItem('vigor_recipes_demo', JSON.stringify(updatedList));
    }
  };

  const deleteRecipe = async (id: string): Promise<void> => {
    setRecipes(prev => prev.filter(r => r.id !== id));
    showToast('Receta eliminada de la biblioteca');

    if (fbUser?.uid && !isDemoMode) {
      try {
        await deleteDoc(doc(db, 'users', fbUser.uid, 'recipes', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `users/${fbUser.uid}/recipes/${id}`);
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

    if (fbUser?.uid && !isDemoMode) {
      try {
        await setDoc(doc(db, 'users', fbUser.uid, 'mealPlans', planId), {
          ...updatedPlan,
          userId: fbUser.uid,
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `users/${fbUser.uid}/mealPlans/${planId}`);
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

    if (fbUser?.uid && !isDemoMode) {
      try {
        await setDoc(doc(db, 'users', fbUser.uid, 'mealPlans', planId), {
          ...updatedPlan,
          userId: fbUser.uid,
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${fbUser.uid}/mealPlans/${planId}`);
      }
    }
  };

  const logPlannedMeal = async (date: string, moment: MealMoment, recipeId: string): Promise<void> => {
    const recipe = recipes.find(r => r.id === recipeId);
    if (!recipe) {
      showToast('Receta no encontrada en la biblioteca', 'warning');
      return;
    }

    // Prevención de duplicados accidentales: verificar si ya fue registrada para esta fecha y momento
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

    if (fbUser?.uid && !isDemoMode) {
      try {
        // Escritura y eliminación atómica mediante writeBatch para eliminar el riesgo de resultados parciales
        const batch = writeBatch(db);

        // 1. Guardar/actualizar cada insumo en Firestore respetando isValidGrocery
        for (const item of updatedGroceries) {
          const docRef = doc(db, 'users', fbUser.uid, 'groceries', item.id);
          const cleanItem = Object.fromEntries(
            Object.entries({
              ...item,
              userId: fbUser.uid,
              updatedAt: new Date().toISOString(),
            }).filter(([_, v]) => v !== undefined)
          );
          batch.set(docRef, cleanItem, { merge: true });
        }

        // 2. Eliminar de Firestore los insumos planificados pendientes que fueron retirados
        const activeIds = new Set(updatedGroceries.map(g => g.id));
        for (const oldItem of groceries) {
          if (!activeIds.has(oldItem.id)) {
            const oldRef = doc(db, 'users', fbUser.uid, 'groceries', oldItem.id);
            batch.delete(oldRef);
          }
        }

        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${fbUser.uid}/groceries`);
      }
    } else if (currentUser?.id) {
      localStorage.setItem(`vigor_groceries_${currentUser.id}`, JSON.stringify(updatedGroceries));
    }

    // Notificaciones comprensibles según resultado
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
    setActiveWorkout(prev => {
      const nextSets = [...prev.sets];
      const activeIdx = nextSets.findIndex(s => !s.completed);
      if (activeIdx !== -1) {
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
      userId: fbUser?.uid || 'demo_user',
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
    };

    setWorkoutHistory(prev => [newRecord, ...prev]);

    if (e1rm >= 95) {
      sendPushAlert(
        '¡Hito de Sobrecarga Progresiva!',
        `Serie completada a ${weight}kg x ${reps} reps (1RM estimado: ${e1rm}kg).`,
        'entrenamiento'
      );
    }

    if (fbUser?.uid && !isDemoMode) {
      if (activeLiveWorkout?.id) {
        try {
          await setDoc(doc(db, 'users', fbUser.uid, 'workoutSessions', sessionId), newRecord);
        } catch (err) {
          console.error('Failed to log set in Firestore:', err);
        }
      } else {
        // En cumplimiento de la política de cero series huérfanas, las series remotas requieren sesión activa
        console.warn('Serie registrada localmente. Para sincronizar con Firestore, inicia un entrenamiento en vivo.');
      }
    }
  };

  const addCardioSession = async (session: Omit<CardioSession, 'id'>) => {
    const id = `cardio-${Date.now()}`;
    const newSession: CardioSession = { ...session, id };
    setCardioSessions(prev => [newSession, ...prev]);
    showToast(`Sesión de cardio "${session.title}" guardada con éxito`);

    if (fbUser?.uid && !isDemoMode) {
      try {
        await setDoc(doc(db, 'users', fbUser.uid, 'cardioSessions', id), {
          ...newSession,
          userId: fbUser.uid,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `users/${fbUser.uid}/cardioSessions/${id}`);
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

  // Workout Routines Operations (Increment 6B)
  const createRoutineFromTemplate = async (templateId: string, customName?: string): Promise<string> => {
    const uid = fbUser?.uid || currentUser?.id || 'demo_camilo';
    const newRoutine = instantiateRoutineFromTemplate(templateId, uid, customName);

    setWorkoutRoutines(prev => [newRoutine, ...prev.filter(r => r.id !== newRoutine.id)]);
    setActiveRoutineId(newRoutine.id);

    if (isDemoMode || !fbUser?.uid) {
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
      await setDoc(doc(db, 'users', fbUser.uid, 'workoutRoutines', newRoutine.id), {
        ...newRoutine,
        userId: fbUser.uid,
        updatedAt: new Date().toISOString(),
      });
      setRoutineSyncStatus('synced');
      showToast(`Rutina "${newRoutine.name}" guardada en la nube`, 'success');
      return newRoutine.id;
    } catch (err) {
      setRoutineSyncStatus('error');
      handleFirestoreError(err, OperationType.CREATE, `users/${fbUser.uid}/workoutRoutines/${newRoutine.id}`);
      throw err;
    }
  };

  const createCustomRoutine = async (
    routineData: Omit<WorkoutRoutine, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
  ): Promise<string> => {
    const uid = fbUser?.uid || currentUser?.id || 'demo_camilo';
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
    setActiveRoutineId(newRoutine.id);

    if (isDemoMode || !fbUser?.uid) {
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
      await setDoc(doc(db, 'users', fbUser.uid, 'workoutRoutines', newId), {
        ...newRoutine,
        userId: fbUser.uid,
        updatedAt: now,
      });
      setRoutineSyncStatus('synced');
      showToast(`Rutina "${newRoutine.name}" guardada en la nube`, 'success');
      return newRoutine.id;
    } catch (err) {
      setRoutineSyncStatus('error');
      handleFirestoreError(err, OperationType.CREATE, `users/${fbUser.uid}/workoutRoutines/${newId}`);
      throw err;
    }
  };

  const updateWorkoutRoutine = async (id: string, updates: Partial<WorkoutRoutine>): Promise<void> => {
    const now = new Date().toISOString();
    const updatedList = workoutRoutines.map(r => {
      if (r.id === id) {
        return { ...r, ...updates, updatedAt: now };
      }
      return r;
    });
    setWorkoutRoutines(updatedList);

    const uid = fbUser?.uid || currentUser?.id || 'demo_camilo';
    if (isDemoMode || !fbUser?.uid) {
      const demoKey = `vigor_workout_routines_${uid}`;
      localStorage.setItem(demoKey, JSON.stringify(updatedList));
      setRoutineSyncStatus('synced');
      return;
    }

    setRoutineSyncStatus('saving');
    try {
      await updateDoc(doc(db, 'users', fbUser.uid, 'workoutRoutines', id), {
        ...updates,
        updatedAt: now,
      });
      setRoutineSyncStatus('synced');
    } catch (err) {
      setRoutineSyncStatus('error');
      handleFirestoreError(err, OperationType.UPDATE, `users/${fbUser.uid}/workoutRoutines/${id}`);
      throw err;
    }
  };

  const deleteWorkoutRoutine = async (id: string): Promise<void> => {
    const target = workoutRoutines.find(r => r.id === id);
    const filtered = workoutRoutines.filter(r => r.id !== id);
    setWorkoutRoutines(filtered);
    if (activeRoutineId === id) {
      setActiveRoutineId(filtered[0]?.id || null);
    }

    const uid = fbUser?.uid || currentUser?.id || 'demo_camilo';
    if (isDemoMode || !fbUser?.uid) {
      const demoKey = `vigor_workout_routines_${uid}`;
      localStorage.setItem(demoKey, JSON.stringify(filtered));
      showToast(`Rutina "${target?.name || ''}" eliminada`, 'info');
      return;
    }

    setRoutineSyncStatus('saving');
    try {
      await deleteDoc(doc(db, 'users', fbUser.uid, 'workoutRoutines', id));
      setRoutineSyncStatus('synced');
      showToast(`Rutina "${target?.name || ''}" eliminada de la nube`, 'info');
    } catch (err) {
      setRoutineSyncStatus('error');
      handleFirestoreError(err, OperationType.DELETE, `users/${fbUser.uid}/workoutRoutines/${id}`);
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

  // Live Workout Execution Engine (Increment 6C)
  const startLiveWorkout = async (routine: WorkoutRoutine, day: RoutineDay): Promise<string> => {
    const uid = fbUser?.uid || currentUser?.id || 'demo_camilo';
    const workoutId = `ewk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
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

    if (fbUser?.uid && !isDemoMode) {
      try {
        await setDoc(doc(db, 'users', fbUser.uid, 'executedWorkouts', workoutId), {
          id: workoutId,
          userId: fbUser.uid,
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
        });
      } catch (err: any) {
        handleFirestoreError(err, OperationType.CREATE, `users/${fbUser.uid}/executedWorkouts/${workoutId}`);
      }
    }

    showToast(`¡Sesión en vivo "${day.shortName || day.name}" iniciada!`, 'success');
    navigate('registro-de-entrenamiento');
    return workoutId;
  };

  const startQuickLiveWorkout = async (name: string = 'Entrenamiento Libre'): Promise<string> => {
    const uid = fbUser?.uid || currentUser?.id || 'demo_camilo';
    const workoutId = `ewk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
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

    if (fbUser?.uid && !isDemoMode) {
      try {
        await setDoc(doc(db, 'users', fbUser.uid, 'executedWorkouts', workoutId), {
          id: workoutId,
          userId: fbUser.uid,
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
        });
      } catch (err: any) {
        handleFirestoreError(err, OperationType.CREATE, `users/${fbUser.uid}/executedWorkouts/${workoutId}`);
      }
    }

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

    let targetSetIndex = targetEx.sets.findIndex(s => !s.completed);
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
      userId: fbUser?.uid || currentUser?.id || 'demo_camilo',
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

    if (fbUser?.uid && !isDemoMode) {
      try {
        await setDoc(doc(db, 'users', fbUser.uid, 'workoutSessions', setId), sessionRecord);
      } catch (err: any) {
        handleFirestoreError(err, OperationType.CREATE, `users/${fbUser.uid}/workoutSessions/${setId}`);
      }

      try {
        await setDoc(
          doc(db, 'users', fbUser.uid, 'executedWorkouts', activeLiveWorkout.id),
          {
            totalTonnageKg,
            totalCompletedSets,
            totalReps,
            averageRir,
            durationSeconds: activeLiveWorkout.durationSeconds,
            exercisesSnapshot: updatedExercises,
          },
          { merge: true }
        );
      } catch {}
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
    const duration = finalDurationSeconds !== undefined ? finalDurationSeconds : activeLiveWorkout.durationSeconds;

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

    if (fbUser?.uid && !isDemoMode) {
      try {
        await setDoc(doc(db, 'users', fbUser.uid, 'executedWorkouts', completedWorkout.id), completedWorkout);
      } catch (err: any) {
        handleFirestoreError(err, OperationType.WRITE, `users/${fbUser.uid}/executedWorkouts/${completedWorkout.id}`);
        showToast('Error al registrar la finalización en la nube. La sesión se mantiene en curso para reintentar.', 'warning');
        return { success: false, error: err?.message || 'Error al persistir cabecera' };
      }
    } else {
      const demoUid = currentUser?.id || 'demo_camilo';
      const existing = localStorage.getItem(`vigor_executed_workouts_${demoUid}`);
      const list = existing ? JSON.parse(existing) : [];
      localStorage.setItem(`vigor_executed_workouts_${demoUid}`, JSON.stringify([completedWorkout, ...list]));
    }

    // Only update local memory and clear active session after confirmed write
    setExecutedWorkoutsHistory(prev => [completedWorkout, ...prev]);
    localStorage.removeItem('vigor_active_live_session');
    setActiveLiveWorkout(null);
    setHasRecoveredLiveSession(false);

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

    // Registrar en historial para preservar trazabilidad
    setExecutedWorkoutsHistory(prev => [abandonedWorkout, ...prev]);

    if (fbUser?.uid && !isDemoMode) {
      try {
        await updateDoc(doc(db, 'users', fbUser.uid, 'executedWorkouts', workoutId), {
          status: 'abandoned',
          completedAt: nowIso,
        });
      } catch (err: any) {
        handleFirestoreError(err, OperationType.WRITE, `users/${fbUser.uid}/executedWorkouts/${workoutId}`);
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

  return (
    <AppContext.Provider
      value={{
        currentPath,
        navigate,

        // Auth
        currentUser,
        isAuthenticated: !!currentUser,
        isDemoMode,
        loginWithGoogle,
        startDemoMode,
        logout,
        isAuthModalOpen,
        openAuthModal: () => setIsAuthModalOpen(true),
        closeAuthModal: () => setIsAuthModalOpen(false),

        // Template Loader
        loadDemoTemplates,

        // Notifications
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

        // Biometrics
        biometrics,
        updateBiometrics,
        resetBiometricsToExcel,
        mealPartition,
        updateMealPartition,

        // Groceries
        groceries,
        toggleGroceryStatus,
        addGrocery,
        editGrocery,
        resetGroceryToPlan,
        deleteGrocery,
        clearCompletedGroceries,
        regenerateFromMenu,

        // Meal Logs & Date Context
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

        // Modals
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

        // Mobile
        isMobileSidebarOpen,
        toggleMobileSidebar: () => setIsMobileSidebarOpen(prev => !prev),
        closeMobileSidebar: () => setIsMobileSidebarOpen(false),

        // Toast
        toast,
        showToast,

        // Workout Legacy & Compatibility
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

        // Workout Routines (Increment 6B)
        workoutRoutines,
        activeRoutine,
        activeRoutineId,
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

        // Live Workout Execution Engine (Increment 6C)
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

        // Recipe Library & Weekly Plans (Increment 4)
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

        // Recipe & Assign Modals
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
