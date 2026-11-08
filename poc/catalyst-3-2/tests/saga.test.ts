import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryNoSQLAdapter,
  setStorageAdapterForTesting,
} from '../src/nosql/catalystNosql.js';
import { TestRepository } from '../src/nosql/testRepository.js';
import {
  RoleChangeSagaCoordinator,
  InMemorySimulatedIAMAdapter,
} from '../src/services/sagaSimulator.js';

describe('Prueba 6 — Sagas Persistidas, Idempotencia y Recuperación de Fallos', () => {
  let memoryAdapter: InMemoryNoSQLAdapter;
  let repository: TestRepository;
  let iamAdapter: InMemorySimulatedIAMAdapter;
  let coordinator: RoleChangeSagaCoordinator;

  beforeEach(() => {
    memoryAdapter = new InMemoryNoSQLAdapter();
    setStorageAdapterForTesting(memoryAdapter);
    repository = new TestRepository('VigorCorePoc');
    iamAdapter = new InMemorySimulatedIAMAdapter();
    iamAdapter.setUserRole('user_saga_target', 'athlete');
    coordinator = new RoleChangeSagaCoordinator(repository, iamAdapter);
  });

  it('1. debe ejecutar una saga completa y persistir el estado COMPLETED', async () => {
    const key = 'IDEMPOTENCY_KEY_001';
    const payloadHash = 'hash_payload_admin';

    const result = await coordinator.executeRoleChange(
      key,
      'user_saga_target',
      'admin',
      payloadHash
    );

    expect(result.success).toBe(true);
    expect(result.state.step).toBe('COMPLETED');
    expect(await iamAdapter.getUserRole('user_saga_target')).toBe('admin');

    const userProfile = await repository.fetchFictionalItem('POC#3.2#USER#user_saga_target', 'PROFILE');
    expect(userProfile.item?.role).toBe('admin');
  });

  it('2. debe ser idempotente ante reintentos con la misma idempotency key y mismo payload', async () => {
    const key = 'IDEMPOTENCY_KEY_002';
    const payloadHash = 'hash_payload_admin';

    // First execution
    const res1 = await coordinator.executeRoleChange(key, 'user_saga_target', 'admin', payloadHash);
    expect(res1.success).toBe(true);
    expect(res1.state.step).toBe('COMPLETED');

    // Duplicate retry
    const res2 = await coordinator.executeRoleChange(key, 'user_saga_target', 'admin', payloadHash);
    expect(res2.success).toBe(true);
    expect(res2.state.step).toBe('COMPLETED');
    expect(res2.state.sagaId).toBe(res1.state.sagaId); // Same saga state returned without re-executing
  });

  it('3. debe rechazar reintento con la misma key pero payload diferente (IDEMPOTENCY_KEY_PAYLOAD_MISMATCH)', async () => {
    const key = 'IDEMPOTENCY_KEY_003';

    await coordinator.executeRoleChange(key, 'user_saga_target', 'admin', 'hash_admin');

    await expect(
      coordinator.executeRoleChange(key, 'user_saga_target', 'superadmin', 'hash_superadmin')
    ).rejects.toThrow(/IDEMPOTENCY_KEY_PAYLOAD_MISMATCH/);
  });

  it('4. debe recuperar una saga interrumpida tras aplicar IAM pero antes de NoSQL (IAM_APPLIED)', async () => {
    const key = 'IDEMPOTENCY_KEY_004';
    const payloadHash = 'hash_admin';

    // Simulate crash after IAM applied
    await expect(
      coordinator.executeRoleChange(key, 'user_saga_target', 'admin', payloadHash, {
        simulateCrashAt: 'AFTER_IAM',
      })
    ).rejects.toThrow(/SIMULATED_CRASH/);

    // Verify IAM was updated but NoSQL was not yet finalized
    expect(await iamAdapter.getUserRole('user_saga_target')).toBe('admin');
    const incompleteSaga = await repository.fetchFictionalItem(`POC#3.2#SAGA#${key}`, 'STATE');
    expect(incompleteSaga.item?.step).toBe('IAM_APPLIED');

    // Recovery worker reconciles: advances forward, syncs NoSQL and marks COMPLETED
    const recovery = await coordinator.recoverIncompleteSaga(key);
    expect(recovery.success).toBe(true);
    expect(recovery.state.step).toBe('COMPLETED');

    const syncedNoSQL = await repository.fetchFictionalItem('POC#3.2#USER#user_saga_target', 'PROFILE');
    expect(syncedNoSQL.item?.role).toBe('admin');
  });

  it('5. debe marcar FAILED una saga que cayó antes de tocar IAM (STARTED)', async () => {
    const key = 'IDEMPOTENCY_KEY_005';
    const payloadHash = 'hash_admin';

    // Simulate crash before IAM
    await expect(
      coordinator.executeRoleChange(key, 'user_saga_target', 'admin', payloadHash, {
        simulateCrashAt: 'BEFORE_IAM',
      })
    ).rejects.toThrow(/SIMULATED_CRASH/);

    // Recovery reconciles: IAM untouched, marks saga FAILED
    const recovery = await coordinator.recoverIncompleteSaga(key);
    expect(recovery.success).toBe(true);
    expect(recovery.state.step).toBe('FAILED');
    expect(await iamAdapter.getUserRole('user_saga_target')).toBe('athlete');
  });
});
