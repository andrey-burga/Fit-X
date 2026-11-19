/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 5.0 Concrete Catalyst NoSQL Per-Table Providers (5 Frozen Tables)
 *
 * Implements strictly typed, schema-bound providers for:
 * 1. `Users`            (PK: `pk`, PK-only, GSIs: `GSI_Email`, `GSI_Directory`, `GSI_RoleStatus`, TTL: NONE)
 * 2. `UserData`         (PK: `pk`, SK: `sk`, GSI: `GSI_UserEntityDate`, TTL: NONE, <= 350 KB soft budget)
 * 3. `AdminInvitations` (PK: `pk`, PK-only, GSI: `GSI_InviteEmailStatus`, TTL: `ttlEpochSec`)
 * 4. `AuditLogs`        (PK: `pk`, SK: `sk`, GSIs: `GSI_AuditActor`, `GSI_AuditTarget`, `GSI_GlobalChronology`, append-only, TTL: NONE)
 * 5. `SystemControl`    (PK: `pk`, PK-only, TTL: `ttlEpochSec`, atomic counters/sessions/sagas/locks)
 */

import type { NoSQL } from '@zcatalyst/nosql';
import type { CatalystApp } from '@zcatalyst/auth-admin';
import {
  CATALYST_PLATFORM_LIMITS,
  DIRECTORY_SEGMENTS,
  KeyBuilders,
  type AccountStatus,
  type AdminInvitationItem,
  type AuditLogItem,
  type ControlSagaItem,
  type InviteStatus,
  type SessionRecordItem,
  type UserAccountItem,
  type UserDataItem,
  type UserRole,
} from '../../types/cleanSlate.js';
import type {
  ConditionExpr,
  ICleanSlateNoSQLAdapter,
  QueryPageResult,
  TableKey,
  UpdateItemResult,
} from '../cleanSlateEngine.js';
import {
  BaseCatalystTableProvider,
  createCatalystLiveNoSQLAdapter,
} from './baseTableProvider.js';

export interface SuperadminCountControlRecord {
  pk: 'CTRL#SUPERADMIN_COUNT';
  activeSuperadminCount: number;
  version: number;
  updatedAt: string;
  ttlEpochSec?: number;
}

export class UsersTableProvider extends BaseCatalystTableProvider<UserAccountItem> {
  constructor(adapter: ICleanSlateNoSQLAdapter) {
    super('Users', adapter);
  }

  async fetchUserByUid(uid: string, consistentRead = true): Promise<UserAccountItem | null> {
    return this.fetchByKey({ pk: KeyBuilders.userPk(uid) }, { consistent_read: consistentRead });
  }

  async findByNormalizedEmail(
    email: string,
    consistentRead = true
  ): Promise<UserAccountItem[]> {
    const normalized = email.toLowerCase().trim();
    if (!normalized) return [];
    const page = await this.queryBySecondaryIndex({
      indexName: 'GSI_Email',
      partitionKeyValue: normalized,
      consistent_read: consistentRead,
      limit: 25,
    });
    return page.items;
  }

  async listDirectorySegment(
    segment: (typeof DIRECTORY_SEGMENTS)[number],
    options: {
      startKey?: string;
      limit?: number;
      scanDescending?: boolean;
      consistent_read?: boolean;
    } = {}
  ): Promise<QueryPageResult<UserAccountItem>> {
    return this.queryBySecondaryIndex({
      indexName: 'GSI_Directory',
      partitionKeyValue: segment,
      startKey: options.startKey,
      limit: options.limit,
      scanDescending: options.scanDescending ?? true,
      consistent_read: options.consistent_read ?? false,
    });
  }

  async listAllDirectorySegmentsConcurrently(
    options: { limitPerSegment?: number; consistent_read?: boolean } = {}
  ): Promise<UserAccountItem[]> {
    const pages = await Promise.all(
      DIRECTORY_SEGMENTS.map(seg =>
        this.listDirectorySegment(seg, {
          limit: options.limitPerSegment ?? CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
          consistent_read: options.consistent_read ?? true,
        })
      )
    );
    return pages.flatMap(p => p.items);
  }

  async queryByRoleStatus(
    role: UserRole,
    accountStatus?: AccountStatus,
    options: { limit?: number; startKey?: string; consistent_read?: boolean } = {}
  ): Promise<QueryPageResult<UserAccountItem>> {
    return this.queryBySecondaryIndex({
      indexName: 'GSI_RoleStatus',
      partitionKeyValue: role,
      ...(accountStatus ? { sortKeyEquals: accountStatus } : {}),
      limit: options.limit,
      startKey: options.startKey,
      consistent_read: options.consistent_read ?? true,
    });
  }

  async insertUser(user: UserAccountItem): Promise<{ inserted: boolean; error?: string }> {
    const sizeBytes = Buffer.byteLength(JSON.stringify(user), 'utf8');
    if (sizeBytes > CATALYST_PLATFORM_LIMITS.SAFE_PAYLOAD_BUDGET_BYTES) {
      throw new Error(
        `USERS_ITEM_BUDGET_EXCEEDED: Users item (${sizeBytes} bytes) exceeds 350 KB safety ceiling.`
      );
    }
    return this.insertItem(user, { type: 'attribute_not_exists', attr: 'pk' });
  }

  async bumpSessionEpoch(
    uid: string,
    expectedEpoch: number,
    nowIso: string
  ): Promise<UpdateItemResult<UserAccountItem>> {
    const key: TableKey = { pk: KeyBuilders.userPk(uid) };
    return this.withTimeoutRecovery(
      () =>
        this.updateItem(
          key,
          { sessionEpoch: expectedEpoch + 1, updatedAt: nowIso },
          { type: 'equals', attr: 'sessionEpoch', value: expectedEpoch }
        ),
      async () => {
        const fresh = await this.fetchByKey(key, { consistent_read: true });
        if (fresh && fresh.sessionEpoch >= expectedEpoch + 1) {
          return {
            updated: true,
            status: 'Success',
            httpStatus: 200,
            response: { operation: 'UPDATE', size: 1, update: [{ status: 'Success' }] } as any,
            payload: {} as any,
            item: fresh,
          };
        }
        return this.updateItem(
          key,
          { sessionEpoch: (fresh?.sessionEpoch ?? expectedEpoch) + 1, updatedAt: nowIso },
          { type: 'equals', attr: 'sessionEpoch', value: fresh?.sessionEpoch ?? expectedEpoch }
        );
      }
    );
  }
}

export class UserDataTableProvider extends BaseCatalystTableProvider<UserDataItem> {
  constructor(adapter: ICleanSlateNoSQLAdapter) {
    super('UserData', adapter);
  }

  async fetchEntity(
    uid: string,
    sk: string,
    consistentRead = true
  ): Promise<UserDataItem | null> {
    return this.fetchByKey(
      { pk: KeyBuilders.userPk(uid), sk },
      { consistent_read: consistentRead }
    );
  }

  async listUserPartition(
    uid: string,
    options: {
      sortKeyPrefix?: string;
      sortKeyBetween?: [string, string];
      limit?: number;
      startKey?: string;
      scanDescending?: boolean;
      consistent_read?: boolean;
    } = {}
  ): Promise<QueryPageResult<UserDataItem>> {
    return this.queryByPartition({
      partitionKeyValue: KeyBuilders.userPk(uid),
      sortKeyPrefix: options.sortKeyPrefix,
      sortKeyBetween: options.sortKeyBetween,
      limit: options.limit,
      startKey: options.startKey,
      scanDescending: options.scanDescending,
      consistent_read: options.consistent_read ?? true,
    });
  }

  async queryEntityDateIndex(
    uid: string,
    options: {
      entityDatePrefix?: string;
      entityDateBetween?: [string, string];
      limit?: number;
      startKey?: string;
      scanDescending?: boolean;
      consistent_read?: boolean;
    } = {}
  ): Promise<QueryPageResult<UserDataItem>> {
    return this.queryBySecondaryIndex({
      indexName: 'GSI_UserEntityDate',
      partitionKeyValue: KeyBuilders.userPk(uid),
      sortKeyPrefix: options.entityDatePrefix,
      sortKeyBetween: options.entityDateBetween,
      limit: options.limit,
      startKey: options.startKey,
      scanDescending: options.scanDescending,
      consistent_read: options.consistent_read ?? true,
    });
  }

  async upsertEntity(
    item: UserDataItem,
    condition?: ConditionExpr
  ): Promise<{ inserted: boolean; error?: string }> {
    if (!item.pk.startsWith('USER#')) {
      throw new Error('USERDATA_PARTITION_VIOLATION: pk must start with USER#.');
    }
    const bytes = Buffer.byteLength(JSON.stringify(item), 'utf8');
    if (bytes > CATALYST_PLATFORM_LIMITS.SAFE_PAYLOAD_BUDGET_BYTES) {
      throw new Error(
        `USERDATA_SOFT_BUDGET_EXCEEDED: Item '${item.sk}' (${bytes} bytes) exceeds 350 KB safety ceiling.`
      );
    }
    return this.insertItem(item, condition);
  }

  async updateEntityVersioned(
    uid: string,
    sk: string,
    expectedVersion: number,
    updates: Partial<UserDataItem>
  ): Promise<UpdateItemResult<UserDataItem>> {
    return this.updateItem(
      { pk: KeyBuilders.userPk(uid), sk },
      updates,
      { type: 'equals', attr: 'version', value: expectedVersion }
    );
  }
}

export class AdminInvitationsTableProvider extends BaseCatalystTableProvider<AdminInvitationItem> {
  constructor(adapter: ICleanSlateNoSQLAdapter) {
    super('AdminInvitations', adapter);
  }

  async fetchInvitation(inviteId: string, consistentRead = true): Promise<AdminInvitationItem | null> {
    return this.fetchByKey(
      { pk: KeyBuilders.invitePk(inviteId) },
      { consistent_read: consistentRead }
    );
  }

  async findByEmailAndStatus(
    emailNormalized: string,
    status?: InviteStatus,
    consistentRead = true
  ): Promise<AdminInvitationItem[]> {
    const page = await this.queryBySecondaryIndex({
      indexName: 'GSI_InviteEmailStatus',
      partitionKeyValue: emailNormalized.toLowerCase().trim(),
      ...(status ? { sortKeyEquals: status } : {}),
      consistent_read: consistentRead,
      limit: 50,
    });
    return page.items;
  }

  isInvitationExpired(item: AdminInvitationItem, nowSec = Math.floor(Date.now() / 1000)): boolean {
    return !Number.isFinite(item.expiresAtEpochSec) || item.expiresAtEpochSec <= nowSec;
  }

  async createInvitation(item: AdminInvitationItem): Promise<{ inserted: boolean; error?: string }> {
    if (!Number.isInteger(item.ttlEpochSec) || item.ttlEpochSec <= 0) {
      throw new Error('INVALID_TTL_EPOCH: AdminInvitations item requires integer ttlEpochSec (Number).');
    }
    return this.insertItem(item, { type: 'attribute_not_exists', attr: 'pk' });
  }

  async transitionStatus(
    inviteId: string,
    expectedStatus: InviteStatus,
    updates: Partial<AdminInvitationItem>,
    extraCondition?: ConditionExpr
  ): Promise<UpdateItemResult<AdminInvitationItem>> {
    const cond: ConditionExpr = extraCondition
      ? {
          type: 'and',
          conditions: [{ type: 'equals', attr: 'status', value: expectedStatus }, extraCondition],
        }
      : { type: 'equals', attr: 'status', value: expectedStatus };
    return this.updateItem({ pk: KeyBuilders.invitePk(inviteId) }, updates, cond);
  }
}

export class AuditLogsTableProvider extends BaseCatalystTableProvider<AuditLogItem> {
  constructor(adapter: ICleanSlateNoSQLAdapter) {
    super('AuditLogs', adapter);
  }

  /**
   * Append-only audit log writer. `AuditLogs` NEVER mutates or deletes committed entries.
   */
  async appendEvent(item: AuditLogItem): Promise<{ inserted: boolean; error?: string }> {
    if (!item.pk.startsWith('AUDIT#') || !item.auditPeriodBucket.startsWith('AUDIT_Q#')) {
      throw new Error('AUDIT_PARTITION_VIOLATION: Invalid AUDIT# or AUDIT_Q# bucket key.');
    }
    return this.insertItem(item);
  }

  async listByMonth(
    monthYyyyMm: string,
    options: { limit?: number; startKey?: string; scanDescending?: boolean } = {}
  ): Promise<QueryPageResult<AuditLogItem>> {
    return this.queryByPartition({
      partitionKeyValue: `AUDIT#${monthYyyyMm}`,
      limit: options.limit,
      startKey: options.startKey,
      scanDescending: options.scanDescending ?? false,
      consistent_read: false,
    });
  }

  async listByActor(
    actorUid: string,
    options: { dateBetween?: [string, string]; limit?: number; startKey?: string } = {}
  ): Promise<QueryPageResult<AuditLogItem>> {
    return this.queryBySecondaryIndex({
      indexName: 'GSI_AuditActor',
      partitionKeyValue: actorUid,
      sortKeyBetween: options.dateBetween,
      limit: options.limit,
      startKey: options.startKey,
      scanDescending: true,
      consistent_read: false,
    });
  }

  async listByTarget(
    targetUid: string,
    options: { dateBetween?: [string, string]; limit?: number; startKey?: string } = {}
  ): Promise<QueryPageResult<AuditLogItem>> {
    return this.queryBySecondaryIndex({
      indexName: 'GSI_AuditTarget',
      partitionKeyValue: targetUid,
      sortKeyBetween: options.dateBetween,
      limit: options.limit,
      startKey: options.startKey,
      scanDescending: true,
      consistent_read: false,
    });
  }

  async listByQuarterBucket(
    periodBucket: string,
    options: { dateBetween?: [string, string]; limit?: number; startKey?: string } = {}
  ): Promise<QueryPageResult<AuditLogItem>> {
    return this.queryBySecondaryIndex({
      indexName: 'GSI_GlobalChronology',
      partitionKeyValue: periodBucket,
      sortKeyBetween: options.dateBetween,
      limit: options.limit,
      startKey: options.startKey,
      scanDescending: true,
      consistent_read: false,
    });
  }
}

export class SystemControlTableProvider extends BaseCatalystTableProvider<Record<string, any>> {
  constructor(adapter: ICleanSlateNoSQLAdapter) {
    super('SystemControl', adapter);
  }

  async fetchControlRecord<T extends Record<string, any>>(pk: string): Promise<T | null> {
    return (await this.fetchByKey({ pk }, { consistent_read: true })) as T | null;
  }

  async insertSession(session: SessionRecordItem): Promise<{ inserted: boolean; error?: string }> {
    if (!Number.isInteger(session.ttlEpochSec) || session.ttlEpochSec <= 0) {
      throw new Error('INVALID_TTL_EPOCH: SessionRecordItem requires integer ttlEpochSec.');
    }
    return this.insertItem(session, { type: 'attribute_not_exists', attr: 'pk' });
  }

  async fetchSession(sid: string): Promise<SessionRecordItem | null> {
    return this.fetchControlRecord<SessionRecordItem>(KeyBuilders.sessionPk(sid));
  }

  async revokeSession(
    sid: string,
    reason: string,
    nowSec: number
  ): Promise<UpdateItemResult<Record<string, any>>> {
    const pk = KeyBuilders.sessionPk(sid);
    const nowIso = new Date(nowSec * 1000).toISOString();
    const patch: Partial<SessionRecordItem> = {
      status: 'revoked',
      revokedAt: nowIso,
      revocationReason: reason,
      ...(reason === 'session_rotated' ? { rotatedAtEpochSec: nowSec } : {}),
    };
    return this.updateItem(
      { pk },
      patch,
      { type: 'equals', attr: 'status', value: 'active' }
    );
  }

  async touchSessionCatalystCheck(
    sid: string,
    nowSec: number
  ): Promise<UpdateItemResult<Record<string, any>>> {
    return this.updateItem(
      { pk: KeyBuilders.sessionPk(sid) },
      { lastCatalystCheckAtEpochSec: nowSec },
      { type: 'equals', attr: 'status', value: 'active' }
    );
  }

  async atomicIncrementSuperadminCount(
    expectedVersion: number,
    delta: number,
    nowIso: string
  ): Promise<UpdateItemResult<Record<string, any>>> {
    if (!Number.isInteger(delta) || delta === 0) {
      throw new Error('INVALID_COUNTER_DELTA: delta must be a non-zero integer.');
    }
    const condition: ConditionExpr =
      delta < 0
        ? {
            type: 'and',
            conditions: [
              { type: 'equals', attr: 'version', value: expectedVersion },
              { type: 'gt', attr: 'activeSuperadminCount', value: Math.abs(delta) },
            ],
          }
        : { type: 'equals', attr: 'version', value: expectedVersion };

    return this.updateItem(
      { pk: KeyBuilders.superadminCountPk() },
      { updatedAt: nowIso },
      condition,
      { activeSuperadminCount: delta, version: 1 }
    );
  }

  async insertSaga(saga: ControlSagaItem): Promise<{ inserted: boolean; error?: string }> {
    if (!Number.isInteger(saga.ttlEpochSec) || saga.ttlEpochSec <= 0) {
      throw new Error('INVALID_TTL_EPOCH: ControlSagaItem requires integer ttlEpochSec.');
    }
    return this.insertItem(saga);
  }
}

export interface CatalystTableProvidersRegistry {
  adapter: ICleanSlateNoSQLAdapter;
  users: UsersTableProvider;
  userData: UserDataTableProvider;
  adminInvitations: AdminInvitationsTableProvider;
  auditLogs: AuditLogsTableProvider;
  systemControl: SystemControlTableProvider;
}

export function createTableProviders(
  source: ICleanSlateNoSQLAdapter | NoSQL | CatalystApp | (() => NoSQL | CatalystApp)
): CatalystTableProvidersRegistry {
  const adapter: ICleanSlateNoSQLAdapter =
    typeof source !== 'function' &&
    typeof (source as ICleanSlateNoSQLAdapter).fetchItem === 'function'
      ? (source as ICleanSlateNoSQLAdapter)
      : createCatalystLiveNoSQLAdapter(source as NoSQL | CatalystApp | (() => NoSQL | CatalystApp));

  return {
    adapter,
    users: new UsersTableProvider(adapter),
    userData: new UserDataTableProvider(adapter),
    adminInvitations: new AdminInvitationsTableProvider(adapter),
    auditLogs: new AuditLogsTableProvider(adapter),
    systemControl: new SystemControlTableProvider(adapter),
  };
}
