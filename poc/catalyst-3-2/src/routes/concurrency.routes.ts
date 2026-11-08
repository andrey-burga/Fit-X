import { Router } from 'express';
import { TestRepository } from '../nosql/testRepository.js';

export const concurrencyRouter = Router();
const repository = new TestRepository();

/**
 * POST /poc/concurrency/lock/acquire
 * Acquire lease lock with fencing token
 */
concurrencyRouter.post('/lock/acquire', async (req, res) => {
  try {
    const { resourceId, holderId, durationMs } = req.body;
    if (!resourceId || !holderId) {
      res.status(400).json({ success: false, error: 'MISSING_PARAMS', message: 'resourceId and holderId are required' });
      return;
    }

    const result = await repository.acquireLeaseLock(resourceId, holderId, durationMs || 5000);
    if (result.success) {
      res.json({ success: true, fencingToken: result.fencingToken });
    } else {
      res.status(409).json({ success: false, error: result.error });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/**
 * POST /poc/concurrency/lock/release
 * Release lease lock with fencing token check
 */
concurrencyRouter.post('/lock/release', async (req, res) => {
  try {
    const { resourceId, holderId, fencingToken } = req.body;
    if (!resourceId || !holderId || fencingToken === undefined) {
      res.status(400).json({ success: false, error: 'MISSING_PARAMS' });
      return;
    }

    const result = await repository.releaseLeaseLock(resourceId, holderId, Number(fencingToken));
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(409).json({ success: false, error: result.error });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/**
 * POST /poc/concurrency/superadmin/decrement
 * Atomically decrement superadmin counter with condition > 1
 */
concurrencyRouter.post('/superadmin/decrement', async (_req, res) => {
  try {
    const result = await repository.decrementSuperadminCounterAtomic();
    if (result.success) {
      res.json({ success: true, newCount: result.newCount });
    } else {
      res.status(409).json({ success: false, error: result.error });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
