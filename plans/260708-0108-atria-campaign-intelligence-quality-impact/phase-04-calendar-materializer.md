# Phase 04 — Calendar Materializer + Scheduling Engine

**Priority:** CORE. **Status:** planned. **Depends on:** Phase 03 (the calendar).
**Goal:** Turn an approved `content_calendar` into N scheduled Posts, each its own runnable flow.

## What's new
1. **Materializer** (`master/campaign-materializer.ts`) — for each `CalendarSlot`: create a Post under
   the campaign (`createPostForOwner`) with the slot's platforms/angle/format, build a per-slot GoalSpec
   (single-scope, the slot's outputs) → run it through the planner so each post's DAG is composed from
   the registry (NO hand-authored templates), and set a concrete `scheduledAt` (below). Posts start
   `brief`/`planned`.
2. **Scheduling engine** (`scheduler/schedule-calendar.ts`) — ACTIVATE the dormant
   `Campaign.postingWindow` + `timezone`: spread slots across `duration` honoring `cadence`, landing each
   at a real timestamp inside the posting window in the campaign tz (jittered; no two same-platform posts
   within X hours). Pure + injectable `now`. Output: `dayOffset → scheduledAt`.

## Reuses (no rewrite)
- `cloneTemplateRun`/per-post instance runs, `createPostForOwner`, `scheduledAt`, and the hardened
  scheduler (`isPublishBlocked`, one runtime chokepoint). Materialized posts flow the existing safe path.

## Related code files
Create: `master/campaign-materializer.ts`, `scheduler/schedule-calendar.ts`,
`orchestration/verify-campaign-materializer.ts`.
Modify: `api/campaigns-router.ts` (`POST /campaigns/:id/materialize` — takes the user-edited calendar),
`db/repos/post-repo.ts` (bulk-create helper if needed). Read: `master/campaign-from-flow.ts`, `tick.ts`.

## Steps
1. `schedule-calendar.ts` — cadence × window × tz → concrete `scheduledAt[]` (pure, injectable now).
2. Materializer — slot → per-slot GoalSpec → planner plan → Post + instance run + scheduledAt.
3. `POST /campaigns/:id/materialize` (idempotent: re-materialize replaces un-published slots only, never
   a `posted` one — reuse the autonomy-hardening already-posted guard).
4. Verify (DRY-RUN): 4wk × 3/wk → 12 posts, each scheduled inside the window + spread across the month,
   each with a valid registry-composed DAG; re-materialize doesn't dup or touch posted.

## Acceptance
- N slots → N Posts (correct platforms/format/angle + realistic `scheduledAt`), each with a runnable DAG.
- Re-materializing an edited calendar is safe (no dup, no touching published posts).

## Next → Phase 05 grants the whole set to run autonomously.
