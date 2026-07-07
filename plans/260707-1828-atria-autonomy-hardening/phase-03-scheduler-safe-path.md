# Phase 03 — Scheduler as a Safe Publish Path  [C2]

**Priority:** CRITICAL. **Status:** DONE 2026-07-08 (tsc + verify-scheduler-safe-path 8/8 + per-platform-publish/executor/runtime/audit/kill-switch green). NOT committed.
**Ownership decision (in code):** executor owns IMMEDIATE publish, cron owns SCHEDULED — BOTH via the SAME `runtimePublishFn` §11 chokepoint; executor parks scheduled posts (never inline-publishes) → no double-publish.
**Implemented:** (E#1) scheduler default publish `publishTo`→`runtimePublishFn` (kill-switch+audit+idempotency+rate-limit) in `runSchedulerTick`+`publishPostNow`. Fixed the shim: `InvokeResult`+`toInvokeResult`+`runtimePublishFn` now carry `platformPostId`+`degraded` (were DROPPED → the executor's live path already lost the gone-signal id + H1c degrade; now preserved on both paths). (A#1/B#3) new `isPublishBlocked(runId)` = running/pending/awaiting_approval nodes OR non-terminal run OR (atria && !scheduleConfirmed); replaces `hasActiveFlowNodes` in the tick (which missed a publisher-parked run). scheduleConfirmed (Phase 01) now gates the cron.
**Verify proves:** kill-switch stops+audits a scheduled publish; publisher-parked run NOT published (stub never called); atria+unconfirmed schedule held, released once re-confirmed. **Depends on:** Phase 02.
**Findings:** A#1, B#3, E#1. Reports: autonomous-execution-core, state-machine-qa, connect-credential.

## Root cause (the scheduler is a shadow publish path)
1. **E#1 — bypasses §11 safety.** `scheduler/tick.ts` `processPost` publishes via `publishTo` DIRECTLY, not through `runtimePublishFn`/`invokeAction`. So autonomously scheduled posts get NO kill-switch check, NO audit, NO idempotency, NO rate-limit. The global "pause all external actions" cannot stop an in-flight scheduled fleet, and there's no forensic record.
2. **A#1/B#3 — bypasses the approval gate.** `hasActiveFlowNodes` (workflow-run-repo.ts:139) counts only `running`/`pending` nodes, EXCLUDING `awaiting_approval`. A post that reached `ready` at the CONCEPT gate but whose run is still parked at a later gate (e.g. pre-video cost gate) is seen as "flow done" → the cron claims + publishes it before media exists → `resolvePlatformInput` throws → post silently `error`, run orphaned `needs_approval`. Wide race window (post is `ready` long before media).
3. **Ownership race:** the in-flow executor publish (Phase 02) and the scheduler cron can both target the same post. Decide ONE owner (plan.md decision #2).

## Fix approach
1. **Route the scheduler through the connector runtime** — `processPost` publishes via `runtimePublishFn`/`invokeAction` (same chokepoint as the executor's publisher), inheriting kill-switch + audit + idempotency + rate-limit. Remove the direct `publishTo` call. This is the single most important safety fix.
2. **Respect parked gates** — a post whose run is NOT terminal (any node `awaiting_approval`/`needs_connection`, or run status `needs_approval`/`running`) is NOT due. Extend the flow-active check: `isPublishBlocked(runId)` = has running/pending nodes OR run.status ∈ {needs_approval, running} OR any node awaiting_approval. Use it in `findPublishDueBatch` filtering / the tick skip. (Builds on the batch/skip already added in the `feat(scheduler)` commit.)
3. **Apply Phase 02 boundary at publish** — re-read the post + re-resolve connections before the scheduled publish; fail loud on stale connection or not-publishable (no silent error).
4. **Resolve the ownership race** — per decision #2: if the in-flow gate owns scheduled publishing, the cron only handles posts whose run is COMPLETED and status `ready` (pure timing). If the cron owns it, the executor must NOT inline-publish scheduled posts (already parks them via the `feat(scheduler)` commit) — keep that and make the cron the sole publisher. Document the chosen owner in code comments.

## Related code files
Modify: `src/scheduler/tick.ts` (`runSchedulerTick`, `processPost` → runtime path), `src/db/repos/workflow-run-repo.ts` (`hasActiveFlowNodes` → `isPublishBlocked` or add a stricter variant), `src/db/repos/post-repo.ts` (`findPublishDueBatch` may join run status). Read: `src/orchestration/executor/runtime` (invokeAction / runtimePublishFn), `src/system` kill-switch.

## Implementation steps
1. Swap `processPost`'s publish to the connector runtime chokepoint (mirror `runPublisher`'s `publishPostNow(id, owner, runtimePublishFn)` path). Verify kill-switch + audit rows now appear for scheduled publishes.
2. Add `isPublishBlocked(runId)` (running/pending/awaiting_approval nodes OR non-terminal run). Use in the tick: skip blocked posts (already skips flow-active; widen the definition). 
3. Add the Phase 02 re-read + connection re-resolve to `processPost`.
4. Encode the ownership decision; comment the invariant.
5. Verify: extend `verify-per-platform-publish.ts` / add a scheduler verify — (a) kill-switch ON blocks a scheduled publish; (b) a post whose run is parked awaiting_approval is NOT published by the cron; (c) audit row exists after a scheduled publish.

## Success criteria
- Kill-switch stops scheduled publishes; every scheduled publish has an audit row + idempotency key.
- The cron never publishes a post whose run is parked at any gate.
- No double-publish between executor and cron (single owner).

## Risks / security
- Routing through the runtime may change publish semantics (idempotency/rate-limit now active) — verify the DRY-RUN vs live behavior matches the executor path.
- Widening "blocked" could delay legitimate publishes if a run legitimately holds a non-publisher node awaiting approval while the publisher is ready — confirm the gate taxonomy so only RELEVANT gates block (a lead-collector-style side node shouldn't block publish). Cross-check with Phase 01 registry `gate` metadata.

## Next steps → Phase 04 (reapers backstop any post/run that still ends up stuck).
