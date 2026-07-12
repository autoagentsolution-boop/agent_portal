# Phase 06 — Frontend: flow card node + Scheduled page cancel/reschedule

**Priority:** P1 · **Status:** ⬜ Not started · **Depends on:** 04, 05

## Overview
Make the schedule visible and reversible: the flow card shows the `scheduler` node with its confirmed
time; the existing Scheduled page lists parked runs with Cancel / Reschedule.

## Related code files
- Modify: flow-card / DAG renderers (`web/src/components/run-dag-view.tsx`,
  `orchestrate-run-cards.tsx`, `OrchestratePanel.tsx`) — render the `scheduler` node + a
  "⏰ Scheduled for {local time} ({tz})" chip on a parked run.
- Modify: `web/src/components/scheduled-view.tsx` — add a "Scheduled sends" section fed by a new
  endpoint listing runs `status='scheduled'`; each row → Cancel (→ `cancelled`) + Reschedule
  (re-open the confirm flow → new `scheduledResumeAt`).
- Modify: `src/api/orchestration-router.ts` — `GET /runs/scheduled` (owner-scoped) + `POST
  /runs/:id/cancel-schedule` + `POST /runs/:id/reschedule` (re-park with a new confirmed time).
- Modify: `web/src/api/client.ts` + schema regen for the new endpoints.

## Implementation steps
1. Backend: list/cancel/reschedule endpoints for scheduled runs.
2. Scheduled page: section with local-time display (convert stored UTC → viewer local + show tz).
3. Flow card: scheduler node chip + time.

## Todo
- [ ] `GET /runs/scheduled`, cancel, reschedule endpoints
- [ ] Scheduled page section (list + cancel + reschedule)
- [ ] Flow card renders scheduler node + time chip
- [ ] Local-time display (UTC → viewer tz, tz label shown)
- [ ] FE typecheck (`tsc -b`) green

## Success criteria
- A scheduled email appears on the Scheduled page with its time; Cancel stops it (cron never fires);
  Reschedule moves it to a new confirmed time.

## Risks
- Time display confusion → always show the tz label + the sender/recipient basis chosen at confirm.
- Cancel race: cancel while the cron is mid-claim → cancel must no-op if already `running`.
