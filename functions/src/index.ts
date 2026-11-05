/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Cloud Functions v2 Callable Entry Point (Increment 7D)
 *
 * Protected administrative operations using Firebase Admin SDK and Custom Claims.
 * Connects exclusively to named database: ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  getNamedFirestore,
  getActorRoleFromClaims,
  listAdminUsers as listUsersLogic,
  getAdminUserDetail as getUserDetailLogic,
  createAdminInvitation as createInviteLogic,
  revokeAdminInvitation as revokeInviteLogic,
  acceptAdminInvitation as acceptInviteLogic,
  setAdminUserRole as setRoleLogic,
  setAdminUserStatus as setStatusLogic,
  requestAdminPasswordReset as resetPasswordLogic,
  syncUserToDirectory as syncDirectoryLogic,
  getAdminAuditLogs as getAuditLogsLogic,
  getAdminPlatformStats as getStatsLogic,
} from './adminLogic';
import { requireAdminAuthorization } from './authGuard';

import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

if (!getApps().length) {
  initializeApp();
}

const db = getNamedFirestore();
const auth = getAuth();

/**
 * Handles errors gracefully into appropriate HttpsError
 */
function handleAdminError(err: any): never {
  const msg = err?.message || 'Error en operación administrativa.';
  if (msg.includes('Se requiere una sesión autenticada') || msg.includes('iniciar sesión')) {
    throw new HttpsError('unauthenticated', msg);
  }
  if (
    msg.includes('Acceso denegado') ||
    msg.includes('Escalada') ||
    msg.includes('desactualizado') ||
    msg.includes('bloqueada') ||
    msg.includes('suspendida')
  ) {
    throw new HttpsError('permission-denied', msg);
  }
  if (msg.includes('invitación no es válido') || msg.includes('obligatorio') || msg.includes('inválid')) {
    throw new HttpsError('invalid-argument', msg);
  }
  if (msg.includes('ha sido canjeada') || msg.includes('expirado') || msg.includes('revocada') || msg.includes('procesada en este momento')) {
    throw new HttpsError('failed-precondition', msg);
  }
  throw new HttpsError('internal', msg);
}

// ---------------------------------------------------------------------------
// 1. Directory Listing & Stats
// ---------------------------------------------------------------------------

export const listAdminUsers = onCall({ enforceAppCheck: false }, async request => {
  try {
    const actor = await requireAdminAuthorization(db, request.auth, 'users:list');
    return await listUsersLogic(db, actor.authoritativeRole, request.data?.filter || {});
  } catch (err: any) {
    handleAdminError(err);
  }
});

export const getAdminStats = onCall({ enforceAppCheck: false }, async request => {
  try {
    await requireAdminAuthorization(db, request.auth, 'users:stats');
    return await getStatsLogic(db);
  } catch (err: any) {
    handleAdminError(err);
  }
});

export const getAdminUserDetail = onCall({ enforceAppCheck: false }, async request => {
  const targetUid = request.data?.targetUid;
  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'El parámetro targetUid es obligatorio.');
  }
  try {
    const actor = await requireAdminAuthorization(db, request.auth, 'users:detail', { targetUid });
    return await getUserDetailLogic(db, actor.authoritativeRole, targetUid);
  } catch (err: any) {
    handleAdminError(err);
  }
});

// ---------------------------------------------------------------------------
// 2. Invitations
// ---------------------------------------------------------------------------

export const createAdminInvitation = onCall({ enforceAppCheck: false }, async request => {
  const { targetEmail, targetRole } = request.data || {};
  if (!targetEmail || !targetRole) {
    throw new HttpsError('invalid-argument', 'Los parámetros targetEmail y targetRole son obligatorios.');
  }
  try {
    const actor = await requireAdminAuthorization(db, request.auth, 'invitations:create', { targetRole });
    return await createInviteLogic(db, actor.uid, actor.authoritativeRole, actor.email, targetEmail, targetRole);
  } catch (err: any) {
    handleAdminError(err);
  }
});

export const revokeAdminInvitation = onCall({ enforceAppCheck: false }, async request => {
  const { inviteId, reason } = request.data || {};
  if (!inviteId) {
    throw new HttpsError('invalid-argument', 'El parámetro inviteId es obligatorio.');
  }
  try {
    const actor = await requireAdminAuthorization(db, request.auth, 'invitations:revoke');
    await revokeInviteLogic(db, actor.uid, actor.authoritativeRole, actor.email, inviteId, reason);
    return { success: true };
  } catch (err: any) {
    handleAdminError(err);
  }
});

export const acceptAdminInvitation = onCall({ enforceAppCheck: false }, async request => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Operación denegada: Debe iniciar sesión para canjear la invitación.');
  }
  const callerUid = request.auth.uid;
  const callerEmail = request.auth.token.email || '';
  const callerEmailVerified = Boolean(request.auth.token.email_verified);
  const { inviteId, token } = request.data || {};
  if (!inviteId || !token) {
    throw new HttpsError('invalid-argument', 'Los parámetros inviteId y token son obligatorios.');
  }
  try {
    return await acceptInviteLogic(db, auth, callerUid, callerEmail, callerEmailVerified, inviteId, token);
  } catch (err: any) {
    handleAdminError(err);
  }
});

// ---------------------------------------------------------------------------
// 3. Role & Account Status
// ---------------------------------------------------------------------------

export const setAdminUserRole = onCall({ enforceAppCheck: false }, async request => {
  const { targetUid, newRole, reason } = request.data || {};
  if (!targetUid || !newRole) {
    throw new HttpsError('invalid-argument', 'Los parámetros targetUid y newRole son obligatorios.');
  }
  try {
    const actor = await requireAdminAuthorization(db, request.auth, 'users:setRole', { targetUid, targetRole: newRole });
    await setRoleLogic(db, auth, actor.uid, actor.authoritativeRole, actor.email, targetUid, newRole, reason);
    return { success: true };
  } catch (err: any) {
    handleAdminError(err);
  }
});

export const setAdminUserStatus = onCall({ enforceAppCheck: false }, async request => {
  const { targetUid, newStatus, reason } = request.data || {};
  if (!targetUid || !newStatus) {
    throw new HttpsError('invalid-argument', 'Los parámetros targetUid y newStatus son obligatorios.');
  }
  try {
    const actor = await requireAdminAuthorization(db, request.auth, 'users:setStatus', { targetUid });
    await setStatusLogic(db, auth, actor.uid, actor.authoritativeRole, actor.email, targetUid, newStatus, reason);
    return { success: true };
  } catch (err: any) {
    handleAdminError(err);
  }
});

export const requestAdminPasswordReset = onCall({ enforceAppCheck: false }, async request => {
  const { targetUid } = request.data || {};
  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'El parámetro targetUid es obligatorio.');
  }
  try {
    const actor = await requireAdminAuthorization(db, request.auth, 'users:resetPassword', { targetUid });
    return await resetPasswordLogic(db, auth, actor.uid, actor.authoritativeRole, actor.email, targetUid);
  } catch (err: any) {
    handleAdminError(err);
  }
});

// ---------------------------------------------------------------------------
// 4. Directory Sync & Audit Logs
// ---------------------------------------------------------------------------

export const syncCurrentUserDirectory = onCall({ enforceAppCheck: false }, async request => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para sincronizar su directorio.');
  }
  try {
    const summary = await syncDirectoryLogic(db, auth, request.auth.uid, request.auth.uid);
    return { success: true, summary };
  } catch (err: any) {
    throw new HttpsError('internal', err.message || 'Error al sincronizar directorio del usuario.');
  }
});

export const getAdminAuditLogs = onCall({ enforceAppCheck: false }, async request => {
  try {
    const actor = await requireAdminAuthorization(db, request.auth, 'audit:list');
    return await getAuditLogsLogic(db, actor.authoritativeRole, request.data?.filter || {});
  } catch (err: any) {
    handleAdminError(err);
  }
});
