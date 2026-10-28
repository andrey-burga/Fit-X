/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Seed data generator for VigorCore Demo Mode (Increment 6F)
 * Generates realistic 5-week (35-day) training history for demo user 'demo_camilo'
 * with primary compound lifts, warmup/effective sets, session RPE, duration, and RIR.
 */

import { ExecutedWorkout, LiveExerciseSession, LiveWorkoutSet } from '../types/workout';
import { calculateEpley1RM, calculateSessionTonnage, calculateAverageRir } from '../utils/workoutCalculations';
import { getLocalDateString } from '../services/dateUtils';

export function createDemoExecutedWorkoutsHistory(userId: string = 'demo_camilo', now: Date = new Date()): ExecutedWorkout[] {
  const workouts: ExecutedWorkout[] = [];

  // Routine templates for Torso & Pierna
  const torsoExercises = [
    { id: 'barbell_bench_press', name: 'Press de Banca Plano con Barra', muscle: 'pecho', pattern: 'empuje_horizontal', baseWeight: 80, reps: 8 },
    { id: 'pendlay_barbell_row', name: 'Remo con Barra Pendlay (90°)', muscle: 'espalda', pattern: 'traccion_horizontal', baseWeight: 70, reps: 8 },
    { id: 'standing_overhead_press', name: 'Press Militar de Pie con Barra (OHP)', muscle: 'hombros', pattern: 'empuje_vertical', baseWeight: 50, reps: 8 },
  ];

  const legExercises = [
    { id: 'barbell_back_squat', name: 'Sentadilla Trasera con Barra (Barra Alta)', muscle: 'cuadriceps', pattern: 'sentadilla', baseWeight: 105, reps: 7 },
    { id: 'conventional_deadlift_barbell', name: 'Peso Muerto Convencional con Barra', muscle: 'cuerpo_completo', pattern: 'bisagra_cadera', baseWeight: 125, reps: 6 },
  ];

  // Generate 5 weeks of workouts (3-4 days/week across the past 35 days)
  // Week 5 (oldest): Day 33, Day 31, Day 29
  // Week 4: Day 26, Day 24, Day 22
  // Week 3: Day 19, Day 17, Day 15
  // Week 2: Day 12, Day 10, Day 8
  // Week 1 (acute): Day 5, Day 3, Day 1
  const workoutDaysAgo = [33, 31, 29, 26, 24, 22, 19, 17, 15, 12, 10, 8, 5, 3, 1];

  workoutDaysAgo.forEach((daysAgo, idx) => {
    const isTorso = idx % 2 === 0;
    const sessionDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const dateStr = sessionDate.toISOString();
    const workoutId = `demo_exec_w_${35 - daysAgo}_${idx}`;

    // Micro-progression: slightly increase weight over the weeks (+1.25 to +2.5 kg every 2 weeks)
    const weekProgress = Math.floor((35 - daysAgo) / 7);
    const weightBonus = weekProgress * 1.25;

    const chosenExList = isTorso ? torsoExercises : legExercises;

    const exercisesSnapshot: LiveExerciseSession[] = chosenExList.map((exDef, exIdx) => {
      const currentWeight = exDef.baseWeight + weightBonus;
      const sets: LiveWorkoutSet[] = [
        // 1 Warmup set (must be excluded from tonnage and PRs!)
        {
          id: `demo_set_wup_${workoutId}_${exIdx}_0`,
          setNumber: 1,
          type: 'warmup',
          weightKg: Math.round(currentWeight * 0.5),
          reps: 10,
          rir: 5,
          completed: true,
          estimated1RM: calculateEpley1RM(Math.round(currentWeight * 0.5), 10).value,
          completedAt: dateStr,
        },
        // 3 Effective sets
        {
          id: `demo_set_eff_${workoutId}_${exIdx}_1`,
          setNumber: 2,
          type: 'effective',
          weightKg: currentWeight,
          reps: exDef.reps,
          rir: 2,
          completed: true,
          estimated1RM: calculateEpley1RM(currentWeight, exDef.reps).value,
          completedAt: dateStr,
        },
        {
          id: `demo_set_eff_${workoutId}_${exIdx}_2`,
          setNumber: 3,
          type: 'effective',
          weightKg: currentWeight,
          reps: exDef.reps,
          rir: 1,
          completed: true,
          estimated1RM: calculateEpley1RM(currentWeight, exDef.reps).value,
          completedAt: dateStr,
        },
        {
          id: `demo_set_eff_${workoutId}_${exIdx}_3`,
          setNumber: 4,
          type: 'effective',
          weightKg: currentWeight,
          reps: Math.max(5, exDef.reps - 1),
          rir: 1,
          completed: true,
          estimated1RM: calculateEpley1RM(currentWeight, Math.max(5, exDef.reps - 1)).value,
          completedAt: dateStr,
        },
      ];

      return {
        configId: `demo_cfg_${exDef.id}`,
        exerciseId: exDef.id,
        exerciseName: exDef.name,
        muscleGroup: exDef.muscle as any,
        movementPattern: exDef.pattern as any,
        equipment: 'barra',
        restSeconds: 120,
        sets,
      };
    });

    const allSets = exercisesSnapshot.flatMap(e => e.sets);
    const totalTonnageKg = calculateSessionTonnage(allSets);
    const totalCompletedSets = allSets.filter(s => s.completed && s.type !== 'warmup').length;
    const totalReps = allSets.filter(s => s.completed && s.type !== 'warmup').reduce((acc, s) => acc + s.reps, 0);
    const averageRir = calculateAverageRir(allSets);
    const durationSeconds = 3600 + (idx % 4) * 180;
    const sessionRpe = 8.0 + (idx % 3) * 0.5;

    workouts.push({
      id: workoutId,
      userId,
      routineId: 'template_torso_pierna_4d',
      routineName: 'Rutina Torso / Pierna Frecuencia 2',
      routineDayId: isTorso ? 'd1' : 'd2',
      routineDayName: isTorso ? 'Día 1: Torso Pesado' : 'Día 2: Pierna Pesada',
      status: 'completed',
      startedAt: dateStr,
      completedAt: new Date(sessionDate.getTime() + durationSeconds * 1000).toISOString(),
      durationSeconds,
      totalTonnageKg,
      totalCompletedSets,
      totalReps,
      averageRir,
      sessionRpe,
      notes: `Sesión ${isTorso ? 'Torso' : 'Pierna'} completada con buena técnica y RIR 1-2.`,
      exercisesSnapshot,
    });
  });

  return workouts;
}
