/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Cloud Functions Backend Types (Increment 7D)
 */

export type UserRole = 'athlete' | 'admin' | 'superadmin';
export type FutureUserRole = UserRole | 'coach';

export type AccountAccessStatus = 'active' | 'suspended' | 'pending_verification' | 'pending_invitation';

export interface AdminUserSummary {
  uid: string;
  email: string;
  normalizedEmail: string;
  displayName: string;
  avatarUrl?: string;
  role: UserRole;
  accountStatus: AccountAccessStatus;
  emailVerified: boolean;
  authProvider: 'google.com' | 'password' | 'demo';
  createdAt: string; // ISO
  lastSignInAt?: string; // ISO
  updatedAt: string; // ISO
  suspendedAt?: string;
  suspendedBy?: string;
  suspensionReason?: string;
}

export interface AdminUserDirectoryFilter {
  searchQuery?: string;
  role?: UserRole | 'all';
  accountStatus?: AccountAccessStatus | 'all';
  emailVerified?: boolean | 'all';
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'createdAt' | 'lastSignInAt' | 'displayName' | 'email';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface AdminUserDirectoryResult {
  users: AdminUserSummary[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  stats: AdminPlatformStats;
}

export interface AdminPlatformStats {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  pendingVerificationUsers: number;
  pendingInvitations: number;
  recentSignups30d: number;
}

export interface AdminInvitation {
  inviteId: string;
  emailNormalized: string;
  targetRole: 'athlete' | 'admin';
  status: 'pending' | 'redeeming' | 'redeemed' | 'revoked' | 'expired';
  tokenHash: string; // SHA-256 hash of secret token
  createdBy: string; // Actor UID
  createdByName?: string;
  createdAt: string; // ISO
  expiresAt: string; // ISO (7 days default)
  redeemedBy?: string; // UID
  redeemedAt?: string; // ISO
  lockedBy?: string; // UID currently redeeming (atomic lock)
  lockedAt?: string; // ISO lock timestamp
  revokedBy?: string;
  revokedAt?: string;
  operationId?: string; // Stable saga transaction identifier
  roleVersionAssigned?: number; // Monotonic roleVersion applied
}

export interface AdminRoleStateRecord {
  uid: string;
  role: UserRole;
  roleVersion: number;
  updatedAt: string; // ISO
  updatedBy: string; // Actor UID
}

export interface AccountAccessRecord {
  uid: string;
  status: 'active' | 'suspended';
  updatedAt: string; // ISO
  suspendedAt?: string; // ISO
  suspendedBy?: string; // Actor UID
  validAfter?: number; // Unix timestamp in seconds (matching request.auth.token.auth_time)
  reasonCode?: string;
}

export type AdminAuditAction =
  | 'user_invited'
  | 'invitation_revoked'
  | 'invitation_redeemed'
  | 'role_updated'
  | 'account_suspended'
  | 'account_reactivated'
  | 'password_reset_requested'
  | 'superadmin_bootstrapped'
  | 'access_denied'
  | 'directory_synced';

export interface AdminAuditLog {
  eventId: string;
  action: AdminAuditAction;
  status?: 'requested' | 'completed' | 'failed' | 'partially_completed' | 'retried';
  actorUid: string;
  actorRole: UserRole;
  actorEmail?: string;
  targetUid?: string;
  targetEmail?: string;
  timestamp: string; // ISO
  serverTimestamp?: any;
  reason?: string;
  changes?: {
    before?: Record<string, any>;
    after?: Record<string, any>;
  };
  metadata?: Record<string, any>;
  correlationId?: string;
}

export interface AdminAuditLogFilter {
  action?: AdminAuditAction | 'all';
  actorUid?: string;
  targetUid?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}
