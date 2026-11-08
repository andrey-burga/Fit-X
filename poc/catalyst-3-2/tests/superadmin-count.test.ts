import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryNoSQLAdapter,
  setStorageAdapterForTesting,
} from '../src/nosql/catalystNosql.js';
import { TestRepository } from '../src/nosql/testRepository.js';

describe('Prueba 5 — Contador Atómico del Último Superadmin (POC#3.2#SUPERADMIN_COUNT)', () => {
  let memoryAdapter: InMemoryNoSQLAdapter;
  let repository: TestRepository;

  beforeEach(async () => {
    memoryAdapter = new InMemoryNoSQLAdapter();
    setStorageAdapterForTesting(memoryAdapter);
    repository = new TestRepository('VigorCorePoc');
    // Initialize counter with exactly 2 superadmins
    await repository.initializeSuperadminCounter(2);
  });

  it('debe decrementar de 2 a 1 con éxito y bloquear un segundo decremento concurrente', async () => {
    // Operation 1 attempts decrement
    const op1 = await repository.decrementSuperadminCounterAtomic();
    expect(op1.success).toBe(true);
    expect(op1.newCount).toBe(1);

    // Operation 2 attempts simultaneous/subsequent decrement: condition activeSuperadminCount > 1 fails!
    const op2 = await repository.decrementSuperadminCounterAtomic();
    expect(op2.success).toBe(false);
    expect(op2.error).toContain('CANNOT_DEMOTE_LAST_SUPERADMIN');

    // Final validated count in database remains strictly 1
    const finalState = await repository.fetchFictionalItem('POC#3.2#SUPERADMIN_COUNT', 'SINGLETON');
    expect(finalState.item?.activeSuperadminCount).toBe(1);
  });

  it('debe prevenir que el contador alcance 0 bajo condiciones concurrentes simultáneas', async () => {
    // Simulate simultaneous execution of two demotion requests
    const [resultA, resultB] = await Promise.all([
      repository.decrementSuperadminCounterAtomic(),
      repository.decrementSuperadminCounterAtomic(),
    ]);

    // Exactly one operation must succeed, and exactly one must fail
    const successes = [resultA, resultB].filter((r) => r.success);
    const failures = [resultA, resultB].filter((r) => !r.success);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].error).toContain('CANNOT_DEMOTE_LAST_SUPERADMIN');

    // Verify counter is exactly 1
    const finalState = await repository.fetchFictionalItem('POC#3.2#SUPERADMIN_COUNT', 'SINGLETON');
    expect(finalState.item?.activeSuperadminCount).toBe(1);
  });
});
