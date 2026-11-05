/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Incremento 7D: Script de Migración y Backfill de Directorio
 *
 * USO:
 *   npx tsx scripts/migrate_existing_users.ts [--dry-run] [--confirm]
 *
 * CARACTERÍSTICAS:
 *   - Lee usuarios existentes desde Firebase Auth.
 *   - Valida duplicados y correos normalizados.
 *   - Asigna rol predeterminado 'athlete' si no posee rol en Custom Claims.
 *   - Pobla adminUserDirectory/{uid} y accountAccess/{uid}.
 *   - Conserva perfiles existentes en users/{uid} y todas sus subcolecciones intactas.
 *   - Modo --dry-run activo por defecto para máxima seguridad.
 */

import { initializeApp, getApps, getApp, type App } from 'firebase-admin/app';
import { getAuth, type ListUsersResult } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const EXPECTED_PROJECT_ID = 'gen-lang-client-0041212770';
const NAMED_DATABASE_ID = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';

export interface MigrationOptions {
  isDryRun: boolean;
  isConfirmed: boolean;
}

export function parseArgs(args: string[]): MigrationOptions {
  let isDryRun = true;
  let isConfirmed = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--no-dry-run') {
      isDryRun = false;
    } else if (arg === '--dry-run') {
      isDryRun = true;
    } else if (arg === '--confirm') {
      isConfirmed = true;
    }
  }

  return { isDryRun, isConfirmed };
}

export async function executeUserMigration(
  options: MigrationOptions,
  customApp?: App
): Promise<{ processed: number; backfilled: number; duplicatesFound: number }> {
  console.log('========================================================================');
  console.log(' VIGORCORE — MIGRACIÓN Y BACKFILL DE DIRECTORIO (INCREMENTO 7D)');
  console.log('========================================================================');
  console.log(` Proyecto:     ${EXPECTED_PROJECT_ID}`);
  console.log(` Base de datos: ${NAMED_DATABASE_ID}`);
  console.log(` Modo Dry-Run: ${options.isDryRun ? 'ACTIVADO (Solo Lectura)' : 'DESACTIVADO'}`);
  console.log(` Confirmación: ${options.isConfirmed ? 'SÍ' : 'NO'}`);
  console.log('------------------------------------------------------------------------\n');

  let app = customApp;
  if (!app) {
    if (!getApps().length) {
      app = initializeApp({ projectId: EXPECTED_PROJECT_ID });
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

  let processed = 0;
  let backfilled = 0;
  let duplicatesFound = 0;
  const seenEmails = new Set<string>();

  let nextPageToken: string | undefined = undefined;

  do {
    const listResult: ListUsersResult = await auth.listUsers(100, nextPageToken);
    for (const user of listResult.users) {
      processed++;
      const normEmail = (user.email || '').toLowerCase().trim();
      if (normEmail && seenEmails.has(normEmail)) {
        console.warn(`  [ALERTA DUPLICADO] Correo ${normEmail} detectado en múltiples cuentas (UID: ${user.uid}).`);
        duplicatesFound++;
      } else if (normEmail) {
        seenEmails.add(normEmail);
      }

      const currentClaims = user.customClaims || {};
      const role = currentClaims.role || 'athlete';
      const status = user.disabled ? 'suspended' : (!user.emailVerified ? 'pending_verification' : 'active');

      console.log(`  -> Procesando UID [${user.uid}] (${user.email || 'sin email'}): Rol=${role}, Estado=${status}`);

      if (!options.isDryRun && options.isConfirmed) {
        // Apply backfill
        const nowIso = new Date().toISOString();
        const nowEpochSeconds = Math.floor(Date.now() / 1000);

        // Check if adminRoleState already exists to preserve previous version
        const existingRoleDoc = await db.collection('adminRoleState').doc(user.uid).get();
        const existingRoleData = existingRoleDoc.exists ? existingRoleDoc.data() : null;
        const assignedRole = existingRoleData?.role || role;
        const assignedVersion = existingRoleData?.roleVersion || (typeof currentClaims.roleVersion === 'number' ? currentClaims.roleVersion : 1);

        // Ensure claims include roleVersion for administrative roles
        if ((assignedRole === 'admin' || assignedRole === 'superadmin') && typeof currentClaims.roleVersion !== 'number') {
          await auth.setCustomUserClaims(user.uid, {
            ...currentClaims,
            role: assignedRole,
            roleVersion: assignedVersion,
          });
        }

        await db.collection('adminUserDirectory').doc(user.uid).set(
          {
            uid: user.uid,
            email: user.email || '',
            normalizedEmail: normEmail,
            displayName: user.displayName || user.email?.split('@')[0] || 'Atleta Vigor',
            role: assignedRole,
            accountStatus: status,
            emailVerified: Boolean(user.emailVerified),
            authProvider: user.providerData[0]?.providerId === 'google.com' ? 'google.com' : 'password',
            createdAt: user.metadata.creationTime || nowIso,
            lastSignInAt: user.metadata.lastSignInTime || undefined,
            updatedAt: nowIso,
          },
          { merge: true }
        );

        await db.collection('adminRoleState').doc(user.uid).set(
          {
            uid: user.uid,
            role: assignedRole,
            roleVersion: assignedVersion,
            updatedAt: nowIso,
            updatedBy: 'migration',
          },
          { merge: true }
        );

        await db.collection('accountAccess').doc(user.uid).set(
          {
            uid: user.uid,
            status: user.disabled ? 'suspended' : 'active',
            updatedAt: nowIso,
            validAfter: nowEpochSeconds,
          },
          { merge: true }
        );

        backfilled++;
      }
    }
    nextPageToken = listResult.pageToken;
  } while (nextPageToken);

  console.log('\n------------------------------------------------------------------------');
  console.log(` Total usuarios analizados: ${processed}`);
  console.log(` Registros backfilled:       ${options.isDryRun ? '0 (Simulado)' : backfilled}`);
  console.log(` Duplicados de email:        ${duplicatesFound}`);
  console.log('========================================================================\n');

  return { processed, backfilled, duplicatesFound };
}

if (process.argv[1] && process.argv[1].endsWith('migrate_existing_users.ts')) {
  const opts = parseArgs(process.argv.slice(2));
  executeUserMigration(opts).catch(err => {
    console.error('\n[ERROR FATAL]:', err.message);
    process.exit(1);
  });
}
