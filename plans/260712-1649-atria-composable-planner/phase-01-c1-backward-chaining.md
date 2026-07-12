# Phase 01 — C1: Backward-chaining agent selection

**Priority:** P0 (unblocks everything) · **Status:** planned · **Gated by:** golden-master

## Context links
- `MKTAgent/src/orchestration/master/workflow-planner.ts` (`selectAgents` :19-59, `deriveDeps` :63-82, `planWorkflow` :88+)
- `MKTAgent/src/orchestration/registry/agent-registry.ts` (`produces`/`requires`/`optional`/`gate` per node)
- `MKTAgent/src/orchestration/verify-planner-golden.ts` + `planner-golden-snapshot.json` (15-case net)
- `MKTAgent/src/orchestration/schemas/goal-spec.ts` (`GoalSpec.outputs.*` flags)

## Overview
Replace the marketing if-ladder in `selectAgents()` with a registry-driven backward-chaining selector: **requested terminal artifact type → the node that `produces` it → recurse on its `requires` → minimal node set**. Edge derivation (`deriveDeps`) already consumes `produces`/`requires` and is UNCHANGED.

## Key insight
The registry is already a complete producer/consumer graph. Selection is the only hardcoded, marketing-shaped layer. Making selection consume the same graph the edges already use collapses the coupling — and makes the birthday `{email_writer→scheduler→email_agent}` chain an ordinary artifact chain, not a special `if (needsEmail)` branch.

## Architecture
1. **`targetsFromGoal(goal): ArtifactType[]`** — the terminal outputs a goal requests. For marketing goals, a thin shim maps existing `outputs.*` flags → artifact types, so the golden snapshot stays byte-identical:
   - `needsPublishing` → `publish_result`
   - `needsEmail` → `email_result`
   - `campaignScope !== 'single'` → `content_calendar` (terminal; stops here — see below)
   - `needsVideo` → `video_prompt`; `needsInfographic` → `infographic_brief`; `needsStoryboard` → `storyboard`
   - `needsTextPost` → `content_concept`
   - `needsResearch` → `research_summary`; `needsStrategy` → `strategy_brief`; `needsIdeation` → `campaign_ideas`
   (When a downstream target subsumes an upstream one, backward-chaining dedups; the shim may over-list safely.)
2. **`selectByTargets(targets): RunnableAgentId[]`** — BFS/DFS backward over the registry: for each target find the (single) node whose `produces` includes it, add it, push its `requires` as new targets; recurse until closed. Return in **topological order** (producers before consumers) so `deriveDeps` still finds upstream producers.
3. **Optional-grounding inclusion (the subtle part).** Current marketing plans include OPTIONAL producers (e.g. campaign path adds `ideation`+`strategy` to ground `campaign_strategist` via its `optional` slots; `concept_writer` grounds on optional `research_summary`/`strategy_brief`). Pure `requires`-chaining omits these → snapshot diff. Resolution: fold the relevant `optional` producers into the target set **when the goal's flags imply them** (the shim already lists `strategy_brief`/`campaign_ideas` when `needsStrategy`/`needsIdeation`). Verify against golden; adjust the shim, not the selector.
4. **Preserve as post-selection cross-cutting rules (unchanged semantics):**
   - **Scheduler splice** (`planWorkflow:100-103`): splice `scheduler` before the terminal action when `goal.schedule.confirmed && .at`. Keep as-is; scheduler is a control node (`produces schedule_marker`, required by nothing) — outside backward-chaining.
   - **Campaign stop-at-calendar** (`selectAgents:35-39`): when `campaignScope !== 'single'`, the ONLY target is `content_calendar`; do not chain into per-post nodes. Enforced by `targetsFromGoal` emitting just `content_calendar` (+ implied grounding producers).
   - **Publish-only guard** (`planWorkflow:110-112`): backward-chaining from `publish_result` WOULD auto-pull `concept_writer` (publisher `requires content_concept`), silently turning a content-less publish into a content plan — a behavior change. Keep the guard as a **pre-check**: if the target set derives solely from `needsPublishing` with no independently-requested content target, return `publish_only_no_content` (byte-identical error).
5. **Node ORDER is load-bearing, not just the set.** `plan-tiers.buildPlanTiers` decides which tier cards to show by comparing **ordered** `agentIdList(plan).join(',')` between balanced/economy/full. If backward-chaining changes the topo order of the same node set, tier dedup breaks (spurious or missing Economy/Full cards). `selectByTargets` MUST emit the same order as the current pipeline sequence (research → ideation → strategy → concept → media → publisher; email path unchanged).

## Every `planWorkflow` entry point must stay identical (FEATURES.md cross-check)
`selectAgents`/`planWorkflow` is NOT called only by the brain. All four consumers must produce byte-AND-order-identical plans — the golden master must exercise each:
- **`master-agent.planFromGoal`** ← router `POST /orchestration/runs`, `atria-tools.propose_workflow` (the obvious path).
- **`plan-tiers.buildPlanTiers`** (`plan-tiers.ts:43,49,54`) — plans `balanced` + `economyGoal(g)` (`needsResearch/Ideation/Strategy=false`) + `fullGoal(g)` (those `=true`), then `apply-tier`/`plan-tiers` endpoints rebuild the run from a tier. The `outputs→targets` shim is the single point that must map these mutated flags correctly.
- **`campaign-materializer`** (`campaign-materializer.ts:79`) — each approved calendar slot becomes a single-scope `GoalSpec` re-planned via `planWorkflow`. Materialized-post plans must not drift.
- **~12 `verify-*.ts`** scripts call `planWorkflow` directly (email/campaign/concept/connect/executor/scheduler…).

## Related code files
- **Modify:** `workflow-planner.ts` — add `targetsFromGoal` + `selectByTargets`; `selectAgents` becomes `selectByTargets(targetsFromGoal(goal))`; keep splice/guard/campaign rules.
- **Read/none:** `agent-registry.ts`, `deriveDeps` (no change), `goal-spec.ts`.
- **Possibly add:** `artifact-graph.ts` (small helper: `producerOf(type)`, memoized reverse index over `AGENTS`) — keeps `workflow-planner.ts` under the 200-line guide.

## Implementation steps
1. Build a memoized reverse index `producerOf: ArtifactType → RunnableAgentId` from `AGENTS` (assert single-producer; ambiguity = registry error).
2. Implement `targetsFromGoal` (flag→artifact shim) + `selectByTargets` (backward closure, topo-ordered).
3. Swap `selectAgents` body to the new path; keep splice + publish guard + campaign-stop.
4. `npx tsc --noEmit` clean.
5. **Expand the golden master BEFORE refactoring** (the current 15 cases don't cover tiers/materializer). Add: for each representative goal, its `economyGoal` + `fullGoal` variant (proves the tier shim), and a set of single-scope materialized-slot goals (image/carousel/text/video posts). Re-baseline this EXPANDED snapshot on the CURRENT `selectAgents`, commit it, THEN refactor.
6. Run `verify-planner-golden` → **must diff-clean (node list + ORDER + deps + gates) on every case**. Any diff: root-cause (usually optional-grounding or order); fix the shim; do NOT blindly `--update`.
7. Prove drop-in: with NO registry change, confirm `{email_writer→scheduler→email_agent}` selects for a scheduled-email goal (add a golden case if not already covered).

## Todo
- [ ] **Expand golden master first** (tier variants economy/full + materialized single-scope slots), re-baseline on current code, commit
- [ ] `artifact-graph.ts` reverse index + single-producer assert
- [ ] `targetsFromGoal` shim (maps all `outputs.needs*` incl. the tier-toggled research/ideation/strategy)
- [ ] `selectByTargets` backward closure — topo order MATCHING current pipeline sequence
- [ ] Preserve scheduler splice / publish guard / campaign-stop
- [ ] tsc clean
- [ ] `verify-planner-golden` diff-clean incl. ORDER (explain any delta)
- [ ] Golden case: scheduled-email group composes
- [ ] Sanity: `buildPlanTiers` still offers the same economy/balanced/full cards on a video+publish goal

## Success criteria
- Every (expanded) golden case byte-identical: node list **+ order** + derived deps + gates.
- Tier cards (`buildPlanTiers`) unchanged on representative goals — economy/full still trim/add exactly research+ideation+strategy.
- Materialized calendar slots plan identically.
- Scheduled birthday email selects `email_writer→scheduler→email_agent` via artifact chaining, no `needsEmail` special-case in the selector.
- `selectAgents` contains zero marketing-flag `if`s (flags live only in the `targetsFromGoal` shim).

## Risk
| Risk | Mitigation |
|------|-----------|
| Node-order drift breaks tier-card dedup | Golden captures ordered lists; `selectByTargets` emits pipeline order; explicit tier sanity check |
| Optional-grounding omission → golden diff | Shim lists implied optional producers; golden catches it pre-merge |
| Tier-mutated goals map wrong | Golden includes economy/full variants; shim is the single flag→target map |
| Materializer plan drift | Golden includes materialized single-scope slots |
| Publish-only silently gains content | Keep guard as explicit pre-check |
| Multi-producer artifact ambiguity | Assert single producer at index build; fail loud |
| Scheduler/gate regressions | Splice + gate logic untouched; `hasGate`/`agentGate` unchanged |

## Next
Phase 02 depends on `selectByTargets` returning a typed "no producer for target X" signal (the capability gap) instead of an empty set.
