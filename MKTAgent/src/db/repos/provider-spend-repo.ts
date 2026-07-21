// PROVIDER spend — what WE pay Google, read off the `mkt_llm_usage` ledger. Deliberately separate
// from credit-repo, which tracks what TENANTS owe us in credits; conflating the two is the obvious
// way to misread this console.
//
// Why this exists and what it deliberately does NOT do: the account is on a Gemini paid PREPAID
// tier, and there is **no API anywhere that exposes the prepaid balance** — not Cloud Billing, not
// any Gemini endpoint (AI Studio's Usage-and-Limits page is the only place it lives, checked
// 2026-07-21). So this reports SPEND and burn rate and makes no claim about what is left. Anything
// labelled "remaining balance" here would be a guess wearing a number's clothes.
//
// Second honesty constraint: `cost_usd` is OUR price-table estimate recorded at call time, not
// Google's invoice. It is right for trend and magnitude, and must not be presented as billing truth.
//
// Windows are ROLLING (last 24h / 7d / 30d), not calendar days, so the figures mean the same thing
// regardless of the server's timezone or which timezone Google closes its billing day in. The daily
// series is calendar-bucketed and explicitly UTC.
import { prisma } from '../client.ts';

export interface SpendBucket { calls: number; costUsd: number }
export interface SpendSlice { key: string; calls: number; costUsd: number }
export interface DailySpend { day: string; calls: number; costUsd: number }

export interface ProviderSpendSummary {
  windows: { last24h: SpendBucket; last7d: SpendBucket; last30d: SpendBucket; lifetime: SpendBucket };
  bySurface: SpendSlice[]; // last 30d, biggest first
  byModel: SpendSlice[]; // last 30d, biggest first
  daily: DailySpend[]; // last 14 calendar days, UTC, oldest first
  generatedAt: string;
}

const WINDOW_DAYS = { last24h: 1, last7d: 7, last30d: 30 } as const;
const DAILY_SERIES_DAYS = 14;

const daysAgo = (n: number): Date => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

// Float sums drift on money; round to cents at the edge so the UI never shows 4.840000000000001.
const cents = (n: number): number => Math.round(n * 100) / 100;

const bucket = async (since?: Date): Promise<SpendBucket> => {
  const agg = await prisma.llmUsage.aggregate({
    _count: { _all: true },
    _sum: { costUsd: true },
    ...(since ? { where: { createdAt: { gte: since } } } : {}),
  });
  return { calls: agg._count._all, costUsd: cents(agg._sum.costUsd ?? 0) };
};

const sliceBy = async (field: 'surface' | 'model', since: Date): Promise<SpendSlice[]> => {
  const rows = await prisma.llmUsage.groupBy({
    by: [field],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    _sum: { costUsd: true },
  });
  return rows
    .map((r) => ({ key: String(r[field]), calls: r._count._all, costUsd: cents(r._sum.costUsd ?? 0) }))
    .sort((a, b) => b.costUsd - a.costUsd);
};

// Calendar series needs date_trunc, which groupBy cannot express. Raw SQL over a 14-day slice keeps
// this one query instead of pulling ~6k rows into memory to bucket them in JS.
const dailySeries = async (): Promise<DailySpend[]> => {
  const rows = await prisma.$queryRaw<Array<{ day: Date; calls: bigint; cost: number | null }>>`
    SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day,
           count(*) AS calls,
           sum(cost_usd) AS cost
    FROM mkt_llm_usage
    WHERE created_at >= ${daysAgo(DAILY_SERIES_DAYS)}
    GROUP BY 1
    ORDER BY 1 ASC
  `;
  return rows.map((r) => ({
    day: new Date(r.day).toISOString().slice(0, 10),
    calls: Number(r.calls),
    costUsd: cents(r.cost ?? 0),
  }));
};

export const getProviderSpend = async (): Promise<ProviderSpendSummary> => {
  const since30 = daysAgo(WINDOW_DAYS.last30d);
  const [last24h, last7d, last30d, lifetime, bySurface, byModel, daily] = await Promise.all([
    bucket(daysAgo(WINDOW_DAYS.last24h)),
    bucket(daysAgo(WINDOW_DAYS.last7d)),
    bucket(since30),
    bucket(),
    sliceBy('surface', since30),
    sliceBy('model', since30),
    dailySeries(),
  ]);
  return {
    windows: { last24h, last7d, last30d, lifetime },
    bySurface,
    byModel,
    daily,
    generatedAt: new Date().toISOString(),
  };
};
