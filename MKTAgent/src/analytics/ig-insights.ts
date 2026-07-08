// Instagram Media Insights (Atria v2 P2-2b, IG extension). Same resilient shape as fb-insights: the
// Graph API fails the WHOLE call if ANY requested metric is invalid, and IG deprecates media metrics
// by version/media-type (e.g. `impressions` was retired for media created after 2024-07-02, replaced
// by `views`). So we query MINIMAL independent groups and degrade per group to null:
//   • reach group  — `reach` (unique accounts reached; unlike FB, IG exposes this even for small accounts)
//   • engage group — `total_interactions` (likes + comments + saves + shares)
// Uses the owner's IG user token; IG media ids come from platformPostIds.instagram. Best-effort, TTL
// cache, never throws. Live-unverified until an IG post exists on the account (graceful null till then).
import { env } from '../config/env.ts';
import { getActiveToken } from '../tokens/service.ts';
import { logger } from '../lib/logger.ts';
import { type InsightsSum, emptySum } from './insights-types.ts';

const G = env.GRAPH_VERSION;
const CACHE_TTL_MS = 30 * 60_000;
const MAX_POSTS = 50;
const REACH_METRICS = 'reach';
const ENGAGE_METRICS = 'total_interactions';

export interface IgPostInsights { reach: number | null; engaged: number | null }

const cache = new Map<string, { data: IgPostInsights; ts: number }>();

type MetricRow = { name?: string; values?: Array<{ value?: unknown }> };
const scalar = (rows: MetricRow[], name: string): number | null => {
  const v = rows.find((m) => m.name === name)?.values?.[0]?.value;
  return typeof v === 'number' ? v : null;
};

// Fetch one IG metric group; null on error (invalid metric / missing scope / media type). No throw.
const fetchGroup = async (token: string, mediaId: string, metrics: string, fetchFn: typeof fetch): Promise<MetricRow[] | null> => {
  try {
    const url = `https://graph.facebook.com/${G}/${mediaId}/insights?metric=${metrics}&access_token=${encodeURIComponent(token)}`;
    const res = await fetchFn(url);
    const j = (await res.json()) as { data?: MetricRow[]; error?: { message?: string } };
    if (!res.ok || j.error || !Array.isArray(j.data)) {
      logger.warn('ig_insights_group_unavailable', { mediaId, metrics, error: String(j.error?.message ?? res.status).slice(0, 140) });
      return null;
    }
    return j.data;
  } catch (e) {
    logger.warn('ig_insights_group_error', { mediaId, metrics, error: String(e).slice(0, 140) });
    return null;
  }
};

export const fetchIgMediaInsights = async (
  token: string,
  mediaId: string,
  fetchFn: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<IgPostInsights> => {
  const cached = cache.get(mediaId);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.data;
  const [reachRows, engageRows] = await Promise.all([
    fetchGroup(token, mediaId, REACH_METRICS, fetchFn),
    fetchGroup(token, mediaId, ENGAGE_METRICS, fetchFn),
  ]);
  const data: IgPostInsights = {
    reach: reachRows ? scalar(reachRows, 'reach') : null,
    engaged: engageRows ? scalar(engageRows, 'total_interactions') : null,
  };
  cache.set(mediaId, { data, ts: now });
  return data;
};

// Sum measured IG insights across a set of published posts' IG media ids. Returns the shared
// InsightsSum (impressions always null — IG's `impressions` is deprecated; reach is the headline).
export const sumIgInsights = async (
  ownerId: string,
  igMediaIds: string[],
  deps: { fetchFn?: typeof fetch; token?: string | null; now?: number } = {},
): Promise<InsightsSum> => {
  const ids = igMediaIds.filter(Boolean).slice(0, MAX_POSTS);
  if (ids.length === 0) return emptySum();
  const token = deps.token ?? (await getActiveToken(ownerId, 'instagram').catch(() => null));
  if (!token) return emptySum();
  const now = deps.now ?? Date.now();
  const results = await Promise.all(ids.map((id) => fetchIgMediaInsights(token, id, deps.fetchFn ?? fetch, now)));

  const sumField = (key: keyof IgPostInsights): number | null => {
    const vals = results.map((r) => r[key]).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
  };
  const postsMeasured = results.filter((r) => r.reach !== null || r.engaged !== null).length;
  return {
    measuredReach: sumField('reach'),
    measuredImpressions: null,
    measuredEngaged: sumField('engaged'),
    postsMeasured,
    platforms: postsMeasured > 0 ? ['instagram'] : [],
  };
};
