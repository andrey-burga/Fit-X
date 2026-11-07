"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.VIGORCORE_DATABASE_ID = void 0;
exports.getNamedFirestore = getNamedFirestore;
exports.normalizeEmail = normalizeEmail;
exports.hashToken = hashToken;
exports.timingSafeHashCompare = timingSafeHashCompare;
exports.generateSecureToken = generateSecureToken;
exports.writeAuditLog = writeAuditLog;
exports.getActorRoleFromClaims = getActorRoleFromClaims;
exports.assertAdminOrSuperadmin = assertAdminOrSuperadmin;
exports.assertSuperadmin = assertSuperadmin;
exports.getAdminPlatformStats = getAdminPlatformStats;
exports.listAdminUsers = listAdminUsers;
exports.getAdminUserDetail = getAdminUserDetail;
exports.createAdminInvitation = createAdminInvitation;
exports.revokeAdminInvitation = revokeAdminInvitation;
exports.acceptAdminInvitation = acceptAdminInvitation;
exports.setAdminUserRole = setAdminUserRole;
exports.setAdminUserStatus = setAdminUserStatus;
exports.requestAdminPasswordReset = requestAdminPasswordReset;
exports.syncUserToDirectory = syncUserToDirectory;
exports.getAdminAuditLogs = getAdminAuditLogs;
const crypto = __importStar(require("crypto"));
const firestore_1 = require("firebase-admin/firestore");
exports.VIGORCORE_DATABASE_ID = 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c';
/**
 * Returns a Firestore instance explicitly configured with the named database.
 */
function getNamedFirestore(app) {
    try {
        return app ? (0, firestore_1.getFirestore)(app, exports.VIGORCORE_DATABASE_ID) : (0, firestore_1.getFirestore)(exports.VIGORCORE_DATABASE_ID);
    }
    catch {
        const defaultFs = app ? (0, firestore_1.getFirestore)(app) : (0, firestore_1.getFirestore)();
        defaultFs.databaseId = exports.VIGORCORE_DATABASE_ID;
        return defaultFs;
    }
}
/**
 * Normalizes email address for consistent comparison and search.
 */
function normalizeEmail(email) {
    return (email || '').trim().toLowerCase();
}
/**
 * Computes a cryptographic SHA-256 hash of a string.
 */
function hashToken(token) {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
}
/**
 * Compares two hex hashes in constant time to prevent timing attacks.
 */
function timingSafeHashCompare(a, b) {
    try {
        const bufA = Buffer.from(a.trim(), 'hex');
        const bufB = Buffer.from(b.trim(), 'hex');
        if (bufA.length !== bufB.length || bufA.length === 0) {
            return false;
        }
        return crypto.timingSafeEqual(bufA, bufB);
    }
    catch {
        return false;
    }
}
/**
 * Generates a secure random 32-byte hex token.
 */
function generateSecureToken() {
    return crypto.randomBytes(32).toString('hex');
}
/**
 * Appends an entry to the append-only audit trail in Firestore.
 */
async function writeAuditLog(db, entry) {
    const eventId = `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const timestamp = new Date().toISOString();
    let serverTimestampVal = undefined;
    try {
        if (typeof firestore_1.FieldValue !== 'undefined' && firestore_1.FieldValue.serverTimestamp) {
            serverTimestampVal = firestore_1.FieldValue.serverTimestamp();
        }
    }
    catch { }
    const auditDoc = {
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
function getActorRoleFromClaims(claims) {
    if (!claims || !claims.role)
        return 'athlete';
    const role = claims.role;
    if (role === 'superadmin' || role === 'admin' || role === 'athlete') {
        return role;
    }
    return 'athlete';
}
/**
 * Asserts that the actor is at least an admin.
 */
function assertAdminOrSuperadmin(actorRole, actionName) {
    if (actorRole !== 'admin' && actorRole !== 'superadmin') {
        throw new Error(`Acceso denegado: Se requiere rol de administrador para [${actionName}]. Rol actual: ${actorRole}`);
    }
}
/**
 * Asserts that the actor is a superadmin.
 */
function assertSuperadmin(actorRole, actionName) {
    if (actorRole !== 'superadmin') {
        throw new Error(`Acceso denegado: Se requiere rol de superadministrador para [${actionName}]. Rol actual: ${actorRole}`);
    }
}
// ---------------------------------------------------------------------------
// 1. Directory Listing & Platform Statistics
// ---------------------------------------------------------------------------
async function getAdminPlatformStats(db) {
    const directorySnap = await db.collection('adminUserDirectory').get();
    const invitationsSnap = await db.collection('adminInvitations').where('status', '==', 'pending').get();
    let totalUsers = 0;
    let activeUsers = 0;
    let suspendedUsers = 0;
    let pendingVerificationUsers = 0;
    let recentSignups30d = 0;
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    directorySnap.forEach((docSnap) => {
        totalUsers++;
        const data = docSnap.data();
        if (data.accountStatus === 'suspended') {
            suspendedUsers++;
        }
        else if (data.emailVerified === false) {
            pendingVerificationUsers++;
        }
        else {
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
async function listAdminUsers(db, actorRole, filter = {}) {
    assertAdminOrSuperadmin(actorRole, 'listAdminUsers');
    let queryRef = db.collection('adminUserDirectory');
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
    let allUsers = [];
    snapshot.forEach((docSnap) => {
        allUsers.push(docSnap.data());
    });
    // Client-side search & range filtering if needed
    if (filter.searchQuery && filter.searchQuery.trim().length > 0) {
        const q = filter.searchQuery.trim().toLowerCase();
        allUsers = allUsers.filter(u => (u.email && u.email.toLowerCase().includes(q)) ||
            (u.displayName && u.displayName.toLowerCase().includes(q)) ||
            (u.uid && u.uid.toLowerCase().includes(q)));
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
        let valA = a[sortBy] || '';
        let valB = b[sortBy] || '';
        if (typeof valA === 'string')
            valA = valA.toLowerCase();
        if (typeof valB === 'string')
            valB = valB.toLowerCase();
        if (valA < valB)
            return sortOrder === 'asc' ? -1 : 1;
        if (valA > valB)
            return sortOrder === 'asc' ? 1 : -1;
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
async function getAdminUserDetail(db, actorRole, targetUid) {
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
    const recentLogs = [];
    logsSnap.forEach((snap) => recentLogs.push(snap.data()));
    return {
        user: userDoc.data(),
        accessRecord: accessDoc.exists ? accessDoc.data() : undefined,
        recentLogs,
    };
}
// ---------------------------------------------------------------------------
// 2. Invitations System
// ---------------------------------------------------------------------------
async function createAdminInvitation(db, actorUid, actorRole, actorEmail, targetEmail, targetRole) {
    assertAdminOrSuperadmin(actorRole, 'createAdminInvitation');
    const normalizedEmail = normalizeEmail(targetEmail);
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
        throw new Error('Dirección de correo electrónico inválida.');
    }
    // Privilege escalation check
    if (targetRole === 'admin' && actorRole !== 'superadmin') {
        throw new Error('Escalada de privilegios bloqueada: Solo un superadministrador puede invitar administradores.');
    }
    if (targetRole === 'superadmin') {
        throw new Error('Escalada de privilegios bloqueada: No se permite invitar superadministradores por flujo ordinario.');
    }
    // Check for existing active invitations
    const existingInvites = await db.collection('adminInvitations')
        .where('emailNormalized', '==', normalizedEmail)
        .where('status', '==', 'pending')
        .get();
    const nowMs = Date.now();
    for (const docSnap of existingInvites.docs) {
        const inv = docSnap.data();
        if (Date.parse(inv.expiresAt) > nowMs) {
            throw new Error(`Ya existe una invitación pendiente y activa para el correo ${normalizedEmail}.`);
        }
        else {
            // Mark as expired
            await docSnap.ref.update({ status: 'expired' });
        }
    }
    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);
    const inviteId = `inv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
    const invitation = {
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
async function revokeAdminInvitation(db, actorUid, actorRole, actorEmail, inviteId, reason) {
    assertAdminOrSuperadmin(actorRole, 'revokeAdminInvitation');
    const inviteRef = db.collection('adminInvitations').doc(inviteId);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) {
        throw new Error(`Invitación [${inviteId}] no encontrada.`);
    }
    const invite = inviteSnap.data();
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
async function acceptAdminInvitation(db, auth, callerUid, callerEmail, callerEmailVerified, inviteId, rawToken) {
    if (!callerEmailVerified) {
        throw new Error('Verificación requerida: Debe verificar su correo electrónico antes de canjear una invitación.');
    }
    const normalizedCallerEmail = normalizeEmail(callerEmail);
    const inviteRef = db.collection('adminInvitations').doc(inviteId);
    const operationId = `op_redeem_${inviteId}_${callerUid}`;
    const opRef = db.collection('adminInvitationOperations').doc(operationId);
    // Phase 1: Atomic validation and state lock ('pending' -> 'redeeming')
    let inviteData;
    const performAtomicLock = async (transaction) => {
        const inviteSnap = transaction ? await transaction.get(inviteRef) : await inviteRef.get();
        if (!inviteSnap.exists) {
            throw new Error('La invitación no existe o ha sido eliminada.');
        }
        const currentInvite = inviteSnap.data();
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
            }
            else {
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
                }
                else {
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
                const prevOpData = prevOpDoc.exists ? prevOpDoc.data() : null;
                const prevRoleDoc = await db.collection('adminRoleState').doc(previousLockerUid).get();
                const prevRoleData = prevRoleDoc.exists ? prevRoleDoc.data() : null;
                const opCompleted = !!(prevOpData && (prevOpData.status === 'role_confirmed' || prevOpData.status === 'completed'));
                const roleMatches = !!(prevRoleData && prevRoleData.role === currentInvite.targetRole && prevRoleData.lastOperationId === previousOpId);
                if (opCompleted && roleMatches) {
                    // Reconcile invitation to redeemed by the previous user to prevent double consumption
                    const reconcileUpdate = {
                        status: 'redeemed',
                        redeemedBy: previousLockerUid,
                        redeemedAt: prevOpData?.updatedAt || new Date().toISOString(),
                        operationId: previousOpId,
                        roleVersionAssigned: prevRoleData?.roleVersion,
                    };
                    if (transaction) {
                        transaction.update(inviteRef, reconcileUpdate);
                    }
                    else {
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
            status: 'redeeming',
            lockedBy: callerUid,
            lockedAt: nowIso,
            operationId,
        };
        if (transaction) {
            transaction.update(inviteRef, lockUpdate);
        }
        else {
            await inviteRef.update(lockUpdate);
        }
        // Record initial operation state: reserved
        const opRecord = {
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
        }
        else {
            await opRef.set(opRecord);
        }
        return currentInvite;
    };
    if (typeof db.runTransaction === 'function') {
        inviteData = await db.runTransaction(async (tx) => performAtomicLock(tx));
    }
    else {
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
            ? (existingRoleSnap.data()?.roleVersion || 0)
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
        const roleStateDoc = {
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
        }
        catch { }
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
        await directoryRef.set({
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
        }, { merge: true });
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
    }
    catch (err) {
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
        }
        catch { }
        // Rollback reservation lock to pending so user can retry safely
        try {
            const rollbackFields = {
                status: 'pending',
            };
            if (typeof firestore_1.FieldValue !== 'undefined' && firestore_1.FieldValue.delete) {
                rollbackFields.lockedBy = firestore_1.FieldValue.delete();
                rollbackFields.lockedAt = firestore_1.FieldValue.delete();
            }
            else {
                delete rollbackFields.lockedBy;
                delete rollbackFields.lockedAt;
            }
            await inviteRef.update(rollbackFields);
        }
        catch { }
        throw err;
    }
}
// ---------------------------------------------------------------------------
// 3. User Role Management (Superadmin Only)
// ---------------------------------------------------------------------------
async function setAdminUserRole(db, auth, actorUid, actorRole, actorEmail, targetUid, newRole, reason) {
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
        ? (existingRoleStateSnap.data()?.roleVersion || 0)
        : (typeof currentClaims.roleVersion === 'number' ? currentClaims.roleVersion : 0);
    const nextVersion = Math.max(1, currentVersion + 1);
    const nowIso = new Date().toISOString();
    const roleStateDoc = {
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
    }
    catch { }
    // 4. Update administrative directory
    await db.collection('adminUserDirectory').doc(targetUid).set({
        role: newRole,
        updatedAt: nowIso,
    }, { merge: true });
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
async function setAdminUserStatus(db, auth, actorUid, actorRole, actorEmail, targetUid, newStatus, reason) {
    assertAdminOrSuperadmin(actorRole, 'setAdminUserStatus');
    if (actorUid === targetUid) {
        throw new Error('Operación bloqueada: No puede suspender o deshabilitar su propia cuenta.');
    }
    const targetUser = await auth.getUser(targetUid);
    const targetClaims = targetUser.customClaims || {};
    const targetRole = targetClaims.role || 'athlete';
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
        const accessDoc = {
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
        let authError = null;
        try {
            await auth.updateUser(targetUid, { disabled: true });
            await auth.revokeRefreshTokens(targetUid);
        }
        catch (err) {
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
        await db.collection('adminUserDirectory').doc(targetUid).set({
            accountStatus: 'suspended',
            suspendedAt: nowIso,
            suspendedBy: actorUid,
            suspensionReason: reason || 'administrative_suspension',
            updatedAt: nowIso,
        }, { merge: true });
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
    }
    else {
        // Step 1: Enable user in Firebase Auth FIRST to ensure Auth account is ready
        await auth.updateUser(targetUid, { disabled: false });
        // Step 2: Revoke tokens to force fresh login session after reactivation
        try {
            await auth.revokeRefreshTokens(targetUid);
        }
        catch { }
        // Step 3: Retrieve updated UserRecord to read tokensValidAfterTime set by Firebase Auth
        const updatedUser = await auth.getUser(targetUid);
        let validAfterEpoch = nowEpochSeconds;
        const metadataAny = updatedUser.metadata;
        if (metadataAny && metadataAny.tokensValidAfterTime) {
            const parsedTime = Math.floor(Date.parse(metadataAny.tokensValidAfterTime) / 1000);
            if (!isNaN(parsedTime) && parsedTime > 0) {
                validAfterEpoch = parsedTime;
            }
        }
        // Step 4: Only after Auth succeeds and tokens are revoked, set accountAccess to active with validAfter epoch seconds
        const accessDoc = {
            uid: targetUid,
            status: 'active',
            updatedAt: nowIso,
            validAfter: validAfterEpoch,
        };
        await db.collection('accountAccess').doc(targetUid).set(accessDoc);
        // Step 4: Update directory
        await db.collection('adminUserDirectory').doc(targetUid).set({
            accountStatus: 'active',
            suspendedAt: firestore_1.FieldValue.delete ? firestore_1.FieldValue.delete() : undefined,
            suspendedBy: firestore_1.FieldValue.delete ? firestore_1.FieldValue.delete() : undefined,
            suspensionReason: firestore_1.FieldValue.delete ? firestore_1.FieldValue.delete() : undefined,
            updatedAt: nowIso,
        }, { merge: true });
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
async function requestAdminPasswordReset(db, auth, actorUid, actorRole, actorEmail, targetUid) {
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
async function syncUserToDirectory(db, auth, targetUid, actorUid) {
    const userRecord = await auth.getUser(targetUid);
    const claims = userRecord.customClaims || {};
    const role = getActorRoleFromClaims(claims);
    const accessDoc = await db.collection('accountAccess').doc(targetUid).get();
    const accessData = accessDoc.exists ? accessDoc.data() : null;
    let accountStatus = 'active';
    if (userRecord.disabled || accessData?.status === 'suspended') {
        accountStatus = 'suspended';
    }
    else if (!userRecord.emailVerified) {
        accountStatus = 'pending_verification';
    }
    const nowIso = new Date().toISOString();
    const summary = {
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
async function getAdminAuditLogs(db, actorRole, filter = {}) {
    assertAdminOrSuperadmin(actorRole, 'getAdminAuditLogs');
    let queryRef = db.collection('adminAuditLogs');
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
    let allLogs = [];
    snapshot.forEach((docSnap) => {
        allLogs.push(docSnap.data());
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
//# sourceMappingURL=adminLogic.js.map