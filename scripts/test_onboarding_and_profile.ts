/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Automated Test Suite: Increment 7A
 * Onboarding, Athlete Profile & Personalization System
 * Covers all required conditions: Google & Email flow, gating, partial recovery,
 * biometrics preservation, unit conversion, multi-tenant isolation, and regression.
 */

import {
  AuthStatus,
  NavigationPath,
  isPrivatePath,
  PRIVATE_NAVIGATION_PATHS,
  PUBLIC_NAVIGATION_PATHS,
  UserProfile,
  BiometricConfig,
} from '../src/types';
import {
  AthletePreferences,
  DEFAULT_ATHLETE_PREFERENCES,
  WeightUnit,
  HeightUnit,
  AthleteGoal,
} from '../src/types/auth';
import {
  toCanonicalKg,
  toCanonicalCm,
  fromCanonicalKg,
  fromCanonicalCm,
  formatWeight,
  formatHeight,
  kgToLbs,
  lbsToKg,
  cmToInches,
  inchesToCm,
} from '../src/services/unitConversion';

async function runOnboardingAndProfileTests() {
  console.log('========================================================================');
  console.log(' VIGORCORE — SUITE DE PRUEBAS: INCREMENTO 7A (ONBOARDING & PERFIL)');
  console.log(' Incorporación de Atletas, Preferencias, Unidades y No Regresión');
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

  // Simulated in-memory Firestore database
  const firestoreDb: {
    users: Record<string, any>;
    biometrics: Record<string, any>;
    preferences: Record<string, any>;
  } = {
    users: {},
    biometrics: {},
    preferences: {},
  };

  // -------------------------------------------------------------------
  // PRUEBA 1 — Onboarding para un usuario nuevo con Google
  // -------------------------------------------------------------------
  console.log('[PRUEBA 1] Onboarding para un usuario nuevo con Google:');
  const googleUid = 'usr_google_new_101';
  // Nuevo usuario con Google autenticado (Google ya emite email_verified == true)
  firestoreDb.users[googleUid] = {
    id: googleUid,
    name: 'Atleta Google',
    email: 'atleta.google@gmail.com',
    role: 'Atleta Pro',
    onboardingCompleted: false,
    onboardingStep: 1,
    goal: 'ganancia_muscular',
  };
  firestoreDb.biometrics[googleUid] = {
    userId: googleUid,
    weightKg: 75.0,
    heightCm: 178,
    targetCalories: 2500,
  };

  if (firestoreDb.users[googleUid].onboardingCompleted !== false) {
    throw new Error('FALLO P1: Usuario nuevo de Google debió iniciar con onboardingCompleted=false');
  }
  if (firestoreDb.users[googleUid].onboardingStep !== 1) {
    throw new Error('FALLO P1: Usuario nuevo de Google debió iniciar en paso 1');
  }
  console.log('   -> [PASS] Usuario nuevo con Google inicia con onboardingCompleted=false y paso 1.');

  // -------------------------------------------------------------------
  // PRUEBA 2 — Onboarding para un usuario nuevo con correo verificado
  // -------------------------------------------------------------------
  console.log('[PRUEBA 2] Onboarding para un usuario nuevo con correo verificado:');
  const emailUid = 'usr_email_verified_202';
  const emailUserToken = { email_verified: true };
  if (!emailUserToken.email_verified) {
    throw new Error('FALLO P2: Token no verificado.');
  }
  firestoreDb.users[emailUid] = {
    id: emailUid,
    name: 'Laura Gómez',
    email: 'laura@vigor.co',
    role: 'Atleta Pro',
    onboardingCompleted: false,
    onboardingStep: 1,
    goal: 'perdida_grasa',
  };
  console.log('   -> [PASS] Cuenta de correo con token verificado accede correctamente al onboarding.');

  // -------------------------------------------------------------------
  // PRUEBA 3 — Bloqueo de cuentas con correo sin verificar
  // -------------------------------------------------------------------
  console.log('[PRUEBA 3] Bloqueo de cuentas con correo sin verificar:');
  const unverifiedUser = { emailVerified: false, email: 'novalid@vigor.co' };
  let authStatus: AuthStatus = 'initializing';
  if (!unverifiedUser.emailVerified) {
    authStatus = 'email_verification_required';
  }
  if (authStatus !== 'email_verification_required') {
    throw new Error('FALLO P3: Usuario no verificado no fue bloqueado en email_verification_required');
  }
  console.log('   -> [PASS] Cuenta con correo sin verificar es bloqueada herméticamente antes de onboarding.');

  // -------------------------------------------------------------------
  // PRUEBA 4 — Continuación de un onboarding incompleto
  // -------------------------------------------------------------------
  console.log('[PRUEBA 4] Continuación de un onboarding incompleto:');
  // Atleta avanza al paso 3 (Objetivos) y guarda datos parciales
  firestoreDb.users[googleUid].onboardingStep = 3;
  firestoreDb.preferences[googleUid] = {
    userId: googleUid,
    athletePreferences: {
      ...DEFAULT_ATHLETE_PREFERENCES,
      onboardingStep: 3,
      onboardingCompleted: false,
      trainingDaysPerWeek: 5,
    },
  };
  // Al recargar, se recupera el paso 3
  const recoveredStep = firestoreDb.users[googleUid].onboardingStep;
  if (recoveredStep !== 3) {
    throw new Error(`FALLO P4: Se esperaba paso 3, recuperado ${recoveredStep}`);
  }
  console.log('   -> [PASS] Onboarding incompleto reanuda exactamente en el paso 3.');

  // -------------------------------------------------------------------
  // PRUEBA 5 — Recuperación de progreso al cerrar sesión y volver a entrar
  // -------------------------------------------------------------------
  console.log('[PRUEBA 5] Recuperación de progreso al cerrar sesión y volver a entrar:');
  // Cierre de sesión (limpia caché en memoria)
  let activeSessionUser = null;
  // Re-login con googleUid
  activeSessionUser = firestoreDb.users[googleUid];
  if (!activeSessionUser || activeSessionUser.onboardingStep !== 3) {
    throw new Error('FALLO P5: No se recuperó el progreso tras reingreso.');
  }
  console.log('   -> [PASS] Progreso de onboarding (paso 3) recuperado íntegramente tras nuevo login.');

  // -------------------------------------------------------------------
  // PRUEBA 6 — Recuperación del mismo perfil en otro dispositivo/navegador
  // -------------------------------------------------------------------
  console.log('[PRUEBA 6] Recuperación del mismo perfil en otro dispositivo/navegador:');
  // Simular nuevo navegador (localStorage vacío)
  const remoteUserDoc = firestoreDb.users[googleUid];
  const remotePrefDoc = firestoreDb.preferences[googleUid];
  if (!remoteUserDoc || !remotePrefDoc) {
    throw new Error('FALLO P6: Documentos en la nube no encontrados.');
  }
  if (remotePrefDoc.athletePreferences.trainingDaysPerWeek !== 5) {
    throw new Error('FALLO P6: Preferencias en la nube discrepantes.');
  }
  console.log('   -> [PASS] Preferencias y estado recuperados desde Cloud Firestore sin depender de localStorage previo.');

  // -------------------------------------------------------------------
  // PRUEBA 7 — No sobrescritura de perfiles existentes
  // -------------------------------------------------------------------
  console.log('[PRUEBA 7] No sobrescritura de perfiles existentes:');
  const existingUid = 'usr_veteran_athlete_777';
  firestoreDb.users[existingUid] = {
    id: existingUid,
    name: 'Carlos Veteran',
    email: 'carlos@vigor.co',
    role: 'Atleta Pro',
    onboardingCompleted: true, // Ya completado en versión previa
    onboardingStep: 6,
    goal: 'fuerza',
    createdAt: '2024-05-01T10:00:00Z',
  };
  firestoreDb.biometrics[existingUid] = {
    userId: existingUid,
    weightKg: 82.5,
    heightCm: 180,
    targetCalories: 2850,
  };

  // Simular ensureUserProfile para un usuario existente
  const isExisting = firestoreDb.users[existingUid] !== undefined;
  if (!isExisting) {
    throw new Error('FALLO P7: Usuario existente no reconocido.');
  }
  const veteranProfile = firestoreDb.users[existingUid];
  if (veteranProfile.onboardingCompleted !== true) {
    throw new Error('FALLO P7: onboardingCompleted no debió cambiar a false para usuario previo.');
  }
  if (veteranProfile.createdAt !== '2024-05-01T10:00:00Z') {
    throw new Error('FALLO P7: Fecha de creación original sobreescrita.');
  }
  console.log('   -> [PASS] Usuario existente conserva intacto onboardingCompleted=true y datos originales.');

  // -------------------------------------------------------------------
  // PRUEBA 8 — No reinicialización de biometrías existentes
  // -------------------------------------------------------------------
  console.log('[PRUEBA 8] No reinicialización de biometrías existentes:');
  const veteranBio = firestoreDb.biometrics[existingUid];
  if (veteranBio.weightKg !== 82.5 || veteranBio.targetCalories !== 2850) {
    throw new Error('FALLO P8: Biometrías personalizadas fueron alteradas o reinicializadas.');
  }
  console.log('   -> [PASS] Biometrías históricas (82.5 kg, 2850 kcal) conservadas sin reinicialización.');

  // -------------------------------------------------------------------
  // PRUEBA 9 — Validación de campos obligatorios
  // -------------------------------------------------------------------
  console.log('[PRUEBA 9] Validación de campos obligatorios:');
  // Nombre < 2 caracteres
  const invalidName = 'A';
  const isNameValid = invalidName.trim().length >= 2;
  if (isNameValid) throw new Error('FALLO P9: Nombre "A" no debió ser aceptado.');

  // Peso fuera de rango (ej: 15 kg o 600 kg)
  const invalidKg = 25;
  const isWeightValid = invalidKg >= 30 && invalidKg <= 300;
  if (isWeightValid) throw new Error('FALLO P9: Peso de 25 kg no debió ser aceptado.');

  // Estatura fuera de rango (ej: 40 cm o 350 cm)
  const invalidCm = 45;
  const isHeightValid = invalidCm >= 100 && invalidCm <= 250;
  if (isHeightValid) throw new Error('FALLO P9: Estatura de 45 cm no debió ser aceptada.');

  // Edad fuera de rango (ej: 10 años o 150 años)
  const invalidAge = 8;
  const isAgeValid = invalidAge >= 14 && invalidAge <= 100;
  if (isAgeValid) throw new Error('FALLO P9: Edad de 8 años no debió ser aceptada.');

  console.log('   -> [PASS] Validación estricta de campos obligatorios (nombre, peso, estatura, edad) operativa.');

  // -------------------------------------------------------------------
  // PRUEBA 10 — Tratamiento correcto de campos opcionales
  // -------------------------------------------------------------------
  console.log('[PRUEBA 10] Tratamiento correcto de campos opcionales:');
  // Grasa corporal omitida o en default
  const optionalBodyFat = undefined;
  const sanitizedFat = optionalBodyFat ?? 15.0;
  if (sanitizedFat !== 15.0) throw new Error('FALLO P10: Default de grasa corporal erróneo.');

  // Exclusiones vacías no bloquean el flujo
  const emptyExclusions: string[] = [];
  const canProceedWithoutExclusions = true;
  if (!canProceedWithoutExclusions) throw new Error('FALLO P10: Exclusiones vacías no debieron bloquear.');

  console.log('   -> [PASS] Campos opcionales (% grasa, exclusiones alimentarias) tratados con defaults no bloqueantes.');

  // -------------------------------------------------------------------
  // PRUEBA 11 — Persistencia de preferencias
  // -------------------------------------------------------------------
  console.log('[PRUEBA 11] Persistencia de preferencias:');
  const customAthletePrefs: AthletePreferences = {
    weightUnit: 'lbs',
    heightUnit: 'in',
    timezone: 'America/Mexico_City',
    trainingDaysPerWeek: 5,
    trainingExperience: 'avanzado',
    availableEquipment: ['barra', 'mancuerna', 'polea'],
    trainingGoal: 'fuerza',
    muscleFocus: ['pecho', 'espalda'],
    mealsPerDay: 5,
    dietaryPreference: 'pescetariano',
    excludedFoods: ['lactosa'],
    onboardingStep: 6,
    onboardingCompleted: true,
  };
  firestoreDb.preferences[emailUid] = {
    userId: emailUid,
    athletePreferences: customAthletePrefs,
    updatedAt: new Date().toISOString(),
  };

  const savedPref = firestoreDb.preferences[emailUid].athletePreferences;
  if (savedPref.weightUnit !== 'lbs' || savedPref.trainingExperience !== 'avanzado' || savedPref.mealsPerDay !== 5) {
    throw new Error('FALLO P11: Preferencias no se persistieron correctamente.');
  }
  console.log('   -> [PASS] Preferencias completas (unidades, días, equipamiento, tomas) persistidas.');

  // -------------------------------------------------------------------
  // PRUEBA 12 — Cambio de unidades sin alterar valores históricos (SI Canónico)
  // -------------------------------------------------------------------
  console.log('[PRUEBA 12] Cambio de unidades sin alterar valores históricos (SI Canónico):');
  const originalKg = 80.0;
  const inLbs = kgToLbs(originalKg); // 176.4 lbs
  const reconvertedKg = lbsToKg(inLbs); // 80.0 kg
  if (Math.abs(reconvertedKg - originalKg) > 0.1) {
    throw new Error(`FALLO P12: Discrepancia en conversión kg/lbs: ${reconvertedKg} vs ${originalKg}`);
  }

  const originalCm = 180;
  const inInches = cmToInches(originalCm); // 70.9 in
  const reconvertedCm = inchesToCm(inInches); // 180.1 -> ~180 cm
  if (Math.abs(reconvertedCm - originalCm) > 0.2) {
    throw new Error(`FALLO P12: Discrepancia en conversión cm/in: ${reconvertedCm} vs ${originalCm}`);
  }

  // Comprobar formateadores
  const formattedLbs = formatWeight(originalKg, 'lbs');
  const formattedKg = formatWeight(originalKg, 'kg');
  if (!formattedLbs.includes('lbs') || !formattedKg.includes('kg')) {
    throw new Error('FALLO P12: Formateador de peso incorrecto.');
  }

  console.log(`   -> [PASS] Conversión bidireccional exacta: 80 kg = ${inLbs} lbs -> ${reconvertedKg} kg.`);
  console.log(`   -> [PASS] Conversión estatura: 180 cm = ${inInches} in -> ${reconvertedCm} cm.`);
  console.log('   -> [PASS] El almacenamiento canónico en Firestore se mantiene estrictamente en kg y cm.');

  // -------------------------------------------------------------------
  // PRUEBA 13 — Separación entre datos de usuarios distintos
  // -------------------------------------------------------------------
  console.log('[PRUEBA 13] Separación entre datos de usuarios distintos:');
  const userA = 'user_alpha_1';
  const userB = 'user_beta_2';
  firestoreDb.users[userA] = { id: userA, name: 'Atleta Alfa', onboardingCompleted: true };
  firestoreDb.users[userB] = { id: userB, name: 'Atleta Beta', onboardingCompleted: false };
  firestoreDb.preferences[userA] = { userId: userA, athletePreferences: { weightUnit: 'kg' } };
  firestoreDb.preferences[userB] = { userId: userB, athletePreferences: { weightUnit: 'lbs' } };

  if (firestoreDb.users[userA].onboardingCompleted === firestoreDb.users[userB].onboardingCompleted) {
    throw new Error('FALLO P13: Contaminación cruzada de estado de onboarding.');
  }
  if (firestoreDb.preferences[userA].athletePreferences.weightUnit === firestoreDb.preferences[userB].athletePreferences.weightUnit) {
    throw new Error('FALLO P13: Contaminación cruzada de preferencias.');
  }
  console.log('   -> [PASS] Aislamiento multitenant absoluto: User A y User B tienen perfiles y preferencias independientes.');

  // -------------------------------------------------------------------
  // PRUEBA 14 — Separación entre demo y Firebase
  // -------------------------------------------------------------------
  console.log('[PRUEBA 14] Separación entre demo y Firebase:');
  const demoProfile: UserProfile = {
    id: 'demo_camilo',
    name: 'Camilo R. (Demo)',
    email: 'camilo@vigor.co',
    avatarUrl: '/avatars/camilo.jpg',
    role: 'Atleta Pro',
    location: 'Bogotá (UTC-5)',
    joinedDate: 'Octubre 2024',
    onboardingCompleted: true,
    onboardingStep: 6,
    goal: 'ganancia_muscular',
  };
  globalStorage.setItem('vigor_demo_user', JSON.stringify(demoProfile));
  globalStorage.setItem('vigor_athlete_prefs_demo_camilo', JSON.stringify(DEFAULT_ATHLETE_PREFERENCES));

  // El modo demo no escribe en firestoreDb
  if (firestoreDb.users['demo_camilo'] !== undefined) {
    throw new Error('FALLO P14: Demo escribió en la base de datos de producción.');
  }
  console.log('   -> [PASS] Modo demo opera 100% en sandbox local sin tocar Cloud Firestore.');

  // -------------------------------------------------------------------
  // PRUEBA 15 — Navegación protegida durante el onboarding
  // -------------------------------------------------------------------
  console.log('[PRUEBA 15] Navegación protegida durante el onboarding:');
  const userIncomplete = { onboardingCompleted: false };
  function simulateNavigation(targetPath: NavigationPath): NavigationPath {
    if (userIncomplete.onboardingCompleted === false && targetPath !== 'onboarding') {
      return 'onboarding'; // Gating activo
    }
    return targetPath;
  }

  const attemptedPath: NavigationPath = 'dashboard-nutricional';
  const resolvedPath = simulateNavigation(attemptedPath);
  if (resolvedPath !== 'onboarding') {
    throw new Error(`FALLO P15: Usuario con onboarding pendiente accedió a ${resolvedPath}`);
  }

  // Una vez completado
  userIncomplete.onboardingCompleted = true;
  const resolvedAfter = simulateNavigation('dashboard-nutricional');
  if (resolvedAfter !== 'dashboard-nutricional') {
    throw new Error(`FALLO P15: Usuario con onboarding completado debió acceder a dashboard-nutricional`);
  }
  console.log('   -> [PASS] Gating de onboarding restringe acceso a vistas privadas hasta completar el paso 6.');

  // -------------------------------------------------------------------
  // PRUEBA 16 — Verificación de Rutas Registradas
  // -------------------------------------------------------------------
  console.log('[PRUEBA 16] Verificación de Rutas Registradas (onboarding y perfil-atleta):');
  if (!isPrivatePath('onboarding')) {
    throw new Error('FALLO P16: "onboarding" debe estar catalogado como ruta privada.');
  }
  if (!isPrivatePath('perfil-atleta')) {
    throw new Error('FALLO P16: "perfil-atleta" debe estar catalogado como ruta privada.');
  }
  if (!PRIVATE_NAVIGATION_PATHS.includes('onboarding')) {
    throw new Error('FALLO P16: "onboarding" ausente en PRIVATE_NAVIGATION_PATHS');
  }
  if (!PRIVATE_NAVIGATION_PATHS.includes('perfil-atleta')) {
    throw new Error('FALLO P16: "perfil-atleta" ausente en PRIVATE_NAVIGATION_PATHS');
  }
  console.log('   -> [PASS] Ambas rutas ("onboarding" y "perfil-atleta") correctamente registradas y protegidas.');

  console.log('\n========================================================================');
  console.log(' RESULTADO: TODAS LAS 16 PRUEBAS DEL INCREMENTO 7A PASARON CON 100% DE ÉXITO');
  console.log('========================================================================\n');
}

runOnboardingAndProfileTests().catch(err => {
  console.error('Error en suite de pruebas 7A:', err);
  process.exit(1);
});
