export type UserRole = 'athlete' | 'admin' | 'superadmin';

export type AccountStatus = 'active' | 'suspended' | 'pending';

export interface AuthenticatedActor {
  userId: string;
  email: string;
  role: UserRole;
  status: 'ACTIVE' | 'DISABLED';
  isConfirmed: boolean;
  roleVersion: number;
  validAfter: number;
  authTime: number;
}

export interface FictionalAthleteRecord {
  pk: string; // POC#3.2#ATHLETE#<uid>
  sk: string; // RECORD#<recordId>
  ownerUid: string;
  fictionalMetric: string;
  fictionalValue: number;
  createdAt: number;
  updatedAt: number;
}

export interface FictionalLeaseLock {
  pk: string; // POC#3.2#LOCK#<resourceId>
  holderId: string;
  fencingToken: number;
  leaseExpiresAt: number;
  acquiredAt: number;
  resourcePayload?: Record<string, unknown>;
}

export interface FictionalSuperadminCounter {
  pk: string; // POC#3.2#SUPERADMIN_COUNT
  sk: string; // SINGLETON
  activeSuperadminCount: number;
  version: number;
  lastUpdated: number;
}

export type SagaStep = 
  | 'STARTED'
  | 'IAM_APPLIED'
  | 'NOSQL_APPLIED'
  | 'COMPLETED'
  | 'COMPENSATING'
  | 'FAILED';

export interface SagaState {
  sagaId: string;
  idempotencyKey: string;
  payloadHash: string;
  step: SagaStep;
  targetUserId: string;
  requestedRole: UserRole;
  previousRole?: UserRole;
  error?: string;
  createdAt: number;
  updatedAt: number;
}
