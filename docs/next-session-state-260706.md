# Next-session state — 2026-07-06 (end of day)

Branch `pivot/video-content-farm`, **pushed through `1abe71b`**. Working tree clean. Repo
https://github.com/autoagentsolution-boop/agent_portal (private).

## ⚠ DO THIS FIRST (before manual testing)
1. **Backend container** was last rebuilt today with all backend code. If unsure, from `MKTAgent/`:
   `docker compose up -d --build` (applies the 4 new migrations via `migrate deploy`).
2. **Web** is served by **vite dev (:5173)**, NOT the container — run `npm run dev` in `web/`. The
   container is API-only (:7100). Recent UI work is HMR-live; hard-reload if the bundle looks stale.
3. 4 migrations added today (all additive): `lead_intake_token`, `lead_pii_encryption`, `lead_score`,
   `lead_comment_capture`.
4. **PUBLIC_BASE_URL=http://localhost:7100** is now in `.env` (needed for X OAuth Connect).

## What shipped today (big session — all committed + pushed)

### A) Early fixes (morning)
- **#5 per-node runtime + token counts** in the DAG view (data already persisted; DTO+UI gap).
- **verify-api** poll windows widened to real media-gen latency.
- **Edit-brief 500** fix (updateMany rejected a relation write → set scalar FK).
- **Campaign posts → summary list + drill-in** (no more wall of full cards); post-create navigates.
- **Product Knowledge**: re-hydrate campaign brandContext, default save-to-library ON, 📚 library page.
- **Publisher image auto-degrade** (§#6): a carousel/video post degrades to `image` for image-only
  platforms (Threads/IG/LinkedIn/X) reusing a carousel frame / infographic / hero / upload — no skip.
- **Veo 429/503 backoff retry** (Tier-1 2-RPM bursts; not a quota exhaustion).

### B) X publishing — FIXED (real tweet + image posted)
Root cause: the pasted token lacked **write scopes** (not app-only, not tier). Fix = OAuth **Connect**
(PKCE) after setting `PUBLIC_BASE_URL=http://localhost:7100` (X allows localhost callback — no ngrok)
+ registering the callback WITHOUT a trailing slash. Also: a **Refresh token field** on the X card so
a pasted refresh token enables auto-refresh; X media-403 degrades to a text-only tweet.

### C) Lead Collector — Atria Phase 01 COMPLETE + verified
Plan `plans/260706-1040-atria-mvp-leads-priority/` (5 phases). Phase 01 all 6 gaps done:
- **§01.1 per-tenant intake tokens** — `LeadIntakeToken` (sha256-hashed, plaintext once); funnels
  present `x-intake-token`/`?t=` → lead lands on the right owner (was hardcoded SYSTEM_OWNER).
- **§01.2 PII encryption** — name/email/phone/message AES-256-GCM; dedupe on `email_bidx` (keyed HMAC).
- **§01.5 hybrid scoring** — rule layer on capture + LLM `POST /leads/:id/rescore`.
- **§01.3 Leads UI** — 🎯 Leads page: intake setup + scored table + **💬 Active lead collectors**.
- **§01.4/§01.6 comment-keyword** — per-post `leadCaptureKeyword` (e.g. "Atria AI"); a comment on the
  published FB/IG with keyword + email → opt-in lead. `commentSourceIds` recorded at publish write-back.
  **LIVE-VERIFIED**: post 75f70734 → poll reached FB Graph API (0 comments so far, no error).
- 5 verify suites green (tenancy/pii/scoring/comments + verify-api). `src/leads/` + `src/leads/sources/`.

### D) Late UI/IA fixes
- Concept versions stay visible after the gate is passed (review mode on the completed concept node)
  — a re-run had hidden them and users thought they were deleted (they weren't; artifact had 4).
- Sidebar: **Product Knowledge · Leads · Flows are peer top-level heads** (same level).
- Product Knowledge page: short summary + **+ Import product** + a **"From your campaigns"** section
  (surfaces campaign.brandContext knowledge, not just library entries).
- Fixed: Leads active-collectors 422 (limit 200→100); PK page now shows campaign brandContext.

## Where things stand / what's NEXT (Atria v2)
Phase 01 (Lead Collector) is DONE. Remaining v2 phases (plan folder above):
- **Phase 02** — agent layers (Memory API, Product Expert loop, Researcher via Gemini Google-Search
  grounding, Strategist lead-scoring, Editor tone-gate, Publisher optimal-time). Only Researcher is net-new.
- **Phase 03** — orchestration multi-tier plans + credit (transparent token passthrough) + 5 safety layers.
- **Phase 04** — UI adaptation to the command-center v2 look.
- **Phase 05** — adopt agent-definition schema + marketing prompts from `agency-agents` (persona catalog,
  NOT an engine). Do schema first (Phase 05-A) as the container for Phase 02 agents.

## To fully close comment-capture (live)
Comment `Atria AI <email>` on post 75f70734's FB post → 🎯 Leads → **Poll comments** → the lead appears.

## Verify status
All green vs rebuilt container: verify-api + verify-leads-{tenancy,pii,scoring,comments} +
verify-executor/per-platform/postability. typecheck + web build clean.
