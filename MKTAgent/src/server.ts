// MKTAgent HTTP server. Mirrors render-service bootstrap (Express 5, structured
// logs, global error handler). Domain routers (campaigns/posts/leads/webhooks)
// are mounted in later phases; P0 ships /health only.
import { env } from './config/env.ts';
import express, { type ErrorRequestHandler } from 'express';
import { logger } from './lib/logger.ts';
import { startSchedulerCron } from './scheduler/cron.ts';
import { startCopyGenCron } from './copygen/cron.ts';
import { startTokenCron } from './tokens/cron.ts';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'mktagent', env: env.NODE_ENV });
});

// Domain routers mounted here in later phases:
//   app.use('/webhooks', webhooksRouter);   // P5
//   app.use('/campaigns', requireApiKey, campaignsRouter); // P7
//   app.use('/posts', requireApiKey, postsRouter);         // P7
//   app.use('/leads', requireApiKey, leadsRouter);         // P7

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
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
