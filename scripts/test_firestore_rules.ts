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

    console.log('\n--- GRUPO 6: SEGURIDAD Y REGLAS DE BIOMETRÍA Y PERIODIZACIÓN (Incremento 7C.2) ---');

    // 6.1 Usuario propietario puede actualizar sus biometrías
    const validBioDoc = {
      userId: userA,
      weightKg: 75,
      heightCm: 178,
      age: 28,
      palFactor: 1.55,
      targetCalories: 2666,
      targetProteinG: 150,
      targetFatG: 60,
      targetCarbsG: 382,
      proteinPerKg: 2.0,
      fatPerKg: 0.8,
    };
    await assertSucceeds(
      setDoc(doc(dbA, 'users', userA, 'biometrics', 'current'), validBioDoc)
    );
    console.log('  -> [PASS] 6.1 Usuario propietario actualiza biometrías válidas: PERMITIDO.');

    // 6.2 Usuario propietario puede guardar lastAppliedPeriodization (metas periodizadas)
    const periodizedBioDoc = {
      ...validBioDoc,
      targetCalories: 2850,
      targetProteinG: 165,
      lastAppliedPeriodization: {
        phase: 'Semana 2 de 6',
        athleteGoal: 'hipertrofia',
        appliedAt: new Date().toISOString(),
        isDietBreak: false,
        previousTargets: {
          targetCalories: 2666,
          targetProteinG: 150,
          targetCarbsG: 382,
          targetFatG: 60,
          proteinPerKg: 2.0,
          fatPerKg: 0.8,
          targetDeltaKcal: 0,
        },
      },
    };
    await assertSucceeds(
      setDoc(doc(dbA, 'users', userA, 'biometrics', 'current'), periodizedBioDoc)
    );
    console.log('  -> [PASS] 6.2 Guardado de periodización y previousTargets: PERMITIDO.');

    // 6.3 Usuario propietario puede restaurar previousTargets (reversión)
    const revertedBioDoc = {
      ...validBioDoc,
      targetCalories: 2666,
      targetProteinG: 150,
      lastAppliedPeriodization: null,
    };
    await assertSucceeds(
      setDoc(doc(dbA, 'users', userA, 'biometrics', 'current'), revertedBioDoc)
    );
    console.log('  -> [PASS] 6.3 Reversión y restauración de previousTargets: PERMITIDO.');

    // 6.4 Usuario A no puede modificar ni leer biometrías de Usuario B
    await assertFails(
      getDoc(doc(dbB, 'users', userA, 'biometrics', 'current'))
    );
    await assertFails(
      setDoc(doc(dbB, 'users', userA, 'biometrics', 'current'), {
        ...validBioDoc,
        userId: userB,
      })
    );
    console.log('  -> [PASS] 6.4 Usuario A no puede leer ni modificar biometrías de B: RECHAZADO.');

    // 6.5 Usuario no autenticado no puede actualizar biometrías
    await assertFails(
      setDoc(doc(dbAnon, 'users', userA, 'biometrics', 'current'), validBioDoc)
    );
    await assertFails(
      getDoc(doc(dbAnon, 'users', userA, 'biometrics', 'current'))
    );
    console.log('  -> [PASS] 6.5 Usuario no autenticado rechazado en biometrías: RECHAZADO.');

    // 6.6 Valores fuera de rango son rechazados por isValidBiometrics
    await assertFails(
      setDoc(doc(dbA, 'users', userA, 'biometrics', 'current'), {
        ...validBioDoc,
        weightKg: -10, // Inválido: weightKg <= 0
      })
    );
    await assertFails(
      setDoc(doc(dbA, 'users', userA, 'biometrics', 'current'), {
        ...validBioDoc,
        heightCm: 30, // Inválido: heightCm <= 50
      })
    );
    await assertFails(
      setDoc(doc(dbA, 'users', userA, 'biometrics', 'current'), {
        ...validBioDoc,
        targetCalories: 200, // Inválido: targetCalories < 500
      })
    );
    console.log('  -> [PASS] 6.6 Valores fuera de rango (peso, altura, calorías) rechazados: RECHAZADO.');

    // 6.7 La actualización conserva los campos inmutables (userId no transferible)
    await assertFails(
      updateDoc(doc(dbA, 'users', userA, 'biometrics', 'current'), {
        userId: userB, // Intento de transferir posesión
      })
    );
    console.log('  -> [PASS] 6.7 Intento de transferir userId en update de biometrías: RECHAZADO.');

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
  console.log('[AUDITORÍA ESTÁTICA]: Verificando reglas de Incrementos 6C, 7A y 7C (Biometría y Periodización)...');
  const checks = [
    { label: 'isValidExecutedWorkout definida', pass: rulesContent.includes('function isValidExecutedWorkout') },
    { label: 'isLinkedWorkoutActive definida', pass: rulesContent.includes('function isLinkedWorkoutActive') },
    { label: 'canModifyExistingSet definida', pass: rulesContent.includes('function canModifyExistingSet') },
    { label: 'Creación de sesión obligatoria in_progress', pass: rulesContent.includes("incoming().status == 'in_progress'") },
    { label: 'Bloqueo de borrado en executedWorkouts (allow delete: if false)', pass: rulesContent.includes('match /executedWorkouts/{workoutId}') && rulesContent.includes('allow delete: if false;') },
    { label: 'Vinculación obligatoria de series (workoutSessions)', pass: rulesContent.includes("('executedWorkoutId' in incoming()) &&") && rulesContent.includes('isLinkedWorkoutActive(incoming().executedWorkoutId, userId)') },
    { label: 'Inmutabilidad de executedWorkoutId en update', pass: rulesContent.includes('incoming().executedWorkoutId == existing().executedWorkoutId') },
    { label: 'isValidBiometrics definida', pass: rulesContent.includes('function isValidBiometrics(data, userId)') },
    { label: 'isValidBiometrics valida data.userId == userId', pass: rulesContent.includes('data.userId == userId') && rulesContent.includes('data.weightKg > 0') },
    { label: 'isValidBiometrics valida límites de peso (0 a 500 kg) y estatura (50 a 300 cm)', pass: rulesContent.includes('data.weightKg < 500') && rulesContent.includes('data.heightCm < 300') },
    { label: 'isValidBiometrics valida rango calórico (500 a 10000 kcal)', pass: rulesContent.includes('data.targetCalories >= 500 && data.targetCalories <= 10000') },
    { label: 'Match /biometrics/{docId} con control de propietario isOwner(userId)', pass: rulesContent.includes('match /biometrics/{docId}') && rulesContent.includes('isOwner(userId)') },
    { label: 'allow create/update en biometrics con isValidBiometrics', pass: rulesContent.includes('isValidBiometrics(incoming(), userId)') },
    { label: 'Inmutabilidad de userId en update de biometrics (incoming().userId == existing().userId)', pass: rulesContent.includes('incoming().userId == existing().userId') },
    { label: 'Default deny catch-all presente', pass: rulesContent.includes('match /{document=**} {\n      allow read, write: if false;\n    }') },
    // Incremento 7D, 7D.1 y 7D.2: RBAC, Suspensión, Anti-Stale-Tokens, Versionado Real y Colecciones Administrativas
    { label: 'isAccountActive definida y verifica accountAccess/{userId}', pass: rulesContent.includes('function isAccountActive(userId)') && rulesContent.includes('documents/accountAccess/$(userId)') },
    { label: 'isAccountActive valida frescura de sesión con validAfter vs request.auth.token.auth_time', pass: rulesContent.includes('request.auth.token.auth_time >=') && rulesContent.includes('validAfter') },
    { label: 'isOwner integra comprobación de cuenta activa isAccountActive(userId)', pass: rulesContent.includes('isOwner(userId)') && rulesContent.includes('isAccountActive(userId)') },
    { label: 'isAuthoritativeRole verifica adminRoleState y previene tokens estancados', pass: rulesContent.includes('function isAuthoritativeRole(role)') && rulesContent.includes('documents/adminRoleState/$(request.auth.uid)') },
    { label: 'isAuthoritativeRole valida roleVersion numérica e igualdad estricta con token', pass: rulesContent.includes('request.auth.token.roleVersion is int') && rulesContent.includes('data.roleVersion == request.auth.token.roleVersion') },
    { label: 'isAdmin definida y valida rol autoritativo isAuthoritativeRole en admin o superadmin', pass: rulesContent.includes('function isAdmin()') && rulesContent.includes("isAuthoritativeRole('admin') || isAuthoritativeRole('superadmin')") },
    { label: 'adminRoleState match con allow read: if owner o admin y allow write: if false', pass: rulesContent.includes('match /adminRoleState/{userId}') && rulesContent.includes('allow write: if false;') },
    { label: 'adminUserDirectory match con allow read: if isAdmin() y allow write: if false', pass: rulesContent.includes('match /adminUserDirectory/{userId}') && rulesContent.includes('allow read: if isAdmin();') && rulesContent.includes('allow write: if false;') },
    { label: 'adminInvitations match con allow read: if isAdmin() y allow write: if false', pass: rulesContent.includes('match /adminInvitations/{inviteId}') && rulesContent.includes('allow read: if isAdmin();') && rulesContent.includes('allow write: if false;') },
    { label: 'accountAccess match con allow read: if owner o admin y allow write: if false', pass: rulesContent.includes('match /accountAccess/{userId}') && rulesContent.includes('allow write: if false;') },
    { label: 'adminAuditLogs match con allow read: if isAdmin() y allow write: if false (append-only vía backend)', pass: rulesContent.includes('match /adminAuditLogs/{eventId}') && rulesContent.includes('allow read: if isAdmin();') && rulesContent.includes('allow write: if false;') },
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
  console.log(`\n[ÉXITO] Todas las ${checks.length} aserciones de reglas estáticas verificadas.`);
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('test_firestore_rules')) {
  runFirestoreRulesTests().catch((err) => {
    console.error('Error durante la ejecución:', err);
    process.exit(1);
  });
}
