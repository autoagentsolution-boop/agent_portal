// FB Page post Insights (Atria v2 P2-2b — the Analytics agent's data). Fetches whatever REAL metrics
// Meta exposes for a published Facebook post so the Impact report shows MEASURED numbers instead of
// only the reachPerPost heuristic. Two independent metric GROUPS (Graph fails the WHOLE call if ANY
// requested metric is invalid, and validity varies by page/version):
//   • reach group  — post_impressions_unique (reach) + post_impressions. Meta WITHHOLDS these for
//     small pages (<100 followers) / deprecated on some versions → group errors → reach/impr null.
//   • engage group — post_clicks + post_reactions_by_type_total (summed). Broadly available.
// Best-effort per group: a failure returns null for that group's fields (Impact keeps its labeled
// estimate for reach) — never throws, never blocks the report. A process TTL cache bounds Graph calls.
import { env } from '../config/env.ts';
import { getActiveToken } from '../tokens/service.ts';
import { logger } from '../lib/logger.ts';

const G = env.GRAPH_VERSION;
const CACHE_TTL_MS = 30 * 60_000;
const MAX_POSTS = 50;
const REACH_METRICS = 'post_impressions_unique,post_impressions';
const ENGAGE_METRICS = 'post_clicks,post_reactions_by_type_total';

export interface FbPostInsights {
  reach: number | null;       // post_impressions_unique — null when Meta withholds it for this page
  impressions: number | null; // post_impressions
  engaged: number | null;     // post_clicks + Σ reactions-by-type — null when the engage group fails
}
export interface FbInsightsSum {
  measuredReach: number | null;
  measuredImpressions: number | null;
  measuredEngaged: number | null;
  fbPostsMeasured: number; // FB posts that returned ANY measured field
}

const cache = new Map<string, { data: FbPostInsights; ts: number }>();

type MetricRow = { name?: string; values?: Array<{ value?: unknown }> };
const scalar = (rows: MetricRow[], name: string): number | null => {
  const v = rows.find((m) => m.name === name)?.values?.[0]?.value;
  return typeof v === 'number' ? v : null;
};
// post_reactions_by_type_total → { like: n, love: n, ... }; sum the numeric values.
const reactionsTotal = (rows: MetricRow[]): number | null => {
  const v = rows.find((m) => m.name === 'post_reactions_by_type_total')?.values?.[0]?.value;
  if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).reduce((s: number, n) => s + (typeof n === 'number' ? n : 0), 0);
  return null;
};

// Fetch one metric group. Returns the data rows, or null if the group errored (invalid metric /
// missing scope / withheld). Never throws.
const fetchGroup = async (token: string, fbPostId: string, metrics: string, fetchFn: typeof fetch): Promise<MetricRow[] | null> => {
  try {
    const url = `https://graph.facebook.com/${G}/${fbPostId}/insights?metric=${metrics}&access_token=${encodeURIComponent(token)}`;
    const res = await fetchFn(url);
    const j = (await res.json()) as { data?: MetricRow[]; error?: { message?: string } };
    if (!res.ok || j.error || !Array.isArray(j.data)) {
      logger.warn('fb_insights_group_unavailable', { fbPostId, metrics, error: String(j.error?.message ?? res.status).slice(0, 140) });
      return null;
    }
    return j.data;
  } catch (e) {
    logger.warn('fb_insights_group_error', { fbPostId, metrics, error: String(e).slice(0, 140) });
    return null;
  }
};

// One post's insights (both groups, independent). `now` injectable for deterministic cache tests.
export const fetchFbPostInsights = async (
  token: string,
  fbPostId: string,
  fetchFn: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<FbPostInsights> => {
  const cached = cache.get(fbPostId);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.data;
  const [reachRows, engageRows] = await Promise.all([
    fetchGroup(token, fbPostId, REACH_METRICS, fetchFn),
    fetchGroup(token, fbPostId, ENGAGE_METRICS, fetchFn),
  ]);
  const clicks = engageRows ? scalar(engageRows, 'post_clicks') : null;
  const reacts = engageRows ? reactionsTotal(engageRows) : null;
  const engaged = clicks === null && reacts === null ? null : (clicks ?? 0) + (reacts ?? 0);
  const data: FbPostInsights = {
    reach: reachRows ? scalar(reachRows, 'post_impressions_unique') : null,
    impressions: reachRows ? scalar(reachRows, 'post_impressions') : null,
    engaged,
  };
  cache.set(fbPostId, { data, ts: now });
  return data;
};

// Sum across a set of published posts' FB post ids. Each field is null when NO post produced it
// (so Impact keeps its estimate rather than showing a false 0). Owner-scoped token read.
export const sumFbInsights = async (
  ownerId: string,
  fbPostIds: string[],
  deps: { fetchFn?: typeof fetch; token?: string | null; now?: number } = {},
): Promise<FbInsightsSum> => {
  const empty: FbInsightsSum = { measuredReach: null, measuredImpressions: null, measuredEngaged: null, fbPostsMeasured: 0 };
  const ids = fbPostIds.filter(Boolean).slice(0, MAX_POSTS);
  if (ids.length === 0) return empty;
  const token = deps.token ?? (await getActiveToken(ownerId, 'facebook').catch(() => null));
  if (!token) return empty;
  const now = deps.now ?? Date.now();
  const results = await Promise.all(ids.map((id) => fetchFbPostInsights(token, id, deps.fetchFn ?? fetch, now)));

  // Per-field sum over posts that produced that field; null when none did.
  const sumField = (key: keyof FbPostInsights): number | null => {
    const vals = results.map((r) => r[key]).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
  };
  const measuredReach = sumField('reach');
  const measuredImpressions = sumField('impressions');
  const measuredEngaged = sumField('engaged');
  const fbPostsMeasured = results.filter((r) => r.reach !== null || r.impressions !== null || r.engaged !== null).length;
  return { measuredReach, measuredImpressions, measuredEngaged, fbPostsMeasured };
};
