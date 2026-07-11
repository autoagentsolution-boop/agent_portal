# QA/QC — Atria reasoning brain (commit 0b7724a)

Scope: atria-brain.ts, atria-tools.ts, atria-brain-prompt.ts, orchestration-router.ts (POST /runs), orchestration-chat.ts (getChatHistory). Traced callees: report-answer, grounded-search, master-agent, requirement-analyzer, workflow-run-repo, mappers, llm-usage, user-memory-repo. `npx tsc --noEmit` = 0 errors. No code changed.

Verdict: no Critical (auth is clean end-to-end, no injection/RCE, no cross-tenant, no data corruption). Real defects are latency, a multi-turn slot-loss regression, and several degradation-path bugs.

---

## High

### H1 — No overall deadline: one POST /runs can hang for minutes (latency/cost/DoS regression)
atria-brain.ts:79-106. Loop is `MAX_ROUNDS=5`, each `callGemini` has a 60s timeout (:54). Each round can also fire tool calls that are themselves LLM round-trips with their OWN timeouts: `groundedSearch` 60s + `withRetry` (grounded-search.ts:59,72), `propose_workflow`→`requirementAnalyzer.analyze` (another Gemini call), `answerDataQuery` 30s (report-answer.ts:111). Worst case a single request serially chains ~5 brain calls + N tool LLM calls → several minutes on the request thread, with no aggregate cap. The route (asyncHandler) has no timeout.
Impact: replaced an instant regex `classifyIntent` + one `handle` call with an unbounded reasoning loop. A client/proxy will time out (hung "Thinking"), and concurrent users multiply Gemini spend + pin connections. Cost is real money per round.
Fix: add a wall-clock budget (e.g. `Date.now()` deadline ~25-35s) checked each round → break to legacy/best-effort; and/or lower MAX_ROUNDS to 2-3. Consider running the loop detached like the executor and streaming, rather than blocking the POST.

### H2 — Multi-turn slot loss: propose_workflow re-analyzes FRESH, discards the prior goal (refine regression)
atria-tools.ts:115-118 calls `requirementAnalyzer.analyze(goal_description, ownerId, memoryContext)` — the same fresh path as `masterAgent.handle`, NOT `masterAgent.refine`. The old /runs flow, on an existing pre-exec run, called `refine(priorGoal, message)` which deterministically `mergeGoals(prior, delta)` + `applyRemovals` so nothing gathered was lost (master-agent.ts:50-57). Now the prior `GoalSpec` stored on `existingPreExec` is never passed to the analyzer, and `applyOutcomeToRun` (orchestration-router.ts:97-115) OVERWRITES `run.goal` with the fresh outcome.goal.
Impact: gathered product/audience/platforms/angle across turns now survive ONLY if the LLM re-states them all inside `goal_description` every turn. Any omission silently drops a slot — the exact "each turn re-asks everything" failure the deterministic merge was built to prevent. The brain sees chat history so it *often* works, but there is no longer a guarantee.
Fix: when an `existingPreExec` run exists, thread its parsed prior GoalSpec into `propose_workflow` and merge (reuse `refine`/`mergeGoals`) instead of a fresh analyze; or have the router merge outcome.goal onto the prior goal before `applyOutcomeToRun`.

---

## Medium

### M1 — Unguarded `recordGeminiCall` in the loop → a ledger hiccup forces a marketing fallback
atria-brain.ts:83 `await recordGeminiCall(raw, …)` sits inside the loop's try. `recordGeminiCall`→`recordLlmUsage` is a DB write (llm-usage.ts:80) and can throw. A throw is caught by the outer `catch` (:110) → `legacyFallback` → `masterAgent.handle` = a forced marketing GoalSpec extraction, discarding the model's already-computed reply/tool state. A billing write must never convert a conversational turn into a marketing proposal.
Fix: `await recordGeminiCall(...).catch(() => {})` (best-effort, as its own comment elsewhere describes it).

### M2 — Empty-text reply degradation renders "…" and persists a junk turn
atria-brain.ts:81 returns `{kind:'reply', text:''}` whenever `!res.ok` AND there is prior history — including transient 502s (Gemini is noted flaky in project memory). Also :91/:88 path: no `candidates` (safety block / `finishReason:SAFETY` / empty parts) → `textOf([])===''`. The router (orchestration-router.ts:199) does `turn.text?.trim() || '…'` → the user sees "…" and `recordAnswerTurn` (:200) persists it as the agent message + an `answered` run. No retry, no fallback.
Impact: on any transient error mid-conversation the user gets a dead "…" reply and a polluted transcript.
Fix: on empty/`!res.ok` prefer a graceful retry or a localized "I hit a hiccup, try again" and do NOT persist an empty turn; at minimum don't record a `…` message.

### M3 — A side-question mid-setup shadows the in-progress plan run
orchestration-router.ts:198-205: a `reply` turn always creates a NEW run with status `answered`. `getLatestRunWithNodesForChat` orders by `updatedAt desc` (workflow-run-repo.ts:409). So if the user has a `planned`/`awaiting_clarification` run in the chat and asks any general question, the new `answered` run becomes "latest" → the by-chat restore (:575) and the panel lose the flow card, and the next turn's `existing` is the answered run (not in `PRE_EXEC`), so `existingPreExec=null` and the brain re-proposes from scratch (compounds H2).
Fix: don't let a reply-only run displace an active pre-exec run for by-chat restore (filter answered runs, or don't bump/create a competing run), or resurface the pre-exec run when present.

### M4 — Unbounded tool output fed back into contents
atria-tools.ts:99 returns `{summary: text}` from `groundedSearch` with no length cap (save_memory is capped 500 at :111, workspace data is bounded fields). A large grounded answer is echoed into `contents` and resent every subsequent round → token cost growth and larger prompts.
Fix: truncate `summary` (e.g. slice ~2-4k chars) before returning.

---

## Low

### L1 — Search citation labels persisted/displayed unsanitized
atria-tools.ts:98 collects `citations` (web titles/URIs from Gemini grounding = attacker-influenceable external content); router `appendSources` (orchestration-router.ts:231-232) concatenates them into the chat message that is stored and returned. If the frontend renders markdown/links, a crafted result title is a phishing / markdown-injection surface. Low (depends on renderer; content is not executed server-side).
Fix: strip markdown/control chars from labels before display.

### L2 — Degraded paths still force the marketing frame
`legacyFallback` (atria-brain.ts:59-62) runs `masterAgent.handle` = marketing extraction. So no-key, and a FIRST-message transient Gemini error (:81 → legacy), turn a plain "hi" into a marketing proposal — contradicting the "marketing is not the default lens" goal on exactly the paths where the brain is unavailable. Acceptable stopgap; note it.

### L3 — Possible consecutive same-role contents
atria-brain.ts:76 appends the current user message after `historyContents(prior)`. If `prior`'s last entry is a `user` message (e.g. a prior turn that failed to record an agent reply), two `user` roles are adjacent. Gemini tolerates it; cosmetic.

---

## Positive
- Auth is clean: `ownerId` = `req.userId!` threaded end-to-end into every tool (search/data/recall/remember all owner-scoped; `rememberFreeform` dedups per owner). No cross-tenant path.
- `dispatchTool` never throws (:126-128) — a failing tool degrades to `{error}` the model can reason about. Good.
- `save_memory` validates `kind` against a whitelist (:26) and caps content (:111).
- `answered` run's non-GoalSpec goal `{intent:'converse'}` is safe: `toRunDto` passes `run.goal` raw (no parse), `answered` is excluded from `PRE_EXEC`, and the template branch only parses `kind==='template'` — verified no `goalSpec.parse` runs on it.
- Parallel `functionCall` parts handled (:86-100); proposal short-circuit correctly excludes `plan_error` so the model can recover.
- `getChatHistory`, `recallForMessage`, `captureFromGoal`, `buildLeadAwarenessNote`, `logRun` all `.catch`-guarded in the router.

---

## Unresolved questions
1. Is there a client/proxy request timeout in front of POST /runs? If <60s, H1 already breaks turns that use ≥1 tool.
2. Does the frontend render assistant chat messages as markdown/HTML? Decides whether L1 is Low or Medium.
3. Intended behavior when the user interleaves a question during flow setup (M3) — should the flow card persist? Confirms severity.
4. `finishReason:MAX_TOKENS` with a truncated `functionCall` — `str()` coerces args, but is a partial `goal_description` acceptable, or should such a round be retried?
