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
  | 'core'
  | 'cuerpo_completo';

export type MovementPattern =
  | 'empuje_horizontal'
  | 'traccion_horizontal'
  | 'empuje_vertical'
  | 'traccion_vertical'
  | 'sentadilla'
  | 'bisagra_cadera'
  | 'zancada'
  | 'aislamiento'
  | 'transporte';

export type EquipmentRequired =
  | 'barra'
  | 'mancuerna'
  | 'polea'
  | 'maquina'
  | 'peso_corporal'
  | 'kettlebell'
  | 'bandas';

export interface ExerciseItem {
  id: string;                         // Identificador estable único
  name: string;                       // Nombre canónico en español
  muscleGroup: MuscleGroup;           // Grupo muscular principal
  secondaryMuscles?: MuscleGroup[];   // Músculos secundarios/sinergistas
  movementPattern: MovementPattern;   // Patrón biomecánico
  equipment: EquipmentRequired;       // Equipamiento principal
  instructions?: string[];            // Pautas técnicas de ejecución
  variants?: string[];                // IDs de ejercicios sustitutos justificados
  isCustom?: boolean;                 // true si fue creado por el usuario
  userId?: string;                    // null/undefined para catálogo general, UID para custom
}

export interface PlannedExerciseConfig {
  id: string;                         // ID único de la asignación en la rutina
  exerciseId: string;                 // Referencia al ID en ExerciseItem
  orderIndex: number;                 // Orden dentro del día (1, 2, 3...)
  sets: number;                       // Series efectivas (ej: 3 o 4)
  repsMin: number;                    // Rango inferior de repeticiones (ej: 6)
  repsMax: number;                    // Rango superior de repeticiones (ej: 8)
  targetRir?: number;                 // RIR objetivo (ej: 1 o 2)
  restSeconds: number;                // Descanso entre series en segundos (ej: 120)
  tempo?: string;                     // Cadencia opcional (ej: '3-1-X-0')
  notes?: string;                     // Pautas específicas de técnica o progresión
}

export interface RoutineDay {
  id: string;                         // 'd1', 'd2', 'd3', 'd4', etc.
  name: string;                       // Ej: 'Día 1 • Lunes: Torso Pesado'
  shortName: string;                  // Ej: 'Torso Pesado'
  dayOfWeek?: string;                 // 'Lunes', 'Martes', etc.
  focusDescription?: string;          // Ej: 'Fuerza & Grosor (Tensión Mecánica)'
  isRestDay?: boolean;                // true si es descanso activo o recuperación
  exercises: PlannedExerciseConfig[];
}

export interface WorkoutRoutine {
  id: string;                         // ID del documento (ej: 'routine_1730000000')
  userId: string;                     // UID del usuario o 'demo_camilo'
  name: string;                       // Nombre de la rutina
  description: string;                // Descripción del objetivo
  goal: 'hipertrofia' | 'fuerza' | 'recomposicion' | 'resistencia';
  frequencyDays: number;              // Días de entrenamiento por semana (ej: 4)
  days: RoutineDay[];                 // Estructura de días
  isDefault?: boolean;                // Rutina activa seleccionada
  sourceTemplateId?: string;          // ID de la plantilla maestra de origen
  createdAt: string;                  // ISO 8601
  updatedAt: string;                  // ISO 8601
}

export interface MasterWorkoutTemplate {
  id: string;
  name: string;
  goal: WorkoutRoutine['goal'];
  frequencyDays: number;
  description: string;
  days: RoutineDay[];
}

export type WorkoutSetType = 'warmup' | 'effective' | 'dropset' | 'failure';

export interface LiveWorkoutSet {
  id: string;
  setNumber: number;
  type: WorkoutSetType;
  targetRepsMin?: number;
  targetRepsMax?: number;
  targetRir?: number;
  weightKg: number;
  reps: number;
  rir: number;
  completed: boolean;
  estimated1RM: number;
  completedAt?: string;
}

export interface LiveExerciseSession {
  configId: string;
  exerciseId: string;
  exerciseName: string;
  muscleGroup: MuscleGroup;
  movementPattern: MovementPattern;
  equipment: EquipmentRequired;
  tempo?: string;
  restSeconds: number;
  notes?: string;
  cue?: string;
  historicalRecord?: string;
  sets: LiveWorkoutSet[];
}

export interface ExecutedWorkout {
  id: string;
  userId: string;
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
  averageRir: number;
  sessionRpe?: number;
  notes?: string;
  exercisesSnapshot: LiveExerciseSession[];
}
