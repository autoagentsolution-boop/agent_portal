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
