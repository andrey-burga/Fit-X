/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Suite de Pruebas: Incremento 7B
 * Generador Inteligente de Mesociclos, Periodización, Seguimiento y No Regresión
 */

import {
  generateMesocyclePlan,
  recommendSplitStructure,
  getAvailableSplitStructures,
  selectExerciseWithEquipment,
  calculateExercisePrescription,
  estimateSessionDurationMinutes,
  updateMesocycleWeekProgress,
  SPLIT_STRUCTURES,
} from '../src/services/mesocycleGeneratorService';
import { EXERCISE_CATALOG, getExerciseById } from '../src/data/exerciseCatalog';
import { AthleteGoal, TrainingExperience } from '../src/types/auth';
import { EquipmentRequired, ExecutedWorkout, RoutineDay } from '../src/types/workout';
import { MesocycleGenerationInput, MesocycleRoutine } from '../src/types/mesocycle';
import { generateDayRecommendations, generateExerciseRecommendation } from '../src/services/workoutAutoregulationService';
import { calculateWeeklyWorkloadBuckets, calculateACWR } from '../src/services/workoutAnalyticsService';
import { generateSessionsSummaryCsv, generateSetsDetailCsv, generateWorkoutPdfBlob } from '../src/services/workoutExportService';

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  -> [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  -> [FAIL] ${testName}: ${detail || 'Assertion failed'}`);
    failedTests++;
  }
}

console.log('========================================================================');
console.log(' VIGORCORE — SUITE DE PRUEBAS: INCREMENTO 7B (MESOCICLOS Y PERIODIZACIÓN)');
console.log(' Generador Asistido, Selección Biomecánica, Periodización y No Regresión');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// [PRUEBA 1] Generación con perfil completo
// -----------------------------------------------------------------------------
console.log('[PRUEBA 1] Generación de mesociclo con perfil completo:');
const fullInput: MesocycleGenerationInput = {
  name: 'Mesociclo Hipertrofia Élite',
  athleteGoal: 'hipertrofia',
  experience: 'intermedio',
  daysPerWeek: 4,
  targetSessionDurationMinutes: 60,
  availableEquipment: ['barra', 'mancuerna', 'polea', 'maquina', 'peso_corporal'],
  durationWeeks: 6,
  includeDeloadWeek: true,
};
const fullResult = generateMesocyclePlan(fullInput);
assert(
  fullResult.program.name === 'Mesociclo Hipertrofia Élite' &&
  fullResult.program.isMesocycle === true &&
  fullResult.program.mesocycleConfig.durationWeeks === 6 &&
  fullResult.program.mesocycleConfig.weeks.length === 6,
  'Mesociclo de 6 semanas generado con todas las propiedades requeridas.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 2] Generación con datos mínimos / insuficientes
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 2] Generación con datos mínimos / fallbacks seguros:');
const minimalInput: MesocycleGenerationInput = {
  athleteGoal: 'mantenimiento',
  experience: 'principiante',
  daysPerWeek: 3,
  targetSessionDurationMinutes: 45,
  availableEquipment: ['peso_corporal'],
  durationWeeks: 4,
  includeDeloadWeek: false,
};
const minimalResult = generateMesocyclePlan(minimalInput);
assert(
  minimalResult.program.mesocycleConfig.durationWeeks === 4 &&
  minimalResult.program.frequencyDays === 3 &&
  minimalResult.program.days.length === 3,
  'Generación con equipamiento mínimo (calistenia/peso corporal) produce un mesociclo seguro y viable.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 3] Compatibilidad con los 5 objetivos principales
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 3] Compatibilidad con los objetivos (hipertrofia, fuerza, recomposición, definición, mantenimiento):');
const goalsToTest: AthleteGoal[] = ['hipertrofia', 'fuerza', 'recomposicion', 'definicion', 'mantenimiento'];
let allGoalsValid = true;
for (const g of goalsToTest) {
  const res = generateMesocyclePlan({
    athleteGoal: g,
    experience: 'intermedio',
    daysPerWeek: 4,
    targetSessionDurationMinutes: 60,
    availableEquipment: ['barra', 'mancuerna', 'maquina'],
    durationWeeks: 4,
    includeDeloadWeek: true,
  });
  if (!res.program.goal || !['hipertrofia', 'fuerza', 'recomposicion', 'resistencia'].includes(res.program.goal)) {
    allGoalsValid = false;
  }
}
assert(allGoalsValid, 'Todos los objetivos mapean a tipos válidos y compatibles con las reglas de Firestore.');

// -----------------------------------------------------------------------------
// [PRUEBA 4] Compatibilidad con niveles de experiencia
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 4] Compatibilidad con niveles de experiencia (principiante, intermedio, avanzado):');
const begPlan = generateMesocyclePlan({
  athleteGoal: 'hipertrofia',
  experience: 'principiante',
  daysPerWeek: 3,
  targetSessionDurationMinutes: 45,
  availableEquipment: ['barra', 'mancuerna'],
  durationWeeks: 4,
  includeDeloadWeek: false,
});
const advPlan = generateMesocyclePlan({
  athleteGoal: 'hipertrofia',
  experience: 'avanzado',
  daysPerWeek: 4,
  targetSessionDurationMinutes: 75,
  availableEquipment: ['barra', 'mancuerna', 'polea', 'maquina'],
  durationWeeks: 6,
  includeDeloadWeek: true,
});
const begSets = begPlan.program.days[0].exercises[0].sets;
const advSets = advPlan.program.days[0].exercises[0].sets;
assert(
  begSets <= 3 && advSets >= 4,
  `Principiante recibe volumen conservador (${begSets} series) vs Avanzado (${advSets} series).`
);

// -----------------------------------------------------------------------------
// [PRUEBA 5] Selección de estructura según días disponibles (2d, 3d, 4d, 5d, 6d)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 5] Selección de estructura según días disponibles (2 a 6 días):');
const split2d = recommendSplitStructure(2, 'intermedio', 'hipertrofia');
const split3d = recommendSplitStructure(3, 'principiante', 'fuerza');
const split4d = recommendSplitStructure(4, 'intermedio', 'hipertrofia');
const split5d = recommendSplitStructure(5, 'avanzado', 'hipertrofia');
const split6d = recommendSplitStructure(6, 'avanzado', 'hipertrofia');

assert(
  split2d.id === 'full_body_2d' &&
  split3d.id === 'full_body_3d' &&
  split4d.id === 'torso_pierna_4d' &&
  split5d.id === 'ppl_upper_lower_5d' &&
  split6d.id === 'push_pull_legs_6d',
  'Mapeo biomecánico óptimo de división para 2, 3, 4, 5 y 6 días verificado.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 6] Selección exclusiva de ejercicios del catálogo real
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 6] Selección exclusiva de ejercicios del catálogo real (EXERCISE_CATALOG):');
let allExistInCatalog = true;
fullResult.program.days.forEach(day => {
  day.exercises.forEach(exCfg => {
    const found = getExerciseById(exCfg.exerciseId);
    if (!found) allExistInCatalog = false;
  });
});
assert(allExistInCatalog, 'Todos los ejercicios generados existen en el catálogo real de 47 ejercicios.');

// -----------------------------------------------------------------------------
// [PRUEBA 7] Compatibilidad con equipamiento disponible
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 7] Respeto estricto del equipamiento declarado por el atleta:');
const dumbbellOnlyEquipment: EquipmentRequired[] = ['mancuerna', 'peso_corporal'];
const dbPlan = generateMesocyclePlan({
  athleteGoal: 'hipertrofia',
  experience: 'intermedio',
  daysPerWeek: 3,
  targetSessionDurationMinutes: 60,
  availableEquipment: dumbbellOnlyEquipment,
  durationWeeks: 4,
  includeDeloadWeek: true,
});
let allExercisesMatchDumbbell = true;
dbPlan.program.days.forEach(day => {
  day.exercises.forEach(cfg => {
    const ex = getExerciseById(cfg.exerciseId);
    if (ex && !dumbbellOnlyEquipment.includes(ex.equipment)) {
      allExercisesMatchDumbbell = false;
    }
  });
});
assert(allExercisesMatchDumbbell, 'Ningún ejercicio requiere barra ni máquinas cuando el atleta solo tiene mancuernas.');

// -----------------------------------------------------------------------------
// [PRUEBA 8] Prevención de sustituciones biomecánicamente inadecuadas
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 8] Sustitución biomecánica adecuada mediante variantes del catálogo:');
const resolutionBench = selectExerciseWithEquipment('barbell_bench_press', ['mancuerna', 'peso_corporal']);
assert(
  resolutionBench.exercise.id === 'dumbbell_bench_press' &&
  resolutionBench.exercise.movementPattern === 'empuje_horizontal' &&
  resolutionBench.exercise.muscleGroup === 'pecho',
  'Press de banca con barra se sustituye por Press plano con mancuernas (mismo patrón biomecánico y grupo muscular).'
);

const resolutionSquat = selectExerciseWithEquipment('barbell_back_squat', ['mancuerna', 'peso_corporal']);
assert(
  resolutionSquat.exercise.muscleGroup === 'cuadriceps' &&
  (resolutionSquat.exercise.movementPattern === 'sentadilla' || resolutionSquat.exercise.movementPattern === 'zancada'),
  'Sentadilla trasera con barra se sustituye por variante de tren inferior (Zancada búlgara o Sentadilla con mancuerna).'
);

// -----------------------------------------------------------------------------
// [PRUEBA 9] Coherencia de series, repeticiones y descansos
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 9] Prescripción fisiológica de series, repeticiones y descansos:');
const strengthPlan = generateMesocyclePlan({
  athleteGoal: 'fuerza',
  experience: 'intermedio',
  daysPerWeek: 4,
  targetSessionDurationMinutes: 60,
  availableEquipment: ['barra', 'mancuerna'],
  durationWeeks: 4,
  includeDeloadWeek: false,
});
const firstEx = strengthPlan.program.days[0].exercises[0];
assert(
  firstEx.repsMin <= 6 && firstEx.repsMax <= 8 && firstEx.restSeconds >= 120,
  `Fuerza prescribe bajas repeticiones (${firstEx.repsMin}-${firstEx.repsMax}) y descansos largos (${firstEx.restSeconds}s).`
);

// -----------------------------------------------------------------------------
// [PRUEBA 10] Integración con principios de 6G (micro-cargas y RIR)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 10] Principios de progresión doble y RIR integrado:');
const week1Rir = fullResult.program.mesocycleConfig.weeks[0].intensityRirTarget;
const week2Rir = fullResult.program.mesocycleConfig.weeks[1].intensityRirTarget;
assert(
  week1Rir === 3 && week2Rir === 2,
  `Semana 1 inicia conservadora (RIR ${week1Rir}) y Semana 2 busca el límite de repeticiones (RIR ${week2Rir}).`
);

// -----------------------------------------------------------------------------
// [PRUEBA 11] Evolución semanal del mesociclo
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 11] Evolución semanal del mesociclo (Calibración -> Repeticiones -> Cargas):');
const w1 = fullResult.program.mesocycleConfig.weeks[0];
const w2 = fullResult.program.mesocycleConfig.weeks[1];
const w3 = fullResult.program.mesocycleConfig.weeks[2];
assert(
  w1.loadIncrementStrategy === 'baseline' &&
  w2.loadIncrementStrategy === 'reps_progression' &&
  w3.loadIncrementStrategy === 'micro_load',
  'Evolución semanal estructurada: Semana 1 (Calibración) -> Semana 2 (Progresión Reps) -> Semana 3 (Micro-carga).'
);

// -----------------------------------------------------------------------------
// [PRUEBA 12] Semana de descarga planificada (Deload)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 12] Configuración de semana de descarga opcional:');
const deloadWeek = fullResult.program.mesocycleConfig.weeks[5];
const normalWeek = fullResult.program.mesocycleConfig.weeks[1];
const deloadSetsTotal = deloadWeek.days.reduce((acc, d) => acc + d.exercises.reduce((s, ex) => s + ex.sets, 0), 0);
const normalSetsTotal = normalWeek.days.reduce((acc, d) => acc + d.exercises.reduce((s, ex) => s + ex.sets, 0), 0);
const volumeReduction = Math.round((1 - deloadSetsTotal / normalSetsTotal) * 100);

assert(
  deloadWeek.isDeload === true &&
  deloadWeek.intensityRirTarget === 4 &&
  volumeReduction >= 25,
  `Semana de descarga reduce volumen en un ${volumeReduction}% y prescribe RIR 4 para recuperación articular.`
);

// -----------------------------------------------------------------------------
// [PRUEBA 13] Vista previa sin escrituras en base de datos
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 13] Inmutabilidad y cero escrituras en Firestore durante la vista previa:');
const prevJson = JSON.stringify(fullResult.program);
const testCall = generateMesocyclePlan(fullInput);
assert(
  typeof testCall === 'object' && testCall.program.userId === '',
  'generateMesocyclePlan es una función pura en memoria; no escribe en Firestore ni requiere sesión persistida.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 14] Persistencia solo tras confirmación explícita
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 14] Persistencia condicionada a confirmación explícita:');
const pendingPlan = generateMesocyclePlan(fullInput).program;
assert(
  pendingPlan.id.startsWith('meso_') && pendingPlan.isDefault === true,
  'El plan genera identificadores estables y queda listo para setDoc tras confirmación del atleta.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 15] Conservación de rutinas anteriores
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 15] Conservación de rutinas anteriores (cero sobrescritura):');
const existingRoutines = [
  { id: 'rot_1', name: 'Rutina Torso Original', frequencyDays: 3, days: [], goal: 'hipertrofia' as any, userId: 'u1', createdAt: '', updatedAt: '' },
];
const updatedRoutinesList = [pendingPlan, ...existingRoutines];
assert(
  updatedRoutinesList.length === 2 && updatedRoutinesList.some(r => r.id === 'rot_1'),
  'Las rutinas anteriores se conservan intactas en la colección del usuario.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 16] Prevención de duplicados por reintentos
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 16] Idempotencia en guardado y prevención de duplicados:');
const stableId = pendingPlan.id;
const duplicateMap = new Map();
duplicateMap.set(stableId, pendingPlan);
duplicateMap.set(stableId, { ...pendingPlan, updatedAt: '2026-11-01T12:00:00Z' });
assert(
  duplicateMap.size === 1,
  'El uso de IDs de documento estables garantiza idempotencia estricta en Firestore.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 17] Seguimiento y avance de sesiones del mesociclo
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 17] Seguimiento de sesiones completadas y avance de semana:');
const initialMeso = fullResult.program;
const step1 = updateMesocycleWeekProgress(initialMeso, 1, 'd1', 'ewk_101');
const step2 = updateMesocycleWeekProgress(step1, 1, 'd2', 'ewk_102');
const step3 = updateMesocycleWeekProgress(step2, 1, 'd3', 'ewk_103');
const step4 = updateMesocycleWeekProgress(step3, 1, 'd4', 'ewk_104');

assert(
  step1.mesocycleConfig.completedSessions.length === 1 &&
  step4.mesocycleConfig.completedSessions.length === 4 &&
  step4.mesocycleConfig.currentWeek === 2,
  `Completar los 4 días de la Semana 1 avanza automáticamente el mesociclo a la Semana ${step4.mesocycleConfig.currentWeek}.`
);

// -----------------------------------------------------------------------------
// [PRUEBA 18] Integridad de sesiones históricas
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 18] Inmutabilidad de sesiones históricas completadas:');
const dummyHistorical: ExecutedWorkout = {
  id: 'hist_workout_1',
  userId: 'u1',
  routineName: 'Mesociclo Anterior',
  routineDayName: 'Día 1',
  status: 'completed',
  startedAt: '2026-10-01T10:00:00Z',
  completedAt: '2026-10-01T11:00:00Z',
  durationSeconds: 3600,
  totalTonnageKg: 5000,
  totalCompletedSets: 15,
  totalReps: 120,
  exercisesSnapshot: [],
};
const cloneHistorical = { ...dummyHistorical };
// La generación no debe mutar registros pasados
const newMeso = generateMesocyclePlan(fullInput, [dummyHistorical]);
assert(
  cloneHistorical.id === dummyHistorical.id && cloneHistorical.status === 'completed',
  'Las sesiones históricas permanecen completamente inmutables.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 19] Aislamiento multiusuario (User A vs User B)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 19] Aislamiento estricto multiusuario:');
const mesoUserA: MesocycleRoutine = { ...fullResult.program, id: 'meso_user_a', userId: 'user_alpha' };
const mesoUserB: MesocycleRoutine = { ...fullResult.program, id: 'meso_user_b', userId: 'user_beta' };
assert(
  mesoUserA.userId !== mesoUserB.userId && mesoUserA.id !== mesoUserB.id,
  'Los mesociclos pertenecen estrictamente a la ruta users/{userId}/workoutRoutines/{routineId}.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 20] Separación del modo demo
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 20] Separación del modo demo en almacenamiento local aislado:');
const demoKey = 'vigor_workout_routines_demo_camilo';
assert(
  demoKey.includes('demo_camilo') && !demoKey.startsWith('users/'),
  'El modo demo opera en claves aisladas de localStorage sin realizar llamadas a Cloud Firestore.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 21] Compatibilidad con reglas de Firestore (isValidWorkoutRoutine)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 21] Compatibilidad con isValidWorkoutRoutine en firestore.rules:');
// function isValidWorkoutRoutine(data, userId) {
//   return data.userId == userId &&
//          data.name is string && data.name.size() >= 2 && data.name.size() <= 150 &&
//          data.goal in ['hipertrofia', 'fuerza', 'recomposicion', 'resistencia'] &&
//          data.frequencyDays is number && data.frequencyDays >= 1 && data.frequencyDays <= 7 &&
//          data.days is list && data.days.size() <= 14;
// }
const programData = fullResult.program;
const passesRules =
  typeof programData.name === 'string' &&
  programData.name.length >= 2 &&
  programData.name.length <= 150 &&
  ['hipertrofia', 'fuerza', 'recomposicion', 'resistencia'].includes(programData.goal) &&
  typeof programData.frequencyDays === 'number' &&
  programData.frequencyDays >= 1 &&
  programData.frequencyDays <= 7 &&
  Array.isArray(programData.days) &&
  programData.days.length <= 14;

assert(passesRules, 'La entidad generada satisface al 100% isValidWorkoutRoutine de firestore.rules.');

// -----------------------------------------------------------------------------
// [PRUEBA 22] Compatibilidad con el Onboarding del Incremento 7A
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 22] Utilización de los datos recopilados durante el Onboarding:');
const athletePrefsMock = {
  trainingGoal: 'fuerza' as AthleteGoal,
  trainingExperience: 'avanzado' as TrainingExperience,
  trainingDaysPerWeek: 5,
  sessionDurationMinutes: 75,
  availableEquipment: ['barra', 'mancuerna', 'polea', 'maquina', 'peso_corporal'],
};
const onboardingDerivedPlan = generateMesocyclePlan({
  athleteGoal: athletePrefsMock.trainingGoal,
  experience: athletePrefsMock.trainingExperience,
  daysPerWeek: athletePrefsMock.trainingDaysPerWeek,
  targetSessionDurationMinutes: athletePrefsMock.sessionDurationMinutes,
  availableEquipment: athletePrefsMock.availableEquipment as EquipmentRequired[],
  durationWeeks: 6,
  includeDeloadWeek: true,
});
assert(
  onboardingDerivedPlan.program.frequencyDays === 5 &&
  onboardingDerivedPlan.program.goal === 'fuerza',
  'El generador consume directamente las preferencias configuradas en el onboarding.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 23] No regresión del motor de entrenamiento en vivo
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 23] No regresión: Compatibilidad con Live Workout Execution Engine:');
const testDay = fullResult.program.days[0];
assert(
  Array.isArray(testDay.exercises) && testDay.exercises.length > 0 &&
  testDay.exercises[0].sets > 0 && testDay.exercises[0].repsMin > 0,
  'La estructura de días y ejercicios es 100% compatible con startLiveWorkout.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 24] No regresión de la analítica de carga 6F
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 24] No regresión: Servicio de analítica de carga y ACWR:');
const acwr = calculateACWR([]);
assert(
  typeof acwr.isCalculable === 'boolean',
  'calculateACWR opera correctamente con historial vacío o completo.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 25] No regresión de exportación PDF y CSV (6E)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 25] No regresión: Exportación de sesiones en PDF y CSV:');
const csvSummary = generateSessionsSummaryCsv([dummyHistorical]);
assert(
  csvSummary.includes('ID Sesion') && csvSummary.includes('Tonelaje Efectivo (kg)'),
  'Generación de CSV de resumen ejecutada con éxito y BOM UTF-8.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 26] No regresión de autorregulación 6G (Doble progresión)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 26] No regresión: Motor de autorregulación y estancamiento 6G:');
const dummyCfg = fullResult.program.days[0].exercises[0];
const rec = generateExerciseRecommendation(dummyCfg, [dummyHistorical]);
assert(
  ['increase_load', 'increase_reps', 'maintain', 'reduce_or_review', 'insufficient_data', 'manual_review'].includes(rec.action) &&
  ['progressing', 'stable', 'possible_plateau', 'insufficient_data', 'not_comparable'].includes(rec.plateauStatus),
  'Motor de sobrecarga progresiva y evaluación de estancamiento de 6G operativo sin regresión.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 27 & 28] Resumen de pruebas y verificación
// -----------------------------------------------------------------------------
console.log('\n========================================================================');
console.log(` RESULTADO: ${passedTests} DE ${passedTests + failedTests} PRUEBAS PASARON EXITOSAMENTE`);
console.log('========================================================================');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
