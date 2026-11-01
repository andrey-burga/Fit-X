export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  role: 'Atleta Pro' | 'Coach' | 'Nutricionista';
  location: string;
  joinedDate: string;
  emailVerified?: boolean;
  authProvider?: 'google.com' | 'password' | 'demo';
  onboardingCompleted?: boolean;
  onboardingStep?: number;
  goal?: AthleteGoal;
}

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

export interface AthletePreferences {
  weightUnit: WeightUnit;
  heightUnit: HeightUnit;
  timezone: string;
  trainingDaysPerWeek: number; // 3, 4, 5, 6
  daysPerWeek?: number;
  sessionDurationMinutes?: number;
  equipmentType?: string;
  trainingExperience: TrainingExperience;
  availableEquipment: string[];
  trainingGoal: AthleteGoal;
  muscleFocus: string[];
  mealsPerDay: number;
  dietaryPreference: DietaryPreference;
  excludedFoods?: string[];
  onboardingStep: number;
  onboardingCompleted: boolean;
  updatedAt?: string;
}

export const DEFAULT_ATHLETE_PREFERENCES: AthletePreferences = {
  weightUnit: 'kg',
  heightUnit: 'cm',
  timezone: 'America/Bogota',
  trainingDaysPerWeek: 4,
  trainingExperience: 'intermedio',
  availableEquipment: ['barra', 'mancuerna', 'polea', 'maquina', 'peso_corporal'],
  trainingGoal: 'hipertrofia',
  muscleFocus: ['pecho', 'espalda', 'cuadriceps', 'hombros'],
  mealsPerDay: 4,
  dietaryPreference: 'omnivoro',
  excludedFoods: [],
  onboardingStep: 1,
  onboardingCompleted: true,
};

export type NotificationCategory = 'nutricion' | 'entrenamiento' | 'compras' | 'sistema';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  timestamp: string; // e.g. 'Hace 10 min'
  category: NotificationCategory;
  read: boolean;
  actionPath?: string;
  severity?: 'info' | 'success' | 'warning';
}

export interface NotificationPreferences {
  mealReminders: boolean;
  workoutAlerts: boolean;
  groceryAlerts: boolean;
  systemSync: boolean;
  soundEnabled: boolean;
  pushEnabled: boolean;
  pushPermission: 'default' | 'granted' | 'denied';
}
