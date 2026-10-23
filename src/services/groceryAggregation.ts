import { WeeklyMealPlan, FoodCategory, DayMealPlan, PlannedMealSlot, Recipe, RecipeIngredient } from '../types/nutrition';
import { GroceryDepartment, GroceryItem } from '../types';
import { getFoodById } from './nutritionMath';

export interface AggregatedIngredient {
  key: string;
  foodId?: string;
  foodName: string;
  state: string;
  totalGrams: number;
  quantity: number;
  unit: string;
  department: GroceryDepartment;
  occurrences: number;
  momentsSummary: string[];
  recipeSource: string;
  nutritionInfo: string;
  warning?: string;
}

export interface SyncSummary {
  addedCount: number;
  updatedCount: number;
  preservedCompletedCount: number;
  manualPreservedCount: number;
  retiredCount: number;
  totalItems: number;
}

/**
 * Mapea la categoría nutricional USDA a uno de los 5 departamentos permitidos por las reglas de Firestore.
 */
export function mapCategoryToDepartment(category?: FoodCategory): GroceryDepartment {
  if (!category) return 'carbohidratos';

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
    case 'suplementos':
    default:
      return 'grasas';
  }
}

/**
 * Formatea la cantidad y la unidad métrica adecuada según la naturaleza del alimento.
 * - Huevos enteros: convierte gramos a unidades (1 huevo mediano/grande = 50g según USDA SR Legacy 173424).
 * - Aceite de oliva y aceites culinarios: densidad bromatológica verificada = 0.92 g/ml (COI / USDA SR Legacy 171413).
 *   (1 ml = 0.92 g; ej: 100 g de aceite = 109 ml. No se asume 1 g/ml).
 * - Leche de vaca fluida: densidad bromatológica verificada = 1.03 g/ml (USDA SR Legacy 171265).
 * - Para otros aceites, productos densos o líquidos sin densidad verificada: se conserva la unidad de masa ('g' o 'kg' si >= 1000g).
 */
export function formatGroceryQuantityAndUnit(
  foodId: string | undefined,
  totalGrams: number,
  category?: FoodCategory
): { quantity: number; unit: string } {
  // 1. Huevos enteros: 50g por unidad (USDA SR Legacy 173424 / 171287)
  if (foodId && (foodId.includes('huevo-entero') || foodId.includes('173424') || foodId.includes('171287'))) {
    const units = Math.max(1, Math.round(totalGrams / 50));
    return { quantity: units, unit: 'unid' };
  }

  // 2. Aceites culinarios con densidad verificada (densidad = 0.92 g/ml)
  // 1 ml = 0.92 g de aceite de oliva; por tanto volumen (ml) = masa (g) / 0.92
  if (
    foodId === 'usda-171413-aceite-oliva-virgen-extra' ||
    (category === 'grasas_aceites' && (foodId?.includes('aceite-oliva') || foodId?.includes('aove') || foodId?.includes('aceite-vegetal')))
  ) {
    const density = 0.92;
    const volumeMl = Math.round(totalGrams / density);
    if (volumeMl >= 1000) {
      return { quantity: Number((volumeMl / 1000).toFixed(2)), unit: 'l' };
    }
    return { quantity: volumeMl, unit: 'ml' };
  }

  // 3. Leche de vaca fluida con densidad verificada (densidad = 1.03 g/ml)
  if (
    foodId === 'usda-171265-leche-entera-fluida' ||
    foodId === 'usda-171269-leche-descremada-fluida'
  ) {
    const density = 1.03;
    const volumeMl = Math.round(totalGrams / density);
    if (volumeMl >= 1000) {
      return { quantity: Number((volumeMl / 1000).toFixed(2)), unit: 'l' };
    }
    return { quantity: volumeMl, unit: 'ml' };
  }

  // 4. Granel sólido o alimentos sin densidad verificada: conservar unidad de masa
  if (totalGrams >= 1000) {
    return { quantity: Number((totalGrams / 1000).toFixed(2)), unit: 'kg' };
  }

  return { quantity: Math.round(totalGrams), unit: 'g' };
}

/**
 * Función pura de agregación: recorre los 7 días del plan semanal,
 * agrupa los ingredientes equivalentes respetando estrictamente su estado de preparación
 * (crudo vs cocido) y calcula las cantidades netas acumuladas.
 */
export function aggregateWeeklyMealPlan(
  plan: WeeklyMealPlan,
  recipesList?: Recipe[]
): AggregatedIngredient[] {
  if (!plan || !plan.days) {
    return [];
  }

  // Mapa de recetas para lookup si un slot carece de array de ingredientes directo
  const recipeMap = new Map<string, Recipe>();
  if (recipesList && recipesList.length > 0) {
    recipesList.forEach(r => recipeMap.set(r.id, r));
  }

  // Map acumulador por clave compuesta: foodId (o nombre normalizado) + estado
  const map = new Map<
    string,
    {
      foodId?: string;
      foodName: string;
      state: string;
      totalGrams: number;
      category?: FoodCategory;
      occurrences: number;
      momentsSummary: string[];
      totalProtein: number;
      totalCarbs: number;
      totalFats: number;
    }
  >();

  const dayEntries = Object.values(plan.days as Record<string, DayMealPlan>);

  dayEntries.forEach(day => {
    if (!day || !day.meals) return;

    const moments = ['desayuno', 'almuerzo', 'merienda', 'cena', 'snack'] as const;

    moments.forEach(m => {
      const slot = day.meals[m] as PlannedMealSlot | undefined;
      if (!slot) return;

      const momentLabel = `${day.dayLabel || day.date} (${m})`;
      const servings = slot.servings && slot.servings > 0 ? slot.servings : 1;

      // Obtener ingredientes: priorizar la definición actualizada de la receta en recipeMap
      // escalada por las porciones del slot, o caer a slot.ingredients si la receta no está en la biblioteca
      let ingredientsToProcess: Array<{
        foodId: string;
        foodName: string;
        grams: number;
        state?: string;
      }> = [];

      if (slot.recipeId && recipeMap.has(slot.recipeId)) {
        const recipe = recipeMap.get(slot.recipeId)!;
        ingredientsToProcess = recipe.ingredients.map(ing => ({
          foodId: ing.foodId,
          foodName: ing.foodName,
          grams: ing.grams * servings,
          state: ing.preparationState,
        }));
      } else if (slot.ingredients && slot.ingredients.length > 0) {
        ingredientsToProcess = slot.ingredients.map(ing => ({
          foodId: ing.foodId,
          foodName: ing.foodName,
          grams: ing.grams,
          state: ing.state,
        }));
      }

      ingredientsToProcess.forEach(ing => {
        if (!ing || ing.grams <= 0) return;

        const food = getFoodById(ing.foodId);
        const state = ing.state || food?.state || 'cocido';
        const foodName = food?.name || ing.foodName;
        const category = food?.category;

        // Clave única estable: id de alimento + estado de preparación
        // Evita mezclar pollo crudo con pollo asado
        const key = food?.id
          ? `${food.id}__${state}`
          : `${ing.foodName.toLowerCase().trim()}__${state}`;

        // Cálculo de macronutrientes acumulados para el insumo
        let protG = 0;
        let carbG = 0;
        let fatG = 0;
        if (food) {
          const factor = ing.grams / food.referenceGrams;
          protG = food.proteinPer100g * factor;
          carbG = food.carbsPer100g * factor;
          fatG = food.fatsPer100g * factor;
        }

        const existing = map.get(key);
        if (existing) {
          existing.totalGrams += ing.grams;
          existing.occurrences += 1;
          existing.totalProtein += protG;
          existing.totalCarbs += carbG;
          existing.totalFats += fatG;
          if (!existing.momentsSummary.includes(momentLabel)) {
            existing.momentsSummary.push(momentLabel);
          }
        } else {
          map.set(key, {
            foodId: food?.id || ing.foodId,
            foodName,
            state,
            totalGrams: ing.grams,
            category,
            occurrences: 1,
            momentsSummary: [momentLabel],
            totalProtein: protG,
            totalCarbs: carbG,
            totalFats: fatG,
          });
        }
      });
    });
  });

  const result: AggregatedIngredient[] = [];

  for (const [key, data] of map.entries()) {
    const { quantity, unit } = formatGroceryQuantityAndUnit(data.foodId, data.totalGrams, data.category);
    const department = mapCategoryToDepartment(data.category);

    const recipeSource = `Calculado de: ${data.occurrences} ${
      data.occurrences === 1 ? 'toma' : 'tomas'
    } en la semana`;

    const roundedP = Math.round(data.totalProtein);
    const roundedC = Math.round(data.totalCarbs);
    const roundedF = Math.round(data.totalFats);
    const nutritionInfo = `Aporte: ${roundedP}g Prot • ${roundedC}g Carb • ${roundedF}g Gras`;

    // Advertencia informativa si el estado difiere de la presentación común
    let warning: string | undefined;
    if (data.state === 'crudo' && department === 'carnes') {
      warning = 'Medición en peso crudo para compra directa en carnicería';
    }

    result.push({
      key,
      foodId: data.foodId,
      foodName: data.foodName,
      state: data.state,
      totalGrams: Math.round(data.totalGrams * 10) / 10,
      quantity,
      unit,
      department,
      occurrences: data.occurrences,
      momentsSummary: data.momentsSummary,
      recipeSource,
      nutritionInfo,
      warning,
    });
  }

  // Ordenar alfabéticamente por departamento y nombre
  return result.sort((a, b) => a.department.localeCompare(b.department) || a.foodName.localeCompare(b.foodName));
}

/**
 * Función pura de sincronización segura e idempotente.
 * - Idempotencia: correrla repetidamente genera exactamente el mismo resultado sin duplicar ni sumar dos veces.
 * - No borra artículos agregados manualmente por el usuario (`origin: 'manual'`).
 * - Conserva el estado de compra (`status: 'completed'`) de los insumos ya adquiridos.
 * - Política de conflicto: Si el usuario editó manualmente una cantidad (`isCustomized: true`),
 *   se respeta su cantidad personalizada y se anota `calculatedQuantity` con el requerimiento del menú.
 * - Actualiza las cantidades de insumos no personalizados según el menú vigente.
 * - Retira insumos planificados pendientes que ya no se usan en ninguna comida del menú.
 */
export function computeIdempotentGrocerySync(
  currentGroceries: GroceryItem[],
  aggregated: AggregatedIngredient[]
): {
  updatedGroceries: GroceryItem[];
  syncSummary: SyncSummary;
} {
  let addedCount = 0;
  let updatedCount = 0;
  let preservedCompletedCount = 0;
  let manualPreservedCount = 0;
  let retiredCount = 0;

  // 1. Clasificar y conservar artículos manuales sin alteración
  const manualItems: GroceryItem[] = [];
  const existingPlanItemsMap = new Map<string, GroceryItem>();
  const processedExistingIds = new Set<string>();

  for (const item of currentGroceries) {
    // Si fue agregado manualmente o explícitamente marcado como manual
    const isManual = item.origin === 'manual' || (!item.planKey && !item.recipeSource?.startsWith('Calculado de:'));
    if (isManual) {
      manualItems.push({
        ...item,
        origin: 'manual',
      });
      manualPreservedCount++;
    } else {
      // Es un artículo originado en el plan
      const lookupKey = item.planKey || `${item.foodId || item.name.toLowerCase().trim()}__${item.preparationState || 'cocido'}`;
      existingPlanItemsMap.set(lookupKey, item);
      // Mapear por ID de alimento si existe
      if (item.foodId) {
        existingPlanItemsMap.set(`${item.foodId}__${item.preparationState || 'cocido'}`, item);
      }
    }
  }

  // 2. Procesar los insumos agregados del plan actual
  const mergedPlanItems: GroceryItem[] = [];

  for (const agg of aggregated) {
    // Buscar coincidencia estable
    let existing = existingPlanItemsMap.get(agg.key);
    if (!existing && agg.foodId) {
      existing = existingPlanItemsMap.get(`${agg.foodId}__${agg.state}`);
    }
    if (!existing) {
      // Fallback por nombre normalizado solo si no se ha usado
      for (const item of existingPlanItemsMap.values()) {
        if (!processedExistingIds.has(item.id) && item.name.toLowerCase().trim() === agg.foodName.toLowerCase().trim()) {
          existing = item;
          break;
        }
      }
    }

    if (existing) {
      processedExistingIds.add(existing.id);
      const wasCompleted = existing.status === 'completed';
      if (wasCompleted) {
        preservedCompletedCount++;
      } else {
        updatedCount++;
      }

      // Política de resolución de conflictos manual vs plan:
      // Si el usuario editó manualmente la cantidad, respetamos su cantidad
      // y guardamos la requerida por el plan en calculatedQuantity
      const isCustomized = existing.isCustomized === true;
      const finalQuantity = isCustomized ? existing.quantity : agg.quantity;
      const finalUnit = isCustomized ? existing.unit : agg.unit;

      mergedPlanItems.push({
        ...existing,
        name: agg.foodName,
        quantity: finalQuantity,
        unit: finalUnit,
        department: existing.department || agg.department,
        status: existing.status, // PRESERVAR: si el usuario ya lo compró, sigue comprado
        origin: 'plan',
        planKey: agg.key,
        foodId: agg.foodId,
        preparationState: agg.state,
        recipeSource: isCustomized
          ? `${agg.recipeSource} (Cantidad editada por usuario)`
          : agg.recipeSource,
        nutritionInfo: agg.nutritionInfo,
        warning: agg.warning,
        isCustomized,
        calculatedQuantity: agg.quantity,
      });
    } else {
      // Insumo nuevo que no estaba en la lista: añadir con status pending
      const newId = `groc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      addedCount++;

      mergedPlanItems.push({
        id: newId,
        name: agg.foodName,
        quantity: agg.quantity,
        unit: agg.unit,
        department: agg.department,
        status: 'pending',
        origin: 'plan',
        planKey: agg.key,
        foodId: agg.foodId,
        preparationState: agg.state,
        recipeSource: agg.recipeSource,
        nutritionInfo: agg.nutritionInfo,
        warning: agg.warning,
        isCustomized: false,
        calculatedQuantity: agg.quantity,
      });
    }
  }

  // 3. Revisar artículos del plan previo que ya no están en el nuevo menú
  // Si estaban pendientes, se retiran limpiamente.
  // Si ya estaban comprados ('completed'), se conservan para no borrar el registro de compra.
  const seenIds = new Set(mergedPlanItems.map(p => p.id));

  for (const item of existingPlanItemsMap.values()) {
    if (seenIds.has(item.id)) continue;
    seenIds.add(item.id);

    if (item.status === 'completed') {
      preservedCompletedCount++;
      mergedPlanItems.push({
        ...item,
        notes: item.notes ? `${item.notes} · (Comprado previamente)` : '(Comprado previamente - ya no en menú)',
      });
    } else {
      // Ya no está en el menú y no se ha comprado: se retira limpiamente
      retiredCount++;
    }
  }

  // Unir artículos manuales + artículos del plan
  const updatedGroceries = [...mergedPlanItems, ...manualItems];

  const syncSummary: SyncSummary = {
    addedCount,
    updatedCount,
    preservedCompletedCount,
    manualPreservedCount,
    retiredCount,
    totalItems: updatedGroceries.length,
  };

  return {
    updatedGroceries,
    syncSummary,
  };
}
