// Inbound rate limits (doc 09 §2.2). The only limiter that existed before this was OUTBOUND
// (connectors/runtime/rate-limit-manager, spacing publishes so a burst can't trip a platform's
// anti-spam guard). Nothing capped inbound request RATE at all.
//
// Why it matters for LLM routes specifically: the credit gate caps how MUCH a tenant can spend in
// total, but places no ceiling on how FAST. One compromised session could drain a wallet at machine
// speed, and every one of those calls costs us Gemini tokens whether or not the run completes —
// and a run that fails bills the tenant nothing (workflow-executor.ts:119), so the loss is ours.
//
// Limits are deliberately conservative starting points chosen by the product owner (2026-07-18),
// not measured from traffic. Revisit once there is real usage data: a 429 on a legitimate user is
// a worse outcome than a slightly loose ceiling.
import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { logger } from '../lib/logger.ts';

const MINUTE = 60_000;

// Shared shape: emit standard RateLimit-* headers, skip the legacy X-RateLimit-* ones, and log
// every trip so a limit that's too tight shows up in the logs instead of as a silent user complaint.
const base = (name: string): Partial<Options> => ({
  windowMs: MINUTE,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn('rate_limit_tripped', {
      limiter: name,
      path: req.path,
      ip: req.ip,
      userId: (req as Request & { userId?: string }).userId ?? null,
    });
    res.status(429).json({ error: 'rate_limited', message: 'Too many requests — slow down and retry shortly.' });
  },
});

// /auth — keyed by IP, because the caller is by definition not authenticated yet. Guards credential
// stuffing and login-endpoint hammering.
export const authLimiter = rateLimit({ ...base('auth'), limit: 10 });

// LLM-backed routes — keyed by TENANT, not IP: the resource being protected is per-tenant spend, and
// several users behind one office NAT share an IP. Falls back to the IP when there is no userId yet
// (ipKeyGenerator normalises IPv6 to a /64 — a raw req.ip key lets one host rotate addresses).
//
// GETs are EXEMPT, and that is not a loophole — it is the difference between "requests to a router
// that can spend money" and "requests that actually spend money". Applying the limit to reads was
// measurably wrong: the first run of the http verify suite under this limiter produced 249 trips,
// 236 of them on a single GET /runs/:id — a run-status poll. A user watching their own flow execute
// would have been 429'd out of the UI while the flow they paid for was still running.
//
// Writes are what enqueue LLM work (POST /runs, POST a chat turn, POST execute), so the ceiling
// belongs there. If read-hammering ever needs a ceiling of its own it should be a separate, much
// looser limiter — a status poll and a Gemini call do not belong in the same budget.
export const llmLimiter = rateLimit({
  ...base('llm'),
  limit: 20,
  skip: (req: Request): boolean => req.method === 'GET',
  keyGenerator: (req: Request): string => {
    const userId = (req as Request & { userId?: string }).userId;
    return userId ? `user:${userId}` : ipKeyGenerator(req.ip ?? '');
  },
});
