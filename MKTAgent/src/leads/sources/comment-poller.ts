// Comment-keyword lead poller (§01.4). For each published post that has a lead-capture keyword,
// reads the comments on THAT post (only Atria's own posts) and turns keyword+email comments into
// opt-in leads on the post's OWNER. The comment fetcher is injected so the parse/capture/dedupe
// logic is verifiable with fakes; the live Graph-API fetcher is the default (see comment-fetch-graph).
import { prisma } from '../../db/client.ts';
import { captureLead } from '../service.ts';
import { parseComment } from './comment-parse.ts';
import { logger } from '../../lib/logger.ts';
import type { SocialPlatform } from '../../../prisma/generated/prisma/client.ts';

export interface FetchedComment { id: string; authorName: string | null; text: string }
// Read comments for one published post on one platform. ownerId lets the fetcher pick the token.
export type CommentFetcher = (platform: SocialPlatform, platformPostId: string, ownerId: string) => Promise<FetchedComment[]>;

// Thrown by a fetcher when the platform reports the post no longer exists (deleted). The poller
// catches it and DEACTIVATES that collector — a deleted post can never capture again. Distinct
// from a transient/auth error (which returns [] and retries).
export class PostGoneError extends Error {
  constructor(public platform: SocialPlatform, public platformPostId: string) {
    super(`post gone on ${platform}: ${platformPostId}`);
    this.name = 'PostGoneError';
  }
}

// Platforms whose comments we can read today (FB/IG live-verified; Threads/LinkedIn/X best-effort
// or tier-gated — see comment-fetch-graph.ts for per-platform caveats).
const COMMENTABLE: SocialPlatform[] = ['facebook', 'instagram', 'threads', 'linkedin', 'x'];

export interface PollSummary { postsPolled: number; commentsScanned: number; leadsCaptured: number; duplicates: number }

// ownerId scopes the poll to one tenant (the manual UI trigger); omit for the global cron.
export const pollCommentsForLeads = async (fetcher: CommentFetcher, ownerId?: string): Promise<PollSummary> => {
  const summary: PollSummary = { postsPolled: 0, commentsScanned: 0, leadsCaptured: 0, duplicates: 0 };
  // Skip EXPIRED collectors (leadCollectorExpiresAt in the past) — a post isn't polled forever;
  // this bounds the overhead. null expiry = legacy/always-on. Re-activating from Leads extends it.
  const now = new Date();
  const posts = await prisma.post.findMany({
    where: {
      leadCaptureKeyword: { not: null },
      OR: [{ leadCollectorExpiresAt: null }, { leadCollectorExpiresAt: { gt: now } }],
      ...(ownerId ? { ownerId } : {}),
    },
    include: { campaign: { select: { product: true } } },
  });

  for (const post of posts) {
    const keyword = post.leadCaptureKeyword!;
    const sources = (post.commentSourceIds ?? {}) as Record<string, string>;
    if (!sources || Object.keys(sources).length === 0) continue; // not published to a commentable target yet
    // Mutable accumulator: deletions across multiple gone platforms must accumulate here (not be
    // recomputed from the stale `sources` snapshot each time, which would last-write-win).
    const liveSources = { ...sources };
    for (const [platformKey, platformPostId] of Object.entries(sources)) {
      const platform = platformKey as SocialPlatform;
      if (!platformPostId || !COMMENTABLE.includes(platform)) continue;
      let comments: FetchedComment[] = [];
      try {
        comments = await fetcher(platform, platformPostId, post.ownerId);
      } catch (e) {
        if (e instanceof PostGoneError) {
          // The published post was deleted → stop watching it. Remove this platform's source from the
          // accumulator; if no sources remain, mark the collector 'post_deleted' (UI: "stopped — post deleted").
          delete liveSources[platformKey];
          const noneLeft = Object.keys(liveSources).length === 0;
          await prisma.post.update({
            where: { id: post.id },
            data: { commentSourceIds: liveSources, ...(noneLeft ? { leadCollectorStatus: 'post_deleted' } : {}) },
          });
          logger.info('lead_collector_post_deleted', { postId: post.id, platform, stopped: noneLeft });
          continue;
        }
        logger.warn('comment_poll_fetch_failed', { postId: post.id, platform, error: String(e).slice(0, 160) });
        continue;
      }
      summary.postsPolled++;
      for (const c of comments) {
        summary.commentsScanned++;
        const parsed = parseComment(c.text, keyword);
        if (!parsed.matched || !parsed.email) continue;
        const outcome = await captureLead({
          name: c.authorName || '',
          email: parsed.email,
          phone: '',
          message: c.text.slice(0, 500),
          sourceProduct: post.campaign?.product || '',
          sourcePlatform: platform,
          source: 'comment',
          calBookingUid: null,
          rawPayload: { commentId: c.id, platform, postId: post.id },
        }, post.ownerId);
        if (outcome.status === 'created') summary.leadsCaptured++;
        else summary.duplicates++;
      }
    }
  }
  logger.info('comment_poll_done', { ...summary });
  return summary;
};
