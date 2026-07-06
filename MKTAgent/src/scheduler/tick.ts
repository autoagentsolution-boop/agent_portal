// Scheduler tick — one pass of the n8n mkt-post-scheduler graph in code:
//   advisory lock → pick one due Post → claim (ready→posting) → resolve+validate
//   → fan-out to platforms → aggregate → write back → audit → release lock.
//
// Single-row-per-tick (matching n8n) keeps each tick bounded and the lock hold
// short. node-cron fires every minute; a backlog drains one row per minute.
// Both guards run: the advisory lock serializes ticks/instances, and the atomic
// claimForPublish() updateMany guards the row even if the lock were ever bypassed.
import { acquireSchedulerLock } from './lock.ts';
import { resolvePlatformInput, publishAssetType, PostValidationError } from './resolve-input.ts';
import { aggregate, toWriteBack } from './aggregate.ts';
import { recordCommentSources } from '../leads/sources/comment-watch.ts';
import {
  findPublishDue,
  claimForPublish,
  claimForPublishOwned,
  getPostForOwner,
  updatePost,
} from '../db/repos/post-repo.ts';
import { publishTo } from '../social/index.ts';
import { platformSupportsAsset } from '../social/postability.ts';
import { hasDriveConnected, resolveCampaignFolder } from '../assets/drive-client.ts';
import { materializeForPublicUrl, NEEDS_PUBLIC_URL, slugify } from '../assets/materialize.ts';
import { getCampaign } from '../db/repos/campaign-repo.ts';
import { hasActiveFlowNodes } from '../db/repos/workflow-run-repo.ts';
import { publishPostStatus } from '../events/bus.ts';
import { logRun } from '../db/client.ts';
import { logger } from '../lib/logger.ts';
import type { Post, SocialPlatform, AssetType } from '../../prisma/generated/prisma/client.ts';
import type { PublishInput, PublishResult } from '../social/types.ts';
import type { AssetRef } from '../assets/store.ts';

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

// One publish target after per-platform resolution (item 5). Either has a built `input`
// (publishable) or a `skipReason` (asset unsupported / media missing) — never both.
interface PlatformTarget {
  platform: SocialPlatform;
  assetType: AssetType;
  input?: PublishInput;
  skipReason?: string;
}

// Terminal validation failure for a whole post: mark error, log, emit — no network.
async function failPost(post: Post, reason: string): Promise<TickResult> {
  await updatePost(post.id, { status: 'error', error: reason.slice(0, 500), postedAt: new Date() });
  await logRun('warn', 'mkt_post', { id: post.id, status: 'error', reason }, post.ownerId);
  publishPostStatus(post.ownerId, { postId: post.id, status: 'error', campaignId: post.campaignId, error: reason.slice(0, 500) });
  return { picked: true, postId: post.id, status: 'error', reason };
}

// Core: resolve → fan-out → aggregate → write-back for ONE already-claimed post
// (status=posting). Shared by the cron tick and the manual publish-now trigger.
export async function processPost(post: Post, publish: PublishFn): Promise<TickResult> {
  // Empty targets → clean validation error, no network (n8n "Build error write-back").
  if (!post.platforms || post.platforms.length === 0) {
    return failPost(post, 'no target platforms');
  }

  // Per-platform resolution (items 1 + 5): each target may publish a DIFFERENT asset type
  // (platformAssets) with its own media. For each platform: pick its asset type, check the
  // adapter supports it (item 1), then build that platform's input (degraded media). A
  // platform whose asset is unsupported or whose media is missing is recorded as a SKIP —
  // an explicit ok:false row, never a doomed network call.
  const targets: PlatformTarget[] = post.platforms.map((platform) => {
    const assetType = publishAssetType(post, platform);
    if (!platformSupportsAsset(platform, assetType)) {
      return { platform, assetType, skipReason: `${platform} cannot post ${assetType}` };
    }
    try {
      return { platform, assetType, input: resolvePlatformInput(post, platform) };
    } catch (e) {
      if (e instanceof PostValidationError) return { platform, assetType, skipReason: e.message };
      throw e;
    }
  });
  const publishable = targets.filter((t): t is PlatformTarget & { input: PublishInput } => Boolean(t.input));
  const skipped = targets.filter((t) => !t.input);
  if (publishable.length === 0) {
    return failPost(post, `no target platform can publish this post: ${skipped.map((s) => `${s.platform} (${s.skipReason})`).join('; ')}`);
  }

  // Materialize local images → public Drive fileIds for platforms that fetch a public URL
  // server-side (IG/Threads). Cache by asset type so two public platforms sharing an asset
  // upload once. Video is skipped (lh3 serves a thumbnail). Best-effort: on failure the
  // platform falls through to its adapter's clear public-URL error; disk-upload platforms
  // (FB/LinkedIn/X) still publish (partial success holds).
  const publicByAsset = new Map<AssetType, AssetRef[]>();
  const needsPublic = publishable.some((t) => NEEDS_PUBLIC_URL.has(t.platform) && t.assetType !== 'video');
  if (needsPublic && (await hasDriveConnected(post.ownerId))) {
    try {
      const campaign = await getCampaign(post.campaignId, post.ownerId);
      const name = campaign?.product ?? 'Uncategorized';
      const folderId = await resolveCampaignFolder(post.ownerId, name);
      for (const t of publishable) {
        if (!NEEDS_PUBLIC_URL.has(t.platform) || t.assetType === 'video' || publicByAsset.has(t.assetType)) continue;
        publicByAsset.set(t.assetType, await materializeForPublicUrl(post.ownerId, t.input.assets, { folderId, slug: slugify(name) }));
      }
    } catch (e) {
      logger.warn('drive_materialize_failed', { postId: post.id, error: String(e).slice(0, 200) });
    }
  }

  // publishTo never throws → Promise.all is safe; one slow platform doesn't block.
  const published = await Promise.all(
    publishable.map((t) => {
      const publicAssets = NEEDS_PUBLIC_URL.has(t.platform) ? publicByAsset.get(t.assetType) : undefined;
      return publish(t.platform, publicAssets ? { ...t.input, assets: publicAssets } : t.input);
    }),
  );
  // Skipped targets → explicit ok:false rows so the outcome records exactly what did NOT go
  // out and why (drives status=partial when some platforms succeed).
  const skippedResults: PublishResult[] = skipped.map((s) => ({
    platform: s.platform,
    ok: false,
    url: null,
    error: `skipped: ${s.skipReason}`,
  }));
  const results = [...published, ...skippedResults];
  const outcome = aggregate(results);
  await updatePost(post.id, toWriteBack(outcome));
  // Lead Collector (§01.6): if this post opts into comment capture, record which published
  // posts the poller should watch. Best-effort — never affects the publish outcome.
  await recordCommentSources(post, outcome.postUrls, outcome.platformPostIds).catch((e) =>
    logger.warn('record_comment_sources_failed', { postId: post.id, error: String(e).slice(0, 120) }));
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

    // Flow-active guard: if this post's flow is still producing (a node running/pending — e.g. the
    // video is still generating past the scheduled time), DELAY the publish. Leave the post due +
    // unclaimed so the next tick retries once the flow finishes — never publish before the media is
    // ready. (The 18:20-scheduled-but-video-slow case.)
    if (due.runId && (await hasActiveFlowNodes(due.runId))) {
      logger.info('scheduler_delayed_flow_active', { postId: due.id, runId: due.runId });
      return { picked: false, postId: due.id, reason: 'flow_active' };
    }

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
