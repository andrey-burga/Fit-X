/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Suite de Pruebas Automatizadas:
 * Grupo A: RBAC (Role-Based Access Control)
 * Grupo B: Prevención de Escalada de Privilegios
 */

import {
  assertAdminOrSuperadmin,
  assertSuperadmin,
  getActorRoleFromClaims,
  createAdminInvitation,
  setAdminUserRole,
  setAdminUserStatus,
  listAdminUsers,
} from '../functions/src/adminLogic';
import { requireAdminAuthorization } from '../functions/src/authGuard';
import { UserRole } from '../src/types/admin';

async function runRbacTests() {
  console.log('========================================================================');
  console.log(' VIGORCORE — SUITE DE PRUEBAS: RBAC Y PREVENCIÓN DE ESCALADA');
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

  // Simulated in-memory Firestore database
  const memoryDb: Record<string, Record<string, any>> = {
    adminUserDirectory: {
      sa_1: { uid: 'sa_1', email: 'owner@vigorcore.com', role: 'superadmin', accountStatus: 'active' },
      adm_1: { uid: 'adm_1', email: 'admin1@vigorcore.com', role: 'admin', accountStatus: 'active' },
      ath_1: { uid: 'ath_1', email: 'athlete1@vigorcore.com', role: 'athlete', accountStatus: 'active' },
    },
    adminInvitations: {},
    adminAuditLogs: {},
    accountAccess: {},
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
        update: async (data: any) => {
          if (!memoryDb[colName]?.[docId]) throw new Error('Not found');
          memoryDb[colName][docId] = { ...memoryDb[colName][docId], ...data };
        },
      }),
      where: (field: string, op: string, val: any) => ({
        where: (field2: string, op2: string, val2: any) => ({
          get: async () => {
            const docs = Object.values(memoryDb[colName] || {}).filter(
              (d: any) => d[field] === val && d[field2] === val2
            );
            return {
              size: docs.length,
              docs: docs.map((d: any) => ({ data: () => d, ref: { update: async (u: any) => Object.assign(d, u) } })),
              forEach: (cb: any) => docs.forEach((d: any) => cb({ data: () => d })),
            };
          },
        }),
        get: async () => {
          const docs = Object.values(memoryDb[colName] || {}).filter((d: any) => d[field] === val);
          return {
            size: docs.length,
            docs: docs.map((d: any) => ({ data: () => d, ref: { update: async (u: any) => Object.assign(d, u) } })),
            forEach: (cb: any) => docs.forEach((d: any) => cb({ data: () => d })),
          };
        },
      }),
      get: async () => {
        const docs = Object.values(memoryDb[colName] || {});
        return {
          size: docs.length,
          forEach: (cb: any) => docs.forEach((d: any) => cb({ data: () => d })),
        };
      },
    }),
  };

  const fakeAuth: any = {
    users: {
      sa_1: { uid: 'sa_1', email: 'owner@vigorcore.com', customClaims: { role: 'superadmin' } },
      adm_1: { uid: 'adm_1', email: 'admin1@vigorcore.com', customClaims: { role: 'admin' } },
      ath_1: { uid: 'ath_1', email: 'athlete1@vigorcore.com', customClaims: { role: 'athlete' } },
    },
    getUser: async (uid: string) => {
      const u = fakeAuth.users[uid];
      if (!u) throw new Error(`User ${uid} not found`);
      return u;
    },
    setCustomUserClaims: async (uid: string, claims: any) => {
      if (!fakeAuth.users[uid]) throw new Error(`User ${uid} not found`);
      fakeAuth.users[uid].customClaims = claims;
    },
  };

  console.log('--- SECCIÓN A: VALIDACIÓN DE ROLES RBAC ---');

  // A.1: Claims resolution
  assert('A.1 Claims nulos o indefinidos resuelven a rol atleta predeterminado', getActorRoleFromClaims(null) === 'athlete');
  assert('A.2 Claim { role: "admin" } resuelve a admin', getActorRoleFromClaims({ role: 'admin' }) === 'admin');
  assert('A.3 Claim { role: "superadmin" } resuelve a superadmin', getActorRoleFromClaims({ role: 'superadmin' }) === 'superadmin');
  assert('A.4 Claim inválido o manipulado { role: "hacker" } resuelve a atleta', getActorRoleFromClaims({ role: 'hacker' }) === 'athlete');

  // A.5: Atleta denegado en endpoints administrativos
  let athleteBlocked = false;
  try {
    assertAdminOrSuperadmin('athlete', 'listAdminUsers');
  } catch {
    athleteBlocked = true;
  }
  assert('A.5 Atleta es rechazado al intentar ejecutar operaciones de administración', athleteBlocked);

  // A.6: Admin permitido en endpoints administrativos
  let adminAllowed = false;
  try {
    assertAdminOrSuperadmin('admin', 'listAdminUsers');
    adminAllowed = true;
  } catch {}
  assert('A.6 Administrador es autorizado para operaciones de gestión operativa', adminAllowed);

  // A.7: Superadmin permitido en endpoints administrativos y elevados
  let superadminAllowed = false;
  try {
    assertSuperadmin('superadmin', 'setAdminUserRole');
    superadminAllowed = true;
  } catch {}
  assert('A.7 Superadministrador es autorizado para operaciones elevadas', superadminAllowed);

  console.log('\n--- SECCIÓN B: PREVENCIÓN DE ESCALADA DE PRIVILEGIOS ---');

  // B.1: Admin intentando invitar a otro administrador -> RECHAZADO
  let adminInviteAdminBlocked = false;
  try {
    await createAdminInvitation(
      fakeFirestore,
      'adm_1',
      'admin',
      'admin1@vigorcore.com',
      'nuevo_admin@vigorcore.com',
      'admin'
    );
  } catch (err: any) {
    if (err.message.includes('Escalada de privilegios bloqueada')) {
      adminInviteAdminBlocked = true;
    }
  }
  assert('B.1 Administrador intentando invitar a otro administrador es denegado', adminInviteAdminBlocked);

  // B.2: Intento de invitar superadmin -> RECHAZADO
  let inviteSuperadminBlocked = false;
  try {
    await createAdminInvitation(
      fakeFirestore,
      'sa_1',
      'superadmin',
      'owner@vigorcore.com',
      'hacker@vigorcore.com',
      'superadmin' as any
    );
  } catch (err: any) {
    if (err.message.includes('No se permite invitar superadministradores')) {
      inviteSuperadminBlocked = true;
    }
  }
  assert('B.2 No se permite invitar superadministradores por flujo ordinario de invitaciones', inviteSuperadminBlocked);

  // B.3: Admin intentando modificar roles (setAdminUserRole) -> RECHAZADO
  let adminChangeRoleBlocked = false;
  try {
    await setAdminUserRole(
      fakeFirestore,
      fakeAuth,
      'adm_1',
      'admin',
      'admin1@vigorcore.com',
      'ath_1',
      'admin'
    );
  } catch (err: any) {
    if (err.message.includes('Acceso denegado: Se requiere rol de superadministrador')) {
      adminChangeRoleBlocked = true;
    }
  }
  assert('B.3 Administrador intentando promover o cambiar rol es bloqueado (solo superadmin)', adminChangeRoleBlocked);

  // B.4: Intento de degradar al último superadministrador -> BLOQUEADO
  let lastSuperadminDegradeBlocked = false;
  try {
    await setAdminUserRole(
      fakeFirestore,
      fakeAuth,
      'sa_1',
      'superadmin',
      'owner@vigorcore.com',
      'sa_1',
      'athlete'
    );
  } catch (err: any) {
    if (err.message.includes('Operación bloqueada')) {
      lastSuperadminDegradeBlocked = true;
    }
  }
  assert('B.4 Sistema bloquea degradar o remover al último superadministrador activo', lastSuperadminDegradeBlocked);

  // B.5: Superadmin intentando suspenderse a sí mismo -> BLOQUEADO
  let selfSuspensionBlocked = false;
  try {
    await setAdminUserStatus(
      fakeFirestore,
      fakeAuth,
      'sa_1',
      'superadmin',
      'owner@vigorcore.com',
      'sa_1',
      'suspended'
    );
  } catch (err: any) {
    if (err.message.includes('No puede suspender o deshabilitar su propia cuenta')) {
      selfSuspensionBlocked = true;
    }
  }
  assert('B.5 Administrador o Superadministrador no puede autosuspenderse', selfSuspensionBlocked);

  console.log('\n--- SECCIÓN C: ANTI-STALE-TOKENS, VERSIONADO REAL Y TRANSICIONES DE PRIVILEGIOS (Incremento 7D.2) ---');

  const nowEpoch = Math.floor(Date.now() / 1000);

  // Initialize accountAccess for administrative accounts
  memoryDb.accountAccess = {
    sa_1: { uid: 'sa_1', status: 'active', updatedAt: new Date().toISOString(), validAfter: nowEpoch - 100 },
    adm_1: { uid: 'adm_1', status: 'active', updatedAt: new Date().toISOString(), validAfter: nowEpoch - 100 },
  };

  // Seed authoritative role state with roleVersion
  memoryDb.adminRoleState = {
    sa_1: { uid: 'sa_1', role: 'superadmin', roleVersion: 1, updatedAt: new Date().toISOString(), updatedBy: 'bootstrap' },
    adm_1: { uid: 'adm_1', role: 'admin', roleVersion: 1, updatedAt: new Date().toISOString(), updatedBy: 'sa_1' },
  };

  fakeAuth.users['sa_1'].customClaims = { role: 'superadmin', roleVersion: 1 };
  fakeAuth.users['adm_1'].customClaims = { role: 'admin', roleVersion: 1 };

  // C.1: Actor legítimo con token versionado y concordante con adminRoleState es autorizado
  const authContextSaV1 = {
    uid: 'sa_1',
    token: { email: 'owner@vigorcore.com', email_verified: true, role: 'superadmin', roleVersion: 1, auth_time: nowEpoch },
  };
  const authResSa = await requireAdminAuthorization(fakeFirestore, authContextSaV1, 'users:list');
  assert('C.1 Actor con token y adminRoleState concordantes (v1) es plenamente autorizado', authResSa.authoritativeRole === 'superadmin' && authResSa.authoritativeRoleVersion === 1);

  // C.2: Token sin roleVersion es estrictamente RECHAZADO
  const unversionedTokenContext = {
    uid: 'sa_1',
    token: { email: 'owner@vigorcore.com', email_verified: true, role: 'superadmin', auth_time: nowEpoch },
  };
  let unversionedBlocked = false;
  try {
    await requireAdminAuthorization(fakeFirestore, unversionedTokenContext, 'users:list');
  } catch (err: any) {
    if (err.message.includes('roleVersion ausente') || err.message.includes('no versionado')) {
      unversionedBlocked = true;
    }
  }
  assert('C.2 Token administrativo sin roleVersion es estrictamente rechazado', unversionedBlocked);

  // C.3: Token con roleVersion manipulada hacia adelante (ej: v99) es RECHAZADO
  const forgedVersionContext = {
    uid: 'sa_1',
    token: { email: 'owner@vigorcore.com', email_verified: true, role: 'superadmin', roleVersion: 99, auth_time: nowEpoch },
  };
  let forgedVersionBlocked = false;
  try {
    await requireAdminAuthorization(fakeFirestore, forgedVersionContext, 'users:list');
  } catch (err: any) {
    if (err.message.includes('versión de privilegios desactualizada') || err.message.includes('no coincide')) {
      forgedVersionBlocked = true;
    }
  }
  assert('C.3 Token con roleVersion manipulada/futura (v99) es bloqueado por discordancia de versión', forgedVersionBlocked);

  // C.4: SECUENCIA COMPLETA DE TRANSICIÓN: Athlete -> Admin v1 -> Athlete v2 -> Admin v3
  console.log('\n  [CICLO 1]: Transición Athlete -> Admin v1 -> Athlete v2 -> Admin v3');
  const targetUid = 'ath_transition';
  memoryDb.adminUserDirectory[targetUid] = {
    uid: targetUid,
    email: 'transicion@vigorcore.com',
    role: 'athlete',
    accountStatus: 'active',
  };
  memoryDb.accountAccess[targetUid] = {
    uid: targetUid,
    status: 'active',
    updatedAt: new Date().toISOString(),
    validAfter: nowEpoch - 100,
  };
  fakeAuth.users[targetUid] = {
    uid: targetUid,
    email: 'transicion@vigorcore.com',
    customClaims: { role: 'athlete' },
  };

  // Paso 1: Promoción a Admin v1
  await setAdminUserRole(fakeFirestore, fakeAuth, 'sa_1', 'superadmin', 'owner@vigorcore.com', targetUid, 'admin');
  const stateV1 = memoryDb.adminRoleState[targetUid];
  assert('C.4.1 Promoción inicial asigna Admin con roleVersion: 1', stateV1?.role === 'admin' && stateV1?.roleVersion === 1);
  assert('C.4.2 Custom Claims de Auth actualizados con { role: "admin", roleVersion: 1 }', fakeAuth.users[targetUid].customClaims.role === 'admin' && fakeAuth.users[targetUid].customClaims.roleVersion === 1);

  const tokenAdminV1 = {
    uid: targetUid,
    token: { email: 'transicion@vigorcore.com', email_verified: true, role: 'admin', roleVersion: 1, auth_time: nowEpoch },
  };
  const authResV1 = await requireAdminAuthorization(fakeFirestore, tokenAdminV1, 'users:list');
  assert('C.4.3 Token Admin v1 es autorizado válidamente mientras adminRoleState esté en v1', authResV1.authoritativeRole === 'admin' && authResV1.authoritativeRoleVersion === 1);

  // Paso 2: Degradación a Athlete v2
  await setAdminUserRole(fakeFirestore, fakeAuth, 'sa_1', 'superadmin', 'owner@vigorcore.com', targetUid, 'athlete');
  const stateV2 = memoryDb.adminRoleState[targetUid];
  assert('C.4.4 Degradación a atleta incrementa versión monotónica a roleVersion: 2', stateV2?.role === 'athlete' && stateV2?.roleVersion === 2);
  assert('C.4.5 Custom claims actualizados a { role: "athlete", roleVersion: 2 }', fakeAuth.users[targetUid].customClaims.role === 'athlete' && fakeAuth.users[targetUid].customClaims.roleVersion === 2);

  // Demostrar que Token Admin v1 antiguo ahora es RECHAZADO
  let tokenV1AfterDemotionBlocked = false;
  try {
    await requireAdminAuthorization(fakeFirestore, tokenAdminV1, 'users:list');
  } catch (err: any) {
    if (err.message.includes('Autorización revocada') || err.message.includes('no coincide con el rol')) {
      tokenV1AfterDemotionBlocked = true;
    }
  }
  assert('C.4.6 Token Admin v1 es estrictamente rechazado tras degradación a Athlete v2', tokenV1AfterDemotionBlocked);

  // Demostrar que Token Athlete v2 es RECHAZADO para operaciones administrativas
  const tokenAthleteV2 = {
    uid: targetUid,
    token: { email: 'transicion@vigorcore.com', email_verified: true, role: 'athlete', roleVersion: 2, auth_time: nowEpoch },
  };
  let tokenAthleteV2Blocked = false;
  try {
    await requireAdminAuthorization(fakeFirestore, tokenAthleteV2, 'users:list');
  } catch (err: any) {
    if (err.message.includes('Autorización revocada: El rol actualmente registrado en el servidor es [athlete]')) {
      tokenAthleteV2Blocked = true;
    }
  }
  assert('C.4.7 Token Athlete v2 no puede invocar endpoints administrativos', tokenAthleteV2Blocked);

  // Paso 3: Re-promoción a Admin v3
  await setAdminUserRole(fakeFirestore, fakeAuth, 'sa_1', 'superadmin', 'owner@vigorcore.com', targetUid, 'admin');
  const stateV3 = memoryDb.adminRoleState[targetUid];
  assert('C.4.8 Re-promoción a Admin incrementa monotónicamente a roleVersion: 3', stateV3?.role === 'admin' && stateV3?.roleVersion === 3);

  // Demostrar que el Token v1 anterior sigue siendo RECHAZADO por versión caducada (v1 vs v3)
  let tokenV1OnV3Blocked = false;
  try {
    await requireAdminAuthorization(fakeFirestore, tokenAdminV1, 'users:list');
  } catch (err: any) {
    if (err.message.includes('versión de privilegios desactualizada') || err.message.includes('v1') || err.message.includes('v3')) {
      tokenV1OnV3Blocked = true;
    }
  }
  assert('C.4.9 Token antiguo Admin v1 es rechazado por discordancia de versión frente a servidor v3', tokenV1OnV3Blocked);

  // Demostrar que nuevo Token con Admin v3 es plenamente AUTORIZADO
  const tokenAdminV3 = {
    uid: targetUid,
    token: { email: 'transicion@vigorcore.com', email_verified: true, role: 'admin', roleVersion: 3, auth_time: nowEpoch },
  };
  const authResV3 = await requireAdminAuthorization(fakeFirestore, tokenAdminV3, 'users:list');
  assert('C.4.10 Token fresco Admin v3 es plenamente autorizado', authResV3.authoritativeRole === 'admin' && authResV3.authoritativeRoleVersion === 3);

  // C.5: SECUENCIA EQUIVALENTE PARA SUPERADMINISTRADOR: Superadmin v1 -> Admin v2 -> Superadmin v3
  console.log('\n  [CICLO 2]: Transición Superadmin v1 -> Admin v2 -> Superadmin v3');
  const saTargetUid = 'sa_second';
  memoryDb.adminUserDirectory[saTargetUid] = {
    uid: saTargetUid,
    email: 'sa2@vigorcore.com',
    role: 'superadmin',
    accountStatus: 'active',
  };
  memoryDb.accountAccess[saTargetUid] = {
    uid: saTargetUid,
    status: 'active',
    updatedAt: new Date().toISOString(),
    validAfter: nowEpoch - 100,
  };
  memoryDb.adminRoleState[saTargetUid] = {
    uid: saTargetUid,
    role: 'superadmin',
    roleVersion: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: 'sa_1',
  };
  fakeAuth.users[saTargetUid] = {
    uid: saTargetUid,
    email: 'sa2@vigorcore.com',
    customClaims: { role: 'superadmin', roleVersion: 1 },
  };

  const tokenSaV1 = {
    uid: saTargetUid,
    token: { email: 'sa2@vigorcore.com', email_verified: true, role: 'superadmin', roleVersion: 1, auth_time: nowEpoch },
  };
  const saAuth1 = await requireAdminAuthorization(fakeFirestore, tokenSaV1, 'users:setRole');
  assert('C.5.1 Superadmin v1 autorizado para setRole (permiso exclusivo de superadmin)', saAuth1.authoritativeRole === 'superadmin');

  // Degradar segundo superadmin a admin
  await setAdminUserRole(fakeFirestore, fakeAuth, 'sa_1', 'superadmin', 'owner@vigorcore.com', saTargetUid, 'admin');
  assert('C.5.2 Degradación de superadmin a admin incrementa versión a v2', memoryDb.adminRoleState[saTargetUid]?.role === 'admin' && memoryDb.adminRoleState[saTargetUid]?.roleVersion === 2);

  // Token antiguo Superadmin v1 intentando setRole -> RECHAZADO por stale token
  let staleSaTokenBlocked = false;
  try {
    await requireAdminAuthorization(fakeFirestore, tokenSaV1, 'users:setRole');
  } catch (err: any) {
    if (err.message.includes('token desactualizado') || err.message.includes('no coincide con el rol')) {
      staleSaTokenBlocked = true;
    }
  }
  assert('C.5.3 Token antiguo Superadmin v1 es bloqueado de inmediato ante degradación a admin', staleSaTokenBlocked);

  // Re-promover a superadmin -> roleVersion pasa a 3
  await setAdminUserRole(fakeFirestore, fakeAuth, 'sa_1', 'superadmin', 'owner@vigorcore.com', saTargetUid, 'superadmin');
  assert('C.5.4 Re-promoción a superadmin avanza monotónicamente a roleVersion: 3', memoryDb.adminRoleState[saTargetUid]?.role === 'superadmin' && memoryDb.adminRoleState[saTargetUid]?.roleVersion === 3);

  // Token Superadmin v1 rechazado por versión v1 vs v3
  let saV1OnV3Blocked = false;
  try {
    await requireAdminAuthorization(fakeFirestore, tokenSaV1, 'users:setRole');
  } catch (err: any) {
    if (err.message.includes('versión de privilegios desactualizada') || err.message.includes('v1') || err.message.includes('v3')) {
      saV1OnV3Blocked = true;
    }
  }
  assert('C.5.5 Token antiguo Superadmin v1 es rechazado por versión obsoleta', saV1OnV3Blocked);

  // Token Superadmin v3 plenamente autorizado
  const tokenSaV3 = {
    uid: saTargetUid,
    token: { email: 'sa2@vigorcore.com', email_verified: true, role: 'superadmin', roleVersion: 3, auth_time: nowEpoch },
  };
  const saAuth3 = await requireAdminAuthorization(fakeFirestore, tokenSaV3, 'users:setRole');
  assert('C.5.6 Token fresco Superadmin v3 autorizado con plena autoridad', saAuth3.authoritativeRole === 'superadmin' && saAuth3.authoritativeRoleVersion === 3);

  // C.6: Cuenta suspendida en accountAccess/{uid} es bloqueada inmediatamente incluso con token de superadmin v3
  memoryDb.accountAccess[saTargetUid] = { uid: saTargetUid, status: 'suspended', updatedAt: new Date().toISOString() };
  let suspendedAdminBlocked = false;
  try {
    await requireAdminAuthorization(fakeFirestore, tokenSaV3, 'users:list');
  } catch (err: any) {
    if (err.message.includes('Cuenta suspendida')) {
      suspendedAdminBlocked = true;
    }
  }
  assert('C.6 Cuenta en accountAccess con status: suspended es bloqueada preventivamente', suspendedAdminBlocked);

  // C.7: Ausencia de adminRoleState defaults to athlete (fail-closed)
  memoryDb.accountAccess['unknown_uid'] = {
    uid: 'unknown_uid',
    status: 'active',
    updatedAt: new Date().toISOString(),
    validAfter: nowEpoch - 100,
  };
  const unknownAuthContext = {
    uid: 'unknown_uid',
    token: { email: 'unknown@vigorcore.com', email_verified: true, role: 'admin', roleVersion: 1, auth_time: nowEpoch },
  };
  let missingRoleStateBlocked = false;
  try {
    await requireAdminAuthorization(fakeFirestore, unknownAuthContext, 'users:list');
  } catch (err: any) {
    if (err.message.includes('adminRoleState') || err.message.includes('Autorización denegada')) {
      missingRoleStateBlocked = true;
    }
  }
  assert('C.7 Ausencia de adminRoleState deniega acceso administrativo (fail-closed)', missingRoleStateBlocked);

  console.log('\n========================================================================');
  console.log(` RESULTADOS RBAC, VERSIONADO REAL & TRANSICIONES: ${passed} pasadas, ${failed} fallidas`);
  console.log('========================================================================\n');

  if (failed > 0) process.exit(1);
}

runRbacTests();
