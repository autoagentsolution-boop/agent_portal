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

// Platforms whose comments we can read today (FB primary; IG best-effort). Others are skipped.
const COMMENTABLE: SocialPlatform[] = ['facebook', 'instagram'];

export interface PollSummary { postsPolled: number; commentsScanned: number; leadsCaptured: number; duplicates: number }

// ownerId scopes the poll to one tenant (the manual UI trigger); omit for the global cron.
export const pollCommentsForLeads = async (fetcher: CommentFetcher, ownerId?: string): Promise<PollSummary> => {
  const summary: PollSummary = { postsPolled: 0, commentsScanned: 0, leadsCaptured: 0, duplicates: 0 };
  const posts = await prisma.post.findMany({
    where: { leadCaptureKeyword: { not: null }, ...(ownerId ? { ownerId } : {}) },
    include: { campaign: { select: { product: true } } },
  });

  for (const post of posts) {
    const keyword = post.leadCaptureKeyword!;
    const sources = (post.commentSourceIds ?? {}) as Record<string, string>;
    if (!sources || Object.keys(sources).length === 0) continue; // not published to a commentable target yet
    for (const [platformKey, platformPostId] of Object.entries(sources)) {
      const platform = platformKey as SocialPlatform;
      if (!platformPostId || !COMMENTABLE.includes(platform)) continue;
      let comments: FetchedComment[] = [];
      try {
        comments = await fetcher(platform, platformPostId, post.ownerId);
      } catch (e) {
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
