import { Router } from 'express';
import { requireCatalystAuth } from '../auth/authGuard.js';

export const authRouter = Router();

/**
 * GET /poc/me
 * Strictly protected endpoint demonstrating session resolution,
 * rejection of spoofing headers/queries, and separation of status and is_confirmed.
 */
authRouter.get('/me', requireCatalystAuth, (req, res) => {
  const actor = req.actor!;

  res.json({
    success: true,
    data: {
      userId: actor.userId,
      email: actor.email,
      role: actor.role,
      status: actor.status,
      isConfirmed: actor.isConfirmed,
    },
  });
});
