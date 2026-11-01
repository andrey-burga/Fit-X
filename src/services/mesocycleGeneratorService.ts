/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Incremento 7B: Motor Inteligente de Generación de Mesociclos
 *
 * Características:
 *  - Selección inteligente de división semanal basada en días, experiencia y objetivo.
 *  - Selección estricta de ejercicios desde el catálogo real (EXERCISE_CATALOG).
 *  - Adaptación biomecánica a equipamiento disponible con variantes justificadas.
 *  - Prescripción científica de series, repeticiones, RIR, descansos y cadencia.
 *  - Periodización semana a semana (Calibración -> Progresión doble -> Micro-cargas -> Descarga).
 *  - Estimación realista de duración de sesión y advertencias de volumen.
 *  - 100% cálculos en memoria sin mutación de Firestore durante la generación/previa.
 *  - Plena compatibilidad con isValidWorkoutRoutine en firestore.rules.
 */

import { AthleteGoal, TrainingExperience } from '../types/auth';
import {
  EquipmentRequired,
  MuscleGroup,
  MovementPattern,
  PlannedExerciseConfig,
  RoutineDay,
  WorkoutRoutine,
  ExecutedWorkout,
} from '../types/workout';
import { WorkoutSessionRecord } from '../types';
import {
  MesocycleDurationWeeks,
  SplitStructureId,
  SplitStructureDefinition,
  MesocycleWeekPrescription,
  MesocycleConfig,
  MesocycleRoutine,
  MesocycleGenerationInput,
  MesocycleGenerationResult,
} from '../types/mesocycle';
import { EXERCISE_CATALOG, getExerciseById } from '../data/exerciseCatalog';
import { calculateEpley1RM } from '../utils/workoutCalculations';

// ========================================================
// 1. ESTRUCTURAS SEMANALES Y DIVISIONES DE ENTRENAMIENTO
// ========================================================

export const SPLIT_STRUCTURES: SplitStructureDefinition[] = [
  {
    id: 'full_body_2d',
    name: 'Full Body (2 Días)',
    daysPerWeek: 2,
    description: 'Entrenamiento de cuerpo completo espaciado (ej. Martes y Viernes o Lunes y Jueves) con máxima eficiencia de tiempo.',
    suitableExperience: ['principiante', 'intermedio'],
    suitableGoals: ['mantenimiento', 'recomposicion', 'definicion', 'hipertrofia'],
    rationale: 'Para atletas con 2 días disponibles, la frecuencia 2 de cuerpo completo asegura estímulo en los principales patrones de movimiento sin acumular fatiga excesiva en una sola sesión.',
    dayTemplates: [
      {
        dayId: 'd1',
        name: 'Día 1: Full Body A (Enfoque Dominante Empuje & Cuádriceps)',
        shortName: 'Full Body A',
        focusDescription: 'Tensión Mecánica • Sentadilla, Banca y Tracción',
        primaryMuscleGroups: ['cuadriceps', 'pecho', 'espalda'],
        secondaryMuscleGroups: ['hombros', 'biceps', 'core'],
      },
      {
        dayId: 'd2',
        name: 'Día 2: Full Body B (Enfoque Dominante Bisagra & Tirón)',
        shortName: 'Full Body B',
        focusDescription: 'Cadena Posterior & Estabilidad Escapular',
        primaryMuscleGroups: ['isquios', 'gluteos', 'espalda'],
        secondaryMuscleGroups: ['pecho', 'triceps', 'gemelos'],
      },
    ],
  },
  {
    id: 'full_body_3d',
    name: 'Full Body Clásico (3 Días)',
    daysPerWeek: 3,
    description: 'Tres sesiones de cuerpo completo alternando énfasis de patrones (A: Sentadilla/Empuje, B: Bisagra/Tirón, C: Unilateral/Accesorios).',
    suitableExperience: ['principiante', 'intermedio', 'avanzado'],
    suitableGoals: ['fuerza', 'recomposicion', 'hipertrofia', 'definicion', 'mantenimiento'],
    rationale: 'La frecuencia 3 permite distribuir el volumen semanal en dosis óptimas de 3 a 5 series efectivas por sesión por grupo muscular, facilitando mayor calidad en cada repetición y alta tasa de síntesis proteica.',
    dayTemplates: [
      {
        dayId: 'd1',
        name: 'Día 1: Full Body A (Tensión Primaria Sentadilla & Banca)',
        shortName: 'Full Body A',
        focusDescription: 'Empuje Horizontal, Cuádriceps y Tracción Vertical',
        primaryMuscleGroups: ['cuadriceps', 'pecho', 'espalda'],
        secondaryMuscleGroups: ['hombros', 'biceps'],
      },
      {
        dayId: 'd2',
        name: 'Día 2: Full Body B (Tensión Bisagra Cadera & Vertical)',
        shortName: 'Full Body B',
        focusDescription: 'Peso Muerto / RDL, Empuje Vertical y Espalda Media',
        primaryMuscleGroups: ['isquios', 'hombros', 'espalda'],
        secondaryMuscleGroups: ['triceps', 'gluteos', 'core'],
      },
      {
        dayId: 'd3',
        name: 'Día 3: Full Body C (Densidad, Unilateral y Brazos)',
        shortName: 'Full Body C',
        focusDescription: 'Zancadas, Pectoral Inclinado, Remo y Aislamiento',
        primaryMuscleGroups: ['cuadriceps', 'pecho', 'espalda'],
        secondaryMuscleGroups: ['biceps', 'triceps', 'gemelos'],
      },
    ],
  },
  {
    id: 'push_pull_legs_3d',
    name: 'Push / Pull / Legs (3 Días)',
    daysPerWeek: 3,
    description: 'División sinérgica clásica: Día 1 Empuje (pecho/hombro/tríceps), Día 2 Tirón (espalda/bíceps), Día 3 Pierna completa.',
    suitableExperience: ['intermedio', 'avanzado'],
    suitableGoals: ['hipertrofia', 'definicion', 'fuerza'],
    rationale: 'Concentra la fatiga en un mismo plano anatómico por día, permitiendo una recuperación articular completa de 7 días entre sesiones similares.',
    dayTemplates: [
      {
        dayId: 'd1',
        name: 'Día 1: Empuje (Push) • Pecho, Deltoides Anterior/Lateral & Tríceps',
        shortName: 'Empuje (Push)',
        focusDescription: 'Pectoral plano/inclinado, Press militar y extensiones',
        primaryMuscleGroups: ['pecho', 'hombros', 'triceps'],
        secondaryMuscleGroups: ['core'],
      },
      {
        dayId: 'd2',
        name: 'Día 2: Tirón (Pull) • Espalda, Deltoides Posterior & Bíceps',
        shortName: 'Tirón (Pull)',
        focusDescription: 'Remos pesados, Jalón/Dominada y flexiones de codo',
        primaryMuscleGroups: ['espalda', 'biceps'],
        secondaryMuscleGroups: ['hombros'],
      },
      {
        dayId: 'd3',
        name: 'Día 3: Pierna (Legs) • Cuádriceps, Isquiosurales, Glúteos & Gemelos',
        shortName: 'Pierna (Legs)',
        focusDescription: 'Sentadilla, Bisagra de cadera, zancadas y pantorrilla',
        primaryMuscleGroups: ['cuadriceps', 'isquios', 'gluteos'],
        secondaryMuscleGroups: ['gemelos', 'core'],
      },
    ],
  },
  {
    id: 'torso_pierna_fullbody_3d',
    name: 'Torso / Pierna + Full Body (3 Días Híbrido)',
    daysPerWeek: 3,
    description: 'Estructura híbrida moderna: Día 1 Torso Pesado, Día 2 Pierna Pesada, Día 3 Full Body de estímulo metabólico.',
    suitableExperience: ['intermedio', 'avanzado'],
    suitableGoals: ['hipertrofia', 'recomposicion', 'fuerza'],
    rationale: 'Combina la especificidad de una división Torso/Pierna con un tercer día de cuerpo completo para garantizar frecuencia 2 en todos los grupos musculares con solo 3 días en el gimnasio.',
    dayTemplates: [
      {
        dayId: 'd1',
        name: 'Día 1: Torso Superior (Upper Body Focus)',
        shortName: 'Torso Superior',
        focusDescription: 'Pecho, Espalda completa y Hombros',
        primaryMuscleGroups: ['pecho', 'espalda', 'hombros'],
        secondaryMuscleGroups: ['biceps', 'triceps'],
      },
      {
        dayId: 'd2',
        name: 'Día 2: Tren Inferior (Lower Body Focus)',
        shortName: 'Tren Inferior',
        focusDescription: 'Sentadillas, RDL, Prensa y Gemelos',
        primaryMuscleGroups: ['cuadriceps', 'isquios', 'gluteos'],
        secondaryMuscleGroups: ['gemelos', 'core'],
      },
      {
        dayId: 'd3',
        name: 'Día 3: Full Body Estímulo & Accesorios',
        shortName: 'Full Body Híbrido',
        focusDescription: 'Básicos sinérgicos y volumen acumulativo',
        primaryMuscleGroups: ['pecho', 'espalda', 'cuadriceps'],
        secondaryMuscleGroups: ['isquios', 'biceps', 'triceps', 'hombros'],
      },
    ],
  },
  {
    id: 'torso_pierna_4d',
    name: 'Torso / Pierna Periodizado (4 Días)',
    daysPerWeek: 4,
    description: 'El estándar de oro para hipertrofia y fuerza: Torso Fuerza (L), Pierna Fuerza (M), Torso Hipertrofia (J), Pierna Hipertrofia (V).',
    suitableExperience: ['principiante', 'intermedio', 'avanzado'],
    suitableGoals: ['hipertrofia', 'fuerza', 'recomposicion', 'definicion'],
    rationale: 'Distribución balanceada con frecuencia 2 estricta, 72-96 horas de recuperación entre sesiones del mismo plano y reparto óptimo de volumen semanal.',
    dayTemplates: [
      {
        dayId: 'd1',
        name: 'Día 1: Torso Fuerza • Tensión Mecánica',
        shortName: 'Torso Fuerza',
        focusDescription: 'Banca plana, Remo con barra, Press militar y Dominadas',
        primaryMuscleGroups: ['pecho', 'espalda', 'hombros'],
        secondaryMuscleGroups: ['triceps', 'biceps'],
      },
      {
        dayId: 'd2',
        name: 'Día 2: Pierna Fuerza • Cadena Anterior & Posterior',
        shortName: 'Pierna Fuerza',
        focusDescription: 'Sentadilla trasera, RDL, Prensa y Core',
        primaryMuscleGroups: ['cuadriceps', 'isquios', 'gluteos'],
        secondaryMuscleGroups: ['gemelos', 'core'],
      },
      {
        dayId: 'd3',
        name: 'Día 3: Torso Hipertrofia • Volumen & Bombeo',
        shortName: 'Torso Hipertrofia',
        focusDescription: 'Inclinado, Jalón polea, Remos máquina, Laterales y Brazos',
        primaryMuscleGroups: ['pecho', 'espalda', 'hombros'],
        secondaryMuscleGroups: ['biceps', 'triceps'],
      },
      {
        dayId: 'd4',
        name: 'Día 4: Pierna Hipertrofia • Hip Thrust & Aislamiento',
        shortName: 'Pierna Hipertrofia',
        focusDescription: 'Hack squat / Prensa, Hip thrust, Curl femoral y Extensiones',
        primaryMuscleGroups: ['cuadriceps', 'gluteos', 'isquios'],
        secondaryMuscleGroups: ['gemelos', 'core'],
      },
    ],
  },
  {
    id: 'ppl_upper_lower_5d',
    name: 'PPL + Torso / Pierna (5 Días)',
    daysPerWeek: 5,
    description: 'Estructura avanzada de 5 días: Push, Pull, Legs, descanso, Torso, Pierna.',
    suitableExperience: ['intermedio', 'avanzado'],
    suitableGoals: ['hipertrofia', 'fuerza'],
    rationale: 'Permite elevar el volumen semanal a 16-20 series por grupo muscular manteniendo la densidad y la frescura neuromuscular con dos descansos semanales.',
    dayTemplates: [
      {
        dayId: 'd1',
        name: 'Día 1: Empuje (Push A)',
        shortName: 'Push A',
        focusDescription: 'Pectoral pesado, deltoides y tríceps',
        primaryMuscleGroups: ['pecho', 'hombros', 'triceps'],
        secondaryMuscleGroups: [],
      },
      {
        dayId: 'd2',
        name: 'Día 2: Tirón (Pull A)',
        shortName: 'Pull A',
        focusDescription: 'Tracción horizontal pesada, jalones y bíceps',
        primaryMuscleGroups: ['espalda', 'biceps'],
        secondaryMuscleGroups: ['hombros'],
      },
      {
        dayId: 'd3',
        name: 'Día 3: Pierna (Legs A)',
        shortName: 'Legs A',
        focusDescription: 'Enfoque cuádriceps y gemelos',
        primaryMuscleGroups: ['cuadriceps', 'gluteos'],
        secondaryMuscleGroups: ['isquios', 'gemelos'],
      },
      {
        dayId: 'd4',
        name: 'Día 4: Torso Completo (Upper B)',
        shortName: 'Torso B',
        focusDescription: 'Tensión combinada pecho/espalda y deltoides lateral',
        primaryMuscleGroups: ['pecho', 'espalda', 'hombros'],
        secondaryMuscleGroups: ['biceps', 'triceps'],
      },
      {
        dayId: 'd5',
        name: 'Día 5: Pierna Completa (Lower B)',
        shortName: 'Pierna B',
        focusDescription: 'Enfoque cadena posterior (RDL, Hip Thrust, Curl)',
        primaryMuscleGroups: ['isquios', 'gluteos', 'cuadriceps'],
        secondaryMuscleGroups: ['gemelos', 'core'],
      },
    ],
  },
  {
    id: 'push_pull_legs_6d',
    name: 'Push / Pull / Legs Frecuencia 2 (6 Días)',
    daysPerWeek: 6,
    description: 'Doble ciclo PPL semanal (Push A, Pull A, Legs A, Push B, Pull B, Legs B, 1 día descanso).',
    suitableExperience: ['avanzado'],
    suitableGoals: ['hipertrofia'],
    rationale: 'Estructura de alto volumen para atletas experimentados que toleran sesiones frecuentes y priorizan el máximo crecimiento muscular por división de grupos.',
    dayTemplates: [
      {
        dayId: 'd1',
        name: 'Día 1: Push A (Pecho Pesado / Hombro)',
        shortName: 'Push A',
        focusDescription: 'Press de banca, militar y fondos',
        primaryMuscleGroups: ['pecho', 'hombros', 'triceps'],
        secondaryMuscleGroups: [],
      },
      {
        dayId: 'd2',
        name: 'Día 2: Pull A (Espalda Grosor / Bíceps)',
        shortName: 'Pull A',
        focusDescription: 'Remo pendlay, dominadas y curl barra',
        primaryMuscleGroups: ['espalda', 'biceps'],
        secondaryMuscleGroups: ['hombros'],
      },
      {
        dayId: 'd3',
        name: 'Día 3: Legs A (Cuádriceps Dominante)',
        shortName: 'Legs A',
        focusDescription: 'Sentadilla trasera, prensa y extensiones',
        primaryMuscleGroups: ['cuadriceps', 'gluteos'],
        secondaryMuscleGroups: ['gemelos', 'core'],
      },
      {
        dayId: 'd4',
        name: 'Día 4: Push B (Pecho Inclinado / Tríceps)',
        shortName: 'Push B',
        focusDescription: 'Press inclinado, laterales y extensiones polea',
        primaryMuscleGroups: ['pecho', 'hombros', 'triceps'],
        secondaryMuscleGroups: [],
      },
      {
        dayId: 'd5',
        name: 'Día 5: Pull B (Espalda Amplitud / Bíceps)',
        shortName: 'Pull B',
        focusDescription: 'Jalón al pecho, remo unilateral y bayesian curl',
        primaryMuscleGroups: ['espalda', 'biceps'],
        secondaryMuscleGroups: ['hombros'],
      },
      {
        dayId: 'd6',
        name: 'Día 6: Legs B (Cadena Posterior Dominante)',
        shortName: 'Legs B',
        focusDescription: 'RDL, Hip thrust, curl femoral y gemelos',
        primaryMuscleGroups: ['isquios', 'gluteos', 'cuadriceps'],
        secondaryMuscleGroups: ['gemelos', 'core'],
      },
    ],
  },
];

export const getAvailableSplitStructures = (daysPerWeek?: number): SplitStructureDefinition[] => {
  if (!daysPerWeek) return SPLIT_STRUCTURES;
  return SPLIT_STRUCTURES.filter(s => s.daysPerWeek === daysPerWeek);
};

export const recommendSplitStructure = (
  daysPerWeek: number,
  experience: TrainingExperience,
  goal: AthleteGoal
): SplitStructureDefinition => {
  const matches = SPLIT_STRUCTURES.filter(s => s.daysPerWeek === daysPerWeek);
  if (matches.length === 0) {
    // Buscar la más cercana
    if (daysPerWeek <= 2) return SPLIT_STRUCTURES[0]; // full_body_2d
    if (daysPerWeek === 3) return SPLIT_STRUCTURES[1]; // full_body_3d
    if (daysPerWeek === 4) return SPLIT_STRUCTURES[4]; // torso_pierna_4d
    if (daysPerWeek === 5) return SPLIT_STRUCTURES[5]; // ppl_upper_lower_5d
    return SPLIT_STRUCTURES[6]; // push_pull_legs_6d
  }

  // Si hay más de una (ej. 3 días: full body, PPL o híbrido)
  if (matches.length > 1) {
    if (goal === 'hipertrofia' && experience !== 'principiante') {
      const ppl = matches.find(m => m.id === 'push_pull_legs_3d');
      if (ppl) return ppl;
    }
    const hybrid = matches.find(m => m.id === 'torso_pierna_fullbody_3d');
    if (hybrid && experience === 'intermedio') return hybrid;
  }

  return matches[0];
};

// ========================================================
// 2. SELECCIÓN DE EJERCICIOS CON RESOLUCIÓN DE EQUIPAMIENTO
// ========================================================

/**
 * Resuelve un ejercicio compatible con el equipamiento del atleta
 * respetando estrictamente el catálogo real (EXERCISE_CATALOG).
 */
export const selectExerciseWithEquipment = (
  preferredExerciseId: string,
  availableEquipment: EquipmentRequired[]
): { exercise: typeof EXERCISE_CATALOG[0]; wasSubstituted: boolean; originalName?: string } => {
  const original = getExerciseById(preferredExerciseId);
  if (!original) {
    // Si por alguna razón no existe, tomar el primer básico del catálogo
    return { exercise: EXERCISE_CATALOG[0], wasSubstituted: false };
  }

  // Si el equipamiento original está disponible, usarlo directamente
  if (availableEquipment.includes(original.equipment)) {
    return { exercise: original, wasSubstituted: false };
  }

  // 1. Buscar en las variantes declaradas del ejercicio
  if (original.variants && original.variants.length > 0) {
    for (const variantId of original.variants) {
      const variant = getExerciseById(variantId);
      if (variant && availableEquipment.includes(variant.equipment)) {
        return { exercise: variant, wasSubstituted: true, originalName: original.name };
      }
    }
  }

  // 2. Buscar en el catálogo un ejercicio con el mismo patrón biomecánico y grupo muscular
  const samePattern = EXERCISE_CATALOG.find(
    ex =>
      ex.muscleGroup === original.muscleGroup &&
      ex.movementPattern === original.movementPattern &&
      availableEquipment.includes(ex.equipment)
  );
  if (samePattern) {
    return { exercise: samePattern, wasSubstituted: true, originalName: original.name };
  }

  // 3. Buscar cualquier ejercicio del mismo grupo muscular compatible
  const sameMuscle = EXERCISE_CATALOG.find(
    ex => ex.muscleGroup === original.muscleGroup && availableEquipment.includes(ex.equipment)
  );
  if (sameMuscle) {
    return { exercise: sameMuscle, wasSubstituted: true, originalName: original.name };
  }

  // 4. Fallback final seguro: peso corporal o primer ejercicio disponible
  const bodyweightOrAny =
    EXERCISE_CATALOG.find(ex => ex.equipment === 'peso_corporal') ||
    EXERCISE_CATALOG.find(ex => availableEquipment.includes(ex.equipment)) ||
    original;

  return { exercise: bodyweightOrAny, wasSubstituted: true, originalName: original.name };
};

// ========================================================
// 3. PRESCRIPCIÓN DE SERIES, REPETICIONES Y DESCANSO
// ========================================================

export const calculateExercisePrescription = (
  exercise: typeof EXERCISE_CATALOG[0],
  goal: AthleteGoal,
  experience: TrainingExperience,
  orderIndex: number,
  isCompound: boolean,
  targetWeightKg?: number
): {
  sets: number;
  repsMin: number;
  repsMax: number;
  targetRir: number;
  restSeconds: number;
  tempo: string;
  notes: string;
  targetWeightKg: number;
} => {
  let sets = 3;
  let repsMin = 8;
  let repsMax = 12;
  let targetRir = 2;
  let restSeconds = 90;
  let tempo = '2-0-1-0';
  let notes = '';

  // Volumen base por experiencia
  if (experience === 'principiante') {
    sets = isCompound ? 3 : 2;
  } else if (experience === 'intermedio') {
    sets = isCompound ? 4 : 3;
  } else {
    // Avanzado
    sets = isCompound ? 4 : 3;
  }

  // Rangos de reps y descansos por objetivo
  switch (goal) {
    case 'fuerza':
      if (isCompound) {
        repsMin = 4;
        repsMax = 6;
        targetRir = 2;
        restSeconds = 180;
        tempo = '3-1-X-0';
        notes = 'Pausa de 1 s en punto de estiramiento; empuje explosivo sin deformar la técnica.';
      } else {
        repsMin = 6;
        repsMax = 8;
        targetRir = 2;
        restSeconds = 120;
        notes = 'Accesorios de apoyo postural y refuerzo de puntos débiles.';
      }
      break;

    case 'hipertrofia':
      if (isCompound) {
        repsMin = 6;
        repsMax = 8;
        targetRir = 2;
        restSeconds = 120;
        tempo = '2-1-1-0';
        notes = 'Tensión mecánica continua; control excéntrico estricto de 2-3 s.';
      } else {
        repsMin = 10;
        repsMax = 15;
        targetRir = 1;
        restSeconds = 90;
        tempo = '2-0-1-1';
        notes = 'Estiramiento profundo y contracción isométrica de 1 s en acortamiento.';
      }
      break;

    case 'recomposicion':
      if (isCompound) {
        repsMin = 8;
        repsMax = 10;
        targetRir = 2;
        restSeconds = 120;
      } else {
        repsMin = 10;
        repsMax = 12;
        targetRir = 1;
        restSeconds = 90;
      }
      notes = 'Estimular retención de masa muscular magra con densidad moderada.';
      break;

    case 'definicion':
      if (isCompound) {
        repsMin = 8;
        repsMax = 10;
        targetRir = 2;
        restSeconds = 90;
      } else {
        repsMin = 12;
        repsMax = 15;
        targetRir = 1;
        restSeconds = 75;
      }
      notes = 'Mantener la intensidad de carga para proteger el tejido muscular con alta densidad.';
      break;

    case 'mantenimiento':
    default:
      sets = isCompound ? 3 : 2;
      repsMin = 8;
      repsMax = 10;
      targetRir = 2;
      restSeconds = 90;
      notes = 'Volumen de mantenimiento sostenible con mínimo costo de recuperación articular.';
      break;
  }

  // Carga objetivo inicial si no existe historial
  let weight = targetWeightKg && targetWeightKg > 0 ? targetWeightKg : 0;
  if (!weight) {
    if (exercise.equipment === 'barra') weight = 50;
    else if (exercise.equipment === 'mancuerna') weight = 16;
    else if (exercise.equipment === 'maquina') weight = 40;
    else if (exercise.equipment === 'polea') weight = 25;
    else weight = 0; // peso corporal
  }

  return {
    sets,
    repsMin,
    repsMax,
    targetRir,
    restSeconds,
    tempo,
    notes,
    targetWeightKg: weight,
  };
};

/**
 * Estima la duración de una sesión en minutos a partir de series, reps y descansos.
 */
export const estimateSessionDurationMinutes = (exercises: PlannedExerciseConfig[]): number => {
  let totalSeconds = 0;
  exercises.forEach(ex => {
    const avgReps = (ex.repsMin + ex.repsMax) / 2;
    const timePerSetSeconds = avgReps * 4 + ex.restSeconds; // ~4 s por repetición (2s excéntrica + 1s concéntrica + 1s transición)
    totalSeconds += ex.sets * timePerSetSeconds;
  });
  // Añadir 8 minutos de calentamiento articular y aproximación general
  return Math.round(totalSeconds / 60) + 8;
};

// ========================================================
// 4. PERIODIZACIÓN SEMANA A SEMANA (CALIBRACIÓN -> DESCARGA)
// ========================================================

/**
 * Genera la progresión de una semana específica del mesociclo
 */
export const generateWeekPrescription = (
  weekNumber: number,
  totalWeeks: MesocycleDurationWeeks,
  baseDays: RoutineDay[],
  includeDeloadWeek: boolean,
  goal: AthleteGoal
): MesocycleWeekPrescription => {
  const isLastWeek = weekNumber === totalWeeks;
  const isDeload = isLastWeek && includeDeloadWeek;

  let name = `Semana ${weekNumber}`;
  let focus = '';
  let volumeMultiplier = 1.0;
  let intensityRirTarget = 2;
  let loadIncrementStrategy: MesocycleWeekPrescription['loadIncrementStrategy'] = 'baseline';

  if (isDeload) {
    name = `Semana ${weekNumber}: Descarga Activa (Deload Planificado)`;
    focus = 'Reducción del 33% al 40% en series y RIR 4 para disipar fatiga central y articular antes del siguiente bloque.';
    volumeMultiplier = 0.65;
    intensityRirTarget = 4;
    loadIncrementStrategy = 'deload_recovery';
  } else if (weekNumber === 1) {
    name = `Semana 1: Calibración y Tensión Base`;
    focus = 'RIR 3 conservador. Establecer cargas basales de referencia con técnica estricta y rango de movimiento completo.';
    volumeMultiplier = 1.0;
    intensityRirTarget = 3;
    loadIncrementStrategy = 'baseline';
  } else if (weekNumber === 2) {
    name = `Semana 2: Sobrecarga de Repeticiones (Progresión Doble)`;
    focus = 'RIR 2. Mantener la carga de la Semana 1 e intentar alcanzar el rango superior de repeticiones (repsMax).';
    volumeMultiplier = 1.0;
    intensityRirTarget = 2;
    loadIncrementStrategy = 'reps_progression';
  } else if (weekNumber === 3) {
    name = `Semana 3: Sobrecarga de Carga (Micro-carga)`;
    focus = 'RIR 1-2. Aplicar micro-incrementos de peso (+1.25 a +2.5 kg en barras, +2 kg en mancuernas) si se superó repsMax.';
    volumeMultiplier = 1.05;
    intensityRirTarget = 2;
    loadIncrementStrategy = 'micro_load';
  } else {
    name = `Semana ${weekNumber}: Acumulación & Consolidación`;
    focus = 'RIR 1-2. Consolidar el nuevo tonelaje de trabajo efectivo y afianzar la cadencia de ejecución.';
    volumeMultiplier = 1.05;
    intensityRirTarget = 1;
    loadIncrementStrategy = 'micro_load';
  }

  // Adaptar los días de la semana con los ajustes de volumen y RIR
  const weekDays: RoutineDay[] = baseDays.map(day => {
    const updatedExercises: PlannedExerciseConfig[] = day.exercises.map(ex => {
      let weekSets = ex.sets;
      let targetWeight = ex.targetWeightKg || 50;

      if (isDeload) {
        // Reducir series un 33%-40% (mínimo 2 series)
        weekSets = Math.max(2, Math.round(ex.sets * volumeMultiplier));
        // Reducción leve del 10% de peso para garantizar RIR 4
        targetWeight = Math.round(targetWeight * 0.9 * 2) / 2;
      } else if (weekNumber >= 3) {
        // En semana de micro-carga, reflejar sugerencia progresiva
        const exItem = getExerciseById(ex.exerciseId);
        const micro = exItem?.equipment === 'mancuerna' ? 2 : exItem?.equipment === 'barra' ? 2.5 : 2.5;
        targetWeight = Math.round((targetWeight + (weekNumber - 2) * micro) * 2) / 2;
      }

      return {
        ...ex,
        sets: weekSets,
        targetRir: intensityRirTarget,
        targetWeightKg: targetWeight,
        notes: isDeload
          ? `[Descarga]: ${weekSets} series a RIR 4. Enfócate en la fluidez del movimiento sin fatiga.`
          : ex.notes,
      };
    });

    return {
      ...day,
      exercises: updatedExercises,
    };
  });

  return {
    weekNumber,
    name,
    focus,
    isDeload,
    volumeMultiplier,
    intensityRirTarget,
    loadIncrementStrategy,
    days: weekDays,
  };
};

// ========================================================
// 5. MAPEO DE EJERCICIOS CANDIDATOS POR DÍA
// ========================================================

const CANDIDATE_EXERCISES_BY_FOCUS: Record<string, string[]> = {
  // Pecho / Empuje horizontal
  pecho: [
    'barbell_bench_press',
    'incline_dumbbell_press',
    'dumbbell_bench_press',
    'incline_barbell_press',
    'machine_chest_press',
    'weighted_dips',
    'cable_chest_flyes',
    'machine_pec_deck',
  ],
  // Espalda / Tirón
  espalda: [
    'pendlay_barbell_row',
    'lat_pulldown_wide',
    'single_arm_dumbbell_row',
    'cable_seated_row',
    'pull_ups_neutral',
    'chest_supported_tbar_row',
    'close_grip_lat_pulldown',
  ],
  // Hombros / Empuje vertical y laterales
  hombros: [
    'standing_overhead_press',
    'seated_dumbbell_shoulder_press',
    'cable_lateral_raises',
    'dumbbell_lateral_raises',
    'face_pull_cable',
    'rear_delt_reverse_flyes_cable',
  ],
  // Cuádriceps / Sentadilla
  cuadriceps: [
    'barbell_back_squat',
    'hack_squat_machine',
    'leg_press_45',
    'bulgarian_split_squat',
    'front_squat_barbell',
    'leg_extension_machine',
  ],
  // Isquios / Bisagra cadera
  isquios: [
    'romanian_deadlift_barbell',
    'seated_leg_curl_machine',
    'romanian_deadlift_dumbbells',
    'lying_leg_curl_machine',
  ],
  // Glúteos
  gluteos: [
    'barbell_hip_thrust',
    'glute_cable_kickback',
  ],
  // Brazos
  biceps: [
    'ez_bar_bicep_curl',
    'dumbbell_incline_curl',
    'cable_bayesian_curl',
    'hammer_curl_dumbbells',
  ],
  triceps: [
    'triceps_rope_pushdown',
    'overhead_cable_triceps_extension',
    'skull_crushers_ez_bar',
  ],
  // Gemelos
  gemelos: [
    'standing_calf_raise_machine',
    'seated_calf_raise_machine',
  ],
  // Core
  core: [
    'ab_wheel_rollout',
    'hanging_leg_raises',
    'cable_kneeling_crunch',
  ],
  // Cuerpo completo
  cuerpo_completo: [
    'conventional_deadlift_barbell',
    'kettlebell_swing_two_handed',
  ],
};

// ========================================================
// 6. MOTOR PRINCIPAL: GENERACIÓN DE MESOCICLO
// ========================================================

/**
 * Genera un mesociclo completo, validado y periodizado a partir de datos del atleta.
 * CERO escrituras en Firestore — cálculo 100% en memoria.
 */
export const generateMesocyclePlan = (
  input: MesocycleGenerationInput,
  historicalWorkouts: ExecutedWorkout[] = [],
  workoutHistory: WorkoutSessionRecord[] = []
): MesocycleGenerationResult => {
  const warnings: string[] = [];
  const rationale: string[] = [];

  // 1. Resolver división semanal
  let split = input.splitStructure
    ? SPLIT_STRUCTURES.find(s => s.id === input.splitStructure)
    : undefined;

  if (!split) {
    split = recommendSplitStructure(input.daysPerWeek, input.experience, input.athleteGoal);
  }

  rationale.push(`Estructura "${split.name}" seleccionada para ${input.daysPerWeek} días semanales: ${split.rationale}`);
  rationale.push(`Objetivo deportivo "${input.athleteGoal}" aplicado a rangos de repeticiones y cadencias.`);

  // 2. Construir días base con ejercicios resueltos
  let dayCounter = 1;
  const baseDays: RoutineDay[] = split.dayTemplates.map(dayTemplate => {
    const plannedExercises: PlannedExerciseConfig[] = [];
    let orderIndex = 1;

    // Seleccionar candidatos para los grupos musculares primarios
    const targetGroups = [...dayTemplate.primaryMuscleGroups, ...dayTemplate.secondaryMuscleGroups];
    const pickedExerciseIds = new Set<string>();

    for (const group of targetGroups) {
      const candidates = CANDIDATE_EXERCISES_BY_FOCUS[group] || [];
      for (const candidateId of candidates) {
        if (pickedExerciseIds.has(candidateId)) continue;

        // Comprobar equipamiento
        const resolution = selectExerciseWithEquipment(candidateId, input.availableEquipment);
        if (pickedExerciseIds.has(resolution.exercise.id)) continue;

        if (resolution.wasSubstituted && resolution.originalName) {
          warnings.push(
            `"${resolution.originalName}" fue sustituido por "${resolution.exercise.name}" para ajustarse a tu equipamiento disponible.`
          );
        }

        const isCompound =
          resolution.exercise.movementPattern === 'empuje_horizontal' ||
          resolution.exercise.movementPattern === 'traccion_horizontal' ||
          resolution.exercise.movementPattern === 'empuje_vertical' ||
          resolution.exercise.movementPattern === 'traccion_vertical' ||
          resolution.exercise.movementPattern === 'sentadilla' ||
          resolution.exercise.movementPattern === 'bisagra_cadera';

        // Buscar peso histórico si existe
        const historyRecord = workoutHistory.find(h => h.exerciseId === resolution.exercise.id && h.completed);
        const startingWeight = historyRecord ? historyRecord.weightKg : undefined;

        const prescription = calculateExercisePrescription(
          resolution.exercise,
          input.athleteGoal,
          input.experience,
          orderIndex,
          isCompound,
          startingWeight
        );

        plannedExercises.push({
          id: `cfg_m_${dayTemplate.dayId}_ex${orderIndex}_${Math.random().toString(36).substring(2, 6)}`,
          exerciseId: resolution.exercise.id,
          orderIndex,
          sets: prescription.sets,
          repsMin: prescription.repsMin,
          repsMax: prescription.repsMax,
          targetRir: prescription.targetRir,
          targetWeightKg: prescription.targetWeightKg,
          restSeconds: prescription.restSeconds,
          tempo: prescription.tempo,
          notes: prescription.notes,
        });

        pickedExerciseIds.add(resolution.exercise.id);
        orderIndex++;

        // Limitar a máximo 5-6 ejercicios por sesión para no exceder duración
        if (orderIndex > 6) break;
      }
      if (orderIndex > 6) break;
    }

    // Estimar duración de la sesión del día
    const estMinutes = estimateSessionDurationMinutes(plannedExercises);
    if (estMinutes > input.targetSessionDurationMinutes + 15) {
      warnings.push(
        `La sesión "${dayTemplate.shortName}" estima ${estMinutes} min (tu tiempo deseado es ${input.targetSessionDurationMinutes} min). Te sugerimos reducir series o ajustar descansos si dispones de tiempo ajustado.`
      );
    }

    const dayObj: RoutineDay = {
      id: dayTemplate.dayId,
      name: dayTemplate.name,
      shortName: dayTemplate.shortName,
      focusDescription: dayTemplate.focusDescription,
      exercises: plannedExercises,
    };

    dayCounter++;
    return dayObj;
  });

  // 3. Generar periodización semana a semana
  const weeks: MesocycleWeekPrescription[] = [];
  for (let w = 1; w <= input.durationWeeks; w++) {
    const weekPrescription = generateWeekPrescription(
      w,
      input.durationWeeks,
      baseDays,
      input.includeDeloadWeek,
      input.athleteGoal
    );
    weeks.push(weekPrescription);
  }

  if (input.includeDeloadWeek) {
    rationale.push(
      `Semana ${input.durationWeeks} configurada como descarga activa (Deload) para disipar fatiga central acumulada.`
    );
  }

  // 4. Calcular desglose de volumen por grupo muscular
  const muscleVolumeBreakdown: Record<MuscleGroup, number> = {
    pecho: 0,
    espalda: 0,
    cuadriceps: 0,
    isquios: 0,
    gluteos: 0,
    hombros: 0,
    biceps: 0,
    triceps: 0,
    gemelos: 0,
    core: 0,
    cuerpo_completo: 0,
  };

  baseDays.forEach(day => {
    day.exercises.forEach(cfg => {
      const ex = getExerciseById(cfg.exerciseId);
      if (ex) {
        muscleVolumeBreakdown[ex.muscleGroup] = (muscleVolumeBreakdown[ex.muscleGroup] || 0) + cfg.sets;
      }
    });
  });

  // 5. Tiempo semanal total estimado
  const estimatedWeeklyTimeMinutes = baseDays.reduce((acc, day) => acc + estimateSessionDurationMinutes(day.exercises), 0);

  // 6. Mapear objetivo a esquema estricto de isValidWorkoutRoutine en Firestore
  // isValidWorkoutRoutine exige: data.goal in ['hipertrofia', 'fuerza', 'recomposicion', 'resistencia']
  const firestoreGoal: WorkoutRoutine['goal'] =
    input.athleteGoal === 'fuerza'
      ? 'fuerza'
      : input.athleteGoal === 'hipertrofia'
      ? 'hipertrofia'
      : input.athleteGoal === 'definicion'
      ? 'recomposicion'
      : input.athleteGoal === 'mantenimiento'
      ? 'recomposicion'
      : 'recomposicion';

  const routineId = `meso_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const routineName =
    input.name?.trim() ||
    `Mesociclo ${input.athleteGoal.charAt(0).toUpperCase() + input.athleteGoal.slice(1)} • ${split.name} (${input.durationWeeks} Semanas)`;

  const mesocycleConfig: MesocycleConfig = {
    durationWeeks: input.durationWeeks,
    splitStructure: split.id,
    splitStructureName: split.name,
    athleteGoal: input.athleteGoal,
    experience: input.experience,
    targetSessionDurationMinutes: input.targetSessionDurationMinutes,
    availableEquipment: input.availableEquipment,
    musclePriorities: input.musclePriorities,
    hasDeloadWeek: input.includeDeloadWeek,
    deloadWeekIndex: input.includeDeloadWeek ? input.durationWeeks : undefined,
    currentWeek: 1,
    weeks,
    completedSessions: [],
  };

  const program: MesocycleRoutine = {
    id: routineId,
    userId: '', // Se asigna al confirmar y guardar
    name: routineName,
    description: `Programa de entrenamiento estructurado de ${input.durationWeeks} semanas con división ${split.name}. Progresión doble y descarga planificada.`,
    goal: firestoreGoal,
    frequencyDays: input.daysPerWeek,
    days: baseDays,
    isDefault: true,
    isMesocycle: true,
    mesocycleConfig,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    program,
    rationale,
    warnings,
    estimatedWeeklyTimeMinutes,
    muscleVolumeBreakdown,
  };
};

/**
 * Registra una sesión completada en el mesociclo y avanza de semana automáticamente si corresponde.
 * Operación pura en memoria.
 */
export const updateMesocycleWeekProgress = (
  routine: MesocycleRoutine,
  weekNumber: number,
  dayId: string,
  executedWorkoutId?: string
): MesocycleRoutine => {
  const currentCompleted = routine.mesocycleConfig.completedSessions || [];
  const alreadyCompleted = currentCompleted.some(c => c.weekNumber === weekNumber && c.dayId === dayId);

  let updatedCompleted = currentCompleted;
  if (!alreadyCompleted) {
    updatedCompleted = [
      ...currentCompleted,
      {
        weekNumber,
        dayId,
        executedWorkoutId,
        completedAt: new Date().toISOString(),
      },
    ];
  }

  // Comprobar si se completaron todos los días de la semana actual
  const currentWeekObj = routine.mesocycleConfig.weeks.find(w => w.weekNumber === weekNumber);
  const totalDaysInWeek = currentWeekObj ? currentWeekObj.days.length : routine.days.length;
  const completedInThisWeek = updatedCompleted.filter(c => c.weekNumber === weekNumber).length;

  let newCurrentWeek = routine.mesocycleConfig.currentWeek;
  if (completedInThisWeek >= totalDaysInWeek && weekNumber < routine.mesocycleConfig.durationWeeks) {
    newCurrentWeek = weekNumber + 1;
  }

  // Si la semana avanzó, actualizar también los días activos en routine.days
  const activeWeekPrescription = routine.mesocycleConfig.weeks.find(w => w.weekNumber === newCurrentWeek);
  const activeDays = activeWeekPrescription ? activeWeekPrescription.days : routine.days;

  return {
    ...routine,
    days: activeDays,
    mesocycleConfig: {
      ...routine.mesocycleConfig,
      currentWeek: newCurrentWeek,
      completedSessions: updatedCompleted,
    },
    updatedAt: new Date().toISOString(),
  };
};
