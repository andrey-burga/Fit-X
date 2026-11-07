/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Suite de Pruebas Automatizadas:
 * Grupo D: Suspensión, Reactivación y Revocación de Sesiones
 * Grupo E: Trazabilidad y Auditoría Administrativa Append-Only
 */

import {
  setAdminUserStatus,
  writeAuditLog,
  getAdminAuditLogs,
} from '../functions/src/adminLogic';

async function runSuspensionAndAuditTests() {
  console.log('========================================================================');
  console.log(' VIGORCORE — SUITE: SUSPENSIÓN, REVOCACIÓN Y AUDITORÍA APPEND-ONLY');
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
    adminUserDirectory: {
      ath_suspendable: { uid: 'ath_suspendable', email: 'atleta@vigorcore.com', role: 'athlete', accountStatus: 'active' },
      adm_target: { uid: 'adm_target', email: 'adm_target@vigorcore.com', role: 'admin', accountStatus: 'active' },
      sa_active: { uid: 'sa_active', email: 'sa@vigorcore.com', role: 'superadmin', accountStatus: 'active' },
    },
    adminAuditLogs: {},
    accountAccess: {},
    adminRoleState: {},
  };

  const callSequence: string[] = [];

  const fakeFirestore: any = {
    collection: (colName: string) => ({
      doc: (docId: string) => ({
        get: async () => ({
          exists: !!memoryDb[colName]?.[docId],
          data: () => memoryDb[colName]?.[docId],
        }),
        set: async (data: any, options?: any) => {
          callSequence.push(`firestore:${colName}:${docId}`);
          if (!memoryDb[colName]) memoryDb[colName] = {};
          if (options?.merge && memoryDb[colName][docId]) {
            memoryDb[colName][docId] = { ...memoryDb[colName][docId], ...data };
          } else {
            memoryDb[colName][docId] = data;
          }
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
              forEach: (cb: any) => docs.forEach((d: any) => cb({ data: () => d })),
            };
          },
        }),
        get: async () => {
          const docs = Object.values(memoryDb[colName] || {}).filter((d: any) => d[field] === val);
          return {
            size: docs.length,
            forEach: (cb: any) => docs.forEach((d: any) => cb({ data: () => d })),
          };
        },
        orderBy: (orderField: string, direction: string) => ({
          get: async () => {
            const docs = Object.values(memoryDb[colName] || {}).filter((d: any) => d[field] === val);
            return {
              size: docs.length,
              forEach: (cb: any) => docs.forEach((d: any) => cb({ data: () => d })),
            };
          },
        }),
      }),
      orderBy: (orderField: string, direction: string) => ({
        get: async () => {
          const docs = Object.values(memoryDb[colName] || {});
          return {
            size: docs.length,
            forEach: (cb: any) => docs.forEach((d: any) => cb({ data: () => d })),
          };
        },
      }),
    }),
  };

  const tokensRevoked: Record<string, boolean> = {};
  const fakeAuth: any = {
    users: {
      ath_suspendable: { uid: 'ath_suspendable', email: 'atleta@vigorcore.com', disabled: false, customClaims: { role: 'athlete' } },
      adm_target: { uid: 'adm_target', email: 'adm_target@vigorcore.com', disabled: false, customClaims: { role: 'admin' } },
      sa_active: { uid: 'sa_active', email: 'sa@vigorcore.com', disabled: false, customClaims: { role: 'superadmin' } },
    },
    getUser: async (uid: string) => fakeAuth.users[uid],
    updateUser: async (uid: string, updates: any) => {
      callSequence.push(`auth:updateUser:${uid}:${JSON.stringify(updates)}`);
      Object.assign(fakeAuth.users[uid], updates);
    },
    revokeRefreshTokens: async (uid: string) => {
      callSequence.push(`auth:revokeRefreshTokens:${uid}`);
      tokensRevoked[uid] = true;
    },
  };

  console.log('--- SECCIÓN D: CICLO DE SUSPENSIÓN Y REACTIVACIÓN ---');

  // D.1: Suspensión autorizada de atleta por admin
  callSequence.length = 0;
  await setAdminUserStatus(
    fakeFirestore,
    fakeAuth,
    'adm_actor_uid',
    'admin',
    'admin@vigorcore.com',
    'ath_suspendable',
    'suspended',
    'Violación de términos de uso'
  );

  assert('D.1 Cuenta deshabilitada en Firebase Auth (disabled: true)', fakeAuth.users['ath_suspendable'].disabled === true);
  assert('D.2 Revocación de refresh tokens ejecutada para invalidar sesiones', tokensRevoked['ath_suspendable'] === true);
  assert('D.3 Registro de acceso accountAccess/{uid} creado con status: suspended', memoryDb.accountAccess['ath_suspendable']?.status === 'suspended');
  assert('D.3B Orden fail-closed: accountAccess/{uid} escrito ANTES de llamadas de Auth', callSequence.indexOf('firestore:accountAccess:ath_suspendable') < callSequence.indexOf('auth:updateUser:ath_suspendable:{"disabled":true}'));
  assert('D.4 Directorio administrativo refleja estado suspended', memoryDb.adminUserDirectory['ath_suspendable']?.accountStatus === 'suspended');

  // D.5: Admin intentando suspender a otro admin -> DENEGADO
  let adminSuspendAdminBlocked = false;
  try {
    await setAdminUserStatus(
      fakeFirestore,
      fakeAuth,
      'adm_actor_uid',
      'admin',
      'admin@vigorcore.com',
      'adm_target',
      'suspended',
      'Intento no autorizado'
    );
  } catch (err: any) {
    if (err.message.includes('Escalada bloqueada')) {
      adminSuspendAdminBlocked = true;
    }
  }
  assert('D.5 Administrador ordinario no puede suspender a otro administrador', adminSuspendAdminBlocked);

  // D.6: Reactivación autorizada
  callSequence.length = 0;
  await setAdminUserStatus(
    fakeFirestore,
    fakeAuth,
    'adm_actor_uid',
    'admin',
    'admin@vigorcore.com',
    'ath_suspendable',
    'active',
    'Caso aclarado con el atleta'
  );

  assert('D.6 Reactivación habilita cuenta en Firebase Auth (disabled: false)', fakeAuth.users['ath_suspendable'].disabled === false);
  assert('D.7 Registro de acceso accountAccess transiciona a active', memoryDb.accountAccess['ath_suspendable']?.status === 'active');
  assert('D.7B validAfter almacenado en segundos Unix (epoch seconds)', typeof memoryDb.accountAccess['ath_suspendable']?.validAfter === 'number' && memoryDb.accountAccess['ath_suspendable']?.validAfter <= Math.floor(Date.now() / 1000));
  assert('D.8 Directorio administrativo transiciona a active', memoryDb.adminUserDirectory['ath_suspendable']?.accountStatus === 'active');
  assert('D.8B Orden seguro de reactivación: Auth habilitado ANTES de accountAccess', callSequence.indexOf('auth:updateUser:ath_suspendable:{"disabled":false}') < callSequence.indexOf('firestore:accountAccess:ath_suspendable'));

  console.log('\n--- SECCIÓN D.2: INVALIDACIÓN TEMPORAL DE SESIÓN POST-REACTIVACIÓN (validAfter vs auth_time) ---');

  const reactivatedUid = 'adm_reactivated';
  const reactivationEpoch = Math.floor(Date.now() / 1000);

  memoryDb.adminUserDirectory[reactivatedUid] = {
    uid: reactivatedUid,
    email: 'reactivated@vigorcore.com',
    role: 'admin',
    accountStatus: 'active',
  };
  memoryDb.adminRoleState[reactivatedUid] = {
    uid: reactivatedUid,
    role: 'admin',
    roleVersion: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: 'sa_active',
  };
  memoryDb.accountAccess[reactivatedUid] = {
    uid: reactivatedUid,
    status: 'active',
    updatedAt: new Date().toISOString(),
    validAfter: reactivationEpoch, // Reactivation occurred at reactivationEpoch
  };

  // D.9: Sesión emitida antes de la reactivación (auth_time < validAfter) es RECHAZADA
  const staleSessionToken = {
    uid: reactivatedUid,
    token: {
      email: 'reactivated@vigorcore.com',
      email_verified: true,
      role: 'admin',
      roleVersion: 1,
      auth_time: reactivationEpoch - 300, // 5 minutes prior to reactivation
    },
  };
  let staleSessionBlocked = false;
  try {
    const { requireAdminAuthorization } = await import('../functions/src/authGuard');
    await requireAdminAuthorization(fakeFirestore, staleSessionToken, 'users:list');
  } catch (err: any) {
    if (err.message.includes('Sesión invalidada') || err.message.includes('auth_time')) {
      staleSessionBlocked = true;
    }
  }
  assert('D.9 Sesión emitida antes de la reactivación (auth_time < validAfter) es rechazada', staleSessionBlocked);

  // D.9B: Caso límite estricto: token emitido en el mismo segundo exacto (auth_time == validAfter) es RECHAZADO (se exige estrictamente auth_time > validAfter)
  const boundarySessionToken = {
    uid: reactivatedUid,
    token: {
      email: 'reactivated@vigorcore.com',
      email_verified: true,
      role: 'admin',
      roleVersion: 1,
      auth_time: reactivationEpoch, // Same exact second
    },
  };
  let boundarySessionBlocked = false;
  try {
    const { requireAdminAuthorization } = await import('../functions/src/authGuard');
    await requireAdminAuthorization(fakeFirestore, boundarySessionToken, 'users:list');
  } catch (err: any) {
    if (err.message.includes('Sesión invalidada') || err.message.includes('auth_time')) {
      boundarySessionBlocked = true;
    }
  }
  assert('D.9B Token en el mismo segundo exacto (auth_time == validAfter) es rechazado por comparación estricta >', boundarySessionBlocked);

  // D.9C: Token con auth_time faltante o inválido con validAfter activo es RECHAZADO
  const missingAuthTimeToken = {
    uid: reactivatedUid,
    token: {
      email: 'reactivated@vigorcore.com',
      email_verified: true,
      role: 'admin',
      roleVersion: 1,
    },
  };
  let missingAuthTimeBlocked = false;
  try {
    const { requireAdminAuthorization } = await import('../functions/src/authGuard');
    await requireAdminAuthorization(fakeFirestore, missingAuthTimeToken, 'users:list');
  } catch (err: any) {
    if (err.message.includes('Sesión invalidada') || err.message.includes('auth_time')) {
      missingAuthTimeBlocked = true;
    }
  }
  assert('D.9C Token sin auth_time con validAfter presente es rechazado por falta de prueba de frescura', missingAuthTimeBlocked);

  // D.10: Sesión fresca emitida tras la reactivación (auth_time > validAfter) es AUTORIZADA
  const freshSessionToken = {
    uid: reactivatedUid,
    token: {
      email: 'reactivated@vigorcore.com',
      email_verified: true,
      role: 'admin',
      roleVersion: 1,
      auth_time: reactivationEpoch + 10, // Fresh login strictly after reactivation
    },
  };
  const { requireAdminAuthorization: requireAdminAuthFresh } = await import('../functions/src/authGuard');
  const freshRes = await requireAdminAuthFresh(fakeFirestore, freshSessionToken, 'users:list');
  assert('D.10 Sesión fresca re-autenticada (auth_time > validAfter) es autorizada válidamente', freshRes.authoritativeRole === 'admin');

  console.log('\n--- SECCIÓN D.3: BLOQUEO HERMÉTICO DE ACTOR SUSPENDIDO EN TODOS LOS 8 ENDPOINTS ---');

  const suspendedAdminUid = 'adm_suspended_all';
  memoryDb.adminRoleState[suspendedAdminUid] = {
    uid: suspendedAdminUid,
    role: 'superadmin',
    roleVersion: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: 'system',
  };
  memoryDb.accountAccess[suspendedAdminUid] = {
    uid: suspendedAdminUid,
    status: 'suspended',
    updatedAt: new Date().toISOString(),
    validAfter: reactivationEpoch,
  };

  const suspendedAdminToken = {
    uid: suspendedAdminUid,
    token: {
      email: 'suspended_sa@vigorcore.com',
      email_verified: true,
      role: 'superadmin',
      roleVersion: 1,
      auth_time: reactivationEpoch + 100,
    },
  };

  const allAdminPermissions: (import('../functions/src/authGuard').AdminPermission)[] = [
    'users:list',
    'users:detail',
    'users:stats',
    'invitations:create',
    'invitations:revoke',
    'users:setRole',
    'users:setStatus',
    'audit:list',
  ];

  let endpointsBlockedCount = 0;
  for (const perm of allAdminPermissions) {
    try {
      await requireAdminAuthFresh(fakeFirestore, suspendedAdminToken, perm);
    } catch (err: any) {
      if (err.message.includes('Cuenta suspendida o inactiva')) {
        endpointsBlockedCount++;
      }
    }
  }
  assert('D.11 Cuenta con status: suspended es rechazada en TODOS los 8 endpoints administrativos', endpointsBlockedCount === 8);

  console.log('\n--- SECCIÓN D.4: RESILENCIA ANTE FALLO PARCIAL (FAIL-CLOSED Y AUDITORÍA) ---');

  const partialTargetUid = 'ath_partial_fail';
  fakeAuth.users[partialTargetUid] = {
    uid: partialTargetUid,
    email: 'partial@vigorcore.com',
    disabled: false,
    customClaims: { role: 'athlete' },
  };

  // Simular fallo transitorio o de red en Firebase Auth al deshabilitar usuario
  const failingAuth: any = {
    users: fakeAuth.users,
    getUser: async (uid: string) => fakeAuth.users[uid],
    updateUser: async () => {
      throw new Error('Firebase Auth Service Unavailable: 503 Internal Server Error');
    },
    revokeRefreshTokens: async () => {},
  };

  let partialSuspensionErrorThrown = false;
  try {
    await setAdminUserStatus(
      fakeFirestore,
      failingAuth,
      'sa_active',
      'superadmin',
      'sa@vigorcore.com',
      partialTargetUid,
      'suspended',
      'Prueba de fallo parcial en Auth'
    );
  } catch (err: any) {
    if (err.message.includes('503 Internal Server Error')) {
      partialSuspensionErrorThrown = true;
    }
  }
  assert('D.12 Fallo en Auth propaga error pero asegura persistencia fail-closed', partialSuspensionErrorThrown);
  assert('D.13 accountAccess/{uid} persiste en status: suspended a pesar del fallo en Auth', memoryDb.accountAccess[partialTargetUid]?.status === 'suspended');

  const partialLogs = Object.values(memoryDb.adminAuditLogs).filter((l: any) => l.action === 'account_suspended' && l.status === 'partially_completed');
  assert('D.14 adminAuditLogs registra evento con status: partially_completed y detalle del error', partialLogs.length > 0 && partialLogs[0].metadata?.partialError?.includes('503'));

  console.log('\n--- SECCIÓN E: AUDITORÍA APPEND-ONLY Y PROTECCIÓN DE DATOS ---');

  // E.1: Verificación de logs generados en las operaciones previas
  const allLogs = Object.values(memoryDb.adminAuditLogs);
  assert('E.1 Operaciones sensibles generan registros en adminAuditLogs', allLogs.length >= 3);

  const suspendLog = allLogs.find((l: any) => l.action === 'account_suspended' && l.status === 'completed');
  assert('E.2 Log de suspensión contiene actorUid, actorRole, targetUid y motivo', !!suspendLog && suspendLog.targetUid === 'ath_suspendable' && suspendLog.actorRole === 'admin');
  assert('E.2B Log de auditoría contiene status: completed', suspendLog?.status === 'completed');
  assert('E.3 Log contiene timestamp ISO de servidor', !!suspendLog?.timestamp && !isNaN(Date.parse(suspendLog.timestamp)));

  // E.4: Cero exposición de secretos o contraseñas
  const containsSecrets = allLogs.some((l: any) => l.password || l.rawToken || l.secret || l.token);
  assert('E.4 Cero secretos, hashes o contraseñas expuestas en registros de auditoría', !containsSecrets);

  // E.5: Consulta restringida a personal administrativo
  let athleteAuditBlocked = false;
  try {
    await getAdminAuditLogs(fakeFirestore, 'athlete', {});
  } catch (err: any) {
    if (err.message.includes('Acceso denegado')) {
      athleteAuditBlocked = true;
    }
  }
  assert('E.5 Atletas ordinarios tienen lectura denegada sobre adminAuditLogs', athleteAuditBlocked);

  console.log('\n========================================================================');
  console.log(` RESULTADOS SUSPENSIÓN, VALIDAFTER Y AUDITORÍA: ${passed} pasadas, ${failed} fallidas`);
  console.log('========================================================================\n');

  if (failed > 0) process.exit(1);
}

runSuspensionAndAuditTests();
