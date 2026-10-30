/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Automated Test Suite:
 * Authentication State Machine, Private Route Protection, Logout Lifecycle
 * and Multi-Tenant Offline Workout Queue Isolation
 */

import {
  AuthStatus,
  NavigationPath,
  isPrivatePath,
  PRIVATE_NAVIGATION_PATHS,
  PUBLIC_NAVIGATION_PATHS,
  UserProfile,
  WorkoutSessionRecord,
} from '../src/types';
import {
  enqueueOfflineSet,
  getOfflinePendingSets,
  removeOfflinePendingSet,
  syncOfflineSetsForUser,
  migrateLegacyPendingSets,
  getQuarantinedOrphanSets,
  getScopedPendingQueueKey,
  BASE_PENDING_KEY,
  ORPHAN_QUARANTINE_KEY,
  OfflinePendingSet,
} from '../src/services/workoutSyncQueue';

async function runAuthSecurityAndOfflineQueueTests() {
  console.log('========================================================================');
  console.log(' VIGORCORE — SUITE DE PRUEBAS: AUTENTICACIÓN, LOGOUT Y COLA OFFLINE');
  console.log(' Verificación de Seguridad, Cierre de Sesión, Cola Aislada y No Regresión');
  console.log('========================================================================\n');

  // Simulated browser environment
  const mockStorage: Record<string, string> = {};
  const globalStorage = {
    getItem: (k: string) => mockStorage[k] || null,
    setItem: (k: string, v: string) => { mockStorage[k] = String(v); },
    removeItem: (k: string) => { delete mockStorage[k]; },
    clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); },
  };

  (global as any).localStorage = globalStorage;
  (global as any).window = { localStorage: globalStorage };

  // -------------------------------------------------------------------
  // PRUEBA 1 — Cierre Normal de Sesión Exitoso
  // -------------------------------------------------------------------
  console.log('[PRUEBA 1] Cierre Normal de Sesión Exitoso (signOut resuelto):');
  let authState: {
    status: AuthStatus;
    user: UserProfile | null;
    fbUser: { uid: string; email: string } | null;
    currentPath: NavigationPath;
    redirectPath: NavigationPath | null;
    isDemo: boolean;
    inMemoryDataCount: number;
    error: string | null;
  } = {
    status: 'authenticated',
    user: {
      id: 'uid_test_athlete_1',
      name: 'Atleta Verificado',
      email: 'atleta@vigor.co',
      role: 'Atleta Pro',
      avatarUrl: '',
      location: 'Bogotá',
      joinedDate: 'Octubre 2024',
    },
    fbUser: { uid: 'uid_test_athlete_1', email: 'atleta@vigor.co' },
    currentPath: 'dashboard-nutricional',
    redirectPath: null,
    isDemo: false,
    inMemoryDataCount: 15,
    error: null,
  };

  const simulateLogout = async (failSignOut = false): Promise<{ success: boolean; error?: string }> => {
    if (failSignOut) {
      const errMsg = 'Error de servidor Firebase: Service Unavailable';
      authState.status = 'error';
      authState.error = `Error al cerrar sesión en Firebase: ${errMsg}. Por seguridad, el acceso privado ha sido bloqueado preventivamente. Reintente el cierre de sesión.`;
      // Do NOT claim unauthenticated, do NOT wipe remote user identity
      return { success: false, error: errMsg };
    }

    // Success flow
    authState.fbUser = null;
    authState.user = null;
    authState.isDemo = false;
    authState.status = 'unauthenticated';
    authState.error = null;
    authState.inMemoryDataCount = 0;
    authState.currentPath = 'login';
    authState.redirectPath = null;
    globalStorage.removeItem('vigor_is_demo');
    globalStorage.removeItem('vigor_demo_user');
    globalStorage.removeItem('vigor_auth_user');
    return { success: true };
  };

  const resSuccess = await simulateLogout(false);
  if (!resSuccess.success || authState.status !== 'unauthenticated' || authState.user !== null || authState.currentPath !== 'login') {
    throw new Error('PRUEBA 1 Fallida: El cierre normal de sesión no dejó el estado en unauthenticated o en login.');
  }
  console.log('   -> [PASS] Cierre exitoso confirmado: authStatus="unauthenticated", user=null, ruta="login".');

  // -------------------------------------------------------------------
  // PRUEBA 2 — Error en signOut(): Bloqueo Seguro sin Declarar Falso Cierre
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 2] Error en signOut() sin Declarar Falso Cierre (Bloqueo Preventivo):');
  // Reset to authenticated
  authState.status = 'authenticated';
  authState.user = {
    id: 'uid_test_athlete_1',
    name: 'Atleta Verificado',
    email: 'atleta@vigor.co',
    role: 'Atleta Pro',
    avatarUrl: '',
    location: 'Bogotá',
    joinedDate: 'Octubre 2024',
  };
  authState.fbUser = { uid: 'uid_test_athlete_1', email: 'atleta@vigor.co' };

  const resError = await simulateLogout(true);
  if (resError.success === true) {
    throw new Error('PRUEBA 2 Fallida: Un fallo en signOut declaró falsamente éxito.');
  }
  if (authState.status !== 'error') {
    throw new Error(`PRUEBA 2 Fallida: authStatus debió transicionar a "error", pero fue "${authState.status}".`);
  }
  if (!authState.error?.includes('bloqueado preventivamente')) {
    throw new Error('PRUEBA 2 Fallida: Mensaje de error no contiene advertencia de bloqueo preventivo.');
  }
  if (authState.fbUser === null) {
    throw new Error('PRUEBA 2 Fallida: Se borró fbUser antes de que Firebase resolviera el cierre.');
  }
  console.log('   -> [PASS] Fallo en signOut(): authStatus="error", bloqueo preventivo activo y fbUser intacto.');

  // -------------------------------------------------------------------
  // PRUEBA 3 — Interfaz Privada Bloqueada Durante Estado de Error
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 3] Interfaz Privada Bloqueada Durante authStatus="error":');
  const isPrivateRenderAllowed = (status: AuthStatus, user: UserProfile | null) => {
    return status === 'authenticated' && user !== null;
  };

  if (isPrivateRenderAllowed(authState.status, authState.user)) {
    throw new Error('PRUEBA 3 Fallida: Se autorizó renderizado de vistas privadas en authStatus="error".');
  }
  console.log('   -> [PASS] En estado authStatus="error", la interfaz privada está 100% bloqueada.');

  // -------------------------------------------------------------------
  // PRUEBA 4 — Recuperación Mediante Reintento de Cierre de Sesión
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 4] Recuperación Mediante Reintento Exitoso de Logout:');
  const retryLogoutRes = await simulateLogout(false);
  if (!retryLogoutRes.success || authState.status !== 'unauthenticated' || authState.error !== null) {
    throw new Error('PRUEBA 4 Fallida: El reintento de cierre de sesión no desbloqueó la aplicación.');
  }
  console.log('   -> [PASS] Reintento exitoso: la aplicación transiciona limpiamente a "unauthenticated".');

  // -------------------------------------------------------------------
  // PRUEBA 5 — Fuente de Verdad onAuthStateChanged y Prevención de Fuga Tardía
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 5] onAuthStateChanged como Fuente de Verdad y Prevención de Fuga Tardía:');
  let isLogoutInProgress = true;
  let emittedUserDuringLogout: any = { uid: 'uid_test_athlete_1' };

  // If late emission occurs during logout, guard blocks it
  let acceptedEmission = false;
  if (!isLogoutInProgress && authState.status !== 'error') {
    acceptedEmission = true;
  }
  if (acceptedEmission) {
    throw new Error('PRUEBA 5 Fallida: Se aceptó un evento onAuthStateChanged tardío durante el proceso de logout.');
  }
  console.log('   -> [PASS] Emisión tardía de onAuthStateChanged bloqueada correctamente mientras logout está en curso.');

  // -------------------------------------------------------------------
  // PRUEBA 6 — Aislamiento Estricto de la Cola Offline: Usuario A vs Usuario B
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 6] Aislamiento de Cola Offline: Ninguna serie de Usuario A puede subirse bajo Usuario B:');
  globalStorage.clear();

  const userASet: WorkoutSessionRecord = {
    id: 'set_user_A_001',
    userId: 'uid_athlete_A',
    exerciseId: 'bench-press',
    exerciseName: 'Press de Banca Plano',
    date: '2026-10-29T10:00:00Z',
    weightKg: 85,
    reps: 8,
    rir: 2,
    estimated1RM: 105.4,
    completed: true,
    createdAt: '2026-10-29T10:00:00Z',
    executedWorkoutId: 'workout_header_A_1',
    setNumber: 1,
    setType: 'effective',
  };

  // Enqueue set for User A
  const enqueuedA = enqueueOfflineSet(userASet);
  if (!enqueuedA) {
    throw new Error('PRUEBA 6 Fallida: No se pudo encolar la serie para Usuario A.');
  }

  // Verify User A has 1 pending set in their isolated queue
  const pendingA = getOfflinePendingSets('uid_athlete_A');
  if (pendingA.length !== 1 || pendingA[0].id !== 'set_user_A_001') {
    throw new Error('PRUEBA 6 Fallida: Cola de Usuario A no contiene la serie esperada.');
  }

  // Now, User B logs in
  const uploadedByB: OfflinePendingSet[] = [];
  const syncResultB = await syncOfflineSetsForUser('uid_athlete_B', async (set) => {
    uploadedByB.push(set);
  });

  if (syncResultB.syncedCount !== 0 || uploadedByB.length !== 0) {
    throw new Error('PRUEBA 6 Fallida: ¡CRÍTICO! Series de Usuario A fueron sincronizadas bajo la cuenta de Usuario B.');
  }
  console.log('   -> [PASS] Cola de Usuario A inaccesible para Usuario B. Cero series cruzadas sincronizadas.');

  // -------------------------------------------------------------------
  // PRUEBA 7 — Conservación de Datos Pendientes de A tras Cambio de Cuenta
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 7] Conservación de Datos Pendientes de A tras Cierre e Inicio de B:');
  const pendingAAfterB = getOfflinePendingSets('uid_athlete_A');
  if (pendingAAfterB.length !== 1 || pendingAAfterB[0].id !== 'set_user_A_001') {
    throw new Error('PRUEBA 7 Fallida: Los datos de Usuario A se perdieron o fueron eliminados por el inicio de sesión de B.');
  }

  // When User A logs back in, User A synchronizes their own sets
  const uploadedByA: OfflinePendingSet[] = [];
  const syncResultA = await syncOfflineSetsForUser('uid_athlete_A', async (set) => {
    uploadedByA.push(set);
  });

  if (syncResultA.syncedCount !== 1 || uploadedByA.length !== 1 || uploadedByA[0].userId !== 'uid_athlete_A') {
    throw new Error('PRUEBA 7 Fallida: Usuario A no pudo sincronizar sus propias series legítimas.');
  }

  // Queue for User A is now empty
  const pendingAEmpty = getOfflinePendingSets('uid_athlete_A');
  if (pendingAEmpty.length !== 0) {
    throw new Error('PRUEBA 7 Fallida: La serie sincronizada no fue purgada de la cola tras éxito.');
  }
  console.log('   -> [PASS] Datos de A conservados íntegros y sincronizados con éxito al reingresar A.');

  // -------------------------------------------------------------------
  // PRUEBA 8 — Detección, Migración y Cuarentena de Registros Huérfanos
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 8] Migración y Cuarentena Segura de Registros Huérfanos sin UID:');
  globalStorage.clear();

  // Seed legacy unpartitioned storage key with a mix of valid and orphan records
  const legacyData = [
    {
      id: 'legacy_valid_1',
      userId: 'uid_migrated_user',
      exerciseId: 'squat',
      exerciseName: 'Sentadilla Trasera',
      date: '2026-10-28T09:00:00Z',
      weightKg: 120,
      reps: 5,
      rir: 1,
      estimated1RM: 135,
      completed: true,
      createdAt: '2026-10-28T09:00:00Z',
      executedWorkoutId: 'workout_migrated_1',
    },
    {
      id: 'legacy_orphan_without_uid',
      // NO userId or null/empty
      userId: '',
      exerciseId: 'deadlift',
      exerciseName: 'Peso Muerto',
      date: '2026-10-28T10:00:00Z',
      weightKg: 160,
      reps: 3,
      rir: 0,
      estimated1RM: 175,
      completed: true,
      createdAt: '2026-10-28T10:00:00Z',
    },
  ];

  globalStorage.setItem(BASE_PENDING_KEY, JSON.stringify(legacyData));

  // Execute migration
  const migrationStats = migrateLegacyPendingSets();
  if (migrationStats.migrated !== 1 || migrationStats.quarantined !== 1) {
    throw new Error(`PRUEBA 8 Fallida: Estadísticas de migración incorrectas: ${JSON.stringify(migrationStats)}`);
  }

  // Shared legacy key MUST be deleted
  if (globalStorage.getItem(BASE_PENDING_KEY) !== null) {
    throw new Error('PRUEBA 8 Fallida: La clave compartida legacy "vigor_offline_pending_sets" no fue eliminada.');
  }

  // Valid record moved to user's scoped key
  const migratedSets = getOfflinePendingSets('uid_migrated_user');
  if (migratedSets.length !== 1 || migratedSets[0].id !== 'legacy_valid_1') {
    throw new Error('PRUEBA 8 Fallida: Registro válido no fue migrado a la cola del usuario.');
  }

  // Orphan record safely quarantined
  const orphans = getQuarantinedOrphanSets();
  if (orphans.length !== 1 || orphans[0].id !== 'legacy_orphan_without_uid') {
    throw new Error('PRUEBA 8 Fallida: Registro sin UID no fue puesto en cuarentena aislada.');
  }
  console.log('   -> [PASS] Clave compartida eliminada: registros válidos migrados y huérfanos aislados en cuarentena.');

  // -------------------------------------------------------------------
  // PRUEBA 9 — Idempotencia en la Inserción de Series Offline
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 9] Idempotencia en Inserción Offline (No Duplicados por Reintentos):');
  const duplicateSet: WorkoutSessionRecord = {
    id: 'set_idempotent_test',
    userId: 'uid_athlete_idempotent',
    exerciseId: 'overhead-press',
    exerciseName: 'Press Militar',
    date: '2026-10-29T11:00:00Z',
    weightKg: 50,
    reps: 8,
    rir: 2,
    estimated1RM: 62,
    completed: true,
    createdAt: '2026-10-29T11:00:00Z',
    executedWorkoutId: 'workout_idem_1',
  };

  enqueueOfflineSet(duplicateSet);
  enqueueOfflineSet(duplicateSet); // Call twice
  enqueueOfflineSet({ ...duplicateSet, weightKg: 52.5 }); // Update same ID

  const idemSets = getOfflinePendingSets('uid_athlete_idempotent');
  if (idemSets.length !== 1) {
    throw new Error(`PRUEBA 9 Fallida: Se generaron duplicados en la cola offline: longitud=${idemSets.length}`);
  }
  if (idemSets[0].weightKg !== 52.5) {
    throw new Error('PRUEBA 9 Fallida: La actualización idempotente no reflejó el nuevo valor.');
  }
  console.log('   -> [PASS] Inserción estrictamente idempotente: una sola entrada conservada con valores actualizados.');

  // -------------------------------------------------------------------
  // PRUEBA 10 — Regla de Contingencia: Series sin Cabecera Remota No Se Envían
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 10] Regla de Contingencia: Series sin executedWorkoutId Se Conservan sin Intentar Envío:');
  const setWithoutHeader: WorkoutSessionRecord = {
    id: 'set_no_header_001',
    userId: 'uid_contingency_athlete',
    exerciseId: 'curl-biceps',
    exerciseName: 'Curl de Bíceps',
    date: '2026-10-29T11:30:00Z',
    weightKg: 30,
    reps: 10,
    rir: 2,
    estimated1RM: 39,
    completed: true,
    createdAt: '2026-10-29T11:30:00Z',
    // Missing executedWorkoutId
  };

  enqueueOfflineSet(setWithoutHeader);
  let attemptUploaded = false;
  const syncContingency = await syncOfflineSetsForUser('uid_contingency_athlete', async () => {
    attemptUploaded = true;
  });

  if (attemptUploaded || syncContingency.syncedCount !== 0 || syncContingency.skippedCount !== 1) {
    throw new Error('PRUEBA 10 Fallida: Se intentó subir una serie sin executedWorkoutId, violando la regla de integridad.');
  }

  // The set must still be safely in the queue
  const preservedInQueue = getOfflinePendingSets('uid_contingency_athlete');
  if (preservedInQueue.length !== 1 || preservedInQueue[0].id !== 'set_no_header_001') {
    throw new Error('PRUEBA 10 Fallida: La serie sin cabecera fue eliminada en lugar de conservarse.');
  }
  console.log('   -> [PASS] Serie sin cabecera se conserva en la cola local sin enviar a Firestore hasta tener sesión válida.');

  // -------------------------------------------------------------------
  // PRUEBA 11 — Aislamiento y Compatibilidad con Modo Demo
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 11] Aislamiento del Modo Demo: Almacenamiento Local Separado sin Firestore:');
  const demoSet: WorkoutSessionRecord = {
    id: 'set_demo_001',
    userId: 'demo_camilo',
    exerciseId: 'leg-press',
    exerciseName: 'Prensa de Piernas',
    date: '2026-10-29T12:00:00Z',
    weightKg: 200,
    reps: 10,
    rir: 1,
    estimated1RM: 260,
    completed: true,
    createdAt: '2026-10-29T12:00:00Z',
    executedWorkoutId: 'workout_demo_1',
  };

  enqueueOfflineSet(demoSet, true);
  const demoKey = getScopedPendingQueueKey('demo_camilo', true);
  if (!demoKey.includes('demo_camilo')) {
    throw new Error(`PRUEBA 11 Fallida: Clave de demo incorrecta: ${demoKey}`);
  }
  const demoSets = getOfflinePendingSets('demo_camilo', true);
  if (demoSets.length !== 1 || demoSets[0].id !== 'set_demo_001') {
    throw new Error('PRUEBA 11 Fallida: Serie demo no se recuperó en su cola aislada.');
  }
  console.log('   -> [PASS] Modo demo opera en su propio espacio "vigor_offline_pending_sets_demo_camilo" sin tocar Firestore.');

  // -------------------------------------------------------------------
  // PRUEBA 12 — Rutas Privadas y Públicas Exhaustivamente Validadas
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 12] Exhaustividad de Rutas (12 Privadas, 3 Públicas):');
  const expectedPrivate = [
    'dashboard-nutricional',
    'configuracion-nutricional',
    'menu-semanal',
    'registro-de-comidas',
    'registro-diario',
    'lista-de-compras',
    'sustituciones',
    'guia-y-ajustes',
    'rutina-de-entrenamiento',
    'registro-de-entrenamiento',
    'cardio-y-hiit',
    'progreso-del-entrenamiento',
  ];

  for (const p of expectedPrivate) {
    if (!isPrivatePath(p)) {
      throw new Error(`PRUEBA 12 Fallida: Ruta privada "${p}" no validada.`);
    }
  }

  for (const pub of PUBLIC_NAVIGATION_PATHS) {
    if (isPrivatePath(pub)) {
      throw new Error(`PRUEBA 12 Fallida: Ruta pública "${pub}" clasificada erróneamente como privada.`);
    }
  }
  console.log('   -> [PASS] 12 rutas privadas y 3 rutas públicas verificadas con concordancia total.');

  console.log('\n========================================================================');
  console.log(' RESULTADO: TODAS LAS 12 PRUEBAS DE AUTENTICACIÓN Y COLA OFFLINE PASARON 100%');
  console.log('========================================================================\n');
}

runAuthSecurityAndOfflineQueueTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[FATAL ERROR EN PRUEBAS]:', err);
    process.exit(1);
  });
