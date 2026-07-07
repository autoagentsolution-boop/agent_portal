# Phase 02 — Impact ↔ Usage credit reconcile (P0 BUG)

**Priority:** P0 · **Status:** planned · **Type:** clear bug, small
Impact report and Usage page show DIFFERENT credit totals for the same activity.

## Root cause (verified)
Usage (`MKTAgent/src/cost/llm-usage.ts:123-129`) sums media USD ONLY over tokenless rows
(`where: { ownerId, totalTokens: 0 }`) so media spend converts to credits ON TOP of token
passthrough without double-counting token-bearing media rows.

Impact (`MKTAgent/src/impact/impact-metrics.ts:47,77`) sums media USD over ALL media-surface
rows (no `totalTokens: 0` filter), then `creditsFor(totalTokens, mediaUsd)` =
`creditsFromTokens(totalTokens) + creditsFromUsd(mediaUsd)` (`:24-25,62,91`). Image-based media
(infographic/storyboard) record tokens>0 AND costUsd>0 → counted twice (once in totalTokens,
once in mediaUsd). Video (Veo, tokenless) is fine. Net: Impact `creditsSpent` > Usage credits.
`usdSpent` (`agg._sum.costUsd`, all rows) is correct and unaffected.

## Fix (design) — mirror Usage, but keep mediaPieces counting ALL media
⚠ Do NOT just add `totalTokens:0` to the existing `media` aggregate — it also feeds
`mediaPieces` (`media._count`), which must count ALL media generations (incl. token-bearing
image gens). Adding the filter there would undercount mediaPieces. SPLIT the concerns.

In BOTH `metricsForCampaign` (:45-51) and `metricsForPeriod` (:75-80):
1. Keep the existing `media` aggregate (surface in MEDIA_SURFACES, no token filter) → use its
   `_count` for `mediaPieces` only.
2. Add a SEPARATE credit-basis sum: `mediaCreditUsd` = `llmUsage.aggregate({ where: { ...ledgerWhere,
   surface: { in: MEDIA_SURFACES }, totalTokens: 0 }, _sum: { costUsd: true } })`.
3. Feed `creditsFor(totalTokens, mediaCreditUsd)` (not the unfiltered mediaUsd).

Result: `creditsSpent` uses the exact same basis as `usageTotals` → the two pages reconcile.
Optionally factor the shared media-credit sum so drift can't recur.

## Todo
- [ ] add tokenless media-USD sum (`totalTokens:0`) in metricsForCampaign + metricsForPeriod
- [ ] keep mediaPieces = all-media `_count`
- [ ] creditsSpent uses the filtered basis
- [ ] tsc backend; spot-check Impact credits == Usage credits for one owner (SELECT-only)

## Success criteria
- For the same owner/period, Impact `creditsSpent` == Usage page total credits.
- `mediaPieces` unchanged (still counts every media generation).
- `usdSpent` unchanged.

## Risk
- Low. Pure read-path aggregation change. Confirm parity with a manual SELECT before/after.
