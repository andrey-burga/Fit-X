import { NUTRITION_CATALOG, NUTRITION_CATALOG_BY_ID } from '../data/nutritionCatalog';
import {
  CalculatedFoodPortion,
  FoodCategory,
  FoodItem,
  FoodPreparationState,
  NutritionalBreakdown,
} from '../types/nutrition';

/**
 * Validador estricto de gramos consumidos o planificados.
 *
 * Reglas de negocio:
 * 1. Debe ser de tipo number primitivo.
 * 2. Debe ser un número finito (rechaza NaN, Infinity, -Infinity).
 * 3. Debe ser no negativo (>= 0). Se rechazan cantidades negativas.
 *
 * @throws {Error} Si el valor no cumple con las restricciones numéricas.
 */
export function validateGrams(grams: unknown): number {
  if (typeof grams !== 'number' || !Number.isFinite(grams)) {
    throw new Error(
      `[NutritionMath] Cantidad de gramos inválida: se esperaba un número finito, pero se recibió: ${String(
        grams
      )} (${typeof grams})`
    );
  }

  if (grams < 0) {
    throw new Error(
      `[NutritionMath] Cantidad de gramos negativa no permitida: ${grams} g. La porción debe ser mayor o igual a 0.`
    );
  }

  return grams;
}

/**
 * Valida la integridad numérica de los macronutrientes de un alimento.
 *
 * @throws {Error} Si algún macronutriente es inválido, negativo o no finito.
 */
export function validateFoodNutrients(food: FoodItem): boolean {
  if (!food || typeof food !== 'object') {
    throw new Error('[NutritionMath] Alimento inválido o nulo.');
  }

  const fieldsToCheck: Array<keyof Pick<
    FoodItem,
    'caloriesPer100g' | 'proteinPer100g' | 'carbsPer100g' | 'fatsPer100g' | 'fiberPer100g'
  >> = ['caloriesPer100g', 'proteinPer100g', 'carbsPer100g', 'fatsPer100g', 'fiberPer100g'];

  for (const field of fieldsToCheck) {
    const val = food[field];
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
      throw new Error(
        `[NutritionMath] Valor incoherente en ${field} para el alimento '${food.name}' (ID: ${food.id}): ${val}`
      );
    }
  }

  return true;
}

/**
 * Obtiene un alimento del catálogo por su identificador único estable.
 *
 * @param id Identificador único del alimento (ej. 'usda-171077-pechuga-pollo-asada')
 * @returns El alimento correspondiente o undefined si no existe.
 */
export function getFoodById(id: string): FoodItem | undefined {
  if (!id || typeof id !== 'string') {
    return undefined;
  }
  return NUTRITION_CATALOG_BY_ID.get(id.trim());
}

/**
 * Obtiene un alimento por su ID o lanza un error explícito si no existe.
 *
 * @throws {Error} Si el alimento no está registrado en el catálogo.
 */
export function getFoodOrThrow(id: string): FoodItem {
  const food = getFoodById(id);
  if (!food) {
    throw new Error(
      `[NutritionMath] Alimento no encontrado en el catálogo oficial: '${id}'. Verifique el identificador.`
    );
  }
  return food;
}

/**
 * Retorna todos los alimentos disponibles en el catálogo.
 */
export function getAllFoods(): readonly FoodItem[] {
  return NUTRITION_CATALOG;
}

/**
 * Opciones de filtrado para búsqueda de alimentos en el catálogo.
 */
export interface FoodSearchOptions {
  category?: FoodCategory;
  state?: FoodPreparationState;
  limit?: number;
}

/**
 * Busca alimentos por coincidencia de términos en español o etiquetas normalizadas.
 */
export function searchFoods(query: string, options?: FoodSearchOptions): FoodItem[] {
  const normalizedQuery = (query || '').toLowerCase().trim();
  const categoryFilter = options?.category;
  const stateFilter = options?.state;
  const limit = options?.limit ?? 50;

  const results: FoodItem[] = [];

  for (const food of NUTRITION_CATALOG) {
    if (categoryFilter && food.category !== categoryFilter) {
      continue;
    }
    if (stateFilter && food.state !== stateFilter) {
      continue;
    }

    if (!normalizedQuery) {
      results.push(food);
    } else {
      const matchName = food.name.toLowerCase().includes(normalizedQuery);
      const matchTag = food.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));
      if (matchName || matchTag) {
        results.push(food);
      }
    }

    if (results.length >= limit) {
      break;
    }
  }

  return results;
}

/**
 * Motor de cálculo nutricional por porción en gramos.
 *
 * Fórmula física:
 * nutriente consumido = (nutriente por 100 g * gramos consumidos) / 100
 *
 * Conserva la precisión numérica de punto flotante.
 * No reemplaza las calorías por la aproximación 4/4/9: utiliza directamente
 * el valor analítico provisto por el laboratorio del registro oficial.
 */
export function calculateNutrients(food: FoodItem, grams: number): NutritionalBreakdown {
  const validatedGrams = validateGrams(grams);
  validateFoodNutrients(food);

  // Manejo directo de caso base cero para evitar operaciones innecesarias
  if (validatedGrams === 0) {
    return {
      calories: 0,
      protein: 0,
      carbs: 0,
      fats: 0,
      fiber: 0,
    };
  }

  const factor = validatedGrams / food.referenceGrams;

  return {
    calories: food.caloriesPer100g * factor,
    protein: food.proteinPer100g * factor,
    carbs: food.carbsPer100g * factor,
    fats: food.fatsPer100g * factor,
    fiber: food.fiberPer100g * factor,
  };
}

/**
 * Calcula los nutrientes de una porción a partir del ID del alimento y los gramos.
 *
 * @throws {Error} Si el ID no existe o si los gramos son inválidos.
 */
export function calculatePortionNutrients(
  foodId: string,
  grams: number
): CalculatedFoodPortion {
  const food = getFoodOrThrow(foodId);
  const validatedGrams = validateGrams(grams);
  const nutrients = calculateNutrients(food, validatedGrams);

  return {
    foodId: food.id,
    foodName: food.name,
    grams: validatedGrams,
    nutrients,
    sourceFdcId: food.source.fdcId,
  };
}

/**
 * Suma los nutrientes de múltiples alimentos o ingredientes.
 * Permite computar totales de platos compuestos, comidas y menús diarios.
 *
 * @param items Lista de desglose nutricional a consolidar.
 * @returns La sumatoria total con precisión completa.
 */
export function sumNutrients(items: readonly NutritionalBreakdown[]): NutritionalBreakdown {
  const total: NutritionalBreakdown = {
    calories: 0,
    protein: 0,
    carbs: 0,
    fats: 0,
    fiber: 0,
  };

  if (!items || items.length === 0) {
    return total;
  }

  for (const item of items) {
    total.calories += item.calories || 0;
    total.protein += item.protein || 0;
    total.carbs += item.carbs || 0;
    total.fats += item.fats || 0;
    total.fiber += item.fiber || 0;
  }

  return total;
}

/**
 * Utilidad de redondeo para presentación en interfaz visual.
 * Mantiene la regla de redondear únicamente en la capa de vista o presentación final.
 */
export function roundNutrients(
  nutrients: NutritionalBreakdown,
  decimals: number = 1
): NutritionalBreakdown {
  const factor = Math.pow(10, decimals);
  return {
    calories: Math.round(nutrients.calories * factor) / factor,
    protein: Math.round(nutrients.protein * factor) / factor,
    carbs: Math.round(nutrients.carbs * factor) / factor,
    fats: Math.round(nutrients.fats * factor) / factor,
    fiber: Math.round(nutrients.fiber * factor) / factor,
  };
}

/**
 * Formatea un valor nutricional para presentación en UI (ej. "31.5 g" o "165 kcal").
 */
export function formatNutrientValue(
  value: number,
  decimals: number = 1,
  unit: string = 'g'
): string {
  if (!Number.isFinite(value)) {
    return `0 ${unit}`;
  }
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(value * factor) / factor;
  return `${rounded} ${unit}`;
}

/**
 * Calcula los nutrientes exactos de una receta a partir de sus ingredientes y número de porciones.
 *
 * @throws {Error} Si algún ingrediente no existe en el catálogo o si los gramos son inválidos.
 */
export function calculateRecipeNutrients(
  ingredients: Array<{ foodId: string; grams: number }>,
  servings: number = 1
): {
  total: NutritionalBreakdown;
  perServing: NutritionalBreakdown;
  ingredientsBreakdown: CalculatedFoodPortion[];
} {
  if (!ingredients || ingredients.length === 0) {
    const empty: NutritionalBreakdown = { calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0 };
    return { total: empty, perServing: empty, ingredientsBreakdown: [] };
  }

  const validServings = servings > 0 && Number.isFinite(servings) ? servings : 1;
  const ingredientsBreakdown: CalculatedFoodPortion[] = [];

  for (const ing of ingredients) {
    const portion = calculatePortionNutrients(ing.foodId, ing.grams);
    ingredientsBreakdown.push(portion);
  }

  const total = sumNutrients(ingredientsBreakdown.map(ib => ib.nutrients));
  const perServing: NutritionalBreakdown = {
    calories: total.calories / validServings,
    protein: total.protein / validServings,
    carbs: total.carbs / validServings,
    fats: total.fats / validServings,
    fiber: total.fiber / validServings,
  };

  return {
    total,
    perServing,
    ingredientsBreakdown,
  };
}

