/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Suite de Pruebas Automatizadas:
 * Grupo C: Sistema de Invitaciones Seguras, Hashing Criptográfico y Ciclo de Canje
 */

import {
  createAdminInvitation,
  revokeAdminInvitation,
  acceptAdminInvitation,
  hashToken,
  timingSafeHashCompare,
} from '../functions/src/adminLogic';

async function runInvitationsTests() {
  console.log('========================================================================');
  console.log(' VIGORCORE — SUITE DE PRUEBAS: INVITACIONES SEGURAS Y HASHING');
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

  // Simulated in-memory storage
  const memoryDb: Record<string, Record<string, any>> = {
    adminInvitations: {},
    adminAuditLogs: {},
    adminUserDirectory: {},
    accountAccess: {},
    adminRoleState: {},
    adminInvitationOperations: {},
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
              docs: docs.map((d: any) => ({
                data: () => d,
                ref: {
                  update: async (u: any) => Object.assign(d, u),
                },
              })),
              forEach: (cb: any) => docs.forEach((d: any) => cb({ data: () => d })),
            };
          },
        }),
        get: async () => {
          const docs = Object.values(memoryDb[colName] || {}).filter((d: any) => d[field] === val);
          return {
            size: docs.length,
            docs: docs.map((d: any) => ({
              data: () => d,
              ref: {
                update: async (u: any) => Object.assign(d, u),
              },
            })),
            forEach: (cb: any) => docs.forEach((d: any) => cb({ data: () => d })),
          };
        },
      }),
    }),
  };

  const fakeAuth: any = {
    users: {
      target_user_uid: {
        uid: 'target_user_uid',
        email: 'invitado@vigorcore.com',
        displayName: 'Atleta Invitado',
        emailVerified: true,
        providerData: [{ providerId: 'password' }],
        metadata: { creationTime: new Date().toISOString() },
        customClaims: {},
      },
      unverified_user_uid: {
        uid: 'unverified_user_uid',
        email: 'sinverificar@vigorcore.com',
        emailVerified: false,
        providerData: [{ providerId: 'password' }],
        metadata: { creationTime: new Date().toISOString() },
        customClaims: {},
      },
    },
    getUser: async (uid: string) => fakeAuth.users[uid],
    setCustomUserClaims: async (uid: string, claims: any) => {
      fakeAuth.users[uid].customClaims = claims;
    },
  };

  // C.1: Creación autorizada y correo normalizado
  console.log('--- CICLO DE CREACIÓN Y HASHING ---');
  const inv1 = await createAdminInvitation(
    fakeFirestore,
    'admin_actor_uid',
    'admin',
    'admin@vigorcore.com',
    '   Invitado@VigorCore.COM   ', // Dirty mixed-case and spaces
    'athlete'
  );

  assert('C.1 Creación autorizada genera inviteId y rawToken', !!inv1.inviteId && !!inv1.rawToken);
  assert('C.2 Enlace de invitación contiene dominio oficial y parámetros', inv1.inviteLink.includes('https://fit-x-bhnatsxl.onslate.com'));

  const savedInvite = memoryDb.adminInvitations[inv1.inviteId];
  assert('C.3 Correo se normaliza a minúsculas sin espacios (invitado@vigorcore.com)', savedInvite.emailNormalized === 'invitado@vigorcore.com');
  assert('C.4 En Firestore se almacena únicamente el hash SHA-256 (token en texto plano ausente)', savedInvite.tokenHash === hashToken(inv1.rawToken) && !savedInvite.rawToken);

  // C.5: Rechazo de invitación duplicada activa
  let duplicateBlocked = false;
  try {
    await createAdminInvitation(
      fakeFirestore,
      'admin_actor_uid',
      'admin',
      'admin@vigorcore.com',
      'invitado@vigorcore.com',
      'athlete'
    );
  } catch (err: any) {
    if (err.message.includes('Ya existe una invitación pendiente')) {
      duplicateBlocked = true;
    }
  }
  assert('C.5 Invitación duplicada para correo con invitación activa es bloqueada', duplicateBlocked);

  console.log('\n--- CICLO DE VALIDACIÓN Y CANJE ---');

  // C.6: Intento con token inválido -> RECHAZADO
  let invalidTokenBlocked = false;
  try {
    await acceptAdminInvitation(
      fakeFirestore,
      fakeAuth,
      'target_user_uid',
      'invitado@vigorcore.com',
      true,
      inv1.inviteId,
      'token_falso_manipulado'
    );
  } catch (err: any) {
    if (err.message.includes('token de invitación no es válido')) {
      invalidTokenBlocked = true;
    }
  }
  assert('C.6 Token manipulado o incorrecto es rechazado', invalidTokenBlocked);

  // C.7: Intento con correo diferente al destinatario -> RECHAZADO
  let differentEmailBlocked = false;
  try {
    await acceptAdminInvitation(
      fakeFirestore,
      fakeAuth,
      'target_user_uid',
      'impostor@vigorcore.com',
      true,
      inv1.inviteId,
      inv1.rawToken
    );
  } catch (err: any) {
    if (err.message.includes('no coincide con el destinatario')) {
      differentEmailBlocked = true;
    }
  }
  assert('C.7 Usuario con correo distinto al de la invitación es rechazado', differentEmailBlocked);

  // C.8: Intento con correo sin verificar -> RECHAZADO
  let unverifiedEmailBlocked = false;
  try {
    await acceptAdminInvitation(
      fakeFirestore,
      fakeAuth,
      'unverified_user_uid',
      'invitado@vigorcore.com',
      false, // emailVerified = false
      inv1.inviteId,
      inv1.rawToken
    );
  } catch (err: any) {
    if (err.message.includes('Debe verificar su correo electrónico')) {
      unverifiedEmailBlocked = true;
    }
  }
  assert('C.8 Usuario con correo electrónico no verificado es bloqueado preventivamente', unverifiedEmailBlocked);

  // C.9: Canje legítimo exitoso
  const redeemResult = await acceptAdminInvitation(
    fakeFirestore,
    fakeAuth,
    'target_user_uid',
    'invitado@vigorcore.com',
    true,
    inv1.inviteId,
    inv1.rawToken
  );
  assert('C.9 Canje legítimo es exitoso', redeemResult.success && redeemResult.assignedRole === 'athlete');
  assert('C.10 Custom claims en Firebase Auth asignan el rol autorizado', fakeAuth.users['target_user_uid'].customClaims.role === 'athlete');
  assert('C.10B Estado autoritativo adminRoleState/{uid} creado con roleVersion: 1', memoryDb.adminRoleState['target_user_uid']?.role === 'athlete' && memoryDb.adminRoleState['target_user_uid']?.roleVersion === 1);
  assert('C.10C timingSafeHashCompare valida hashes en tiempo constante de forma segura', timingSafeHashCompare(hashToken('token_test'), hashToken('token_test')) && !timingSafeHashCompare(hashToken('token_test'), hashToken('token_different')));
  assert('C.11 Estado de invitación transiciona a redeemed', memoryDb.adminInvitations[inv1.inviteId].status === 'redeemed');
  assert('C.12 Directorio administrativo se actualiza con la cuenta', memoryDb.adminUserDirectory['target_user_uid']?.accountStatus === 'active');

  // C.13A: Re-canje por el mismo usuario es idempotente y exitoso
  const sameUserRecheck = await acceptAdminInvitation(
    fakeFirestore,
    fakeAuth,
    'target_user_uid',
    'invitado@vigorcore.com',
    true,
    inv1.inviteId,
    inv1.rawToken
  );
  assert('C.13A Re-canje por el mismo usuario retorna resultado idempotente exitoso', sameUserRecheck.success);

  // C.13B: Intento de canje por un usuario distinto es denegado
  let reuseBlocked = false;
  fakeAuth.users['different_user_uid'] = {
    uid: 'different_user_uid',
    email: 'invitado@vigorcore.com',
    emailVerified: true,
    providerData: [{ providerId: 'password' }],
    metadata: {},
    customClaims: {},
  };
  try {
    await acceptAdminInvitation(
      fakeFirestore,
      fakeAuth,
      'different_user_uid',
      'invitado@vigorcore.com',
      true,
      inv1.inviteId,
      inv1.rawToken
    );
  } catch (err: any) {
    if (err.message.includes('ya ha sido canjeada')) {
      reuseBlocked = true;
    }
  }
  assert('C.13B Reutilización de invitación ya canjeada por otro usuario es estrictamente denegada', reuseBlocked);

  // C.14: Revocación de invitación
  console.log('\n--- CICLO DE REVOCACIÓN Y EXPIRACIÓN ---');
  const inv2 = await createAdminInvitation(
    fakeFirestore,
    'admin_actor_uid',
    'admin',
    'admin@vigorcore.com',
    'revocar@vigorcore.com',
    'athlete'
  );
  await revokeAdminInvitation(fakeFirestore, 'admin_actor_uid', 'admin', 'admin@vigorcore.com', inv2.inviteId, 'Prueba de revocación');
  assert('C.14 Invitación transiciona a status: revoked', memoryDb.adminInvitations[inv2.inviteId].status === 'revoked');

  let revokedAcceptBlocked = false;
  try {
    fakeAuth.users['revoked_uid'] = {
      uid: 'revoked_uid',
      email: 'revocar@vigorcore.com',
      emailVerified: true,
      providerData: [{ providerId: 'password' }],
      metadata: {},
      customClaims: {},
    };
    await acceptAdminInvitation(fakeFirestore, fakeAuth, 'revoked_uid', 'revocar@vigorcore.com', true, inv2.inviteId, inv2.rawToken);
  } catch (err: any) {
    if (err.message.includes('ha sido revocada')) {
      revokedAcceptBlocked = true;
    }
  }
  assert('C.15 Intento de canjear invitación revocada es denegado', revokedAcceptBlocked);

  // C.16: Invitación expirada (> 7 días)
  const inv3 = await createAdminInvitation(
    fakeFirestore,
    'admin_actor_uid',
    'admin',
    'admin@vigorcore.com',
    'expirado@vigorcore.com',
    'athlete'
  );
  // Force expiration in past
  memoryDb.adminInvitations[inv3.inviteId].expiresAt = new Date(Date.now() - 10000).toISOString();

  let expiredAcceptBlocked = false;
  try {
    fakeAuth.users['exp_uid'] = {
      uid: 'exp_uid',
      email: 'expirado@vigorcore.com',
      emailVerified: true,
      providerData: [{ providerId: 'password' }],
      metadata: {},
      customClaims: {},
    };
    await acceptAdminInvitation(fakeFirestore, fakeAuth, 'exp_uid', 'expirado@vigorcore.com', true, inv3.inviteId, inv3.rawToken);
  } catch (err: any) {
    if (err.message.includes('ha expirado')) {
      expiredAcceptBlocked = true;
    }
  }
  // C.17: Bloqueo de concurrencia cuando está en status 'redeeming' por otro usuario (< 5 min)
  console.log('\n--- CICLO DE CONCURRENCIA, SAGA Y RECUPERACIÓN DE TRANSACCIÓN ---');
  const inv4 = await createAdminInvitation(
    fakeFirestore,
    'admin_actor_uid',
    'admin',
    'admin@vigorcore.com',
    'concurrente@vigorcore.com',
    'athlete'
  );
  // Simular que worker_alpha_uid tiene la invitación bloqueada recientemente en estado 'redeeming'
  memoryDb.adminInvitations[inv4.inviteId].status = 'redeeming';
  memoryDb.adminInvitations[inv4.inviteId].lockedBy = 'worker_alpha_uid';
  memoryDb.adminInvitations[inv4.inviteId].lockedAt = new Date().toISOString();

  fakeAuth.users['worker_beta_uid'] = {
    uid: 'worker_beta_uid',
    email: 'concurrente@vigorcore.com',
    emailVerified: true,
    providerData: [{ providerId: 'password' }],
    metadata: {},
    customClaims: {},
  };
  fakeAuth.users['worker_alpha_uid'] = {
    uid: 'worker_alpha_uid',
    email: 'concurrente@vigorcore.com',
    emailVerified: true,
    providerData: [{ providerId: 'password' }],
    metadata: {},
    customClaims: {},
  };

  let concurrentBlocked = false;
  try {
    await acceptAdminInvitation(
      fakeFirestore,
      fakeAuth,
      'worker_beta_uid',
      'concurrente@vigorcore.com',
      true,
      inv4.inviteId,
      inv4.rawToken
    );
  } catch (err: any) {
    if (err.message.includes('procesada en este momento')) {
      concurrentBlocked = true;
    }
  }
  assert('C.17 Invitación bloqueada en proceso activo (status: redeeming) rechaza intentos concurrentes de otro usuario', concurrentBlocked);

  // C.18: Mismo usuario (worker_alpha_uid) reanudando la saga en curso renueva el lock y completa el canje
  const resumeResult = await acceptAdminInvitation(
    fakeFirestore,
    fakeAuth,
    'worker_alpha_uid',
    'concurrente@vigorcore.com',
    true,
    inv4.inviteId,
    inv4.rawToken
  );
  assert('C.18 Mismo usuario (callerUid == lockedBy) reanuda el lock de la saga y canjea exitosamente', resumeResult.success && memoryDb.adminInvitations[inv4.inviteId].status === 'redeemed' && memoryDb.adminInvitations[inv4.inviteId].redeemedBy === 'worker_alpha_uid');
  assert('C.18B Invitación canjeada registra operationId y roleVersionAssigned', !!memoryDb.adminInvitations[inv4.inviteId].operationId && typeof memoryDb.adminInvitations[inv4.inviteId].roleVersionAssigned === 'number');

  // C.19: Reintento idempotente del mismo usuario retorna éxito sin alterar versionado
  const idempResult = await acceptAdminInvitation(
    fakeFirestore,
    fakeAuth,
    'worker_alpha_uid',
    'concurrente@vigorcore.com',
    true,
    inv4.inviteId,
    inv4.rawToken
  );
  assert('C.19 Reintento posterior del mismo usuario es idempotente y exitoso', idempResult.success && idempResult.message.includes('previamente canjeada'));

  // C.20: Intento de un segundo usuario tras canje completado es DENEGADO (Anti-Double-Redemption)
  let secondUserAfterRedeemBlocked = false;
  try {
    await acceptAdminInvitation(
      fakeFirestore,
      fakeAuth,
      'worker_beta_uid',
      'concurrente@vigorcore.com',
      true,
      inv4.inviteId,
      inv4.rawToken
    );
  } catch (err: any) {
    if (err.message.includes('ya ha sido canjeada anteriormente')) {
      secondUserAfterRedeemBlocked = true;
    }
  }
  assert('C.20 Segundo usuario es rotundamente denegado tras canje previo (Anti-Double-Redemption)', secondUserAfterRedeemBlocked);

  // C.21: Lock estancado (> 5 min) por un usuario previo que SÍ recibió el rol en adminRoleState
  const inv5 = await createAdminInvitation(
    fakeFirestore,
    'sa_actor_uid',
    'superadmin',
    'owner@vigorcore.com',
    'stale_reconcile@vigorcore.com',
    'admin'
  );
  memoryDb.adminInvitations[inv5.inviteId].status = 'redeeming';
  memoryDb.adminInvitations[inv5.inviteId].lockedBy = 'ghost_user_1';
  memoryDb.adminInvitations[inv5.inviteId].lockedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago

  const ghostOpId = `op_redeem_${inv5.inviteId}_ghost_user_1`;
  memoryDb.adminInvitations[inv5.inviteId].operationId = ghostOpId;
  memoryDb.adminInvitationOperations[ghostOpId] = {
    operationId: ghostOpId,
    inviteId: inv5.inviteId,
    callerUid: 'ghost_user_1',
    targetRole: 'admin',
    status: 'role_confirmed',
    updatedAt: new Date().toISOString(),
  };

  // Simulamos que ghost_user_1 sí completó la operación y tiene lastOperationId coincidente
  memoryDb.adminRoleState['ghost_user_1'] = {
    uid: 'ghost_user_1',
    role: 'admin',
    roleVersion: 1,
    lastOperationId: ghostOpId,
  };

  fakeAuth.users['second_user_uid'] = {
    uid: 'second_user_uid',
    email: 'stale_reconcile@vigorcore.com',
    emailVerified: true,
    providerData: [{ providerId: 'password' }],
    metadata: {},
    customClaims: {},
  };

  let staleReconciledBlocked = false;
  try {
    await acceptAdminInvitation(
      fakeFirestore,
      fakeAuth,
      'second_user_uid',
      'stale_reconcile@vigorcore.com',
      true,
      inv5.inviteId,
      inv5.rawToken
    );
  } catch (err: any) {
    if (err.message.includes('ya fue consumida previamente por otro usuario')) {
      staleReconciledBlocked = true;
    }
  }
  assert('C.21 Lock estancado reconcilia invitación a redeemed por usuario previo y bloquea al segundo usuario', staleReconciledBlocked && memoryDb.adminInvitations[inv5.inviteId].status === 'redeemed' && memoryDb.adminInvitations[inv5.inviteId].redeemedBy === 'ghost_user_1');

  // C.21B: Usuario previo ya tenía el rol ANTES de la invitación pero NO completó la operación (lastOperationId diferente)
  const inv5B = await createAdminInvitation(
    fakeFirestore,
    'sa_actor_uid',
    'superadmin',
    'owner@vigorcore.com',
    'stale_prior_role@vigorcore.com',
    'athlete'
  );
  memoryDb.adminInvitations[inv5B.inviteId].status = 'redeeming';
  memoryDb.adminInvitations[inv5B.inviteId].lockedBy = 'prior_athlete_uid';
  memoryDb.adminInvitations[inv5B.inviteId].lockedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  // El usuario ya era athlete antes por una operación previa no relacionada
  memoryDb.adminRoleState['prior_athlete_uid'] = {
    uid: 'prior_athlete_uid',
    role: 'athlete',
    roleVersion: 1,
    lastOperationId: 'op_old_other_thing',
  };

  fakeAuth.users['competitor_user_uid'] = {
    uid: 'competitor_user_uid',
    email: 'stale_prior_role@vigorcore.com',
    emailVerified: true,
    providerData: [{ providerId: 'password' }],
    metadata: {},
    customClaims: {},
  };

  let priorRoleIndeterminateBlocked = false;
  try {
    await acceptAdminInvitation(
      fakeFirestore,
      fakeAuth,
      'competitor_user_uid',
      'stale_prior_role@vigorcore.com',
      true,
      inv5B.inviteId,
      inv5B.rawToken
    );
  } catch (err: any) {
    if (err.message.includes('Bloqueo de seguridad: La invitación quedó en estado de reserva indeterminado')) {
      priorRoleIndeterminateBlocked = true;
    }
  }
  assert('C.21B Usuario previo con rol preexistente pero sin operación confirmada no se confunde con canje y activa bloqueo de seguridad', priorRoleIndeterminateBlocked);

  // C.22: Lock estancado (> 5 min) indeterminado (usuario previo NO tiene el rol) activa bloqueo de seguridad
  const inv6 = await createAdminInvitation(
    fakeFirestore,
    'sa_actor_uid',
    'superadmin',
    'owner@vigorcore.com',
    'stale_indeterminate@vigorcore.com',
    'admin'
  );
  memoryDb.adminInvitations[inv6.inviteId].status = 'redeeming';
  memoryDb.adminInvitations[inv6.inviteId].lockedBy = 'failed_worker_uid';
  memoryDb.adminInvitations[inv6.inviteId].lockedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
  // failed_worker_uid NO tiene rol en adminRoleState

  fakeAuth.users['intruder_uid'] = {
    uid: 'intruder_uid',
    email: 'stale_indeterminate@vigorcore.com',
    emailVerified: true,
    providerData: [{ providerId: 'password' }],
    metadata: {},
    customClaims: {},
  };

  let indeterminateBlocked = false;
  try {
    await acceptAdminInvitation(
      fakeFirestore,
      fakeAuth,
      'intruder_uid',
      'stale_indeterminate@vigorcore.com',
      true,
      inv6.inviteId,
      inv6.rawToken
    );
  } catch (err: any) {
    if (err.message.includes('Bloqueo de seguridad: La invitación quedó en estado de reserva indeterminado')) {
      indeterminateBlocked = true;
    }
  }
  assert('C.22 Lock estancado indeterminado activa bloqueo de seguridad preventivo (requiere admin)', indeterminateBlocked);

  // C.23: Fallo en fase 2 (aprovisionamiento Auth) ejecuta rollback de lock a status: pending
  const inv7 = await createAdminInvitation(
    fakeFirestore,
    'admin_actor_uid',
    'admin',
    'admin@vigorcore.com',
    'rollback@vigorcore.com',
    'athlete'
  );

  fakeAuth.users['rollback_uid'] = {
    uid: 'rollback_uid',
    email: 'rollback@vigorcore.com',
    emailVerified: true,
    providerData: [{ providerId: 'password' }],
    metadata: {},
    customClaims: {},
  };

  // Simular fallo en setCustomUserClaims
  const failingCustomAuth: any = {
    users: fakeAuth.users,
    getUser: async (uid: string) => fakeAuth.users[uid],
    setCustomUserClaims: async () => {
      throw new Error('Internal Auth network error');
    },
    revokeRefreshTokens: async () => {},
  };

  let rollbackErrorThrown = false;
  try {
    await acceptAdminInvitation(
      fakeFirestore,
      failingCustomAuth,
      'rollback_uid',
      'rollback@vigorcore.com',
      true,
      inv7.inviteId,
      inv7.rawToken
    );
  } catch (err: any) {
    if (err.message.includes('Internal Auth network error')) {
      rollbackErrorThrown = true;
    }
  }
  assert('C.23 Fallo durante aprovisionamiento de claims arroja error y ejecuta rollback', rollbackErrorThrown);
  assert('C.24 Rollback restaura invitación a status: pending para permitir posterior reintento', memoryDb.adminInvitations[inv7.inviteId].status === 'pending');

  console.log('\n========================================================================');
  console.log(` RESULTADOS INVITACIONES & SAGA DE CONCURRENCIA: ${passed} pasadas, ${failed} fallidas`);
  console.log('========================================================================\n');

  if (failed > 0) process.exit(1);
}

runInvitationsTests();
