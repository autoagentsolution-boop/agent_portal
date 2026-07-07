// Credit display anchors — MIRRORS the backend source of truth at MKTAgent/src/cost/credits.ts.
// "Credits" are a friendly presentation of real spend, NOT a price: token nodes by tokens, media
// nodes by USD, on ONE comparable scale. Keep these values in lock-step with the backend; if the
// anchor ever moves, change it in BOTH places (there's no shared module across the API/web split).
export const TOKENS_PER_CREDIT = 250; // 15k tokens ≈ 60 credits
export const USD_PER_CREDIT = (TOKENS_PER_CREDIT / 1_000_000) * 2.5; // $0.000625 (flash output rate)

// A run that spent SOMETHING never shows 0 credits (Math.max(1, …)).
export const creditsFromTokens = (totalTokens: number): number =>
  totalTokens <= 0 ? 0 : Math.max(1, Math.round(totalTokens / TOKENS_PER_CREDIT));

export const creditsFromUsd = (costUsd: number): number =>
  costUsd <= 0 ? 0 : Math.max(1, Math.round(costUsd / USD_PER_CREDIT));
