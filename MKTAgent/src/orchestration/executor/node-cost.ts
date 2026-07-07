// Per-node token/cost accounting. PREFER real usageMetadata (costFromUsage) over the char/4
// estimate — the estimate misses Gemini 2.5 THINKING tokens (billed at the output rate, often
// several× the visible output), image-input tokens, and grounding tokens, so it can undercount
// by an order of magnitude. estimateLlmCost stays only as a fallback when a response carries no
// usageMetadata. Everything here is best-effort — cost accounting must NEVER throw into a hot path.
//
// Prices are current public list (2026-07); adjust in ONE place. Costed per model tier so a
// pro/lite call isn't priced at flash rates.

export interface NodeCost {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export const ZERO_COST: NodeCost = { promptTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };

// Real provider token split. thoughtTokens = Gemini 2.5 internal reasoning (billed at OUTPUT
// rate); cachedTokens = the cached portion of the prompt (billed at the cheaper cached rate,
// and already included in promptTokens per the API).
export interface GeminiUsage {
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  cachedTokens: number;
}

interface ModelPrice { inPerM: number; outPerM: number; cachedPerM: number }
// $/1M tokens by model tier (2026-07 public list). Keys are prefixes — a '-preview'/'-tts'/
// '-002' variant resolves to its base tier. Unknown model → flash (the default GEMINI_MODEL).
const PRICING: Record<string, ModelPrice> = {
  'gemini-2.5-pro': { inPerM: 1.25, outPerM: 10.0, cachedPerM: 0.125 },
  'gemini-2.5-flash-lite': { inPerM: 0.10, outPerM: 0.40, cachedPerM: 0.01 },
  'gemini-2.5-flash': { inPerM: 0.30, outPerM: 2.50, cachedPerM: 0.03 },
  'gemini-3-pro': { inPerM: 2.0, outPerM: 12.0, cachedPerM: 0.20 },
  'gemini-3-flash': { inPerM: 0.50, outPerM: 3.0, cachedPerM: 0.05 },
  // Image gen (nano-banana) bills the generated image AS output tokens (~1290 tok/image @ $30/1M
  // ≈ $0.039). Real usageMetadata → real token-based cost that lands near the old $0.04 flat, but
  // now with visible token counts. Longer prefix than 'gemini-2.5-flash' so it wins the match.
  'gemini-2.5-flash-image': { inPerM: 0.30, outPerM: 30.0, cachedPerM: 0.03 },
};
const DEFAULT_PRICE = PRICING['gemini-2.5-flash']!;
const priceFor = (model?: string): ModelPrice => {
  if (!model) return DEFAULT_PRICE;
  // Longest-prefix match so 'gemini-2.5-flash-lite' isn't shadowed by 'gemini-2.5-flash'.
  const key = Object.keys(PRICING).filter((k) => model.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  return key ? PRICING[key]! : DEFAULT_PRICE;
};

// Cost in USD from REAL usage. Thinking billed at output rate; cached prompt at the cached rate.
export const costUsdFromUsage = (u: GeminiUsage, model?: string): number => {
  const p = priceFor(model);
  const billedInput = Math.max(0, u.promptTokens - u.cachedTokens);
  return (
    (billedInput / 1_000_000) * p.inPerM +
    (u.cachedTokens / 1_000_000) * p.cachedPerM +
    ((u.outputTokens + u.thoughtTokens) / 1_000_000) * p.outPerM
  );
};

// NodeCost from real usage — thinking tokens fold into outputTokens so the per-node display +
// cost include them (wf_node_run has no separate thought column; the llm_usage ledger keeps the split).
export const costFromUsage = (u: GeminiUsage, model?: string): NodeCost => {
  const outputTokens = u.outputTokens + u.thoughtTokens;
  return {
    promptTokens: u.promptTokens,
    outputTokens,
    totalTokens: u.promptTokens + outputTokens,
    costUsd: costUsdFromUsage(u, model),
  };
};

const CHARS_PER_TOKEN = 4;
const toTokens = (s: string): number => Math.ceil(s.length / CHARS_PER_TOKEN);

// FALLBACK ONLY — estimate an LLM node's cost from text when no usageMetadata is available.
// Undercounts thinking/image/grounding tokens; prefer costFromUsage everywhere possible.
export const estimateLlmCost = (promptText: string, completionText: string, model?: string): NodeCost =>
  costFromUsage(
    { promptTokens: toTokens(promptText), outputTokens: toTokens(completionText), thoughtTokens: 0, cachedTokens: 0 },
    model,
  );

// gemini-2.5-flash-image: flat per generated image (list ~$0.039/image).
const IMAGE_FLAT_USD = 0.04;
// Flat cost for one generated image (image models don't bill by token here).
export const imageCost = (): NodeCost => ({ ...ZERO_COST, costUsd: IMAGE_FLAT_USD });

// Veo i2v priced PER SECOND (not flat): veo-3.1-lite ≈ $0.05/s silent 720p (2026-07); Fast/
// Standard/audio tiers cost more — override VEO_PER_SEC_USD if the tier changes. An 8s clip
// ≈ $0.40, so the old $0.20 flat undercounted ~2×.
const VEO_PER_SEC_USD = 0.05;
export const videoClipCost = (clips: number, durationSec = 8): NodeCost =>
  ({ ...ZERO_COST, costUsd: VEO_PER_SEC_USD * Math.max(0, durationSec) * Math.max(0, clips) });

// Flat cost for one generated TTS voiceover (Gemini TTS bills audio-output tokens; this is a
// demo-safe per-clip estimate so the video node's cost isn't understated by the narration).
const TTS_FLAT_USD = 0.02;
export const ttsCost = (): NodeCost => ({ ...ZERO_COST, costUsd: TTS_FLAT_USD });

// Sum two node costs (LLM planning + N media generations in one node).
export const sumCost = (a: NodeCost | undefined, b: NodeCost | undefined): NodeCost => ({
  promptTokens: (a?.promptTokens ?? 0) + (b?.promptTokens ?? 0),
  outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
  totalTokens: (a?.totalTokens ?? 0) + (b?.totalTokens ?? 0),
  costUsd: (a?.costUsd ?? 0) + (b?.costUsd ?? 0),
});
