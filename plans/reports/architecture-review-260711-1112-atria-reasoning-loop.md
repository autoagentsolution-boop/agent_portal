# Architecture Review — Atria Reasoning Brain (commit 0b7724a)

**Scope:** design/pattern/coupling/seams/extensibility of the new reasoning-loop-as-front-controller. Not line-level bugs.
**Verdict:** The pattern is right and the seam is 80% clean. The remaining 20% — the *proposal channel* — quietly re-couples the "general" brain back to the marketing domain model it was meant to transcend. That coupling is the through-line of every risk below.

---

## What's sound (keep)

- **Loop-as-front-controller is the correct pattern for the north star.** Default path = `reply`; orchestration is one tool the model elects. That inverts the old regex-router (marketing-first) into general-first. This directly delivers P1a.
- **Tools wrap existing code, add no new engines** (DRY/KISS): `web_search`→groundedSearch, `get_workspace_data`→answerDataQuery, memory→user-memory, `propose_workflow`→analyzer+planner. `dispatchTool` never throws (returns `{error}` the model can reason over) — good agentic hygiene.
- **Clean module split:** `atria-brain` (loop), `atria-tools` (menu+dispatch), `atria-brain-prompt` (behavior). Behavior lives in the prompt, not code branches — exactly what a general assistant needs. These three files are well-factored and single-responsibility.
- **Registry + edge-derivation is genuinely extensible** for *nodes*: `requires`/`produces` matching derives DAG edges with no hardcoded flow. email_writer/email_agent dropped in via this. This is the strong part of the codebase and P1b's foundation.
- **Graceful degradation exists** (no key / loop failure → legacy planner) so a turn always lands.

---

## Top architectural risks (ranked)

### R1 — The proposal channel IS the marketing model. `AtriaTurn.proposal` returns `MasterAgentOutcome` (change-now-ish; blocks P1b)
The brain's only *structured* output is `{ kind:'proposal'; outcome: MasterAgentOutcome }`. `MasterAgentOutcome` carries a `GoalSpec` whose type literal is `goal: 'marketing_content'`, whose `outputs` are marketing flags (needsInfographic, needsStoryboard, needsPublishing…) and whose `slots` are marketing slots (product, targetAudience, brandVoice, platforms). So the general brain's one non-conversational verdict is *marketing-shaped by type*. `propose_workflow` → `requirementAnalyzer.analyze` (a marketing intake prompt) → `masterAgent.planFromGoal` (marketing planner). **Every "create/run something" is modeled as a marketing campaign.** Evidence this is already straining: email had to be smuggled in as a `needsEmail` flag + a `parseEmailIntent` regex *inside the marketing analyzer*; research is a `needsResearch` marketing flag. This is the "boxed to marketing" symptom the vision names, now one layer deeper (in the brain's return contract) rather than removed.

### R2 — `selectAgents()` is an imperative marketing if-ladder, not data-driven (blocks P1b's "drop a node in and it composes")
P1b's goal: a future `translate`/`summarize`/`doc-analyzer` node drops into the registry + a runner and composes with **no special-casing**. Today that is false. Edge *derivation* is data-driven, but agent *selection* (`workflow-planner.selectAgents`) is a hardcoded ladder branching on marketing `outputFlags` + `campaignScope`. A new capability needs: (a) a new `needsX` flag in the `GoalSpec` schema, (b) a new branch in `selectAgents`, (c) usually a new regex intent in the analyzer, (d) a runner. Three of those four are marketing-framework edits. So a non-marketing node cannot compose without touching the marketing GoalSpec + planner.

### R3 — Two competing "working memory" models now coexist and can disagree (change-now decision; P1a/P1b)
The system already had structured conversational memory: pre-exec runs accumulate state via `mergeGoals`/`applyRemovals`/`analyzeWithRemovals` (the refine path). The brain introduces a *second* model: reconstruct from chat history each turn, and `propose_workflow` calls `requirementAnalyzer.analyze` **fresh** (not `refine`/`analyzeWithRemovals`). Yet the router still routes a brain proposal on an existing chat through `applyOutcomeToRun`, which **replaces** the run's goal with the freshly-analyzed one. Net: on a multi-turn refinement, accumulation now lives in the brain's NL `goal_description` (reconstructed from ≤8 history turns) and the structured `mergeGoals` machinery is bypassed on the brain path — while still active on the clarify path. Two accumulators, one run. They will diverge (e.g. a slot gathered by an earlier clarify turn that the brain's NL summary omits gets dropped on the next proposal). Working memory needs ONE home.

### R4 — The reasoning loop entrenches Gemini's tool-calling wire shape deeply (acceptable for v1; revisit at P2)
This is now the 5th near-duplicate Gemini fetch seam (brain, analyzer, report-answer, grounded-search, plus llm-json). The other four are one-shot `generateContent`; the brain is a **stateful multi-turn tool loop**, which is the hardest to port. Gemini specifics baked into the loop body: `tools:[{functionDeclarations}]`, reading `parts[].functionCall`, echoing `{role:'model', parts:[{functionCall}]}`, appending `{role:'user', parts:[{functionResponse:{name,response:{result}}}]}`. Claude (`tool_use`/`tool_result` content blocks) and OpenAI (`tool_calls`/`role:'tool'`) differ in schema, role names, and result envelope — so it's not just the fetch that's coupled, it's the loop protocol. The *most portable* piece is `TOOL_DECLARATIONS` (already a provider-neutral JSON-schema-ish shape). P2 is explicitly deferred, so this is "note for P2," but flag: the loop is the single most provider-entrenched code in the app.

### R5 — Turn-controller logic leaks into the HTTP router (change-now-ish; single-responsibility)
`POST /runs` is ~100 lines doing: template/campaign-intent short-circuit, memory recall, history fetch, brain invocation, reply-vs-proposal branching, four run-persistence policies (answered / planned / clarification / in-place-vs-fresh), lead-awareness, capture. The brain decides *intent*; the router decides *run-creation policy* — which is orchestration, not HTTP. Also the pre-existing template/campaign-intent branch runs **before** and **bypasses** the brain entirely (a message on a saved template never reaches Atria), an awkward pre-brain special-case now sitting in front of the general controller.

### R6 — Degrade-to-marketing re-frames the turn (design smell; low sev)
`legacyFallback` (any loop failure / no key) returns a **marketing proposal**. A transient Gemini blip on "hello" degrades into a marketing plan card — the exact wrong frame for the general-first promise. The general default should degrade to a *conversational* fallback, not a marketing DAG.

### R7 — `goal` column is now polymorphic and unvalidated (minor; data-honesty)
The `answered` run stores `goal: { intent:'converse', message }`, which is not a `GoalSpec` (schema requires `goal:'marketing_content'`, outputs, slots). `createRun.goal` is typed `object` (Prisma Json) and `toRunDto` passes it through unparsed, so nothing breaks — but the column silently became a union of "marketing GoalSpec" and "converse envelope." Any consumer that `goalSpec.parse(run.goal)`s an answered run will throw.

---

## Recommendations, tied to the goals

### Change now (cheap, unblocks P1b, low risk)
1. **Decouple the proposal contract from marketing (R1).** Make `AtriaTurn.proposal` carry a capability-neutral shape — minimally `{ kind:'proposal'; runId-inputs… }` or a small `CapabilityProposal` union — rather than `MasterAgentOutcome`. Even if marketing is the only capability today, the *type* should not name it. This is the single highest-leverage change: it turns "add a capability" from "extend the marketing model" into "add a proposal variant."
2. **Pick one working-memory home (R3).** For general-first, make **chat history + user-memory** the accumulator and treat `GoalSpec` as a *derived* artifact of a proposal (re-derived each proposal from history). Then either retire the `mergeGoals`/refine path on the brain route or make the brain call `refine` instead of `analyze` when a pre-exec goal exists — but not both silently. Document which wins.
3. **Fix degrade-to-conversation (R6):** loop failure with prior history should return an empty-but-conversational reply path, not a marketing proposal.

### Acceptable for v1, revisit at P1b
4. **Make `selectAgents` data-driven (R2).** Replace the marketing if-ladder with capability→required-artifact selection (the planner already derives edges from `produces`/`requires`; extend that so a goal names *target artifacts* and the planner back-chains the node set). This is the concrete unblock for "drop translate/summarize into the registry and it composes." Until then, document that a new node still requires a GoalSpec flag + a selectAgents branch.
5. **Extract a `handleTurn` application service (R5):** recall → brain → persist → DTO, called by the router. Move the template/campaign-intent branch either into the brain (as tools) or behind that service, so the router is thin and Atria is the sole turn controller.

### Note for P2 (do not build now)
6. **Provider abstraction (R4):** when P2 lands, introduce a `LlmClient` with a normalized `{ text, toolCalls[] }` result and a `appendToolResults()` primitive; keep `TOOL_DECLARATIONS` as the portable ToolSpec and add per-provider adapters mapping schema + message roles. Consolidating the 5 duplicate `endpoint()`/fetch/timeout helpers into that client is the DRY win. The multi-turn loop in `atria-brain` is where the abstraction must be cleanest.

### Minor
7. **R7:** give converse runs a typed envelope (or a nullable/loosened goal union) so no consumer `goalSpec.parse`s an answered run.

---

## Unresolved questions
1. On a pre-exec chat, does a brain proposal intentionally **replace** accumulated goal state, or is losing earlier clarify-gathered slots a latent bug? (R3 — needs a product decision, not just code.)
2. Should the template/campaign-intent short-circuit become Atria tools (so the brain owns *all* turns) or stay a router pre-filter? Current split means saved-flow chats silently never reach the general brain.
3. Is `MasterAgentOutcome` intended as the permanent proposal contract, or a v1 placeholder? The answer determines whether R1 is "change now" or "already planned."
4. Multi-tool-per-round: the loop dispatches all `functionCall` parts in a round and can set `ctx.proposal` mid-round then short-circuit — is a proposal racing a same-round `save_memory`/`web_search` acceptable, or should `propose_workflow` be terminal-only?
