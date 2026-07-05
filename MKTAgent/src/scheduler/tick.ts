// Scheduler tick — one pass of the n8n mkt-post-scheduler graph in code:
//   advisory lock → pick one due Post → claim (ready→posting) → resolve+validate
//   → fan-out to platforms → aggregate → write back → audit → release lock.
//
// Single-row-per-tick (matching n8n) keeps each tick bounded and the lock hold
// short. node-cron fires every minute; a backlog drains one row per minute.
// Both guards run: the advisory lock serializes ticks/instances, and the atomic
// claimForPublish() updateMany guards the row even if the lock were ever bypassed.
import { acquireSchedulerLock } from './lock.ts';
import { resolvePublishInput, PostValidationError } from './resolve-input.ts';
import { aggregate, toWriteBack } from './aggregate.ts';
import {
  findPublishDue,
  claimForPublish,
  claimForPublishOwned,
  getPostForOwner,
  updatePost,
} from '../db/repos/post-repo.ts';
import { publishTo } from '../social/index.ts';
import { hasDriveConnected } from '../assets/drive-client.ts';
import { materializeForPublicUrl, NEEDS_PUBLIC_URL } from '../assets/materialize.ts';
import { publishPostStatus } from '../events/bus.ts';
import { logRun } from '../db/client.ts';
import { logger } from '../lib/logger.ts';
import type { Post } from '../../prisma/generated/prisma/client.ts';
import type { PublishInput, PublishResult } from '../social/types.ts';

// Injectable publish fn — defaults to the real registry. Tests pass a stub to
// exercise the full tick (claim → aggregate → write-back) with NO real posts,
// honoring the DRY-RUN-only rule for the remaining adapters.
export type PublishFn = (
  platform: Post['platforms'][number],
  input: PublishInput,
) => Promise<PublishResult>;

export interface TickResult {
  picked: boolean;
  postId?: string;
  status?: string;
  reason?: string;
}

// Core: resolve → fan-out → aggregate → write-back for ONE already-claimed post
// (status=posting). Shared by the cron tick and the manual publish-now trigger.
export async function processPost(post: Post, publish: PublishFn): Promise<TickResult> {
  // Validation failure → mark error, no network call (n8n "Build error write-back").
  let input: PublishInput;
  try {
    input = resolvePublishInput(post);
  } catch (e) {
    if (e instanceof PostValidationError) {
      await updatePost(post.id, { status: 'error', error: e.message.slice(0, 500), postedAt: new Date() });
      await logRun('warn', 'mkt_post', { id: post.id, status: 'error', reason: e.message }, post.ownerId);
      publishPostStatus(post.ownerId, {
        postId: post.id,
        status: 'error',
        campaignId: post.campaignId,
        error: e.message.slice(0, 500),
      });
      return { picked: true, postId: post.id, status: 'error', reason: e.message };
    }
    throw e;
  }

  // Materialize local: images → public Drive fileIds ONCE for platforms that fetch a
  // public URL server-side (IG/Threads). FB/LinkedIn/X keep local: (they upload bytes off
  // disk). Images only — lh3 serves a thumbnail for video fileIds. Best-effort: if Drive
  // isn't connected or the upload fails, IG/Threads fall through to their adapter's clear
  // public-URL error while the disk-upload platforms still publish (partial success holds).
  let publicInput = input;
  const needsPublic = input.assetType !== 'video' && post.platforms.some((p) => NEEDS_PUBLIC_URL.has(p));
  if (needsPublic && (await hasDriveConnected(post.ownerId))) {
    try {
      publicInput = { ...input, assets: await materializeForPublicUrl(post.ownerId, input.assets) };
    } catch (e) {
      logger.warn('drive_materialize_failed', { postId: post.id, error: String(e).slice(0, 200) });
    }
  }

  // publishTo never throws → Promise.all is safe; one slow platform doesn't block.
  const results = await Promise.all(
    post.platforms.map((p) => publish(p, NEEDS_PUBLIC_URL.has(p) ? publicInput : input)),
  );
  const outcome = aggregate(results);
  await updatePost(post.id, toWriteBack(outcome));
  await logRun(
    outcome.status === 'error' ? 'error' : 'info',
    'mkt_post',
    { id: post.id, status: outcome.status, postUrls: outcome.postUrls, error: outcome.error },
    post.ownerId,
  );
  publishPostStatus(post.ownerId, {
    postId: post.id,
    status: outcome.status,
    campaignId: post.campaignId,
    postUrls: outcome.postUrls,
    error: outcome.error,
  });
  return { picked: true, postId: post.id, status: outcome.status };
}

// Manual trigger (T8): publish a specific owner-scoped post NOW (UI "Publish now"
// button) instead of waiting for the scheduler cron. The route has already checked
// ownership; here we use the owner-scoped atomic claim (ready→posting) as the race
// guard — it coexists with the cron (first to claim wins). No advisory lock needed:
// the claim is the serialization point, and we publish exactly one row.
//   Returns: not_found (wrong state/tenant → no claim) | claim_lost | the outcome.
export async function publishPostNow(
  postId: string,
  ownerId: string,
  publish: PublishFn = publishTo,
): Promise<TickResult> {
  const claimed = await claimForPublishOwned(postId, ownerId);
  if (!claimed) {
    // Either not ready, wrong tenant, or the cron claimed it first.
    const exists = await getPostForOwner(postId, ownerId);
    return { picked: false, postId, reason: exists ? 'not_publishable' : 'not_found' };
  }
  const post = await getPostForOwner(postId, ownerId);
  if (!post) return { picked: false, postId, reason: 'not_found' }; // unreachable post-claim
  try {
    return await processPost(post, publish);
  } catch (e) {
    await updatePost(postId, { status: 'error', error: String(e).slice(0, 500), postedAt: new Date() }).catch(() => {});
    publishPostStatus(ownerId, { postId, status: 'error', campaignId: post.campaignId, error: String(e).slice(0, 500) });
    throw e;
  }
}

export async function runSchedulerTick(publish: PublishFn = publishTo): Promise<TickResult> {
  const lock = await acquireSchedulerLock();
  if (!lock.acquired) {
    logger.info('scheduler_tick_skipped', { reason: 'lock_held' });
    return { picked: false, reason: 'lock_held' };
  }
  try {
    const due = await findPublishDue(new Date());
    if (!due) return { picked: false, reason: 'no_due' };

    // Atomic claim guards against a row picked by another path between read+claim.
    const claimed = await claimForPublish(due.id);
    if (!claimed) {
      logger.warn('scheduler_claim_lost', { postId: due.id });
      return { picked: false, postId: due.id, reason: 'claim_lost' };
    }

    try {
      return await processPost(due, publish);
    } catch (e) {
      // Unexpected failure AFTER claim (e.g. DB write). Don't leave the row stuck
      // in `posting`; mark it error so a future tick/operator sees it terminally.
      await updatePost(due.id, { status: 'error', error: String(e).slice(0, 500), postedAt: new Date() }).catch(() => {});
      publishPostStatus(due.ownerId, {
        postId: due.id,
        status: 'error',
        campaignId: due.campaignId,
        error: String(e).slice(0, 500),
      });
      throw e;
    }
  } catch (e) {
    logger.error('scheduler_tick_failed', { error: String(e).slice(0, 300) });
    await logRun('error', 'mkt_post', { error: String(e).slice(0, 300) }).catch(() => {});
    return { picked: false, reason: 'error' };
  } finally {
    await lock.release();
  }
}
