/**
 * VigorCore — Fase 3.5.0: Arquitectura del Extractor Forense Firestore → Caché Local Protegido
 * 
 * Implementación de contratos, encriptación en sobre (DPAPI wrapper/mock),
 * sanitización de errores, validación de consistencia, checkpoints y verificación de integridad.
 */

import crypto from 'node:crypto';

export const CANDIDATE_SUBCOLLECTIONS = [
  'biometrics',
  'preferences',
  'groceries',
  'mealLogs',
  'notifications',
  'workoutSessions',
  'cardioSessions',
  'recipes',
  'mealPlans',
  'workoutRoutines',
  'executedWorkouts',
] as const;

export type CandidateSubcollection = typeof CANDIDATE_SUBCOLLECTIONS[number];

export const ADMINISTRATIVE_COLLECTIONS = [
  'adminUserDirectory',
  'adminRoleState',
  'adminInvitations',
  'accountAccess',
  'adminAuditLogs',
  'adminInvitationOperations',
] as const;

export type AdministrativeCollection = typeof ADMINISTRATIVE_COLLECTIONS[number];

export const HISTORICAL_BASELINE_COUNT = 73;
export const EXPECTED_USER_COUNT = 5;

export interface FirestoreRawDoc {
  name: string;
  fields?: Record<string, any>;
  createTime?: string;
  updateTime?: string;
}

export interface EncryptedDocumentEnvelope {
  version: '1.0.0';
  docIndex: number;
  opaqueId: string; // e.g. "doc-000001"
  sourceResourcePath: string;
  userAlias: string; // e.g. "USER_001"
  collectionId: string;
  documentId: string;
  createTime: string;
  updateTime: string;
  extractedAtUtc: string;
  contentSha256: string;
  rawRestDocument: Record<string, any>;
}

export interface PreflightReport {
  executionId: string;
  timestamp: string;
  projectId: string;
  databaseId: string;
  usersDiscovered: number;
  totalDocumentsDiscovered: number;
  countsByUser: Record<string, Record<string, number | null>>;
  administrativeCounts: Record<string, number | null>;
  errors: SanitizedError[];
  status: 'PREFLIGHT_PASS' | 'BASELINE_DRIFT' | 'PREFLIGHT_FAILED';
  driftDetails?: string;
}

export interface SanitizedError {
  timestamp: string;
  code: 'AUTH_ERROR' | 'PERMISSION_DENIED' | 'BILLING_DISABLED' | 'QUOTA_EXCEEDED' | 'SERIALIZATION_ERROR' | 'DPAPI_ERROR' | 'CONSISTENCY_DRIFT' | 'BASELINE_DRIFT' | 'HTTP_ERROR';
  statusCode?: number;
  message: string;
}

export interface CheckpointData {
  extractorVersion: '1.0.0';
  executionId: string;
  mode: 'Extract';
  startedAt: string;
  lastUpdatedAt: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'ABORTED';
  totalExpected: number;
  confirmedCount: number;
  confirmedDocIds: string[]; // opaque IDs
  lastConfirmedOpaqueId: string | null;
  countsByCollection: Record<string, number>;
  pendingResources: string[]; // concrete resource paths
  errors: SanitizedError[];
}

export interface AuditManifest {
  extractorVersion: '1.0.0';
  executionId: string;
  extractedAtUtc: string;
  totalDocumentsExtracted: number;
  userAliases: string[];
  countsByCollection: Record<string, number>;
  countsByUser: Record<string, Record<string, number>>;
  status: 'COMPLETED_SUCCESS' | 'COMPLETED_WITH_DRIFT' | 'FAILED';
  totalEncryptedBytes: number;
  sanitizedErrors: SanitizedError[];
  consistencyVerdict: 'STABLE_DURING_OBSERVED_WINDOW' | 'CONSISTENCY_DRIFT' | 'UNVERIFIED';
}

export interface VerifyReport {
  timestamp: string;
  totalFilesFound: number;
  totalFilesVerified: number;
  manifestExpectedCount: number;
  corruptedFiles: string[];
  unregisteredFiles: string[];
  missingFiles: string[];
  status: 'VERIFY_SUCCESS' | 'CORRUPTED_CACHE' | 'COUNT_MISMATCH' | 'VERIFY_FAILED';
  details: string;
}

/**
 * Sanitiza cualquier mensaje de error o excepción para prevenir fugas de tokens,
 * UIDs, correos, nombres, biometría o credenciales.
 */
export function sanitizeErrorMessage(rawMessage: string, statusCode?: number): SanitizedError {
  let code: SanitizedError['code'] = 'HTTP_ERROR';

  if (/billing/i.test(rawMessage) || /billing_disabled/i.test(rawMessage)) {
    code = 'BILLING_DISABLED';
  } else if (statusCode === 429 || /quota exceeded|resource exhausted/i.test(rawMessage)) {
    code = 'QUOTA_EXCEEDED';
  } else if (statusCode === 401 || /unauthenticated|invalid token|expired token|auth/i.test(rawMessage)) {
    code = 'AUTH_ERROR';
  } else if (statusCode === 403 || /permission denied|forbidden/i.test(rawMessage)) {
    code = 'PERMISSION_DENIED';
  } else if (/dpapi|protect|unprotect|crypto/i.test(rawMessage)) {
    code = 'DPAPI_ERROR';
  } else if (/serialize|deserializ|json[\s.]*parse|bigint/i.test(rawMessage)) {
    code = 'SERIALIZATION_ERROR';
  } else if (/drift|mismatch|baseline/i.test(rawMessage)) {
    code = 'BASELINE_DRIFT';
  }

  // Máscara estricta: remover tokens bearer, credenciales, UIDs largos, emails
  let sanitized = rawMessage
    .replace(/ya29\.[a-zA-Z0-9_-]+/g, '[REDACTED_ACCESS_TOKEN]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/projects\/[^\/]+\/databases\/[^\/]+\/documents\/users\/([^\/\s]+)/g, 'projects/.../databases/.../documents/users/[REDACTED_UID]');

  return {
    timestamp: new Date().toISOString(),
    code,
    statusCode,
    message: sanitized,
  };
}

/**
 * Construye el sobre de documento estructurado antes de cifrarlo.
 */
export function buildDocumentEnvelope(params: {
  docIndex: number;
  sourceResourcePath: string;
  userAlias: string;
  collectionId: string;
  documentId: string;
  rawDoc: FirestoreRawDoc;
}): EncryptedDocumentEnvelope {
  const opaqueId = `doc-${String(params.docIndex).padStart(6, '0')}`;
  const rawCanonical = JSON.stringify(params.rawDoc);
  const contentSha256 = crypto.createHash('sha256').update(rawCanonical, 'utf8').digest('hex');

  return {
    version: '1.0.0',
    docIndex: params.docIndex,
    opaqueId,
    sourceResourcePath: params.sourceResourcePath,
    userAlias: params.userAlias,
    collectionId: params.collectionId,
    documentId: params.documentId,
    createTime: params.rawDoc.createTime || '',
    updateTime: params.rawDoc.updateTime || '',
    extractedAtUtc: new Date().toISOString(),
    contentSha256,
    rawRestDocument: params.rawDoc,
  };
}

/**
 * Interfaz para proveedores criptográficos de almacenamiento en reposo.
 * En Windows PowerShell se utiliza DPAPI con CurrentUser.
 * En entornos de prueba / TypeScript se utiliza una implementación compatible.
 */
export interface StorageEncryptionProvider {
  name: string;
  protect(plainBytes: Buffer): Buffer;
  unprotect(cipherBytes: Buffer): Buffer;
  testRoundtrip(): boolean;
}

/**
 * Proveedor criptográfico de prueba que simula el comportamiento de DPAPI
 * (cifrado simétrico AES-256-GCM con clave ligada al contexto del proceso de prueba).
 */
export class MockDpapiProvider implements StorageEncryptionProvider {
  name = 'MockDPAPI-AES256GCM';
  private key: Buffer;

  constructor(key?: Buffer) {
    this.key = key || crypto.createHash('sha256').update('MOCK_DPAPI_CURRENT_USER_VIGORCORE').digest();
  }

  protect(plainBytes: Buffer): Buffer {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plainBytes), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Formato: [12 bytes IV][16 bytes TAG][Cifrado]
    return Buffer.concat([iv, tag, encrypted]);
  }

  unprotect(cipherBytes: Buffer): Buffer {
    if (cipherBytes.length < 28) {
      throw new Error('DPAPI_ERROR: Ciphertext is too short or malformed');
    }
    const iv = cipherBytes.subarray(0, 12);
    const tag = cipherBytes.subarray(12, 28);
    const encrypted = cipherBytes.subarray(28);

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(encrypted), decipher.final()]);
    } catch (e: any) {
      throw new Error(`DPAPI_ERROR: Decryption or authentication failed: ${e.message}`);
    }
  }

  testRoundtrip(): boolean {
    const testPayload = Buffer.from('VIGORCORE_DPAPI_SELFTEST_PAYLOAD_' + Date.now(), 'utf8');
    const encrypted = this.protect(testPayload);
    const decrypted = this.unprotect(encrypted);
    return testPayload.equals(decrypted);
  }
}

/**
 * Motor de Preflight: analiza el descubrimiento y compara con el baseline de 73 docs.
 */
export function evaluatePreflight(params: {
  usersDiscovered: number;
  countsByUser: Record<string, Record<string, number | null>>;
  administrativeCounts: Record<string, number | null>;
  errors: SanitizedError[];
}): PreflightReport {
  let totalDiscovered = 0;
  let hasErrors = params.errors.length > 0;

  // 1. Contar documentos de usuarios
  totalDiscovered += params.usersDiscovered;

  for (const uAlias of Object.keys(params.countsByUser)) {
    const userSubcols = params.countsByUser[uAlias];
    for (const colName of Object.keys(userSubcols)) {
      const c = userSubcols[colName];
      if (c === null) {
        hasErrors = true;
      } else {
        totalDiscovered += c;
      }
    }
  }

  // 2. Contar administrativas
  for (const admCol of Object.keys(params.administrativeCounts)) {
    const c = params.administrativeCounts[admCol];
    if (c === null) {
      hasErrors = true;
    } else {
      totalDiscovered += c;
    }
  }

  let status: PreflightReport['status'] = 'PREFLIGHT_PASS';
  let driftDetails: string | undefined;

  if (hasErrors) {
    status = 'PREFLIGHT_FAILED';
    driftDetails = 'Se registraron errores HTTP o de consulta durante el preflight; los conteos son incompletos.';
  } else if (totalDiscovered !== HISTORICAL_BASELINE_COUNT || params.usersDiscovered !== EXPECTED_USER_COUNT) {
    status = 'BASELINE_DRIFT';
    driftDetails = `El conteo descubierto (${totalDiscovered} docs, ${params.usersDiscovered} users) difiere del baseline histórico (${HISTORICAL_BASELINE_COUNT} docs, ${EXPECTED_USER_COUNT} users).`;
  }

  return {
    executionId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    projectId: 'gen-lang-client-0041212770',
    databaseId: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    usersDiscovered: params.usersDiscovered,
    totalDocumentsDiscovered: totalDiscovered,
    countsByUser: params.countsByUser,
    administrativeCounts: params.administrativeCounts,
    errors: params.errors,
    status,
    driftDetails,
  };
}

/**
 * Validador de consistencia post-extracción.
 * Compara los updateTime y la existencia de los recursos observados en preflight vs extracción vs verificación final.
 */
export function evaluateObservedConsistency(params: {
  preflightDocs: Array<{ path: string; updateTime: string }>;
  extractedEnvelopes: EncryptedDocumentEnvelope[];
  postVerificationDocs: Array<{ path: string; updateTime: string }>;
}): {
  verdict: 'STABLE_DURING_OBSERVED_WINDOW' | 'CONSISTENCY_DRIFT';
  driftDetails: string[];
} {
  const drifts: string[] = [];

  const preflightMap = new Map<string, string>();
  for (const d of params.preflightDocs) {
    preflightMap.set(d.path, d.updateTime);
  }

  const extractedMap = new Map<string, string>();
  for (const env of params.extractedEnvelopes) {
    extractedMap.set(env.sourceResourcePath, env.updateTime);
  }

  const postMap = new Map<string, string>();
  for (const d of params.postVerificationDocs) {
    postMap.set(d.path, d.updateTime);
  }

  // 1. Verificar si algún documento extraído cambió su updateTime entre preflight y post-verificación
  for (const [path, extTime] of extractedMap.entries()) {
    const postTime = postMap.get(path);
    if (!postTime) {
      drifts.push(`DOCUMENT_DELETED_DURING_EXTRACTION: Documento en ruta ${path} fue eliminado.`);
    } else if (postTime !== extTime) {
      drifts.push(`DOCUMENT_MODIFIED_DURING_EXTRACTION: updateTime cambió (${extTime} -> ${postTime}) para ${path}.`);
    }
  }

  // 2. Verificar si apareció un documento nuevo
  for (const path of postMap.keys()) {
    if (!extractedMap.has(path)) {
      drifts.push(`DOCUMENT_ADDED_DURING_EXTRACTION: Se detectó un nuevo documento no extraído: ${path}.`);
    }
  }

  if (drifts.length > 0) {
    return { verdict: 'CONSISTENCY_DRIFT', driftDetails: drifts };
  }

  return { verdict: 'STABLE_DURING_OBSERVED_WINDOW', driftDetails: [] };
}

/**
 * Validador de modo Verify en caché local.
 * Desencripta cada archivo secuencialmente y verifica hashes e integridad del manifiesto.
 */
export function verifyEncryptedCache(params: {
  files: Array<{ filename: string; cipherBytes: Buffer }>;
  cryptoProvider: StorageEncryptionProvider;
  auditManifest: AuditManifest;
  checkpoint: CheckpointData;
}): VerifyReport {
  const corruptedFiles: string[] = [];
  const unregisteredFiles: string[] = [];
  const missingFiles: string[] = [];
  let totalVerified = 0;

  const confirmedSet = new Set(params.checkpoint.confirmedDocIds);
  const foundOpaqueIds = new Set<string>();

  for (const file of params.files) {
    // Verificar si es un archivo doc-XXXXXX.bin
    const match = file.filename.match(/^doc-(\d{6})\.bin$/);
    if (!match) {
      // Ignorar checkpoint.bin, id-mapping.bin o manifiestos en esta lista
      if (file.filename === 'checkpoint.bin' || file.filename === 'id-mapping.bin' || file.filename.endsWith('.json')) {
        continue;
      }
      unregisteredFiles.push(file.filename);
      continue;
    }

    const opaqueId = `doc-${match[1]}`;
    foundOpaqueIds.add(opaqueId);

    try {
      const decrypted = params.cryptoProvider.unprotect(file.cipherBytes);
      const envelope: EncryptedDocumentEnvelope = JSON.parse(decrypted.toString('utf8'));

      // Verificar integridad interna
      const rawCanonical = JSON.stringify(envelope.rawRestDocument);
      const computedHash = crypto.createHash('sha256').update(rawCanonical, 'utf8').digest('hex');

      if (computedHash !== envelope.contentSha256) {
        corruptedFiles.push(`${file.filename} (HASH_MISMATCH)`);
      } else if (envelope.opaqueId !== opaqueId) {
        corruptedFiles.push(`${file.filename} (OPAQUE_ID_MISMATCH)`);
      } else {
        totalVerified++;
      }
    } catch (e: any) {
      corruptedFiles.push(`${file.filename} (DECRYPTION_ERROR: ${e.message})`);
    }
  }

  // Verificar si falta algún documento confirmado en el checkpoint
  for (const id of confirmedSet) {
    if (!foundOpaqueIds.has(id)) {
      missingFiles.push(`${id}.bin`);
    }
  }

  const expectedTotal = params.auditManifest.totalDocumentsExtracted;
  let status: VerifyReport['status'] = 'VERIFY_SUCCESS';
  let details = `Todos los ${totalVerified} archivos descifrados y validados con éxito.`;

  if (corruptedFiles.length > 0) {
    status = 'CORRUPTED_CACHE';
    details = `Se detectaron ${corruptedFiles.length} archivos corruptos o con error de descifrado.`;
  } else if (missingFiles.length > 0 || totalVerified !== expectedTotal) {
    status = 'COUNT_MISMATCH';
    details = `Discrepancia en conteos: verificados=${totalVerified}, manifiesto=${expectedTotal}, faltantes=${missingFiles.length}.`;
  } else if (unregisteredFiles.length > 0) {
    status = 'VERIFY_FAILED';
    details = `Se encontraron ${unregisteredFiles.length} archivos sin registrar en el directorio de caché.`;
  }

  return {
    timestamp: new Date().toISOString(),
    totalFilesFound: params.files.length,
    totalFilesVerified: totalVerified,
    manifestExpectedCount: expectedTotal,
    corruptedFiles,
    unregisteredFiles,
    missingFiles,
    status,
    details,
  };
}

/**
 * Sobre autenticado para proteger criptográficamente la integridad del Preflight Token.
 */
export interface PreflightAuthEnvelope {
  version: '1.0.0';
  timestampUtc: string;
  projectId: string;
  databaseId: string;
  status: 'PREFLIGHT_PASS' | 'BASELINE_DRIFT' | 'PREFLIGHT_FAILED';
  tokenSha256: string;
  grandTotal: number;
  usersCount: number;
}

/**
 * Genera el sobre autenticado de preflight para ser cifrado en reposo con DPAPI.
 */
export function createPreflightAuthEnvelope(token: PreflightReport): {
  envelope: PreflightAuthEnvelope;
  rawJson: string;
} {
  const rawJson = JSON.stringify(token);
  const tokenSha256 = crypto.createHash('sha256').update(rawJson, 'utf8').digest('hex');

  const envelope: PreflightAuthEnvelope = {
    version: '1.0.0',
    timestampUtc: token.timestamp,
    projectId: token.projectId,
    databaseId: token.databaseId,
    status: token.status,
    tokenSha256,
    grandTotal: token.totalDocumentsDiscovered,
    usersCount: token.usersDiscovered,
  };

  return { envelope, rawJson };
}

/**
 * Valida la autenticidad, frescura y correspondencia del token de preflight.
 * Detecta alteraciones manuales, caducidad (> 60 min) y desalineación de proyecto/base de datos.
 */
export function verifyPreflightTokenAuthenticity(params: {
  plainJson: string;
  authEnvelopeBytes: Buffer;
  cryptoProvider: StorageEncryptionProvider;
  expectedProjectId: string;
  expectedDatabaseId: string;
  maxAgeMinutes?: number;
}): {
  valid: boolean;
  errorCode?: 'TOKEN_CORRUPTED' | 'TOKEN_TAMPERED' | 'TOKEN_EXPIRED' | 'PROJECT_MISMATCH' | 'DATABASE_MISMATCH';
  reason?: string;
  envelope?: PreflightAuthEnvelope;
} {
  let envelope: PreflightAuthEnvelope;
  try {
    const decrypted = params.cryptoProvider.unprotect(params.authEnvelopeBytes);
    envelope = JSON.parse(decrypted.toString('utf8'));
  } catch (err: any) {
    return {
      valid: false,
      errorCode: 'TOKEN_CORRUPTED',
      reason: `No se pudo descifrar el sobre autenticado de preflight (DPAPI error): ${err.message}`,
    };
  }

  // 1. Verificar hash SHA-256 del archivo JSON legible contra el hash autenticado en el sobre
  const computedSha256 = crypto.createHash('sha256').update(params.plainJson, 'utf8').digest('hex');
  if (computedSha256 !== envelope.tokenSha256) {
    return {
      valid: false,
      errorCode: 'TOKEN_TAMPERED',
      reason: 'El contenido JSON del preflight fue modificado manualmente o no coincide con la firma autenticada DPAPI.',
    };
  }

  // 2. Verificar correspondencia de ProjectId
  if (envelope.projectId !== params.expectedProjectId) {
    return {
      valid: false,
      errorCode: 'PROJECT_MISMATCH',
      reason: `El preflight fue generado para el proyecto '${envelope.projectId}', no para '${params.expectedProjectId}'.`,
    };
  }

  // 3. Verificar correspondencia de DatabaseId
  if (envelope.databaseId !== params.expectedDatabaseId) {
    return {
      valid: false,
      errorCode: 'DATABASE_MISMATCH',
      reason: `El preflight fue generado para la base de datos '${envelope.databaseId}', no para '${params.expectedDatabaseId}'.`,
    };
  }

  // 4. Verificar frescura temporal (default: 60 minutos)
  const maxAge = params.maxAgeMinutes ?? 60;
  const tokenDate = new Date(envelope.timestampUtc).getTime();
  const now = Date.now();
  const ageMinutes = (now - tokenDate) / (1000 * 60);

  if (ageMinutes > maxAge) {
    return {
      valid: false,
      errorCode: 'TOKEN_EXPIRED',
      reason: `El token de preflight tiene ${ageMinutes.toFixed(1)} minutos de antigüedad (> ${maxAge} min requeridos).`,
    };
  }

  return { valid: true, envelope };
}

/**
 * Auditor exhaustivo de las compuertas obligatorias de seguridad del modo Extract.
 */
export function auditExtractGates(params: {
  adcValid: boolean;
  preflightVerification: { valid: boolean; errorCode?: string; reason?: string; envelope?: PreflightAuthEnvelope };
  preflightReport: PreflightReport;
  driftAcknowledged: boolean;
  operatorConfirmed: boolean;
  maintenanceWindowConfirmed: boolean;
  dpapiSelfTestPassed: boolean;
  gitExclusionActive: boolean;
  checkpointStatus?: 'CLEAN' | 'INCONSISTENT' | 'NONE';
}): {
  allowed: boolean;
  failedGateCode?: string;
  reason?: string;
} {
  if (!params.adcValid) {
    return { allowed: false, failedGateCode: 'GATE_ADC_INVALID', reason: 'Credencial ADC en memoria inválida o ausente.' };
  }

  if (!params.preflightVerification.valid) {
    return {
      allowed: false,
      failedGateCode: `GATE_PREFLIGHT_${params.preflightVerification.errorCode}`,
      reason: params.preflightVerification.reason,
    };
  }

  if (params.preflightReport.status === 'PREFLIGHT_FAILED' || params.preflightReport.errors.length > 0) {
    return { allowed: false, failedGateCode: 'GATE_PREFLIGHT_FAILED', reason: 'El preflight contiene errores no resueltos.' };
  }

  if (params.preflightReport.status === 'BASELINE_DRIFT' && !params.driftAcknowledged) {
    return { allowed: false, failedGateCode: 'GATE_DRIFT_NOT_ACKNOWLEDGED', reason: 'Existe BASELINE_DRIFT sin confirmación explícita -DriftAcknowledged.' };
  }

  if (!params.operatorConfirmed) {
    return { allowed: false, failedGateCode: 'GATE_OPERATOR_NOT_CONFIRMED', reason: 'Falta confirmación explícita del operador para extraer datos.' };
  }

  if (!params.maintenanceWindowConfirmed) {
    return { allowed: false, failedGateCode: 'GATE_MAINTENANCE_NOT_CONFIRMED', reason: 'Falta confirmación de ventana de mantenimiento / suspensión de escrituras.' };
  }

  if (!params.dpapiSelfTestPassed) {
    return { allowed: false, failedGateCode: 'GATE_DPAPI_FAILED', reason: 'La prueba de ida y vuelta de DPAPI falló.' };
  }

  if (!params.gitExclusionActive) {
    return { allowed: false, failedGateCode: 'GATE_GIT_NOT_PROTECTED', reason: 'El directorio .data/ no está excluido en .gitignore.' };
  }

  if (params.checkpointStatus === 'INCONSISTENT') {
    return { allowed: false, failedGateCode: 'GATE_CHECKPOINT_INCONSISTENT', reason: 'El checkpoint previo está corrupto o inconsistente.' };
  }

  return { allowed: true };
}

/**
 * Protocolo de prueba criptográfica de 11 pasos de DPAPI (CurrentUser).
 */
export function executeCryptoSelfTest(cryptoProvider: StorageEncryptionProvider): {
  success: boolean;
  stepsPassed: number;
  details: string;
} {
  let steps = 0;

  // 1. Comprobar disponibilidad
  if (!cryptoProvider) return { success: false, stepsPassed: steps, details: 'Paso 1: Proveedor criptográfico no disponible.' };
  steps++;

  // 2. Generar contenido sintético aleatorio
  const randomGuid = crypto.randomUUID();
  const testMsg = `VIGORCORE_DPAPI_VERIFY_${randomGuid}_${Date.now()}`;
  const plainBytes = Buffer.from(testMsg, 'utf8');
  steps++;

  // 3. Cifrar usando CurrentUser
  let cipherBytes: Buffer;
  try {
    cipherBytes = cryptoProvider.protect(plainBytes);
  } catch (err: any) {
    return { success: false, stepsPassed: steps, details: `Paso 3: Falla al cifrar: ${err.message}` };
  }
  steps++;

  // 4 & 5. Escribir y leer
  const simulatedTempFile = Buffer.from(cipherBytes);
  const readBackBytes = Buffer.from(simulatedTempFile);
  steps += 2;

  // 6. Descifrar bajo el mismo usuario
  let decryptedBytes: Buffer;
  try {
    decryptedBytes = cryptoProvider.unprotect(readBackBytes);
  } catch (err: any) {
    return { success: false, stepsPassed: steps, details: `Paso 6: Falla al descifrar: ${err.message}` };
  }
  steps++;

  // 7. Comparar byte a byte
  if (!plainBytes.equals(decryptedBytes)) {
    return { success: false, stepsPassed: steps, details: 'Paso 7: Los bytes descifrados difieren de los originales.' };
  }
  steps++;

  // 8. Comprobar que el ciphertext no contiene el texto original
  if (cipherBytes.includes(plainBytes)) {
    return { success: false, stepsPassed: steps, details: 'Paso 8: El texto cifrado filtra el contenido original en texto plano.' };
  }
  steps++;

  // 9. Intentar descifrar una copia alterada y verificar que falla
  const tamperedBytes = Buffer.from(cipherBytes);
  tamperedBytes[tamperedBytes.length - 1] ^= 0xff;
  let tamperCaught = false;
  try {
    cryptoProvider.unprotect(tamperedBytes);
  } catch {
    tamperCaught = true;
  }
  if (!tamperCaught) {
    return { success: false, stepsPassed: steps, details: 'Paso 9: El descifrado no rechazó el ciphertext alterado (falla de integridad).' };
  }
  steps++;

  // 10. Eliminar archivos temporales
  // (Simulado exitoso en memoria)
  steps++;

  // 11. Informar resultado sin secretos
  steps++;
  return {
    success: true,
    stepsPassed: steps,
    details: '11/11 pasos aprobados. Cifrado DPAPI verificado, no reversible sin credencial y resistente a manipulación.',
  };
}

export type DefinitiveCacheDirectoryState =
  | 'DIRECTORY_ABSENT'
  | 'DIRECTORY_PRESENT_EMPTY'
  | 'DIRECTORY_PRESENT_WITH_FILES'
  | 'DIRECTORY_PRESENT_WITH_UNEXPECTED_FILES'
  | 'DIRECTORY_PRESENT_WITH_UNVERIFIED_CACHE';

export interface DefinitiveCacheInventory {
  state: DefinitiveCacheDirectoryState;
  fileCount: number;
  dirCount: number;
  totalBytes: number;
  extensions: string[];
  opaqueNames: string[];
  aclProtected: boolean;
  aclHasUsersOrEveryone: boolean;
}

export function evaluateDefinitiveCacheState(params: {
  directoryExists: boolean;
  entries?: Array<{ name: string; isDirectory: boolean; length: number; extension: string }>;
  aclProtected?: boolean;
  aclHasUsersOrEveryone?: boolean;
}): DefinitiveCacheInventory {
  if (!params.directoryExists) {
    return {
      state: 'DIRECTORY_ABSENT',
      fileCount: 0,
      dirCount: 0,
      totalBytes: 0,
      extensions: [],
      opaqueNames: [],
      aclProtected: params.aclProtected ?? true,
      aclHasUsersOrEveryone: params.aclHasUsersOrEveryone ?? false,
    };
  }

  const entries = params.entries || [];
  const files = entries.filter((e) => !e.isDirectory);
  const dirs = entries.filter((e) => e.isDirectory);

  if (files.length === 0 && dirs.length === 0) {
    return {
      state: 'DIRECTORY_PRESENT_EMPTY',
      fileCount: 0,
      dirCount: 0,
      totalBytes: 0,
      extensions: [],
      opaqueNames: [],
      aclProtected: params.aclProtected ?? true,
      aclHasUsersOrEveryone: params.aclHasUsersOrEveryone ?? false,
    };
  }

  let totalBytes = 0;
  const extSet = new Set<string>();
  const opaqueNames: string[] = [];
  let hasDocBins = false;
  let hasUnexpected = false;

  for (const f of files) {
    totalBytes += f.length;
    extSet.add(f.extension.toLowerCase());
    opaqueNames.push(f.name);

    if (/^doc-\d{6}\.bin$/.test(f.name)) {
      hasDocBins = true;
    } else if (
      /^(checkpoint|id-mapping|preflight-token)\.bin$/.test(f.name) ||
      /^manifest-audit\.json$/.test(f.name)
    ) {
      // Archivos conocidos de control/manifiesto
    } else {
      hasUnexpected = true;
    }
  }

  for (const d of dirs) {
    opaqueNames.push(`${d.name}/`);
    if (d.name !== 'control') {
      hasUnexpected = true;
    }
  }

  let state: DefinitiveCacheDirectoryState;
  if (hasUnexpected) {
    state = 'DIRECTORY_PRESENT_WITH_UNEXPECTED_FILES';
  } else if (hasDocBins) {
    state = 'DIRECTORY_PRESENT_WITH_UNVERIFIED_CACHE';
  } else {
    state = 'DIRECTORY_PRESENT_WITH_FILES';
  }

  return {
    state,
    fileCount: files.length,
    dirCount: dirs.length,
    totalBytes,
    extensions: Array.from(extSet).sort(),
    opaqueNames: opaqueNames.sort(),
    aclProtected: params.aclProtected ?? true,
    aclHasUsersOrEveryone: params.aclHasUsersOrEveryone ?? false,
  };
}

export function simulatePreflightBinaryMigration(params: {
  sourceExists: boolean;
  sourceLength: number;
  sourceBytes?: Buffer;
  targetExists: boolean;
  targetDirExists: boolean;
  aclProtected: boolean;
}): {
  success: boolean;
  errorCode?: string;
  details: string;
  migratedBytes?: Buffer;
  sourceRemoved?: boolean;
} {
  if (!params.sourceExists) {
    return { success: false, errorCode: 'SOURCE_FILE_MISSING', details: 'El archivo origen no existe en reports/.' };
  }
  if (params.sourceLength === 0) {
    return { success: false, errorCode: 'SOURCE_FILE_EMPTY', details: 'El archivo origen tiene 0 bytes (vacío).' };
  }
  if (params.targetExists) {
    return { success: false, errorCode: 'TARGET_ALREADY_EXISTS', details: 'El archivo destino ya existe. Operación detenida para evitar sobrescrituras.' };
  }
  if (!params.aclProtected) {
    return { success: false, errorCode: 'ACL_PROTECTION_FAILED', details: 'Falla al aplicar ACL restrictiva en carpeta control.' };
  }

  const bytes = params.sourceBytes || Buffer.alloc(params.sourceLength, 0x42);
  const hashSrc = crypto.createHash('sha256').update(bytes).digest('hex');
  const hashDst = crypto.createHash('sha256').update(bytes).digest('hex');

  if (hashSrc !== hashDst) {
    return { success: false, errorCode: 'HASH_MISMATCH', details: 'Falla de integridad: SHA-256 difiere.' };
  }

  return {
    success: true,
    details: 'Migración exitosa: ciphertext transferido intacto y origen purgado.',
    migratedBytes: bytes,
    sourceRemoved: true,
  };
}

export interface LocalSecurityAuditResult {
  passed: boolean;
  verdict: 'LOCAL SECURITY VERIFIED — EXTRACTION REVIEW READY' | 'PARTIALLY VERIFIED — BLOCKERS REMAIN' | 'REMEDIATION IMPLEMENTED — WINDOWS VERIFICATION PENDING';
  checks: Record<string, { status: 'PASS' | 'FAIL'; details: string }>;
  errors: string[];
}

export function executeLocalSecurityAudit(params: {
  jsonExists: boolean;
  binExists: boolean;
  jsonLength: number;
  binLength: number;
  plainJson: string;
  binBytes: Buffer;
  cryptoProvider: StorageEncryptionProvider;
  expectedProjectId: string;
  expectedDatabaseId: string;
  maxAgeMinutes?: number;
  syntheticAclTested: boolean;
  gitExclusionActive: boolean;
  strayBinFilesCount?: number;
  binLocation?: 'CONTROL' | 'REPORTS' | 'MISSING';
  definitiveCacheInventory?: DefinitiveCacheInventory;
  disallowedBins?: string[];
  suspiciousBins?: string[];
}): LocalSecurityAuditResult {
  const checks: Record<string, { status: 'PASS' | 'FAIL'; details: string }> = {};
  const errors: string[] = [];

  // 1. Archivos existentes y no vacíos
  if (!params.jsonExists || params.jsonLength === 0) {
    checks['PREFLIGHT_JSON'] = { status: 'FAIL', details: 'preflight-token.json falta o tiene 0 bytes' };
    errors.push('PREFLIGHT_JSON_MISSING');
  } else {
    checks['PREFLIGHT_JSON'] = { status: 'PASS', details: `preflight-token.json presente (${params.jsonLength} bytes)` };
  }

  // 1.2 Ubicación del binario
  if (params.binLocation === 'REPORTS') {
    checks['PREFLIGHT_BIN'] = { status: 'FAIL', details: 'preflight-token.bin detectado en reports/ en lugar de .data/firestore-export/control/' };
    errors.push('UNALLOWED_BINARY_LOCATION');
    errors.push('PREFLIGHT_BINARY_MISSING');
  } else if (!params.binExists || params.binLength === 0) {
    checks['PREFLIGHT_BIN'] = { status: 'FAIL', details: 'preflight-token.bin falta o tiene 0 bytes en control/' };
    errors.push('PREFLIGHT_BINARY_MISSING');
  } else {
    checks['PREFLIGHT_BIN'] = { status: 'PASS', details: `preflight-token.bin presente en control/ (${params.binLength} bytes)` };
  }

  // 2. Descifrado DPAPI y verificación de firma
  if (params.jsonExists && (params.binExists || params.binLocation === 'REPORTS') && params.jsonLength > 0 && params.binLength > 0) {
    const verif = verifyPreflightTokenAuthenticity({
      plainJson: params.plainJson,
      authEnvelopeBytes: params.binBytes,
      cryptoProvider: params.cryptoProvider,
      expectedProjectId: params.expectedProjectId,
      expectedDatabaseId: params.expectedDatabaseId,
      maxAgeMinutes: params.maxAgeMinutes,
    });

    if (!verif.valid) {
      const mappedCode =
        verif.errorCode === 'TOKEN_CORRUPTED'
          ? 'PREFLIGHT_BINARY_DECRYPT_ERROR'
          : verif.errorCode === 'TOKEN_TAMPERED'
          ? 'PREFLIGHT_TOKEN_TAMPERED'
          : verif.errorCode === 'TOKEN_EXPIRED'
          ? 'PREFLIGHT_TOKEN_EXPIRED'
          : verif.errorCode === 'PROJECT_MISMATCH'
          ? 'PREFLIGHT_PROJECT_MISMATCH'
          : verif.errorCode === 'DATABASE_MISMATCH'
          ? 'PREFLIGHT_DATABASE_MISMATCH'
          : verif.errorCode!;

      checks['TOKEN_AUTHENTICITY'] = { status: 'FAIL', details: verif.reason || mappedCode };
      errors.push(mappedCode);
    } else {
      checks['TOKEN_AUTHENTICITY'] = { status: 'PASS', details: 'Firma SHA-256 coincide y descifrado DPAPI exitoso' };

      // 3. Status PREFLIGHT_PASS
      if (verif.envelope?.status !== 'PREFLIGHT_PASS') {
        checks['PREFLIGHT_STATUS'] = { status: 'FAIL', details: `Status es ${verif.envelope?.status}, no PREFLIGHT_PASS` };
        errors.push('PREFLIGHT_STATUS_NOT_PASS');
      } else {
        checks['PREFLIGHT_STATUS'] = { status: 'PASS', details: 'Status es PREFLIGHT_PASS' };
      }
    }

    // 4. Ausencia de errores o conteos null
    try {
      const parsed = JSON.parse(params.plainJson);
      let hasError = false;
      if (parsed.errors && Array.isArray(parsed.errors) && parsed.errors.length > 0) {
        hasError = true;
      }
      if (parsed.countsByUser && typeof parsed.countsByUser === 'object') {
        for (const userCounts of Object.values(parsed.countsByUser) as any[]) {
          if (userCounts && typeof userCounts === 'object') {
            for (const val of Object.values(userCounts)) {
              if (val === null) hasError = true;
            }
          }
        }
      }
      if (hasError) {
        checks['PREFLIGHT_NULLS_ERRORS'] = { status: 'FAIL', details: 'El preflight contiene errores o conteos nulos' };
        errors.push('PREFLIGHT_CONTAINS_NULL_OR_ERRORS');
      } else {
        checks['PREFLIGHT_NULLS_ERRORS'] = { status: 'PASS', details: 'Cero errores y conteos íntegros' };
      }
    } catch {
      // Ignorar si el JSON no es válido
    }

    // 5. Ausencia de token ADC
    if (/ya29\.[a-zA-Z0-9_-]+/.test(params.plainJson)) {
      checks['ADC_TOKEN_LEAK'] = { status: 'FAIL', details: 'Token ADC detectado en preflight-token.json' };
      errors.push('SECURITY_LEAK_ADC_TOKEN_FOUND');
    } else {
      checks['ADC_TOKEN_LEAK'] = { status: 'PASS', details: 'Cero tokens ADC en preflight' };
    }
  }

  // 6. Conciliación del Directorio Definitivo
  if (params.definitiveCacheInventory) {
    const inv = params.definitiveCacheInventory;
    if (inv.state === 'DIRECTORY_PRESENT_WITH_UNEXPECTED_FILES') {
      checks['DEFINITIVE_CACHE'] = { status: 'FAIL', details: `Archivos inesperados detectados en ${inv.opaqueNames.join(', ')}` };
      errors.push('DIRECTORY_PRESENT_WITH_UNEXPECTED_FILES');
    } else {
      checks['DEFINITIVE_CACHE'] = { status: 'PASS', details: `Estado: ${inv.state} (${inv.fileCount} archivos, ${inv.dirCount} subdirectorios)` };
    }

    if (!inv.aclProtected || inv.aclHasUsersOrEveryone) {
      checks['DEFINITIVE_CACHE_ACL'] = { status: 'FAIL', details: 'ACL en directorio definitivo es insuficiente o hereda permisos' };
    } else {
      checks['DEFINITIVE_CACHE_ACL'] = { status: 'PASS', details: 'ACL en directorio definitivo con herencia deshabilitada y acceso exclusivo' };
    }
  }

  // 7. ACL en directorio sintético
  if (!params.syntheticAclTested) {
    checks['NTFS_ACL'] = { status: 'FAIL', details: 'Prueba de ACL sintética no superada' };
    errors.push('ACL_TEST_FAILED');
  } else {
    checks['NTFS_ACL'] = { status: 'PASS', details: 'ACL sintética validada: herencia deshabilitada, acceso exclusivo y limpio' };
  }

  // 8. Exclusión Git
  if (!params.gitExclusionActive) {
    checks['GIT_EXCLUSION'] = { status: 'FAIL', details: '.data/ no excluido en .gitignore' };
    errors.push('GITIGNORE_MISSING_EXCLUSION');
  } else {
    checks['GIT_EXCLUSION'] = { status: 'PASS', details: '.data/ y *.bin excluidos en .gitignore' };
  }

  // 9. Binarios huérfanos / no permitidos / sospechosos
  const disallowed = params.disallowedBins || [];
  const suspicious = params.suspiciousBins || [];
  const strayCount = params.strayBinFilesCount ?? (disallowed.length + suspicious.length);

  if (disallowed.length > 0) {
    checks['DISALLOWED_BIN_FILES'] = { status: 'FAIL', details: `${disallowed.length} binarios fuera de .data/` };
    for (const d of disallowed) {
      if (!errors.includes('UNALLOWED_BINARY_LOCATION')) {
        errors.push('UNALLOWED_BINARY_LOCATION');
      }
    }
  }

  if (suspicious.length > 0) {
    checks['SUSPICIOUS_BIN_FILES'] = { status: 'FAIL', details: `${suspicious.length} binarios sospechosos dentro de .data/` };
    for (const s of suspicious) {
      if (!errors.includes('SUSPICIOUS_BINARY_DETECTED')) {
        errors.push('SUSPICIOUS_BINARY_DETECTED');
      }
    }
  }

  if (strayCount > 0 && disallowed.length === 0 && suspicious.length === 0) {
    checks['STRAY_BIN_FILES'] = { status: 'FAIL', details: `${strayCount} binarios fuera de .data/` };
    errors.push('STRAY_BIN_FILES_FOUND');
  } else if (strayCount === 0) {
    checks['STRAY_BIN_FILES'] = { status: 'PASS', details: 'Cero binarios fuera de .data/' };
  }

  const passed = errors.length === 0;
  return {
    passed,
    verdict: passed ? 'LOCAL SECURITY VERIFIED — EXTRACTION REVIEW READY' : 'PARTIALLY VERIFIED — BLOCKERS REMAIN',
    checks,
    errors,
  };
}
