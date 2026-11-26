/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.7 — Canonical Catalyst HTTP Admin Governance Repository Adapter
 *
 * Strictly separated from `CatalystHttpAthleteRepository`.
 * - Enforces no local RBAC bypass and exposes zero admin credentials or secrets.
 * - Uses ONLY canonical parameterized paths from `ROUTE_CONTRACT_SPECS` /
 *   `CLEAN_SLATE_ENDPOINT_CATALOG` (legacy flat paths removed).
 * - Implements `listInvitations` directly against `GET /api/v1/admin/invitations`.
 */

import type {
  AccountStatus,
  AdminInvitationModel,
  AdminStatsModel,
  AuditLogModel,
  UserAccountModel,
  UserRole,
} from '../contracts/cleanSlateModels';
import {
  CleanSlateRepositoryError,
  type AdminDirectoryFilter,
  type IAdminGovernanceRepository,
} from '../contracts/repositories';
import { CatalystHttpTransport, type HttpTransportConfig } from './httpTransport';

function assertSafeIdentifier(id: string, fieldName: string): string {
  const safe = id.trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(safe) || safe === '.' || safe.includes('..') || safe.includes('#')) {
    throw new CleanSlateRepositoryError(
      'INVALID_PATH_PARAMETER',
      `El parámetro '${fieldName}' no cumple SAFE_IDENTIFIER_RE.`,
      400,
      { origin: 'client_synthetic' }
    );
  }
  return safe;
}

export class CatalystHttpAdminRepository implements IAdminGovernanceRepository {
  private readonly transport: CatalystHttpTransport;

  constructor(configOrTransport: HttpTransportConfig | CatalystHttpTransport) {
    this.transport =
      configOrTransport instanceof CatalystHttpTransport
        ? configOrTransport
        : new CatalystHttpTransport(configOrTransport);
  }

  async listUsers(_actorUid: string, filter: AdminDirectoryFilter = {}): Promise<UserAccountModel[]> {
    const res = await this.transport.request<{ users?: UserAccountModel[]; items?: UserAccountModel[] }>({
      method: 'GET',
      path: '/api/v1/admin/users',
      query: {
        role: filter.role && filter.role !== 'all' ? filter.role : undefined,
        accountStatus:
          filter.accountStatus && filter.accountStatus !== 'all' ? filter.accountStatus : undefined,
        emailVerified:
          filter.emailVerified !== undefined && filter.emailVerified !== 'all'
            ? String(filter.emailVerified)
            : undefined,
        searchQuery: filter.searchQuery?.trim() || undefined,
        sortBy: filter.sortBy,
        sortOrder: filter.sortOrder,
      },
    });
    return res.data?.users ?? res.data?.items ?? [];
  }

  async getStats(_actorUid: string): Promise<AdminStatsModel> {
    const res = await this.transport.request<{ stats?: AdminStatsModel }>({
      method: 'GET',
      path: '/api/v1/admin/stats',
    });
    if (!res.data?.stats) {
      throw new CleanSlateRepositoryError(
        'INVALID_ADMIN_STATS_RESPONSE',
        'GET /api/v1/admin/stats no devolvió estadísticas válidas.',
        502,
        { origin: 'client_synthetic' }
      );
    }
    return {
      ...res.data.stats,
      pendingInvitations: res.data.stats.pendingInvitations ?? 0,
    };
  }

  async getUserDetail(
    _actorUid: string,
    targetUid: string
  ): Promise<{ user: UserAccountModel; recentLogs: AuditLogModel[] }> {
    const safeUid = assertSafeIdentifier(targetUid, 'targetUid');
    const res = await this.transport.request<{
      user?: UserAccountModel;
      recentLogs?: AuditLogModel[];
      auditLogs?: AuditLogModel[];
    }>({
      method: 'GET',
      path: `/api/v1/admin/users/${encodeURIComponent(safeUid)}`,
    });
    if (!res.data?.user) {
      throw new CleanSlateRepositoryError(
        'INVALID_USER_DETAIL_RESPONSE',
        `GET /api/v1/admin/users/${safeUid} no devolvió detalle de usuario.`,
        502,
        { origin: 'client_synthetic' }
      );
    }
    return {
      user: res.data.user,
      recentLogs: res.data.recentLogs ?? res.data.auditLogs ?? [],
    };
  }

  async listInvitations(
    _actorUid: string,
    filter: {
      email?: string;
      status?: AdminInvitationModel['status'] | 'all';
      limit?: number;
      startKey?: string;
    } = {}
  ): Promise<AdminInvitationModel[]> {
    const res = await this.transport.request<{
      invitations?: AdminInvitationModel[];
      items?: AdminInvitationModel[];
    }>({
      method: 'GET',
      path: '/api/v1/admin/invitations',
      query: {
        email: filter.email?.trim() || undefined,
        status: filter.status && filter.status !== 'all' ? filter.status : undefined,
        limit: filter.limit,
        startKey: filter.startKey,
      },
    });
    return res.data?.invitations ?? res.data?.items ?? [];
  }

  async createInvitation(
    _actorUid: string,
    targetEmail: string,
    targetRole: 'athlete' | 'admin'
  ): Promise<AdminInvitationModel> {
    const res = await this.transport.request<{
      invitation?: AdminInvitationModel;
      inviteId?: string;
      rawToken?: string;
      expiresAt?: string;
    }>({
      method: 'POST',
      path: '/api/v1/admin/invitations',
      body: { targetEmail, targetRole },
    });

    if (res.data?.invitation) {
      return res.data.invitation;
    }

    const nowIso = new Date().toISOString();
    return {
      inviteId: res.data?.inviteId ?? '',
      emailNormalized: targetEmail.toLowerCase().trim(),
      targetRole,
      status: 'pending',
      rawTokenPreview: res.data?.rawToken,
      createdBy: 'server_derived',
      createdByEmail: '',
      createdAt: nowIso,
      expiresAt: res.data?.expiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    };
  }

  async revokeInvitation(
    _actorUid: string,
    inviteId: string,
    reason?: string
  ): Promise<AdminInvitationModel> {
    const safeInviteId = assertSafeIdentifier(inviteId, 'inviteId');
    const path = `/api/v1/admin/invitations/${encodeURIComponent(safeInviteId)}/revoke`;

    const res = await this.transport.request<{ invitation?: AdminInvitationModel; status?: string }>({
      method: 'POST',
      path,
      body: { inviteId: safeInviteId, reason },
    });

    if (res.data?.invitation) {
      return res.data.invitation;
    }

    return {
      inviteId: safeInviteId,
      emailNormalized: '',
      targetRole: 'athlete',
      status: 'revoked',
      createdBy: '',
      createdByEmail: '',
      createdAt: '',
      expiresAt: '',
      revokedAt: new Date().toISOString(),
      revokeReason: reason,
    };
  }

  async redeemInvitationPreview(
    _callerUid: string,
    inviteId: string,
    rawToken: string
  ): Promise<{ assignedRole: UserRole; roleVersion: number }> {
    const safeInviteId = assertSafeIdentifier(inviteId, 'inviteId');
    const res = await this.transport.request<{ assignedRole?: UserRole; roleVersion?: number }>({
      method: 'POST',
      path: '/api/v1/invitations/redeem',
      body: { inviteId: safeInviteId, token: rawToken },
    });
    if (!res.data?.assignedRole || typeof res.data.roleVersion !== 'number') {
      throw new CleanSlateRepositoryError(
        'INVALID_REDEEM_RESPONSE',
        'POST /api/v1/invitations/redeem no devolvió assignedRole y roleVersion.',
        502,
        { origin: 'client_synthetic' }
      );
    }
    return {
      assignedRole: res.data.assignedRole,
      roleVersion: res.data.roleVersion,
    };
  }

  async setUserStatus(
    _actorUid: string,
    targetUid: string,
    newStatus: AccountStatus,
    reason?: string
  ): Promise<UserAccountModel> {
    const safeUid = assertSafeIdentifier(targetUid, 'targetUid');
    const path = `/api/v1/admin/users/${encodeURIComponent(safeUid)}/status`;

    const res = await this.transport.request<{ user?: UserAccountModel }>({
      method: 'POST',
      path,
      body: { targetUid: safeUid, newStatus, reason },
    });
    if (!res.data?.user) {
      throw new CleanSlateRepositoryError(
        'INVALID_USER_STATUS_RESPONSE',
        `POST ${path} no devolvió el usuario actualizado.`,
        502,
        { origin: 'client_synthetic' }
      );
    }
    return res.data.user;
  }

  async setUserRole(
    _actorUid: string,
    targetUid: string,
    newRole: UserRole,
    reason?: string,
    options: { idempotencyKey?: string } = {}
  ): Promise<UserAccountModel> {
    const safeUid = assertSafeIdentifier(targetUid, 'targetUid');
    const path = `/api/v1/admin/users/${encodeURIComponent(safeUid)}/role`;

    const res = await this.transport.request<{ user?: UserAccountModel }>({
      method: 'POST',
      path,
      idempotent: Boolean(options.idempotencyKey),
      body: {
        targetUid: safeUid,
        newRole,
        reason,
        ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      },
    });
    if (!res.data?.user) {
      throw new CleanSlateRepositoryError(
        'INVALID_USER_ROLE_RESPONSE',
        `POST ${path} no devolvió el usuario actualizado.`,
        502,
        { origin: 'client_synthetic' }
      );
    }
    return res.data.user;
  }

  async requestPasswordReset(_actorUid: string, targetUid: string): Promise<{ emailSentTo: string }> {
    const safeUid = assertSafeIdentifier(targetUid, 'targetUid');
    const path = `/api/v1/admin/users/${encodeURIComponent(safeUid)}/password-reset`;

    const res = await this.transport.request<{ emailSentTo?: string; email?: string }>({
      method: 'POST',
      path,
      body: { targetUid: safeUid },
    });
    return { emailSentTo: res.data?.emailSentTo ?? res.data?.email ?? '' };
  }

  async listAuditLogs(
    _actorUid: string,
    filter: { action?: string; targetUid?: string; actorUid?: string; month?: string } = {}
  ): Promise<AuditLogModel[]> {
    const res = await this.transport.request<{ logs?: AuditLogModel[]; items?: AuditLogModel[] }>({
      method: 'GET',
      path: '/api/v1/admin/audit-logs',
      query: {
        action: filter.action && filter.action !== 'all' ? filter.action : undefined,
        targetUid: filter.targetUid || undefined,
        actorUid: filter.actorUid || undefined,
        month: filter.month || undefined,
      },
    });
    return res.data?.logs ?? res.data?.items ?? [];
  }
}
