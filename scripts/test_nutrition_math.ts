import { NUTRITION_CATALOG, NUTRITION_CATALOG_BY_ID } from '../src/data/nutritionCatalog';
import {
  calculateNutrients,
  calculatePortionNutrients,
  formatNutrientValue,
  getAllFoods,
  getFoodById,
  getFoodOrThrow,
  roundNutrients,
  searchFoods,
  sumNutrients,
  validateFoodNutrients,
  validateGrams,
} from '../src/services/nutritionMath';
import { FoodItem } from '../src/types/nutrition';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ [FAIL] ${testName}`);
    if (detail) console.error(`     Detalle: ${detail}`);
    process.exitCode = 1;
  } else {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  }
}

function assertThrows(fn: () => void, testName: string, expectedMsgSubstring?: string) {
  totalTests++;
  try {
    fn();
    console.error(`  ❌ [FAIL] ${testName}: Se esperaba que lanzara error pero no lanzó.`);
    process.exitCode = 1;
  } catch (err: any) {
    if (expectedMsgSubstring && !err.message.includes(expectedMsgSubstring)) {
      console.error(
        `  ❌ [FAIL] ${testName}: Mensaje de error no contiene '${expectedMsgSubstring}'. Recibido: ${err.message}`
      );
      process.exitCode = 1;
    } else {
      passedTests++;
      console.log(`  ✅ [PASS] ${testName} (Lanzó: "${err.message}")`);
    }
  }
}

function closeTo(actual: number, expected: number, epsilon = 0.0001): boolean {
  return Math.abs(actual - expected) <= epsilon;
}

console.log('========================================================================');
console.log(' SUITE DE PRUEBAS DE INTEGRIDAD Y MOTOR MATEMÁTICO — VIGORCORE');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// BLOQUE 1: Integridad Estructural y Auditoría Metadatos FDC
// -----------------------------------------------------------------------------
console.log('[BLOQUE 1] Integridad Estructural y Auditoría de Metadatos FDC:');

assert(
  NUTRITION_CATALOG.length === 37,
  `Catálogo auditado contiene exactamente 37 registros únicos normalizados (obtenidos: ${NUTRITION_CATALOG.length})`
);

// Detección de duplicados
const seenIds = new Set<string>();
const seenFdcIds = new Set<number>();
let duplicateId = false;

for (const food of NUTRITION_CATALOG) {
  if (seenIds.has(food.id)) {
    duplicateId = true;
    break;
  }
  seenIds.add(food.id);
  seenFdcIds.add(food.source.fdcId);
}

assert(!duplicateId, 'No existen identificadores (IDs) de cadena duplicados en el catálogo');
assert(
  NUTRITION_CATALOG_BY_ID.size === NUTRITION_CATALOG.length,
  'El índice Map O(1) por ID tiene exactamente 37 entradas'
);

// Verificación exhaustiva de metadatos por cada alimento
for (const food of NUTRITION_CATALOG) {
  assert(food.id.startsWith('usda-'), `El ID inicia con prefijo 'usda-' (${food.id})`);
  assert(food.id.includes(String(food.source.fdcId)), `El ID contiene el FDC ID oficial (${food.id} incluye ${food.source.fdcId})`);
  assert(food.name.length >= 5, `Nombre en español descriptivo (${food.name})`);
  assert(food.servingUnit === 'g', `Unidad de referencia fija en 'g' (${food.id})`);
  assert(food.referenceGrams === 100, `Base fija en 100 g (${food.id})`);
  assert(validateFoodNutrients(food), `Nutrientes válidos y no negativos (${food.id})`);

  // Restricción física de conservación de masa:
  const macroSum = food.proteinPer100g + food.carbsPer100g + food.fatsPer100g;
  assert(
    macroSum <= 100.5,
    `Coherencia biofísica: suma de macronutrientes <= 100 g (${food.id}: ${macroSum.toFixed(2)} g)`
  );

  // Verificación de datasets válidos de FoodData Central
  const validDatasets = ['SR Legacy', 'Foundation Foods', 'Survey (FNDDS)'];
  assert(
    validDatasets.includes(food.source.dataset),
    `Dataset USDA oficial reconocido: ${food.source.dataset} (${food.id})`
  );
  assert(
    food.source.provider === 'USDA FoodData Central',
    `Proveedor USDA FoodData Central certificado (${food.id})`
  );
  assert(
    food.source.sourceUrl.includes(String(food.source.fdcId)),
    `URL de FoodData Central enlaza al FDC ID específico (${food.source.sourceUrl})`
  );
  assert(
    food.source.foodDescriptionEn.length > 3,
    `Descripción original en inglés de la fuente conservada (${food.source.foodDescriptionEn})`
  );
  assert(food.tags.length >= 2, `Alimento tiene etiquetas de búsqueda contextuales (${food.id})`);
  assert(food.commonPortions.length >= 1, `Alimento tiene al menos una porción de uso común (${food.id})`);

  for (const portion of food.commonPortions) {
    assert(portion.grams > 0, `Porción '${portion.name}' tiene gramos positivos (${portion.grams} g)`);
  }
}

// -----------------------------------------------------------------------------
// BLOQUE 2: Auditoría Específica de Casos Crudo vs. Cocido
// -----------------------------------------------------------------------------
console.log('\n[BLOQUE 2] Auditoría Específica de Aislamiento Crudo vs. Cocido:');

// Caso Pollo: FDC 171077 (crudo) vs. FDC 171477 (asado)
const pechugaAsada = getFoodOrThrow('usda-171477-pechuga-pollo-asada');
const pechugaCruda = getFoodOrThrow('usda-171077-pechuga-pollo-cruda');

assert(
  pechugaAsada.source.fdcId === 171477 && pechugaAsada.state === 'asado_plancha',
  'Pechuga asada utiliza el FDC ID 171477 verificado de USDA SR Legacy'
);
assert(
  pechugaCruda.source.fdcId === 171077 && pechugaCruda.state === 'crudo',
  'Pechuga cruda utiliza el FDC ID 171077 verificado de USDA SR Legacy'
);
assert(
  pechugaAsada.proteinPer100g === 31.02 && pechugaCruda.proteinPer100g === 22.5,
  'Diferencia biológica por pérdida de agua en cocción: 31.02 g (asada) vs. 22.50 g (cruda)'
);

// Caso Huevo Entero: FDC 171287 (crudo) vs. FDC 173424 (cocido duro)
const huevoCrudo = getFoodOrThrow('usda-171287-huevo-entero-crudo');
const huevoCocido = getFoodOrThrow('usda-173424-huevo-entero-cocido');
assert(
  huevoCrudo.source.fdcId === 171287 && huevoCocido.source.fdcId === 173424,
  'Huevos crudo (171287) y cocido (173424) utilizan registros independientes de laboratorio'
);

// Caso Claras: FDC 172183 (cruda pasteurizada) vs. FDC 2707169 (cocida)
const claraCruda = getFoodOrThrow('usda-172183-clara-de-huevo-cruda');
const claraCocida = getFoodOrThrow('usda-2707169-clara-de-huevo-cocida');
assert(
  claraCruda.source.fdcId === 172183 && claraCocida.source.fdcId === 2707169,
  'Clara cruda (SR Legacy 172183) y clara cocida (FNDDS 2707169) auditadas sin confusión con yema'
);

// Caso Fríjoles: FDC 175194 (cocidos sin sal)
const frijolesRojos = getFoodOrThrow('usda-175194-frijoles-rojos-cargamanto-cocidos');
assert(
  frijolesRojos.source.fdcId === 175194 && frijolesRojos.state === 'cocido',
  'Fríjoles rojos cargamanto cocidos utilizan FDC ID 175194 (cocidos, no el ID de semillas crudas)'
);

// Caso Papa: FDC 170520 (hervida sin piel)
const papaHervida = getFoodOrThrow('usda-170520-papa-hervida-sin-piel');
assert(
  papaHervida.source.fdcId === 170520 && papaHervida.state === 'hervido',
  'Papa hervida sin piel utiliza FDC ID 170520 verificado de USDA SR Legacy'
);

// Caso Mantequilla de Maní: FDC 172470 (sin sal)
const mantMani = getFoodOrThrow('usda-172470-mantequilla-mani-natural');
assert(
  mantMani.source.fdcId === 172470 && mantMani.source.foodDescriptionEn.includes('without salt'),
  'Mantequilla de maní utiliza FDC ID 172470 (smooth style, without salt)'
);

// -----------------------------------------------------------------------------
// BLOQUE 3: Motor Matemático — Sin Factores Genéricos de Cocción
// -----------------------------------------------------------------------------
console.log('\n[BLOQUE 3] Comprobación de Cálculos Matemáticos Puros:');

// Verificación de que nutritionMath no aplica conversiones genéricas:
// Si calculamos 100g de pechuga cruda, produce EXACTAMENTE los nutrientes de pechuga cruda.
const mathPechugaCruda = calculateNutrients(pechugaCruda, 100);
assert(
  mathPechugaCruda.calories === 120 && mathPechugaCruda.protein === 22.5,
  'Cálculo de pechuga cruda (100g) devuelve directamente sus valores sin multiplicador'
);

const mathPechugaAsada = calculateNutrients(pechugaAsada, 100);
assert(
  mathPechugaAsada.calories === 165 && mathPechugaAsada.protein === 31.02,
  'Cálculo de pechuga asada (100g) devuelve directamente sus valores analíticos oficiales'
);

// Caso manual obligatorio:
// "si un alimento tiene 30 g de proteína por 100 g, una cantidad de 150 g debe producir 45 g de proteína"
const dummyFood: FoodItem = {
  id: 'test-30g-proteina',
  name: 'Alimento de prueba manual 30g proteína',
  category: 'suplementos',
  state: 'seco',
  servingUnit: 'g',
  referenceGrams: 100,
  caloriesPer100g: 200,
  proteinPer100g: 30,
  carbsPer100g: 10,
  fatsPer100g: 4,
  fiberPer100g: 2,
  source: {
    provider: 'USDA FoodData Central',
    fdcId: 999999,
    dataset: 'SR Legacy',
    foodDescriptionEn: 'Test dummy food for manual calculation',
    sourceUrl: 'https://fdc.nal.usda.gov',
    version: '1.0',
  },
  commonPortions: [{ name: 'Porción estándar', grams: 150 }],
  tags: ['test'],
};

const calc150g = calculateNutrients(dummyFood, 150);
assert(
  closeTo(calc150g.protein, 45.0),
  'Caso manual: 30 g de proteína/100 g en 150 g produce exactamente 45.0 g de proteína'
);
assert(
  closeTo(calc150g.calories, 300.0),
  'Caso manual: 200 kcal/100 g en 150 g produce exactamente 300.0 kcal'
);

// Verificación de porción de pechuga asada para 180 g
const portionPollo = calculatePortionNutrients('usda-171477-pechuga-pollo-asada', 180);
assert(
  closeTo(portionPollo.nutrients.calories, 165 * 1.8),
  `Pechuga asada (180 g): ${(165 * 1.8).toFixed(1)} kcal verificadas`
);
assert(
  closeTo(portionPollo.nutrients.protein, 31.02 * 1.8),
  `Pechuga asada (180 g): ${(31.02 * 1.8).toFixed(2)} g proteína verificadas`
);
assert(
  portionPollo.sourceFdcId === 171477,
  'calculatedPortion conserva el FDC ID verificado 171477'
);

// Plato compuesto:
const arroz = getFoodOrThrow('usda-168878-arroz-blanco-cocido');
const aceite = getFoodOrThrow('usda-171413-aceite-oliva-virgen-extra');
const brocoli = getFoodOrThrow('usda-170380-brocoli-cocido-al-vapor');

const totalPlato = sumNutrients([
  portionPollo.nutrients,
  calculateNutrients(arroz, 150),
  calculateNutrients(aceite, 10),
  calculateNutrients(brocoli, 100),
]);

// 180g Pollo (165*1.8=297 kcal, 55.836g P, 6.426g G)
// 150g Arroz (130*1.5=195 kcal, 4.035g P, 42.255g C, 0.42g G, 0.6g Fibra)
// 10g Aceite (884*0.1=88.4 kcal, 10g G)
// 100g Brócoli (35 kcal, 2.38g P, 7.18g C, 0.41g G, 3.3g Fibra)
// Totales:
// kcal = 297 + 195 + 88.4 + 35 = 615.4 kcal
// P = 55.836 + 4.035 + 0 + 2.38 = 62.251 g
// C = 0 + 42.255 + 0 + 7.18 = 49.435 g
// G = 6.426 + 0.42 + 10 + 0.41 = 17.256 g
// Fibra = 0 + 0.6 + 0 + 3.3 = 3.9 g
assert(closeTo(totalPlato.calories, 615.4), 'Calorías totales del plato compuesto: 615.4 kcal');
assert(closeTo(totalPlato.protein, 62.251), 'Proteína total del plato compuesto: 62.25 g');
assert(closeTo(totalPlato.carbs, 49.435), 'Carbohidratos totales: 49.44 g');
assert(closeTo(totalPlato.fats, 17.256), 'Grasas totales: 17.26 g');
assert(closeTo(totalPlato.fiber, 3.9), 'Fibra total: 3.90 g');

// -----------------------------------------------------------------------------
// BLOQUE 4: Manejo de Excepciones y Entradas Inválidas
// -----------------------------------------------------------------------------
console.log('\n[BLOQUE 4] Gestión de Errores y Validaciones:');

assertThrows(
  () => validateGrams(-10),
  'validateGrams rechaza gramos negativos (-10)',
  'negativa no permitida'
);
assertThrows(
  () => validateGrams(NaN),
  'validateGrams rechaza NaN',
  'se esperaba un número finito'
);
assertThrows(
  () => validateGrams(Infinity),
  'validateGrams rechaza Infinity',
  'se esperaba un número finito'
);
assertThrows(
  () => validateGrams('100' as any),
  'validateGrams rechaza string numérico',
  'se esperaba un número finito'
);
assertThrows(
  () => getFoodOrThrow('id-inexistente-xyz'),
  'getFoodOrThrow rechaza ID no registrado en catálogo',
  'Alimento no encontrado en el catálogo oficial'
);

const rounded = roundNutrients(totalPlato, 1);
assert(rounded.calories === 615.4, 'roundNutrients redondea calorías');
assert(rounded.protein === 62.3, 'roundNutrients redondea proteína (62.251 -> 62.3)');
assert(formatNutrientValue(rounded.protein, 1, 'g') === '62.3 g', 'formatNutrientValue produce texto formateado');

console.log('\n========================================================================');
console.log(` RESULTADO: ${passedTests} / ${totalTests} PRUEBAS SUPERADAS`);
console.log('========================================================================\n');

if (passedTests === totalTests) {
  console.log('🎉 [ÉXITO TOTAL] Catálogo Auditado y Motor Matemático 100% Verificado.');
  process.exit(0);
} else {
  console.error('❌ [FALLO] Algunas pruebas de auditoría no superaron la verificación.');
  process.exit(1);
}
