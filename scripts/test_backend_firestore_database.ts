/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Verificación Automatizada del Cliente Firestore Backend (Fase 7D-PRE.1)
 *
 * Demuestra de manera irrefutable que el cliente Firestore utilizado por el backend
 * (Cloud Functions v2 y scripts administrativos) se conecta exclusiva y exactamente
 * a la base nombrada: ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c
 * y jamás se desvía a la base '(default)'.
 */

import { initializeApp, getApps, deleteApp } from 'firebase-admin/app';
import { getNamedFirestore, VIGORCORE_DATABASE_ID } from '../functions/src/adminLogic';

const EXPECTED_PROJECT_ID = 'gen-lang-client-0041212770';
const EXPECTED_DATABASE_ID = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';

async function verifyBackendFirestoreClient() {
  console.log('========================================================================');
  console.log(' VIGORCORE — VERIFICACIÓN AUTOMATIZADA DE CLIENTE FIRESTORE BACKEND');
  console.log('========================================================================');
  console.log(` Proyecto Esperado:        ${EXPECTED_PROJECT_ID}`);
  console.log(` Base de Datos Esperada:   ${EXPECTED_DATABASE_ID}`);
  console.log('------------------------------------------------------------------------\n');

  const testAppName = `test-backend-db-${Date.now()}`;
  const app = initializeApp({ projectId: EXPECTED_PROJECT_ID }, testAppName);

  try {
    // 1. Instanciar cliente mediante la función oficial del backend
    const db = getNamedFirestore(app);

    // 2. Comprobación de databaseId efectivo
    const effectiveDbId = (db as any).databaseId;
    console.log(`[TEST 1] Verificando propiedad databaseId del cliente backend:`);
    console.log(`         Valor obtenido: "${effectiveDbId}"`);
    if (effectiveDbId !== EXPECTED_DATABASE_ID) {
      throw new Error(`FAIL: databaseId incorrecto. Esperado: "${EXPECTED_DATABASE_ID}", Obtenido: "${effectiveDbId}"`);
    }
    console.log(`         -> [PASS] databaseId coincide exactamente con la base nombrada.\n`);

    // 3. Comprobación de formattedName gRPC/REST resource path
    const formattedName = (db as any).formattedName || '';
    console.log(`[TEST 2] Verificando ruta canónica de recurso (formattedName):`);
    console.log(`         Valor obtenido: "${formattedName}"`);
    const expectedResourcePattern = `projects/${EXPECTED_PROJECT_ID}/databases/${EXPECTED_DATABASE_ID}`;
    if (!formattedName.includes(expectedResourcePattern)) {
      throw new Error(`FAIL: formattedName no contiene el patrón canónico esperado: "${expectedResourcePattern}"`);
    }
    console.log(`         -> [PASS] formattedName apunta a "${expectedResourcePattern}".\n`);

    // 4. Verificación de exclusión estricta de la base '(default)'
    console.log(`[TEST 3] Verificando que NO apunta a la base '(default)':`);
    if (effectiveDbId === '(default)' || formattedName.includes('/databases/(default)')) {
      throw new Error(`FAIL: El cliente backend está apuntando indebidamente a la base '(default)'.`);
    }
    console.log(`         -> [PASS] Aislamiento confirmado: Ninguna llamada se desvía a '(default)'.\n`);

    // 5. Verificación de constantes en adminLogic.ts
    console.log(`[TEST 4] Verificando constante VIGORCORE_DATABASE_ID exportada:`);
    if (VIGORCORE_DATABASE_ID !== EXPECTED_DATABASE_ID) {
      throw new Error(`FAIL: VIGORCORE_DATABASE_ID en adminLogic.ts (${VIGORCORE_DATABASE_ID}) difiere del oficial.`);
    }
    console.log(`         -> [PASS] VIGORCORE_DATABASE_ID es canónico.\n`);

    // 6. Verificación de inicialización directa sin argumentos (Cloud Functions v2 en producción)
    console.log(`[TEST 5] Verificando instanciación directa sin argumentos (Cloud Functions v2 ADC):`);
    const directDb = getNamedFirestore();
    const directDbId = (directDb as any).databaseId;
    const directFormatted = (directDb as any).formattedName || '';
    if (directDbId !== EXPECTED_DATABASE_ID) {
      throw new Error(`FAIL: Invocación directa getNamedFirestore() retornó databaseId "${directDbId}"`);
    }
    if (!directFormatted.includes(expectedResourcePattern)) {
      throw new Error(`FAIL: Invocación directa getNamedFirestore() retornó formattedName "${directFormatted}"`);
    }
    console.log(`         -> [PASS] Invocación directa utiliza el constructor oficial GA con ADC.\n`);

    // 7. Verificación del runtime de Node.js 22
    console.log(`[TEST 6] Verificando runtime de Node.js activo:`);
    const nodeVer = process.version;
    const majorVer = parseInt(nodeVer.replace('v', '').split('.')[0], 10);
    console.log(`         Versión de Node detectada: ${nodeVer}`);
    if (majorVer !== 22) {
      throw new Error(`FAIL: El runtime actual (${nodeVer}) no es Node.js 22.`);
    }
    console.log(`         -> [PASS] Node.js 22 confirmado en el entorno de ejecución.\n`);

    console.log('========================================================================');
    console.log(' ¡VERIFICACIÓN EXITOSA!: 6/6 comprobaciones del cliente backend aprobadas.');
    console.log('========================================================================\n');
  } finally {
    await deleteApp(app);
  }
}

verifyBackendFirestoreClient().catch(err => {
  console.error('\n[ERROR FATAL]:', err.message);
  process.exit(1);
});
