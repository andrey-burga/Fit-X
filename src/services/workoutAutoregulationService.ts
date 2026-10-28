/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Workout Autoregulation & Progressive Overload Engine (Increment 6G)
 *
 * Provides:
 *  1. Double progression logic (reps first, then micro-load increments)
 *  2. Equipment-aware increment granularity (barbell 1.25-2.5kg, dumbbell 2kg, machine 2.5-5kg)
 *  3. Respect for target RIR and submaximal fatigue indicators
 *  4. Strict exclusion of warmup sets from work metrics & evidence
 *  5. Multi-session plateau detection (>= 3 consecutive stagnant sessions)
 *  6. Safe, user-confirmed Deload Assistant (side-by-side comparison, zero silent overwrites)
 *  7. 100% in-memory calculations, zero unconfirmed mutations, full multi-tenant & demo isolation
 */

import {
  WorkoutRoutine,
  PlannedExerciseConfig,
  RoutineDay,
  ExecutedWorkout,
  LiveExerciseSession,
  EquipmentRequired,
} from '../types/workout';
import { WorkoutSessionRecord } from '../types';
import { calculateEpley1RM } from '../utils/workoutCalculations';
import { getExerciseById } from '../data/exerciseCatalog';
import { getLocalDateString } from './dateUtils';
import { extractExportSets, ExportSetRecord } from './workoutExportService';
import { canonicalizeExercise } from './workoutAnalyticsService';

export type RecommendationAction =
  | 'increase_load'
  | 'increase_reps'
  | 'maintain'
  | 'reduce_or_review'
  | 'insufficient_data'
  | 'manual_review';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type PlateauStatus =
  | 'progressing'
  | 'stable'
  | 'possible_plateau'
  | 'insufficient_data'
  | 'not_comparable';

export interface HistoricalSetEvidence {
  date: string;
  workoutId: string;
  setNumber: number;
  weightKg: number;
  reps: number;
  rir: number | null;
  isWarmup: boolean;
  estimated1RM: number;
}

export interface HistoricalSessionEvidence {
  date: string;
  workoutId: string;
  workoutStatus: 'completed' | 'abandoned' | 'in_progress';
  routineName: string;
  effectiveSets: HistoricalSetEvidence[];
  effectiveSetsCount: number;
  bestWeightKg: number;
  bestReps: number;
  averageReps: number;
  averageRir: number | null;
  allSetsMetMaxReps: boolean;
  anySetFailedMinReps: boolean;
  totalEffectiveTonnage: number;
}

export interface ExerciseRecommendation {
  configId: string;
  exerciseId: string;
  canonicalId: string;
  exerciseName: string;
  equipment: EquipmentRequired;
  currentPrescription: {
    sets: number;
    repsMin: number;
    repsMax: number;
    targetRir?: number;
    targetWeightKg?: number;
    restSeconds: number;
  };
  lastPerformance: {
    date: string;
    weightKg: number;
    reps: number;
    rir: number | null;
    completedSets: number;
    averageRir: number | null;
    allSetsMetMaxReps: boolean;
    allSetsMetMinReps: boolean;
  } | null;
  suggestedWeightKg: number;
  suggestedRepsMin: number;
  suggestedRepsMax: number;
  action: RecommendationAction;
  actionBadge: {
    label: string;
    colorClass: string;
    icon: string;
  };
  confidence: ConfidenceLevel;
  confidenceReason: string;
  reason: string;
  historicalEvidence: HistoricalSessionEvidence[];
  limitations: string[];
  plateauStatus: PlateauStatus;
  plateauReason: string;
  plateauActionSuggestions: string[];
}

export interface DeloadOptions {
  volumeReductionPct: number; // e.g. 50 (4 sets -> 2 sets)
  rirIncrease: number;         // e.g. +2 (RIR 1 -> RIR 3)
  reduceLoadPct: number;       // e.g. 0 (keep weight) or 10
}

export interface DeloadComparisonSummary {
  originalTotalSets: number;
  deloadTotalSets: number;
  setsSaved: number;
  setsReductionPct: number;
  originalAverageTargetRir: number;
  deloadAverageTargetRir: number;
  estimatedTimeSavedMinutes: number;
}

export interface DeloadProposal {
  sourceRoutineId: string;
  sourceRoutineName: string;
  deloadRoutineName: string;
  options: DeloadOptions;
  comparisonSummary: DeloadComparisonSummary;
  days: RoutineDay[];
  rationale: string;
}

/**
 * Equipment-aware micro-increment granularity.
 * Returns the safest, practical load increment (kg) for a given equipment and baseline load.
 */
export function getEquipmentIncrement(
  equipment: EquipmentRequired,
  currentWeightKg: number,
  isLowerBody: boolean = false
): number {
  switch (equipment) {
    case 'barra':
      // Barbell: lower body (squat/deadlift) usually supports +2.5 kg.
      // Upper body (bench/ohp) supports +1.25 kg to +2.5 kg.
      if (isLowerBody && currentWeightKg >= 100) return 2.5;
      if (currentWeightKg >= 80) return 2.5;
      return 1.25;

    case 'mancuerna':
      // Dumbbells in commercial gyms typically progress in steps of 2.0 kg.
      return 2.0;

    case 'polea':
    case 'maquina':
      // Weight stacks usually jump by 2.5 kg or 5.0 kg.
      if (currentWeightKg >= 60) return 5.0;
      return 2.5;

    case 'kettlebell':
      // Kettlebells typically jump by 2.0 or 4.0 kg.
      return 2.0;

    case 'peso_corporal':
      // Weighted dips / pullups: micro-increment with belt plate.
      return 1.25;

    default:
      return 1.25;
  }
}

/**
 * Extracts and groups comparable historical sessions for a given exercise.
 * Filters out warmup sets and ensures sessions are chronologically ordered.
 */
export function extractComparableSessions(
  targetExerciseId: string,
  executedWorkouts: ExecutedWorkout[],
  fallbackHistory: WorkoutSessionRecord[] = []
): HistoricalSessionEvidence[] {
  const { canonicalId } = canonicalizeExercise(targetExerciseId, '');
  const allSets = extractExportSets(executedWorkouts, fallbackHistory);

  // Filter sets for this canonical exercise, strictly excluding warmups and incomplete sets
  const relevantSets = allSets.filter(s => {
    if (s.isWarmup || s.setType === 'warmup') return false;
    if (!s.completed || s.weightKg <= 0 || s.reps <= 0) return false;
    const itemCanon = canonicalizeExercise(s.exerciseId, s.exerciseName);
    return itemCanon.canonicalId === canonicalId;
  });

  // Group by workoutId or by date
  const sessionsMap = new Map<string, ExportSetRecord[]>();
  relevantSets.forEach(s => {
    const key = s.workoutId !== 'legacy_standalone' ? s.workoutId : `${s.exerciseId}_${s.workoutStartedAt}`;
    if (!sessionsMap.has(key)) {
      sessionsMap.set(key, []);
    }
    sessionsMap.get(key)!.push(s);
  });

  const sessionList: HistoricalSessionEvidence[] = [];

  sessionsMap.forEach((setsInSession, wId) => {
    const first = setsInSession[0];
    const dateStr = getLocalDateString(first.completedAt || first.workoutStartedAt);

    const effectiveSets: HistoricalSetEvidence[] = setsInSession.map(s => ({
      date: dateStr,
      workoutId: s.workoutId,
      setNumber: s.setNumber,
      weightKg: s.weightKg,
      reps: s.reps,
      rir: s.rir,
      isWarmup: false,
      estimated1RM: s.estimated1RM || calculateEpley1RM(s.weightKg, s.reps).value,
    }));

    const weights = effectiveSets.map(s => s.weightKg);
    const repsList = effectiveSets.map(s => s.reps);
    const rirs = effectiveSets.filter(s => s.rir !== null && s.rir !== undefined).map(s => s.rir!);

    const bestWeightKg = Math.max(...weights);
    const bestReps = Math.max(...repsList);
    const averageReps = Math.round((repsList.reduce((a, b) => a + b, 0) / repsList.length) * 10) / 10;
    const averageRir = rirs.length > 0 ? Math.round((rirs.reduce((a, b) => a + b, 0) / rirs.length) * 10) / 10 : null;
    const totalEffectiveTonnage = effectiveSets.reduce((sum, s) => sum + Math.round(s.weightKg * s.reps), 0);

    sessionList.push({
      date: dateStr,
      workoutId: wId,
      workoutStatus: first.workoutStatus,
      routineName: first.routineName,
      effectiveSets,
      effectiveSetsCount: effectiveSets.length,
      bestWeightKg,
      bestReps,
      averageReps,
      averageRir,
      allSetsMetMaxReps: false, // Calculated relative to prescription later
      anySetFailedMinReps: false,
      totalEffectiveTonnage,
    });
  });

  // Sort chronologically ascending (oldest to newest)
  sessionList.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return sessionList;
}

/**
 * Detects whether an exercise is in a plateau state based on >= 3 consecutive completed exposures.
 */
export function detectExercisePlateau(
  sessions: HistoricalSessionEvidence[],
  repsMax: number
): { status: PlateauStatus; reason: string; actionSuggestions: string[] } {
  // Filter for completed sessions only (abandoned sessions do not establish or break plateaus)
  const completedSessions = sessions.filter(s => s.workoutStatus === 'completed' && s.effectiveSetsCount >= 2);

  if (completedSessions.length < 3) {
    return {
      status: 'insufficient_data',
      reason: `Historial de exposiciones insuficiente (${completedSessions.length}/3 sesiones completadas comparables).`,
      actionSuggestions: ['Continúa registrando sesiones completadas para que el algoritmo pueda evaluar la tendencia.'],
    };
  }

  // Take the last 3 completed sessions
  const last3 = completedSessions.slice(-3);
  const [s1, s2, s3] = last3;

  // Check if there was progress in weight, reps, or estimated 1RM
  const weightProgress = s3.bestWeightKg > s1.bestWeightKg;
  const repsProgress = s3.bestReps > s1.bestReps || s3.averageReps > s1.averageReps;
  const best1RM1 = Math.max(...s1.effectiveSets.map(s => s.estimated1RM));
  const best1RM3 = Math.max(...s3.effectiveSets.map(s => s.estimated1RM));
  const epleyProgress = best1RM3 > best1RM1 * 1.015; // At least +1.5% 1RM increase

  if (weightProgress || repsProgress || epleyProgress) {
    return {
      status: 'progressing',
      reason: 'Sobrecarga progresiva activa observada entre las últimas 3 sesiones (aumento en carga, repeticiones o 1RM estimado).',
      actionSuggestions: ['Mantén la progresión actual. La adaptación neuromuscular es favorable.'],
    };
  }

  // If the athlete has reached repsMax, they are ready to load, NOT stuck in a plateau!
  if (s3.bestReps >= repsMax && s3.averageReps >= repsMax - 1) {
    return {
      status: 'stable',
      reason: `Rendimiento óptimo consolidado al límite superior (${repsMax} reps). Preparado para progresión de carga.`,
      actionSuggestions: ['Aplica el incremento sugerido de carga para comenzar un nuevo ciclo de progresión doble.'],
    };
  }

  // If weight and reps have remained flat or slightly declined across >= 3 sessions below repsMax
  const isIdenticalPerformance =
    s1.bestWeightKg === s2.bestWeightKg &&
    s2.bestWeightKg === s3.bestWeightKg &&
    s1.bestReps === s2.bestReps &&
    s2.bestReps === s3.bestReps;

  const isDecliningPerformance =
    s3.bestWeightKg <= s1.bestWeightKg && s3.averageReps < s1.averageReps;

  if (isIdenticalPerformance || isDecliningPerformance) {
    return {
      status: 'possible_plateau',
      reason: `Estancamiento potencial detectado: 3 sesiones consecutivas con la misma carga (${s3.bestWeightKg} kg) y repeticiones (${s3.bestReps} reps) sin alcanzar el rango superior de ${repsMax} reps.`,
      actionSuggestions: [
        'Revisar la técnica de ejecución y asegurar control del tempo excéntrico (2-3s).',
        'Verificar el descanso entre series: asegurar al menos 120-180 segundos en levantamientos compuestos.',
        'Evaluar el volumen semanal del grupo muscular para verificar si hay fatiga local acumulada.',
        'Considerar una semana de descarga planificada (Deload) o sustituir el ejercicio por una variante biomecánica del catálogo.',
      ],
    };
  }

  return {
    status: 'stable',
    reason: 'Rendimiento estable dentro de las fluctuaciones normales de entrenamiento. Sin indicios de estancamiento.',
    actionSuggestions: ['Continúa trabajando dentro del rango prescrito.'],
  };
}

/**
 * Core Double Progression & Autoregulation Recommendation Generator.
 */
export function generateExerciseRecommendation(
  config: PlannedExerciseConfig,
  executedWorkouts: ExecutedWorkout[],
  fallbackHistory: WorkoutSessionRecord[] = []
): ExerciseRecommendation {
  const exercise = getExerciseById(config.exerciseId);
  const exerciseName = exercise?.name || config.exerciseId;
  const equipment = exercise?.equipment || 'barra';
  const isLowerBody = exercise?.muscleGroup === 'cuadriceps' || exercise?.muscleGroup === 'isquios' || exercise?.muscleGroup === 'gluteos';
  const { canonicalId } = canonicalizeExercise(config.exerciseId, exerciseName);

  const baselineWeight = config.targetWeightKg && config.targetWeightKg > 0
    ? config.targetWeightKg
    : 60.0;

  const currentPrescription = {
    sets: config.sets,
    repsMin: config.repsMin,
    repsMax: config.repsMax,
    targetRir: config.targetRir ?? 2,
    targetWeightKg: config.targetWeightKg,
    restSeconds: config.restSeconds,
  };

  const comparableSessions = extractComparableSessions(config.exerciseId, executedWorkouts, fallbackHistory);
  const completedSessions = comparableSessions.filter(s => s.workoutStatus === 'completed');

  const limitations: string[] = [];

  // Plateau analysis
  const plateau = detectExercisePlateau(comparableSessions, config.repsMax);

  // Case 1: Insufficient Data
  if (completedSessions.length === 0) {
    limitations.push('Sin sesiones completadas previas en el historial para este ejercicio.');
    return {
      configId: config.id,
      exerciseId: config.exerciseId,
      canonicalId,
      exerciseName,
      equipment,
      currentPrescription,
      lastPerformance: null,
      suggestedWeightKg: baselineWeight,
      suggestedRepsMin: config.repsMin,
      suggestedRepsMax: config.repsMax,
      action: 'insufficient_data',
      actionBadge: {
        label: 'Sin Historial Previo',
        colorClass: 'bg-surface-container-high text-on-surface-variant',
        icon: 'help_outline',
      },
      confidence: 'low',
      confidenceReason: 'No hay registros históricos de este ejercicio para emitir una recomendación algorítmica.',
      reason: `No hay sesiones previas registradas para ${exerciseName}. Inicia con la prescripción base de ${config.sets} series de ${config.repsMin}-${config.repsMax} reps para establecer tu línea base.`,
      historicalEvidence: [],
      limitations,
      plateauStatus: 'insufficient_data',
      plateauReason: plateau.reason,
      plateauActionSuggestions: plateau.actionSuggestions,
    };
  }

  // Latest comparable completed session
  const lastSession = completedSessions[completedSessions.length - 1];
  const lastSets = lastSession.effectiveSets;
  const lastWeight = lastSession.bestWeightKg;
  const lastAvgRir = lastSession.averageRir;

  if (lastAvgRir === null) {
    limitations.push('RIR no registrado en la última sesión; recomendación basada exclusivamente en repeticiones y carga.');
  }

  // Assess performance against prescription
  const allSetsMetMaxReps = lastSets.every(s => s.reps >= config.repsMax);
  const allSetsMetMinReps = lastSets.every(s => s.reps >= config.repsMin);
  const anySetFailedMinReps = lastSets.some(s => s.reps < config.repsMin);

  lastSession.allSetsMetMaxReps = allSetsMetMaxReps;
  lastSession.anySetFailedMinReps = anySetFailedMinReps;

  const lastPerformance = {
    date: lastSession.date,
    weightKg: lastWeight,
    reps: lastSession.bestReps,
    rir: lastAvgRir,
    completedSets: lastSession.effectiveSetsCount,
    averageRir: lastAvgRir,
    allSetsMetMaxReps,
    allSetsMetMinReps,
  };

  const increment = getEquipmentIncrement(equipment, lastWeight, isLowerBody);

  // -------------------------------------------------------------
  // RULE 1: Double Progression - Load Increase Triggered
  // Condition: All completed effective sets reached or exceeded repsMax
  // and RIR was adequate (RIR >= 1, not grinding to failure).
  // -------------------------------------------------------------
  if (allSetsMetMaxReps && (lastAvgRir === null || lastAvgRir >= 1)) {
    const suggestedWeightKg = Math.round((lastWeight + increment) * 10) / 10;
    const confidence: ConfidenceLevel = completedSessions.length >= 2 && lastAvgRir !== null ? 'high' : 'medium';

    return {
      configId: config.id,
      exerciseId: config.exerciseId,
      canonicalId,
      exerciseName,
      equipment,
      currentPrescription,
      lastPerformance,
      suggestedWeightKg,
      suggestedRepsMin: config.repsMin,
      suggestedRepsMax: config.repsMax,
      action: 'increase_load',
      actionBadge: {
        label: `Micro-Carga (+${increment} kg)`,
        colorClass: 'bg-primary-fixed text-on-primary-fixed font-bold',
        icon: 'arrow_upward',
      },
      confidence,
      confidenceReason: confidence === 'high'
        ? `Consistencia confirmada: ${completedSessions.length} sesiones completadas con RIR promedio de ${lastAvgRir}.`
        : 'Recomendación basada en superación del rango superior de repeticiones.',
      reason: `Completaste con éxito todas las series (${lastSets.length}) en el límite superior de ${config.repsMax} repeticiones con ${lastWeight} kg. Corresponde aplicar un incremento de carga de +${increment} kg y reiniciar el ciclo en ${config.repsMin} reps.`,
      historicalEvidence: comparableSessions.slice(-4),
      limitations,
      plateauStatus: plateau.status,
      plateauReason: plateau.reason,
      plateauActionSuggestions: plateau.actionSuggestions,
    };
  }

  // -------------------------------------------------------------
  // RULE 2: Double Progression - Consolidate Reps with Current Weight
  // Condition: Met min reps, but not all sets reached repsMax yet.
  // -------------------------------------------------------------
  if (allSetsMetMinReps && !allSetsMetMaxReps) {
    const confidence: ConfidenceLevel = 'high';
    return {
      configId: config.id,
      exerciseId: config.exerciseId,
      canonicalId,
      exerciseName,
      equipment,
      currentPrescription,
      lastPerformance,
      suggestedWeightKg: lastWeight,
      suggestedRepsMin: config.repsMin,
      suggestedRepsMax: config.repsMax,
      action: 'increase_reps',
      actionBadge: {
        label: 'Aumentar Repeticiones',
        colorClass: 'bg-secondary-fixed text-on-secondary-fixed font-semibold',
        icon: 'trending_up',
      },
      confidence,
      confidenceReason: 'Rendimiento sólido dentro del rango prescrito. Datos consistentes.',
      reason: `Tu rendimiento (${lastSession.bestReps} reps con ${lastWeight} kg) se encuentra dentro del rango objetivo (${config.repsMin}-${config.repsMax} reps). Prioriza sumar repeticiones en todas las series antes de incrementar el peso.`,
      historicalEvidence: comparableSessions.slice(-4),
      limitations,
      plateauStatus: plateau.status,
      plateauReason: plateau.reason,
      plateauActionSuggestions: plateau.actionSuggestions,
    };
  }

  // -------------------------------------------------------------
  // RULE 3: Performance Drop or Excessive Fatigue
  // Condition: Failed to reach repsMin in one or more sets.
  // -------------------------------------------------------------
  if (anySetFailedMinReps) {
    // If athlete failed reps, suggest maintaining or checking form/recovery
    const action: RecommendationAction = plateau.status === 'possible_plateau' ? 'reduce_or_review' : 'maintain';
    return {
      configId: config.id,
      exerciseId: config.exerciseId,
      canonicalId,
      exerciseName,
      equipment,
      currentPrescription,
      lastPerformance,
      suggestedWeightKg: lastWeight,
      suggestedRepsMin: config.repsMin,
      suggestedRepsMax: config.repsMax,
      action,
      actionBadge: {
        label: action === 'reduce_or_review' ? 'Revisar / Moderar' : 'Mantener Carga',
        colorClass: 'bg-amber-100 text-amber-900 font-semibold',
        icon: action === 'reduce_or_review' ? 'warning' : 'pause',
      },
      confidence: 'medium',
      confidenceReason: 'Una o más series no alcanzaron el rango inferior prescrito.',
      reason: `En la última sesión algunas series no alcanzaron el mínimo de ${config.repsMin} repeticiones. Mantén los ${lastWeight} kg y asegura descansos completos (${config.restSeconds} s) antes de considerar cambios.`,
      historicalEvidence: comparableSessions.slice(-4),
      limitations,
      plateauStatus: plateau.status,
      plateauReason: plateau.reason,
      plateauActionSuggestions: plateau.actionSuggestions,
    };
  }

  // -------------------------------------------------------------
  // DEFAULT: Maintain Current Prescription
  // -------------------------------------------------------------
  return {
    configId: config.id,
    exerciseId: config.exerciseId,
    canonicalId,
    exerciseName,
    equipment,
    currentPrescription,
    lastPerformance,
    suggestedWeightKg: lastWeight,
    suggestedRepsMin: config.repsMin,
    suggestedRepsMax: config.repsMax,
    action: 'maintain',
    actionBadge: {
      label: 'Mantener Prescripción',
      colorClass: 'bg-surface-container-high text-on-surface font-semibold',
      icon: 'check',
    },
    confidence: 'medium',
    confidenceReason: 'El rendimiento actual coincide con el rango prescrito.',
    reason: `Rendimiento estable con ${lastWeight} kg. Continúa ejecutando con la carga y repeticiones prescritas.`,
    historicalEvidence: comparableSessions.slice(-4),
    limitations,
    plateauStatus: plateau.status,
    plateauReason: plateau.reason,
    plateauActionSuggestions: plateau.actionSuggestions,
  };
}

/**
 * Generates recommendations for an entire RoutineDay.
 */
export function generateDayRecommendations(
  day: RoutineDay,
  executedWorkouts: ExecutedWorkout[],
  fallbackHistory: WorkoutSessionRecord[] = []
): ExerciseRecommendation[] {
  return day.exercises.map(cfg =>
    generateExerciseRecommendation(cfg, executedWorkouts, fallbackHistory)
  );
}

/**
 * Deload Assistant: Generates a periodized deload proposal from an existing WorkoutRoutine.
 * Does NOT overwrite or mutate the original routine.
 */
export function generateDeloadProposal(
  routine: WorkoutRoutine,
  userOptions: Partial<DeloadOptions> = {}
): DeloadProposal {
  const options: DeloadOptions = {
    volumeReductionPct: userOptions.volumeReductionPct ?? 50,
    rirIncrease: userOptions.rirIncrease ?? 2,
    reduceLoadPct: userOptions.reduceLoadPct ?? 0,
  };

  let originalTotalSets = 0;
  let deloadTotalSets = 0;
  let originalTargetRirSum = 0;
  let deloadTargetRirSum = 0;
  let totalExercises = 0;

  const deloadDays: RoutineDay[] = routine.days.map(day => {
    if (day.isRestDay) return { ...day };

    const deloadExercises: PlannedExerciseConfig[] = day.exercises.map(cfg => {
      originalTotalSets += cfg.sets;
      totalExercises++;

      // Compute reduced sets: e.g. 50% reduction
      // 4 sets -> 2 sets; 3 sets -> 2 sets; 2 sets -> 1 set (minimum 1 set)
      const reducedSets = Math.max(1, Math.round(cfg.sets * (1 - options.volumeReductionPct / 100)));
      deloadTotalSets += reducedSets;

      const baseRir = cfg.targetRir ?? 2;
      originalTargetRirSum += baseRir;
      const newTargetRir = Math.min(4, baseRir + options.rirIncrease);
      deloadTargetRirSum += newTargetRir;

      // Optional load adjustment
      let newWeight = cfg.targetWeightKg;
      if (cfg.targetWeightKg && options.reduceLoadPct > 0) {
        newWeight = Math.round((cfg.targetWeightKg * (1 - options.reduceLoadPct / 100)) * 10) / 10;
      }

      return {
        ...cfg,
        sets: reducedSets,
        targetRir: newTargetRir,
        targetWeightKg: newWeight,
        notes: `[Semana de Descarga] Volumen reducido al ${options.volumeReductionPct}%. Mantener RIR ${newTargetRir} sin rozar el fallo muscular.`,
      };
    });

    return {
      ...day,
      name: `${day.name} (Descarga)`,
      focusDescription: 'Descarga Activa y Disipación de Fatiga',
      exercises: deloadExercises,
    };
  });

  const setsSaved = originalTotalSets - deloadTotalSets;
  const setsReductionPct = originalTotalSets > 0 ? Math.round((setsSaved / originalTotalSets) * 100) : 0;
  const originalAverageTargetRir = totalExercises > 0 ? Math.round((originalTargetRirSum / totalExercises) * 10) / 10 : 2;
  const deloadAverageTargetRir = totalExercises > 0 ? Math.round((deloadTargetRirSum / totalExercises) * 10) / 10 : 4;
  const estimatedTimeSavedMinutes = Math.round(setsSaved * 3.5); // ~3.5 min per set + rest saved

  const deloadRoutineName = `[Descarga] ${routine.name}`;
  const rationale = `Microciclo de descarga activa y resensibilización neural. Reduce el volumen en un ${setsReductionPct}% (${setsSaved} series menos en la semana) y aumenta el RIR a ${deloadAverageTargetRir} para disipar fatiga articular y neuromuscular conservando los patrones motores.`;

  return {
    sourceRoutineId: routine.id,
    sourceRoutineName: routine.name,
    deloadRoutineName,
    options,
    comparisonSummary: {
      originalTotalSets,
      deloadTotalSets,
      setsSaved,
      setsReductionPct,
      originalAverageTargetRir,
      deloadAverageTargetRir,
      estimatedTimeSavedMinutes,
    },
    days: deloadDays,
    rationale,
  };
}
