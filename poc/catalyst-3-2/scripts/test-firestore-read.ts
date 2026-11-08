import { Firestore } from '@google-cloud/firestore';
import { loadEnvConfig } from '../src/config/env.js';

async function testFirestoreRead() {
  console.log('====================================================');
  console.log(' PRUEBA 8: AUDITORÍA DE LECTURA FIRESTORE (READ-ONLY)');
  console.log('====================================================');

  const env = loadEnvConfig();
  const projectId = env.GCP_PROJECT_ID;
  const databaseId = env.FIRESTORE_DATABASE_ID;
  const docPath = process.env.FIRESTORE_AUDIT_DOC_PATH || '_system_/audit_read_probe';

  console.log(`- Proyecto GCP Objetivo: ${projectId}`);
  console.log(`- Firestore Database ID: ${databaseId}`);
  console.log(`- Documento de Sondeo:   ${docPath}`);
  console.log(`- Modo de Operación:     STRICT READ-ONLY (Cero Escrituras)`);

  let firestore: Firestore;
  try {
    firestore = new Firestore({
      projectId,
      databaseId,
    });
  } catch (initErr) {
    console.error('ERROR AL INICIALIZAR CLIENTE FIRESTORE:', initErr);
    process.exit(1);
  }

  const startTime = performance.now();
  try {
    const docRef = firestore.doc(docPath);
    const snapshot = await docRef.get();
    const durationMs = (performance.now() - startTime).toFixed(2);

    console.log('\n[RESULTADO DEL SONDEO DE LECTURA]:');
    console.log(` - Estado de Autorización: AUTORIZADO (Lectura permitida)`);
    console.log(` - Existencia del Documento: ${snapshot.exists ? 'EXISTE' : 'NO EXISTE (404 pero lectura autorizada)'}`);
    console.log(` - Latencia de Respuesta: ${durationMs} ms`);
    console.log(` - Diagnóstico de Facturación: DATA PLANE ACTIVO (Lecturas gRPC permitidas a pesar de estado de facturación)`);
    console.log('\nVEREDICTO: La base de datos responde a lecturas directas del SDK sin requerir exportación.');
  } catch (err: any) {
    const durationMs = (performance.now() - startTime).toFixed(2);
    const code = err.code ?? 'UNKNOWN';
    const message = err.message ?? '';

    console.log('\n[RESULTADO DEL SONDEO DE LECTURA]:');
    console.log(` - Estado de Autorización: DENEGADO / ERROR`);
    console.log(` - Código de Error gRPC:   ${code}`);
    console.log(` - Latencia de Respuesta:  ${durationMs} ms`);

    // Distinguish error types clearly
    let diagnosis = 'ERROR NO CLASIFICADO';
    if (message.includes('billing') || message.includes('Billing') || message.includes('disabled')) {
      diagnosis = 'BILLING_DISABLED: La API de Cloud Firestore bloquea el tráfico de lectura debido a facturación deshabilitada o cuenta cerrada.';
    } else if (code === 7 || code === 'PERMISSION_DENIED') {
      diagnosis = 'IAM_INSUFFICIENT_OR_RULE_DENIAL: Permisos insuficientes del Service Account o denegación por Security Rules.';
    } else if (code === 16 || code === 'UNAUTHENTICATED') {
      diagnosis = 'UNAUTHENTICATED: Credenciales de Google Cloud ausentes o inválidas en el entorno de ejecución.';
    } else if (code === 5 || code === 'NOT_FOUND') {
      diagnosis = 'DATABASE_NOT_FOUND: La base de datos nombrada no existe o la ruta del proyecto es incorrecta.';
    } else if (code === 14 || code === 'UNAVAILABLE') {
      diagnosis = 'NETWORK_OR_SERVICE_UNAVAILABLE: Error de red o servicio no alcanzable.';
    }

    console.log(` - Diagnóstico Técnico:    ${diagnosis}`);
    console.log(` - Detalle Seguro:         ${message.substring(0, 160)}...`);
  }
}

testFirestoreRead().catch((err) => {
  console.error('Fallo en la ejecución del script:', err);
});
