/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 4.0.2 Administrative Governance Service (Final Audit)
 *
 * Official Zoho Catalyst Contracts Applied:
 * 1. OBJECTIVE 1 (Superadmin Counter Guarantee — No multi-item ACID transactions):
 *    - Single-item conditional updates on `CTRL#SUPERADMIN_COUNT` (`version == counterVersion AND activeSuperadminCount > 1`).
 *    - Inspects `response.data.update[0].status` (`'Success' | 'ConditionMismatch' | 'CriteriaMismatch'`),
 *      NEVER treating HTTP 200 alone as success.
 *    - Fails closed if `CTRL#SUPERADMIN_COUNT` does not exist (`SUPERADMIN_COUNTER_NOT_PROVISIONED`)
 *      or drifts from `Users` (`SUPERADMIN_COUNTER_DRIFT_DETECTED`).
 *    - On timeout (`CatalystTimeoutError`), executes mandatory `consistent_read: true` BEFORE any retry
 *      to prevent double-decrements or blind retries.
 *    - Keeps `allowSuperadminMutations === false` BY DEFAULT until live `PASS-INTEGRATION`.
 * 2. OBJECTIVE 2 (Offline Bootstrap Audit):
 *    - Operator-controlled offline/CLI only; no public HTTP route; supports lost-response
 *      reconciliation for same `operatorTicketId` + `targetCatalystUserId`, plus consistent post-verification.
 * 3. OBJECTIVE 3 (Distributed Index Queries):
 *    - `listDirectoryUsers` fans out across 4 deterministic `GSI_Directory` segments (`USER_SEG#0..3`)
 *      with parallel `Promise.all`, descending merge sort, and composite cursor pagination.
 *    - `listAuditLogs` uses base table monthly shared partition (`AUDIT#YYYY-MM`) OR quarterly
 *      `GSI_GlobalChronology` period buckets (`AUDIT_Q#<YYYY>-Q<1..4>`) with parallel cross-bucket merge.
 */

import crypto from 'node:crypto';
import {
  CATALYST_PLATFORM_LIMITS,
  DIRECTORY_SEGMENTS,
  enumerateQuarterBuckets,
  KeyBuilders,
  type AdminInvitationItem,
  type AuditLogItem,
  type AuthoritativeActor,
  type ControlSagaItem,
  type UserAccountItem,
  type UserRole,
} from '../types/cleanSlate.js';
import {
  CatalystTimeoutError,
  type ICleanSlateNoSQLAdapter,
  type QueryPageResult,
  type UpdateItemResult,
} from '../nosql/cleanSlateEngine.js';
import { USER_STATUS, type ICatalystAuthRuntime } from '../auth/cleanSlateAuthGuard.js';

export type AdminPermission =
  | 'users:list'
  | 'users:detail'
  | 'users:stats'
  | 'users:setRole'
  | 'users:setStatus'
  | 'users:resetPassword'
  | 'invitations:list'
  | 'invitations:create'
  | 'invitations:revoke'
  | 'audit:list';

export const PERMISSION_MATRIX: Record<AdminPermission, UserRole[]> = {
  'users:list': ['admin', 'superadmin'],
  'users:detail': ['admin', 'superadmin'],
  'users:stats': ['admin', 'superadmin'],
  'users:setRole': ['superadmin'],
  'users:setStatus': ['admin', 'superadmin'],
  'users:resetPassword': ['admin', 'superadmin'],
  'invitations:list': ['admin', 'superadmin'],
  'invitations:create': ['admin', 'superadmin'],
  'invitations:revoke': ['admin', 'superadmin'],
  'audit:list': ['admin', 'superadmin'],
};

export class AdminGovernanceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: 400 | 403 | 404 | 409 | 504 = 403
  ) {
    super(message);
    this.name = 'AdminGovernanceError';
  }
}

export interface GovernanceRuntimeOptions {
  /**
   * MUST remain false in production until PASS-INTEGRATION proves live Catalyst NoSQL
   * conditional update atomicity and saga recovery against the real cluster.
   */
  liveAtomicityVerifiedForSuperadminMutations?: boolean;
}

interface SuperadminCounterItem {
  pk: string;
  activeSuperadminCount: number;
  version: number;
  updatedAt: string;
}

function sha256Hex(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function constantTimeHexEquals(aHex: string, bHex: string): boolean {
  if (aHex.length !== bHex.length) return false;
  return crypto.timingSafeEqual(Buffer.from(aHex, 'utf8'), Buffer.from(bHex, 'utf8'));
}

function isCatalystTimeoutError(err: unknown): boolean {
  return err instanceof CatalystTimeoutError || Boolean((err as any)?.isTimeout);
}

/**
 * Inspects real `@zcatalyst/nosql` `NoSQLResponse.update[0].status` (not solely HTTP 200).
 * HTTP 200 with `ConditionMismatch` or `CriteriaMismatch` is NEVER treated as a successful write.
 */
export function assertCatalystUpdateApplied<T>(res: UpdateItemResult<T>): { applied: boolean; status: string; item?: T } {
  const itemResult = res.response?.update?.[0];
  const status = itemResult?.status ?? res.status;
  if (res.httpStatus !== 200 || status !== 'Success' || !res.updated) {
    return { applied: false, status };
  }
  return { applied: true, status, item: res.item };
}

export class AdminGovernanceService {
  private readonly allowSuperadminMutations: boolean;

  constructor(
    private db: ICleanSlateNoSQLAdapter,
    private authRuntime?: ICatalystAuthRuntime,
    private nowMsProvider: () => number = () => Date.now(),
    options: GovernanceRuntimeOptions = {}
  ) {
    this.allowSuperadminMutations = Boolean(options.liveAtomicityVerifiedForSuperadminMutations);
  }

  assertPermission(
    actor: AuthoritativeActor,
    permission: AdminPermission,
    context?: { targetRole?: UserRole; targetUid?: string }
  ): void {
    const allowed = PERMISSION_MATRIX[permission];
    if (!allowed.includes(actor.role)) {
      throw new AdminGovernanceError('PERMISSION_DENIED', `Role '${actor.role}' lacks '${permission}'.`, 403);
    }
    if (permission === 'invitations:create' && actor.role === 'admin' && context?.targetRole !== 'athlete') {
      throw new AdminGovernanceError(
        'PRIVILEGE_ESCALATION_BLOCKED',
        'Admins can only invite athletes. Only superadmin can invite admins.',
        403
      );
    }
    if (permission === 'users:setStatus' && context?.targetUid === actor.catalystUserId) {
      throw new AdminGovernanceError(
        'SELF_SUSPENSION_BLOCKED',
        'Administrators cannot suspend or reactivate their own account.',
        403
      );
    }
  }

  private async appendAuditLog(
    entry: Omit<AuditLogItem, 'pk' | 'sk' | 'auditPeriodBucket' | 'globalChronologyKey' | 'eventId' | 'timestamp'>
  ): Promise<AuditLogItem> {
    const nowMs = this.nowMsProvider();
    const nowIso = new Date(nowMs).toISOString();
    const eventId = `aud_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;
    const item: AuditLogItem = {
      pk: KeyBuilders.auditPk(nowIso),
      sk: KeyBuilders.auditSk(nowMs, eventId),
      auditPeriodBucket: KeyBuilders.auditPeriodBucket(nowIso),
      globalChronologyKey: `${nowIso}#${eventId}`,
      eventId,
      timestamp: nowIso,
      ...entry,
    };
    await this.db.insertItem('AuditLogs', item);
    return item;
  }

  /**
   * OBJECTIVE 2 — OFFLINE ADMINISTRATIVE INITIALIZATION PROCEDURE:
   * - Strictly offline/CLI/Console operator-only (`offlineCliAuthorized === true`).
   * - Never relies on `insertItems` condition on empty partition as concurrency lock.
   * - Supports idempotent recovery on lost response ONLY for the same `(operatorTicketId, targetCatalystUserId)`.
   * - Performs consistent post-verification of `Users`, `CTRL#BOOTSTRAP`, `CTRL#SUPERADMIN_COUNT`, and `AuditLogs`.
   */
  async executeOfflineAdminBootstrap(params: {
    offlineCliAuthorized: boolean;
    targetCatalystUserId: string;
    operatorTicketId: string;
    operatorEmail?: string;
  }): Promise<{
    bootstrapped: boolean;
    recoveredFromPartialRun: boolean;
    user: UserAccountItem;
    verification: {
      bootstrapStatus: string;
      superadminCount: number;
      activeSuperadminsInUsers: number;
    };
  }> {
    if (!params.offlineCliAuthorized) {
      throw new AdminGovernanceError(
        'PUBLIC_BOOTSTRAP_PROHIBITED',
        'Bootstrap is strictly prohibited from public endpoints; requires offline CLI/Console authorization.',
        403
      );
    }

    const userPk = KeyBuilders.userPk(params.targetCatalystUserId);
    const existingLock = await this.db.fetchItem<{
      pk: string;
      status: string;
      claimedByUid: string;
      operatorTicketId: string;
    }>('SystemControl', { pk: KeyBuilders.bootstrapLockPk() }, { consistent_read: true });

    const existingCounter = await this.db.fetchItem<SuperadminCounterItem>(
      'SystemControl',
      { pk: KeyBuilders.superadminCountPk() },
      { consistent_read: true }
    );

    const existingSuperadmins = await this.db.queryIndex<UserAccountItem>('Users', {
      indexName: 'GSI_RoleStatus',
      partitionKeyValue: 'superadmin',
      consistent_read: true,
    });

    const user = await this.db.fetchItem<UserAccountItem>('Users', { pk: userPk }, { consistent_read: true });

    // Lost-response / interrupted run recovery ONLY when exact same ticket & target user started bootstrap
    const isSameOperatorRecovery =
      existingLock &&
      existingLock.status === 'CLAIMED' &&
      existingLock.claimedByUid === params.targetCatalystUserId &&
      existingLock.operatorTicketId === params.operatorTicketId &&
      (!existingCounter || !user || user.role !== 'superadmin');

    if (existingLock && existingLock.status === 'CLAIMED' && !isSameOperatorRecovery) {
      throw new AdminGovernanceError(
        'BOOTSTRAP_ALREADY_COMPLETED',
        'Bootstrap already marked CLAIMED in SystemControl.',
        409
      );
    }

    if (existingSuperadmins.items.length > 0 && !isSameOperatorRecovery) {
      throw new AdminGovernanceError(
        'SUPERADMIN_ALREADY_EXISTS',
        'At least one superadmin already exists in Users. Offline bootstrap aborted.',
        409
      );
    }

    if (!user) {
      throw new AdminGovernanceError('BOOTSTRAP_USER_NOT_FOUND', 'Target user must register in Users first.', 404);
    }
    if (!user.emailVerified || user.accountStatus !== 'active') {
      throw new AdminGovernanceError('BOOTSTRAP_PRECONDITION_FAILED', 'Target user must be verified and active.', 403);
    }

    const nowIso = new Date(this.nowMsProvider()).toISOString();

    if (!existingLock) {
      await this.db.insertItem('SystemControl', {
        pk: KeyBuilders.bootstrapLockPk(),
        status: 'CLAIMED',
        claimedByUid: user.uid,
        operatorTicketId: params.operatorTicketId,
        claimedAt: nowIso,
      });
    }

    if (!existingCounter) {
      await this.db.insertItem('SystemControl', {
        pk: KeyBuilders.superadminCountPk(),
        activeSuperadminCount: 1,
        version: 1,
        updatedAt: nowIso,
      });
    }

    if (user.role !== 'superadmin') {
      const userRes = await this.db.updateItem<UserAccountItem>('Users', { pk: userPk }, {
        role: 'superadmin',
        roleVersion: user.roleVersion + 1,
        sessionEpoch: user.sessionEpoch + 1,
        updatedAt: nowIso,
      });
      const check = assertCatalystUpdateApplied(userRes);
      if (!check.applied) {
        throw new AdminGovernanceError('BOOTSTRAP_WRITE_FAILED', `Failed updating Users (${check.status}).`, 409);
      }
    }

    await this.appendAuditLog({
      action: isSameOperatorRecovery ? 'superadmin_bootstrap_recovered_offline' : 'superadmin_bootstrapped_offline',
      actorUid: 'offline_operator_cli',
      actorRole: 'system',
      actorEmail: params.operatorEmail || 'operator@vigorcore.offline',
      targetUid: user.uid,
      targetEmail: user.email,
      reason: `Offline one-time initialization (${params.operatorTicketId})`,
      changes: { before: { role: user.role }, after: { role: 'superadmin' } },
    });

    // Mandatory post-bootstrap consistent verification
    const verifiedUser = await this.db.fetchItem<UserAccountItem>('Users', { pk: userPk }, { consistent_read: true });
    const verifiedLock = await this.db.fetchItem<{ status: string }>(
      'SystemControl',
      { pk: KeyBuilders.bootstrapLockPk() },
      { consistent_read: true }
    );
    const verifiedCounter = await this.db.fetchItem<SuperadminCounterItem>(
      'SystemControl',
      { pk: KeyBuilders.superadminCountPk() },
      { consistent_read: true }
    );
    const verifiedSuperadmins = await this.db.queryIndex<UserAccountItem>('Users', {
      indexName: 'GSI_RoleStatus',
      partitionKeyValue: 'superadmin',
      sortKeyEquals: 'active',
      consistent_read: true,
    });

    if (
      !verifiedUser ||
      verifiedUser.role !== 'superadmin' ||
      verifiedLock?.status !== 'CLAIMED' ||
      verifiedCounter?.activeSuperadminCount !== 1 ||
      verifiedSuperadmins.items.length !== 1
    ) {
      throw new AdminGovernanceError(
        'BOOTSTRAP_POST_VERIFICATION_FAILED',
        'Post-bootstrap consistent read verification failed.',
        409
      );
    }

    return {
      bootstrapped: true,
      recoveredFromPartialRun: Boolean(isSameOperatorRecovery),
      user: verifiedUser,
      verification: {
        bootstrapStatus: verifiedLock.status,
        superadminCount: verifiedCounter.activeSuperadminCount,
        activeSuperadminsInUsers: verifiedSuperadmins.items.length,
      },
    };
  }

  /**
   * Explicit operator-only provisioning / reconciliation procedure for `CTRL#SUPERADMIN_COUNT`.
   * Normal API endpoints MUST NEVER silently create a missing counter.
   */
  async provisionSuperadminCounterFromOperator(params: {
    offlineCliAuthorized: boolean;
    operatorTicketId: string;
  }): Promise<SuperadminCounterItem> {
    if (!params.offlineCliAuthorized) {
      throw new AdminGovernanceError(
        'OPERATOR_AUTHORIZATION_REQUIRED',
        'Superadmin counter provisioning requires offline operator authorization.',
        403
      );
    }

    const activeSuperadmins = await this.db.queryIndex<UserAccountItem>('Users', {
      indexName: 'GSI_RoleStatus',
      partitionKeyValue: 'superadmin',
      sortKeyEquals: 'active',
      consistent_read: true,
    });
    const count = activeSuperadmins.items.length;
    const nowIso = new Date(this.nowMsProvider()).toISOString();

    const existing = await this.db.fetchItem<SuperadminCounterItem>(
      'SystemControl',
      { pk: KeyBuilders.superadminCountPk() },
      { consistent_read: true }
    );

    let resultCounter: SuperadminCounterItem;
    if (!existing) {
      resultCounter = {
        pk: KeyBuilders.superadminCountPk(),
        activeSuperadminCount: count,
        version: 1,
        updatedAt: nowIso,
      };
      await this.db.insertItem('SystemControl', resultCounter);
    } else {
      const upd = await this.db.updateItem<SuperadminCounterItem>(
        'SystemControl',
        { pk: KeyBuilders.superadminCountPk() },
        { activeSuperadminCount: count, updatedAt: nowIso },
        { type: 'equals', attr: 'version', value: existing.version },
        { version: 1 }
      );
      const check = assertCatalystUpdateApplied(upd);
      if (!check.applied || !check.item) {
        throw new AdminGovernanceError(
          'COUNTER_PROVISION_CONFLICT',
          `Conditional counter reconciliation aborted (${check.status}).`,
          409
        );
      }
      resultCounter = check.item;
    }

    await this.appendAuditLog({
      action: 'superadmin_counter_provisioned',
      actorUid: 'offline_operator_cli',
      actorRole: 'system',
      actorEmail: 'operator@vigorcore.offline',
      targetUid: KeyBuilders.superadminCountPk(),
      reason: `Operator counter reconciliation (${params.operatorTicketId})`,
      changes: { activeSuperadminCount: count, version: resultCounter.version },
    });

    return resultCounter;
  }

  /**
   * Verifies `CTRL#SUPERADMIN_COUNT` exists AND agrees with `Users` (`GSI_RoleStatus`).
   * Rejects immediately if counter does not exist (`SUPERADMIN_COUNTER_NOT_PROVISIONED`)
   * or if any drift exists (`SUPERADMIN_COUNTER_DRIFT_DETECTED`).
   */
  async assertNoSuperadminCounterDrift(): Promise<{ activeCount: number; counterVersion: number }> {
    const counter = await this.db.fetchItem<SuperadminCounterItem>(
      'SystemControl',
      { pk: KeyBuilders.superadminCountPk() },
      { consistent_read: true }
    );
    if (!counter) {
      throw new AdminGovernanceError(
        'SUPERADMIN_COUNTER_NOT_PROVISIONED',
        'Registro CTRL#SUPERADMIN_COUNT no existe en SystemControl. Reserva bloqueada hasta aprovisionamiento explícito por operador.',
        409
      );
    }

    const storedCount = Number(counter.activeSuperadminCount);
    if (!Number.isInteger(storedCount) || storedCount < 0) {
      throw new AdminGovernanceError(
        'SUPERADMIN_COUNTER_NEGATIVE_OR_CORRUPT',
        `Invariant violation: CTRL#SUPERADMIN_COUNT tiene valor inválido (${counter.activeSuperadminCount}).`,
        409
      );
    }

    const realSuperadmins = await this.db.queryIndex<UserAccountItem>('Users', {
      indexName: 'GSI_RoleStatus',
      partitionKeyValue: 'superadmin',
      sortKeyEquals: 'active',
      consistent_read: true,
    });

    const realCount = realSuperadmins.items.length;

    if (storedCount !== realCount) {
      throw new AdminGovernanceError(
        'SUPERADMIN_COUNTER_DRIFT_DETECTED',
        `Falla de consistencia detectada: SystemControl=${storedCount} vs Users reales=${realCount}. Operación bloqueada en modo fail-closed.`,
        409
      );
    }

    return { activeCount: realCount, counterVersion: counter.version };
  }

  /**
   * Single-item conditional reservation on `CTRL#SUPERADMIN_COUNT` with:
   * - Inspection of `data.update[0].status` (`ConditionMismatch` / `CriteriaMismatch` abort cleanly).
   * - Timeout recovery: executes mandatory `consistent_read: true` BEFORE any retry.
   */
  private async reserveSuperadminSlotWithTimeoutRecovery(
    counterVersion: number,
    nowIso: string
  ): Promise<number> {
    const attemptReserve = () =>
      this.db.updateItem<SuperadminCounterItem>(
        'SystemControl',
        { pk: KeyBuilders.superadminCountPk() },
        { updatedAt: nowIso },
        {
          type: 'and',
          conditions: [
            { type: 'gt', attr: 'activeSuperadminCount', value: 1 },
            { type: 'equals', attr: 'version', value: counterVersion },
          ],
        },
        { activeSuperadminCount: -1, version: 1 }
      );

    try {
      const reserveRes = await attemptReserve();
      const check = assertCatalystUpdateApplied(reserveRes);
      if (!check.applied || !check.item) {
        throw new AdminGovernanceError(
          'LAST_SUPERADMIN_PROTECTED',
          `Reserva condicional denegada (${check.status}) en CTRL#SUPERADMIN_COUNT.`,
          409
        );
      }
      return check.item.version;
    } catch (err) {
      if (!isCatalystTimeoutError(err)) {
        throw err;
      }
      // MANDATORY consistent read after timeout BEFORE any retry
      const consistentCounter = await this.db.fetchItem<SuperadminCounterItem>(
        'SystemControl',
        { pk: KeyBuilders.superadminCountPk() },
        { consistent_read: true }
      );
      if (!consistentCounter) {
        throw new AdminGovernanceError(
          'SUPERADMIN_COUNTER_NOT_PROVISIONED',
          'Timeout seguido de lectura consistente: CTRL#SUPERADMIN_COUNT no existe.',
          409
        );
      }
      if (consistentCounter.activeSuperadminCount < 0) {
        throw new AdminGovernanceError(
          'SUPERADMIN_COUNTER_NEGATIVE_OR_CORRUPT',
          'Timeout recovery detectó activeSuperadminCount < 0.',
          409
        );
      }
      if (consistentCounter.version > counterVersion) {
        // The write DID succeed before timeout -> DO NOT retry or double-decrement
        return consistentCounter.version;
      }
      // Write did NOT apply before timeout -> one safe conditional retry with exact verified version
      const retryRes = await attemptReserve();
      const retryCheck = assertCatalystUpdateApplied(retryRes);
      if (!retryCheck.applied || !retryCheck.item) {
        throw new AdminGovernanceError(
          'LAST_SUPERADMIN_PROTECTED',
          `Reintento post-timeout rechazado (${retryCheck.status}).`,
          409
        );
      }
      return retryCheck.item.version;
    }
  }

  private async syncExistingSuperadminCounterFromUsers(): Promise<number> {
    const existing = await this.db.fetchItem<SuperadminCounterItem>(
      'SystemControl',
      { pk: KeyBuilders.superadminCountPk() },
      { consistent_read: true }
    );
    if (!existing) {
      throw new AdminGovernanceError(
        'SUPERADMIN_COUNTER_NOT_PROVISIONED',
        'No se puede sincronizar CTRL#SUPERADMIN_COUNT porque el registro no existe.',
        409
      );
    }

    const activeSuperadmins = await this.db.queryIndex<UserAccountItem>('Users', {
      indexName: 'GSI_RoleStatus',
      partitionKeyValue: 'superadmin',
      sortKeyEquals: 'active',
      consistent_read: true,
    });
    const nowIso = new Date(this.nowMsProvider()).toISOString();
    const count = activeSuperadmins.items.length;

    const upd = await this.db.updateItem<SuperadminCounterItem>(
      'SystemControl',
      { pk: KeyBuilders.superadminCountPk() },
      { activeSuperadminCount: count, updatedAt: nowIso },
      { type: 'equals', attr: 'version', value: existing.version },
      { version: 1 }
    );
    const check = assertCatalystUpdateApplied(upd);
    if (!check.applied) {
      throw new AdminGovernanceError(
        'SUPERADMIN_COUNTER_SYNC_CONFLICT',
        `Fallo condicional al sincronizar contador (${check.status}).`,
        409
      );
    }
    return count;
  }

  async createInvitation(
    actor: AuthoritativeActor,
    targetEmail: string,
    targetRole: 'athlete' | 'admin'
  ): Promise<{ inviteId: string; rawToken: string; expiresAt: string }> {
    this.assertPermission(actor, 'invitations:create', { targetRole });
    const emailNormalized = targetEmail.toLowerCase().trim();
    if (!emailNormalized || !emailNormalized.includes('@')) {
      throw new AdminGovernanceError('INVALID_EMAIL', 'Valid target email is required.', 400);
    }

    const nowMs = this.nowMsProvider();
    const nowIso = new Date(nowMs).toISOString();
    const expiresAtMs = nowMs + 7 * 24 * 60 * 60 * 1000;
    const expiresAtEpochSec = Math.floor(expiresAtMs / 1000);
    const ttlEpochSec = expiresAtEpochSec + 24 * 3600;

    const inviteId = `inv_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;
    const rawToken = crypto.randomBytes(32).toString('hex');

    const inviteItem: AdminInvitationItem = {
      pk: KeyBuilders.invitePk(inviteId),
      inviteId,
      emailNormalized,
      targetRole,
      status: 'pending',
      tokenHash: sha256Hex(rawToken),
      createdBy: actor.catalystUserId,
      createdByEmail: actor.email,
      createdAt: nowIso,
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtEpochSec,
      ttlEpochSec,
    };

    await this.db.insertItem('AdminInvitations', inviteItem);
    await this.appendAuditLog({
      action: 'invitation_created',
      actorUid: actor.catalystUserId,
      actorRole: actor.role,
      actorEmail: actor.email,
      targetUid: emailNormalized,
      targetEmail: emailNormalized,
      reason: `Invitación generada para rol ${targetRole}`,
      changes: {
        after: {
          inviteId,
          targetRole,
          expiresAt: inviteItem.expiresAt,
        },
      },
    });

    return { inviteId, rawToken, expiresAt: inviteItem.expiresAt };
  }

  async listInvitations(
    actor: AuthoritativeActor,
    filter: {
      email?: string;
      status?: AdminInvitationItem['status'];
      limit?: number;
      startKey?: string;
    } = {}
  ): Promise<
    QueryPageResult<AdminInvitationItem> & {
      queryStrategy: 'GSI_InviteEmailStatus' | 'AuditLogs_GSI_GlobalChronology_Hydrated';
      indexLimitationNote?: string;
    }
  > {
    this.assertPermission(actor, 'invitations:list');
    const limit = Math.min(Math.max(1, filter.limit ?? 50), CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS);
    const normalizedEmail = filter.email?.toLowerCase().trim();

    const sanitizeInvitation = (inv: AdminInvitationItem): AdminInvitationItem => {
      const { tokenHash: _th, lockHolderOpId: _lho, lockExpiresAtMs: _lem, ...safe } = inv;
      return safe as AdminInvitationItem;
    };

    if (normalizedEmail) {
      const page = await this.db.queryIndex<AdminInvitationItem>('AdminInvitations', {
        indexName: 'GSI_InviteEmailStatus',
        partitionKeyValue: normalizedEmail,
        sortKeyEquals: filter.status,
        scanDescending: true,
        limit,
        startKey: filter.startKey,
      });
      return {
        items: page.items.map(sanitizeInvitation),
        nextStartKey: page.nextStartKey,
        queryStrategy: 'GSI_InviteEmailStatus',
      };
    }

    const nowMs = this.nowMsProvider();
    const nowIso = new Date(nowMs).toISOString();
    const currentYear = new Date(nowMs).getUTCFullYear();
    const startYear = Math.max(2025, currentYear - 1);
    const startIso = `${startYear}-01-01T00:00:00.000Z`;
    const buckets = enumerateQuarterBuckets(startIso, nowIso);

    const bucketPages = await Promise.all(
      buckets.map(bucket =>
        this.db.queryIndex<AuditLogItem>('AuditLogs', {
          indexName: 'GSI_GlobalChronology',
          partitionKeyValue: bucket,
          scanDescending: true,
          limit: CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
        })
      )
    );

    const createdLogs = bucketPages
      .flatMap(p => p.items)
      .filter(entry => entry.action === 'invitation_created')
      .sort((a, b) => b.globalChronologyKey.localeCompare(a.globalChronologyKey));

    const orderedInviteIds: string[] = [];
    const seenIds = new Set<string>();
    for (const logEntry of createdLogs) {
      const afterObj = (logEntry.changes as { after?: { inviteId?: unknown } } | undefined)?.after;
      const fromChanges = typeof afterObj?.inviteId === 'string' ? afterObj.inviteId.trim() : '';
      const fromTarget = logEntry.targetUid?.startsWith('inv_') ? logEntry.targetUid : '';
      const inviteId = fromChanges || fromTarget;
      if (inviteId && !seenIds.has(inviteId)) {
        seenIds.add(inviteId);
        orderedInviteIds.push(inviteId);
      }
    }

    const hydrated: AdminInvitationItem[] = [];
    if (typeof this.db.fetchItem === 'function') {
      const batchSize = 25;
      for (let i = 0; i < orderedInviteIds.length; i += batchSize) {
        const chunk = orderedInviteIds.slice(i, i + batchSize);
        const fetched = await Promise.all(
          chunk.map(id =>
            this.db.fetchItem<AdminInvitationItem>(
              'AdminInvitations',
              { pk: KeyBuilders.invitePk(id) },
              { consistent_read: true }
            )
          )
        );
        for (const item of fetched) {
          if (item && (!filter.status || item.status === filter.status)) {
            hydrated.push(sanitizeInvitation(item));
          }
        }
      }
    }

    hydrated.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const rawOffset = filter.startKey ? Number(Buffer.from(filter.startKey, 'base64url').toString('utf8')) : 0;
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
    const items = hydrated.slice(offset, offset + limit);
    const hasMore = offset + limit < hydrated.length;
    const nextStartKey = hasMore ? Buffer.from(String(offset + limit), 'utf8').toString('base64url') : undefined;

    return {
      items,
      nextStartKey,
      queryStrategy: 'AuditLogs_GSI_GlobalChronology_Hydrated',
      indexLimitationNote:
        'Frozen AdminInvitations schema exposes GSI_InviteEmailStatus (emailNormalized + status) only; global status listing hydrates invitation_created events from AuditLogs.GSI_GlobalChronology quarterly buckets.',
    };
  }

  async revokeInvitation(
    actor: AuthoritativeActor,
    inviteId: string,
    reason?: string
  ): Promise<{ revoked: boolean; inviteId: string }> {
    this.assertPermission(actor, 'invitations:revoke');
    const pk = KeyBuilders.invitePk(inviteId);
    const nowIso = new Date(this.nowMsProvider()).toISOString();

    const upd = await this.db.updateItem<AdminInvitationItem>(
      'AdminInvitations',
      { pk },
      {
        status: 'revoked',
        revokedBy: actor.catalystUserId,
        revokedAt: nowIso,
        revokeReason: reason,
      },
      { type: 'equals', attr: 'status', value: 'pending' }
    );
    const check = assertCatalystUpdateApplied(upd);
    if (!check.applied) {
      throw new AdminGovernanceError(
        'INVITATION_REVOKE_FAILED',
        `No se pudo revocar la invitación (${check.status}).`,
        409
      );
    }

    await this.appendAuditLog({
      action: 'invitation_revoked',
      actorUid: actor.catalystUserId,
      actorRole: actor.role,
      actorEmail: actor.email,
      targetUid: check.item?.emailNormalized || inviteId,
      reason: reason || 'Invitación revocada administrativamente',
    });

    return { revoked: true, inviteId };
  }

  async redeemInvitation(
    caller: AuthoritativeActor,
    inviteId: string,
    rawToken: string
  ): Promise<{ assignedRole: UserRole; roleVersion: number }> {
    const pk = KeyBuilders.invitePk(inviteId);
    const opId = `op_${this.nowMsProvider()}_${crypto.randomBytes(3).toString('hex')}`;
    const nowMs = this.nowMsProvider();
    const nowSec = Math.floor(nowMs / 1000);

    const lockRes = await this.db.updateItem<AdminInvitationItem>(
      'AdminInvitations',
      { pk },
      { status: 'redeeming', lockHolderOpId: opId, lockExpiresAtMs: nowMs + 30_000 },
      { type: 'equals', attr: 'status', value: 'pending' }
    );
    const lockCheck = assertCatalystUpdateApplied(lockRes);

    if (!lockCheck.applied || !lockCheck.item) {
      throw new AdminGovernanceError(
        'INVITATION_UNAVAILABLE',
        `La invitación no está disponible (${lockCheck.status}).`,
        409
      );
    }

    const invite = lockCheck.item;
    const releaseLock = async () => {
      await this.db.updateItem<AdminInvitationItem>(
        'AdminInvitations',
        { pk },
        { status: 'pending', lockHolderOpId: undefined, lockExpiresAtMs: undefined },
        { type: 'equals', attr: 'lockHolderOpId', value: opId }
      );
    };

    if (invite.expiresAtEpochSec <= nowSec) {
      await this.db.updateItem<AdminInvitationItem>('AdminInvitations', { pk }, {
        status: 'expired',
        lockHolderOpId: undefined,
      });
      throw new AdminGovernanceError('INVITATION_EXPIRED', 'La invitación ha expirado.', 409);
    }

    if (invite.emailNormalized !== caller.normalizedEmail) {
      await releaseLock();
      throw new AdminGovernanceError('INVITATION_EMAIL_MISMATCH', 'Correo no coincide con la invitación.', 403);
    }

    if (!constantTimeHexEquals(sha256Hex(rawToken), invite.tokenHash)) {
      await releaseLock();
      throw new AdminGovernanceError('INVITATION_TOKEN_INVALID', 'Token de invitación inválido.', 403);
    }

    const userPk = KeyBuilders.userPk(caller.catalystUserId);
    const nextRoleVersion = caller.roleVersion + 1;
    const roleToAssign: UserRole = caller.role === 'superadmin' ? 'superadmin' : invite.targetRole;

    const userUpd = await this.db.updateItem<UserAccountItem>('Users', { pk: userPk }, {
      role: roleToAssign,
      roleVersion: nextRoleVersion,
      updatedAt: new Date(nowMs).toISOString(),
    });
    const userCheck = assertCatalystUpdateApplied(userUpd);
    if (!userCheck.applied) {
      await releaseLock();
      throw new AdminGovernanceError('INVITATION_USER_UPDATE_FAILED', `Failed updating user (${userCheck.status}).`, 409);
    }

    await this.db.updateItem<AdminInvitationItem>('AdminInvitations', { pk }, {
      status: 'redeemed',
      redeemedBy: caller.catalystUserId,
      redeemedAt: new Date(nowMs).toISOString(),
      lockHolderOpId: undefined,
      lockExpiresAtMs: undefined,
    });

    await this.appendAuditLog({
      action: 'invitation_redeemed',
      actorUid: caller.catalystUserId,
      actorRole: roleToAssign,
      actorEmail: caller.email,
      targetUid: caller.catalystUserId,
      targetEmail: caller.email,
      changes: { before: { role: caller.role }, after: { role: roleToAssign } },
    });

    return { assignedRole: roleToAssign, roleVersion: nextRoleVersion };
  }

  /**
   * Role update with single-item conditional writes, `data.update[0].status` check,
   * timeout consistent-read recovery, counter-drift verification, and default disabled superadmin writes.
   */
  async setUserRole(
    actor: AuthoritativeActor,
    targetUid: string,
    newRole: UserRole,
    options: { idempotencyKey?: string; reason?: string; simulateCrashAfterUsersWrite?: boolean } = {}
  ): Promise<UserAccountItem> {
    this.assertPermission(actor, 'users:setRole', { targetUid, targetRole: newRole });

    const idempotencyKey = options.idempotencyKey || `role_${targetUid}_${newRole}_${this.nowMsProvider()}`;
    const payloadHash = sha256Hex(JSON.stringify({ targetUid, newRole }));
    const sagaPk = KeyBuilders.sagaPk(idempotencyKey);

    const existingSaga = await this.db.fetchItem<ControlSagaItem>('SystemControl', { pk: sagaPk }, { consistent_read: true });
    if (existingSaga) {
      if (existingSaga.payloadHash !== payloadHash) {
        throw new AdminGovernanceError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key reused with different parameters.', 409);
      }
      if (existingSaga.step === 'COMPLETED' && existingSaga.resultSnapshot) {
        return existingSaga.resultSnapshot as unknown as UserAccountItem;
      }
      if (existingSaga.step === 'USERS_UPDATED') {
        const currentUser = await this.db.fetchItem<UserAccountItem>('Users', { pk: KeyBuilders.userPk(targetUid) }, { consistent_read: true });
        if (currentUser) {
          if (existingSaga.reservedDecrementVersion === undefined) {
            await this.syncExistingSuperadminCounterFromUsers();
          }
          await this.db.updateItem<ControlSagaItem>('SystemControl', { pk: sagaPk }, {
            step: 'COMPLETED',
            resultSnapshot: currentUser as unknown as Record<string, unknown>,
            updatedAt: new Date(this.nowMsProvider()).toISOString(),
          });
          return currentUser;
        }
      }
    }

    const targetPk = KeyBuilders.userPk(targetUid);
    const targetUser = await this.db.fetchItem<UserAccountItem>('Users', { pk: targetPk }, { consistent_read: true });
    if (!targetUser) {
      throw new AdminGovernanceError('USER_NOT_FOUND', 'Target user does not exist.', 404);
    }

    const involvesSuperadmin = targetUser.role === 'superadmin' || newRole === 'superadmin';
    if (involvesSuperadmin && !this.allowSuperadminMutations) {
      throw new AdminGovernanceError(
        'SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED',
        'Los cambios automáticos sobre el rol superadmin están deshabilitados hasta verificar atomicidad remota en integración viva (PASS-INTEGRATION).',
        403
      );
    }

    if (targetUser.role === newRole) {
      return targetUser;
    }

    const nowMs = this.nowMsProvider();
    const nowIso = new Date(nowMs).toISOString();
    const ttlEpochSec = Math.floor(nowMs / 1000) + 7 * 24 * 3600;

    let reservedDecrementVersion: number | null = null;
    if (involvesSuperadmin) {
      const { activeCount, counterVersion } = await this.assertNoSuperadminCounterDrift();
      if (targetUser.role === 'superadmin' && newRole !== 'superadmin' && targetUser.accountStatus === 'active') {
        if (activeCount <= 1) {
          throw new AdminGovernanceError(
            'LAST_SUPERADMIN_PROTECTED',
            'Operación bloqueada: No se puede degradar al último superadministrador activo.',
            409
          );
        }
        reservedDecrementVersion = await this.reserveSuperadminSlotWithTimeoutRecovery(counterVersion, nowIso);
      }
    }

    await this.db.insertItem<ControlSagaItem>('SystemControl', {
      pk: sagaPk,
      idempotencyKey,
      operationType: 'SET_ROLE',
      payloadHash,
      step: 'STARTED',
      targetUid,
      previousRole: targetUser.role,
      requestedRole: newRole,
      ...(reservedDecrementVersion !== null ? { reservedDecrementVersion } : {}),
      createdAt: nowIso,
      updatedAt: nowIso,
      ttlEpochSec,
    });

    // Update authoritative Users record with optimistic roleVersion check & bump sessionEpoch on role change
    let updatedUserItem: UserAccountItem | undefined;
    try {
      const updatedUserRes = await this.db.updateItem<UserAccountItem>(
        'Users',
        { pk: targetPk },
        {
          role: newRole,
          roleVersion: targetUser.roleVersion + 1,
          sessionEpoch: targetUser.sessionEpoch + 1,
          updatedAt: nowIso,
        },
        { type: 'equals', attr: 'roleVersion', value: targetUser.roleVersion }
      );
      const userCheck = assertCatalystUpdateApplied(updatedUserRes);
      if (userCheck.applied && userCheck.item) {
        updatedUserItem = userCheck.item;
      }
    } catch (err) {
      if (!isCatalystTimeoutError(err)) throw err;
      // Mandatory consistent read on Users after timeout BEFORE deciding compensation/retry
      const consistentUser = await this.db.fetchItem<UserAccountItem>('Users', { pk: targetPk }, { consistent_read: true });
      if (consistentUser && consistentUser.roleVersion > targetUser.roleVersion && consistentUser.role === newRole) {
        updatedUserItem = consistentUser;
      }
    }

    if (!updatedUserItem) {
      if (reservedDecrementVersion !== null) {
        await this.db.updateItem(
          'SystemControl',
          { pk: KeyBuilders.superadminCountPk() },
          { updatedAt: nowIso },
          { type: 'equals', attr: 'version', value: reservedDecrementVersion },
          { activeSuperadminCount: 1, version: 1 }
        );
      }
      throw new AdminGovernanceError('ROLE_UPDATE_RACE', 'Role update rejected or aborted cleanly.', 409);
    }

    await this.db.updateItem<ControlSagaItem>('SystemControl', { pk: sagaPk }, {
      step: 'USERS_UPDATED',
      updatedAt: nowIso,
    });

    if (options.simulateCrashAfterUsersWrite) {
      throw new Error('SIMULATED_CRASH_AFTER_USERS_WRITE');
    }

    if (involvesSuperadmin && reservedDecrementVersion === null) {
      await this.syncExistingSuperadminCounterFromUsers();
    }

    await this.db.updateItem<ControlSagaItem>('SystemControl', { pk: sagaPk }, {
      step: 'COMPLETED',
      resultSnapshot: updatedUserItem as unknown as Record<string, unknown>,
      updatedAt: nowIso,
    });

    await this.appendAuditLog({
      action: 'role_changed',
      actorUid: actor.catalystUserId,
      actorRole: actor.role,
      actorEmail: actor.email,
      targetUid,
      targetEmail: targetUser.email,
      reason: options.reason,
      changes: { before: { role: targetUser.role }, after: { role: newRole } },
    });

    return updatedUserItem;
  }

  async setUserStatus(
    actor: AuthoritativeActor,
    targetUid: string,
    newStatus: 'active' | 'suspended',
    reason?: string
  ): Promise<UserAccountItem> {
    this.assertPermission(actor, 'users:setStatus', { targetUid });
    const targetPk = KeyBuilders.userPk(targetUid);
    const targetUser = await this.db.fetchItem<UserAccountItem>('Users', { pk: targetPk }, { consistent_read: true });
    if (!targetUser) {
      throw new AdminGovernanceError('USER_NOT_FOUND', 'Target user does not exist.', 404);
    }

    const nowIso = new Date(this.nowMsProvider()).toISOString();
    let reservedDecrementVersion: number | null = null;

    if (targetUser.role === 'superadmin') {
      if (actor.role === 'admin') {
        throw new AdminGovernanceError('SUPERADMIN_TARGET_PROTECTED', 'Admins cannot suspend a superadmin.', 403);
      }
      if (!this.allowSuperadminMutations) {
        throw new AdminGovernanceError(
          'SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED',
          'Suspensión automática de superadmin deshabilitada hasta verificar atomicidad remota.',
          403
        );
      }
      if (newStatus === 'suspended' && targetUser.accountStatus === 'active') {
        const { activeCount, counterVersion } = await this.assertNoSuperadminCounterDrift();
        if (activeCount <= 1) {
          throw new AdminGovernanceError('LAST_SUPERADMIN_PROTECTED', 'No se puede suspender al último superadmin activo.', 409);
        }
        reservedDecrementVersion = await this.reserveSuperadminSlotWithTimeoutRecovery(counterVersion, nowIso);
      }
    }

    const updatedRes = await this.db.updateItem<UserAccountItem>(
      'Users',
      { pk: targetPk },
      {
        accountStatus: newStatus,
        sessionEpoch: targetUser.sessionEpoch + 1,
        roleVersion: targetUser.roleVersion + 1,
        suspendedAt: newStatus === 'suspended' ? nowIso : undefined,
        suspendedBy: newStatus === 'suspended' ? actor.catalystUserId : undefined,
        suspensionReason: newStatus === 'suspended' ? reason : undefined,
        updatedAt: nowIso,
      },
      { type: 'equals', attr: 'sessionEpoch', value: targetUser.sessionEpoch }
    );
    const check = assertCatalystUpdateApplied(updatedRes);
    if (!check.applied || !check.item) {
      if (reservedDecrementVersion !== null) {
        await this.db.updateItem(
          'SystemControl',
          { pk: KeyBuilders.superadminCountPk() },
          { updatedAt: nowIso },
          { type: 'equals', attr: 'version', value: reservedDecrementVersion },
          { activeSuperadminCount: 1, version: 1 }
        );
      }
      throw new AdminGovernanceError('STATUS_UPDATE_CONFLICT', `Error al actualizar estado (${check.status}).`, 409);
    }

    if (this.authRuntime) {
      await this.authRuntime.updateUserStatus(
        targetUid,
        newStatus === 'suspended' ? USER_STATUS.DISABLE : USER_STATUS.ENABLE
      );
    }

    if (targetUser.role === 'superadmin' && reservedDecrementVersion === null) {
      await this.syncExistingSuperadminCounterFromUsers();
    }

    await this.appendAuditLog({
      action: newStatus === 'suspended' ? 'account_suspended' : 'account_reactivated',
      actorUid: actor.catalystUserId,
      actorRole: actor.role,
      actorEmail: actor.email,
      targetUid,
      targetEmail: targetUser.email,
      reason,
      changes: { before: { status: targetUser.accountStatus }, after: { status: newStatus } },
    });

    return check.item;
  }

  async getAdminUserDetail(
    actor: AuthoritativeActor,
    targetUid: string
  ): Promise<{ user: UserAccountItem; recentLogs: AuditLogItem[] }> {
    this.assertPermission(actor, 'users:detail', { targetUid });
    const user = await this.db.fetchItem<UserAccountItem>('Users', { pk: KeyBuilders.userPk(targetUid) }, { consistent_read: true });
    if (!user) {
      throw new AdminGovernanceError('USER_NOT_FOUND', 'Target user does not exist.', 404);
    }
    const logs = await this.db.queryIndex<AuditLogItem>('AuditLogs', {
      indexName: 'GSI_AuditTarget',
      partitionKeyValue: targetUid,
      scanDescending: true,
      limit: 20,
    });
    return { user, recentLogs: logs.items };
  }

  async getAdminStats(actor: AuthoritativeActor): Promise<{
    totalUsers: number;
    activeUsers: number;
    suspendedUsers: number;
    superadmins: number;
    admins: number;
    pendingInvitations: number;
    pendingVerificationUsers: number;
    recentSignups30d: number;
  }> {
    this.assertPermission(actor, 'users:stats');
    const segmentUsersList = await Promise.all(
      DIRECTORY_SEGMENTS.map(async seg => {
        const seenInSegment = new Set<string>();
        const collected: UserAccountItem[] = [];
        let startKey: string | undefined;

        do {
          const page = await this.db.queryIndex<UserAccountItem>('Users', {
            indexName: 'GSI_Directory',
            partitionKeyValue: seg,
            limit: CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
            ...(startKey ? { startKey } : {}),
          });

          for (const item of page.items) {
            const dedupeKey = item.pk || item.uid;
            if (!seenInSegment.has(dedupeKey)) {
              seenInSegment.add(dedupeKey);
              collected.push(item);
            }
          }

          if (page.nextStartKey && page.nextStartKey === startKey) {
            throw new AdminGovernanceError(
              'DIRECTORY_PAGINATION_STALLED',
              `GSI_Directory cursor pagination stalled on segment '${seg}'.`,
              504
            );
          }
          startKey = page.nextStartKey;
        } while (startKey);

        return collected;
      })
    );

    const uniqueByPk = new Map<string, UserAccountItem>();
    for (const segUsers of segmentUsersList) {
      for (const user of segUsers) {
        const key = user.pk || user.uid;
        if (!uniqueByPk.has(key)) {
          uniqueByPk.set(key, user);
        }
      }
    }
    const users = Array.from(uniqueByPk.values());
    const nowMs = this.nowMsProvider();
    const nowSec = Math.floor(nowMs / 1000);
    const cutoff30dIso = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();

    let pendingInvitations = 0;
    if (typeof this.db.fetchItem === 'function') {
      const pendingPage = await this.listInvitations(actor, {
        status: 'pending',
        limit: CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
      });
      pendingInvitations = pendingPage.items.filter(inv => inv.expiresAtEpochSec > nowSec).length;
    }

    return {
      totalUsers: users.length,
      activeUsers: users.filter(u => u.accountStatus === 'active').length,
      suspendedUsers: users.filter(u => u.accountStatus === 'suspended').length,
      superadmins: users.filter(u => u.role === 'superadmin').length,
      admins: users.filter(u => u.role === 'admin').length,
      pendingInvitations,
      pendingVerificationUsers: users.filter(u => !u.emailVerified).length,
      recentSignups30d: users.filter(
        u => typeof u.createdAt === 'string' && u.createdAt >= cutoff30dIso
      ).length,
    };
  }

  async requestAdminPasswordReset(
    actor: AuthoritativeActor,
    targetUid: string
  ): Promise<{ success: boolean; emailSentTo: string }> {
    this.assertPermission(actor, 'users:resetPassword', { targetUid });
    const targetUser = await this.db.fetchItem<UserAccountItem>('Users', { pk: KeyBuilders.userPk(targetUid) }, { consistent_read: true });
    if (!targetUser) {
      throw new AdminGovernanceError('USER_NOT_FOUND', 'Target user does not exist.', 404);
    }
    if (this.authRuntime?.sendPasswordReset) {
      await this.authRuntime.sendPasswordReset(targetUser.email);
    }
    await this.appendAuditLog({
      action: 'password_reset_requested',
      actorUid: actor.catalystUserId,
      actorRole: actor.role,
      actorEmail: actor.email,
      targetUid,
      targetEmail: targetUser.email,
    });
    return { success: true, emailSentTo: targetUser.email };
  }

  /**
   * OBJECTIVE 3 — DISTRIBUTED DIRECTORY PAGINATION:
   * Queries all 4 `GSI_Directory` segments (`USER_SEG#0..3`) in parallel (`Promise.all`),
   * applies search/verification/status filters BEFORE pagination slicing,
   * sorts cleanly, and paginates with a composite segment cursor.
   */
  async listDirectoryUsers(
    actor: AuthoritativeActor,
    filter: {
      role?: UserRole;
      accountStatus?: 'active' | 'suspended';
      emailVerified?: boolean;
      searchQuery?: string;
      sortBy?: 'createdAt' | 'displayName' | 'email';
      sortOrder?: 'asc' | 'desc';
      limit?: number;
      startKey?: string;
    } = {}
  ): Promise<QueryPageResult<UserAccountItem>> {
    this.assertPermission(actor, 'users:list');
    const limit = Math.min(Math.max(1, filter.limit ?? 50), CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS);
    const needle = filter.searchQuery?.trim().toLowerCase();
    const needsInMemoryFilterOrSort =
      Boolean(needle) || filter.emailVerified !== undefined || filter.sortBy !== undefined || filter.sortOrder !== undefined;

    const applyDirectoryFiltersAndSort = (items: UserAccountItem[]): UserAccountItem[] => {
      let out = items;
      if (filter.accountStatus) {
        out = out.filter(u => u.accountStatus === filter.accountStatus);
      }
      if (filter.emailVerified !== undefined) {
        out = out.filter(u => Boolean(u.emailVerified) === filter.emailVerified);
      }
      if (needle) {
        out = out.filter(
          u =>
            u.displayName.toLowerCase().includes(needle) ||
            u.email.toLowerCase().includes(needle) ||
            u.uid.toLowerCase().includes(needle)
        );
      }
      const sortBy = filter.sortBy ?? 'createdAt';
      const dir = filter.sortOrder === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => {
        const av = String((a as unknown as Record<string, unknown>)[sortBy] ?? '');
        const bv = String((b as unknown as Record<string, unknown>)[sortBy] ?? '');
        return av.localeCompare(bv) * dir;
      });
      return out;
    };

    if (filter.role && !needsInMemoryFilterOrSort) {
      return this.db.queryIndex<UserAccountItem>('Users', {
        indexName: 'GSI_RoleStatus',
        partitionKeyValue: filter.role,
        sortKeyEquals: filter.accountStatus,
        limit,
        startKey: filter.startKey,
      });
    }

    const rawOffset = filter.startKey ? Number(Buffer.from(filter.startKey, 'base64url').toString('utf8')) : 0;
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

    if (filter.role) {
      const collected: UserAccountItem[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await this.db.queryIndex<UserAccountItem>('Users', {
          indexName: 'GSI_RoleStatus',
          partitionKeyValue: filter.role,
          sortKeyEquals: filter.accountStatus,
          limit: CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
          startKey: cursor,
        });
        collected.push(...page.items);
        cursor = page.nextStartKey;
        pages++;
      } while (cursor && pages < 5);

      const filtered = applyDirectoryFiltersAndSort(collected);
      const slice = filtered.slice(offset, offset + limit);
      const hasMore = offset + limit < filtered.length || Boolean(cursor);
      const nextStartKey = hasMore ? Buffer.from(String(offset + limit), 'utf8').toString('base64url') : undefined;
      return { items: slice, nextStartKey };
    }

    const perSegmentFetch = needsInMemoryFilterOrSort
      ? CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS
      : Math.min(offset + limit, CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS);

    const segmentPages = await Promise.all(
      DIRECTORY_SEGMENTS.map(seg =>
        this.db.queryIndex<UserAccountItem>('Users', {
          indexName: 'GSI_Directory',
          partitionKeyValue: seg,
          scanDescending: true,
          limit: perSegmentFetch,
        })
      )
    );

    const merged = applyDirectoryFiltersAndSort(segmentPages.flatMap(p => p.items));
    const slice = merged.slice(offset, offset + limit);
    const hasMore = offset + limit < merged.length || segmentPages.some(p => Boolean(p.nextStartKey));
    const nextStartKey = hasMore ? Buffer.from(String(offset + limit), 'utf8').toString('base64url') : undefined;

    return { items: slice, nextStartKey };
  }

  /**
   * OBJECTIVE 3 — AUDIT CHRONOLOGY STRATEGY:
   * - Single month (`query.month`): queries base table shared monthly partition `AUDIT#<YYYY-MM>`.
   * - Cross-month / global timeline: queries bounded quarterly buckets (`AUDIT_Q#<YYYY>-Q<1..4>`)
   *   on `GSI_GlobalChronology` in parallel (`Promise.all`) with sorted merge.
   */
  async listAuditLogs(
    actor: AuthoritativeActor,
    query: {
      month?: string;
      targetUid?: string;
      actorUid?: string;
      globalTimeline?: boolean;
      dateRangeIso?: [string, string];
      limit?: number;
      startKey?: string;
    } = {}
  ): Promise<QueryPageResult<AuditLogItem>> {
    this.assertPermission(actor, 'audit:list');
    const limit = Math.min(query.limit ?? 50, CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS);

    if (query.targetUid) {
      return this.db.queryIndex<AuditLogItem>('AuditLogs', {
        indexName: 'GSI_AuditTarget',
        partitionKeyValue: query.targetUid,
        scanDescending: true,
        limit,
        startKey: query.startKey,
      });
    }

    if (query.actorUid) {
      return this.db.queryIndex<AuditLogItem>('AuditLogs', {
        indexName: 'GSI_AuditActor',
        partitionKeyValue: query.actorUid,
        scanDescending: true,
        limit,
        startKey: query.startKey,
      });
    }

    if (query.globalTimeline || query.dateRangeIso) {
      const nowIso = new Date(this.nowMsProvider()).toISOString();
      const startIso = query.dateRangeIso ? query.dateRangeIso[0] : `${nowIso.slice(0, 4)}-01-01T00:00:00.000Z`;
      const endIso = query.dateRangeIso ? query.dateRangeIso[1] : nowIso;
      const buckets = enumerateQuarterBuckets(startIso, endIso);

      const offset = query.startKey ? Number(Buffer.from(query.startKey, 'base64url').toString('utf8')) : 0;
      const perBucketLimit = Math.min(offset + limit, CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS);

      const bucketResults = await Promise.all(
        buckets.map(bucket =>
          this.db.queryIndex<AuditLogItem>('AuditLogs', {
            indexName: 'GSI_GlobalChronology',
            partitionKeyValue: bucket,
            sortKeyBetween: query.dateRangeIso ? [query.dateRangeIso[0], `${query.dateRangeIso[1]}\uffff`] : undefined,
            scanDescending: true,
            limit: perBucketLimit,
          })
        )
      );

      const merged = bucketResults
        .flatMap(r => r.items)
        .sort((a, b) => b.globalChronologyKey.localeCompare(a.globalChronologyKey));

      const items = merged.slice(offset, offset + limit);
      const hasMore = offset + limit < merged.length || bucketResults.some(r => Boolean(r.nextStartKey));
      const nextStartKey = hasMore ? Buffer.from(String(offset + limit), 'utf8').toString('base64url') : undefined;

      return { items, nextStartKey };
    }

    const pk = query.month ? `AUDIT#${query.month}` : KeyBuilders.auditPk(new Date(this.nowMsProvider()));
    return this.db.queryTable<AuditLogItem>('AuditLogs', {
      partitionKeyValue: pk,
      limit,
      startKey: query.startKey,
    });
  }
}
