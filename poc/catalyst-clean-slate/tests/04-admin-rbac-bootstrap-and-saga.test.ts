/**
 * Classification: PASS-UNIT / PASS-MOCK
 * Covers Objectives 1 & 2:
 * - Offline bootstrap single execution, repeated bootstrap rejection, and lost-response recovery.
 * - Automatic superadmin mutations DISABLED BY DEFAULT until live PASS-INTEGRATION.
 * - Unprovisioned counter detection (`SUPERADMIN_COUNTER_NOT_PROVISIONED`) & explicit operator provisioning.
 * - Timeout recovery (`TIMEOUT_AFTER_APPLY` & `TIMEOUT_BEFORE_APPLY`) with mandatory `consistentRead: true`
 *   before any retry, preventing double-decrement.
 * - Concurrent superadmin demotions, counter drift detection, and idempotent saga retry.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import { CleanSlateAuthGuard, MockCatalystAuthRuntime } from '../src/auth/cleanSlateAuthGuard.js';
import { AdminGovernanceError, AdminGovernanceService } from '../src/services/adminGovernanceService.js';
import { KeyBuilders } from '../src/types/cleanSlate.js';

async function setupGovernance(enableSuperadminMutationsForSagaTest = false) {
  let nowSec = 1_760_000_000;
  const db = new CleanSlateInMemoryNoSQLAdapter(() => nowSec);
  const auth = new MockCatalystAuthRuntime();
  const guard = new CleanSlateAuthGuard(auth, db);
  const admin = new AdminGovernanceService(db, auth, () => nowSec * 1000, {
    liveAtomicityVerifiedForSuperadminMutations: enableSuperadminMutationsForSagaTest,
  });

  async function registerAndAuth(userId: string, email: string) {
    auth.setCurrentUser({
      zuid: `z_${userId}`,
      user_id: userId,
      email_id: email,
      status: 'ACTIVE',
      is_confirmed: true,
    });
    return guard.bootstrapAuthenticatedProfile({});
  }

  return { db, auth, guard, admin, registerAndAuth };
}

test('[PASS-MOCK] Public HTTP bootstrap prohibited; offline bootstrap executes once, recovers lost response, and blocks second bootstrap', async () => {
  const { db, admin, registerAndAuth } = await setupGovernance(false);
  await registerAndAuth('cat_founder', 'founder@vigor.co');

  await assert.rejects(
    () =>
      admin.executeOfflineAdminBootstrap({
        offlineCliAuthorized: false,
        targetCatalystUserId: 'cat_founder',
        operatorTicketId: 'CHG-001',
      }),
    (err: any) => err instanceof AdminGovernanceError && err.code === 'PUBLIC_BOOTSTRAP_PROHIBITED'
  );

  // Simulate partial offline run where CTRL#BOOTSTRAP wrote but counter/Users failed (lost response mid-run)
  await db.insertItem('SystemControl', {
    pk: KeyBuilders.bootstrapLockPk(),
    status: 'CLAIMED',
    claimedByUid: 'cat_founder',
    operatorTicketId: 'CHG-001',
    claimedAt: '2026-11-13T10:00:00Z',
  });

  // Re-running with SAME ticket & target user recovers cleanly and verifies post-state
  const recovered = await admin.executeOfflineAdminBootstrap({
    offlineCliAuthorized: true,
    targetCatalystUserId: 'cat_founder',
    operatorTicketId: 'CHG-001',
  });
  assert.equal(recovered.bootstrapped, true);
  assert.equal(recovered.recoveredFromPartialRun, true);
  assert.equal(recovered.user.role, 'superadmin');
  assert.equal(recovered.verification.bootstrapStatus, 'CLAIMED');
  assert.equal(recovered.verification.superadminCount, 1);

  // Repeated bootstrap attempt (same or second user) is strictly rejected
  await registerAndAuth('cat_second', 'second@vigor.co');
  await assert.rejects(
    () =>
      admin.executeOfflineAdminBootstrap({
        offlineCliAuthorized: true,
        targetCatalystUserId: 'cat_second',
        operatorTicketId: 'CHG-002',
      }),
    (err: any) => err instanceof AdminGovernanceError && err.code === 'BOOTSTRAP_ALREADY_COMPLETED'
  );
});

test('[PASS-MOCK] Automatic superadmin role/status mutations are DISABLED BY DEFAULT until live PASS-INTEGRATION', async () => {
  const { admin, registerAndAuth } = await setupGovernance(false);
  await registerAndAuth('cat_sa', 'sa@vigor.co');
  await admin.executeOfflineAdminBootstrap({
    offlineCliAuthorized: true,
    targetCatalystUserId: 'cat_sa',
    operatorTicketId: 'CHG-001',
  });
  const saActor = await registerAndAuth('cat_sa', 'sa@vigor.co');

  await assert.rejects(
    () => admin.setUserRole(saActor, 'cat_sa', 'admin'),
    (err: any) => err instanceof AdminGovernanceError && err.code === 'SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED'
  );

  await assert.rejects(
    () => admin.setUserStatus(saActor, 'cat_sa', 'suspended'),
    (err: any) => err instanceof AdminGovernanceError
  );
});

test('[PASS-MOCK] Unprovisioned CTRL#SUPERADMIN_COUNT blocks reservation until explicit operator provisioning', async () => {
  const { db, admin, registerAndAuth } = await setupGovernance(true);
  await registerAndAuth('cat_sa_1', 'sa1@vigor.co');
  await registerAndAuth('cat_sa_2', 'sa2@vigor.co');
  // Seed two superadmins directly without CTRL#SUPERADMIN_COUNT
  await db.updateItem('Users', { pk: 'USER#cat_sa_1' }, { role: 'superadmin' });
  await db.updateItem('Users', { pk: 'USER#cat_sa_2' }, { role: 'superadmin' });
  const sa1 = await registerAndAuth('cat_sa_1', 'sa1@vigor.co');

  // Must fail with SUPERADMIN_COUNTER_NOT_PROVISIONED (never silently reserve or invent counter)
  await assert.rejects(
    () => admin.setUserRole(sa1, 'cat_sa_2', 'admin', { idempotencyKey: 'no_counter_yet' }),
    (err: any) => err instanceof AdminGovernanceError && err.code === 'SUPERADMIN_COUNTER_NOT_PROVISIONED'
  );

  // Explicit offline provisioning creates CTRL#SUPERADMIN_COUNT = 2
  const counter = await admin.provisionSuperadminCounterFromOperator({
    offlineCliAuthorized: true,
    operatorTicketId: 'CHG-PROV-01',
  });
  assert.equal(counter.activeSuperadminCount, 2);

  // Now demotion executes cleanly leaving 1 superadmin
  const res = await admin.setUserRole(sa1, 'cat_sa_2', 'admin', { idempotencyKey: 'after_prov' });
  assert.equal(res.role, 'admin');
});

test('[PASS-MOCK] Timeout during conditional reservation triggers mandatory consistentRead before retry (zero double-decrement)', async () => {
  const { db, admin, registerAndAuth } = await setupGovernance(true);
  await registerAndAuth('cat_sa_1', 'sa1@vigor.co');
  await admin.executeOfflineAdminBootstrap({
    offlineCliAuthorized: true,
    targetCatalystUserId: 'cat_sa_1',
    operatorTicketId: 'CHG-001',
  });
  const sa1 = await registerAndAuth('cat_sa_1', 'sa1@vigor.co');
  await registerAndAuth('cat_sa_2', 'sa2@vigor.co');
  await admin.setUserRole(sa1, 'cat_sa_2', 'superadmin', { idempotencyKey: 'prom_sa2' });

  // Inject TIMEOUT_AFTER_APPLY on SystemControl during demotion of sa_2:
  // Counter IS decremented remotely before timeout; handler MUST read consistent counter and NOT double-decrement.
  db.fetchAuditTrail.length = 0;
  db.injectNextUpdateFault('SystemControl', 'TIMEOUT_AFTER_APPLY');
  const demoted = await admin.setUserRole(sa1, 'cat_sa_2', 'admin', { idempotencyKey: 'demote_timeout_after' });
  assert.equal(demoted.role, 'admin');

  const consistentReadsOnCounter = db.fetchAuditTrail.filter(
    f => f.table === 'SystemControl' && f.pk === KeyBuilders.superadminCountPk() && f.consistent_read
  );
  assert.ok(consistentReadsOnCounter.length >= 2);
  assert.equal(consistentReadsOnCounter[0].sdkPayload.consistent_read, true);

  const counterAfter = await db.fetchItem<any>('SystemControl', { pk: KeyBuilders.superadminCountPk() }, { consistent_read: true });
  assert.equal(counterAfter.activeSuperadminCount, 1);

  // Re-promote sa_2 and test TIMEOUT_BEFORE_APPLY -> consistent_read confirms unapplied -> safe conditional retry succeeds
  await admin.setUserRole(sa1, 'cat_sa_2', 'superadmin', { idempotencyKey: 'reprom_sa2' });
  db.injectNextUpdateFault('SystemControl', 'TIMEOUT_BEFORE_APPLY');
  const demoted2 = await admin.setUserRole(sa1, 'cat_sa_2', 'admin', { idempotencyKey: 'demote_timeout_before' });
  assert.equal(demoted2.role, 'admin');
  const counterFinal = await db.fetchItem<any>('SystemControl', { pk: KeyBuilders.superadminCountPk() }, { consistent_read: true });
  assert.equal(counterFinal.activeSuperadminCount, 1);

  // Verify counter NEVER drops below 0 on final active superadmin demotion attempt
  await assert.rejects(
    () => admin.setUserRole(sa1, 'cat_sa_1', 'admin', { idempotencyKey: 'demote_last_sa1' }),
    (err: any) => err instanceof AdminGovernanceError && err.code === 'LAST_SUPERADMIN_PROTECTED'
  );
  const counterNeverNegative = await db.fetchItem<any>('SystemControl', { pk: KeyBuilders.superadminCountPk() }, { consistent_read: true });
  assert.equal(counterNeverNegative.activeSuperadminCount, 1);
});

test('[PASS-MOCK] Concurrent superadmin mutations, counter drift detection, lost-response crash recovery, and idempotent retry', async () => {
  const { db, admin, registerAndAuth } = await setupGovernance(true);
  await registerAndAuth('cat_sa_1', 'sa1@vigor.co');
  await admin.executeOfflineAdminBootstrap({
    offlineCliAuthorized: true,
    targetCatalystUserId: 'cat_sa_1',
    operatorTicketId: 'CHG-001',
  });
  const sa1 = await registerAndAuth('cat_sa_1', 'sa1@vigor.co');

  await registerAndAuth('cat_sa_2', 'sa2@vigor.co');
  const opKey = 'op_promote_sa2_001';

  await assert.rejects(
    () =>
      admin.setUserRole(sa1, 'cat_sa_2', 'superadmin', {
        idempotencyKey: opKey,
        simulateCrashAfterUsersWrite: true,
      }),
    /SIMULATED_CRASH_AFTER_USERS_WRITE/
  );

  await assert.rejects(
    () => admin.assertNoSuperadminCounterDrift(),
    (err: any) => err instanceof AdminGovernanceError && err.code === 'SUPERADMIN_COUNTER_DRIFT_DETECTED'
  );

  const recovered = await admin.setUserRole(sa1, 'cat_sa_2', 'superadmin', { idempotencyKey: opKey });
  assert.equal(recovered.role, 'superadmin');

  const driftCheck = await admin.assertNoSuperadminCounterDrift();
  assert.equal(driftCheck.activeCount, 2);

  const idempotentReplay = await admin.setUserRole(sa1, 'cat_sa_2', 'superadmin', { idempotencyKey: opKey });
  assert.equal(idempotentReplay.roleVersion, recovered.roleVersion);

  const sa2 = await registerAndAuth('cat_sa_2', 'sa2@vigor.co');
  const [resA, resB] = await Promise.allSettled([
    admin.setUserRole(sa1, 'cat_sa_2', 'admin', { idempotencyKey: 'demote_sa2' }),
    admin.setUserRole(sa2, 'cat_sa_1', 'admin', { idempotencyKey: 'demote_sa1' }),
  ]);

  const succeeded = [resA, resB].filter(r => r.status === 'fulfilled');
  const rejected = [resA, resB].filter(r => r.status === 'rejected');
  const remaining = await db.queryIndex<any>('Users', {
    indexName: 'GSI_RoleStatus',
    partitionKeyValue: 'superadmin',
    sortKeyEquals: 'active',
  });
  assert.equal(succeeded.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(remaining.items.length, 1);
});

test('[PASS-MOCK] Admin invitation creation, revocation, and simultaneous redemption lock', async () => {
  const { admin, registerAndAuth } = await setupGovernance(false);
  await registerAndAuth('cat_sa', 'sa@vigor.co');
  await admin.executeOfflineAdminBootstrap({
    offlineCliAuthorized: true,
    targetCatalystUserId: 'cat_sa',
    operatorTicketId: 'CHG-001',
  });
  const saActor = await registerAndAuth('cat_sa', 'sa@vigor.co');

  await registerAndAuth('cat_adm_1', 'adm1@vigor.co');
  const inv = await admin.createInvitation(saActor, 'adm1@vigor.co', 'admin');
  const adm1 = await registerAndAuth('cat_adm_1', 'adm1@vigor.co');

  const [r1, r2] = await Promise.allSettled([
    admin.redeemInvitation(adm1, inv.inviteId, inv.rawToken),
    admin.redeemInvitation(adm1, inv.inviteId, inv.rawToken),
  ]);
  assert.equal([r1, r2].filter(r => r.status === 'fulfilled').length, 1);
  assert.equal([r1, r2].filter(r => r.status === 'rejected').length, 1);

  const inv2 = await admin.createInvitation(saActor, 'other@vigor.co', 'athlete');
  const rev = await admin.revokeInvitation(saActor, inv2.inviteId, 'Cancelada');
  assert.equal(rev.revoked, true);
});
