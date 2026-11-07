/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Centralized Authorization Guard (Increment 7D.1)
 *
 * Enforces dynamic multi-layer authorization:
 * 1. Authenticated Identity (request.auth).
 * 2. Active Account Verification (accountAccess/{uid} !== 'suspended').
 * 3. Authoritative Role State Verification (adminRoleState/{uid}).
 * 4. Anti-Stale-Token Matching (request.auth.token.role === adminRoleState.role).
 * 5. Granular Permission Matrix & Hierarchy Restrictions.
 */

import { Firestore } from '@google-cloud/firestore';
import { UserRole, AdminRoleStateRecord, AccountAccessRecord } from './types';

export type AdminPermission =
  | 'users:list'
  | 'users:detail'
  | 'users:stats'
  | 'invitations:create'
  | 'invitations:revoke'
  | 'users:setRole'
  | 'users:setStatus'
  | 'users:resetPassword'
  | 'audit:list';

export const PERMISSION_MATRIX: Record<AdminPermission, UserRole[]> = {
  'users:list': ['admin', 'superadmin'],
  'users:detail': ['admin', 'superadmin'],
  'users:stats': ['admin', 'superadmin'],
  'invitations:create': ['admin', 'superadmin'],
  'invitations:revoke': ['admin', 'superadmin'],
  'users:setRole': ['superadmin'], // Superadmin only
  'users:setStatus': ['admin', 'superadmin'],
  'users:resetPassword': ['admin', 'superadmin'],
  'audit:list': ['admin', 'superadmin'],
};

export interface TargetConstraintInfo {
  targetUid?: string;
  targetRole?: UserRole;
}

export interface AuthorizedActorContext {
  uid: string;
  email: string;
  emailVerified: boolean;
  tokenRole: UserRole;
  tokenRoleVersion?: number;
  authoritativeRole: UserRole;
  authoritativeRoleVersion: number;
}

/**
 * Resolves verified actor role from custom claims token.
 */
export function getTokenRole(claims?: Record<string, any> | null): UserRole {
  if (!claims || !claims.role) return 'athlete';
  const role = claims.role;
  if (role === 'superadmin' || role === 'admin' || role === 'athlete') {
    return role;
  }
  return 'athlete';
}

/**
 * Central Authorization Guard executing all fail-closed checks:
 * 1. Authenticated Identity (request.auth.uid).
 * 2. Active Account Verification (accountAccess/{uid} === 'active').
 * 3. Session Freshness Check (request.auth.token.auth_time >= validAfter).
 * 4. Authoritative Role State Verification (adminRoleState/{uid}).
 * 5. Anti-Stale-Token Matching (token.role === state.role).
 * 6. Privilege Versioning Matching (token.roleVersion === state.roleVersion).
 * 7. Granular Permission Matrix & Hierarchy Restrictions.
 */
export async function requireAdminAuthorization(
  db: Firestore,
  authContext: { uid?: string; token?: Record<string, any> } | null | undefined,
  requiredPermission: AdminPermission,
  targetInfo?: TargetConstraintInfo
): Promise<AuthorizedActorContext> {
  // 1. Authenticated Identity
  if (!authContext || !authContext.uid) {
    throw new Error('Operación denegada: Se requiere una sesión autenticada.');
  }

  const actorUid = authContext.uid;
  const token = authContext.token || {};
  const actorEmail = token.email || '';
  const emailVerified = Boolean(token.email_verified);
  const tokenRole = getTokenRole(token);
  const tokenRoleVersion = token.roleVersion;

  // 2. Strict Privilege Versioning Check on Token for Administrative Operations:
  // Administrative roles must carry a verified numeric roleVersion claim.
  if (tokenRole === 'admin' || tokenRole === 'superadmin') {
    if (typeof tokenRoleVersion !== 'number') {
      throw new Error(
        'Autorización denegada: Token administrativo inválido o no versionado (roleVersion ausente). ' +
        'Por políticas de seguridad, debe iniciar sesión nuevamente para actualizar sus privilegios.'
      );
    }
  }

  // 3. Active Account Verification (accountAccess/{uid})
  // For administrative identities, the accountAccess record MUST exist, be active,
  // and be established after any revocation/reactivation window (validAfter).
  const accessSnap = await db.collection('accountAccess').doc(actorUid).get();
  if (!accessSnap.exists) {
    throw new Error('Acceso denegado: Registro de control de acceso no inicializado para la cuenta administrativa.');
  }

  const accessData = accessSnap.data() as AccountAccessRecord;
  if (accessData.status !== 'active') {
    throw new Error(`Cuenta suspendida o inactiva: Su acceso administrativo se encuentra en estado [${accessData.status}].`);
  }

  // 4. Session Freshness Validation (validAfter vs auth_time)
  // Strict comparison: auth_time MUST be strictly greater than validAfter (>).
  // Both timestamps are integer Unix epoch seconds.
  if (typeof accessData.validAfter === 'number') {
    if (typeof token.auth_time !== 'number') {
      throw new Error(
        'Sesión invalidada: auth_time ausente o inválido en el token de autenticación. Debe iniciar sesión nuevamente.'
      );
    }
    if (token.auth_time <= accessData.validAfter) {
      throw new Error(
        `Sesión invalidada: La sesión fue emitida antes o en el mismo instante de la última reactivación o revocación de seguridad ` +
        `(auth_time: ${token.auth_time} <= validAfter: ${accessData.validAfter}). Debe iniciar una nueva sesión.`
      );
    }
  }

  // 5. Live Authoritative Role State Verification (adminRoleState/{uid})
  // Absence of document or non-admin role means the user has NO administrative authority.
  const roleStateSnap = await db.collection('adminRoleState').doc(actorUid).get();
  if (!roleStateSnap.exists) {
    throw new Error('Autorización denegada: La cuenta no cuenta con un registro autoritativo en adminRoleState.');
  }

  const roleStateData = roleStateSnap.data() as AdminRoleStateRecord;
  const authoritativeRole = roleStateData.role;
  const authoritativeRoleVersion = roleStateData.roleVersion;

  if (authoritativeRole !== 'admin' && authoritativeRole !== 'superadmin') {
    throw new Error(`Autorización revocada: El rol actualmente registrado en el servidor es [${authoritativeRole}].`);
  }

  // 6. Anti-Stale-Token Matching (Role and RoleVersion):
  // Both role name AND version number must match exactly.
  if (tokenRole !== authoritativeRole) {
    throw new Error(
      `Autorización revocada o token desactualizado: El rol del token [${tokenRole}] ` +
      `no coincide con el rol actualmente autorizado en el servidor [${authoritativeRole}]. ` +
      `Por seguridad, debe refrescar sus credenciales.`
    );
  }

  if (tokenRoleVersion !== authoritativeRoleVersion) {
    throw new Error(
      `Autorización revocada o versión de privilegios desactualizada: La versión del token [v${tokenRoleVersion}] ` +
      `no coincide con la versión autorizada en el servidor [v${authoritativeRoleVersion}]. ` +
      `Por seguridad, debe refrescar sus credenciales.`
    );
  }

  // 7. Granular Permission Matrix Check
  const allowedRoles = PERMISSION_MATRIX[requiredPermission];
  if (!allowedRoles || !allowedRoles.includes(authoritativeRole)) {
    throw new Error(
      `Acceso denegado: El rol [${authoritativeRole}] no cuenta con el permiso [${requiredPermission}].`
    );
  }

  // 8. Target & Hierarchy Constraints
  if (targetInfo) {
    // Cannot act on self for destructive account actions
    if (requiredPermission === 'users:setStatus' && targetInfo.targetUid === actorUid) {
      throw new Error('Operación bloqueada: No puede suspender o deshabilitar su propia cuenta.');
    }

    // Admin cannot invite or promote admin/superadmin
    if (requiredPermission === 'invitations:create' && targetInfo.targetRole === 'admin') {
      if (authoritativeRole !== 'superadmin') {
        throw new Error('Escalada de privilegios bloqueada: Solo un superadministrador puede invitar administradores.');
      }
    }

    // Nobody can invite superadmin via standard web invitation
    if (requiredPermission === 'invitations:create' && (targetInfo.targetRole as any) === 'superadmin') {
      throw new Error('Escalada bloqueada: No se permite invitar superadministradores por flujo ordinario.');
    }
  }

  return {
    uid: actorUid,
    email: actorEmail,
    emailVerified,
    tokenRole,
    tokenRoleVersion,
    authoritativeRole,
    authoritativeRoleVersion,
  };
}
