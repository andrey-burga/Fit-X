/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Advanced Workload Analytics, Strength Progression & Recovery Monitoring (Increment 6F)
 * Pure, tested TypeScript service providing:
 *  - Workload aggregation & weekly buckets (effective tonnage, sets, reps, frequency)
 *  - Strict exclusion of warmup sets from tonnage and PR metrics
 *  - Scientifically sound Acute:Chronic Workload Ratio (ACWR 7d / 28d baseline = 35d window)
 *  - Data sufficiency validation & non-alarmist indirect recovery indicators
 *  - Exercise strength progression & estimated 1RM (Epley formula)
 *  - Zero external API transmission, 100% read-only in-memory calculations
 */

import { ExecutedWorkout, LiveExerciseSession, LiveWorkoutSet, MuscleGroup } from '../types/workout';
import { WorkoutSessionRecord } from '../types';
import { calculateEpley1RM, calculateSessionTonnage } from '../utils/workoutCalculations';
import { getLocalDateString, getTodayLocalDateString } from './dateUtils';
import { extractExportSets, ExportSetRecord } from './workoutExportService';

export type AnalyticsPeriodOption = '4w' | '12w' | '24w' | 'all' | 'custom';

export interface AnalyticsFilterOptions {
  period: AnalyticsPeriodOption;
  customStartDate?: string; // 'YYYY-MM-DD'
  customEndDate?: string;   // 'YYYY-MM-DD'
  muscleGroup?: MuscleGroup | 'all';
  exerciseId?: string | 'all';
}

export interface WeeklyWorkloadBucket {
  weekIndex: number;          // 1, 2, 3...
  weekStart: string;          // YYYY-MM-DD
  weekEnd: string;            // YYYY-MM-DD
  label: string;              // e.g. "Sem 1 (14 Oct - 20 Oct)"
  completedSessions: number;
  abandonedSessions: number;
  totalSessions: number;
  effectiveTonnageKg: number; // Warmups strictly excluded
  effectiveSets: number;
  warmupSets: number;
  totalReps: number;
  frequencyDays: number;      // Distinct dates trained
  averageRir: number | null;
  sessionRpeAvg: number | null;
  internalLoadScore: number | null; // Sum(sRPE * durationMinutes)
  workDensityKgPerMin: number | null;
}

export type AcwrStatus =
  | 'optimal_progression'
  | 'elevated_load'
  | 'high_spike'
  | 'deload_or_reduced'
  | 'rest_period'
  | 'insufficient_data';

export interface AcwrResult {
  isCalculable: boolean;
  insufficiencyReason?: string;
  requiredDays: number;       // 35 days (7 acute + 28 chronic)
  availableHistoryDays: number;
  // Acute Window (last 7 full days up to reference date)
  acuteWindowDays: number;    // 7
  acuteStartDate: string;     // YYYY-MM-DD
  acuteEndDate: string;       // YYYY-MM-DD
  acuteTonnageKg: number;
  acuteInternalLoad: number | null;
  acuteSessionsCount: number;
  acuteEffectiveSets: number;
  // Chronic Baseline Window (4 weeks = 28 days preceding the acute window)
  chronicWindowDays: number;  // 28
  chronicStartDate: string;   // YYYY-MM-DD
  chronicEndDate: string;     // YYYY-MM-DD
  chronicTotalTonnageKg: number;
  chronicWeeklyBaselineTonnageKg: number; // chronicTotalTonnageKg / 4
  chronicTotalInternalLoad: number | null;
  chronicWeeklyBaselineInternalLoad: number | null;
  chronicSessionsCount: number;
  // Computed Ratios
  acwrTonnageRatio: number | null; // acuteTonnageKg / chronicWeeklyBaselineTonnageKg
  acwrInternalRatio: number | null; // acuteInternalLoad / chronicWeeklyBaselineInternalLoad
  // Responsible Categorization & Feedback
  status: AcwrStatus;
  statusLabel: string;
  statusBadgeColor: string;
  feedbackMessage: string;
  methodologyNote: string;
}

export interface ExerciseProgressionPoint {
  date: string;               // YYYY-MM-DD
  workoutId: string;
  workoutStatus: 'completed' | 'abandoned' | 'in_progress';
  routineName: string;
  bestWeightKg: number;
  bestReps: number;
  bestRir: number | null;
  estimated1RM: number;       // Epley formula
  totalSetsInSession: number;
  totalExerciseTonnageKg: number;
}

export interface ExerciseProgressionSummary {
  exerciseId: string;
  canonicalId: string;
  exerciseName: string;
  muscleGroup: string;
  totalSessions: number;
  historyPoints: ExerciseProgressionPoint[]; // Chronological
  allTimeBest1RM: number;
  allTimeBestWeightKg: number;
  allTimeBestReps: number;
  allTimeBestRir: number | null;
  allTimeBestDate: string;
  periodBest1RM?: number;
  firstRecorded1RM?: number;
  net1RMChangeKg?: number;
  net1RMChangePct?: number;
  hasReliableTrend: boolean; // >= 3 distinct dates with records
}

export interface IndirectRecoveryIndicators {
  averageEffectiveRir: number | null;
  averageSessionRpe: number | null;
  sessionDensityKgPerMin: number | null;
  highIntensitySetsCount: number; // RIR <= 2
  highIntensityPercentage: number;
  trainingFrequencyPerWeek: number;
  workloadTrend: 'increasing' | 'stable' | 'decreasing' | 'insufficient';
  disclaimerText: string;
}

export interface PrimaryLiftItem {
  id: string;
  name: string;
  category: string;
  canonicalId: string;
  summary?: ExerciseProgressionSummary;
}

export interface ConsolidatedAnalytics {
  filter: AnalyticsFilterOptions;
  totalSessionsCount: number;
  completedSessionsCount: number;
  abandonedSessionsCount: number;
  totalEffectiveTonnageKg: number;
  totalEffectiveSets: number;
  totalWarmupSets: number;
  totalReps: number;
  totalDurationSeconds: number;
  averageDurationMinutes: number;
  weeklyBuckets: WeeklyWorkloadBucket[];
  acwr: AcwrResult;
  exerciseProgressions: Record<string, ExerciseProgressionSummary>;
  recoveryIndicators: IndirectRecoveryIndicators;
  primaryLifts: PrimaryLiftItem[];
  periodComparison?: {
    currentTonnage: number;
    previousTonnage: number;
    tonnageDeltaKg: number;
    tonnageDeltaPct: number;
    currentSessions: number;
    previousSessions: number;
    sessionsDelta: number;
  };
}

// Canonical exercise definitions for primary compound lifts
export const PRIMARY_COMPOUND_LIFTS = [
  {
    id: 'banca',
    canonicalId: 'barbell_bench_press',
    name: 'Press de Banca Plano',
    category: 'Pecho / Empuje Horizontal',
    aliases: ['bench_press', 'banca', 'press de banca', 'barbell_bench_press', 'dumbbell_bench_press'],
  },
  {
    id: 'sentadilla',
    canonicalId: 'barbell_back_squat',
    name: 'Sentadilla Trasera con Barra',
    category: 'Pierna / Rodilla',
    aliases: ['squat', 'sentadilla', 'barbell_back_squat', 'back_squat', 'front_squat_barbell'],
  },
  {
    id: 'peso_muerto',
    canonicalId: 'conventional_deadlift_barbell',
    name: 'Peso Muerto Convencional',
    category: 'Cadena Posterior / Bisagra',
    aliases: ['deadlift', 'peso muerto', 'conventional_deadlift_barbell', 'romanian_deadlift_barbell', 'rdl'],
  },
  {
    id: 'militar',
    canonicalId: 'standing_overhead_press',
    name: 'Press Militar de Pie (OHP)',
    category: 'Hombros / Empuje Vertical',
    aliases: ['overhead_press', 'militar', 'ohp', 'standing_overhead_press', 'press militar'],
  },
  {
    id: 'pendlay',
    canonicalId: 'pendlay_barbell_row',
    name: 'Remo Pendlay con Barra',
    category: 'Espalda / Tracción Horizontal',
    aliases: ['pendlay', 'remo', 'pendlay_barbell_row', 'barbell_row', 'remo pendlay', 'pendlay-1'],
  },
];

/**
 * Normalizes exercise identifiers to group historical aliases and catalog IDs.
 */
export function canonicalizeExercise(exerciseId: string, exerciseName: string): { canonicalId: string; displayName: string } {
  const normId = (exerciseId || '').toLowerCase().trim();
  const normName = (exerciseName || '').toLowerCase().trim();

  for (const lift of PRIMARY_COMPOUND_LIFTS) {
    for (const alias of lift.aliases) {
      if (normId.includes(alias) || normName.includes(alias)) {
        return { canonicalId: lift.canonicalId, displayName: lift.name };
      }
    }
  }

  return { canonicalId: exerciseId || 'custom_exercise', displayName: exerciseName || 'Ejercicio' };
}

/**
 * Filter executed workouts according to period, custom dates, muscle group or exercise.
 */
export function filterWorkoutsForAnalytics(
  workouts: ExecutedWorkout[],
  filter: AnalyticsFilterOptions,
  refDate: Date = new Date()
): ExecutedWorkout[] {
  if (!workouts || workouts.length === 0) return [];

  let minDate: Date | null = null;
  let maxDate: Date | null = null;

  if (filter.period === '4w') {
    minDate = new Date(refDate.getTime() - 28 * 24 * 60 * 60 * 1000);
  } else if (filter.period === '12w') {
    minDate = new Date(refDate.getTime() - 84 * 24 * 60 * 60 * 1000);
  } else if (filter.period === '24w') {
    minDate = new Date(refDate.getTime() - 180 * 24 * 60 * 60 * 1000);
  } else if (filter.period === 'custom') {
    if (filter.customStartDate) {
      minDate = new Date(`${filter.customStartDate}T00:00:00`);
    }
    if (filter.customEndDate) {
      maxDate = new Date(`${filter.customEndDate}T23:59:59`);
    }
  }

  return workouts.filter(w => {
    // 1. Date filter
    const wDate = new Date(w.startedAt);
    if (!isNaN(wDate.getTime())) {
      if (minDate && wDate < minDate) return false;
      if (maxDate && wDate > maxDate) return false;
    }

    // 2. Muscle Group filter (if set and not 'all')
    if (filter.muscleGroup && filter.muscleGroup !== 'all') {
      const hasMuscle = (w.exercisesSnapshot || []).some(
        ex => ex.muscleGroup === filter.muscleGroup
      );
      if (!hasMuscle) return false;
    }

    // 3. Specific Exercise filter (if set and not 'all')
    if (filter.exerciseId && filter.exerciseId !== 'all') {
      const hasExercise = (w.exercisesSnapshot || []).some(
        ex => ex.exerciseId === filter.exerciseId || ex.exerciseName.toLowerCase().includes(filter.exerciseId!.toLowerCase())
      );
      if (!hasExercise) return false;
    }

    return true;
  });
}

/**
 * Computes weekly workload buckets (7-day intervals) across a collection of workouts and legacy sets.
 */
export function calculateWeeklyWorkloadBuckets(
  workouts: ExecutedWorkout[],
  fallbackHistory: WorkoutSessionRecord[] = [],
  filter: AnalyticsFilterOptions,
  refDate: Date = new Date()
): WeeklyWorkloadBucket[] {
  // Determine date bounds
  let numWeeks = 12;
  if (filter.period === '4w') numWeeks = 4;
  else if (filter.period === '12w') numWeeks = 12;
  else if (filter.period === '24w') numWeeks = 24;
  else if (filter.period === 'all') numWeeks = 26; // up to 6 months display
  else if (filter.period === 'custom') {
    if (filter.customStartDate && filter.customEndDate) {
      const s = new Date(`${filter.customStartDate}T00:00:00`).getTime();
      const e = new Date(`${filter.customEndDate}T23:59:59`).getTime();
      const days = Math.max(7, Math.ceil((e - s) / (24 * 60 * 60 * 1000)));
      numWeeks = Math.max(1, Math.min(52, Math.ceil(days / 7)));
    }
  }

  // Pre-extract structured sets from workouts and deduplicated fallback
  const allSets = extractExportSets(workouts, fallbackHistory);

  // Build weekly intervals working backwards from refDate
  const buckets: WeeklyWorkloadBucket[] = [];
  const endRef = new Date(refDate);

  // Month names in Spanish for clean labels
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  for (let i = numWeeks - 1; i >= 0; i--) {
    const bucketEnd = new Date(endRef.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const bucketStart = new Date(bucketEnd.getTime() - 6 * 24 * 60 * 60 * 1000);

    const sStr = getLocalDateString(bucketStart.toISOString());
    const eStr = getLocalDateString(bucketEnd.toISOString());

    const sMonth = monthNames[bucketStart.getMonth()];
    const eMonth = monthNames[bucketEnd.getMonth()];
    const label = `Sem ${numWeeks - i} (${bucketStart.getDate()} ${sMonth} - ${bucketEnd.getDate()} ${eMonth})`;

    // Filter sessions belonging to this 7-day interval
    const bStartMs = new Date(`${sStr}T00:00:00`).getTime();
    const bEndMs = new Date(`${eStr}T23:59:59`).getTime();

    const matchingWorkouts = workouts.filter(w => {
      const t = new Date(w.startedAt).getTime();
      return !isNaN(t) && t >= bStartMs && t <= bEndMs;
    });

    // Sets falling within this interval
    const matchingSets = allSets.filter(s => {
      const t = new Date(s.completedAt || s.workoutStartedAt).getTime();
      return !isNaN(t) && t >= bStartMs && t <= bEndMs;
    });

    const completedSessions = matchingWorkouts.filter(w => w.status === 'completed').length;
    const abandonedSessions = matchingWorkouts.filter(w => w.status === 'abandoned').length;

    // Strict volume computation: EXCLUDE warmup sets from effective tonnage!
    let effectiveTonnage = 0;
    let effectiveSetsCount = 0;
    let warmupSetsCount = 0;
    let totalRepsCount = 0;
    const rirList: number[] = [];
    const trainedDates = new Set<string>();

    matchingSets.forEach(s => {
      trainedDates.add(getLocalDateString(s.completedAt || s.workoutStartedAt));
      if (s.isWarmup || s.setType === 'warmup') {
        warmupSetsCount++;
        return;
      }
      if (s.completed) {
        effectiveSetsCount++;
        effectiveTonnage += Math.round(s.weightKg * s.reps);
        totalRepsCount += s.reps;
        if (s.rir !== null && s.rir !== undefined && s.rir >= 0) {
          rirList.push(s.rir);
        }
      }
    });

    // Session RPE & Internal load Foster's method: sRPE * durationMinutes
    let internalLoadTotal = 0;
    let sessionsWithInternalData = 0;
    let totalDurationSeconds = 0;

    matchingWorkouts.forEach(w => {
      totalDurationSeconds += w.durationSeconds || 0;
      if (w.sessionRpe && w.sessionRpe > 0 && w.durationSeconds > 0) {
        const durationMin = w.durationSeconds / 60;
        internalLoadTotal += Math.round(w.sessionRpe * durationMin);
        sessionsWithInternalData++;
      }
    });

    const averageRir = rirList.length > 0 ? Math.round((rirList.reduce((a, b) => a + b, 0) / rirList.length) * 10) / 10 : null;
    const sessionRpeAvg = sessionsWithInternalData > 0
      ? Math.round((matchingWorkouts.reduce((acc, w) => acc + (w.sessionRpe || 0), 0) / sessionsWithInternalData) * 10) / 10
      : null;
    const internalLoadScore = sessionsWithInternalData > 0 ? internalLoadTotal : null;
    const workDensityKgPerMin = totalDurationSeconds > 0 && effectiveTonnage > 0
      ? Math.round((effectiveTonnage / (totalDurationSeconds / 60)) * 10) / 10
      : null;

    buckets.push({
      weekIndex: numWeeks - i,
      weekStart: sStr,
      weekEnd: eStr,
      label,
      completedSessions,
      abandonedSessions,
      totalSessions: matchingWorkouts.length,
      effectiveTonnageKg: effectiveTonnage,
      effectiveSets: effectiveSetsCount,
      warmupSets: warmupSetsCount,
      totalReps: totalRepsCount,
      frequencyDays: trainedDates.size,
      averageRir,
      sessionRpeAvg,
      internalLoadScore,
      workDensityKgPerMin,
    });
  }

  return buckets;
}

/**
 * Calculates Acute:Chronic Workload Ratio (ACWR) using standardized 7-day acute and 28-day chronic windows (35-day span).
 *
 * Explicit Methodology:
 *  - Acute window: Rolling 7 days [refDate - 7d, refDate].
 *  - Chronic window: 28 days preceding the acute window [refDate - 35d, refDate - 7d].
 *  - Chronic Weekly Baseline = Chronic total tonnage / 4 weeks.
 *  - ACWR = Acute tonnage / Chronic Weekly Baseline.
 *  - Strict sufficiency check: requires >= 28 days of history and >= 1 completed session in the chronic baseline.
 *  - Responsible heuristic interpretation (0.8 - 1.3 sweet spot, > 1.5 spike).
 *  - Strictly zero alarmism; no claims of physiological neuromuscular diagnosis or injury prediction.
 */
export function calculateACWR(
  workouts: ExecutedWorkout[],
  fallbackHistory: WorkoutSessionRecord[] = [],
  refDate: Date = new Date()
): AcwrResult {
  const REQUIRED_DAYS = 35;
  const ACUTE_DAYS = 7;
  const CHRONIC_DAYS = 28;

  // Timestamps
  const refMs = refDate.getTime();
  const acuteStartMs = refMs - ACUTE_DAYS * 24 * 60 * 60 * 1000;
  const chronicStartMs = acuteStartMs - CHRONIC_DAYS * 24 * 60 * 60 * 1000;

  const acuteStartDate = getLocalDateString(new Date(acuteStartMs).toISOString());
  const acuteEndDate = getLocalDateString(refDate.toISOString());
  const chronicStartDate = getLocalDateString(new Date(chronicStartMs).toISOString());
  const chronicEndDate = getLocalDateString(new Date(acuteStartMs).toISOString());

  // Check total history span available
  const allDates: number[] = [];
  workouts.forEach(w => {
    const t = new Date(w.startedAt).getTime();
    if (!isNaN(t)) allDates.push(t);
  });
  fallbackHistory.forEach(h => {
    const t = new Date(h.date).getTime();
    if (!isNaN(t)) allDates.push(t);
  });

  const availableHistoryDays = allDates.length > 0
    ? Math.max(1, Math.round((refMs - Math.min(...allDates)) / (24 * 60 * 60 * 1000)))
    : 0;

  // Extract all sets once
  const allSets = extractExportSets(workouts, fallbackHistory);

  // 1. Compute Acute Window Load
  let acuteTonnageKg = 0;
  let acuteEffectiveSets = 0;
  let acuteInternalLoadTotal = 0;
  let acuteSessionsWithInternal = 0;

  const acuteWorkouts = workouts.filter(w => {
    const t = new Date(w.startedAt).getTime();
    return !isNaN(t) && t >= acuteStartMs && t <= refMs;
  });

  allSets.forEach(s => {
    const t = new Date(s.completedAt || s.workoutStartedAt).getTime();
    if (!isNaN(t) && t >= acuteStartMs && t <= refMs) {
      if (!s.isWarmup && s.setType !== 'warmup' && s.completed) {
        acuteEffectiveSets++;
        acuteTonnageKg += Math.round(s.weightKg * s.reps);
      }
    }
  });

  acuteWorkouts.forEach(w => {
    if (w.sessionRpe && w.sessionRpe > 0 && w.durationSeconds > 0) {
      acuteInternalLoadTotal += Math.round(w.sessionRpe * (w.durationSeconds / 60));
      acuteSessionsWithInternal++;
    }
  });

  const acuteInternalLoad = acuteSessionsWithInternal > 0 ? acuteInternalLoadTotal : null;

  // 2. Compute Chronic Baseline Window Load (4 weeks)
  let chronicTotalTonnageKg = 0;
  let chronicInternalLoadTotal = 0;
  let chronicSessionsWithInternal = 0;

  const chronicWorkouts = workouts.filter(w => {
    const t = new Date(w.startedAt).getTime();
    return !isNaN(t) && t >= chronicStartMs && t < acuteStartMs;
  });

  allSets.forEach(s => {
    const t = new Date(s.completedAt || s.workoutStartedAt).getTime();
    if (!isNaN(t) && t >= chronicStartMs && t < acuteStartMs) {
      if (!s.isWarmup && s.setType !== 'warmup' && s.completed) {
        chronicTotalTonnageKg += Math.round(s.weightKg * s.reps);
      }
    }
  });

  chronicWorkouts.forEach(w => {
    if (w.sessionRpe && w.sessionRpe > 0 && w.durationSeconds > 0) {
      chronicInternalLoadTotal += Math.round(w.sessionRpe * (w.durationSeconds / 60));
      chronicSessionsWithInternal++;
    }
  });

  const chronicWeeklyBaselineTonnageKg = Math.round((chronicTotalTonnageKg / 4) * 10) / 10;
  const chronicTotalInternalLoad = chronicSessionsWithInternal > 0 ? chronicInternalLoadTotal : null;
  const chronicWeeklyBaselineInternalLoad = chronicTotalInternalLoad !== null
    ? Math.round((chronicTotalInternalLoad / 4) * 10) / 10
    : null;

  // 3. Sufficiency Verification
  if (availableHistoryDays < 21 || (chronicWorkouts.length === 0 && chronicTotalTonnageKg === 0)) {
    return {
      isCalculable: false,
      insufficiencyReason: availableHistoryDays < 21
        ? `Historial insuficiente (${availableHistoryDays} días registrados). Se requieren al menos 28-35 días continuos para consolidar tu línea base crónica.`
        : 'Sin sesiones registradas en la ventana crónica de referencia (últimas 4 semanas anteriores). Falta línea base comparativa.',
      requiredDays: REQUIRED_DAYS,
      availableHistoryDays,
      acuteWindowDays: ACUTE_DAYS,
      acuteStartDate,
      acuteEndDate,
      acuteTonnageKg,
      acuteInternalLoad,
      acuteSessionsCount: acuteWorkouts.length,
      acuteEffectiveSets,
      chronicWindowDays: CHRONIC_DAYS,
      chronicStartDate,
      chronicEndDate,
      chronicTotalTonnageKg,
      chronicWeeklyBaselineTonnageKg,
      chronicTotalInternalLoad,
      chronicWeeklyBaselineInternalLoad,
      chronicSessionsCount: chronicWorkouts.length,
      acwrTonnageRatio: null,
      acwrInternalRatio: null,
      status: 'insufficient_data',
      statusLabel: 'Línea Base en Construcción',
      statusBadgeColor: 'bg-surface-container-high text-on-surface-variant',
      feedbackMessage: 'Continúa registrando tus entrenamientos. Se necesitan al menos 4 semanas de datos para establecer tu línea base de carga crónica.',
      methodologyNote: 'Cálculo ACWR = Carga aguda (7d) / Carga crónica media semanal (28d). Requiere 35 días de historial.',
    };
  }

  // Handle zero chronic baseline (prevent divide by zero)
  if (chronicWeeklyBaselineTonnageKg <= 0) {
    return {
      isCalculable: false,
      insufficiencyReason: 'Línea base crónica igual a 0 kg. No es posible dividir la carga aguda por una referencia nula.',
      requiredDays: REQUIRED_DAYS,
      availableHistoryDays,
      acuteWindowDays: ACUTE_DAYS,
      acuteStartDate,
      acuteEndDate,
      acuteTonnageKg,
      acuteInternalLoad,
      acuteSessionsCount: acuteWorkouts.length,
      acuteEffectiveSets,
      chronicWindowDays: CHRONIC_DAYS,
      chronicStartDate,
      chronicEndDate,
      chronicTotalTonnageKg,
      chronicWeeklyBaselineTonnageKg,
      chronicTotalInternalLoad,
      chronicWeeklyBaselineInternalLoad,
      chronicSessionsCount: chronicWorkouts.length,
      acwrTonnageRatio: null,
      acwrInternalRatio: null,
      status: 'insufficient_data',
      statusLabel: 'Línea Base Vacía',
      statusBadgeColor: 'bg-surface-container-high text-on-surface-variant',
      feedbackMessage: 'Tu volumen en las 4 semanas anteriores fue nulo. No es posible calcular una ratio matemática sin denominador histórico.',
      methodologyNote: 'ACWR requiere un denominador crónico mayor a cero.',
    };
  }

  // Compute Ratio
  const rawRatio = acuteTonnageKg / chronicWeeklyBaselineTonnageKg;
  const acwrTonnageRatio = Math.round(rawRatio * 100) / 100;

  const acwrInternalRatio = chronicWeeklyBaselineInternalLoad && acuteInternalLoad
    ? Math.round((acuteInternalLoad / chronicWeeklyBaselineInternalLoad) * 100) / 100
    : null;

  // Classify Status
  let status: AcwrStatus = 'optimal_progression';
  let statusLabel = 'Carga Estable (Sweet-Spot)';
  let statusBadgeColor = 'bg-primary-fixed text-on-primary-fixed';
  let feedbackMessage = 'Tu carga de los últimos 7 días se mantiene en equilibrio progresivo con tu promedio de las últimas 4 semanas (ratio 0.8 - 1.3).';

  if (acwrTonnageRatio === 0) {
    status = 'rest_period';
    statusLabel = 'Sin Carga Aguda Reciente';
    statusBadgeColor = 'bg-surface-container-high text-on-surface-variant';
    feedbackMessage = 'No se han registrado sesiones en los últimos 7 días. Si fue una pausa planificada, tu fatiga residual se habrá disipado; si vas a retomar, reintroduce la carga progresivamente.';
  } else if (acwrTonnageRatio < 0.8) {
    status = 'deload_or_reduced';
    statusLabel = 'Carga Reducida / Descarga';
    statusBadgeColor = 'bg-secondary-fixed text-on-secondary-fixed';
    feedbackMessage = 'Tu volumen semanal actual es inferior a tu línea base histórica (<0.8). Es habitual en semanas de descarga (deload), viajes o fases de transición.';
  } else if (acwrTonnageRatio >= 0.8 && acwrTonnageRatio <= 1.3) {
    status = 'optimal_progression';
    statusLabel = 'Carga Estable (Sweet-Spot)';
    statusBadgeColor = 'bg-primary-fixed text-on-primary-fixed';
    feedbackMessage = 'La carga de trabajo reciente progresa de forma controlada y sostenible respecto a tus últimas 4 semanas.';
  } else if (acwrTonnageRatio > 1.3 && acwrTonnageRatio <= 1.5) {
    status = 'elevated_load';
    statusLabel = 'Incremento Notable de Carga';
    statusBadgeColor = 'bg-amber-100 text-amber-900';
    feedbackMessage = 'La carga reciente ha aumentado respecto a tu referencia histórica. Revisa la evolución de las sesiones, el esfuerzo percibido, el descanso y cómo te estás sintiendo.';
  } else if (acwrTonnageRatio > 1.5) {
    status = 'high_spike';
    statusLabel = 'Pico de Carga Aguda';
    statusBadgeColor = 'bg-amber-200 text-amber-950 font-bold';
    feedbackMessage = 'La carga de los últimos 7 días supera notablemente tu línea base crónica (>1.5). Valora moderar el volumen o la intensidad en las próximas sesiones si notas acumulación de fatiga articular o bajada de rendimiento.';
  }

  const methodologyNote = 'Ratio de volumen externo (tonelaje 7d / 28d media). Referencias heurísticas orientativas (0.8 - 1.3 habitual), no predictores deterministas de lesión ni diagnósticos médicos.';

  return {
    isCalculable: true,
    requiredDays: REQUIRED_DAYS,
    availableHistoryDays,
    acuteWindowDays: ACUTE_DAYS,
    acuteStartDate,
    acuteEndDate,
    acuteTonnageKg,
    acuteInternalLoad,
    acuteSessionsCount: acuteWorkouts.length,
    acuteEffectiveSets,
    chronicWindowDays: CHRONIC_DAYS,
    chronicStartDate,
    chronicEndDate,
    chronicTotalTonnageKg,
    chronicWeeklyBaselineTonnageKg,
    chronicTotalInternalLoad,
    chronicWeeklyBaselineInternalLoad,
    chronicSessionsCount: chronicWorkouts.length,
    acwrTonnageRatio,
    acwrInternalRatio,
    status,
    statusLabel,
    statusBadgeColor,
    feedbackMessage,
    methodologyNote,
  };
}

/**
 * Computes 1RM progression and session bests for each exercise in the athlete's history.
 */
export function calculateExerciseProgressions(
  workouts: ExecutedWorkout[],
  fallbackHistory: WorkoutSessionRecord[] = [],
  filter?: AnalyticsFilterOptions
): Record<string, ExerciseProgressionSummary> {
  const progressions: Record<string, ExerciseProgressionSummary> = {};
  const allSets = extractExportSets(workouts, fallbackHistory);

  // Group sets by canonical exercise
  const exerciseSetsMap = new Map<string, ExportSetRecord[]>();

  allSets.forEach(set => {
    // Strictly exclude warmup sets from PR and 1RM calculation!
    if (set.isWarmup || set.setType === 'warmup') return;
    if (!set.completed || set.weightKg <= 0 || set.reps <= 0) return;

    const { canonicalId, displayName } = canonicalizeExercise(set.exerciseId, set.exerciseName);

    if (!exerciseSetsMap.has(canonicalId)) {
      exerciseSetsMap.set(canonicalId, []);
    }
    exerciseSetsMap.get(canonicalId)!.push(set);
  });

  // For each exercise, group by session/date to get the best set per session
  exerciseSetsMap.forEach((sets, canonicalId) => {
    const firstSet = sets[0];
    const { displayName } = canonicalizeExercise(firstSet.exerciseId, firstSet.exerciseName);

    // Group sets by workoutId or date
    const sessionMap = new Map<string, ExportSetRecord[]>();
    sets.forEach(s => {
      const key = s.workoutId !== 'legacy_standalone' ? s.workoutId : `${s.exerciseId}_${s.workoutStartedAt}`;
      if (!sessionMap.has(key)) {
        sessionMap.set(key, []);
      }
      sessionMap.get(key)!.push(s);
    });

    const historyPoints: ExerciseProgressionPoint[] = [];

    sessionMap.forEach((sessionSets, wId) => {
      let bestEstimated1RM = 0;
      let bestWeight = 0;
      let bestReps = 0;
      let bestRir: number | null = null;
      let totalExTonnage = 0;

      sessionSets.forEach(s => {
        totalExTonnage += Math.round(s.weightKg * s.reps);
        const epley = s.estimated1RM || calculateEpley1RM(s.weightKg, s.reps).value;
        if (epley > bestEstimated1RM) {
          bestEstimated1RM = epley;
          bestWeight = s.weightKg;
          bestReps = s.reps;
          bestRir = s.rir;
        }
      });

      const rep = sessionSets[0];
      historyPoints.push({
        date: getLocalDateString(rep.completedAt || rep.workoutStartedAt),
        workoutId: rep.workoutId,
        workoutStatus: rep.workoutStatus,
        routineName: rep.routineName,
        bestWeightKg: bestWeight,
        bestReps,
        bestRir,
        estimated1RM: bestEstimated1RM,
        totalSetsInSession: sessionSets.length,
        totalExerciseTonnageKg: totalExTonnage,
      });
    });

    // Sort chronologically ascending
    historyPoints.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // All-time best
    let allTimeBest1RM = 0;
    let allTimeBestWeightKg = 0;
    let allTimeBestReps = 0;
    let allTimeBestRir: number | null = null;
    let allTimeBestDate = '';

    historyPoints.forEach(p => {
      if (p.estimated1RM > allTimeBest1RM) {
        allTimeBest1RM = p.estimated1RM;
        allTimeBestWeightKg = p.bestWeightKg;
        allTimeBestReps = p.bestReps;
        allTimeBestRir = p.bestRir;
        allTimeBestDate = p.date;
      }
    });

    const firstRecorded1RM = historyPoints.length > 0 ? historyPoints[0].estimated1RM : undefined;
    const net1RMChangeKg = firstRecorded1RM && allTimeBest1RM > 0
      ? Math.round((allTimeBest1RM - firstRecorded1RM) * 10) / 10
      : undefined;
    const net1RMChangePct = firstRecorded1RM && firstRecorded1RM > 0 && net1RMChangeKg !== undefined
      ? Math.round((net1RMChangeKg / firstRecorded1RM) * 1000) / 10
      : undefined;

    // Filter points if date filters are applied
    let filteredPoints = historyPoints;
    if (filter) {
      if (filter.period === '4w') {
        const cut = Date.now() - 28 * 24 * 60 * 60 * 1000;
        filteredPoints = historyPoints.filter(p => new Date(p.date).getTime() >= cut);
      } else if (filter.period === '12w') {
        const cut = Date.now() - 84 * 24 * 60 * 60 * 1000;
        filteredPoints = historyPoints.filter(p => new Date(p.date).getTime() >= cut);
      } else if (filter.period === '24w') {
        const cut = Date.now() - 180 * 24 * 60 * 60 * 1000;
        filteredPoints = historyPoints.filter(p => new Date(p.date).getTime() >= cut);
      } else if (filter.period === 'custom') {
        if (filter.customStartDate) {
          const cutStart = new Date(`${filter.customStartDate}T00:00:00`).getTime();
          filteredPoints = filteredPoints.filter(p => new Date(p.date).getTime() >= cutStart);
        }
        if (filter.customEndDate) {
          const cutEnd = new Date(`${filter.customEndDate}T23:59:59`).getTime();
          filteredPoints = filteredPoints.filter(p => new Date(p.date).getTime() <= cutEnd);
        }
      }
    }

    const periodBest1RM = filteredPoints.length > 0
      ? Math.max(...filteredPoints.map(p => p.estimated1RM))
      : allTimeBest1RM;

    progressions[canonicalId] = {
      exerciseId: firstSet.exerciseId,
      canonicalId,
      exerciseName: displayName,
      muscleGroup: firstSet.muscleGroup || 'general',
      totalSessions: historyPoints.length,
      historyPoints: filteredPoints,
      allTimeBest1RM,
      allTimeBestWeightKg,
      allTimeBestReps,
      allTimeBestRir,
      allTimeBestDate,
      periodBest1RM,
      firstRecorded1RM,
      net1RMChangeKg,
      net1RMChangePct,
      hasReliableTrend: historyPoints.length >= 3,
    };
  });

  return progressions;
}

/**
 * Calculates indirect recovery and fatigue indicators from recorded sets and sessions.
 * Never invents sleep or soreness data. Uses real RIR, density, and session RPE.
 */
export function calculateIndirectRecoveryIndicators(
  workouts: ExecutedWorkout[],
  fallbackHistory: WorkoutSessionRecord[] = [],
  acwr?: AcwrResult
): IndirectRecoveryIndicators {
  const allSets = extractExportSets(workouts, fallbackHistory);

  const effectiveSets = allSets.filter(s => !s.isWarmup && s.setType !== 'warmup' && s.completed);

  const rirValues: number[] = [];
  let highIntensitySetsCount = 0;

  effectiveSets.forEach(s => {
    if (s.rir !== null && s.rir !== undefined && s.rir >= 0) {
      rirValues.push(s.rir);
      if (s.rir <= 2) {
        highIntensitySetsCount++;
      }
    }
  });

  const averageEffectiveRir = rirValues.length > 0
    ? Math.round((rirValues.reduce((a, b) => a + b, 0) / rirValues.length) * 10) / 10
    : null;

  const highIntensityPercentage = effectiveSets.length > 0
    ? Math.round((highIntensitySetsCount / effectiveSets.length) * 1000) / 10
    : 0;

  // Session RPE average
  const validRpes = workouts.filter(w => w.sessionRpe && w.sessionRpe > 0).map(w => w.sessionRpe!);
  const averageSessionRpe = validRpes.length > 0
    ? Math.round((validRpes.reduce((a, b) => a + b, 0) / validRpes.length) * 10) / 10
    : null;

  // Density: kg / min
  let totalTonnage = 0;
  let totalDurationSec = 0;
  workouts.forEach(w => {
    totalTonnage += w.totalTonnageKg || 0;
    totalDurationSec += w.durationSeconds || 0;
  });

  const sessionDensityKgPerMin = totalDurationSec > 0 && totalTonnage > 0
    ? Math.round((totalTonnage / (totalDurationSec / 60)) * 10) / 10
    : null;

  // Weekly frequency
  const uniqueDates = new Set<string>();
  workouts.forEach(w => uniqueDates.add(getLocalDateString(w.startedAt)));
  const totalDays = uniqueDates.size;
  const trainingFrequencyPerWeek = workouts.length > 0
    ? Math.round((totalDays / Math.max(1, Math.ceil(workouts.length / 3))) * 10) / 10
    : 0;

  // Workload trend
  let workloadTrend: 'increasing' | 'stable' | 'decreasing' | 'insufficient' = 'insufficient';
  if (acwr && acwr.isCalculable && acwr.acwrTonnageRatio !== null) {
    if (acwr.acwrTonnageRatio > 1.3) workloadTrend = 'increasing';
    else if (acwr.acwrTonnageRatio < 0.8) workloadTrend = 'decreasing';
    else workloadTrend = 'stable';
  }

  const disclaimerText =
    'Indicadores indirectos basados en proximidad al fallo (RIR), tasa de series de alta intensidad y densidad de carga. No sustituyen valoraciones biométricas directas de fatiga neuromuscular.';

  return {
    averageEffectiveRir,
    averageSessionRpe,
    sessionDensityKgPerMin,
    highIntensitySetsCount,
    highIntensityPercentage,
    trainingFrequencyPerWeek,
    workloadTrend,
    disclaimerText,
  };
}

/**
 * Consolidated master calculation engine for TrainingProgressView.
 */
export function computeConsolidatedAnalytics(
  workouts: ExecutedWorkout[],
  fallbackHistory: WorkoutSessionRecord[] = [],
  filter: AnalyticsFilterOptions,
  refDate: Date = new Date()
): ConsolidatedAnalytics {
  const filteredWorkouts = filterWorkoutsForAnalytics(workouts, filter, refDate);
  const weeklyBuckets = calculateWeeklyWorkloadBuckets(filteredWorkouts, fallbackHistory, filter, refDate);
  const acwr = calculateACWR(workouts, fallbackHistory, refDate);
  const exerciseProgressions = calculateExerciseProgressions(workouts, fallbackHistory, filter);
  const recoveryIndicators = calculateIndirectRecoveryIndicators(filteredWorkouts, fallbackHistory, acwr);

  // Totals across filtered workouts
  let completedSessionsCount = 0;
  let abandonedSessionsCount = 0;
  let totalEffectiveTonnageKg = 0;
  let totalEffectiveSets = 0;
  let totalWarmupSets = 0;
  let totalReps = 0;
  let totalDurationSeconds = 0;

  filteredWorkouts.forEach(w => {
    if (w.status === 'completed') completedSessionsCount++;
    if (w.status === 'abandoned') abandonedSessionsCount++;
    totalDurationSeconds += w.durationSeconds || 0;
  });

  weeklyBuckets.forEach(b => {
    totalEffectiveTonnageKg += b.effectiveTonnageKg;
    totalEffectiveSets += b.effectiveSets;
    totalWarmupSets += b.warmupSets;
    totalReps += b.totalReps;
  });

  const averageDurationMinutes = filteredWorkouts.length > 0 && totalDurationSeconds > 0
    ? Math.round(totalDurationSeconds / filteredWorkouts.length / 60)
    : 0;

  // Primary compound lifts list linked with actual progressions
  const primaryLifts: PrimaryLiftItem[] = PRIMARY_COMPOUND_LIFTS.map(lift => {
    return {
      id: lift.id,
      name: lift.name,
      category: lift.category,
      canonicalId: lift.canonicalId,
      summary: exerciseProgressions[lift.canonicalId],
    };
  });

  // Period comparison (current filtered vs previous identical span)
  let periodComparison: ConsolidatedAnalytics['periodComparison'] = undefined;
  if (filter.period === '4w' || filter.period === '12w') {
    const days = filter.period === '4w' ? 28 : 84;
    const prevRef = new Date(refDate.getTime() - days * 24 * 60 * 60 * 1000);
    const prevFilter: AnalyticsFilterOptions = { ...filter };
    const prevWorkouts = filterWorkoutsForAnalytics(workouts, prevFilter, prevRef);
    const prevBuckets = calculateWeeklyWorkloadBuckets(prevWorkouts, fallbackHistory, prevFilter, prevRef);
    const prevTonnage = prevBuckets.reduce((acc, b) => acc + b.effectiveTonnageKg, 0);
    const prevSessions = prevWorkouts.length;

    const tonnageDeltaKg = totalEffectiveTonnageKg - prevTonnage;
    const tonnageDeltaPct = prevTonnage > 0
      ? Math.round((tonnageDeltaKg / prevTonnage) * 1000) / 10
      : totalEffectiveTonnageKg > 0 ? 100 : 0;
    const sessionsDelta = filteredWorkouts.length - prevSessions;

    periodComparison = {
      currentTonnage: totalEffectiveTonnageKg,
      previousTonnage: prevTonnage,
      tonnageDeltaKg,
      tonnageDeltaPct,
      currentSessions: filteredWorkouts.length,
      previousSessions: prevSessions,
      sessionsDelta,
    };
  }

  return {
    filter,
    totalSessionsCount: filteredWorkouts.length,
    completedSessionsCount,
    abandonedSessionsCount,
    totalEffectiveTonnageKg,
    totalEffectiveSets,
    totalWarmupSets,
    totalReps,
    totalDurationSeconds,
    averageDurationMinutes,
    weeklyBuckets,
    acwr,
    exerciseProgressions,
    recoveryIndicators,
    primaryLifts,
    periodComparison,
  };
}
