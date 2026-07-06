// Live comment fetcher via the Meta Graph API (§01.4) — FB + IG. Reads comments on Atria's OWN
// published FB post / IG media using the same page/IG token publishing already uses — no new
// permission beyond what FB publish needs (pages_read_engagement is standard for a page you manage).
//   FB:  GET /{post-id}/comments?fields=id,from,message
//   IG:  GET /{media-id}/comments?fields=id,username,text
// ⚠️ LIVE-UNTESTED here (needs a real connected page + a published post with comments). The
// poller + parse + capture are verified with an injected fetcher; this is the thin live seam.
import { env } from '../../../config/env.ts';
import { getActiveToken } from '../../../tokens/service.ts';
import { withRetry } from '../../../lib/retry.ts';
import { logger } from '../../../lib/logger.ts';
import { PostGoneError, type FetchedComment } from '../comment-poller.ts';
import { isNumericId } from '../comment-watch.ts';
import type { SocialPlatform } from '../../../../prisma/generated/prisma/client.ts';

const GRAPH = `https://graph.facebook.com/${env.GRAPH_VERSION || 'v21.0'}`;

// Meta signals a DELETED / non-existent object with OAuthException subcode 33 ("does not exist")
// or an HTTP 404. We deliberately do NOT treat a bare code 100 (no subcode) as gone: code 100 is
// Meta's generic "invalid parameter / unknown path" bucket, so trusting it alone could flip a LIVE
// post to deleted on any malformed-id or unsupported-field response — and a false delete
// (deactivating a live collector) is the high-blast-radius mistake, so the safe failure is to keep
// polling. Distinct from AUTH (code 190) and RATE (4/17/32/613) which are transient. Shared with the
// Threads fetcher (graph.threads.net uses the same Graph-API error envelope).
export const isMetaGraphPostGone = (status: number, error: any): boolean => {
  const subcode = error?.error_subcode;
  return status === 404 || subcode === 33;
};

export const fetchMetaComments = async (
  platform: 'facebook' | 'instagram',
  platformPostId: string,
  ownerId: string,
): Promise<FetchedComment[]> => {
  const token = await getActiveToken(ownerId, platform);
  const fields = platform === 'instagram' ? 'id,username,text' : 'id,from,message';
  const url = `${GRAPH}/${encodeURIComponent(platformPostId)}/comments?fields=${fields}&limit=100&access_token=${encodeURIComponent(token)}`;
  const res = await withRetry(() => fetch(url), { label: `${platform}_comments` });
  const j = (await res.json()) as { data?: Array<Record<string, unknown>>; error?: any };
  if (!res.ok || j.error) {
    // The post was deleted on the platform → tell the poller to STOP this collector (don't keep
    // polling a dead post forever). Transient/auth errors just return [] and retry next cycle.
    // GUARD: for IG a code-100 on a SHORTCODE means "Graph can't resolve this id", NOT "deleted" — a
    // shortcode never resolves. Only trust the gone signal when the id is resolvable (FB {page}_{post}
    // is always resolvable; IG requires the numeric media id). Prevents false-deactivating a live
    // collector whose stored id is a legacy shortcode.
    const resolvable = platform === 'facebook' || isNumericId(platformPostId);
    if (isMetaGraphPostGone(res.status, j.error) && resolvable) {
      throw new PostGoneError(platform as SocialPlatform, platformPostId);
    }
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
