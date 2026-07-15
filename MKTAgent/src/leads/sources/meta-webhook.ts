// Meta comment-capture webhook (Multichannel Nurture Nodes Phase 03) — real-time upgrade for the
// Meta family (Facebook Page feed comments, Instagram media comments, Threads replies), sitting
// BESIDE the 30-min comment-poller.ts (which stays the fallback/catch-up path — a missed or
// delayed webhook delivery self-heals on the next poll tick). Both paths route into the SAME
// captureLead chokepoint (service.ts) with the SAME dedupe keys, so a comment delivered via both
// never mints two leads.
//
// Public callback (no JWT) — verified two ways per Meta's webhook contract:
//   GET  /webhooks/meta  — the one-time subscribe handshake: echoes hub.challenge back ONLY when
//                          hub.verify_token matches META_WEBHOOK_VERIFY_TOKEN.
//   POST /webhooks/meta  — every subsequent delivery: HMAC-SHA256 of the RAW request body, keyed
//                          with the Meta app secret, must match X-Hub-Signature-256 (constant-time
//                          compare). An unsigned or wrong-signature POST is rejected outright — this
//                          is a public URL, not a private one (mirrors safeEqual's use for the
//                          legacy lead-webhook secret and the Telegram webhook secret).
//
// Deploy dependency (not code): a live Meta app must have `feed`/`comments`/`mentions` (page/IG) or
// `replies` (Threads) subscribed AND app-review approval before Meta will ever call this route —
// see plan phase-03-lead-capture-extension.md "Risk / security". Until then this route is inert
// (nothing calls it) but is real, wired code, not a placeholder.
import { Router, type Request, type Response, json } from 'express';
import { createHmac } from 'node:crypto';
import { env } from '../../config/env.ts';
import { safeEqual } from '../../lib/crypto.ts';
import { logger } from '../../lib/logger.ts';
import { parseComment } from './comment-parse.ts';
import { captureLead } from '../service.ts';
import { findPostByCommentSource } from '../../db/repos/post-repo.ts';
import type { SocialPlatform } from '../../../prisma/generated/prisma/client.ts';

export const metaWebhookRouter: Router = Router();

// X-Hub-Signature-256 is computed over the EXACT bytes Meta sent, so the JSON parser here MUST
// stash the raw Buffer before parsing — Express's app-wide express.json() (mounted later in
// server.ts) would otherwise discard it. Exported so server.ts can mount this parser ahead of the
// app-wide one (same "mount early with its own parser" pattern as postMediaRouter/productKnowledgeRouter).
export interface RawBodyRequest extends Request { rawBody?: Buffer }
export const metaWebhookJsonParser = json({
  verify: (req: Request, _res: Response, buf: Buffer) => { (req as RawBodyRequest).rawBody = buf; },
});

// ---- Signature verify. `secret` defaults to the real env (production path); the fixture-only
// verify script passes an explicit test secret so it can exercise BOTH a valid and an invalid
// signature deterministically without mutating process.env (module-load-time env.ts singleton). ----
export const verifyMetaSignature = (
  rawBody: Buffer,
  signatureHeader: string | undefined | null,
  secret: string = env.META_APP_SECRET,
): boolean => {
  if (!signatureHeader || !secret) return false;
  const [scheme, hex] = signatureHeader.split('=');
  if (scheme !== 'sha256' || !hex) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(hex, expected);
};

// ---- Normalize the FB / IG / Threads webhook envelopes into one shape ----
export interface NormalizedComment {
  platform: SocialPlatform;
  platformPostId: string;
  commentId: string;
  text: string;
  authorId: string | null;
  authorName: string | null;
}

interface MetaWebhookChange { field?: string; value?: Record<string, unknown> }
interface MetaWebhookEntry { id?: string; changes?: unknown }
interface MetaWebhookBody { object?: string; entry?: unknown }

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// Malformed/unexpected shapes never throw — a bad payload just yields fewer (or zero) normalized
// comments; the poller remains the fallback for whatever this pass couldn't parse.
export const normalizeMetaWebhookEntry = (body: unknown): NormalizedComment[] => {
  const b = (body && typeof body === 'object' ? body : {}) as MetaWebhookBody;
  const entries = Array.isArray(b.entry) ? (b.entry as MetaWebhookEntry[]) : [];
  const out: NormalizedComment[] = [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? (entry.changes as MetaWebhookChange[]) : [];
    for (const change of changes) {
      const v = change?.value ?? {};
      try {
        if (b.object === 'page' && change.field === 'feed' && v.item === 'comment' && v.verb === 'add') {
          // FB Page feed webhook: sender_id/sender_name are flat fields (NOT a nested `from` object
          // like the Graph read API returns) — see Meta's page-feed webhook docs.
          const platformPostId = str(v.post_id);
          const commentId = str(v.comment_id);
          if (!platformPostId || !commentId) continue;
          out.push({
            platform: 'facebook', platformPostId, commentId, text: str(v.message),
            authorId: str(v.sender_id) || null, authorName: str(v.sender_name) || null,
          });
        } else if (b.object === 'instagram' && change.field === 'comments') {
          const media = v.media as { id?: string } | undefined;
          const from = v.from as { id?: string; username?: string } | undefined;
          const platformPostId = str(media?.id);
          const commentId = str(v.id);
          if (!platformPostId || !commentId) continue;
          out.push({
            platform: 'instagram', platformPostId, commentId, text: str(v.text),
            authorId: str(from?.id) || null, authorName: str(from?.username) || null,
          });
        } else if (b.object === 'threads' && (change.field === 'replies' || change.field === 'mentions')) {
          // Best-effort — Threads' webhook payload shape isn't publicly pinned down the way FB/IG's
          // is (mirrors the media.id + from{id,username} shape IG uses). LIVE-UNTESTED, same caveat
          // as comment-fetchers/threads.ts; live-verify against a real subscription before relying on it.
          const media = (v.media ?? v.root_post) as { id?: string } | undefined;
          const from = v.from as { id?: string; username?: string } | undefined;
          const platformPostId = str(media?.id);
          const commentId = str(v.id);
          if (!platformPostId || !commentId) continue;
          out.push({
            platform: 'threads', platformPostId, commentId, text: str(v.text),
            authorId: str(from?.id) || null, authorName: str(from?.username) || null,
          });
        }
      } catch (e) {
        logger.warn('meta_webhook_change_unparsed', { object: b.object, field: change?.field, error: String(e).slice(0, 160) });
      }
    }
  }
  return out;
};

// Route one normalized comment into the SAME chokepoint the poller uses (captureLead), applying
// the SAME keyword-consent + handle-only rules (comment-poller.ts's capture loop). A comment on a
// post we don't watch (no leadCaptureKeyword, or a post row we can't find) is silently ignored —
// this webhook receives every comment on every connected page, not just Atria's own captured ones.
export const routeMetaComment = async (c: NormalizedComment): Promise<void> => {
  const post = await findPostByCommentSource(c.platform, c.platformPostId);
  if (!post || !post.leadCaptureKeyword) return;
  const parsed = parseComment(c.text, post.leadCaptureKeyword);
  if (!parsed.keywordHit) return;
  const platformUserId = c.authorId || (!parsed.email ? c.authorName : null);
  if (!parsed.email && !platformUserId) {
    logger.warn('meta_webhook_no_identity', { postId: post.id, platform: c.platform, commentId: c.commentId });
    return;
  }
  await captureLead({
    name: c.authorName || '',
    email: parsed.email,
    phone: '',
    message: c.text.slice(0, 500),
    sourceProduct: post.campaign?.product || '',
    sourcePlatform: c.platform,
    source: 'comment',
    calBookingUid: null,
    rawPayload: { commentId: c.commentId, platform: c.platform, postId: post.id, via: 'webhook' },
    platform: c.platform,
    platformUserId: platformUserId || null,
    platformHandle: c.authorName,
  }, post.ownerId);
};

// ---- Pure(ish) handlers — exported separately from the Express wiring below so the
// fixture-only verify script (verify-comment-capture.ts) can exercise the GET-challenge and
// POST-signature/routing logic directly, with NO real HTTP server and NO live Meta calls. ----
export const handleVerifyChallenge = (
  query: Record<string, unknown>,
  verifyToken: string = env.META_WEBHOOK_VERIFY_TOKEN,
): { status: number; body: string } => {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  const verified =
    mode === 'subscribe' &&
    typeof token === 'string' &&
    Boolean(verifyToken) &&
    safeEqual(token, verifyToken);
  return verified ? { status: 200, body: str(challenge) } : { status: 403, body: '' };
};

export const handleWebhookDelivery = async (
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined | null,
  parsedBody: unknown,
  secret: string = env.META_APP_SECRET,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  if (!rawBody || !verifyMetaSignature(rawBody, signatureHeader, secret)) {
    logger.warn('meta_webhook_bad_signature', { hasRawBody: Boolean(rawBody), hasSig: Boolean(signatureHeader) });
    return { status: 401, body: { error: 'invalid_signature' } };
  }
  // Meta requires a fast 200 on receipt regardless of downstream outcome, else it retries the same
  // delivery — capture failures are logged, never surfaced as a non-200 (mirrors telegram-webhook-router.ts).
  try {
    const comments = normalizeMetaWebhookEntry(parsedBody);
    for (const c of comments) {
      await routeMetaComment(c).catch((e) =>
        logger.warn('meta_webhook_capture_failed', { platform: c.platform, error: String(e).slice(0, 160) }),
      );
    }
  } catch (e) {
    logger.warn('meta_webhook_malformed_payload', { error: String(e).slice(0, 160) });
  }
  return { status: 200, body: { received: true } };
};

// ---- GET — one-time subscribe verify-challenge ----
metaWebhookRouter.get('/', (req: Request, res: Response) => {
  const r = handleVerifyChallenge(req.query as Record<string, unknown>);
  if (r.status !== 200) { res.status(r.status).end(); return; }
  res.status(200).type('text/plain').send(r.body);
});

// ---- POST — every subsequent delivery ----
metaWebhookRouter.post('/', async (req: Request, res: Response) => {
  const raw = (req as RawBodyRequest).rawBody;
  const r = await handleWebhookDelivery(raw, req.header('x-hub-signature-256'), req.body);
  res.status(r.status).json(r.body);
});
