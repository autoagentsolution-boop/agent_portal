# Phase 05 — Generic resume-due-runs cron

**Priority:** P0 · **Status:** ✅ Done · **Depends on:** 04

## Overview
The single type-agnostic driver: every minute, find runs due to resume and re-enter the executor.
It knows nothing about email/publish — it just resumes runs. Reuses the existing cron + advisory lock.

## Related code files
- Create: `src/scheduler/resume-due-runs.ts` — one tick: advisory lock → `claimScheduledDue()` (atomic
  `scheduled → running`, oldest first, one per tick) → `runWorkflow(runId, { ... })` → on outcome log.
- Modify: `src/scheduler/cron.ts` — mount the new tick on the same 1-min schedule (or a sibling
  `cron.schedule`). Reuse `acquireSchedulerLock` (or a distinct lock key to avoid starving publish tick).
- Modify: `src/system` bootstrap where crons start — register the new cron behind an env flag
  (e.g. `ENABLE_SCHEDULER_RESUME`, default on in dev) mirroring existing cron gating.

## Implementation steps
1. `claimScheduledDue()` — `updateMany where status='scheduled' AND scheduleConfirmed AND
   scheduledResumeAt <= now()` → set `running`, return one claimed id (atomic; guards double-fire).
2. Tick: claim → `runWorkflow` → the parked scheduler node completes → action runs.
3. Catch-up semantics: `<= now` so a missed window fires late, never lost.
4. Separate advisory lock key from the publish tick so the two never block each other.

## Todo
- [ ] `resume-due-runs.ts` tick (lock + claim + runWorkflow)
- [ ] `claimScheduledDue()` atomic repo query
- [ ] Mount on cron with its own lock key + env flag
- [ ] Backlog drains one run/min; a down-then-up server fires overdue runs on restart
- [ ] Typecheck green

## Success criteria
- A parked, confirmed run with past `scheduledResumeAt` is picked up within a minute and its action
  runs exactly once; two overlapping ticks never double-run (lock + atomic claim proven).

## Risks
- Lock contention with publish tick → distinct lock keys.
- A run that errors on resume must NOT loop forever → on failure set `failed` (not back to `scheduled`).
