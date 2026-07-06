// Credit model (Atria Phase 03) — TRANSPARENT TOKEN PASSTHROUGH. "Credits" are just a friendly
// presentation of the REAL tokens a run consumed: no markup, no billing engine, no paid tier in
// MVP — the goal is clarity for non-tech users ("≈ 60 credits", raw tokens on hover). The divisor
// is a DISPLAY constant, NOT a price; a future paid plan layers a price on top WITHOUT reworking
// the display. Keep it here as the single source of truth.
export const TOKENS_PER_CREDIT = 250; // 15k tokens ≈ 60 credits (matches the command-center mockup)

// Round to a friendly whole number; a run that spent SOMETHING never shows 0 credits.
export const creditsFromTokens = (totalTokens: number): number => {
  if (totalTokens <= 0) return 0;
  return Math.max(1, Math.round(totalTokens / TOKENS_PER_CREDIT));
};

export interface CostLike {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

// Attach the friendly `credits` number to a raw token/cost summary. Raw tokens + USD stay
// available for the transparency hover + any future pricing.
export const withCredits = <T extends CostLike>(c: T): T & { credits: number } => ({
  ...c,
  credits: creditsFromTokens(c.totalTokens),
});
