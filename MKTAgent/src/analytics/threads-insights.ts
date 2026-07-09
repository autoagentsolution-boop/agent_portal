// Threads Media Insights (Atria v2 P2-2b, Threads extension). Same resilient shape as fb/ig-insights:
// the Graph API fails the WHOLE call if ANY requested metric is invalid, so we query MINIMAL
// independent groups and degrade per group to null. graph.threads.net exposes per-media:
//   • views group  — `views` (Threads' impressions equivalent; there is NO per-post reach/unique metric)
//   • engage group — `likes,replies,reposts,quotes` (summed)
// Uses the owner's Threads token (Bearer header — matches the publish adapter's log-hygiene rule; a
// token in the URL leaks into access logs). Threads media ids come from platformPostIds.threads.
// Best-effort, TTL cache, never throws. Reach is always null (Threads has no reach metric).
import { env } from '../config/env.ts';
import { getActiveToken } from '../tokens/service.ts';
import { logger } from '../lib/logger.ts';
import { type InsightsSum, emptySum } from './insights-types.ts';

const TV = env.THREADS_VERSION;
const CACHE_TTL_MS = 30 * 60_000;
const MAX_POSTS = 50;
const VIEWS_METRICS = 'views';
const ENGAGE_METRICS = 'likes,replies,reposts,quotes';

export interface ThreadsPostInsights { impressions: number | null; engaged: number | null }

const cache = new Map<string, { data: ThreadsPostInsights; ts: number }>();

// Threads insights rows carry the scalar under either `values[0].value` (time-series) or
// `total_value.value` (lifetime) depending on metric — read whichever is present.
type MetricRow = { name?: string; values?: Array<{ value?: unknown }>; total_value?: { value?: unknown } };
const scalar = (rows: MetricRow[], name: string): number | null => {
  const row = rows.find((m) => m.name === name);
  const v = row?.total_value?.value ?? row?.values?.[0]?.value;
  return typeof v === 'number' ? v : null;
};
const sumMetrics = (rows: MetricRow[], names: string[]): number | null => {
  const vals = names.map((n) => scalar(rows, n)).filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
};

// Fetch one metric group; null on error (invalid metric / missing scope). Never throws. Bearer auth.
const fetchGroup = async (token: string, mediaId: string, metrics: string, fetchFn: typeof fetch): Promise<MetricRow[] | null> => {
  try {
    const url = `https://graph.threads.net/${TV}/${mediaId}/insights?metric=${metrics}`;
    const res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = (await res.json()) as { data?: MetricRow[]; error?: { message?: string } };
    if (!res.ok || j.error || !Array.isArray(j.data)) {
      logger.warn('threads_insights_group_unavailable', { mediaId, metrics, error: String(j.error?.message ?? res.status).slice(0, 140) });
      return null;
    }
    return j.data;
  } catch (e) {
    logger.warn('threads_insights_group_error', { mediaId, metrics, error: String(e).slice(0, 140) });
    return null;
  }
};

export const fetchThreadsPostInsights = async (
  token: string,
  mediaId: string,
  fetchFn: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<ThreadsPostInsights> => {
  const cached = cache.get(mediaId);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.data;
  const [viewRows, engageRows] = await Promise.all([
    fetchGroup(token, mediaId, VIEWS_METRICS, fetchFn),
    fetchGroup(token, mediaId, ENGAGE_METRICS, fetchFn),
  ]);
  const data: ThreadsPostInsights = {
    impressions: viewRows ? scalar(viewRows, 'views') : null,
    engaged: engageRows ? sumMetrics(engageRows, ['likes', 'replies', 'reposts', 'quotes']) : null,
  };
  cache.set(mediaId, { data, ts: now });
  return data;
};

// Sum measured Threads insights across published posts' Threads media ids. Returns the shared
// InsightsSum (reach always null — Threads exposes no reach; `views` maps to impressions).
export const sumThreadsInsights = async (
  ownerId: string,
  mediaIds: string[],
  deps: { fetchFn?: typeof fetch; token?: string | null; now?: number } = {},
): Promise<InsightsSum> => {
  const ids = mediaIds.filter(Boolean).slice(0, MAX_POSTS);
  if (ids.length === 0) return emptySum();
  const token = deps.token ?? (await getActiveToken(ownerId, 'threads').catch(() => null));
  if (!token) return emptySum();
  const now = deps.now ?? Date.now();
  const results = await Promise.all(ids.map((id) => fetchThreadsPostInsights(token, id, deps.fetchFn ?? fetch, now)));

  const sumField = (key: keyof ThreadsPostInsights): number | null => {
    const vals = results.map((r) => r[key]).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
  };
  const postsMeasured = results.filter((r) => r.impressions !== null || r.engaged !== null).length;
  return {
    measuredReach: null,
    measuredImpressions: sumField('impressions'),
    measuredEngaged: sumField('engaged'),
    postsMeasured,
    platforms: postsMeasured > 0 ? ['threads'] : [],
  };
};
