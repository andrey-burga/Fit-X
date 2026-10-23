import {
  getLocalDateString,
  getTodayLocalDateString,
  formatSpanishDate,
  formatTimeOnly,
  getChartDayBuckets,
} from '../src/services/dateUtils';
import { MealLogItem, MealMoment } from '../src/types';

let passed = 0;
let total = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  total++;
  if (!condition) {
    console.error(`  ❌ [FAIL] ${testName}`);
    if (detail) console.error(`     Detalle: ${detail}`);
    process.exitCode = 1;
  } else {
    passed++;
    console.log(`  ✅ [PASS] ${testName}`);
  }
}

console.log('========================================================================');
console.log(' TEST INCREMENTO 3: DASHBOARD DINÁMICO, FECHAS LOCALES Y AGREGACIONES');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// BLOQUE 1: Extracción de fecha local sin corrimiento UTC
// -----------------------------------------------------------------------------
assert(
  getLocalDateString('2024-10-24T23:45') === '2024-10-24',
  'datetime-local a las 23:45 no se desplaza al día siguiente por UTC'
);
assert(
  getLocalDateString('2024-10-24T00:15') === '2024-10-24',
  'datetime-local a las 00:15 no se desplaza al día anterior por UTC'
);
assert(
  getLocalDateString('2024-10-24') === '2024-10-24',
  'Formato YYYY-MM-DD se conserva intacto'
);
assert(
  formatTimeOnly('2024-10-24T08:15') === '08:15 AM',
  'formatTimeOnly extrae 08:15 AM'
);
assert(
  formatTimeOnly('2024-10-24T13:30') === '01:30 PM',
  'formatTimeOnly extrae 01:30 PM'
);

// -----------------------------------------------------------------------------
// BLOQUE 2: Rangos de gráfico semanal y 14 días
// -----------------------------------------------------------------------------
const weekBuckets = getChartDayBuckets('2024-10-24', 'week');
assert(weekBuckets.length === 7, 'Rango "week" retorna exactamente 7 días');
assert(weekBuckets[0].dayShort === 'Lun', 'Semana natural inicia en Lunes');
assert(weekBuckets[6].dayShort === 'Dom', 'Semana natural termina en Domingo');
assert(
  weekBuckets.some(b => b.dateStr === '2024-10-24' && b.isCurrentDay),
  '2024-10-24 está marcado como activo dentro de su semana'
);

const fourteenBuckets = getChartDayBuckets('2024-10-24', '14d');
assert(fourteenBuckets.length === 14, 'Rango "14d" retorna exactamente 14 días');
assert(
  fourteenBuckets.some(b => b.dateStr === '2024-10-24' && b.isCurrentDay),
  '2024-10-24 está contenido en el rango de 14 días'
);

// -----------------------------------------------------------------------------
// BLOQUE 3: Agregación matemática real de comidas por fecha
// -----------------------------------------------------------------------------
const sampleLogs: MealLogItem[] = [
  {
    id: 'log-1',
    dateTime: '2024-10-24T08:15',
    moment: 'desayuno',
    title: 'Bowl de avena',
    description: 'Avena con leche',
    portion: '320 g',
    calories: 520,
    protein: 38.5,
    carbs: 62.0,
    fats: 9.8,
    source: 'Plantilla',
    verified: true,
  },
  {
    id: 'log-2',
    dateTime: '2024-10-24T13:30',
    moment: 'almuerzo',
    title: 'Pechuga asada con arroz',
    description: 'Pechuga y arroz',
    portion: '430 g',
    calories: 680,
    protein: 58.2,
    carbs: 64.0,
    fats: 16.5,
    source: 'Manual',
    verified: true,
  },
  {
    id: 'log-3',
    dateTime: '2024-10-24T17:00',
    moment: 'merienda',
    title: 'Yogur griego',
    description: 'Yogur con nueces',
    portion: '235 g',
    calories: 310,
    protein: 24.0,
    carbs: 22.0,
    fats: 14.0,
    source: 'Receta',
    verified: true,
  },
  {
    id: 'log-4',
    dateTime: '2024-10-25T12:00',
    moment: 'almuerzo',
    title: 'Salmón con espárragos',
    description: 'Salmón 200g',
    portion: '250 g',
    calories: 450,
    protein: 42.0,
    carbs: 5.0,
    fats: 28.0,
    source: 'Manual',
    verified: true,
  },
];

// Comprobar agregación para 2024-10-24:
const dayLogs24 = sampleLogs.filter(m => getLocalDateString(m.dateTime) === '2024-10-24');
assert(dayLogs24.length === 3, '2024-10-24 tiene exactamente 3 comidas');
const kcal24 = dayLogs24.reduce((acc, m) => acc + m.calories, 0);
const prot24 = Math.round(dayLogs24.reduce((acc, m) => acc + m.protein, 0) * 10) / 10;
const carbs24 = Math.round(dayLogs24.reduce((acc, m) => acc + m.carbs, 0) * 10) / 10;
const fats24 = Math.round(dayLogs24.reduce((acc, m) => acc + m.fats, 0) * 10) / 10;

assert(kcal24 === 1510, `Calorías exactas esperadas 1510 kcal, obtenido: ${kcal24}`);
assert(prot24 === 120.7, `Proteína exacta esperada 120.7 g, obtenido: ${prot24}`);
assert(carbs24 === 148.0, `Carbohidratos exactos esperados 148.0 g, obtenido: ${carbs24}`);
assert(fats24 === 40.3, `Grasas exactas esperadas 40.3 g, obtenido: ${fats24}`);

// Comprobar día vacío (ej. 2024-10-26):
const dayLogsEmpty = sampleLogs.filter(m => getLocalDateString(m.dateTime) === '2024-10-26');
assert(dayLogsEmpty.length === 0, 'Fecha sin registros retorna 0 comidas');
const kcalEmpty = dayLogsEmpty.reduce((acc, m) => acc + m.calories, 0);
assert(kcalEmpty === 0, 'Día vacío no inventa calorías ficticias (0 kcal)');

// -----------------------------------------------------------------------------
// BLOQUE 4: Identificación de momentos no registrados
// -----------------------------------------------------------------------------
const recordedMoments = new Set(dayLogs24.map(m => m.moment));
const standardMoments: MealMoment[] = ['desayuno', 'almuerzo', 'merienda', 'cena'];
const pendingMoments = standardMoments.filter(m => !recordedMoments.has(m));
assert(
  pendingMoments.length === 1 && pendingMoments[0] === 'cena',
  'Detecta exactamente la "cena" como momento pendiente para 2024-10-24'
);

// -----------------------------------------------------------------------------
// BLOQUE 5: Promedio de ingesta solo sobre días con datos
// -----------------------------------------------------------------------------
const weekData = weekBuckets.map(bucket => {
  const dayMeals = sampleLogs.filter(m => getLocalDateString(m.dateTime) === bucket.dateStr);
  const kcal = dayMeals.reduce((acc, m) => acc + m.calories, 0);
  return {
    date: bucket.dateStr,
    kcal,
    empty: dayMeals.length === 0,
  };
});

const activeDaysInWeek = weekData.filter(d => !d.empty);
assert(activeDaysInWeek.length === 2, 'En la semana hay 2 días con registros (24 y 25 de Octubre)');
const expectedAverage = Math.round((1510 + 450) / 2);
const calculatedAverage = Math.round(activeDaysInWeek.reduce((acc, d) => acc + d.kcal, 0) / activeDaysInWeek.length);
assert(
  calculatedAverage === expectedAverage && calculatedAverage === 980,
  `Promedio diario considera solo días activos (${calculatedAverage} kcal/día)`
);

console.log(`\n========================================================================`);
console.log(` RESULTADO: ${passed} / ${total} PRUEBAS SUPERADAS`);
console.log(`========================================================================`);
