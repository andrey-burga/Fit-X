import { Router } from 'express';
import { loadEnvConfig, getSanitizedEnvSummary } from '../config/env.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  const env = loadEnvConfig();
  res.json({
    status: 'ok',
    service: 'vigorcore-catalyst-poc',
    timestamp: new Date().toISOString(),
    config: getSanitizedEnvSummary(env),
  });
});
