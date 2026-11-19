/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Pure Nutrition, Periodization, Substitution & Grocery Engine
 * 100% browser-safe pure TypeScript functions decoupled from database persistence.
 */

import {
  CATALYST_BUDGET_LIMITS,
  type AthleteGoal,
  type BiometricsPayload,
  type FoodCatalogItem,
  type FoodCategory,
  type GroceryDepartment,
  type GroceryItemRecord,
  type HeightUnit,
  type MealLogRecord,
  type MealMoment,
  type MealPlanRecord,
  type PlannedMealSlot,
  type RecipeRecord,
  type WeightUnit,
} from '../contracts/cleanSlateModels';

export const FOOD_CATALOG: FoodCatalogItem[] = [
  { id: 'usda-pechuga-pollo', name: 'Pechuga de Pollo (cruda)', category: 'carnes_aves', state: 'crudo', caloriesPer100g: 120, proteinPer100g: 22.5, carbsPer100g: 0, fatPer100g: 2.6, fiberPer100g: 0, commonPortionG: 150 },
  { id: 'usda-pavo-lomo', name: 'Lomo de Pavo Fileteado (crudo)', category: 'carnes_aves', state: 'crudo', caloriesPer100g: 114, proteinPer100g: 23.6, carbsPer100g: 0, fatPer100g: 1.6, fiberPer100g: 0, commonPortionG: 150 },
  { id: 'usda-salmon-salvaje', name: 'Salmón Atlántico (crudo)', category: 'pescados_mariscos', state: 'crudo', caloriesPer100g: 208, proteinPer100g: 20.4, carbsPer100g: 0, fatPer100g: 13.4, fiberPer100g: 0, commonPortionG: 150 },
  { id: 'usda-atun-agua', name: 'Atún Claro al Natural', category: 'pescados_mariscos', state: 'fresco', caloriesPer100g: 116, proteinPer100g: 25.5, carbsPer100g: 0, fatPer100g: 0.8, fiberPer100g: 0, commonPortionG: 120 },
  { id: 'usda-huevo-entero', name: 'Huevo Entero Fresco', category: 'huevos', state: 'crudo', caloriesPer100g: 143, proteinPer100g: 12.6, carbsPer100g: 0.7, fatPer100g: 9.5, fiberPer100g: 0, commonPortionG: 100 },
  { id: 'usda-claras-huevo', name: 'Claras de Huevo Líquidas', category: 'huevos', state: 'crudo', caloriesPer100g: 52, proteinPer100g: 10.9, carbsPer100g: 0.7, fatPer100g: 0.2, fiberPer100g: 0, commonPortionG: 150 },
  { id: 'usda-yogur-griego', name: 'Yogur Griego Desnatado 0%', category: 'lacteos', state: 'fresco', caloriesPer100g: 59, proteinPer100g: 10.2, carbsPer100g: 3.6, fatPer100g: 0.4, fiberPer100g: 0, commonPortionG: 200 },
  { id: 'usda-arroz-basmati', name: 'Arroz Basmati (en seco)', category: 'cereales_granos', state: 'seco', caloriesPer100g: 356, proteinPer100g: 7.5, carbsPer100g: 78.2, fatPer100g: 0.9, fiberPer100g: 1.4, commonPortionG: 80 },
  { id: 'usda-avena-hojuelas', name: 'Avena en Hojuelas (en seco)', category: 'cereales_granos', state: 'seco', caloriesPer100g: 379, proteinPer100g: 13.2, carbsPer100g: 67.7, fatPer100g: 6.5, fiberPer100g: 10.1, commonPortionG: 60 },
  { id: 'usda-papa-cocida', name: 'Papa Blanca Cocida', category: 'tuberculos_raices', state: 'cocido', caloriesPer100g: 87, proteinPer100g: 1.9, carbsPer100g: 20.1, fatPer100g: 0.1, fiberPer100g: 1.8, commonPortionG: 250 },
  { id: 'usda-banano', name: 'Banano / Plátano Maduro', category: 'frutas', state: 'fresco', caloriesPer100g: 89, proteinPer100g: 1.1, carbsPer100g: 22.8, fatPer100g: 0.3, fiberPer100g: 2.6, commonPortionG: 120 },
  { id: 'usda-arandanos', name: 'Arándanos Azules Frescos', category: 'frutas', state: 'fresco', caloriesPer100g: 57, proteinPer100g: 0.7, carbsPer100g: 14.5, fatPer100g: 0.3, fiberPer100g: 2.4, commonPortionG: 80 },
  { id: 'usda-brocoli', name: 'Brócoli Fresco', category: 'verduras_hortalizas', state: 'crudo', caloriesPer100g: 34, proteinPer100g: 2.8, carbsPer100g: 6.6, fatPer100g: 0.4, fiberPer100g: 2.6, commonPortionG: 150 },
  { id: 'usda-espinaca', name: 'Espinaca Fresca', category: 'verduras_hortalizas', state: 'crudo', caloriesPer100g: 23, proteinPer100g: 2.9, carbsPer100g: 3.6, fatPer100g: 0.4, fiberPer100g: 2.2, commonPortionG: 100 },
  { id: 'usda-aove', name: 'Aceite de Oliva Virgen Extra', category: 'grasas_aceites', state: 'fresco', caloriesPer100g: 884, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 100, fiberPer100g: 0, commonPortionG: 10 },
  { id: 'usda-aguacate', name: 'Aguacate Hass', category: 'grasas_aceites', state: 'fresco', caloriesPer100g: 160, proteinPer100g: 2.0, carbsPer100g: 8.5, fatPer100g: 14.7, fiberPer100g: 6.7, commonPortionG: 80 },
  { id: 'usda-almendras', name: 'Almendras Naturales', category: 'frutos_secos_semillas', state: 'seco', caloriesPer100g: 579, proteinPer100g: 21.2, carbsPer100g: 21.6, fatPer100g: 49.9, fiberPer100g: 12.5, commonPortionG: 25 },
  { id: 'usda-lentejas-secas', name: 'Lentejas Pardinas (en seco)', category: 'legumbres', state: 'seco', caloriesPer100g: 352, proteinPer100g: 24.6, carbsPer100g: 63.4, fatPer100g: 1.1, fiberPer100g: 10.7, commonPortionG: 70 },
];

export function getFoodById(foodId: string): FoodCatalogItem | undefined {
  return FOOD_CATALOG.find(f => f.id === foodId);
}

export function calculateFoodPortion(food: FoodCatalogItem, grams: number) {
  const safeGrams = Math.max(0, Number.isFinite(grams) ? grams : 0);
  const factor = safeGrams / 100;
  return {
    calories: Math.round(food.caloriesPer100g * factor),
    protein: Math.round(food.proteinPer100g * factor * 10) / 10,
    carbs: Math.round(food.carbsPer100g * factor * 10) / 10,
    fat: Math.round(food.fatPer100g * factor * 10) / 10,
  };
}

export function kgToLbs(kg: number): number {
  return Math.round(kg * 2.20462262185 * 10) / 10;
}

export function lbsToKg(lbs: number): number {
  return Math.round(lbs * 0.45359237 * 10) / 10;
}

export function cmToIn(cm: number): number {
  return Math.round(cm * 0.3937007874 * 10) / 10;
}

export function inToCm(inches: number): number {
  return Math.round(inches * 2.54 * 10) / 10;
}

export function formatWeight(kg: number, unit: WeightUnit): string {
  return unit === 'lbs' ? `${kgToLbs(kg)} lbs` : `${Math.round(kg * 10) / 10} kg`;
}

export function formatHeight(cm: number, unit: HeightUnit): string {
  return unit === 'in' ? `${cmToIn(cm)} in` : `${Math.round(cm)} cm`;
}

export function computeBiometricTargets(input: {
  weightKg: number;
  heightCm: number;
  age: number;
  bodyFatPct: number;
  palFactor: number;
  targetDeltaKcal: number;
  proteinPerKg: number;
  fatPerKg: number;
}): BiometricsPayload {
  const bmr = Math.round(10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + 5);
  const tdee = Math.round(bmr * input.palFactor);
  const rawCalories = Math.max(1200, tdee + input.targetDeltaKcal);

  const targetProteinG = Math.round(input.weightKg * input.proteinPerKg);
  const minFatG = Math.max(35, Math.round(input.weightKg * 0.65));
  let targetFatG = Math.max(minFatG, Math.round(input.weightKg * input.fatPerKg));

  // Diophantine 4/4/9 parity alignment so carbs remain integer-exact
  const modTarget = ((rawCalories % 4) + 4) % 4;
  const modFat = ((targetFatG % 4) + 4) % 4;
  let diff = modTarget - modFat;
  if (diff === -3) diff = 1;
  if (diff === 3) diff = -1;
  if (diff === 2 && targetFatG - 2 >= minFatG) diff = -2;
  targetFatG = Math.max(minFatG, targetFatG + diff);

  const targetCarbsG = Math.max(30, Math.round((rawCalories - targetProteinG * 4 - targetFatG * 9) / 4));
  const targetCalories = targetProteinG * 4 + targetCarbsG * 4 + targetFatG * 9;

  return {
    weightKg: Math.round(input.weightKg * 10) / 10,
    heightCm: Math.round(input.heightCm * 10) / 10,
    bodyFatPct: Math.round(input.bodyFatPct * 10) / 10,
    age: Math.round(input.age),
    palFactor: Math.round(input.palFactor * 1000) / 1000,
    targetDeltaKcal: Math.round(input.targetDeltaKcal),
    proteinPerKg: Math.round(input.proteinPerKg * 10) / 10,
    fatPerKg: Math.round(input.fatPerKg * 10) / 10,
    bmr,
    tdee,
    targetCalories,
    targetProteinG,
    targetFatG,
    targetCarbsG,
  };
}

export interface PeriodizationDayTarget {
  label: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  carbShiftPct: number;
}

export interface PeriodizationRecommendation {
  goal: AthleteGoal;
  phaseLabel: string;
  isDeloadWeek: boolean;
  dietBreakApplied: boolean;
  proposedTargets: BiometricsPayload;
  dayTargets: {
    highDemand: PeriodizationDayTarget;
    moderateDemand: PeriodizationDayTarget;
    restDay: PeriodizationDayTarget;
  };
  weeklyAverageCalories: number;
  warnings: string[];
  scientificNotes: string[];
}

export function computeAdaptivePeriodization(params: {
  goal: AthleteGoal;
  biometrics: BiometricsPayload;
  trainingDaysPerWeek: number;
  isDeloadWeek: boolean;
  dietBreakSelected: boolean;
  carbCyclingShiftPct?: number;
}): PeriodizationRecommendation {
  const { goal, biometrics, trainingDaysPerWeek, isDeloadWeek, dietBreakSelected } = params;
  const shiftPct = Math.min(25, Math.max(0, params.carbCyclingShiftPct ?? 15));

  const goalDefaults: Record<string, { delta: number; prot: number; fat: number }> = {
    hipertrofia: { delta: 200, prot: 2.0, fat: 0.9 },
    ganancia_muscular: { delta: 200, prot: 2.0, fat: 0.9 },
    fuerza: { delta: 100, prot: 1.8, fat: 0.9 },
    rendimiento: { delta: 100, prot: 1.8, fat: 0.9 },
    recomposicion: { delta: -100, prot: 2.2, fat: 0.8 },
    definicion: { delta: -400, prot: 2.4, fat: 0.7 },
    perdida_grasa: { delta: -400, prot: 2.4, fat: 0.7 },
    mantenimiento: { delta: 0, prot: 1.8, fat: 0.9 },
    resistencia: { delta: 50, prot: 1.7, fat: 0.85 },
    salud_general: { delta: 0, prot: 1.6, fat: 0.85 },
  };
  const base = goalDefaults[goal] ?? goalDefaults.hipertrofia;

  let delta = base.delta;
  let prot = base.prot;
  const fat = base.fat;
  let dietBreakApplied = false;

  if (isDeloadWeek) {
    if (goal === 'definicion' || goal === 'perdida_grasa') {
      if (dietBreakSelected) {
        delta = 0;
        dietBreakApplied = true;
      } else {
        delta = -350;
      }
      prot = 2.4;
    } else if (goal === 'hipertrofia' || goal === 'ganancia_muscular') {
      delta = 50;
    } else {
      delta = 0;
    }
  }

  const proposedTargets = computeBiometricTargets({
    weightKg: biometrics.weightKg,
    heightCm: biometrics.heightCm,
    age: biometrics.age,
    bodyFatPct: biometrics.bodyFatPct,
    palFactor: biometrics.palFactor,
    targetDeltaKcal: delta,
    proteinPerKg: prot,
    fatPerKg: fat,
  });

  const tDays = Math.min(6, Math.max(1, trainingDaysPerWeek));
  const rDays = 7 - tDays;
  const highDays = tDays <= 3 ? 1 : tDays <= 5 ? 2 : 3;
  const modDays = tDays - highDays;

  const highCarbsG = Math.round(proposedTargets.targetCarbsG * (1 + shiftPct / 100));
  const extraCarbTotalKcal = (highCarbsG - proposedTargets.targetCarbsG) * 4 * highDays;
  const restCarbCutPerDay = Math.round(extraCarbTotalKcal / (4 * Math.max(1, rDays)));
  const restCarbsG = Math.max(30, proposedTargets.targetCarbsG - restCarbCutPerDay);

  const highCalories = proposedTargets.targetProteinG * 4 + highCarbsG * 4 + proposedTargets.targetFatG * 9;
  const modCalories = proposedTargets.targetCalories;
  const restCalories = proposedTargets.targetProteinG * 4 + restCarbsG * 4 + proposedTargets.targetFatG * 9;

  const weeklyAverageCalories = Math.round(
    (highCalories * highDays + modCalories * modDays + restCalories * rDays) / 7
  );

  const warnings: string[] = [];
  if (proposedTargets.targetCalories < proposedTargets.bmr) {
    warnings.push('Las calorías propuestas están por debajo del BMR estimado.');
  }
  if (proposedTargets.fatPerKg < 0.65) {
    warnings.push('Grasa por debajo del umbral recomendado de 0.65 g/kg.');
  }

  const scientificNotes: string[] = [
    'Ciclado de carbohidratos isocalórico: conserva el presupuesto energético semanal priorizando días de alta demanda.',
  ];
  if (isDeloadWeek && (goal === 'definicion' || goal === 'perdida_grasa')) {
    scientificNotes.push(
      'El Diet Break en descarga es estrictamente opcional para adherencia psicológica y reposición de glucógeno; no acelera el metabolismo.'
    );
  }

  return {
    goal,
    phaseLabel: isDeloadWeek ? 'Semana de Descarga (Deload)' : 'Fase Acumulativa / Estándar',
    isDeloadWeek,
    dietBreakApplied,
    proposedTargets,
    dayTargets: {
      highDemand: {
        label: `Alta Demanda (${highDays} días/sem)`,
        calories: highCalories,
        proteinG: proposedTargets.targetProteinG,
        carbsG: highCarbsG,
        fatG: proposedTargets.targetFatG,
        carbShiftPct: shiftPct,
      },
      moderateDemand: {
        label: `Entreno Estándar (${modDays} días/sem)`,
        calories: modCalories,
        proteinG: proposedTargets.targetProteinG,
        carbsG: proposedTargets.targetCarbsG,
        fatG: proposedTargets.targetFatG,
        carbShiftPct: 0,
      },
      restDay: {
        label: `Descanso (${rDays} días/sem)`,
        calories: restCalories,
        proteinG: proposedTargets.targetProteinG,
        carbsG: restCarbsG,
        fatG: proposedTargets.targetFatG,
        carbShiftPct: Math.round(((restCarbsG - proposedTargets.targetCarbsG) / Math.max(1, proposedTargets.targetCarbsG)) * 100),
      },
    },
    weeklyAverageCalories,
    warnings,
    scientificNotes,
  };
}

export type SubstitutionCriterion = 'isoprotein' | 'isocarb' | 'isocaloric';

export interface SubstitutionComparison {
  sourceFood: FoodCatalogItem;
  sourceGrams: number;
  sourceNutrients: ReturnType<typeof calculateFoodPortion>;
  targetFood: FoodCatalogItem;
  targetGrams: number;
  targetNutrients: ReturnType<typeof calculateFoodPortion>;
  criterion: SubstitutionCriterion;
  deltaCalories: number;
  deltaProtein: number;
  deltaCarbs: number;
  deltaFat: number;
}

export function computeFoodSubstitution(
  sourceFoodId: string,
  sourceGrams: number,
  targetFoodId: string,
  criterion: SubstitutionCriterion
): SubstitutionComparison | null {
  const sourceFood = getFoodById(sourceFoodId);
  const targetFood = getFoodById(targetFoodId);
  if (!sourceFood || !targetFood) return null;

  const safeGrams = Math.max(1, sourceGrams);
  const sourceNutrients = calculateFoodPortion(sourceFood, safeGrams);

  let targetGrams = safeGrams;
  if (criterion === 'isoprotein' && targetFood.proteinPer100g > 0) {
    targetGrams = (sourceNutrients.protein / targetFood.proteinPer100g) * 100;
  } else if (criterion === 'isocarb' && targetFood.carbsPer100g > 0) {
    targetGrams = (sourceNutrients.carbs / targetFood.carbsPer100g) * 100;
  } else if (targetFood.caloriesPer100g > 0) {
    targetGrams = (sourceNutrients.calories / targetFood.caloriesPer100g) * 100;
  }

  targetGrams = Math.max(1, Math.round(targetGrams));
  const targetNutrients = calculateFoodPortion(targetFood, targetGrams);

  return {
    sourceFood,
    sourceGrams: safeGrams,
    sourceNutrients,
    targetFood,
    targetGrams,
    targetNutrients,
    criterion,
    deltaCalories: targetNutrients.calories - sourceNutrients.calories,
    deltaProtein: Math.round((targetNutrients.protein - sourceNutrients.protein) * 10) / 10,
    deltaCarbs: Math.round((targetNutrients.carbs - sourceNutrients.carbs) * 10) / 10,
    deltaFat: Math.round((targetNutrients.fat - sourceNutrients.fat) * 10) / 10,
  };
}

export function mapFoodCategoryToDepartment(category?: FoodCategory): GroceryDepartment {
  switch (category) {
    case 'carnes_aves':
    case 'pescados_mariscos':
      return 'carnes';
    case 'huevos':
    case 'lacteos':
      return 'huevos';
    case 'verduras_hortalizas':
    case 'frutas':
      return 'verduras';
    case 'cereales_granos':
    case 'tuberculos_raices':
    case 'legumbres':
      return 'carbohidratos';
    case 'grasas_aceites':
    case 'frutos_secos_semillas':
    default:
      return 'grasas';
  }
}

export interface GrocerySyncDiff {
  items: GroceryItemRecord[];
  addedCount: number;
  updatedCount: number;
  preservedBoughtCount: number;
  preservedManualCount: number;
  retiredCount: number;
  estimatedBatchCalls: number;
}

export function computeIdempotentGrocerySync(
  currentGroceries: GroceryItemRecord[],
  plan: MealPlanRecord | undefined,
  recipes: RecipeRecord[]
): GrocerySyncDiff {
  const recipeMap = new Map(recipes.map(r => [r.id, r]));
  const aggregated = new Map<
    string,
    { foodId: string; name: string; grams: number; department: GroceryDepartment; occurrences: number }
  >();

  if (plan?.days) {
    const moments: MealMoment[] = ['desayuno', 'almuerzo', 'merienda', 'cena', 'snack'];
    for (const day of Object.values(plan.days)) {
      for (const moment of moments) {
        const slot: PlannedMealSlot | undefined = day.meals?.[moment];
        if (!slot) continue;
        const recipe = recipeMap.get(slot.recipeId);
        if (!recipe) continue;
        const servings = slot.servings > 0 ? slot.servings : 1;
        for (const ing of recipe.ingredients) {
          const food = getFoodById(ing.foodId);
          const key = `${ing.foodId}__${food?.state || 'base'}`;
          const prev = aggregated.get(key);
          const addGrams = ing.grams * servings;
          if (prev) {
            prev.grams += addGrams;
            prev.occurrences += 1;
          } else {
            aggregated.set(key, {
              foodId: ing.foodId,
              name: food?.name || ing.foodName,
              grams: addGrams,
              department: mapFoodCategoryToDepartment(food?.category),
              occurrences: 1,
            });
          }
        }
      }
    }
  }

  const manualItems = currentGroceries.filter(i => i.origin === 'manual');
  const existingPlanMap = new Map(
    currentGroceries
      .filter(i => i.origin === 'plan' && i.planKey)
      .map(i => [i.planKey!, i])
  );

  let addedCount = 0;
  let updatedCount = 0;
  let preservedBoughtCount = 0;
  const nextPlanItems: GroceryItemRecord[] = [];
  const usedKeys = new Set<string>();

  for (const [key, agg] of aggregated.entries()) {
    usedKeys.add(key);
    const existing = existingPlanMap.get(key);
    const qty = agg.grams >= 1000 ? Math.round((agg.grams / 1000) * 100) / 100 : Math.round(agg.grams);
    const unit = agg.grams >= 1000 ? 'kg' : 'g';

    if (existing) {
      if (existing.status === 'bought') preservedBoughtCount++;
      else updatedCount++;
      nextPlanItems.push({
        ...existing,
        name: agg.name,
        quantity: qty,
        unit,
        department: agg.department,
        recipeSource: `Plan semanal (${agg.occurrences} tomas)`,
      });
    } else {
      addedCount++;
      nextPlanItems.push({
        id: `groc_${key}`,
        name: agg.name,
        quantity: qty,
        unit,
        department: agg.department,
        status: 'pending',
        origin: 'plan',
        planKey: key,
        foodId: agg.foodId,
        recipeSource: `Plan semanal (${agg.occurrences} tomas)`,
      });
    }
  }

  let retiredCount = 0;
  for (const [key, item] of existingPlanMap.entries()) {
    if (usedKeys.has(key)) continue;
    if (item.status === 'bought') {
      preservedBoughtCount++;
      nextPlanItems.push(item);
    } else {
      retiredCount++;
    }
  }

  const items = [...nextPlanItems, ...manualItems].sort(
    (a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name)
  );
  const estimatedBatchCalls = Math.max(1, Math.ceil(items.length / CATALYST_BUDGET_LIMITS.MAX_BATCH_WRITE_ITEMS));

  return {
    items,
    addedCount,
    updatedCount,
    preservedBoughtCount,
    preservedManualCount: manualItems.length,
    retiredCount,
    estimatedBatchCalls,
  };
}

export function groupMealLogsByDate(
  logs: MealLogRecord[],
  dates: string[]
): Array<{
  date: string;
  mealsCount: number;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  status: 'logged' | 'unlogged';
}> {
  return dates.map(date => {
    const dayMeals = logs.filter(m => m.dateTime.slice(0, 10) === date);
    if (dayMeals.length === 0) {
      return {
        date,
        mealsCount: 0,
        calories: null,
        protein: null,
        carbs: null,
        fat: null,
        status: 'unlogged',
      };
    }
    return {
      date,
      mealsCount: dayMeals.length,
      calories: Math.round(dayMeals.reduce((s, m) => s + m.kcal, 0)),
      protein: Math.round(dayMeals.reduce((s, m) => s + m.protein, 0) * 10) / 10,
      carbs: Math.round(dayMeals.reduce((s, m) => s + m.carbs, 0) * 10) / 10,
      fat: Math.round(dayMeals.reduce((s, m) => s + m.fat, 0) * 10) / 10,
      status: 'logged',
    };
  });
}

export function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getRecentDateList(daysCount: number, endDateIso = getTodayIsoDate()): string[] {
  const [y, m, d] = endDateIso.split('-').map(Number);
  const base = new Date(y, m - 1, d, 12, 0, 0);
  const out: string[] = [];
  for (let i = daysCount - 1; i >= 0; i--) {
    const dt = new Date(base);
    dt.setDate(base.getDate() - i);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    out.push(`${yy}-${mm}-${dd}`);
  }
  return out;
}
