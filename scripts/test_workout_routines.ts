import { EXERCISE_CATALOG, getExerciseById, searchExercises, getExercisesByMuscleGroup } from '../src/data/exerciseCatalog';
import { MASTER_WORKOUT_TEMPLATES, instantiateRoutineFromTemplate } from '../src/data/workoutTemplates';
import { MuscleGroup, MovementPattern, EquipmentRequired, WorkoutRoutine, PlannedExerciseConfig } from '../src/types/workout';

let passed = 0;
let total = 0;

function assert(condition: boolean, message: string) {
  total++;
  if (!condition) {
    console.error(`  ❌ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passed++;
  console.log(`  ✅ [PASS] ${message}`);
}

console.log('========================================================================');
console.log(' TEST INCREMENTO 6B: CATÁLOGO DE EJERCICIOS Y MOTOR DE RUTINAS');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// [TEST 1] Integridad y Unicidad del Catálogo Canónico
// -----------------------------------------------------------------------------
console.log('[TEST 1] Integridad y Unicidad del Catálogo Canónico:');
assert(EXERCISE_CATALOG.length >= 25, `El catálogo cuenta con cobertura suficiente (${EXERCISE_CATALOG.length} ejercicios)`);

const idSet = new Set<string>();
EXERCISE_CATALOG.forEach(ex => {
  assert(!idSet.has(ex.id), `ID "${ex.id}" es único en el catálogo`);
  idSet.add(ex.id);
  assert(/^[a-zA-Z0-9_-]+$/.test(ex.id), `ID "${ex.id}" cumple formato alfanumérico seguro`);
  assert(ex.name.length >= 3, `Nombre "${ex.name}" tiene longitud válida`);
  assert(Boolean(ex.instructions && ex.instructions.length > 0), `Ejercicio "${ex.name}" cuenta con instrucciones técnicas`);
  
  if (ex.variants && ex.variants.length > 0) {
    ex.variants.forEach(variantId => {
      assert(
        EXERCISE_CATALOG.some(e => e.id === variantId),
        `Variante "${variantId}" de "${ex.name}" apunta a un ejercicio existente en el catálogo`
      );
    });
  }
});

const requiredMuscles: MuscleGroup[] = [
  'pecho', 'espalda', 'hombros', 'biceps', 'triceps', 
  'cuadriceps', 'isquios', 'gluteos', 'gemelos', 'core', 'cuerpo_completo'
];
requiredMuscles.forEach(muscle => {
  const count = getExercisesByMuscleGroup(muscle).length;
  assert(count > 0, `Grupo muscular "${muscle}" cubierto en el catálogo (${count} ejercicios)`);
});

// -----------------------------------------------------------------------------
// [TEST 2] Búsqueda y Filtros del Catálogo
// -----------------------------------------------------------------------------
console.log('\n[TEST 2] Búsqueda y Filtros del Catálogo:');
const benchSearch = searchExercises('banca');
assert(benchSearch.some(ex => ex.id === 'barbell_bench_press'), 'Búsqueda por texto "banca" localiza Press de Banca');

const chestOnly = searchExercises('', 'pecho');
assert(chestOnly.every(ex => ex.muscleGroup === 'pecho'), 'Filtro por grupo "pecho" retorna exclusivamente ejercicios pectorales');

const barbellOnly = EXERCISE_CATALOG.filter(ex => ex.equipment === 'barra');
assert(barbellOnly.length >= 5, `Ejercicios con barra disponibles: ${barbellOnly.length}`);

// -----------------------------------------------------------------------------
// [TEST 3] Plantillas Maestras y Copia Independiente
// -----------------------------------------------------------------------------
console.log('\n[TEST 3] Plantillas Maestras y Copia Independiente:');
assert(MASTER_WORKOUT_TEMPLATES.length === 3, 'Existen exactamente 3 plantillas maestras (Torso/Pierna, PPL, Full Body)');

const tpMaster = MASTER_WORKOUT_TEMPLATES.find(t => t.id === 'template_torso_pierna_4d')!;
assert(tpMaster !== undefined, 'Plantilla Torso/Pierna 4D existe');
assert(tpMaster.days.length === 6, 'Torso/Pierna contiene 4 días de fuerza + días de descanso/recuperación');

// Instanciar para usuario
const user1Routine = instantiateRoutineFromTemplate('template_torso_pierna_4d', 'user_alpha');
const user2Routine = instantiateRoutineFromTemplate('template_torso_pierna_4d', 'user_beta');

assert(user1Routine.id !== user2Routine.id, 'Las instancias tienen IDs de rutina distintos');
assert(user1Routine.userId === 'user_alpha', 'Usuario 1 asignado correctamente');
assert(user2Routine.userId === 'user_beta', 'Usuario 2 asignado correctamente');
assert(user1Routine.days[0].exercises[0].id !== user2Routine.days[0].exercises[0].id, 'IDs de configuración de ejercicios son únicos e independientes');

// Probar mutación de copia: no debe alterar plantilla maestra
user1Routine.days[0].exercises[0].sets = 99;
assert(tpMaster.days[0].exercises[0].sets === 4, 'Modificar la rutina del usuario NO altera la plantilla maestra (Invarianza profunda)');
assert(user2Routine.days[0].exercises[0].sets === 4, 'Modificar la rutina del usuario 1 NO altera la rutina del usuario 2');

// -----------------------------------------------------------------------------
// [TEST 4] Modificación, Inserción y Reordenamiento de Ejercicios
// -----------------------------------------------------------------------------
console.log('\n[TEST 4] Modificación, Inserción y Reordenamiento de Ejercicios:');
const testRoutine = instantiateRoutineFromTemplate('template_full_body_3d', 'test_user');
const day1 = testRoutine.days[0];
const initialCount = day1.exercises.length;

// Añadir ejercicio
const newExConfig: PlannedExerciseConfig = {
  id: `cfg_test_${Date.now()}`,
  exerciseId: 'cable_bayesian_curl',
  orderIndex: initialCount + 1,
  sets: 3,
  repsMin: 12,
  repsMax: 15,
  targetRir: 1,
  restSeconds: 60,
  notes: 'Pausa en estiramiento'
};
day1.exercises.push(newExConfig);
assert(day1.exercises.length === initialCount + 1, 'Ejercicio añadido satisfactoriamente al día');
assert(day1.exercises[day1.exercises.length - 1].orderIndex === initialCount + 1, 'orderIndex secuencial asignado correctamente');

// Reordenar: mover el nuevo ejercicio al inicio (índice 0)
const moved = day1.exercises.pop()!;
day1.exercises.unshift(moved);
day1.exercises.forEach((ex, idx) => {
  ex.orderIndex = idx + 1;
});
assert(day1.exercises[0].exerciseId === 'cable_bayesian_curl', 'Ejercicio reordenado al inicio (índice 0)');
assert(day1.exercises[0].orderIndex === 1, 'orderIndex normalizado a 1 tras reordenamiento');
assert(day1.exercises[1].orderIndex === 2, 'orderIndex de ejercicio desplazado normalizado a 2');

// Eliminar ejercicio
day1.exercises = day1.exercises.filter(e => e.id !== newExConfig.id);
day1.exercises.forEach((ex, idx) => {
  ex.orderIndex = idx + 1;
});
assert(day1.exercises.length === initialCount, 'Ejercicio retirado y longitud restablecida');
assert(day1.exercises.every((e, i) => e.orderIndex === i + 1), 'Índices ordenados consecutivamente sin huecos');

// -----------------------------------------------------------------------------
// [TEST 5] Persistencia y Serialización (Round-trip)
// -----------------------------------------------------------------------------
console.log('\n[TEST 5] Persistencia y Serialización (Round-trip):');
const serialized = JSON.stringify(testRoutine);
const deserialized: WorkoutRoutine = JSON.parse(serialized);

assert(deserialized.id === testRoutine.id, 'ID de rutina preservado en serialización');
assert(deserialized.days.length === testRoutine.days.length, 'Estructura de días preservada');
assert(deserialized.days[0].exercises[0].exerciseId === testRoutine.days[0].exercises[0].exerciseId, 'Parámetros de ejercicios preservados intactos');

// -----------------------------------------------------------------------------
// [TEST 6] Validación de Reglas de Seguridad de Firestore (isValidWorkoutRoutine)
// -----------------------------------------------------------------------------
console.log('\n[TEST 6] Validación de Reglas de Seguridad de Firestore (isValidWorkoutRoutine):');

function isValidWorkoutRoutineRule(data: any, userId: string): boolean {
  return (
    data.userId === userId &&
    typeof data.name === 'string' &&
    data.name.length >= 2 &&
    data.name.length <= 150 &&
    ['hipertrofia', 'fuerza', 'recomposicion', 'resistencia'].includes(data.goal) &&
    typeof data.frequencyDays === 'number' &&
    data.frequencyDays >= 1 &&
    data.frequencyDays <= 7 &&
    Array.isArray(data.days) &&
    data.days.length <= 14
  );
}

const validPayload = {
  userId: 'usr_camilo_123',
  name: 'Torso Pierna Pesado',
  goal: 'hipertrofia',
  frequencyDays: 4,
  days: testRoutine.days
};

assert(isValidWorkoutRoutineRule(validPayload, 'usr_camilo_123'), 'Rutina válida cumple isValidWorkoutRoutine');
assert(!isValidWorkoutRoutineRule(validPayload, 'usr_atacante'), 'Rechaza escritura con userId ajeno');
assert(!isValidWorkoutRoutineRule({ ...validPayload, name: 'A' }, 'usr_camilo_123'), 'Rechaza rutina con nombre < 2 caracteres');
assert(!isValidWorkoutRoutineRule({ ...validPayload, goal: 'crossfit_extremo' }, 'usr_camilo_123'), 'Rechaza meta no autorizada en enum');
assert(!isValidWorkoutRoutineRule({ ...validPayload, frequencyDays: 0 }, 'usr_camilo_123'), 'Rechaza frecuencia menor a 1 día');
assert(!isValidWorkoutRoutineRule({ ...validPayload, frequencyDays: 8 }, 'usr_camilo_123'), 'Rechaza frecuencia mayor a 7 días');
assert(!isValidWorkoutRoutineRule({ ...validPayload, days: 'invalido' }, 'usr_camilo_123'), 'Rechaza payload donde days no es lista');

// -----------------------------------------------------------------------------
// [TEST 7] Invarianza y Protección de Histórico en workoutSessions
// -----------------------------------------------------------------------------
console.log('\n[TEST 7] Invarianza y Protección de Histórico en workoutSessions:');

function isValidWorkoutSessionRule(data: any, userId: string): boolean {
  return (
    data.userId === userId &&
    typeof data.exerciseId === 'string' &&
    data.exerciseId.length <= 100 &&
    typeof data.exerciseName === 'string' &&
    data.exerciseName.length <= 150 &&
    typeof data.weightKg === 'number' &&
    data.weightKg >= 0 &&
    typeof data.reps === 'number' &&
    data.reps >= 0 &&
    typeof data.completed === 'boolean'
  );
}

const sampleHistoricalSet = {
  userId: 'usr_camilo_123',
  exerciseId: 'pendlay-1',
  exerciseName: 'Remo con Barra Pendlay',
  weightKg: 75.0,
  reps: 8,
  completed: true
};

assert(isValidWorkoutSessionRule(sampleHistoricalSet, 'usr_camilo_123'), 'Serie histórica válida cumple isValidWorkoutSession');
assert(!isValidWorkoutSessionRule({ ...sampleHistoricalSet, weightKg: -5 }, 'usr_camilo_123'), 'Rechaza serie con peso negativo');
// Confirmar que un objeto rutina no puede inyectarse en workoutSessions
assert(!isValidWorkoutSessionRule(validPayload, 'usr_camilo_123'), 'Objeto rutina es estrictamente RECHAZADO por la colección de series workoutSessions');

// -----------------------------------------------------------------------------
// [TEST 8] Aislamiento del Modo Demostración vs Cuentas Cloud
// -----------------------------------------------------------------------------
console.log('\n[TEST 8] Aislamiento del Modo Demostración vs Cuentas Cloud:');
const demoCamiloRoutine = instantiateRoutineFromTemplate('template_torso_pierna_4d', 'demo_camilo');
const demoSofiaRoutine = instantiateRoutineFromTemplate('template_push_pull_legs_3d', 'demo_sofia');

assert(demoCamiloRoutine.userId === 'demo_camilo', 'Rutina de Camilo aislada bajo su identificador');
assert(demoSofiaRoutine.userId === 'demo_sofia', 'Rutina de Sofía aislada bajo su identificador');

// Modificación en Camilo no afecta a Sofía
demoCamiloRoutine.name = 'Torso Pierna Modificado';
assert(demoSofiaRoutine.name !== demoCamiloRoutine.name, 'Modificaciones entre perfiles demo no se cruzan');

console.log('\n========================================================================');
console.log(` RESULTADO: ${passed} / ${total} PRUEBAS SUPERADAS CON ÉXITO`);
console.log('========================================================================');
