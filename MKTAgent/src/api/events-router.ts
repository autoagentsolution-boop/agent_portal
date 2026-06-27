// SSE events router (T5) — GET /events streams THIS user's post status changes.
// Polling GET /posts?status= remains the always-works fallback; SSE is the
// low-latency path for the review UI.
//
// Auth: requireAuth needs a Bearer header, but the browser EventSource API can't
// set headers. So this endpoint accepts the JWT via either the Authorization
// header (programmatic clients) OR a `?token=` query param (EventSource). The
// query path puts the token in access logs — acceptable for this internal tool;
// revisit if it ever faces untrusted networks (use a short-lived stream ticket).
import { Router } from 'express';
import { verifySession } from '../lib/auth-jwt.ts';
import { subscribe, type PostStatusEvent } from '../events/bus.ts';
import { logger } from '../lib/logger.ts';

export const eventsRouter: Router = Router();

const HEARTBEAT_MS = 25_000; // < typical 30-60s idle-proxy timeout

const tokenFrom = (req: { header: (n: string) => string | undefined; query: Record<string, unknown> }): string | null => {
  const h = req.header('authorization');
  if (h) {
    const [scheme, t] = h.split(' ');
    if (scheme === 'Bearer' && t) return t;
  }
  return typeof req.query.token === 'string' ? req.query.token : null;
};

eventsRouter.get('/', (req, res) => {
  const token = tokenFrom(req);
  const claims = token ? verifySession(token) : null;
  if (!claims) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const ownerId = claims.sub;

  // SSE headers. Disable proxy buffering so events flush immediately.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n'); // client reconnect backoff hint
  res.write(`event: ready\ndata: ${JSON.stringify({ ownerId })}\n\n`);

  const send = (e: PostStatusEvent): void => {
    res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  };
  const unsubscribe = subscribe(ownerId, send);

  const heartbeat = setInterval(() => {
    res.write(`: ping\n\n`); // SSE comment; keeps the connection + proxies warm
  }, HEARTBEAT_MS);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
    logger.info('sse_disconnect', { ownerId });
  };
  req.on('close', cleanup);
  res.on('error', cleanup);
  logger.info('sse_connect', { ownerId });
});
