import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth } from 'google-auth-library';
import { loadEnvConfig } from '../src/config/env.js';

async function testFirestoreRead() {
  console.log('================================================================');
  console.log(' PRUEBA 9: AUDITORÍA DE LECTURA FIRESTORE Y ADC (READ-ONLY)     ');
  console.log('================================================================');

  const env = loadEnvConfig();
  const projectId = env.GCP_PROJECT_ID;
  const databaseId = env.FIRESTORE_DATABASE_ID;
  const docPath = process.env.FIRESTORE_AUDIT_DOC_PATH || '_system_/audit_read_probe';

  console.log(`- Proyecto GCP Objetivo:   ${projectId}`);
  console.log(`- Firestore Database ID:   ${databaseId}`);
  console.log(`- Documento de Sondeo:     ${docPath}`);
  console.log(`- Modo de Operación:       STRICT READ-ONLY (Cero Escrituras / Cero Mutaciones)`);

  // Inspect Application Default Credentials (ADC) source
  const auth = new GoogleAuth();
  let adcType = 'UNKNOWN';
  let authenticatedIdentity = 'No disponible';

  try {
    const client = await auth.getClient();
    adcType = client.constructor.name;

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.log(`- Fuente ADC Detectada:    Archivo GOOGLE_APPLICATION_CREDENTIALS (${process.env.GOOGLE_APPLICATION_CREDENTIALS})`);
    } else if (adcType === 'UserRefreshClient' || adcType === 'OAuth2Client') {
      console.log(`- Fuente ADC Detectada:    gcloud auth application-default login (Credencial de Usuario OAuth)`);
    } else if (adcType === 'Compute') {
      console.log(`- Fuente ADC Detectada:    Servidor de Metadatos / Compute Engine / Cloud Run (Entorno Local Containerizado)`);
    } else {
      console.log(`- Fuente ADC Detectada:    ${adcType}`);
    }

    if ('email' in client && (client as any).email) {
      authenticatedIdentity = (client as any).email;
    } else {
      const defaultProj = await auth.getProjectId().catch(() => 'no-default-project');
      authenticatedIdentity = `Principal asociado a proyecto default [${defaultProj}] (${adcType})`;
    }
    console.log(`- Identidad Autenticada:   ${authenticatedIdentity}`);
  } catch (authErr: any) {
    console.log(`- Fuente ADC Detectada:    NINGUNA (Error al resolver credenciales: ${authErr.message})`);
  }

  let firestore: Firestore;
  try {
    firestore = new Firestore({
      projectId,
      databaseId,
    });
  } catch (initErr: any) {
    console.error('ERROR AL INICIALIZAR CLIENTE FIRESTORE:', initErr.message);
    process.exit(1);
  }

  const startTime = performance.now();
  try {
    const docRef = firestore.doc(docPath);
    const snapshot = await docRef.get();
    const durationMs = (performance.now() - startTime).toFixed(2);

    console.log('\n[RESULTADO DEL SONDEO DE LECTURA]:');
    console.log(` - Estado de Autorización:    AUTORIZADO (Lectura concedida por IAM y Security Rules)`);
    console.log(` - Existencia del Documento:  ${snapshot.exists ? 'DOCUMENTO EXISTE' : 'NO EXISTE (404 pero lectura fue autorizada)'}`);
    console.log(` - Latencia de Respuesta:     ${durationMs} ms`);
    console.log(` - Diagnóstico de Facturación: DATA PLANE ACTIVO (Lecturas gRPC permitidas a pesar de estado de facturación)`);
    console.log('\nVEREDICTO: La base de datos nombrada responde a lecturas directas del SDK sin requerir exportación.');
  } catch (err: any) {
    const durationMs = (performance.now() - startTime).toFixed(2);
    const code = err.code ?? 'UNKNOWN';
    const message = err.message ?? '';

    console.log('\n[RESULTADO DEL SONDEO DE LECTURA]:');
    console.log(` - Estado de Autorización:    DENEGADO / ERROR`);
    console.log(` - Código de Error gRPC:      ${code}`);
    console.log(` - Latencia de Respuesta:     ${durationMs} ms`);

    // Distinguish all 7 error categories strictly
    let diagnosis = 'ERROR_NO_CLASIFICADO';
    let explanation = '';

    if (message.toLowerCase().includes('billing') || message.includes('Billing') || message.includes('account has been closed')) {
      diagnosis = 'BILLING_DISABLED';
      explanation = 'La API de Cloud Firestore bloquea el tráfico de lectura debido a facturación deshabilitada o cuenta de facturación cerrada.';
    } else if (message.includes('API has not been used') || message.includes('has not been enabled')) {
      diagnosis = 'API_DISABLED';
      explanation = 'La API de Cloud Firestore / Cloud Datastore no está habilitada en el proyecto destino.';
    } else if (code === 5 || code === 'NOT_FOUND' || message.includes('database was not found')) {
      diagnosis = 'DATABASE_NOT_FOUND';
      explanation = 'La base de datos nombrada ai-studio-vigorcore-... no existe o el Project ID es incorrecto.';
    } else if (code === 16 || code === 'UNAUTHENTICATED') {
      diagnosis = 'UNAUTHENTICATED';
      explanation = 'No se proporcionaron credenciales válidas en ADC ni Service Account Key.';
    } else if (code === 7 || code === 'PERMISSION_DENIED') {
      diagnosis = 'PERMISSION_DENIED';
      explanation = 'La identidad autenticada no posee el rol IAM roles/datastore.viewer (permiso datastore.entities.get) sobre el proyecto gen-lang-client-0041212770.';
    } else if (code === 14 || code === 'UNAVAILABLE' || code === 4 || code === 'DEADLINE_EXCEEDED') {
      diagnosis = 'NETWORK_OR_SERVICE_UNAVAILABLE';
      explanation = 'Error transitorio de red o servicio de Google Cloud temporalmente inalcanzable.';
    }

    console.log(` - Clasificación Diagnóstica: [${diagnosis}]`);
    console.log(` - Causa Técnica:             ${explanation}`);
    console.log(` - Detalle Seguro:            ${message.substring(0, 160)}...`);
  }
}

testFirestoreRead().catch((err) => {
  console.error('Fallo no controlado en la ejecución del script:', err);
});
