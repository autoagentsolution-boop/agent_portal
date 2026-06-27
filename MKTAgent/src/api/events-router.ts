// SSE events router (T5) — GET /events streams THIS user's post status changes.
// Polling GET /posts?status= remains the always-works fallback; SSE is the
// low-latency path for the review UI.
//
// Auth: the browser uses EventSource(url, { withCredentials: true }) so the
// HttpOnly session cookie (T8) rides the request — no token in the URL/logs. We
// resolve via the shared Bearer-or-cookie resolver, then fall back to a `?token=`
// JWT query param ONLY for non-cookie programmatic clients (puts the token in
// access logs — fine for an internal tool; the cookie path avoids it for the UI).
import { Router } from 'express';
import { verifySession } from '../lib/auth-jwt.ts';
import { resolveRequestOwner } from './middleware-auth.ts';
import { subscribe, type PostStatusEvent } from '../events/bus.ts';
import { logger } from '../lib/logger.ts';

export const eventsRouter: Router = Router();

const HEARTBEAT_MS = 25_000; // < typical 30-60s idle-proxy timeout

eventsRouter.get('/', async (req, res) => {
  // Primary: Bearer header or session cookie (browser EventSource w/ credentials).
  let ownerId = await resolveRequestOwner(req);
  // Fallback: ?token= JWT for clients that can set neither header nor cookie.
  if (!ownerId && typeof req.query.token === 'string') {
    ownerId = verifySession(req.query.token)?.sub ?? null;
  }
  if (!ownerId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

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
