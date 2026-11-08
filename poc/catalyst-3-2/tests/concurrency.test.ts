import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryNoSQLAdapter,
  setStorageAdapterForTesting,
} from '../src/nosql/catalystNosql.js';
import { TestRepository } from '../src/nosql/testRepository.js';

describe('Prueba 4 — Concurrencia Real, Lease Locks y Fencing Tokens', () => {
  let memoryAdapter: InMemoryNoSQLAdapter;
  let repository: TestRepository;

  beforeEach(() => {
    memoryAdapter = new InMemoryNoSQLAdapter();
    setStorageAdapterForTesting(memoryAdapter);
    repository = new TestRepository('VigorCorePoc');
  });

  it('debe otorgar el lease lock a la primera solicitud y rechazar la segunda concurrente', async () => {
    const resourceId = 'WORKOUT_SESSION_777';
    const worker1 = 'WORKER_NODE_A';
    const worker2 = 'WORKER_NODE_B';

    // Worker 1 acquires lock
    const res1 = await repository.acquireLeaseLock(resourceId, worker1, 10000);
    expect(res1.success).toBe(true);
    expect(res1.fencingToken).toBe(1);

    // Worker 2 attempts concurrent acquisition while lease is active
    const res2 = await repository.acquireLeaseLock(resourceId, worker2, 10000);
    expect(res2.success).toBe(false);
    expect(res2.error).toContain('CONDITIONAL_CHECK_FAILED');
  });

  it('debe permitir que un nuevo worker adquiera el lock con fencing token incrementado tras la expiración', async () => {
    const resourceId = 'WORKOUT_SESSION_888';
    const worker1 = 'WORKER_NODE_A';
    const worker2 = 'WORKER_NODE_B';

    // Worker 1 acquires lock with short duration (0ms simulates already expired)
    const res1 = await repository.acquireLeaseLock(resourceId, worker1, -100);
    expect(res1.success).toBe(true);
    expect(res1.fencingToken).toBe(1);

    // Worker 2 acquires after expiration: Condition leaseExpiresAt < now evaluates to true!
    const res2 = await repository.acquireLeaseLock(resourceId, worker2, 5000);
    expect(res2.success).toBe(true);
    expect(res2.fencingToken).toBe(2); // Monotonically incremented fencing token
  });

  it('debe rechazar la liberación del lock si el worker o el fencing token no coinciden', async () => {
    const resourceId = 'WORKOUT_SESSION_999';
    const worker1 = 'WORKER_NODE_A';
    const staleWorker = 'WORKER_NODE_STALE';

    const res1 = await repository.acquireLeaseLock(resourceId, worker1, 10000);
    expect(res1.success).toBe(true);
    const token = res1.fencingToken!;

    // Stale worker attempts to release with wrong identity or wrong token
    const invalidRelease = await repository.releaseLeaseLock(resourceId, staleWorker, token);
    expect(invalidRelease.success).toBe(false);
    expect(invalidRelease.error).toContain('CONDITIONAL_CHECK_FAILED');

    // Valid release by worker1 with matching token
    const validRelease = await repository.releaseLeaseLock(resourceId, worker1, token);
    expect(validRelease.success).toBe(true);
  });
});
