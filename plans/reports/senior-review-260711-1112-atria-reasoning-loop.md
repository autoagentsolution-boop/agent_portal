# Senior Review — Atria reasoning brain (commit 0b7724a)

Scope: maintainability + operability review of the LLM reasoning loop that replaced
regex `classifyIntent` + immediate marketing extraction on `POST /orchestration/runs`.
Method: read all 5 files + traced callees (master-agent, requirement-analyzer,
orchestration-chat, workflow-run-repo, mappers), `tsc --noEmit` (EXIT 0), grep for refs.
No code changed.

Verdict: sound design, compiles, backward-compat is OK. But the multi-turn accumulation
guarantee was silently traded from deterministic → LLM-faith, and the request path now
has no wall-clock budget or reasoning-trace logging. Two fix-now items below.

---

## P0 — Multi-turn slot accumulation is no longer guaranteed (regression)

**Where:** `atria-tools.ts:116` (`requirementAnalyzer.analyze(goal_description,…)` — the
*fresh, no-prior* variant) vs the retired `masterAgent.refine` (`master-agent.ts:50-57`,
`analyzeWithRemovals(message, prior)` → `mergeGoals(prior, delta)`).

**Risk:** The old path read the run's stored `GoalSpec` as source of truth and
*additively merged* each turn's delta (`goal-merge.ts`), so a slot gathered on turn 1
(product) could never be lost by a terse turn-3 reply ("on Facebook"). The new path calls
`analyze()` **fresh every turn** with only the model-authored `goal_description`. There is
no `mergeGoals`, no `prior` context into the analyzer, and no deterministic safety net.
Whether "make a video" → "about GreenLeaf" → "on Facebook" preserves all three slots now
depends **entirely on the brain restating every earlier slot** inside `goal_description`.
Two concrete leak paths:
1. **History window truncation:** `atria-brain.ts:41-42` feeds only `prior.slice(-8)` (4
   user + 4 agent turns) — even though `getChatHistory` fetched 20 (`orchestration-chat.ts:36`).
   A product named >8 turns back (long clarification) is outside the brain's context and
   cannot be echoed into `goal_description`. Old `mergeGoals` had no such horizon.
2. **In-place overwrite:** on `existingPreExec`, `applyOutcomeToRun` (`orchestration-router.ts:103-107`)
   calls `replanRun(runId, …, goal, …)` — it **replaces** `run.goal` with the freshly
   analyzed goal. Any slot the brain omitted this turn is now gone from the run; there is no
   union with the previous `run.goal`.

`memoryContext` does **not** backstop this: `ctx.memoryContext` is `recallForMessage(userId,
body.message)` for the *current* message only (`orchestration-router.ts:189`), so on "on
Facebook" it recalls nothing about GreenLeaf.

**Recommendation (fix now):** either (a) in `propose_workflow`, when an `existingPreExec`/prior
goal exists, run `analyzeWithRemovals(desc, priorGoal)` + `mergeGoals` instead of fresh
`analyze` (restore the additive guarantee), or (b) at minimum raise the brain's history slice
to match the 20 fetched and add a prompt directive "always restate every known slot in
goal_description." (a) is the real fix; (b) is a mitigation. e2e verify only tested single-turn
proposals, so this regression is unproven by the commit's own testing.

## P0 — No wall-clock budget on the turn; worst-case multi-minute hang

**Where:** `atria-brain.ts:29,54,79-80` — `MAX_ROUNDS=5`, each `callGemini` has its own
`AbortSignal.timeout(60_000)`, and tools called inside a round add their *own* 60s LLM calls
(`grounded-search`, `requirement-analyzer.analyze`).

**Risk:** There is no aggregate deadline. `POST /runs` `await`s `runAtriaBrain` synchronously
(`orchestration-router.ts:194`). Worst case ≈ 5 rounds × (60s brain + 60s nested tool) ≈ **up
to ~10 min** on one HTTP request before it even reaches `recordTurn` (which fires *another*
Gemini author call + optional `readWorkspaceReport`). Old `classifyIntent` was instant regex.
Typical proposal turn is ~2–3 sequential Gemini calls (brain round → analyze → author), which
is already a real latency step-up the UI's optimistic "Thinking…" must cover. A stuck round
holds the connection with no user feedback.

**Recommendation (fix now, small):** wrap the loop in an overall deadline (e.g. `Date.now()`
budget ~90–120s checked each round; on exceed → return best proposal-so-far or a graceful
"still thinking, try again" reply). Cheap insurance against a pathological loop pinning a
request thread.

## P1 — Interleaved conversational reply orphans the flow card (duplicate runs)

**Where:** `orchestration-router.ts:198-205` (reply → new `answered` run) +
`getLatestRunWithNodesForChat` ordering `updatedAt desc` (`workflow-run-repo.ts:409`) +
`PRE_EXEC` set (`:127`, excludes `answered`).

**Risk:** The design assumes the flow card "evolves on ONE run." But `answered` ∉ `PRE_EXEC`.
Sequence: turn A proposes → `awaiting_clarification` run (pre-exec). Turn B the user asks a
side question → brain replies → a **new `answered` run**, now the newest by `updatedAt`. Turn C
"on Facebook" → `existing` = the answered run → `existingPreExec = null` → `persistOutcome`
creates **another** run; the original clarification card is orphaned. Result: two flow runs for
one setup, and the accumulated goal on the first is abandoned. The old always-refine model never
forked like this. Any conversational aside mid-setup triggers it.

**Recommendation (tech-debt / fix soon):** when resolving `existing`, prefer the latest
*non-answered* run for the chat (or skip `answered` runs), so a pre-exec flow card stays the
refinement target across interleaved chatter.

## P1 — Failure surfaces to the user are poor

**Where:** `atria-brain.ts:81` and `:110-111`.

- `:81` on `!res.ok` **with prior history** returns `{ kind:'reply', text:'' }` → router
  renders `appendSources('' || '…')` = a bare **"…"** message (`orchestration-router.ts:199`).
  A Gemini 5xx mid-conversation shows the user an empty dot with no error, no retry hint.
- `:81` on the **first** turn (no prior) and `:110-111` `catch` → `legacyFallback` = the
  deterministic **marketing planner**. So *any* brain error on a general/greeting message
  ("explain quantum tunneling") degrades to a **marketing workflow proposal** — the exact
  framing this commit set out to remove. Bounded, but a confusing surprise.

**Recommendation (fix soon):** replace the empty-string reply with a localized graceful
"I hit a snag, try again" and reconsider defaulting the catch to a marketing proposal for
conversational turns (a plain apology reply is safer than a spurious flow card).

## P1 — Effectively no observability for a bad turn

**Where:** only `logRun('info','atria_reply',{searched})` on the reply path
(`orchestration-router.ts:202`). Proposal path logs nothing brain-specific.

**Risk:** You cannot reconstruct a bad turn from logs. Nothing records: which tools were
called and with what args, how many rounds ran, whether `legacyFallback` fired (key missing vs
error vs round-exhaustion), or tool errors — `dispatchTool` swallows every throw into an
`{error}` returned to the model (`atria-tools.ts:126-128`) and never logs it. `recordGeminiCall`
ledgers cost but not the reasoning trace. Debugging "why did Atria propose marketing for a
greeting / lose the product / hang" is guesswork.

**Recommendation (fix soon, cheap):** log one structured line per turn — `rounds`, `tools`
(names), `fallback` reason, terminal `kind`. Log tool errors at `warn`.

## P2 — Gemini fetch/endpoint/extract boilerplate is now duplicated ~14×

**Where:** `atria-brain.ts:30-55` adds another hand-rolled `endpoint()/fetch/partsOf/textOf`.
Grep for the endpoint literal hits **13 files** already (`gemini-intake-provider`, `grounded-search`,
`copygen/gemini`, `nano-banana`, `conversation-author`, `llm-json`, `report-answer`,
`requirement-analyzer`, `save-offer-author`, `analyze-documents`, `video/tts`, `video/veo`, +
this). Every copy re-implements URL building, the 60s timeout, and candidate-parts extraction.

**Risk:** Pre-existing systemic debt this commit extends, not a new sin. But it means model
name, timeout, retry/backoff, and safety-setting policy can never be changed in one place — e.g.
the known intermittent Gemini 502s (noted in memory) have no shared retry; each seam handles
`!res.ok` differently (some fallback, some throw, the brain returns "").

**Recommendation (tech-debt later):** extract a tiny `geminiGenerateContent(model, body)` +
`extractParts` helper. Out of scope for this commit; worth a follow-up ticket.

---

## Backward-compat (checked — OK)

- **`answered` goal shape** changed to `{intent:'converse', message}`. This mirrors the
  pre-existing `{intent:'data-query',…}` shape (git diff confirms the old data-query path
  already wrote a non-`GoalSpec` goal). `toRunDto` passes `goal: run.goal` **raw** — no
  `goalSpec.parse` — so no crash (`orchestration-mappers.ts:46`). No frontend consumer reads
  `goal.intent` / `goal.slots` on answered runs; grep of `MKTAgent/web/src` found no `answered`
  status handling. **No breakage.**
- Endpoints that `goalSpec.parse(run.goal)` (`/execute`, `/clarify`, `/approve-node`, tiers)
  are all guarded by status checks that an `answered` run can never satisfy → the malformed
  parse is unreachable. Safe.
- **Dead code:** `intent-router.ts` `classifyIntent` / `MessageIntent` now has **zero
  production references** (only its own file, a brain comment, and the plan). The plan itself
  says safe to delete. `report-answer.ts` `answerDataQuery` is **still used** — via the
  `get_workspace_data` tool. `groundedSearch`, `recallForMessage`, `rememberFreeform` all still
  wired. `masterAgent.refine` is now **unused from the router** but still a public method (only
  self-tested/unreferenced) — dead-ish; keep if you adopt the P0(a) fix, else delete.

## Config / deploy (checked)

- Env deps: `GEMINI_API_KEY` (default `''`) and `GEMINI_MODEL` (default `gemini-2.5-flash`,
  `env.ts:66,69`). Flash supports function-calling, so the loop works on the default.
- **No-key path:** `runAtriaBrain` → `legacyFallback` → `masterAgent.handle` = deterministic
  marketing planner. So a deployment without a key **loses the general-assistant behavior
  entirely** and forces every message into a marketing proposal. Acceptable degradation, but
  it's a silent behavior divergence between keyed/unkeyed environments worth documenting.
- `recallForMessage` does **not** hit Gemini (no fetch in `user-memory.ts`), so it adds no LLM
  latency — good.

---

## Unresolved questions

1. Is the P0 multi-turn leak acceptable for the demo timeframe, or should P0(a) (restore
   `mergeGoals` inside `propose_workflow` when a prior goal exists) land now? It's the single
   biggest behavior regression and is untested by the commit.
2. Intended UX when the brain proposes `awaiting_clarification`: does the frontend surface the
   structured AskUserQuestion card (answered via `/clarify` → `mergeAnswers`), the brain's
   conversational question, or both? The two clarification mechanisms now coexist and can write
   `run.goal` from different sources on alternating turns.
3. Should tool-round Gemini calls share the brain's cost/latency budget and a single retry
   policy for the known 502s, or stay independent per-seam?

---
**Status:** DONE_WITH_CONCERNS
**Summary:** Loop compiles, backward-compat verified safe, dead code confirmed. Two fix-now
issues: (P0) multi-turn slot accumulation lost its deterministic guarantee — now LLM-faith with
an 8-turn horizon and in-place goal overwrite, unproven by the commit's single-turn e2e; (P0) no
aggregate wall-clock budget → up-to-minutes synchronous hang. Plus poor failure UX ("…"/spurious
marketing fallback), near-zero reasoning-trace logging, an orphaned-flow-card duplication path,
and systemic Gemini-boilerplate duplication (now ~14 copies).
**Concerns/Blockers:** P0 accumulation regression should be decided before broad multi-turn use.
