// Plan cost estimation (Atria Phase 03) — estimate a DAG's tokens/credits BEFORE running it,
// from real per-agent history (agentCostAverages) with sane per-agent fallbacks for agents that
// have no history yet (new install / new agent). Used by the multi-tier plan cards so each tier
// shows a real estimated credit cost, not a guess.
import type { AgentCostAverage } from '../db/repos/workflow-run-repo.ts';
import { creditsFromTokens } from './credits.ts';
import { imageCost, videoClipCost, ttsCost } from '../orchestration/executor/node-cost.ts';

// Fallback per-agent total-token estimates (order-of-magnitude) when no history exists. LLM
// agents are token-costed; media agents spend on generation (flat/derived USD, ~0 tokens) so
// their token estimate is small but they carry a USD floor via MEDIA_USD_FLOOR below.
const DEFAULT_AGENT_TOKENS: Record<string, number> = {
  content_search: 3_000, // grounded research (+ surcharge below)
  ideation: 2_000,
  strategy: 2_500,
  concept_writer: 6_000, // 3-5 copy variants
  infographic: 1_500,
  storyboard: 4_000, // plan + per-frame prompts
  video: 1_000,
  publisher: 0,
};

// Media agents bill mostly in USD (image/video/tts), not tokens — a floor so a media-heavy tier
// isn't shown as near-free. Rough per-node USD from node-cost's real constants.
const MEDIA_USD_FLOOR: Record<string, number> = {
  infographic: imageCost().costUsd, // one image
  storyboard: imageCost().costUsd * 4, // ~4 frames
  video: videoClipCost(4, 8).costUsd + ttsCost().costUsd, // ~4 clips + voiceover
  content_search: 0.035, // grounding surcharge
};

export interface PlanEstimate {
  totalTokens: number;
  costUsd: number;
  credits: number;
  agentCount: number;
}

// Estimate a plan (list of agent ids) using history where available, fallbacks otherwise.
export const estimateAgents = (agentIds: string[], history: AgentCostAverage[]): PlanEstimate => {
  const byId = new Map(history.map((h) => [h.agentId, h]));
  let totalTokens = 0;
  let costUsd = 0;
  for (const id of agentIds) {
    const h = byId.get(id);
    if (h && h.avgTotalTokens > 0) {
      totalTokens += h.avgTotalTokens;
      costUsd += h.avgCostUsd;
    } else {
      totalTokens += DEFAULT_AGENT_TOKENS[id] ?? 1_000;
    }
    costUsd += MEDIA_USD_FLOOR[id] ?? 0; // media spend history doesn't live in tokens
  }
  return { totalTokens, costUsd, credits: creditsFromTokens(totalTokens), agentCount: agentIds.length };
};
