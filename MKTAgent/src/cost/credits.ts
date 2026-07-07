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

// Media (image/video/TTS) bills a USD amount with NO tokens, so token-passthrough credits show 0
// for it — real spend goes invisible (feedback #4). Convert media USD → credits on a basis that
// stays CONSISTENT with the token scale: 250 tokens/credit at the flash OUTPUT rate ($2.50/1M) ⇒
// $0.000625/credit. So a $0.04 image ≈ 64 credits sits right next to a 15k-token run ≈ 60 credits —
// the two dimensions read on one comparable scale. Like TOKENS_PER_CREDIT this is a DISPLAY anchor,
// not a price; a future paid plan layers a real price on top without touching the display.
export const USD_PER_CREDIT = (TOKENS_PER_CREDIT / 1_000_000) * 2.5; // $0.000625

export const creditsFromUsd = (costUsd: number): number => {
  if (costUsd <= 0) return 0;
  return Math.max(1, Math.round(costUsd / USD_PER_CREDIT));
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
