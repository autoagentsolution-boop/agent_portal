// LLM/media usage ledger (mkt_llm_usage) — the single per-owner spend record across EVERY
// surface. Every public model call should record here so a tenant's true cost can be totalled +
// broken down for billing + business analysis. All writes are BEST-EFFORT: recording must never
// block or fail the call it measures.
import { prisma } from '../db/client.ts';
import { logger } from '../lib/logger.ts';
import { costFromUsage, costUsdFromUsage, type GeminiUsage } from '../orchestration/executor/node-cost.ts';
import { creditsFromTokens, creditsFromUsd } from './credits.ts';

// Normalize a raw Gemini generateContent response envelope → GeminiUsage. Reads the REAL
// usageMetadata (incl. thoughtsTokenCount + cachedContentTokenCount) rather than estimating.
export const extractGeminiUsage = (raw: unknown): GeminiUsage => {
  const u =
    (raw as {
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
        cachedContentTokenCount?: number;
      };
    }).usageMetadata ?? {};
  return {
    promptTokens: u.promptTokenCount ?? 0,
    outputTokens: u.candidatesTokenCount ?? 0,
    thoughtTokens: u.thoughtsTokenCount ?? 0,
    cachedTokens: u.cachedContentTokenCount ?? 0,
  };
};

export interface RecordUsageInput {
  ownerId?: string | null;
  surface: string; // chat | intake | copygen | research | lead_rescore | product_analysis | orchestration
  model: string;
  usage: GeminiUsage;
  // Media/grounding calls with no token bill pass an explicit costUsd (added on top of token cost).
  extraCostUsd?: number;
  runId?: string | null;
  refId?: string | null;
}

export const recordLlmUsage = async (input: RecordUsageInput): Promise<void> => {
  try {
    const { usage, model } = input;
    const totalTokens = usage.promptTokens + usage.outputTokens + usage.thoughtTokens;
    const costUsd = costUsdFromUsage(usage, model) + (input.extraCostUsd ?? 0);
    await prisma.llmUsage.create({
      data: {
        ownerId: input.ownerId ?? null,
        surface: input.surface,
        model,
        promptTokens: usage.promptTokens,
        outputTokens: usage.outputTokens,
        thoughtTokens: usage.thoughtTokens,
        cachedTokens: usage.cachedTokens,
        totalTokens,
        costUsd,
        runId: input.runId ?? null,
        refId: input.refId ?? null,
      },
    });
  } catch (e) {
    // Never surface a ledger write failure to the measured call.
    logger.warn('llm_usage_record_failed', { surface: input.surface, error: String(e).slice(0, 160) });
  }
};

// One-shot: extract usage from a raw Gemini response and record it. The common path for callers
// that already hold the raw envelope.
export const recordGeminiCall = async (
  raw: unknown,
  meta: { ownerId?: string | null; surface: string; model: string; extraCostUsd?: number; runId?: string | null; refId?: string | null },
): Promise<void> => recordLlmUsage({ ...meta, usage: extractGeminiUsage(raw) });

// Record a media (image/video/tts) generation that bills a flat/derived USD amount, not tokens.
export const recordMediaCost = async (
  meta: { ownerId?: string | null; surface: string; model: string; costUsd: number; runId?: string | null; refId?: string | null },
): Promise<void> =>
  recordLlmUsage({
    ownerId: meta.ownerId,
    surface: meta.surface,
    model: meta.model,
    usage: { promptTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0 },
    extraCostUsd: meta.costUsd,
    runId: meta.runId,
    refId: meta.refId,
  });

export interface SurfaceTotal {
  surface: string;
  costUsd: number;
  totalTokens: number;
  credits: number;
  calls: number;
}
export interface UsageTotals {
  costUsd: number;
  totalTokens: number;
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  credits: number;
  calls: number;
  bySurface: SurfaceTotal[];
}

// Per-owner spend total + per-surface breakdown — the billing/analysis view.
export const usageTotals = async (ownerId: string): Promise<UsageTotals> => {
  const [agg, grouped, mediaGrouped] = await Promise.all([
    prisma.llmUsage.aggregate({
      where: { ownerId },
      _sum: { costUsd: true, totalTokens: true, promptTokens: true, outputTokens: true, thoughtTokens: true },
      _count: true,
    }),
    prisma.llmUsage.groupBy({
      by: ['surface'],
      where: { ownerId },
      _sum: { costUsd: true, totalTokens: true },
      _count: true,
    }),
    // Media rows carry USD but zero tokens (feedback #4). Sum the USD of the tokenless rows per
    // surface so their spend converts to credits ON TOP of the token-passthrough — otherwise a
    // video/image run shows real USD but 0 credits and the media spend is invisible in the UI.
    prisma.llmUsage.groupBy({
      by: ['surface'],
      where: { ownerId, totalTokens: 0 },
      _sum: { costUsd: true },
    }),
  ]);
  const mediaUsdBySurface = new Map(mediaGrouped.map((g) => [g.surface, g._sum.costUsd ?? 0]));
  const totalTokens = agg._sum.totalTokens ?? 0;
  // Credits are ADDITIVE per surface: token passthrough for the LLM tokens PLUS the USD-derived
  // credits of any tokenless media rows on that surface. Robust even if a surface mixes both.
  const bySurface = grouped
    .map((g) => {
      const tokens = g._sum.totalTokens ?? 0;
      const credits = creditsFromTokens(tokens) + creditsFromUsd(mediaUsdBySurface.get(g.surface) ?? 0);
      return { surface: g.surface, costUsd: g._sum.costUsd ?? 0, totalTokens: tokens, credits, calls: g._count };
    })
    .sort((a, b) => b.costUsd - a.costUsd);
  return {
    costUsd: agg._sum.costUsd ?? 0,
    totalTokens,
    promptTokens: agg._sum.promptTokens ?? 0,
    outputTokens: agg._sum.outputTokens ?? 0,
    thoughtTokens: agg._sum.thoughtTokens ?? 0,
    credits: bySurface.reduce((s, x) => s + x.credits, 0),
    calls: agg._count,
    bySurface,
  };
};

// Re-export so callers can compute a NodeCost from usage without importing node-cost directly.
export { costFromUsage };
