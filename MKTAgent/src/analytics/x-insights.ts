// X (Twitter) post Insights (Atria v2 P2-2b, X extension). Same resilient contract as the fb/ig/
// threads adapters, but X differs: metrics come from a SINGLE tweet-lookup call (not per-metric
// groups) — GET /2/tweets/:id?tweet.fields=public_metrics returns { like_count, reply_count,
// retweet_count, quote_count, bookmark_count, impression_count }.
//   • impressions ← impression_count. The FREE tier omits it (and heavily rate-limits reads: ~1/15min,
//     so most lookups 429) → impressions null, degrades to the labeled estimate. Auto-populates if the
//     app is on a paid tier that returns impression_count.
//   • engaged ← likes + replies + retweets + quotes.
//   • reach ← null (X has no reach/unique metric).
// OAuth2 user-context Bearer (same token as the publish adapter). Best-effort, TTL cache, never throws.
import { getActiveToken } from '../tokens/service.ts';
import { logger } from '../lib/logger.ts';
import { type InsightsSum, emptySum } from './insights-types.ts';

const CACHE_TTL_MS = 30 * 60_000;
const MAX_POSTS = 50;

export interface XPostInsights { impressions: number | null; engaged: number | null }

const cache = new Map<string, { data: XPostInsights; ts: number }>();

type PublicMetrics = {
  like_count?: number; reply_count?: number; retweet_count?: number;
  quote_count?: number; bookmark_count?: number; impression_count?: number;
};
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const engagementOf = (m: PublicMetrics): number | null => {
  const parts = [m.like_count, m.reply_count, m.retweet_count, m.quote_count].map(num).filter((v): v is number => v !== null);
  return parts.length ? parts.reduce((s, v) => s + v, 0) : null;
};

// One tweet's public_metrics; null fields on error (rate limit / missing scope / free tier). No throw.
export const fetchXPostInsights = async (
  token: string,
  tweetId: string,
  fetchFn: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<XPostInsights> => {
  const cached = cache.get(tweetId);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.data;
  let data: XPostInsights = { impressions: null, engaged: null };
  try {
    const url = `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=public_metrics`;
    const res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = (await res.json()) as { data?: { public_metrics?: PublicMetrics }; errors?: unknown; title?: string };
    const pm = j.data?.public_metrics;
    if (!res.ok || !pm) {
      logger.warn('x_insights_unavailable', { tweetId, error: String(j.title ?? res.status).slice(0, 140) });
    } else {
      data = { impressions: num(pm.impression_count), engaged: engagementOf(pm) };
    }
  } catch (e) {
    logger.warn('x_insights_error', { tweetId, error: String(e).slice(0, 140) });
  }
  cache.set(tweetId, { data, ts: now });
  return data;
};

// Sum measured X insights across published posts' tweet ids. Reach always null (X has no reach).
export const sumXInsights = async (
  ownerId: string,
  tweetIds: string[],
  deps: { fetchFn?: typeof fetch; token?: string | null; now?: number } = {},
): Promise<InsightsSum> => {
  const ids = tweetIds.filter(Boolean).slice(0, MAX_POSTS);
  if (ids.length === 0) return emptySum();
  const token = deps.token ?? (await getActiveToken(ownerId, 'x').catch(() => null));
  if (!token) return emptySum();
  const now = deps.now ?? Date.now();
  const results = await Promise.all(ids.map((id) => fetchXPostInsights(token, id, deps.fetchFn ?? fetch, now)));

  const sumField = (key: keyof XPostInsights): number | null => {
    const vals = results.map((r) => r[key]).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
  };
  const postsMeasured = results.filter((r) => r.impressions !== null || r.engaged !== null).length;
  return {
    measuredReach: null,
    measuredImpressions: sumField('impressions'),
    measuredEngaged: sumField('engaged'),
    postsMeasured,
    platforms: postsMeasured > 0 ? ['x'] : [],
  };
};
