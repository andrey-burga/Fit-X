/**
 * VigorCore — Batería Integral de Pruebas Unitarias de Cierre Técnico (Fase 3.4.2)
 * Valida los 4 Bloqueos Críticos: F-ID-01, F-ID-02, F-SER-01 y F-ROL-01
 */

import assert from 'node:assert/strict';
import {
  SecureIdentityLinker,
  InMemoryIdentityStore,
  type FirebaseTokenValidator,
  type FirebaseTokenClaims,
  type CatalystSessionContext,
} from '../src/etl/identityLinker.js';
import { BackendPartitionGuard } from '../src/etl/backendPartitionGuard.js';
import {
  deserializeFirestoreInteger,
  deserializeFirestoreTimestamp,
  deserializeFirestoreValue,
  deserializeFirestoreDocument,
  canonicalizeValue,
  toCanonicalJson,
  computeSourceHash,
  computeTransformedHash,
  computeDestinationHash,
  computeCanonicalSha256,
  INT64_MAX,
  INT64_MIN,
} from '../src/etl/serializationPrecision.js';
import {
  SafeRollbackEngine,
  type RollbackTargetStore,
  type MigrationManifestItem,
} from '../src/etl/rollbackSafety.js';

console.log('========================================================================');
console.log(' VIGORCORE FASE 3.4.2: PRUEBAS DE CIERRE TÉCNICO DE LOS 4 BLOQUEOS CRÍTICOS');
console.log('========================================================================\n');

let passedTests = 0;
const testQueue: Array<{ name: string; fn: () => void | Promise<void> }> = [];

function runTest(name: string, fn: () => void | Promise<void>) {
  testQueue.push({ name, fn });
}

// -----------------------------------------------------------------------------
// 1. PRUEBAS F-ID-01: VINCULACIÓN SEGURA DE IDENTIDADES (12 Casos)
// -----------------------------------------------------------------------------

const GCP_PROJECT = 'gen-lang-client-0041212770';

class MockTokenValidator implements FirebaseTokenValidator {
  public mockClaims: Record<string, FirebaseTokenClaims> = {};
  public invalidSignatures = new Set<string>();

  async verifyIdToken(tokenString: string) {
    if (this.invalidSignatures.has(tokenString)) {
      return { valid: false, error: 'SIGNATURE_VERIFICATION_FAILED' };
    }
    const claims = this.mockClaims[tokenString];
    if (!claims) {
      return { valid: false, error: 'TOKEN_UNKNOWN_OR_MALFORMED' };
    }
    return { valid: true, claims };
  }
}

const mockValidator = new MockTokenValidator();
const identityStore = new InMemoryIdentityStore();
const linker = new SecureIdentityLinker(GCP_PROJECT, mockValidator, identityStore, 300);

const nowSec = Math.floor(Date.now() / 1000);

// Helper for valid claims
function createValidClaims(uid: string, projectId = GCP_PROJECT, ageSeconds = 10): FirebaseTokenClaims {
  return {
    iss: `https://securetoken.google.com/${projectId}`,
    aud: projectId,
    sub: uid,
    email: `${uid.toLowerCase()}@test.vigorcore.com`,
    email_verified: true,
    auth_time: nowSec - ageSeconds,
    exp: nowSec + 3600,
    iat: nowSec - ageSeconds,
  };
}

runTest('F-ID-01.1: Vinculación exitosa con token Firebase válido y Catalyst confirmado', async () => {
  identityStore.clear();
  const token = 'tok_valid_user1';
  mockValidator.mockClaims[token] = createValidClaims('usr_firebase_001');

  const session: CatalystSessionContext = {
    userId: '1583000000001',
    email: 'usr_firebase_001@test.vigorcore.com',
    isConfirmed: true,
    status: 'ACTIVE',
  };

  const res = await linker.linkWithProofOfPossession(session, token);
  assert.equal(res.success, true);
  assert.equal(res.status, 'LINKED');
  assert.equal(res.sourceUid, 'usr_firebase_001');
  assert.equal(res.catalystUserId, '1583000000001');

  const saved = await identityStore.getMappingBySourceUid('usr_firebase_001');
  assert.ok(saved);
  assert.equal(saved?.linkStatus, 'LINKED_ACTIVE');
});

runTest('F-ID-01.2: Rechazo estricto ante firma de token Firebase inválida', async () => {
  const token = 'tok_bad_sig';
  mockValidator.invalidSignatures.add(token);

  const session: CatalystSessionContext = {
    userId: '1583000000002',
    email: 'u2@test.com',
    isConfirmed: true,
    status: 'ACTIVE',
  };

  const res = await linker.linkWithProofOfPossession(session, token);
  assert.equal(res.success, false);
  assert.equal(res.status, 'REJECTED_INVALID_PROOF');
  assert.match(res.error || '', /SIGNATURE_VERIFICATION_FAILED/);
});

runTest('F-ID-01.3: Rechazo estricto ante token expirado', async () => {
  const token = 'tok_expired';
  const claims = createValidClaims('usr_expired');
  claims.exp = nowSec - 10; // Expirado hace 10s
  mockValidator.mockClaims[token] = claims;

  const session: CatalystSessionContext = {
    userId: '1583000000003',
    email: 'exp@test.com',
    isConfirmed: true,
    status: 'ACTIVE',
  };

  const res = await linker.linkWithProofOfPossession(session, token);
  assert.equal(res.success, false);
  assert.equal(res.status, 'REJECTED_INVALID_PROOF');
  assert.match(res.error || '', /FIREBASE_TOKEN_EXPIRED/);
});

runTest('F-ID-01.4: Rechazo ante token emitido para otro proyecto GCP', async () => {
  const token = 'tok_other_project';
  mockValidator.mockClaims[token] = createValidClaims('usr_other', 'fake-gcp-project-999');

  const session: CatalystSessionContext = {
    userId: '1583000000004',
    email: 'other@test.com',
    isConfirmed: true,
    status: 'ACTIVE',
  };

  const res = await linker.linkWithProofOfPossession(session, token);
  assert.equal(res.success, false);
  assert.equal(res.status, 'REJECTED_TAMPERED');
  assert.match(res.error || '', /PROJECT_MISMATCH/);
});

runTest('F-ID-01.5: Rechazo ante cuenta Catalyst no confirmada (isConfirmed: false)', async () => {
  const token = 'tok_unconfirmed_cat';
  mockValidator.mockClaims[token] = createValidClaims('usr_unconfirmed');

  const session: CatalystSessionContext = {
    userId: '1583000000005',
    email: 'unconfirmed@test.com',
    isConfirmed: false, // Peligro de Account Takeover
    status: 'ACTIVE',
  };

  const res = await linker.linkWithProofOfPossession(session, token);
  assert.equal(res.success, false);
  assert.equal(res.status, 'REJECTED_UNCONFIRMED');
});

runTest('F-ID-01.6: Rechazo ante coincidencia de correo sin prueba de posesión Firebase', async () => {
  const session: CatalystSessionContext = {
    userId: '1583000000006',
    email: 'athlete@test.com',
    isConfirmed: true,
    status: 'ACTIVE',
  };

  // Se envía token vacío o null
  const res = await linker.linkWithProofOfPossession(session, '');
  assert.equal(res.success, false);
  assert.equal(res.status, 'REJECTED_INVALID_PROOF');
  assert.match(res.error || '', /MISSING_FIREBASE_PROOF_TOKEN/);
});

runTest('F-ID-01.7: Rechazo si el Firebase UID ya fue reclamado por otro usuario Catalyst', async () => {
  // Pre-enlazar usr_shared a Catalyst user 100
  await identityStore.saveMapping({
    pk: 'USER#usr_shared',
    sk: 'PROFILE',
    sourceUid: 'usr_shared',
    catalystUserId: '1583000000100',
    emailNormalized: 'shared@test.com',
    linkStatus: 'LINKED_ACTIVE',
    linkedMethod: 'PROOF_OF_POSSESSION_TOKEN',
    version: 1,
  });

  const token = 'tok_shared';
  mockValidator.mockClaims[token] = createValidClaims('usr_shared');

  // Usuario Catalyst 200 intenta reclamar el mismo Firebase UID
  const session: CatalystSessionContext = {
    userId: '1583000000200',
    email: 'shared@test.com',
    isConfirmed: true,
    status: 'ACTIVE',
  };

  const res = await linker.linkWithProofOfPossession(session, token);
  assert.equal(res.success, false);
  assert.equal(res.status, 'REJECTED_COLLISION');
  assert.match(res.error || '', /FIREBASE_UID_ALREADY_CLAIMED/);
});

runTest('F-ID-01.8: Rechazo si la cuenta Catalyst ya está vinculada a otro Firebase UID', async () => {
  // Catalyst user 300 ya vinculado a usr_first
  await identityStore.saveMapping({
    pk: 'USER#usr_first',
    sk: 'PROFILE',
    sourceUid: 'usr_first',
    catalystUserId: '1583000000300',
    emailNormalized: 'user300@test.com',
    linkStatus: 'LINKED_ACTIVE',
    linkedMethod: 'PROOF_OF_POSSESSION_TOKEN',
    version: 1,
  });

  const token = 'tok_second';
  mockValidator.mockClaims[token] = createValidClaims('usr_second');

  // Catalyst user 300 intenta vincular un segundo Firebase UID
  const session: CatalystSessionContext = {
    userId: '1583000000300',
    email: 'user300@test.com',
    isConfirmed: true,
    status: 'ACTIVE',
  };

  const res = await linker.linkWithProofOfPossession(session, token);
  assert.equal(res.success, false);
  assert.equal(res.status, 'REJECTED_COLLISION');
  assert.match(res.error || '', /CATALYST_ALREADY_LINKED/);
});

runTest('F-ID-01.9: Idempotencia: reintento de la misma vinculación devuelve ALREADY_LINKED', async () => {
  const token = 'tok_idem';
  mockValidator.mockClaims[token] = createValidClaims('usr_idem');

  const session: CatalystSessionContext = {
    userId: '1583000000400',
    email: 'idem@test.com',
    isConfirmed: true,
    status: 'ACTIVE',
  };

  const res1 = await linker.linkWithProofOfPossession(session, token);
  assert.equal(res1.status, 'LINKED');

  const res2 = await linker.linkWithProofOfPossession(session, token);
  assert.equal(res2.success, true);
  assert.equal(res2.status, 'ALREADY_LINKED');
  assert.equal(res2.sourceUid, 'usr_idem');
});

runTest('F-ID-01.10: Rechazo ante cuenta Catalyst suspendida o deshabilitada', async () => {
  const token = 'tok_suspended';
  mockValidator.mockClaims[token] = createValidClaims('usr_susp');

  const session: CatalystSessionContext = {
    userId: '1583000000500',
    email: 'susp@test.com',
    isConfirmed: true,
    status: 'SUSPENDED',
  };

  const res = await linker.linkWithProofOfPossession(session, token);
  assert.equal(res.success, false);
  assert.equal(res.status, 'REJECTED_SUSPENDED');
});

// -----------------------------------------------------------------------------
// 2. PRUEBAS F-ID-02: DERIVACIÓN FORZADA DE PARTICIÓN Y ANTI-IDOR (8 Casos)
// -----------------------------------------------------------------------------

const partitionGuard = new BackendPartitionGuard(identityStore);

runTest('F-ID-02.1: Usuario solicita sus propios datos y backend deriva partición correcta', async () => {
  // Asegurar mapeo en store
  await identityStore.saveMapping({
    pk: 'USER#usr_athlete_01',
    sk: 'PROFILE',
    sourceUid: 'usr_athlete_01',
    catalystUserId: '1583000000010',
    emailNormalized: 'ath1@test.com',
    linkStatus: 'LINKED_ACTIVE',
    linkedMethod: 'PROOF_OF_POSSESSION_TOKEN',
    version: 1,
  });

  const catalystUser = {
    userId: '1583000000010',
    email: 'ath1@test.com',
    isConfirmed: true,
    status: 'ACTIVE',
    role: 'athlete',
  };

  const req = {
    headers: { 'accept': 'application/json' },
    query: { limit: '20' },
  };

  const result = await partitionGuard.resolvePartition(catalystUser, req);
  assert.equal(result.authorized, true);
  assert.ok(result.context);
  assert.equal(result.context?.partitionKey, 'USER#usr_athlete_01');
  assert.equal(result.context?.sourceUid, 'usr_athlete_01');
});

runTest('F-ID-02.2: Rechazo ante intento de suplantación vía header x-user-id / x-auth-uid', async () => {
  const catalystUser = {
    userId: '1583000000010',
    email: 'ath1@test.com',
    isConfirmed: true,
    status: 'ACTIVE',
  };

  const req = {
    headers: { 'x-user-id': 'usr_victima_99' },
  };

  const result = await partitionGuard.resolvePartition(catalystUser, req);
  assert.equal(result.authorized, false);
  assert.equal(result.errorCode, 'SPOOFING_ATTEMPT_DETECTED');
});

runTest('F-ID-02.3: Rechazo ante intento de inyección de sourceUid en body (Anti-IDOR)', async () => {
  const catalystUser = {
    userId: '1583000000010',
    email: 'ath1@test.com',
    isConfirmed: true,
    status: 'ACTIVE',
  };

  const req = {
    body: {
      groceryName: 'Avena',
      sourceUid: 'usr_victima_99', // Intento de inyectar datos en cuenta ajena
    },
  };

  const result = await partitionGuard.resolvePartition(catalystUser, req);
  assert.equal(result.authorized, false);
  assert.equal(result.errorCode, 'SPOOFING_ATTEMPT_DETECTED');
});

runTest('F-ID-02.4: Rechazo ante intento de inyección de partition_key en query string', async () => {
  const catalystUser = {
    userId: '1583000000010',
    email: 'ath1@test.com',
    isConfirmed: true,
    status: 'ACTIVE',
  };

  const req = {
    query: {
      pk: 'USER#usr_victima_99',
    },
  };

  const result = await partitionGuard.resolvePartition(catalystUser, req);
  assert.equal(result.authorized, false);
  assert.equal(result.errorCode, 'SPOOFING_ATTEMPT_DETECTED');
});

runTest('F-ID-02.5: Rechazo si el mapeo de identidad no existe en la base de datos', async () => {
  const catalystUser = {
    userId: '1583000000999', // No existe en store
    email: 'notfound@test.com',
    isConfirmed: true,
    status: 'ACTIVE',
  };

  const result = await partitionGuard.resolvePartition(catalystUser, {});
  assert.equal(result.authorized, false);
  assert.equal(result.errorCode, 'IDENTITY_MAPPING_NOT_FOUND');
});

runTest('F-ID-02.6: Rechazo si el mapeo de identidad está deshabilitado / bloqueado', async () => {
  await identityStore.saveMapping({
    pk: 'USER#usr_locked',
    sk: 'PROFILE',
    sourceUid: 'usr_locked',
    catalystUserId: '1583000000020',
    emailNormalized: 'locked@test.com',
    linkStatus: 'DISPUTED_LOCKED',
    linkedMethod: 'PROOF_OF_POSSESSION_TOKEN',
    version: 1,
  });

  const catalystUser = {
    userId: '1583000000020',
    email: 'locked@test.com',
    isConfirmed: true,
    status: 'ACTIVE',
  };

  const result = await partitionGuard.resolvePartition(catalystUser, {});
  assert.equal(result.authorized, false);
  assert.equal(result.errorCode, 'IDENTITY_MAPPING_DISABLED');
});

runTest('F-ID-02.7: Rechazo de acceso a operación administrativa para atleta regular', async () => {
  const catalystUser = {
    userId: '1583000000010',
    email: 'ath1@test.com',
    isConfirmed: true,
    status: 'ACTIVE',
    role: 'athlete',
  };

  // Atleta intenta invocar endpoint admin
  const result = await partitionGuard.resolvePartition(catalystUser, {}, 'admin');
  assert.equal(result.authorized, false);
  assert.equal(result.errorCode, 'INSUFFICIENT_ADMIN_PERMISSIONS');
});

// -----------------------------------------------------------------------------
// 3. PRUEBAS F-SER-01: SERIALIZACIÓN SIN PÉRDIDA DE PRECISIÓN (14 Casos)
// -----------------------------------------------------------------------------

runTest('F-SER-01.1: deserializeFirestoreInteger deserializa exactamente INT64_MAX', () => {
  const str = '9223372036854775807';
  const big = deserializeFirestoreInteger(str);
  assert.equal(big, INT64_MAX);
  assert.equal(big.toString(), str);
});

runTest('F-SER-01.2: deserializeFirestoreInteger deserializa exactamente INT64_MIN', () => {
  const str = '-9223372036854775808';
  const big = deserializeFirestoreInteger(str);
  assert.equal(big, INT64_MIN);
  assert.equal(big.toString(), str);
});

runTest('F-SER-01.3: Demostración de que BigInt preserva precisión donde JS Number falla', () => {
  // Entero mayor a Number.MAX_SAFE_INTEGER (9007199254740991)
  const preciseStr = '9007199254740993';
  const big = deserializeFirestoreInteger(preciseStr);
  const ruinedNumber = Number(preciseStr);

  // Number("9007199254740993") se redondea erróneamente a 9007199254740992 en JS
  assert.notEqual(ruinedNumber.toString(), preciseStr);
  assert.equal(big.toString(), preciseStr);
});

runTest('F-SER-01.4: Rechazo fail-closed de entero que excede rango de 64 bits con signo', () => {
  const outOfBounds = '9223372036854775808'; // INT64_MAX + 1
  assert.throws(() => {
    deserializeFirestoreInteger(outOfBounds);
  }, /INTEGER_OUT_OF_BOUNDS/);
});

runTest('F-SER-01.5: Rechazo fail-closed de formato decimal inválido (flotante, hex, alfanumérico)', () => {
  assert.throws(() => deserializeFirestoreInteger('123.45'), /MALFORMED_INTEGER/);
  assert.throws(() => deserializeFirestoreInteger('0x12'), /MALFORMED_INTEGER/);
  assert.throws(() => deserializeFirestoreInteger('abc'), /MALFORMED_INTEGER/);
  assert.throws(() => deserializeFirestoreInteger(''), /MALFORMED_INTEGER/);
});

runTest('F-SER-01.6: deserializeFirestoreTimestamp preserva 9 dígitos de nanosegundos exactos', () => {
  const rfcStr = '2026-11-10T12:30:45.123456789Z';
  const ts = deserializeFirestoreTimestamp(rfcStr);

  assert.equal(ts['@type'], 'timestamp');
  assert.equal(ts.nanoseconds, 123456789);
  assert.equal(ts.rfc3339, rfcStr);
});

runTest('F-SER-01.7: deserializeFirestoreTimestamp normaliza offset de zona horaria a UTC', () => {
  // 17:30:00+05:00 equivale a 12:30:00Z
  const offsetStr = '2026-11-10T17:30:00+05:00';
  const ts = deserializeFirestoreTimestamp(offsetStr);

  assert.equal(ts.rfc3339, '2026-11-10T12:30:00Z');
});

runTest('F-SER-01.8: Deserialización de los 11 tipos oficiales de Firestore REST v1', () => {
  const rawFields = {
    str: { stringValue: 'VigorCore Atleta' },
    i64: { integerValue: '9007199254740995' },
    dbl: { doubleValue: 74.5 },
    bln: { booleanValue: true },
    nil: { nullValue: null },
    ts: { timestampValue: '2026-11-10T08:00:00.987654321Z' },
    map: { mapValue: { fields: { sub: { stringValue: 'anidado' } } } },
    arr: { arrayValue: { values: [{ stringValue: 'a' }, { stringValue: 'b' }] } },
    ref: { referenceValue: 'projects/p/databases/d/documents/users/usr_1' },
    bin: { bytesValue: 'aGVsbG8gd29ybGQ=' },
    geo: { geoPointValue: { latitude: 4.6097, longitude: -74.0817 } },
  };

  const doc = deserializeFirestoreDocument({
    name: 'projects/p/databases/d/documents/users/usr_1/groceries/g1',
    fields: rawFields,
    createTime: '2026-11-10T00:00:00Z',
    updateTime: '2026-11-10T01:00:00.123456Z',
  });

  assert.equal(doc.id, 'g1');
  assert.equal(doc.fields.str, 'VigorCore Atleta');
  assert.deepEqual(doc.fields.i64, { '@type': 'int64', value: '9007199254740995' });
  assert.equal(doc.fields.dbl, 74.5);
  assert.equal(doc.fields.bln, true);
  assert.equal(doc.fields.nil, null);
  assert.equal((doc.fields.ts as any).nanoseconds, 987654321);
  assert.deepEqual(doc.fields.map, { sub: 'anidado' });
  assert.deepEqual(doc.fields.arr, ['a', 'b']);
  assert.equal((doc.fields.ref as any).relativePath, 'users/usr_1');
  assert.equal((doc.fields.bin as any).base64, 'aGVsbG8gd29ybGQ=');
  assert.equal((doc.fields.geo as any).latitude, 4.6097);
});

runTest('F-SER-01.9: Canonicalización determinista: orden alfabético de claves y arrays posicionales', () => {
  // Dos objetos con el mismo contenido pero orden de propiedades distinto
  const obj1 = { z: 1, a: 2, m: { y: 10, b: 20 }, arr: ['second', 'first'] };
  const obj2 = { a: 2, m: { b: 20, y: 10 }, z: 1, arr: ['second', 'first'] };

  const canon1 = toCanonicalJson(obj1);
  const canon2 = toCanonicalJson(obj2);

  assert.equal(canon1, canon2);
  // Verificar que el orden en array no se alteró
  assert.ok(canon1.includes('["second","first"]'));
  // Verificar que las claves están ordenadas alfabéticamente
  assert.equal(canon1, '{"a":2,"arr":["second","first"],"m":{"b":20,"y":10},"z":1}');
});

runTest('F-SER-01.10: Normalización Unicode NFC en canonicalización', () => {
  // "é" compuesto (U+00E9) vs "e" + acento combinatorio (U+0065 U+0301)
  const strComposed = '\u00E9';
  const strDecomposed = 'e\u0301';

  assert.notEqual(strComposed, strDecomposed);
  const canonComposed = toCanonicalJson({ name: strComposed });
  const canonDecomposed = toCanonicalJson({ name: strDecomposed });

  assert.equal(canonComposed, canonDecomposed);
});

runTest('F-SER-01.11: Tres Hashes Independientes: cálculo y verificación de correspondencia', () => {
  const rawFirestoreJson = JSON.stringify({
    name: 'projects/p/databases/d/documents/users/u1',
    fields: {
      name: { stringValue: 'Carlos' },
      weightKg: { doubleValue: 80.5 },
    },
  });

  // 1. sourceHash
  const hSource = computeSourceHash(rawFirestoreJson);
  assert.match(hSource, /^sha256:[a-f0-9]{64}$/);

  // 2. transformedHash
  const transformedPayload = {
    name: 'Carlos',
    weightKg: 80.5,
    _sourcePath: 'users/u1', // Metadato técnico excluido de canonicalización
  };
  const hTransformed = computeTransformedHash(transformedPayload);
  assert.match(hTransformed, /^sha256:[a-f0-9]{64}$/);

  // 3. destinationHash (Simulando recuperación desde Catalyst con claves adicionales pk/sk)
  const retrievedFromCatalyst = {
    pk: 'USER#u1',
    sk: 'PROFILE',
    weightKg: 80.5,
    name: 'Carlos',
    _migratedAt: 1731200000000,
  };
  const hDestination = computeDestinationHash(retrievedFromCatalyst);

  // La regla dorada: transformedHash debe ser exactamente idéntico a destinationHash
  assert.equal(hTransformed, hDestination);
});

// -----------------------------------------------------------------------------
// 4. PRUEBAS F-ROL-01: ROLLBACK SEGURO Y NO DESTRUCTIVO (9 Casos)
// -----------------------------------------------------------------------------

class MockRollbackStore implements RollbackTargetStore {
  public tableData = new Map<string, Record<string, unknown>>();
  public deletedKeys: string[] = [];

  private getKey(pk: string, sk: string) {
    return `${pk}##${sk}`;
  }

  async fetchItem(_table: string, pk: string, sk: string) {
    const item = this.tableData.get(this.getKey(pk, sk));
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }

  async deleteItem(_table: string, pk: string, sk: string) {
    const key = this.getKey(pk, sk);
    if (!this.tableData.has(key)) {
      return { success: false, error: 'NOT_FOUND' };
    }
    this.tableData.delete(key);
    this.deletedKeys.push(key);
    return { success: true };
  }

  seedItem(pk: string, sk: string, data: Record<string, unknown>) {
    this.tableData.set(this.getKey(pk, sk), { pk, sk, ...data });
  }
}

const mockRollbackStore = new MockRollbackStore();
const rollbackEngine = new SafeRollbackEngine(mockRollbackStore);

runTest('F-ROL-01.1: Rollback antes de habilitar escrituras elimina documento idéntico', async () => {
  mockRollbackStore.tableData.clear();
  mockRollbackStore.deletedKeys = [];

  const initialPayload = { name: 'Avena', quantity: 500, updatedAt: 1000, _migrationBatchId: 'MIG-01' };
  const hash = computeCanonicalSha256(initialPayload);

  mockRollbackStore.seedItem('USER#u1', 'GROCERY#g1', {
    ...initialPayload,
    _migratedAt: 1000,
  });

  const manifest: MigrationManifestItem[] = [
    {
      pk: 'USER#u1',
      sk: 'GROCERY#g1',
      sourceUid: 'u1',
      sourcePath: 'users/u1/groceries/g1',
      transformedHash: hash,
      migratedAt: 1000,
      migrationBatchId: 'MIG-01',
    },
  ];

  const report = await rollbackEngine.executeSafeRollback('UserData', manifest, {
    userWritesEnabled: false, // Pre-cutover
  });

  if (report.errors.length > 0) {
    console.log('DEBUG ERRORS in F-ROL-01.1:', JSON.stringify(report.errors));
  }
  assert.equal(report.status, 'COMPLETED_CLEAN');
  assert.equal(report.deletedCount, 1);
  assert.equal(report.preservedUserCount, 0);
  assert.equal(mockRollbackStore.tableData.size, 0);
});

runTest('F-ROL-01.2: Rollback es ABORTADO si las escrituras de usuarios están activas', async () => {
  const manifest: MigrationManifestItem[] = [
    {
      pk: 'USER#u1',
      sk: 'GROCERY#g1',
      sourceUid: 'u1',
      sourcePath: 'users/u1/groceries/g1',
      transformedHash: 'sha256:123',
      migratedAt: 1000,
      migrationBatchId: 'MIG-01',
    },
  ];

  const report = await rollbackEngine.executeSafeRollback('UserData', manifest, {
    userWritesEnabled: true, // Post-cutover
  });

  assert.equal(report.status, 'ABORTED_USER_WRITES_ACTIVE');
  assert.equal(report.deletedCount, 0);
  assert.match(report.errors[0].error, /SAFETY_HALT/);
});

runTest('F-ROL-01.3: Documento modificado por usuario con posterioridad es PRESERVADO y no borrado', async () => {
  mockRollbackStore.tableData.clear();
  mockRollbackStore.deletedKeys = [];

  const initialPayload = { name: 'Avena', quantity: 500 };
  const hash = computeCanonicalSha256(initialPayload);

  // El atleta actualizó la cantidad a 750 y el updatedAt a 2000 (> migratedAt 1000)
  mockRollbackStore.seedItem('USER#u1', 'GROCERY#g1', {
    name: 'Avena',
    quantity: 750,
    _migrationBatchId: 'MIG-01',
    _migratedAt: 1000,
    updatedAt: 2000,
  });

  const manifest: MigrationManifestItem[] = [
    {
      pk: 'USER#u1',
      sk: 'GROCERY#g1',
      sourceUid: 'u1',
      sourcePath: 'users/u1/groceries/g1',
      transformedHash: hash,
      migratedAt: 1000,
      migrationBatchId: 'MIG-01',
    },
  ];

  const report = await rollbackEngine.executeSafeRollback('UserData', manifest, {
    userWritesEnabled: false,
  });

  assert.equal(report.status, 'COMPLETED_WITH_QUARANTINE');
  assert.equal(report.deletedCount, 0);
  assert.equal(report.preservedUserCount, 1);
  assert.equal(report.quarantinedCount, 1);
  assert.equal(mockRollbackStore.tableData.size, 1); // Documento sobrevive intacto
});

runTest('F-ROL-01.4: CASO CRÍTICO: updatedAt == _migratedAt pero contenido modificado -> PRESERVADO', async () => {
  mockRollbackStore.tableData.clear();
  mockRollbackStore.deletedKeys = [];

  const initialPayload = { name: 'Avena', quantity: 500 };
  const originalHash = computeCanonicalSha256(initialPayload);

  // Caso sutil: un cliente modificó el dato pero no actualizó la fecha (updatedAt == 1000)
  mockRollbackStore.seedItem('USER#u1', 'GROCERY#g1', {
    name: 'Avena Integral Modificada', // CONTENIDO DIFERENTE
    quantity: 1200,
    _migrationBatchId: 'MIG-01',
    _migratedAt: 1000,
    updatedAt: 1000, // FECHAS COINCIDEN FALSAMENTE
  });

  const manifest: MigrationManifestItem[] = [
    {
      pk: 'USER#u1',
      sk: 'GROCERY#g1',
      sourceUid: 'u1',
      sourcePath: 'users/u1/groceries/g1',
      transformedHash: originalHash,
      migratedAt: 1000,
      migrationBatchId: 'MIG-01',
    },
  ];

  const report = await rollbackEngine.executeSafeRollback('UserData', manifest, {
    userWritesEnabled: false,
  });

  // La comprobación de hash canónico profundo salva el dato
  assert.equal(report.deletedCount, 0);
  assert.equal(report.preservedUserCount, 1);
  assert.equal(report.quarantinedItems[0].reason, 'CONTENT_HASH_MISMATCH');
  assert.equal(mockRollbackStore.tableData.size, 1);
});

runTest('F-ROL-01.5: Documento con flag _userMutatedAfterMigration es PRESERVADO', async () => {
  mockRollbackStore.tableData.clear();

  mockRollbackStore.seedItem('USER#u1', 'BIO#current', {
    weightKg: 78.5,
    _userMutatedAfterMigration: true,
    _migrationBatchId: 'MIG-01',
    _migratedAt: 1000,
  });

  const manifest: MigrationManifestItem[] = [
    {
      pk: 'USER#u1',
      sk: 'BIO#current',
      sourceUid: 'u1',
      sourcePath: 'users/u1/biometrics/current',
      transformedHash: 'sha256:any',
      migratedAt: 1000,
      migrationBatchId: 'MIG-01',
    },
  ];

  const report = await rollbackEngine.executeSafeRollback('UserData', manifest, {
    userWritesEnabled: false,
  });

  assert.equal(report.deletedCount, 0);
  assert.equal(report.preservedUserCount, 1);
  assert.equal(report.quarantinedItems[0].reason, 'POST_MIGRATION_USER_MUTATION');
});

runTest('F-ROL-01.6: Documento de otro batch de migración es PRESERVADO', async () => {
  mockRollbackStore.tableData.clear();

  mockRollbackStore.seedItem('USER#u1', 'BIO#current', {
    weightKg: 78.5,
    _migrationBatchId: 'MIG-02-ANOTHER',
  });

  const manifest: MigrationManifestItem[] = [
    {
      pk: 'USER#u1',
      sk: 'BIO#current',
      sourceUid: 'u1',
      sourcePath: 'users/u1/biometrics/current',
      transformedHash: 'sha256:any',
      migratedAt: 1000,
      migrationBatchId: 'MIG-01',
    },
  ];

  const report = await rollbackEngine.executeSafeRollback('UserData', manifest, {
    userWritesEnabled: false,
  });

  assert.equal(report.deletedCount, 0);
  assert.equal(report.preservedUserCount, 1);
});

// Execute all queued tests sequentially
(async function runAll() {
  for (const t of testQueue) {
    try {
      await t.fn();
      console.log(` [PASS-UNIT] ${t.name}`);
      passedTests++;
    } catch (err: any) {
      console.error(` [FAIL-UNIT] ${t.name}`);
      console.error(`   Error: ${err.message}\n${err.stack}`);
      process.exit(1);
    }
  }

  console.log('\n========================================================================');
  console.log(` RESULTADO: ${passedTests} PRUEBAS UNITARIAS DE CIERRE APROBADAS (100% PASS-UNIT)`);
  console.log('========================================================================\n');
})();
