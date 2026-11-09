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

export const CANDIDATE_SUBCOLLECTIONS = [
  'biometrics',
  'groceries',
  'mealLogs',
  'notifications',
  'preferences',
  'workoutSessions',
  'executedWorkouts',
  'cardioSessions',
  'recipes',
  'mealPlans',
  'workoutRoutines',
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

/**
 * Registro de alias determinista para usuarios:
 * Mapea UIDs reales o resource names completos a seudónimos opacos (USER_001, USER_002, ...).
 * Evita imprimir o persistir UIDs en reportes Markdown o consola.
 */
export class UserAliasRegistry {
  private uidToAlias = new Map<string, string>();
  private aliasToUid = new Map<string, string>();

  /**
   * Registra un usuario y le asigna un alias determinista USER_XXX.
   * Si ya existe, retorna el alias existente.
   */
  public register(userResourceNameOrUid: string): string {
    const uid = this.extractUid(userResourceNameOrUid);
    const existing = this.uidToAlias.get(uid);
    if (existing) {
      return existing;
    }

    const index = this.uidToAlias.size + 1;
    const alias = `USER_${String(index).padStart(3, '0')}`;
    this.uidToAlias.set(uid, alias);
    this.aliasToUid.set(alias, uid);
    return alias;
  }

  public getAlias(userResourceNameOrUid: string): string | undefined {
    const uid = this.extractUid(userResourceNameOrUid);
    return this.uidToAlias.get(uid);
  }

  public getUid(alias: string): string | undefined {
    return this.aliasToUid.get(alias);
  }

  public getAllRegistered(): Array<{ uid: string; alias: string }> {
    const list: Array<{ uid: string; alias: string }> = [];
    for (const [uid, alias] of this.uidToAlias.entries()) {
      list.push({ uid, alias });
    }
    return list;
  }

  private extractUid(resourceOrUid: string): string {
    if (!resourceOrUid) return '';
    const match = resourceOrUid.match(/\/documents\/users\/([^/]+)$/);
    if (match) return match[1];
    const slashIndex = resourceOrUid.lastIndexOf('/');
    return slashIndex !== -1 ? resourceOrUid.substring(slashIndex + 1) : resourceOrUid;
  }
}

/**
 * Enmascara una ruta concreta sustituyendo el UID del usuario por su alias y los IDs de documentos por {id}.
 * Ejemplo:
 *   'projects/.../documents/users/usr_ABC123/workouts/w_987' -> 'users/USER_001/workouts/{id}'
 */
export function maskConcretePathWithAlias(concretePath: string, registry: UserAliasRegistry): string {
  if (!concretePath) return '';

  const docSegmentIndex = concretePath.indexOf('/documents/');
  const relPath = docSegmentIndex !== -1 ? concretePath.substring(docSegmentIndex + '/documents/'.length) : concretePath;

  const parts = relPath.split('/').filter(Boolean);
  if (parts.length === 0) return '';

  if (parts[0] === 'users' && parts.length >= 2) {
    const uid = parts[1];
    const alias = registry.getAlias(uid) || 'USER_UNKNOWN';
    const remaining = parts.slice(2);

    const maskedRemaining: string[] = [];
    for (let i = 0; i < remaining.length; i++) {
      if (i % 2 === 0) {
        // Nombre de subcolección (ej. 'biometrics', 'mealLogs')
        maskedRemaining.push(remaining[i]);
      } else {
        // Document ID hijo
        maskedRemaining.push('{id}');
      }
    }

    return ['users', alias, ...maskedRemaining].join('/');
  }

  return maskResourcePath(concretePath);
}

export interface ConcreteDeepQueueItem {
  collectionId: string;
  parentResourceUrl: string;
  concretePath: string; // Ruta real y concreta del padre (ej: 'users/uid1/biometrics')
  depth: number;
  cursor?: string;
  userAlias?: string;
}

/**
 * Motor de Cola BFS para Recorrido Profundo con Deduplicación por Ruta Concreta:
 * Resuelve la causa raíz de la Fase 3.3.5 al garantizar que 'users/UID1/biometrics'
 * y 'users/UID2/biometrics' se traten como instancias completamente separadas.
 */
export class BfsQueueEngine {
  private queue: ConcreteDeepQueueItem[] = [];
  private visitedConcretePaths = new Set<string>();
  private completedConcretePaths = new Set<string>();

  constructor(initialItems: ConcreteDeepQueueItem[] = []) {
    for (const item of initialItems) {
      this.enqueue(item);
    }
  }

  /**
   * Encola una subcolección utilizando su RUTA CONCRETA (nunca la plantilla anonimizada).
   * Retorna true si fue encolada, o false si esa instancia concreta ya fue visitada.
   */
  public enqueue(item: ConcreteDeepQueueItem): boolean {
    const concreteKey = item.concretePath.trim();
    if (this.visitedConcretePaths.has(concreteKey)) {
      return false; // Ya encolada previamente
    }
    this.visitedConcretePaths.add(concreteKey);
    this.queue.push(item);
    return true;
  }

  public dequeue(): ConcreteDeepQueueItem | undefined {
    return this.queue.shift();
  }

  public get pendingCount(): number {
    return this.queue.length;
  }

  public isVisited(concretePath: string): boolean {
    return this.visitedConcretePaths.has(concretePath.trim());
  }

  public markCompleted(concretePath: string): void {
    this.completedConcretePaths.add(concretePath.trim());
  }

  public isCompleted(concretePath: string): boolean {
    return this.completedConcretePaths.has(concretePath.trim());
  }

  public getSnapshotQueue(): ConcreteDeepQueueItem[] {
    return [...this.queue];
  }

  public getVisitedPaths(): string[] {
    return Array.from(this.visitedConcretePaths);
  }

  public getCompletedPaths(): string[] {
    return Array.from(this.completedConcretePaths);
  }
}

export interface UserSubcollectionEntry {
  count: number | null;
  status: 'DISCOVERED' | 'CHECKED_EMPTY' | 'NOT_VERIFIED' | 'FAILED';
  hasMore?: boolean;
}

export type UserSubcollectionMatrix = Record<string, Record<CandidateSubcollection, UserSubcollectionEntry>>;
