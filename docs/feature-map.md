# Feature Map

Living record of features shipped and their real relationships in the app. Each commit appends a stub below; the model curates the relationships.

## Features & relationships

### Composable planner — backward-chaining selection (C1, `0295323`)
The planner selects agent nodes by **backward-chaining from requested output artifacts** instead of a marketing if-ladder.
- **Depends on:** the agent registry's `produces`/`requires` graph (`registry/agent-registry.ts`); a new single-producer reverse index (`master/artifact-graph.ts`).
- **How:** `targetsFromGoal` (the ONLY reader of `GoalSpec.outputs.*` flags) → `selectByTargets` (closes over producers/requires, returns canonical `PIPELINE_ORDER`).
- **Consumed by (unchanged behavior):** `master/master-agent.planFromGoal` (← router `POST /orchestration/runs`, `atria-tools.propose_workflow`), `master/plan-tiers.buildPlanTiers` (economy/balanced/full), `master/campaign-materializer` (per calendar slot). Node ORDER preserved so tier-card dedup stays stable.
- **Guarded by:** `verify-planner-golden` (23 cases incl. tiers + materializer). Publish-only still errors via flag-based `isPublishOnly`. Scheduler splice untouched.
- **Unlocks:** a scheduled email composes `email_writer → scheduler → email_agent` via artifact chaining — no `needsEmail` special-case; selection is now marketing-agnostic.

### Capability-gap handling — Atria honestly flags what it can't do (Phase 02, this commit)
When the user asks for a capability **no agent node produces**, Atria does not fake it or bend it into a marketing plan — it flags the gap as demand and tells the user honestly.
- **Depends on / REUSES (not a new table):** the existing `RoadmapDemand` mechanism (`mkt_roadmap_demand`, `db/repos/roadmap-demand-repo.ts`, `registry/roadmap-agents.ts` pitches, `registry/vision-agents.ts` surfaces). Extended with a nullable `spec Json?` column + `action: 'requested'`.
- **New:** brain tool `flag_capability_gap` (`atria/atria-tools.ts` + `prompts/atria-brain-prompt.ts`) → `recordCapabilityGap` (dedup via `wasRequested`) → `mkt_roadmap_demand` row with a drop-in spec (produces/requires/gate/example). Reply-only turn — sets NO workflow proposal.
- **Surfaced by:** `GET /atria/roadmap-demand` (owner-auth DEV backlog), alongside `/atria/roadmap` + `/atria/suggestions`.
- **Complements C1:** C1 composes EXISTING nodes; this is the honest fallback when NONE produces the needed artifact. The `spec` maps 1:1 to a registry `AgentDefinition`, so a dev scaffolds the node (registry + runner) with no planner change.
- **Guarded by:** `verify-capability-gap` (repo round-trip + dedup + brain dispatch); `verify-atria-suggestions` confirms the pitched/accepted path is unregressed.

### `summarize` — first non-marketing capability node, reachable + composable (Phase 05, this commit)
Proves the composable-agent thesis end-to-end: a real capability drops in with **only a registry entry + a runner**, is reachable from chat, composes with other nodes, and runs — with the marketing path untouched.
- **The node:** `registry/agent-registry.ts` (`summarize`: produces `summary`, requires `[]` — reads source from the goal like `email_writer`) + `executor/agent-runners.ts` `runSummarize` (Gemini → `{summary, bullets}`) + `schemas/artifact-schemas.ts` `summary` type. **No planner change** — this is the whole point.
- **Reachability (the seam that avoids a thin layer):** new `GoalSpec.taskTargets` (a general escape hatch from marketing flags) short-circuits `targetsFromGoal` → `selectByTargets` picks the node by its output. Brain tool `propose_task(capability, source_text)` (`atria-tools.ts`, map `TASK_CAPABILITIES`) builds a task goal and plans it via `master-agent.planFromGoal(goal, {skipClarification})` — skips the marketing clarification engine. Marketing goals never set `taskTargets`, so the golden 23/23 is unaffected.
- **Composition:** `email_writer.optional` now includes `summary`, so `taskTargets:['summary','email_result']` composes `summarize → email_writer → email_agent` (deriveDeps wires the edge; email_writer grounds the email on the summary).
- **Relationship to C1 + capability-gap:** C1 made selection target-driven so this composes with zero planner edits; capability-gap (P2) would have flagged "summarize" as missing — building it via the drop-in recipe **closes that loop** (gap → authored node → reachable). `TASK_CAPABILITIES` is where the next utility (translate, transcribe…) plugs in.
- **Guarded by:** `verify-summarize-node` (planner compose + runner + brain seam + **real executor run** producing a stored `summary` artifact); golden 23/23 + email/scheduler/capability-gap verifies unregressed.

### Atria brain reliability — explicit thinking budget (fix, this commit)
Fixes spurious "sorry, I ran into a problem" replies. `gemini-2.5-flash`'s **default dynamic thinking** misbehaves with tools — it intermittently returns `finishReason=STOP` with EMPTY content parts, which the brain loop reads as a failed turn. Setting an **explicit** `thinkingConfig.thinkingBudget` (4096) in `atria-brain.ts` `doCall` fixes it deterministically while KEEPING real reasoning (the model self-limits below the ceiling). Measured: default → empty every time; explicit budget → a clean tool-call/reply every time. Baseline of a coming **per-agent-group thinking-budget policy** (see `plans/260712-1649-atria-composable-planner/phase-06-thinking-budget-policy.md`).

## Commit ledger

- **fix(orchestration): preserve email intent + recipient name across refine/confirm turns** (0733288)
  - `MKTAgent/src/orchestration/executor/agent-runners.ts`
  - `MKTAgent/src/orchestration/master/goal-merge.ts`
  - `MKTAgent/src/orchestration/master/requirement-analyzer.ts`
- **chore(hooks): test-integrity gate + feature-ledger on commit** (7a19654)
  - `.claude/hooks/feature-ledger.cjs`
  - `.claude/hooks/test-integrity-guard.cjs`
  - `.claude/hooks/test-integrity-stop.cjs`
  - `.claude/settings.json`
  - `docs/feature-map.md`
- **docs(plan): final composable-planner plan (Track A / P1b)** (4cd7aa6)
  - `plans/260712-1649-atria-composable-planner/phase-01-c1-backward-chaining.md`
  - `plans/260712-1649-atria-composable-planner/phase-02-capability-gap-devnotify.md`
  - `plans/260712-1649-atria-composable-planner/phase-03-c2-workflow-proposal.md`
  - `plans/260712-1649-atria-composable-planner/phase-04-c3-taskspec.md`
  - `plans/260712-1649-atria-composable-planner/phase-05-node-authoring-verify.md`
  - `plans/260712-1649-atria-composable-planner/plan.md`
- **test(orchestration): expand planner golden-master to tiers + materializer slots** (6047d18)
  - `MKTAgent/src/orchestration/planner-golden-snapshot.json`
  - `MKTAgent/src/orchestration/verify-planner-golden.ts`
- **refactor(orchestration): backward-chaining agent selection (C1)** (0295323)
  - `MKTAgent/src/orchestration/master/artifact-graph.ts`
  - `MKTAgent/src/orchestration/master/workflow-planner.ts`
  - `docs/feature-map.md`
- **feat(orchestration): capability-gap handling — Atria honestly flags missing capabilities (P2)** (2861dbe)
  - `MKTAgent/prisma/migrations/20260712112702_add_capability_gap_spec/migration.sql`
  - `MKTAgent/prisma/schema.prisma`
  - `MKTAgent/src/api/atria-router.ts`
  - `MKTAgent/src/db/repos/roadmap-demand-repo.ts`
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/prompts/atria-brain-prompt.ts`
  - `MKTAgent/src/orchestration/verify-capability-gap.ts`
  - `docs/feature-map.md`
- **feat(orchestration): summarize node — first non-marketing capability, reachable + composable (P5)** (caa2d27)
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/executor/agent-runners.ts`
  - `MKTAgent/src/orchestration/master/master-agent.ts`
  - `MKTAgent/src/orchestration/master/workflow-planner.ts`
  - `MKTAgent/src/orchestration/prompts/atria-brain-prompt.ts`
  - `MKTAgent/src/orchestration/registry/agent-registry.ts`
  - `MKTAgent/src/orchestration/registry/agent-types.ts`
  - `MKTAgent/src/orchestration/schemas/artifact-schemas.ts`
  - `MKTAgent/src/orchestration/schemas/goal-spec.ts`
  - `MKTAgent/src/orchestration/schemas/workflow-plan.ts`
  - `MKTAgent/src/orchestration/verify-summarize-node.ts`
  - `docs/feature-map.md`
- **docs(plan): mark P1/P2/P5 done, P3/P4 superseded by lightweight task seam** (bdef900)
  - `docs/feature-map.md`
  - `plans/260712-1649-atria-composable-planner/plan.md`
- **fix(orchestration): explicit brain thinking budget — stop spurious empty-reply apologies** (b5c4f9c)
  - `MKTAgent/src/orchestration/atria/atria-brain.ts`
  - `docs/feature-map.md`
- **docs(plan): phase-06 per-agent-group thinking-budget policy (design locked)** (0c8c883)
  - `docs/feature-map.md`
  - `plans/260712-1649-atria-composable-planner/phase-06-thinking-budget-policy.md`
