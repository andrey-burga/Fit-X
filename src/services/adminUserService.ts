/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Client Administrative User Service (Catalyst HTTP Migration)
 * Connects frontend UI directly to Zoho Catalyst HTTP repositories (`adminRepo` & `authRepo`)
 * with zero Firebase dependencies and local simulated fallback in demo mode.
 */

import type {
  AuditLogModel,
  UserAccountModel,
} from '../../poc/catalyst-clean-slate/src/frontend/contracts/cleanSlateModels.ts';
import { adminRepo, authRepo } from './catalystClient';
import {
  AdminUserSummary,
  AdminUserDirectoryFilter,
  AdminUserDirectoryResult,
  AdminPlatformStats,
  AdminAuditLog,
  AdminAuditLogFilter,
  AdminAuditAction,
  AccountAccessRecord,
  UserRole,
} from '../types/admin';

function resolveActorContext(): {
  actorUid: string;
  isDemo: boolean;
  email: string;
  displayName: string;
} {
  if (typeof localStorage === 'undefined') {
    return {
      actorUid: 'demo-user',
      isDemo: true,
      email: 'camilo@vigor.co',
      displayName: 'Camilo R. (Demo)',
    };
  }

  const isDemo = localStorage.getItem('vigor_is_demo') === 'true';
  const rawUser = localStorage.getItem('vigor_demo_user') || localStorage.getItem('vigor_auth_user');
  if (rawUser) {
    try {
      const parsed = JSON.parse(rawUser) as {
        id?: string;
        uid?: string;
        email?: string;
        name?: string;
        displayName?: string;
      };
      const uid = parsed.id || parsed.uid || (isDemo ? 'demo-user' : 'session_actor');
      return {
        actorUid: uid,
        isDemo: isDemo || uid === 'demo-user',
        email: parsed.email || 'camilo@vigor.co',
        displayName: parsed.name || parsed.displayName || 'Camilo R. (Demo)',
      };
    } catch {
      // Ignore malformed JSON in localStorage
    }
  }

  return {
    actorUid: isDemo ? 'demo-user' : 'session_actor',
    isDemo,
    email: 'camilo@vigor.co',
    displayName: 'Camilo R. (Demo)',
  };
}

function mapAuthProvider(raw?: string): AdminUserSummary['authProvider'] {
  if (raw === 'google.com' || raw === 'password' || raw === 'demo') {
    return raw;
  }
  return 'password';
}

function mapAccountToSummary(model: UserAccountModel): AdminUserSummary {
  return {
    uid: model.uid,
    email: model.email,
    normalizedEmail: model.normalizedEmail,
    displayName: model.displayName,
    avatarUrl: model.avatarUrl,
    role: model.role,
    accountStatus: model.accountStatus,
    emailVerified: model.emailVerified,
    authProvider: mapAuthProvider(model.authProvider),
    createdAt: model.createdAt,
    lastSignInAt: model.lastSignInAt,
    updatedAt: model.updatedAt,
    suspendedAt: model.suspendedAt,
    suspensionReason: model.suspensionReason,
  };
}

function mapAuditLog(model: AuditLogModel): AdminAuditLog {
  return {
    eventId: model.eventId,
    action: model.action as AdminAuditAction,
    actorUid: model.actorUid,
    actorRole: model.actorRole === 'system' ? 'superadmin' : model.actorRole,
    actorEmail: model.actorEmail,
    targetUid: model.targetUid,
    targetEmail: model.targetEmail,
    timestamp: model.timestamp,
    reason: model.reason,
    changes: model.changes as AdminAuditLog['changes'],
  };
}

/**
 * Fetch paginated directory of users with filters and stats
 */
export async function fetchAdminUserDirectory(
  filter: AdminUserDirectoryFilter = {}
): Promise<AdminUserDirectoryResult> {
  const { actorUid, isDemo } = resolveActorContext();
  if (isDemo || actorUid === 'demo-user') {
    return getSimulatedDirectory(filter);
  }

  const remoteAccountStatus =
    filter.accountStatus === 'active' || filter.accountStatus === 'suspended'
      ? filter.accountStatus
      : undefined;

  const [rawUsers, rawStats] = await Promise.all([
    adminRepo.listUsers(actorUid, {
      searchQuery: filter.searchQuery,
      role: filter.role,
      accountStatus: remoteAccountStatus ?? 'all',
      emailVerified: filter.emailVerified,
      sortBy: filter.sortBy,
      sortOrder: filter.sortOrder,
    }),
    adminRepo.getStats(actorUid),
  ]);

  let users = rawUsers.map(mapAccountToSummary);
  if (filter.accountStatus && filter.accountStatus !== 'all' && !remoteAccountStatus) {
    users = users.filter(u => u.accountStatus === filter.accountStatus);
  }
  if (filter.dateFrom) {
    users = users.filter(u => u.createdAt >= filter.dateFrom!);
  }
  if (filter.dateTo) {
    users = users.filter(u => u.createdAt <= filter.dateTo!);
  }

  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.max(1, filter.pageSize ?? 20);
  const totalCount = users.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const pagedUsers = users.slice((page - 1) * pageSize, page * pageSize);

  return {
    users: pagedUsers,
    totalCount,
    page,
    pageSize,
    totalPages,
    stats: {
      totalUsers: rawStats.totalUsers,
      activeUsers: rawStats.activeUsers,
      suspendedUsers: rawStats.suspendedUsers,
      pendingVerificationUsers: rawStats.pendingVerificationUsers ?? 0,
      pendingInvitations: rawStats.pendingInvitations ?? 0,
      recentSignups30d: rawStats.recentSignups30d ?? 0,
    },
  };
}

/**
 * Fetch detailed record and recent logs for a single user
 */
export async function fetchAdminUserDetail(
  targetUid: string
): Promise<{ user: AdminUserSummary; accessRecord?: AccountAccessRecord; recentLogs: AdminAuditLog[] }> {
  const { actorUid, isDemo } = resolveActorContext();
  if (isDemo || actorUid === 'demo-user') {
    const directory = getSimulatedDirectory({});
    const found = directory.users.find(u => u.uid === targetUid);
    if (!found) throw new Error('Usuario no encontrado en el directorio.');
    return {
      user: found,
      accessRecord: {
        uid: targetUid,
        status: found.accountStatus === 'suspended' ? 'suspended' : 'active',
        updatedAt: found.updatedAt,
      },
      recentLogs: [],
    };
  }

  const detail = await adminRepo.getUserDetail(actorUid, targetUid);
  const summary = mapAccountToSummary(detail.user);
  return {
    user: summary,
    accessRecord: {
      uid: summary.uid,
      status: summary.accountStatus,
      updatedAt: summary.updatedAt,
      suspendedAt: summary.suspendedAt,
    },
    recentLogs: detail.recentLogs.map(mapAuditLog),
  };
}

/**
 * Create a new secure invitation
 */
export async function createInvitation(
  targetEmail: string,
  targetRole: 'athlete' | 'admin'
): Promise<{ inviteId: string; rawToken: string; inviteLink: string; expiresAt: string }> {
  const { actorUid, isDemo } = resolveActorContext();
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://fit-x-bhnatsxl.onslate.com';

  if (isDemo || actorUid === 'demo-user') {
    const rawToken = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    const inviteId = `inv_${Date.now()}`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const inviteLink = `${origin}/#/aceptar-invitacion?inviteId=${inviteId}&token=${rawToken}`;
    return { inviteId, rawToken, inviteLink, expiresAt };
  }

  const inv = await adminRepo.createInvitation(actorUid, targetEmail, targetRole);
  const rawToken = inv.rawTokenPreview ?? '';
  const inviteLink = `${origin}/#/aceptar-invitacion?inviteId=${encodeURIComponent(inv.inviteId)}&token=${encodeURIComponent(rawToken)}`;
  return {
    inviteId: inv.inviteId,
    rawToken,
    inviteLink,
    expiresAt: inv.expiresAt,
  };
}

/**
 * Revoke an active invitation
 */
export async function revokeInvitation(inviteId: string, reason?: string): Promise<void> {
  const { actorUid, isDemo } = resolveActorContext();
  if (isDemo || actorUid === 'demo-user') {
    return;
  }
  await adminRepo.revokeInvitation(actorUid, inviteId, reason);
}

/**
 * Accept and redeem an invitation
 */
export async function acceptInvitation(
  inviteId: string,
  token: string
): Promise<{ success: boolean; assignedRole: UserRole; message: string }> {
  const { actorUid, isDemo } = resolveActorContext();
  if (isDemo || actorUid === 'demo-user') {
    return {
      success: true,
      assignedRole: 'athlete',
      message: 'Invitación canjeada exitosamente en entorno local.',
    };
  }

  const res = await authRepo.redeemInvitation(inviteId, token);
  const assignedRole = res.assignedRole as UserRole;
  return {
    success: true,
    assignedRole,
    message: `Invitación canjeada exitosamente con rol [${assignedRole}].`,
  };
}

/**
 * Change a user's role (Superadmin only)
 */
export async function updateUserRole(
  targetUid: string,
  newRole: UserRole,
  reason?: string
): Promise<void> {
  const { actorUid, isDemo } = resolveActorContext();
  if (isDemo || actorUid === 'demo-user') {
    return;
  }
  await adminRepo.setUserRole(actorUid, targetUid, newRole, reason);
}

/**
 * Suspend or reactivate user account
 */
export async function updateUserStatus(
  targetUid: string,
  newStatus: 'active' | 'suspended',
  reason?: string
): Promise<void> {
  const { actorUid, isDemo } = resolveActorContext();
  if (isDemo || actorUid === 'demo-user') {
    return;
  }
  await adminRepo.setUserStatus(actorUid, targetUid, newStatus, reason);
}

/**
 * Request password recovery email
 */
export async function requestUserPasswordReset(
  targetUid: string
): Promise<{ success: boolean; emailSentTo: string }> {
  const { actorUid, isDemo } = resolveActorContext();
  if (isDemo || actorUid === 'demo-user') {
    return { success: true, emailSentTo: 'usuario@vigorcore.com' };
  }

  const res = await adminRepo.requestPasswordReset(actorUid, targetUid);
  return {
    success: true,
    emailSentTo: res.emailSentTo,
  };
}

/**
 * Fetch platform stats
 */
export async function fetchPlatformStats(): Promise<AdminPlatformStats> {
  const { actorUid, isDemo } = resolveActorContext();
  if (isDemo || actorUid === 'demo-user') {
    return {
      totalUsers: 1,
      activeUsers: 1,
      suspendedUsers: 0,
      pendingVerificationUsers: 0,
      pendingInvitations: 0,
      recentSignups30d: 1,
    };
  }

  const stats = await adminRepo.getStats(actorUid);
  return {
    totalUsers: stats.totalUsers,
    activeUsers: stats.activeUsers,
    suspendedUsers: stats.suspendedUsers,
    pendingVerificationUsers: stats.pendingVerificationUsers ?? 0,
    pendingInvitations: stats.pendingInvitations ?? 0,
    recentSignups30d: stats.recentSignups30d ?? 0,
  };
}

/**
 * Fetch audit logs
 */
export async function fetchAuditLogs(
  filter: AdminAuditLogFilter = {}
): Promise<{ logs: AdminAuditLog[]; totalCount: number }> {
  const { actorUid, isDemo } = resolveActorContext();
  if (isDemo || actorUid === 'demo-user') {
    return { logs: [], totalCount: 0 };
  }

  const rawLogs = await adminRepo.listAuditLogs(actorUid, {
    action: filter.action && filter.action !== 'all' ? filter.action : undefined,
    actorUid: filter.actorUid,
    targetUid: filter.targetUid,
    month: filter.dateFrom ? filter.dateFrom.slice(0, 7) : undefined,
  });

  let mapped = rawLogs.map(mapAuditLog);
  if (filter.dateFrom) {
    mapped = mapped.filter(l => l.timestamp >= filter.dateFrom!);
  }
  if (filter.dateTo) {
    mapped = mapped.filter(l => l.timestamp <= filter.dateTo!);
  }

  const totalCount = mapped.length;
  if (filter.page && filter.pageSize) {
    const start = (Math.max(1, filter.page) - 1) * filter.pageSize;
    mapped = mapped.slice(start, start + filter.pageSize);
  }

  return { logs: mapped, totalCount };
}

// ---------------------------------------------------------------------------
// Simulated directory for demo or offline sandbox
// ---------------------------------------------------------------------------
function getSimulatedDirectory(_filter: AdminUserDirectoryFilter): AdminUserDirectoryResult {
  const { actorUid, email, displayName } = resolveActorContext();

  const users: AdminUserSummary[] = [
    {
      uid: actorUid === 'demo-user' ? 'usr_camilo_demo' : actorUid,
      email,
      normalizedEmail: email.toLowerCase(),
      displayName,
      role: 'athlete',
      accountStatus: 'active',
      emailVerified: true,
      authProvider: 'demo',
      createdAt: '2024-10-01T12:00:00Z',
      lastSignInAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  return {
    users,
    totalCount: users.length,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    stats: {
      totalUsers: 1,
      activeUsers: 1,
      suspendedUsers: 0,
      pendingVerificationUsers: 0,
      pendingInvitations: 0,
      recentSignups30d: 1,
    },
  };
}
