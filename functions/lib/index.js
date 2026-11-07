"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Cloud Functions v2 Callable Entry Point (Increment 7D)
 *
 * Protected administrative operations using Firebase Admin SDK and Custom Claims.
 * Connects exclusively to named database: ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAdminAuditLogs = exports.syncCurrentUserDirectory = exports.requestAdminPasswordReset = exports.setAdminUserStatus = exports.setAdminUserRole = exports.acceptAdminInvitation = exports.revokeAdminInvitation = exports.createAdminInvitation = exports.getAdminUserDetail = exports.getAdminStats = exports.listAdminUsers = void 0;
const https_1 = require("firebase-functions/v2/https");
const adminLogic_1 = require("./adminLogic");
const authGuard_1 = require("./authGuard");
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
if (!(0, app_1.getApps)().length) {
    (0, app_1.initializeApp)();
}
const db = (0, adminLogic_1.getNamedFirestore)();
const auth = (0, auth_1.getAuth)();
/**
 * Handles errors gracefully into appropriate HttpsError
 */
function handleAdminError(err) {
    const msg = err?.message || 'Error en operación administrativa.';
    if (msg.includes('Se requiere una sesión autenticada') || msg.includes('iniciar sesión')) {
        throw new https_1.HttpsError('unauthenticated', msg);
    }
    if (msg.includes('Acceso denegado') ||
        msg.includes('Escalada') ||
        msg.includes('desactualizado') ||
        msg.includes('bloqueada') ||
        msg.includes('suspendida')) {
        throw new https_1.HttpsError('permission-denied', msg);
    }
    if (msg.includes('invitación no es válido') || msg.includes('obligatorio') || msg.includes('inválid')) {
        throw new https_1.HttpsError('invalid-argument', msg);
    }
    if (msg.includes('ha sido canjeada') || msg.includes('expirado') || msg.includes('revocada') || msg.includes('procesada en este momento')) {
        throw new https_1.HttpsError('failed-precondition', msg);
    }
    throw new https_1.HttpsError('internal', msg);
}
// ---------------------------------------------------------------------------
// 1. Directory Listing & Stats
// ---------------------------------------------------------------------------
exports.listAdminUsers = (0, https_1.onCall)({ enforceAppCheck: false }, async (request) => {
    try {
        const actor = await (0, authGuard_1.requireAdminAuthorization)(db, request.auth, 'users:list');
        return await (0, adminLogic_1.listAdminUsers)(db, actor.authoritativeRole, request.data?.filter || {});
    }
    catch (err) {
        handleAdminError(err);
    }
});
exports.getAdminStats = (0, https_1.onCall)({ enforceAppCheck: false }, async (request) => {
    try {
        await (0, authGuard_1.requireAdminAuthorization)(db, request.auth, 'users:stats');
        return await (0, adminLogic_1.getAdminPlatformStats)(db);
    }
    catch (err) {
        handleAdminError(err);
    }
});
exports.getAdminUserDetail = (0, https_1.onCall)({ enforceAppCheck: false }, async (request) => {
    const targetUid = request.data?.targetUid;
    if (!targetUid) {
        throw new https_1.HttpsError('invalid-argument', 'El parámetro targetUid es obligatorio.');
    }
    try {
        const actor = await (0, authGuard_1.requireAdminAuthorization)(db, request.auth, 'users:detail', { targetUid });
        return await (0, adminLogic_1.getAdminUserDetail)(db, actor.authoritativeRole, targetUid);
    }
    catch (err) {
        handleAdminError(err);
    }
});
// ---------------------------------------------------------------------------
// 2. Invitations
// ---------------------------------------------------------------------------
exports.createAdminInvitation = (0, https_1.onCall)({ enforceAppCheck: false }, async (request) => {
    const { targetEmail, targetRole } = request.data || {};
    if (!targetEmail || !targetRole) {
        throw new https_1.HttpsError('invalid-argument', 'Los parámetros targetEmail y targetRole son obligatorios.');
    }
    try {
        const actor = await (0, authGuard_1.requireAdminAuthorization)(db, request.auth, 'invitations:create', { targetRole });
        return await (0, adminLogic_1.createAdminInvitation)(db, actor.uid, actor.authoritativeRole, actor.email, targetEmail, targetRole);
    }
    catch (err) {
        handleAdminError(err);
    }
});
exports.revokeAdminInvitation = (0, https_1.onCall)({ enforceAppCheck: false }, async (request) => {
    const { inviteId, reason } = request.data || {};
    if (!inviteId) {
        throw new https_1.HttpsError('invalid-argument', 'El parámetro inviteId es obligatorio.');
    }
    try {
        const actor = await (0, authGuard_1.requireAdminAuthorization)(db, request.auth, 'invitations:revoke');
        await (0, adminLogic_1.revokeAdminInvitation)(db, actor.uid, actor.authoritativeRole, actor.email, inviteId, reason);
        return { success: true };
    }
    catch (err) {
        handleAdminError(err);
    }
});
exports.acceptAdminInvitation = (0, https_1.onCall)({ enforceAppCheck: false }, async (request) => {
    if (!request.auth || !request.auth.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Operación denegada: Debe iniciar sesión para canjear la invitación.');
    }
    const callerUid = request.auth.uid;
    const callerEmail = request.auth.token.email || '';
    const callerEmailVerified = Boolean(request.auth.token.email_verified);
    const { inviteId, token } = request.data || {};
    if (!inviteId || !token) {
        throw new https_1.HttpsError('invalid-argument', 'Los parámetros inviteId y token son obligatorios.');
    }
    try {
        return await (0, adminLogic_1.acceptAdminInvitation)(db, auth, callerUid, callerEmail, callerEmailVerified, inviteId, token);
    }
    catch (err) {
        handleAdminError(err);
    }
});
// ---------------------------------------------------------------------------
// 3. Role & Account Status
// ---------------------------------------------------------------------------
exports.setAdminUserRole = (0, https_1.onCall)({ enforceAppCheck: false }, async (request) => {
    const { targetUid, newRole, reason } = request.data || {};
    if (!targetUid || !newRole) {
        throw new https_1.HttpsError('invalid-argument', 'Los parámetros targetUid y newRole son obligatorios.');
    }
    try {
        const actor = await (0, authGuard_1.requireAdminAuthorization)(db, request.auth, 'users:setRole', { targetUid, targetRole: newRole });
        await (0, adminLogic_1.setAdminUserRole)(db, auth, actor.uid, actor.authoritativeRole, actor.email, targetUid, newRole, reason);
        return { success: true };
    }
    catch (err) {
        handleAdminError(err);
    }
});
exports.setAdminUserStatus = (0, https_1.onCall)({ enforceAppCheck: false }, async (request) => {
    const { targetUid, newStatus, reason } = request.data || {};
    if (!targetUid || !newStatus) {
        throw new https_1.HttpsError('invalid-argument', 'Los parámetros targetUid y newStatus son obligatorios.');
    }
    try {
        const actor = await (0, authGuard_1.requireAdminAuthorization)(db, request.auth, 'users:setStatus', { targetUid });
        await (0, adminLogic_1.setAdminUserStatus)(db, auth, actor.uid, actor.authoritativeRole, actor.email, targetUid, newStatus, reason);
        return { success: true };
    }
    catch (err) {
        handleAdminError(err);
    }
});
exports.requestAdminPasswordReset = (0, https_1.onCall)({ enforceAppCheck: false }, async (request) => {
    const { targetUid } = request.data || {};
    if (!targetUid) {
        throw new https_1.HttpsError('invalid-argument', 'El parámetro targetUid es obligatorio.');
    }
    try {
        const actor = await (0, authGuard_1.requireAdminAuthorization)(db, request.auth, 'users:resetPassword', { targetUid });
        return await (0, adminLogic_1.requestAdminPasswordReset)(db, auth, actor.uid, actor.authoritativeRole, actor.email, targetUid);
    }
    catch (err) {
        handleAdminError(err);
    }
});
// ---------------------------------------------------------------------------
// 4. Directory Sync & Audit Logs
// ---------------------------------------------------------------------------
exports.syncCurrentUserDirectory = (0, https_1.onCall)({ enforceAppCheck: false }, async (request) => {
    if (!request.auth || !request.auth.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Debe iniciar sesión para sincronizar su directorio.');
    }
    try {
        const summary = await (0, adminLogic_1.syncUserToDirectory)(db, auth, request.auth.uid, request.auth.uid);
        return { success: true, summary };
    }
    catch (err) {
        throw new https_1.HttpsError('internal', err.message || 'Error al sincronizar directorio del usuario.');
    }
});
exports.getAdminAuditLogs = (0, https_1.onCall)({ enforceAppCheck: false }, async (request) => {
    try {
        const actor = await (0, authGuard_1.requireAdminAuthorization)(db, request.auth, 'audit:list');
        return await (0, adminLogic_1.getAdminAuditLogs)(db, actor.authoritativeRole, request.data?.filter || {});
    }
    catch (err) {
        handleAdminError(err);
    }
});
//# sourceMappingURL=index.js.map