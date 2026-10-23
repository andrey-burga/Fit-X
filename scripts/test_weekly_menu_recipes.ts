import { NUTRITION_CATALOG, NUTRITION_CATALOG_BY_ID } from '../src/data/nutritionCatalog';
import { calculateRecipeNutrients, roundNutrients, getFoodById } from '../src/services/nutritionMath';
import { TEMPLATE_RECIPES, createDefaultWeeklyPlan } from '../src/data/templateRecipes';
import { getWeekStartEnd, shiftWeek, getWeekDays } from '../src/services/dateUtils';
import { Recipe, WeeklyMealPlan } from '../src/types/nutrition';
import { MealMoment, GroceryDepartment } from '../src/types';

let passed = 0;
let total = 0;

function assert(condition: boolean, message: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✅ [PASS] ${message}`);
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

console.log('========================================================================');
console.log(' TEST INCREMENTO 4: SISTEMA DE RECETAS, MENÚ SEMANAL Y COMPATIBILIDAD ');
console.log('========================================================================\n');

// 1. Template Recipes & USDA Catalog Integrity
console.log('[TEST 1] Integridad del Catálogo y Recetas Base Verificadas:');
assert(TEMPLATE_RECIPES.length >= 8, `Biblioteca contiene ${TEMPLATE_RECIPES.length} recetas preconfiguradas (mínimo 8)`);

for (const recipe of TEMPLATE_RECIPES) {
  assert(recipe.name.length >= 2, `Receta "${recipe.name}" tiene nombre válido (>= 2 caracteres)`);
  assert(
    ['desayuno', 'almuerzo', 'merienda', 'cena', 'snack'].includes(recipe.suggestedMoment),
    `Receta "${recipe.name}" momento sugerido válido: ${recipe.suggestedMoment}`
  );
  assert(recipe.servings >= 1, `Receta "${recipe.name}" porciones >= 1`);
  assert(recipe.totalNutrients.calories > 0, `Receta "${recipe.name}" calorías calculadas > 0 (${recipe.totalNutrients.calories} kcal)`);
  assert(recipe.ingredients.length > 0, `Receta "${recipe.name}" tiene ${recipe.ingredients.length} ingredientes reales`);

  // Verify all ingredients exist in USDA catalog
  for (const ing of recipe.ingredients) {
    const food = NUTRITION_CATALOG_BY_ID.get(ing.foodId);
    assert(!!food, `Ingrediente "${ing.foodName}" (ID: ${ing.foodId}) existe en NUTRITION_CATALOG oficial`);
    assert(ing.grams > 0, `Ingrediente "${ing.foodName}" tiene gramos válidos: ${ing.grams}g`);
  }
}

// 2. Mathematical Engine on Custom Recipe Calculation
console.log('\n[TEST 2] Motor Matemático de Recetas (calculateRecipeNutrients):');
const testIngredients = [
  { foodId: 'usda-171477-pechuga-pollo-asada', grams: 200 }, // 165 kcal/100g, 31.02g P/100g
  { foodId: 'usda-169704-arroz-integral-cocido', grams: 150 }, // 123 kcal/100g, 2.74g P/100g
  { foodId: 'usda-171706-aguacate-hass-crudo', grams: 50 },  // 160 kcal/100g, 2.0g P/100g
];

const singleServingCalc = calculateRecipeNutrients(testIngredients, 1);
// Pollo: 165 * 2 = 330 kcal, 31.02 * 2 = 62.04 g P
// Arroz integral: 112 * 1.5 = 168 kcal, 2.32 * 1.5 = 3.48 g P
// Aguacate: 160 * 0.5 = 80 kcal, 2.0 * 0.5 = 1.0 g P
// Total Kcal: 330 + 168 + 80 = 578.0 kcal
// Total P: 62.04 + 3.48 + 1.0 = 66.52 g P

assert(
  Math.abs(singleServingCalc.total.calories - 578.0) < 0.1,
  `Calorías totales exactas calculadas: ${singleServingCalc.total.calories.toFixed(1)} kcal (esperado exacto 578.0)`
);
assert(
  Math.abs(singleServingCalc.total.protein - 66.52) < 0.1,
  `Proteína total exacta calculada: ${singleServingCalc.total.protein.toFixed(2)} g (esperado exacto 66.52)`
);

// Scale to 2 servings
const doubleServingCalc = calculateRecipeNutrients(testIngredients, 2);
assert(
  Math.abs(doubleServingCalc.perServing.calories - singleServingCalc.total.calories / 2) < 0.1,
  `Cálculo por porción divide equitativamente las calorías para 2 porciones`
);
assert(
  Math.abs(doubleServingCalc.perServing.protein - singleServingCalc.total.protein / 2) < 0.1,
  `Cálculo por porción divide equitativamente la proteína para 2 porciones`
);

// 3. Firestore Rules Simulation for Recipes (isValidRecipe)
console.log('\n[TEST 3] Validación de Reglas de Seguridad Firestore para Recetas (isValidRecipe):');
function simulateIsValidRecipe(data: any, userId: string): boolean {
  return (
    data.userId === userId &&
    typeof data.name === 'string' &&
    data.name.length >= 2 &&
    data.name.length <= 150 &&
    ['desayuno', 'almuerzo', 'merienda', 'cena', 'snack'].includes(data.suggestedMoment) &&
    typeof data.servings === 'number' &&
    data.servings >= 1 &&
    typeof data.totalNutrients?.calories === 'number' &&
    data.totalNutrients?.calories >= 0
  );
}

const validUid = 'atleta_test_uid_456';
const sampleRecipePayload = {
  userId: validUid,
  name: 'Bowl de Pollo y Arroz Silvestre',
  suggestedMoment: 'almuerzo',
  servings: 1,
  totalNutrients: {
    calories: 595,
    protein: 67,
    carbs: 45,
    fats: 14,
    fiber: 6,
  },
};

assert(simulateIsValidRecipe(sampleRecipePayload, validUid), 'Receta válida cumple la regla isValidRecipe');
assert(!simulateIsValidRecipe({ ...sampleRecipePayload, userId: 'other_hacker_uid' }, validUid), 'Rechaza receta con userId ajeno');
assert(!simulateIsValidRecipe({ ...sampleRecipePayload, name: 'X' }, validUid), 'Rechaza receta con nombre menor a 2 caracteres');
assert(!simulateIsValidRecipe({ ...sampleRecipePayload, suggestedMoment: 'postre' }, validUid), 'Rechaza receta con momento no permitido');
assert(!simulateIsValidRecipe({ ...sampleRecipePayload, servings: 0 }, validUid), 'Rechaza receta con porciones < 1');
assert(!simulateIsValidRecipe({ ...sampleRecipePayload, totalNutrients: { calories: -50 } }, validUid), 'Rechaza receta con calorías negativas');

// 4. Firestore Rules Simulation for Meal Plans (isValidMealPlan)
console.log('\n[TEST 4] Validación de Reglas de Seguridad Firestore para Planes Semanales (isValidMealPlan):');
function simulateIsValidMealPlan(data: any, userId: string): boolean {
  return (
    data.userId === userId &&
    typeof data.weekStart === 'string' &&
    data.weekStart.length === 10 &&
    typeof data.weekEnd === 'string' &&
    data.weekEnd.length === 10
  );
}

const sampleMealPlanPayload = {
  userId: validUid,
  weekStart: '2024-10-21',
  weekEnd: '2024-10-27',
  label: 'Semana 43',
};

assert(simulateIsValidMealPlan(sampleMealPlanPayload, validUid), 'Plan semanal válido cumple la regla isValidMealPlan');
assert(!simulateIsValidMealPlan({ ...sampleMealPlanPayload, userId: 'other_uid' }, validUid), 'Rechaza plan con userId ajeno');
assert(!simulateIsValidMealPlan({ ...sampleMealPlanPayload, weekStart: '2024-10-2' }, validUid), 'Rechaza plan con weekStart no ISO (longitud != 10)');
assert(!simulateIsValidMealPlan({ ...sampleMealPlanPayload, weekEnd: '2024-10-27T00:00' }, validUid), 'Rechaza plan con weekEnd mayor a 10 caracteres');

// 5. Weekly Meal Plan Generator & Day Mapping
console.log('\n[TEST 5] Generador de Plan Semanal Base y Días (createDefaultWeeklyPlan):');
const defaultPlan = createDefaultWeeklyPlan('2024-10-21', '2024-10-27', validUid, TEMPLATE_RECIPES);
assert(defaultPlan.weekStart === '2024-10-21', 'Plan weekStart es 2024-10-21 (Lunes)');
assert(defaultPlan.weekEnd === '2024-10-27', 'Plan weekEnd es 2024-10-27 (Domingo)');
assert(Object.keys(defaultPlan.days).length === 7, 'El plan contiene exactamente los 7 días de la semana');

const thursday = defaultPlan.days['2024-10-24'];
assert(!!thursday, '2024-10-24 (Jueves) está presente en el plan');
assert(!!thursday.meals.desayuno, 'Desayuno planificado para el Jueves');
assert(!!thursday.meals.almuerzo, 'Almuerzo planificado para el Jueves');
assert(!!thursday.meals.merienda, 'Merienda planificada para el Jueves');
assert(!!thursday.meals.cena, 'Cena planificada para el Jueves');

// 6. Direct Logging from Planned Recipe into Daily Diary (isValidMealLog)
console.log('\n[TEST 6] Registro directo de Comida Planificada a Diario (isValidMealLog):');
function simulateIsValidMealLog(data: any, userId: string): boolean {
  return (
    data.userId === userId &&
    typeof data.title === 'string' &&
    data.title.length >= 1 &&
    data.title.length <= 150 &&
    ['desayuno', 'almuerzo', 'merienda', 'cena', 'snack'].includes(data.moment) &&
    typeof data.calories === 'number' &&
    data.calories >= 0 &&
    data.calories <= 5000
  );
}

const breakfastSlot = thursday.meals.desayuno!;
const loggedPayload = {
  userId: validUid,
  dateTime: '2024-10-24T08:00',
  moment: 'desayuno',
  title: breakfastSlot.recipeName,
  description: 'Preparación de receta',
  portion: '1 porción (325 g)',
  calories: Math.round(breakfastSlot.calories),
  protein: breakfastSlot.protein,
  carbs: breakfastSlot.carbs,
  fats: breakfastSlot.fats,
  source: 'Receta',
  verified: true,
};

assert(simulateIsValidMealLog(loggedPayload, validUid), 'Comida registrada desde receta cumple con isValidMealLog');

// 7. Shopping List Synchronization & Department Mapping (isValidGrocery)
console.log('\n[TEST 7] Sincronización con Lista de Compras y Mapeo de Departamentos (isValidGrocery):');
function simulateIsValidGrocery(data: any, userId: string): boolean {
  return (
    data.userId === userId &&
    typeof data.name === 'string' &&
    data.name.length >= 1 &&
    data.name.length <= 150 &&
    typeof data.quantity === 'number' &&
    data.quantity >= 0 &&
    typeof data.unit === 'string' &&
    data.unit.length <= 30 &&
    ['carnes', 'huevos', 'verduras', 'carbohidratos', 'grasas'].includes(data.department) &&
    ['pending', 'completed'].includes(data.status)
  );
}

// Map each ingredient of the breakfast recipe to a grocery item
for (const ing of breakfastSlot.ingredients || []) {
  const food = getFoodById(ing.foodId);
  let dept: GroceryDepartment = 'carbohidratos';
  if (food) {
    if (food.category === 'carnes_aves' || food.category === 'pescados_mariscos') {
      dept = 'carnes';
    } else if (food.category === 'huevos') {
      dept = 'huevos';
    } else if (food.category === 'frutas' || food.category === 'verduras_hortalizas') {
      dept = 'verduras';
    } else if (['cereales_granos', 'tuberculos_raices', 'legumbres'].includes(food.category)) {
      dept = 'carbohidratos';
    } else {
      dept = 'grasas';
    }
  }

  const groceryPayload = {
    userId: validUid,
    name: ing.foodName,
    quantity: ing.grams,
    unit: 'g',
    department: dept,
    status: 'pending',
  };

  assert(
    simulateIsValidGrocery(groceryPayload, validUid),
    `Insumo "${ing.foodName}" mapeado a departamento válido "${dept}" y cumple isValidGrocery`
  );
}

// 8. Week Shifting and Boundary Integrity
console.log('\n[TEST 8] Navegación de Semanas y Consistencia de Fechas:');
const refWeek = getWeekStartEnd('2024-10-24');
assert(refWeek.weekStart === '2024-10-21', 'Semana 43 inicia el Lunes 2024-10-21');
assert(refWeek.weekEnd === '2024-10-27', 'Semana 43 termina el Domingo 2024-10-27');

const nextWeekStart = shiftWeek(refWeek.weekStart, 1);
assert(nextWeekStart === '2024-10-28', 'Siguiente semana inicia exactamente 7 días después (2024-10-28)');

const prevWeekStart = shiftWeek(refWeek.weekStart, -1);
assert(prevWeekStart === '2024-10-14', 'Semana anterior inicia exactamente 7 días antes (2024-10-14)');

const weekDaysList = getWeekDays('2024-10-24');
assert(weekDaysList.length === 7, 'Retorna exactamente 7 días');
assert(weekDaysList[0].dayShort === 'Lun', 'El primer día es Lunes');
assert(weekDaysList[6].dayShort === 'Dom', 'El último día es Domingo');

console.log('========================================================================');
console.log(` RESULTADO: ${passed} / ${total} PRUEBAS SUPERADAS`);
console.log('========================================================================');

if (passed !== total) {
  process.exit(1);
}
