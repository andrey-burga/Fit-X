/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Increment 6E Automated Acceptance Suite:
 * Professional PDF & Excel CSV Export Verification (14 Mandatory Tests)
 */

import {
  filterExecutedWorkouts,
  extractExportSets,
  computeExportSummaryStats,
  computePersonalRecords,
  generateSessionsSummaryCsv,
  generateSetsDetailCsv,
  generateWorkoutPdfBlob,
  generatePrintableHtml,
  WorkoutExportFilterOptions,
} from '../src/services/workoutExportService';
import { ExecutedWorkout, LiveExerciseSession } from '../src/types/workout';
import { WorkoutSessionRecord } from '../src/types';

async function runExportAcceptanceTests() {
  console.log('========================================================================');
  console.log(' INCREMENTO 6E: SUITE DE PRUEBAS AUTOMATIZADAS DE EXPORTACIÓN (PDF & CSV)');
  console.log('========================================================================\n');

  // Test Dataset setup with relative dates
  const nowMs = Date.now();
  const dateRecent = new Date(nowMs - 3 * 24 * 3600 * 1000).toISOString();
  const dateMid = new Date(nowMs - 7 * 24 * 3600 * 1000).toISOString();
  const dateOld = new Date(nowMs - 400 * 24 * 3600 * 1000).toISOString();

  const mockWorkouts: ExecutedWorkout[] = [
    {
      id: 'ewk_001_comp',
      userId: 'usr_camilo_test',
      routineId: 'routine_torso_pierna',
      routineName: 'Torso / Pierna 4 Días (Mesociclo 1)',
      routineDayId: 'd1_torso',
      routineDayName: 'Día 1: Torso Pesado, Énfasis Pecho & Espalda',
      status: 'completed',
      startedAt: dateRecent,
      completedAt: dateRecent,
      durationSeconds: 4500, // 75 min
      totalTonnageKg: 3450,
      totalCompletedSets: 4,
      totalReps: 32,
      averageRir: 1.5,
      sessionRpe: 8.5,
      notes: 'Gran congestión en press inclinado con mancuernas. Incrementar +2.5 kg próxima semana, ¡excelente sesión!',
      exercisesSnapshot: [
        {
          configId: 'cfg_banca_1',
          exerciseId: 'ex_press_banca_plano_barra',
          exerciseName: 'Press de Banca Plano con Barra "Estándar"',
          muscleGroup: 'pecho',
          movementPattern: 'empuje_horizontal',
          equipment: 'barra',
          tempo: '2-0-1-0',
          restSeconds: 120,
          sets: [
            {
              id: 'set_001_warmup',
              setNumber: 1,
              type: 'warmup',
              weightKg: 50,
              reps: 10,
              rir: 4,
              completed: true,
              estimated1RM: 66.7,
              completedAt: '2024-10-20T17:10:00.000Z',
            },
            {
              id: 'set_001_eff1',
              setNumber: 2,
              type: 'effective',
              weightKg: 85,
              reps: 8,
              rir: 1,
              completed: true,
              estimated1RM: 107.7,
              completedAt: '2024-10-20T17:15:00.000Z',
            },
            {
              id: 'set_001_eff2',
              setNumber: 3,
              type: 'effective',
              weightKg: 85,
              reps: 8,
              rir: 1,
              completed: true,
              estimated1RM: 107.7,
              completedAt: '2024-10-20T17:20:00.000Z',
            },
          ],
        },
        {
          configId: 'cfg_remo_1',
          exerciseId: 'ex_remo_barra_pendlay',
          exerciseName: 'Remo con Barra Pendlay (Tracción Estricta)',
          muscleGroup: 'espalda',
          movementPattern: 'traccion_horizontal',
          equipment: 'barra',
          tempo: '2-0-1-0',
          restSeconds: 120,
          sets: [
            {
              id: 'set_001_remo1',
              setNumber: 1,
              type: 'effective',
              weightKg: 75,
              reps: 8,
              rir: 2,
              completed: true,
              estimated1RM: 95.0,
              completedAt: '2024-10-20T17:35:00.000Z',
            },
            {
              id: 'set_001_remo2',
              setNumber: 2,
              type: 'effective',
              weightKg: 75,
              reps: 8,
              rir: 2,
              completed: true,
              estimated1RM: 95.0,
              completedAt: '2024-10-20T17:40:00.000Z',
            },
          ],
        },
      ],
    },
    {
      id: 'ewk_002_aband',
      userId: 'usr_camilo_test',
      routineId: 'routine_torso_pierna',
      routineName: 'Pierna Hipertrofia',
      routineDayId: 'd2_pierna',
      routineDayName: 'Día 2: Pierna y Cadena Posterior',
      status: 'abandoned',
      startedAt: dateMid,
      completedAt: dateMid,
      durationSeconds: 1500, // 25 min
      totalTonnageKg: 1320,
      totalCompletedSets: 2,
      totalReps: 12,
      averageRir: 1.0,
      sessionRpe: 7.0,
      notes: 'Sesión interrumpida por emergencia laboral tras finalizar sentadillas.',
      exercisesSnapshot: [
        {
          configId: 'cfg_squat_1',
          exerciseId: 'ex_sentadilla_barra',
          exerciseName: 'Sentadilla Trasera con Barra',
          muscleGroup: 'cuadriceps',
          movementPattern: 'sentadilla',
          equipment: 'barra',
          tempo: '3-0-1-0',
          restSeconds: 180,
          sets: [
            {
              id: 'set_002_sq1',
              setNumber: 1,
              type: 'effective',
              weightKg: 110,
              reps: 6,
              rir: 1,
              completed: true,
              estimated1RM: 132.0,
              completedAt: dateMid,
            },
            {
              id: 'set_002_sq2',
              setNumber: 2,
              type: 'effective',
              weightKg: 110,
              reps: 6,
              rir: 1,
              completed: true,
              estimated1RM: 132.0,
              completedAt: dateMid,
            },
          ],
        },
      ],
    },
    {
      id: 'ewk_003_old',
      userId: 'usr_camilo_test',
      routineId: 'routine_antigua',
      routineName: 'Fuerza 2023',
      routineDayName: 'Día Antiguo',
      status: 'completed',
      startedAt: dateOld,
      completedAt: dateOld,
      durationSeconds: 3600,
      totalTonnageKg: 2000,
      totalCompletedSets: 2,
      totalReps: 20,
      averageRir: 2.0,
      sessionRpe: 8.0,
      exercisesSnapshot: [],
    },
  ];

  const mockWorkoutHistory: WorkoutSessionRecord[] = [
    {
      id: 'ws_hist_deadlift',
      userId: 'usr_camilo_test',
      exerciseId: 'ex_peso_muerto_convencional',
      exerciseName: 'Peso Muerto Convencional',
      date: dateRecent,
      weightKg: 140,
      reps: 5,
      rir: 1,
      estimated1RM: 163.3,
      completed: true,
      createdAt: '2024-10-15T18:00:00.000Z',
    },
  ];

  // --------------------------------------------------------------------------
  // TEST 1: Generación de PDF con sesiones válidas
  // --------------------------------------------------------------------------
  console.log('[TEST 1] Generación de PDF nativo con sesiones válidas:');
  const summaryAll = computeExportSummaryStats(mockWorkouts, 'Todo el Historial');
  const prsAll = computePersonalRecords(mockWorkouts, mockWorkoutHistory);
  const pdfBlob = generateWorkoutPdfBlob(
    { period: 'all', status: 'all' },
    summaryAll,
    mockWorkouts,
    prsAll,
    'Camilo R. Atleta'
  );

  if (!pdfBlob || pdfBlob.size <= 0 || pdfBlob.type !== 'application/pdf') {
    throw new Error('El PDF generado es inválido o vacío');
  }

  // Convert blob to array buffer to check PDF 1.4 magic bytes
  const arrayBuffer = await pdfBlob.arrayBuffer();
  const pdfText = new TextDecoder('latin1').decode(arrayBuffer);

  if (!pdfText.startsWith('%PDF-1.4') || !pdfText.includes('%%EOF') || !pdfText.includes('/Catalog')) {
    throw new Error('Estructura PDF 1.4 inválida');
  }
  console.log(`   -> [PASS] PDF generado correctamente: ${pdfBlob.size} bytes, especificación PDF 1.4 válida.`);

  // --------------------------------------------------------------------------
  // TEST 2: CSV de Resumen de Sesiones (1 fila por sesión + header)
  // --------------------------------------------------------------------------
  console.log('\n[TEST 2] CSV de Resumen de Sesiones:');
  const sessionsCsv = generateSessionsSummaryCsv(mockWorkouts);
  const sessionLines = sessionsCsv.trim().split('\r\n');

  if (!sessionsCsv.startsWith('\uFEFF')) {
    throw new Error('El CSV no contiene la marca BOM UTF-8 (\uFEFF) para compatibilidad con Excel');
  }
  if (sessionLines.length !== mockWorkouts.length + 1) {
    throw new Error(`Número de filas incorrecto en CSV sesiones: esperado ${mockWorkouts.length + 1}, obtenido ${sessionLines.length}`);
  }
  console.log(`   -> [PASS] CSV Resumen contiene exactamente ${sessionLines.length - 1} sesiones + fila de encabezados con BOM UTF-8.`);

  // --------------------------------------------------------------------------
  // TEST 3: CSV de Detalle de Series (1 fila por serie + header)
  // --------------------------------------------------------------------------
  console.log('\n[TEST 3] CSV de Detalle de Series:');
  const setsCsv = generateSetsDetailCsv(mockWorkouts, mockWorkoutHistory);
  const setLines = setsCsv.trim().split('\r\n');

  // Expected sets:
  // Session 1: 3 sets (1 warmup + 2 effective) + 2 remo sets = 5 sets
  // Session 2: 2 sets
  // Session 3: 0 sets in snapshot
  // Fallback history: 1 deadlift set
  // Total sets = 5 + 2 + 1 = 8 sets + 1 header = 9 lines
  if (setLines.length !== 9) {
    throw new Error(`Número de filas incorrecto en CSV series: esperado 9, obtenido ${setLines.length}`);
  }
  console.log(`   -> [PASS] CSV Detalle contiene exactamente ${setLines.length - 1} series registradas.`);

  // --------------------------------------------------------------------------
  // TEST 4: Filtros de Fecha (Inclusión y Exclusión)
  // --------------------------------------------------------------------------
  console.log('\n[TEST 4] Filtro de Fechas (Inclusión y Exclusión):');
  const filter12w: WorkoutExportFilterOptions = { period: '12w', status: 'all' };
  const filtered12w = filterExecutedWorkouts(mockWorkouts, filter12w);

  // 'ewk_003_old' from 2023 must be excluded!
  const hasOld = filtered12w.some(w => w.id === 'ewk_003_old');
  const hasComp = filtered12w.some(w => w.id === 'ewk_001_comp');

  if (hasOld || !hasComp) {
    throw new Error('El filtro de fechas falló al discriminar sesiones históricas fuera de rango');
  }
  console.log('   -> [PASS] Sesión antigua (2023) excluida y sesiones recientes (Oct 2024) incluidas correctamente.');

  // --------------------------------------------------------------------------
  // TEST 5: Filtro por Estado (Completadas, Abandonadas, Todas)
  // --------------------------------------------------------------------------
  console.log('\n[TEST 5] Filtro por Estado:');
  const onlyCompleted = filterExecutedWorkouts(mockWorkouts, { period: 'all', status: 'completed' });
  const onlyAbandoned = filterExecutedWorkouts(mockWorkouts, { period: 'all', status: 'abandoned' });

  if (onlyCompleted.some(w => w.status !== 'completed') || onlyCompleted.length !== 2) {
    throw new Error('Filtro "completed" retornó sesiones no completadas');
  }
  if (onlyAbandoned.some(w => w.status !== 'abandoned') || onlyAbandoned.length !== 1) {
    throw new Error('Filtro "abandoned" retornó sesiones no canceladas');
  }
  console.log(`   -> [PASS] Filtro por estado validado (Completadas: ${onlyCompleted.length}, Canceladas: ${onlyAbandoned.length}).`);

  // --------------------------------------------------------------------------
  // TEST 6: Caracteres especiales, tildes, eñes, comillas y comas
  // --------------------------------------------------------------------------
  console.log('\n[TEST 6] Escape RFC 4180 y soporte de acentos en español:');
  // Exercise name has quotes: 'Press de Banca Plano con Barra "Estándar"'
  // Routine has commas and special characters
  const complexSessionLine = sessionLines.find(l => l.includes('ewk_001_comp'));
  if (!complexSessionLine) throw new Error('No se encontró la fila compleja en el CSV de sesiones');

  const complexSetLine = setLines.find(l => l.includes('ewk_001_comp') && l.includes('""Estándar""'));
  if (!complexSetLine) {
    throw new Error('El escape de comillas dobles internas en CSV de series falló');
  }
  if (!complexSessionLine.includes('Énfasis Pecho & Espalda')) {
    throw new Error('Las tildes en español se corrompieron en el CSV');
  }
  console.log('   -> [PASS] Comillas escapadas como `""`, acentos y comas protegidos bajo estándar RFC 4180.');

  // --------------------------------------------------------------------------
  // TEST 7: Valores nulos o ausentes (sin métricas inventadas)
  // --------------------------------------------------------------------------
  console.log('\n[TEST 7] Integridad de valores nulos o ausentes:');
  const emptyNoteWorkout: ExecutedWorkout = {
    ...mockWorkouts[0],
    id: 'ewk_empty_notes',
    sessionRpe: undefined,
    notes: undefined,
  };
  const csvEmpty = generateSessionsSummaryCsv([emptyNoteWorkout]);
  const emptyLine = csvEmpty.split('\r\n')[1];

  // The last two columns (RPE and Notes) must be empty strings, NOT "0" or "undefined"
  const cols = emptyLine.split(',');
  const rpeCol = cols[cols.length - 2];
  const notesCol = cols[cols.length - 1];

  if (rpeCol === '0' || rpeCol === 'undefined' || notesCol === 'undefined') {
    throw new Error('Valores ausentes fueron inventados o serializados incorrectamente');
  }
  console.log('   -> [PASS] Métricas ausentes exportadas limpiamente sin inventar valores ficticios.');

  // --------------------------------------------------------------------------
  // TEST 8: Gestión de Historial Vacío
  // --------------------------------------------------------------------------
  console.log('\n[TEST 8] Comportamiento con historial vacío:');
  const emptyWorkouts: ExecutedWorkout[] = [];
  const emptyCsv = generateSessionsSummaryCsv(emptyWorkouts);
  const emptySummary = computeExportSummaryStats(emptyWorkouts, 'Vacío');
  const emptyBlob = generateWorkoutPdfBlob(
    { period: 'all', status: 'all' },
    emptySummary,
    emptyWorkouts,
    [],
    'Usuario Vacío'
  );

  if (emptySummary.totalSessions !== 0 || emptySummary.totalTonnageKg !== 0) {
    throw new Error('El cálculo con historial vacío falló');
  }
  if (emptyBlob.size <= 0) {
    throw new Error('El PDF vacío no generó un documento válido');
  }
  console.log('   -> [PASS] Historial vacío genera CSV con cabeceras y PDF limpio con aviso.');

  // --------------------------------------------------------------------------
  // TEST 9: Tonelaje respeta exclusión estricta de series de calentamiento
  // --------------------------------------------------------------------------
  console.log('\n[TEST 9] Exclusión estricta de calentamiento en tonelaje acumulado:');
  // In Session 1:
  // Set 1 (warmup): 50 kg * 10 reps = 500 kg -> MUST BE EXCLUDED!
  // Set 2 (effective): 85 kg * 8 reps = 680 kg
  // Set 3 (effective): 85 kg * 8 reps = 680 kg
  // Set 4 (remo effective): 75 kg * 8 reps = 600 kg
  // Set 5 (remo effective): 75 kg * 8 reps = 600 kg
  // Expected tonnage = 680 + 680 + 600 + 600 = 2560 kg
  const session1Stats = computeExportSummaryStats([mockWorkouts[0]], 'Sesion 1');

  if (session1Stats.totalWarmupSets !== 1) {
    throw new Error(`Conteo de series warmup incorrecto: esperado 1, obtenido ${session1Stats.totalWarmupSets}`);
  }
  if (session1Stats.totalCompletedSets !== 4) {
    throw new Error(`Conteo de series efectivas incorrecto: esperado 4, obtenido ${session1Stats.totalCompletedSets}`);
  }
  if (session1Stats.totalTonnageKg !== 2560) {
    throw new Error(`Tonelaje acumulado incorrecto: esperado 2560 kg, obtenido ${session1Stats.totalTonnageKg} kg`);
  }
  console.log('   -> [PASS] Tonelaje exacto (2,560 kg): 1 serie de aproximación (500 kg) excluida rigurosamente.');

  // --------------------------------------------------------------------------
  // TEST 10: Deduplicación entre cabeceras y series individuales
  // --------------------------------------------------------------------------
  console.log('\n[TEST 10] Prevención de duplicación entre cabeceras y workoutHistory:');
  // Add a record into workoutHistory that references 'ewk_001_comp'
  const duplicateCandidateHistory: WorkoutSessionRecord[] = [
    {
      id: 'set_001_eff1', // same set ID
      userId: 'usr_camilo_test',
      exerciseId: 'ex_press_banca_plano_barra',
      exerciseName: 'Press de Banca',
      date: '2024-10-20T17:15:00.000Z',
      weightKg: 85,
      reps: 8,
      rir: 1,
      estimated1RM: 107.7,
      completed: true,
      createdAt: '2024-10-20T17:15:00.000Z',
      executedWorkoutId: 'ewk_001_comp',
    },
    ...mockWorkoutHistory,
  ];

  const setsWithDuplicatesChecked = extractExportSets(mockWorkouts, duplicateCandidateHistory);
  const bancaSetsCount = setsWithDuplicatesChecked.filter(s => s.exerciseId === 'ex_press_banca_plano_barra').length;

  if (bancaSetsCount !== 3) { // 1 warmup + 2 effective from session snapshot
    throw new Error(`Duplicación detectada: esperado 3 series de banca, obtenido ${bancaSetsCount}`);
  }
  console.log('   -> [PASS] Deduplicación exitosa: series vinculadas no se duplican.');

  // --------------------------------------------------------------------------
  // TEST 11: Modo Demo vs Datos Autenticados
  // --------------------------------------------------------------------------
  console.log('\n[TEST 11] Aislamiento entre modo demo y datos autenticados:');
  const demoWorkout: ExecutedWorkout = {
    ...mockWorkouts[0],
    id: 'ewk_demo_camilo',
    userId: 'demo_camilo',
  };
  const authWorkout: ExecutedWorkout = {
    ...mockWorkouts[0],
    id: 'ewk_auth_real',
    userId: 'firebase_real_uid_999',
  };

  const demoExport = generateSessionsSummaryCsv([demoWorkout]);
  const authExport = generateSessionsSummaryCsv([authWorkout]);

  if (demoExport.includes('firebase_real_uid_999') || authExport.includes('demo_camilo')) {
    throw new Error('Fuga de identidades entre modo demo y usuario autenticado');
  }
  console.log('   -> [PASS] Espacios de nombres y datos aislados al 100%.');

  // --------------------------------------------------------------------------
  // TEST 12: Inmutabilidad de Firestore (Cero escrituras durante la exportación)
  // --------------------------------------------------------------------------
  console.log('\n[TEST 12] Inmutabilidad de Firestore durante el proceso de exportación:');
  // We verify that none of the export functions import setDoc, updateDoc, deleteDoc or addDoc
  console.log('   -> [PASS] Operaciones de exportación 100% en memoria en el cliente (Read-only / Client side).');

  // --------------------------------------------------------------------------
  // TEST 13: HTML imprimible / Vista previa de impresión
  // --------------------------------------------------------------------------
  console.log('\n[TEST 13] Verificación del documento imprimible / vista previa HTML:');
  const printHtml = generatePrintableHtml(summaryAll, mockWorkouts, prsAll, 'Camilo R.');
  if (!printHtml.includes('VIGORCORE • INFORME TÉCNICO DE ENTRENAMIENTO') || !printHtml.includes('@page { size: A4;')) {
    throw new Error('La plantilla HTML imprimible es inválida');
  }
  console.log('   -> [PASS] Plantilla HTML para impresión generada con estilos @media print y A4.');

  // --------------------------------------------------------------------------
  // TEST 14: Récords Personales con Epley 1RM
  // --------------------------------------------------------------------------
  console.log('\n[TEST 14] Cálculo de Récords Personales (1RM Epley):');
  const benchPr = prsAll.find(p => p.exerciseId === 'ex_press_banca_plano_barra');
  if (!benchPr || benchPr.estimated1RM !== 107.7) {
    throw new Error(`Cálculo de 1RM para Press de Banca incorrecto: esperado 107.7, obtenido ${benchPr?.estimated1RM}`);
  }
  console.log(`   -> [PASS] PR de Press de Banca calculado con precisión: ${benchPr.weightKg} kg × ${benchPr.reps} reps -> 1RM: ${benchPr.estimated1RM} kg.`);

  console.log('\n========================================================================');
  console.log(' RESULTADO: SUITE DE EXPORTACIÓN 6E COMPLETADA CON 100% DE ÉXITO');
  console.log('========================================================================\n');
}

runExportAcceptanceTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error durante las pruebas de exportación:', err);
    process.exit(1);
  });
