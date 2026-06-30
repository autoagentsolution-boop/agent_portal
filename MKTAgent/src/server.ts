// MKTAgent HTTP server. Mirrors render-service bootstrap (Express 5, structured
// logs, global error handler). Domain routers (campaigns/posts/leads/webhooks)
// are mounted in later phases; P0 ships /health only.
import { env } from './config/env.ts';
import express, { type ErrorRequestHandler } from 'express';
import { mkdirSync } from 'node:fs';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { logger } from './lib/logger.ts';
import { startSchedulerCron } from './scheduler/cron.ts';
import { startCopyGenCron } from './copygen/cron.ts';
import { startTokenCron } from './tokens/cron.ts';
import { requireAuth } from './api/middleware-auth.ts';
import { postsRouter } from './api/posts-router.ts';
import { campaignsRouter } from './api/campaigns-router.ts';
import { authRouter } from './api/auth-router.ts';
import { connectRouter } from './api/connect-router.ts';
import { eventsRouter } from './api/events-router.ts';
import { leadsRouter } from './api/leads-router.ts';
import { agentRouter } from './api/agent-router.ts';
import { orchestrationRouter } from './api/orchestration-router.ts';
import { connectionsRouter } from './api/connections-router.ts';
import { IMAGE_OUTPUT_DIR } from './imagegen/nano-banana.ts';

const app = express();

// CORS for the browser UI (T8). Credentialed (cookie) XHR requires an explicit
// origin — wildcard is rejected by browsers when credentials:true. Only enabled
// when UI_BASE_URL is set; the lead webhooks are server-to-server (no browser) so
// they're unaffected. Without a UI configured, no cross-origin access is allowed.
if (env.UI_BASE_URL) {
  app.use(cors({ origin: env.UI_BASE_URL, credentials: true }));
}
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'mktagent', env: env.NODE_ENV });
});

// Generated media (M2-lite). Serves images the imagegen agent wrote to disk so the
// UI can render the real artifact (infographic_brief.imageRef = local:<abspath> →
// /media/images/<hash>.png). Read-only static; filenames are content hashes (non-
// guessable). NOTE (production): move behind auth or signed URLs before public use.
// Ensure the dir exists so static doesn't 500 on a fresh container (no images yet).
mkdirSync(IMAGE_OUTPUT_DIR, { recursive: true });
app.use('/media/images', express.static(IMAGE_OUTPUT_DIR, { fallthrough: false, maxAge: '1h' }));

// Auth (Google login → JWT). Public start/callback; /auth/me self-guards.
app.use('/auth', authRouter);

// Per-user social connect (T4). /start self-guards with requireAuth; /callback is
// public (platform redirect, no auth header) but ownerId rides a signed state JWT.
app.use('/connect', connectRouter);

// P7 review-API slice — JWT/tenant-scoped (T2). requireAuth attaches req.userId;
// every downstream repo query filters by it. api-key is reserved for internal
// cron/webhook s2s routes (mounted in later phases), not user-facing CRUD.
app.use('/posts', requireAuth, postsRouter);
app.use('/campaigns', requireAuth, campaignsRouter);

// Master Agent typed intake. Draft-only parser that helps users set up the flow;
// writes still happen through the explicit campaign/post APIs after UI confirmation.
app.use('/agent', requireAuth, agentRouter);

// Goal-based agent orchestration (Milestone 1). Master Agent → dynamic DAG plan →
// executor with an approval gate before any external-write (publisher) node. Runs
// BESIDE the template intake path; tenant-scoped via requireAuth.
app.use('/orchestration', requireAuth, orchestrationRouter);

// Connections (M2-lite). Read-only view of the caller's social connection status
// over the existing OAuthToken store; never touches the write path or token values.
app.use('/connections', requireAuth, connectionsRouter);

// Per-user SSE stream (T5). Self-authenticates (Bearer header OR ?token= for the
// browser EventSource API) so it is NOT behind requireAuth's header-only gate.
app.use('/events', eventsRouter);

// Leads (T6). Mixed auth: POST intake routes are secret-gated (external funnels
// have no JWT); GET /leads self-guards with requireAuth. So NOT behind a blanket
// requireAuth mount.
app.use('/leads', leadsRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // Malformed JSON body → 400, not a generic 500 (express.json throws a SyntaxError
  // with a `.type` of 'entity.parse.failed').
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }
  // Respect an error that already carries an HTTP status (e.g. express.static passes a
  // 404 for a missing file when fallthrough:false). Only unexpected errors are 500s.
  const status = (err && (err.status || err.statusCode)) as number | undefined;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ error: status === 404 ? 'not_found' : 'request_error' });
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
