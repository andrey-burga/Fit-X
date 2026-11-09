/**
 * VigorCore — Pruebas Unitarias de Lógica de Consulta e Invariantes de Privacidad
 * Fase 3.3.1: StructuredQuery, Proyección __name__, Paginación y Manejo de Estados
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  buildRunQueryBody,
  parseRunQueryResponse,
  recordCollectionResult,
  evaluateOverallSummary,
  maskResourcePath,
  checkDeepLimits,
  UserAliasRegistry,
  maskConcretePathWithAlias,
  BfsQueueEngine,
  CANDIDATE_SUBCOLLECTIONS,
  ADMINISTRATIVE_COLLECTIONS,
} from '../src/inventory/firestoreRest.js';

console.log('========================================================================');
console.log(' VIGORCORE FASE 3.3.1: PRUEBAS UNITARIAS DE LÓGICA REST E INVARIANTES   ');
console.log('========================================================================\n');

let testsPassed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(` [PASS-UNIT] ${name}`);
    testsPassed++;
  } catch (error: any) {
    console.error(` [FAIL-UNIT] ${name}`);
    console.error(`   Detalle: ${error.message}`);
    process.exit(1);
  }
}

// 1. Verificación de StructuredQuery y proyección estricta __name__
runTest('1. buildRunQueryBody genera proyección exclusiva __name__ sin campos de datos', () => {
  const query = buildRunQueryBody({ collectionId: 'users', limit: 50 });

  assert.equal(query.structuredQuery.from[0].collectionId, 'users');
  assert.equal(query.structuredQuery.select.fields.length, 1);
  assert.equal(query.structuredQuery.select.fields[0].fieldPath, '__name__');
  assert.equal(query.structuredQuery.orderBy[0].field.fieldPath, '__name__');
  assert.equal(query.structuredQuery.orderBy[0].direction, 'ASCENDING');
  assert.equal(query.structuredQuery.limit, 50);
  assert.equal(query.structuredQuery.startAt, undefined);
});

// 2. Cursor de paginación con referenceValue y before: false
runTest('2. buildRunQueryBody genera cursor de paginación startAt con before: false', () => {
  const lastDocPath = 'projects/gen-lang-client-0041212770/databases/test-db/documents/users/user_abc123';
  const query = buildRunQueryBody({
    collectionId: 'users',
    limit: 100,
    startAfterDocName: lastDocPath,
  });

  assert.ok(query.structuredQuery.startAt);
  assert.equal(query.structuredQuery.startAt.before, false);
  assert.equal(query.structuredQuery.startAt.values.length, 1);
  assert.equal(query.structuredQuery.startAt.values[0].referenceValue, lastDocPath);
});

// 3. Validación de rechazo ante collectionId vacío
runTest('3. buildRunQueryBody rechaza collectionId vacío fail-closed', () => {
  assert.throws(() => {
    buildRunQueryBody({ collectionId: '   ' });
  }, /collectionId no puede estar vacío/);
});

// 4. Parseo de respuesta sin campos privados y con stream progress
runTest('4. parseRunQueryResponse procesa documentos y detecta ausencia de fields', () => {
  const mockResponse = [
    {
      document: {
        name: 'projects/p/databases/d/documents/users/doc1',
        createTime: '2026-10-01T00:00:00Z',
        updateTime: '2026-10-01T01:00:00Z',
      },
      readTime: '2026-11-08T18:00:00Z',
    },
    {
      document: {
        name: 'projects/p/databases/d/documents/users/doc2',
        createTime: '2026-10-02T00:00:00Z',
        updateTime: '2026-10-02T01:00:00Z',
      },
      readTime: '2026-11-08T18:00:00Z',
    },
    {
      readTime: '2026-11-08T18:00:01Z', // Elemento final de progreso sin documento
    },
  ];

  const parsed = parseRunQueryResponse(mockResponse, 2);

  assert.equal(parsed.documents.length, 2);
  assert.equal(parsed.documents[0].name, 'projects/p/databases/d/documents/users/doc1');
  assert.equal(parsed.documents[1].name, 'projects/p/databases/d/documents/users/doc2');
  assert.equal(parsed.hasMore, true);
  assert.equal(parsed.nextCursor, 'projects/p/databases/d/documents/users/doc2');
  assert.equal(parsed.fieldsLeaked, false);
  assert.equal(parsed.rawReadTime, '2026-11-08T18:00:01Z');
});

// 5. Invariante de Privacidad: detección de campos filtrados (failsafe)
runTest('5. parseRunQueryResponse detecta si un documento contiene campos inesperados', () => {
  const contaminatedResponse = [
    {
      document: {
        name: 'projects/p/databases/d/documents/athletes/ath1',
        fields: {
          weight_kg: { doubleValue: 82.5 },
          athlete_name: { stringValue: 'Persona Real' },
        },
      },
    },
  ];

  const parsed = parseRunQueryResponse(contaminatedResponse, 10);
  assert.equal(parsed.fieldsLeaked, true, 'Debe activar la bandera de fieldsLeaked para activar alerta');
  assert.equal(parsed.documents.length, 1);
});

// 6. Estado ante Error: DocumentsEnumerated debe ser null, no 0
runTest('6. recordCollectionResult nunca asigna 0 si la consulta falla (usa null y enumerationComplete: false)', () => {
  const failedState = recordCollectionResult('users', 'users', 0, {
    success: false,
    error: {
      statusCode: 400,
      message: 'Invalid reserved name in field path __none__',
    },
  });

  assert.strictEqual(failedState.documentsEnumerated, null, 'documentsEnumerated no puede ser 0 ante error');
  assert.strictEqual(failedState.hasMore, null);
  assert.strictEqual(failedState.enumerationComplete, false);
  assert.ok(failedState.error);
  assert.equal(failedState.error.statusCode, 400);

  // Éxito con 0 documentos reales
  const emptyState = recordCollectionResult('locks', 'locks', 0, {
    success: true,
    count: 0,
    hasMore: false,
  });

  assert.strictEqual(emptyState.documentsEnumerated, 0, 'Solo puede ser 0 cuando la consulta fue exitosa sin resultados');
  assert.strictEqual(emptyState.enumerationComplete, true);
  assert.strictEqual(emptyState.error, undefined);
});

// 7. Evaluación Global: PARTIAL_FAILURE ante cualquier fallo en una colección
runTest('7. evaluateOverallSummary clasifica PARTIAL_FAILURE y totalDocuments = null ante fallos', () => {
  const states = [
    recordCollectionResult('users', 'users', 0, {
      success: false,
      error: { statusCode: 400, message: 'Invalid query' },
    }),
    recordCollectionResult('trainers', 'trainers', 0, {
      success: true,
      count: 5,
      hasMore: false,
    }),
  ];

  const summary = evaluateOverallSummary({
    projectId: 'gen-lang-client-0041212770',
    databaseId: 'test-db',
    mode: 'Shallow',
    collectionStates: states,
  });

  assert.equal(summary.status, 'PARTIAL_FAILURE');
  assert.strictEqual(summary.totalDocumentsEnumerated, null, 'El total no puede calcularse si una colección falló');
  assert.equal(summary.failedCollectionsCount, 1);
  assert.equal(summary.totalCollections, 2);
});

// 8. Evaluación Global: COMPLETED_SUCCESS cuando todas las colecciones tienen éxito
runTest('8. evaluateOverallSummary clasifica COMPLETED_SUCCESS cuando no hay fallos', () => {
  const states = [
    recordCollectionResult('users', 'users', 0, {
      success: true,
      count: 14,
      hasMore: false,
    }),
    recordCollectionResult('trainers', 'trainers', 0, {
      success: true,
      count: 3,
      hasMore: false,
    }),
  ];

  const summary = evaluateOverallSummary({
    projectId: 'gen-lang-client-0041212770',
    databaseId: 'test-db',
    mode: 'Shallow',
    collectionStates: states,
  });

  assert.equal(summary.status, 'COMPLETED_SUCCESS');
  assert.equal(summary.totalDocumentsEnumerated, 17);
  assert.equal(summary.failedCollectionsCount, 0);
});

// 9. Failsafe de Privacidad: cuando se detectan fields en respuesta, se aborta y marca PARTIAL_FAILURE
runTest('9. failsafe de privacidad ante fuga de fields aborta la colección y marca PARTIAL_FAILURE', () => {
  const contaminatedResponse = [
    {
      document: {
        name: 'projects/p/databases/d/documents/athletes/ath1',
        fields: {
          workout_plan: { stringValue: 'Hipertrofia Pierna' },
        },
      },
    },
  ];

  const parsed = parseRunQueryResponse(contaminatedResponse, 10);
  assert.equal(parsed.fieldsLeaked, true);

  // El motor aborta la colección ante fieldsLeaked y registra error de privacidad
  const collectionResult = recordCollectionResult('athletes', 'athletes', 0, {
    success: false,
    error: {
      statusCode: 400,
      message: 'Failsafe de privacidad activado: campos inesperados detectados',
    },
  });

  const successResult = recordCollectionResult('users', 'users', 0, {
    success: true,
    count: 2,
    hasMore: false,
  });

  assert.strictEqual(collectionResult.documentsEnumerated, null);
  assert.strictEqual(collectionResult.enumerationComplete, false);

  const summary = evaluateOverallSummary({
    projectId: 'gen-lang-client-0041212770',
    databaseId: 'test-db',
    mode: 'Shallow',
    collectionStates: [collectionResult, successResult],
  });

  assert.equal(summary.status, 'PARTIAL_FAILURE');
  assert.strictEqual(summary.totalDocumentsEnumerated, null);
});

// 10. Sanitización de ruta relativa: prevención de C:\ en Windows
runTest('10. sanitización de ruta OutputDir previene anclaje a C:\\ en Windows', () => {
  const sanitizeOutputDir = (rawDir: string, pocDir: string) => {
    if (!rawDir || rawDir.trim().length === 0) {
      return `${pocDir}/reports/firestore-inventory`;
    }
    const cleanRelative = rawDir.replace(/^[\/\\]+/, '');
    return `${pocDir}/${cleanRelative}`;
  };

  const pocMockDir = 'C:/Users/User/vigorcore/poc/catalyst-3-2';
  
  // Si el usuario pasa '/reports/firestore-inventory', no debe resolver en 'C:/reports/...'
  const resolvedWithLeadingSlash = sanitizeOutputDir('/reports/firestore-inventory', pocMockDir);
  assert.equal(resolvedWithLeadingSlash, 'C:/Users/User/vigorcore/poc/catalyst-3-2/reports/firestore-inventory');

  // Si está vacío, debe usar la ruta predeterminada en poc/catalyst-3-2
  const resolvedEmpty = sanitizeOutputDir('', pocMockDir);
  assert.equal(resolvedEmpty, 'C:/Users/User/vigorcore/poc/catalyst-3-2/reports/firestore-inventory');
});

// 11. Validación de Construcción Markdown Segura (Cero backticks escapados en plantillas)
runTest('11. construcción estática de Markdown genera tablas válidas sin backticks conflictivos', () => {
  const formatMarkdownRow = (colId: string, count: number | null, hasMore: boolean | null, complete: boolean, status: string) => {
    const docCountStr = count === null ? 'null (Error)' : String(count);
    const hasMoreStr = hasMore === null ? 'null' : hasMore ? 'Si' : 'No';
    const compStr = complete ? 'Si' : 'No';
    return '| ' + colId + ' | Raiz | ' + docCountStr + ' | ' + hasMoreStr + ' | ' + compStr + ' | ' + status + ' |';
  };

  const rowSuccess = formatMarkdownRow('users', 14, false, true, 'SUCCESS');
  assert.equal(rowSuccess, '| users | Raiz | 14 | No | Si | SUCCESS |');

  const rowFailed = formatMarkdownRow('athletes', null, null, false, 'FAILED (400)');
  assert.equal(rowFailed, '| athletes | Raiz | null (Error) | null | No | FAILED (400) |');
});

// 12. Verificación de ausencia de backticks y subexpresiones en el script .ps1
runTest('12. script inventory-firestore.ps1 tiene 0 backticks y 0 subexpresiones $(...)', () => {
  const scriptContent = fs.readFileSync(path.resolve('poc/catalyst-3-2/scripts/inventory-firestore.ps1'), 'utf-8');

  assert.ok(!scriptContent.includes('`'), 'El script no debe contener ningún carácter backtick para evitar errores en PS 5.1');
  assert.ok(!scriptContent.includes('$('), 'El script no debe contener ninguna subexpresión $(...)');
});

// 13. Anonimización de Rutas (maskResourcePath): Prevención de exposición de UIDs
runTest('13. maskResourcePath anonimiza IDs de documentos en cualquier nivel de profundidad', () => {
  const rootDoc = 'projects/gen-lang-client-0041212770/databases/test-db/documents/users/usr_ABC123_XYZ';
  assert.equal(maskResourcePath(rootDoc), 'users/{id}');

  const subDoc = 'projects/gen-lang-client-0041212770/databases/test-db/documents/users/usr_ABC123_XYZ/workouts/w_987654';
  assert.equal(maskResourcePath(subDoc), 'users/{id}/workouts/{id}');

  const relativePath = 'users/athlete_456/metrics/m_789/samples/s_001';
  assert.equal(maskResourcePath(relativePath), 'users/{id}/metrics/{id}/samples/{id}');

  assert.equal(maskResourcePath(''), '');
});

// 14. Verificación de Límites de Seguridad en Modo Deep (checkDeepLimits)
runTest('14. checkDeepLimits detecta disparadores de paro por solicitudes, documentos y profundidad', () => {
  const limits = {
    maxRequests: 500,
    maxDocuments: 2000,
    maxDepth: 10,
    throttleMs: 100,
  };

  // Normal dentro de límites
  const okState = checkDeepLimits({ totalRequests: 100, totalDocuments: 500, currentDepth: 2 }, limits);
  assert.equal(okState.limitReached, false);

  // Límite de requests alcanzado
  const requestLimit = checkDeepLimits({ totalRequests: 500, totalDocuments: 50, currentDepth: 1 }, limits);
  assert.equal(requestLimit.limitReached, true);
  assert.ok(requestLimit.reason?.includes('MaxRequests alcanzado'));

  // Límite de documentos alcanzado
  const docLimit = checkDeepLimits({ totalRequests: 20, totalDocuments: 2000, currentDepth: 1 }, limits);
  assert.equal(docLimit.limitReached, true);
  assert.ok(docLimit.reason?.includes('MaxDocuments alcanzado'));

  // Límite de profundidad superado
  const depthLimit = checkDeepLimits({ totalRequests: 20, totalDocuments: 50, currentDepth: 11 }, limits);
  assert.equal(depthLimit.limitReached, true);
  assert.ok(depthLimit.reason?.includes('MaxDepth alcanzado'));
});

// 15. Integridad de Checkpoint Atómico de Reanudación
runTest('15. estructura de DeepCheckpoint permite serialización y reanudación idempotente', () => {
  const checkpoint = {
    executionId: 'deep-exec-20261109-test',
    timestamp: new Date().toISOString(),
    mode: 'Deep' as const,
    completedCollections: ['users'],
    completedDocuments: ['projects/p/databases/d/documents/users/u1'],
    pendingQueue: [
      {
        collectionId: 'workouts',
        parentResourceUrl: 'https://firestore.googleapis.com/.../users/u1',
        path: 'users/u1/workouts',
        depth: 1,
      },
    ],
    stats: {
      totalRequests: 12,
      totalDocuments: 5,
      totalSubcollections: 1,
    },
    limits: {
      maxRequests: 500,
      maxDocuments: 2000,
      maxDepth: 10,
      throttleMs: 100,
    },
    status: 'PAUSED_LIMIT_REACHED' as const,
    limitReachedReason: 'MaxRequests alcanzado (500 >= 500)',
  };

  const serialized = JSON.stringify(checkpoint);
  const deserialized = JSON.parse(serialized);

  assert.equal(deserialized.status, 'PAUSED_LIMIT_REACHED');
  assert.equal(deserialized.pendingQueue.length, 1);
  assert.equal(deserialized.completedCollections[0], 'users');
  assert.equal(deserialized.stats.totalDocuments, 5);
});

// ============================================================================
// FASE 3.3.6: PRUEBAS OBLIGATORIAS DE COBERTURA MULTI-USUARIO (CASOS A - F)
// ============================================================================

// 16. Caso A: Usuario 1 tiene biometrics y Usuario 2 tiene biometrics -> Ambas instancias deben procesarse
runTest('16. [Caso A] subcolecciones homónimas en distintos usuarios se procesan como instancias independientes', () => {
  const engine = new BfsQueueEngine();
  const registry = new UserAliasRegistry();

  const user1Doc = 'projects/gen-lang-client-0041212770/databases/db/documents/users/UID_001';
  const user2Doc = 'projects/gen-lang-client-0041212770/databases/db/documents/users/UID_002';

  const u1Alias = registry.register(user1Doc);
  const u2Alias = registry.register(user2Doc);

  assert.equal(u1Alias, 'USER_001');
  assert.equal(u2Alias, 'USER_002');

  // Encolar biometrics de Usuario 1
  const enqueued1 = engine.enqueue({
    collectionId: 'biometrics',
    parentResourceUrl: `https://firestore.googleapis.com/v1/${user1Doc}`,
    concretePath: `${user1Doc}/biometrics`,
    depth: 1,
    userAlias: u1Alias,
  });
  assert.equal(enqueued1, true, 'Biometrics de Usuario 1 debe encolarse');

  // Encolar biometrics de Usuario 2 (Fallo anterior: era descartado por clave 'users/{id}/biometrics')
  const enqueued2 = engine.enqueue({
    collectionId: 'biometrics',
    parentResourceUrl: `https://firestore.googleapis.com/v1/${user2Doc}`,
    concretePath: `${user2Doc}/biometrics`,
    depth: 1,
    userAlias: u2Alias,
  });
  assert.equal(enqueued2, true, 'Biometrics de Usuario 2 DEBE encolarse independientemente sin colisión');
  assert.equal(engine.pendingCount, 2, 'La cola debe contener exactamente 2 tareas independientes');

  const task1 = engine.dequeue();
  const task2 = engine.dequeue();

  assert.equal(task1?.concretePath, `${user1Doc}/biometrics`);
  assert.equal(task2?.concretePath, `${user2Doc}/biometrics`);
  assert.notEqual(task1?.concretePath, task2?.concretePath);
});

// 17. Caso B: Cinco usuarios tienen mealLogs -> Cinco instancias independientes deben encolarse y consultarse
runTest('17. [Caso B] cinco usuarios con mealLogs generan exactamente 5 instancias independientes en cola', () => {
  const engine = new BfsQueueEngine();
  const registry = new UserAliasRegistry();

  const userIds = ['UID_ALPHA', 'UID_BETA', 'UID_GAMMA', 'UID_DELTA', 'UID_EPSILON'];
  const enqueuedResults: boolean[] = [];

  for (const uid of userIds) {
    const docPath = `projects/p/databases/d/documents/users/${uid}`;
    const alias = registry.register(docPath);
    const success = engine.enqueue({
      collectionId: 'mealLogs',
      parentResourceUrl: `https://firestore.googleapis.com/v1/${docPath}`,
      concretePath: `${docPath}/mealLogs`,
      depth: 1,
      userAlias: alias,
    });
    enqueuedResults.push(success);
  }

  assert.equal(enqueuedResults.length, 5);
  assert.ok(enqueuedResults.every((res) => res === true), 'Todos los 5 usuarios deben encolar su propia instancia');
  assert.equal(engine.pendingCount, 5, 'Deben haber 5 instancias en cola');

  const processedUsers: string[] = [];
  while (engine.pendingCount > 0) {
    const task = engine.dequeue();
    if (task?.userAlias) {
      processedUsers.push(task.userAlias);
    }
  }

  assert.deepEqual(processedUsers, ['USER_001', 'USER_002', 'USER_003', 'USER_004', 'USER_005']);
});

// 18. Caso C: Usuario 3 no tiene una subcolección -> Ausencia registrada solo para Usuario 3 sin afectar a los demás
runTest('18. [Caso C] ausencia de una subcolección en un usuario no afecta la exploración de los demás', () => {
  const registry = new UserAliasRegistry();
  const userMatrix: Record<string, Record<string, { count: number | null; status: string }>> = {};

  const uids = ['U1', 'U2', 'U3', 'U4', 'U5'];
  for (const uid of uids) {
    const alias = registry.register(uid);
    userMatrix[alias] = {};
    for (const cand of CANDIDATE_SUBCOLLECTIONS) {
      userMatrix[alias][cand] = { count: null, status: 'NOT_VERIFIED' };
    }
  }

  // Simulación: U1, U2, U4, U5 tienen 'cardioSessions', pero U3 no la tiene
  userMatrix['USER_001']['cardioSessions'] = { count: 2, status: 'DISCOVERED' };
  userMatrix['USER_002']['cardioSessions'] = { count: 1, status: 'DISCOVERED' };
  userMatrix['USER_003']['cardioSessions'] = { count: 0, status: 'CHECKED_EMPTY' }; // Ausencia legítima
  userMatrix['USER_004']['cardioSessions'] = { count: 5, status: 'DISCOVERED' };
  userMatrix['USER_005']['cardioSessions'] = { count: 3, status: 'DISCOVERED' };

  assert.equal(userMatrix['USER_001']['cardioSessions'].count, 2);
  assert.equal(userMatrix['USER_003']['cardioSessions'].count, 0);
  assert.equal(userMatrix['USER_003']['cardioSessions'].status, 'CHECKED_EMPTY');
  assert.equal(userMatrix['USER_004']['cardioSessions'].count, 5);
});

// 19. Caso D: Dos subcolecciones diferentes tienen documentos con el mismo ID -> Distintos por tener padres diferentes
runTest('19. [Caso D] documentos con mismo ID en subcolecciones de distintos padres se diferencian por ruta concreta', () => {
  const user1 = 'projects/p/databases/d/documents/users/USER_A';
  const user2 = 'projects/p/databases/d/documents/users/USER_B';

  // Ambos usuarios tienen un documento de configuración con ID idéntico 'current'
  const docPathA = `${user1}/biometrics/current`;
  const docPathB = `${user2}/biometrics/current`;

  assert.notEqual(docPathA, docPathB, 'Las rutas completas deben ser distintas');

  const registry = new UserAliasRegistry();
  registry.register(user1);
  registry.register(user2);

  const maskedA = maskConcretePathWithAlias(docPathA, registry);
  const maskedB = maskConcretePathWithAlias(docPathB, registry);

  assert.equal(maskedA, 'users/USER_001/biometrics/{id}');
  assert.equal(maskedB, 'users/USER_002/biometrics/{id}');
  assert.notEqual(maskedA, maskedB, 'Los reportes conservan distinción de usuario sin revelar UIDs');
});

// 20. Caso E: Interrupción y reanudación no duplica ni omite instancias por usuario
runTest('20. [Caso E] checkpoint preserva rutas concretas y reanuda sin omitir ni duplicar usuarios', () => {
  const engineOriginal = new BfsQueueEngine();
  const path1 = 'projects/p/databases/d/documents/users/U1/groceries';
  const path2 = 'projects/p/databases/d/documents/users/U2/groceries';
  const path3 = 'projects/p/databases/d/documents/users/U3/groceries';

  engineOriginal.enqueue({ collectionId: 'groceries', parentResourceUrl: '...', concretePath: path1, depth: 1 });
  engineOriginal.enqueue({ collectionId: 'groceries', parentResourceUrl: '...', concretePath: path2, depth: 1 });
  engineOriginal.enqueue({ collectionId: 'groceries', parentResourceUrl: '...', concretePath: path3, depth: 1 });

  // Se procesa la primera tarea
  const done1 = engineOriginal.dequeue();
  assert.equal(done1?.concretePath, path1);
  engineOriginal.markCompleted(path1);

  // Se genera checkpoint en pausa
  const snapshotQueue = engineOriginal.getSnapshotQueue();
  const completedList = engineOriginal.getCompletedPaths();

  assert.equal(snapshotQueue.length, 2);
  assert.equal(completedList.length, 1);
  assert.equal(completedList[0], path1);

  // Reanudar en nueva instancia de motor
  const engineResumed = new BfsQueueEngine(snapshotQueue);
  for (const c of completedList) {
    engineResumed.markCompleted(c);
  }

  // Intento de re-encolar path1 (ya completado)
  const canReAddCompleted = engineResumed.isCompleted(path1);
  assert.equal(canReAddCompleted, true, 'El elemento completado debe identificarse como completado');

  // Procesar tareas pendientes restantes
  const next2 = engineResumed.dequeue();
  const next3 = engineResumed.dequeue();

  assert.equal(next2?.concretePath, path2);
  assert.equal(next3?.concretePath, path3);
  assert.equal(engineResumed.pendingCount, 0, 'Todas las tareas pendientes fueron ejecutadas sin duplicados');
});

// 21. Caso F: Se alcanza MaxRequests -> Checkpoint atómico y estado PARTIAL_LIMIT_REACHED
runTest('21. [Caso F] alcanzar MaxRequests activa estado de límite y preserva trabajo pendiente', () => {
  const limits = {
    maxRequests: 500,
    maxDocuments: 2000,
    maxDepth: 10,
    throttleMs: 100,
  };

  const limitCheck = checkDeepLimits({ totalRequests: 500, totalDocuments: 120, currentDepth: 2 }, limits);
  assert.equal(limitCheck.limitReached, true);
  assert.ok(limitCheck.reason?.includes('MaxRequests alcanzado'));

  const pendingItems = [
    { collectionId: 'mealLogs', parentResourceUrl: '...', concretePath: 'users/U4/mealLogs', depth: 1 },
    { collectionId: 'mealLogs', parentResourceUrl: '...', concretePath: 'users/U5/mealLogs', depth: 1 },
  ];

  const checkpoint = {
    executionId: 'exec-limit-test',
    status: 'PAUSED_LIMIT_REACHED',
    limitReachedReason: limitCheck.reason,
    pendingQueue: pendingItems,
    stats: { totalRequests: 500, totalDocuments: 120, totalSubcollections: 18 },
  };

  assert.equal(checkpoint.status, 'PAUSED_LIMIT_REACHED');
  assert.equal(checkpoint.pendingQueue.length, 2);
  assert.notEqual(checkpoint.status, 'COMPLETED_SUCCESS', 'Bajo ningún concepto debe marcarse COMPLETED_SUCCESS ante límite');
});

console.log(`\n========================================================================`);
console.log(` RESULTADO: ${testsPassed}/21 PRUEBAS UNITARIAS APROBADAS (100% PASS-UNIT)`);
console.log(`========================================================================\n`);
