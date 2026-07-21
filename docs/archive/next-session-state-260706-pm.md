# Next-session state — 2026-07-06 (end of day, PM)

Branch `pivot/video-content-farm`, pushed through **`c3e844b`**. Working tree clean.
Repo https://github.com/autoagentsolution-boop/agent_portal (private).

## ⚠ DO THIS FIRST (before manual testing)
1. **Backend container** was force-recreated with all backend code + migrations. If unsure, from
   `MKTAgent/`: `docker compose up -d --build --force-recreate app`.
2. **Web** is served by **vite dev (:5173)** (`npm run dev` in `web/`), NOT the container (API-only :7100).
3. **`.env` crons enabled this session (gitignored, NOT committed):** `ENABLE_SCHEDULER_CRON=true`
   (was OFF — scheduled posts never published before!), `ENABLE_LEADS_CRON=true`, plus existing
   `ENABLE_TOKEN_CRON`. Scheduler = every minute, **publishes REAL posts**. COPYGEN cron still off.
4. Migrations added today (PM): `post_copy_edited`, `llm_usage_ledger`, `system_flag_kill_switch`,
   `post_version_count`, `lead_collector_status`.

## What shipped today (PM session) — all committed + pushed
- **Atria Phase 02 + 05-A** (agent layers + persona schema) — `ef255bb`, `1e54cd9`.
- **Gemini cost accounting** — real usageMetadata + thinking tokens + `mkt_llm_usage` ledger across
  ALL surfaces + `GET /orchestration/usage`; fixes ~100× undercount — `f614803`.
- **Atria Phase 03** — credit model + multi-tier plans + kill switch + tier-apply + web surfaces —
  `8809031`, `31cb5ed`, `3d696c6`.
- **Fixes batch** — copy-gen truncation (thinking off), scheduler waits for active flow before
  publishing, video approval ≠ auto-publish, concept `versionCount` (default 1), lead-collector
  deleted-post detection + all-5-platforms + 30-min cron, web UI — `8763f7c`, `d030b97`, `7398b4f`, `c3e844b`.

See `docs/project-changelog.md` for detail; memory `project_fixes_and_collector_expansion`,
`project_atria_phase03_credit_safety`, `project_llm_cost_accounting`, `project_atria_phase02_agent_layers`.

## RESOLVED — "LinkedIn post not in Leads" (keyword gap) → activate-from-Leads
- Root cause: a post only becomes a collector when a `leadCaptureKeyword` is set (the opt-in trigger).
  DB check: 13 posts, only 1 had a keyword → LinkedIn/multi-platform test posts correctly weren't shown.
- FIX (pushed `493ee84` + `c733db1` + `39cdb2e`): **`POST /posts/:id/collector { keyword }`** sets the
  keyword and, on an already-published post, BACKFILLS comment watch sources from the live postUrls
  (recordCommentSources) so it starts collecting across every platform at once. `keyword:null` stops it.
  Leads page now lists every PUBLISHED post (posted/partial) with live state (🟢 collecting / 🟡 pending
  / ⏸ not collecting) + inline keyword input + Start/Stop. Deleted posts (leadCollectorStatus=post_deleted)
  are HIDDEN from the list; the leads they already captured PERSIST (mkt_lead cascades only with the
  owner, never the post). Verified the posted LinkedIn post's URLs parse for all 5 platforms.
- Still worth considering: capture the keyword IN the Master-Agent flow so new posts collect from
  publish time (option 2) — deferred; the activate-from-Leads path covers the immediate need.
- **Link liveness + expiry (pushed `074aedc` + `e58c914`):** `GET /posts/:id/link-status` checks each
  published platform link's existence (reuses PostGone signal) → 🟢/🔴/⚪ per platform, self-heals dead
  watched sources (all-dead → post_deleted → hidden). Leads page shows ALL platform links + a Check
  button. **Collector expiry:** `post.leadCollectorExpiresAt` (migration) = now+30d on activate; the
  poller SKIPS expired collectors (no forever-polling); UI shows "expires in Nd"/"⏳ expired" + Extend.
  verify-leads-expiry 3/3. `src/leads/sources/post-liveness.ts`; TTL const `COLLECTOR_TTL_DAYS=30` in posts-router.

## Other deferred / next
- Threads/LinkedIn/X comment fetchers are **LIVE-UNTESTED** (no creds); LinkedIn `/v2` vs `/rest` +
  X elevated-tier are the risks. FB/IG proven.
- `ideation/strategy/storyboard` (llm-json.ts) still have gemini-2.5 thinking ON — disable if they truncate.
- OpenAPI `openapi.ts` behind on many routes; web hand-types at the boundary. Low value to sync.
- Abort is node-boundary granular (a long media node finishes first) — mid-node cancel = bigger change.
- Atria **Phase 04** (command-center UI) + **Phase 05-B/C** (agency-agents prompts + divisions view) remain.
