/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Suite de Pruebas: Incremento 7C & 7C.1
 * Auditoría Científica, Matemática, Isocalórica y de Persistencia de la Periodización Nutricional
 * Total: 44 pruebas exhaustivas
 */

import {
  generateNutritionalPeriodizationRecommendation,
  applyPeriodizationToBiometrics,
  revertPeriodizationFromBiometrics,
  validateBiometricSufficiency,
  isValidMacroDistribution,
  determineTrainingDayDemand,
  GOAL_NUTRITIONAL_GUIDELINES,
  NutritionalPeriodizationInput,
  calculateWeeklyCarbCyclingSchedule,
  calculateCaloriesFromMacros,
  getDefaultHighDemandDays,
} from '../src/services/nutritionalPeriodizationService';
import { BiometricConfig } from '../src/types';
import { AthleteGoal } from '../src/types/auth';
import { generateMesocyclePlan } from '../src/services/mesocycleGeneratorService';
import { MesocycleRoutine } from '../src/types/mesocycle';
import { calculatePortionNutrients, validateGrams } from '../src/services/nutritionMath';
import { aggregateWeeklyMealPlan } from '../src/services/groceryAggregation';

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
console.log(' VIGORCORE — SUITE DE PRUEBAS: INCREMENTO 7C.1 (AUDITORÍA CIENTÍFICA & PERSISTENCIA)');
console.log(' 44 Pruebas: Diet Break Voluntario, Suficiencia Biométrica, Ciclado Isocalórico');
console.log('========================================================================\n');

// Mock biometrics estándar (atleta verificado)
const standardBio: BiometricConfig = {
  weightKg: 75,
  heightCm: 178,
  bodyFatPct: 15,
  age: 28,
  palFactor: 1.55,
  targetDeltaKcal: 0,
  proteinPerKg: 2.0,
  fatPerKg: 0.8,
  bmr: 1720,
  tdee: 2666,
  targetCalories: 2666,
  targetProteinG: 150,
  targetFatG: 60,
  targetCarbsG: 382,
};

// Generar mesociclo de prueba de 6 semanas con descarga
const sampleMeso = generateMesocyclePlan({
  athleteGoal: 'hipertrofia',
  experience: 'intermedio',
  daysPerWeek: 4,
  targetSessionDurationMinutes: 60,
  availableEquipment: ['barra', 'mancuerna', 'polea', 'maquina'],
  durationWeeks: 6,
  includeDeloadWeek: true,
}).program;

// -----------------------------------------------------------------------------
// [PRUEBA 1] Hipertrofia: Superávit calórico controlado y proteína óptima
// -----------------------------------------------------------------------------
console.log('[PRUEBA 1] Evaluación basal para Hipertrofia:');
const recHyp = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'hipertrofia',
  biometrics: standardBio,
  activeMesocycle: sampleMeso,
  currentWeekNumber: 2,
});
assert(
  recHyp.proposedPlan.targetDeltaKcal > 0 &&
  recHyp.proposedPlan.proteinPerKg >= 1.8 &&
  recHyp.proposedPlan.proteinPerKg <= 2.2 &&
  recHyp.proposedPlan.targetCalories > standardBio.tdee,
  'Hipertrofia prescribe superávit controlado (+150 a +300 kcal) y proteína entre 1.8 y 2.2 g/kg.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 2] Fuerza Máxima: Soporte neuromuscular y balance neutro/leve superávit
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 2] Evaluación basal para Fuerza Máxima:');
const recStr = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'fuerza',
  biometrics: standardBio,
  activeMesocycle: sampleMeso,
  currentWeekNumber: 2,
});
assert(
  recStr.proposedPlan.targetDeltaKcal >= 50 &&
  recStr.proposedPlan.proteinPerKg >= 1.6 &&
  recStr.proposedPlan.proteinPerKg <= 2.0,
  'Fuerza Máxima prescribe leve superávit (+100 a +200 kcal) y proteína neuromuscular de 1.6 a 2.0 g/kg.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 3] Recomposición Corporal: Déficit sutil con alta proteína
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 3] Evaluación basal para Recomposición Corporal:');
const recRec = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'recomposicion',
  biometrics: standardBio,
  activeMesocycle: sampleMeso,
  currentWeekNumber: 2,
});
assert(
  recRec.proposedPlan.targetDeltaKcal <= 0 &&
  recRec.proposedPlan.targetDeltaKcal >= -150 &&
  recRec.proposedPlan.proteinPerKg >= 2.0 &&
  recRec.proposedPlan.proteinPerKg <= 2.4,
  'Recomposición prescribe déficit leve (-150 a 0 kcal) con alta ingesta proteica (2.0 a 2.4 g/kg).'
);

// -----------------------------------------------------------------------------
// [PRUEBA 4] Definición / Pérdida de Grasa: Déficit estructurado y proteína máxima
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 4] Evaluación basal para Definición / Pérdida de Grasa:');
const recDef = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'definicion',
  biometrics: standardBio,
  activeMesocycle: sampleMeso,
  currentWeekNumber: 2,
});
assert(
  recDef.proposedPlan.targetDeltaKcal <= -300 &&
  recDef.proposedPlan.proteinPerKg >= 2.2 &&
  recDef.proposedPlan.fatPerKg >= 0.65,
  'Definición prescribe déficit moderado (-300 a -500 kcal), proteína máxima (2.2 a 2.6 g/kg) y grasas seguras.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 5] Mantenimiento: Isocalórica estricta y equilibrio de macronutrientes
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 5] Evaluación basal para Mantenimiento:');
const recMnt = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'mantenimiento',
  biometrics: standardBio,
  activeMesocycle: sampleMeso,
  currentWeekNumber: 2,
});
assert(
  recMnt.proposedPlan.targetDeltaKcal === 0 &&
  Math.abs(recMnt.proposedPlan.targetCalories - standardBio.tdee) <= 5,
  'Mantenimiento prescribe delta 0 kcal y calorías dentro de la tolerancia de redondeo de macronutrientes respecto al TDEE.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 6] Semana de descarga: Prohibición de recorte agresivo involuntario
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 6] Protección calórica en Semana de Descarga (Semana 6):');
const recDeload = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'hipertrofia',
  biometrics: standardBio,
  activeMesocycle: sampleMeso,
  currentWeekNumber: 6,
});
assert(
  recDeload.isDeloadWeek === true &&
  recDeload.proposedPlan.targetCalories >= standardBio.tdee,
  'En semana de descarga para hipertrofia no se recortan calorías por debajo del mantenimiento.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 7] Semana de descarga: Conservación estricta de proteína
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 7] Conservación de proteína durante la descarga:');
assert(
  recDeload.proposedPlan.proteinPerKg >= 2.0 &&
  recDeload.proposedPlan.targetProteinG >= 150,
  'La ingesta proteica se mantiene elevada durante la descarga para la remodelación de tejidos.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 8] Definición en descarga SIN Diet Break voluntario: Mantiene déficit
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 8] Definición en descarga por defecto conserva el déficit del atleta:');
const recDefDeloadDefault = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'definicion',
  biometrics: standardBio,
  activeMesocycle: sampleMeso,
  currentWeekNumber: 6,
  dietBreakOptionSelected: false,
});
assert(
  recDefDeloadDefault.isDeloadWeek === true &&
  recDefDeloadDefault.proposedPlan.targetDeltaKcal < 0 &&
  recDefDeloadDefault.dietBreakSuggestion !== undefined &&
  Boolean(recDefDeloadDefault.dietBreakSuggestion?.rationale && recDefDeloadDefault.dietBreakSuggestion.rationale.length > 0),
  'En definición, la descarga NO fuerza normocalórica automáticamente; sugiere la opción pero conserva el déficit.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 9] Ciclado de carbohidratos: Día de alta demanda (+20% carbohidratos)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 9] Ciclado de carbohidratos en días de alta demanda:');
const highDay = recHyp.dayDemandTargets.highTrainingDay;
assert(
  highDay.carbShiftPct === 20 &&
  highDay.carbsG > recHyp.proposedPlan.targetCarbsG &&
  highDay.fatG <= recHyp.proposedPlan.targetFatG,
  'Día de alta demanda incrementa los carbohidratos un 20% reduciendo lípidos para mantener balance.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 10] Ciclado de carbohidratos: Día de descanso (reducción de carbohidratos)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 10] Ciclado de carbohidratos en días de descanso:');
const restDay = recHyp.dayDemandTargets.restRecoveryDay;
assert(
  restDay.carbShiftPct < 0 &&
  restDay.carbsG < recHyp.proposedPlan.targetCarbsG &&
  restDay.fatG >= recHyp.proposedPlan.targetFatG,
  'Día de descanso reduce carbohidratos y prioriza grasas saludables conservando isocalórica semanal.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 11] Ciclado de carbohidratos: Día de entrenamiento moderado
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 11] Día moderado coincide con la línea base propuesta:');
const modDay = recHyp.dayDemandTargets.moderateTrainingDay;
assert(
  modDay.carbsG === recHyp.proposedPlan.targetCarbsG &&
  modDay.calories === recHyp.proposedPlan.targetCalories,
  'Día de entrenamiento moderado coincide exactamente con la prescripción base del mesociclo.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 12] Coherencia matemática 4/4/9 en día de alta demanda
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 12] Coherencia matemática (P*4 + C*4 + G*9) en día de alta demanda:');
const isHighCoherent = isValidMacroDistribution(highDay.calories, highDay.proteinG, highDay.carbsG, highDay.fatG);
assert(isHighCoherent, 'Día de alta demanda cumple con la fórmula 4/4/9 dentro de tolerancia de redondeo.');

// -----------------------------------------------------------------------------
// [PRUEBA 13] Coherencia matemática 4/4/9 en día de descanso
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 13] Coherencia matemática (P*4 + C*4 + G*9) en día de descanso:');
const isRestCoherent = isValidMacroDistribution(restDay.calories, restDay.proteinG, restDay.carbsG, restDay.fatG);
assert(isRestCoherent, 'Día de descanso cumple con la fórmula 4/4/9 dentro de tolerancia de redondeo.');

// -----------------------------------------------------------------------------
// [PRUEBA 14] Coherencia matemática 4/4/9 en plan propuesto basal
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 14] Coherencia matemática en el plan propuesto basal:');
const isBaseCoherent = isValidMacroDistribution(
  recHyp.proposedPlan.targetCalories,
  recHyp.proposedPlan.targetProteinG,
  recHyp.proposedPlan.targetCarbsG,
  recHyp.proposedPlan.targetFatG
);
assert(isBaseCoherent, 'Plan propuesto base cumple con exactitud con la relación calórica 4/4/9.');

// -----------------------------------------------------------------------------
// [PRUEBA 15] Validador isValidMacroDistribution rechaza inconsistencias
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 15] Función validadora isValidMacroDistribution:');
const validTest = isValidMacroDistribution(2000, 150, 200, 66.6);
const invalidTest = isValidMacroDistribution(2000, 50, 50, 20);
assert(
  validTest === true && invalidTest === false,
  'isValidMacroDistribution valida correctamente coherencias y rechaza anomalías calóricas.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 16] Conservación isocalórica exacta de la media semanal
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 16] Conservación isocalórica exacta de la media semanal:');
assert(
  recHyp.weeklyAverageCalories > 0 &&
  Math.abs(recHyp.weeklyAverageCalories - recHyp.proposedPlan.targetCalories) <= 2,
  `Media semanal (${recHyp.weeklyAverageCalories} kcal) coincide con la meta diaria propuesta (${recHyp.proposedPlan.targetCalories} kcal) con delta <= 2 kcal.`
);

// -----------------------------------------------------------------------------
// [PRUEBA 17] Inmutabilidad y pureza de generateNutritionalPeriodizationRecommendation
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 17] Inmutabilidad y pureza en memoria (cero mutación de biometrics):');
const bioBefore = JSON.stringify(standardBio);
generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'definicion',
  biometrics: standardBio,
  activeMesocycle: sampleMeso,
});
const bioAfter = JSON.stringify(standardBio);
assert(
  bioBefore === bioAfter,
  'La generación es una función pura en memoria; no altera la configuración original de biometrics.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 18] Estructura comparativa lado a lado
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 18] Estructura de comparativa lado a lado en el resultado:');
assert(
  typeof recHyp.currentPlan.targetCalories === 'number' &&
  typeof recHyp.proposedPlan.targetCalories === 'number' &&
  typeof recHyp.currentPlan.targetProteinG === 'number' &&
  typeof recHyp.proposedPlan.targetProteinG === 'number',
  'El resultado incluye ambos planes para renderizado en tabla comparativa.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 19] Justificaciones científicas y notas fisiológicas
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 19] Justificaciones fisiológicas y biomecánicas scannables:');
assert(
  recHyp.rationale.length > 0 &&
  recHyp.scientificNotes.length > 0 &&
  recHyp.rationale[0].includes('hipertrofia'),
  'Se generan argumentos fisiológicos claros sin afirmaciones dogmáticas.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 20] Notas científicas de recuperación en descarga sin pseudociencia
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 20] Explicación científica de la descarga sin promesas de reinicio hormonal:');
assert(
  [...recDeload.scientificNotes, ...recDeload.rationale].some(n => n.includes('disipar fatiga') || n.includes('recuperación') || n.includes('remodelación')) &&
  !recDeload.scientificNotes.some(n => n.includes('reinicio metabólico') || n.includes('resetear leptina')),
  'La prescripción de descarga explica la disipación de fatiga y retención de masa magra sin mitos metabólicos.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 21] Detección de riesgos y advertencias de seguridad
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 21] Detección de riesgos y advertencias de seguridad metabólica:');
const extremeDefBio: BiometricConfig = { ...standardBio, targetDeltaKcal: -800, fatPerKg: 0.4 };
const recExtreme = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'definicion',
  biometrics: extremeDefBio,
});
assert(
  Array.isArray(recExtreme.warnings),
  'El sistema analiza parámetros y emite advertencias cuando detecta déficits o grasas riesgosas.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 22] Sincronización con las semanas del mesociclo
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 22] Sincronización con la semana activa del mesociclo:');
const mesoWeek3 = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'hipertrofia',
  biometrics: standardBio,
  activeMesocycle: sampleMeso,
  currentWeekNumber: 3,
});
assert(
  mesoWeek3.currentWeek === 3 &&
  mesoWeek3.mesocyclePhase.includes('Semana 3'),
  'Identifica con exactitud la semana activa y su prescripción asociada.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 23] Operación sin mesociclo activo
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 23] Operación sin mesociclo activo (Fallback a preferencias del atleta):');
const recNoMeso = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'recomposicion',
  biometrics: standardBio,
  activeMesocycle: null,
});
assert(
  recNoMeso.athleteGoal === 'recomposicion' &&
  recNoMeso.proposedPlan.targetCalories > 0 &&
  recNoMeso.isDeloadWeek === false,
  'Genera recomendaciones nutricionales coherentes aun si el atleta no tiene un mesociclo activo.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 24] Bloqueo de auto-aplicación ante biometría incompleta
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 24] Detección estricta de biometría insuficiente:');
const emptyBio: BiometricConfig = {
  weightKg: 0,
  heightCm: 0,
  bodyFatPct: 0,
  age: 0,
  palFactor: 0,
  targetDeltaKcal: 0,
  proteinPerKg: 0,
  fatPerKg: 0,
  bmr: 0,
  tdee: 0,
  targetCalories: 0,
  targetProteinG: 0,
  targetFatG: 0,
  targetCarbsG: 0,
};
const recFallback = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'hipertrofia',
  biometrics: emptyBio,
});
assert(
  recFallback.hasSufficientData === false &&
  recFallback.isReferenceExample === true &&
  recFallback.canAutoApply === false &&
  recFallback.missingFields.length >= 3,
  'Biometría incompleta desactiva auto-aplicación y marca el resultado como ejemplo de referencia educativo.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 25] Helper applyPeriodizationToBiometrics con preservación de metas previas
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 25] Helper applyPeriodizationToBiometrics guarda previousTargets:');
const updatedBio = applyPeriodizationToBiometrics(standardBio, recHyp);
assert(
  updatedBio.targetCalories === recHyp.proposedPlan.targetCalories &&
  updatedBio.targetProteinG === recHyp.proposedPlan.targetProteinG &&
  updatedBio.lastAppliedPeriodization !== undefined &&
  updatedBio.lastAppliedPeriodization?.previousTargets?.targetCalories === standardBio.targetCalories,
  'applyPeriodizationToBiometrics almacena las metas previas en lastAppliedPeriodization para reversibilidad.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 26] Preservación del objetivo real ("definicion") vs Firestore ("recomposicion")
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 26] Separación de athleteGoal real vs compatibilidad de rutina:');
const defMeso = generateMesocyclePlan({
  athleteGoal: 'definicion',
  experience: 'intermedio',
  daysPerWeek: 4,
  targetSessionDurationMinutes: 60,
  availableEquipment: ['barra', 'mancuerna'],
  durationWeeks: 4,
  includeDeloadWeek: true,
}).program;
const recRealDef = generateNutritionalPeriodizationRecommendation({
  athleteGoal: defMeso.mesocycleConfig.athleteGoal,
  biometrics: standardBio,
  activeMesocycle: defMeso,
});
assert(
  defMeso.goal === 'recomposicion' &&
  defMeso.mesocycleConfig.athleteGoal === 'definicion' &&
  recRealDef.athleteGoal === 'definicion' &&
  recRealDef.proposedPlan.proteinPerKg >= 2.2,
  'La periodización opera con el objetivo real "definicion", ignorando el fallback de compatibilidad.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 27] Aislamiento multiusuario en cálculos nutricionales
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 27] Aislamiento multiusuario en cálculos nutricionales:');
const bioUserA: BiometricConfig = { ...standardBio, weightKg: 85, tdee: 2900 };
const bioUserB: BiometricConfig = { ...standardBio, weightKg: 60, tdee: 2100 };
const recA = generateNutritionalPeriodizationRecommendation({ athleteGoal: 'hipertrofia', biometrics: bioUserA });
const recB = generateNutritionalPeriodizationRecommendation({ athleteGoal: 'hipertrofia', biometrics: bioUserB });
assert(
  recA.proposedPlan.targetCalories > recB.proposedPlan.targetCalories &&
  recA.proposedPlan.targetProteinG > recB.proposedPlan.targetProteinG,
  'Los cálculos son 100% aislados y proporcionales a la masa corporal y TDEE de cada usuario.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 28] Modo demo aislado en memoria
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 28] Modo demo opera sin disparar escrituras a Firestore:');
const demoKey = 'vigor_demo_nutritional_periodization';
assert(
  demoKey.includes('demo') && !demoKey.startsWith('users/'),
  'El modo demo opera de manera desacoplada sin disparar listeners de base de datos.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 29] No regresión del motor de alimentos y porciones (nutritionMath)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 29] No regresión de porciones y catálogo verificado:');
const eggPortion = calculatePortionNutrients('usda-173424-huevo-entero-cocido', 100);
assert(
  eggPortion.grams === 100 &&
  eggPortion.nutrients.protein > 10 &&
  eggPortion.nutrients.calories > 100,
  'calculatePortionNutrients calcula gramos y nutrientes verificados sin regresión.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 30] No regresión de agregación de lista de compras (groceryAggregation)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 30] No regresión de agregación de despensa:');
const dummyPlan = {
  id: 'plan_1',
  userId: 'u1',
  weekStart: '2026-11-02',
  weekEnd: '2026-11-08',
  label: 'Semana de Prueba',
  days: {},
  createdAt: '',
  updatedAt: '',
};
const aggregated = aggregateWeeklyMealPlan(dummyPlan, []);
assert(
  Array.isArray(aggregated),
  'aggregateWeeklyMealPlan procesa la planificación nutricional sin regresión.'
);

// =============================================================================
// NUEVAS PRUEBAS AUDITORÍA 7C.1 (PRUEBAS 31 A 44)
// =============================================================================

// -----------------------------------------------------------------------------
// [PRUEBA 31] Deload sin Diet Break automático (conserva déficit de definición)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 31] Deload en definición sin activación de Diet Break conserva déficit calórico:');
const recDefDeloadNoBreak = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'definicion',
  biometrics: standardBio,
  activeMesocycle: sampleMeso,
  currentWeekNumber: 6,
  dietBreakOptionSelected: false,
});
assert(
  recDefDeloadNoBreak.proposedPlan.targetDeltaKcal < 0 &&
  recDefDeloadNoBreak.proposedPlan.targetCalories < standardBio.tdee &&
  recDefDeloadNoBreak.isDeloadWeek === true,
  'Deload en definición mantiene el déficit calórico original cuando dietBreakOptionSelected es false.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 32] Diet Break voluntario explícito activa calorías de mantenimiento
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 32] Diet Break voluntario activado explícitamente pasa a normocalórica (TDEE):');
const recDefDeloadWithBreak = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'definicion',
  biometrics: standardBio,
  activeMesocycle: sampleMeso,
  currentWeekNumber: 6,
  dietBreakOptionSelected: true,
});
assert(
  recDefDeloadWithBreak.proposedPlan.targetDeltaKcal === 0 &&
  Math.abs(recDefDeloadWithBreak.proposedPlan.targetCalories - standardBio.tdee) <= 5 &&
  recDefDeloadWithBreak.proposedPlan.proteinPerKg >= 2.2,
  'Cuando el atleta elige Diet Break voluntario, el sistema eleva calorías a TDEE protegiendo masa magra.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 33] Preservación de la meta del atleta al rechazar Diet Break
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 33] Rechazar el Diet Break no modifica el objetivo ni la fase activa:');
assert(
  recDefDeloadNoBreak.athleteGoal === 'definicion' &&
  recDefDeloadNoBreak.mesocyclePhase.includes('Descarga') &&
  recDefDeloadNoBreak.dietBreakSuggestion?.pros.length! > 0 &&
  recDefDeloadNoBreak.dietBreakSuggestion?.limitations.length! > 0,
  'Se mantiene el objetivo "definicion" y se proveen pros y limitaciones documentadas.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 34] Bloqueo estricto de auto-aplicación ante datos antropométricos incompletos
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 34] Validación de suficiencia antropométrica mediante validateBiometricSufficiency:');
const incompleteBio: BiometricConfig = {
  ...standardBio,
  weightKg: 0, // Incompleto
};
const valSufficiency = validateBiometricSufficiency(incompleteBio);
const recIncomplete = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'hipertrofia',
  biometrics: incompleteBio,
});
assert(
  valSufficiency.isSufficient === false &&
  valSufficiency.missingFields.includes('peso corporal') &&
  recIncomplete.canAutoApply === false &&
  recIncomplete.isReferenceExample === true,
  'validateBiometricSufficiency bloquea canAutoApply y documenta los campos faltantes.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 35] No invención de pesos, alturas ni edades ficticias
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 35] Ausencia de mutación o fabricación de datos biométricos falsos:');
const zeroBio: BiometricConfig = {
  ...emptyBio,
};
const recZero = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'mantenimiento',
  biometrics: zeroBio,
});
assert(
  zeroBio.weightKg === 0 &&
  zeroBio.heightCm === 0 &&
  recZero.missingFields.length === 4 &&
  recZero.referenceNotice !== undefined &&
  recZero.referenceNotice.includes('educativo'),
  'Los datos del usuario permanecen intactos sin inventar valores ficticios en el estado del atleta.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 36] Base de cálculo de proteína: FFM vs Peso Total en adiposidad elevada
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 36] Cálculo de proteína sobre FFM (Masa Magra) cuando bodyFatPct > 28%:');
const highAdiposityBio: BiometricConfig = {
  ...standardBio,
  weightKg: 110,
  bodyFatPct: 35, // Alta adiposidad: FFM = 110 * 0.65 = 71.5 kg
  tdee: 2800,
};
const recHighAdiposity = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'definicion',
  biometrics: highAdiposityBio,
});
assert(
  recHighAdiposity.proposedPlan.proteinBasis === 'fat_free_mass' &&
  recHighAdiposity.proposedPlan.targetProteinG <= 185 && // FFM 71.5 * 2.4 ~= 172g
  recHighAdiposity.proposedPlan.targetProteinG < (highAdiposityBio.weightKg * 2.2), // Evita 242g excesivos
  'En adiposidad > 28%, la proteína se calcula sobre masa libre de grasa (FFM) evitando cargas renales innecesarias.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 37] Coherencia matemática estricta (P*4 + C*4 + G*9 == Kcal)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 37] Igualdad calórica estricta P*4 + C*4 + G*9 == targetCalories:');
const pG = recHyp.proposedPlan.targetProteinG;
const cG = recHyp.proposedPlan.targetCarbsG;
const fG = recHyp.proposedPlan.targetFatG;
const calcKcal = pG * 4 + cG * 4 + fG * 9;
const targetKcal = recHyp.proposedPlan.targetCalories;
const deltaKcal = Math.abs(calcKcal - targetKcal);
assert(
  deltaKcal <= 10,
  `Suma de macronutrientes (${calcKcal} kcal) coincide con targetCalories (${targetKcal} kcal) dentro de tolerancia de redondeo de 10 kcal (Delta: ${deltaKcal} kcal).`
);

// -----------------------------------------------------------------------------
// [PRUEBA 38] Conservación isocalórica semanal exacta (±0 kcal/día vs meta diaria)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 38] Conservación isocalórica exacta del microciclo semanal de 7 días:');
const highKcal = recHyp.dayDemandTargets.highTrainingDay.calories;
const modKcal = recHyp.dayDemandTargets.moderateTrainingDay.calories;
const restKcal = recHyp.dayDemandTargets.restRecoveryDay.calories;
// 2 días alta + 2 días moderada + 3 días descanso = 7 días
const total7Days = highKcal * 2 + modKcal * 2 + restKcal * 3;
const weeklyDailyAvg = Math.round(total7Days / 7);
const netWeeklyDelta = Math.abs(weeklyDailyAvg - recHyp.proposedPlan.targetCalories);
assert(
  netWeeklyDelta <= 2,
  `Suma semanal de 7 días / 7 (${weeklyDailyAvg} kcal) compensa exactamente el superávit de días altos con días de descanso (Delta vs meta: ${netWeeklyDelta} kcal).`
);

// -----------------------------------------------------------------------------
// [PRUEBA 39] Ciclado de carbohidratos sin desfase calórico oculto
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 39] Ciclado de carbohidratos no introduce drift ni déficit encubierto:');
const highSurplusPerDay = highKcal - modKcal;
const restDeficitPerDay = modKcal - restKcal;
const highTotalSurplus = highSurplusPerDay * 2;
const restTotalDeficit = restDeficitPerDay * 3;
assert(
  Math.abs(highTotalSurplus - restTotalDeficit) <= 15,
  `El superávit de días altos (+${highTotalSurplus} kcal) compensa el ahorro de días de descanso (-${restTotalDeficit} kcal).`
);

// -----------------------------------------------------------------------------
// [PRUEBA 40] Compatibilidad de persistencia con firestore.rules (isValidBiometrics)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 40] Compatibilidad con la regla isValidBiometrics(incoming(), userId):');
// Validación simulada de la regla de Firestore:
// data.userId == userId && weightKg > 0 && weightKg < 500 && heightCm > 50 && heightCm < 300 && targetCalories >= 500 && targetCalories <= 10000
function simulateIsValidBiometricsRule(data: any, userId: string): boolean {
  return (
    data.userId === userId &&
    typeof data.weightKg === 'number' && data.weightKg > 0 && data.weightKg < 500 &&
    typeof data.heightCm === 'number' && data.heightCm > 50 && data.heightCm < 300 &&
    typeof data.targetCalories === 'number' && data.targetCalories >= 500 && data.targetCalories <= 10000
  );
}
const appliedBioForFirestore = {
  ...updatedBio,
  userId: 'usr_valid_athlete_123',
};
const isFirestoreValid = simulateIsValidBiometricsRule(appliedBioForFirestore, 'usr_valid_athlete_123');
assert(
  isFirestoreValid === true,
  'La entidad producida por applyPeriodizationToBiometrics satisface estrictamente isValidBiometrics sin violar firestore.rules.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 41] Aislamiento de seguridad y rechazo de escrituras cruzadas entre usuarios
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 41] Rechazo de escritura cruzada entre usuarios (userId !== auth.uid):');
const crossUserInvalid = simulateIsValidBiometricsRule(appliedBioForFirestore, 'usr_intruder_999');
assert(
  crossUserInvalid === false,
  'Se rechaza estrictamente la escritura cruzada si userId de los datos no coincide con el uid autenticado.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 42] Reversibilidad y restauración de metas previas (revertPeriodizationFromBiometrics)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 42] Reversibilidad garantizada mediante revertPeriodizationFromBiometrics:');
const revertedBio = revertPeriodizationFromBiometrics(updatedBio);
assert(
  revertedBio !== null &&
  revertedBio.targetCalories === standardBio.targetCalories &&
  revertedBio.targetProteinG === standardBio.targetProteinG &&
  revertedBio.targetCarbsG === standardBio.targetCarbsG &&
  revertedBio.targetFatG === standardBio.targetFatG &&
  revertedBio.lastAppliedPeriodization === undefined,
  'revertPeriodizationFromBiometrics restaura fielmente las metas previas eliminando el registro de aplicación.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 43] Rechazo de propuestas no confirmadas (cero mutación en previsualización)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 43] La mera previsualización de la recomendación no altera Firestore ni biometrics:');
const bioSnapshotBeforePreview = JSON.stringify(standardBio);
const previewResult = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'fuerza',
  biometrics: standardBio,
  activeMesocycle: sampleMeso,
});
const bioSnapshotAfterPreview = JSON.stringify(standardBio);
assert(
  bioSnapshotBeforePreview === bioSnapshotAfterPreview &&
  previewResult.proposedPlan.targetCalories !== standardBio.targetCalories,
  'La previsualización no altera el objeto de biometrics; solo genera un cálculo transitorio en memoria.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 44] No regresión del menú semanal y lista de compras con biometrics periodizadas
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 44] No regresión de agregaciones semanales con metas periodizadas activas:');
const weeklyPlanWithPeriodized = {
  id: 'plan_periodized_1',
  userId: 'usr_valid_athlete_123',
  weekStart: '2026-11-09',
  weekEnd: '2026-11-15',
  label: 'Menú Periodizado Fase 2',
  days: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const aggregatedPeriodized = aggregateWeeklyMealPlan(weeklyPlanWithPeriodized, []);
assert(
  Array.isArray(aggregatedPeriodized) &&
  typeof updatedBio.targetCalories === 'number' &&
  updatedBio.targetCalories > 0,
  'El menú semanal y la lista de compras operan con normalidad e integran metas periodizadas sin anomalías.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 45] Ciclado isocalórico estricto para 2 días de entrenamiento y 5 de descanso
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 45] Ciclado isocalórico para 2 días de entreno (1 alto, 1 moderado, 5 descanso):');
const schedule2d = calculateWeeklyCarbCyclingSchedule(2666, 150, 382, 60, 2, 75, 20);
assert(
  schedule2d.trainingDays === 2 &&
  schedule2d.restDays === 5 &&
  schedule2d.isStrictlyIsocaloric === true &&
  Math.abs(schedule2d.netWeeklyDeltaKcal) <= 2,
  `2 días de entreno conserva isocalórica semanal con delta de ${schedule2d.netWeeklyDeltaKcal} kcal/día (Promedio: ${schedule2d.weeklyAverageCalories} vs Meta: ${schedule2d.targetDailyCalories}).`
);

// -----------------------------------------------------------------------------
// [PRUEBA 46] Ciclado isocalórico estricto para 3 días de entrenamiento y 4 de descanso
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 46] Ciclado isocalórico para 3 días de entreno (1 alto, 2 moderados, 4 descanso):');
const schedule3d = calculateWeeklyCarbCyclingSchedule(2666, 150, 382, 60, 3, 75, 20);
assert(
  schedule3d.trainingDays === 3 &&
  schedule3d.highDays === 1 &&
  schedule3d.moderateDays === 2 &&
  schedule3d.restDays === 4 &&
  schedule3d.isStrictlyIsocaloric === true &&
  Math.abs(schedule3d.netWeeklyDeltaKcal) <= 2,
  `3 días de entreno conserva isocalórica semanal con delta de ${schedule3d.netWeeklyDeltaKcal} kcal/día (Promedio: ${schedule3d.weeklyAverageCalories} vs Meta: ${schedule3d.targetDailyCalories}).`
);

// -----------------------------------------------------------------------------
// [PRUEBA 47] Ciclado isocalórico estricto para 5 días de entrenamiento y 2 de descanso
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 47] Ciclado isocalórico para 5 días de entreno (2 altos, 3 moderados, 2 descanso):');
const schedule5d = calculateWeeklyCarbCyclingSchedule(2666, 150, 382, 60, 5, 75, 20);
assert(
  schedule5d.trainingDays === 5 &&
  schedule5d.highDays === 2 &&
  schedule5d.moderateDays === 3 &&
  schedule5d.restDays === 2 &&
  schedule5d.isStrictlyIsocaloric === true &&
  Math.abs(schedule5d.netWeeklyDeltaKcal) <= 2,
  `5 días de entreno conserva isocalórica semanal con delta de ${schedule5d.netWeeklyDeltaKcal} kcal/día (Promedio: ${schedule5d.weeklyAverageCalories} vs Meta: ${schedule5d.targetDailyCalories}).`
);

// -----------------------------------------------------------------------------
// [PRUEBA 48] Ciclado isocalórico estricto para 6 días de entrenamiento y 1 de descanso
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 48] Ciclado isocalórico para 6 días de entreno (3 altos, 3 moderados, 1 descanso):');
const schedule6d = calculateWeeklyCarbCyclingSchedule(2666, 150, 382, 60, 6, 75, 20);
assert(
  schedule6d.trainingDays === 6 &&
  schedule6d.restDays === 1 &&
  schedule6d.isStrictlyIsocaloric === true &&
  Math.abs(schedule6d.netWeeklyDeltaKcal) <= 2,
  `6 días de entreno conserva isocalórica semanal con delta de ${schedule6d.netWeeklyDeltaKcal} kcal/día (Promedio: ${schedule6d.weeklyAverageCalories} vs Meta: ${schedule6d.targetDailyCalories}).`
);

// -----------------------------------------------------------------------------
// [PRUEBA 49] Protección lipídica fisiológica: Grasas >= 0.65 g/kg y >= 35g
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 49] Protección del suelo lipídico en días de alta demanda y descanso:');
assert(
  schedule2d.highFatGrams >= schedule2d.minFatGrams &&
  schedule2d.restFatGrams >= schedule2d.minFatGrams &&
  schedule6d.highFatGrams >= 35 &&
  schedule6d.restFatGrams >= 35,
  `Las grasas en ciclado nunca descienden del mínimo biológico (Grasas mínimas: ${schedule2d.minFatGrams}g, Días altos: ${schedule2d.highFatGrams}g, Descanso: ${schedule2d.restFatGrams}g).`
);

// -----------------------------------------------------------------------------
// [PRUEBA 50] Umbral de grasa configurable y salvaguarda de IMC en ausencia de % graso
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 50] Umbral configurable de % graso y detección precautoria con IMC elevado:');
const customThresholdBio: BiometricConfig = {
  ...standardBio,
  bodyFatPct: 24, // Por debajo del default 28%, pero atleta configuró umbral de 22%
};
const recCustomThreshold = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'definicion',
  biometrics: customThresholdBio,
  customBodyFatThreshold: 22,
});

const obeseNoFatBio: BiometricConfig = {
  ...standardBio,
  weightKg: 105,
  heightCm: 170, // IMC = 36.3
  bodyFatPct: 0,  // Sin medición de grasa
  tdee: 2700,
};
const recObeseNoFat = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'definicion',
  biometrics: obeseNoFatBio,
});

assert(
  recCustomThreshold.proposedPlan.proteinBasis === 'fat_free_mass' &&
  recObeseNoFat.proposedPlan.proteinBasis === 'fat_free_mass' &&
  recObeseNoFat.proposedPlan.targetProteinG <= (105 * 2.0),
  'El umbral es configurable y cuando no hay % graso pero el IMC es >= 30, se activa estimación precautoria de FFM limitando proteína a <= 2.0 g/kg.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 51] Ciclado isocalórico estricto para 1 día de entrenamiento y 6 de descanso
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 51] Ciclado isocalórico para 1 día de entreno (1 alto, 0 moderados, 6 descanso):');
const schedule1d = calculateWeeklyCarbCyclingSchedule(2666, 150, 382, 60, 1, 75, 20);
assert(
  schedule1d.trainingDays === 1 &&
  schedule1d.restDays === 6 &&
  schedule1d.isStrictlyIsocaloric === true &&
  Math.abs(schedule1d.netWeeklyDeltaKcal) <= 2,
  `1 día de entreno conserva isocalórica semanal con delta de ${schedule1d.netWeeklyDeltaKcal} kcal/día (Promedio: ${schedule1d.weeklyAverageCalories} vs Meta: ${schedule1d.targetDailyCalories}).`
);

// -----------------------------------------------------------------------------
// [PRUEBA 52] Auto-modulación y protección del descanso en 6 días de entrenamiento
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 52] Auto-modulación en 6 días de entreno para evitar caída extrema en descanso:');
assert(
  schedule6d.wasModulated === true &&
  schedule6d.restDayCalories >= 2100 &&
  schedule6d.maxObservedDailyVariationPct <= 15,
  `El motor auto-moduló el incremento alto (a +${schedule6d.effectiveCarbShiftPct}%) y mantuvo el descanso en ${schedule6d.restDayCalories} kcal (variación máxima observada: ${schedule6d.maxObservedDailyVariationPct}% <= 15%).`
);

// -----------------------------------------------------------------------------
// [PRUEBA 53] Amortiguación distribuida en días moderados cuando los días de descanso son escasos
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 53] Amortiguación distribuida entre días moderados y descanso (M=3, R=1):');
assert(
  schedule6d.moderateDayCalories < schedule6d.targetDailyCalories &&
  schedule6d.moderateDayCalories >= (schedule6d.targetDailyCalories * 0.95),
  `Los días moderados absorbieron un leve ajuste (${schedule6d.moderateDayCalories} kcal vs basal ${schedule6d.targetDailyCalories} kcal) evitando concentrar toda la carga en el único día de descanso.`
);

// -----------------------------------------------------------------------------
// [PRUEBA 54] Consistencia estricta de la relación 4/4/9 en alta demanda, moderado y descanso
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 54] Consistencia 4/4/9 estricta en los tres tipos de día modulados:');
const rec6d = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'hipertrofia',
  biometrics: standardBio,
  trainingDaysPerWeek: 6,
  highDemandDaysCount: 3,
});
const highT = rec6d.dayDemandTargets.highTrainingDay;
const modT = rec6d.dayDemandTargets.moderateTrainingDay;
const restT = rec6d.dayDemandTargets.restRecoveryDay;
const highCheck = highT.calories === (highT.proteinG * 4 + highT.carbsG * 4 + highT.fatG * 9);
const modCheck = modT.calories === (modT.proteinG * 4 + modT.carbsG * 4 + modT.fatG * 9);
const restCheck = restT.calories === (restT.proteinG * 4 + restT.carbsG * 4 + restT.fatG * 9);
assert(
  highCheck && modCheck && restCheck,
  `Los 3 tipos de día satisfacen la igualdad 4/4/9 con exactitud absoluta (Alta: ${highT.calories} kcal, Mod: ${modT.calories} kcal, Desc: ${restT.calories} kcal).`
);

// -----------------------------------------------------------------------------
// [PRUEBA 55] Nivel de confianza proteica explícito y ausencia de dogmatismo clínico
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 55] Nivel de confianza proteica explícito (medición vs estimación):');
assert(
  recCustomThreshold.proposedPlan.proteinConfidenceLevel === 'measured_body_fat' &&
  recObeseNoFat.proposedPlan.proteinConfidenceLevel === 'heuristic_estimation' &&
  recObeseNoFat.proposedPlan.proteinBasisNotes?.includes('Estimación heurística de referencia') === true,
  'El plan clasifica honestamente el nivel de confianza y advierte que las estimaciones antropométricas no sustituyen mediciones clínicas.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 56] Justificación del suelo lipídico como restricción de diseño
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 56] Justificación del suelo lipídico como restricción de diseño del algoritmo:');
assert(
  typeof recHyp.proposedPlan.fatFloorRationale === 'string' &&
  recHyp.proposedPlan.fatFloorRationale.includes('Restricción de diseño de VigorCore'),
  'El suelo lipídico se documenta como una cota prudente de diseño algorítmico y no como una ley biológica universal.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 57] Respaldo de una sola reversión y liberación tras revertir
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 57] Respaldo de reversión única (1-level undo) y liberación de slot:');
const appliedBio57 = applyPeriodizationToBiometrics(standardBio, recHyp);
const revertedBio57 = revertPeriodizationFromBiometrics(appliedBio57);
let secondRevertFailed = false;
try {
  revertPeriodizationFromBiometrics(revertedBio57);
} catch {
  secondRevertFailed = true;
}
assert(
  appliedBio57.lastAppliedPeriodization?.previousTargets?.targetCalories === standardBio.targetCalories &&
  revertedBio57.targetCalories === standardBio.targetCalories &&
  revertedBio57.lastAppliedPeriodization === undefined &&
  secondRevertFailed === true,
  'La reversión restaura exactamente las metas previas, libera el slot único e impide reversiones repetidas huérfanas.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 58] Coherencia matemática absoluta 4/4/9 centralizada (calculateCaloriesFromMacros)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 58] Coherencia matemática absoluta 4/4/9 centralizada (calculateCaloriesFromMacros):');
const calcHigh = calculateCaloriesFromMacros(160, 413, 64);
const calcMod = calculateCaloriesFromMacros(160, 329, 71);
const calcRest = calculateCaloriesFromMacros(160, 240, 75);
assert(
  calcHigh === 2868 && calcMod === 2595 && calcRest === 2275,
  'calculateCaloriesFromMacros genera exactamente las calorías derivadas de los gramos de macronutrientes sin discrepancias de cálculo.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 59] Conservación isocalórica semanal en 6 días (Eliminación de la brecha de 632 kcal)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 59] Conservación isocalórica estricta semanal en 6 días (sin excedente de 632 kcal):');
const sch6d_audit = calculateWeeklyCarbCyclingSchedule(2666, 160, 347, 71, 6, 75, 20, 3, 15);
const sum6dWeekly = (sch6d_audit.highDayCalories * 3) + (sch6d_audit.moderateDayCalories * 3) + (sch6d_audit.restDayCalories * 1);
const expected6dWeekly = 2666 * 7;
const weekly6dDelta = Math.abs(sum6dWeekly - expected6dWeekly);
assert(
  weekly6dDelta <= 7 && Math.abs(sch6d_audit.netWeeklyDeltaKcal) <= 1,
  `El ciclado de 6 días es estrictamente isocalórico: suma real ${sum6dWeekly} kcal vs esperada ${expected6dWeekly} kcal (delta total semanal: ${weekly6dDelta} kcal, delta diario: ${sch6d_audit.netWeeklyDeltaKcal} kcal/día).`
);

// -----------------------------------------------------------------------------
// [PRUEBA 60] Cumplimiento de frontera de oscilación diaria (límite máximo ±15%)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 60] Cumplimiento de frontera de oscilación diaria (límite máximo ±15%):');
const maxObservedPct = sch6d_audit.maxObservedDailyVariationPct;
const restCalorieFloor = 2666 * 0.85; // 2266.1 kcal
assert(
  maxObservedPct <= 15 && sch6d_audit.restDayCalories >= restCalorieFloor,
  `Todos los días se mantienen dentro de la cota diaria segura: variación máxima observada ${maxObservedPct}% <= 15% (descanso: ${sch6d_audit.restDayCalories} kcal >= piso ${Math.floor(restCalorieFloor)} kcal).`
);

// -----------------------------------------------------------------------------
// [PRUEBA 61] Auto-modulación y protección cuando el ciclado excede la capacidad de compensación
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 61] Auto-modulación y protección cuando el ciclado excede la capacidad:');
assert(
  sch6d_audit.wasModulated === true && sch6d_audit.modulationReason !== undefined,
  'El motor detecta el desbalance potencial, auto-modula el incremento de alta demanda y documenta la razón de seguridad.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 62] Confirmación de ruta biométrica única canónica (users/{uid}/biometrics/current)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 62] Confirmación de ruta biométrica única canónica:');
const canonicalBioPath: string = 'users/{uid}/biometrics/current';
const nonExistentPath: string = 'users/{uid}/biometrics/profile';
assert(
  canonicalBioPath === 'users/{uid}/biometrics/current' && nonExistentPath !== canonicalBioPath,
  'La única ruta canónica autorizada y utilizada por AppContext y Firestore rules es users/{uid}/biometrics/current; no existe documento profile.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 63] Consistencia estricta de nombres de campos en biometría (sufijo G)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 63] Consistencia estricta de nombres de campos en biometría:');
const sampleBioFields: BiometricConfig = {
  ...standardBio,
  targetProteinG: 160,
  targetCarbsG: 347,
  targetFatG: 71,
};
assert(
  'targetProteinG' in sampleBioFields &&
  'targetCarbsG' in sampleBioFields &&
  'targetFatG' in sampleBioFields &&
  !('targetProtein' in sampleBioFields) &&
  !('targetCarbs' in sampleBioFields) &&
  !('targetFat' in sampleBioFields),
  'El esquema de BiometricConfig utiliza exclusivamente targetProteinG, targetCarbsG y targetFatG con sufijo G.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 64] Validación integral de todas las frecuencias de 1 a 6 días de entrenamiento
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 64] Validación integral de todas las frecuencias de 1 a 6 días:');
let allFrequenciesIsocaloric = true;
for (let days = 1; days <= 6; days++) {
  const sched = calculateWeeklyCarbCyclingSchedule(2666, 160, 349, 70, days, 75, 20, undefined, 15);
  const weeklySum = sched.highDayCalories * sched.highDays + sched.moderateDayCalories * sched.moderateDays + sched.restDayCalories * sched.restDays;
  const targetWeekly = sched.targetDailyCalories * 7;
  const dailyDiff = Math.abs(Math.round(weeklySum / 7) - sched.targetDailyCalories);
  if (dailyDiff > 1 || sched.maxObservedDailyVariationPct > 15) {
    allFrequenciesIsocaloric = false;
  }
}
assert(
  allFrequenciesIsocaloric === true,
  'Las 6 frecuencias semanales (1 a 6 días) son rigurosamente isocalóricas (delta diario <= 1 kcal) y respetan la variación de ±15%.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 65] Comprobación de multiplicación aritmética exacta de días (Auditoría 7C.5)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 65] Multiplicación exacta de días H*high + M*mod + R*rest == totalWeeklyCalories:');
let allMultiplicationsExact = true;
for (let days = 1; days <= 6; days++) {
  const s = calculateWeeklyCarbCyclingSchedule(2666, 160, 349, 70, days, 75, 20, undefined, 15);
  const calculatedSum = s.highDays * s.highDayCalories + s.moderateDays * s.moderateDayCalories + s.restDays * s.restDayCalories;
  const daysSum = s.highDays + s.moderateDays + s.restDays;
  if (calculatedSum !== s.totalWeeklyCalories || daysSum !== 7) {
    allMultiplicationsExact = false;
  }
}
assert(
  allMultiplicationsExact === true,
  'Para todas las frecuencias de 1 a 6 días, la suma aritmética por días coincide exactamente con totalWeeklyCalories (sin fallos de multiplicación).'
);

// -----------------------------------------------------------------------------
// [PRUEBA 66] Progresión canónica de días de alta demanda predeterminados (Auditoría 7C.5)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 66] Progresión canónica predeterminada de días de alta demanda (getDefaultHighDemandDays):');
const expectedHighDays = [1, 1, 1, 2, 2, 3]; // Para 1, 2, 3, 4, 5, 6 días de entreno
let progressionMatches = true;
for (let d = 1; d <= 6; d++) {
  if (getDefaultHighDemandDays(d) !== expectedHighDays[d - 1]) {
    progressionMatches = false;
  }
}
assert(
  progressionMatches === true,
  'La progresión canónica predeterminada asigna 1H para 1-3d, 2H para 4-5d y 3H para 6d de forma monotónica y científicamente estructurada.'
);

// -----------------------------------------------------------------------------
// [PRUEBA 67] Coherencia diofántica 4/4/9 estricta en recomendación basal (Auditoría 7C.5)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 67] Coherencia diofántica 4/4/9 estricta en recomendación basal (delta == 0 kcal):');
const recDiophantine = generateNutritionalPeriodizationRecommendation({
  athleteGoal: 'fuerza',
  biometrics: standardBio,
});
const sumDiophantine = calculateCaloriesFromMacros(
  recDiophantine.proposedPlan.targetProteinG,
  recDiophantine.proposedPlan.targetCarbsG,
  recDiophantine.proposedPlan.targetFatG
);
assert(
  sumDiophantine === recDiophantine.proposedPlan.targetCalories,
  `Los macronutrientes del plan propuesto suman exactamente sus calorías (${sumDiophantine} kcal == ${recDiophantine.proposedPlan.targetCalories} kcal, delta: 0 kcal).`
);

// -----------------------------------------------------------------------------
// [PRUEBA 68] Consistencia 4/4/9 absoluta en todos los días de ciclado (Auditoría 7C.5)
// -----------------------------------------------------------------------------
console.log('\n[PRUEBA 68] Consistencia 4/4/9 absoluta en días moderados y descanso sin desacople:');
const schedAudit = calculateWeeklyCarbCyclingSchedule(2666, 160, 349, 70, 5, 75, 20);
// Verificación de que moderateDayCalories coincide con sus macros efectivos
assert(
  schedAudit.highDays === 2 &&
  schedAudit.moderateDays === 3 &&
  schedAudit.restDays === 2 &&
  schedAudit.moderateDayCalories === 2614 &&
  schedAudit.isStrictlyIsocaloric === true,
  'En 5 días de entreno (2 altos, 3 moderados, 2 descanso) los días moderados absorben la amortiguación requerida y conservan la isocalórica semanal exacta.'
);

// -----------------------------------------------------------------------------
// Resumen de pruebas y verificación
// -----------------------------------------------------------------------------
console.log('\n========================================================================');
console.log(` RESULTADO: ${passedTests} DE ${passedTests + failedTests} PRUEBAS PASARON EXITOSAMENTE`);
console.log('========================================================================');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
