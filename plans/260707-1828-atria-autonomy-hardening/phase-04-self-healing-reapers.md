# Phase 04 — Self-Healing Reapers + Failure Propagation  [C3, orphans, partial]

**Priority:** CRITICAL. **Status:** planned. **Depends on:** none (independent backstop; do after 02/03 so it reaps the RIGHT residue).
**Findings:** A#3, B#1, B#2, B-F6, B-F7. Reports: autonomous-execution-core, state-machine-qa.

## Root cause (nothing recovers a stuck row; an always-on fleet needs self-healing)
1. **B#1 — post stuck `posting`.** `claimForPublish` flips ready→posting (post-repo.ts:59); a crash/container-restart before write-back leaves the post permanently `posting`: not editable, not deletable, never re-picked by the cron. No sweeper. (Repo has a history of stale-container rebuilds → live hazard.)
2. **B#2 — run stuck `running`.** `/execute` + `/approve-node` flip run→`running` and launch the executor DETACHED (fire-and-forget `void run().catch(...)`, executor:143, orchestration-router.ts:288). A mid-node crash wedges the run `running` forever; only `/abort` frees it, and the swallowed detached error means Atria still got HTTP 200 and believes the flow is progressing.
3. **A#3 — node stuck `running`.** A node left `running` makes the scheduler treat the post as flow-active forever (the live 321f253c/a8e4fc96 class). 
4. **B-F6/F7 — dead-ends.** `partial` has no failed-platform retry; orphaned `needs_approval`/`planned` runs never expire.

## Fix approach — a reaper cron + honest failure surfacing
1. **Reaper cron** (new `src/scheduler/reaper.ts`, gated by an env flag, runs e.g. every 5 min):
   - Posts `posting` with `updatedAt` older than TIMEOUT (e.g. 10 min) → `error` (+reason "publish timed out / interrupted"), emit status. Now editable/deletable/re-runnable.
   - Runs `running` with `updatedAt` older than TIMEOUT (e.g. 15 min, > longest node incl. video ~90s×N) → `failed` (+ mark the in-flight node `failed`), emit. 
   - Nodes `running` older than a per-node TIMEOUT (video longer) → `failed`; cascade run→`failed`.
   - Orphaned `needs_approval`/`planned` runs older than a long TTL (e.g. 7d) → log/notify (don't auto-delete; surface for cleanup).
2. **Heartbeat for liveness** — reaper needs to distinguish "slow" from "dead". Add `updatedAt` touch on each node status transition (likely already via `@updatedAt`); the executor already writes node timestamps — confirm `running` nodes get a `startedAt` so the reaper can age them. If long media nodes need more time, key the timeout off node `agentId` (video gets a bigger budget).
3. **Don't swallow detached errors** — the fire-and-forget `void executor().catch()` must, on catch, set run→`failed` + the current node→`failed` + emit, not just log. So a crash surfaces as `failed` (which the reaper also backstops).
4. **`partial` retry** — add a path to re-attempt only the failed platforms of a `partial` post (or at minimum make `partial` a terminal, re-runnable state, not a silent dead-end).

## Related code files
Create: `src/scheduler/reaper.ts` + `verify-reaper.ts`; wire into `src/server.ts` (env `ENABLE_REAPER_CRON`).
Modify: `src/orchestration/executor/workflow-executor.ts` (detached `.catch` sets failed), `src/db/repos/post-repo.ts` + `workflow-run-repo.ts` (reaper queries: find-stale-posting, find-stale-running-run/node), `src/api/orchestration-router.ts` (the detached launch catch).

## Implementation steps
1. Add reaper queries (owner-agnostic worker path, like the leads/scheduler crons): stale `posting` posts, stale `running` runs, stale `running` nodes — by `updatedAt`/`startedAt` age.
2. Write `reaper.ts` transitions (idempotent, best-effort, logged), env-gated, cron every 5 min.
3. Harden the detached executor catch to mark failed + emit.
4. (Optional this phase) `partial` per-platform retry.
5. Verify `verify-reaper.ts`: seed a post `posting` with old updatedAt → reaper flips to `error`; seed a run `running` old → `failed`; ensure a FRESH running node/run (recent) is NOT reaped (no false positives).

## Success criteria
- No row can stay `posting`/`running` beyond its timeout; each becomes a terminal, actionable state.
- A crashed detached executor surfaces as `failed` (Atria/UI sees the real outcome), not a hung 200.
- Reaper never kills a legitimately in-progress run (timeouts > real max durations, video-aware).

## Risks / security
- **False reaping** is the danger — set timeouts generously above real max (video render can be minutes ×N clips). Make timeouts env-tunable. Key off node agentId.
- Worker-path queries are owner-agnostic by design (documented pattern) — keep them read-then-scoped-write, no cross-tenant leak.

## Next steps → independent of 05/06/07.
