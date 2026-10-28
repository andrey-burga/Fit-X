import { WorkoutSetType } from '../types/workout';

export interface EpleyResult {
  value: number;
  isReliable: boolean;
  warning?: string;
  submaximalPercentages: {
    percentage: number;
    weightKg: number;
    recommendedReps: string;
  }[];
}

/**
 * Calculates estimated 1RM using the validated Epley formula:
 * 1RM = weightKg * (1 + reps / 30)
 *
 * For reps = 1, 1RM is exactly weightKg.
 * For reps > 10, the calculation is flagged with a reliability warning.
 */
export function calculateEpley1RM(weightKg: number, reps: number): EpleyResult {
  if (weightKg <= 0 || reps <= 0) {
    return {
      value: 0,
      isReliable: true,
      submaximalPercentages: [],
    };
  }

  let raw1RM = reps === 1 ? weightKg : weightKg * (1 + reps / 30);
  const rounded1RM = Math.round(raw1RM * 10) / 10;
  const isReliable = reps <= 10;
  const warning = !isReliable
    ? 'Menor confiabilidad: por encima de 10-12 repeticiones la fatiga metabólica y glucolítica reduce la precisión predictiva de 1RM.'
    : undefined;

  const submaximalPercentages = [
    {
      percentage: 95,
      weightKg: Math.round(rounded1RM * 0.95 * 10) / 10,
      recommendedReps: '1 - 2 reps (Fuerza Máxima)',
    },
    {
      percentage: 90,
      weightKg: Math.round(rounded1RM * 0.90 * 10) / 10,
      recommendedReps: '3 - 4 reps (Fuerza / Tensión)',
    },
    {
      percentage: 85,
      weightKg: Math.round(rounded1RM * 0.85 * 10) / 10,
      recommendedReps: '5 - 6 reps (Fuerza / Hipertrofia)',
    },
    {
      percentage: 80,
      weightKg: Math.round(rounded1RM * 0.80 * 10) / 10,
      recommendedReps: '7 - 8 reps (Hipertrofia Miofibrilar)',
    },
    {
      percentage: 70,
      weightKg: Math.round(rounded1RM * 0.70 * 10) / 10,
      recommendedReps: '10 - 12 reps (Hipertrofia Sarcoplásmica)',
    },
  ];

  return {
    value: rounded1RM,
    isReliable,
    warning,
    submaximalPercentages,
  };
}

/**
 * Calculates total session volume tonnage (kg).
 * CRITICAL RULE: Warm-up sets (type === 'warmup') MUST be excluded from the calculation.
 * Only completed effective, dropset, or failure sets are accumulated.
 */
export function calculateSessionTonnage(
  sets: { weightKg: number; reps: number; type: WorkoutSetType | string; completed: boolean }[]
): number {
  return sets.reduce((acc, set) => {
    if (!set.completed) return acc;
    if (set.type === 'warmup') return acc;
    return acc + Math.round(set.weightKg * set.reps);
  }, 0);
}

/**
 * Calculates average RIR for completed effective sets.
 */
export function calculateAverageRir(
  sets: { rir?: number | null; type: WorkoutSetType | string; completed: boolean }[]
): number {
  const effectiveSets = sets.filter(s => s.completed && s.type !== 'warmup' && s.rir !== null && s.rir !== undefined);
  if (effectiveSets.length === 0) return 0;
  const totalRir = effectiveSets.reduce((sum, s) => sum + (s.rir ?? 0), 0);
  return Math.round((totalRir / effectiveSets.length) * 10) / 10;
}
