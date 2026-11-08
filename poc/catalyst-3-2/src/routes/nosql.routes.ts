import { Router } from 'express';
import { TestRepository } from '../nosql/testRepository.js';
import { requireCatalystAuth } from '../auth/authGuard.js';

export const nosqlRouter = Router();
const repository = new TestRepository();

/**
 * POST /poc/nosql/insert
 * Insert fictional isolated item
 */
nosqlRouter.post('/insert', async (req, res) => {
  try {
    const { pk, sk, attributes } = req.body;
    if (!pk || !sk) {
      res.status(400).json({ success: false, error: 'MISSING_KEYS', message: 'pk and sk are required' });
      return;
    }

    const result = await repository.insertFictionalItem(pk, sk, attributes || {});
    if (result.success) {
      res.status(201).json({ success: true, durationMs: result.durationMs });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/**
 * GET /poc/nosql/item
 * Fetch fictional item
 */
nosqlRouter.get('/item', async (req, res) => {
  try {
    const pk = String(req.query.pk || '');
    const sk = req.query.sk ? String(req.query.sk) : undefined;
    if (!pk) {
      res.status(400).json({ success: false, error: 'MISSING_PK' });
      return;
    }

    const result = await repository.fetchFictionalItem(pk, sk);
    if (result.item) {
      res.json({ success: true, item: result.item, durationMs: result.durationMs });
    } else {
      res.status(404).json({ success: false, error: 'NOT_FOUND' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/**
 * GET /poc/nosql/logs
 * Retrieve telemetry and execution logs of all NoSQL operations
 */
nosqlRouter.get('/logs', (_req, res) => {
  res.json({
    success: true,
    logs: repository.getLogs(),
  });
});

/**
 * GET /poc/athlete/record/:recordId
 * Protected athlete privacy test endpoint
 * Strictly asserts ownerUid === req.actor.userId
 */
nosqlRouter.get('/athlete/record/:recordId', requireCatalystAuth, async (req, res) => {
  try {
    const actor = req.actor!;
    const recordId = req.params.recordId;

    // Fail-closed against UID manipulation via query or body
    if (req.query.ownerUid && req.query.ownerUid !== actor.userId) {
      res.status(403).json({
        success: false,
        error: 'UID_MANIPULATION_ATTEMPT_REJECTED',
        message: 'Client cannot request records for another athlete via query parameter.',
      });
      return;
    }

    // Records are partitioned by authenticated actor's userId
    const pk = `POC#3.2#ATHLETE#${actor.userId}`;
    const sk = `RECORD#${recordId}`;

    const result = await repository.fetchFictionalItem(pk, sk);
    if (!result.item) {
      res.status(404).json({ success: false, error: 'RECORD_NOT_FOUND' });
      return;
    }

    // Final security check: ownerUid in document must match authenticated session
    if (result.item.ownerUid !== actor.userId) {
      res.status(403).json({
        success: false,
        error: 'FORBIDDEN_RECORD_ACCESS',
        message: 'Security invariant violation: Athlete cannot read records belonging to another athlete.',
      });
      return;
    }

    res.json({
      success: true,
      data: {
        recordId,
        ownerUid: result.item.ownerUid,
        fictionalMetric: result.item.fictionalMetric,
        fictionalValue: result.item.fictionalValue,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
