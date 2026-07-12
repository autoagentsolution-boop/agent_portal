# Generic Scheduler Agent Node

**Goal:** One reusable, type-agnostic `scheduler` agent node so ANY workflow can defer its
terminal action to a confirmed future time. The scheduler never performs the action — it PARKS
the run and a single generic cron RE-ENTERS the executor at the parked node when due. Adding a new
schedulable task = building the normal flow; scheduling comes free. First consumer: scheduled email
("send tomorrow morning"); publisher scheduling **coexists unchanged** until this proves out.

## Locked design decisions (user, 2026-07-12)
1. **Re-enter executor** — the cron resumes the parked run; it does NOT do the action itself. This is
   the un-hardcoding: the scheduler is blind to what the next node does.
2. **Publisher coexists** — the existing post `scheduledAt` + `runSchedulerTick` path stays as-is
   until the generic node is proven. No migration in this plan.
3. **Gemini parse + explicit user confirm** — natural-language time ("sáng mai") is parsed by Gemini
   to an absolute UTC instant; Atria ALWAYS confirms the exact instant + timezone before parking
   (recipient may be in a different tz than the sender).

## Architecture (one paragraph)
A `scheduler` registry node (gate: `schedule`) is planned immediately BEFORE a run's terminal action
node (email_agent / later publisher). When the executor reaches it, the run HALTS for the single
human approval (review draft + confirm time). Approving a schedule gate sets
`run.scheduledResumeAt = T` + `run.status = 'scheduled'` and pre-authorizes the immediate downstream
action for THIS run. A generic `resumeDueRuns` cron (reuses `cron.ts` + `lock.ts` + atomic claim)
finds `status='scheduled' AND scheduledResumeAt <= now`, claims it, and calls `runWorkflow(runId)` —
which skips the completed scheduler node and runs the pre-authorized action unattended.

## Flow shape (email)
`email_writer → scheduler (HALT: approve draft + confirm T) → email_agent (send at T, gate waived)`

## Phases
| # | Phase | Status |
|---|-------|--------|
| 01 | [Data model + GoalSpec schedule slot](phase-01-data-model-schedule-slot.md) | ⬜ Not started |
| 02 | [Gemini time-parse + Atria confirm](phase-02-time-parse-and-confirm.md) | ⬜ Not started |
| 03 | [Scheduler registry node + planner injection](phase-03-scheduler-node-and-planner.md) | ⬜ Not started |
| 04 | [Executor schedule gate + action waive + re-entry](phase-04-executor-schedule-gate.md) | ⬜ Not started |
| 05 | [Generic resume-due-runs cron](phase-05-resume-due-runs-cron.md) | ⬜ Not started |
| 06 | [Frontend: flow card node + Scheduled page cancel/reschedule](phase-06-frontend-scheduled.md) | ⬜ Not started |
| 07 | [Tests + verify (coexist, no double-send)](phase-07-tests-verify.md) | ⬜ Not started |

## Key reuse (why this is medium, not large)
- Cron + advisory lock (`src/scheduler/cron.ts`, `lock.ts`) — reused, add one tick branch.
- Park-on-approve pattern — mirrors publisher's `isScheduledFuture()` at `workflow-executor.ts:155`.
- Resume-safe executor — `runWorkflow` already skips completed nodes; re-entry is native.
- Atomic claim — mirrors `claimForPublish` (status transition guards double-fire).
- Scheduled page (`web/src/components/scheduled-view.tsx`) — extend to list parked runs.

## Net-new (one-time)
`run.scheduledResumeAt` column · `GoalSpec.schedule` slot · Gemini time-parse util + confirm tool ·
`scheduler` registry node + planner rule · schedule-gate branch in approve path · `resumeDueRuns` cron.

## Cross-cutting risks
- **Timezone/parse** → mitigated by mandatory Atria confirm of the absolute UTC instant.
- **Missed tick on downtime** → `<= now` catch-up (fires late, never lost).
- **Double-send** → advisory lock + atomic status claim.
- **Coexistence** → generic path only handles runs with a `scheduler` node; publisher path untouched.
