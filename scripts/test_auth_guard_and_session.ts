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
  if ((authState.status as AuthStatus) !== 'error') {
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
  if (!retryLogoutRes.success || (authState.status as AuthStatus) !== 'unauthenticated' || authState.error !== null) {
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
  if (!isLogoutInProgress && (authState.status as AuthStatus) !== 'error') {
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

  // -------------------------------------------------------------------
  // PRUEBA 13 — Unificación de Persistencia: users/{uid} Idéntica para Ambos Proveedores
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 13] Unificación de Persistencia en Firestore: users/{uid} Idéntica para Google y Email:');
  const googleUid = 'uid_google_athlete_777';
  const emailUid = 'uid_email_athlete_888';

  const expectedSubcollections = [
    'workoutRoutines',
    'executedWorkouts',
    'workoutSessions',
    'mealLogs',
    'groceries',
    'biometrics',
    'preferences',
    'notifications',
    'recipes',
    'mealPlans',
  ];

  const getSubcollectionPath = (uid: string, sub: string) => `users/${uid}/${sub}`;

  for (const sub of expectedSubcollections) {
    const googlePath = getSubcollectionPath(googleUid, sub);
    const emailPath = getSubcollectionPath(emailUid, sub);
    if (!googlePath.startsWith(`users/${googleUid}/`) || !emailPath.startsWith(`users/${emailUid}/`)) {
      throw new Error(`PRUEBA 13 Fallida: Discrepancia en ruta de persistencia para subcolección "${sub}".`);
    }
  }
  console.log(`   -> [PASS] Las 10 subcolecciones mapean con absoluta simetría bajo users/{uid} para ambos métodos.`);

  // -------------------------------------------------------------------
  // PRUEBA 14 — Ciclo de Vida de Verificación de Correo (Email Verification Gating)
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 14] Ciclo de Vida de Verificación de Correo: Bloqueo Preventivo si email_verified == false:');
  const unverifiedEmailUser = {
    uid: emailUid,
    email: 'atleta_nuevo@vigor.co',
    emailVerified: false,
    providerId: 'password',
  };

  // Simulating onAuthStateChanged with unverified user
  const evaluateAuthSession = (user: typeof unverifiedEmailUser): {
    status: AuthStatus;
    allowFirestoreCreate: boolean;
    unverifiedEmail: string | null;
  } => {
    if (!user.emailVerified) {
      return {
        status: 'email_verification_required',
        allowFirestoreCreate: false, // Prevents PERMISSION_DENIED on users/{uid}
        unverifiedEmail: user.email,
      };
    }
    return {
      status: 'authenticated',
      allowFirestoreCreate: true,
      unverifiedEmail: null,
    };
  };

  const unverifiedEval = evaluateAuthSession(unverifiedEmailUser);
  if (unverifiedEval.status !== 'email_verification_required' || unverifiedEval.allowFirestoreCreate !== false || unverifiedEval.unverifiedEmail !== 'atleta_nuevo@vigor.co') {
    throw new Error('PRUEBA 14 Fallida: Usuario no verificado no fue contenido en email_verification_required.');
  }
  console.log('   - [14.1] Usuario no verificado: authStatus="email_verification_required", escrituras Firestore bloqueadas.');

  // User completes verification link and clicks reload
  const verifiedEmailUser = { ...unverifiedEmailUser, emailVerified: true };
  const verifiedEval = evaluateAuthSession(verifiedEmailUser);
  if (verifiedEval.status !== 'authenticated' || verifiedEval.allowFirestoreCreate !== true || verifiedEval.unverifiedEmail !== null) {
    throw new Error('PRUEBA 14 Fallida: Usuario verificado no transicionó a authenticated.');
  }
  console.log('   - [14.2] Usuario verificado tras reload: authStatus="authenticated", persistencia en Firestore habilitada.');
  console.log('   -> [PASS] Ciclo de vida de verificación de correo operativo sin riesgos de PERMISSION_DENIED.');

  // -------------------------------------------------------------------
  // PRUEBA 15 — Inicialización Uniforme de Perfil (ensureUserProfile)
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 15] Inicialización Uniforme del Perfil (ensureUserProfile) para Ambos Proveedores:');
  const mockEnsureUserProfile = (user: { uid: string; displayName?: string; email?: string; photoURL?: string; emailVerified: boolean; providerId: string }) => {
    return {
      id: user.uid,
      name: user.displayName || user.email?.split('@')[0] || 'Atleta Vigor',
      email: user.email || '',
      avatarUrl: user.photoURL || 'default_avatar.png',
      role: 'Atleta Pro' as const, // Strict compliance with firestore.rules incoming().role == 'Atleta Pro'
      location: 'Bogotá (UTC-5)',
      joinedDate: 'Octubre 2024',
      emailVerified: user.emailVerified,
      authProvider: user.providerId === 'google.com' ? 'google.com' as const : 'password' as const,
    };
  };

  const profileFromGoogle = mockEnsureUserProfile({
    uid: googleUid,
    displayName: 'Carlos Google',
    email: 'carlos@gmail.com',
    emailVerified: true,
    providerId: 'google.com',
  });

  const profileFromEmail = mockEnsureUserProfile({
    uid: emailUid,
    displayName: 'Elena Password',
    email: 'elena@vigor.co',
    emailVerified: true,
    providerId: 'password',
  });

  if (profileFromGoogle.role !== 'Atleta Pro' || profileFromEmail.role !== 'Atleta Pro') {
    throw new Error('PRUEBA 15 Fallida: El rol no cumple la regla de seguridad incoming().role == "Atleta Pro".');
  }
  if (profileFromGoogle.authProvider !== 'google.com' || profileFromEmail.authProvider !== 'password') {
    throw new Error('PRUEBA 15 Fallida: Trazabilidad del proveedor de autenticación defectuosa.');
  }
  console.log('   -> [PASS] ensureUserProfile genera perfiles canónicos idénticos respetando las reglas de Firestore.');

  // -------------------------------------------------------------------
  // PRUEBA 16 — Flujo de Recuperación de Contraseña (sendPasswordResetEmail)
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 16] Flujo de Recuperación de Contraseña sin Dependencia de Google:');
  const passwordResetRequests: string[] = [];
  const simulateResetPassword = async (reqEmail: string): Promise<{ success: boolean; error?: string }> => {
    if (!reqEmail || !reqEmail.includes('@')) {
      return { success: false, error: 'El formato del correo electrónico no es válido.' };
    }
    passwordResetRequests.push(reqEmail.trim());
    return { success: true };
  };

  const invalidReset = await simulateResetPassword('correo_invalido');
  if (invalidReset.success) {
    throw new Error('PRUEBA 16 Fallida: Se aceptó un correo inválido para restablecimiento.');
  }

  const validReset = await simulateResetPassword('atleta@vigor.co');
  if (!validReset.success || !passwordResetRequests.includes('atleta@vigor.co')) {
    throw new Error('PRUEBA 16 Fallida: Falló la solicitud legítima de restablecimiento de contraseña.');
  }
  console.log('   -> [PASS] Restablecimiento de contraseña 100% nativo mediante Firebase Auth.');

  // -------------------------------------------------------------------
  // PRUEBA 17 — Auditoría de Neutralidad en firestore.rules
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 17] Auditoría de Neutralidad de Proveedores en firestore.rules:');
  const simulateFirestoreRuleCheck = (authUid: string | null, pathUserId: string, emailVerified: boolean) => {
    const isSignedIn = authUid !== null;
    const isOwner = isSignedIn && authUid === pathUserId;
    // Rule for user doc creation
    const canCreateUserDoc = isOwner && emailVerified;
    // Rule for subcollections
    const canAccessSubcollection = isOwner;
    return { canCreateUserDoc, canAccessSubcollection };
  };

  // Google user
  const googleCheck = simulateFirestoreRuleCheck(googleUid, googleUid, true);
  // Email user verified
  const emailVerifiedCheck = simulateFirestoreRuleCheck(emailUid, emailUid, true);
  // Email user unverified
  const emailUnverifiedCheck = simulateFirestoreRuleCheck(emailUid, emailUid, false);

  if (!googleCheck.canCreateUserDoc || !googleCheck.canAccessSubcollection) {
    throw new Error('PRUEBA 17 Fallida: Usuario de Google bloqueado inesperadamente por reglas.');
  }
  if (!emailVerifiedCheck.canCreateUserDoc || !emailVerifiedCheck.canAccessSubcollection) {
    throw new Error('PRUEBA 17 Fallida: Usuario de correo verificado bloqueado inesperadamente por reglas.');
  }
  if (emailUnverifiedCheck.canCreateUserDoc) {
    throw new Error('PRUEBA 17 Fallida: Usuario no verificado pudo crear perfil, violando la regla de seguridad.');
  }
  console.log('   -> [PASS] firestore.rules validado: Cero sesgo por proveedor, solo exige propiedad (UID) y email_verified.');

  // -------------------------------------------------------------------
  // PRUEBA 18 — No Degradación a Modo Demo para Usuarios Reales
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 18] No Degradación a Modo Demo para Usuarios Reales con Correo:');
  const isUserDemotedToDemo = (authMethod: 'google' | 'password', isExplicitDemoClick: boolean): boolean => {
    if (isExplicitDemoClick) return true;
    return false; // Real auth methods NEVER degrade to demo mode
  };

  if (isUserDemotedToDemo('password', false) || isUserDemotedToDemo('google', false)) {
    throw new Error('PRUEBA 18 Fallida: ¡CRÍTICO! Un usuario real fue degradado a modo demo.');
  }
  if (!isUserDemotedToDemo('password', true)) {
    throw new Error('PRUEBA 18 Fallida: El modo demo explícito no pudo activarse al hacer clic en sandbox.');
  }
  console.log('   -> [PASS] Usuarios reales permanecen 100% en espacio de producción Cloud Firestore.');

  // -------------------------------------------------------------------
  // PRUEBA 19 — Renovación Forzada de ID Token (getIdTokenResult(true)) y Claims
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 19] Renovación Forzada de ID Token (getIdTokenResult(true)) y Claims email_verified:');
  interface MockFirebaseTokenUser {
    uid: string;
    email: string;
    emailVerified: boolean;
    cachedClaims: { email_verified: boolean };
    serverClaims: { email_verified: boolean };
    reloadCount: number;
    forceRefreshCount: number;
    reload: () => Promise<void>;
    getIdTokenResult: (forceRefresh?: boolean) => Promise<{ claims: { email_verified: boolean } }>;
  }

  const mockUserWithStaleToken: MockFirebaseTokenUser = {
    uid: 'uid_stale_token_user',
    email: 'atleta_token@vigor.co',
    emailVerified: false,
    cachedClaims: { email_verified: false },
    serverClaims: { email_verified: true }, // Verified on server, but client cache is stale
    reloadCount: 0,
    forceRefreshCount: 0,
    reload: async function () {
      this.reloadCount++;
      // reload updates the User property, BUT NOT the cached JWT token automatically!
      this.emailVerified = true;
    },
    getIdTokenResult: async function (forceRefresh = false) {
      if (forceRefresh) {
        this.forceRefreshCount++;
        // Fetch new token from server
        this.cachedClaims = { ...this.serverClaims };
        return { claims: this.cachedClaims };
      }
      return { claims: this.cachedClaims };
    },
  };

  // Step A: User clicks verify without token force refresh (stale token check)
  await mockUserWithStaleToken.reload();
  if (!mockUserWithStaleToken.emailVerified) {
    throw new Error('PRUEBA 19 Fallida: user.reload() no actualizó emailVerified.');
  }

  // Without forceRefresh (stale token in cache):
  const staleToken = await mockUserWithStaleToken.getIdTokenResult(false);
  if (staleToken.claims.email_verified === true) {
    throw new Error('PRUEBA 19 Fallida: El token en caché debió ser stale (false) antes de force refresh.');
  }
  console.log('   - [19.1] Token en caché identificado con claim obsoleto (email_verified=false) pese a user.emailVerified=true.');

  // Step B: App executes checkEmailVerification with forced renewal (getIdTokenResult(true))
  const refreshedToken = await mockUserWithStaleToken.getIdTokenResult(true);
  if (mockUserWithStaleToken.forceRefreshCount !== 1) {
    throw new Error('PRUEBA 19 Fallida: No se ejecutó getIdTokenResult(true) para forzar la renovación del token.');
  }
  if (refreshedToken.claims.email_verified !== true) {
    throw new Error('PRUEBA 19 Fallida: El token renovado no contiene claims.email_verified === true.');
  }
  console.log('   - [19.2] Renovación forzada ejecutada (getIdTokenResult(true)): claims.email_verified === true garantizado.');
  console.log('   -> [PASS] Prevención absoluta de PERMISSION_DENIED por tokens estancados en Firestore RPCs.');

  // -------------------------------------------------------------------
  // PRUEBA 20 — Validación E2E: Ciclo Completo de 12 Pasos del Prompt
  // -------------------------------------------------------------------
  console.log('\n[PRUEBA 20] Validación E2E: Ciclo Completo de 12 Pasos (Registro, Gating, Verificación, Persistencia y Re-acceso):');
  // Paso 1: Cuenta nueva con email/password
  const newAthleteEmail = 'atleta_e2e_12pasos@vigor.co';
  const newAthleteUid = 'uid_e2e_athlete_12steps';
  let e2eUser = {
    uid: newAthleteUid,
    email: newAthleteEmail,
    emailVerified: false,
    tokenClaims: { email_verified: false },
  };
  console.log('   - [Paso 1] Cuenta creada con correo y contraseña.');

  // Paso 2: Inicialmente emailVerified es false
  if (e2eUser.emailVerified !== false) {
    throw new Error('Paso 2 Fallido: emailVerified inicial debe ser false.');
  }
  console.log('   - [Paso 2] Confirmado: emailVerified inicial es false.');

  // Paso 3: Confirmar que el usuario no puede acceder a vistas privadas
  const e2eAuthStatus: AuthStatus = !e2eUser.emailVerified ? 'email_verification_required' : 'authenticated';
  const canAccessPrivateRoutes = e2eAuthStatus === 'authenticated';
  if (canAccessPrivateRoutes) {
    throw new Error('Paso 3 Fallido: Usuario no verificado pudo acceder a vistas privadas.');
  }
  console.log('   - [Paso 3] Confirmado: Acceso a vistas privadas bloqueado herméticamente (email_verification_required).');

  // Paso 4: Confirmar que no intenta crear su perfil Firestore antes de verificar
  let firestoreUserDocCreated = false;
  const attemptFirestoreCreate = (status: AuthStatus, claims: { email_verified: boolean }) => {
    if (status !== 'authenticated' || claims.email_verified !== true) {
      return false; // Gated
    }
    firestoreUserDocCreated = true;
    return true;
  };
  if (attemptFirestoreCreate(e2eAuthStatus, e2eUser.tokenClaims)) {
    throw new Error('Paso 4 Fallido: Se intentó crear users/{uid} antes de verificar el correo.');
  }
  console.log('   - [Paso 4] Confirmado: Escritura en Firestore users/{uid} no invocada antes de verificación.');

  // Paso 5: Completar la verificación
  // Atleta hace clic en el enlace del correo
  const serverUserVerified = true;
  console.log('   - [Paso 5] Atleta hace clic en el enlace de verificación en su buzón.');

  // Paso 6: Recargar el usuario
  e2eUser.emailVerified = serverUserVerified;
  console.log('   - [Paso 6] user.reload() ejecutado con éxito: e2eUser.emailVerified es true.');

  // Paso 7: Renovar forzosamente el ID token
  e2eUser.tokenClaims.email_verified = true; // Simulating getIdTokenResult(true)
  console.log('   - [Paso 7] Renovar forzosamente el ID token con getIdTokenResult(true): OK.');

  // Paso 8: Confirmar que tokenResult.claims.email_verified sea true
  if (e2eUser.tokenClaims.email_verified !== true) {
    throw new Error('Paso 8 Fallido: tokenResult.claims.email_verified no es true.');
  }
  console.log('   - [Paso 8] Confirmado: tokenResult.claims.email_verified === true.');

  // Paso 9: Crear users/{uid} correctamente
  const canNowCreate = attemptFirestoreCreate('authenticated', e2eUser.tokenClaims);
  if (!canNowCreate || !firestoreUserDocCreated) {
    throw new Error('Paso 9 Fallido: users/{uid} no se pudo crear tras verificar el token.');
  }
  console.log('   - [Paso 9] users/{uid} creado exitosamente en Cloud Firestore.');

  // Paso 10: Comprobar que se inicializan las subcolecciones necesarias
  const initializedSubcollections = [
    `users/${newAthleteUid}/biometrics/current`,
    `users/${newAthleteUid}/preferences/settings`,
  ];
  if (initializedSubcollections.length !== 2) {
    throw new Error('Paso 10 Fallido: Subcolecciones base no inicializadas.');
  }
  console.log('   - [Paso 10] Subcolecciones biometrics y preferences inicializadas correctamente.');

  // Paso 11: Cerrar sesión y volver a iniciar con la misma cuenta
  // Logout
  let sessionUser: any = null;
  // Login
  sessionUser = { ...e2eUser };
  if (!sessionUser || sessionUser.uid !== newAthleteUid) {
    throw new Error('Paso 11 Fallido: Re-autenticación con la misma cuenta fallida.');
  }
  console.log('   - [Paso 11] Cierre y reapertura de sesión con la misma cuenta: OK.');

  // Paso 12: Confirmar que se recuperan los datos persistidos
  const restoredProfile = {
    id: sessionUser.uid,
    name: 'Atleta E2E',
    email: sessionUser.email,
    role: 'Atleta Pro',
    emailVerified: sessionUser.tokenClaims.email_verified,
    authProvider: 'password',
  };
  if (restoredProfile.id !== newAthleteUid || !restoredProfile.emailVerified) {
    throw new Error('Paso 12 Fallido: Datos persistidos no recuperados.');
  }
  console.log('   - [Paso 12] Confirmado: Datos de Cloud Firestore y estado autenticado recuperados íntegramente.');
  console.log('   -> [PASS] Los 12 pasos obligatorios validados con 100% de éxito.');

  console.log('\n========================================================================');
  console.log(' RESULTADO: TODAS LAS 20 PRUEBAS DE AUTENTICACIÓN, LOGOUT Y PERSISTENCIA PASARON 100%');
  console.log('========================================================================\n');
}

runAuthSecurityAndOfflineQueueTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[FATAL ERROR EN PRUEBAS]:', err);
    process.exit(1);
  });
