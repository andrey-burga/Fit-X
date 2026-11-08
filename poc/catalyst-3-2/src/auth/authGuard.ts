import type { Request, Response, NextFunction } from 'express';
import { getAuthClient } from './catalystAuth.js';
import type { AuthenticatedActor, UserRole } from '../types/actor.js';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      actor?: AuthenticatedActor;
    }
  }
}

export async function requireCatalystAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Fail-closed rule: Explicitly reject any spoofed identity in headers, body, or query
  const forbiddenHeaders = ['x-user-id', 'x-role', 'x-auth-uid', 'x-actor-id'];
  for (const h of forbiddenHeaders) {
    if (req.headers[h]) {
      res.status(403).json({
        success: false,
        error: 'IDENTITY_SPOOFING_REJECTED',
        message: `Header '${h}' is prohibited. Identity must be resolved server-side from Catalyst session.`,
      });
      return;
    }
  }

  try {
    const authClient = getAuthClient();
    const catalystUser = await authClient.getCurrentUser(req);

    if (!catalystUser || !catalystUser.user_id) {
      res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Missing or invalid Catalyst session. No active user found.',
      });
      return;
    }

    // Check account status
    const statusUpper = (catalystUser.status || '').toUpperCase();
    if (statusUpper !== 'ACTIVE') {
      res.status(403).json({
        success: false,
        error: 'ACCOUNT_DISABLED',
        message: `User account is not active. Current status: ${catalystUser.status}`,
      });
      return;
    }

    // Check confirmation status separately from status
    if (catalystUser.is_confirmed !== true) {
      res.status(403).json({
        success: false,
        error: 'ACCOUNT_UNCONFIRMED',
        message: 'User email confirmation is pending. Account cannot perform authenticated operations.',
      });
      return;
    }

    // Map role safely
    const roleName = (catalystUser.role_details?.role_name || 'athlete').toLowerCase();
    let validatedRole: UserRole = 'athlete';
    if (roleName === 'superadmin' || roleName === 'super_admin') {
      validatedRole = 'superadmin';
    } else if (roleName === 'admin') {
      validatedRole = 'admin';
    }

    req.actor = {
      userId: catalystUser.user_id,
      email: catalystUser.email_id,
      role: validatedRole,
      status: 'ACTIVE',
      isConfirmed: true,
      roleVersion: 1,
      validAfter: 0,
      authTime: Date.now(),
    };

    next();
  } catch (err) {
    res.status(401).json({
      success: false,
      error: 'AUTH_VERIFICATION_FAILED',
      message: err instanceof Error ? err.message : 'Unknown authentication error',
    });
  }
}
