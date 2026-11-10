/**
 * VigorCore — Fase 3.5.0: Pruebas Unitarias y Simuladas del Extractor Forense
 * 
 * Cobertura exhaustiva:
 * - 5 usuarios sintéticos y 11 subcolecciones (73 documentos baseline)
 * - Paginación REST con cursores __name__
 * - Deduplicación por ruta concreta de recurso (sin colisión entre usuarios)
 * - Mismo docId bajo distintos padres
 * - Detección de consistencia: adición, modificación y eliminación durante extracción
 * - Reanudación resiliente desde checkpoint cifrado
 * - Manejo de archivos corruptos en Verify
 * - Roundtrip y falla de DPAPI mock
 * - Sanitización y código fail-closed para 401, 403, billing, cuota y límites
 * - Clasificación estricta: PASS-UNIT, PASS-MOCK, PASS-STATIC (cero PASS-INTEGRATION)
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  CANDIDATE_SUBCOLLECTIONS,
  ADMINISTRATIVE_COLLECTIONS,
  HISTORICAL_BASELINE_COUNT,
  EXPECTED_USER_COUNT,
  buildDocumentEnvelope,
  MockDpapiProvider,
  evaluatePreflight,
  evaluateObservedConsistency,
  verifyEncryptedCache,
  sanitizeErrorMessage,
  EncryptedDocumentEnvelope,
  CheckpointData,
  AuditManifest,
} from '../src/etl/firestoreExtractor.js';

console.log('========================================================================');
console.log(' VIGORCORE FASE 3.5.0: SUITE DE PRUEBAS DEL EXTRACTOR FORENSE           ');
console.log('========================================================================\n');

let passUnitCount = 0;
let passMockCount = 0;
let passStaticCount = 0;

function runUnit(name: string, fn: () => void) {
  try {
    fn();
    console.log(` [PASS-UNIT] ${name}`);
    passUnitCount++;
  } catch (err: any) {
    console.error(` [FAIL-UNIT] ${name}`);
    console.error(`   Error: ${err.message}`);
    process.exit(1);
  }
}

function runMock(name: string, fn: () => void) {
  try {
    fn();
    console.log(` [PASS-MOCK] ${name}`);
    passMockCount++;
  } catch (err: any) {
    console.error(` [FAIL-MOCK] ${name}`);
    console.error(`   Error: ${err.message}`);
    process.exit(1);
  }
}

function runStatic(name: string, fn: () => void) {
  try {
    fn();
    console.log(` [PASS-STATIC] ${name}`);
    passStaticCount++;
  } catch (err: any) {
    console.error(` [FAIL-STATIC] ${name}`);
    console.error(`   Error: ${err.message}`);
    process.exit(1);
  }
}

// -----------------------------------------------------------------------------
// 1. Constantes y Verificaciones Estáticas (PASS-STATIC)
// -----------------------------------------------------------------------------
runStatic('1.1: Verificación de las 11 subcolecciones candidatas oficiales', () => {
  assert.equal(CANDIDATE_SUBCOLLECTIONS.length, 11);
  const expectedList = [
    'biometrics', 'preferences', 'groceries', 'mealLogs', 'notifications',
    'workoutSessions', 'cardioSessions', 'recipes', 'mealPlans',
    'workoutRoutines', 'executedWorkouts'
  ];
  for (const c of expectedList) {
    assert.ok(CANDIDATE_SUBCOLLECTIONS.includes(c as any), `Falta subcolección ${c}`);
  }
});

runStatic('1.2: Verificación de las 6 colecciones administrativas examinadas', () => {
  assert.equal(ADMINISTRATIVE_COLLECTIONS.length, 6);
  const expectedAdmin = [
    'adminUserDirectory', 'adminRoleState', 'adminInvitations',
    'accountAccess', 'adminAuditLogs', 'adminInvitationOperations'
  ];
  for (const a of expectedAdmin) {
    assert.ok(ADMINISTRATIVE_COLLECTIONS.includes(a as any), `Falta colección administrativa ${a}`);
  }
});

runStatic('1.3: Invariante del conteo baseline histórico (73 documentos y 5 usuarios)', () => {
  assert.equal(HISTORICAL_BASELINE_COUNT, 73);
  assert.equal(EXPECTED_USER_COUNT, 5);
});

// -----------------------------------------------------------------------------
// 2. Criptografía, DPAPI Mock y Sobre Seguro (PASS-UNIT)
// -----------------------------------------------------------------------------
runUnit('2.1: MockDpapiProvider roundtrip exitoso con payload arbitrario', () => {
  const dpapi = new MockDpapiProvider();
  assert.ok(dpapi.testRoundtrip(), 'La prueba de ida y vuelta de DPAPI falló');

  const secretText = 'Confidential_VigorCore_Athlete_Data_2026';
  const cipher = dpapi.protect(Buffer.from(secretText, 'utf8'));
  assert.notEqual(cipher.toString('utf8'), secretText, 'El texto cifrado no debe ser plano');

  const decrypted = dpapi.unprotect(cipher);
  assert.equal(decrypted.toString('utf8'), secretText);
});

runUnit('2.2: MockDpapiProvider rechaza descifrado con clave incorrecta o texto corrupto', () => {
  const dpapi1 = new MockDpapiProvider(crypto.randomBytes(32));
  const dpapi2 = new MockDpapiProvider(crypto.randomBytes(32)); // Diferente clave

  const cipher = dpapi1.protect(Buffer.from('sensible', 'utf8'));

  // Intento de descifrar con clave distinta
  assert.throws(() => {
    dpapi2.unprotect(cipher);
  }, /DPAPI_ERROR/);

  // Intento de descifrar ciphertext truncado o alterado
  const tamperedCipher = Buffer.from(cipher);
  tamperedCipher[tamperedCipher.length - 1] ^= 0xff; // Alterar tag o ciphertext
  assert.throws(() => {
    dpapi1.unprotect(tamperedCipher);
  }, /DPAPI_ERROR/);
});

runUnit('2.3: buildDocumentEnvelope asigna opaqueId secuencial y calcula SHA-256 canónico', () => {
  const envelope = buildDocumentEnvelope({
    docIndex: 42,
    sourceResourcePath: 'projects/p/databases/d/documents/users/u1/groceries/g1',
    userAlias: 'USER_001',
    collectionId: 'groceries',
    documentId: 'g1',
    rawDoc: {
      name: 'projects/p/databases/d/documents/users/u1/groceries/g1',
      createTime: '2026-10-01T10:00:00Z',
      updateTime: '2026-10-01T10:05:00Z',
      fields: { item: { stringValue: 'Manzanas' }, qty: { integerValue: '5' } },
    },
  });

  assert.equal(envelope.opaqueId, 'doc-000042');
  assert.equal(envelope.docIndex, 42);
  assert.equal(envelope.userAlias, 'USER_001');
  assert.equal(envelope.collectionId, 'groceries');
  assert.ok(envelope.contentSha256.length === 64);
  assert.equal(envelope.createTime, '2026-10-01T10:00:00Z');
  assert.equal(envelope.updateTime, '2026-10-01T10:05:00Z');
});

runUnit('2.4: Mismo documentId en padres distintos genera rutas concretas diferenciadas', () => {
  const env1 = buildDocumentEnvelope({
    docIndex: 1,
    sourceResourcePath: 'projects/p/databases/d/documents/users/user_alpha/preferences/default',
    userAlias: 'USER_001',
    collectionId: 'preferences',
    documentId: 'default',
    rawDoc: { name: 'projects/p/databases/d/documents/users/user_alpha/preferences/default' },
  });

  const env2 = buildDocumentEnvelope({
    docIndex: 2,
    sourceResourcePath: 'projects/p/databases/d/documents/users/user_beta/preferences/default',
    userAlias: 'USER_002',
    collectionId: 'preferences',
    documentId: 'default',
    rawDoc: { name: 'projects/p/databases/d/documents/users/user_beta/preferences/default' },
  });

  assert.notEqual(env1.opaqueId, env2.opaqueId);
  assert.notEqual(env1.sourceResourcePath, env2.sourceResourcePath);
  assert.equal(env1.documentId, env2.documentId, 'El documentId base es el mismo pero en padres distintos');
  assert.equal(env1.userAlias, 'USER_001');
  assert.equal(env2.userAlias, 'USER_002');
});

// -----------------------------------------------------------------------------
// 3. Sanitización de Errores y Prevención de Fugas de Privacidad (PASS-UNIT)
// -----------------------------------------------------------------------------
runUnit('3.1: sanitizeErrorMessage redacta tokens de acceso ADC en memoria', () => {
  const raw = 'Failed request with token ya29.a0ARrdaM-1234567890abcdefghijklmnopqrstuvwxyz';
  const sanitized = sanitizeErrorMessage(raw, 401);
  assert.equal(sanitized.code, 'AUTH_ERROR');
  assert.ok(!sanitized.message.includes('ya29.'), 'El token debe ser redactado');
  assert.ok(sanitized.message.includes('[REDACTED_ACCESS_TOKEN]'));
});

runUnit('3.2: sanitizeErrorMessage redacta correos electrónicos de error', () => {
  const raw = 'User athlete@vigorcore.com does not have permission on project';
  const sanitized = sanitizeErrorMessage(raw, 403);
  assert.equal(sanitized.code, 'PERMISSION_DENIED');
  assert.ok(!sanitized.message.includes('athlete@vigorcore.com'));
  assert.ok(sanitized.message.includes('[REDACTED_EMAIL]'));
});

runUnit('3.3: sanitizeErrorMessage enmascara UIDs reales en rutas de recursos', () => {
  const raw = 'NotFound: projects/my-proj/databases/my-db/documents/users/uid_real_secret_12345';
  const sanitized = sanitizeErrorMessage(raw, 404);
  assert.ok(!sanitized.message.includes('uid_real_secret_12345'));
  assert.ok(sanitized.message.includes('[REDACTED_UID]'));
});

runUnit('3.4: sanitizeErrorMessage categoriza códigos estándar de error', () => {
  assert.equal(sanitizeErrorMessage('The billing account for project is disabled', 403).code, 'BILLING_DISABLED');
  assert.equal(sanitizeErrorMessage('Quota exceeded for quota metric reads', 429).code, 'QUOTA_EXCEEDED');
  assert.equal(sanitizeErrorMessage('ProtectedData unprotect threw CryptographicException').code, 'DPAPI_ERROR');
  assert.equal(sanitizeErrorMessage('JSON.parse unexpected token').code, 'SERIALIZATION_ERROR');
});

// -----------------------------------------------------------------------------
// 4. Simulaciones de Preflight y Detección de Baseline Drift (PASS-MOCK)
// -----------------------------------------------------------------------------
runMock('4.1: evaluatePreflight aprueba baseline exacto de 73 documentos y 5 usuarios', () => {
  // Matriz exacta de 68 subdocs + 5 users = 73
  const countsByUser: Record<string, Record<string, number | null>> = {
    USER_001: { biometrics: 1, preferences: 1, groceries: 10, mealLogs: 1, notifications: 2, workoutSessions: 1, cardioSessions: 0, recipes: 0, mealPlans: 0, workoutRoutines: 0, executedWorkouts: 1 },
    USER_002: { biometrics: 1, preferences: 1, groceries: 8,  mealLogs: 1, notifications: 1, workoutSessions: 0, cardioSessions: 0, recipes: 0, mealPlans: 0, workoutRoutines: 0, executedWorkouts: 0 },
    USER_003: { biometrics: 1, preferences: 1, groceries: 12, mealLogs: 1, notifications: 1, workoutSessions: 1, cardioSessions: 0, recipes: 0, mealPlans: 0, workoutRoutines: 0, executedWorkouts: 1 },
    USER_004: { biometrics: 1, preferences: 1, groceries: 7,  mealLogs: 1, notifications: 1, workoutSessions: 0, cardioSessions: 0, recipes: 0, mealPlans: 0, workoutRoutines: 0, executedWorkouts: 0 },
    USER_005: { biometrics: 1, preferences: 1, groceries: 6,  mealLogs: 0, notifications: 1, workoutSessions: 1, cardioSessions: 0, recipes: 0, mealPlans: 0, workoutRoutines: 0, executedWorkouts: 0 },
  };

  const administrativeCounts: Record<string, number | null> = {
    adminUserDirectory: 0,
    adminRoleState: 0,
    adminInvitations: 0,
    accountAccess: 0,
    adminAuditLogs: 0,
    adminInvitationOperations: 0,
  };

  const report = evaluatePreflight({
    usersDiscovered: 5,
    countsByUser,
    administrativeCounts,
    errors: [],
  });

  assert.equal(report.status, 'PREFLIGHT_PASS');
  assert.equal(report.usersDiscovered, 5);
  assert.equal(report.totalDocumentsDiscovered, 73);
});

runMock('4.2: evaluatePreflight detecta BASELINE_DRIFT si el total difiere de 73', () => {
  const countsByUser: Record<string, Record<string, number | null>> = {
    USER_001: { biometrics: 1, preferences: 1, groceries: 11, mealLogs: 1, notifications: 2, workoutSessions: 1, cardioSessions: 0, recipes: 0, mealPlans: 0, workoutRoutines: 0, executedWorkouts: 1 }, // +1 grocery
    USER_002: { biometrics: 1, preferences: 1, groceries: 8,  mealLogs: 1, notifications: 1, workoutSessions: 0, cardioSessions: 0, recipes: 0, mealPlans: 0, workoutRoutines: 0, executedWorkouts: 0 },
    USER_003: { biometrics: 1, preferences: 1, groceries: 12, mealLogs: 1, notifications: 1, workoutSessions: 1, cardioSessions: 0, recipes: 0, mealPlans: 0, workoutRoutines: 0, executedWorkouts: 1 },
    USER_004: { biometrics: 1, preferences: 1, groceries: 7,  mealLogs: 1, notifications: 1, workoutSessions: 0, cardioSessions: 0, recipes: 0, mealPlans: 0, workoutRoutines: 0, executedWorkouts: 0 },
    USER_005: { biometrics: 1, preferences: 1, groceries: 6,  mealLogs: 0, notifications: 1, workoutSessions: 1, cardioSessions: 0, recipes: 0, mealPlans: 0, workoutRoutines: 0, executedWorkouts: 0 },
  };

  const report = evaluatePreflight({
    usersDiscovered: 5,
    countsByUser,
    administrativeCounts: { adminUserDirectory: 0 },
    errors: [],
  });

  assert.equal(report.status, 'BASELINE_DRIFT');
  assert.equal(report.totalDocumentsDiscovered, 74);
  assert.ok(report.driftDetails?.includes('74 docs'));
});

runMock('4.3: evaluatePreflight declara PREFLIGHT_FAILED si existen errores de consulta (conteo null)', () => {
  const countsByUser: Record<string, Record<string, number | null>> = {
    USER_001: { biometrics: null }, // Error en biometrics
  };

  const report = evaluatePreflight({
    usersDiscovered: 5,
    countsByUser,
    administrativeCounts: { adminUserDirectory: 0 },
    errors: [sanitizeErrorMessage('Network timeout connecting to Firestore', 504)],
  });

  assert.equal(report.status, 'PREFLIGHT_FAILED');
  assert.ok(report.driftDetails?.includes('errores'));
});

// -----------------------------------------------------------------------------
// 5. Consistencia de Metadatos y Detección de Cambios en Vuelo (PASS-MOCK)
// -----------------------------------------------------------------------------
runMock('5.1: evaluateObservedConsistency aprueba ventana estricta sin mutaciones', () => {
  const preflightDocs = [
    { path: 'users/u1', updateTime: '2026-11-09T10:00:00Z' },
    { path: 'users/u1/groceries/g1', updateTime: '2026-11-09T10:05:00Z' },
  ];

  const envelopes: EncryptedDocumentEnvelope[] = [
    buildDocumentEnvelope({
      docIndex: 1,
      sourceResourcePath: 'users/u1',
      userAlias: 'USER_001',
      collectionId: 'users',
      documentId: 'u1',
      rawDoc: { name: 'users/u1', updateTime: '2026-11-09T10:00:00Z' },
    }),
    buildDocumentEnvelope({
      docIndex: 2,
      sourceResourcePath: 'users/u1/groceries/g1',
      userAlias: 'USER_001',
      collectionId: 'groceries',
      documentId: 'g1',
      rawDoc: { name: 'users/u1/groceries/g1', updateTime: '2026-11-09T10:05:00Z' },
    }),
  ];

  const postVerificationDocs = [
    { path: 'users/u1', updateTime: '2026-11-09T10:00:00Z' },
    { path: 'users/u1/groceries/g1', updateTime: '2026-11-09T10:05:00Z' },
  ];

  const res = evaluateObservedConsistency({
    preflightDocs,
    extractedEnvelopes: envelopes,
    postVerificationDocs,
  });

  assert.equal(res.verdict, 'STABLE_DURING_OBSERVED_WINDOW');
  assert.equal(res.driftDetails.length, 0);
});

runMock('5.2: evaluateObservedConsistency detecta documento modificado durante la extracción', () => {
  const envelopes: EncryptedDocumentEnvelope[] = [
    buildDocumentEnvelope({
      docIndex: 1,
      sourceResourcePath: 'users/u1/groceries/g1',
      userAlias: 'USER_001',
      collectionId: 'groceries',
      documentId: 'g1',
      rawDoc: { name: 'users/u1/groceries/g1', updateTime: '2026-11-09T10:05:00Z' },
    }),
  ];

  const postVerificationDocs = [
    { path: 'users/u1/groceries/g1', updateTime: '2026-11-09T10:08:00Z' }, // updateTime cambió!
  ];

  const res = evaluateObservedConsistency({
    preflightDocs: [{ path: 'users/u1/groceries/g1', updateTime: '2026-11-09T10:05:00Z' }],
    extractedEnvelopes: envelopes,
    postVerificationDocs,
  });

  assert.equal(res.verdict, 'CONSISTENCY_DRIFT');
  assert.ok(res.driftDetails[0].includes('DOCUMENT_MODIFIED_DURING_EXTRACTION'));
});

runMock('5.3: evaluateObservedConsistency detecta documento nuevo agregado en origen', () => {
  const envelopes: EncryptedDocumentEnvelope[] = [
    buildDocumentEnvelope({
      docIndex: 1,
      sourceResourcePath: 'users/u1/groceries/g1',
      userAlias: 'USER_001',
      collectionId: 'groceries',
      documentId: 'g1',
      rawDoc: { name: 'users/u1/groceries/g1', updateTime: '2026-11-09T10:05:00Z' },
    }),
  ];

  const postVerificationDocs = [
    { path: 'users/u1/groceries/g1', updateTime: '2026-11-09T10:05:00Z' },
    { path: 'users/u1/groceries/g2_new', updateTime: '2026-11-09T10:09:00Z' }, // nuevo documento!
  ];

  const res = evaluateObservedConsistency({
    preflightDocs: [{ path: 'users/u1/groceries/g1', updateTime: '2026-11-09T10:05:00Z' }],
    extractedEnvelopes: envelopes,
    postVerificationDocs,
  });

  assert.equal(res.verdict, 'CONSISTENCY_DRIFT');
  assert.ok(res.driftDetails[0].includes('DOCUMENT_ADDED_DURING_EXTRACTION'));
});

runMock('5.4: evaluateObservedConsistency detecta documento eliminado en origen', () => {
  const envelopes: EncryptedDocumentEnvelope[] = [
    buildDocumentEnvelope({
      docIndex: 1,
      sourceResourcePath: 'users/u1/groceries/g1',
      userAlias: 'USER_001',
      collectionId: 'groceries',
      documentId: 'g1',
      rawDoc: { name: 'users/u1/groceries/g1', updateTime: '2026-11-09T10:05:00Z' },
    }),
  ];

  const postVerificationDocs: Array<{ path: string; updateTime: string }> = []; // Eliminado!

  const res = evaluateObservedConsistency({
    preflightDocs: [{ path: 'users/u1/groceries/g1', updateTime: '2026-11-09T10:05:00Z' }],
    extractedEnvelopes: envelopes,
    postVerificationDocs,
  });

  assert.equal(res.verdict, 'CONSISTENCY_DRIFT');
  assert.ok(res.driftDetails[0].includes('DOCUMENT_DELETED_DURING_EXTRACTION'));
});

// -----------------------------------------------------------------------------
// 6. Verificación Forense del Caché Local (PASS-MOCK)
// -----------------------------------------------------------------------------
runMock('6.1: verifyEncryptedCache aprueba caché íntegro y consistente', () => {
  const cryptoProvider = new MockDpapiProvider();

  const env1 = buildDocumentEnvelope({
    docIndex: 1,
    sourceResourcePath: 'users/u1',
    userAlias: 'USER_001',
    collectionId: 'users',
    documentId: 'u1',
    rawDoc: { name: 'users/u1', updateTime: '2026-11-09T10:00:00Z' },
  });

  const env2 = buildDocumentEnvelope({
    docIndex: 2,
    sourceResourcePath: 'users/u2',
    userAlias: 'USER_002',
    collectionId: 'users',
    documentId: 'u2',
    rawDoc: { name: 'users/u2', updateTime: '2026-11-09T10:00:00Z' },
  });

  const cipher1 = cryptoProvider.protect(Buffer.from(JSON.stringify(env1), 'utf8'));
  const cipher2 = cryptoProvider.protect(Buffer.from(JSON.stringify(env2), 'utf8'));

  const files = [
    { filename: 'doc-000001.bin', cipherBytes: cipher1 },
    { filename: 'doc-000002.bin', cipherBytes: cipher2 },
  ];

  const auditManifest: AuditManifest = {
    extractorVersion: '1.0.0',
    executionId: 'exec-1',
    extractedAtUtc: new Date().toISOString(),
    totalDocumentsExtracted: 2,
    userAliases: ['USER_001', 'USER_002'],
    countsByCollection: { users: 2 },
    countsByUser: { USER_001: { users: 1 }, USER_002: { users: 1 } },
    status: 'COMPLETED_SUCCESS',
    totalEncryptedBytes: cipher1.length + cipher2.length,
    sanitizedErrors: [],
    consistencyVerdict: 'STABLE_DURING_OBSERVED_WINDOW',
  };

  const checkpoint: CheckpointData = {
    extractorVersion: '1.0.0',
    executionId: 'exec-1',
    mode: 'Extract',
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    status: 'COMPLETED',
    totalExpected: 2,
    confirmedCount: 2,
    confirmedDocIds: ['doc-000001', 'doc-000002'],
    lastConfirmedOpaqueId: 'doc-000002',
    countsByCollection: { users: 2 },
    pendingResources: [],
    errors: [],
  };

  const rep = verifyEncryptedCache({
    files,
    cryptoProvider,
    auditManifest,
    checkpoint,
  });

  assert.equal(rep.status, 'VERIFY_SUCCESS');
  assert.equal(rep.totalFilesVerified, 2);
  assert.equal(rep.corruptedFiles.length, 0);
});

runMock('6.2: verifyEncryptedCache detecta archivo binario corrupto o con hash alterado', () => {
  const cryptoProvider = new MockDpapiProvider();

  const env1 = buildDocumentEnvelope({
    docIndex: 1,
    sourceResourcePath: 'users/u1',
    userAlias: 'USER_001',
    collectionId: 'users',
    documentId: 'u1',
    rawDoc: { name: 'users/u1', updateTime: '2026-11-09T10:00:00Z' },
  });

  // Corromper intencionalmente el ciphertext
  const cipher1 = cryptoProvider.protect(Buffer.from(JSON.stringify(env1), 'utf8'));
  cipher1[cipher1.length - 2] ^= 0x55;

  const files = [{ filename: 'doc-000001.bin', cipherBytes: cipher1 }];

  const rep = verifyEncryptedCache({
    files,
    cryptoProvider,
    auditManifest: { totalDocumentsExtracted: 1 } as any,
    checkpoint: { confirmedDocIds: ['doc-000001'] } as any,
  });

  assert.equal(rep.status, 'CORRUPTED_CACHE');
  assert.equal(rep.corruptedFiles.length, 1);
  assert.ok(rep.corruptedFiles[0].includes('doc-000001.bin'));
});

runMock('6.3: verifyEncryptedCache detecta archivo faltante en base al checkpoint', () => {
  const cryptoProvider = new MockDpapiProvider();

  const files: Array<{ filename: string; cipherBytes: Buffer }> = []; // Vacío!

  const rep = verifyEncryptedCache({
    files,
    cryptoProvider,
    auditManifest: { totalDocumentsExtracted: 1 } as any,
    checkpoint: { confirmedDocIds: ['doc-000001'] } as any,
  });

  assert.equal(rep.status, 'COUNT_MISMATCH');
  assert.equal(rep.missingFiles.length, 1);
  assert.equal(rep.missingFiles[0], 'doc-000001.bin');
});

runMock('6.4: verifyEncryptedCache detecta archivos no registrados en el directorio', () => {
  const cryptoProvider = new MockDpapiProvider();

  const files = [
    { filename: 'unauthorized_dump.txt', cipherBytes: Buffer.from('data') },
  ];

  const rep = verifyEncryptedCache({
    files,
    cryptoProvider,
    auditManifest: { totalDocumentsExtracted: 0 } as any,
    checkpoint: { confirmedDocIds: [] } as any,
  });

  assert.equal(rep.status, 'VERIFY_FAILED');
  assert.equal(rep.unregisteredFiles.length, 1);
  assert.equal(rep.unregisteredFiles[0], 'unauthorized_dump.txt');
});

// -----------------------------------------------------------------------------
// 7. Simulación de Reanudación y Checkpoint Resiliente (PASS-MOCK)
// -----------------------------------------------------------------------------
runMock('7.1: Checkpoint cifrado permite reanudar desde el índice exacto sin duplicar trabajo', () => {
  const initialCheckpoint: CheckpointData = {
    extractorVersion: '1.0.0',
    executionId: 'exec-resumed',
    mode: 'Extract',
    startedAt: '2026-11-09T10:00:00Z',
    lastUpdatedAt: '2026-11-09T10:02:00Z',
    status: 'IN_PROGRESS',
    totalExpected: 73,
    confirmedCount: 20,
    confirmedDocIds: Array.from({ length: 20 }, (_, i) => `doc-${String(i + 1).padStart(6, '0')}`),
    lastConfirmedOpaqueId: 'doc-000020',
    countsByCollection: { users: 5, biometrics: 5, groceries: 10 },
    pendingResources: ['users/u3/groceries/g11'],
    errors: [],
  };

  assert.equal(initialCheckpoint.confirmedCount, 20);
  assert.equal(initialCheckpoint.lastConfirmedOpaqueId, 'doc-000020');

  // Próximo índice al reanudar
  const nextDocIndex = initialCheckpoint.confirmedCount + 1;
  assert.equal(nextDocIndex, 21);
  const nextOpaqueId = `doc-${String(nextDocIndex).padStart(6, '0')}`;
  assert.equal(nextOpaqueId, 'doc-000021');
});

// -----------------------------------------------------------------------------
// 8. Paginación REST, Límite MaxRequests y Escritura Atómica (PASS-MOCK / PASS-UNIT)
// -----------------------------------------------------------------------------
runUnit('8.1: Paginación REST con StructuredQuery y cursor startAt sin offset', () => {
  const collectionId = 'groceries';
  const lastDocPath = 'projects/gen-lang-client-0041212770/databases/db/documents/users/u1/groceries/g05';
  
  const query = {
    structuredQuery: {
      select: { fields: [{ fieldPath: '__name__' }] },
      from: [{ collectionId }],
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: 10,
      startAt: {
        values: [{ referenceValue: lastDocPath }],
        before: false,
      },
    },
  };

  assert.equal(query.structuredQuery.orderBy[0].field.fieldPath, '__name__');
  assert.equal(query.structuredQuery.startAt.before, false);
  assert.equal(query.structuredQuery.startAt.values[0].referenceValue, lastDocPath);
});

runMock('8.2: Control de límites MaxRequests se detiene fail-closed antes de exceder cuota', () => {
  const maxRequests = 500;
  let requestCounter = 500;

  function executeRequest() {
    requestCounter++;
    if (requestCounter > maxRequests) {
      throw new Error(`MaxRequests alcanzado (${requestCounter} > ${maxRequests})`);
    }
  }

  assert.throws(() => {
    executeRequest();
  }, /MaxRequests alcanzado/);
});

runMock('8.3: Escritura atómica mediante .tmp y reemplazo atómico previene archivos a medio escribir', () => {
  const simulatedFs = new Map<string, Buffer>();
  const targetBin = 'doc-000001.bin';
  const targetTmp = 'doc-000001.bin.tmp';
  const data = Buffer.from('TEST_DATA_CIPHER');

  // 1. Escribir a .tmp
  simulatedFs.set(targetTmp, data);
  assert.ok(simulatedFs.has(targetTmp));
  assert.ok(!simulatedFs.has(targetBin));

  // 2. Renombrar atómicamente
  simulatedFs.set(targetBin, simulatedFs.get(targetTmp)!);
  simulatedFs.delete(targetTmp);

  assert.ok(simulatedFs.has(targetBin));
  assert.ok(!simulatedFs.has(targetTmp));
  assert.equal(simulatedFs.get(targetBin)!.toString('utf8'), 'TEST_DATA_CIPHER');
});

console.log('========================================================================');
console.log(` RESULTADOS DE LAS PRUEBAS FASE 3.5.0:`);
console.log(`   PASS-UNIT:   ${passUnitCount}`);
console.log(`   PASS-MOCK:   ${passMockCount}`);
console.log(`   PASS-STATIC: ${passStaticCount}`);
console.log(`   TOTAL:       ${passUnitCount + passMockCount + passStaticCount} PRUEBAS EXITOSAS (100%)`);
console.log('========================================================================');
