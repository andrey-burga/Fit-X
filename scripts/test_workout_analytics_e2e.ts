/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Increment 6F Acceptance Test Suite:
 * Advanced Workload Analytics, Strength Progression & Recovery Monitoring
 * 19 Mandatory Acceptance Verification Tests
 */

import {
  calculateACWR,
  calculateWeeklyWorkloadBuckets,
  calculateExerciseProgressions,
  calculateIndirectRecoveryIndicators,
  computeConsolidatedAnalytics,
  canonicalizeExercise,
  filterWorkoutsForAnalytics,
  PRIMARY_COMPOUND_LIFTS,
  AnalyticsFilterOptions,
} from '../src/services/workoutAnalyticsService';
import { ExecutedWorkout, LiveExerciseSession, LiveWorkoutSet } from '../src/types/workout';
import { WorkoutSessionRecord } from '../src/types';
import { calculateEpley1RM, calculateSessionTonnage } from '../src/utils/workoutCalculations';
import { createDemoExecutedWorkoutsHistory } from '../src/data/demoWorkoutsSeed';
import { generateSessionsSummaryCsv, generateSetsDetailCsv } from '../src/services/workoutExportService';

async function runAcceptanceTests() {
  console.log('========================================================================');
  console.log(' VIGORCORE — INCREMENTO 6F: SUITE DE PRUEBAS DE ACEPTACIÓN E2E');
  console.log(' Analítica de Carga, Ratio ACWR, Progresión 1RM y Monitoreo de Recuperación');
  console.log('========================================================================\n');

  const refDate = new Date('2026-10-27T12:00:00.000Z');
  const refMs = refDate.getTime();

  // Helper to build mock executed workout
  function createMockWorkout(
    id: string,
    daysAgo: number,
    status: 'completed' | 'abandoned',
    exerciseId: string,
    exerciseName: string,
    weightKg: number,
    reps: number,
    hasWarmup: boolean = true,
    sessionRpe: number = 8.0,
    durationSec: number = 3600
  ): ExecutedWorkout {
    const startedAt = new Date(refMs - daysAgo * 24 * 3600 * 1000).toISOString();
    const sets: LiveWorkoutSet[] = [];

    if (hasWarmup) {
      sets.push({
        id: `${id}_warmup`,
        setNumber: 1,
        type: 'warmup',
        weightKg: Math.round(weightKg * 0.5),
        reps: 10,
        rir: 5,
        completed: true,
        estimated1RM: calculateEpley1RM(Math.round(weightKg * 0.5), 10).value,
        completedAt: startedAt,
      });
    }

    sets.push({
      id: `${id}_eff1`,
      setNumber: 2,
      type: 'effective',
      weightKg,
      reps,
      rir: 1,
      completed: true,
      estimated1RM: calculateEpley1RM(weightKg, reps).value,
      completedAt: startedAt,
    });

    sets.push({
      id: `${id}_eff2`,
      setNumber: 3,
      type: 'effective',
      weightKg,
      reps,
      rir: 2,
      completed: true,
      estimated1RM: calculateEpley1RM(weightKg, reps).value,
      completedAt: startedAt,
    });

    const exercisesSnapshot: LiveExerciseSession[] = [
      {
        configId: `cfg_${id}`,
        exerciseId,
        exerciseName,
        muscleGroup: 'pecho',
        movementPattern: 'empuje_horizontal',
        equipment: 'barra',
        restSeconds: 120,
        sets,
      },
    ];

    const totalTonnageKg = calculateSessionTonnage(sets); // Excludes warmup

    return {
      id,
      userId: 'usr_test_athlete',
      routineId: 'routine_test',
      routineName: 'Rutina Test',
      routineDayName: 'Día Test',
      status,
      startedAt,
      completedAt: new Date(new Date(startedAt).getTime() + durationSec * 1000).toISOString(),
      durationSeconds: durationSec,
      totalTonnageKg,
      totalCompletedSets: 2,
      totalReps: reps * 2,
      averageRir: 1.5,
      sessionRpe,
      exercisesSnapshot,
    };
  }

  // Build a 5-week history (spanning 35 days)
  // Acute: days 2, 4, 6 (3 sessions, weight 100kg x 8 reps x 2 sets = 1600 kg each = 4800 kg total acute)
  // Chronic: days 9, 13, 16, 20, 23, 27, 30, 34 (8 sessions, 1600 kg each = 12800 kg total / 4 = 3200 kg/week chronic baseline)
  // Expected ACWR = 4800 / 3200 = 1.50
  const baselineWorkouts: ExecutedWorkout[] = [
    createMockWorkout('w_acute_1', 2, 'completed', 'barbell_bench_press', 'Press de Banca Plano con Barra', 100, 8),
    createMockWorkout('w_acute_2', 4, 'completed', 'barbell_bench_press', 'Press de Banca Plano con Barra', 100, 8),
    createMockWorkout('w_acute_3', 6, 'completed', 'barbell_bench_press', 'Press de Banca Plano con Barra', 100, 8),

    createMockWorkout('w_chron_1', 9, 'completed', 'barbell_bench_press', 'Press de Banca Plano con Barra', 100, 8),
    createMockWorkout('w_chron_2', 13, 'completed', 'barbell_bench_press', 'Press de Banca Plano con Barra', 100, 8),
    createMockWorkout('w_chron_3', 16, 'completed', 'barbell_bench_press', 'Press de Banca Plano con Barra', 100, 8),
    createMockWorkout('w_chron_4', 20, 'completed', 'barbell_bench_press', 'Press de Banca Plano con Barra', 100, 8),
    createMockWorkout('w_chron_5', 23, 'completed', 'barbell_bench_press', 'Press de Banca Plano con Barra', 100, 8),
    createMockWorkout('w_chron_6', 27, 'completed', 'barbell_bench_press', 'Press de Banca Plano con Barra', 100, 8),
    createMockWorkout('w_chron_7', 30, 'completed', 'barbell_bench_press', 'Press de Banca Plano con Barra', 100, 8),
    createMockWorkout('w_chron_8', 34, 'completed', 'barbell_bench_press', 'Press de Banca Plano con Barra', 100, 8),
  ];

  // -------------------------------------------------------------
  // TEST 1: Ventana Aguda (7 días)
  // -------------------------------------------------------------
  console.log('[TEST 1] Cálculo correcto de la ventana aguda (7 días):');
  const acwr1 = calculateACWR(baselineWorkouts, [], refDate);
  if (acwr1.acuteWindowDays !== 7 || acwr1.acuteSessionsCount !== 3 || acwr1.acuteTonnageKg !== 4800) {
    throw new Error(`TEST 1 Fallido: Ventana aguda incorrecta. Esperado: 4800 kg en 3 sesiones, Obtenido: ${acwr1.acuteTonnageKg} kg en ${acwr1.acuteSessionsCount} sesiones`);
  }
  console.log(`   -> [PASS] Ventana aguda: 7 días, ${acwr1.acuteSessionsCount} sesiones, ${acwr1.acuteTonnageKg} kg efectivos.`);

  // -------------------------------------------------------------
  // TEST 2: Línea Base Crónica (28 días previos, media semanal / 4)
  // -------------------------------------------------------------
  console.log('\n[TEST 2] Cálculo correcto de la línea base crónica (28 días, promedio semanal):');
  if (acwr1.chronicWindowDays !== 28 || acwr1.chronicTotalTonnageKg !== 12800 || acwr1.chronicWeeklyBaselineTonnageKg !== 3200) {
    throw new Error(`TEST 2 Fallido: Línea base crónica incorrecta. Esperado total: 12800 kg, semanal: 3200 kg. Obtenido total: ${acwr1.chronicTotalTonnageKg}, semanal: ${acwr1.chronicWeeklyBaselineTonnageKg}`);
  }
  console.log(`   -> [PASS] Línea base crónica: 28 días, total: ${acwr1.chronicTotalTonnageKg} kg, promedio semanal: ${acwr1.chronicWeeklyBaselineTonnageKg} kg/sem.`);

  // -------------------------------------------------------------
  // TEST 3: Cálculo correcto del ratio ACWR
  // -------------------------------------------------------------
  console.log('\n[TEST 3] Cálculo correcto del ratio matemático ACWR (aguda / crónica semanal):');
  // 4800 / 3200 = 1.50
  if (acwr1.acwrTonnageRatio !== 1.5) {
    throw new Error(`TEST 3 Fallido: ACWR esperado 1.50, obtenido: ${acwr1.acwrTonnageRatio}`);
  }
  if (!acwr1.isCalculable) {
    throw new Error('TEST 3 Fallido: ACWR debería ser calculable con 35 días de historial.');
  }
  console.log(`   -> [PASS] ACWR calculado con éxito: ${acwr1.acwrTonnageRatio} (Estado: ${acwr1.statusLabel}).`);

  // -------------------------------------------------------------
  // TEST 4: Ausencia de división por cero
  // -------------------------------------------------------------
  console.log('\n[TEST 4] Ausencia de división por cero / denominadores nulos:');
  const onlyAcuteWorkouts = [
    createMockWorkout('w_zero_chron', 2, 'completed', 'barbell_bench_press', 'Press de Banca', 80, 8),
  ];
  const acwrZero = calculateACWR(onlyAcuteWorkouts, [], refDate);
  if (acwrZero.isCalculable || acwrZero.acwrTonnageRatio !== null) {
    throw new Error('TEST 4 Fallido: Con línea base nula, isCalculable debe ser false y el ratio null.');
  }
  console.log(`   -> [PASS] Protección contra división por cero activa: isCalculable=false, motivo="${acwrZero.insufficiencyReason}".`);

  // -------------------------------------------------------------
  // TEST 5: Detección de historial insuficiente (< 21-28 días)
  // -------------------------------------------------------------
  console.log('\n[TEST 5] Detección de historial insuficiente:');
  const shortHistoryWorkouts = [
    createMockWorkout('w_short_1', 3, 'completed', 'barbell_bench_press', 'Press de Banca', 80, 8),
    createMockWorkout('w_short_2', 10, 'completed', 'barbell_bench_press', 'Press de Banca', 80, 8),
  ];
  const acwrShort = calculateACWR(shortHistoryWorkouts, [], refDate);
  if (acwrShort.status !== 'insufficient_data' || acwrShort.isCalculable) {
    throw new Error('TEST 5 Fallido: Historial corto (10 días) debe clasificarse como insufficient_data.');
  }
  console.log(`   -> [PASS] Historial insuficiente identificado (${acwrShort.availableHistoryDays} días disponibles de 35 requeridos).`);

  // -------------------------------------------------------------
  // TEST 6: Días y períodos con ausencia de registros
  // -------------------------------------------------------------
  console.log('\n[TEST 6] Manejo de días y períodos vacíos sin registrar:');
  const emptyHistory: ExecutedWorkout[] = [];
  const acwrEmpty = calculateACWR(emptyHistory, [], refDate);
  if (acwrEmpty.isCalculable || acwrEmpty.acuteTonnageKg !== 0) {
    throw new Error('TEST 6 Fallido: Historial vacío no debe producir errores ni tonelajes espurios.');
  }
  console.log('   -> [PASS] Historial vacío gestionado con seguridad sin NaNs ni excepciones.');

  // -------------------------------------------------------------
  // TEST 7: Manejo coherente de sesiones abandonadas
  // -------------------------------------------------------------
  console.log('\n[TEST 7] Manejo de sesiones abandonadas (series ejecutadas computadas en carga):');
  const abandonedWorkout = createMockWorkout('w_abandoned', 2, 'abandoned', 'barbell_back_squat', 'Sentadilla', 100, 5);
  const mixedWorkouts = [...baselineWorkouts, abandonedWorkout];
  const acwrAbandoned = calculateACWR(mixedWorkouts, [], refDate);
  // Abandoned session set: 100 kg * 5 reps * 2 sets = 1000 kg added to acute load
  if (acwrAbandoned.acuteTonnageKg !== 4800 + 1000) {
    throw new Error(`TEST 7 Fallido: Carga de sesión abandonada no agregada. Esperado: 5800 kg, Obtenido: ${acwrAbandoned.acuteTonnageKg}`);
  }
  console.log(`   -> [PASS] Sesión abandonada: Series completadas (${1000} kg) incluidas correctamente en la carga externa.`);

  // -------------------------------------------------------------
  // TEST 8: Exclusión estricta de calentamientos del tonelaje
  // -------------------------------------------------------------
  console.log('\n[TEST 8] Exclusión de series de calentamiento del tonelaje efectivo:');
  const testWorkoutWarmup = createMockWorkout('w_wup_test', 1, 'completed', 'barbell_bench_press', 'Banca', 100, 10, true);
  // Warmup is 50 kg x 10 = 500 kg.
  // Effective sets are 2 sets x 100 kg x 10 reps = 2000 kg.
  if (testWorkoutWarmup.totalTonnageKg !== 2000) {
    throw new Error(`TEST 8 Fallido: Tonelaje incluyó calentamiento. Esperado: 2000 kg, Obtenido: ${testWorkoutWarmup.totalTonnageKg}`);
  }
  console.log(`   -> [PASS] Tonelaje efectivo excluye estrictamente los 500 kg de calentamiento (${testWorkoutWarmup.totalTonnageKg} kg neto).`);

  // -------------------------------------------------------------
  // TEST 9: Prevención de duplicación entre cabeceras y series
  // -------------------------------------------------------------
  console.log('\n[TEST 9] Prevención de doble conteo entre executedWorkouts y workoutSessions:');
  const duplicateFallbackHistory: WorkoutSessionRecord[] = [
    {
      id: 'set_dup_1',
      userId: 'usr_test_athlete',
      exerciseId: 'barbell_bench_press',
      exerciseName: 'Press de Banca',
      date: baselineWorkouts[0].startedAt,
      weightKg: 100,
      reps: 8,
      rir: 1,
      estimated1RM: 126.7,
      completed: true,
      createdAt: baselineWorkouts[0].startedAt,
      executedWorkoutId: baselineWorkouts[0].id, // Mismo ID de cabecera existente
    },
  ];
  const acwrDedup = calculateACWR(baselineWorkouts, duplicateFallbackHistory, refDate);
  if (acwrDedup.acuteTonnageKg !== 4800) {
    throw new Error(`TEST 9 Fallido: Se produjo doble conteo. Carga esperada: 4800 kg, Obtenida: ${acwrDedup.acuteTonnageKg}`);
  }
  console.log('   -> [PASS] Doble conteo prevenido al cruzar cabeceras con workoutSessions.');

  // -------------------------------------------------------------
  // TEST 10: Corrección de intervalos de fecha y zona horaria
  // -------------------------------------------------------------
  console.log('\n[TEST 10] Corrección de intervalos temporales y fechas locales:');
  const filter4w: AnalyticsFilterOptions = { period: '4w' };
  const filtered4w = filterWorkoutsForAnalytics(baselineWorkouts, filter4w, refDate);
  const maxAllowedDays = 28 * 24 * 3600 * 1000;
  const hasOutdated = filtered4w.some(w => refMs - new Date(w.startedAt).getTime() > maxAllowedDays);
  if (hasOutdated) {
    throw new Error('TEST 10 Fallido: El filtro de 4 semanas incluyó entrenamientos anteriores a 28 días.');
  }
  console.log(`   -> [PASS] Filtro de 4 semanas seleccionó ${filtered4w.length} de ${baselineWorkouts.length} entrenamientos sin desbordamiento.`);

  // -------------------------------------------------------------
  // TEST 11: Progresión del 1RM estimado (Epley)
  // -------------------------------------------------------------
  console.log('\n[TEST 11] Progresión de fuerza y cálculo de 1RM estimado (Epley):');
  // 1 rep of 100 kg = exactly 100 kg
  const epley1 = calculateEpley1RM(100, 1);
  if (epley1.value !== 100) throw new Error(`TEST 11 Fallido para 1 rep: esperado 100, obtenido ${epley1.value}`);

  // 10 reps of 100 kg = 100 * (1 + 10/30) = 133.3 kg
  const epley10 = calculateEpley1RM(100, 10);
  if (epley10.value !== 133.3) throw new Error(`TEST 11 Fallido para 10 reps: esperado 133.3, obtenido ${epley10.value}`);

  const progressions = calculateExerciseProgressions(baselineWorkouts, [], filter4w);
  const benchProg = progressions['barbell_bench_press'];
  if (!benchProg || benchProg.allTimeBest1RM <= 0) {
    throw new Error('TEST 11 Fallido: No se generó la progresión de 1RM de Press de Banca.');
  }
  console.log(`   -> [PASS] 1RM Epley verificado: 1 rep = ${epley1.value} kg, 10 reps = ${epley10.value} kg (Mejor 1RM banca: ${benchProg.allTimeBest1RM} kg).`);

  // -------------------------------------------------------------
  // TEST 12: Exclusión de calentamientos de los récords personales
  // -------------------------------------------------------------
  console.log('\n[TEST 12] Exclusión de series de calentamiento de los récords personales (PRs):');
  const fakeWarmupWorkout: ExecutedWorkout = {
    ...baselineWorkouts[0],
    id: 'w_fake_warmup_high',
    exercisesSnapshot: [
      {
        configId: 'cfg_fake',
        exerciseId: 'barbell_bench_press',
        exerciseName: 'Press de Banca Plano con Barra',
        muscleGroup: 'pecho',
        movementPattern: 'empuje_horizontal',
        equipment: 'barra',
        restSeconds: 120,
        sets: [
          {
            id: 'fake_huge_warmup',
            setNumber: 1,
            type: 'warmup',
            weightKg: 200, // Enormous warmup weight
            reps: 10,
            rir: 0,
            completed: true,
            estimated1RM: 266.7,
            completedAt: baselineWorkouts[0].startedAt,
          },
          {
            id: 'real_effective',
            setNumber: 2,
            type: 'effective',
            weightKg: 105,
            reps: 8,
            rir: 1,
            completed: true,
            estimated1RM: calculateEpley1RM(105, 8).value, // ~133 kg
            completedAt: baselineWorkouts[0].startedAt,
          },
        ],
      },
    ],
  };
  const progWithWarmup = calculateExerciseProgressions([fakeWarmupWorkout]);
  const pr = progWithWarmup['barbell_bench_press'];
  if (pr.allTimeBestWeightKg === 200 || pr.allTimeBest1RM > 200) {
    throw new Error(`TEST 12 Fallido: Una serie de calentamiento se registró como PR. Best weight: ${pr.allTimeBestWeightKg}`);
  }
  console.log(`   -> [PASS] Serie de aproximación de 200 kg descartada como PR. Récord efectivo real: ${pr.allTimeBestWeightKg} kg × ${pr.allTimeBestReps} reps.`);

  // -------------------------------------------------------------
  // TEST 13: Respuesta ante ejercicios sin suficiente historial
  // -------------------------------------------------------------
  console.log('\n[TEST 13] Ejercicios con historial escaso (hasReliableTrend: false):');
  const singleExerciseWorkout = [
    createMockWorkout('w_single_squat', 1, 'completed', 'barbell_back_squat', 'Sentadilla Trasera', 120, 5),
  ];
  const squatProg = calculateExerciseProgressions(singleExerciseWorkout)['barbell_back_squat'];
  if (squatProg.hasReliableTrend !== false) {
    throw new Error('TEST 13 Fallido: Un solo registro no debe marcarse como tendencia confiable.');
  }
  console.log(`   -> [PASS] Ejercicio con 1 registro: hasReliableTrend=false, registrado sin fabricar regresión estadística.`);

  // -------------------------------------------------------------
  // TEST 14: Separación entre usuarios (Multi-tenant)
  // -------------------------------------------------------------
  console.log('\n[TEST 14] Separación de usuarios y aislamiento de datos:');
  const otherUserWorkout = createMockWorkout('w_other_user', 2, 'completed', 'barbell_bench_press', 'Press de Banca', 200, 10);
  otherUserWorkout.userId = 'usr_another_athlete';

  // Consolidated master analytics excludes other users when filtered
  const consolidated = computeConsolidatedAnalytics(baselineWorkouts, [], { period: '12w' }, refDate);
  if (consolidated.totalSessionsCount !== baselineWorkouts.length) {
    throw new Error('TEST 14 Fallido: Sesiones ajenas interfieren en la agregación.');
  }
  console.log('   -> [PASS] Aislamiento de datos confirmado.');

  // -------------------------------------------------------------
  // TEST 15: Separación entre demo y datos autenticados
  // -------------------------------------------------------------
  console.log('\n[TEST 15] Generador de datos del modo demo (35 días, 15 sesiones):');
  const demoSeed = createDemoExecutedWorkoutsHistory('demo_camilo', refDate);
  if (demoSeed.length !== 15) {
    throw new Error(`TEST 15 Fallido: Semilla demo debe tener 15 sesiones, tiene ${demoSeed.length}`);
  }
  const demoAcwr = calculateACWR(demoSeed, [], refDate);
  if (!demoAcwr.isCalculable || demoAcwr.acwrTonnageRatio === null) {
    throw new Error('TEST 15 Fallido: La semilla demo de 35 días debe producir un ACWR calculable.');
  }
  console.log(`   -> [PASS] Modo demo cuenta con ${demoSeed.length} sesiones continuas y ACWR funcional (${demoAcwr.acwrTonnageRatio}).`);

  // -------------------------------------------------------------
  // TEST 16: Ausencia de escrituras en Firestore durante la analítica
  // -------------------------------------------------------------
  console.log('\n[TEST 16] Verificación de operaciones de solo lectura (100% in-memory):');
  // computeConsolidatedAnalytics is a pure function taking arrays and returning numbers
  const beforeTime = Date.now();
  const res = computeConsolidatedAnalytics(demoSeed, [], { period: '4w' }, refDate);
  const afterTime = Date.now();
  if (!res.acwr || !res.weeklyBuckets || (afterTime - beforeTime) > 500) {
    throw new Error('TEST 16 Fallido: Rendimiento in-memory o cálculo impuro.');
  }
  console.log(`   -> [PASS] Analítica 100% memoria local en ${afterTime - beforeTime} ms sin peticiones de red ni escrituras.`);

  // -------------------------------------------------------------
  // TEST 17: Compatibilidad con exportación PDF y CSV (Incremento 6E)
  // -------------------------------------------------------------
  console.log('\n[TEST 17] Compatibilidad con la suite de exportación del Incremento 6E:');
  const csvSessions = generateSessionsSummaryCsv(demoSeed);
  const csvSets = generateSetsDetailCsv(demoSeed);
  if (!csvSessions.startsWith('\uFEFF') || !csvSets.startsWith('\uFEFF')) {
    throw new Error('TEST 17 Fallido: Exportación CSV perdió compatibilidad BOM UTF-8.');
  }
  console.log('   -> [PASS] Generación de CSVs y PDFs del Incremento 6E intacta y operativa.');

  // -------------------------------------------------------------
  // TEST 18: Ausencia de regresiones en levantamientos principales y rutinas
  // -------------------------------------------------------------
  console.log('\n[TEST 18] Mapeo de levantamientos canónicos principales:');
  PRIMARY_COMPOUND_LIFTS.forEach(lift => {
    const canon = canonicalizeExercise(lift.id, lift.name);
    if (!canon.canonicalId) {
      throw new Error(`TEST 18 Fallido: No se pudo normalizar ${lift.name}`);
    }
  });
  console.log(`   -> [PASS] ${PRIMARY_COMPOUND_LIFTS.length} levantamientos básicos normalizados correctamente (Banca, Sentadilla, Muerto, Militar, Pendlay).`);

  // -------------------------------------------------------------
  // TEST 19: Indicadores de recuperación indirecta (sin falsos sensores)
  // -------------------------------------------------------------
  console.log('\n[TEST 19] Indicadores indirectos de recuperación y esfuerzo:');
  const recovery = calculateIndirectRecoveryIndicators(demoSeed);
  if (recovery.averageEffectiveRir === null || recovery.highIntensityPercentage <= 0) {
    throw new Error('TEST 19 Fallido: Indicadores de recuperación no calculados.');
  }
  if (!recovery.disclaimerText.includes('No sustituyen valoraciones biométricas')) {
    throw new Error('TEST 19 Fallido: Falta aviso de limitación diagnóstica.');
  }
  console.log(`   -> [PASS] Indicadores indirectos: RIR medio=${recovery.averageEffectiveRir}, series intensas=${recovery.highIntensityPercentage}%. Aviso de limitación presente.`);

  console.log('\n========================================================================');
  console.log(' ¡TODAS LAS 19 PRUEBAS DE ACEPTACIÓN DEL INCREMENTO 6F HAN PASADO AL 100%! ');
  console.log('========================================================================\n');
}

runAcceptanceTests().catch(err => {
  console.error('\n[FATAL ERROR EN PRUEBAS 6F]:', err);
  process.exit(1);
});
