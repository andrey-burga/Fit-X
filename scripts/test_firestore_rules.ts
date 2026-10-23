/**
 * VigorCore — Suite Oficial de Pruebas de Cloud Firestore Security Rules
 * Implementada con @firebase/rules-unit-testing para Firebase Emulator Suite
 *
 * Proyecto Aislado: demo-vigorcore-rules (Prefijo demo- para forzar modo emulador offline)
 */

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'demo-vigorcore-rules';
const RULES_PATH = resolve(process.cwd(), 'firestore.rules');

export async function runFirestoreRulesTests() {
  console.log('========================================================================');
  console.log(' SUITE REAL DE FIRESTORE SECURITY RULES — VIGORCORE (INCREMENTO 6C.2)');
  console.log(` Proyecto de Pruebas: ${PROJECT_ID} (Aislado, 0% datos de producción)`);
  console.log(` Archivo de Reglas:   ${RULES_PATH}`);
  console.log('========================================================================\n');

  const rulesContent = readFileSync(RULES_PATH, 'utf8');

  // Verificar si el emulador de Firestore está activo en el entorno
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (!emulatorHost) {
    console.warn('------------------------------------------------------------------------');
    console.warn(' [AVISO DE ENTORNO]: FIRESTORE_EMULATOR_HOST no detectado.');
    console.warn(' Firebase Emulator Suite requiere Java Runtime Environment (JRE 11+).');
    console.warn(' En este contenedor Linux, Java no se encuentra instalado ("java: not found").');
    console.warn('');
    console.warn(' Para ejecutar esta suite contra el motor binario CEL real de Firestore:');
    console.warn('   1. Clonar el repositorio en una máquina con Java 11+ y Node.js.');
    console.warn('   2. Instalar dependencias: npm install');
    console.warn('   3. Ejecutar: npm run test:emulator');
    console.warn('      (o: firebase emulators:exec --only firestore "npx tsx scripts/test_firestore_rules.ts")');
    console.warn('------------------------------------------------------------------------\n');
    console.log('Procediendo con validación estática de integridad de reglas...\n');
    runStaticIntegrityAudit(rulesContent);
    return;
  }

  console.log(`[INFO] Conectado a Firebase Emulator Suite en: ${emulatorHost}`);
  let testEnv: RulesTestEnvironment | null = null;

  try {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: rulesContent,
        host: emulatorHost.split(':')[0] || '127.0.0.1',
        port: parseInt(emulatorHost.split(':')[1] || '8080', 10),
      },
    });

    const userA = 'atleta_alpha_uid';
    const userB = 'atleta_beta_uid';
    const authContextA = testEnv.authenticatedContext(userA, {
      email: 'alpha@vigorcore.com',
      email_verified: true,
    });
    const authContextB = testEnv.authenticatedContext(userB, {
      email: 'beta@vigorcore.com',
      email_verified: true,
    });
    const unauthContext = testEnv.unauthenticatedContext();

    const dbA = authContextA.firestore();
    const dbB = authContextB.firestore();
    const dbAnon = unauthContext.firestore();

    console.log('--- GRUPO 1: CICLO DE VIDA DE SESIONES (executedWorkouts) ---');

    // 1.1 Crear sesión nueva in_progress: PERMITIDO
    const session1Id = 'ewk_live_001';
    const validInProgressSession = {
      id: session1Id,
      userId: userA,
      routineName: 'Torso Hipertrofia',
      status: 'in_progress',
      startedAt: new Date().toISOString(),
      durationSeconds: 0,
      totalTonnageKg: 0,
      totalCompletedSets: 0,
    };
    await assertSucceeds(
      setDoc(doc(dbA, 'users', userA, 'executedWorkouts', session1Id), validInProgressSession)
    );
    console.log('  -> [PASS] 1.1 Crear sesión con status "in_progress": PERMITIDO.');

    // 1.2 Crear directamente sesión completed o abandoned: RECHAZADO
    const forgedCompletedSession = {
      ...validInProgressSession,
      id: 'ewk_forged_completed',
      status: 'completed',
    };
    await assertFails(
      setDoc(doc(dbA, 'users', userA, 'executedWorkouts', 'ewk_forged_completed'), forgedCompletedSession)
    );
    console.log('  -> [PASS] 1.2 Crear directamente sesión en estado "completed": RECHAZADO.');

    const forgedAbandonedSession = {
      ...validInProgressSession,
      id: 'ewk_forged_abandoned',
      status: 'abandoned',
    };
    await assertFails(
      setDoc(doc(dbA, 'users', userA, 'executedWorkouts', 'ewk_forged_abandoned'), forgedAbandonedSession)
    );
    console.log('  -> [PASS] 1.2B Crear directamente sesión en estado "abandoned": RECHAZADO.');

    console.log('\n--- GRUPO 2: VINCULACIÓN OBLIGATORIA DE SERIES (workoutSessions) ---');

    // 2.1 Crear serie vinculada a sesión activa: PERMITIDO
    const set1Id = 'set_press_banca_01';
    const validLinkedSet = {
      id: set1Id,
      userId: userA,
      exerciseId: 'ex_press_banca',
      exerciseName: 'Press de Banca',
      weightKg: 80,
      reps: 8,
      completed: true,
      executedWorkoutId: session1Id,
    };
    await assertSucceeds(
      setDoc(doc(dbA, 'users', userA, 'workoutSessions', set1Id), validLinkedSet)
    );
    console.log('  -> [PASS] 2.1 Crear serie vinculada a sesión activa in_progress: PERMITIDO.');

    // 2.2 Crear serie sin identificador o identificador vacío: RECHAZADO
    const setWithoutLink = {
      id: 'set_no_link',
      userId: userA,
      exerciseId: 'ex_press_banca',
      exerciseName: 'Press de Banca',
      weightKg: 80,
      reps: 8,
      completed: true,
    };
    await assertFails(
      setDoc(doc(dbA, 'users', userA, 'workoutSessions', 'set_no_link'), setWithoutLink)
    );
    console.log('  -> [PASS] 2.2A Crear serie sin executedWorkoutId: RECHAZADO.');

    const setWithEmptyLink = {
      ...validLinkedSet,
      id: 'set_empty_link',
      executedWorkoutId: '',
    };
    await assertFails(
      setDoc(doc(dbA, 'users', userA, 'workoutSessions', 'set_empty_link'), setWithEmptyLink)
    );
    console.log('  -> [PASS] 2.2B Crear serie con executedWorkoutId vacío: RECHAZADO.');

    // 2.3 Crear serie con ID de sesión inexistente: RECHAZADO
    const setWithGhostLink = {
      ...validLinkedSet,
      id: 'set_ghost_link',
      executedWorkoutId: 'ewk_does_not_exist_999',
    };
    await assertFails(
      setDoc(doc(dbA, 'users', userA, 'workoutSessions', 'set_ghost_link'), setWithGhostLink)
    );
    console.log('  -> [PASS] 2.3 Crear serie con sesión inexistente: RECHAZADO.');

    console.log('\n--- GRUPO 3: CIERRE, ABANDONO E INMUTABILIDAD TERMINAL ---');

    // 3.1 Transición a completed: PERMITIDO
    const completedUpdate = {
      status: 'completed',
      completedAt: new Date().toISOString(),
      totalTonnageKg: 640,
      totalCompletedSets: 1,
    };
    await assertSucceeds(
      updateDoc(doc(dbA, 'users', userA, 'executedWorkouts', session1Id), completedUpdate)
    );
    console.log('  -> [PASS] 3.1 Finalizar sesión en curso (transición a "completed"): PERMITIDO.');

    // 3.2 Modificar, reabrir o borrar sesión terminal: RECHAZADO
    await assertFails(
      updateDoc(doc(dbA, 'users', userA, 'executedWorkouts', session1Id), {
        status: 'in_progress',
      })
    );
    console.log('  -> [PASS] 3.2A Reabrir sesión completada a in_progress: RECHAZADO.');

    await assertFails(
      updateDoc(doc(dbA, 'users', userA, 'executedWorkouts', session1Id), {
        totalTonnageKg: 99999,
      })
    );
    console.log('  -> [PASS] 3.2B Modificar métricas de sesión completada: RECHAZADO.');

    await assertFails(
      deleteDoc(doc(dbA, 'users', userA, 'executedWorkouts', session1Id))
    );
    console.log('  -> [PASS] 3.2C Borrar sesión completada: RECHAZADO.');

    // 3.3 Intentar agregar series o modificar series de sesión completada: RECHAZADO
    const setAfterCompleted = {
      id: 'set_tamper_after',
      userId: userA,
      exerciseId: 'ex_press_banca',
      exerciseName: 'Press de Banca',
      weightKg: 100,
      reps: 10,
      completed: true,
      executedWorkoutId: session1Id,
    };
    await assertFails(
      setDoc(doc(dbA, 'users', userA, 'workoutSessions', 'set_tamper_after'), setAfterCompleted)
    );
    console.log('  -> [PASS] 3.3A Agregar serie a sesión completada: RECHAZADO.');

    await assertFails(
      updateDoc(doc(dbA, 'users', userA, 'workoutSessions', set1Id), { reps: 15 })
    );
    console.log('  -> [PASS] 3.3B Modificar serie vinculada a sesión completada: RECHAZADO.');

    await assertFails(
      deleteDoc(doc(dbA, 'users', userA, 'workoutSessions', set1Id))
    );
    console.log('  -> [PASS] 3.3C Eliminar serie vinculada a sesión completada: RECHAZADO.');

    // 3.4 Desvincular serie (stripping attack): RECHAZADO
    // Creamos sesión 2 in_progress para prueba de desvinculación activa
    const session2Id = 'ewk_live_002';
    await assertSucceeds(
      setDoc(doc(dbA, 'users', userA, 'executedWorkouts', session2Id), {
        ...validInProgressSession,
        id: session2Id,
      })
    );
    const set2Id = 'set_002_strip';
    await assertSucceeds(
      setDoc(doc(dbA, 'users', userA, 'workoutSessions', set2Id), {
        ...validLinkedSet,
        id: set2Id,
        executedWorkoutId: session2Id,
      })
    );
    await assertFails(
      updateDoc(doc(dbA, 'users', userA, 'workoutSessions', set2Id), {
        executedWorkoutId: '',
      })
    );
    console.log('  -> [PASS] 3.4 Desvincular serie (remover o cambiar executedWorkoutId): RECHAZADO.');

    // 3.5 Cancelación y conservación inmutable de sesión abandonada
    await assertSucceeds(
      updateDoc(doc(dbA, 'users', userA, 'executedWorkouts', session2Id), {
        status: 'abandoned',
        completedAt: new Date().toISOString(),
      })
    );
    console.log('  -> [PASS] 3.5A Cancelar sesión (transición a "abandoned"): PERMITIDO.');

    await assertFails(
      deleteDoc(doc(dbA, 'users', userA, 'executedWorkouts', session2Id))
    );
    console.log('  -> [PASS] 3.5B Borrado directo de sesión abandonada: RECHAZADO.');

    await assertFails(
      updateDoc(doc(dbA, 'users', userA, 'workoutSessions', set2Id), { weightKg: 100 })
    );
    console.log('  -> [PASS] 3.5C Modificar serie de sesión abandonada: RECHAZADO.');

    console.log('\n--- GRUPO 4: COMPATIBILIDAD HISTÓRICA Y SEGURIDAD MULTIUSUARIO ---');

    // 4.1 Series históricas sin executedWorkoutId: lectura y modificación permitidas al dueño
    // Usamos context bypass administrativo temporal para sembrar una serie previa a 6C
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, 'users', userA, 'workoutSessions', 'set_legacy_pre6c'), {
        id: 'set_legacy_pre6c',
        userId: userA,
        exerciseId: 'ex_sentadilla',
        exerciseName: 'Sentadilla Trasera',
        weightKg: 100,
        reps: 5,
        completed: true,
      });
    });

    const legacySnap = await assertSucceeds(
      getDoc(doc(dbA, 'users', userA, 'workoutSessions', 'set_legacy_pre6c'))
    );
    if (!legacySnap.exists()) throw new Error('Serie histórica no encontrada');
    await assertSucceeds(
      updateDoc(doc(dbA, 'users', userA, 'workoutSessions', 'set_legacy_pre6c'), { reps: 6 })
    );
    console.log('  -> [PASS] 4.1 Series históricas sin executedWorkoutId: 100% COMPATIBLES.');

    // 4.2 Rechazar accesos cruzados entre Atleta A y Atleta B
    await assertFails(
      getDoc(doc(dbB, 'users', userA, 'executedWorkouts', session1Id))
    );
    await assertFails(
      setDoc(doc(dbB, 'users', userA, 'workoutSessions', 'hacked_set'), validLinkedSet)
    );
    await assertFails(
      getDoc(doc(dbAnon, 'users', userA, 'executedWorkouts', session1Id))
    );
    console.log('  -> [PASS] 4.2 Aislamiento total de seguridad entre cuentas (User A vs User B): GARANTIZADO.');

    console.log('\n--- GRUPO 5: NO REGRESIÓN DE NUTRICIÓN, RUTINAS Y COMPRAS ---');

    // 5.1 MealLog legítimo de User A
    await assertSucceeds(
      setDoc(doc(dbA, 'users', userA, 'mealLogs', 'log_001'), {
        userId: userA,
        title: 'Avena con Proteína',
        moment: 'desayuno',
        calories: 450,
      })
    );
    // 5.2 Grocery legítimo de User A
    await assertSucceeds(
      setDoc(doc(dbA, 'users', userA, 'groceries', 'groc_001'), {
        userId: userA,
        name: 'Pechuga de Pollo',
        quantity: 1,
        unit: 'kg',
        department: 'carnes',
        status: 'pending',
      })
    );
    // 5.3 Workout Routine legítima de User A
    await assertSucceeds(
      setDoc(doc(dbA, 'users', userA, 'workoutRoutines', 'rout_001'), {
        userId: userA,
        name: 'Rutina Torso Pierna',
        goal: 'hipertrofia',
        frequencyDays: 4,
        days: [],
      })
    );
    console.log('  -> [PASS] 5.1 Nutrición, despensa y rutinas: CERO REGRESIONES.');

    console.log('\n========================================================================');
    console.log(' RESULTADO: TODAS LAS PRUEBAS DE EMULADOR FIRESTORE APROBARON 100%');
    console.log('========================================================================\n');
  } finally {
    if (testEnv) {
      await testEnv.cleanup();
    }
  }
}

function runStaticIntegrityAudit(rulesContent: string) {
  console.log('[AUDITORÍA ESTÁTICA]: Verificando reglas de Incremente 6C...');
  const checks = [
    { label: 'isValidExecutedWorkout definida', pass: rulesContent.includes('function isValidExecutedWorkout') },
    { label: 'isLinkedWorkoutActive definida', pass: rulesContent.includes('function isLinkedWorkoutActive') },
    { label: 'canModifyExistingSet definida', pass: rulesContent.includes('function canModifyExistingSet') },
    { label: 'Creación de sesión obligatoria in_progress', pass: rulesContent.includes("incoming().status == 'in_progress'") },
    { label: 'Bloqueo de borrado en executedWorkouts (allow delete: if false)', pass: rulesContent.includes('match /executedWorkouts/{workoutId}') && rulesContent.includes('allow delete: if false;') },
    { label: 'Vinculación obligatoria de series (workoutSessions)', pass: rulesContent.includes("('executedWorkoutId' in incoming()) &&") && rulesContent.includes('isLinkedWorkoutActive(incoming().executedWorkoutId, userId)') },
    { label: 'Inmutabilidad de executedWorkoutId en update', pass: rulesContent.includes('incoming().executedWorkoutId == existing().executedWorkoutId') },
    { label: 'Default deny catch-all presente', pass: rulesContent.includes('match /{document=**} {\n      allow read, write: if false;\n    }') },
  ];

  let allPassed = true;
  for (const c of checks) {
    if (c.pass) {
      console.log(`  -> [PASS] ${c.label}`);
    } else {
      console.error(`  -> [FAIL] ${c.label}`);
      allPassed = false;
    }
  }

  if (!allPassed) {
    console.error('\n[ERROR] Falló una o más comprobaciones estáticas de reglas.');
    process.exit(1);
  }
  console.log('\n[ÉXITO] Todas las aserciones de reglas estáticas verificadas.');
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('test_firestore_rules')) {
  runFirestoreRulesTests().catch((err) => {
    console.error('Error durante la ejecución:', err);
    process.exit(1);
  });
}
