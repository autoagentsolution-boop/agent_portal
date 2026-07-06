// Live comment fetcher via the Meta Graph API (§01.4). Reads comments on Atria's OWN published
// FB post / IG media using the same page/IG token publishing already uses — no new permission
// beyond what FB publish needs (pages_read_engagement is standard for a page you manage).
//   FB:  GET /{post-id}/comments?fields=id,from,message
//   IG:  GET /{media-id}/comments?fields=id,username,text
// ⚠️ LIVE-UNTESTED here (needs a real connected page + a published post with comments). The
// poller + parse + capture are verified with an injected fetcher; this is the thin live seam.
import { env } from '../../config/env.ts';
import { getActiveToken } from '../../tokens/service.ts';
import { withRetry } from '../../lib/retry.ts';
import { logger } from '../../lib/logger.ts';
import type { CommentFetcher, FetchedComment } from './comment-poller.ts';
import type { SocialPlatform } from '../../../prisma/generated/prisma/client.ts';

const GRAPH = `https://graph.facebook.com/${env.GRAPH_VERSION || 'v21.0'}`;

export const graphCommentFetcher: CommentFetcher = async (
  platform: SocialPlatform,
  platformPostId: string,
  ownerId: string,
): Promise<FetchedComment[]> => {
  const token = await getActiveToken(ownerId, platform);
  const fields = platform === 'instagram' ? 'id,username,text' : 'id,from,message';
  const url = `${GRAPH}/${encodeURIComponent(platformPostId)}/comments?fields=${fields}&limit=100&access_token=${encodeURIComponent(token)}`;
  const res = await withRetry(() => fetch(url), { label: `${platform}_comments` });
  const j = (await res.json()) as { data?: Array<Record<string, unknown>>; error?: unknown };
  if (!res.ok || j.error) {
    logger.warn('graph_comments_error', { platform, status: res.status, error: JSON.stringify(j.error).slice(0, 160) });
    return [];
  }
  return (j.data ?? []).map((c) => ({
    id: String(c.id ?? ''),
    authorName: platform === 'instagram'
      ? (typeof c.username === 'string' ? c.username : null)
      : ((c.from as { name?: string } | undefined)?.name ?? null),
    text: String((platform === 'instagram' ? c.text : c.message) ?? ''),
  }));
};
