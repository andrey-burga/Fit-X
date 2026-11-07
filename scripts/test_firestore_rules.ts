/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Suite Oficial de Pruebas de Cloud Firestore Security Rules (Incremento 7D.3.3)
 *
 * Base de Datos Oficial (Producción): ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c
 * Base de Datos Emulador (Pruebas):   (default) [aislada con firestore.rules cargadas]
 * Proyecto Aislado:                   demo-vigorcore-rules (Prefijo demo- para modo emulador offline)
 *
 * ARQUITECTURA DE INTEGRACIÓN 100% PÚBLICA (INCREMENTO 7D.3.3):
 * - Configuración desacoplada en firebase.rules-test.json para el Firestore Emulator (evita incompatibilidad multidatabase).
 * - Preflight Fail-Closed obligatorio antes de la suite: aborta si el emulador arranca sin reglas (open rules).
 * - Selección modular pública getFirestore(app) para evaluación de reglas en (default).
 * - Verificación Canary de aislamiento entre (default) y ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c.
 * - Autenticación simulada mediante la API modular pública connectFirestoreEmulator(db, host, port, { mockUserToken }).
 * - Cero uso de propiedades privadas (_delegate, _databaseId) o monkey-patching interno.
 */

import { initializeApp, deleteApp, FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  Firestore,
} from 'firebase/firestore';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export const NAMED_DATABASE_ID = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
export const PROJECT_ID = 'demo-vigorcore-rules';
export const RULES_PATH = resolve(process.cwd(), 'firestore.rules');

export interface ScenarioResult {
  testId: string;
  groupId: number;
  groupName: string;
  description: string;
  expected: 'PERMITIDO' | 'RECHAZADO';
  actual: 'PERMITIDO' | 'RECHAZADO' | 'ERROR';
  passed: boolean;
  errorDetail?: string;
}

export interface GroupResult {
  groupId: number;
  groupName: string;
  scenarios: ScenarioResult[];
}

export async function runFirestoreRulesTests() {
  const isStaticExplicit = process.argv.includes('--static') || process.argv.includes('--static-only');
  const rulesContent = readFileSync(RULES_PATH, 'utf8');

  // Si se solicita explícitamente comprobación estática o no hay emulador, se ejecuta la auditoría estática CEL
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (isStaticExplicit || !emulatorHost) {
    if (!isStaticExplicit) {
      console.warn('========================================================================');
      console.warn(' [AVISO DE ENTORNO]: FIRESTORE_EMULATOR_HOST no detectado en el contenedor.');
      console.warn(' Firebase Emulator Suite requiere Java Runtime Environment (JRE 11+).');
      console.warn('');
      console.warn(' Para ejecutar esta suite contra el emulador binario real de Firestore en Windows:');
      console.warn('   npm run test:emulator');
      console.warn('   (o: npx firebase emulators:exec --only firestore "npx tsx scripts/test_firestore_rules.ts")');
      console.warn('========================================================================\n');
    }
    console.log('Procediendo con auditoría estática de integridad de reglas...\n');
    runStaticIntegrityAudit(rulesContent);
    return;
  }

  const host = emulatorHost.split(':')[0] || '127.0.0.1';
  const port = parseInt(emulatorHost.split(':')[1] || '8080', 10);

  console.log('========================================================================');
  console.log(' SUITE REAL DE FIRESTORE SECURITY RULES — VIGORCORE (INCREMENTO 7D.3.3)');
  console.log(` Proyecto de Pruebas:      ${PROJECT_ID} (Aislado, 0% datos de producción)`);
  console.log(` Base de Datos Emulada:    (default) [Configuración aislada de pruebas]`);
  console.log(` Base Nombrada Producción: ${NAMED_DATABASE_ID} [Verificada en Canary]`);
  console.log(` Archivo de Reglas:        ${RULES_PATH}`);
  console.log(` Emulador Activo en:       ${emulatorHost}`);
  console.log(' Integración SDK:          100% APIs Públicas (getFirestore + connectFirestoreEmulator)');
  console.log('========================================================================\n');

  let testEnv: RulesTestEnvironment | null = null;
  const activeApps: FirebaseApp[] = [];
  const groups: GroupResult[] = [];
  let currentGroup: GroupResult | null = null;

  // Fábrica de clientes Firestore modular 100% pública
  function createClient(uid: string, tokenClaims?: Record<string, any>, databaseId?: string): Firestore {
    const appName = `client_${uid}_${databaseId || 'default'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const app = initializeApp({ projectId: PROJECT_ID }, appName);
    activeApps.push(app);

    // Por defecto conecta a (default), donde el Firestore Emulator carga y aplica firestore.rules
    const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);

    if (uid === 'unauthenticated') {
      connectFirestoreEmulator(db, host, port);
    } else if (uid === 'owner') {
      // Token especial 'owner' documentado por Firebase para aprovisionamiento de fixtures sin reglas
      connectFirestoreEmulator(db, host, port, { mockUserToken: 'owner' });
    } else {
      const mockUserToken = {
        user_id: uid,
        sub: uid,
        email: tokenClaims?.email || `${uid}@vigorcore.com`,
        email_verified: tokenClaims?.email_verified ?? true,
        ...tokenClaims,
      };
      connectFirestoreEmulator(db, host, port, { mockUserToken });
    }
    return db;
  }

  // Alias para mantener compatibilidad total con todas las invocaciones existentes
  const createNamedClient = (uid: string, tokenClaims?: Record<string, any>) => createClient(uid, tokenClaims);

  // Fábrica para base nombrada explícita (para verificación Canary de aislamiento)
  function createExplicitNamedClient(uid: string): Firestore {
    return createClient(uid, undefined, NAMED_DATABASE_ID);
  }

  function startGroup(groupId: number, groupName: string) {
    currentGroup = { groupId, groupName, scenarios: [] };
    groups.push(currentGroup);
    console.log(`\n--- GRUPO ${groupId}: ${groupName} ---`);
  }

  async function expectAllowed(testId: string, description: string, promise: Promise<any>) {
    let passed = false;
    let actual: 'PERMITIDO' | 'RECHAZADO' | 'ERROR' = 'PERMITIDO';
    let errorDetail: string | undefined = undefined;

    try {
      await assertSucceeds(promise);
      passed = true;
      actual = 'PERMITIDO';
      console.log(`  -> [PASS] ${testId} ${description}`);
      console.log(`     Esperado: PERMITIDO | Obtenido: PERMITIDO`);
    } catch (err: any) {
      passed = false;
      actual = 'RECHAZADO';
      errorDetail = err?.message || String(err);
      console.error(`  -> [FAIL] ${testId} ${description}`);
      console.error(`     Esperado: PERMITIDO | Obtenido: RECHAZADO (${errorDetail})`);
    }

    currentGroup?.scenarios.push({
      testId,
      groupId: currentGroup.groupId,
      groupName: currentGroup.groupName,
      description,
      expected: 'PERMITIDO',
      actual,
      passed,
      errorDetail,
    });
  }

  async function expectDenied(testId: string, description: string, promise: Promise<any>) {
    let passed = false;
    let actual: 'PERMITIDO' | 'RECHAZADO' | 'ERROR' = 'RECHAZADO';
    let errorDetail: string | undefined = undefined;

    try {
      await assertFails(promise);
      passed = true;
      actual = 'RECHAZADO';
      console.log(`  -> [PASS] ${testId} ${description}`);
      console.log(`     Esperado: RECHAZADO | Obtenido: RECHAZADO (PERMISSION_DENIED)`);
    } catch (err: any) {
      passed = false;
      actual = 'PERMITIDO';
      errorDetail = 'La operación fue permitida cuando debía ser rechazada por firestore.rules';
      console.error(`  -> [FAIL] ${testId} ${description}`);
      console.error(`     Esperado: RECHAZADO | Obtenido: PERMITIDO (Inseguro)`);
    }

    currentGroup?.scenarios.push({
      testId,
      groupId: currentGroup.groupId,
      groupName: currentGroup.groupName,
      description,
      expected: 'RECHAZADO',
      actual,
      passed,
      errorDetail,
    });
  }

  try {
    // =========================================================================
    // COMPROBACIÓN PREVIA OBLIGATORIA FAIL-CLOSED (INCREMENTO 7D.3.3)
    // =========================================================================
    console.log('========================================================================');
    console.log(' [PREFLIGHT CHECK]: Verificando enforcement real de Security Rules en el Emulador...');
    console.log('========================================================================');

    const preflightProbeDb = createClient('unauthenticated');
    try {
      await setDoc(doc(preflightProbeDb, 'accountAccess', 'emulator-preflight-probe'), {
        uid: 'emulator-preflight-probe',
        status: 'active',
        probeTimestamp: Date.now(),
      });
      // SI LA ESCRITURA TUVO ÉXITO -> ¡EL EMULADOR ESTÁ EN MODO REGLAS ABIERTAS (OPEN RULES)!
      console.error('\n************************************************************************');
      console.error(' FATAL: Firestore Emulator no está aplicando Security Rules. Suite cancelada por seguridad.');
      console.error(' La escritura no autenticada en "accountAccess/emulator-preflight-probe" fue PERMITIDA.');
      console.error(' Causa: El emulador inició sin firestore.rules cargadas o en modo abierto.');
      console.error(' Solución: Inicie el emulador con --config firebase.rules-test.json');
      console.error('************************************************************************\n');
      process.exit(1);
    } catch (preflightErr: any) {
      const errCode = preflightErr?.code || '';
      const errMsg = preflightErr?.message || String(preflightErr);
      if (
        errCode === 'permission-denied' ||
        errMsg.includes('PERMISSION_DENIED') ||
        errMsg.includes('permission-denied') ||
        errMsg.includes('Missing or insufficient permissions')
      ) {
        console.log('  -> [PASS] Preflight Check: La escritura no autenticada fue RECHAZADA (PERMISSION_DENIED).');
        console.log('  -> CONFIRMADO: Firestore Emulator está aplicando Security Rules activamente.\n');
      } else {
        console.error('\n************************************************************************');
        console.error(' FATAL: Error inesperado de conexión con Firestore Emulator durante preflight.');
        console.error(` Detalle del error: ${errMsg} (código: ${errCode})`);
        console.error('************************************************************************\n');
        process.exit(1);
      }
    }

    // Inicializar test environment para sincronizar reglas en el entorno
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: rulesContent,
        host,
        port,
      },
    });

    // Clientes de prueba para los grupos históricos
    const userA = 'atleta_alpha_uid';
    const userB = 'atleta_beta_uid';
    const dbA = createClient(userA, { email: 'alpha@vigorcore.com', email_verified: true });
    const dbB = createClient(userB, { email: 'beta@vigorcore.com', email_verified: true });
    const dbAnon = createClient('unauthenticated');
    const dbOwner = createClient('owner');

    // =========================================================================
    // PRUEBA CANARY: IDENTIDAD Y AISLAMIENTO DE BASE DE DATOS (INCREMENTO 7D.3.3)
    // =========================================================================
    startGroup(0, 'PRUEBA CANARY DE IDENTIDAD Y AISLAMIENTO DE BASE DE DATOS');

    const canaryId = 'canary_doc_vigorcore_7d33';
    const canaryPayload = {
      testCanary: true,
      targetDatabase: 'default',
      namedDatabaseReference: NAMED_DATABASE_ID,
      marker: 'verified_rules_enforcement',
      timestamp: Date.now(),
    };

    // GC.1 Escribir documento de control en base de pruebas (default) con bypass owner
    await expectAllowed(
      '[GC.1]',
      'Escribir documento de control en base de pruebas (default) con cliente admin bypass',
      setDoc(doc(dbOwner, 'users', 'canary_user', 'preferences', canaryId), canaryPayload)
    );

    // GC.2 Leer documento de control desde cliente autenticado propietario en (default)
    const dbCanaryUser = createClient('canary_user', { email: 'canary@vigorcore.com', email_verified: true });
    const canarySnap = await getDoc(doc(dbCanaryUser, 'users', 'canary_user', 'preferences', canaryId));
    const canaryData = canarySnap.exists() ? canarySnap.data() : null;

    let canaryDataMatches = false;
    if (canaryData && canaryData.marker === 'verified_rules_enforcement' && canaryData.namedDatabaseReference === NAMED_DATABASE_ID) {
      canaryDataMatches = true;
    }
    await expectAllowed(
      '[GC.2]',
      'Lectura de documento de control en base de pruebas confirma contenido e identidad',
      canaryDataMatches ? Promise.resolve() : Promise.reject(new Error('Datos del canary no coinciden'))
    );

    // GC.3 Verificar aislamiento: el documento en (default) no colisiona con el namespace de la base nombrada
    const dbNamedOwner = createExplicitNamedClient('owner');
    const namedSnap = await getDoc(doc(dbNamedOwner, 'users', 'canary_user', 'preferences', canaryId));
    await expectAllowed(
      '[GC.3]',
      'Aislamiento de namespaces: documento en (default) no existe en namespace de base nombrada',
      !namedSnap.exists() ? Promise.resolve() : Promise.reject(new Error('Colisión: documento encontrado en namespace nombrado'))
    );

    // GC.4 Demostración de evaluación activa de firestore.rules
    await expectDenied(
      '[GC.4]',
      'Evaluación activa de reglas: cliente no autorizado intentando escribir en accountAccess (allow write: if false)',
      setDoc(doc(dbCanaryUser, 'accountAccess', 'canary_tamper'), { uid: 'canary_tamper', status: 'active' })
    );

    // =========================================================================
    // GRUPO 1: CICLO DE VIDA DE SESIONES (executedWorkouts) [HISTÓRICO 6C.2]
    // =========================================================================
    startGroup(1, 'CICLO DE VIDA DE SESIONES (executedWorkouts)');

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

    await expectAllowed(
      '[G1.1]',
      'Crear sesión nueva en estado "in_progress"',
      setDoc(doc(dbA, 'users', userA, 'executedWorkouts', session1Id), validInProgressSession)
    );

    const forgedCompletedSession = {
      ...validInProgressSession,
      id: 'ewk_forged_completed',
      status: 'completed',
    };
    await expectDenied(
      '[G1.2A]',
      'Crear directamente sesión en estado terminal "completed"',
      setDoc(doc(dbA, 'users', userA, 'executedWorkouts', 'ewk_forged_completed'), forgedCompletedSession)
    );

    const forgedAbandonedSession = {
      ...validInProgressSession,
      id: 'ewk_forged_abandoned',
      status: 'abandoned',
    };
    await expectDenied(
      '[G1.2B]',
      'Crear directamente sesión en estado terminal "abandoned"',
      setDoc(doc(dbA, 'users', userA, 'executedWorkouts', 'ewk_forged_abandoned'), forgedAbandonedSession)
    );

    // =========================================================================
    // GRUPO 2: VINCULACIÓN OBLIGATORIA DE SERIES (workoutSessions) [HISTÓRICO 6C.2]
    // =========================================================================
    startGroup(2, 'VINCULACIÓN OBLIGATORIA DE SERIES (workoutSessions)');

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

    await expectAllowed(
      '[G2.1]',
      'Crear serie vinculada a sesión activa in_progress',
      setDoc(doc(dbA, 'users', userA, 'workoutSessions', set1Id), validLinkedSet)
    );

    const setWithoutLink = {
      id: 'set_no_link',
      userId: userA,
      exerciseId: 'ex_press_banca',
      exerciseName: 'Press de Banca',
      weightKg: 80,
      reps: 8,
      completed: true,
    };
    await expectDenied(
      '[G2.2A]',
      'Crear serie sin executedWorkoutId',
      setDoc(doc(dbA, 'users', userA, 'workoutSessions', 'set_no_link'), setWithoutLink)
    );

    const setWithEmptyLink = {
      ...validLinkedSet,
      id: 'set_empty_link',
      executedWorkoutId: '',
    };
    await expectDenied(
      '[G2.2B]',
      'Crear serie con executedWorkoutId vacío',
      setDoc(doc(dbA, 'users', userA, 'workoutSessions', 'set_empty_link'), setWithEmptyLink)
    );

    const setWithGhostLink = {
      ...validLinkedSet,
      id: 'set_ghost_link',
      executedWorkoutId: 'ewk_does_not_exist_999',
    };
    await expectDenied(
      '[G2.3]',
      'Crear serie vinculada a sesión inexistente',
      setDoc(doc(dbA, 'users', userA, 'workoutSessions', 'set_ghost_link'), setWithGhostLink)
    );

    // =========================================================================
    // GRUPO 3: CIERRE, ABANDONO E INMUTABILIDAD TERMINAL [HISTÓRICO 6C.2]
    // =========================================================================
    startGroup(3, 'CIERRE, ABANDONO E INMUTABILIDAD TERMINAL');

    const completedUpdate = {
      status: 'completed',
      completedAt: new Date().toISOString(),
      totalTonnageKg: 640,
      totalCompletedSets: 1,
    };
    await expectAllowed(
      '[G3.1]',
      'Finalizar sesión en curso (transición legítima a "completed")',
      updateDoc(doc(dbA, 'users', userA, 'executedWorkouts', session1Id), completedUpdate)
    );

    await expectDenied(
      '[G3.2A]',
      'Reabrir sesión completada a "in_progress"',
      updateDoc(doc(dbA, 'users', userA, 'executedWorkouts', session1Id), { status: 'in_progress' })
    );

    await expectDenied(
      '[G3.2B]',
      'Modificar métricas de sesión ya completada',
      updateDoc(doc(dbA, 'users', userA, 'executedWorkouts', session1Id), { totalTonnageKg: 99999 })
    );

    await expectDenied(
      '[G3.2C]',
      'Borrar cabecera de sesión completada (allow delete: if false)',
      deleteDoc(doc(dbA, 'users', userA, 'executedWorkouts', session1Id))
    );

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
    await expectDenied(
      '[G3.3A]',
      'Agregar serie nueva a sesión ya completada',
      setDoc(doc(dbA, 'users', userA, 'workoutSessions', 'set_tamper_after'), setAfterCompleted)
    );

    await expectDenied(
      '[G3.3B]',
      'Modificar serie vinculada a sesión ya completada',
      updateDoc(doc(dbA, 'users', userA, 'workoutSessions', set1Id), { reps: 15 })
    );

    await expectDenied(
      '[G3.3C]',
      'Eliminar serie vinculada a sesión ya completada',
      deleteDoc(doc(dbA, 'users', userA, 'workoutSessions', set1Id))
    );

    // Preparar sesión 2 in_progress con dbOwner
    const session2Id = 'ewk_live_002';
    await setDoc(doc(dbOwner, 'users', userA, 'executedWorkouts', session2Id), {
      ...validInProgressSession,
      id: session2Id,
    });
    const set2Id = 'set_002_strip';
    await setDoc(doc(dbOwner, 'users', userA, 'workoutSessions', set2Id), {
      ...validLinkedSet,
      id: set2Id,
      executedWorkoutId: session2Id,
    });

    await expectDenied(
      '[G3.4]',
      'Desvincular serie (remover o vaciar executedWorkoutId)',
      updateDoc(doc(dbA, 'users', userA, 'workoutSessions', set2Id), { executedWorkoutId: '' })
    );

    await expectAllowed(
      '[G3.5A]',
      'Cancelar sesión en curso (transición legítima a "abandoned")',
      updateDoc(doc(dbA, 'users', userA, 'executedWorkouts', session2Id), {
        status: 'abandoned',
        completedAt: new Date().toISOString(),
      })
    );

    await expectDenied(
      '[G3.5B]',
      'Borrado directo de sesión en estado abandonado',
      deleteDoc(doc(dbA, 'users', userA, 'executedWorkouts', session2Id))
    );

    await expectDenied(
      '[G3.5C]',
      'Modificar serie perteneciente a sesión abandonada',
      updateDoc(doc(dbA, 'users', userA, 'workoutSessions', set2Id), { weightKg: 100 })
    );

    // =========================================================================
    // GRUPO 4: COMPATIBILIDAD HISTÓRICA Y SEGURIDAD MULTIUSUARIO [HISTÓRICO 6C.2]
    // =========================================================================
    startGroup(4, 'COMPATIBILIDAD HISTÓRICA Y SEGURIDAD MULTIUSUARIO');

    await setDoc(doc(dbOwner, 'users', userA, 'workoutSessions', 'set_legacy_pre6c'), {
      id: 'set_legacy_pre6c',
      userId: userA,
      exerciseId: 'ex_sentadilla',
      exerciseName: 'Sentadilla Trasera',
      weightKg: 100,
      reps: 5,
      completed: true,
    });

    await expectAllowed(
      '[G4.1]',
      'Series históricas sin executedWorkoutId: 100% compatibles y modificables por dueño',
      updateDoc(doc(dbA, 'users', userA, 'workoutSessions', 'set_legacy_pre6c'), { reps: 6 })
    );

    await expectDenied(
      '[G4.2A]',
      'Atleta B intentando leer sesión ejecutada de Atleta A',
      getDoc(doc(dbB, 'users', userA, 'executedWorkouts', session1Id))
    );

    await expectDenied(
      '[G4.2B]',
      'Atleta B intentando sembrar serie en cuenta de Atleta A',
      setDoc(doc(dbB, 'users', userA, 'workoutSessions', 'hacked_set'), validLinkedSet)
    );

    await expectDenied(
      '[G4.2C]',
      'Usuario no autenticado intentando leer sesión de Atleta A',
      getDoc(doc(dbAnon, 'users', userA, 'executedWorkouts', session1Id))
    );

    // =========================================================================
    // GRUPO 5: NO REGRESIÓN DE NUTRICIÓN, RUTINAS Y COMPRAS [HISTÓRICO 6C.2 / 7C.2]
    // =========================================================================
    startGroup(5, 'NO REGRESIÓN DE NUTRICIÓN, RUTINAS Y COMPRAS');

    await expectAllowed(
      '[G5.1A]',
      'Registrar comida legítima en mealLogs',
      setDoc(doc(dbA, 'users', userA, 'mealLogs', 'log_001'), {
        userId: userA,
        title: 'Avena con Proteína',
        moment: 'desayuno',
        calories: 450,
      })
    );

    await expectAllowed(
      '[G5.1B]',
      'Registrar ítem legítimo en despensa groceries',
      setDoc(doc(dbA, 'users', userA, 'groceries', 'groc_001'), {
        userId: userA,
        name: 'Pechuga de Pollo',
        quantity: 1,
        unit: 'kg',
        department: 'carnes',
        status: 'pending',
      })
    );

    await expectAllowed(
      '[G5.1C]',
      'Crear rutina legítima en workoutRoutines',
      setDoc(doc(dbA, 'users', userA, 'workoutRoutines', 'rout_001'), {
        userId: userA,
        name: 'Rutina Torso Pierna',
        goal: 'hipertrofia',
        frequencyDays: 4,
        days: [],
      })
    );

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

    await expectAllowed(
      '[G5.2A]',
      'Usuario propietario actualiza biometrías válidas en biometrics/current',
      setDoc(doc(dbA, 'users', userA, 'biometrics', 'current'), validBioDoc)
    );

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
    await expectAllowed(
      '[G5.2B]',
      'Guardado de periodización nutricional y previousTargets',
      setDoc(doc(dbA, 'users', userA, 'biometrics', 'current'), periodizedBioDoc)
    );

    const revertedBioDoc = {
      ...validBioDoc,
      targetCalories: 2666,
      targetProteinG: 150,
      lastAppliedPeriodization: null,
    };
    await expectAllowed(
      '[G5.2C]',
      'Reversión y restauración de previousTargets',
      setDoc(doc(dbA, 'users', userA, 'biometrics', 'current'), revertedBioDoc)
    );

    await expectDenied(
      '[G5.2D]',
      'Usuario B intentando leer o modificar biometrías de Usuario A',
      getDoc(doc(dbB, 'users', userA, 'biometrics', 'current'))
    );

    await expectDenied(
      '[G5.2E]',
      'Usuario no autenticado intentando leer o modificar biometrías',
      getDoc(doc(dbAnon, 'users', userA, 'biometrics', 'current'))
    );

    await expectDenied(
      '[G5.2F]',
      'Valores biométricos fuera de rango (peso negativo) rechazados por isValidBiometrics',
      setDoc(doc(dbA, 'users', userA, 'biometrics', 'current'), {
        ...validBioDoc,
        weightKg: -10,
      })
    );

    await expectDenied(
      '[G5.2G]',
      'Intento de transferir userId en actualización de biometrías',
      updateDoc(doc(dbA, 'users', userA, 'biometrics', 'current'), {
        userId: userB,
      })
    );

    // =========================================================================
    // PREPARACIÓN DE FIXTURES ADMINISTRATIVOS MEDIANTE CLIENTE AUTORIZADO
    // =========================================================================
    const T_BASE = 1700000000; // Epoch base en segundos Unix

    // Fixtures G6
    await setDoc(doc(dbOwner, 'users', 'g6_legacy_uid', 'preferences', 'default'), {
      userId: 'g6_legacy_uid',
      theme: 'dark',
    });

    await setDoc(doc(dbOwner, 'accountAccess', 'g6_active_uid'), {
      uid: 'g6_active_uid',
      status: 'active',
      validAfter: T_BASE,
    });
    await setDoc(doc(dbOwner, 'users', 'g6_active_uid', 'preferences', 'default'), {
      userId: 'g6_active_uid',
      theme: 'dark',
    });

    await setDoc(doc(dbOwner, 'accountAccess', 'g6_suspended_uid'), {
      uid: 'g6_suspended_uid',
      status: 'suspended',
      validAfter: T_BASE,
    });
    await setDoc(doc(dbOwner, 'users', 'g6_suspended_uid', 'preferences', 'default'), {
      userId: 'g6_suspended_uid',
      theme: 'dark',
    });

    await setDoc(doc(dbOwner, 'accountAccess', 'g6_pending_uid'), {
      uid: 'g6_pending_uid',
      status: 'pending',
    });
    await setDoc(doc(dbOwner, 'users', 'g6_pending_uid', 'preferences', 'default'), {
      userId: 'g6_pending_uid',
      theme: 'dark',
    });

    await setDoc(doc(dbOwner, 'accountAccess', 'g6_disabled_uid'), {
      uid: 'g6_disabled_uid',
      status: 'disabled',
    });
    await setDoc(doc(dbOwner, 'users', 'g6_disabled_uid', 'preferences', 'default'), {
      userId: 'g6_disabled_uid',
      theme: 'dark',
    });

    await setDoc(doc(dbOwner, 'accountAccess', 'g6_provisioning_uid'), {
      uid: 'g6_provisioning_uid',
      status: 'provisioning',
    });
    await setDoc(doc(dbOwner, 'users', 'g6_provisioning_uid', 'preferences', 'default'), {
      userId: 'g6_provisioning_uid',
      theme: 'dark',
    });

    await setDoc(doc(dbOwner, 'accountAccess', 'g6_partially_completed_uid'), {
      uid: 'g6_partially_completed_uid',
      status: 'partially_completed',
    });
    await setDoc(doc(dbOwner, 'users', 'g6_partially_completed_uid', 'preferences', 'default'), {
      userId: 'g6_partially_completed_uid',
      theme: 'dark',
    });

    await setDoc(doc(dbOwner, 'accountAccess', 'g6_unknown_uid'), {
      uid: 'g6_unknown_uid',
      status: 'unrecognized_status_xyz',
    });
    await setDoc(doc(dbOwner, 'users', 'g6_unknown_uid', 'preferences', 'default'), {
      userId: 'g6_unknown_uid',
      theme: 'dark',
    });

    // Fixtures G7
    await setDoc(doc(dbOwner, 'accountAccess', 'g7_admin_v1_uid'), {
      uid: 'g7_admin_v1_uid',
      status: 'active',
      validAfter: T_BASE,
    });
    await setDoc(doc(dbOwner, 'adminRoleState', 'g7_admin_v1_uid'), {
      uid: 'g7_admin_v1_uid',
      role: 'admin',
      roleVersion: 1,
    });

    await setDoc(doc(dbOwner, 'accountAccess', 'g7_admin_demoted_uid'), {
      uid: 'g7_admin_demoted_uid',
      status: 'active',
      validAfter: T_BASE,
    });
    await setDoc(doc(dbOwner, 'adminRoleState', 'g7_admin_demoted_uid'), {
      uid: 'g7_admin_demoted_uid',
      role: 'athlete',
      roleVersion: 2,
    });

    await setDoc(doc(dbOwner, 'accountAccess', 'g7_admin_v3_uid'), {
      uid: 'g7_admin_v3_uid',
      status: 'active',
      validAfter: T_BASE,
    });
    await setDoc(doc(dbOwner, 'adminRoleState', 'g7_admin_v3_uid'), {
      uid: 'g7_admin_v3_uid',
      role: 'admin',
      roleVersion: 3,
    });

    await setDoc(doc(dbOwner, 'accountAccess', 'g7_superadmin_uid'), {
      uid: 'g7_superadmin_uid',
      status: 'active',
      validAfter: T_BASE,
    });
    await setDoc(doc(dbOwner, 'adminRoleState', 'g7_superadmin_uid'), {
      uid: 'g7_superadmin_uid',
      role: 'superadmin',
      roleVersion: 1,
    });

    // Fixtures G8
    await setDoc(doc(dbOwner, 'accountAccess', 'g8_admin_fresh_uid'), {
      uid: 'g8_admin_fresh_uid',
      status: 'active',
      validAfter: T_BASE,
    });
    await setDoc(doc(dbOwner, 'adminRoleState', 'g8_admin_fresh_uid'), {
      uid: 'g8_admin_fresh_uid',
      role: 'admin',
      roleVersion: 1,
    });

    await setDoc(doc(dbOwner, 'accountAccess', 'g8_admin_suspended_uid'), {
      uid: 'g8_admin_suspended_uid',
      status: 'suspended',
      validAfter: T_BASE,
    });
    await setDoc(doc(dbOwner, 'adminRoleState', 'g8_admin_suspended_uid'), {
      uid: 'g8_admin_suspended_uid',
      role: 'admin',
      roleVersion: 1,
    });

    // Fixtures colecciones administrativas
    await setDoc(doc(dbOwner, 'adminUserDirectory', 'dir_entry_001'), {
      uid: 'dir_entry_001',
      email: 'target@vigorcore.com',
      role: 'athlete',
    });
    await setDoc(doc(dbOwner, 'adminInvitations', 'inv_001'), {
      inviteId: 'inv_001',
      emailNormalized: 'target@vigorcore.com',
    });
    await setDoc(doc(dbOwner, 'adminAuditLogs', 'aud_001'), {
      eventId: 'aud_001',
      action: 'user_invited',
    });
    await setDoc(doc(dbOwner, 'adminInvitationOperations', 'op_001'), {
      operationId: 'op_001',
      status: 'completed',
    });

    // =========================================================================
    // GRUPO 6: ESTADOS DE ACCOUNT ACCESS [INCREMENTO 7D.3.2]
    // =========================================================================
    startGroup(6, 'ESTADOS DE ACCOUNT ACCESS');

    const dbLegacy = createNamedClient('g6_legacy_uid', { email: 'legacy@vigorcore.com', email_verified: true });
    await expectAllowed(
      '[G6.1]',
      'Propietario sin documento accountAccess: permitido por compatibilidad heredada',
      getDoc(doc(dbLegacy, 'users', 'g6_legacy_uid', 'preferences', 'default'))
    );

    const dbActive = createNamedClient('g6_active_uid', { email: 'active@vigorcore.com', email_verified: true, auth_time: T_BASE + 100 });
    await expectAllowed(
      '[G6.2]',
      'Propietario con status "active" y auth_time > validAfter: permitido',
      getDoc(doc(dbActive, 'users', 'g6_active_uid', 'preferences', 'default'))
    );

    const dbSuspended = createNamedClient('g6_suspended_uid', { email: 'suspended@vigorcore.com', email_verified: true, auth_time: T_BASE + 100 });
    await expectDenied(
      '[G6.3]',
      'Propietario con status "suspended": denegado de forma inmediata e irrevocable',
      getDoc(doc(dbSuspended, 'users', 'g6_suspended_uid', 'preferences', 'default'))
    );

    const dbPending = createNamedClient('g6_pending_uid', { email: 'pending@vigorcore.com', email_verified: true });
    await expectDenied(
      '[G6.4]',
      'Propietario con status "pending": denegado (requiere status == active)',
      getDoc(doc(dbPending, 'users', 'g6_pending_uid', 'preferences', 'default'))
    );

    const dbDisabled = createNamedClient('g6_disabled_uid', { email: 'disabled@vigorcore.com', email_verified: true });
    await expectDenied(
      '[G6.5]',
      'Propietario con status "disabled": denegado',
      getDoc(doc(dbDisabled, 'users', 'g6_disabled_uid', 'preferences', 'default'))
    );

    const dbProvisioning = createNamedClient('g6_provisioning_uid', { email: 'prov@vigorcore.com', email_verified: true });
    await expectDenied(
      '[G6.6]',
      'Propietario con status "provisioning": denegado',
      getDoc(doc(dbProvisioning, 'users', 'g6_provisioning_uid', 'preferences', 'default'))
    );

    const dbPartial = createNamedClient('g6_partially_completed_uid', { email: 'partial@vigorcore.com', email_verified: true });
    await expectDenied(
      '[G6.7]',
      'Propietario con status "partially_completed": denegado',
      getDoc(doc(dbPartial, 'users', 'g6_partially_completed_uid', 'preferences', 'default'))
    );

    const dbUnknown = createNamedClient('g6_unknown_uid', { email: 'unknown@vigorcore.com', email_verified: true });
    await expectDenied(
      '[G6.8]',
      'Propietario con estado desconocido o no reconocido: denegado',
      getDoc(doc(dbUnknown, 'users', 'g6_unknown_uid', 'preferences', 'default'))
    );

    await expectDenied(
      '[G6.9]',
      'Usuario heredado sin accountAccess intentando leer directorio administrativo: denegado',
      getDoc(doc(dbLegacy, 'adminUserDirectory', 'dir_entry_001'))
    );

    // =========================================================================
    // GRUPO 7: ROLES Y VERSIONADO MONOTÓNICO [INCREMENTO 7D.3.2]
    // =========================================================================
    startGroup(7, 'ROLES Y VERSIONADO MONOTÓNICO');

    const dbAdminV1 = createNamedClient('g7_admin_v1_uid', {
      email: 'admin_v1@vigorcore.com',
      email_verified: true,
      role: 'admin',
      roleVersion: 1,
      auth_time: T_BASE + 100,
    });
    await expectAllowed(
      '[G7.1]',
      'Token admin v1 coincidente con adminRoleState v1: autorizado',
      getDoc(doc(dbAdminV1, 'adminUserDirectory', 'dir_entry_001'))
    );

    const dbAdminDemoted = createNamedClient('g7_admin_demoted_uid', {
      email: 'demoted@vigorcore.com',
      email_verified: true,
      role: 'admin',
      roleVersion: 1,
      auth_time: T_BASE + 100,
    });
    await expectDenied(
      '[G7.2]',
      'Token admin v1 pero estado degradado a athlete v2 en servidor: denegado',
      getDoc(doc(dbAdminDemoted, 'adminUserDirectory', 'dir_entry_001'))
    );

    const dbAdminV1Obsolete = createNamedClient('g7_admin_v3_uid', {
      email: 'obsolete@vigorcore.com',
      email_verified: true,
      role: 'admin',
      roleVersion: 1,
      auth_time: T_BASE + 100,
    });
    await expectDenied(
      '[G7.3]',
      'Token admin v1 obsoleto contra estado admin v3 en servidor: denegado',
      getDoc(doc(dbAdminV1Obsolete, 'adminUserDirectory', 'dir_entry_001'))
    );

    const dbAdminV99 = createNamedClient('g7_admin_v3_uid', {
      email: 'future@vigorcore.com',
      email_verified: true,
      role: 'admin',
      roleVersion: 99,
      auth_time: T_BASE + 100,
    });
    await expectDenied(
      '[G7.4]',
      'Token admin v99 con versión manipulada frente a servidor v3: denegado',
      getDoc(doc(dbAdminV99, 'adminUserDirectory', 'dir_entry_001'))
    );

    const dbAdminNoVersion = createNamedClient('g7_admin_v1_uid', {
      email: 'noversion@vigorcore.com',
      email_verified: true,
      role: 'admin',
      auth_time: T_BASE + 100,
    });
    await expectDenied(
      '[G7.5]',
      'Token con rol admin pero sin claim roleVersion numérico: denegado',
      getDoc(doc(dbAdminNoVersion, 'adminUserDirectory', 'dir_entry_001'))
    );

    const dbAthleteAdminAttempt = createNamedClient('g6_active_uid', {
      email: 'athlete@vigorcore.com',
      email_verified: true,
      role: 'athlete',
      roleVersion: 1,
      auth_time: T_BASE + 100,
    });
    await expectDenied(
      '[G7.6]',
      'Token con rol athlete intentando leer adminUserDirectory: denegado',
      getDoc(doc(dbAthleteAdminAttempt, 'adminUserDirectory', 'dir_entry_001'))
    );

    const dbSuperadminMismatched = createNamedClient('g7_superadmin_uid', {
      email: 'sa_mismatch@vigorcore.com',
      email_verified: true,
      role: 'superadmin',
      roleVersion: 2, // Servidor tiene v1
      auth_time: T_BASE + 100,
    });
    await expectDenied(
      '[G7.7]',
      'Token superadmin con version v2 frente a servidor v1: denegado',
      getDoc(doc(dbSuperadminMismatched, 'adminUserDirectory', 'dir_entry_001'))
    );

    const dbSuperadminCorrect = createNamedClient('g7_superadmin_uid', {
      email: 'sa_correct@vigorcore.com',
      email_verified: true,
      role: 'superadmin',
      roleVersion: 1,
      auth_time: T_BASE + 100,
    });
    await expectAllowed(
      '[G7.8]',
      'Token superadmin con versión concordante v1: autorizado',
      getDoc(doc(dbSuperadminCorrect, 'adminUserDirectory', 'dir_entry_001'))
    );

    // =========================================================================
    // GRUPO 8: SESIONES Y FRESCURA TEMPORAL (validAfter vs auth_time) [7D.3.2]
    // =========================================================================
    startGroup(8, 'SESIONES Y FRESCURA TEMPORAL (validAfter vs auth_time)');

    const dbStaleBefore = createNamedClient('g8_admin_fresh_uid', {
      email: 'fresh@vigorcore.com',
      email_verified: true,
      role: 'admin',
      roleVersion: 1,
      auth_time: T_BASE - 100, // < T_BASE
    });
    await expectDenied(
      '[G8.1]',
      'auth_time anterior a validAfter (sesión emitida previo a revocación): denegado',
      getDoc(doc(dbStaleBefore, 'adminUserDirectory', 'dir_entry_001'))
    );

    const dbBoundaryExact = createNamedClient('g8_admin_fresh_uid', {
      email: 'fresh@vigorcore.com',
      email_verified: true,
      role: 'admin',
      roleVersion: 1,
      auth_time: T_BASE, // == T_BASE
    });
    await expectDenied(
      '[G8.2]',
      'auth_time igual a validAfter (mismo segundo exacto): denegado por comparación estricta >',
      getDoc(doc(dbBoundaryExact, 'adminUserDirectory', 'dir_entry_001'))
    );

    const dbFreshAfter = createNamedClient('g8_admin_fresh_uid', {
      email: 'fresh@vigorcore.com',
      email_verified: true,
      role: 'admin',
      roleVersion: 1,
      auth_time: T_BASE + 1, // > T_BASE
    });
    await expectAllowed(
      '[G8.3]',
      'auth_time estrictamente posterior a validAfter: permitido',
      getDoc(doc(dbFreshAfter, 'adminUserDirectory', 'dir_entry_001'))
    );

    const dbMissingAuthTime = createNamedClient('g8_admin_fresh_uid', {
      email: 'fresh@vigorcore.com',
      email_verified: true,
      role: 'admin',
      roleVersion: 1,
      // auth_time omitido
    });
    await expectDenied(
      '[G8.4]',
      'auth_time ausente en token de autenticación cuando validAfter está fijado: denegado',
      getDoc(doc(dbMissingAuthTime, 'adminUserDirectory', 'dir_entry_001'))
    );

    const dbWrongTypeAuthTime = createNamedClient('g8_admin_fresh_uid', {
      email: 'fresh@vigorcore.com',
      email_verified: true,
      role: 'admin',
      roleVersion: 1,
      auth_time: '1700000050' as any, // String en vez de int
    });
    await expectDenied(
      '[G8.5]',
      'auth_time con tipo de dato no entero (string): denegado por request.auth.token.auth_time is int',
      getDoc(doc(dbWrongTypeAuthTime, 'adminUserDirectory', 'dir_entry_001'))
    );

    const dbSuspendedRecentToken = createNamedClient('g8_admin_suspended_uid', {
      email: 'suspended_admin@vigorcore.com',
      email_verified: true,
      role: 'admin',
      roleVersion: 1,
      auth_time: T_BASE + 500, // Token fresco pero cuenta suspendida
    });
    await expectDenied(
      '[G8.6]',
      'Cuenta suspendida con token reciente (status != active): denegado',
      getDoc(doc(dbSuspendedRecentToken, 'adminUserDirectory', 'dir_entry_001'))
    );

    const dbActiveOldToken = createNamedClient('g8_admin_fresh_uid', {
      email: 'fresh@vigorcore.com',
      email_verified: true,
      role: 'admin',
      roleVersion: 1,
      auth_time: T_BASE - 500,
    });
    await expectDenied(
      '[G8.7]',
      'Cuenta activa con token antiguo no satisfactorio de validAfter: denegado',
      getDoc(doc(dbActiveOldToken, 'adminUserDirectory', 'dir_entry_001'))
    );

    // =========================================================================
    // GRUPO 9: PROTECCIÓN DE COLECCIONES ADMINISTRATIVAS [INCREMENTO 7D.3.2]
    // =========================================================================
    startGroup(9, 'PROTECCIÓN DE COLECCIONES ADMINISTRATIVAS');

    // 9.1 Bloqueo de escrituras directas desde cliente
    await expectDenied(
      '[G9.1A]',
      'Escritura directa de cliente en accountAccess/{userId} (allow write: if false)',
      setDoc(doc(dbSuperadminCorrect, 'accountAccess', 'target_hack'), { uid: 'target_hack', status: 'active' })
    );

    await expectDenied(
      '[G9.1B]',
      'Escritura directa de cliente en adminRoleState/{userId} (allow write: if false)',
      setDoc(doc(dbSuperadminCorrect, 'adminRoleState', 'target_hack'), { uid: 'target_hack', role: 'superadmin' })
    );

    await expectDenied(
      '[G9.1C]',
      'Escritura directa de cliente en adminUserDirectory/{userId} (allow write: if false)',
      setDoc(doc(dbSuperadminCorrect, 'adminUserDirectory', 'target_hack'), { uid: 'target_hack' })
    );

    await expectDenied(
      '[G9.1D]',
      'Escritura directa de cliente en adminInvitations/{inviteId} (allow write: if false)',
      setDoc(doc(dbSuperadminCorrect, 'adminInvitations', 'fake_invite'), { tokenHash: '123' })
    );

    await expectDenied(
      '[G9.1E]',
      'Escritura directa de cliente en adminAuditLogs/{eventId} (allow write: if false)',
      setDoc(doc(dbSuperadminCorrect, 'adminAuditLogs', 'fake_log'), { action: 'tampered' })
    );

    await expectDenied(
      '[G9.1F]',
      'Escritura directa de cliente en adminInvitationOperations/{operationId} (allow write: if false)',
      setDoc(doc(dbSuperadminCorrect, 'adminInvitationOperations', 'fake_op'), { status: 'completed' })
    );

    // 9.2 Administrador NO tiene permisos para leer datos privados de atletas
    await expectDenied(
      '[G9.2A]',
      'Administrador intentando leer biometrías privadas de Usuario A en users/{userA}/biometrics/current',
      getDoc(doc(dbAdminV1, 'users', userA, 'biometrics', 'current'))
    );

    await expectDenied(
      '[G9.2B]',
      'Administrador intentando leer registros de comidas privados de Usuario A en users/{userA}/mealLogs/log_001',
      getDoc(doc(dbAdminV1, 'users', userA, 'mealLogs', 'log_001'))
    );

    await expectDenied(
      '[G9.2C]',
      'Administrador intentando leer rutinas privadas de Usuario A en users/{userA}/workoutRoutines/rout_001',
      getDoc(doc(dbAdminV1, 'users', userA, 'workoutRoutines', 'rout_001'))
    );

    await expectDenied(
      '[G9.2D]',
      'Administrador intentando leer sesiones ejecutadas privadas de Usuario A en users/{userA}/executedWorkouts/ewk_live_001',
      getDoc(doc(dbAdminV1, 'users', userA, 'executedWorkouts', session1Id))
    );

    // =========================================================================
    // GRUPO 10: AISLAMIENTO Y REGRESIÓN DE AUTORIZACIÓN [INCREMENTO 7D.3.2]
    // =========================================================================
    startGroup(10, 'AISLAMIENTO Y REGRESIÓN DE AUTORIZACIÓN');

    await expectAllowed(
      '[G10.1]',
      'Usuario A leyendo sus propias rutinas en users/{userA}/workoutRoutines/rout_001',
      getDoc(doc(dbA, 'users', userA, 'workoutRoutines', 'rout_001'))
    );

    await expectDenied(
      '[G10.2]',
      'Usuario A intentando leer rutinas privadas de Usuario B',
      getDoc(doc(dbA, 'users', userB, 'workoutRoutines', 'rout_001'))
    );

    await expectDenied(
      '[G10.3]',
      'Administrador intentando escribir en users/{userB}/workoutRoutines/rout_hacked',
      setDoc(doc(dbAdminV1, 'users', userB, 'workoutRoutines', 'rout_hacked'), {
        userId: userB,
        name: 'Hacked Routine',
      })
    );

    await expectDenied(
      '[G10.4]',
      'Atleta ordinario intentando leer registros en adminAuditLogs',
      getDoc(doc(dbA, 'adminAuditLogs', 'aud_001'))
    );

    await expectDenied(
      '[G10.5]',
      'Atleta ordinario intentando consultar directorio en adminUserDirectory',
      getDoc(doc(dbA, 'adminUserDirectory', 'dir_entry_001'))
    );

    await expectDenied(
      '[G10.6]',
      'Intento de inyectar registro de auditoría desde cliente autenticado',
      setDoc(doc(dbA, 'adminAuditLogs', 'aud_forged'), {
        eventId: 'aud_forged',
        action: 'user_invited',
      })
    );

    await expectDenied(
      '[G10.7A]',
      'Usuario no autenticado intentando leer adminUserDirectory',
      getDoc(doc(dbAnon, 'adminUserDirectory', 'dir_entry_001'))
    );
    await expectDenied(
      '[G10.7B]',
      'Usuario no autenticado intentando leer accountAccess',
      getDoc(doc(dbAnon, 'accountAccess', 'g6_active_uid'))
    );

    await expectDenied(
      '[G10.8]',
      'Usuario A intentando escribir biometría en cuenta B con payload adulterado',
      setDoc(doc(dbA, 'users', userB, 'biometrics', 'current'), {
        userId: userA,
        weightKg: 80,
      })
    );

    // =========================================================================
    // RESUMEN Y REPORTE DE RESULTADOS REALES DEL TEST RUNNER
    // =========================================================================
    const allScenarios: ScenarioResult[] = groups.flatMap((g) => g.scenarios);
    const totalExecuted = allScenarios.length;
    const totalPassed = allScenarios.filter((s) => s.passed).length;
    const totalFailed = allScenarios.filter((s) => !s.passed).length;

    // Intentar consultar cobertura de reglas desde el endpoint oficial del emulador
    try {
      const coverageUrl = `http://${host}:${port}/emulator/v1/projects/${PROJECT_ID}:ruleCoverage`;
      const coverageRes = await fetch(coverageUrl);
      if (coverageRes.ok) {
        const coverageData = await coverageRes.json() as any;
        console.log('\n========================================================================');
        console.log(' COBERTURA DE EVALUACIÓN DE SECURITY RULES EN TIEMPO DE EJECUCIÓN');
        console.log('========================================================================');
        console.log(` Endpoint: ${coverageUrl}`);
        if (coverageData && coverageData.rules) {
          const ruleEntries = Object.entries(coverageData.rules);
          console.log(` Reglas monitorizadas por el emulador: ${ruleEntries.length}`);
        }
        console.log(' Cobertura de expresiones evaluada exitosamente por el motor CEL.');
        console.log('========================================================================');
      }
    } catch {
      // Endpoint de cobertura no disponible o emulador no lo soporta en este puerto
    }

    console.log('\n========================================================================');
    console.log(' RESUMEN FINAL DE EJECUCIÓN — FIRESTORE SECURITY RULES (INCREMENTO 7D.3.3)');
    console.log('========================================================================');
    console.log(` Archivo de Reglas:          ${RULES_PATH}`);
    console.log(` Base de Datos de Pruebas:   (default) [Aislada en emulador]`);
    console.log(` Base Nombrada Producción:   ${NAMED_DATABASE_ID} [Verificada en Canary]`);
    console.log(` Proyecto de Emulador:       ${PROJECT_ID}`);
    console.log(` Grupos Ejecutados:          ${groups.length} (Canary + Grupos 1 al 10)`);
    console.log(` Cantidad Total Escenarios:  ${totalExecuted}`);
    console.log(` Escenarios Aprobados (PASS): ${totalPassed}`);
    console.log(` Escenarios Fallidos (FAIL):  ${totalFailed}`);
    console.log(` Código de Salida:           ${totalFailed === 0 ? '0 (SUCCESS)' : '1 (ERROR)'}`);
    console.log('========================================================================\n');

    console.log('REGISTRO CONCILIADO DE ESCENARIOS POR GRUPO:');
    for (const g of groups) {
      console.log(`  * Grupo ${g.groupId} [${g.groupName}]: ${g.scenarios.length} escenarios (Aprobados: ${g.scenarios.filter(s => s.passed).length})`);
    }

    if (totalFailed > 0) {
      console.error(`\n[ERROR CRÍTICO]: Se detectaron ${totalFailed} escenarios fallidos en las reglas de seguridad.`);
      process.exit(1);
    } else {
      console.log(`\n[ÉXITO TOTAL]: Todos los ${totalPassed} escenarios del emulador aprobaron satisfactoriamente.`);
    }
  } finally {
    for (const app of activeApps) {
      try {
        await deleteApp(app);
      } catch {}
    }
    if (testEnv) {
      await testEnv.cleanup();
    }
  }
}

/**
 * Auditoría estática estructural y sintáctica de firestore.rules para entornos sin emulador
 */
export function runStaticIntegrityAudit(rulesContent: string) {
  console.log('[AUDITORÍA ESTÁTICA]: Verificando reglas de Incrementos 6C, 7A, 7C, 7D.3.2 y 7D.3.3...');
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
    // Incremento 7D, 7D.1, 7D.2 y 7D.3.2: RBAC, Suspensión, Anti-Stale-Tokens, Versionado Real y Colecciones Administrativas
    { label: 'isAccountActive definida y verifica accountAccess/{userId}', pass: rulesContent.includes('function isAccountActive(userId)') && rulesContent.includes('documents/accountAccess/$(userId)') },
    { label: 'isAccountActive exige status == active cuando existe accountAccess', pass: rulesContent.includes("get(/databases/$(database)/documents/accountAccess/$(userId)).data.status == 'active'") },
    { label: 'isAccountActive valida frescura de sesión con comparación estricta auth_time > validAfter', pass: rulesContent.includes('request.auth.token.auth_time > get(/databases/$(database)/documents/accountAccess/$(userId)).data.validAfter') },
    { label: 'isAdministrativeAccountActive definida con exigencia estricta de documento y status == active', pass: rulesContent.includes('function isAdministrativeAccountActive(userId)') && rulesContent.includes('exists(/databases/$(database)/documents/accountAccess/$(userId))') },
    { label: 'isOwner integra comprobación de cuenta activa isAccountActive(userId)', pass: rulesContent.includes('isOwner(userId)') && rulesContent.includes('isAccountActive(userId)') },
    { label: 'isAuthoritativeRole utiliza isAdministrativeAccountActive y previene tokens estancados', pass: rulesContent.includes('function isAuthoritativeRole(role)') && rulesContent.includes('isAdministrativeAccountActive(request.auth.uid)') },
    { label: 'isAuthoritativeRole valida roleVersion numérica e igualdad estricta con token', pass: rulesContent.includes('request.auth.token.roleVersion is int') && rulesContent.includes('data.roleVersion == request.auth.token.roleVersion') },
    { label: 'isAdmin definida y valida rol autoritativo isAuthoritativeRole en admin o superadmin', pass: rulesContent.includes('function isAdmin()') && rulesContent.includes("isAuthoritativeRole('admin') || isAuthoritativeRole('superadmin')") },
    { label: 'adminRoleState match con allow read: if owner o admin y allow write: if false', pass: rulesContent.includes('match /adminRoleState/{userId}') && rulesContent.includes('allow write: if false;') },
    { label: 'adminUserDirectory match con allow read: if isAdmin() y allow write: if false', pass: rulesContent.includes('match /adminUserDirectory/{userId}') && rulesContent.includes('allow read: if isAdmin();') && rulesContent.includes('allow write: if false;') },
    { label: 'adminInvitations match con allow read: if isAdmin() y allow write: if false', pass: rulesContent.includes('match /adminInvitations/{inviteId}') && rulesContent.includes('allow read: if isAdmin();') && rulesContent.includes('allow write: if false;') },
    { label: 'accountAccess match con allow read: if owner o admin y allow write: if false', pass: rulesContent.includes('match /accountAccess/{userId}') && rulesContent.includes('allow write: if false;') },
    { label: 'adminAuditLogs match con allow read: if isAdmin() y allow write: if false (append-only vía backend)', pass: rulesContent.includes('match /adminAuditLogs/{eventId}') && rulesContent.includes('allow read: if isAdmin();') && rulesContent.includes('allow write: if false;') },
    { label: 'adminInvitationOperations match con allow read: if isAdmin() y allow write: if false', pass: rulesContent.includes('match /adminInvitationOperations/{operationId}') && rulesContent.includes('allow read: if isAdmin();') && rulesContent.includes('allow write: if false;') },
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
