# Phase 07 — Tests + verify (coexist, no double-send)

**Priority:** P0 (gate to done) · **Status:** ⬜ Not started · **Depends on:** 01–06

## Overview
Prove the generic path end-to-end with NO real send, prove it coexists with the untouched publisher
path, and prove the two guards (advisory lock + atomic claim) stop double-fire.

## Test matrix
1. **Parse+confirm:** phrase → proposed instant; unconfirmed never parks; `at <= now` rejected.
2. **Planner:** confirmed schedule → `[email_writer, scheduler, email_agent]`; none → unchanged.
3. **Executor gate:** reach scheduler → HALT; approve → `status='scheduled'`, no send; artifacts intact.
4. **Re-entry:** flip `scheduledResumeAt` to past → `resumeDueRuns` (stub `gmailSendFn`) → email_agent
   runs ONCE; `scheduleConfirmed=false` run is skipped by the cron.
5. **Double-fire:** two concurrent ticks / claim → exactly one send (atomic claim + lock).
6. **Coexist:** a scheduled POST (publisher path) still parks+publishes via `runSchedulerTick`
   untouched; the new cron ignores runs with no scheduler node.
7. **Failure:** action throws on resume → run `failed`, not re-queued (no infinite loop).
8. **Timezone:** stored UTC instant renders correctly to a chosen tz; confirm string matched the park.

## Related code files
- Create: `src/orchestration/executor/verify-scheduler-node.ts` (stub gmail/publish fns — DRY-RUN).
- Reuse: existing scheduler verify scripts as templates (`src/scheduler/verify-scheduler-safe-path.ts`).
- Run: backend `tsc --noEmit`; web `tsc -b`; the verify scripts; `docker compose up --build` boot green.

## Todo
- [ ] Verify script: park → resume → single send (stubbed)
- [ ] Coexistence check: publisher scheduled post unaffected
- [ ] Double-fire guard proven (lock + atomic claim)
- [ ] Failure path → `failed`, no loop
- [ ] Full typecheck + boot green; e2e with a real Gemini key (owner) once, real Gmail send confirmed
- [ ] Update `docs/` (system-architecture + changelog) via docs-manager

## Success criteria
- All matrix rows pass; a real scheduled birthday email drafts now, parks, and sends unattended at the
  confirmed time exactly once — with the publisher path demonstrably unchanged.

## Risks
- Real-send tests are irreversible → default all automated tests to stubbed send; do the ONE real
  send deliberately (no-burst rule).
