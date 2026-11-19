/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Pure Workout Analytics, Mesocycle, Autoregulation & Export Engine
 * Strictly excludes warmup sets from effective tonnage and 1RM PR metrics.
 */

import type {
  AthleteGoal,
  EquipmentRequired,
  ExecutedWorkoutRecord,
  ExerciseCatalogItem,
  MesocycleDurationWeeks,
  MesocycleWeekPrescription,
  MuscleGroup,
  PlannedExerciseConfig,
  RoutineDay,
  TrainingExperience,
  WorkoutRoutineRecord,
  WorkoutSetRecord,
} from '../contracts/cleanSlateModels';

export const EXERCISE_CATALOG: ExerciseCatalogItem[] = [
  { id: 'barbell_bench_press', name: 'Press de Banca Plano con Barra', muscleGroup: 'pecho', equipment: 'barra', pattern: 'empuje_horizontal', defaultRepsMin: 6, defaultRepsMax: 8, defaultRestSeconds: 150 },
  { id: 'incline_dumbbell_press', name: 'Press Inclinado con Mancuernas', muscleGroup: 'pecho', equipment: 'mancuerna', pattern: 'empuje_horizontal', defaultRepsMin: 8, defaultRepsMax: 12, defaultRestSeconds: 120 },
  { id: 'cable_chest_fly', name: 'Cruce en Poleas para Pectoral', muscleGroup: 'pecho', equipment: 'polea', pattern: 'aislamiento', defaultRepsMin: 12, defaultRepsMax: 15, defaultRestSeconds: 75 },
  { id: 'pendlay_barbell_row', name: 'Remo Pendlay con Barra', muscleGroup: 'espalda', equipment: 'barra', pattern: 'traccion_horizontal', defaultRepsMin: 6, defaultRepsMax: 8, defaultRestSeconds: 150 },
  { id: 'lat_pulldown', name: 'Jalón al Pecho en Polea', muscleGroup: 'espalda', equipment: 'polea', pattern: 'traccion_vertical', defaultRepsMin: 8, defaultRepsMax: 12, defaultRestSeconds: 105 },
  { id: 'weighted_pullup', name: 'Dominadas Pronas', muscleGroup: 'espalda', equipment: 'peso_corporal', pattern: 'traccion_vertical', defaultRepsMin: 6, defaultRepsMax: 10, defaultRestSeconds: 120 },
  { id: 'barbell_back_squat', name: 'Sentadilla Trasera con Barra', muscleGroup: 'cuadriceps', equipment: 'barra', pattern: 'sentadilla', defaultRepsMin: 5, defaultRepsMax: 8, defaultRestSeconds: 180 },
  { id: 'leg_press_45', name: 'Prensa Inclinada 45°', muscleGroup: 'cuadriceps', equipment: 'maquina', pattern: 'sentadilla', defaultRepsMin: 10, defaultRepsMax: 12, defaultRestSeconds: 120 },
  { id: 'romanian_deadlift', name: 'Peso Muerto Rumano (RDL)', muscleGroup: 'isquios', equipment: 'barra', pattern: 'bisagra_cadera', defaultRepsMin: 6, defaultRepsMax: 10, defaultRestSeconds: 150 },
  { id: 'seated_leg_curl', name: 'Curl Femoral Sentado en Máquina', muscleGroup: 'isquios', equipment: 'maquina', pattern: 'aislamiento', defaultRepsMin: 10, defaultRepsMax: 15, defaultRestSeconds: 90 },
  { id: 'hip_thrust_barbell', name: 'Hip Thrust con Barra', muscleGroup: 'gluteos', equipment: 'barra', pattern: 'bisagra_cadera', defaultRepsMin: 8, defaultRepsMax: 12, defaultRestSeconds: 120 },
  { id: 'standing_overhead_press', name: 'Press Militar de Pie (OHP)', muscleGroup: 'hombros', equipment: 'barra', pattern: 'empuje_vertical', defaultRepsMin: 6, defaultRepsMax: 8, defaultRestSeconds: 150 },
  { id: 'dumbbell_lateral_raise', name: 'Elevaciones Laterales con Mancuernas', muscleGroup: 'hombros', equipment: 'mancuerna', pattern: 'aislamiento', defaultRepsMin: 12, defaultRepsMax: 16, defaultRestSeconds: 75 },
  { id: 'incline_dumbbell_curl', name: 'Curl Bíceps Banco Inclinado', muscleGroup: 'biceps', equipment: 'mancuerna', pattern: 'aislamiento', defaultRepsMin: 10, defaultRepsMax: 14, defaultRestSeconds: 75 },
  { id: 'rope_tricep_pushdown', name: 'Extensión de Tríceps en Polea', muscleGroup: 'triceps', equipment: 'polea', pattern: 'aislamiento', defaultRepsMin: 10, defaultRepsMax: 14, defaultRestSeconds: 75 },
  { id: 'standing_calf_raise', name: 'Elevación de Talones de Pie', muscleGroup: 'gemelos', equipment: 'maquina', pattern: 'aislamiento', defaultRepsMin: 12, defaultRepsMax: 16, defaultRestSeconds: 60 },
  { id: 'cable_crunch', name: 'Crunch Abdominal en Polea', muscleGroup: 'core', equipment: 'polea', pattern: 'aislamiento', defaultRepsMin: 12, defaultRepsMax: 16, defaultRestSeconds: 60 },
];

export function calculateEpley1RM(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  if (reps === 1) return Math.round(weightKg * 10) / 10;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

export function calculateEffectiveTonnage(sets: WorkoutSetRecord[]): number {
  return sets.reduce((sum, s) => {
    if (!s.completed || s.type === 'warmup') return sum;
    return sum + Math.round(s.weightKg * s.reps);
  }, 0);
}

export function calculateEffectiveSetsCount(sets: WorkoutSetRecord[]): number {
  return sets.filter(s => s.completed && s.type !== 'warmup').length;
}

export function calculateAverageRir(sets: WorkoutSetRecord[]): number | null {
  const effective = sets.filter(s => s.completed && s.type !== 'warmup' && Number.isFinite(s.rir));
  if (effective.length === 0) return null;
  const sum = effective.reduce((acc, s) => acc + s.rir, 0);
  return Math.round((sum / effective.length) * 10) / 10;
}

export interface AcwrAnalyticsSummary {
  isCalculable: boolean;
  statusLabel: string;
  acwrRatio: number | null;
  acuteTonnageKg: number;
  chronicWeeklyAvgKg: number;
  historyDays: number;
  message: string;
}

export interface ExerciseAnalyticsSummary {
  exerciseId: string;
  exerciseName: string;
  muscleGroup: MuscleGroup;
  sessionsCount: number;
  bestWeightKg: number;
  best1RM: number;
  latestWeightKg: number;
  latestReps: number;
  latestRir: number | null;
}

export interface WeeklyTonnagePoint {
  label: string;
  tonnageKg: number;
  effectiveSets: number;
  completedWorkouts: number;
}

export function computeTrainingAnalytics(
  workouts: ExecutedWorkoutRecord[],
  sets: WorkoutSetRecord[],
  period: '4w' | '12w' | '24w' | 'all' = '12w',
  referenceDateMs = Date.now()
): {
  totalCompletedWorkouts: number;
  totalEffectiveTonnageKg: number;
  totalEffectiveSets: number;
  totalWarmupSetsExcluded: number;
  averageRir: number | null;
  weeklyPoints: WeeklyTonnagePoint[];
  acwr: AcwrAnalyticsSummary;
  exerciseSummaries: ExerciseAnalyticsSummary[];
} {
  const periodDays = period === '4w' ? 28 : period === '12w' ? 84 : period === '24w' ? 180 : 3650;
  const cutoffMs = referenceDateMs - periodDays * 24 * 60 * 60 * 1000;

  const filteredWorkouts = workouts.filter(w => {
    const t = new Date(w.startedAt).getTime();
    return Number.isFinite(t) && t >= cutoffMs;
  });

  const workoutIdsInPeriod = new Set(filteredWorkouts.map(w => w.id));
  const filteredSets = sets.filter(s => workoutIdsInPeriod.has(s.executedWorkoutId));

  const totalEffectiveTonnageKg = calculateEffectiveTonnage(filteredSets);
  const totalEffectiveSets = calculateEffectiveSetsCount(filteredSets);
  const totalWarmupSetsExcluded = filteredSets.filter(s => s.completed && s.type === 'warmup').length;
  const averageRir = calculateAverageRir(filteredSets);

  const numWeeks = period === '4w' ? 4 : period === '12w' ? 8 : 10;
  const weeklyPoints: WeeklyTonnagePoint[] = [];
  for (let i = numWeeks - 1; i >= 0; i--) {
    const endMs = referenceDateMs - i * 7 * 24 * 60 * 60 * 1000;
    const startMs = endMs - 7 * 24 * 60 * 60 * 1000;
    const wInWeek = filteredWorkouts.filter(w => {
      const t = new Date(w.startedAt).getTime();
      return t >= startMs && t < endMs;
    });
    const wIds = new Set(wInWeek.map(w => w.id));
    const sInWeek = filteredSets.filter(s => wIds.has(s.executedWorkoutId));
    weeklyPoints.push({
      label: `Sem -${i}`,
      tonnageKg: calculateEffectiveTonnage(sInWeek),
      effectiveSets: calculateEffectiveSetsCount(sInWeek),
      completedWorkouts: wInWeek.filter(w => w.status === 'completed').length,
    });
  }

  // ACWR 7d / 28d baseline
  const acuteStartMs = referenceDateMs - 7 * 24 * 60 * 60 * 1000;
  const chronicStartMs = referenceDateMs - 35 * 24 * 60 * 60 * 1000;
  const allTimestamps = workouts.map(w => new Date(w.startedAt).getTime()).filter(Number.isFinite);
  const historyDays = allTimestamps.length > 0
    ? Math.max(1, Math.round((referenceDateMs - Math.min(...allTimestamps)) / (24 * 60 * 60 * 1000)))
    : 0;

  const workoutTimeMap = new Map(workouts.map(w => [w.id, new Date(w.startedAt).getTime()]));
  const acuteSets = sets.filter(s => {
    const t = workoutTimeMap.get(s.executedWorkoutId) ?? 0;
    return t >= acuteStartMs && t <= referenceDateMs;
  });
  const chronicSets = sets.filter(s => {
    const t = workoutTimeMap.get(s.executedWorkoutId) ?? 0;
    return t >= chronicStartMs && t < acuteStartMs;
  });

  const acuteTonnageKg = calculateEffectiveTonnage(acuteSets);
  const chronicWeeklyAvgKg = Math.round(calculateEffectiveTonnage(chronicSets) / 4);

  let acwr: AcwrAnalyticsSummary;
  if (historyDays < 21 || chronicWeeklyAvgKg <= 0) {
    acwr = {
      isCalculable: false,
      statusLabel: 'Línea Base en Construcción',
      acwrRatio: null,
      acuteTonnageKg,
      chronicWeeklyAvgKg,
      historyDays,
      message: `Se requieren >= 21-28 días continuos de historial (actual: ${historyDays} días) para calcular ACWR fiable.`,
    };
  } else {
    const ratio = Math.round((acuteTonnageKg / chronicWeeklyAvgKg) * 100) / 100;
    let statusLabel = 'Carga Óptima (0.8 - 1.3)';
    let message = 'Progresión estable respecto al promedio crónico de 4 semanas.';
    if (ratio > 1.5) {
      statusLabel = 'Pico Agudo (> 1.5)';
      message = 'El volumen semanal supera notablemente tu media crónica. Vigila recuperación y RIR.';
    } else if (ratio > 1.3) {
      statusLabel = 'Carga Elevada (1.3 - 1.5)';
      message = 'Incremento notable de volumen; monitorea fatiga acumulada.';
    } else if (ratio < 0.8) {
      statusLabel = 'Descarga / Carga Reducida (< 0.8)';
      message = 'Volumen por debajo del promedio histórico (descarga o pausa planificada).';
    }
    acwr = {
      isCalculable: true,
      statusLabel,
      acwrRatio: ratio,
      acuteTonnageKg,
      chronicWeeklyAvgKg,
      historyDays,
      message,
    };
  }

  // Exercise summaries (completed workouts only, effective sets only)
  const completedIds = new Set(workouts.filter(w => w.status === 'completed').map(w => w.id));
  const byExercise = new Map<string, WorkoutSetRecord[]>();
  for (const s of sets) {
    if (!completedIds.has(s.executedWorkoutId) || !s.completed || s.type === 'warmup') continue;
    const list = byExercise.get(s.exerciseId) ?? [];
    list.push(s);
    byExercise.set(s.exerciseId, list);
  }

  const exerciseSummaries: ExerciseAnalyticsSummary[] = [];
  for (const [exerciseId, exSets] of byExercise.entries()) {
    const sorted = [...exSets].sort(
      (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
    );
    const sessionsSet = new Set(sorted.map(s => s.executedWorkoutId));
    const best1RM = Math.max(...sorted.map(s => calculateEpley1RM(s.weightKg, s.reps)));
    const bestWeightKg = Math.max(...sorted.map(s => s.weightKg));
    const latest = sorted[sorted.length - 1];
    exerciseSummaries.push({
      exerciseId,
      exerciseName: latest.exerciseName,
      muscleGroup: latest.muscleGroup,
      sessionsCount: sessionsSet.size,
      bestWeightKg,
      best1RM,
      latestWeightKg: latest.weightKg,
      latestReps: latest.reps,
      latestRir: latest.rir,
    });
  }

  return {
    totalCompletedWorkouts: filteredWorkouts.filter(w => w.status === 'completed').length,
    totalEffectiveTonnageKg,
    totalEffectiveSets,
    totalWarmupSetsExcluded,
    averageRir,
    weeklyPoints,
    acwr,
    exerciseSummaries: exerciseSummaries.sort((a, b) => b.best1RM - a.best1RM),
  };
}

export interface AutoregulationRecommendation {
  exerciseId: string;
  exerciseName: string;
  action: 'increase_load' | 'increase_reps' | 'maintain' | 'insufficient_data';
  badgeLabel: string;
  currentWeightKg: number;
  suggestedWeightKg: number;
  reason: string;
}

export function generateRoutineDayAutoregulation(
  day: RoutineDay,
  workouts: ExecutedWorkoutRecord[],
  sets: WorkoutSetRecord[]
): AutoregulationRecommendation[] {
  const completedIds = new Set(workouts.filter(w => w.status === 'completed').map(w => w.id));

  return day.exercises.map(cfg => {
    const exSets = sets
      .filter(s => s.exerciseId === cfg.exerciseId && completedIds.has(s.executedWorkoutId) && s.completed && s.type !== 'warmup')
      .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());

    if (exSets.length === 0) {
      return {
        exerciseId: cfg.exerciseId,
        exerciseName: cfg.exerciseName,
        action: 'insufficient_data',
        badgeLabel: 'Sin historial',
        currentWeightKg: cfg.targetWeightKg,
        suggestedWeightKg: cfg.targetWeightKg,
        reason: `Inicia con ${cfg.targetWeightKg} kg en ${cfg.repsMin}-${cfg.repsMax} reps (RIR ${cfg.targetRir}).`,
      };
    }

    const latestWorkoutId = exSets[0].executedWorkoutId;
    const latestSets = exSets.filter(s => s.executedWorkoutId === latestWorkoutId);
    const topWeight = Math.max(...latestSets.map(s => s.weightKg));
    const avgRir = calculateAverageRir(latestSets);
    const allHitMax = latestSets.every(s => s.reps >= cfg.repsMax);
    const increment = cfg.equipment === 'barra' ? 2.5 : cfg.equipment === 'mancuerna' ? 2.0 : 2.5;

    if (allHitMax && (avgRir === null || avgRir >= 1)) {
      return {
        exerciseId: cfg.exerciseId,
        exerciseName: cfg.exerciseName,
        action: 'increase_load',
        badgeLabel: `Subir +${increment} kg`,
        currentWeightKg: topWeight,
        suggestedWeightKg: Math.round((topWeight + increment) * 10) / 10,
        reason: `Todas las series alcanzaron ${cfg.repsMax}+ reps con RIR ${avgRir ?? 'adecuado'}.`,
      };
    }

    if (latestSets.every(s => s.reps >= cfg.repsMin)) {
      return {
        exerciseId: cfg.exerciseId,
        exerciseName: cfg.exerciseName,
        action: 'increase_reps',
        badgeLabel: 'Consolidar reps',
        currentWeightKg: topWeight,
        suggestedWeightKg: topWeight,
        reason: `Mantén ${topWeight} kg hasta consolidar ${cfg.repsMax} reps en todas las series.`,
      };
    }

    return {
      exerciseId: cfg.exerciseId,
      exerciseName: cfg.exerciseName,
      action: 'maintain',
      badgeLabel: 'Mantener carga',
      currentWeightKg: topWeight,
      suggestedWeightKg: topWeight,
      reason: `Prioriza técnica y descanso completo (${cfg.restSeconds}s) para alcanzar >= ${cfg.repsMin} reps.`,
    };
  });
}

export function generateMesocycleProgram(input: {
  name: string;
  goal: AthleteGoal;
  experience: TrainingExperience;
  daysPerWeek: number;
  durationWeeks: MesocycleDurationWeeks;
  availableEquipment: EquipmentRequired[];
  includeDeloadWeek: boolean;
}): WorkoutRoutineRecord {
  const daysCount = Math.min(6, Math.max(2, input.daysPerWeek));
  const eqSet = new Set<EquipmentRequired>(
    input.availableEquipment.length > 0 ? input.availableEquipment : ['barra', 'mancuerna', 'polea', 'maquina', 'peso_corporal']
  );

  const pickExercises = (groups: MuscleGroup[], countPerGroup = 1): PlannedExerciseConfig[] => {
    const picked: PlannedExerciseConfig[] = [];
    let idx = 1;
    for (const mg of groups) {
      const candidates = EXERCISE_CATALOG.filter(e => e.muscleGroup === mg && eqSet.has(e.equipment));
      const fallback = EXERCISE_CATALOG.filter(e => e.muscleGroup === mg);
      const list = (candidates.length > 0 ? candidates : fallback).slice(0, countPerGroup);
      for (const ex of list) {
        const sets = input.experience === 'principiante' ? 3 : 4;
        const repsMin = input.goal === 'fuerza' ? 4 : ex.defaultRepsMin;
        const repsMax = input.goal === 'fuerza' ? 6 : ex.defaultRepsMax;
        picked.push({
          id: `cfg_${mg}_${idx++}_${ex.id}`,
          exerciseId: ex.id,
          exerciseName: ex.name,
          muscleGroup: ex.muscleGroup,
          equipment: ex.equipment,
          sets,
          repsMin,
          repsMax,
          targetRir: 2,
          targetWeightKg: ex.equipment === 'barra' ? 60 : 20,
          restSeconds: ex.defaultRestSeconds,
        });
      }
    }
    return picked;
  };

  const baseDays: RoutineDay[] = [];
  if (daysCount <= 3) {
    for (let d = 1; d <= daysCount; d++) {
      baseDays.push({
        id: `d${d}`,
        name: `Día ${d}: Full Body ${String.fromCharCode(64 + d)}`,
        shortName: `Full Body ${String.fromCharCode(64 + d)}`,
        focusDescription: 'Tensión mecánica global & patrones básicos',
        exercises: pickExercises(
          d % 2 === 1 ? ['cuadriceps', 'pecho', 'espalda', 'hombros'] : ['isquios', 'espalda', 'pecho', 'biceps'],
          1
        ),
      });
    }
  } else {
    const templates: Array<{ id: string; name: string; short: string; focus: string; groups: MuscleGroup[] }> = [
      { id: 'd1', name: 'Día 1: Torso Fuerza', short: 'Torso Fuerza', focus: 'Empuje y tracción pesada', groups: ['pecho', 'espalda', 'hombros'] },
      { id: 'd2', name: 'Día 2: Pierna Fuerza', short: 'Pierna Fuerza', focus: 'Sentadilla, bisagra y core', groups: ['cuadriceps', 'isquios', 'gemelos'] },
      { id: 'd3', name: 'Día 3: Torso Hipertrofia', short: 'Torso Volumen', focus: 'Ángulos inclinados y brazos', groups: ['pecho', 'espalda', 'biceps', 'triceps'] },
      { id: 'd4', name: 'Día 4: Pierna Hipertrofia', short: 'Pierna Volumen', focus: 'Glúteo, femoral y aislamiento', groups: ['cuadriceps', 'gluteos', 'isquios', 'core'] },
      { id: 'd5', name: 'Día 5: Empuje & Hombro', short: 'Push Plus', focus: 'Deltoides lateral y tríceps', groups: ['hombros', 'pecho', 'triceps'] },
      { id: 'd6', name: 'Día 6: Tirón & Cadena Posterior', short: 'Pull Plus', focus: 'Dorsales, bíceps y posterior', groups: ['espalda', 'biceps', 'isquios'] },
    ];
    for (let i = 0; i < daysCount; i++) {
      const tpl = templates[i];
      baseDays.push({
        id: tpl.id,
        name: tpl.name,
        shortName: tpl.short,
        focusDescription: tpl.focus,
        exercises: pickExercises(tpl.groups, 1),
      });
    }
  }

  const weeks: MesocycleWeekPrescription[] = [];
  for (let w = 1; w <= input.durationWeeks; w++) {
    const isDeload = input.includeDeloadWeek && w === input.durationWeeks;
    const volumeMultiplier = isDeload ? 0.6 : w === 1 ? 1.0 : 1.1;
    const intensityRirTarget = isDeload ? 4 : Math.max(1, 3 - Math.floor((w - 1) / 2));

    weeks.push({
      weekNumber: w,
      name: isDeload ? `Semana ${w} (Descarga)` : `Semana ${w}`,
      isDeload,
      volumeMultiplier,
      intensityRirTarget,
      days: baseDays.map(day => ({
        ...day,
        exercises: day.exercises.map(ex => ({
          ...ex,
          sets: Math.max(1, Math.round(ex.sets * volumeMultiplier)),
          targetRir: intensityRirTarget,
        })),
      })),
    });
  }

  const mappedGoal: WorkoutRoutineRecord['goal'] =
    input.goal === 'fuerza' || input.goal === 'rendimiento'
      ? 'fuerza'
      : input.goal === 'resistencia'
        ? 'resistencia'
        : input.goal === 'recomposicion' || input.goal === 'definicion' || input.goal === 'perdida_grasa'
          ? 'recomposicion'
          : 'hipertrofia';

  return {
    id: `meso_${Date.now()}`,
    name: input.name.trim() || `Mesociclo ${daysCount}D (${input.durationWeeks} sem)`,
    description: `Programa periodizado de ${input.durationWeeks} semanas (${daysCount} días/semana)${input.includeDeloadWeek ? ' con semana final de descarga' : ''}.`,
    goal: mappedGoal,
    frequencyDays: daysCount,
    isDefault: true,
    isMesocycle: true,
    mesocycleConfig: {
      durationWeeks: input.durationWeeks,
      splitName: daysCount <= 3 ? 'Full Body Periodizado' : 'Torso / Pierna + Especialización',
      includeDeloadWeek: input.includeDeloadWeek,
      currentWeek: 1,
      weeks,
    },
    days: baseDays,
    updatedAt: new Date().toISOString(),
  };
}

export function serializeWorkoutsToCsv(
  workouts: ExecutedWorkoutRecord[],
  sets: WorkoutSetRecord[]
): string {
  const headers = ['workoutId', 'fecha', 'rutina', 'estado', 'ejercicio', 'serie', 'tipo', 'pesoKg', 'reps', 'rir', '1RM_Epley'];
  const workoutMap = new Map(workouts.map(w => [w.id, w]));
  const rows = sets.map(s => {
    const w = workoutMap.get(s.executedWorkoutId);
    return [
      s.executedWorkoutId,
      (w?.startedAt ?? s.completedAt).slice(0, 10),
      `"${(w?.routineDayName || 'Sesión libre').replace(/"/g, '""')}"`,
      w?.status ?? 'unknown',
      `"${s.exerciseName.replace(/"/g, '""')}"`,
      String(s.setNumber),
      s.type,
      String(s.weightKg),
      String(s.reps),
      String(s.rir),
      String(s.estimated1RM),
    ].join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}
