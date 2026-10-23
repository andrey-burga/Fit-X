import { NUTRITION_CATALOG } from '../src/data/nutritionCatalog';
import { calculateNutrients, roundNutrients, searchFoods } from '../src/services/nutritionMath';
import { MealLogItem, MealMoment } from '../src/types';

let passed = 0;
let total = 0;

function assert(cond: boolean, name: string, detail?: string) {
  total++;
  if (!cond) {
    console.error(`❌ [FAIL] ${name}`);
    if (detail) console.error(`   Detalle: ${detail}`);
    process.exitCode = 1;
  } else {
    passed++;
    console.log(`✅ [PASS] ${name}`);
  }
}

console.log('========================================================================');
console.log(' TEST DE INTEGRACIÓN INCREMENTO 2: REGISTER MEAL DRAWER & NUTRITION ENGINE');
console.log('========================================================================\n');

// 1. Simulación de búsqueda en catálogo
const chickenResults = searchFoods('pechuga');
assert(chickenResults.length >= 2, 'Búsqueda por texto "pechuga" retorna opciones crudas y asadas');
const asada = chickenResults.find(f => f.state === 'asado_plancha');
assert(asada !== undefined, 'Encuentra pechuga asada en resultados');
assert(asada?.source.fdcId === 171477, 'FDC ID verificado coincide con 171477');

// 2. Simulación de cálculo en vivo para 180g de pechuga asada
if (asada) {
  const macros = roundNutrients(calculateNutrients(asada, 180), 1);
  assert(macros.calories === 297, `Calorías exactas esperadas 297, obtenido: ${macros.calories}`);
  assert(macros.protein === 55.8, `Proteína exacta esperada 55.8g, obtenido: ${macros.protein}`);
  assert(macros.fats === 6.4, `Grasas exactas esperadas 6.4g, obtenido: ${macros.fats}`);
  assert(macros.carbs === 0, `Carbohidratos 0g, obtenido: ${macros.carbs}`);

  // 3. Simulación de payload generado por RegisterMealDrawer
  const testPayload: Omit<MealLogItem, 'id'> = {
    dateTime: '2024-10-24T13:45',
    moment: 'almuerzo' as MealMoment,
    title: asada.name,
    description: `180g - ${asada.name} (${asada.state}) [USDA FDC ${asada.source.fdcId}]`,
    portion: '180 g',
    calories: macros.calories,
    protein: macros.protein,
    carbs: macros.carbs,
    fats: macros.fats,
    source: 'Manual',
    verified: true,
    foodId: asada.id,
    foodFdcId: asada.source.fdcId,
    grams: 180,
    fiber: macros.fiber,
  };

  // 4. Verificación de reglas de validación Firestore (isValidMealLog)
  const isValidMealLogRule = (data: any, userId: string): boolean => {
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
  };

  const simulatedFirestoreDoc = {
    ...testPayload,
    userId: 'user-test-123',
    createdAt: new Date().toISOString(),
  };

  assert(
    isValidMealLogRule(simulatedFirestoreDoc, 'user-test-123'),
    'El payload cumple estrictamente la regla isValidMealLog de Firestore'
  );
  assert(testPayload.title.length <= 150, 'El título no excede los 150 caracteres exigidos por Firestore');
  assert(testPayload.calories <= 5000, 'Las calorías están dentro del rango permitido por Firestore (<= 5000)');
  assert(testPayload.foodFdcId === 171477, 'Conserva el FDC ID para auditoría futura');
  assert(testPayload.fiber === 0, 'La fibra es calculada numéricamente sin NaN');
}

// 5. Verificación de porciones sugeridas
const huevoDuro = NUTRITION_CATALOG.find(f => f.id === 'usda-173424-huevo-entero-cocido');
assert(huevoDuro !== undefined, 'Encuentra huevo duro');
if (huevoDuro && huevoDuro.commonPortions.length > 0) {
  const portion1 = huevoDuro.commonPortions[0]; // 50g
  const eggMacros = roundNutrients(calculateNutrients(huevoDuro, portion1.grams), 1);
  assert(eggMacros.calories === 77.5, `Huevo 50g calorías esperadas 77.5 kcal, obtenido: ${eggMacros.calories}`);
  assert(eggMacros.protein === 6.3, `Huevo 50g proteína esperada 6.3g, obtenido: ${eggMacros.protein}`);
}

console.log(`\n========================================================================`);
console.log(` RESULTADO: ${passed} / ${total} PRUEBAS SUPERADAS`);
console.log(`========================================================================`);
