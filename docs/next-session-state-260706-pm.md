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

## OPEN — Lead collector needs a KEYWORD per post (the "LinkedIn post not in Leads" finding)
- The Leads page "💬 Active lead collectors" lists posts with a `leadCaptureKeyword` set. A post only
  becomes a collector when a keyword is set (the opt-in trigger: `keyword + email` in a comment → lead).
- DB check 2026-07-06 PM: 13 posts, **only 1 has a keyword** (`75f70734` "Atria AI", FB-only). Every
  LinkedIn/multi-platform test post has NO keyword → correctly not shown. NOT a bug.
- **UX gap:** posts created via the Master-Agent flow / published without ever setting a keyword never
  become collectors. Options to consider next session:
  1. Surface the keyword field IN the flow (Master-Agent capture or the post-create step), not only the
     brief form, so the user sets it before publish.
  2. Optional per-campaign default keyword auto-applied to new posts.
  3. Show published posts in a "not collecting (no keyword)" state on the Leads page with a quick
     "start collecting" action that sets a keyword + records comment sources.
- Also: `commentSourceIds` for the one keyworded post is FB-only (published before multi-platform
  support). Re-publish (or a poll) after setting keywords would record linkedin/threads/x ids now.

## Other deferred / next
- Threads/LinkedIn/X comment fetchers are **LIVE-UNTESTED** (no creds); LinkedIn `/v2` vs `/rest` +
  X elevated-tier are the risks. FB/IG proven.
- `ideation/strategy/storyboard` (llm-json.ts) still have gemini-2.5 thinking ON — disable if they truncate.
- OpenAPI `openapi.ts` behind on many routes; web hand-types at the boundary. Low value to sync.
- Abort is node-boundary granular (a long media node finishes first) — mid-node cancel = bigger change.
- Atria **Phase 04** (command-center UI) + **Phase 05-B/C** (agency-agents prompts + divisions view) remain.
