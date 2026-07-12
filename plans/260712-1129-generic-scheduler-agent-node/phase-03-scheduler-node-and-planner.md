# Phase 03 — Scheduler registry node + planner injection

**Priority:** P0 · **Status:** ✅ Done · **Depends on:** 01

## Overview
Make `scheduler` a real registry agent node with a new `gate: 'schedule'`, and teach the planner to
insert it immediately before the terminal action node whenever the goal carries a confirmed schedule.

## Related code files
- Modify: `src/orchestration/registry/agent-registry.ts` — add `scheduler` node: display name/emoji,
  `requiresApproval` semantics via `gate: 'schedule'`, division. It produces a trivial artifact
  (`schedule_marker`) and performs NO external action.
- Modify: `src/orchestration/master/workflow-planner.ts` — if `goal.schedule?.confirmed && goal.schedule.at`,
  splice `scheduler` directly before the terminal action node (email_agent; publisher later). No
  schedule → plan unchanged (publisher keeps its own path).
- Modify: gate-kind type / registry `GateKind` union — add `'schedule'`.
- Modify: `src/orchestration/executor/agent-runners.ts` — trivial `runScheduler` runner (returns the
  marker with `resumeAt`). The PARK decision lives in Phase 04 (executor), not here.

## Implementation steps
1. Registry entry `scheduler` (runnable, gate `schedule`, no connection required).
2. Planner: detect confirmed schedule → insert node + wire edges (writer → scheduler → action).
3. Keep email flow default (no schedule) = `email_writer → email_agent` unchanged.

## Todo
- [ ] `scheduler` registry node + `GateKind` 'schedule'
- [ ] `runScheduler` trivial runner (marker + resumeAt)
- [ ] Planner injects scheduler before terminal action when schedule confirmed
- [ ] Unscheduled flows unchanged (snapshot test of node lists)
- [ ] Typecheck green

## Success criteria
- `planFromGoal` on an email goal WITH confirmed schedule → nodes `[email_writer, scheduler, email_agent]`.
- Without schedule → `[email_writer, email_agent]` (regression-safe).

## Risks
- Node ordering/edges wrong → verify the DAG edges, not just the node set.
- Registry `gate` union consumed in multiple switch sites → grep all `GateKind` usages and handle 'schedule'.
