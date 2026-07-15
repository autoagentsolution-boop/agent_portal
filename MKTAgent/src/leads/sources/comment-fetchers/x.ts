// Live comment fetcher for X/Twitter (§01.4 platform coverage). Reads replies to Atria's OWN
// tweet via the v2 recent-search conversation query — X has no direct "replies to this tweet"
// endpoint, so we search for tweets in the same conversation.
//   GET /2/tweets/search/recent?query=conversation_id:{tweetId}&tweet.fields=author_id,text
//       &expansions=author_id&user.fields=username
// ⚠️ LIVE-UNTESTED / requires an elevated (paid) X API tier — recent-search is gated above the
// free tier. A 401/403 here means "our access tier can't read replies", which is a static
// capability limit, not evidence the tweet is gone — return [] (never PostGoneError) so the
// collector stays active; only a 404 (tweet itself deleted) deactivates it.
//
// Phase 03 hardening: gated behind ENABLE_X_LEAD_CAPTURE (default OFF) — a free-tier token would
// otherwise burn a 401/403 API call every 30-min cron tick for nothing. Flip the flag only once the
// connected token is confirmed on a tier with recent-search access.
import { env } from '../../../config/env.ts';
import { getActiveToken } from '../../../tokens/service.ts';
import { withRetry } from '../../../lib/retry.ts';
import { logger } from '../../../lib/logger.ts';
import { PostGoneError, type FetchedComment } from '../comment-poller.ts';

// Log the tier-limit warning once per process instead of on every poll cycle (it will recur
// every cycle until the account is upgraded — spamming logs adds no new information).
let loggedTierLimit = false;

export const fetchXComments = async (
  platformPostId: string,
  ownerId: string,
): Promise<FetchedComment[]> => {
  if (!env.ENABLE_X_LEAD_CAPTURE) return []; // flag off → clean no-op, not a wasted API call

  const token = await getActiveToken(ownerId, 'x');
  const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(`conversation_id:${platformPostId}`)}&tweet.fields=author_id,text&expansions=author_id&user.fields=username`;
  const res = await withRetry(
    () => fetch(url, { headers: { Authorization: `Bearer ${token}` } }),
    { label: 'x_comments' },
  );
  if (res.status === 404) throw new PostGoneError('x', platformPostId);
  const j = (await res.json()) as {
    data?: Array<{ id: string; author_id?: string; text: string }>;
    includes?: { users?: Array<{ id: string; username: string }> };
    errors?: Array<{ title?: string; detail?: string }>;
  };
  if (res.status === 401 || res.status === 403) {
    if (!loggedTierLimit) {
      logger.warn('x_comments_tier_limit', { status: res.status, detail: JSON.stringify(j.errors).slice(0, 200) });
      loggedTierLimit = true;
    }
    return [];
  }
  if (!res.ok) {
    logger.warn('x_comments_error', { status: res.status, error: JSON.stringify(j.errors).slice(0, 160) });
    return [];
  }
  const usersById = new Map((j.includes?.users ?? []).map((u) => [u.id, u.username]));
  return (j.data ?? []).map((t) => ({
    id: t.id,
    authorName: (t.author_id && usersById.get(t.author_id)) || null,
    authorId: t.author_id || null, // Phase 03 handle-only identity
    text: t.text ?? '',
  }));
};
