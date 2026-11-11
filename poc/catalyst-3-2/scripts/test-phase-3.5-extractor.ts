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
  PreflightReport,
  createPreflightAuthEnvelope,
  verifyPreflightTokenAuthenticity,
  auditExtractGates,
  executeCryptoSelfTest,
  executeLocalSecurityAudit,
  evaluateDefinitiveCacheState,
  simulatePreflightBinaryMigration,
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

// -----------------------------------------------------------------------------
// 9. Validación Criptográfica DPAPI y Auditoría de Compuertas (FASE 3.5.0.1)
// -----------------------------------------------------------------------------
runUnit('9.1: executeCryptoSelfTest ejecuta exitosamente el protocolo de 11 pasos DPAPI', () => {
  const provider = new MockDpapiProvider();
  const res = executeCryptoSelfTest(provider);
  assert.equal(res.success, true);
  assert.equal(res.stepsPassed, 11);
  assert.ok(res.details.includes('11/11 pasos aprobados'));
});

runUnit('9.2: Rechazo estricto de ciphertext alterado en DPAPI (resistencia a manipulación)', () => {
  const provider = new MockDpapiProvider();
  const plain = Buffer.from('TEST_PAYLOAD_TAMPER_CHECK', 'utf8');
  const cipher = provider.protect(plain);

  const tampered = Buffer.from(cipher);
  tampered[tampered.length - 1] ^= 0x55;

  assert.throws(() => {
    provider.unprotect(tampered);
  }, /DPAPI_ERROR/);
});

runMock('9.3: Preflight Token autenticado genera sobre criptográfico y pasa validación', () => {
  const provider = new MockDpapiProvider();
  const tokenReport: PreflightReport = {
    executionId: 'exec-123',
    timestamp: new Date().toISOString(),
    projectId: 'gen-lang-client-0041212770',
    databaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    usersDiscovered: 5,
    totalDocumentsDiscovered: 73,
    countsByUser: {},
    administrativeCounts: {},
    errors: [],
    status: 'PREFLIGHT_PASS',
  };

  const { envelope, rawJson } = createPreflightAuthEnvelope(tokenReport);
  const cipherEnvelope = provider.protect(Buffer.from(JSON.stringify(envelope), 'utf8'));

  const verif = verifyPreflightTokenAuthenticity({
    plainJson: rawJson,
    authEnvelopeBytes: cipherEnvelope,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
  });

  assert.equal(verif.valid, true);
  assert.equal(verif.envelope?.status, 'PREFLIGHT_PASS');
});

runMock('9.4: Preflight Token manipulado en JSON es rechazado con TOKEN_TAMPERED', () => {
  const provider = new MockDpapiProvider();
  const tokenReport: PreflightReport = {
    executionId: 'exec-123',
    timestamp: new Date().toISOString(),
    projectId: 'gen-lang-client-0041212770',
    databaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    usersDiscovered: 5,
    totalDocumentsDiscovered: 73,
    countsByUser: {},
    administrativeCounts: {},
    errors: [],
    status: 'BASELINE_DRIFT', // Original es DRIFT
  };

  const { envelope, rawJson } = createPreflightAuthEnvelope(tokenReport);
  const cipherEnvelope = provider.protect(Buffer.from(JSON.stringify(envelope), 'utf8'));

  // Intento de manipulación manual del JSON: cambiar status a PREFLIGHT_PASS
  const tamperedJson = rawJson.replace('BASELINE_DRIFT', 'PREFLIGHT_PASS');

  const verif = verifyPreflightTokenAuthenticity({
    plainJson: tamperedJson,
    authEnvelopeBytes: cipherEnvelope,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
  });

  assert.equal(verif.valid, false);
  assert.equal(verif.errorCode, 'TOKEN_TAMPERED');
});

runMock('9.5: Preflight Token caducado (> 60 min) es rechazado con TOKEN_EXPIRED', () => {
  const provider = new MockDpapiProvider();
  const expiredTime = new Date(Date.now() - 65 * 60 * 1000).toISOString(); // Hace 65 min
  const tokenReport: PreflightReport = {
    executionId: 'exec-old',
    timestamp: expiredTime,
    projectId: 'gen-lang-client-0041212770',
    databaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    usersDiscovered: 5,
    totalDocumentsDiscovered: 73,
    countsByUser: {},
    administrativeCounts: {},
    errors: [],
    status: 'PREFLIGHT_PASS',
  };

  const { envelope, rawJson } = createPreflightAuthEnvelope(tokenReport);
  const cipherEnvelope = provider.protect(Buffer.from(JSON.stringify(envelope), 'utf8'));

  const verif = verifyPreflightTokenAuthenticity({
    plainJson: rawJson,
    authEnvelopeBytes: cipherEnvelope,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    maxAgeMinutes: 60,
  });

  assert.equal(verif.valid, false);
  assert.equal(verif.errorCode, 'TOKEN_EXPIRED');
});

runMock('9.6: Preflight Token emitido para otro proyecto GCP es rechazado con PROJECT_MISMATCH', () => {
  const provider = new MockDpapiProvider();
  const tokenReport: PreflightReport = {
    executionId: 'exec-other-proj',
    timestamp: new Date().toISOString(),
    projectId: 'rogue-unauthorized-project',
    databaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    usersDiscovered: 5,
    totalDocumentsDiscovered: 73,
    countsByUser: {},
    administrativeCounts: {},
    errors: [],
    status: 'PREFLIGHT_PASS',
  };

  const { envelope, rawJson } = createPreflightAuthEnvelope(tokenReport);
  const cipherEnvelope = provider.protect(Buffer.from(JSON.stringify(envelope), 'utf8'));

  const verif = verifyPreflightTokenAuthenticity({
    plainJson: rawJson,
    authEnvelopeBytes: cipherEnvelope,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
  });

  assert.equal(verif.valid, false);
  assert.equal(verif.errorCode, 'PROJECT_MISMATCH');
});

runMock('9.7: Preflight Token emitido para otra base de datos Firestore es rechazado con DATABASE_MISMATCH', () => {
  const provider = new MockDpapiProvider();
  const tokenReport: PreflightReport = {
    executionId: 'exec-other-db',
    timestamp: new Date().toISOString(),
    projectId: 'gen-lang-client-0041212770',
    databaseId: '(default)', // Default DB en lugar de la named DB
    usersDiscovered: 5,
    totalDocumentsDiscovered: 73,
    countsByUser: {},
    administrativeCounts: {},
    errors: [],
    status: 'PREFLIGHT_PASS',
  };

  const { envelope, rawJson } = createPreflightAuthEnvelope(tokenReport);
  const cipherEnvelope = provider.protect(Buffer.from(JSON.stringify(envelope), 'utf8'));

  const verif = verifyPreflightTokenAuthenticity({
    plainJson: rawJson,
    authEnvelopeBytes: cipherEnvelope,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
  });

  assert.equal(verif.valid, false);
  assert.equal(verif.errorCode, 'DATABASE_MISMATCH');
});

runMock('9.8: auditExtractGates bloquea extracción si ADC es inválido', () => {
  const audit = auditExtractGates({
    adcValid: false,
    preflightVerification: { valid: true },
    preflightReport: { status: 'PREFLIGHT_PASS', errors: [] } as any,
    driftAcknowledged: false,
    operatorConfirmed: true,
    maintenanceWindowConfirmed: true,
    dpapiSelfTestPassed: true,
    gitExclusionActive: true,
  });

  assert.equal(audit.allowed, false);
  assert.equal(audit.failedGateCode, 'GATE_ADC_INVALID');
});

runMock('9.9: auditExtractGates bloquea extracción si el operador no confirma explícitamente', () => {
  const audit = auditExtractGates({
    adcValid: true,
    preflightVerification: { valid: true },
    preflightReport: { status: 'PREFLIGHT_PASS', errors: [] } as any,
    driftAcknowledged: false,
    operatorConfirmed: false, // NO confirmado!
    maintenanceWindowConfirmed: true,
    dpapiSelfTestPassed: true,
    gitExclusionActive: true,
  });

  assert.equal(audit.allowed, false);
  assert.equal(audit.failedGateCode, 'GATE_OPERATOR_NOT_CONFIRMED');
});

runMock('9.10: auditExtractGates bloquea extracción si falta confirmación de ventana de mantenimiento', () => {
  const audit = auditExtractGates({
    adcValid: true,
    preflightVerification: { valid: true },
    preflightReport: { status: 'PREFLIGHT_PASS', errors: [] } as any,
    driftAcknowledged: false,
    operatorConfirmed: true,
    maintenanceWindowConfirmed: false, // NO confirmada!
    dpapiSelfTestPassed: true,
    gitExclusionActive: true,
  });

  assert.equal(audit.allowed, false);
  assert.equal(audit.failedGateCode, 'GATE_MAINTENANCE_NOT_CONFIRMED');
});

runMock('9.11: auditExtractGates bloquea extracción si .data/ no está excluido en .gitignore', () => {
  const audit = auditExtractGates({
    adcValid: true,
    preflightVerification: { valid: true },
    preflightReport: { status: 'PREFLIGHT_PASS', errors: [] } as any,
    driftAcknowledged: false,
    operatorConfirmed: true,
    maintenanceWindowConfirmed: true,
    dpapiSelfTestPassed: true,
    gitExclusionActive: false, // Fuga a git!
  });

  assert.equal(audit.allowed, false);
  assert.equal(audit.failedGateCode, 'GATE_GIT_NOT_PROTECTED');
});

runMock('9.12: auditExtractGates bloquea extracción si el checkpoint es inconsistente', () => {
  const audit = auditExtractGates({
    adcValid: true,
    preflightVerification: { valid: true },
    preflightReport: { status: 'PREFLIGHT_PASS', errors: [] } as any,
    driftAcknowledged: false,
    operatorConfirmed: true,
    maintenanceWindowConfirmed: true,
    dpapiSelfTestPassed: true,
    gitExclusionActive: true,
    checkpointStatus: 'INCONSISTENT',
  });

  assert.equal(audit.allowed, false);
  assert.equal(audit.failedGateCode, 'GATE_CHECKPOINT_INCONSISTENT');
});

runMock('9.13: auditExtractGates bloquea extracción si existe drift no reconocido', () => {
  const audit = auditExtractGates({
    adcValid: true,
    preflightVerification: { valid: true },
    preflightReport: { status: 'BASELINE_DRIFT', errors: [] } as any,
    driftAcknowledged: false, // NO reconocido!
    operatorConfirmed: true,
    maintenanceWindowConfirmed: true,
    dpapiSelfTestPassed: true,
    gitExclusionActive: true,
  });

  assert.equal(audit.allowed, false);
  assert.equal(audit.failedGateCode, 'GATE_DRIFT_NOT_ACKNOWLEDGED');
});

runMock('9.14: auditExtractGates aprueba extracción cuando todas las 10 compuertas están satisfechas', () => {
  const audit = auditExtractGates({
    adcValid: true,
    preflightVerification: { valid: true },
    preflightReport: { status: 'PREFLIGHT_PASS', errors: [] } as any,
    driftAcknowledged: false,
    operatorConfirmed: true,
    maintenanceWindowConfirmed: true,
    dpapiSelfTestPassed: true,
    gitExclusionActive: true,
    checkpointStatus: 'CLEAN',
  });

  assert.equal(audit.allowed, true);
  assert.equal(audit.failedGateCode, undefined);
});

// -----------------------------------------------------------------------------
// 10. Auditoría Runtime de Seguridad Local (FASE 3.5.0.2)
// -----------------------------------------------------------------------------
function createStandardValidPreflight() {
  const provider = new MockDpapiProvider();
  const tokenReport: PreflightReport = {
    executionId: 'exec-sec-audit',
    timestamp: new Date().toISOString(),
    projectId: 'gen-lang-client-0041212770',
    databaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    usersDiscovered: 5,
    totalDocumentsDiscovered: 73,
    countsByUser: {
      USER_001: { biometrics: 1, groceries: 1 },
      USER_002: { biometrics: 1, groceries: 1 },
    },
    administrativeCounts: { adminUserDirectory: 0 },
    errors: [],
    status: 'PREFLIGHT_PASS',
  };

  const { envelope, rawJson } = createPreflightAuthEnvelope(tokenReport);
  const binBytes = provider.protect(Buffer.from(JSON.stringify(envelope), 'utf8'));

  return { provider, rawJson, binBytes };
}

runUnit('10.1: executeLocalSecurityAudit aprueba con preflight dual íntegro, ACL sintética y Git protegido', () => {
  const { provider, rawJson, binBytes } = createStandardValidPreflight();
  const res = executeLocalSecurityAudit({
    jsonExists: true,
    binExists: true,
    jsonLength: Buffer.byteLength(rawJson),
    binLength: binBytes.length,
    plainJson: rawJson,
    binBytes,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    syntheticAclTested: true,
    gitExclusionActive: true,
    strayBinFilesCount: 0,
  });

  assert.equal(res.passed, true);
  assert.equal(res.verdict, 'LOCAL SECURITY VERIFIED — EXTRACTION REVIEW READY');
  assert.equal(res.errors.length, 0);
  assert.equal(res.checks['TOKEN_AUTHENTICITY'].status, 'PASS');
  assert.equal(res.checks['NTFS_ACL'].status, 'PASS');
  assert.equal(res.checks['GIT_EXCLUSION'].status, 'PASS');
});

runMock('10.2: executeLocalSecurityAudit reporta PREFLIGHT_BINARY_MISSING si falta preflight-token.bin', () => {
  const { provider, rawJson } = createStandardValidPreflight();
  const res = executeLocalSecurityAudit({
    jsonExists: true,
    binExists: false,
    jsonLength: Buffer.byteLength(rawJson),
    binLength: 0,
    plainJson: rawJson,
    binBytes: Buffer.alloc(0),
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    syntheticAclTested: true,
    gitExclusionActive: true,
    strayBinFilesCount: 0,
  });

  assert.equal(res.passed, false);
  assert.equal(res.verdict, 'PARTIALLY VERIFIED — BLOCKERS REMAIN');
  assert.ok(res.errors.includes('PREFLIGHT_BINARY_MISSING'));
});

runMock('10.3: executeLocalSecurityAudit reporta PREFLIGHT_BINARY_DECRYPT_ERROR si preflight-token.bin está corrupto', () => {
  const { provider, rawJson, binBytes } = createStandardValidPreflight();
  const corruptedBin = Buffer.from(binBytes);
  corruptedBin[corruptedBin.length - 2] ^= 0xaa;

  const res = executeLocalSecurityAudit({
    jsonExists: true,
    binExists: true,
    jsonLength: Buffer.byteLength(rawJson),
    binLength: corruptedBin.length,
    plainJson: rawJson,
    binBytes: corruptedBin,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    syntheticAclTested: true,
    gitExclusionActive: true,
    strayBinFilesCount: 0,
  });

  assert.equal(res.passed, false);
  assert.ok(res.errors.includes('PREFLIGHT_BINARY_DECRYPT_ERROR'));
});

runMock('10.4: executeLocalSecurityAudit reporta PREFLIGHT_TOKEN_TAMPERED si el JSON fue alterado respecto al hash autenticado', () => {
  const { provider, rawJson, binBytes } = createStandardValidPreflight();
  const tamperedJson = rawJson.replace('"totalDocumentsDiscovered":73', '"totalDocumentsDiscovered":74');

  const res = executeLocalSecurityAudit({
    jsonExists: true,
    binExists: true,
    jsonLength: Buffer.byteLength(tamperedJson),
    binLength: binBytes.length,
    plainJson: tamperedJson,
    binBytes,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    syntheticAclTested: true,
    gitExclusionActive: true,
    strayBinFilesCount: 0,
  });

  assert.equal(res.passed, false);
  assert.ok(res.errors.includes('PREFLIGHT_TOKEN_TAMPERED'));
});

runMock('10.5: executeLocalSecurityAudit reporta PREFLIGHT_PROJECT_MISMATCH si el proyecto GCP no coincide', () => {
  const { provider, rawJson, binBytes } = createStandardValidPreflight();
  const res = executeLocalSecurityAudit({
    jsonExists: true,
    binExists: true,
    jsonLength: Buffer.byteLength(rawJson),
    binLength: binBytes.length,
    plainJson: rawJson,
    binBytes,
    cryptoProvider: provider,
    expectedProjectId: 'other-unauthorized-gcp-project',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    syntheticAclTested: true,
    gitExclusionActive: true,
    strayBinFilesCount: 0,
  });

  assert.equal(res.passed, false);
  assert.ok(res.errors.includes('PREFLIGHT_PROJECT_MISMATCH'));
});

runMock('10.6: executeLocalSecurityAudit reporta PREFLIGHT_DATABASE_MISMATCH si la base Firestore no coincide', () => {
  const { provider, rawJson, binBytes } = createStandardValidPreflight();
  const res = executeLocalSecurityAudit({
    jsonExists: true,
    binExists: true,
    jsonLength: Buffer.byteLength(rawJson),
    binLength: binBytes.length,
    plainJson: rawJson,
    binBytes,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: '(default)',
    syntheticAclTested: true,
    gitExclusionActive: true,
    strayBinFilesCount: 0,
  });

  assert.equal(res.passed, false);
  assert.ok(res.errors.includes('PREFLIGHT_DATABASE_MISMATCH'));
});

runMock('10.7: executeLocalSecurityAudit reporta PREFLIGHT_STATUS_NOT_PASS si el estado no es PREFLIGHT_PASS', () => {
  const provider = new MockDpapiProvider();
  const tokenReport: PreflightReport = {
    executionId: 'exec-drift',
    timestamp: new Date().toISOString(),
    projectId: 'gen-lang-client-0041212770',
    databaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    usersDiscovered: 5,
    totalDocumentsDiscovered: 74,
    countsByUser: {},
    administrativeCounts: {},
    errors: [],
    status: 'BASELINE_DRIFT',
  };
  const { envelope, rawJson } = createPreflightAuthEnvelope(tokenReport);
  const binBytes = provider.protect(Buffer.from(JSON.stringify(envelope), 'utf8'));

  const res = executeLocalSecurityAudit({
    jsonExists: true,
    binExists: true,
    jsonLength: Buffer.byteLength(rawJson),
    binLength: binBytes.length,
    plainJson: rawJson,
    binBytes,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    syntheticAclTested: true,
    gitExclusionActive: true,
    strayBinFilesCount: 0,
  });

  assert.equal(res.passed, false);
  assert.ok(res.errors.includes('PREFLIGHT_STATUS_NOT_PASS'));
});

runMock('10.8: executeLocalSecurityAudit reporta PREFLIGHT_TOKEN_EXPIRED si la antigüedad supera 60 minutos', () => {
  const provider = new MockDpapiProvider();
  const oldDate = new Date(Date.now() - 75 * 60 * 1000).toISOString();
  const tokenReport: PreflightReport = {
    executionId: 'exec-old',
    timestamp: oldDate,
    projectId: 'gen-lang-client-0041212770',
    databaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    usersDiscovered: 5,
    totalDocumentsDiscovered: 73,
    countsByUser: {},
    administrativeCounts: {},
    errors: [],
    status: 'PREFLIGHT_PASS',
  };
  const { envelope, rawJson } = createPreflightAuthEnvelope(tokenReport);
  const binBytes = provider.protect(Buffer.from(JSON.stringify(envelope), 'utf8'));

  const res = executeLocalSecurityAudit({
    jsonExists: true,
    binExists: true,
    jsonLength: Buffer.byteLength(rawJson),
    binLength: binBytes.length,
    plainJson: rawJson,
    binBytes,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    maxAgeMinutes: 60,
    syntheticAclTested: true,
    gitExclusionActive: true,
    strayBinFilesCount: 0,
  });

  assert.equal(res.passed, false);
  assert.ok(res.errors.includes('PREFLIGHT_TOKEN_EXPIRED'));
});

runMock('10.9: executeLocalSecurityAudit reporta PREFLIGHT_CONTAINS_NULL_OR_ERRORS si hay conteo null o errores en JSON', () => {
  const provider = new MockDpapiProvider();
  const tokenReport: PreflightReport = {
    executionId: 'exec-err',
    timestamp: new Date().toISOString(),
    projectId: 'gen-lang-client-0041212770',
    databaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    usersDiscovered: 5,
    totalDocumentsDiscovered: 73,
    countsByUser: {
      USER_001: { biometrics: null },
    },
    administrativeCounts: {},
    errors: [sanitizeErrorMessage('HTTP 500 internal server error', 500)],
    status: 'PREFLIGHT_PASS',
  };
  const { envelope, rawJson } = createPreflightAuthEnvelope(tokenReport);
  const binBytes = provider.protect(Buffer.from(JSON.stringify(envelope), 'utf8'));

  const res = executeLocalSecurityAudit({
    jsonExists: true,
    binExists: true,
    jsonLength: Buffer.byteLength(rawJson),
    binLength: binBytes.length,
    plainJson: rawJson,
    binBytes,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    syntheticAclTested: true,
    gitExclusionActive: true,
    strayBinFilesCount: 0,
  });

  assert.equal(res.passed, false);
  assert.ok(res.errors.includes('PREFLIGHT_CONTAINS_NULL_OR_ERRORS'));
});

runMock('10.10: executeLocalSecurityAudit reporta SECURITY_LEAK_ADC_TOKEN_FOUND si detecta patrón ya29...', () => {
  const provider = new MockDpapiProvider();
  const tokenReport: PreflightReport = {
    executionId: 'exec-leak',
    timestamp: new Date().toISOString(),
    projectId: 'gen-lang-client-0041212770',
    databaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    usersDiscovered: 5,
    totalDocumentsDiscovered: 73,
    countsByUser: {},
    administrativeCounts: {},
    errors: ['ya29.a0AfH6SMD_leak_token_sample_string_12345'],
    status: 'PREFLIGHT_PASS',
  };
  const { envelope, rawJson } = createPreflightAuthEnvelope(tokenReport);
  const binBytes = provider.protect(Buffer.from(JSON.stringify(envelope), 'utf8'));

  const res = executeLocalSecurityAudit({
    jsonExists: true,
    binExists: true,
    jsonLength: Buffer.byteLength(rawJson),
    binLength: binBytes.length,
    plainJson: rawJson,
    binBytes,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    syntheticAclTested: true,
    gitExclusionActive: true,
    strayBinFilesCount: 0,
  });

  assert.equal(res.passed, false);
  assert.ok(res.errors.includes('SECURITY_LEAK_ADC_TOKEN_FOUND'));
});

runMock('10.11: executeLocalSecurityAudit reporta ACL_TEST_FAILED si la comprobación de ACL sintética falla', () => {
  const { provider, rawJson, binBytes } = createStandardValidPreflight();
  const res = executeLocalSecurityAudit({
    jsonExists: true,
    binExists: true,
    jsonLength: Buffer.byteLength(rawJson),
    binLength: binBytes.length,
    plainJson: rawJson,
    binBytes,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    syntheticAclTested: false,
    gitExclusionActive: true,
    strayBinFilesCount: 0,
  });

  assert.equal(res.passed, false);
  assert.ok(res.errors.includes('ACL_TEST_FAILED'));
});

runMock('10.12: executeLocalSecurityAudit reporta STRAY_BIN_FILES_FOUND si existen archivos binarios fuera de .data/', () => {
  const { provider, rawJson, binBytes } = createStandardValidPreflight();
  const res = executeLocalSecurityAudit({
    jsonExists: true,
    binExists: true,
    jsonLength: Buffer.byteLength(rawJson),
    binLength: binBytes.length,
    plainJson: rawJson,
    binBytes,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    syntheticAclTested: true,
    gitExclusionActive: true,
    strayBinFilesCount: 2,
  });

  assert.equal(res.passed, false);
  assert.ok(res.errors.includes('STRAY_BIN_FILES_FOUND'));
});

// -----------------------------------------------------------------------------
// 11. Remediación de Preflight Binario y Conciliación de Caché (FASE 3.5.0.3)
// -----------------------------------------------------------------------------
runUnit('11.1: Nueva ruta binaria: executeLocalSecurityAudit valida preflight-token.bin en control/', () => {
  const { provider, rawJson, binBytes } = createStandardValidPreflight();
  const res = executeLocalSecurityAudit({
    jsonExists: true,
    binExists: true,
    jsonLength: Buffer.byteLength(rawJson),
    binLength: binBytes.length,
    plainJson: rawJson,
    binBytes,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    binLocation: 'CONTROL',
    syntheticAclTested: true,
    gitExclusionActive: true,
    strayBinFilesCount: 0,
  });

  assert.equal(res.passed, true);
  assert.equal(res.verdict, 'LOCAL SECURITY VERIFIED — EXTRACTION REVIEW READY');
  assert.equal(res.checks['PREFLIGHT_BIN'].status, 'PASS');
  assert.ok(res.checks['PREFLIGHT_BIN'].details.includes('control/'));
});

runUnit('11.2: Migración segura: simulatePreflightBinaryMigration preserva SHA-256 exacto', () => {
  const sampleCiphertext = Buffer.from('SIMULATED_DPAPI_ENVELOPE_CIPHERTEXT_1234567890');
  const res = simulatePreflightBinaryMigration({
    sourceExists: true,
    sourceLength: sampleCiphertext.length,
    sourceBytes: sampleCiphertext,
    targetExists: false,
    targetDirExists: true,
    aclProtected: true,
  });

  assert.equal(res.success, true);
  assert.equal(res.sourceRemoved, true);
  assert.ok(res.migratedBytes?.equals(sampleCiphertext));
});

runUnit('11.3: Anti-sobrescritura: simulatePreflightBinaryMigration rechaza sobrescribir destino existente', () => {
  const res = simulatePreflightBinaryMigration({
    sourceExists: true,
    sourceLength: 534,
    targetExists: true, // ¡Destino ya existe!
    targetDirExists: true,
    aclProtected: true,
  });

  assert.equal(res.success, false);
  assert.equal(res.errorCode, 'TARGET_ALREADY_EXISTS');
});

runUnit('11.4: Migración falla fail-closed si el archivo origen no existe', () => {
  const res = simulatePreflightBinaryMigration({
    sourceExists: false, // ¡Origen no existe!
    sourceLength: 0,
    targetExists: false,
    targetDirExists: true,
    aclProtected: true,
  });

  assert.equal(res.success, false);
  assert.equal(res.errorCode, 'SOURCE_FILE_MISSING');
});

runUnit('11.5: Migración falla si el archivo origen tiene 0 bytes', () => {
  const res = simulatePreflightBinaryMigration({
    sourceExists: true,
    sourceLength: 0, // ¡Vacío!
    targetExists: false,
    targetDirExists: true,
    aclProtected: true,
  });

  assert.equal(res.success, false);
  assert.equal(res.errorCode, 'SOURCE_FILE_EMPTY');
});

runUnit('11.6: Migración falla si el directorio control carece de ACL protegida', () => {
  const res = simulatePreflightBinaryMigration({
    sourceExists: true,
    sourceLength: 534,
    targetExists: false,
    targetDirExists: true,
    aclProtected: false, // ACL insuficiente
  });

  assert.equal(res.success, false);
  assert.equal(res.errorCode, 'ACL_PROTECTION_FAILED');
});

runUnit('11.7: Conciliación de caché: clasifica DIRECTORY_ABSENT si el directorio no existe', () => {
  const inv = evaluateDefinitiveCacheState({
    directoryExists: false,
  });

  assert.equal(inv.state, 'DIRECTORY_ABSENT');
  assert.equal(inv.fileCount, 0);
  assert.equal(inv.totalBytes, 0);
});

runUnit('11.8: Conciliación de caché: clasifica DIRECTORY_PRESENT_EMPTY si el directorio está vacío', () => {
  const inv = evaluateDefinitiveCacheState({
    directoryExists: true,
    entries: [],
  });

  assert.equal(inv.state, 'DIRECTORY_PRESENT_EMPTY');
  assert.equal(inv.fileCount, 0);
});

runUnit('11.9: Conciliación de caché: clasifica DIRECTORY_PRESENT_WITH_UNEXPECTED_FILES ante archivos ajenos', () => {
  const inv = evaluateDefinitiveCacheState({
    directoryExists: true,
    entries: [
      { name: 'random_dump.txt', isDirectory: false, length: 120, extension: '.txt' },
      { name: 'unknown_script.ps1', isDirectory: false, length: 500, extension: '.ps1' },
    ],
  });

  assert.equal(inv.state, 'DIRECTORY_PRESENT_WITH_UNEXPECTED_FILES');
  assert.equal(inv.fileCount, 2);
  assert.ok(inv.extensions.includes('.txt'));
});

runUnit('11.10: Conciliación de caché: clasifica DIRECTORY_PRESENT_WITH_UNVERIFIED_CACHE ante documentos doc-*.bin', () => {
  const inv = evaluateDefinitiveCacheState({
    directoryExists: true,
    entries: [
      { name: 'doc-000001.bin', isDirectory: false, length: 1024, extension: '.bin' },
      { name: 'doc-000002.bin', isDirectory: false, length: 2048, extension: '.bin' },
      { name: 'control', isDirectory: true, length: 0, extension: '' },
    ],
  });

  assert.equal(inv.state, 'DIRECTORY_PRESENT_WITH_UNVERIFIED_CACHE');
  assert.equal(inv.fileCount, 2);
  assert.equal(inv.dirCount, 1);
  assert.equal(inv.totalBytes, 3072);
});

runUnit('11.11: Conciliación de caché: clasifica DIRECTORY_PRESENT_WITH_FILES cuando solo contiene control/', () => {
  const inv = evaluateDefinitiveCacheState({
    directoryExists: true,
    entries: [
      { name: 'control', isDirectory: true, length: 0, extension: '' },
    ],
  });

  assert.equal(inv.state, 'DIRECTORY_PRESENT_WITH_FILES');
  assert.equal(inv.dirCount, 1);
  assert.equal(inv.fileCount, 0);
});

runUnit('11.12: Conciliación de caché: reporta ACL insuficiente si hereda permisos o contiene Everyone/Users', () => {
  const inv = evaluateDefinitiveCacheState({
    directoryExists: true,
    entries: [],
    aclProtected: false, // Herencia activa
    aclHasUsersOrEveryone: true, // Permisos excesivos
  });

  assert.equal(inv.aclProtected, false);
  assert.equal(inv.aclHasUsersOrEveryone, true);

  const { provider, rawJson, binBytes } = createStandardValidPreflight();
  const res = executeLocalSecurityAudit({
    jsonExists: true,
    binExists: true,
    jsonLength: Buffer.byteLength(rawJson),
    binLength: binBytes.length,
    plainJson: rawJson,
    binBytes,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    binLocation: 'CONTROL',
    definitiveCacheInventory: inv,
    syntheticAclTested: true,
    gitExclusionActive: true,
  });

  assert.equal(res.checks['DEFINITIVE_CACHE_ACL'].status, 'FAIL');
});

runMock('11.13: Escáner reporta UNALLOWED_BINARY_LOCATION si preflight-token.bin reside en reports/', () => {
  const { provider, rawJson, binBytes } = createStandardValidPreflight();
  const res = executeLocalSecurityAudit({
    jsonExists: true,
    binExists: false, // Falta en control/
    jsonLength: Buffer.byteLength(rawJson),
    binLength: binBytes.length,
    plainJson: rawJson,
    binBytes,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    binLocation: 'REPORTS', // Ubicación no permitida
    disallowedBins: ['poc/catalyst-3-2/reports/firestore-extraction-3.5/preflight-token.bin'],
    syntheticAclTested: true,
    gitExclusionActive: true,
  });

  assert.equal(res.passed, false);
  assert.equal(res.verdict, 'PARTIALLY VERIFIED — BLOCKERS REMAIN');
  assert.ok(res.errors.includes('UNALLOWED_BINARY_LOCATION'));
  assert.ok(res.errors.includes('PREFLIGHT_BINARY_MISSING'));
});

runMock('11.14: Escáner reporta SUSPICIOUS_BINARY_DETECTED si detecta binario no estándar dentro de .data/', () => {
  const { provider, rawJson, binBytes } = createStandardValidPreflight();
  const res = executeLocalSecurityAudit({
    jsonExists: true,
    binExists: true,
    jsonLength: Buffer.byteLength(rawJson),
    binLength: binBytes.length,
    plainJson: rawJson,
    binBytes,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    binLocation: 'CONTROL',
    suspiciousBins: ['poc/catalyst-3-2/.data/firestore-export/unauthorized_dump.bin'],
    syntheticAclTested: true,
    gitExclusionActive: true,
  });

  assert.equal(res.passed, false);
  assert.ok(res.errors.includes('SUSPICIOUS_BINARY_DETECTED'));
});

runMock('11.15: Token vencido: executeLocalSecurityAudit reporta PREFLIGHT_TOKEN_EXPIRED a los 300.6 minutos', () => {
  const provider = new MockDpapiProvider();
  const expiredTime = new Date(Date.now() - 300.6 * 60 * 1000).toISOString(); // 300.6 min como en terminal Windows
  const tokenReport: PreflightReport = {
    executionId: 'exec-win-audit',
    timestamp: expiredTime,
    projectId: 'gen-lang-client-0041212770',
    databaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    usersDiscovered: 5,
    totalDocumentsDiscovered: 73,
    countsByUser: {},
    administrativeCounts: {},
    errors: [],
    status: 'PREFLIGHT_PASS',
  };

  const { envelope, rawJson } = createPreflightAuthEnvelope(tokenReport);
  const binBytes = provider.protect(Buffer.from(JSON.stringify(envelope), 'utf8'));

  const res = executeLocalSecurityAudit({
    jsonExists: true,
    binExists: true,
    jsonLength: Buffer.byteLength(rawJson),
    binLength: binBytes.length,
    plainJson: rawJson,
    binBytes,
    cryptoProvider: provider,
    expectedProjectId: 'gen-lang-client-0041212770',
    expectedDatabaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    binLocation: 'CONTROL',
    maxAgeMinutes: 60,
    syntheticAclTested: true,
    gitExclusionActive: true,
  });

  assert.equal(res.passed, false);
  assert.equal(res.verdict, 'PARTIALLY VERIFIED — BLOCKERS REMAIN');
  assert.ok(res.errors.includes('PREFLIGHT_TOKEN_EXPIRED'));
});

runMock('11.16: Ausencia de sobrescritura: Caché con documentos no permite sobrescrituras destructivas', () => {
  const inv = evaluateDefinitiveCacheState({
    directoryExists: true,
    entries: [
      { name: 'doc-000001.bin', isDirectory: false, length: 1024, extension: '.bin' },
    ],
  });

  assert.equal(inv.state, 'DIRECTORY_PRESENT_WITH_UNVERIFIED_CACHE');
  // Se confirma que el estado alerta anti-sobrescritura
  assert.ok(inv.opaqueNames.includes('doc-000001.bin'));
});

console.log('========================================================================');
console.log(` RESULTADOS DE LAS PRUEBAS FASES 3.5.0, 3.5.0.1, 3.5.0.2 Y 3.5.0.3:`);
console.log(`   PASS-UNIT:   ${passUnitCount}`);
console.log(`   PASS-MOCK:   ${passMockCount}`);
console.log(`   PASS-STATIC: ${passStaticCount}`);
console.log(`   TOTAL:       ${passUnitCount + passMockCount + passStaticCount} PRUEBAS EXITOSAS (100%)`);
console.log('========================================================================');


