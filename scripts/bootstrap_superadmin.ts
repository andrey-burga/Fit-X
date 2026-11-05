/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Incremento 7D: Script de Bootstrap Controlado de Superadministrador
 *
 * USO:
 *   npx tsx scripts/bootstrap_superadmin.ts --uid <UID> [--dry-run] [--confirm]
 *
 * REGLAS DE SEGURIDAD:
 *   1. Requiere UID explícito.
 *   2. Verifica existencia en Firebase Authentication.
 *   3. Exige que el correo electrónico esté verificado (email_verified: true).
 *   4. Asigna Custom Claim { role: 'superadmin' }.
 *   5. Es 100% idempotente (si ya es superadmin, no duplica).
 *   6. Conecta a la base con nombre: ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c.
 *   7. Registra evento en adminAuditLogs.
 *   8. Modo --dry-run muestra el plan sin aplicar cambios.
 */

import { initializeApp, getApps, getApp, type App } from 'firebase-admin/app';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import * as path from 'path';
import * as fs from 'fs';

const EXPECTED_PROJECT_ID = 'gen-lang-client-0041212770';
const NAMED_DATABASE_ID = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';

export interface BootstrapOptions {
  uid: string;
  isDryRun: boolean;
  isConfirmed: boolean;
}

export function parseArgs(args: string[]): BootstrapOptions {
  let uid = '';
  let isDryRun = false;
  let isConfirmed = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--uid' && i + 1 < args.length) {
      uid = args[i + 1].trim();
      i++;
    } else if (arg === '--dry-run') {
      isDryRun = true;
    } else if (arg === '--confirm') {
      isConfirmed = true;
    }
  }

  return { uid, isDryRun, isConfirmed };
}

export async function executeSuperadminBootstrap(
  options: BootstrapOptions,
  customApp?: App
): Promise<{ success: boolean; message: string; userSummary?: any }> {
  console.log('========================================================================');
  console.log(' VIGORCORE — BOOTSTRAP DE SUPERADMINISTRADOR (INCREMENTO 7D)');
  console.log('========================================================================');
  console.log(` Proyecto esperado: ${EXPECTED_PROJECT_ID}`);
  console.log(` Base de datos:     ${NAMED_DATABASE_ID}`);
  console.log(` UID objetivo:      ${options.uid || '(no especificado)'}`);
  console.log(` Modo Dry-Run:      ${options.isDryRun ? 'ACTIVADO (Simulación)' : 'Desactivado'}`);
  console.log(` Confirmación:      ${options.isConfirmed ? 'SÍ (--confirm)' : 'NO'}`);
  console.log('------------------------------------------------------------------------\n');

  if (!options.uid) {
    throw new Error('Parámetro obligatorio faltante: Debe proporcionar --uid <UID_DEL_USUARIO>');
  }

  let app = customApp;
  if (!app) {
    if (!getApps().length) {
      app = initializeApp({
        projectId: EXPECTED_PROJECT_ID,
      });
    } else {
      app = getApp();
    }
  }

  const auth = (customApp as any)?.auth ? (customApp as any).auth() : getAuth(app);
  let db: Firestore;
  try {
    db = (customApp as any)?.firestore ? (customApp as any).firestore() : getFirestore(app, NAMED_DATABASE_ID);
  } catch {
    db = (customApp as any)?.firestore ? (customApp as any).firestore() : getFirestore(app);
    (db as any).databaseId = NAMED_DATABASE_ID;
  }

  // 1. Fetch user from Firebase Authentication
  console.log(`[PASO 1/5] Verificando existencia de UID [${options.uid}] en Firebase Authentication...`);
  let userRecord: UserRecord;
  try {
    userRecord = await auth.getUser(options.uid);
  } catch (err: any) {
    throw new Error(`Usuario no encontrado en Firebase Authentication con UID [${options.uid}]: ${err.message}`);
  }

  console.log(`  -> Usuario encontrado:`);
  console.log(`     - Email:          ${userRecord.email || '(sin email)'}`);
  console.log(`     - Nombre:         ${userRecord.displayName || '(sin nombre)'}`);
  console.log(`     - Email Verificado: ${userRecord.emailVerified ? 'SÍ' : 'NO'}`);
  console.log(`     - Deshabilitado:  ${userRecord.disabled ? 'SÍ' : 'NO'}`);
  console.log(`     - Claims actuales: ${JSON.stringify(userRecord.customClaims || {})}`);

  // 2. Strict Security Preconditions
  console.log(`\n[PASO 2/5] Validando precondiciones de seguridad...`);
  if (!userRecord.email) {
    throw new Error('Precondición fallida: La cuenta objetivo no tiene una dirección de correo electrónico.');
  }

  if (!userRecord.emailVerified) {
    throw new Error(
      `Precondición de seguridad fallida: El correo [${userRecord.email}] NO está verificado. ` +
      `Por políticas de seguridad de VigorCore, solo usuarios con correo verificado pueden recibir privilegios de superadministrador.`
    );
  }

  if (userRecord.disabled) {
    throw new Error('Precondición de seguridad fallida: La cuenta se encuentra deshabilitada.');
  }

  const currentRole = userRecord.customClaims?.role;
  const currentClaimsRoleVersion = userRecord.customClaims?.roleVersion;
  if (currentRole === 'superadmin' && typeof currentClaimsRoleVersion === 'number') {
    console.log(`  -> [IDEMPOTENCIA] El usuario ya cuenta con el rol [superadmin] y versión [v${currentClaimsRoleVersion}]. No se requieren modificaciones.`);
    return {
      success: true,
      message: 'Idempotencia: El usuario ya posee privilegios de superadministrador.',
      userSummary: {
        uid: userRecord.uid,
        email: userRecord.email,
        role: 'superadmin',
        roleVersion: currentClaimsRoleVersion,
      },
    };
  }

  // 3. Dry run verification
  if (options.isDryRun) {
    console.log(`\n[PASO 3/5] Simulación (--dry-run) completada con éxito.`);
    console.log(`  -> Se asignarían Custom Claims: { ...currentClaims, role: 'superadmin', roleVersion: 1 }`);
    console.log(`  -> Se crearía o actualizaría adminRoleState/${options.uid} con role: 'superadmin', roleVersion: 1`);
    console.log(`  -> Se crearía o actualizaría adminUserDirectory/${options.uid}`);
    console.log(`  -> Se registraría evento 'superadmin_bootstrapped' en adminAuditLogs.`);
    console.log(`\n[RESULTADO]: Listo para ejecución real. Para aplicar los cambios, ejecute sin --dry-run y con --confirm.`);
    return {
      success: true,
      message: 'Simulación exitosa (--dry-run). No se modificó ningún dato en producción.',
      userSummary: {
        uid: userRecord.uid,
        email: userRecord.email,
        targetRole: 'superadmin',
      },
    };
  }

  // 4. Confirm flag check
  if (!options.isConfirmed) {
    throw new Error('Operación abortada por seguridad: Debe incluir la bandera explícita --confirm para aplicar los cambios.');
  }

  // 5. Apply changes with monotonic roleVersion
  const existingRoleSnap = await db.collection('adminRoleState').doc(options.uid).get();
  const currentVersion = existingRoleSnap.exists
    ? ((existingRoleSnap.data() as any)?.roleVersion || 0)
    : (typeof currentClaimsRoleVersion === 'number' ? currentClaimsRoleVersion : 0);
  const nextVersion = Math.max(1, currentVersion + 1);

  console.log(`\n[PASO 4/5] Aplicando Custom Claim role: 'superadmin', roleVersion: ${nextVersion}...`);
  const updatedClaims = {
    ...(userRecord.customClaims || {}),
    role: 'superadmin',
    roleVersion: nextVersion,
  };
  await auth.setCustomUserClaims(options.uid, updatedClaims);
  console.log('  -> Custom Claims actualizados exitosamente en Firebase Authentication.');

  console.log(`\n[PASO 5/5] Actualizando directorio administrativo, rol autoritativo y registrando auditoría...`);
  const nowIso = new Date().toISOString();
  const nowEpochSeconds = Math.floor(Date.now() / 1000);

  // Authoritative Role State (Anti-Stale-Token)
  await db.collection('adminRoleState').doc(options.uid).set({
    uid: options.uid,
    role: 'superadmin',
    roleVersion: nextVersion,
    updatedAt: nowIso,
    updatedBy: 'bootstrap',
  });

  await db.collection('adminUserDirectory').doc(options.uid).set(
    {
      uid: options.uid,
      email: userRecord.email,
      normalizedEmail: userRecord.email.toLowerCase().trim(),
      displayName: userRecord.displayName || userRecord.email.split('@')[0],
      role: 'superadmin',
      accountStatus: 'active',
      emailVerified: true,
      authProvider: userRecord.providerData[0]?.providerId === 'google.com' ? 'google.com' : 'password',
      createdAt: userRecord.metadata.creationTime || nowIso,
      lastSignInAt: userRecord.metadata.lastSignInTime || nowIso,
      updatedAt: nowIso,
    },
    { merge: true }
  );

  await db.collection('accountAccess').doc(options.uid).set({
    uid: options.uid,
    status: 'active',
    updatedAt: nowIso,
    validAfter: nowEpochSeconds,
  }, { merge: true });

  const eventId = `aud_boot_${Date.now()}`;
  await db.collection('adminAuditLogs').doc(eventId).set({
    eventId,
    action: 'superadmin_bootstrapped',
    actorUid: 'cli_bootstrap',
    actorRole: 'superadmin',
    actorEmail: 'system@vigorcore.cli',
    targetUid: options.uid,
    targetEmail: userRecord.email,
    timestamp: nowIso,
    reason: 'Primer superadministrador inicializado mediante script controlado de bootstrap.',
    changes: {
      before: { role: currentRole || 'athlete' },
      after: { role: 'superadmin' },
    },
  });

  console.log('  -> Estado autoritativo adminRoleState y directorio administrativo actualizados.');
  console.log(`  -> Evento de auditoría registrado con ID: ${eventId}`);
  console.log('\n========================================================================');
  console.log(' ¡SUPERADMINISTRADOR CONFIGURADO CON ÉXITO!');
  console.log('========================================================================\n');

  return {
    success: true,
    message: 'Superadministrador configurado con éxito.',
    userSummary: {
      uid: userRecord.uid,
      email: userRecord.email,
      role: 'superadmin',
    },
  };
}

// Auto-run if executed directly via CLI
if (process.argv[1] && process.argv[1].endsWith('bootstrap_superadmin.ts')) {
  const opts = parseArgs(process.argv.slice(2));
  executeSuperadminBootstrap(opts).catch(err => {
    console.error('\n[ERROR FATAL]:', err.message);
    process.exit(1);
  });
}
