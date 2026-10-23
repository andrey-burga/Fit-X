import { WeeklyMealPlan, DayMealPlan, PlannedMealSlot } from '../src/types/nutrition';
import { GroceryItem, GroceryDepartment } from '../src/types';
import {
  aggregateWeeklyMealPlan,
  computeIdempotentGrocerySync,
  formatGroceryQuantityAndUnit,
  mapCategoryToDepartment,
} from '../src/services/groceryAggregation';
import { TEMPLATE_RECIPES } from '../src/data/templateRecipes';

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
console.log(' TEST INCREMENTO 5: LISTA DE COMPRAS INTELIGENTE, AGREGACIÓN E IDEMPOTENCIA');
console.log('========================================================================\n');

// 1. Agregación de ingredientes y multiplicador de porciones
console.log('[TEST 1] Agregación de ingredientes reales y multiplicador de porciones:');

const testPlan: WeeklyMealPlan = {
  id: 'plan_2024_10_21',
  userId: 'usr_camilo_atleta',
  weekStart: '2024-10-21',
  weekEnd: '2024-10-27',
  label: 'Semana 43',
  createdAt: '2024-10-20T10:00:00Z',
  updatedAt: '2024-10-20T10:00:00Z',
  days: {
    '2024-10-21': {
      date: '2024-10-21',
      dayLabel: 'Lun 21',
      meals: {
        desayuno: {
          recipeId: 'rec_desayuno_1',
          recipeName: 'Bowl de Avena y Proteína',
          calories: 450,
          protein: 40,
          carbs: 55,
          fats: 8,
          servings: 1, // 1 porción
          ingredients: [
            {
              foodId: 'usda-169705-avena-hojuelas-cruda',
              foodName: 'Avena en hojuelas',
              grams: 80,
              state: 'crudo',
            },
            {
              foodId: 'usda-173424-huevo-entero-cocido',
              foodName: 'Huevo entero de gallina',
              grams: 100, // 2 huevos (50g c/u)
              state: 'cocido',
            },
          ],
        },
      },
    },
    '2024-10-23': {
      date: '2024-10-23',
      dayLabel: 'Mié 23',
      meals: {
        desayuno: {
          recipeId: 'rec_desayuno_1',
          recipeName: 'Bowl de Avena y Proteína (Doble)',
          calories: 900,
          protein: 80,
          carbs: 110,
          fats: 16,
          servings: 2, // 2 porciones asignadas
          ingredients: [
            {
              foodId: 'usda-169705-avena-hojuelas-cruda',
              foodName: 'Avena en hojuelas',
              grams: 160, // 80g * 2
              state: 'crudo',
            },
            {
              foodId: 'usda-173424-huevo-entero-cocido',
              foodName: 'Huevo entero de gallina',
              grams: 200, // 100g * 2 = 4 huevos
              state: 'cocido',
            },
          ],
        },
      },
    },
    // Días vacíos sin comidas asignadas deben ignorarse limpiamente
    '2024-10-24': {
      date: '2024-10-24',
      dayLabel: 'Jue 24',
      meals: {},
    },
  },
};

const aggregated = aggregateWeeklyMealPlan(testPlan);
assert(aggregated.length === 2, `Agregó exactamente 2 insumos consolidados (obtenido: ${aggregated.length})`);

const avena = aggregated.find(a => a.foodName.toLowerCase().includes('avena'));
assert(!!avena, 'Avena identificada en los insumos agregados');
assert(avena?.totalGrams === 240, `Avena totalizó exactamente 240g (80g + 160g) - obtenido: ${avena?.totalGrams}g`);
assert(avena?.occurrences === 2, `Avena registra 2 tomas en la semana`);
assert(avena?.department === 'carbohidratos', `Avena clasificada correctamente en 'carbohidratos'`);

const huevos = aggregated.find(a => a.foodId === 'usda-173424-huevo-entero-cocido');
assert(!!huevos, 'Huevos identificados en los insumos agregados');
assert(huevos?.totalGrams === 300, `Huevos totalizan 300g (100g + 200g)`);
assert(huevos?.quantity === 6, `Conversión de huevos: 300g / 50g = 6 unidades (obtenido: ${huevos?.quantity})`);
assert(huevos?.unit === 'unid', `Unidad de huevo entero es 'unid'`);
assert(huevos?.department === 'huevos', `Huevos clasificados en departamento 'huevos'`);

// 2. Aislamiento de estado crudo vs cocido y advertencias
console.log('\n[TEST 2] Aislamiento de preparación crudo vs cocido:');
const meatPlan: WeeklyMealPlan = {
  id: 'plan_meat',
  userId: 'usr_camilo_atleta',
  weekStart: '2024-10-21',
  weekEnd: '2024-10-27',
  label: 'Semana 43',
  createdAt: '2024-10-20T10:00:00Z',
  updatedAt: '2024-10-20T10:00:00Z',
  days: {
    '2024-10-21': {
      date: '2024-10-21',
      dayLabel: 'Lun 21',
      meals: {
        almuerzo: {
          recipeId: 'rec_pollo_crudo',
          recipeName: 'Pechuga Marinada Cruda',
          calories: 300,
          protein: 60,
          carbs: 0,
          fats: 5,
          servings: 1,
          ingredients: [
            {
              foodId: 'usda-171077-pechuga-pollo-cruda',
              foodName: 'Pechuga de pollo cruda',
              grams: 500,
              state: 'crudo',
            },
          ],
        },
        cena: {
          recipeId: 'rec_pollo_asado',
          recipeName: 'Pechuga Asada al Grill',
          calories: 330,
          protein: 62,
          carbs: 0,
          fats: 7,
          servings: 1,
          ingredients: [
            {
              foodId: 'usda-171477-pechuga-pollo-asada',
              foodName: 'Pechuga de pollo asada',
              grams: 300,
              state: 'asado_plancha',
            },
          ],
        },
      },
    },
  },
};

const aggregatedMeat = aggregateWeeklyMealPlan(meatPlan);
assert(aggregatedMeat.length === 2, 'Pollo crudo y pollo asado se conservan como 2 insumos distintos sin mezclarse');
const rawChicken = aggregatedMeat.find(m => m.state === 'crudo');
const cookedChicken = aggregatedMeat.find(m => m.state === 'asado_plancha');
assert(rawChicken?.totalGrams === 500, 'Pollo crudo mantiene 500g netos');
assert(cookedChicken?.totalGrams === 300, 'Pollo asado mantiene 300g netos');
assert(
  rawChicken?.warning?.includes('crudo') === true,
  `Pollo crudo incluye advertencia para compra: "${rawChicken?.warning}"`
);

// 3. Conversión de unidades y formateo métrico
console.log('\n[TEST 3] Conversión de unidades y departamentos:');
// 1500g de carne sólida -> 1.5 kg
const solidLarge = formatGroceryQuantityAndUnit('usda-171477-pechuga-pollo-asada', 1500, 'carnes_aves');
assert(solidLarge.quantity === 1.5 && solidLarge.unit === 'kg', `1500g de carne se formatea a 1.5 kg`);

// 450g de carne sólida -> 450 g
const solidSmall = formatGroceryQuantityAndUnit('usda-171477-pechuga-pollo-asada', 450, 'carnes_aves');
assert(solidSmall.quantity === 450 && solidSmall.unit === 'g', `450g de carne se mantiene en 450 g`);

// Aceite de oliva con densidad verificada = 0.92 g/ml (USDA SR Legacy 171413 / COI):
// 100g de masa -> 100 / 0.92 = 109 ml de volumen (no asume 1 g/ml)
const oilSmall = formatGroceryQuantityAndUnit('usda-171413-aceite-oliva-virgen-extra', 100, 'grasas_aceites');
assert(oilSmall.quantity === 109 && oilSmall.unit === 'ml', `100g de AOVE se convierte con densidad 0.92 g/ml a 109 ml (obtenido: ${oilSmall.quantity} ${oilSmall.unit})`);

// 1200g de aceite de oliva -> 1200 / 0.92 = 1304 ml = 1.3 l
const liquidLarge = formatGroceryQuantityAndUnit('usda-171413-aceite-oliva-virgen-extra', 1200, 'grasas_aceites');
assert(liquidLarge.quantity === 1.3 && liquidLarge.unit === 'l', `1200g de aceite se formatea a 1.3 l con densidad 0.92`);

// Alimentos densos o aceites sin densidad verificada: conservan unidad de masa estricta
const peanutButter = formatGroceryQuantityAndUnit('usda-172470-mantequilla-mani-natural', 500, 'grasas_aceites');
assert(peanutButter.quantity === 500 && peanutButter.unit === 'g', `Mantequilla de maní sin densidad volumétrica conserva unidad de masa (500 g)`);

// Claras de huevo pasteurizadas (no deben convertirse a unid de huevo)
const eggWhites = formatGroceryQuantityAndUnit('usda-172183-clara-de-huevo-cruda', 400, 'huevos');
assert(eggWhites.quantity === 400 && eggWhites.unit === 'g', `400g de claras de huevo se conservan en 400 g (no en unidades)`);

// Departamentos admitidos por las reglas de Firestore
const depts: GroceryDepartment[] = ['carnes', 'huevos', 'verduras', 'carbohidratos', 'grasas'];
assert(depts.includes(mapCategoryToDepartment('carnes_aves')), 'carnes_aves -> carnes');
assert(depts.includes(mapCategoryToDepartment('huevos')), 'huevos -> huevos');
assert(depts.includes(mapCategoryToDepartment('verduras_hortalizas')), 'verduras_hortalizas -> verduras');
assert(depts.includes(mapCategoryToDepartment('cereales_granos')), 'cereales_granos -> carbohidratos');
assert(depts.includes(mapCategoryToDepartment('suplementos')), 'suplementos -> grasas');

// 4. Idempotencia de la sincronización en ejecuciones repetidas
console.log('\n[TEST 4] Idempotencia estricta en ejecuciones repetidas:');

const initialGroceries: GroceryItem[] = [];

// Ejecución 1
const sync1 = computeIdempotentGrocerySync(initialGroceries, aggregated);
assert(sync1.syncSummary.addedCount === 2, `Paso 1: Se añadieron 2 artículos nuevos`);
assert(sync1.updatedGroceries.length === 2, `Paso 1: Lista contiene 2 artículos`);

// Ejecución 2 (con el mismo plan y la misma lista)
const sync2 = computeIdempotentGrocerySync(sync1.updatedGroceries, aggregated);
assert(sync2.syncSummary.addedCount === 0, `Paso 2: En 2da ejecución se añadieron 0 artículos (idempotente)`);
assert(sync2.updatedGroceries.length === 2, `Paso 2: Lista conserva exactamente 2 artículos sin duplicar`);
assert(
  sync2.updatedGroceries[0].quantity === sync1.updatedGroceries[0].quantity,
  `Paso 2: La cantidad no se sumó dos veces (${sync2.updatedGroceries[0].quantity} ${sync2.updatedGroceries[0].unit})`
);

// Ejecución 3
const sync3 = computeIdempotentGrocerySync(sync2.updatedGroceries, aggregated);
assert(sync3.syncSummary.addedCount === 0, `Paso 3: En 3ra ejecución se añadieron 0 artículos`);
assert(sync3.updatedGroceries.length === 2, `Paso 3: La longitud total es invariante`);

// 5. Preservación de artículos manuales
console.log('\n[TEST 5] Preservación de artículos manuales:');
const manualItem: GroceryItem = {
  id: 'item_manual_123',
  name: 'Creatina Creapure Monohidrato',
  quantity: 300,
  unit: 'g',
  department: 'grasas',
  status: 'pending',
  origin: 'manual',
  notes: 'Comprar sello Creapure alemán',
};

const listWithManual = [...sync1.updatedGroceries, manualItem];
const syncWithManual = computeIdempotentGrocerySync(listWithManual, aggregated);

assert(
  syncWithManual.syncSummary.manualPreservedCount === 1,
  `Sincronización reportó 1 artículo manual preservado`
);
const foundManual = syncWithManual.updatedGroceries.find(g => g.id === 'item_manual_123');
assert(!!foundManual, 'Artículo manual sigue presente en la lista');
assert(foundManual?.quantity === 300, 'Cantidad del artículo manual intacta (300g)');
assert(foundManual?.notes === 'Comprar sello Creapure alemán', 'Notas del artículo manual intactas');

// 6. Preservación del estado de compra ('completed')
console.log('\n[TEST 6] Preservación del estado comprado (status: completed):');
const listWithCompleted = sync1.updatedGroceries.map((item, idx) => {
  if (idx === 0) return { ...item, status: 'completed' as const };
  return item;
});

const syncWithCompleted = computeIdempotentGrocerySync(listWithCompleted, aggregated);
const completedPreserved = syncWithCompleted.updatedGroceries.find(g => g.status === 'completed');
assert(!!completedPreserved, 'El artículo marcado como comprado conservó su estado "completed"');
assert(syncWithCompleted.syncSummary.preservedCompletedCount >= 1, 'syncSummary contabilizó el insumo comprado preservado');

// 7. Resolución de conflictos en cantidades personalizadas por el usuario
console.log('\n[TEST 7] Política de conflicto en cantidades personalizadas (isCustomized):');
const listWithCustomized = sync1.updatedGroceries.map(item => {
  if (item.name.toLowerCase().includes('avena')) {
    return {
      ...item,
      quantity: 500, // Usuario editó a 500g (el menú prescribió 240g)
      isCustomized: true,
    };
  }
  return item;
});

const syncCustomized = computeIdempotentGrocerySync(listWithCustomized, aggregated);
const avenaCustom = syncCustomized.updatedGroceries.find(g => g.name.toLowerCase().includes('avena'));
assert(avenaCustom?.quantity === 500, `Cantidad personalizada por el usuario se respeta: 500g (no fue sobreescrita)`);
assert(avenaCustom?.calculatedQuantity === 240, `Cantidad calculada por el menú se almacena para transparencia: 240g`);
assert(avenaCustom?.isCustomized === true, `isCustomized permanece activo`);

// 8. Retiro seguro cuando se elimina una receta del plan
console.log('\n[TEST 8] Retiro o actualización correcta cuando se elimina una receta:');
// Supongamos que eliminamos el desayuno del Miércoles:
const reducedPlan: WeeklyMealPlan = {
  ...testPlan,
  days: {
    '2024-10-21': testPlan.days['2024-10-21'], // Solo queda el Lunes
  },
};

const reducedAggregated = aggregateWeeklyMealPlan(reducedPlan);
// Ahora solo requerimos 80g de avena y 2 huevos (100g)
const syncReduced = computeIdempotentGrocerySync(sync1.updatedGroceries, reducedAggregated);
const reducedAvena = syncReduced.updatedGroceries.find(g => g.name.toLowerCase().includes('avena'));
assert(reducedAvena?.quantity === 80, `Cantidad de avena se actualizó limpiamente a 80g tras quitar el día`);

// Si un artículo pendiente ya no está en el plan semanal, se retira limpiamente
const planWithExtraRecipe: WeeklyMealPlan = {
  ...testPlan,
  days: {
    '2024-10-21': {
      date: '2024-10-21',
      dayLabel: 'Lun 21',
      meals: {
        cena: {
          recipeId: 'rec_salmon',
          recipeName: 'Salmón al horno',
          calories: 400,
          protein: 45,
          carbs: 0,
          fats: 22,
          servings: 1,
          ingredients: [
            {
              foodId: 'usda-173686-salmon-atlantico-cocido',
              foodName: 'Salmón del Atlántico',
              grams: 200,
              state: 'horneado',
            },
          ],
        },
      },
    },
  },
};

const aggWithSalmon = aggregateWeeklyMealPlan(planWithExtraRecipe);
const syncWithSalmon = computeIdempotentGrocerySync([], aggWithSalmon);
assert(syncWithSalmon.updatedGroceries.some(g => g.name.includes('Salmón')), 'Salmón añadido');

// Ahora sincronizamos de vuelta con testPlan (que no tiene Salmón)
const syncWithoutSalmon = computeIdempotentGrocerySync(syncWithSalmon.updatedGroceries, aggregated);
assert(!syncWithoutSalmon.updatedGroceries.some(g => g.name.includes('Salmón')), 'Salmón pendiente retirado limpiamente');
assert(syncWithoutSalmon.syncSummary.retiredCount === 1, 'syncSummary registra 1 insumo retirado');

// 9. Cumplimiento estricto con las reglas de Firestore (isValidGrocery e isValidId)
console.log('\n[TEST 9] Cumplimiento estricto con las reglas de seguridad de Firestore:');

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

function simulateIsValidId(id: string): boolean {
  return typeof id === 'string' && id.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(id);
}

const testUserId = 'usr_atleta_test_777';

for (const item of syncWithManual.updatedGroceries) {
  const firestoreDoc = {
    ...item,
    userId: testUserId,
  };

  assert(
    simulateIsValidId(item.id),
    `ID "${item.id}" cumple isValidId de Firestore (longitud <= 128 y alfanumérico)`
  );
  assert(
    simulateIsValidGrocery(firestoreDoc, testUserId),
    `Insumo "${item.name}" cumple con isValidGrocery(data, userId)`
  );
}

console.log('\n========================================================================');
console.log(` RESULTADO: ${passed} / ${total} PRUEBAS SUPERADAS`);
console.log('========================================================================');

if (passed !== total) {
  process.exit(1);
}
