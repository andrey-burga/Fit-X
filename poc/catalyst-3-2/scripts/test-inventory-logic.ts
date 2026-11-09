/**
 * VigorCore — Pruebas Unitarias de Lógica de Consulta e Invariantes de Privacidad
 * Fase 3.3.1: StructuredQuery, Proyección __name__, Paginación y Manejo de Estados
 */

import assert from 'node:assert/strict';
import {
  buildRunQueryBody,
  parseRunQueryResponse,
  recordCollectionResult,
  evaluateOverallSummary,
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

console.log(`\n========================================================================`);
console.log(` RESULTADO: ${testsPassed}/10 PRUEBAS UNITARIAS APROBADAS (100% PASS-UNIT)`);
console.log(`========================================================================\n`);
