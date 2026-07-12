# Phase 06 — Per-agent-group thinking-budget policy

**Priority:** P1 · **Status:** ✅ IMPLEMENTED (verified) · **Branch:** `pivot/video-content-farm`
**Brain baseline already SHIPPED** (`b5c4f9c`): `atria-brain.ts` `doCall` sets `thinkingConfig.thinkingBudget: 4096`.

## Implementation notes (as-built)
Landed exactly per the mechanism below, with two deliberate deferrals:
- **`concept_writer` budget is DORMANT (copygen stays `thinkingBudget: 0`).** `thinkingBudgetFor('concept_writer')` returns the creative ceiling, but concept_writer's LLM call goes through copygen's own body builder (`copygen/prompt.ts`), which HARD-DISABLES thinking (`thinkingBudget: 0`) — a hard-won fix: gemini-2.5 thinking tokens count against `maxOutputTokens` and truncated the copy JSON ("Unterminated string"). The executor binds budgets onto the `llmJsonFn` seam only, so concept_writer never reads a budget → the fix is preserved. Threading a creative budget into copygen requires ALSO raising `maxOutputTokens` headroom + re-validating no truncation; deferred (one-line change later). Net: the creative tier meaningfully applies to **`email_writer`** (llm-json seam, no `responseSchema`/output cap → thinking is safe).
- **`memory`/`analytics` LLM seams are OUTSIDE the runner map** → not covered by the executor binding; left at Gemini defaults for now (plan already deferred their dynamic dataset-size growth). Follow-up if their calls need an explicit budget.

**As-built files:** `thinking-budget.ts` (new policy), `goal-spec.ts` (`qualityPref`), `llm-json.ts` (`opts.thinkingBudget`), `agent-executor.ts` (per-node bind), `atria-brain.ts` (reads `BRAIN_THINKING_BUDGET`), `deterministic-analyzer.ts` + `requirement-analyzer.ts` (conversational `qualityPref` keyword detection). **Verify:** `verify-thinking-budget.ts` (25 checks incl. e2e wire proof + DRY-RUN pass-through); golden 23/23; summarize regression green.

## Why
`gemini-2.5-flash` default (dynamic) thinking misbehaves **with tools** → intermittently returns `finishReason=STOP` with EMPTY parts (the brain read it as failure → spurious apology). Fix = an EXPLICIT budget. Measured: default→empty every time; explicit 512/2048/4096→clean every time WITH real thinking (th≈43-61 on easy turns). **Budget is a CEILING — the model self-limits below it**, so a generous ceiling is ~free on easy turns and only spends on hard ones. Runners do NOT attach tools, so they don't hit the empty-bug — their budget is purely a quality/cost lever.

## Locked decisions (user, 2026-07-12)
| Tier | Nodes | Budget (ceiling) | Signal |
|---|---|---|---|
| **Reasoning** | Brain, `ideation`, `strategy`, `content_search`, `campaign_strategist` | 4096 → 8192 | fixed generous (finetune later) |
| **Creative** | `concept_writer`, `email_writer`, media (`infographic`/`storyboard`/`video`) | 2048 → 8192 | **user-stated quality, elicited CONVERSATIONALLY** (decision A) — Atria asks/captures "how much quality"; NOT plan-tiers |
| **Doc-scaled** | `summarize` | 2048 → 8192 | `goal.slots.sourceText` length |
| **Action (low)** | `publisher`, `email_agent`, `scheduler` | 0 | none (barely touch text LLM) |
| **Store (usage-growth)** | `memory`, `analytics` | **4096 now** | dataset-size later (trackable/updatable) — DEFERRED |

Groups (`registry/agent-groups.ts`): 🧠 intelligence · ⚡ action · 🤝 assistant (brain + memory).
Media nodes call image/video APIs (no `thinkingBudget` knob) → creative budget effectively applies to `concept_writer` (copy) + `email_writer`.

## Implementation (the clean mechanism)
1. **`src/orchestration/thinking-budget.ts`** (new): `thinkingBudgetFor(agentId: string, ctx?: {goal?}): number`.
   - static per-tier map (values above); `BRAIN_THINKING_BUDGET = 4096`.
   - dynamic: `summarize` → `clamp(2048 + floor(sourceText.length/500)*512, 2048, 8192)`.
   - dynamic: creative → by `goal.qualityPref` (`'standard'`→4096, `'high'`→8192, `'economy'`→2048).
   - keep ALL numbers in this ONE file so tuning is one edit.
2. **`schemas/goal-spec.ts`**: add `qualityPref: z.enum(['economy','standard','high']).default('standard')`. Nullish-safe, additive (golden unaffected — planner ignores it).
3. **Brain sets `qualityPref` conversationally (decision A):** simplest = keyword detection in `requirement-analyzer.ts` ("chất lượng cao"/"high quality"/"best"/"chi tiết" → 'high'; "nhanh"/"tiết kiệm" → 'economy'). Optionally a brain tool later. Brain itself reads `BRAIN_THINKING_BUDGET` from the config (replace the inline 4096).
4. **`master/llm-json.ts`**: `callGeminiJson(prompt, input, onUsage?, opts?: {thinkingBudget?: number})` → add `thinkingConfig: { thinkingBudget: opts.thinkingBudget }` to `generationConfig` when provided.
5. **Executor binds per-node budget with ZERO per-runner edits** (the elegant trick): in `executor/workflow-executor.ts`, where it builds `RunnerContext` and calls the runner, if `ctx.llmJsonFn` is unset (i.e. NOT a DRY-RUN stub), set `ctx.llmJsonFn = (p,i,cb) => callGeminiJson(p,i,cb,{thinkingBudget: thinkingBudgetFor(agentId, ctx)})`. All `ctx.llmJsonFn ?? callGeminiJson` runners (ideation/strategy/campaign_strategist/email_writer/summarize) inherit their budget automatically.
6. **concept_writer** goes through copy-gen's own Gemini seam (`ctx.geminiFn`, `copygen/`), NOT llm-json → thread `thinkingBudget` into that seam separately (or bind `ctx.geminiFn` in the executor the same way).
7. **memory/analytics** LLM seams (user-memory style analysis; analytics insight) are OUTSIDE the runner map → set their Gemini calls to 4096 where they live. If not quickly locatable, note as follow-up (dynamic growth is already deferred).

## Verify
- Unit: `verify-thinking-budget.ts` — `thinkingBudgetFor` returns expected per tier + dynamic (summarize by length, creative by qualityPref).
- `callGeminiJson` includes `thinkingConfig` when budget passed (assert on a request-body spy, or a thin unit).
- Regression: golden 23/23 (planner untouched); `verify-summarize-node` + a brain e2e still green.
- Smoke: a real summarize/reasoning run still completes.

## Gotchas
- Budget is a CEILING (self-limited) — don't expect exact spend = budget.
- The empty-bug is tools+dynamic ONLY; runners (no tools) are safe at any budget.
- `qualityPref` must be nullish-safe in the persisted `wf_run.goal` (old rows lack it → default).
- Keep marketing golden untouched: `qualityPref`/budget never change node SELECTION, only per-node LLM config.

## Deferred (explicitly)
- memory/analytics DYNAMIC growth by dataset size + a user-facing check/update surface (default 4096 for now).
- Richer conversational quality UX (a dedicated brain tool / confirmation) beyond keyword detection.
