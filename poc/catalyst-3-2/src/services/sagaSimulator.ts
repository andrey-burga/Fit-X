import type { SagaState, SagaStep, UserRole } from '../types/actor.js';
import { TestRepository } from '../nosql/testRepository.js';

export interface SimulatedIAMAdapter {
  getUserRole(userId: string): Promise<UserRole>;
  updateUserRole(userId: string, newRole: UserRole): Promise<boolean>;
}

export class InMemorySimulatedIAMAdapter implements SimulatedIAMAdapter {
  private userRoles: Map<string, UserRole> = new Map();

  setUserRole(userId: string, role: UserRole) {
    this.userRoles.set(userId, role);
  }

  async getUserRole(userId: string): Promise<UserRole> {
    return this.userRoles.get(userId) || 'athlete';
  }

  async updateUserRole(userId: string, newRole: UserRole): Promise<boolean> {
    this.userRoles.set(userId, newRole);
    return true;
  }
}

export interface SagaExecutionOptions {
  simulateCrashAt?: 'BEFORE_IAM' | 'AFTER_IAM' | 'AFTER_NOSQL' | 'LOST_RESPONSE';
}

export class RoleChangeSagaCoordinator {
  private repository: TestRepository;
  private iamAdapter: SimulatedIAMAdapter;

  constructor(repository: TestRepository, iamAdapter: SimulatedIAMAdapter) {
    this.repository = repository;
    this.iamAdapter = iamAdapter;
  }

  private getSagaPk(idempotencyKey: string): string {
    return `POC#3.2#SAGA#${idempotencyKey}`;
  }

  /**
   * Execute role change saga with idempotency and state persistence
   */
  async executeRoleChange(
    idempotencyKey: string,
    targetUserId: string,
    requestedRole: UserRole,
    payloadHash: string,
    options: SagaExecutionOptions = {}
  ): Promise<{ success: boolean; state: SagaState; error?: string }> {
    const pk = this.getSagaPk(idempotencyKey);
    const sk = 'STATE';

    // 1. Check if saga already exists
    const existing = await this.repository.fetchFictionalItem(pk, sk);
    if (existing.item) {
      const stored = existing.item as unknown as SagaState;
      // If same key but different payload, reject immediately
      if (stored.payloadHash !== payloadHash) {
        throw new Error('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: The idempotency key was previously used with different parameters.');
      }
      // If already completed, return existing idempotent success
      if (stored.step === 'COMPLETED') {
        return { success: true, state: stored };
      }
    }

    const previousRole = await this.iamAdapter.getUserRole(targetUserId);

    // Initial state
    let currentState: SagaState = {
      sagaId: `saga_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      idempotencyKey,
      payloadHash,
      step: 'STARTED',
      targetUserId,
      requestedRole,
      previousRole,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Save initial state
    await this.repository.insertFictionalItem(pk, sk, currentState as unknown as Record<string, any>);

    // Crash simulation 1: Crash before IAM
    if (options.simulateCrashAt === 'BEFORE_IAM') {
      throw new Error('SIMULATED_CRASH: Process crashed before applying IAM changes.');
    }

    // 2. Apply IAM Role
    await this.iamAdapter.updateUserRole(targetUserId, requestedRole);
    currentState.step = 'IAM_APPLIED';
    currentState.updatedAt = Date.now();
    await this.repository.updateFictionalItemConditional(pk, sk, [
      { attribute: 'step', value: 'IAM_APPLIED' },
      { attribute: 'updatedAt', value: currentState.updatedAt },
    ]);

    // Crash simulation 2: Crash after IAM
    if (options.simulateCrashAt === 'AFTER_IAM') {
      throw new Error('SIMULATED_CRASH: Process crashed after applying IAM changes.');
    }

    // 3. Apply NoSQL role update
    const userRoleRecordPk = `POC#3.2#USER#${targetUserId}`;
    await this.repository.insertFictionalItem(userRoleRecordPk, 'PROFILE', {
      role: requestedRole,
      updatedAt: Date.now(),
    });

    currentState.step = 'NOSQL_APPLIED';
    currentState.updatedAt = Date.now();
    await this.repository.updateFictionalItemConditional(pk, sk, [
      { attribute: 'step', value: 'NOSQL_APPLIED' },
      { attribute: 'updatedAt', value: currentState.updatedAt },
    ]);

    // Crash simulation 3: Crash after NoSQL
    if (options.simulateCrashAt === 'AFTER_NOSQL') {
      throw new Error('SIMULATED_CRASH: Process crashed after NoSQL mutation.');
    }

    // 4. Mark COMPLETED
    currentState.step = 'COMPLETED';
    currentState.updatedAt = Date.now();
    await this.repository.updateFictionalItemConditional(pk, sk, [
      { attribute: 'step', value: 'COMPLETED' },
      { attribute: 'updatedAt', value: currentState.updatedAt },
    ]);

    // Crash simulation 4: Lost response after mutation
    if (options.simulateCrashAt === 'LOST_RESPONSE') {
      throw new Error('SIMULATED_NETWORK_FAILURE: Mutation committed but response lost in transit.');
    }

    return { success: true, state: currentState };
  }

  /**
   * Reconciler / Recovery Worker:
   * Inspects current state in IAM and NoSQL before deciding whether to resume forward or compensate.
   */
  async recoverIncompleteSaga(idempotencyKey: string): Promise<{ success: boolean; state: SagaState }> {
    const pk = this.getSagaPk(idempotencyKey);
    const sk = 'STATE';

    const res = await this.repository.fetchFictionalItem(pk, sk);
    if (!res.item) {
      throw new Error(`Saga with key ${idempotencyKey} not found.`);
    }

    const saga = res.item as unknown as SagaState;
    if (saga.step === 'COMPLETED') {
      return { success: true, state: saga };
    }

    const currentIamRole = await this.iamAdapter.getUserRole(saga.targetUserId);
    const userRecord = await this.repository.fetchFictionalItem(`POC#3.2#USER#${saga.targetUserId}`, 'PROFILE');
    const currentNosqlRole = userRecord.item ? (userRecord.item.role as UserRole) : undefined;

    // Intelligent reconciliation
    if (saga.step === 'IAM_APPLIED') {
      // IAM was applied, but NoSQL was not yet applied or was interrupted.
      // Resume forward: Apply NoSQL and mark completed.
      await this.repository.insertFictionalItem(`POC#3.2#USER#${saga.targetUserId}`, 'PROFILE', {
        role: saga.requestedRole,
        updatedAt: Date.now(),
      });
      saga.step = 'COMPLETED';
      saga.updatedAt = Date.now();
      await this.repository.updateFictionalItemConditional(pk, sk, [
        { attribute: 'step', value: 'COMPLETED' },
        { attribute: 'updatedAt', value: saga.updatedAt },
      ]);
      return { success: true, state: saga };
    }

    if (saga.step === 'STARTED') {
      // Process crashed before IAM was touched.
      // If IAM still has previous role, mark failed or compensate cleanly.
      if (currentIamRole === saga.previousRole) {
        saga.step = 'FAILED';
        saga.updatedAt = Date.now();
        await this.repository.updateFictionalItemConditional(pk, sk, [
          { attribute: 'step', value: 'FAILED' },
          { attribute: 'updatedAt', value: saga.updatedAt },
        ]);
        return { success: true, state: saga };
      }
    }

    if (saga.step === 'NOSQL_APPLIED') {
      // Both IAM and NoSQL mutations took place, only final completion marker was interrupted.
      saga.step = 'COMPLETED';
      saga.updatedAt = Date.now();
      await this.repository.updateFictionalItemConditional(pk, sk, [
        { attribute: 'step', value: 'COMPLETED' },
        { attribute: 'updatedAt', value: saga.updatedAt },
      ]);
      return { success: true, state: saga };
    }

    return { success: true, state: saga };
  }
}
