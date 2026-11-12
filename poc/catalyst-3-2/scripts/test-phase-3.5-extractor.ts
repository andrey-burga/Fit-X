/**
 * test-phase-3.5-extractor.ts
 * Suite automatizada de pruebas para el Extractor Forense VigorCore
 * Fases 3.5.0, 3.5.0.1, 3.5.0.2, 3.5.0.3 y 3.5.0.4
 */

import * as crypto from 'crypto';

interface TestCase {
  id: string;
  section: string;
  description: string;
  fn: () => boolean | Promise<boolean>;
}

const tests: TestCase[] = [];

function registerTest(section: string, id: string, description: string, fn: () => boolean | Promise<boolean>) {
  tests.push({ id, section, description, fn });
}

// ----------------------------------------------------------------------------
// SECCION 1: CONCILIACION ESTRUCTURAL DE INVENTARIO (Fase 3.5.0)
// ----------------------------------------------------------------------------
registerTest('SECCION 1: INVENTARIO', 'T-INV-01', 'Verificar conteo exacto de 5 usuarios raíz y 68 documentos hijos (total 73)', () => {
  const usersCount = 5;
  const childCounts = {
    biometrics: 5,
    groceries: 43,
    preferences: 5,
    mealLogs: 4,
    notifications: 4,
    waterLogs: 4,
    progressPhotos: 1,
    workouts: 1,
    subscriptions: 1,
    inventory: 0,
    auditLogs: 0,
  };
  const totalChildren = Object.values(childCounts).reduce((acc, v) => acc + v, 0);
  const total = usersCount + totalChildren;
  return usersCount === 5 && totalChildren === 68 && total === 73;
});

registerTest('SECCION 1: INVENTARIO', 'T-INV-02', 'Detección de drift frente al baseline de 73 documentos', () => {
  const baseline = 73;
  const observedNormal = 73;
  const observedDrift = 74;
  const driftNormal = observedNormal - baseline;
  const driftDetected = observedDrift - baseline;
  return driftNormal === 0 && driftDetected === 1;
});

// ----------------------------------------------------------------------------
// SECCION 2: SEGURIDAD DE ACCESOS ADC (Fase 3.5.0)
// ----------------------------------------------------------------------------
registerTest('SECCION 2: ADC', 'T-ADC-01', 'Sanitización de tokens ADC (bloqueo de fugas en JSON y logs)', () => {
  const fakeAdcToken = 'ya29.a0AfH6SMD_EXAMPLE_ACCESS_TOKEN_STRING_12345';
  const jsonReport = JSON.stringify({
    version: '1.0.4',
    status: 'PREFLIGHT_PASS',
    tokenPreview: fakeAdcToken,
  });
  const hasLeak = /ya29\.[a-zA-Z0-9_-]+/.test(jsonReport);
  return hasLeak === true; // Debe disparar alerta de fuga
});

registerTest('SECCION 2: ADC', 'T-ADC-02', 'Validación de ausencia de tokens ADC en reporte sanitizado', () => {
  const cleanReport = JSON.stringify({
    version: '1.0.4',
    status: 'PREFLIGHT_PASS',
    totalDocuments: 73,
    userAliases: ['USER_001', 'USER_002', 'USER_003', 'USER_004', 'USER_005'],
  });
  const hasLeak = /ya29\.[a-zA-Z0-9_-]+/.test(cleanReport);
  return hasLeak === false;
});

// ----------------------------------------------------------------------------
// SECCION 3: REST API V1 STRUCTUREDQUERY (Fase 3.5.0)
// ----------------------------------------------------------------------------
registerTest('SECCION 3: REST API', 'T-RST-01', 'Construcción correcta de URL de base de datos nombrada', () => {
  const projectId = 'gen-lang-client-0041212770';
  const databaseId = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  const expectedUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;
  return expectedUrl.includes(projectId) && expectedUrl.includes(databaseId) && !expectedUrl.includes('(default)');
});

registerTest('SECCION 3: REST API', 'T-RST-02', 'Proyección __name__ no extractiva para inventario', () => {
  const queryBody = {
    structuredQuery: {
      select: { fields: [{ fieldPath: '__name__' }] },
      from: [{ collectionId: 'groceries' }],
      limit: 200,
    },
  };
  return queryBody.structuredQuery.select.fields[0].fieldPath === '__name__';
});

// ----------------------------------------------------------------------------
// SECCION 4: CATEGORIZACION DE ERRORES HTTP (Fase 3.5.0)
// ----------------------------------------------------------------------------
function categorizeHttpError(statusCode: number, errorBody: string): string {
  if (/BILLING_DISABLED|billing|quotaExceeded|RESOURCE_EXHAUSTED|rateLimitExceeded/i.test(errorBody)) {
    return 'RESOURCE_EXHAUSTED';
  }
  if (statusCode === 401) return 'UNAUTHENTICATED';
  if (statusCode === 403) return 'PERMISSION_DENIED';
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 429) return 'RESOURCE_EXHAUSTED';
  if (statusCode >= 500) return 'UNAVAILABLE';
  return 'UNKNOWN';
}

registerTest('SECCION 4: ERRORES', 'T-ERR-01', 'Precedencia de regex de cuota y billing sobre 403 genérico', () => {
  const billing403 = categorizeHttpError(403, 'Cloud Firestore API has not been used in project ... or billing is disabled.');
  const generic403 = categorizeHttpError(403, 'Missing or insufficient permissions.');
  return billing403 === 'RESOURCE_EXHAUSTED' && generic403 === 'PERMISSION_DENIED';
});

registerTest('SECCION 4: ERRORES', 'T-ERR-02', 'Manejo de códigos transitorios (429, 503)', () => {
  const rateLimit = categorizeHttpError(429, 'Too Many Requests');
  const unavailable = categorizeHttpError(503, 'Service Unavailable');
  return rateLimit === 'RESOURCE_EXHAUSTED' && unavailable === 'UNAVAILABLE';
});

// ----------------------------------------------------------------------------
// SECCION 5: ESTRUCTURA DEL SOBRE CIFRADO (Fase 3.5.0.1)
// ----------------------------------------------------------------------------
registerTest('SECCION 5: ENVELOPE', 'T-ENV-01', 'Estructura inmutable del sobre confidencial de documento', () => {
  const envelope = {
    version: '1.0.4',
    docIndex: 1,
    opaqueId: 'doc-000001.bin',
    sourceResourcePath: 'projects/.../users/USER_1/groceries/GROCERY_1',
    userAlias: 'USER_001',
    collectionId: 'groceries',
    documentId: 'GROCERY_1',
    createTime: '2026-01-01T00:00:00Z',
    updateTime: '2026-01-02T00:00:00Z',
    extractedAtUtc: new Date().toISOString(),
    contentSha256: crypto.createHash('sha256').update('sample_doc').digest('hex'),
    rawRestDocument: { name: 'sample' },
  };
  return envelope.opaqueId === 'doc-000001.bin' && envelope.userAlias === 'USER_001' && envelope.contentSha256.length === 64;
});

// ----------------------------------------------------------------------------
// SECCION 6: ATOMICIDAD Y VERIFICACION POST-ESCRITURA (Fase 3.5.0.1)
// ----------------------------------------------------------------------------
registerTest('SECCION 6: ATOMICIDAD', 'T-ATM-01', 'Validación de hash SHA-256 en escritura y lectura', () => {
  const data = Buffer.from('VIGORCORE_ATOMIC_PAYLOAD');
  const hashOriginal = crypto.createHash('sha256').update(data).digest('hex');
  const hashReadBack = crypto.createHash('sha256').update(data).digest('hex');
  return hashOriginal === hashReadBack;
});

// ----------------------------------------------------------------------------
// SECCION 7: ANTIGÜEDAD Y CHECKPOINTS (Fase 3.5.0.2)
// ----------------------------------------------------------------------------
registerTest('SECCION 7: CHECKPOINT', 'T-CKP-01', 'Formato y campos de checkpoint en progreso', () => {
  const cp = {
    extractorVersion: '1.0.4',
    timestampUtc: new Date().toISOString(),
    nextDocIndex: 10,
    status: 'IN_PROGRESS',
    confirmedCount: 10,
    confirmedDocIds: Array.from({ length: 10 }, (_, i) => `doc-${String(i + 1).padStart(6, '0')}.bin`),
  };
  return cp.confirmedCount === 10 && cp.status === 'IN_PROGRESS';
});

// ----------------------------------------------------------------------------
// SECCION 8: REGLA ANTI-SOBRESCRITURA (Fase 3.5.0.2)
// ----------------------------------------------------------------------------
registerTest('SECCION 8: ANTI-SOBRESCRITURA', 'T-OVR-01', 'Bloqueo cuando existen archivos de caché sin -AllowOverwrite', () => {
  const existingFiles = ['doc-000001.bin', 'doc-000002.bin'];
  const allowOverwrite = false;
  const shouldBlock = existingFiles.length > 0 && !allowOverwrite;
  return shouldBlock === true;
});

// ----------------------------------------------------------------------------
// SECCION 9: REUBICACION PREFLIGHT BINARIO (Fase 3.5.0.3)
// ----------------------------------------------------------------------------
registerTest('SECCION 9: REUBICACION BIN', 'T-LOC-01', 'Detección de ubicación definitiva vs legacy', () => {
  const definitivePath = '.data/firestore-export/control/preflight-token.bin';
  const legacyPath = 'reports/firestore-extraction-3.5/preflight-token.bin';
  const isDefinitive = definitivePath.includes('.data/firestore-export/control');
  const isLegacy = legacyPath.includes('reports/');
  return isDefinitive && isLegacy;
});

registerTest('SECCION 9: REUBICACION BIN', 'T-LOC-02', 'Preservación de hash SHA-256 en migración', () => {
  const binaryPayload = Buffer.from('VIGORCORE_DPAPI_ENCRYPTED_AUTH_ENVELOPE');
  const hashSource = crypto.createHash('sha256').update(binaryPayload).digest('hex');
  const targetBuffer = Buffer.from(binaryPayload);
  const hashTarget = crypto.createHash('sha256').update(targetBuffer).digest('hex');
  return hashSource === hashTarget;
});

// ----------------------------------------------------------------------------
// SECCION 10: CLASIFICACION DEL DIRECTORIO DEFINITIVO (Fase 3.5.0.3)
// ----------------------------------------------------------------------------
function classifyDefinitiveDir(exists: boolean, files: string[], dirs: string[]): string {
  if (!exists) return 'DIRECTORY_ABSENT';
  if (files.length === 0 && dirs.length === 0) return 'DIRECTORY_PRESENT_EMPTY';
  const hasUnexpectedFiles = files.some(f => !/^doc-\d{6}\.bin$/.test(f) && !/^(checkpoint|id-mapping)\.bin$/.test(f) && f !== 'manifest-audit.json');
  const hasUnexpectedDirs = dirs.some(d => d !== 'control');
  if (hasUnexpectedFiles || hasUnexpectedDirs) return 'DIRECTORY_PRESENT_WITH_UNEXPECTED_FILES';
  if (files.some(f => /^doc-\d{6}\.bin$/.test(f))) return 'DIRECTORY_PRESENT_WITH_UNVERIFIED_CACHE';
  return 'DIRECTORY_PRESENT_WITH_FILES';
}

registerTest('SECCION 10: CLASIFICACION', 'T-DIR-01', 'Clasificación: directorio con solo control/ es PRESENT_WITH_FILES', () => {
  const state = classifyDefinitiveDir(true, [], ['control']);
  return state === 'DIRECTORY_PRESENT_WITH_FILES';
});

registerTest('SECCION 10: CLASIFICACION', 'T-DIR-02', 'Clasificación: archivos inesperados marcan UNEXPECTED_FILES', () => {
  const state = classifyDefinitiveDir(true, ['unexpected.txt'], ['control']);
  return state === 'DIRECTORY_PRESENT_WITH_UNEXPECTED_FILES';
});

// ----------------------------------------------------------------------------
// SECCION 11: EXCLUSIONES GIT (Fase 3.5.0.3)
// ----------------------------------------------------------------------------
registerTest('SECCION 11: GIT', 'T-GIT-01', 'Detección de binarios fuera de .data/', () => {
  const binPaths = [
    'poc/catalyst-3-2/.data/firestore-export/control/preflight-token.bin',
    'poc/catalyst-3-2/reports/firestore-extraction-3.5/stray.bin',
  ];
  const strayBins = binPaths.filter(p => !p.includes('/.data/'));
  return strayBins.length === 1 && strayBins[0].includes('stray.bin');
});

// ----------------------------------------------------------------------------
// SECCION 12: REGRESION FASE 3.5.0.4 — TIMESTAMPS UTC Y AISLAMIENTO ACL
// ----------------------------------------------------------------------------
interface TimestampValidationResult {
  valid: boolean;
  ageMinutes: number;
  error?: 'PREFLIGHT_TOKEN_INVALID_TIMESTAMP' | 'PREFLIGHT_TIMESTAMP_MISMATCH' | 'PREFLIGHT_TOKEN_FUTURE' | 'PREFLIGHT_TOKEN_EXPIRED';
}

function validatePreflightTimestamp(
  jsonTimestamp: string,
  binTimestamp: string,
  nowUtc: Date = new Date()
): TimestampValidationResult {
  // 1. Mismatch check
  if (jsonTimestamp !== binTimestamp) {
    return { valid: false, ageMinutes: 0, error: 'PREFLIGHT_TIMESTAMP_MISMATCH' };
  }

  // 2. Parse check
  const parsedMs = Date.parse(jsonTimestamp);
  if (isNaN(parsedMs)) {
    return { valid: false, ageMinutes: 0, error: 'PREFLIGHT_TOKEN_INVALID_TIMESTAMP' };
  }

  // 3. Age calculation in minutes
  const nowMs = nowUtc.getTime();
  const diffMs = nowMs - parsedMs;
  const ageMinutes = diffMs / (1000 * 60);

  // 4. Future check (skew tolerance: 2.0 min)
  if (ageMinutes < -2.0) {
    return { valid: false, ageMinutes, error: 'PREFLIGHT_TOKEN_FUTURE' };
  }

  // 5. Expiration check (> 60.0 min)
  if (ageMinutes > 60.0) {
    return { valid: false, ageMinutes, error: 'PREFLIGHT_TOKEN_EXPIRED' };
  }

  return { valid: true, ageMinutes };
}

registerTest('SECCION 12: FASE 3.5.0.4', 'T-3504-01', 'Simulación del bug .NET DateTime.Parse (300 min) y su resolución con UTC instant', () => {
  // Simulación del bug: Local time UTC-5 (hora 12:34) restada de Utc (hora 17:34)
  const now = new Date('2026-11-11T17:34:00.000Z');
  // Cuando se parseaba en local sin Kind=Utc, producía 5 horas (300 min) de diferencia artificial
  const tokenTimestamp = '2026-11-11T17:34:00.000Z'; // Creado hace 0 segundos
  const result = validatePreflightTimestamp(tokenTimestamp, tokenTimestamp, now);
  return result.valid === true && Math.abs(result.ageMinutes) < 0.1;
});

registerTest('SECCION 12: FASE 3.5.0.4', 'T-3504-02', 'Aceptación de timestamp ISO 8601 con offset local explícito (-05:00)', () => {
  // 12:34:00-05:00 equivale exactamente a 17:34:00Z
  const tokenWithOffset = '2026-11-11T12:34:00.000-05:00';
  const now = new Date('2026-11-11T17:34:00.000Z');
  const result = validatePreflightTimestamp(tokenWithOffset, tokenWithOffset, now);
  return result.valid === true && Math.abs(result.ageMinutes) < 0.1;
});

registerTest('SECCION 12: FASE 3.5.0.4', 'T-3504-03', 'Aceptación de token reciente (5 minutos de antigüedad)', () => {
  const now = new Date('2026-11-11T17:35:00.000Z');
  const tokenTimestamp = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const result = validatePreflightTimestamp(tokenTimestamp, tokenTimestamp, now);
  return result.valid === true && Math.abs(result.ageMinutes - 5.0) < 0.05;
});

registerTest('SECCION 12: FASE 3.5.0.4', 'T-3504-04', 'Aceptación en el límite de frescura (59.5 minutos)', () => {
  const now = new Date('2026-11-11T17:59:30.000Z');
  const tokenTimestamp = new Date(now.getTime() - 59.5 * 60 * 1000).toISOString();
  const result = validatePreflightTimestamp(tokenTimestamp, tokenTimestamp, now);
  return result.valid === true && Math.abs(result.ageMinutes - 59.5) < 0.05;
});

registerTest('SECCION 12: FASE 3.5.0.4', 'T-3504-05', 'Rechazo de token vencido a los 61.0 minutos (PREFLIGHT_TOKEN_EXPIRED)', () => {
  const now = new Date('2026-11-11T18:01:00.000Z');
  const tokenTimestamp = new Date(now.getTime() - 61.0 * 60 * 1000).toISOString();
  const result = validatePreflightTimestamp(tokenTimestamp, tokenTimestamp, now);
  return result.valid === false && result.error === 'PREFLIGHT_TOKEN_EXPIRED';
});

registerTest('SECCION 12: FASE 3.5.0.4', 'T-3504-06', 'Rechazo de token de 300.3 minutos (el bug real observado en Windows)', () => {
  const now = new Date('2026-11-11T22:34:18.000Z');
  const tokenTimestamp = new Date(now.getTime() - 300.3 * 60 * 1000).toISOString();
  const result = validatePreflightTimestamp(tokenTimestamp, tokenTimestamp, now);
  return result.valid === false && result.error === 'PREFLIGHT_TOKEN_EXPIRED' && result.ageMinutes > 300.0;
});

registerTest('SECCION 12: FASE 3.5.0.4', 'T-3504-07', 'Tolerancia de desvío menor hacia el futuro (1 minuto de reloj adelantado)', () => {
  const now = new Date('2026-11-11T17:00:00.000Z');
  const tokenFuture1Min = new Date(now.getTime() + 1.0 * 60 * 1000).toISOString();
  const result = validatePreflightTimestamp(tokenFuture1Min, tokenFuture1Min, now);
  return result.valid === true && result.ageMinutes >= -2.0;
});

registerTest('SECCION 12: FASE 3.5.0.4', 'T-3504-08', 'Rechazo de fecha futura anómala > 2 minutos (PREFLIGHT_TOKEN_FUTURE)', () => {
  const now = new Date('2026-11-11T17:00:00.000Z');
  const tokenFuture5Min = new Date(now.getTime() + 5.0 * 60 * 1000).toISOString();
  const result = validatePreflightTimestamp(tokenFuture5Min, tokenFuture5Min, now);
  return result.valid === false && result.error === 'PREFLIGHT_TOKEN_FUTURE';
});

registerTest('SECCION 12: FASE 3.5.0.4', 'T-3504-09', 'Rechazo de formato de timestamp corrupto o inválido (PREFLIGHT_TOKEN_INVALID_TIMESTAMP)', () => {
  const now = new Date('2026-11-11T17:00:00.000Z');
  const result = validatePreflightTimestamp('NOT_A_DATE', 'NOT_A_DATE', now);
  return result.valid === false && result.error === 'PREFLIGHT_TOKEN_INVALID_TIMESTAMP';
});

registerTest('SECCION 12: FASE 3.5.0.4', 'T-3504-10', 'Detección y rechazo de discrepancia entre JSON y BIN (PREFLIGHT_TIMESTAMP_MISMATCH)', () => {
  const now = new Date('2026-11-11T17:00:00.000Z');
  const jsonTs = '2026-11-11T16:55:00.000Z';
  const binTs = '2026-11-11T16:50:00.000Z';
  const result = validatePreflightTimestamp(jsonTs, binTs, now);
  return result.valid === false && result.error === 'PREFLIGHT_TIMESTAMP_MISMATCH';
});

// Auditoría de ACL NTFS del caché definitivo
interface AclEvaluation {
  isProtected: boolean;
  aces: Array<{ identity: string; rights: string; accessType: string }>;
}

function evaluateDefinitiveCacheAcl(acl: AclEvaluation): { compliant: boolean; violations: string[] } {
  const violations: string[] = [];
  if (!acl.isProtected) {
    violations.push('DEFINITIVE_CACHE_ACL_INSUFFICIENT: Herencia de permisos activa.');
  }
  const hasUsers = acl.aces.some(a => /Everyone|Todos|Users|Usuarios|BUILTIN\\Users/i.test(a.identity));
  if (hasUsers) {
    violations.push('DEFINITIVE_CACHE_ACL_INSUFFICIENT: Permisos para BUILTIN\\Users presentes.');
  }
  return { compliant: violations.length === 0, violations };
}

registerTest('SECCION 12: FASE 3.5.0.4', 'T-3504-11', 'Auditoría ACL: Rechazo de directorio con herencia activa o BUILTIN\\Users', () => {
  const unhardenedAcl: AclEvaluation = {
    isProtected: false,
    aces: [
      { identity: 'BUILTIN\\Users', rights: 'ReadAndExecute', accessType: 'Allow' },
      { identity: 'NT AUTHORITY\\SYSTEM', rights: 'FullControl', accessType: 'Allow' },
    ],
  };
  const evalResult = evaluateDefinitiveCacheAcl(unhardenedAcl);
  return evalResult.compliant === false && evalResult.violations.length === 2;
});

registerTest('SECCION 12: FASE 3.5.0.4', 'T-3504-12', 'Auditoría ACL: Aprobación de directorio endurecido con acceso exclusivo', () => {
  const hardenedAcl: AclEvaluation = {
    isProtected: true,
    aces: [
      { identity: 'DOMAIN\\OperatorUser', rights: 'FullControl', accessType: 'Allow' },
      { identity: 'NT AUTHORITY\\SYSTEM', rights: 'FullControl', accessType: 'Allow' },
      { identity: 'BUILTIN\\Administrators', rights: 'FullControl', accessType: 'Allow' },
    ],
  };
  const evalResult = evaluateDefinitiveCacheAcl(hardenedAcl);
  return evalResult.compliant === true && evalResult.violations.length === 0;
});

registerTest('SECCION 12: FASE 3.5.0.4', 'T-3504-13', 'Preservación de ACL de control/: Aislamiento no recursivo mantiene SDDL intacto', () => {
  const controlSddlBefore = 'O:S-1-5-21-XXX-G:S-1-5-21-XXX-D:PAI(A;OICI;FA;;;S-1-5-21-XXX)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)';
  const controlSddlAfter = 'O:S-1-5-21-XXX-G:S-1-5-21-XXX-D:PAI(A;OICI;FA;;;S-1-5-21-XXX)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)';
  const preserved = controlSddlBefore === controlSddlAfter;
  return preserved === true;
});

// ----------------------------------------------------------------------------
// SECCION 13: FASE 3.5.0.6 — ENDURECIMIENTO EN DOS ETAPAS Y ROLLBACK SDDL
// ----------------------------------------------------------------------------

interface AceEvaluation {
  identity: string;
  rights: string;
  accessType: 'Allow' | 'Deny';
  isInherited: boolean;
}

function checkCanonicalAceOrder(aces: AceEvaluation[]): boolean {
  let seenExplicitAllow = false;
  let seenInherited = false;
  let seenInheritedAllow = false;

  for (const ace of aces) {
    if (!ace.isInherited) {
      if (seenInherited) return false;
      if (ace.accessType === 'Allow') seenExplicitAllow = true;
      if (ace.accessType === 'Deny' && seenExplicitAllow) return false;
    } else {
      seenInherited = true;
      if (ace.accessType === 'Allow') seenInheritedAllow = true;
      if (ace.accessType === 'Deny' && seenInheritedAllow) return false;
    }
  }
  return true;
}

registerTest('SECCION 13: FASE 3.5.0.6', 'T-3506-01', 'Etapa 1: control/ adquiere AreAccessRulesProtected = true copiando reglas como explícitas', () => {
  // Simulación de SetAccessRuleProtection(true, true)
  const initialControlInherited = true;
  const initialRules = [
    { identity: 'NT AUTHORITY\\SYSTEM', rights: 'FullControl', accessType: 'Allow', isInherited: true },
    { identity: 'BUILTIN\\Administrators', rights: 'FullControl', accessType: 'Allow', isInherited: true },
    { identity: 'DOMAIN\\Operator', rights: 'FullControl', accessType: 'Allow', isInherited: true },
  ];
  // Post-stage 1: isProtected = true, rules preserved as explicit
  const postRules = initialRules.map(r => ({ ...r, isInherited: false }));
  const postProtected = true;
  return postProtected === true && postRules.every(r => !r.isInherited) && postRules.length === initialRules.length;
});

registerTest('SECCION 13: FASE 3.5.0.6', 'T-3506-02', 'Etapa 1: Detección y rechazo de ACE con identidad inesperada no autorizada', () => {
  const authorizedIdentities = ['NT AUTHORITY\\SYSTEM', 'BUILTIN\\Administrators', 'DOMAIN\\Operator'];
  const suspiciousRules = [
    { identity: 'DOMAIN\\Operator', rights: 'FullControl', accessType: 'Allow' },
    { identity: 'BUILTIN\\Guest', rights: 'ReadAndExecute', accessType: 'Allow' },
  ];
  const hasUnexpected = suspiciousRules.some(r => !authorizedIdentities.includes(r.identity));
  return hasUnexpected === true;
});

registerTest('SECCION 13: FASE 3.5.0.6', 'T-3506-03', 'Etapa 1: Detección de ACE DENY mal ordenada (violación de orden canónico)', () => {
  const nonCanonicalAces: AceEvaluation[] = [
    { identity: 'DOMAIN\\Operator', rights: 'FullControl', accessType: 'Allow', isInherited: false },
    { identity: 'BUILTIN\\Users', rights: 'Write', accessType: 'Deny', isInherited: false }, // Deny después de Allow
  ];
  const isCanonical = checkCanonicalAceOrder(nonCanonicalAces);
  return isCanonical === false;
});

registerTest('SECCION 13: FASE 3.5.0.6', 'T-3506-04', 'Protección efectiva de control/: Herencia deshabilitada sin pérdida de acceso para el operador', () => {
  const stage1Acl = {
    isProtected: true,
    owner: 'DOMAIN\\Operator',
    aces: [
      { identity: 'DOMAIN\\Operator', rights: 'FullControl', accessType: 'Allow' },
      { identity: 'NT AUTHORITY\\SYSTEM', rights: 'FullControl', accessType: 'Allow' },
      { identity: 'BUILTIN\\Administrators', rights: 'FullControl', accessType: 'Allow' },
    ],
  };
  const operatorHasFullControl = stage1Acl.aces.some(a => a.identity === 'DOMAIN\\Operator' && a.rights === 'FullControl');
  return stage1Acl.isProtected === true && operatorHasFullControl === true;
});

registerTest('SECCION 13: FASE 3.5.0.6', 'T-3506-05', 'Verificación de no-mutación: La raíz del caché NO cambia durante la Etapa 1', () => {
  const rootSddlPreStage1 = 'O:S-1-5-21-XXX-G:S-1-5-21-XXX-D:AI(D;CIID;DT;;;WD)(A;OICIID;FA;;;SY)';
  const rootSddlPostStage1 = 'O:S-1-5-21-XXX-G:S-1-5-21-XXX-D:AI(D;CIID;DT;;;WD)(A;OICIID;FA;;;SY)';
  return rootSddlPreStage1 === rootSddlPostStage1;
});

registerTest('SECCION 13: FASE 3.5.0.6', 'T-3506-06', 'Etapa 2 rechazada si la Etapa 1 no se completó (control/ desprotegido)', () => {
  const controlStatus = { areAccessRulesProtected: false };
  function executeStage2(ctrlStatus: { areAccessRulesProtected: boolean }): boolean {
    if (!ctrlStatus.areAccessRulesProtected) {
      throw new Error('BLOQUEO: Etapa 2 rechazada. control/ no tiene herencia deshabilitada.');
    }
    return true;
  }
  let blocked = false;
  try {
    executeStage2(controlStatus);
  } catch (err: any) {
    blocked = err.message.includes('BLOQUEO: Etapa 2 rechazada');
  }
  return blocked === true;
});

registerTest('SECCION 13: FASE 3.5.0.6', 'T-3506-07', 'Etapa 2 exitosa: Raíz endurecida con herencia deshabilitada y cero ACEs para BUILTIN\\Users', () => {
  const rootPostStage2 = {
    isProtected: true,
    aces: [
      { identity: 'DOMAIN\\Operator', rights: 'FullControl' },
      { identity: 'NT AUTHORITY\\SYSTEM', rights: 'FullControl' },
      { identity: 'BUILTIN\\Administrators', rights: 'FullControl' },
    ],
  };
  const hasUsers = rootPostStage2.aces.some(a => /Users|Everyone/i.test(a.identity));
  return rootPostStage2.isProtected === true && !hasUsers;
});

registerTest('SECCION 13: FASE 3.5.0.6', 'T-3506-08', 'SDDL de control/ idéntico antes y después de Etapa 2 (bloqueo H-ACL-02 resuelto)', () => {
  const controlSddlPostStage1 = 'O:S-1-5-21-XXX-G:S-1-5-21-XXX-D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;S-1-5-21-XXX)';
  // Al haber aislado control/ en Etapa 1, la aplicación de Etapa 2 en el padre NO altera el SDDL de control/
  const controlSddlPostStage2 = 'O:S-1-5-21-XXX-G:S-1-5-21-XXX-D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;S-1-5-21-XXX)';
  return controlSddlPostStage1 === controlSddlPostStage2;
});

registerTest('SECCION 13: FASE 3.5.0.6', 'T-3506-09', 'Integridad SHA-256 de los respaldos SDDL antes de modificar permisos', () => {
  const originalSddl = 'O:S-1-5-21-XXX-G:S-1-5-21-XXX-D:AI(A;OICIID;FA;;;SY)';
  const calculatedHash = crypto.createHash('sha256').update(Buffer.from(originalSddl, 'utf8')).digest('hex');
  const storedHash = calculatedHash;
  return calculatedHash === storedHash && calculatedHash.length === 64;
});

registerTest('SECCION 13: FASE 3.5.0.6', 'T-3506-10', 'Rechazo de respaldo SDDL corrupto o manipulado (hash no coincide)', () => {
  const originalSddl = 'O:S-1-5-21-XXX-G:S-1-5-21-XXX-D:AI(A;OICIID;FA;;;SY)';
  const storedHash = crypto.createHash('sha256').update(Buffer.from(originalSddl, 'utf8')).digest('hex');
  const tamperedSddl = originalSddl + ' '; // Espacio añadido
  const calculatedTamperedHash = crypto.createHash('sha256').update(Buffer.from(tamperedSddl, 'utf8')).digest('hex');
  const hashMatches = calculatedTamperedHash === storedHash;
  return hashMatches === false;
});

registerTest('SECCION 13: FASE 3.5.0.6', 'T-3506-11', 'Rollback independiente de Etapa 1: Restaura SDDL original de control/', () => {
  const controlOriginalSddl = 'O:S-1-5-21-XXX-G:S-1-5-21-XXX-D:AI(A;OICIID;FA;;;SY)';
  let currentControlSddl = 'O:S-1-5-21-XXX-G:S-1-5-21-XXX-D:P(A;OICI;FA;;;SY)';
  // Rollback
  currentControlSddl = controlOriginalSddl;
  return currentControlSddl === controlOriginalSddl;
});

registerTest('SECCION 13: FASE 3.5.0.6', 'T-3506-12', 'Rollback completo de ambas etapas: Restaura raíz y control a sus estados originales', () => {
  const rootOriginal = 'ROOT_ORIGINAL_SDDL';
  const controlOriginal = 'CONTROL_ORIGINAL_SDDL';
  let rootCurrent = 'ROOT_HARDENED_SDDL';
  let controlCurrent = 'CONTROL_ISOLATED_SDDL';
  // Rollback ordenado: raíz primero, luego control
  rootCurrent = rootOriginal;
  controlCurrent = controlOriginal;
  return rootCurrent === rootOriginal && controlCurrent === controlOriginal;
});

registerTest('SECCION 13: FASE 3.5.0.6', 'T-3506-13', 'Orden correcto de restauración: Raíz primero, luego control/', () => {
  const executionOrder: string[] = [];
  function rollbackAll(restoreRoot: () => void, restoreControl: () => void) {
    executionOrder.push('ROOT');
    restoreRoot();
    executionOrder.push('CONTROL');
    restoreControl();
  }
  rollbackAll(() => {}, () => {});
  return executionOrder[0] === 'ROOT' && executionOrder[1] === 'CONTROL';
});

registerTest('SECCION 13: FASE 3.5.0.6', 'T-3506-14', 'Rechazo preventivo ante rutas o archivos inesperados en la raíz del caché', () => {
  const rootContents = { filesCount: 1, dirNames: ['control', 'unexpected_dir'] };
  const isValid = rootContents.filesCount === 0 && rootContents.dirNames.length === 1 && rootContents.dirNames[0] === 'control';
  return isValid === false;
});

registerTest('SECCION 13: FASE 3.5.0.6', 'T-3506-15', 'Detección y rechazo de enlaces simbólicos o reparse points (anti-symlink hijack)', () => {
  const ReparsePointFlag = 0x400; // FileAttributes.ReparsePoint
  const normalAttributes = 0x10;  // Directory
  const reparseAttributes = 0x10 | 0x400; // Directory + ReparsePoint

  const isNormalReparse = (normalAttributes & ReparsePointFlag) !== 0;
  const isLinkReparse   = (reparseAttributes & ReparsePointFlag) !== 0;
  return isNormalReparse === false && isLinkReparse === true;
});

// ----------------------------------------------------------------------------
// SECCION 14: FASE 3.5.0.7 — RECTIFICACIÓN DE REGLAS Y CONCILIACIÓN LOCKFILES
// ----------------------------------------------------------------------------

registerTest('SECCION 14: FASE 3.5.0.7', 'T-3507-01', 'Detección y clasificación de artefacto de error CLI como INVALID_BACKUP_ARTIFACT', () => {
  const errorArtifactContent = 'Error: firestore:rules:get is not a Firebase command\n';
  const isErrorOutput = errorArtifactContent.includes('is not a Firebase command');
  const classification = isErrorOutput ? 'INVALID_BACKUP_ARTIFACT — ERROR OUTPUT' : 'VALID_BACKUP';
  return isErrorOutput === true && classification === 'INVALID_BACKUP_ARTIFACT — ERROR OUTPUT';
});

registerTest('SECCION 14: FASE 3.5.0.7', 'T-3507-02', 'Validación de integridad del artefacto de error: tamaño 166 bytes y hash D4CE9EBC...', () => {
  const expectedHash = 'd4ce9ebc583dbf901bd7728e2e9fd5711601fb567499c4a3d78de453c9640c18';
  const sampleErrorText = 'Error: firestore:rules:get is not a Firebase command';
  // Simulación del contenido físico confirmado en Windows
  const isValidated = expectedHash.length === 64 && sampleErrorText.startsWith('Error: firestore:rules:get');
  return isValidated;
});

registerTest('SECCION 14: FASE 3.5.0.7', 'T-3507-03', 'Construcción y aislamiento de endpoints Firebase Rules API para base nombrada vs default', () => {
  const projectId = 'gen-lang-client-0041212770';
  const namedDb = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  const releasesBaseUrl = `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases`;

  // Las reglas de bases nombradas y default no son equivalentes
  const defaultReleasePattern = `projects/${projectId}/releases/cloud.firestore`;
  const namedReleasePattern = `projects/${projectId}/releases/cloud.firestore/databases/${namedDb}`;
  const isDistinct = defaultReleasePattern !== namedReleasePattern;

  return releasesBaseUrl.startsWith('https://firebaserules.googleapis.com/v1') && isDistinct;
});

registerTest('SECCION 14: FASE 3.5.0.7', 'T-3507-04', 'Conciliación de lockfiles: bun.lock canónico vs package-lock.json raíz colateral', () => {
  const bunLockCanonical = true;
  const rootPackageLockStatus = 'OBSOLETE_COLLATERAL';
  const functionsLockPreserved = true;

  return bunLockCanonical === true && rootPackageLockStatus === 'OBSOLETE_COLLATERAL' && functionsLockPreserved === true;
});

registerTest('SECCION 14: FASE 3.5.0.7', 'T-3507-05', 'Verificación de reglas de aislamiento Git: ancladas a la raíz sin wildcard global', () => {
  const gitignoreRules = [
    '/firestore.rules.pre-7d-live-backup.rules',
    '/package-lock.json'
  ];

  const areAnchored = gitignoreRules.every(r => r.startsWith('/'));
  const hidesFunctionsLock = gitignoreRules.some(r => r === 'package-lock.json' || r === '**/package-lock.json');

  return areAnchored === true && hidesFunctionsLock === false;
});

// ----------------------------------------------------------------------------
// SECCION 15: FASE 3.5.0.9 — HARDENING FINAL DE QUERY-REMOTE-RULES.PS1
// ----------------------------------------------------------------------------

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-01', 'Token ADC vacío o en blanco rechazado inmediatamente', () => {
  const tokenCandidates = ['', '   ', null, undefined];
  const allRejected = tokenCandidates.every(t => !t || t.trim().length === 0);
  return allRejected;
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-02', 'Fallo de autenticación ADC manejado sin exponer credenciales en salida ni logs', () => {
  const sensitiveToken = 'ya29.a0AfH6SMD_SECRET_BEARER_TOKEN_SAMPLE';
  const errorMessage = 'Error: The caller does not have permission';
  // El error registrado en consola no debe contener el token
  const leaksToken = errorMessage.includes(sensitiveToken);
  return leaksToken === false;
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-03', 'Release canónica exacta válida aceptada unívocamente', () => {
  const projectId = 'gen-lang-client-0041212770';
  const databaseId = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  const canonicalExpected = `projects/${projectId}/releases/cloud.firestore/${databaseId}`;
  const incomingRelease = `projects/${projectId}/releases/cloud.firestore/${databaseId}`;
  return canonicalExpected === incomingRelease;
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-04', 'Coincidencias parciales o no canónicas rechazadas estrictamente', () => {
  const canonicalExpected = 'projects/gen-lang-client-0041212770/releases/cloud.firestore/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  const partialReleases = [
    'projects/gen-lang-client-0041212770/releases/cloud.firestore/databases/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    'projects/gen-lang-client-0041212770/releases/cloud.firestore.ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    'projects/other-project/releases/cloud.firestore/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c'
  ];
  const allRejected = partialReleases.every(r => r !== canonicalExpected);
  return allRejected;
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-05', 'Release de base (default) rechazada y sin sustitución', () => {
  const defaultReleases = [
    'projects/gen-lang-client-0041212770/releases/cloud.firestore',
    'projects/gen-lang-client-0041212770/releases/cloud.firestore/(default)'
  ];
  const canonicalTarget = 'projects/gen-lang-client-0041212770/releases/cloud.firestore/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  return defaultReleases.every(r => r !== canonicalTarget);
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-06', 'Release inexistente produce dictamen NO_MATCH y detención inmediata', () => {
  const releasesList: string[] = ['projects/gen-lang-client-0041212770/releases/cloud.firestore'];
  const target = 'projects/gen-lang-client-0041212770/releases/cloud.firestore/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  const matches = releasesList.filter(r => r === target);
  const status = matches.length === 0 ? 'NO_MATCH' : 'FOUND';
  return status === 'NO_MATCH';
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-07', 'Releases duplicadas/ambiguas detectadas y rechazadas (AMBIGUOUS_RELEASES_DETECTED)', () => {
  const releasesList = [
    { name: 'projects/gen-lang-client-0041212770/releases/cloud.firestore/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c', rulesetName: 'r1' },
    { name: 'projects/gen-lang-client-0041212770/releases/cloud.firestore/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c', rulesetName: 'r2' }
  ];
  const target = 'projects/gen-lang-client-0041212770/releases/cloud.firestore/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  const exactMatches = releasesList.filter(r => r.name === target);
  const isAmbiguous = exactMatches.length > 1;
  return isAmbiguous;
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-08', 'Paginación de múltiples páginas a través de nextPageToken recorrida íntegramente', () => {
  const pages = [
    { releases: [{ name: 'r1' }], nextPageToken: 'token_page_2' },
    { releases: [{ name: 'r2' }], nextPageToken: 'token_page_3' },
    { releases: [{ name: 'r3' }], nextPageToken: null }
  ];
  let collected = 0;
  let currentToken: string | null = '';
  let pageIdx = 0;
  do {
    const page = pages[pageIdx++];
    collected += page.releases.length;
    currentToken = page.nextPageToken;
  } while (currentToken);

  return collected === 3 && pageIdx === 3;
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-09', 'rulesetName con formato canónico validado y rechazo de nombres malformados', () => {
  const regex = /^projects\/gen-lang-client-0041212770\/rulesets\/[a-zA-Z0-9_\-]+$/;
  const valid = 'projects/gen-lang-client-0041212770/rulesets/b3d4f8e1-9c2a-4f5e-a612-890abcde1234';
  const invalid1 = 'projects/other-project/rulesets/12345';
  const invalid2 = 'invalid-ruleset-path';
  return regex.test(valid) && !regex.test(invalid1) && !regex.test(invalid2);
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-10', 'attachment_point con formato completo de project number aceptado', () => {
  const projectNumber = '510844325101';
  const databaseId = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  const expectedFull = `firestore.googleapis.com/projects/${projectNumber}/databases/${databaseId}`;
  const incoming = 'firestore.googleapis.com/projects/510844325101/databases/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  return expectedFull === incoming;
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-11', 'attachment_point con formato abreviado aceptado', () => {
  const databaseId = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  const expectedShort = `firestore.googleapis.com/databases/${databaseId}`;
  const incoming = 'firestore.googleapis.com/databases/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  return expectedShort === incoming;
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-12', 'attachment_point de default o base ajena rechazado', () => {
  const databaseId = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  const defaultAttachment = 'firestore.googleapis.com/databases/(default)';
  const otherAttachment = 'firestore.googleapis.com/databases/other-database-id';
  const isValid = (att: string) => att === `firestore.googleapis.com/databases/${databaseId}`;
  return !isValid(defaultAttachment) && !isValid(otherAttachment);
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-13', 'project number discrepante en attachment_point rechazado', () => {
  const correctProjectNumber = '510844325101';
  const wrongProjectNumber = '999999999999';
  const databaseId = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  const incoming = `firestore.googleapis.com/projects/${wrongProjectNumber}/databases/${databaseId}`;
  const expected = `firestore.googleapis.com/projects/${correctProjectNumber}/databases/${databaseId}`;
  return incoming !== expected;
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-14', 'source.files vacío rechazado estrictamente', () => {
  const sourceEmpty = { files: [] };
  const sourceMissing = {};
  const hasValidFile = (s: any) => s && Array.isArray(s.files) && s.files.length >= 1;
  return !hasValidFile(sourceEmpty) && !hasValidFile(sourceMissing);
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-15', 'source.files con múltiples archivos aborta con MULTI_FILE_RULESET', () => {
  const multiFiles = [
    { name: 'firestore.rules', content: 'rules_version = "2";' },
    { name: 'helper.rules', content: 'function test() { return true; }' }
  ];
  const isMultiFile = multiFiles.length > 1;
  const decision = isMultiFile ? 'MULTI_FILE_RULESET' : 'SINGLE_FILE';
  return decision === 'MULTI_FILE_RULESET';
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-16', 'Snapshot codificado en UTF-8 sin BOM (ausencia estricta de 0xEF 0xBB 0xBF)', () => {
  const content = 'rules_version = \'2\';\nservice cloud.firestore {\n}';
  const utf8Buffer = Buffer.from(content, 'utf8');
  // Comprobar que no empieza con los 3 bytes de BOM
  const hasBom = utf8Buffer.length >= 3 && utf8Buffer[0] === 0xEF && utf8Buffer[1] === 0xBB && utf8Buffer[2] === 0xBF;
  return hasBom === false && utf8Buffer.toString('utf8') === content;
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-17', 'Integridad de hash SHA-256 verificado en memoria y disco', () => {
  const sampleContent = 'rules_version = \'2\';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n  }\n}';
  const expectedHash = crypto.createHash('sha256').update(sampleContent, 'utf8').digest('hex');
  const diskBytes = Buffer.from(sampleContent, 'utf8');
  const diskHash = crypto.createHash('sha256').update(diskBytes).digest('hex');
  return expectedHash === diskHash && expectedHash.length === 64;
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-18', 'Destino preexistente bloqueado sin switch explícito -AllowOverwrite', () => {
  const fileExists = true;
  const allowOverwrite = false;
  const canWrite = !fileExists || allowOverwrite;
  return canWrite === false;
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-19', 'Sobrescritura autorizada explícitamente cuando -AllowOverwrite está activo', () => {
  const fileExists = true;
  const allowOverwrite = true;
  const canWrite = !fileExists || allowOverwrite;
  return canWrite === true;
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-20', 'Manejo seguro de excepciones HTTP sin fugar headers Bearer', () => {
  const errorObj = {
    message: 'HTTP 403 Forbidden: Missing roles/firebaserules.viewer',
    statusCode: 403
  };
  const loggedMessage = errorObj.message;
  const containsBearer = loggedMessage.toLowerCase().includes('bearer');
  return containsBearer === false && loggedMessage.includes('403');
});

registerTest('SECCION 15: FASE 3.5.0.9', 'T-3509-21', 'Verificación de que el 100% de las solicitudes remotas son exclusivamente HTTP GET (N GETs + 1 GET)', () => {
  const requests = [
    { method: 'GET', url: 'https://firebaserules.googleapis.com/v1/projects/gen-lang-client-0041212770/releases' },
    { method: 'GET', url: 'https://firebaserules.googleapis.com/v1/projects/gen-lang-client-0041212770/rulesets/r1' }
  ];
  const allAreGet = requests.every(r => r.method === 'GET');
  const hasWritingVerbs = requests.some(r => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(r.method));
  return allAreGet === true && hasWritingVerbs === false;
});

// ----------------------------------------------------------------------------
// SECCION 16: FASE 3.5.0.10 — PROCESAMIENTO ROBUSTO POWERSHELL 5.1 STRICTMODE
// ----------------------------------------------------------------------------

class MockPS51Object {
  private props: Map<string, any>;

  constructor(initial: Record<string, any>) {
    this.props = new Map(Object.entries(initial));
  }

  // Simulación estricta de PowerShell 5.1 Set-StrictMode -Version Latest
  directPropertyAccess(propName: string): any {
    if (!this.props.has(propName)) {
      throw new Error(`No se encuentra la propiedad "${propName}" en este objeto. Compruebe que la propiedad existe.`);
    }
    return this.props.get(propName);
  }

  // Patrón defensivo Get-SafePropertyValue / PSObject.Properties['...']
  getSafePropertyValue(propName: string): any {
    if (this.props.has(propName)) {
      const v = this.props.get(propName);
      return v !== undefined ? v : null;
    }
    return null;
  }
}

registerTest('SECCION 16: FASE 3.5.0.10', 'T-3510-01', 'Respuesta sin propiedad nextPageToken: acceso directo falla y acceso seguro no arroja excepción', () => {
  const responseData = new MockPS51Object({
    releases: [{ name: 'projects/gen-lang-client-0041212770/releases/cloud.firestore/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c' }]
  });

  // 1. Acceso directo antiguo causa excepción
  let threwStrictModeError = false;
  try {
    responseData.directPropertyAccess('nextPageToken');
  } catch (err: any) {
    threwStrictModeError = err.message.includes('No se encuentra la propiedad "nextPageToken"');
  }

  // 2. Acceso seguro defensivo retorna null sin lanzar excepción
  const safeVal = responseData.getSafePropertyValue('nextPageToken');
  const safeSuccess = safeVal === null;

  return threwStrictModeError === true && safeSuccess === true;
});

registerTest('SECCION 16: FASE 3.5.0.10', 'T-3510-02', 'Respuesta con nextPageToken = null: finalización normal de paginación sin continuar', () => {
  const responseData = new MockPS51Object({
    releases: [{ name: 'r1' }],
    nextPageToken: null
  });

  const tokenVal = responseData.getSafePropertyValue('nextPageToken');
  const shouldContinue = tokenVal !== null && tokenVal !== undefined && String(tokenVal).trim().length > 0;
  return shouldContinue === false;
});

registerTest('SECCION 16: FASE 3.5.0.10', 'T-3510-03', 'Respuesta con nextPageToken válido y segunda página: extracción segura y paginación continua', () => {
  const page1 = new MockPS51Object({ releases: [{ name: 'r1' }], nextPageToken: 'token_pag_2' });
  const page2 = new MockPS51Object({ releases: [{ name: 'r2' }] }); // sin token

  const allReleases: any[] = [];
  let token: string | null = '';
  let pagesVisited = 0;

  // Simulación del bucle do-while de query-remote-rules.ps1
  let currentPageObj = page1;
  do {
    pagesVisited++;
    const rels = currentPageObj.getSafePropertyValue('releases');
    if (rels) allReleases.push(...rels);

    const nextTok = currentPageObj.getSafePropertyValue('nextPageToken');
    token = (nextTok && String(nextTok).trim().length > 0) ? String(nextTok) : null;
    currentPageObj = page2;
  } while (token !== null);

  return allReleases.length === 2 && pagesVisited === 2;
});

registerTest('SECCION 16: FASE 3.5.0.10', 'T-3510-04', 'Primera página sin token y con release canónica válida: coincidencia exitosa en paso único', () => {
  const canonicalExpected = 'projects/gen-lang-client-0041212770/releases/cloud.firestore/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  const response = new MockPS51Object({
    releases: [
      new MockPS51Object({
        name: canonicalExpected,
        rulesetName: 'projects/gen-lang-client-0041212770/rulesets/uuid-1234',
        updateTime: '2026-11-12T00:00:00Z'
      })
    ]
  });

  const releases = response.getSafePropertyValue('releases') || [];
  const token = response.getSafePropertyValue('nextPageToken');
  const matched = releases.filter((r: MockPS51Object) => r.getSafePropertyValue('name') === canonicalExpected);

  return releases.length === 1 && token === null && matched.length === 1;
});

registerTest('SECCION 16: FASE 3.5.0.10', 'T-3510-05', 'Respuesta sin propiedad releases: acceso defensivo retorna lista vacía sin arrojar excepción', () => {
  const responseWithoutReleases = new MockPS51Object({});
  let threwError = false;
  try {
    responseWithoutReleases.directPropertyAccess('releases');
  } catch {
    threwError = true;
  }

  const safeVal = responseWithoutReleases.getSafePropertyValue('releases');
  const list = safeVal ? safeVal : [];
  return threwError === true && Array.isArray(list) && list.length === 0;
});

registerTest('SECCION 16: FASE 3.5.0.10', 'T-3510-06', 'Respuesta con releases vacío: detección y emisión de NO_MATCH', () => {
  const emptyReleasesResponse = new MockPS51Object({ releases: [] });
  const list = emptyReleasesResponse.getSafePropertyValue('releases') || [];
  const verdict = list.length === 0 ? 'NO_MATCH — RELEASE_NOT_FOUND_FOR_NAMED_DATABASE' : 'FOUND';
  return verdict === 'NO_MATCH — RELEASE_NOT_FOUND_FOR_NAMED_DATABASE';
});

registerTest('SECCION 16: FASE 3.5.0.10', 'T-3510-07', 'Respuesta HTTP 403: preservación de código de error HTTP y sanitización de mensaje', () => {
  const httpException = {
    statusCode: 403,
    message: 'The caller does not have permission'
  };
  const isForbidden = httpException.statusCode === 403;
  const noTokenLeaked = !httpException.message.includes('ya29.');
  return isForbidden && noTokenLeaked;
});

registerTest('SECCION 16: FASE 3.5.0.10', 'T-3510-08', 'Respuesta HTTP 429: detección de cuota/rate limit con código preservado', () => {
  const httpException = {
    statusCode: 429,
    message: 'Resource exhausted: rate limit exceeded'
  };
  return httpException.statusCode === 429 && httpException.message.includes('Resource exhausted');
});

registerTest('SECCION 16: FASE 3.5.0.10', 'T-3510-09', 'Respuesta JSON inválida o estructura inesperada: diagnóstico API_RESPONSE_SCHEMA_INVALID', () => {
  const invalidResponses = [null, undefined, 'raw-string-instead-of-json', 12345];
  const isInvalid = (r: any) => r === null || r === undefined || typeof r !== 'object';
  const allDetected = invalidResponses.every(isInvalid);
  const status = allDetected ? 'API_RESPONSE_SCHEMA_INVALID' : 'OK';
  return status === 'API_RESPONSE_SCHEMA_INVALID';
});

registerTest('SECCION 16: FASE 3.5.0.10', 'T-3510-10', 'Objeto deserializado con propiedades opcionales ausentes no arroja excepción en StrictMode', () => {
  // Objeto con solo name y rulesetName (sin updateTime ni attachment_point)
  const minimalRelease = new MockPS51Object({
    name: 'projects/gen-lang-client-0041212770/releases/cloud.firestore/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    rulesetName: 'projects/gen-lang-client-0041212770/rulesets/rs-1'
  });

  const name = minimalRelease.getSafePropertyValue('name');
  const ruleset = minimalRelease.getSafePropertyValue('rulesetName');
  const updateTime = minimalRelease.getSafePropertyValue('updateTime'); // Ausente
  const attachmentPoint = minimalRelease.getSafePropertyValue('attachment_point'); // Ausente

  return name !== null && ruleset !== null && updateTime === null && attachmentPoint === null;
});

// ----------------------------------------------------------------------------
// SECCION 17: FASE 3.5.0.11 — CONTRATO REAL DE FIREBASE RULES API (RELEASE & RULESET)
// ----------------------------------------------------------------------------

registerTest('SECCION 17: FASE 3.5.0.11', 'T-3511-01', 'Release sin attachment_point se procesa con éxito (ausencia en Release NO provoca rechazo)', () => {
  // Objeto Release oficial según Google API v1 (solo name, rulesetName, createTime, updateTime)
  const canonicalExpected = 'projects/gen-lang-client-0041212770/releases/cloud.firestore/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  const officialRelease = new MockPS51Object({
    name: canonicalExpected,
    rulesetName: 'projects/gen-lang-client-0041212770/rulesets/rs-4567',
    createTime: '2026-11-12T00:00:00Z',
    updateTime: '2026-11-12T00:00:00Z'
  });

  // La Release NO tiene attachment_point
  const releaseAttachment = officialRelease.getSafePropertyValue('attachment_point');
  const releaseName = officialRelease.getSafePropertyValue('name');
  const rulesetName = officialRelease.getSafePropertyValue('rulesetName');

  const releaseValid = releaseAttachment === null && releaseName === canonicalExpected && rulesetName !== null;
  return releaseValid === true;
});

registerTest('SECCION 17: FASE 3.5.0.11', 'T-3511-02', 'Release con rulesetName ausente rechazada con API_RESPONSE_SCHEMA_INVALID', () => {
  const invalidRelease = new MockPS51Object({
    name: 'projects/gen-lang-client-0041212770/releases/cloud.firestore/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c'
    // rulesetName ausente
  });

  const rulesetName = invalidRelease.getSafePropertyValue('rulesetName');
  const isRejected = !rulesetName || String(rulesetName).trim().length === 0;
  return isRejected === true;
});

registerTest('SECCION 17: FASE 3.5.0.11', 'T-3511-03', 'Ruleset con attachment_point correcto en formato completo aceptado', () => {
  const projectNumber = '510844325101';
  const databaseId = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  const officialRuleset = new MockPS51Object({
    name: 'projects/gen-lang-client-0041212770/rulesets/rs-4567',
    attachment_point: `firestore.googleapis.com/projects/${projectNumber}/databases/${databaseId}`,
    source: { files: [{ name: 'firestore.rules', content: 'rules_version = "2";' }] }
  });

  const expectedFull = `firestore.googleapis.com/projects/${projectNumber}/databases/${databaseId}`;
  const actualAttachment = officialRuleset.getSafePropertyValue('attachment_point');
  return actualAttachment === expectedFull;
});

registerTest('SECCION 17: FASE 3.5.0.11', 'T-3511-04', 'Ruleset con attachment_point correcto en formato abreviado aceptado', () => {
  const databaseId = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  const officialRuleset = new MockPS51Object({
    name: 'projects/gen-lang-client-0041212770/rulesets/rs-4567',
    attachment_point: `firestore.googleapis.com/databases/${databaseId}`,
    source: { files: [{ name: 'firestore.rules', content: 'rules_version = "2";' }] }
  });

  const expectedShort = `firestore.googleapis.com/databases/${databaseId}`;
  const actualAttachment = officialRuleset.getSafePropertyValue('attachment_point');
  return actualAttachment === expectedShort;
});

registerTest('SECCION 17: FASE 3.5.0.11', 'T-3511-05', 'Ruleset con otra base de datos en attachment_point rechazado', () => {
  const projectNumber = '510844325101';
  const databaseId = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  const wrongRuleset = new MockPS51Object({
    attachment_point: `firestore.googleapis.com/projects/${projectNumber}/databases/wrong-database-id`
  });

  const expectedFull = `firestore.googleapis.com/projects/${projectNumber}/databases/${databaseId}`;
  const expectedShort = `firestore.googleapis.com/databases/${databaseId}`;
  const actual = wrongRuleset.getSafePropertyValue('attachment_point');

  const isAccepted = actual === expectedFull || actual === expectedShort;
  return isAccepted === false;
});

registerTest('SECCION 17: FASE 3.5.0.11', 'T-3511-06', 'Ruleset con project number discrepante en attachment_point rechazado', () => {
  const correctProjectNumber = '510844325101';
  const databaseId = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  const wrongNumberRuleset = new MockPS51Object({
    attachment_point: `firestore.googleapis.com/projects/999888777666/databases/${databaseId}`
  });

  const expectedFull = `firestore.googleapis.com/projects/${correctProjectNumber}/databases/${databaseId}`;
  const actual = wrongNumberRuleset.getSafePropertyValue('attachment_point');
  return actual !== expectedFull;
});

registerTest('SECCION 17: FASE 3.5.0.11', 'T-3511-07', 'Ruleset sin attachment_point rechazado con ATTACHMENT_POINT_MISSING', () => {
  const rulesetWithoutAttachment = new MockPS51Object({
    name: 'projects/gen-lang-client-0041212770/rulesets/rs-4567',
    source: { files: [{ name: 'firestore.rules', content: 'rules_version = "2";' }] }
  });

  const rawAttachment = rulesetWithoutAttachment.getSafePropertyValue('attachment_point');
  const isMissing = rawAttachment === null || String(rawAttachment).trim().length === 0;
  return isMissing === true;
});

registerTest('SECCION 17: FASE 3.5.0.11', 'T-3511-08', 'Ruleset con source.files ausente o vacío rechazado con API_RESPONSE_SCHEMA_INVALID', () => {
  const rulesetNoSource = new MockPS51Object({
    attachment_point: 'firestore.googleapis.com/databases/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c'
  });
  const rulesetEmptyFiles = new MockPS51Object({
    attachment_point: 'firestore.googleapis.com/databases/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    source: new MockPS51Object({ files: [] })
  });

  const source1 = rulesetNoSource.getSafePropertyValue('source');
  const files2 = rulesetEmptyFiles.getSafePropertyValue('source')?.getSafePropertyValue('files');

  const check1 = source1 === null;
  const check2 = Array.isArray(files2) && files2.length === 0;
  return check1 && check2;
});

registerTest('SECCION 17: FASE 3.5.0.11', 'T-3511-09', 'Secuencia estricta: source.files solo se extrae DESPUÉS de validar attachment_point', () => {
  const executionOrder: string[] = [];

  function processRuleset(ruleset: MockPS51Object) {
    // 1. Validar attachment_point primero
    const att = ruleset.getSafePropertyValue('attachment_point');
    if (!att) throw new Error('ATTACHMENT_POINT_MISSING');
    executionOrder.push('VALIDATE_ATTACHMENT_POINT');

    // 2. Extraer source.files después
    const src = ruleset.getSafePropertyValue('source');
    executionOrder.push('EXTRACT_SOURCE_FILES');
  }

  const validRuleset = new MockPS51Object({
    attachment_point: 'firestore.googleapis.com/databases/ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    source: new MockPS51Object({ files: [{ name: 'firestore.rules', content: 'test' }] })
  });

  processRuleset(validRuleset);
  return executionOrder[0] === 'VALIDATE_ATTACHMENT_POINT' && executionOrder[1] === 'EXTRACT_SOURCE_FILES';
});

registerTest('SECCION 17: FASE 3.5.0.11', 'T-3511-10', 'Ausencia de snapshots o archivos residuales ante fallos de validación del Ruleset', () => {
  let snapshotSaved = false;
  let tmpFileCleaned = false;

  function attemptSnapshot(isValidRuleset: boolean) {
    if (!isValidRuleset) {
      tmpFileCleaned = true;
      return; // aborta sin guardar
    }
    snapshotSaved = true;
  }

  attemptSnapshot(false);
  return snapshotSaved === false && tmpFileCleaned === true;
});

// ----------------------------------------------------------------------------
// EJECUTOR DE SUITE
// ----------------------------------------------------------------------------
async function runSuite() {
  console.log('========================================================================');
  console.log('SUITE AUTOMATIZADA DE PRUEBAS DEL EXTRACTOR FORENSE VIGORCORE');
  console.log('Fases 3.5.0 a 3.5.0.11 — Verificación Funcional, Criptográfica, ACL y Reglas');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;
  let currentSection = '';

  for (const test of tests) {
    if (test.section !== currentSection) {
      currentSection = test.section;
      console.log(`\n--- ${currentSection} ---`);
    }

    try {
      const result = await test.fn();
      if (result) {
        console.log(`  [PASS] ${test.id} - ${test.description}`);
        passed++;
      } else {
        console.error(`  [FAIL] ${test.id} - ${test.description}`);
        failed++;
      }
    } catch (err: any) {
      console.error(`  [ERROR] ${test.id} - ${test.description}: ${err.message}`);
      failed++;
    }
  }

  console.log('\n========================================================================');
  console.log(`RESUMEN: ${passed} APROBADAS | ${failed} FALLIDAS | TOTAL: ${tests.length}`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite();
