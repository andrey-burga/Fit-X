/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Incremento 7B: Generador Inteligente de Mesociclos y Periodización
 * Definiciones de tipos para planificación multisesión, estructuras semanales,
 * progresión semanal y seguimiento de adherencia.
 */

import { AthleteGoal, TrainingExperience } from './auth';
import {
  EquipmentRequired,
  MuscleGroup,
  MovementPattern,
  PlannedExerciseConfig,
  RoutineDay,
  WorkoutRoutine,
} from './workout';

export type MesocycleDurationWeeks = 4 | 6 | 8;

export type SplitStructureId =
  | 'full_body_2d'
  | 'full_body_3d'
  | 'torso_pierna_4d'
  | 'push_pull_legs_3d'
  | 'torso_pierna_fullbody_3d'
  | 'ppl_upper_lower_5d'
  | 'push_pull_legs_6d';

export interface SplitStructureDefinition {
  id: SplitStructureId;
  name: string;
  daysPerWeek: number;
  description: string;
  suitableExperience: TrainingExperience[];
  suitableGoals: AthleteGoal[];
  rationale: string;
  dayTemplates: {
    dayId: string;
    name: string;
    shortName: string;
    focusDescription: string;
    primaryMuscleGroups: MuscleGroup[];
    secondaryMuscleGroups: MuscleGroup[];
  }[];
}

export interface MesocycleWeekPrescription {
  weekNumber: number;
  name: string;
  focus: string;
  isDeload: boolean;
  volumeMultiplier: number;  // 1.0 = base, 1.1 = sobrecarga, 0.65 = descarga
  intensityRirTarget: number; // Ej: Sem 1: 3, Sem 2: 2, Sem 3: 1, Sem 4: 4 (descarga)
  loadIncrementStrategy: 'baseline' | 'reps_progression' | 'micro_load' | 'deload_recovery';
  days: RoutineDay[];
}

export interface MesocycleConfig {
  durationWeeks: MesocycleDurationWeeks;
  splitStructure: SplitStructureId;
  splitStructureName: string;
  athleteGoal: AthleteGoal;
  experience: TrainingExperience;
  targetSessionDurationMinutes: number;
  availableEquipment: EquipmentRequired[];
  musclePriorities?: MuscleGroup[];
  hasDeloadWeek: boolean;
  deloadWeekIndex?: number; // Ej: semana 4 (si dura 4), o semana 6 (si dura 6)
  currentWeek: number;      // 1-indexed (1, 2, ..., durationWeeks)
  weeks: MesocycleWeekPrescription[];
  completedSessions: {
    weekNumber: number;
    dayId: string;
    executedWorkoutId?: string;
    completedAt: string;
  }[];
}

export interface MesocycleRoutine extends WorkoutRoutine {
  isMesocycle: true;
  mesocycleConfig: MesocycleConfig;
}

export interface MesocycleGenerationInput {
  name?: string;
  athleteGoal: AthleteGoal;
  experience: TrainingExperience;
  daysPerWeek: number;
  targetSessionDurationMinutes: number;
  availableEquipment: EquipmentRequired[];
  musclePriorities?: MuscleGroup[];
  durationWeeks: MesocycleDurationWeeks;
  splitStructure?: SplitStructureId;
  includeDeloadWeek: boolean;
}

export interface MesocycleGenerationResult {
  program: MesocycleRoutine;
  rationale: string[];
  warnings: string[];
  estimatedWeeklyTimeMinutes: number;
  muscleVolumeBreakdown: Record<MuscleGroup, number>; // series efectivas por semana
}
