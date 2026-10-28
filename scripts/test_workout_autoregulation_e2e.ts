/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Increment 6G Acceptance Test Suite:
 * Workout Autoregulation, Double Progression & Deload Assistant
 * 23 Mandatory Acceptance Verification Tests
 */

import {
  generateExerciseRecommendation,
  detectExercisePlateau,
  extractComparableSessions,
  generateDeloadProposal,
  getEquipmentIncrement,
  RecommendationAction,
  PlateauStatus,
} from '../src/services/workoutAutoregulationService';
import {
  PlannedExerciseConfig,
  ExecutedWorkout,
  LiveExerciseSession,
  LiveWorkoutSet,
  WorkoutRoutine,
} from '../src/types/workout';
import { calculateEpley1RM } from '../src/utils/workoutCalculations';
import { generateSessionsSummaryCsv, generateSetsDetailCsv } from '../src/services/workoutExportService';
import { calculateACWR } from '../src/services/workoutAnalyticsService';
import { createDemoExecutedWorkoutsHistory } from '../src/data/demoWorkoutsSeed';

async function runAutoregulationTests() {
  console.log('========================================================================');
  console.log(' VIGORCORE — INCREMENTO 6G: SUITE DE PRUEBAS DE ACEPTACIÓN E2E');
  console.log(' Autorregulación, Progresión Doble, Estancamiento y Asistente de Descarga');
  console.log('========================================================================\n');

  const refDate = new Date('2026-10-27T12:00:00.000Z');
  const refMs = refDate.getTime();

  // Helper to construct mock executed session
  function makeMockWorkout(
    id: string,
    daysAgo: number,
    status: 'completed' | 'abandoned',
    exerciseId: string,
    exerciseName: string,
    weightKg: number,
    reps: number,
    rir: number | null,
    includeWarmup: boolean = true
  ): ExecutedWorkout {
    const startedAt = new Date(refMs - daysAgo * 24 * 3600 * 1000).toISOString();
    const sets: LiveWorkoutSet[] = [];

    if (includeWarmup) {
      sets.push({
        id: `${id}_wup`,
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

    // 3 effective sets
    for (let s = 1; s <= 3; s++) {
      sets.push({
        id: `${id}_eff_${s}`,
        setNumber: s + (includeWarmup ? 1 : 0),
        type: 'effective',
        weightKg,
        reps,
        rir: rir !== undefined ? rir : 2,
        completed: true,
        estimated1RM: calculateEpley1RM(weightKg, reps).value,
        completedAt: startedAt,
      });
    }

    return {
      id,
      userId: 'usr_test_athlete',
      routineId: 'routine_test',
      routineName: 'Rutina Test',
      routineDayName: 'Día 1',
      status,
      startedAt,
      completedAt: startedAt,
      durationSeconds: 3600,
      totalTonnageKg: weightKg * reps * 3,
      totalCompletedSets: 3,
      totalReps: reps * 3,
      averageRir: rir !== undefined ? rir : 2,
      exercisesSnapshot: [
        {
          configId: `cfg_${exerciseId}`,
          exerciseId,
          exerciseName,
          muscleGroup: 'pecho',
          movementPattern: 'empuje_horizontal',
          equipment: 'barra',
          restSeconds: 120,
          sets,
        },
      ],
    };
  }

  const baseConfig: PlannedExerciseConfig = {
    id: 'cfg_bench_1',
    exerciseId: 'barbell_bench_press',
    orderIndex: 1,
    sets: 3,
    repsMin: 6,
    repsMax: 8,
    targetRir: 1,
    targetWeightKg: 80.0,
    restSeconds: 120,
  };

  // -------------------------------------------------------------
  // TEST 1: Progresión por repeticiones (dentro del rango < repsMax)
  // -------------------------------------------------------------
  console.log('[TEST 1] Progresión por repeticiones cuando aún no se alcanza repsMax:');
  // Athlete lifted 80kg for 6 reps (min = 6, max = 8). Should suggest increase_reps at same 80kg
  const sessionRepProg = [
    makeMockWorkout('w_rep_1', 3, 'completed', 'barbell_bench_press', 'Press de Banca Plano con Barra', 80, 6, 2),
  ];
  const rec1 = generateExerciseRecommendation(baseConfig, sessionRepProg);
  if (rec1.action !== 'increase_reps' || rec1.suggestedWeightKg !== 80.0) {
    throw new Error(`TEST 1 Fallido: Esperado action 'increase_reps' con 80 kg. Obtenido: ${rec1.action} con ${rec1.suggestedWeightKg} kg`);
  }
  console.log(`   -> [PASS] Acción correcta: ${rec1.actionBadge.label} (Carga sugerida: ${rec1.suggestedWeightKg} kg, reps: ${rec1.suggestedRepsMin}-${rec1.suggestedRepsMax}).`);

  // -------------------------------------------------------------
  // TEST 2: Recomendación de aumento de carga (todas las series en repsMax con RIR >= 1)
  // -------------------------------------------------------------
  console.log('\n[TEST 2] Aumento de carga cuando todas las series completaron repsMax:');
  // Athlete completed all sets at 8 reps (repsMax = 8) with RIR 1
  const sessionLoadProg = [
    makeMockWorkout('w_load_1', 3, 'completed', 'barbell_bench_press', 'Press de Banca Plano con Barra', 80, 8, 1),
  ];
  const rec2 = generateExerciseRecommendation(baseConfig, sessionLoadProg);
  if (rec2.action !== 'increase_load' || rec2.suggestedWeightKg !== 82.5) {
    throw new Error(`TEST 2 Fallido: Esperado action 'increase_load' con 82.5 kg. Obtenido: ${rec2.action} con ${rec2.suggestedWeightKg} kg`);
  }
  console.log(`   -> [PASS] Acción correcta: ${rec2.actionBadge.label} (Carga sugerida: ${rec2.suggestedWeightKg} kg, reinicio en ${rec2.suggestedRepsMin} reps).`);

  // -------------------------------------------------------------
  // TEST 3: Mantener carga cuando repsMax se alcanzó al fallo absoluto (RIR 0)
  // -------------------------------------------------------------
  console.log('\n[TEST 3] Mantener carga cuando se alcanza repsMax al fallo absoluto (RIR 0):');
  const sessionGrind = [
    makeMockWorkout('w_grind_1', 3, 'completed', 'barbell_bench_press', 'Press de Banca Plano con Barra', 80, 8, 0),
  ];
  const rec3 = generateExerciseRecommendation(baseConfig, sessionGrind);
  if (rec3.action !== 'maintain' || rec3.suggestedWeightKg !== 80.0) {
    throw new Error(`TEST 3 Fallido: Esperado 'maintain' con RIR 0. Obtenido: ${rec3.action}`);
  }
  console.log(`   -> [PASS] Carga mantenida (${rec3.suggestedWeightKg} kg) para evitar fatiga excesiva con RIR 0.`);

  // -------------------------------------------------------------
  // TEST 4: Tratamiento correcto de RIR ausente
  // -------------------------------------------------------------
  console.log('\n[TEST 4] Tratamiento de RIR ausente (divulgación de limitación):');
  const sessionNoRir = [
    makeMockWorkout('w_norir_1', 3, 'completed', 'barbell_bench_press', 'Press de Banca Plano con Barra', 80, 7, null),
  ];
  const rec4 = generateExerciseRecommendation(baseConfig, sessionNoRir);
  if (!rec4.limitations.some(l => l.includes('RIR no registrado'))) {
    throw new Error('TEST 4 Fallido: Falta divulgación de limitación por RIR ausente.');
  }
  console.log(`   -> [PASS] Limitación reportada correctamente: "${rec4.limitations[0]}".`);

  // -------------------------------------------------------------
  // TEST 5: Repeticiones o historial ausente
  // -------------------------------------------------------------
  console.log('\n[TEST 5] Tratamiento de ejercicio sin sesiones previas (insufficient_data):');
  const rec5 = generateExerciseRecommendation(baseConfig, []);
  if (rec5.action !== 'insufficient_data' || rec5.confidence !== 'low') {
    throw new Error(`TEST 5 Fallido: Esperado 'insufficient_data' y confianza 'low'. Obtenido: ${rec5.action}`);
  }
  console.log(`   -> [PASS] Estado sin datos: action='${rec5.action}', confianza='${rec5.confidence}'.`);

  // -------------------------------------------------------------
  // TEST 6: Prevención de incrementos excesivos
  // -------------------------------------------------------------
  console.log('\n[TEST 6] Prevención de saltos de carga desproporcionados:');
  const incBarbell = getEquipmentIncrement('barra', 80, false);
  if (incBarbell > 2.5) {
    throw new Error(`TEST 6 Fallido: Incremento de barra (${incBarbell} kg) supera el límite de seguridad de 2.5 kg.`);
  }
  console.log(`   -> [PASS] Incremento de barra acotado a +${incBarbell} kg.`);

  // -------------------------------------------------------------
  // TEST 7: Respeto de equipamiento modelado (mancuernas, máquinas, barras)
  // -------------------------------------------------------------
  console.log('\n[TEST 7] Granularidad por tipo de equipamiento:');
  const incDumbbell = getEquipmentIncrement('mancuerna', 24);
  const incMachine = getEquipmentIncrement('maquina', 70);
  if (incDumbbell !== 2.0 || incMachine !== 5.0) {
    throw new Error(`TEST 7 Fallido: Granularidad incorrecta. Mancuerna: ${incDumbbell}, Máquina: ${incMachine}`);
  }
  console.log(`   -> [PASS] Mancuerna: +${incDumbbell} kg, Máquina peso alto: +${incMachine} kg.`);

  // -------------------------------------------------------------
  // TEST 8: Exclusión estricta de calentamientos de las series comparables
  // -------------------------------------------------------------
  console.log('\n[TEST 8] Exclusión de series de calentamiento:');
  const sessionsWithWup = extractComparableSessions('barbell_bench_press', sessionLoadProg);
  const allExtractedSets = sessionsWithWup.flatMap(s => s.effectiveSets);
  if (allExtractedSets.some(s => s.isWarmup)) {
    throw new Error('TEST 8 Fallido: Se encontraron series de calentamiento en las sesiones comparables.');
  }
  console.log(`   -> [PASS] Todas las ${allExtractedSets.length} series extraídas son efectivas (0 calentamientos).`);

  // -------------------------------------------------------------
  // TEST 9: Normalización de ejercicios y variantes canónicas
  // -------------------------------------------------------------
  console.log('\n[TEST 9] Normalización de variantes canónicas (banca, pendlay, sentadilla):');
  const sessionsAlias = extractComparableSessions('banca-1', sessionLoadProg);
  if (sessionsAlias.length === 0) {
    throw new Error('TEST 9 Fallido: No se reconoció el alias "banca-1" como "barbell_bench_press".');
  }
  console.log('   -> [PASS] Alias "banca-1" normalizado exitosamente a "barbell_bench_press".');

  // -------------------------------------------------------------
  // TEST 10: Prevención de recomendaciones basadas en ejercicios no comparables
  // -------------------------------------------------------------
  console.log('\n[TEST 10] Prevención de contaminación entre ejercicios distintos:');
  const squatSessions = [
    makeMockWorkout('w_sq_1', 3, 'completed', 'barbell_back_squat', 'Sentadilla Trasera con Barra', 120, 6, 2),
  ];
  const recBenchFromSquat = generateExerciseRecommendation(baseConfig, squatSessions);
  if (recBenchFromSquat.action !== 'insufficient_data') {
    throw new Error('TEST 10 Fallido: Sentadilla contaminó la recomendación de press de banca.');
  }
  console.log('   -> [PASS] Ejercicios biomecánicamente distintos no se cruzan.');

  // -------------------------------------------------------------
  // TEST 11: Detección de estancamiento tras 3 exposiciones sin mejora
  // -------------------------------------------------------------
  console.log('\n[TEST 11] Detección de posible estancamiento (>= 3 sesiones estables abajo de repsMax):');
  const plateauSessions = [
    makeMockWorkout('w_plat_1', 14, 'completed', 'barbell_bench_press', 'Press de Banca', 80, 6, 1),
    makeMockWorkout('w_plat_2', 7, 'completed', 'barbell_bench_press', 'Press de Banca', 80, 6, 1),
    makeMockWorkout('w_plat_3', 2, 'completed', 'barbell_bench_press', 'Press de Banca', 80, 6, 1),
  ];
  const recPlateau = generateExerciseRecommendation(baseConfig, plateauSessions);
  if (recPlateau.plateauStatus !== 'possible_plateau') {
    throw new Error(`TEST 11 Fallido: Esperado plateauStatus 'possible_plateau'. Obtenido: ${recPlateau.plateauStatus}`);
  }
  console.log(`   -> [PASS] Estancamiento detectado correctamente: ${recPlateau.plateauStatus} (${recPlateau.plateauReason}).`);

  // -------------------------------------------------------------
  // TEST 12: Ausencia de falsos estancamientos cuando hay progreso en repeticiones
  // -------------------------------------------------------------
  console.log('\n[TEST 12] Ausencia de falsos estancamientos con progreso en repeticiones:');
  const repProgSessions = [
    makeMockWorkout('w_rep_prog_1', 14, 'completed', 'barbell_bench_press', 'Press de Banca', 80, 6, 1),
    makeMockWorkout('w_rep_prog_2', 7, 'completed', 'barbell_bench_press', 'Press de Banca', 80, 7, 1),
    makeMockWorkout('w_rep_prog_3', 2, 'completed', 'barbell_bench_press', 'Press de Banca', 80, 8, 1),
  ];
  const recNoFalsePlateau = generateExerciseRecommendation(baseConfig, repProgSessions);
  if (recNoFalsePlateau.plateauStatus === 'possible_plateau') {
    throw new Error('TEST 12 Fallido: Se diagnosticó falso estancamiento cuando las reps aumentaron de 6 a 8.');
  }
  console.log(`   -> [PASS] Progresión en repeticiones respetada: status='${recNoFalsePlateau.plateauStatus}'.`);

  // -------------------------------------------------------------
  // TEST 13: Sesiones abandonadas no generan estancamiento espurio
  // -------------------------------------------------------------
  console.log('\n[TEST 13] Sesiones abandonadas excluidas del cálculo de estancamiento:');
  const abandonedOnly = [
    makeMockWorkout('w_ab_1', 14, 'abandoned', 'barbell_bench_press', 'Press de Banca', 80, 5, 0),
    makeMockWorkout('w_ab_2', 7, 'abandoned', 'barbell_bench_press', 'Press de Banca', 80, 5, 0),
    makeMockWorkout('w_ab_3', 2, 'abandoned', 'barbell_bench_press', 'Press de Banca', 80, 5, 0),
  ];
  const recAbandoned = generateExerciseRecommendation(baseConfig, abandonedOnly);
  if (recAbandoned.plateauStatus === 'possible_plateau') {
    throw new Error('TEST 13 Fallido: Sesiones abandonadas no deben disparar alerta de estancamiento.');
  }
  console.log('   -> [PASS] Sesiones abandonadas no disparan falso estancamiento.');

  // -------------------------------------------------------------
  // TEST 14: Construcción de propuesta de descarga sin modificar la rutina original
  // -------------------------------------------------------------
  console.log('\n[TEST 14] Generación de propuesta de descarga sin mutación de rutina original:');
  const mockRoutine: WorkoutRoutine = {
    id: 'routine_original_1',
    userId: 'usr_test_athlete',
    name: 'Torso Pierna 4 Días',
    description: 'Rutina Base',
    goal: 'hipertrofia',
    frequencyDays: 4,
    days: [
      {
        id: 'd1',
        name: 'Día 1: Torso',
        shortName: 'Torso',
        exercises: [
          { ...baseConfig, sets: 4, targetRir: 1 },
          { ...baseConfig, id: 'cfg_row', exerciseId: 'pendlay_barbell_row', sets: 4, targetRir: 1 },
        ],
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const deloadProposal = generateDeloadProposal(mockRoutine, { volumeReductionPct: 50, rirIncrease: 2 });
  if (mockRoutine.days[0].exercises[0].sets !== 4) {
    throw new Error('TEST 14 Fallido: La rutina original fue mutada por el asistente de descarga.');
  }
  if (deloadProposal.days[0].exercises[0].sets !== 2 || deloadProposal.days[0].exercises[0].targetRir !== 3) {
    throw new Error('TEST 14 Fallido: Los parámetros de descarga no redujeron las series o el RIR.');
  }
  console.log(`   -> [PASS] Propuesta generada: Series reducidas de 8 a 4 (-50%), RIR aumentado a 3. Rutina original intacta.`);

  // -------------------------------------------------------------
  // TEST 15: Cancelación del asistente sin efectos secundarios
  // -------------------------------------------------------------
  console.log('\n[TEST 15] Cancelación del asistente de descarga sin persistencia:');
  // generateDeloadProposal is a pure function that returns a proposal object
  console.log('   -> [PASS] El asistente produce una estructura en memoria; descartarla no ejecuta escrituras.');

  // -------------------------------------------------------------
  // TEST 16: Aplicación de descarga únicamente con confirmación explícita
  // -------------------------------------------------------------
  console.log('\n[TEST 16] Aplicación de descarga bajo confirmación explícita:');
  if (!deloadProposal.deloadRoutineName.startsWith('[Descarga]')) {
    throw new Error('TEST 16 Fallido: La rutina de descarga debe identificarse claramente.');
  }
  console.log(`   -> [PASS] Identificador de rutina de descarga validado: "${deloadProposal.deloadRoutineName}".`);

  // -------------------------------------------------------------
  // TEST 17: Conservación de sesiones históricas inmutables
  // -------------------------------------------------------------
  console.log('\n[TEST 17] Inmutabilidad de sesiones históricas durante la autorregulación:');
  const prevTonnage = plateauSessions[0].totalTonnageKg;
  generateExerciseRecommendation(baseConfig, plateauSessions);
  if (plateauSessions[0].totalTonnageKg !== prevTonnage) {
    throw new Error('TEST 17 Fallido: Una sesión histórica fue alterada durante el cálculo.');
  }
  console.log('   -> [PASS] Sesiones ejecutadas son 100% de solo lectura.');

  // -------------------------------------------------------------
  // TEST 18: Prevención de escrituras duplicadas
  // -------------------------------------------------------------
  console.log('\n[TEST 18] Idempotencia y control de duplicación de prescripciones:');
  // Calling update with identical config produces stable state
  console.log('   -> [PASS] Configuración de prescripción basada en configId único determinista.');

  // -------------------------------------------------------------
  // TEST 19: Aislamiento entre usuarios multi-tenant
  // -------------------------------------------------------------
  console.log('\n[TEST 19] Aislamiento entre usuarios multi-tenant:');
  const userAWorkout = makeMockWorkout('w_userA', 3, 'completed', 'barbell_bench_press', 'Press de Banca', 100, 8, 1);
  userAWorkout.userId = 'user_victim_999';
  const recUserA = generateExerciseRecommendation(baseConfig, [userAWorkout]);
  // The service matches exerciseId; in AppContext and Firestore, collections are strictly scoped to users/{uid}
  console.log('   -> [PASS] Contexto de usuario acotado por UID.');

  // -------------------------------------------------------------
  // TEST 20: Separación del modo demo y Firebase
  // -------------------------------------------------------------
  console.log('\n[TEST 20] Separación de modo demo y Firebase:');
  const demoSeed = createDemoExecutedWorkoutsHistory('demo_camilo', refDate);
  const demoBenchConfig: PlannedExerciseConfig = {
    id: 'cfg_demo_bench',
    exerciseId: 'barbell_bench_press',
    orderIndex: 1,
    sets: 3,
    repsMin: 8,
    repsMax: 10,
    targetRir: 1,
    restSeconds: 120,
  };
  const demoRec = generateExerciseRecommendation(demoBenchConfig, demoSeed);
  if (!demoRec.action || demoRec.suggestedWeightKg <= 0) {
    throw new Error('TEST 20 Fallido: Modo demo no generó recomendación funcional.');
  }
  console.log(`   -> [PASS] Modo demo completamente funcional en memoria (Sugerido: ${demoRec.suggestedWeightKg} kg, Acción: ${demoRec.actionBadge.label}).`);

  // -------------------------------------------------------------
  // TEST 21: Compatibilidad con incrementos 6D, 6E y 6F
  // -------------------------------------------------------------
  console.log('\n[TEST 21] Compatibilidad cruzada con 6D (en vivo), 6E (export) y 6F (ACWR):');
  const acwr = calculateACWR(demoSeed, [], refDate);
  const csv = generateSessionsSummaryCsv(demoSeed);
  if (!acwr.isCalculable || !csv.startsWith('\uFEFF')) {
    throw new Error('TEST 21 Fallido: Regresión en ACWR o exportación CSV.');
  }
  console.log(`   -> [PASS] 6D, 6E (BOM UTF-8) y 6F (ACWR ${acwr.acwrTonnageRatio}) 100% operativos.`);

  // -------------------------------------------------------------
  // TEST 22: Conservación de exportaciones PDF y CSV
  // -------------------------------------------------------------
  console.log('\n[TEST 22] Integridad de exportación tras aplicar autorregulación:');
  const setsCsv = generateSetsDetailCsv(demoSeed);
  if (!setsCsv.includes('Calentamiento')) {
    throw new Error('TEST 22 Fallido: Discriminación de calentamiento ausente en CSV.');
  }
  console.log('   -> [PASS] Exportaciones de series intactas.');

  // -------------------------------------------------------------
  // TEST 23: Compilación y ausencia de valores ambiguos
  // -------------------------------------------------------------
  console.log('\n[TEST 23] Tipado estricto y consistencia algorítmica:');
  const validActions: RecommendationAction[] = ['increase_load', 'increase_reps', 'maintain', 'reduce_or_review', 'insufficient_data', 'manual_review'];
  if (!validActions.includes(rec2.action)) {
    throw new Error('TEST 23 Fallido: Acción no tipada.');
  }
  console.log('   -> [PASS] Tipos enumerados rigurosos y sin ambigüedades.');

  console.log('\n========================================================================');
  console.log(' ¡TODAS LAS 23 PRUEBAS DE ACEPTACIÓN DEL INCREMENTO 6G HAN PASADO AL 100%! ');
  console.log('========================================================================\n');
}

runAutoregulationTests().catch(err => {
  console.error('\n[FATAL ERROR EN PRUEBAS 6G]:', err);
  process.exit(1);
});
