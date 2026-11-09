/**
 * VigorCore — Módulo de Consulta Estructurada y Privacidad Firestore REST (Fase 3.3.1)
 * 
 * Reglas de Arquitectura:
 * 1. Proyección exclusiva de __name__ en StructuredQuery (cero campos de datos sensibles).
 * 2. Paginación determinista basada en cursores startAt { referenceValue, before: false }.
 * 3. Manejo de estados incompletos: nunca registrar 0 si una consulta falla (usar null).
 */

export interface StructuredQueryField {
  fieldPath: string;
}

export interface StructuredQueryOrderBy {
  field: StructuredQueryField;
  direction: 'ASCENDING' | 'DESCENDING';
}

export interface StructuredQueryCursor {
  values: Array<{ referenceValue: string }>;
  before: boolean;
}

export interface StructuredQueryFrom {
  collectionId: string;
  allDescendants?: boolean;
}

export interface StructuredQueryPayload {
  structuredQuery: {
    select: {
      fields: StructuredQueryField[];
    };
    from: StructuredQueryFrom[];
    orderBy: StructuredQueryOrderBy[];
    limit: number;
    startAt?: StructuredQueryCursor;
  };
}

export interface QueryDocumentMetadata {
  name: string;
  createTime?: string;
  updateTime?: string;
}

export interface ParseResult {
  documents: QueryDocumentMetadata[];
  hasMore: boolean;
  nextCursor?: string;
  fieldsLeaked: boolean;
  rawReadTime?: string;
}

export interface CollectionInventoryState {
  collectionId: string;
  path: string;
  level: number;
  documentsEnumerated: number | null;
  hasMore: boolean | null;
  enumerationComplete: boolean;
  error?: {
    statusCode: number;
    message: string;
  };
}

export interface InventoryOverallSummary {
  projectId: string;
  databaseId: string;
  mode: 'Shallow' | 'Deep';
  status: 'COMPLETED_SUCCESS' | 'PARTIAL_FAILURE' | 'FATAL_FAILURE';
  totalCollections: number;
  totalDocumentsEnumerated: number | null;
  partialCollectionsCount: number;
  failedCollectionsCount: number;
  timestamp: string;
}

/**
 * Construye el cuerpo oficial de StructuredQuery con proyección estricta de __name__.
 * Rechaza cualquier nombre reservado inválido (como __none__).
 */
export function buildRunQueryBody(params: {
  collectionId: string;
  limit?: number;
  startAfterDocName?: string;
  allDescendants?: boolean;
}): StructuredQueryPayload {
  const { collectionId, limit = 100, startAfterDocName, allDescendants = false } = params;

  if (!collectionId || collectionId.trim().length === 0) {
    throw new Error('collectionId no puede estar vacío');
  }

  // Validación de seguridad: solo __name__ es un campo reservado válido para proyecciones
  const payload: StructuredQueryPayload = {
    structuredQuery: {
      select: {
        fields: [{ fieldPath: '__name__' }],
      },
      from: [
        {
          collectionId: collectionId.trim(),
          ...(allDescendants ? { allDescendants: true } : {}),
        },
      ],
      orderBy: [
        {
          field: { fieldPath: '__name__' },
          direction: 'ASCENDING',
        },
      ],
      limit: Math.max(1, Math.min(limit, 500)),
    },
  };

  if (startAfterDocName && startAfterDocName.trim().length > 0) {
    payload.structuredQuery.startAt = {
      values: [{ referenceValue: startAfterDocName.trim() }],
      before: false, // before: false significa comenzar inmediatamente DESPUÉS del cursor
    };
  }

  return payload;
}

/**
 * Parsea la respuesta de runQuery garantizando la invariante de privacidad:
 * Comprueba que no existan 'fields' de datos de atletas en ningún documento.
 */
export function parseRunQueryResponse(
  rawItems: any[],
  requestedLimit: number
): ParseResult {
  if (!Array.isArray(rawItems)) {
    return {
      documents: [],
      hasMore: false,
      fieldsLeaked: false,
    };
  }

  const documents: QueryDocumentMetadata[] = [];
  let fieldsLeaked = false;
  let lastReadTime: string | undefined;

  for (const item of rawItems) {
    if (!item) continue;

    if (item.readTime && !item.document) {
      lastReadTime = item.readTime;
      continue;
    }

    if (item.document && typeof item.document.name === 'string') {
      // Invariante de privacidad: si por algún motivo Firestore envió fields, detectarlo
      if (item.document.fields && Object.keys(item.document.fields).length > 0) {
        fieldsLeaked = true;
      }

      documents.push({
        name: item.document.name,
        createTime: item.document.createTime,
        updateTime: item.document.updateTime,
      });
    }
  }

  const hasMore = documents.length >= requestedLimit;
  const nextCursor = hasMore && documents.length > 0 ? documents[documents.length - 1].name : undefined;

  return {
    documents,
    hasMore,
    nextCursor,
    fieldsLeaked,
    rawReadTime: lastReadTime,
  };
}

/**
 * Inicializa o actualiza el estado de una colección respetando la regla:
 * Si hay error, documentsEnumerated DEBE ser null (no 0), y enumerationComplete DEBE ser false.
 */
export function recordCollectionResult(
  collectionId: string,
  path: string,
  level: number,
  result: {
    success: boolean;
    count?: number;
    hasMore?: boolean;
    error?: { statusCode: number; message: string };
  }
): CollectionInventoryState {
  if (!result.success || result.error) {
    return {
      collectionId,
      path,
      level,
      documentsEnumerated: null,
      hasMore: null,
      enumerationComplete: false,
      error: result.error || { statusCode: 500, message: 'Fallo desconocido en consulta' },
    };
  }

  const count = typeof result.count === 'number' ? result.count : 0;
  const hasMore = Boolean(result.hasMore);

  return {
    collectionId,
    path,
    level,
    documentsEnumerated: count,
    hasMore,
    enumerationComplete: !hasMore,
  };
}

/**
 * Calcula el resumen global con clasificación estricta:
 * Si alguna colección falló o quedó incompleta con errores -> PARTIAL_FAILURE.
 */
export function evaluateOverallSummary(params: {
  projectId: string;
  databaseId: string;
  mode: 'Shallow' | 'Deep';
  collectionStates: CollectionInventoryState[];
}): InventoryOverallSummary {
  const { projectId, databaseId, mode, collectionStates } = params;

  let totalDocs: number | null = 0;
  let partialCount = 0;
  let failedCount = 0;

  for (const state of collectionStates) {
    if (state.documentsEnumerated === null || state.error) {
      failedCount++;
      totalDocs = null; // Si una colección falló, el total general no puede ser exacto
    } else {
      if (totalDocs !== null) {
        totalDocs += state.documentsEnumerated;
      }
      if (state.hasMore) {
        partialCount++;
      }
    }
  }

  let status: 'COMPLETED_SUCCESS' | 'PARTIAL_FAILURE' | 'FATAL_FAILURE';
  if (failedCount > 0) {
    status = failedCount === collectionStates.length ? 'FATAL_FAILURE' : 'PARTIAL_FAILURE';
  } else if (partialCount > 0 && mode === 'Deep') {
    status = 'PARTIAL_FAILURE';
  } else {
    status = 'COMPLETED_SUCCESS';
  }

  return {
    projectId,
    databaseId,
    mode,
    status,
    totalCollections: collectionStates.length,
    totalDocumentsEnumerated: totalDocs,
    partialCollectionsCount: partialCount,
    failedCollectionsCount: failedCount,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Enmascara rutas completas de documentos para evitar la exposición de UIDs o seudónimos en Markdown.
 * Ejemplo:
 *   'projects/.../documents/users/usr_12345/workouts/w_987' -> 'users/{id}/workouts/{id}'
 *   'users/usr_12345' -> 'users/{id}'
 */
export function maskResourcePath(fullPath: string): string {
  if (!fullPath) return '';

  // Extraer la ruta relativa a partir del segmento '/documents/' si es un resourceName completo
  const docSegmentIndex = fullPath.indexOf('/documents/');
  const relativePath = docSegmentIndex !== -1 ? fullPath.substring(docSegmentIndex + '/documents/'.length) : fullPath;

  const segments = relativePath.split('/').filter(Boolean);
  if (segments.length === 0) return '';

  const maskedSegments: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (i % 2 === 0) {
      // Colección (ej. 'users', 'workouts')
      maskedSegments.push(segments[i]);
    } else {
      // Document ID (ej. UID del atleta o id de documento) -> anonimizado
      maskedSegments.push('{id}');
    }
  }

  return maskedSegments.join('/');
}

export interface DeepLimits {
  maxRequests: number;
  maxDocuments: number;
  maxDepth: number;
  throttleMs: number;
}

export interface DeepQueueItem {
  collectionId: string;
  parentResourceUrl: string;
  path: string;
  depth: number;
  cursor?: string;
}

export interface DeepCheckpoint {
  executionId: string;
  timestamp: string;
  mode: 'Deep';
  completedCollections: string[];
  completedDocuments: string[];
  pendingQueue: DeepQueueItem[];
  stats: {
    totalRequests: number;
    totalDocuments: number;
    totalSubcollections: number;
  };
  limits: DeepLimits;
  status: 'IN_PROGRESS' | 'PAUSED_LIMIT_REACHED' | 'COMPLETED' | 'FAILED';
  limitReachedReason?: string;
}

/**
 * Verifica si se ha alcanzado algún límite de seguridad durante el recorrido profundo.
 */
export function checkDeepLimits(
  stats: { totalRequests: number; totalDocuments: number; currentDepth: number },
  limits: DeepLimits
): { limitReached: boolean; reason?: string } {
  if (stats.totalRequests >= limits.maxRequests) {
    return {
      limitReached: true,
      reason: `MaxRequests alcanzado (${stats.totalRequests} >= ${limits.maxRequests})`,
    };
  }

  if (stats.totalDocuments >= limits.maxDocuments) {
    return {
      limitReached: true,
      reason: `MaxDocuments alcanzado (${stats.totalDocuments} >= ${limits.maxDocuments})`,
    };
  }

  if (stats.currentDepth > limits.maxDepth) {
    return {
      limitReached: true,
      reason: `MaxDepth alcanzado (${stats.currentDepth} > ${limits.maxDepth})`,
    };
  }

  return { limitReached: false };
}

