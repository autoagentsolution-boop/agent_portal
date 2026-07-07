# QA Audit — Usage/Cost, Impact/ROI, Agent Nodes, Command Center

READ-ONLY static audit. 2026-07-08. Branch pivot/video-content-farm. No source edited, app not run.

---

## Q1 — Usage/cost measurement accuracy → ✅ (with 1 caveat)

**Thinking tokens counted at output rate — YES.**
- `extractGeminiUsage` reads `thoughtsTokenCount` + `cachedContentTokenCount` from real `usageMetadata` — `cost/llm-usage.ts:12-28`.
- `costUsdFromUsage` bills `(outputTokens + thoughtTokens)` at output rate; cached prompt at cached rate; billedInput = prompt−cached — `executor/node-cost.ts:52-60`.
- `totalTokens = prompt + output + thought` — `llm-usage.ts:44`. `costFromUsage` folds thought into output for node display — `node-cost.ts:64-72`.

**Per-owner ledger real — YES.** `recordLlmUsage` → `prisma.llmUsage.create` with ownerId/surface/model/token split/costUsd/runId/refId, best-effort try-catch — `llm-usage.ts:41-65`. `usageTotals` aggregates + per-surface breakdown scoped `where {ownerId}` — `llm-usage.ts:107-150`. GET `/orchestration/usage` → `usageTotals(req.userId)` — `api/orchestration-router.ts:552-554`.

**All real LLM surfaces record** (every physical call site):
- copygen (concept_writer engine, incl. refine + variants) surface `copygen`, refId=post.id — `copygen/service.ts:80,165,209`. NOTE: `concept_writer` runner itself does NOT call recordLlmUsage — correct, no double-count; copy-gen records internally.
- ideation/strategy/campaign_strategist surface `orchestration`, runId+refId — `agent-runners.ts:415,433,475` (callGeminiJson always fires onUsage on a real call — `master/llm-json.ts:51`).
- research surface `research` + `extraCostUsd=GROUNDING_SURCHARGE_USD ($0.035)` — `agent-runners.ts:255-263,42`.
- chat — `conversation-author.ts:154`; intake — `gemini-intake-provider.ts:70`; also product-knowledge analyze + leads llm-score (grep-confirmed record sites).

**Veo/media cost captured — YES.**
- Image: real image tokens via recordLlmUsage(surface infographic/storyboard) when `image.usage` present, else flat `recordMediaCost` — `agent-runners.ts:570-571,645-646`; nano-banana returns real usage — `imagegen/nano-banana.ts:36-93`.
- Video: per-clip `recordMediaCost(videoClipCost(1, durationSec))` Veo @ $0.05/s ×8s ≈$0.40 — `agent-runners.ts:708`, `node-cost.ts:90-95`. TTS flat $0.02 recorded — `agent-runners.ts:726`.

**Caveat (minor undercount):** ledger records only when a real usage object exists. A real call whose envelope omits `usageMetadata` records a **zero-token** row (copygen via `recordGeminiCall(raw)`) or nothing (orchestration, `if (usage)` guard `agent-runners.ts:415`). Rare, but such spend is silently $0. estimateLlmCost fallback drives node display ONLY — never the ledger, so node cost can exceed ledger for that node.

---

## Q2 — Impact report real vs estimated → ⚠ (separation is good; one double-count bug)

**Clearly separated in code & types — GOOD.**
- REAL = `ImpactMetrics` (posts, platforms, mediaPieces, usdSpent, tokens, credits, leads, runMinutes) aggregated straight from ledger/Post/Lead/Run rows — `impact/impact-metrics.ts:1-4,8-18`.
- ESTIMATED = `ValueEstimate` with a literal `estimated: true` marker + `assumptions{}` echoed back, all from env-tunable baselines — `impact/value-model.ts:9-24,43-58`. reach comment "LABELED estimate; real reach needs Insights → v2" (`value-model.ts:16`); savedUsd = max(0, baseline−realSpend).
- `ImpactReport` splits `metrics` (REAL) vs `value` (ESTIMATED, labeled) — `value-model.ts:61-67`. headline explicitly says "**an estimated ~$Y / Z days with an agency**" — `value-model.ts:72-74`. Not presented as fact. ✅

**Which numbers are real:** usdSpent, totalTokens, postsPublished, platforms, mediaPieces, leadsCaptured, runMinutes = MEASURED. baselineUsd, freelancerUsd, savedUsd, savedDays, estimatedReach = ESTIMATE (env constants IMPACT_*).

**⚠ Bug — creditsSpent DOUBLE-COUNTS media rows that recorded real tokens** (see Q5). Not an estimate-vs-fact issue but it inflates the "≈N credits" shown in the REAL metrics block + headline.

**Caveat — leads attribution is fuzzy (honest but soft):** campaign leads matched by `sourceProduct === campaign.product` (no lead↔campaign FK) — `impact-metrics.ts:49-50`. Shared product names cross-attribute. Period-scope leads = clean date window (`impact-metrics.ts:79`). Flagged in-code as "best available link."

---

## Q3 — Agent nodes: runnable vs stub

Runnable registry `AGENTS` = 9 (incl. publisher). Every one has a real runner in `runners{}` — `agent-runners.ts:749-759`. Vision agents (memory/lead_collector/analytics/email) are a SEPARATE display-only list, not in `RunnableAgentId`, no runner — `vision-agents.ts:1-8,20-54`.

| Agent | registry implStatus | Actually runnable? | Evidence |
|---|---|---|---|
| ideation | live | ✅ real LLM | `runIdeation` agent-runners.ts:404-421 |
| strategy | live | ✅ real LLM (+lead-scoring bridge) | `runStrategy` :424-443 |
| content_search | live | ✅ real (Gemini grounded search, degrades safely) | `runResearcher` :235-273 |
| campaign_strategist | live | ✅ real LLM calendar | `runCampaignStrategist` :450-481 |
| concept_writer | live | ✅ real (materializes Post + copy-gen variants) | `runConceptWriter` :191-228 |
| infographic | **stub** ⚠stale | ✅ **LIVE** — real nano-banana image gen + attach | `runInfographic` :551-574 |
| storyboard | **stub** ⚠stale | ✅ **LIVE** — LLM frames + real per-frame image gen | `runStoryboard` :578-668 |
| video | **stub** ⚠stale | ✅ **LIVE** — real Veo i2v + stitch + TTS mux | `runVideo` :679-747 |
| publisher | live | ✅ real (publishPostNow via connector runtime, fail-loud) | `runPublisher` :278-314 |
| memory | (vision) planned | ❌ display-only | vision-agents.ts:21-29 |
| lead_collector | (vision) planned | ❌ NOT a DAG node (but exists as a cron feature elsewhere — UNDERsold) | vision-agents.ts:30-37 |
| analytics | (vision) planned | ❌ display-only | vision-agents.ts:38-45 |
| email | (vision) planned | ❌ display-only | vision-agents.ts:46-53 |

**Key finding:** registry `implStatus:'stub'` on infographic/storyboard/video (`agent-registry.ts:162,178,210`) + the stale header comment "others → schema-valid STUB artifacts" (`agent-runners.ts:5`) are OUT OF DATE — all three are fully live. Direction of error is safe (undersells, never oversells). `AgentImplStatus` type only allows `'live'|'stub'` (`agent-types.ts:22`) yet the /agents route casts to include `'planned'` (`orchestration-router.ts:572`) — type looseness, not a runtime bug.

---

## Q4 — Command Center (final-form home) → ✅ real data, correct funnel

- Renders REAL registry data: GET `/orchestration/agents` returns `AGENT_GROUPS` + `AGENTS` (implStatus live/stub) + `VISION_AGENTS` appended as `implStatus:'planned'` — `orchestration-router.ts:560-588`. Page maps catalog straight to nodes/legend — `command-center-page.tsx:38-121`.
- Credit total = GET `/orchestration/usage` `.credits` (same ledger as Usage page) — `command-center-page.tsx:42`.
- **Launch funnels into live Atria** — `onLaunch` → `launchFromCommandCenter` sets `orchestratePrefill` + `setPage('orchestrate')`; OrchestratePanel `autoStart` auto-sends a non-empty prefill — `App.tsx:86-93,362-373`. Core, nodes, and command bar all route through it — `command-center-page.tsx:86,111,52-55`.
- **Stubs/planned handled honestly:** planned (vision) nodes are non-clickable → `notify("… sắp ra mắt")`, never launch — `command-center-page.tsx:105,111`. Live+stub nodes launch Atria (correct — the "stub" ones are actually live). **No node is shown as runnable that is actually a non-runnable stub** → no upward-misleading demo risk. Only mislabel is cosmetic: 3 live agents wear the dimmed `is-stub` style (`command-center-page.tsx:109`) and lead_collector shows "coming soon" despite the leads feature existing.

---

## Q5 — Measurement/report correctness bugs (wrong numbers in a demo)

**❌ BUG-1 (real, ship-visible): Impact `creditsSpent` double-counts media rows that recorded real tokens.**
- `impact-metrics.ts:24-25` `creditsFor = creditsFromTokens(totalTokens) + creditsFromUsd(mediaUsd)`.
- `totalTokens` = ALL ledger rows (incl. infographic/storyboard rows that recorded REAL image tokens) — `impact-metrics.ts:46,53`.
- `mediaUsd` = `_sum costUsd where surface IN (infographic,storyboard,video)` with **no `totalTokens:0` filter** — `impact-metrics.ts:47,54`.
- ⇒ an image row recorded via `recordLlmUsage` (usage present → tokens>0, surface infographic) is counted BOTH in creditsFromTokens AND creditsFromUsd. Inflates credits.
- Contrast the Usage page which does it correctly: media USD summed only `where totalTokens: 0` — `llm-usage.ts:123-127,136`. **Result: Impact report and Usage page display DIFFERENT credit totals for the same activity** — visible demo inconsistency. usdSpent stays correct (summed once). Fix: filter media agg to `totalTokens: 0` (mirror usageTotals).

**⚠ BUG-2 (soft): leads mis-attribution by product name** — `impact-metrics.ts:49-50`. Two campaigns sharing a product string share leads. Honest/best-effort but can overstate a campaign's leads in a demo with overlapping products.

**⚠ BUG-3 (cosmetic/stale): registry implStatus 'stub'** on live infographic/storyboard/video — `agent-registry.ts:162,178,210` — dims 3 live agents in Command Center. Undersells; not wrong-number.

No error found in: thinking-token pricing, Veo per-second, TTS, grounding surcharge, node-vs-ledger video cost parity (both = rendered×perclip+tts), per-surface tenancy.

---

## Demo-day risks (ranked)

1. **Impact credits ≠ Usage credits** (BUG-1). If you open both screens the numbers won't reconcile → undermines the "transparent" pitch. Only bites when a campaign generated images WITH usageMetadata (the common live path).
2. **Impact headline credits inflated** by the same double-count — the "money shot" line (`value-model.ts:72-74`) shows too many credits (usd is fine).
3. **Live media agents look "coming soon"/dimmed** (BUG-3) — infographic/storyboard/video render as stub-styled; a viewer may think the video pipeline isn't real when it is.
4. **lead_collector shows "sắp ra mắt"** though leads capture exists — undersells a working feature.
5. **Leads over-attribution** on shared product names (BUG-2) — low probability in a scripted demo.

## Tomorrow fix list

- **P0** — Fix Impact credit double-count: add `totalTokens: 0` to the media aggregate in BOTH `metricsForCampaign` and `metricsForPeriod` (mirror `usageTotals`) — `impact/impact-metrics.ts:47,77`. Re-verify Impact.credits == Usage.credits.
- **P1** — Correct stale `implStatus`: set infographic/storyboard/video → `'live'` (they are) — `orchestration/registry/agent-registry.ts:162,178,210`; drop stale "others → STUB" comment `agent-runners.ts:5`. Widen `AgentImplStatus` or keep the route cast consistent — `agent-types.ts:22`.
- **P1** — Decide lead_collector presentation: it exists as a feature; either promote out of "planned" vision list or annotate "available in Leads" — `vision-agents.ts:30-37`.
- **P2** — Record a zero-usage fallback row (or estimate) for real calls missing `usageMetadata` so ledger never silently drops spend — `agent-runners.ts:415,433,475`.
- **P2** — Strengthen lead↔campaign attribution (add a campaign/run FK on Lead) to replace product-name match — `impact-metrics.ts:49-50`.

## Unresolved questions

1. In production, does nano-banana reliably return `usageMetadata`? If yes, BUG-1 fires on nearly every image campaign; if usage is usually absent (flat `recordMediaCost`, tokens=0), BUG-1 is dormant. Determines P0 severity. (Could not run the app to confirm.)
2. Are IMPACT_* env baselines (agency day-rate, hours/post, reach/post) set to defensible values for the demo tenant? Not audited — they drive every estimate.
3. Is the Impact UI component (`web/src/components/impact-report`) visually labeling `value.*` as estimates as strongly as the backend intends? Not read this pass.

---
**Status:** DONE
**Summary:** Cost/usage measurement is solid — real thinking tokens, per-owner ledger, and Veo/media spend are all captured across every surface, and the impact report cleanly separates measured metrics from clearly-labeled estimates. The one real correctness bug is Impact `creditsSpent` double-counting image rows that recorded real tokens (so Impact and Usage show different credit totals — P0), plus a cosmetic stale `implStatus:'stub'` that makes three fully-live media agents look unbuilt in the Command Center, whose registry data and launch-into-Atria funnel are otherwise correct.
