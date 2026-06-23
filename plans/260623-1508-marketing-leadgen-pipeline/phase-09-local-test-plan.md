# Phase 09 — Local Test Plan (Phase 1)

**Context:** [plan.md](plan.md) · workflows in `n8n-workflows/mkt-*.json`. Run on the local Docker stack.
**Goal:** prove the two real loops work locally **before** wiring live Meta publish. Lead loop (B) is fully
testable today; posting loop (A) is testable up to the adapter stub (lock→claim→validate→write-back→unlock).

## Prerequisite fix (BLOCKER — do first)

The `n8n` service in `docker-compose.yml` has **no `env_file`**, so `{{$env.MKT_*}}` resolve to undefined.
Add to the `n8n` service block (mirror render-service):

```yaml
  n8n:
    image: n8nio/n8n:latest
    env_file:
      - .env            # <-- ADD: makes MKT_* + N8N_API_KEY visible to workflows
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      # ...existing...
```

Then recreate: `docker compose up -d --force-recreate n8n`. Verify:
`docker compose exec n8n printenv | grep MKT_` → must list the MKT_* keys.

> Also enable the public API (needed by mkt-meta-token-refresh's credential PATCH):
> add `- N8N_PUBLIC_API_DISABLED=false` (default is enabled, but confirm) and create an API key in
> n8n UI → Settings → n8n API → set it as `N8N_API_KEY` in `.env`.

## Test 0 — Stack up + schema check

```bash
docker compose up -d postgres n8n
docker compose ps                       # postgres healthy, n8n up
# run_log lives in videofarm public schema (Prisma); confirm reachable:
psql -h localhost -p 5432 -U videofarm -d videofarm -c "\dt public.run_log"
# advisory-lock sanity (locks are db-global, schema-agnostic):
psql -h localhost -p 5432 -U videofarm -d videofarm -c "SELECT pg_try_advisory_lock(hashtext('smoke')), pg_advisory_unlock(hashtext('smoke'));"
```
Pass = run_log table exists, advisory lock returns `t`/`t`.

## Test A — Lead capture loop (Loop B) — FULL e2e, no Meta needed

**Prep:**
1. Create the Google Sheet (`calendar` + `leads` tabs per phase-01). Put its ID in `.env` `MKT_SHEET_ID`.
2. n8n UI → create creds: "Marketing Google Sheets" (OAuth), "Marketing Gmail (Sales)" (OAuth).
3. Set `.env`: `MKT_LEAD_WEBHOOK_SECRET=test-secret-123`, `MKT_SALES_EMAIL=<your inbox>`.
4. Import + activate `mkt-lead-capture.json`. Webhook URL = `http://localhost:5678/webhook/mkt-lead`.

**A1 — valid lead (happy path):**
```bash
curl -s -X POST http://localhost:5678/webhook/mkt-lead \
  -H "Content-Type: application/json" -H "X-Webhook-Secret: test-secret-123" \
  -d '{"name":"Test Lead","email":"lead1@example.com","phone":"0900000000","message":"interested","product":"AgentPortal","platform":"facebook"}'
```
Expect: `{"ok":true}`, new row in `leads` tab, email in Sales inbox.

**A2 — bad secret → 401:** same call, `-H "X-Webhook-Secret: wrong"` → `{"ok":false,"error":"unauthorized"}`, **no** row written.

**A3 — invalid email → 400:** `"email":"notanemail"` → `{"ok":false,"error":"invalid_email"}`, no row.

**A4 — duplicate within 30d → logged, no 2nd email:** re-run A1 with same `lead1@example.com` →
`{"ok":true}`, row appended again, **no** Sales email (dedupe skip).

**A5 — attribution:** confirm `sourceProduct=AgentPortal`, `sourcePlatform=facebook` landed in the row.

## Test B — Posting loop (Loop A) — core, up to adapter stub

The FB/Threads publish is stubbed → expected terminal status = `error` ("adapter not yet wired"). What we
verify is the **machinery around it**: lock, claim, validation, write-back, audit, unlock.

**Prep:**
1. Same Sheet; "Marketing Google Drive" OAuth cred created.
2. Seed ONE `calendar` row: `status=ready`, `scheduledAt` = a past Asia/Bangkok time, `platforms=facebook`,
   `driveFolderId` = a real Drive folder containing `hero.png` (no slides → exercises skip-carousel).
3. Import `mkt-post-scheduler.json` (keep inactive — trigger manually via "Execute Workflow").

**B1 — happy machinery:** Execute once.
- Expect: lock acquired → row `ready→posting→error` (stub) → `error` col = "facebook:adapter not yet wired…"
  → `run_log` row `event=mkt_post` level=error → lock released.
- Verify lock freed: `psql ... -c "SELECT pg_try_advisory_lock(hashtext('mkt-post-scheduler')), pg_advisory_unlock(hashtext('mkt-post-scheduler'));"` → `t`,`t`.

**B2 — idempotency / no double-pick:** Execute again immediately. The row is no longer `ready` (now `error`),
so `Pick one due row` finds nothing → `hasDue=false` → straight to Release lock (no-op). No second write-back.

**B3 — concurrency (advisory lock):** open two terminals, fire two `Execute` within ~1s (or briefly hold the
lock via psql in one session). Second run must hit `IF lock acquired = false` → clean no-op exit. No error.
> Manual lock hold: `psql ... -c "SELECT pg_advisory_lock(hashtext('mkt-post-scheduler')); SELECT pg_sleep(20);"`
> then trigger the workflow → it should no-op. Release with the session ending.

**B4 — missing hero → error path:** seed a 2nd row pointing at a Drive folder with **no** `hero.png`,
`status=ready`, past schedule. Execute → status `error`, error col = "hero.png missing", **zero** network
calls, lock released.

**B5 — empty result no-op:** set all rows to `posted`/`error`. Execute → `hasDue=false` → no-op, lock released.

## Test C — Token refresh (Loop, optional — needs Meta app)

Only runnable once `MKT_FB_*` + `N8N_API_KEY` are real. Until then, the Preflight node throws a clear
"missing env vars" error — that itself is a valid negative test (confirms preflight guards correctly).
- Manual execute with no creds → expect `mkt_meta_refresh: missing env vars: MKT_FB_APP_ID, …`. Good.

## What is NOT testable locally yet
- Real FB Page / Threads publish (needs verified Page type + Threads account + tokens — your tomorrow task).
- Google Form Apps Script → webhook (needs the Form; but `curl` in Test A simulates its exact POST shape).

## Exit criteria for "Phase 1 verified local"
- [ ] n8n sees MKT_* env (prereq fix)
- [ ] A1–A5 pass (lead loop fully green)
- [ ] B1–B5 pass (posting machinery green; adapter stub = expected error)
- [ ] B3 proves the advisory lock blocks overlap
- [ ] run_log has audit rows for each posting execution
- [ ] Next: wire real adapters (phase-05) → re-run B1 expecting status=posted
