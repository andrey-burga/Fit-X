import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth } from 'google-auth-library';
import { loadEnvConfig } from '../src/config/env.js';

async function testFirestoreRead() {
  console.log('================================================================');
  console.log(' AUDITORÍA FIRESTORE READ-ONLY CON APPLICATION DEFAULT CREDENTIALS');
  console.log('================================================================');

  const env = loadEnvConfig();
  const projectId = env.GCP_PROJECT_ID || 'gen-lang-client-0041212770';
  const databaseId = env.FIRESTORE_DATABASE_ID || 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
  const docPath = process.env.FIRESTORE_AUDIT_DOC_PATH || '_system_/audit_read_probe';

  console.log(`- Proyecto GCP Objetivo:   ${projectId}`);
  console.log(`- Firestore Database ID:   ${databaseId}`);
  console.log(`- Documento de Sondeo:     ${docPath}`);
  console.log(`- Modo de Operación:       STRICT READ-ONLY (Cero Escrituras / Cero Mutaciones)`);

  // Inspect Application Default Credentials (ADC) without requiring a JSON file
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/datastore'],
  });

  let adcType = 'UNKNOWN';
  let authenticatedIdentity = 'No disponible';

  try {
    const client = await auth.getClient();
    adcType = client.constructor.name;

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.log(`- Fuente ADC Detectada:    Archivo GOOGLE_APPLICATION_CREDENTIALS`);
    } else if (adcType === 'UserRefreshClient' || adcType === 'OAuth2Client') {
      console.log(`- Fuente ADC Detectada:    gcloud auth application-default login (Credencial de Usuario OAuth)`);
    } else if (adcType === 'Compute') {
      console.log(`- Fuente ADC Detectada:    Servidor de Metadatos / Compute Engine / Cloud Run`);
    } else {
      console.log(`- Fuente ADC Detectada:    ${adcType}`);
    }

    if ('email' in client && (client as any).email) {
      authenticatedIdentity = (client as any).email;
    } else {
      const defaultProj = await auth.getProjectId().catch(() => 'desconocido');
      authenticatedIdentity = `Principal asociado al entorno [proyecto default: ${defaultProj}] (${adcType})`;
    }
    console.log(`- Identidad Autenticada:   ${authenticatedIdentity}`);
  } catch (authErr: any) {
    console.log(`- Fuente ADC Detectada:    ERROR AL RESOLVER ADC (${authErr.message})`);
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
    console.log(` - Estado de Autorización:    AUTORIZADO (Lectura concedida mediante IAM de Google Cloud)`);
    console.log(` - Existencia del Documento:  ${snapshot.exists ? 'DOCUMENTO EXISTE' : 'NO EXISTE (404 pero lectura fue autorizada por IAM)'}`);
    console.log(` - Latencia de Respuesta:     ${durationMs} ms`);
    console.log(` - Diagnóstico de Conexión:   DATA PLANE ACTIVO (Llamada gRPC completada con éxito)`);
    console.log('\nVEREDICTO: La base de datos nombrada responde a lecturas directas del SDK sin requerir exportación.');
  } catch (err: any) {
    const durationMs = (performance.now() - startTime).toFixed(2);
    const code = err.code ?? 'UNKNOWN';
    const message = err.message ?? '';
    const details = err.details ?? '';
    const metadata = err.metadata ? err.metadata.getMap() : {};

    console.log('\n[RESULTADO DEL SONDEO DE LECTURA]:');
    console.log(` - Estado de Autorización:    DENEGADO / ERROR`);
    console.log(` - Código de Error gRPC:      ${code}`);
    console.log(` - Detalles gRPC:             ${details}`);
    console.log(` - Latencia de Respuesta:     ${durationMs} ms`);
    if (metadata['x-debug-tracking-id']) {
      console.log(` - Tracking ID de Google:     ${metadata['x-debug-tracking-id']}`);
    }

    // Distinguish classifications accurately without jumping to unproven conclusions
    let diagnosis = 'ERROR_NO_CLASIFICADO';
    let technicalAnalysis = '';

    const lowerMsg = message.toLowerCase();
    const lowerDetails = typeof details === 'string' ? details.toLowerCase() : '';

    if (lowerMsg.includes('billing') || lowerDetails.includes('billing') || lowerMsg.includes('account has been closed')) {
      diagnosis = 'BILLING_DISABLED';
      technicalAnalysis = 'La respuesta de Google Cloud contiene evidencia explícita de bloqueo por facturación deshabilitada o cuenta cerrada.';
    } else if (lowerMsg.includes('api has not been used') || lowerMsg.includes('has not been enabled')) {
      diagnosis = 'API_DISABLED';
      technicalAnalysis = 'La API de Cloud Firestore / Cloud Datastore no se encuentra habilitada en el proyecto de destino.';
    } else if (code === 5 || code === 'NOT_FOUND' || lowerMsg.includes('database was not found') || lowerDetails.includes('not found')) {
      diagnosis = 'DATABASE_NOT_FOUND';
      technicalAnalysis = 'La base de datos nombrada no existe en el proyecto especificado o el Project ID es incorrecto.';
    } else if (code === 16 || code === 'UNAUTHENTICATED') {
      diagnosis = 'UNAUTHENTICATED';
      technicalAnalysis = 'No se proporcionaron credenciales válidas en Application Default Credentials (ADC).';
    } else if (code === 7 || code === 'PERMISSION_DENIED') {
      diagnosis = 'PERMISSION_DENIED';
      technicalAnalysis = 'El servidor gRPC rechazó la petición por falta de autorización. ' +
        'Causas posibles bajo investigación: ' +
        '(a) La identidad ADC que emite la llamada no coincide con la identidad autorizada en IAM del proyecto destino; ' +
        '(b) Desajuste de quota_project_id en ADC frente al proyecto del recurso; ' +
        '(c) Restricción de organización, VPC Service Controls o política de seguridad; ' +
        '(d) Ausencia de permiso datastore.entities.get para la identidad efectiva.';
    } else if (code === 14 || code === 'UNAVAILABLE' || code === 4 || code === 'DEADLINE_EXCEEDED') {
      diagnosis = 'NETWORK_OR_SERVICE_UNAVAILABLE';
      technicalAnalysis = 'Error de conectividad de red o indisponibilidad temporal del endpoint gRPC de Google Cloud.';
    } else {
      diagnosis = 'ERROR_NO_CLASIFICADO';
      technicalAnalysis = `Error gRPC no catalogado: ${message}`;
    }

    console.log(` - Clasificación Diagnóstica: [${diagnosis}]`);
    console.log(` - Análisis Técnico:          ${technicalAnalysis}`);
    console.log(` - Mensaje Sanitizado:        ${message.substring(0, 160)}...`);
  }
}

testFirestoreRead().catch((err) => {
  console.error('Fallo no controlado en la ejecución del script:', err);
});
