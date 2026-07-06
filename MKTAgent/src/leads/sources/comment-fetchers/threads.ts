// Live comment fetcher for Threads (§01.4 platform coverage). Reads replies on Atria's OWN
// published Threads media via graph.threads.net — the same token the Threads publish adapter
// uses (see src/social/threads.ts). GOTCHA: the media id needed here is the numeric id Threads
// hands back at publish time, NOT necessarily the shortcode in the public permalink — see the
// extractPostId comment in comment-watch.ts for the best-effort id we actually store.
//   GET /{media-id}/replies?fields=id,text,username
// ⚠️ LIVE-UNTESTED (needs a real connected Threads account + a published post with replies).
import { env } from '../../../config/env.ts';
import { getActiveToken } from '../../../tokens/service.ts';
import { withRetry } from '../../../lib/retry.ts';
import { logger } from '../../../lib/logger.ts';
import { PostGoneError, type FetchedComment } from '../comment-poller.ts';
import { isMetaGraphPostGone } from './meta.ts';
import { isNumericId } from '../comment-watch.ts';

const THREADS_GRAPH = `https://graph.threads.net/${env.THREADS_VERSION || 'v1.0'}`;

export const fetchThreadsComments = async (
  platformPostId: string,
  ownerId: string,
): Promise<FetchedComment[]> => {
  const token = await getActiveToken(ownerId, 'threads');
  const url = `${THREADS_GRAPH}/${encodeURIComponent(platformPostId)}/replies?fields=id,text,username&access_token=${encodeURIComponent(token)}`;
  const res = await withRetry(() => fetch(url), { label: 'threads_comments' });
  const j = (await res.json()) as { data?: Array<Record<string, unknown>>; error?: any };
  if (!res.ok || j.error) {
    // Threads runs on the Graph API — same OAuthException envelope as FB/IG (code 100 / subcode 33 / 404).
    // GUARD (as IG): a shortcode never resolves → code 100 is NOT a confirmed delete. Only trust the
    // gone signal when the stored id is the numeric media id.
    if (isMetaGraphPostGone(res.status, j.error) && isNumericId(platformPostId)) {
      throw new PostGoneError('threads', platformPostId);
    }
    logger.warn('threads_comments_error', { status: res.status, error: JSON.stringify(j.error).slice(0, 160) });
    return [];
  }
  return (j.data ?? []).map((c) => ({
    id: String(c.id ?? ''),
    authorName: typeof c.username === 'string' ? c.username : null,
    text: String(c.text ?? ''),
  }));
};
