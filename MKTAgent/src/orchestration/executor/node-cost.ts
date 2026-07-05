// Per-node token/cost accounting (Phase 6). Kept deliberately simple + dependency-free:
// exact usageMetadata plumbing across every Gemini path is a larger change, so we ESTIMATE
// from the node's actual I/O sizes (LLM) or a flat per-image price (image gen). Real
// usageMetadata can replace estimateLlmTokens later WITHOUT a schema change (same columns).
//
// Estimation basis: ~4 chars/token (OpenAI/Gemini rule of thumb). Prices are current
// public list (2026-01) for gemini-2.5-flash text + gemini-2.5-flash-image; adjust in
// ONE place if they change. Everything here is best-effort — cost accounting must NEVER
// throw into the executor hot path (callers wrap it).
import type { RunnableAgentId } from '../registry/agent-types.ts';

export interface NodeCost {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export const ZERO_COST: NodeCost = { promptTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };

// gemini-2.5-flash text ($/1M tokens). Input and output priced separately.
const TEXT_INPUT_PER_M = 0.30;
const TEXT_OUTPUT_PER_M = 2.50;
// gemini-2.5-flash-image: flat per generated image (list ~$0.039/image, round to demo-safe).
const IMAGE_FLAT_USD = 0.04;

const CHARS_PER_TOKEN = 4;
const toTokens = (s: string): number => Math.ceil(s.length / CHARS_PER_TOKEN);

// Estimate an LLM node's cost from its prompt + completion text.
export const estimateLlmCost = (promptText: string, completionText: string): NodeCost => {
  const promptTokens = toTokens(promptText);
  const outputTokens = toTokens(completionText);
  const costUsd =
    (promptTokens / 1_000_000) * TEXT_INPUT_PER_M +
    (outputTokens / 1_000_000) * TEXT_OUTPUT_PER_M;
  return { promptTokens, outputTokens, totalTokens: promptTokens + outputTokens, costUsd };
};

// Flat cost for one generated image (image models don't bill by token here).
export const imageCost = (): NodeCost => ({ ...ZERO_COST, costUsd: IMAGE_FLAT_USD });

// Flat cost for one generated video clip (Veo i2v). Public list varies by tier; round to a
// demo-safe estimate. Adjust in ONE place. (Not billed by token.)
const VIDEO_CLIP_FLAT_USD = 0.2;
export const videoClipCost = (clips: number): NodeCost => ({ ...ZERO_COST, costUsd: VIDEO_CLIP_FLAT_USD * Math.max(0, clips) });

// Sum two node costs (LLM planning + N media generations in one node).
export const sumCost = (a: NodeCost | undefined, b: NodeCost | undefined): NodeCost => ({
  promptTokens: (a?.promptTokens ?? 0) + (b?.promptTokens ?? 0),
  outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
  totalTokens: (a?.totalTokens ?? 0) + (b?.totalTokens ?? 0),
  costUsd: (a?.costUsd ?? 0) + (b?.costUsd ?? 0),
});

// Which agents actually spend. content_search stub + publisher = $0. storyboard (images) and
// video (Veo clips) now spend. Used only as a guard; the runner returns the real estimate.
export const SPENDING_AGENTS: ReadonlySet<RunnableAgentId> = new Set<RunnableAgentId>([
  'ideation', 'strategy', 'concept_writer', 'infographic', 'storyboard', 'video',
]);
