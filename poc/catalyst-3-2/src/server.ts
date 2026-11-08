import express from 'express';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { nosqlRouter } from './routes/nosql.routes.js';
import { concurrencyRouter } from './routes/concurrency.routes.js';
import { loadEnvConfig } from './config/env.js';

export function createPocServer() {
  const app = express();
  app.use(express.json());

  // Mount POC route modules
  app.use('/poc', healthRouter);
  app.use('/poc', authRouter);
  app.use('/poc/nosql', nosqlRouter);
  app.use('/poc/concurrency', concurrencyRouter);

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'NOT_FOUND' });
  });

  return app;
}

// Start standalone server if directly executed
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  const env = loadEnvConfig();
  const server = createPocServer();
  server.listen(env.PORT, () => {
    console.log(`[VigorCore Catalyst POC] Server listening on port ${env.PORT} (Mock Mode: ${env.IS_MOCK_MODE})`);
  });
}
