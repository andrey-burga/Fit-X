/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Incremento 7C.1: Auditoría Científica, Matemática y de Persistencia
 * de la Periodización Nutricional
 *
 * Principios Científicos y de Integridad:
 *  1. Rigor biométrico: Validación estricta de datos. No se inventan pesos, edades ni actividades.
 *     Si faltan datos, la recomendación no se personaliza ni se permite persistir automáticamente.
 *  2. Deload y Diet Break voluntario: La pausa dietética a mantenimiento NO es obligatoria ni
 *     automática. Se preserva el objetivo de definición por defecto y se explica la pausa
 *     con sus ventajas, limitaciones y condiciones reales, sin promesas pseudocientíficas
 *     de "reinicio metabólico" ni "normalización hormonal garantizada".
 *  3. Base de cálculo proteico explícito: Identificación de la base (peso corporal total vs. masa libre
 *     de grasa / FFM en individuos con adiposidad elevada) para evitar sobrecargas proteicas.
 *  4. Ciclado de carbohidratos isocalórico estricto: Conservación exacta del promedio calórico
 *     semanal (desviación <= 2 kcal/día), tratando los porcentajes como heurísticas adaptativas.
 *  5. Trazabilidad y reversibilidad: Registro de metas previas en `lastAppliedPeriodization`
 *     y soporte para reversión a la configuración anterior sin alterar historial de comidas.
 *  6. 100% funciones puras en memoria compatibles con isValidBiometrics de Cloud Firestore.
 */

import { AthleteGoal } from '../types/auth';
import { BiometricConfig } from '../types';
import { RoutineDay, ExecutedWorkout } from '../types/workout';
import { MesocycleRoutine, MesocycleWeekPrescription } from '../types/mesocycle';

// ========================================================
// 1. TIPOS Y CONTRATOS DE PERIODIZACIÓN NUTRICIONAL
// ========================================================

export type TrainingDayDemand = 'high_demand' | 'moderate_demand' | 'rest_recovery';

export type ProteinCalculationBasis = 'total_body_weight' | 'fat_free_mass' | 'adjusted_body_weight';

export type ProteinConfidenceLevel = 'measured_body_fat' | 'heuristic_estimation' | 'standard_weight_basis';

export interface NutritionalPeriodizationPlan {
  targetCalories: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
  proteinPerKg: number;
  fatPerKg: number;
  targetDeltaKcal: number;
  proteinBasis: ProteinCalculationBasis;
  proteinConfidenceLevel?: ProteinConfidenceLevel;
  proteinBasisNotes?: string;
  proteinGramsPerKgBasis: number;
  fatFreeMassKg?: number;
  fatFloorRationale?: string;
  isReferenceExample?: boolean;
}

export interface DayDemandNutritionalTarget {
  dayType: TrainingDayDemand;
  label: string;
  description: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  carbShiftPct: number;
  fatShiftPct: number;
  isAutoModulated?: boolean;
  rationale: string;
}

export interface DietBreakSuggestion {
  available: boolean;
  label: string;
  deltaKcal: number;
  targetCalories: number;
  rationale?: string;
  pros: string[];
  limitations: string[];
  conditions: string[];
}

export interface NutritionalPeriodizationInput {
  athleteGoal: AthleteGoal;
  biometrics: BiometricConfig;
  activeMesocycle?: MesocycleRoutine | null;
  currentWeekNumber?: number;
  executedWorkoutsHistory?: ExecutedWorkout[];
  dietBreakOptionSelected?: boolean; // Elección explícita y voluntaria del usuario (Incremento 7C.1)
  customCarbShiftPct?: number;       // Heurística configurable (default 20%)
  trainingDaysPerWeek?: number;      // Distribución semanal (1 a 6 días)
  highDemandDaysCount?: number;      // Días de alta demanda a programar
  customBodyFatThreshold?: number;   // Umbral configurable para transición a FFM (default 28%)
  maxDailyCalorieVariationPct?: number; // Límite de variación diaria respecto al basal (default 18%, ej. 15%-25%)
}

export interface NutritionalPeriodizationResult {
  hasSufficientData: boolean;
  missingFields: string[];
  athleteGoal: AthleteGoal;
  mesocycleName?: string;
  mesocyclePhase: string;
  currentWeek: number;
  totalWeeks: number;
  isDeloadWeek: boolean;
  dietBreakApplied: boolean;
  dietBreakSuggestion?: DietBreakSuggestion;
  currentPlan: NutritionalPeriodizationPlan;
  proposedPlan: NutritionalPeriodizationPlan;
  dayDemandTargets: {
    highTrainingDay: DayDemandNutritionalTarget;
    moderateTrainingDay: DayDemandNutritionalTarget;
    restRecoveryDay: DayDemandNutritionalTarget;
  };
  weeklyAverageCalories: number;
  weeklyEnergyBalanceType: 'isocalorica_estricta' | 'ciclado_calorico';
  weeklyCalorieDeltaPerDay: number;
  wasCarbCyclingModulated?: boolean;
  carbCyclingModulationReason?: string;
  maxObservedDailyVariationPct?: number;
  rationale: string[];
  warnings: string[];
  scientificNotes: string[];
  canAutoApply: boolean;
  referenceNotice?: string;
  isReferenceExample?: boolean;
}

// ========================================================
// 2. CONSTANTES Y GUÍAS FISIOLÓGICAS DE MACRONUTRIENTES
// ========================================================

export const GOAL_NUTRITIONAL_GUIDELINES: Record<
  AthleteGoal,
  {
    targetDeltaRange: [number, number]; // kcal sobre TDEE
    proteinPerKgRange: [number, number]; // g/kg
    fatPerKgRange: [number, number]; // g/kg
    defaultDelta: number;
    defaultProteinPerKg: number;
    defaultFatPerKg: number;
    summary: string;
    scientificRationale: string;
  }
> = {
  hipertrofia: {
    targetDeltaRange: [150, 300],
    proteinPerKgRange: [1.8, 2.2],
    fatPerKgRange: [0.8, 1.0],
    defaultDelta: 200,
    defaultProteinPerKg: 2.0,
    defaultFatPerKg: 0.9,
    summary: 'Superávit calórico controlado y disponibilidad óptima de carbohidratos.',
    scientificRationale:
      'Un superávit moderado de +150 a +300 kcal apoya la síntesis proteica muscular minimizando la acumulación de tejido adiposo. Los carbohidratos suficientes sostienen el volumen glucolítico de series efectivas.',
  },
  fuerza: {
    targetDeltaRange: [50, 200],
    proteinPerKgRange: [1.6, 2.0],
    fatPerKgRange: [0.8, 1.0],
    defaultDelta: 100,
    defaultProteinPerKg: 1.8,
    defaultFatPerKg: 0.9,
    summary: 'Balance energético neutro o levemente positivo para soporte neuromuscular.',
    scientificRationale:
      'La fuerza depende primordialmente de adaptaciones neurales y resíntesis de fosfocreatina. Un balance energético neutro a ligeramente positivo (+100 kcal) apoya la recuperación del SNC sin incremento indeseado de masa corporal.',
  },
  recomposicion: {
    targetDeltaRange: [-150, 0],
    proteinPerKgRange: [2.0, 2.4],
    fatPerKgRange: [0.7, 0.9],
    defaultDelta: -100,
    defaultProteinPerKg: 2.2,
    defaultFatPerKg: 0.8,
    summary: 'Déficit sutil o isocalórica con ingesta proteica elevada y ciclado de nutrientes.',
    scientificRationale:
      'La síntesis muscular y la oxidación lipídica pueden coexistir con un déficit energético conservador (-100 kcal) si la ingesta de aminoácidos es alta y se concentra la energía alrededor de las sesiones.',
  },
  definicion: {
    targetDeltaRange: [-500, -300],
    proteinPerKgRange: [2.2, 2.6],
    fatPerKgRange: [0.65, 0.8],
    defaultDelta: -400,
    defaultProteinPerKg: 2.4,
    defaultFatPerKg: 0.7,
    summary: 'Déficit calórico estructurado con máxima protección de masa magra.',
    scientificRationale:
      'En restricción calórica aumenta la degradación proteica muscular. Ingestas de 2.2 a 2.6 g/kg de proteína y un déficit moderado (-15% a -20%) previenen la pérdida de tejido muscular mientras se movilizan los depósitos lipídicos.',
  },
  mantenimiento: {
    targetDeltaRange: [-50, 50],
    proteinPerKgRange: [1.6, 2.0],
    fatPerKgRange: [0.8, 1.0],
    defaultDelta: 0,
    defaultProteinPerKg: 1.8,
    defaultFatPerKg: 0.9,
    summary: 'Isocalórica estable para consolidación y rendimiento atlético sostenido.',
    scientificRationale:
      'Igualar la ingesta calórica al gasto energético diario total (TDEE) estabiliza las reservas de glucógeno y mantiene la homeostasis metabólica sin oscilaciones de peso corporal.',
  },
  ganancia_muscular: {
    targetDeltaRange: [150, 300],
    proteinPerKgRange: [1.8, 2.2],
    fatPerKgRange: [0.8, 1.0],
    defaultDelta: 200,
    defaultProteinPerKg: 2.0,
    defaultFatPerKg: 0.9,
    summary: 'Superávit calórico controlado y disponibilidad óptima de carbohidratos.',
    scientificRationale:
      'Un superávit de +150 a +300 kcal optimiza la tasa de síntesis proteica muscular.',
  },
  perdida_grasa: {
    targetDeltaRange: [-500, -300],
    proteinPerKgRange: [2.2, 2.6],
    fatPerKgRange: [0.65, 0.8],
    defaultDelta: -400,
    defaultProteinPerKg: 2.4,
    defaultFatPerKg: 0.7,
    summary: 'Déficit calórico estructurado con máxima protección de masa magra.',
    scientificRationale:
      'Déficit moderado con proteína elevada para movilizar grasa preservando el tejido contráctil.',
  },
  rendimiento: {
    targetDeltaRange: [50, 200],
    proteinPerKgRange: [1.6, 2.0],
    fatPerKgRange: [0.8, 1.0],
    defaultDelta: 100,
    defaultProteinPerKg: 1.8,
    defaultFatPerKg: 0.9,
    summary: 'Balance energético neutro o levemente positivo para soporte neural.',
    scientificRationale:
      'Disponibilidad energética adecuada para sostener la intensidad y velocidad en levantamientos pesados.',
  },
  resistencia: {
    targetDeltaRange: [0, 100],
    proteinPerKgRange: [1.6, 1.8],
    fatPerKgRange: [0.8, 1.0],
    defaultDelta: 50,
    defaultProteinPerKg: 1.6,
    defaultFatPerKg: 0.9,
    summary: 'Alta densidad glucídica para sostener el volumen mitocondrial y oxidativo.',
    scientificRationale:
      'Prioriza carbohidratos para mantener el flujo glucolítico en sesiones de larga duración.',
  },
  salud_general: {
    targetDeltaRange: [-50, 50],
    proteinPerKgRange: [1.6, 1.8],
    fatPerKgRange: [0.8, 1.0],
    defaultDelta: 0,
    defaultProteinPerKg: 1.6,
    defaultFatPerKg: 0.9,
    summary: 'Isocalórica balanceada con enfoque en densidad de micronutrientes y hábitos sostenibles.',
    scientificRationale:
      'Balance energético neutro con macronutrientes equilibrados para longevidad y bienestar metabólico.',
  },
};

// ========================================================
// 3. MATEMÁTICAS Y VALIDACIÓN DE MACRONUTRIENTES
// ========================================================

/**
 * Valida la coherencia de una distribución de macronutrientes:
 * Calorías = Proteínas*4 + Carbohidratos*4 + Grasas*9 (con tolerancia de redondeo en gramos).
 */
export const isValidMacroDistribution = (
  calories: number,
  proteinG: number,
  carbsG: number,
  fatsG: number,
  toleranceKcal = 15
): boolean => {
  if (calories <= 0 || proteinG < 0 || carbsG < 0 || fatsG < 0) return false;
  const calculatedKcal = proteinG * 4 + carbsG * 4 + fatsG * 9;
  return Math.abs(calories - calculatedKcal) <= toleranceKcal;
};

/**
 * Evalúa si los datos biométricos del atleta son suficientes y válidos
 * para calcular una recomendación personalizada real.
 */
export const validateBiometricSufficiency = (
  bio?: Partial<BiometricConfig> | null
): { isSufficient: boolean; missingFields: string[] } => {
  const missing: string[] = [];
  if (!bio) {
    return { isSufficient: false, missingFields: ['peso corporal', 'estatura', 'edad', 'factor de actividad'] };
  }

  if (typeof bio.weightKg !== 'number' || !Number.isFinite(bio.weightKg) || bio.weightKg <= 0 || bio.weightKg >= 500) {
    missing.push('peso corporal');
  }
  if (typeof bio.heightCm !== 'number' || !Number.isFinite(bio.heightCm) || bio.heightCm <= 50 || bio.heightCm >= 300) {
    missing.push('estatura');
  }
  if (typeof bio.age !== 'number' || !Number.isFinite(bio.age) || bio.age <= 0 || bio.age >= 120) {
    missing.push('edad');
  }
  if (typeof bio.palFactor !== 'number' || !Number.isFinite(bio.palFactor) || bio.palFactor < 1.0 || bio.palFactor > 3.0) {
    missing.push('factor de actividad');
  }

  return {
    isSufficient: missing.length === 0,
    missingFields: missing,
  };
};

/**
 * Determina el nivel de demanda de una sesión de entrenamiento
 */
export const determineTrainingDayDemand = (day?: RoutineDay): TrainingDayDemand => {
  if (!day || !day.exercises || day.exercises.length === 0) {
    return 'rest_recovery';
  }

  const totalSets = day.exercises.reduce((acc, ex) => acc + ex.sets, 0);
  const nameLower = day.name.toLowerCase();
  const shortLower = (day.shortName || '').toLowerCase();

  const isLegOrHeavyUpper =
    nameLower.includes('pierna') ||
    shortLower.includes('pierna') ||
    nameLower.includes('legs') ||
    shortLower.includes('legs') ||
    nameLower.includes('torso') ||
    shortLower.includes('torso') ||
    nameLower.includes('full body') ||
    totalSets >= 16;

  if (isLegOrHeavyUpper) {
    return 'high_demand';
  }

  if (totalSets >= 8) {
    return 'moderate_demand';
  }

  return 'rest_recovery';
};

// ========================================================
// 4. GENERADOR PRINCIPAL DE RECOMENDACIÓN NUTRICIONAL
// ========================================================

/**
 * Validador y conversor canónico centralizado 4/4/9:
 * calories = proteinG * 4 + carbsG * 4 + fatG * 9
 */
export const calculateCaloriesFromMacros = (proteinG: number, carbsG: number, fatG: number): number => {
  return proteinG * 4 + carbsG * 4 + fatG * 9;
};

/**
 * Determina la progresión canónica predeterminada de días de alta demanda (H)
 * según los días semanales de entrenamiento (1 a 6 días):
 * - 1 día entreno: 1 alto, 0 moderados, 6 descanso
 * - 2 días entreno: 1 alto, 1 moderado, 5 descanso
 * - 3 días entreno: 1 alto, 2 moderados, 4 descanso
 * - 4 días entreno: 2 altos, 2 moderados, 3 descanso
 * - 5 días entreno: 2 altos, 3 moderados, 2 descanso
 * - 6 días entreno: 3 altos, 3 moderados, 1 descanso
 */
export const getDefaultHighDemandDays = (trainingDays: number): number => {
  const t = Math.min(6, Math.max(1, trainingDays));
  if (t <= 1) return 1;
  if (t <= 3) return 1;
  if (t <= 5) return 2;
  return 3;
};

/**
 * Genera la recomendación de periodización nutricional adaptada al mesociclo y al perfil del atleta.
 * Función pura en memoria: no escribe en Firestore ni muta el estado.
 */
export const generateNutritionalPeriodizationRecommendation = (
  input: NutritionalPeriodizationInput
): NutritionalPeriodizationResult => {
  const {
    athleteGoal,
    biometrics,
    activeMesocycle,
    executedWorkoutsHistory = [],
    dietBreakOptionSelected = false,
  } = input;

  // 1. Auditoría de datos biométricos fundamentales
  const sufficiency = validateBiometricSufficiency(biometrics);

  // Si los datos son insuficientes, NO inventar números ficticios como si fueran metas reales.
  if (!sufficiency.isSufficient) {
    const referenceWeight = 70;
    const referenceHeight = 175;
    const referenceAge = 30;
    const referencePal = 1.55;
    const refBmr = Math.round(10 * referenceWeight + 6.25 * referenceHeight - 5 * referenceAge + 5);
    const refTdee = Math.round(refBmr * referencePal);

    const refPlan: NutritionalPeriodizationPlan = {
      targetCalories: refTdee,
      targetProteinG: Math.round(referenceWeight * 2.0),
      targetCarbsG: Math.round((refTdee - referenceWeight * 2.0 * 4 - referenceWeight * 0.8 * 9) / 4),
      targetFatG: Math.round(referenceWeight * 0.8),
      proteinPerKg: 2.0,
      fatPerKg: 0.8,
      targetDeltaKcal: 0,
      proteinBasis: 'total_body_weight',
      proteinGramsPerKgBasis: 2.0,
      isReferenceExample: true,
    };

    return {
      hasSufficientData: false,
      isReferenceExample: true,
      missingFields: sufficiency.missingFields,
      athleteGoal,
      mesocycleName: activeMesocycle?.name,
      mesocyclePhase: 'Configuración pendiente',
      currentWeek: 1,
      totalWeeks: 6,
      isDeloadWeek: false,
      dietBreakApplied: false,
      currentPlan: refPlan,
      proposedPlan: refPlan,
      dayDemandTargets: {
        highTrainingDay: {
          dayType: 'high_demand',
          label: 'Ejemplo Referencial (Alta Demanda)',
          description: 'Ejemplo educativo referencial. Requiere completar perfil biométrico.',
          calories: refTdee,
          proteinG: refPlan.targetProteinG,
          carbsG: refPlan.targetCarbsG,
          fatG: refPlan.targetFatG,
          carbShiftPct: 0,
          fatShiftPct: 0,
          rationale: 'Datos biométricos incompletos.',
        },
        moderateTrainingDay: {
          dayType: 'moderate_demand',
          label: 'Ejemplo Referencial (Estándar)',
          description: 'Ejemplo educativo referencial.',
          calories: refTdee,
          proteinG: refPlan.targetProteinG,
          carbsG: refPlan.targetCarbsG,
          fatG: refPlan.targetFatG,
          carbShiftPct: 0,
          fatShiftPct: 0,
          rationale: 'Datos biométricos incompletos.',
        },
        restRecoveryDay: {
          dayType: 'rest_recovery',
          label: 'Ejemplo Referencial (Descanso)',
          description: 'Ejemplo educativo referencial.',
          calories: refTdee,
          proteinG: refPlan.targetProteinG,
          carbsG: refPlan.targetCarbsG,
          fatG: refPlan.targetFatG,
          carbShiftPct: 0,
          fatShiftPct: 0,
          rationale: 'Datos biométricos incompletos.',
        },
      },
      weeklyAverageCalories: refTdee,
      weeklyEnergyBalanceType: 'isocalorica_estricta',
      weeklyCalorieDeltaPerDay: 0,
      rationale: [
        `Datos biométricos insuficientes para generar una recomendación personalizada. Faltan los siguientes campos: ${sufficiency.missingFields.join(', ')}.`,
        'Completa tu perfil en la sección de Biometría para desbloquear tus requerimientos metabólicos exactos.',
      ],
      warnings: [
        'Los valores mostrados son solo un ejemplo educativo general y NO corresponden a tus necesidades energéticas reales.',
      ],
      scientificNotes: [
        'El cálculo del gasto energético diario total (TDEE) y las tasas de macronutrientes requieren datos individuales verídicos de masa corporal, altura, edad y factor de actividad.',
      ],
      canAutoApply: false,
      referenceNotice:
        'Ejemplo educativo de referencia basado en un perfil estándar (70 kg, 175 cm). No es una prescripción personalizada. Completa tus datos biométricos para calcular tus metas reales.',
    };
  }

  // 2. Datos biométricos verificados
  const weightKg = biometrics.weightKg;
  const heightCm = biometrics.heightCm;
  const age = biometrics.age;
  const palFactor = biometrics.palFactor;

  const calculatedBmr = Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + 5);
  const bmr = biometrics.bmr > 0 ? biometrics.bmr : calculatedBmr;
  const calculatedTdee = Math.round(bmr * palFactor);
  const tdee = biometrics.tdee > 0 ? biometrics.tdee : calculatedTdee;

  // 3. Determinar estado y fase del mesociclo
  const currentWeekNum =
    input.currentWeekNumber ||
    (activeMesocycle?.mesocycleConfig?.currentWeek ? activeMesocycle.mesocycleConfig.currentWeek : 1);
  const totalWeeks = activeMesocycle?.mesocycleConfig?.durationWeeks || 6;
  const weekPrescription: MesocycleWeekPrescription | undefined =
    activeMesocycle?.mesocycleConfig?.weeks?.find(w => w.weekNumber === currentWeekNum);

  const isDeloadWeek = Boolean(weekPrescription?.isDeload);
  const mesocyclePhase = weekPrescription?.name || `Semana ${currentWeekNum} de ${totalWeeks}`;

  // 4. Plan actual configurado en biometrics
  const currentPlan: NutritionalPeriodizationPlan = {
    targetCalories: biometrics.targetCalories || tdee,
    targetProteinG: biometrics.targetProteinG || Math.round(weightKg * 2.0),
    targetFatG: biometrics.targetFatG || Math.round(weightKg * 0.8),
    targetCarbsG:
      biometrics.targetCarbsG ||
      Math.max(
        50,
        Math.round(
          ((biometrics.targetCalories || tdee) -
            (biometrics.targetProteinG || weightKg * 2.0) * 4 -
            (biometrics.targetFatG || weightKg * 0.8) * 9) /
            4
        )
      ),
    proteinPerKg: biometrics.proteinPerKg || 2.0,
    fatPerKg: biometrics.fatPerKg || 0.8,
    targetDeltaKcal: biometrics.targetDeltaKcal || 0,
    proteinBasis: 'total_body_weight',
    proteinGramsPerKgBasis: biometrics.proteinPerKg || 2.0,
  };

  // 5. Análisis de base proteica (peso total vs. masa libre de grasa) y nivel de confianza
  const bodyFatPct = biometrics.bodyFatPct || 0;
  const bodyFatThreshold = input.customBodyFatThreshold ?? 28;
  let proteinBasis: ProteinCalculationBasis = 'total_body_weight';
  let proteinConfidenceLevel: ProteinConfidenceLevel = 'standard_weight_basis';
  let proteinBasisNotes = 'Cálculo de proteína establecido sobre peso corporal total acorde a los rangos estándar de nutrición deportiva.';
  let fatFreeMassKg: number | undefined = undefined;

  const heightM = heightCm / 100;
  const bmi = heightM > 0 ? Math.round((weightKg / (heightM * heightM)) * 10) / 10 : 0;

  // Si se dispone de porcentaje de grasa y supera el umbral,
  // o si no se declaró porcentaje de grasa pero el IMC es de obesidad (>= 30),
  // calcular la proteína sobre masa libre de grasa para prevenir prescripciones excesivas.
  if (bodyFatPct > 0 && bodyFatPct >= bodyFatThreshold) {
    fatFreeMassKg = Math.round(weightKg * (1 - bodyFatPct / 100) * 10) / 10;
    proteinBasis = 'fat_free_mass';
    proteinConfidenceLevel = 'measured_body_fat';
    proteinBasisNotes = `Cálculo realizado sobre masa libre de grasa (${fatFreeMassKg} kg FFM) a partir del porcentaje de grasa medido (${bodyFatPct}%).`;
  } else if (bodyFatPct <= 0 && bmi >= 30) {
    // Estimación heurística de seguridad (modelo antropométrico 70% peso) ante IMC >= 30 sin porcentaje medido
    const estimatedFfm = Math.round(weightKg * 0.70 * 10) / 10;
    fatFreeMassKg = estimatedFfm;
    proteinBasis = 'fat_free_mass';
    proteinConfidenceLevel = 'heuristic_estimation';
    proteinBasisNotes = `Estimación heurística de referencia (FFM ~70% del peso, ${estimatedFfm} kg) ante IMC >= 30 sin porcentaje de grasa medido. Esta estimación prudente no sustituye una medición clínica directa (DEXA, plicometría) y aplica un techo de <= 2.0 g/kg de peso total para evitar sobrecargas.`;
  }

  // 6. Guías base por objetivo
  const guidelines = GOAL_NUTRITIONAL_GUIDELINES[athleteGoal] || GOAL_NUTRITIONAL_GUIDELINES.recomposicion;
  let proposedDeltaKcal = guidelines.defaultDelta;
  let proposedProteinPerKg = guidelines.defaultProteinPerKg;
  let proposedFatPerKg = guidelines.defaultFatPerKg;

  const rationale: string[] = [];
  const warnings: string[] = [];
  const scientificNotes: string[] = [];

  let dietBreakApplied = false;
  let dietBreakSuggestion: DietBreakSuggestion | undefined = undefined;

  // 7. TRATAMIENTO DE LA SEMANA DE DESCARGA Y DIET BREAK
  if (isDeloadWeek) {
    if (athleteGoal === 'definicion' || athleteGoal === 'perdida_grasa') {
      dietBreakSuggestion = {
        available: true,
        label: 'Diet Break Opcional (Pausa a Mantenimiento)',
        deltaKcal: 0,
        targetCalories: tdee,
        rationale:
          'Durante una semana de descarga, una pausa dietética a mantenimiento calórico (TDEE) puede ofrecer un respiro psicológico y mitigar la fatiga acumulada del déficit crónico, favoreciendo la adherencia y la comodidad dietética.',
        pros: [
          'Alivio del agotamiento mental y mejora de la adherencia conductual a largo plazo.',
          'Reposición temporal del glucógeno intramuscular para el siguiente bloque de entrenamiento.',
          'Mayor flexibilidad y variedad en la ingesta diaria durante la semana de descarga.',
        ],
        limitations: [
          'No constituye un "reinicio metabólico" ni garantiza una elevación hormonal permanente.',
          'No acelera la pérdida de grasa por sí mismo; prolonga el calendario total del déficit.',
          'Requiere control de porciones para no exceder el nivel de mantenimiento estimado.',
        ],
        conditions: [
          'Recomendable si experimentas fatiga psicológica o llevas varias semanas seguidas en déficit.',
          'Completamente opcional si mantienes buena energía y prefieres conservar el ritmo de definición.',
        ],
      };

      if (dietBreakOptionSelected) {
        proposedDeltaKcal = 0;
        proposedProteinPerKg = 2.4;
        dietBreakApplied = true;
        rationale.push(
          'Pausa Dietética (Diet Break) voluntaria activada para la semana de descarga: consumo a nivel de mantenimiento (TDEE) para descanso psicológico y soporte de adherencia, manteniendo la proteína elevada.'
        );
      } else {
        proposedDeltaKcal = -350;
        proposedProteinPerKg = 2.4;
        dietBreakApplied = false;
        rationale.push(
          'Semana de descarga con conservación del déficit de definición (-350 kcal) y proteína alta para retención de tejido magro. Dispones de la opción de activar un Diet Break voluntario si lo prefieres.'
        );
      }
    } else if (athleteGoal === 'hipertrofia' || athleteGoal === 'ganancia_muscular') {
      proposedDeltaKcal = 50;
      proposedProteinPerKg = 2.0;
      proposedFatPerKg = 0.9;
      rationale.push(
        'Semana de descarga: el volumen disminuye para disipar fatiga articular. El superávit se reduce a un nivel prácticamente normocalórico (+50 kcal) para consolidar adaptaciones sin acumular grasa superflua.'
      );
    } else {
      proposedDeltaKcal = 0;
      proposedProteinPerKg = guidelines.defaultProteinPerKg;
      proposedFatPerKg = guidelines.defaultFatPerKg;
      rationale.push(
        'Semana de descarga en balance normocalórico para favorecer la recuperación del tejido conectivo sin restricciones energéticas.'
      );
    }

    scientificNotes.push(
      'Criterio de descarga: Durante la descarga se prioriza la disipación de fatiga y la adherencia. Las pausas dietéticas deben evaluarse por comodidad y sostenibilidad, sin promesas de normalización endocrina asegurada.'
    );
  } else {
    rationale.push(
      `Objetivo "${athleteGoal}": ${guidelines.summary} (${proposedDeltaKcal >= 0 ? `+${proposedDeltaKcal}` : proposedDeltaKcal} kcal respecto al TDEE).`
    );
    scientificNotes.push(guidelines.scientificRationale);
  }

  // 8. Cálculo de gramos absolutos de propuesta con rigurosidad de base proteica
  let targetProteinG: number;
  if (proteinBasis === 'fat_free_mass' && fatFreeMassKg && fatFreeMassKg > 0) {
    const proteinPerKgFfm = Math.min(2.5, Math.max(2.1, proposedProteinPerKg * 1.05));
    targetProteinG = Math.round(fatFreeMassKg * proteinPerKgFfm);
    targetProteinG = Math.min(targetProteinG, Math.round(weightKg * 2.0));
    rationale.push(
      `Proteína modulada sobre masa libre de grasa (${fatFreeMassKg} kg FFM a ${proteinPerKgFfm.toFixed(1)} g/kg) para optimizar el balance de nutrientes.`
    );
  } else {
    targetProteinG = Math.round(weightKg * proposedProteinPerKg);
  }

  const proposedCalories = Math.max(1200, tdee + proposedDeltaKcal);
  const minSafeFatFloorG = Math.max(35, Math.round(weightKg * 0.65));
  let targetFatG = Math.max(minSafeFatFloorG, Math.round(weightKg * proposedFatPerKg));

  // Reconciliación diofántica exacta 4/4/9 para eliminar cualquier residuo de redondeo:
  // Como 4P + 4C + 9G = proposedCalories, (proposedCalories - 9G) debe ser divisible por 4.
  // Dado que 9 ≡ 1 (mod 4), (proposedCalories - 9G) ≡ (proposedCalories - G) (mod 4).
  // Ajustamos G en el mínimo delta entero discreto (±1 o ±2g) para que G ≡ proposedCalories (mod 4).
  const targetMod = ((proposedCalories % 4) + 4) % 4;
  const currentFatMod = ((targetFatG % 4) + 4) % 4;
  let fatDiff = targetMod - currentFatMod;
  if (fatDiff === -3) fatDiff = 1;
  if (fatDiff === 3) fatDiff = -1;
  if (fatDiff === 2 && targetFatG - 2 >= minSafeFatFloorG) fatDiff = -2;
  else if (fatDiff === 2) fatDiff = 2;
  else if (fatDiff === -1 && targetFatG - 1 < minSafeFatFloorG) fatDiff = 3;

  targetFatG = Math.max(minSafeFatFloorG, targetFatG + fatDiff);
  const remainingForCarbs = proposedCalories - targetProteinG * 4 - targetFatG * 9;
  const finalCarbsG = Math.max(30, Math.round(remainingForCarbs / 4));
  const finalCalories = calculateCaloriesFromMacros(targetProteinG, finalCarbsG, targetFatG);

  const proposedPlan: NutritionalPeriodizationPlan = {
    targetCalories: finalCalories,
    targetProteinG,
    targetCarbsG: finalCarbsG,
    targetFatG,
    proteinPerKg: Math.round((targetProteinG / weightKg) * 10) / 10,
    fatPerKg: Math.round((targetFatG / weightKg) * 10) / 10,
    targetDeltaKcal: proposedDeltaKcal,
    proteinBasis,
    proteinConfidenceLevel,
    proteinBasisNotes,
    proteinGramsPerKgBasis:
      proteinBasis === 'fat_free_mass' && fatFreeMassKg
        ? Math.round((targetProteinG / fatFreeMassKg) * 10) / 10
        : Math.round((targetProteinG / weightKg) * 10) / 10,
    fatFreeMassKg,
    fatFloorRationale: `Restricción de diseño de VigorCore (${minSafeFatFloorG} g): asegura un suelo lipídico prudente para absorción de vitaminas liposolubles y ácidos grasos esenciales.`,
  };

  // 9. Advertencias de seguridad fisiológica
  if (proposedPlan.fatPerKg < 0.6) {
    warnings.push('La ingesta lipídica es inferior a 0.6 g/kg de peso corporal. Se sugiere mantener al menos 0.65-0.7 g/kg para el soporte hormonal.');
  }
  if (proposedDeltaKcal < -600) {
    warnings.push('El déficit calórico es muy agresivo (> 600 kcal). Podría comprometer el rendimiento en el entrenamiento y la adherencia.');
  }
  if (finalCalories < bmr) {
    warnings.push('Las calorías propuestas están por debajo de tu BMR estimada. Úsalo con cautela y supervisión profesional.');
  }

  // 10. CICLADO DE ENERGÍA Y CARBOHIDRATOS CON DISTRIBUCIÓN ADAPTATIVA INTELIGENTE
  const trainingDays = Math.min(
    6,
    Math.max(
      1,
      input.trainingDaysPerWeek ||
        activeMesocycle?.frequencyDays ||
        activeMesocycle?.days?.length ||
        4
    )
  );
  const restDays = 7 - trainingDays;
  const highDays = Math.min(
    trainingDays,
    Math.max(1, input.highDemandDaysCount ?? getDefaultHighDemandDays(trainingDays))
  );
  const moderateDays = trainingDays - highDays;

  // Límite configurable de oscilación diaria respecto al basal (default 15%, ej. 10%-25%)
  const maxVarPct = Math.min(30, Math.max(10, input.maxDailyCalorieVariationPct ?? 15));
  const requestedCarbShift = input.customCarbShiftPct ?? 20;

  // Suelo lipídico algorítmico seguro
  const minSafeFatG = Math.max(35, Math.round(weightKg * 0.65));
  const desiredHighFatG = Math.max(minSafeFatG, Math.round(targetFatG * 0.9));
  const highFatDeltaKcal = (desiredHighFatG - targetFatG) * 9;

  // Capacidad máxima de absorción de déficit en días de menor demanda
  const maxAllowedHighDelta = Math.floor(finalCalories * (maxVarPct / 100));
  const maxSafeRestDeficitKcal = Math.floor(finalCalories * (maxVarPct / 100));
  const maxSafeModDeficitKcal = (restDays <= 2 && moderateDays > 0) ? Math.min(80, Math.floor(finalCalories * 0.030)) : 0;

  // Margen de seguridad para asegurar que el día de descanso no exceda maxVarPct tras el redondeo a gramos enteros
  const safeRestBudget = restDays <= 2 ? maxSafeRestDeficitKcal - 25 : maxSafeRestDeficitKcal;
  const totalDeficitCapacity = (restDays * safeRestBudget) + (moderateDays * maxSafeModDeficitKcal);
  const maxAllowedHighSurplusPerDay = Math.min(maxAllowedHighDelta, Math.floor(totalDeficitCapacity / highDays));

  // Deseo inicial de superávit de carbohidratos en días de alta demanda
  const desiredHighCarbsG = Math.round(finalCarbsG * (1 + requestedCarbShift / 100));
  const desiredCarbSurplusKcal = (desiredHighCarbsG - finalCarbsG) * 4;
  const desiredHighDeltaKcal = desiredCarbSurplusKcal + highFatDeltaKcal;

  let wasCarbCyclingModulated = false;
  let effectiveHighCarbsG = desiredHighCarbsG;
  let effectiveCarbShiftPct = requestedCarbShift;
  let carbCyclingModulationReason = '';

  if (desiredHighDeltaKcal > maxAllowedHighSurplusPerDay) {
    wasCarbCyclingModulated = true;
    const availableCarbKcal = Math.max(0, maxAllowedHighSurplusPerDay - highFatDeltaKcal);
    const maxSurplusCarbsG = Math.floor(availableCarbKcal / 4);
    effectiveHighCarbsG = finalCarbsG + maxSurplusCarbsG;
    effectiveCarbShiftPct = Math.round(((effectiveHighCarbsG - finalCarbsG) / finalCarbsG) * 100);
    carbCyclingModulationReason = `Se auto-moduló el incremento en días de alta demanda (+${effectiveCarbShiftPct}% en vez de +${requestedCarbShift}%) para proteger la ingesta del día de descanso y mantener la oscilación dentro del límite seguro (±${maxVarPct}%).`;
    rationale.push(carbCyclingModulationReason);
  }

  // Valores calculados para Día de Alta Demanda (4/4/9 estricto)
  const highFatG = desiredHighFatG;
  const highCarbsG = effectiveHighCarbsG;
  const highCalories = calculateCaloriesFromMacros(targetProteinG, highCarbsG, highFatG);
  const actualHighDeltaKcal = highCalories - finalCalories;
  const totalSurplusToCompensate = actualHighDeltaKcal * highDays;

  // Reparto equilibrado de la compensación entre días moderados y descanso
  let modDeficitPerDay = 0;
  let modCalories = finalCalories;
  let modFatG = targetFatG;
  let modCarbsG = finalCarbsG;
  let remainingSurplusForRest = totalSurplusToCompensate;

  if (moderateDays > 0 && restDays <= 2) {
    const desirableModShare = Math.min(moderateDays * maxSafeModDeficitKcal, Math.round(totalSurplusToCompensate * 0.35));
    modDeficitPerDay = Math.floor(desirableModShare / moderateDays);
    const modCarbsReduction = Math.round(modDeficitPerDay / 4);
    modCarbsG = Math.max(30, finalCarbsG - modCarbsReduction);
    modCalories = calculateCaloriesFromMacros(targetProteinG, modCarbsG, modFatG);
    const actualModCompensationTotal = (finalCalories - modCalories) * moderateDays;
    remainingSurplusForRest = totalSurplusToCompensate - actualModCompensationTotal;
  }

  const modCarbShiftPct = Math.round(((modCarbsG - finalCarbsG) / finalCarbsG) * 100);

  // Día de Descanso (4/4/9 estricto)
  const restFatG = Math.max(minSafeFatG, Math.round(targetFatG * 1.05));
  const restFatDeltaKcal = (restFatG - targetFatG) * 9;
  const targetRestDeficitPerDay = remainingSurplusForRest / restDays;
  const restCarbsReductionKcal = targetRestDeficitPerDay + restFatDeltaKcal;
  let restCarbsG = Math.max(30, finalCarbsG - Math.round(restCarbsReductionKcal / 4));
  let finalRestCalories = calculateCaloriesFromMacros(targetProteinG, restCarbsG, restFatG);

  // Verificación y reconciliación de la media semanal exacta
  let totalWeeklyCalories = highCalories * highDays + modCalories * moderateDays + finalRestCalories * restDays;
  const expectedWeeklyCalories = finalCalories * 7;
  let weeklyCalorieGap = expectedWeeklyCalories - totalWeeklyCalories;

  if (Math.abs(weeklyCalorieGap) >= 4) {
    const carbAdjG = Math.round(weeklyCalorieGap / (4 * restDays));
    if (carbAdjG !== 0 && (restCarbsG + carbAdjG) >= 30) {
      restCarbsG += carbAdjG;
      finalRestCalories = calculateCaloriesFromMacros(targetProteinG, restCarbsG, restFatG);
      totalWeeklyCalories = highCalories * highDays + modCalories * moderateDays + finalRestCalories * restDays;
      weeklyCalorieGap = expectedWeeklyCalories - totalWeeklyCalories;
    }
  }

  const restCarbShiftPct = Math.round(((restCarbsG - finalCarbsG) / finalCarbsG) * 100);

  const highDemandTarget: DayDemandNutritionalTarget = {
    dayType: 'high_demand',
    label: 'Día de Alta Demanda (Pierna / Torso Pesado)',
    description: 'Aporte de carbohidratos priorizado para optimizar la resíntesis de glucógeno y el rendimiento en sesiones intensas.',
    calories: highCalories,
    proteinG: targetProteinG,
    carbsG: highCarbsG,
    fatG: highFatG,
    carbShiftPct: effectiveCarbShiftPct,
    fatShiftPct: Math.round(((highFatG - targetFatG) / targetFatG) * 100),
    isAutoModulated: wasCarbCyclingModulated,
    rationale: `Carbohidratos ajustados (+${effectiveCarbShiftPct}%) para respaldar el esfuerzo glucolítico de alta demanda.`,
  };

  const moderateDemandTarget: DayDemandNutritionalTarget = {
    dayType: 'moderate_demand',
    label: 'Día de Entrenamiento Estándar (Empuje / Tirón / Accesorios)',
    description: modDeficitPerDay > 0
      ? 'Distribución equilibrada con leve amortiguación calórica para proteger la ingesta del día de descanso.'
      : 'Distribución balanceada acorde a la meta diaria basal.',
    calories: modCalories,
    proteinG: targetProteinG,
    carbsG: modCarbsG,
    fatG: modFatG,
    carbShiftPct: modCarbShiftPct,
    fatShiftPct: 0,
    rationale: modDeficitPerDay > 0
      ? `Ajuste leve (${modCarbShiftPct}%) para distribuir la compensación entre los días de menor demanda.`
      : 'Distribución equilibrada correspondiente a la meta diaria de referencia.',
  };

  const restRecoveryTarget: DayDemandNutritionalTarget = {
    dayType: 'rest_recovery',
    label: 'Día de Descanso / Recuperación Activa',
    description: 'Distribución con carbohidratos moderados y grasas esenciales en días de menor gasto energético.',
    calories: finalRestCalories,
    proteinG: targetProteinG,
    carbsG: restCarbsG,
    fatG: restFatG,
    carbShiftPct: restCarbShiftPct,
    fatShiftPct: Math.round(((restFatG - targetFatG) / targetFatG) * 100),
    rationale: `Reducción compensatoria de carbohidratos (${restCarbShiftPct}%) conservando el balance semanal sin extremos perjudiciales.`,
  };

  const weeklyAverageCalories = Math.round(totalWeeklyCalories / 7);
  const weeklyCalorieDeltaPerDay = weeklyAverageCalories - finalCalories;

  // Cálculo de variación porcentual máxima observada entre cualquier día y el basal
  const maxObservedDailyVariationPct = Math.max(
    Math.abs(Math.round(((highCalories - finalCalories) / finalCalories) * 100)),
    Math.abs(Math.round(((modCalories - finalCalories) / finalCalories) * 100)),
    Math.abs(Math.round(((finalRestCalories - finalCalories) / finalCalories) * 100))
  );

  return {
    hasSufficientData: true,
    missingFields: [],
    athleteGoal,
    mesocycleName: activeMesocycle?.name,
    mesocyclePhase,
    currentWeek: currentWeekNum,
    totalWeeks,
    isDeloadWeek,
    dietBreakApplied,
    dietBreakSuggestion,
    currentPlan,
    proposedPlan,
    dayDemandTargets: {
      highTrainingDay: highDemandTarget,
      moderateTrainingDay: moderateDemandTarget,
      restRecoveryDay: restRecoveryTarget,
    },
    weeklyAverageCalories,
    weeklyEnergyBalanceType: 'isocalorica_estricta',
    weeklyCalorieDeltaPerDay,
    wasCarbCyclingModulated,
    carbCyclingModulationReason: wasCarbCyclingModulated ? carbCyclingModulationReason : undefined,
    maxObservedDailyVariationPct,
    rationale,
    warnings,
    scientificNotes,
    canAutoApply: true,
  };
};

// ========================================================
// 5. HELPER PARA APLICACIÓN EXPLÍCITA A BIOMETRICS
// ========================================================

/**
 * Genera la nueva configuración de BiometricConfig a partir de la propuesta periodizada.
 * Guarda en `lastAppliedPeriodization` los objetivos anteriores para posibilitar su reversión.
 * Solo se invoca cuando el atleta confirma expresamente en la interfaz.
 */
export const applyPeriodizationToBiometrics = (
  currentBio: BiometricConfig,
  recommendation: NutritionalPeriodizationResult
): BiometricConfig => {
  if (!recommendation.hasSufficientData) {
    throw new Error('No es posible aplicar metas: datos biométricos insuficientes.');
  }

  const { proposedPlan } = recommendation;
  const weightKg = currentBio.weightKg;
  const heightCm = currentBio.heightCm;
  const age = currentBio.age;
  const palFactor = currentBio.palFactor;

  const bmr = currentBio.bmr > 0 ? currentBio.bmr : Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + 5);
  const tdee = currentBio.tdee > 0 ? currentBio.tdee : Math.round(bmr * palFactor);

  return {
    ...currentBio,
    bmr,
    tdee,
    targetDeltaKcal: proposedPlan.targetDeltaKcal,
    proteinPerKg: proposedPlan.proteinPerKg,
    fatPerKg: proposedPlan.fatPerKg,
    targetCalories: proposedPlan.targetCalories,
    targetProteinG: proposedPlan.targetProteinG,
    targetFatG: proposedPlan.targetFatG,
    targetCarbsG: proposedPlan.targetCarbsG,
    lastAppliedPeriodization: {
      phase: recommendation.mesocyclePhase,
      athleteGoal: recommendation.athleteGoal,
      appliedAt: new Date().toISOString(),
      isDietBreak: recommendation.dietBreakApplied,
      previousTargets: {
        targetCalories: currentBio.targetCalories,
        targetProteinG: currentBio.targetProteinG,
        targetCarbsG: currentBio.targetCarbsG,
        targetFatG: currentBio.targetFatG,
        proteinPerKg: currentBio.proteinPerKg,
        fatPerKg: currentBio.fatPerKg,
        targetDeltaKcal: currentBio.targetDeltaKcal,
      },
    },
  };
};

/**
 * Revierte la configuración biométrica al estado anterior registrado
 * en `lastAppliedPeriodization.previousTargets`.
 */
export const revertPeriodizationFromBiometrics = (
  currentBio: BiometricConfig
): BiometricConfig => {
  const previous = currentBio.lastAppliedPeriodization?.previousTargets;
  if (!previous) {
    throw new Error('No se encontraron metas nutricionales anteriores registradas para revertir.');
  }

  return {
    ...currentBio,
    targetCalories: previous.targetCalories,
    targetProteinG: previous.targetProteinG,
    targetCarbsG: previous.targetCarbsG,
    targetFatG: previous.targetFatG,
    proteinPerKg: previous.proteinPerKg,
    fatPerKg: previous.fatPerKg,
    targetDeltaKcal: previous.targetDeltaKcal,
    lastAppliedPeriodization: undefined,
  };
};

// ========================================================
// 6. MOTOR DE CICLADO MULTIFRECUENCIA (1 A 6 DÍAS)
// ========================================================

export interface WeeklyCarbCyclingScheduleResult {
  trainingDays: number;
  restDays: number;
  highDays: number;
  moderateDays: number;
  highDayCalories: number;
  moderateDayCalories: number;
  restDayCalories: number;
  totalWeeklyCalories: number;
  expectedWeeklyCalories: number;
  weeklyAverageCalories: number;
  targetDailyCalories: number;
  netWeeklyDeltaKcal: number;
  isStrictlyIsocaloric: boolean;
  minFatGrams: number;
  highFatGrams: number;
  restFatGrams: number;
  wasModulated: boolean;
  effectiveCarbShiftPct: number;
  maxDailyVariationPct: number;
  maxObservedDailyVariationPct: number;
  modulationReason?: string;
}

/**
 * Calcula y audita la distribución de energía y carbohidratos
 * para cualquier frecuencia de 1 a 6 días de entrenamiento semanales.
 * Prioriza una distribución diaria fisiológicamente viable sobre una compensación forzada.
 */
export function calculateWeeklyCarbCyclingSchedule(
  baseCalories: number,
  proteinG: number,
  carbsG: number,
  fatG: number,
  trainingDays: number, // 1, 2, 3, 4, 5, 6
  weightKg = 75,
  carbShiftPct = 20,
  customHighDays?: number,
  maxDailyVariationPct = 15
): WeeklyCarbCyclingScheduleResult {
  const tDays = Math.min(6, Math.max(1, trainingDays));
  const rDays = 7 - tDays;
  const hDays = Math.min(tDays, Math.max(1, customHighDays ?? getDefaultHighDemandDays(tDays)));
  const mDays = tDays - hDays;

  // Fuente única de verdad energética: la suma 4/4/9 exacta de los macronutrientes basales
  const effectiveBaseCalories = calculateCaloriesFromMacros(proteinG, carbsG, fatG);

  const minSafeFatG = Math.max(35, Math.round(weightKg * 0.65));
  const desiredHighFatG = Math.max(minSafeFatG, Math.round(fatG * 0.9));
  const highFatDeltaKcal = (desiredHighFatG - fatG) * 9;

  // Límites seguros de variación diaria respecto al basal (default 15%)
  const maxAllowedHighDelta = Math.floor(effectiveBaseCalories * (maxDailyVariationPct / 100));
  const maxSafeRestDeficitKcal = Math.floor(effectiveBaseCalories * (maxDailyVariationPct / 100));
  const maxSafeModDeficitKcal = (rDays <= 2 && mDays > 0) ? Math.min(80, Math.floor(effectiveBaseCalories * 0.030)) : 0;

  // Margen de seguridad para asegurar que el día de descanso no exceda maxDailyVariationPct tras el redondeo a gramos enteros
  const safeRestBudget = rDays <= 2 ? maxSafeRestDeficitKcal - 25 : maxSafeRestDeficitKcal;
  const totalDeficitCapacity = (rDays * safeRestBudget) + (mDays * maxSafeModDeficitKcal);
  const maxAllowedHighSurplusPerDay = Math.min(maxAllowedHighDelta, Math.floor(totalDeficitCapacity / hDays));

  // Deseo inicial de superávit de carbohidratos en días de alta demanda
  const desiredHighCarbsG = Math.round(carbsG * (1 + carbShiftPct / 100));
  const desiredCarbSurplusKcal = (desiredHighCarbsG - carbsG) * 4;
  const desiredHighDeltaKcal = desiredCarbSurplusKcal + highFatDeltaKcal;

  let wasModulated = false;
  let effectiveHighCarbsG = desiredHighCarbsG;
  let effectiveCarbShiftPct = carbShiftPct;
  let modulationReason: string | undefined = undefined;

  if (desiredHighDeltaKcal > maxAllowedHighSurplusPerDay) {
    wasModulated = true;
    const availableCarbKcal = Math.max(0, maxAllowedHighSurplusPerDay - highFatDeltaKcal);
    const maxSurplusCarbsG = Math.floor(availableCarbKcal / 4);
    effectiveHighCarbsG = carbsG + maxSurplusCarbsG;
    effectiveCarbShiftPct = Math.round(((effectiveHighCarbsG - carbsG) / carbsG) * 100);
    modulationReason = `Se redujo el incremento de alta demanda (+${effectiveCarbShiftPct}% en vez de +${carbShiftPct}%) para evitar una caída extrema en días de descanso y respetar el límite diario (±${maxDailyVariationPct}%).`;
  }

  // Día de alta demanda efectivo (4/4/9 estricto)
  const highFatG = desiredHighFatG;
  const highCarbsG = effectiveHighCarbsG;
  const highCalories = calculateCaloriesFromMacros(proteinG, highCarbsG, highFatG);
  const actualHighSurplusKcal = highCalories - effectiveBaseCalories;
  const totalSurplusToCompensate = actualHighSurplusKcal * hDays;

  // Reparto equilibrado de la compensación entre días moderados y descanso
  let modDeficitPerDay = 0;
  let modFatG = fatG;
  let modCarbsG = carbsG;
  let remainingSurplusForRest = totalSurplusToCompensate;

  if (mDays > 0 && rDays <= 2) {
    const desirableModShare = Math.min(mDays * maxSafeModDeficitKcal, Math.round(totalSurplusToCompensate * 0.35));
    modDeficitPerDay = Math.floor(desirableModShare / mDays);
    const modCarbsReduction = Math.round(modDeficitPerDay / 4);
    modCarbsG = Math.max(30, carbsG - modCarbsReduction);
    const actualModCompensationTotal = (effectiveBaseCalories - calculateCaloriesFromMacros(proteinG, modCarbsG, modFatG)) * mDays;
    remainingSurplusForRest = totalSurplusToCompensate - actualModCompensationTotal;
  }
  const modCalories = calculateCaloriesFromMacros(proteinG, modCarbsG, modFatG);

  // Día de Descanso (4/4/9 estricto)
  const restFatG = Math.max(minSafeFatG, Math.round(fatG * 1.05));
  const restFatDeltaKcal = (restFatG - fatG) * 9;
  const targetRestDeficitPerDay = remainingSurplusForRest / rDays;
  const restCarbsReductionKcal = targetRestDeficitPerDay + restFatDeltaKcal;
  let restCarbsG = Math.max(30, carbsG - Math.round(restCarbsReductionKcal / 4));
  let finalRestCalories = calculateCaloriesFromMacros(proteinG, restCarbsG, restFatG);

  let totalWeeklyCalories = highCalories * hDays + modCalories * mDays + finalRestCalories * rDays;
  const expectedWeeklyCalories = effectiveBaseCalories * 7;
  let weeklyCalorieGap = expectedWeeklyCalories - totalWeeklyCalories;

  if (Math.abs(weeklyCalorieGap) >= 4) {
    const carbAdjG = Math.round(weeklyCalorieGap / (4 * rDays));
    if (carbAdjG !== 0 && (restCarbsG + carbAdjG) >= 30) {
      restCarbsG += carbAdjG;
      finalRestCalories = calculateCaloriesFromMacros(proteinG, restCarbsG, restFatG);
      totalWeeklyCalories = highCalories * hDays + modCalories * mDays + finalRestCalories * rDays;
      weeklyCalorieGap = expectedWeeklyCalories - totalWeeklyCalories;
    }
  }

  const weeklyAverageCalories = Math.round(totalWeeklyCalories / 7);
  const netWeeklyDeltaKcal = weeklyAverageCalories - effectiveBaseCalories;

  const maxObservedDailyVariationPct = Math.max(
    Math.abs(Math.round(((highCalories - effectiveBaseCalories) / effectiveBaseCalories) * 100)),
    Math.abs(Math.round(((modCalories - effectiveBaseCalories) / effectiveBaseCalories) * 100)),
    Math.abs(Math.round(((finalRestCalories - effectiveBaseCalories) / effectiveBaseCalories) * 100))
  );

  return {
    trainingDays: tDays,
    restDays: rDays,
    highDays: hDays,
    moderateDays: mDays,
    highDayCalories: highCalories,
    moderateDayCalories: modCalories,
    restDayCalories: finalRestCalories,
    totalWeeklyCalories,
    expectedWeeklyCalories,
    weeklyAverageCalories,
    targetDailyCalories: effectiveBaseCalories,
    netWeeklyDeltaKcal,
    isStrictlyIsocaloric: Math.abs(netWeeklyDeltaKcal) <= 1,
    minFatGrams: minSafeFatG,
    highFatGrams: desiredHighFatG,
    restFatGrams: restFatG,
    wasModulated,
    effectiveCarbShiftPct,
    maxDailyVariationPct,
    maxObservedDailyVariationPct,
    modulationReason,
  };
}
