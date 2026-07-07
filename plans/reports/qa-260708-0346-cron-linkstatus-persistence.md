## Cron + Link-Status Persistence Audit (read-only)

### Q1 — Cron loop exists? ✅ (env-gated, default OFF)
- `MKTAgent/src/server.ts:144-148`: `startSchedulerCron/startReaperCron/startCopyGenCron/startTokenCron/startLeadsCron` each gated by its own `env.ENABLE_*_CRON` flag, called from `bootstrap()`.
- `MKTAgent/src/config/env.ts:19,56`: `ENABLE_SCHEDULER_CRON` default `false`, `ENABLE_LEADS_CRON` default `false` (zod `.default(false)`). Only ON if set truthy in `.env` (gitignored — matches prior memory note).
- `MKTAgent/src/scheduler/cron.ts:8-18`: scheduler fires every minute (`* * * * *`), calls `runSchedulerTick()`.
- `MKTAgent/src/scheduler/reaper-cron.ts:7-13`: reaper every 5 min offset `:03` (`3-59/5 * * * *`).
- Leads cron/sweep: gated by `ENABLE_LEADS_CRON` separately (not re-verified file/line here, prior memory confirms `comment-cron.ts`).

### Q2 — Scheduler persists status transitions to DB? ✅ real DB writes, not in-memory
- `tick.ts:221` `claimForPublish(due.id)` → `post-repo.ts:59-65` atomic `prisma.post.updateMany({where:{id,status:'ready'}, data:{status:'posting'}})`.
- `tick.ts:143` `updatePost(post.id, toWriteBack(outcome))` after publish → `post-repo.ts:80-81` `prisma.post.update(...)`. Real Postgres write, includes `postUrls`, `platformPostIds` (aggregate outcome), status (`posted`/`partial`/`error`).
- Failure paths also persist: `tick.ts:68` `failPost` → `updatePost(...status:'error'...)`; `tick.ts:232` catch-block error write-back.
- Verdict: transitions are DB-backed at every step (ready→posting→posted/partial/error), not memory-only.

### Q3 — ROOT CAUSE: link-status lost on refresh ✅ CONFIRMED (not persisted)
Exact path:
1. Web button click → `MKTAgent/web/src/components/LeadsPage.tsx:127` `setLinkStatus((prev) => ({ ...prev, [postId]: r.data.links }))` — writes into **React `useState`** (`linkStatus`, line 46). Pure client memory, no localStorage/cache.
2. That call hits `GET /:id/link-status` — `MKTAgent/src/api/posts-router.ts:326-333` → `checkPostLinks(post, ownerId)` — `MKTAgent/src/leads/sources/post-liveness.ts:25-62`.
3. `checkPostLinks` computes `alive` per platform live via `checkPlatformAlive` (`post-exists.ts:65-94`, real network Graph/X calls) and returns the array **in the response only**.
4. DB write inside `checkPostLinks` (lines 52-58) is **conditional**: `if (JSON.stringify(liveSources) !== JSON.stringify(sources))` — i.e. it ONLY writes when a previously-watched comment source (`commentSourceIds`) changed (a platform confirmed dead → removed from watch list, or all removed → `leadCollectorStatus:'post_deleted'`). It does **not** write the per-platform `alive: true|false|null` array anywhere. There is no `linkStatus`/`liveness` JSON column on `Post` in `prisma/schema.prisma` (only `lastLivenessCheckAt` timestamp at line 348, and `leadCollectorStatus` string at 297 — neither stores per-platform alive booleans).
5. On page load, `LeadsPage.tsx:48-59` `load()` calls `listPosts()` only (never `link-status`); `linkStatus` state initializes to `{}` (line 46).
6. Render fallback `LeadsPage.tsx:191`: `checked ?? (p.postUrls ? ... alive: undefined) : []` — undefined → `aliveMarker` (line 13-14) renders no dot at all (blank), and `aliveTitle` (line 19-23) shows "Not checked yet — click Check links".

**Confirmed**: liveness is computed 100% on-demand per button click, held only in transient client component state, never written to a queryable DB column. Any refresh (React remount) discards it → matches user report exactly ("phải hit check link, và khi refresh thì mất status").

Note: `sweepPostLiveness` (`post-liveness.ts:69-101`, cron-driven proactive sweep) ALSO calls `checkPostLinks` and stamps `lastLivenessCheckAt` (line 93) — but still never persists the per-platform `alive` result, only the timestamp + the indirect self-heal side effects (dropped dead sources / `post_deleted` flag). So even the periodic sweep doesn't fix this — its result is thrown away too, just less often lost since server-side state doesn't survive page refresh anyway (it's not client state, but nothing reads it back either).

### Q4 — Minimal correct fix (design only, not implemented)
- Add a persisted column, e.g. `Post.linkStatus Json?` (`{ [platform]: 'alive'|'dead'|'unknown' }`) or a lighter `Json?` mirroring `LinkStatus[]`, migrated via prisma.
- Write site: inside `checkPostLinks` (`post-liveness.ts:47-50` loop) — after computing `results`, always `prisma.post.update({ data: { linkStatus: results, lastLivenessCheckAt: now } })` (currently the update at line 55-58 is conditional on self-heal only; make it unconditional, or add a second always-run update).
- Read site: `GET /posts` / `toPostDto` should include `linkStatus` in the DTO so `LeadsPage.tsx` can seed `linkStatus` state from `p.linkStatus` in `load()` instead of defaulting to `undefined`.
- Optional: let the existing cron-driven `sweepPostLiveness` (`post-liveness.ts:69`, gated by `ENABLE_LEADS_CRON` + `LEADS_LIVENESS_THROTTLE_HOURS`) be the sole periodic refresher so the UI shows a recent-ish status even before the user clicks "Check links" — this already runs on a schedule, just needs its `checkPostLinks` call's write to be persisted (same fix as above, shared code path).
- Keep the manual button as an on-demand override that also persists (already calls the same `checkPostLinks`, so the write-path fix covers both).

### Q5 — Reapers for stuck posting/running ✅ present, cron-driven
- `reaper-cron.ts` every 5 min → `runReaperOnce()` (`reaper.ts:23-84`):
  - stuck `posting` posts → `error` (`reaper.ts:27-37`, `findStalePostingPosts`/`reapPostingToError`, timeout `env.REAPER_POSTING_TIMEOUT_MIN`).
  - stuck `running` nodes → `failed` + cascade run → `failed` (`reaper.ts:41-56`, video gets bigger budget `REAPER_VIDEO_NODE_TIMEOUT_MIN`).
  - stuck `running` runs (no running node) → `failed` (`reaper.ts:60-69`).
  - orphaned parked runs past TTL → logged only, never auto-deleted (`reaper.ts:74-78`).
- Gated by `ENABLE_REAPER_CRON` (`server.ts:145`), same default-off-unless-.env pattern as scheduler.

### Q6 — Early/double publish risk ✅ guarded, no issue found
- `findPublishDueBatch` filters `scheduledAt: { lte: now }` (`post-repo.ts:52`) — cron never picks a not-yet-due post.
- `claimForPublish`/`claimForPublishOwned` are atomic `updateMany` guarded on `status:'ready'` (`post-repo.ts:59-77`) — first claimer wins, loser gets `count:0` → no double-publish between cron tick and manual "Publish now".
- `isPublishBlocked` gate (`tick.ts:214`) delays (not publishes) a due post whose flow is still producing/parked — prevents publishing before assets ready.
- In-flow executor "PARKS" scheduled-future posts as `ready` rather than inline-publishing (per code comment `tick.ts:10-16`), leaving cron as sole publisher of scheduled posts — no shadow bypass found in reviewed files.

---

## Tomorrow fix list

**P0** — Persist link-status so UI survives refresh:
- `MKTAgent/prisma/schema.prisma` — add `Post.linkStatus Json?` (or reuse `lastLivenessCheckAt` + new column), migration.
- `MKTAgent/src/leads/sources/post-liveness.ts:25-62` (`checkPostLinks`) — always persist `results` (not just on self-heal branch).
- `MKTAgent/src/api/posts-router.ts` `toPostDto` (find its def) — include `linkStatus` in DTO.
- `MKTAgent/web/src/components/LeadsPage.tsx:48-59` (`load`) — seed `linkStatus` state from `p.linkStatus` instead of leaving `{}`.

**P1** — none blocking; scheduler/reaper cron logic itself is sound. Confirm `.env` actually has `ENABLE_SCHEDULER_CRON=1`/`ENABLE_REAPER_CRON=1`/`ENABLE_LEADS_CRON=1` in the running deployment (gitignored, can't verify from repo) — if any is unset, that whole subsystem is silently OFF in prod.

**P2** — `sweepPostLiveness` throttle (`LEADS_LIVENESS_THROTTLE_HOURS`) — once P0 lands, verify the periodic sweep's write uses the same persist path so UI shows fresh-ish status without the user clicking, not just after manual check.

---

## Unresolved questions
1. Is `ENABLE_SCHEDULER_CRON` / `ENABLE_REAPER_CRON` / `ENABLE_LEADS_CRON` actually set to true in the deployed `.env`? Couldn't verify (gitignored, not read per rules). If false, cron subsystems are dormant regardless of code correctness.
2. Exact `toPostDto` location/shape not opened in this pass — needed to confirm DTO change surface for P0 fix.
3. Whether product wants the UI to auto-refresh link-status via the periodic sweep (silent) vs strictly on manual click (explicit) — affects whether P0's persisted value should also drive a "last checked Xh ago" UI label.

Status: DONE
Summary: Cron/reaper/scheduler are real, DB-backed, env-gated (default off) and race-safe; the link-status bug is confirmed root-caused to `checkPostLinks` (post-liveness.ts:25-62) computing alive/dead per platform on every button click but only conditionally writing DB on self-heal, never persisting the actual per-platform status — the web UI holds it in transient `useState` (LeadsPage.tsx:46,127) that resets on refresh.
