/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Cloud Functions Core Administrative Logic (Increment 7D)
 *
 * IMPORTANT:
 * Named Firestore Database ID: ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c
 * Custom Claims are the single source of truth for authorization.
 * Zero plaintext token storage (SHA-256 hashes only).
 */

import * as crypto from 'crypto';
import { Firestore, Query, FieldValue } from '@google-cloud/firestore';
import type { Auth } from 'firebase-admin/auth';
import {
  UserRole,
  AccountAccessStatus,
  AdminUserSummary,
  AdminUserDirectoryFilter,
  AdminUserDirectoryResult,
  AdminPlatformStats,
  AdminInvitation,
  AdminRoleStateRecord,
  AccountAccessRecord,
  AdminAuditLog,
  AdminAuditLogFilter,
} from './types';

export const VIGORCORE_PROJECT_ID = 'gen-lang-client-0041212770';
export const VIGORCORE_DATABASE_ID = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';

/**
 * Returns a Firestore instance explicitly configured with the named database.
 * In Cloud Functions v2, uses the official public constructor from @google-cloud/firestore
 * with Application Default Credentials (ADC), explicit projectId, and explicit databaseId.
 * Cero monkey-patching y cero mutación de propiedades privadas.
 */
export function getNamedFirestore(appOrCustomDb?: any): Firestore {
  if (appOrCustomDb) {
    if (typeof appOrCustomDb.firestore === 'function') {
      return appOrCustomDb.firestore();
    }
    if (typeof appOrCustomDb.collection === 'function') {
      return appOrCustomDb as Firestore;
    }
    if (appOrCustomDb.options?.projectId) {
      return new Firestore({
        projectId: appOrCustomDb.options.projectId,
        databaseId: VIGORCORE_DATABASE_ID,
      });
    }
  }
  return new Firestore({
    projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || VIGORCORE_PROJECT_ID,
    databaseId: VIGORCORE_DATABASE_ID,
  });
}

/**
 * Normalizes email address for consistent comparison and search.
 */
export function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

/**
 * Computes a cryptographic SHA-256 hash of a string.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * Compares two hex hashes in constant time to prevent timing attacks.
 */
export function timingSafeHashCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a.trim(), 'hex');
    const bufB = Buffer.from(b.trim(), 'hex');
    if (bufA.length !== bufB.length || bufA.length === 0) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Generates a secure random 32-byte hex token.
 */
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Appends an entry to the append-only audit trail in Firestore.
 */
export async function writeAuditLog(
  db: Firestore,
  entry: Omit<AdminAuditLog, 'eventId' | 'timestamp'>
): Promise<string> {
  const eventId = `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const timestamp = new Date().toISOString();

  let serverTimestampVal: any = undefined;
  try {
    if (typeof FieldValue !== 'undefined' && FieldValue.serverTimestamp) {
      serverTimestampVal = FieldValue.serverTimestamp();
    }
  } catch {}

  const auditDoc: AdminAuditLog = {
    ...entry,
    eventId,
    status: entry.status || 'completed',
    timestamp,
    ...(serverTimestampVal ? { serverTimestamp: serverTimestampVal } : {}),
  };

  await db.collection('adminAuditLogs').doc(eventId).set(auditDoc);
  return eventId;
}

/**
 * Resolves verified actor role from custom claims. Defaults to 'athlete'.
 */
export function getActorRoleFromClaims(claims?: Record<string, any> | null): UserRole {
  if (!claims || !claims.role) return 'athlete';
  const role = claims.role;
  if (role === 'superadmin' || role === 'admin' || role === 'athlete') {
    return role;
  }
  return 'athlete';
}

/**
 * Asserts that the actor is at least an admin.
 */
export function assertAdminOrSuperadmin(actorRole: UserRole, actionName: string): void {
  if (actorRole !== 'admin' && actorRole !== 'superadmin') {
    throw new Error(`Acceso denegado: Se requiere rol de administrador para [${actionName}]. Rol actual: ${actorRole}`);
  }
}

/**
 * Asserts that the actor is a superadmin.
 */
export function assertSuperadmin(actorRole: UserRole, actionName: string): void {
  if (actorRole !== 'superadmin') {
    throw new Error(`Acceso denegado: Se requiere rol de superadministrador para [${actionName}]. Rol actual: ${actorRole}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Directory Listing & Platform Statistics
// ---------------------------------------------------------------------------

export async function getAdminPlatformStats(db: Firestore): Promise<AdminPlatformStats> {
  const directorySnap = await db.collection('adminUserDirectory').get();
  const invitationsSnap = await db.collection('adminInvitations').where('status', '==', 'pending').get();

  let totalUsers = 0;
  let activeUsers = 0;
  let suspendedUsers = 0;
  let pendingVerificationUsers = 0;
  let recentSignups30d = 0;

  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  directorySnap.forEach((docSnap: any) => {
    totalUsers++;
    const data = docSnap.data() as AdminUserSummary;
    if (data.accountStatus === 'suspended') {
      suspendedUsers++;
    } else if (data.emailVerified === false) {
      pendingVerificationUsers++;
    } else {
      activeUsers++;
    }

    if (data.createdAt) {
      const createdTime = Date.parse(data.createdAt);
      if (!isNaN(createdTime) && now - createdTime <= thirtyDaysMs) {
        recentSignups30d++;
      }
    }
  });

  return {
    totalUsers,
    activeUsers,
    suspendedUsers,
    pendingVerificationUsers,
    pendingInvitations: invitationsSnap.size,
    recentSignups30d,
  };
}

export async function listAdminUsers(
  db: Firestore,
  actorRole: UserRole,
  filter: AdminUserDirectoryFilter = {}
): Promise<AdminUserDirectoryResult> {
  assertAdminOrSuperadmin(actorRole, 'listAdminUsers');

  let queryRef: Query = db.collection('adminUserDirectory');

  if (filter.role && filter.role !== 'all') {
    queryRef = queryRef.where('role', '==', filter.role);
  }
  if (filter.accountStatus && filter.accountStatus !== 'all') {
    queryRef = queryRef.where('accountStatus', '==', filter.accountStatus);
  }
  if (filter.emailVerified !== undefined && filter.emailVerified !== 'all') {
    queryRef = queryRef.where('emailVerified', '==', Boolean(filter.emailVerified));
  }

  const snapshot = await queryRef.get();
  let allUsers: AdminUserSummary[] = [];

  snapshot.forEach((docSnap: any) => {
    allUsers.push(docSnap.data() as AdminUserSummary);
  });

  // Client-side search & range filtering if needed
  if (filter.searchQuery && filter.searchQuery.trim().length > 0) {
    const q = filter.searchQuery.trim().toLowerCase();
    allUsers = allUsers.filter(u =>
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.displayName && u.displayName.toLowerCase().includes(q)) ||
      (u.uid && u.uid.toLowerCase().includes(q))
    );
  }

  if (filter.dateFrom) {
    const fromTime = Date.parse(filter.dateFrom);
    if (!isNaN(fromTime)) {
      allUsers = allUsers.filter(u => Date.parse(u.createdAt) >= fromTime);
    }
  }

  if (filter.dateTo) {
    const toTime = Date.parse(filter.dateTo);
    if (!isNaN(toTime)) {
      allUsers = allUsers.filter(u => Date.parse(u.createdAt) <= toTime);
    }
  }

  // Sorting
  const sortBy = filter.sortBy || 'createdAt';
  const sortOrder = filter.sortOrder || 'desc';
  allUsers.sort((a, b) => {
    let valA = (a as any)[sortBy] || '';
    let valB = (b as any)[sortBy] || '';
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  const totalCount = allUsers.length;
  const page = Math.max(1, filter.page || 1);
  const pageSize = Math.max(1, Math.min(100, filter.pageSize || 20));
  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  const startIndex = (page - 1) * pageSize;
  const pagedUsers = allUsers.slice(startIndex, startIndex + pageSize);

  const stats = await getAdminPlatformStats(db);

  return {
    users: pagedUsers,
    totalCount,
    page,
    pageSize,
    totalPages,
    stats,
  };
}

export async function getAdminUserDetail(
  db: Firestore,
  actorRole: UserRole,
  targetUid: string
): Promise<{ user: AdminUserSummary; accessRecord?: AccountAccessRecord; recentLogs: AdminAuditLog[] }> {
  assertAdminOrSuperadmin(actorRole, 'getAdminUserDetail');

  const userDoc = await db.collection('adminUserDirectory').doc(targetUid).get();
  if (!userDoc.exists) {
    throw new Error(`Usuario [${targetUid}] no encontrado en el directorio administrativo.`);
  }

  const accessDoc = await db.collection('accountAccess').doc(targetUid).get();
  const logsSnap = await db.collection('adminAuditLogs')
    .where('targetUid', '==', targetUid)
    .orderBy('timestamp', 'desc')
    .limit(10)
    .get();

  const recentLogs: AdminAuditLog[] = [];
  logsSnap.forEach((snap: any) => recentLogs.push(snap.data() as AdminAuditLog));

  return {
    user: userDoc.data() as AdminUserSummary,
    accessRecord: accessDoc.exists ? (accessDoc.data() as AccountAccessRecord) : undefined,
    recentLogs,
  };
}

// ---------------------------------------------------------------------------
// 2. Invitations System
// ---------------------------------------------------------------------------

export async function createAdminInvitation(
  db: Firestore,
  actorUid: string,
  actorRole: UserRole,
  actorEmail: string,
  targetEmail: string,
  targetRole: 'athlete' | 'admin'
): Promise<{ inviteId: string; rawToken: string; inviteLink: string; expiresAt: string }> {
  assertAdminOrSuperadmin(actorRole, 'createAdminInvitation');

  const normalizedEmail = normalizeEmail(targetEmail);
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('Dirección de correo electrónico inválida.');
  }

  // Privilege escalation check
  if (targetRole === 'admin' && actorRole !== 'superadmin') {
    throw new Error('Escalada de privilegios bloqueada: Solo un superadministrador puede invitar administradores.');
  }
  if ((targetRole as any) === 'superadmin') {
    throw new Error('Escalada de privilegios bloqueada: No se permite invitar superadministradores por flujo ordinario.');
  }

  // Check for existing active invitations
  const existingInvites = await db.collection('adminInvitations')
    .where('emailNormalized', '==', normalizedEmail)
    .where('status', '==', 'pending')
    .get();

  const nowMs = Date.now();
  for (const docSnap of existingInvites.docs) {
    const inv = docSnap.data() as AdminInvitation;
    if (Date.parse(inv.expiresAt) > nowMs) {
      throw new Error(`Ya existe una invitación pendiente y activa para el correo ${normalizedEmail}.`);
    } else {
      // Mark as expired
      await docSnap.ref.update({ status: 'expired' });
    }
  }

  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const inviteId = `inv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  const invitation: AdminInvitation = {
    inviteId,
    emailNormalized: normalizedEmail,
    targetRole,
    status: 'pending',
    tokenHash,
    createdBy: actorUid,
    createdByName: actorEmail,
    createdAt,
    expiresAt,
  };

  await db.collection('adminInvitations').doc(inviteId).set(invitation);

  await writeAuditLog(db, {
    action: 'user_invited',
    actorUid,
    actorRole,
    actorEmail,
    targetEmail: normalizedEmail,
    reason: `Invitación creada con rol [${targetRole}].`,
    metadata: { inviteId, targetRole, expiresAt },
  });

  const inviteLink = `https://fit-x-bhnatsxl.onslate.com/#/aceptar-invitacion?inviteId=${inviteId}&token=${rawToken}`;

  return {
    inviteId,
    rawToken,
    inviteLink,
    expiresAt,
  };
}

export async function revokeAdminInvitation(
  db: Firestore,
  actorUid: string,
  actorRole: UserRole,
  actorEmail: string,
  inviteId: string,
  reason?: string
): Promise<void> {
  assertAdminOrSuperadmin(actorRole, 'revokeAdminInvitation');

  const inviteRef = db.collection('adminInvitations').doc(inviteId);
  const inviteSnap = await inviteRef.get();

  if (!inviteSnap.exists) {
    throw new Error(`Invitación [${inviteId}] no encontrada.`);
  }

  const invite = inviteSnap.data() as AdminInvitation;
  if (invite.status !== 'pending') {
    throw new Error(`La invitación no se puede revocar porque se encuentra en estado [${invite.status}].`);
  }

  // Admin cannot revoke invitations for roles higher than they can create
  if (invite.targetRole === 'admin' && actorRole !== 'superadmin') {
    throw new Error('Solo un superadministrador puede revocar invitaciones administrativas.');
  }

  await inviteRef.update({
    status: 'revoked',
    revokedBy: actorUid,
    revokedAt: new Date().toISOString(),
  });

  await writeAuditLog(db, {
    action: 'invitation_revoked',
    actorUid,
    actorRole,
    actorEmail,
    targetEmail: invite.emailNormalized,
    reason: reason || 'Invitación revocada por personal administrativo.',
    metadata: { inviteId },
  });
}

export async function acceptAdminInvitation(
  db: Firestore,
  auth: Auth,
  callerUid: string,
  callerEmail: string,
  callerEmailVerified: boolean,
  inviteId: string,
  rawToken: string
): Promise<{ success: boolean; assignedRole: UserRole; message: string }> {
  if (!callerEmailVerified) {
    throw new Error('Verificación requerida: Debe verificar su correo electrónico antes de canjear una invitación.');
  }

  const normalizedCallerEmail = normalizeEmail(callerEmail);
  const inviteRef = db.collection('adminInvitations').doc(inviteId);
  const operationId = `op_redeem_${inviteId}_${callerUid}`;
  const opRef = db.collection('adminInvitationOperations').doc(operationId);

  // Phase 1: Atomic validation and state lock ('pending' -> 'redeeming')
  let inviteData: AdminInvitation;

  const performAtomicLock = async (transaction?: any) => {
    const inviteSnap = transaction ? await transaction.get(inviteRef) : await inviteRef.get();
    if (!inviteSnap.exists) {
      throw new Error('La invitación no existe o ha sido eliminada.');
    }

    const currentInvite = inviteSnap.data() as AdminInvitation;

    // Idempotent redemption check for the same user
    if (currentInvite.status === 'redeemed') {
      if (currentInvite.redeemedBy === callerUid) {
        return currentInvite;
      }
      throw new Error('Esta invitación ya ha sido canjeada anteriormente.');
    }

    if (currentInvite.status === 'revoked') {
      throw new Error('Esta invitación ha sido revocada por un administrador.');
    }

    if (Date.now() > Date.parse(currentInvite.expiresAt)) {
      if (transaction) {
        transaction.update(inviteRef, { status: 'expired' });
      } else {
        await inviteRef.update({ status: 'expired' });
      }
      throw new Error('Esta invitación ha expirado.');
    }

    // Concurrency protection: check if another worker has locked this invitation
    if (currentInvite.status === 'redeeming') {
      const lockTime = currentInvite.lockedAt ? Date.parse(currentInvite.lockedAt) : 0;
      const isStaleLock = Date.now() - lockTime > 5 * 60 * 1000; // 5 min auto-recovery
      
      if (currentInvite.lockedBy === callerUid) {
        // Same user resuming in-flight saga: renew lock
        const renewUpdate = {
          lockedAt: new Date().toISOString(),
          operationId,
        };
        if (transaction) {
          transaction.update(inviteRef, renewUpdate);
        } else {
          await inviteRef.update(renewUpdate);
        }
        return currentInvite;
      }

      if (!isStaleLock) {
        throw new Error('La invitación está siendo procesada en este momento. Intente nuevamente en unos instantes.');
      }

      // Stale lock (> 5 min) by a DIFFERENT user:
      // Exact operation ownership verification:
      // Verify if previous locker's specific operation completed and matches lastOperationId in adminRoleState
      const previousLockerUid = currentInvite.lockedBy;
      if (previousLockerUid) {
        const previousOpId = currentInvite.operationId || `op_redeem_${inviteId}_${previousLockerUid}`;
        const prevOpDoc = await db.collection('adminInvitationOperations').doc(previousOpId).get();
        const prevOpData = prevOpDoc.exists ? (prevOpDoc.data() as import('./types').AdminInvitationOperation) : null;

        const prevRoleDoc = await db.collection('adminRoleState').doc(previousLockerUid).get();
        const prevRoleData = prevRoleDoc.exists ? (prevRoleDoc.data() as AdminRoleStateRecord) : null;

        const opCompleted = !!(prevOpData && (prevOpData.status === 'role_confirmed' || prevOpData.status === 'completed'));
        const roleMatches = !!(prevRoleData && prevRoleData.role === currentInvite.targetRole && prevRoleData.lastOperationId === previousOpId);

        if (opCompleted && roleMatches) {
          // Reconcile invitation to redeemed by the previous user to prevent double consumption
          const reconcileUpdate = {
            status: 'redeemed' as const,
            redeemedBy: previousLockerUid,
            redeemedAt: prevOpData?.updatedAt || new Date().toISOString(),
            operationId: previousOpId,
            roleVersionAssigned: prevRoleData?.roleVersion,
          };
          if (transaction) {
            transaction.update(inviteRef, reconcileUpdate);
          } else {
            await inviteRef.update(reconcileUpdate);
          }
          throw new Error('Esta invitación ya fue consumida previamente por otro usuario durante el procesamiento.');
        }
      }

      // If previous locker did not complete the operation or state is indeterminate, fail-closed security block
      throw new Error('Bloqueo de seguridad: La invitación quedó en estado de reserva indeterminado y requiere intervención administrativa.');
    }

    if (currentInvite.emailNormalized !== normalizedCallerEmail) {
      throw new Error(`El correo de la sesión (${normalizedCallerEmail}) no coincide con el destinatario de la invitación.`);
    }

    // Cryptographic constant-time comparison against timing side channels
    const computedHash = hashToken(rawToken);
    const isValid = timingSafeHashCompare(computedHash, currentInvite.tokenHash);
    if (!isValid) {
      throw new Error('El token de invitación no es válido.');
    }

    const nowIso = new Date().toISOString();

    // Atomic reservation lock
    const lockUpdate = {
      status: 'redeeming' as const,
      lockedBy: callerUid,
      lockedAt: nowIso,
      operationId,
    };

    if (transaction) {
      transaction.update(inviteRef, lockUpdate);
    } else {
      await inviteRef.update(lockUpdate);
    }

    // Record initial operation state: reserved
    const opRecord: import('./types').AdminInvitationOperation = {
      operationId,
      inviteId,
      callerUid,
      targetRole: currentInvite.targetRole,
      status: 'reserved',
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    if (transaction) {
      transaction.set(opRef, opRecord);
    } else {
      await opRef.set(opRecord);
    }

    return currentInvite;
  };

  if (typeof db.runTransaction === 'function') {
    inviteData = await db.runTransaction(async tx => performAtomicLock(tx));
  } else {
    inviteData = await performAtomicLock();
  }

  // Check if idempotent return was triggered
  if (inviteData.status === 'redeemed' && inviteData.redeemedBy === callerUid) {
    return {
      success: true,
      assignedRole: inviteData.targetRole,
      message: 'Invitación previamente canjeada con éxito.',
    };
  }

  // Phase 2: Role provisioning with monotonic roleVersion, live adminRoleState, operation lifecycle and claim assignment
  const redeemedAt = new Date().toISOString();
  try {
    // 2.1 Mark operation in_progress
    await opRef.set({ status: 'in_progress', updatedAt: new Date().toISOString() }, { merge: true });

    const userRecord = await auth.getUser(callerUid);
    const currentClaims = userRecord.customClaims || {};

    // Determine monotonic next roleVersion for this user
    const roleStateRef = db.collection('adminRoleState').doc(callerUid);
    const existingRoleSnap = await roleStateRef.get();
    const currentVersion = existingRoleSnap.exists
      ? ((existingRoleSnap.data() as AdminRoleStateRecord)?.roleVersion || 0)
      : (typeof currentClaims.roleVersion === 'number' ? currentClaims.roleVersion : 0);
    const assignedRoleVersion = Math.max(1, currentVersion + 1);

    const updatedClaims = {
      ...currentClaims,
      role: inviteData.targetRole,
      roleVersion: assignedRoleVersion,
    };

    // 2.2 Assign claims and track claims_assigned
    await auth.setCustomUserClaims(callerUid, updatedClaims);
    await opRef.set({ status: 'claims_assigned', updatedAt: new Date().toISOString() }, { merge: true });

    // 2.3 Write live authoritative role state in adminRoleState/{callerUid} with lastOperationId
    const roleStateDoc: AdminRoleStateRecord = {
      uid: callerUid,
      role: inviteData.targetRole,
      roleVersion: assignedRoleVersion,
      updatedAt: redeemedAt,
      updatedBy: 'invitation',
      lastOperationId: operationId,
    };
    await roleStateRef.set(roleStateDoc);
    await opRef.set({ status: 'role_confirmed', updatedAt: new Date().toISOString() }, { merge: true });

    // Invalidate refresh tokens to force fresh ID token with new roleVersion
    try {
      await auth.revokeRefreshTokens(callerUid);
    } catch {}

    // Mark invitation redeemed
    await inviteRef.update({
      status: 'redeemed',
      redeemedBy: callerUid,
      redeemedAt,
      operationId,
      roleVersionAssigned: assignedRoleVersion,
    });

    // Update administrative directory
    const directoryRef = db.collection('adminUserDirectory').doc(callerUid);
    await directoryRef.set(
      {
        uid: callerUid,
        email: callerEmail,
        normalizedEmail: normalizedCallerEmail,
        displayName: userRecord.displayName || callerEmail.split('@')[0],
        role: inviteData.targetRole,
        accountStatus: 'active',
        emailVerified: true,
        authProvider: userRecord.providerData[0]?.providerId === 'google.com' ? 'google.com' : 'password',
        createdAt: userRecord.metadata.creationTime || new Date().toISOString(),
        lastSignInAt: userRecord.metadata.lastSignInTime || new Date().toISOString(),
        updatedAt: redeemedAt,
      },
      { merge: true }
    );

    // Ensure accountAccess is active with validAfter in integer Unix epoch seconds
    const nowEpochSeconds = Math.floor(Date.now() / 1000);
    await db.collection('accountAccess').doc(callerUid).set({
      uid: callerUid,
      status: 'active',
      updatedAt: redeemedAt,
      validAfter: nowEpochSeconds,
    }, { merge: true });

    // 2.4 Mark operation completed
    await opRef.set({ status: 'completed', updatedAt: new Date().toISOString() }, { merge: true });

    await writeAuditLog(db, {
      action: 'invitation_redeemed',
      status: 'completed',
      actorUid: callerUid,
      actorRole: inviteData.targetRole,
      actorEmail: callerEmail,
      targetUid: callerUid,
      targetEmail: callerEmail,
      reason: `Invitación [${inviteId}] canjeada exitosamente. Rol asignado: [${inviteData.targetRole}] (v${assignedRoleVersion}).`,
      metadata: { inviteId, assignedRole: inviteData.targetRole, roleVersion: assignedRoleVersion, operationId },
    });

    return {
      success: true,
      assignedRole: inviteData.targetRole,
      message: `¡Bienvenido! Se te ha asignado el rol [${inviteData.targetRole}].`,
    };
  } catch (err: any) {
    // Record operation failure
    try {
      await opRef.set({
        operationId,
        inviteId,
        callerUid,
        targetRole: inviteData.targetRole,
        status: 'failed',
        failureCode: err.message || 'unknown_error',
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    } catch {}

    // Rollback reservation lock to pending so user can retry safely
    try {
      const rollbackFields: Record<string, any> = {
        status: 'pending',
      };
      if (typeof FieldValue !== 'undefined' && FieldValue.delete) {
        rollbackFields.lockedBy = FieldValue.delete();
        rollbackFields.lockedAt = FieldValue.delete();
      } else {
        delete (rollbackFields as any).lockedBy;
        delete (rollbackFields as any).lockedAt;
      }
      await inviteRef.update(rollbackFields);
    } catch {}

    throw err;
  }
}

// ---------------------------------------------------------------------------
// 3. User Role Management (Superadmin Only)
// ---------------------------------------------------------------------------

export async function setAdminUserRole(
  db: Firestore,
  auth: Auth,
  actorUid: string,
  actorRole: UserRole,
  actorEmail: string,
  targetUid: string,
  newRole: UserRole,
  reason?: string
): Promise<void> {
  assertSuperadmin(actorRole, 'setAdminUserRole');

  if (actorUid === targetUid && newRole !== 'superadmin') {
    // Check if actor is the last superadmin
    const superAdminsSnap = await db.collection('adminUserDirectory')
      .where('role', '==', 'superadmin')
      .where('accountStatus', '==', 'active')
      .get();

    if (superAdminsSnap.size <= 1) {
      throw new Error('Operación bloqueada: No puede remover su propio rol de superadministrador siendo el único superadministrador activo de la plataforma.');
    }
  }

  const targetUserRecord = await auth.getUser(targetUid);
  const currentClaims = targetUserRecord.customClaims || {};
  const oldRole = currentClaims.role || 'athlete';

  if (oldRole === newRole) {
    return; // Idempotent
  }

  // Prevent leaving system without superadmins
  if (oldRole === 'superadmin' && newRole !== 'superadmin') {
    const superAdminsSnap = await db.collection('adminUserDirectory')
      .where('role', '==', 'superadmin')
      .where('accountStatus', '==', 'active')
      .get();

    if (superAdminsSnap.size <= 1) {
      throw new Error('Operación bloqueada: No se puede degradar al último superadministrador activo del sistema.');
    }
  }

  // 1. Authoritative Role State: Update adminRoleState/{targetUid}
  const roleStateRef = db.collection('adminRoleState').doc(targetUid);
  const existingRoleStateSnap = await roleStateRef.get();
  const currentVersion = existingRoleStateSnap.exists
    ? ((existingRoleStateSnap.data() as AdminRoleStateRecord)?.roleVersion || 0)
    : (typeof currentClaims.roleVersion === 'number' ? currentClaims.roleVersion : 0);
  const nextVersion = Math.max(1, currentVersion + 1);
  const nowIso = new Date().toISOString();

  const roleStateDoc: AdminRoleStateRecord = {
    uid: targetUid,
    role: newRole,
    roleVersion: nextVersion,
    updatedAt: nowIso,
    updatedBy: actorUid,
  };
  await roleStateRef.set(roleStateDoc);

  // 2. Propagate to Firebase Auth Custom Claims (including roleVersion)
  const updatedClaims = {
    ...currentClaims,
    role: newRole,
    roleVersion: nextVersion,
  };
  await auth.setCustomUserClaims(targetUid, updatedClaims);

  // 3. Immediately revoke refresh tokens so client will request fresh ID token
  try {
    await auth.revokeRefreshTokens(targetUid);
  } catch {}

  // 4. Update administrative directory
  await db.collection('adminUserDirectory').doc(targetUid).set(
    {
      role: newRole,
      updatedAt: nowIso,
    },
    { merge: true }
  );

  // 5. Append-only audit trail
  await writeAuditLog(db, {
    action: 'role_updated',
    status: 'completed',
    actorUid,
    actorRole,
    actorEmail,
    targetUid,
    targetEmail: targetUserRecord.email || undefined,
    reason: reason || `Rol modificado de [${oldRole}] a [${newRole}] (v${nextVersion}).`,
    changes: {
      before: { role: oldRole },
      after: { role: newRole },
    },
    metadata: { roleVersion: nextVersion },
  });
}

// ---------------------------------------------------------------------------
// 4. Account Suspension & Reactivation (Fail-Closed Sequence)
// ---------------------------------------------------------------------------

export async function setAdminUserStatus(
  db: Firestore,
  auth: Auth,
  actorUid: string,
  actorRole: UserRole,
  actorEmail: string,
  targetUid: string,
  newStatus: 'active' | 'suspended',
  reason?: string
): Promise<void> {
  assertAdminOrSuperadmin(actorRole, 'setAdminUserStatus');

  if (actorUid === targetUid) {
    throw new Error('Operación bloqueada: No puede suspender o deshabilitar su propia cuenta.');
  }

  const targetUser = await auth.getUser(targetUid);
  const targetClaims = targetUser.customClaims || {};
  const targetRole = (targetClaims.role as UserRole) || 'athlete';

  // Role hierarchy validation
  if (actorRole === 'admin') {
    if (targetRole === 'admin' || targetRole === 'superadmin') {
      throw new Error(`Escalada bloqueada: Un administrador solo puede gestionar el estado de atletas, no de [${targetRole}].`);
    }
  }

  if (targetRole === 'superadmin') {
    const activeSuperAdmins = await db.collection('adminUserDirectory')
      .where('role', '==', 'superadmin')
      .where('accountStatus', '==', 'active')
      .get();

    if (activeSuperAdmins.size <= 1) {
      throw new Error('Operación bloqueada: No puede suspender al único superadministrador activo de la plataforma.');
    }
  }

  const nowIso = new Date().toISOString();
  const nowEpochSeconds = Math.floor(Date.now() / 1000);

  if (newStatus === 'suspended') {
    // FAIL-CLOSED SUSPENSION SEQUENCE:
    // Step 1: Write accountAccess FIRST so firestore.rules isAccountActive() immediately blocks access!
    const accessDoc: AccountAccessRecord = {
      uid: targetUid,
      status: 'suspended',
      updatedAt: nowIso,
      suspendedAt: nowIso,
      suspendedBy: actorUid,
      validAfter: nowEpochSeconds,
      reasonCode: reason || 'administrative_suspension',
    };
    await db.collection('accountAccess').doc(targetUid).set(accessDoc);

    // Step 2: Disable user in Firebase Auth and revoke refresh tokens
    let authError: any = null;
    try {
      await auth.updateUser(targetUid, { disabled: true });
      await auth.revokeRefreshTokens(targetUid);
    } catch (err: any) {
      authError = err;
    }

    if (authError) {
      await writeAuditLog(db, {
        action: 'account_suspended',
        status: 'partially_completed',
        actorUid,
        actorRole,
        actorEmail,
        targetUid,
        targetEmail: targetUser.email || undefined,
        reason: `Fallo parcial en suspensión Auth: ${authError.message || authError}. Acceso en base de datos revocado de inmediato en accountAccess.`,
        metadata: { partialError: String(authError) },
      });
      throw authError;
    }

    // Step 3: Update directory entry
    await db.collection('adminUserDirectory').doc(targetUid).set(
      {
        accountStatus: 'suspended',
        suspendedAt: nowIso,
        suspendedBy: actorUid,
        suspensionReason: reason || 'administrative_suspension',
        updatedAt: nowIso,
      },
      { merge: true }
    );

    // Step 4: Audit log completed
    await writeAuditLog(db, {
      action: 'account_suspended',
      status: 'completed',
      actorUid,
      actorRole,
      actorEmail,
      targetUid,
      targetEmail: targetUser.email || undefined,
      reason: reason || 'Cuenta suspendida administrativamente.',
      changes: {
        before: { status: 'active', disabled: false },
        after: { status: 'suspended', disabled: true },
      },
    });
  } else {
    // Step 1: Enable user in Firebase Auth FIRST to ensure Auth account is ready
    await auth.updateUser(targetUid, { disabled: false });

    // Step 2: Revoke tokens to force fresh login session after reactivation
    try {
      await auth.revokeRefreshTokens(targetUid);
    } catch {}

    // Step 3: Retrieve updated UserRecord to read tokensValidAfterTime set by Firebase Auth
    const updatedUser = await auth.getUser(targetUid);
    let validAfterEpoch = nowEpochSeconds;
    const metadataAny = updatedUser.metadata as any;
    if (metadataAny && metadataAny.tokensValidAfterTime) {
      const parsedTime = Math.floor(Date.parse(metadataAny.tokensValidAfterTime) / 1000);
      if (!isNaN(parsedTime) && parsedTime > 0) {
        validAfterEpoch = parsedTime;
      }
    }

    // Step 4: Only after Auth succeeds and tokens are revoked, set accountAccess to active with validAfter epoch seconds
    const accessDoc: AccountAccessRecord = {
      uid: targetUid,
      status: 'active',
      updatedAt: nowIso,
      validAfter: validAfterEpoch,
    };
    await db.collection('accountAccess').doc(targetUid).set(accessDoc);

    // Step 4: Update directory
    await db.collection('adminUserDirectory').doc(targetUid).set(
      {
        accountStatus: 'active',
        suspendedAt: FieldValue.delete ? FieldValue.delete() : undefined,
        suspendedBy: FieldValue.delete ? FieldValue.delete() : undefined,
        suspensionReason: FieldValue.delete ? FieldValue.delete() : undefined,
        updatedAt: nowIso,
      },
      { merge: true }
    );

    // Step 5: Audit log
    await writeAuditLog(db, {
      action: 'account_reactivated',
      status: 'completed',
      actorUid,
      actorRole,
      actorEmail,
      targetUid,
      targetEmail: targetUser.email || undefined,
      reason: reason || 'Cuenta reactivada administrativamente.',
      changes: {
        before: { status: 'suspended', disabled: true },
        after: { status: 'active', disabled: false },
      },
      metadata: { validAfter: validAfterEpoch },
    });
  }
}

// ---------------------------------------------------------------------------
// 5. Password Reset Request
// ---------------------------------------------------------------------------

export async function requestAdminPasswordReset(
  db: Firestore,
  auth: Auth,
  actorUid: string,
  actorRole: UserRole,
  actorEmail: string,
  targetUid: string
): Promise<{ success: boolean; emailSentTo: string }> {
  assertAdminOrSuperadmin(actorRole, 'requestAdminPasswordReset');

  const targetUser = await auth.getUser(targetUid);
  if (!targetUser.email) {
    throw new Error('El usuario no posee una dirección de correo registrada.');
  }

  // Generate password reset link through Admin SDK standard API
  await auth.generatePasswordResetLink(targetUser.email);

  await writeAuditLog(db, {
    action: 'password_reset_requested',
    actorUid,
    actorRole,
    actorEmail,
    targetUid,
    targetEmail: targetUser.email,
    reason: `Enlace de recuperación de contraseña solicitado por personal administrativo.`,
  });

  return {
    success: true,
    emailSentTo: targetUser.email,
  };
}

// ---------------------------------------------------------------------------
// 6. User Directory Synchronization & Audit Queries
// ---------------------------------------------------------------------------

export async function syncUserToDirectory(
  db: Firestore,
  auth: Auth,
  targetUid: string,
  actorUid?: string
): Promise<AdminUserSummary> {
  const userRecord = await auth.getUser(targetUid);
  const claims = userRecord.customClaims || {};
  const role = getActorRoleFromClaims(claims);

  const accessDoc = await db.collection('accountAccess').doc(targetUid).get();
  const accessData = accessDoc.exists ? (accessDoc.data() as AccountAccessRecord) : null;

  let accountStatus: AccountAccessStatus = 'active';
  if (userRecord.disabled || accessData?.status === 'suspended') {
    accountStatus = 'suspended';
  } else if (!userRecord.emailVerified) {
    accountStatus = 'pending_verification';
  }

  const nowIso = new Date().toISOString();
  const summary: AdminUserSummary = {
    uid: targetUid,
    email: userRecord.email || '',
    normalizedEmail: normalizeEmail(userRecord.email || ''),
    displayName: userRecord.displayName || userRecord.email?.split('@')[0] || 'Atleta Vigor',
    avatarUrl: userRecord.photoURL || undefined,
    role,
    accountStatus,
    emailVerified: Boolean(userRecord.emailVerified),
    authProvider: userRecord.providerData[0]?.providerId === 'google.com' ? 'google.com' : 'password',
    createdAt: userRecord.metadata.creationTime || nowIso,
    lastSignInAt: userRecord.metadata.lastSignInTime || undefined,
    updatedAt: nowIso,
    suspendedAt: accessData?.suspendedAt,
    suspendedBy: accessData?.suspendedBy,
    suspensionReason: accessData?.reasonCode,
  };

  await db.collection('adminUserDirectory').doc(targetUid).set(summary, { merge: true });

  return summary;
}

export async function getAdminAuditLogs(
  db: Firestore,
  actorRole: UserRole,
  filter: AdminAuditLogFilter = {}
): Promise<{ logs: AdminAuditLog[]; totalCount: number }> {
  assertAdminOrSuperadmin(actorRole, 'getAdminAuditLogs');

  let queryRef: Query = db.collection('adminAuditLogs');

  if (filter.action && filter.action !== 'all') {
    queryRef = queryRef.where('action', '==', filter.action);
  }
  if (filter.actorUid) {
    queryRef = queryRef.where('actorUid', '==', filter.actorUid);
  }
  if (filter.targetUid) {
    queryRef = queryRef.where('targetUid', '==', filter.targetUid);
  }

  queryRef = queryRef.orderBy('timestamp', 'desc');

  const snapshot = await queryRef.get();
  let allLogs: AdminAuditLog[] = [];

  snapshot.forEach((docSnap: any) => {
    allLogs.push(docSnap.data() as AdminAuditLog);
  });

  if (filter.dateFrom) {
    const fromTime = Date.parse(filter.dateFrom);
    if (!isNaN(fromTime)) {
      allLogs = allLogs.filter(l => Date.parse(l.timestamp) >= fromTime);
    }
  }

  if (filter.dateTo) {
    const toTime = Date.parse(filter.dateTo);
    if (!isNaN(toTime)) {
      allLogs = allLogs.filter(l => Date.parse(l.timestamp) <= toTime);
    }
  }

  const totalCount = allLogs.length;
  const page = Math.max(1, filter.page || 1);
  const pageSize = Math.max(1, Math.min(100, filter.pageSize || 20));
  const startIndex = (page - 1) * pageSize;

  return {
    logs: allLogs.slice(startIndex, startIndex + pageSize),
    totalCount,
  };
}
