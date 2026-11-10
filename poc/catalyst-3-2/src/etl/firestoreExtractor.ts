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
