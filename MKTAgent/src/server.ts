// MKTAgent HTTP server. Mirrors render-service bootstrap (Express 5, structured
// logs, global error handler). Domain routers (campaigns/posts/leads/webhooks)
// are mounted in later phases; P0 ships /health only.
import { env } from './config/env.ts';
import express, { type ErrorRequestHandler } from 'express';
import { logger } from './lib/logger.ts';
import { startSchedulerCron } from './scheduler/cron.ts';
import { startCopyGenCron } from './copygen/cron.ts';
import { startTokenCron } from './tokens/cron.ts';
import { requireApiKey } from './lib/auth.ts';
import { postsRouter } from './api/posts-router.ts';
import { campaignsRouter } from './api/campaigns-router.ts';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'mktagent', env: env.NODE_ENV });
});

// P7 review-API slice (api-key guarded). Full CRUD + /leads + /webhooks later.
app.use('/posts', requireApiKey, postsRouter);
app.use('/campaigns', requireApiKey, campaignsRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // Malformed JSON body → 400, not a generic 500 (express.json throws a SyntaxError
  // with a `.type` of 'entity.parse.failed').
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }
  logger.error('request_failed', { error: String(err) });
  res.status(500).json({ error: 'internal_error' });
};
app.use(errorHandler);

const bootstrap = (): void => {
  app.listen(env.PORT, () => {
    logger.info('mktagent_listening', { port: env.PORT, env: env.NODE_ENV });
  });
  if (env.ENABLE_SCHEDULER_CRON) startSchedulerCron();
  if (env.ENABLE_COPYGEN_CRON) startCopyGenCron();
  if (env.ENABLE_TOKEN_CRON) startTokenCron();
};

bootstrap();

export { app };
