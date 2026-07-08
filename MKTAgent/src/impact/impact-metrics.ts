// Impact metrics (Atria Phase 07) — REAL aggregation over data the app already captures, for one
// campaign or a period. Everything here is MEASURED (cost ledger, Post/Artifact rows, lead rows,
// run timestamps) — no estimates. The value model (value-model.ts) layers the clearly-labeled
// estimates (cost saved, reach) on top. Reconciles with the Usage page (same mkt_llm_usage ledger).
import { prisma } from '../db/client.ts';
import { creditsFromTokens, creditsFromUsd } from '../cost/credits.ts';

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
}

const LIVE = ['posted', 'partial'];
const MEDIA_SURFACES = ['infographic', 'storyboard', 'video'];

// Credits consistent with the Usage page: token passthrough PLUS credits from tokenless media USD.
const creditsFor = (totalTokens: number, mediaUsd: number): number =>
  creditsFromTokens(totalTokens) + creditsFromUsd(mediaUsd);

const emptyMetrics = (): ImpactMetrics => ({
  postsPublished: 0, postsTotal: 0, platforms: [], mediaPieces: 0,
  usdSpent: 0, totalTokens: 0, creditsSpent: 0, leadsCaptured: 0, runMinutes: 0,
});

const runMinutesFor = (runs: Array<{ createdAt: Date; updatedAt: Date }>): number =>
  Math.round(runs.reduce((s, r) => s + Math.max(0, r.updatedAt.getTime() - r.createdAt.getTime()), 0) / 60000);

// One campaign's real impact. Ledger rows are matched by the campaign's post ids (refId) OR run ids.
export async function metricsForCampaign(campaignId: string, ownerId: string): Promise<ImpactMetrics> {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, ownerId }, select: { product: true } });
  if (!campaign) return emptyMetrics();
  const posts = await prisma.post.findMany({ where: { campaignId, ownerId }, select: { id: true, status: true, platforms: true, runId: true } });
  const postIds = posts.map((p) => p.id);
  const runIds = [...new Set(posts.map((p) => p.runId).filter((r): r is string => Boolean(r)))];
  const published = posts.filter((p) => LIVE.includes(p.status));

  const ledgerWhere = { ownerId, OR: [{ refId: { in: postIds } }, { runId: { in: runIds } }] };
  const [agg, media, mediaCredit, runs, leadsCaptured] = await Promise.all([
    prisma.llmUsage.aggregate({ where: ledgerWhere, _sum: { costUsd: true, totalTokens: true } }),
    // mediaPieces counts ALL media generations (incl. token-bearing image gens) — no token filter.
    prisma.llmUsage.aggregate({ where: { ...ledgerWhere, surface: { in: MEDIA_SURFACES } }, _count: true }),
    // Credit basis mirrors the Usage page (llm-usage.ts:123-127): ONLY tokenless media USD converts to
    // credits, so token-bearing image gens aren't double-counted (once in totalTokens, once in USD).
    prisma.llmUsage.aggregate({ where: { ...ledgerWhere, surface: { in: MEDIA_SURFACES }, totalTokens: 0 }, _sum: { costUsd: true } }),
    runIds.length ? prisma.workflowRun.findMany({ where: { id: { in: runIds }, ownerId }, select: { createdAt: true, updatedAt: true } }) : Promise.resolve([]),
    // Leads have no campaign FK — attribute by the campaign's product (best available link), owner-scoped.
    campaign.product ? prisma.lead.count({ where: { ownerId, sourceProduct: campaign.product } }) : Promise.resolve(0),
  ]);

  const totalTokens = agg._sum.totalTokens ?? 0;
  const mediaCreditUsd = mediaCredit._sum.costUsd ?? 0;
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
  };
}

// A period's real impact across ALL the owner's activity since `since` (owner-scoped date window).
export async function metricsForPeriod(ownerId: string, since: Date): Promise<ImpactMetrics> {
  const posts = await prisma.post.findMany({ where: { ownerId, createdAt: { gte: since } }, select: { status: true, platforms: true, runId: true } });
  const runIds = [...new Set(posts.map((p) => p.runId).filter((r): r is string => Boolean(r)))];
  const published = posts.filter((p) => LIVE.includes(p.status));

  const ledgerWhere = { ownerId, createdAt: { gte: since } };
  const [agg, media, mediaCredit, runs, leadsCaptured] = await Promise.all([
    prisma.llmUsage.aggregate({ where: ledgerWhere, _sum: { costUsd: true, totalTokens: true } }),
    // mediaPieces counts ALL media generations (incl. token-bearing image gens) — no token filter.
    prisma.llmUsage.aggregate({ where: { ...ledgerWhere, surface: { in: MEDIA_SURFACES } }, _count: true }),
    // Credit basis mirrors the Usage page: ONLY tokenless media USD converts to credits.
    prisma.llmUsage.aggregate({ where: { ...ledgerWhere, surface: { in: MEDIA_SURFACES }, totalTokens: 0 }, _sum: { costUsd: true } }),
    runIds.length ? prisma.workflowRun.findMany({ where: { id: { in: runIds }, ownerId }, select: { createdAt: true, updatedAt: true } }) : Promise.resolve([]),
    prisma.lead.count({ where: { ownerId, receivedAt: { gte: since } } }),
  ]);

  const totalTokens = agg._sum.totalTokens ?? 0;
  const mediaCreditUsd = mediaCredit._sum.costUsd ?? 0;
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
  };
}
