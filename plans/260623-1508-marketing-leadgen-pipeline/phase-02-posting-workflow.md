# Phase 02 — Posting Workflow Node Graph (Loop A)

**Context:** [plan.md](plan.md) · [phase-01](phase-01-sheet-and-drive-schema.md) · [phase-05](phase-05-platform-adapter-spec.md).
Scouted patterns: `upload-to-platforms.json` (fan-out + `onError` branches), `fb-token-refresh.json` (cron+code).
**Priority:** P1. **Status:** pending. **Workflow file:** `n8n-workflows/mkt-post-scheduler.json`.

## Overview
Cron reads `calendar`, claims one due row, downloads assets from Drive, fans out to platform adapters,
writes per-platform results back. Idempotent and partial-failure-safe.

## Data Flow
- **In:** Sheet `calendar` rows (status=ready, scheduledAt≤now); Drive PNGs.
- **Transform:** row → claimed → assets(binary) → per-platform publish calls → result map.
- **Out:** Sheet write-back (status/postUrl/postedAt/error); optional `run_log` audit row.

## Node Graph
```
[1] Schedule Trigger (cronExpression "*/20 * * * *", tz Asia/Bangkok)
       ↓
[1.5] Postgres: SELECT pg_try_advisory_lock(hashtext('mkt-post-scheduler')) AS got_lock
       - reuse videofarm DB (port 5432, "Videofarm Postgres" cred — scouted upload-to-platforms.json:66)
       ↓
[1.6] IF got_lock == false → another tick already holds the lock → exit cleanly (no-op).
       Else continue (all of [2]–[11] run INSIDE the lock).
       ↓
[2] Sheets: read `calendar` (range A:M, header-named columns)
       ↓
[3] Code: filter + pick ONE row
       - keep status=="ready" AND scheduledAt<=now(Asia/Bangkok)
       - sort by scheduledAt asc; take first; emit {} if none → go to [U-unlock] (no-op exit)
       ↓
[4] Sheets: update row → status="posting"   ← CLAIM BEFORE any network call (inside advisory lock)
       ↓
[5] Code: parse platforms csv + build asset spec
       - platforms = row.platforms.split(",")
       - heroPath = `${driveFolderId}/hero.png`; slidesPrefix = `${driveFolderId}/slides/`
       ↓
[6] Drive: resolve folder → list children
       - find hero.png (REQUIRED). If missing → jump to [E-validate] error.
       - list slides/*.png; sort by name. Empty → carousel skipped (hero-only).
       ↓
[7] Drive: download hero (+ each slide) as binary  (binaryProperty per asset)
       ↓
[8] Switch/IF fan-out on platforms  ──┬─▶ [FB adapter subgraph]   onError: continueErrorOutput
                                       └─▶ [Threads adapter subgraph] onError: continueErrorOutput
       (each adapter = the container-publish chain from P05; emits {platform, ok, url|error})
       ↓
[9] Merge (mode: append, wait for all branches incl. error outputs)
       ↓
[10] Code: aggregate results
       - allOk → status="posted"; someOk → "partial"; noneOk → "error"
       - postUrl = JSON.stringify({fb:url, threads:url}); error = compact failure list
       - postedAt = now()
       ↓
[11] Sheets: update row (status, postUrl, postedAt, error)  ← write-back by row index
       ↓
[12] (optional) Postgres run_log: INSERT audit {event:'mkt_post', id, result}   (reuse run_log table)
       ↓
[U-unlock] Postgres: SELECT pg_advisory_unlock(hashtext('mkt-post-scheduler'))
       - ALWAYS released: reached on normal exit, no-op exit ([3] empty), and error path ([E-validate]).

[E-validate] Code: mark status="error", error="hero.png missing" → [11] → [U-unlock]
```
> **Lock release discipline:** every terminal path (success, no-row no-op, validation error, adapter failure)
> funnels through [U-unlock]. A held lock after a crash auto-releases when the Postgres session ends (advisory
> locks are session-scoped), so a worker crash cannot deadlock future ticks — the next tick gets the lock.

## Idempotency (critical)
- **Postgres advisory lock = PRIMARY claim mechanism** (chosen, not fallback). The self-host n8n version is
  uncertain, so we do NOT rely on `Settings → Concurrency = 1`. Instead node [1.5] acquires
  `pg_try_advisory_lock(hashtext('mkt-post-scheduler'))` against the already-running videofarm DB. If the lock
  is not acquired ([1.6]), another tick is mid-run → this tick exits as a no-op. The entire read→filter→claim→
  post→write-back sequence runs inside the lock, so two overlapping ticks can never claim the same row even
  with zero n8n concurrency configuration. Released at [U-unlock] on every path; session-scoped so a crash
  cannot deadlock (lock frees when the PG session dies).
- **Claim-before-act:** node [4] flips `ready→posting` before [6]/[8]. Combined with the advisory lock this is
  redundant safety — even if the lock layer were bypassed, an overlapping read in [2] would not see `ready`.
- **One-row-per-tick:** node [3] takes a single row → bounded blast radius, simpler write-back, respects
  per-platform rate limits naturally. Throughput = 1 post / 20 min = 72/day ceiling (ample for marketing).

## Partial-failure handling
- Each adapter branch uses `onError: continueErrorOutput` (scouted `upload-to-platforms.json:53`), so a
  Threads failure does NOT abort the FB branch.
- [9] Merge waits for ALL branches including their error outputs; [10] computes mixed state.
- `partial` is terminal → human inspects `error` col, fixes, manually re-arms row to `ready`. We do NOT
  auto-retry only-failed-platforms in Phase 1 (would double-post the succeeded platform). Documented limitation.

## Related Code Files
- **Create:** `n8n-workflows/mkt-post-scheduler.json`
- **Read for pattern:** `n8n-workflows/upload-to-platforms.json` (fan-out, error branch, Postgres node + cred)
- **Reuse:** "Videofarm Postgres" credential + videofarm DB (port 5432) for advisory lock — no new DB/table needed
- **Append:** `docs/marketing-pipeline-setup.md` (P06) import + activation steps

## Implementation Steps
1. Build nodes [1]–[12] + [1.5]/[1.6]/[U-unlock] per graph; bind Google Sheets, Google Drive, Meta creds
   (P03), Postgres creds ("Videofarm Postgres", reused).
2. Wire the advisory lock: [1.5] `pg_try_advisory_lock`, [1.6] IF gate, [U-unlock] `pg_advisory_unlock` on
   EVERY terminal path (success, empty-no-op, validation error, adapter failure).
3. Reference sheet columns by header name (P01 contract), expose row index for write-back.
4. Wire adapter subgraphs from P05 spec; set `onError: continueErrorOutput` on every publish node.
5. tz Asia/Bangkok. (Do NOT depend on an n8n concurrency setting — advisory lock is the guard.)
6. Smoke: seed row (hero-only, no slides), scheduledAt in past → run once → expect FB+Threads single-image
   post, status=posted, postUrl populated, lock released.
7. Concurrency smoke: trigger two executions back-to-back → second must no-op via [1.6], first posts once.
8. Negative smoke: delete hero.png from Drive → expect status=error, no network post, lock still released.

## Success Criteria
- [ ] Due `ready` row → posted to all listed platforms; status=posted; postUrl has per-platform links.
- [ ] Re-running cron immediately does NOT re-post (status no longer ready).
- [ ] Threads-down simulation → FB still posts → status=partial with Threads error noted.
- [ ] Empty slides → hero-only post succeeds (no carousel error).
- [ ] Missing hero → status=error, zero network calls.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|------------|
| Read-then-claim race double-posts | M×H | Postgres advisory lock [1.5/1.6] (PRIMARY) + claim-before-act; no reliance on n8n concurrency setting |
| Lock leaked / never released | L×H | [U-unlock] on every terminal path; advisory locks are session-scoped → auto-free on PG session end (crash-safe) |
| Drive download timeout on large slides | M×M | per-request timeout 120s (scouted `upload-to-platforms.json:22`); cap slides ≤20 |
| Write-back targets wrong row | L×H | target by stored `id` match, verify row index; never blind-index |
| Stuck in `posting` after crash mid-run | M×M | P06 monitoring: alert rows in `posting` > 30 min; manual reset |

## Security
- All tokens via `{{$env.*}}` — no literals in JSON (repo hard rule).
- Drive/Sheets via bound OAuth credential, least-scope (read calendar, write status; read Drive files).

## Next Steps
Depends on P03 (Meta creds live) + P05 (adapter contract). Audit sink optional via P06.
