// Copy-gen tick — one pass of the n8n mkt-copy-gen graph in code:
//   advisory lock → pick one brief|rework Post (+campaign) → build Gemini request
//   → call → parse → on success write copy + status=review; on failure leave the
//   row at its original status (brief|rework) to retry next tick.
//
// State-machine note: unlike the scheduler we do NOT claim-to-an-intermediate
// state before the API call. The n8n flow only flips to `review` on success, so a
// Gemini/quota failure must leave the row regenerable. The advisory lock (its own
// key) is what prevents two ticks picking the same row concurrently.
import { acquireAdvisoryLock } from '../scheduler/lock.ts';
import { findCopyGenDueWithCampaign, updatePost } from '../db/repos/post-repo.ts';
import { buildGeminiBody } from './prompt.ts';
import { resolveCopyConfig } from './resolve-config.ts';
import { callGemini } from './gemini.ts';
import { parseGeminiResponse } from './parse.ts';
import { logRun } from '../db/client.ts';
import { logger } from '../lib/logger.ts';
import { publishPostStatus } from '../events/bus.ts';

const LOCK_KEY = 'mkt-copy-gen';

export interface CopyGenResult {
  picked: boolean;
  postId?: string;
  status?: 'review' | 'retry';
  reason?: string;
  error?: string;
}

// Injectable Gemini call for tests (verify without spending API tokens).
export type GeminiFn = (body: ReturnType<typeof buildGeminiBody>) => Promise<unknown>;

export async function runCopyGenTick(callFn: GeminiFn = callGemini): Promise<CopyGenResult> {
  const lock = await acquireAdvisoryLock(LOCK_KEY);
  if (!lock.acquired) {
    logger.info('copygen_tick_skipped', { reason: 'lock_held' });
    return { picked: false, reason: 'lock_held' };
  }
  try {
    const post = await findCopyGenDueWithCampaign();
    if (!post) return { picked: false, reason: 'no_due' };

    let body: ReturnType<typeof buildGeminiBody>;
    try {
      body = buildGeminiBody(post);
    } catch (e) {
      // Bad brief (e.g. campaign missing product) → terminal error, won't fix on retry.
      const msg = e instanceof Error ? e.message : String(e);
      await updatePost(post.id, { status: 'error', error: msg.slice(0, 500) });
      await logRun('error', 'mkt_copygen', { id: post.id, error: msg }, post.ownerId);
      publishPostStatus(post.ownerId, {
        postId: post.id,
        status: 'error',
        campaignId: post.campaignId,
        error: msg.slice(0, 500),
      });
      return { picked: true, postId: post.id, status: 'retry', error: msg };
    }

    const raw = await callFn(body);
    const result = parseGeminiResponse(raw);

    if (!result.ok) {
      // Transient (quota/empty) → leave at original status for next tick.
      await logRun('warn', 'mkt_copygen', { id: post.id, retry: post.status, error: result.error }, post.ownerId);
      logger.warn('copygen_failed_retry', { postId: post.id, error: result.error.slice(0, 200) });
      return { picked: true, postId: post.id, status: 'retry', error: result.error };
    }

    // Persist the language-agnostic copy bag + the resolved language it was
    // generated in (so the row records its own language for adapters/UI).
    const cfg = resolveCopyConfig(post);
    await updatePost(post.id, {
      copy: result.copy as unknown as object,
      language: cfg.language,
      status: 'review',
      error: null,
    });
    await logRun(
      'info',
      'mkt_copygen',
      {
        id: post.id,
        status: 'review',
        language: cfg.language,
        lens: { body: result.copy.body.length, threads: result.copy.threads.length, x: result.copy.x.length },
      },
      post.ownerId,
    );
    publishPostStatus(post.ownerId, {
      postId: post.id,
      status: 'review',
      campaignId: post.campaignId,
    });
    return { picked: true, postId: post.id, status: 'review' };
  } catch (e) {
    logger.error('copygen_tick_failed', { error: String(e).slice(0, 300) });
    await logRun('error', 'mkt_copygen', { error: String(e).slice(0, 300) }).catch(() => {});
    return { picked: false, reason: 'error' };
  } finally {
    await lock.release();
  }
}
