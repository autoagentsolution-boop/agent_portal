# Phase 04 — C3: `TaskSpec` for non-marketing intents

**Priority:** P1 · **Status:** planned · **Depends on:** Phase 03

## Context links
- `MKTAgent/src/orchestration/schemas/goal-spec.ts` (marketing-only today)
- `MKTAgent/src/orchestration/master/requirement-analyzer.ts` (regex → marketing slots)
- Phase 03 `WorkflowProposal`

## Overview
A non-marketing goal ("translate this doc", "summarize these 3 URLs", "send a birthday email") has nowhere to live in the marketing `GoalSpec`. Give the brain a general way to express **requested output artifact type(s) + inputs** so `selectByTargets` (Phase 01) decides the plan/gap directly — no marketing analyzer in the loop.

## Key insight
With Phase 01 selecting by artifact type and Phase 03 carrying a general proposal, the only missing piece is a general *request* shape. Keep it minimal: a `TaskSpec` that names the desired outputs and known inputs. The marketing `GoalSpec` remains for marketing (it carries rich campaign structure the generic shape shouldn't absorb — avoid one bloated union).

## Architecture (decide at build time — see open question)
Two candidate shapes; pick when C1/C2 are concrete:
- **A) Sibling `TaskSpec`:** `{ targets: ArtifactType[], inputs: Record<string,unknown>, language, schedule? }` alongside `GoalSpec`. Brain's `propose_workflow` routes marketing→`GoalSpec`, else→`TaskSpec`. Cleaner separation, small duplication (schedule/language).
- **B) Capability-tagged unified goal:** one goal with a `kind` discriminant. Less duplication, risk of a marketing-shaped union creeping back (the very thing we're removing).
- **Lean A** (KISS, keeps marketing complexity quarantined). Confirm at build.

`propose_workflow`: brain decides marketing vs task. Task path → `selectByTargets(taskSpec.targets)` → `WorkflowProposal` (source:'task') or `capability_gap` (Phase 02).

## Blast radius + back-compat (FEATURES.md cross-check) — the widest phase
`GoalSpec` is not just an in-memory type; it is **persisted** and **read in ~15 places**. Any schema change or `TaskSpec` sibling must not break these.

- **Persisted snapshot:** `wf_run.goal` (JSON) stores the GoalSpec of every run (`WorkflowRun.goal`). Existing rows hold marketing GoalSpecs. Sibling `TaskSpec` (option A) is safest — GoalSpec shape is **unchanged**, so old rows parse as-is; a run is discriminated by which column/kind it carries. If instead GoalSpec itself gains fields (option B), they MUST be optional with defaults so historical `wf_run.goal` still validates. **Old runs must reload** (refine/clarify/materialize re-read `wf_run.goal`).
- **Readers to satisfy (grep-confirmed):** `goal-merge.ts` (merge/refine), `clarification-engine.ts`, `conversation-author.ts` (reply text), `goal-to-brief.ts` (→ copy-gen brief), `campaign-from-flow.ts`, `lead-readiness.ts`, `memory/user-memory.ts` (`captureFromGoal` — durable slots), `orchestration-mappers.ts` (DTO to frontend), `agent-runners.ts`, `workflow-executor.ts`. A `TaskSpec` that flows to any of these needs an adapter or an explicit "marketing-only" guard so a non-marketing task doesn't hit marketing-shaped code.
- **`mergeGoals`/refine + `clarify` are marketing-GoalSpec-shaped.** A `TaskSpec` has NO merge/subtract path today — refine ("add a deadline") or `POST /runs/:id/clarify` on a non-marketing task is unhandled. Decide: give `TaskSpec` its own minimal merge, or restrict refine/clarify to marketing goals in v1 (task = single-shot). (This is the exact layer patched in `0733288`.)
- **analyzer has extra callers:** `requirementAnalyzer` also backs `POST /posts/from-agent` and `POST /agent/intake` (draft extraction) — any analyzer change for task detection blasts there too. Prefer brain-driven target extraction (no analyzer regex change) to avoid it.

## Related code files
- **Add:** `src/orchestration/schemas/task-spec.ts`; task→proposal producer in `master-agent.ts`.
- **Modify:** `atria-tools.ts`/`atria-brain.ts` (`propose_workflow` branches marketing vs task), `requirement-analyzer.ts` (task detection or brain-driven target extraction).

## Implementation steps
1. Decide A vs B (default A).
2. `TaskSpec` schema + brain target-extraction (the brain names desired outputs; no regex).
3. Task→`WorkflowProposal` producer via `selectByTargets`.
4. e2e: a non-marketing task (using an EXISTING capability, e.g. scheduled email expressed as a TaskSpec) plans + executes; an unsupported one hits `capability_gap`.

## Todo
- [ ] Decide TaskSpec shape (A/B) — default A (sibling, GoalSpec untouched → zero persistence break)
- [ ] `task-spec.ts` + brain target extraction (no analyzer regex change)
- [ ] Task→proposal producer
- [ ] `propose_workflow` marketing-vs-task branch
- [ ] Decide refine/clarify on tasks (own merge vs single-shot v1) — document
- [ ] Guard/adapt every GoalSpec reader that a task could reach (mappers/DTO, executor, runners, captureFromGoal)
- [ ] Back-compat check: load a pre-change `wf_run.goal` row → still parses + refines
- [ ] e2e supported task + gap task

## Success criteria
- Scheduled birthday email plannable via `TaskSpec` targets (`email_result` + confirmed schedule), no marketing GoalSpec involved.
- Unsupported task → clean `capability_gap` decided in `selectByTargets` (not analyzer guesswork).
- **Existing `wf_run.goal` rows still load, refine, and materialize** (back-compat proven on a real historical run).
- Marketing path + golden unchanged; `/posts/from-agent` + `/agent/intake` unaffected.

## Risk
| Risk | Mitigation |
|------|-----------|
| Persistence break — old `wf_run.goal` won't parse | Prefer sibling A (GoalSpec unchanged); option B fields optional+defaulted; back-compat test on real rows |
| Union bloat (option B) | Prefer sibling A; quarantine marketing structure |
| Task reaches marketing-shaped reader (merge/brief/capture) | Adapter or explicit marketing-only guard per reader; task = single-shot in v1 |
| refine/clarify on a task unhandled | Decide own-merge vs restrict-to-marketing; document in v1 |
| Brain mis-extracts targets | Constrain to registry artifact-type vocabulary in the tool schema; unknown → gap |

## Next
Phase 05 documents the node-authoring recipe and runs the full verification matrix.
