# P1b — Agent-node decoupling (general nodes, drop-in composition)

**Branch:** `pivot/video-content-farm` · **Started:** 2026-07-11 · Builds on the reasoning-brain (P1a, commits `0b7724a`+`c4d738d`).

## Goal
Any agent node — present OR future (translate, summarize, doc-analyzer, gmail-classifier) — should run **standalone OR composed** and **drop into the registry + a runner with no special-casing**. Kill the "everything is boxed to marketing" symptom at the node/planner layer. This is the paired half of P1a (general-first brain); together they make Atria genuinely general.

## What's already good (don't touch)
- **Edge derivation is data-driven** (`workflow-planner.deriveDeps`): links each agent's `requires`/`optional` to the latest upstream `produces`. Adding a node with correct produces/requires composes edges automatically. ✅

## The 3 couplings to remove (from the architecture review, commit-review 260711)
### C1 — `selectAgents()` is a hardcoded marketing if-ladder (`workflow-planner.ts:19-59`)
Selection is keyed on marketing-shaped flags (`outputs.needsIdeation/needsStrategy/needsTextPost/needsInfographic/needsStoryboard/needsVideo/needsPublishing/needsEmail/needsResearch`) with special cases (campaign→calendar stop, publish-only guard, media-only concept_writer inclusion, storyboard→video coupling). A new node needs a new flag + a new ladder branch.
- **Target:** backward-chaining selection from requested **terminal output artifact types**. "I want artifact X → which registry agent `produces` X → recurse on its `requires` → minimal agent set." Registry already declares produces/requires; make selection consume them instead of an if-ladder.
- **Preserve exactly:** every current marketing plan must be byte-identical (campaign stop-at-calendar, publish guard, gates). Regression bar = re-run planner on a matrix of representative goals and diff node lists.

### C2 — proposal contract is marketing-shaped by TYPE (`AtriaTurn.proposal = MasterAgentOutcome`)
The brain's only structured verdict is a marketing `GoalSpec`/`WorkflowPlan`. Email/research were smuggled in as `needsEmail`/`needsResearch` flags — the boxing, one layer deeper. (User decision 2026-07-11: MasterAgentOutcome is a **v1 placeholder**, decouple here.)
- **Target:** a general `WorkflowProposal { goalSummary, nodes[], gates[] }` the brain returns, independent of the marketing GoalSpec. The marketing planner becomes ONE producer of a proposal; a future "doc-analyze→summarize→email" proposal is another. Router/DTO/flow-card consume the general shape.
- **Risk:** run/DTO/frontend/`recordTurn`/conversation-author all currently assume `MasterAgentOutcome`. This is the widest blast radius — phase it behind an adapter first (wrap MasterAgentOutcome→WorkflowProposal) so nothing downstream breaks, THEN add a non-marketing producer.

### C3 — GoalSpec is marketing-only; the analyzer regex maps to marketing slots
A non-marketing goal ("translate this doc", "summarize these 3 URLs") has nowhere to live in GoalSpec.
- **Target:** either a general `TaskSpec` alongside GoalSpec, or a capability-tagged goal. Likely couples with C2. Defer detail until C1/C2 shape is settled.

## Phases (proposed — get user greenlight before core changes)
- [x] **P1b.0 — golden-master test** `src/orchestration/verify-planner-golden.ts` (+ `planner-golden-snapshot.json`): 15 cases across every selectAgents branch (single/multi/no-publish post, ideation+strategy, research, media-only, video chain, storyboard-only, full-stack, campaign×2, spotlight, email, publish-only edge). Captures node lists + derived deps + gates. `--update` to re-baseline; exits 1 on any diff. Baseline captured + PASS. **The safety net for C1** — run before/after the refactor, any diff must be explained.
- [ ] **P1b.1 — C1 backward-chaining selection** behind the golden master (must diff-clean on all marketing goals). Add ONE non-marketing node (e.g. `summarize`) + runner to prove drop-in composition.
- [ ] **P1b.2 — C2 general WorkflowProposal + adapter** (wrap MasterAgentOutcome first, no downstream break), then route a non-marketing proposal end-to-end.
- [ ] **P1b.3 — C3 TaskSpec/general goal** for non-marketing intents; brain's propose_workflow can target it.
- [ ] **P1b.4 — verify:** all existing flows unchanged (golden master + e2e), plus a NEW non-marketing capability works alone and composed.

## Why not coded in this session
The reasoning brain + P0/P1 hardening was just verified live and pushed (`c4d738d`). `selectAgents`/proposal-contract are on the critical path of EVERY flow; a blind unsupervised rewrite + push would risk that freshly-verified system. C1 needs the golden-master net first; C2 needs an adapter to avoid a wide breakage. Recommend greenlighting P1b.0 (golden master) → P1b.1 as the first supervised step.

## Open questions (user)
1. C2: introduce `WorkflowProposal` as the permanent contract now, or keep the MasterAgentOutcome adapter until a 2nd non-marketing producer exists (YAGNI)?
2. First non-marketing node to prove drop-in — `summarize`, `translate`, or `doc-analyze`?
3. Is provider-abstraction (P2, `LlmClient`) wanted before or after P1b? (5+ duplicated Gemini seams; brain entrenches function-call wire shape.)
