# Audit — Gemini/public-LLM cost accounting (why 500K credit burned but data shows ~$5)

Branch `pivot/video-content-farm`. Model in use: `gemini-2.5-flash` (a THINKING model). Verdict:
the tracked cost is a large **undercount** from three compounding causes. Pricing constants
themselves are correct ($0.30 in / $2.50 out per 1M for 2.5-flash, confirmed July 2026).

## Root causes (ranked by impact)

### 1. Most Gemini calls record NO cost at all (invisible spend)
The only per-owner cost aggregate is `workflowNodeRun` (`workflow-run-repo.ts:174`). It sums ONLY
orchestration DAG node costs. These call sites spend real tokens and are recorded NOWHERE:
- **Chat / Master Agent every turn** — `conversation-author.ts`, `requirement-analyzer.ts`,
  `save-offer-author.ts`. A conversation can be dozens of Gemini calls; all uncounted.
- **Intake** — `agent/gemini-intake-provider.ts`, `api/agent-router.ts`.
- **Copy-gen standalone** — `copygen/gemini.ts` via `POST /posts/:id/generate` + the copygen cron.
  (The DAG concept_writer path estimates a cost; the standalone + cron paths do not.)
- **Lead rescore** — `leads/scoring/llm-score.ts` (`POST /leads/:id/rescore`).
- **Product-knowledge analyze** — computes cost (real usageMetadata!) but only RETURNS it
  (`product-knowledge-router.ts:121`); never persisted → not in any total.

### 2. Recorded costs use char/4 estimation, missing THINKING tokens
`node-cost.ts estimateLlmCost` = `ceil(len/4)` on the strings passed in. gemini-2.5-flash bills
**`thoughtsTokenCount` (internal reasoning) at the OUTPUT rate** — and it is frequently several×
the visible output, even when the final answer is short (confirmed in Google's pricing docs). The
estimate reads only the visible completion text → the entire thinking cost is invisible. It also
misses: image-input tokens (multimodal), grounding tokens, and any input not included in the passed
string (several callers pass only a subset, e.g. concept_writer passes `goalContext`, not the full
copy-gen body). Only `analyze-documents.ts` reads real `usageMetadata` — that path is the model to
copy everywhere.

### 3. Flat media prices under-set (esp. video)
`videoClipCost` = $0.20/clip flat; `imageCost` = $0.04; `ttsCost` = $0.02. Veo (`veo-3.1-lite`) is
slow/paid and per-clip cost is very likely > $0.20 — needs calibration against the real tier. Image
(nano-banana ~$0.039) is close; TTS bills audio-output tokens (flat is a rough proxy).

## Net effect
"$5 shown" ≈ sum of DAG-node char/4 estimates with zero thinking tokens and zero chat/copygen/
rescore/analyze spend. Real spend (thinking tokens + every uncounted surface + true video price)
is easily 10–100× that — consistent with burning the 500K credit.

## Fix plan
**Correctness core (both options):**
- Generalize `costFromUsage(usage, model)` in node-cost.ts: cost from REAL usageMetadata —
  `promptTokenCount` at input rate, `(candidatesTokenCount + thoughtsTokenCount)` at output rate,
  `cachedContentTokenCount` at the cached rate. Keep `estimateLlmCost` only as a fallback.
- Make shared callers RETURN usage: `llm-json.ts callGeminiJson`, `copygen/gemini.ts`,
  `grounded-search.ts` (+ a grounding-request surcharge). Runners cost from real usage.
- Calibrate `videoClipCost` to the real Veo tier; keep image/tts as documented estimates.

**Capture-all surfaces:** requires a per-owner `llm_usage` ledger (one small migration) so chat,
intake, copy-gen, rescore, analyze, AND the DAG all write `{ownerId, model, promptTokens,
outputTokens, thoughtTokens, costUsd, surface, createdAt}` → a TRUE per-customer spend total (the
thing you bill on). Without it, chat/copygen/rescore spend stays invisible even after the token-math
fix.

## Open questions
1. Scope: correctness-only on already-recorded paths (no migration) vs full per-owner `llm_usage`
   ledger capturing every surface (needs migration — but it's what customer billing requires).
2. Real `veo-3.1-lite` per-clip price + nano-banana per-image price to lock the media constants.
3. Should a future customer charge apply a markup multiplier over raw cost, or pass-through (memory
   says transparent passthrough for MVP)?
