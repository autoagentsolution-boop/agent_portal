// Impact metrics (Atria Phase 07) — REAL aggregation over data the app already captures, for one
// campaign or a period. Everything here is MEASURED (cost ledger, Post/Artifact rows, lead rows,
// run timestamps) — no estimates. The value model (value-model.ts) layers the clearly-labeled
// estimates (cost saved, reach) on top. Reconciles with the Usage page (same mkt_llm_usage ledger).
import { prisma } from '../db/client.ts';
import { creditsFromTokens, creditsFromUsd } from '../cost/credits.ts';
import { sumFbInsights } from '../analytics/fb-insights.ts';
import { sumIgInsights } from '../analytics/ig-insights.ts';
import { mergeInsights } from '../analytics/insights-types.ts';

export interface ImpactMetrics {
  postsPublished: number; // posts that actually went live (posted | partial)
  postsTotal: number;
  platforms: string[]; // distinct platforms reached across published posts
  mediaPieces: number; // real media generations billed (infographic/storyboard/video ledger rows)
  usdSpent: number; // real spend from the cost ledger
  totalTokens: number;
  creditsSpent: number; // friendly credits (token passthrough + media USD), same basis as Usage
  leadsCaptured: number;
  runMinutes: number; // wall-clock across the contributing runs
  // MEASURED social Insights (P2-2b: FB Page Insights + IG Media Insights). A field is null when NO
  // platform could measure it (no published posts there, or the metric is withheld) → the report uses
  // the labeled estimate for that field. `insightsPlatforms` names who contributed (e.g. ['facebook','instagram']).
  measuredReach: number | null;
  measuredImpressions: number | null;
  measuredEngaged: number | null;
  postsMeasured: number; // published posts (any platform) that returned real insights
  insightsPlatforms: string[];
}

const LIVE = ['posted', 'partial'];
const MEDIA_SURFACES = ['infographic', 'storyboard', 'video'];

// Published posts → their per-platform post/media ids for the Insights lookup.
type PublishedIdRow = { status: string; platformPostIds: unknown };
const platformIdsOf = (posts: PublishedIdRow[], platform: 'facebook' | 'instagram'): string[] =>
  posts
    .filter((p) => LIVE.includes(p.status))
    .map((p) => (p.platformPostIds as Record<string, string> | null)?.[platform])
    .filter((id): id is string => Boolean(id));

// FB Page + IG Media insights, merged per-field (null-aware). Parallel; each adapter is best-effort.
const measuredInsightsFor = async (ownerId: string, posts: PublishedIdRow[]) =>
  mergeInsights(await Promise.all([
    sumFbInsights(ownerId, platformIdsOf(posts, 'facebook')),
    sumIgInsights(ownerId, platformIdsOf(posts, 'instagram')),
  ]));

// Credits consistent with the Usage page: token passthrough PLUS credits from tokenless media USD.
const creditsFor = (totalTokens: number, mediaUsd: number): number =>
  creditsFromTokens(totalTokens) + creditsFromUsd(mediaUsd);

const emptyMetrics = (): ImpactMetrics => ({
  postsPublished: 0, postsTotal: 0, platforms: [], mediaPieces: 0,
  usdSpent: 0, totalTokens: 0, creditsSpent: 0, leadsCaptured: 0, runMinutes: 0,
  measuredReach: null, measuredImpressions: null, measuredEngaged: null, postsMeasured: 0, insightsPlatforms: [],
});

const runMinutesFor = (runs: Array<{ createdAt: Date; updatedAt: Date }>): number =>
  Math.round(runs.reduce((s, r) => s + Math.max(0, r.updatedAt.getTime() - r.createdAt.getTime()), 0) / 60000);

// One campaign's real impact. Ledger rows are matched by the campaign's post ids (refId) OR run ids.
export async function metricsForCampaign(campaignId: string, ownerId: string): Promise<ImpactMetrics> {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, ownerId }, select: { product: true } });
  if (!campaign) return emptyMetrics();
  const posts = await prisma.post.findMany({ where: { campaignId, ownerId }, select: { id: true, status: true, platforms: true, runId: true, platformPostIds: true } });
  const postIds = posts.map((p) => p.id);
  const runIds = [...new Set(posts.map((p) => p.runId).filter((r): r is string => Boolean(r)))];
  const published = posts.filter((p) => LIVE.includes(p.status));

  const ledgerWhere = { ownerId, OR: [{ refId: { in: postIds } }, { runId: { in: runIds } }] };
  const [agg, media, mediaCredit, runs, leadsCaptured] = await Promise.all([
    prisma.llmUsage.aggregate({ where: ledgerWhere, _sum: { costUsd: true, totalTokens: true } }),
    // mediaPieces counts ALL media generations (incl. token-bearing image gens) — no token filter.
    prisma.llmUsage.aggregate({ where: { ...ledgerWhere, surface: { in: MEDIA_SURFACES } }, _count: true }),
    // Credit basis mirrors the Usage page EXACTLY (llm-usage.ts:123-127): sum tokenless USD across
    // EVERY surface (not just MEDIA_SURFACES) so a flat/media cost recorded under any surface converts
    // to credits, while token-bearing rows are excluded (they're already counted via totalTokens).
    prisma.llmUsage.aggregate({ where: { ...ledgerWhere, totalTokens: 0 }, _sum: { costUsd: true } }),
    runIds.length ? prisma.workflowRun.findMany({ where: { id: { in: runIds }, ownerId }, select: { createdAt: true, updatedAt: true } }) : Promise.resolve([]),
    // Leads have no campaign FK — attribute by the campaign's product (best available link), owner-scoped.
    campaign.product ? prisma.lead.count({ where: { ownerId, sourceProduct: campaign.product } }) : Promise.resolve(0),
  ]);

  const totalTokens = agg._sum.totalTokens ?? 0;
  const mediaCreditUsd = mediaCredit._sum.costUsd ?? 0;
  const insights = await measuredInsightsFor(ownerId, posts);
  return {
    postsPublished: published.length,
    postsTotal: posts.length,
    platforms: [...new Set(published.flatMap((p) => p.platforms))],
    mediaPieces: media._count,
    usdSpent: agg._sum.costUsd ?? 0,
    totalTokens,
    creditsSpent: creditsFor(totalTokens, mediaCreditUsd),
    leadsCaptured,
    runMinutes: runMinutesFor(runs),
    measuredReach: insights.measuredReach,
    measuredImpressions: insights.measuredImpressions,
    measuredEngaged: insights.measuredEngaged,
    postsMeasured: insights.postsMeasured,
    insightsPlatforms: insights.platforms,
  };
}

// A period's real impact across ALL the owner's activity since `since` (owner-scoped date window).
export async function metricsForPeriod(ownerId: string, since: Date): Promise<ImpactMetrics> {
  const posts = await prisma.post.findMany({ where: { ownerId, createdAt: { gte: since } }, select: { status: true, platforms: true, runId: true, platformPostIds: true } });
  const runIds = [...new Set(posts.map((p) => p.runId).filter((r): r is string => Boolean(r)))];
  const published = posts.filter((p) => LIVE.includes(p.status));

  const ledgerWhere = { ownerId, createdAt: { gte: since } };
  const [agg, media, mediaCredit, runs, leadsCaptured] = await Promise.all([
    prisma.llmUsage.aggregate({ where: ledgerWhere, _sum: { costUsd: true, totalTokens: true } }),
    // mediaPieces counts ALL media generations (incl. token-bearing image gens) — no token filter.
    prisma.llmUsage.aggregate({ where: { ...ledgerWhere, surface: { in: MEDIA_SURFACES } }, _count: true }),
    // Credit basis mirrors the Usage page EXACTLY: sum tokenless USD across EVERY surface so a flat
    // cost on any surface converts to credits; token-bearing rows are excluded (counted via tokens).
    prisma.llmUsage.aggregate({ where: { ...ledgerWhere, totalTokens: 0 }, _sum: { costUsd: true } }),
    runIds.length ? prisma.workflowRun.findMany({ where: { id: { in: runIds }, ownerId }, select: { createdAt: true, updatedAt: true } }) : Promise.resolve([]),
    prisma.lead.count({ where: { ownerId, receivedAt: { gte: since } } }),
  ]);

  const totalTokens = agg._sum.totalTokens ?? 0;
  const mediaCreditUsd = mediaCredit._sum.costUsd ?? 0;
  const insights = await measuredInsightsFor(ownerId, posts);
  return {
    postsPublished: published.length,
    postsTotal: posts.length,
    platforms: [...new Set(published.flatMap((p) => p.platforms))],
    mediaPieces: media._count,
    usdSpent: agg._sum.costUsd ?? 0,
    totalTokens,
    creditsSpent: creditsFor(totalTokens, mediaCreditUsd),
    leadsCaptured,
    runMinutes: runMinutesFor(runs),
    measuredReach: insights.measuredReach,
    measuredImpressions: insights.measuredImpressions,
    measuredEngaged: insights.measuredEngaged,
    postsMeasured: insights.postsMeasured,
    insightsPlatforms: insights.platforms,
  };
}
