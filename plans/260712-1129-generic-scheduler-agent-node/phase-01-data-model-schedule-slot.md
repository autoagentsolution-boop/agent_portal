# Phase 01 — Data model + GoalSpec schedule slot

**Priority:** P0 (foundation) · **Status:** ✅ Done

## Overview
Add the durable fields the whole feature hangs on: a resume time on the run, and a first-class
schedule slot on the goal so scheduling is intent, not per-task plumbing.

## Related code files
- Modify: `prisma/schema.prisma` — `WorkflowRun` model.
- Create: migration under `prisma/migrations/` (via `prisma migrate dev`).
- Modify: `src/orchestration/schemas/goal-spec.ts` — add `schedule` to slots.
- Modify: any GoalSpec zod schema / `master/goal-merge.ts` (mergeGoals must carry `schedule`).

## Implementation steps
1. `WorkflowRun`: add
   - `scheduledResumeAt DateTime? @map("scheduled_resume_at") @db.Timestamptz(6)` — absolute UTC
     instant to resume; null = not scheduled.
   - Add composite index `@@index([status, scheduledResumeAt], name: "ix_wf_run_status_resume")`
     for the due-run query.
   - Reuse existing `scheduleConfirmed` (already present) as the "user confirmed the finalized time"
     flag the cron requires before firing.
2. `GoalSpec.schedule`: `{ at: string | null; phrase: string | null; timezone: string | null;
   confirmed: boolean }` — `at` = ISO UTC, `phrase` = raw ("sáng mai"), `timezone` = IANA resolved,
   `confirmed` gates planning of the scheduler node.
3. `mergeGoals`: carry `schedule` additively (later turn's `at`/`confirmed` win when set).
4. Run `prisma migrate dev` (Docker applies on boot); regenerate client.

## Todo
- [ ] Add `scheduledResumeAt` + index to `WorkflowRun`
- [ ] Migration created + applied (Docker `migrate deploy` on boot stays green)
- [ ] `GoalSpec.schedule` slot + zod
- [ ] `mergeGoals` carries `schedule`
- [ ] `prisma generate`; backend typecheck green

## Success criteria
- `npx tsc --noEmit` green; migration applies clean on `docker compose up --build`.
- A run can be persisted with `scheduledResumeAt` + `status='scheduled'`.

## Risks
- Migration on a live volume — additive nullable column, safe. Verify `migrate deploy` (not `dev`)
  is what the container runs on boot so no drift prompt.
