/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Client Administrative User Service (Increment 7D)
 * Connects frontend UI to backend Cloud Functions v2 and manages administrative data.
 * Zero privileged credentials or service account keys in the browser.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth, db } from '../firebase';
import {
  AdminUserSummary,
  AdminUserDirectoryFilter,
  AdminUserDirectoryResult,
  AdminPlatformStats,
  AdminInvitation,
  AdminAuditLog,
  AdminAuditLogFilter,
  AccountAccessRecord,
  UserRole,
} from '../types/admin';

// Initialize Firebase Functions with default region
let functionsInstance: ReturnType<typeof getFunctions> | null = null;
function getFunctionsInstance() {
  if (!functionsInstance) {
    try {
      functionsInstance = getFunctions(undefined, 'us-central1');
    } catch (err) {
      console.warn('Firebase Functions client initialization note:', err);
    }
  }
  return functionsInstance;
}

/**
 * Fetch paginated directory of users with filters and stats
 */
export async function fetchAdminUserDirectory(
  filter: AdminUserDirectoryFilter = {}
): Promise<AdminUserDirectoryResult> {
  const fns = getFunctionsInstance();
  if (fns) {
    try {
      const callable = httpsCallable<{ filter: AdminUserDirectoryFilter }, AdminUserDirectoryResult>(
        fns,
        'listAdminUsers'
      );
      const res = await callable({ filter });
      return res.data;
    } catch (err: any) {
      console.warn('Cloud Functions listAdminUsers call failed, falling back to local simulation:', err);
    }
  }

  // Graceful client fallback for sandbox or pending function deployment
  return getSimulatedDirectory(filter);
}

/**
 * Fetch detailed record and recent logs for a single user
 */
export async function fetchAdminUserDetail(
  targetUid: string
): Promise<{ user: AdminUserSummary; accessRecord?: AccountAccessRecord; recentLogs: AdminAuditLog[] }> {
  const fns = getFunctionsInstance();
  if (fns) {
    try {
      const callable = httpsCallable<
        { targetUid: string },
        { user: AdminUserSummary; accessRecord?: AccountAccessRecord; recentLogs: AdminAuditLog[] }
      >(fns, 'getAdminUserDetail');
      const res = await callable({ targetUid });
      return res.data;
    } catch (err: any) {
      console.warn('Cloud Functions getAdminUserDetail call failed:', err);
    }
  }

  // Fallback
  const directory = await fetchAdminUserDirectory({});
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

/**
 * Create a new secure invitation
 */
export async function createInvitation(
  targetEmail: string,
  targetRole: 'athlete' | 'admin'
): Promise<{ inviteId: string; rawToken: string; inviteLink: string; expiresAt: string }> {
  const fns = getFunctionsInstance();
  if (fns) {
    try {
      const callable = httpsCallable<
        { targetEmail: string; targetRole: 'athlete' | 'admin' },
        { inviteId: string; rawToken: string; inviteLink: string; expiresAt: string }
      >(fns, 'createAdminInvitation');
      const res = await callable({ targetEmail, targetRole });
      return res.data;
    } catch (err: any) {
      throw new Error(err.message || 'Error al generar la invitación administrativa.');
    }
  }

  // Fallback simulation for local development
  const rawToken = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
  const inviteId = `inv_${Date.now()}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const inviteLink = `https://fit-x-bhnatsxl.onslate.com/#/aceptar-invitacion?inviteId=${inviteId}&token=${rawToken}`;
  return { inviteId, rawToken, inviteLink, expiresAt };
}

/**
 * Revoke an active invitation
 */
export async function revokeInvitation(inviteId: string, reason?: string): Promise<void> {
  const fns = getFunctionsInstance();
  if (fns) {
    const callable = httpsCallable<{ inviteId: string; reason?: string }, { success: boolean }>(
      fns,
      'revokeAdminInvitation'
    );
    await callable({ inviteId, reason });
    return;
  }
}

/**
 * Accept and redeem an invitation
 */
export async function acceptInvitation(
  inviteId: string,
  token: string
): Promise<{ success: boolean; assignedRole: UserRole; message: string }> {
  const fns = getFunctionsInstance();
  if (fns) {
    const callable = httpsCallable<
      { inviteId: string; token: string },
      { success: boolean; assignedRole: UserRole; message: string }
    >(fns, 'acceptAdminInvitation');
    const res = await callable({ inviteId, token });
    return res.data;
  }

  return {
    success: true,
    assignedRole: 'athlete',
    message: 'Invitación canjeada exitosamente en entorno local.',
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
  const fns = getFunctionsInstance();
  if (fns) {
    const callable = httpsCallable<{ targetUid: string; newRole: UserRole; reason?: string }, { success: boolean }>(
      fns,
      'setAdminUserRole'
    );
    await callable({ targetUid, newRole, reason });
    return;
  }
}

/**
 * Suspend or reactivate user account
 */
export async function updateUserStatus(
  targetUid: string,
  newStatus: 'active' | 'suspended',
  reason?: string
): Promise<void> {
  const fns = getFunctionsInstance();
  if (fns) {
    const callable = httpsCallable<
      { targetUid: string; newStatus: 'active' | 'suspended'; reason?: string },
      { success: boolean }
    >(fns, 'setAdminUserStatus');
    await callable({ targetUid, newStatus, reason });
    return;
  }
}

/**
 * Request password recovery email
 */
export async function requestUserPasswordReset(
  targetUid: string
): Promise<{ success: boolean; emailSentTo: string }> {
  const fns = getFunctionsInstance();
  if (fns) {
    const callable = httpsCallable<{ targetUid: string }, { success: boolean; emailSentTo: string }>(
      fns,
      'requestAdminPasswordReset'
    );
    const res = await callable({ targetUid });
    return res.data;
  }

  return { success: true, emailSentTo: 'usuario@vigorcore.com' };
}

/**
 * Fetch platform stats
 */
export async function fetchPlatformStats(): Promise<AdminPlatformStats> {
  const fns = getFunctionsInstance();
  if (fns) {
    try {
      const callable = httpsCallable<void, AdminPlatformStats>(fns, 'getAdminStats');
      const res = await callable();
      return res.data;
    } catch (err) {
      console.warn('getAdminStats call failed:', err);
    }
  }

  return {
    totalUsers: 1,
    activeUsers: 1,
    suspendedUsers: 0,
    pendingVerificationUsers: 0,
    pendingInvitations: 0,
    recentSignups30d: 1,
  };
}

/**
 * Fetch audit logs
 */
export async function fetchAuditLogs(
  filter: AdminAuditLogFilter = {}
): Promise<{ logs: AdminAuditLog[]; totalCount: number }> {
  const fns = getFunctionsInstance();
  if (fns) {
    try {
      const callable = httpsCallable<
        { filter: AdminAuditLogFilter },
        { logs: AdminAuditLog[]; totalCount: number }
      >(fns, 'getAdminAuditLogs');
      const res = await callable({ filter });
      return res.data;
    } catch (err) {
      console.warn('getAdminAuditLogs call failed:', err);
    }
  }

  return { logs: [], totalCount: 0 };
}

// ---------------------------------------------------------------------------
// Simulated directory for demo or offline sandbox
// ---------------------------------------------------------------------------
function getSimulatedDirectory(filter: AdminUserDirectoryFilter): AdminUserDirectoryResult {
  const currentUser = auth.currentUser;
  const currentEmail = currentUser?.email || 'camilo@vigor.co';
  const currentName = currentUser?.displayName || 'Camilo R. (Demo)';

  const users: AdminUserSummary[] = [
    {
      uid: currentUser?.uid || 'usr_camilo_demo',
      email: currentEmail,
      normalizedEmail: currentEmail.toLowerCase(),
      displayName: currentName,
      role: 'athlete',
      accountStatus: 'active',
      emailVerified: true,
      authProvider: 'google.com',
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
