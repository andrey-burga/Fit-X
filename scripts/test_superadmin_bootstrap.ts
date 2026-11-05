/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Suite de Pruebas Automatizadas:
 * Validación del Script de Bootstrap de Superadministrador (scripts/bootstrap_superadmin.ts)
 */

import { executeSuperadminBootstrap } from './bootstrap_superadmin';

async function runBootstrapTests() {
  console.log('========================================================================');
  console.log(' VIGORCORE — SUITE: BOOTSTRAP DE SUPERADMINISTRADOR');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(desc: string, condition: boolean, errorDetail?: string) {
    if (condition) {
      console.log(`  [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${desc} -> ${errorDetail || 'Condición no cumplida'}`);
      failed++;
    }
  }

  const memoryDb: Record<string, Record<string, any>> = {
    adminUserDirectory: {},
    accountAccess: {},
    adminAuditLogs: {},
    adminRoleState: {},
  };

  const fakeFirestore: any = {
    collection: (colName: string) => ({
      doc: (docId: string) => ({
        get: async () => ({
          exists: !!memoryDb[colName]?.[docId],
          data: () => memoryDb[colName]?.[docId],
        }),
        set: async (data: any, options?: any) => {
          if (!memoryDb[colName]) memoryDb[colName] = {};
          if (options?.merge && memoryDb[colName][docId]) {
            memoryDb[colName][docId] = { ...memoryDb[colName][docId], ...data };
          } else {
            memoryDb[colName][docId] = data;
          }
        },
      }),
    }),
  };

  const fakeAuthUsers: Record<string, any> = {
    unverified_uid: {
      uid: 'unverified_uid',
      email: 'owner_unverified@vigorcore.com',
      emailVerified: false,
      disabled: false,
      customClaims: {},
      providerData: [{ providerId: 'password' }],
      metadata: {},
    },
    disabled_uid: {
      uid: 'disabled_uid',
      email: 'owner_disabled@vigorcore.com',
      emailVerified: true,
      disabled: true,
      customClaims: {},
      providerData: [{ providerId: 'password' }],
      metadata: {},
    },
    valid_candidate_uid: {
      uid: 'valid_candidate_uid',
      email: 'propietario@vigorcore.com',
      displayName: 'Propietario VigorCore',
      emailVerified: true,
      disabled: false,
      customClaims: {},
      providerData: [{ providerId: 'google.com' }],
      metadata: {},
    },
  };

  const fakeCustomApp: any = {
    firestore: () => fakeFirestore,
  };

  (fakeCustomApp as any).auth = () => ({
    getUser: async (uid: string) => {
      const u = fakeAuthUsers[uid];
      if (!u) throw new Error(`User not found: ${uid}`);
      return u;
    },
    setCustomUserClaims: async (uid: string, claims: any) => {
      fakeAuthUsers[uid].customClaims = claims;
    },
  });

  // 1. Missing UID
  let missingUidError = false;
  try {
    await executeSuperadminBootstrap({ uid: '', isDryRun: false, isConfirmed: false }, fakeCustomApp);
  } catch (err: any) {
    if (err.message.includes('Parámetro obligatorio faltante')) missingUidError = true;
  }
  assert('BS.1 Falla si no se especifica --uid explícito', missingUidError);

  // 2. User not found
  let notFoundError = false;
  try {
    await executeSuperadminBootstrap({ uid: 'non_existent_uid', isDryRun: false, isConfirmed: false }, fakeCustomApp);
  } catch (err: any) {
    if (err.message.includes('Usuario no encontrado')) notFoundError = true;
  }
  assert('BS.2 Falla si el UID no existe en Firebase Authentication', notFoundError);

  // 3. Email unverified
  let unverifiedError = false;
  try {
    await executeSuperadminBootstrap({ uid: 'unverified_uid', isDryRun: false, isConfirmed: false }, fakeCustomApp);
  } catch (err: any) {
    if (err.message.includes('NO está verificado')) unverifiedError = true;
  }
  assert('BS.3 Falla si el correo electrónico de la cuenta no está verificado', unverifiedError);

  // 4. Account disabled
  let disabledError = false;
  try {
    await executeSuperadminBootstrap({ uid: 'disabled_uid', isDryRun: false, isConfirmed: false }, fakeCustomApp);
  } catch (err: any) {
    if (err.message.includes('se encuentra deshabilitada')) disabledError = true;
  }
  assert('BS.4 Falla si la cuenta objetivo se encuentra deshabilitada', disabledError);

  // 5. Dry run simulation (no changes applied)
  const dryRunRes = await executeSuperadminBootstrap(
    { uid: 'valid_candidate_uid', isDryRun: true, isConfirmed: false },
    fakeCustomApp
  );
  assert('BS.5 Modo --dry-run valida precondiciones sin modificar datos', dryRunRes.success && dryRunRes.message.includes('Simulación exitosa'));
  assert('BS.6 Claims no se alteran en dry-run', fakeAuthUsers['valid_candidate_uid'].customClaims.role === undefined);

  // 6. Missing confirm flag
  let missingConfirmError = false;
  try {
    await executeSuperadminBootstrap({ uid: 'valid_candidate_uid', isDryRun: false, isConfirmed: false }, fakeCustomApp);
  } catch (err: any) {
    if (err.message.includes('--confirm')) missingConfirmError = true;
  }
  assert('BS.7 Exige bandera explícita --confirm para aplicar los cambios', missingConfirmError);

  // 7. Successful bootstrap with --confirm
  const realRes = await executeSuperadminBootstrap(
    { uid: 'valid_candidate_uid', isDryRun: false, isConfirmed: true },
    fakeCustomApp
  );
  assert('BS.8 Bootstrap real exitoso con precondiciones cumplidas y confirmación', realRes.success);
  assert('BS.9 Custom Claims asignan role: superadmin', fakeAuthUsers['valid_candidate_uid'].customClaims.role === 'superadmin');
  assert('BS.10 adminUserDirectory/{uid} creado con role: superadmin', memoryDb.adminUserDirectory['valid_candidate_uid']?.role === 'superadmin');
  assert('BS.10B adminRoleState/{uid} creado con role: superadmin y roleVersion: 1', memoryDb.adminRoleState['valid_candidate_uid']?.role === 'superadmin' && memoryDb.adminRoleState['valid_candidate_uid']?.roleVersion === 1);
  assert('BS.11 adminAuditLogs contiene evento de bootstrap registrado', Object.values(memoryDb.adminAuditLogs).some((l: any) => l.action === 'superadmin_bootstrapped'));

  // 8. Idempotency test (running again on same superadmin)
  const idempRes = await executeSuperadminBootstrap(
    { uid: 'valid_candidate_uid', isDryRun: false, isConfirmed: true },
    fakeCustomApp
  );
  assert('BS.12 Es 100% idempotente (detecta rol existente y no duplica operaciones)', idempRes.message.includes('Idempotencia'));

  console.log('\n========================================================================');
  console.log(` RESULTADOS BOOTSTRAP: ${passed} pasadas, ${failed} fallidas`);
  console.log('========================================================================\n');

  if (failed > 0) process.exit(1);
}

runBootstrapTests();
