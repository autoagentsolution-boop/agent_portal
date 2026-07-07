// Per-platform post liveness check (Leads: "does this published link still exist on the platform?").
// A post can be published to several platforms; the user may delete it on one/all after testing.
// Delegates to checkPlatformAlive (post-exists.ts) — a DEDICATED existence check that only asserts
// alive:true on a confirmed object read (NOT "the comment fetch returned []", which false-positives
// on LinkedIn 403 / X search-empty). On-demand only (a real API call per platform). Also SELF-HEALS:
// a WATCHED source confirmed deleted is removed from commentSourceIds, and when none remain the
// collector is marked post_deleted.
import { prisma } from '../../db/client.ts';
import { logger } from '../../lib/logger.ts';
import { env } from '../../config/env.ts';
import { checkPlatformAlive } from './post-exists.ts';
import { extractPostId } from './comment-watch.ts';
import type { Post, SocialPlatform } from '../../../prisma/generated/prisma/client.ts';

const COMMENTABLE = new Set<SocialPlatform>(['facebook', 'instagram', 'threads', 'linkedin', 'x']);

// alive: true = reachable, false = deleted on-platform, null = couldn't determine (transient/auth,
// or a platform we can't check — e.g. an unparseable URL or a LIVE-UNTESTED tier limit).
export interface LinkStatus { platform: string; url: string; alive: boolean | null }

// The liveness checker is injectable (default = the real network check) so the union-iteration
// self-heal logic (M2) can be verified without real platform calls, like the resolver's reader seam.
export type AliveFn = (platform: SocialPlatform, id: string, ownerId: string) => Promise<boolean | null>;

export const checkPostLinks = async (
  post: Post,
  ownerId: string,
  aliveFn: AliveFn = checkPlatformAlive,
): Promise<LinkStatus[]> => {
  const postUrls = (post.postUrls ?? {}) as Record<string, string>;
  const sources = (post.commentSourceIds ?? {}) as Record<string, string>;
  const platformIds = (post.platformPostIds ?? {}) as Record<string, string>;
  const liveSources = { ...sources };
  const results: LinkStatus[] = [];

  // Iterate the UNION of published links AND watched comment-sources (Phase 07 / M2). A watched
  // platform with NO postUrls entry (X publishes without a stored URL) was never existence-checked,
  // so `noneLeft` could never trigger and the collector polled a deleted X post until 30d expiry.
  const platformKeys = new Set<string>([...Object.keys(postUrls), ...Object.keys(sources)]);
  for (const platformKey of platformKeys) {
    const platform = platformKey as SocialPlatform;
    const url = postUrls[platform] ?? '';
    if (!COMMENTABLE.has(platform)) { results.push({ platform, url, alive: null }); continue; }
    // Prefer the canonical resolvable id captured at publish; then the watched collector source;
    // finally parse the URL if we have one (legacy rows → a shortcode, treated as null downstream).
    const id = platformIds[platform] ?? sources[platform] ?? (url ? extractPostId(platform, url) : null);
    const alive = id ? await aliveFn(platform, id, ownerId) : null;
    results.push({ platform, url, alive });
    if (alive === false) delete liveSources[platform]; // confirmed deleted → stop watching this platform
  }

  // Persist self-heal only if a WATCHED source actually died.
  if (JSON.stringify(liveSources) !== JSON.stringify(sources)) {
    const noneLeft = Object.keys(sources).length > 0 && Object.keys(liveSources).length === 0;
    await prisma.post.update({
      where: { id: post.id },
      data: { commentSourceIds: liveSources, ...(noneLeft ? { leadCollectorStatus: 'post_deleted' } : {}) },
    });
    logger.info('post_links_checked', { postId: post.id, stopped: noneLeft, dead: results.filter((r) => r.alive === false).map((r) => r.platform) });
  }
  return results;
};

// Proactive liveness sweep (feedback #3): after the leads cron polls, verify each watched post
// still exists on-platform. checkPostLinks self-heals — a confirmed-deleted link is dropped and the
// collector marked post_deleted when none remain, so the poller's `leadCollectorStatus != post_deleted`
// filter skips it next tick. Deliberately runs at the CRON layer (real platform calls), NOT inside
// pollCommentsForLeads which stays pure/injectable. Best-effort: one dead post never aborts the sweep.
export const sweepPostLiveness = async (ownerId?: string): Promise<{ checked: number; dead: number }> => {
  const now = new Date();
  // Throttle (Phase 07 / M3): only re-check a post whose last sweep is older than the window (or
  // never) — the poller's reactive PostGoneError stays the fast detector, so a full re-sweep every
  // 30-min tick just doubled API volume and re-hit already-dead URLs.
  const staleBefore = new Date(now.getTime() - env.LEADS_LIVENESS_THROTTLE_HOURS * 3_600_000);
  const posts = await prisma.post.findMany({
    where: {
      leadCaptureKeyword: { not: null },
      // Same scope as the poller: non-expired, not-yet-deleted. Prisma `not` excludes null, so the
      // explicit null arm keeps active collectors in scope.
      AND: [
        { OR: [{ leadCollectorExpiresAt: null }, { leadCollectorExpiresAt: { gt: now } }] },
        { OR: [{ leadCollectorStatus: null }, { leadCollectorStatus: { not: 'post_deleted' } }] },
        { OR: [{ lastLivenessCheckAt: null }, { lastLivenessCheckAt: { lt: staleBefore } }] },
      ],
      ...(ownerId ? { ownerId } : {}),
    },
  });
  let checked = 0;
  let dead = 0;
  for (const post of posts) {
    try {
      const links = await checkPostLinks(post, post.ownerId);
      await prisma.post.update({ where: { id: post.id }, data: { lastLivenessCheckAt: new Date() } }).catch(() => {});
      checked++;
      if (links.some((l) => l.alive === false)) dead++;
    } catch (e) {
      logger.warn('liveness_sweep_failed', { postId: post.id, error: String(e).slice(0, 160) });
    }
  }
  return { checked, dead };
};
