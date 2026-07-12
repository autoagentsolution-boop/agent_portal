# Feature Map

Living record of features shipped and their real relationships in the app. Each commit appends a stub below; the model curates the relationships.

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
