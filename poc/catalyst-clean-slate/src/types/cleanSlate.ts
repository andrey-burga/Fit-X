/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 4.0.2 Frozen Clean-Slate Catalyst Data Model & Physical Schema
 *
 * Physical schema & contract updates (Phase 4.0.2):
 * - Freezes 5 Catalyst NoSQL tables, key types, additional sort keys (<= 5), and GSIs (<= 20).
 * - Replaces unbounded constant GSI partition keys with controlled distribution:
 *   * `Users.GSI_Directory`: deterministic 4-segment partition `directorySegment` (`USER_SEG#0..3`).
 *   * `AuditLogs.GSI_GlobalChronology`: quarterly period bucket `auditPeriodBucket` (`AUDIT_Q#YYYY-Q#`).
 * - Matches real `@zcatalyst/auth` `getCurrentUser()` schema (uses no undocumented token timestamps).
 * - Preserves `Users`, `AdminInvitations`, and `SystemControl` as PK-only (`sortKey: null`).
 */

import crypto from 'node:crypto';

export type TableName =
  | 'Users'
  | 'UserData'
  | 'AdminInvitations'
  | 'AuditLogs'
  | 'SystemControl';

export type UserRole = 'athlete' | 'admin' | 'superadmin';
export type AccountStatus = 'active' | 'suspended';
export type InviteStatus = 'pending' | 'redeeming' | 'redeemed' | 'revoked' | 'expired';

export type UserDataEntityType =
  | 'BIOMETRICS'
  | 'PREFERENCES'
  | 'GROCERY'
  | 'MEAL_LOG'
  | 'RECIPE'
  | 'MEAL_PLAN'
  | 'WORKOUT_ROUTINE'
  | 'EXECUTED_WORKOUT'
  | 'WORKOUT_SET'
  | 'CARDIO_SESSION'
  | 'NOTIFICATION';

export const CATALYST_PLATFORM_LIMITS = {
  MAX_ITEM_BYTES: 400 * 1024, // 400 KB official Catalyst NoSQL hard limit
  SAFE_PAYLOAD_BUDGET_BYTES: 350 * 1024, // App-enforced safety ceiling
  MAX_BATCH_WRITE_ITEMS: 25, // Catalyst NoSQL insertItems / updateItems / deleteItems max
  MAX_QUERY_READ_ITEMS: 100, // Catalyst NoSQL fetchItem / queryTable / queryIndex max per call
  MAX_SORT_KEYS_PER_TABLE: 5, // Primary SK + up to 4 additional SKs
  MAX_SECONDARY_INDEXES_PER_TABLE: 20, // Global secondary indexes per table
  ADVANCED_IO_TIMEOUT_MS: 30_000, // 30s hard execution limit (non-configurable)
} as const;

export const DIRECTORY_SEGMENT_COUNT = 4;
export const DIRECTORY_SEGMENTS = [
  'USER_SEG#0',
  'USER_SEG#1',
  'USER_SEG#2',
  'USER_SEG#3',
] as const;

export type SecondaryIndexProjection = 'ALL' | 'KEYS_ONLY' | 'SPECIFIC_ATTRIBUTES';

export interface SecondaryIndexSpec {
  indexName: string;
  partitionKey: string;
  partitionKeyType: 'String' | 'Number';
  sortKey?: string;
  sortKeyType?: 'String' | 'Number';
  projection: SecondaryIndexProjection;
  projectedAttributes?: string[];
  isUniqueConstraint: false; // Catalyst NoSQL secondary indexes NEVER enforce uniqueness
}

export interface TableSchemaSpec {
  tableName: TableName;
  partitionKey: string;
  partitionKeyType: 'String' | 'Number';
  sortKey: string | null; // Omitted in Catalyst NoSQL when 1 item per partition
  sortKeyType?: 'String';
  additionalSortKeys: Array<{ name: string; type: 'String' | 'Number' }>;
  secondaryIndexes: SecondaryIndexSpec[];
  ttlAttribute?: { name: string; type: 'Number' }; // Unix epoch seconds
}

/**
 * FROZEN Physical 5-Table Clean-Slate Registry (Phase 4.0.2 Schema Freeze).
 * Primary keys, additional sort keys, and index keys are immutable once created in Catalyst Console.
 */
export const TABLE_SCHEMA_REGISTRY: Record<TableName, TableSchemaSpec> = {
  Users: {
    tableName: 'Users',
    partitionKey: 'pk', // USER#<catalystUserId>
    partitionKeyType: 'String',
    sortKey: null, // 1 item per partition -> no redundant SK
    additionalSortKeys: [],
    secondaryIndexes: [
      {
        indexName: 'GSI_Email',
        partitionKey: 'normalizedEmail',
        partitionKeyType: 'String',
        projection: 'ALL',
        isUniqueConstraint: false,
      },
      {
        indexName: 'GSI_Directory',
        partitionKey: 'directorySegment', // USER_SEG#0..3 (controlled sharding eliminates single hot partition)
        partitionKeyType: 'String',
        sortKey: 'createdAt',
        sortKeyType: 'String',
        projection: 'SPECIFIC_ATTRIBUTES',
        projectedAttributes: [
          'pk',
          'uid',
          'email',
          'displayName',
          'role',
          'roleVersion',
          'accountStatus',
          'emailVerified',
          'directorySegment',
          'createdAt',
          'lastSignInAt',
        ],
        isUniqueConstraint: false,
      },
      {
        indexName: 'GSI_RoleStatus',
        partitionKey: 'role',
        partitionKeyType: 'String',
        sortKey: 'accountStatus',
        sortKeyType: 'String',
        projection: 'ALL',
        isUniqueConstraint: false,
      },
    ],
  },
  UserData: {
    tableName: 'UserData',
    partitionKey: 'pk', // USER#<catalystUserId>
    partitionKeyType: 'String',
    sortKey: 'sk', // <ENTITY_PREFIX>#...
    sortKeyType: 'String',
    additionalSortKeys: [
      { name: 'entityType', type: 'String' },
      { name: 'updatedAt', type: 'String' },
    ], // Total sort keys = 3 (<= 5)
    secondaryIndexes: [
      {
        indexName: 'GSI_UserEntityDate',
        partitionKey: 'pk',
        partitionKeyType: 'String',
        sortKey: 'entityDateKey', // <ENTITY_TYPE>#<ISO_DATE>#<id>
        sortKeyType: 'String',
        projection: 'ALL',
        isUniqueConstraint: false,
      },
    ],
  },
  AdminInvitations: {
    tableName: 'AdminInvitations',
    partitionKey: 'pk', // INVITE#<inviteId>
    partitionKeyType: 'String',
    sortKey: null, // 1 item per partition -> no redundant SK
    additionalSortKeys: [],
    secondaryIndexes: [
      {
        indexName: 'GSI_InviteEmailStatus',
        partitionKey: 'emailNormalized',
        partitionKeyType: 'String',
        sortKey: 'status',
        sortKeyType: 'String',
        projection: 'ALL',
        isUniqueConstraint: false,
      },
    ],
    ttlAttribute: { name: 'ttlEpochSec', type: 'Number' },
  },
  AuditLogs: {
    tableName: 'AuditLogs',
    partitionKey: 'pk', // AUDIT#<YYYY-MM> (shared monthly partition)
    partitionKeyType: 'String',
    sortKey: 'sk', // <invertedEpochMs>#<eventId>
    sortKeyType: 'String',
    additionalSortKeys: [
      { name: 'action', type: 'String' },
      { name: 'timestamp', type: 'String' },
    ], // Total sort keys = 3 (<= 5)
    secondaryIndexes: [
      {
        indexName: 'GSI_AuditActor',
        partitionKey: 'actorUid',
        partitionKeyType: 'String',
        sortKey: 'timestamp',
        sortKeyType: 'String',
        projection: 'ALL',
        isUniqueConstraint: false,
      },
      {
        indexName: 'GSI_AuditTarget',
        partitionKey: 'targetUid',
        partitionKeyType: 'String',
        sortKey: 'timestamp',
        sortKeyType: 'String',
        projection: 'ALL',
        isUniqueConstraint: false,
      },
      {
        indexName: 'GSI_GlobalChronology',
        partitionKey: 'auditPeriodBucket', // AUDIT_Q#<YYYY>-Q<1..4> -> bounded period bucket for cross-month timelines
        partitionKeyType: 'String',
        sortKey: 'globalChronologyKey', // <ISO_TIMESTAMP>#<eventId>
        sortKeyType: 'String',
        projection: 'ALL',
        isUniqueConstraint: false,
      },
    ],
  },
  SystemControl: {
    tableName: 'SystemControl',
    partitionKey: 'pk', // CTRL#BOOTSTRAP | CTRL#SUPERADMIN_COUNT | CTRL#SAGA#<idempotencyKey> | SESSION#<sid>
    partitionKeyType: 'String',
    sortKey: null, // 1 item per partition -> no redundant SK
    additionalSortKeys: [],
    secondaryIndexes: [],
    ttlAttribute: { name: 'ttlEpochSec', type: 'Number' },
  },
};

export const KeyBuilders = {
  userPk: (catalystUserId: string) => `USER#${assertNonEmptyId(catalystUserId, 'catalystUserId')}`,

  directorySegment: (catalystUserId: string): (typeof DIRECTORY_SEGMENTS)[number] => {
    const clean = assertNonEmptyId(catalystUserId, 'catalystUserId');
    const digest = crypto.createHash('sha256').update(clean, 'utf8').digest();
    const bucketIdx = digest[0] % DIRECTORY_SEGMENT_COUNT;
    return DIRECTORY_SEGMENTS[bucketIdx];
  },

  biometricsSk: () => 'BIO#current',
  preferencesSk: () => 'PREF#settings',
  grocerySk: (groceryId: string) => `GROCERY#${assertNonEmptyId(groceryId, 'groceryId')}`,
  mealSk: (dateTimeIso: string, mealLogId: string) =>
    `MEAL#${assertNonEmptyId(dateTimeIso, 'dateTimeIso')}#${assertNonEmptyId(mealLogId, 'mealLogId')}`,
  recipeSk: (recipeId: string) => `RECIPE#${assertNonEmptyId(recipeId, 'recipeId')}`,
  mealPlanSk: (weekStartIso: string) => `PLAN#${assertNonEmptyId(weekStartIso, 'weekStartIso')}`,
  routineSk: (routineId: string) => `ROUTINE#${assertNonEmptyId(routineId, 'routineId')}`,
  executedWorkoutSk: (startedAtIso: string, workoutId: string) =>
    `WORKOUT#${assertNonEmptyId(startedAtIso, 'startedAtIso')}#${assertNonEmptyId(workoutId, 'workoutId')}`,
  workoutSetSk: (executedWorkoutId: string, sessionId: string) =>
    `SET#${assertNonEmptyId(executedWorkoutId, 'executedWorkoutId')}#${assertNonEmptyId(sessionId, 'sessionId')}`,
  cardioSk: (dateIso: string, cardioId: string) =>
    `CARDIO#${assertNonEmptyId(dateIso, 'dateIso')}#${assertNonEmptyId(cardioId, 'cardioId')}`,
  notificationSk: (createdAtIso: string, notificationId: string) =>
    `NOTIF#${assertNonEmptyId(createdAtIso, 'createdAtIso')}#${assertNonEmptyId(notificationId, 'notificationId')}`,

  invitePk: (inviteId: string) => `INVITE#${assertNonEmptyId(inviteId, 'inviteId')}`,

  auditPk: (date: Date | string) => {
    const iso = typeof date === 'string' ? date : date.toISOString();
    return `AUDIT#${iso.slice(0, 7)}`; // AUDIT#YYYY-MM
  },
  auditPeriodBucket: (date: Date | string) => {
    const iso = typeof date === 'string' ? date : date.toISOString();
    const year = iso.slice(0, 4);
    const month = Number(iso.slice(5, 7));
    const quarter = Math.floor((month - 1) / 3) + 1;
    return `AUDIT_Q#${year}-Q${quarter}`; // e.g., AUDIT_Q#2026-Q4
  },
  auditSk: (epochMs: number, eventId: string) => {
    const inverted = String(9999999999999 - Math.floor(epochMs)).padStart(13, '0');
    return `${inverted}#${assertNonEmptyId(eventId, 'eventId')}`;
  },

  superadminCountPk: () => 'CTRL#SUPERADMIN_COUNT',
  bootstrapLockPk: () => 'CTRL#BOOTSTRAP',
  sagaPk: (idempotencyKey: string) => `CTRL#SAGA#${assertNonEmptyId(idempotencyKey, 'idempotencyKey')}`,
  sessionPk: (sid: string) => `SESSION#${assertNonEmptyId(sid, 'sid')}`,
};

export function enumerateQuarterBuckets(startIso: string, endIso: string): string[] {
  const startYear = Number(startIso.slice(0, 4));
  const startQuarter = Math.floor((Number(startIso.slice(5, 7)) - 1) / 3) + 1;
  const endYear = Number(endIso.slice(0, 4));
  const endQuarter = Math.floor((Number(endIso.slice(5, 7)) - 1) / 3) + 1;

  const buckets: string[] = [];
  let y = startYear;
  let q = startQuarter;
  while (y < endYear || (y === endYear && q <= endQuarter)) {
    buckets.push(`AUDIT_Q#${y}-Q${q}`);
    q++;
    if (q > 4) {
      q = 1;
      y++;
    }
    if (buckets.length > 40) break;
  }
  return buckets.reverse(); // descending chronological order
}

function assertNonEmptyId(val: string, fieldName: string): string {
  const trimmed = (val || '').trim();
  if (!trimmed || trimmed.includes('#')) {
    throw new Error(`Invalid key component '${fieldName}': must be non-empty and cannot contain '#' delimiter.`);
  }
  return trimmed;
}

/**
 * Real documented shape returned by `@zcatalyst/auth` `userManagement().getCurrentUser()`.
 * Strictly contains documented fields only (no undocumented token timestamps).
 */
export interface CatalystAuthCurrentUser {
  zuid: string;
  zaaid?: string;
  org_id?: string;
  user_id: string;
  status: 'ACTIVE' | 'NOT_CONFIRMED' | 'DISABLED' | string;
  is_confirmed: boolean;
  email_id: string;
  first_name?: string;
  last_name?: string;
  created_time?: string;
  modified_time?: string;
  user_type?: string;
  role_details?: {
    role_id: string;
    role_name: string;
  };
}

export interface AuthoritativeActor {
  catalystUserId: string;
  email: string;
  normalizedEmail: string;
  displayName: string;
  role: UserRole;
  roleVersion: number;
  sessionEpoch: number;
  accountStatus: AccountStatus;
  isConfirmed: boolean;
  sessionId?: string;
  sessionExpiresAtEpochSec?: number;
}

export interface UserAccountItem {
  pk: string; // USER#<catalystUserId>
  uid: string;
  email: string;
  normalizedEmail: string;
  displayName: string;
  profileLabel?: 'Atleta Pro' | 'Coach' | 'Nutricionista';
  role: UserRole;
  roleVersion: number;
  sessionEpoch: number; // Incremented on suspension/security reset/role change to invalidate stale app sessions
  accountStatus: AccountStatus;
  emailVerified: boolean;
  authProvider: string;
  directorySegment: (typeof DIRECTORY_SEGMENTS)[number];
  onboardingCompleted: boolean;
  onboardingStep: number;
  goal?: string;
  location?: string;
  suspensionReason?: string;
  suspendedAt?: string;
  suspendedBy?: string;
  createdAt: string;
  updatedAt: string;
  lastSignInAt: string;
}

export interface UserDataItem {
  pk: string; // USER#<catalystUserId>
  sk: string;
  uid: string;
  entityType: UserDataEntityType;
  entityId: string;
  entityDateKey: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface AdminInvitationItem {
  pk: string; // INVITE#<inviteId>
  inviteId: string;
  emailNormalized: string;
  targetRole: 'athlete' | 'admin';
  status: InviteStatus;
  tokenHash: string;
  createdBy: string;
  createdByEmail: string;
  createdAt: string;
  expiresAt: string;
  expiresAtEpochSec: number;
  ttlEpochSec: number;
  redeemedBy?: string;
  redeemedAt?: string;
  revokedBy?: string;
  revokedAt?: string;
  revokeReason?: string;
  lockHolderOpId?: string;
  lockExpiresAtMs?: number;
}

export interface AuditLogItem {
  pk: string; // AUDIT#YYYY-MM
  sk: string; // <invertedEpochMs>#<eventId>
  auditPeriodBucket: string; // AUDIT_Q#<YYYY>-Q<1..4>
  globalChronologyKey: string; // <ISO_TIMESTAMP>#<eventId>
  eventId: string;
  action: string;
  actorUid: string;
  actorRole: UserRole | 'system';
  actorEmail: string;
  targetUid: string;
  targetEmail?: string;
  timestamp: string;
  reason?: string;
  changes?: Record<string, unknown>;
}

export interface ControlSagaItem {
  pk: string; // CTRL#SAGA#<idempotencyKey>
  idempotencyKey: string;
  operationType: 'SET_ROLE' | 'SET_STATUS';
  payloadHash: string;
  step: 'STARTED' | 'USERS_UPDATED' | 'COMPLETED' | 'FAILED';
  targetUid: string;
  previousRole?: UserRole;
  requestedRole?: UserRole;
  previousStatus?: AccountStatus;
  requestedStatus?: AccountStatus;
  reservedDecrementVersion?: number;
  resultSnapshot?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  ttlEpochSec: number;
}

export interface SessionRecordItem {
  pk: string; // SESSION#<sid> inside SystemControl
  sid: string;
  ownerUserId: string;
  sessionEpoch: number;
  issuedAt: string;
  issuedAtEpochSec: number;
  initialAuthAtEpochSec?: number;
  expiresAt: string;
  expiresAtEpochSec: number;
  absoluteExpiresAtEpochSec?: number;
  lastCatalystCheckAtEpochSec?: number;
  rotatedAtEpochSec?: number;
  revokedAt?: string;
  revocationReason?: string;
  status: 'active' | 'revoked';
  ttlEpochSec: number; // Async cleanup ONLY; expiration checked strictly via expiresAtEpochSec
}
