# Phase 04 — Executor schedule gate + action waive + re-entry

**Priority:** P0 (the core) · **Status:** ✅ Done · **Depends on:** 03

## Overview
The heart: when the executor reaches the `scheduler` node it HALTS for the single human approval;
approving a schedule gate parks the run with `scheduledResumeAt` and pre-authorizes the immediate
downstream action; on cron re-entry the completed scheduler node is skipped and the action runs
unattended. This is where "re-enter executor" is realized.

## Key insight
`runWorkflow` is already resume-safe (completed nodes skip). So re-entry needs NO new executor loop —
only (a) a park branch at the schedule gate, and (b) a per-run waive so the downstream action gate
does not re-halt. Mirror the existing publisher `isScheduledFuture()` park + the granted-gate waive.

## Related code files
- Modify: `src/orchestration/executor/workflow-executor.ts` — handle `gate: 'schedule'`: HALT before
  the scheduler node the first time (status `needs_approval`, nodeId = scheduler). On resume where the
  scheduler node is approved: if `run.scheduledResumeAt > now` → set run `scheduled`, park, return; if
  `<= now` (cron re-entry) → mark scheduler node completed and CONTINUE. Waive the next action node's
  gate for this run (scoped, one-shot).
- Modify: approve path `src/api/orchestration-router.ts` (approve-node / execute) — approving a
  `schedule` gate writes `scheduledResumeAt` (from goal.schedule.at) + `status='scheduled'` +
  `scheduleConfirmed=true` instead of running inline.
- Modify: `src/db/repos/workflow-run-repo.ts` — helper `parkScheduled(runId, at)` + `claimScheduledDue()`
  atomic transition (`scheduled → running`) for the cron (guards double-fire).

## Implementation steps
1. Schedule-gate HALT on first reach (like publisher before-gate).
2. Approve schedule gate → `parkScheduled(runId, goal.schedule.at)`.
3. Re-entry: scheduler node time-passed → complete it → waive downstream action gate → run action.
4. Ensure the action node (email_agent) does NOT re-request approval when reached via the waive.

## Todo
- [ ] `gate: 'schedule'` HALT + park branch in executor
- [ ] Approve-schedule path parks (no inline run)
- [ ] `parkScheduled` + `claimScheduledDue` atomic repo helpers
- [ ] Downstream action gate waived one-shot per run on resume
- [ ] Typecheck green
- [ ] Manual: park a run, flip `scheduledResumeAt` to past, resume → action fires once

## Success criteria
- Approving the scheduler gate parks (`status='scheduled'`, no send).
- Re-entry after due sends exactly once; email_agent does not re-prompt approval.

## Risks
- Waive too broad → could auto-run more than the intended action. Scope the waive to the single node
  immediately downstream of the scheduler, this run only.
- Guardrail context (connection/token) must be re-checked at actual send time (token may expire between
  park and T) — reuse `buildGuardrailCtx` at re-entry; fail-closed → park + notify, never silent drop.
