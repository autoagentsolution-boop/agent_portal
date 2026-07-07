# Atria Campaign Intelligence — E2E Test Guide

End-to-end test plan for the 8-phase Atria work (commit `953903e`, branch `pivot/video-content-farm`).
Backend logic is proven by 9 DRY-RUN verify suites; this guide covers the **live-auth browser path**
the verifies can't reach. Follow top-to-bottom — later steps depend on earlier state.

## 0. Prerequisites

- **DB up + migrations applied.** Postgres via `docker compose up -d postgres` (port 5433). Apply:
  `cd MKTAgent && npx prisma migrate deploy && npx prisma generate`. New tables: `mkt_instruction`,
  `mkt_roadmap_demand`.
- **If running in Docker containers, REBUILD** — stale containers are the #1 cause of "feature not
  working" here. Code-diving a bug before rebuilding wastes time.
- **Backend:** `cd MKTAgent && npm run dev` (tsx watch, port 7100). Boot log should show
  `mktagent_listening`. Cron flags in `.env`: `ENABLE_SCHEDULER_CRON` is currently **on** (it will
  auto-publish granted posts once `scheduledAt` passes — see the ⚠ in step 5).
- **Frontend:** `cd MKTAgent/web && npm run dev` (vite). Log in with Google (the whole app is
  `requireAuth`-gated → 401 without a session).
- **For grounded content** (optional but recommended): `GEMINI_API_KEY` set so the strategist +
  copy-gen actually call Gemini. Without it, the deterministic fallbacks still plan, but content
  won't reflect the expert-prompt quality lift.

## 1. Content quality — expert prompts + user instructions (Phases 01–02)

Goal: prove a user instruction set once steers content across agents, and hard guardrails still win.

1. Sidebar → **✦ Atria** → the **Atria Instructions** box. Add e.g. `Always end the post with a
   specific question.` and `Never use emojis.` Confirm they list, toggle, delete.
2. Run any single post (Orchestrate → "Write a Facebook post about <product>" → save → execute in
   Active Flows → let concept_writer generate). **Expect:** copy honors the instructions (ends with a
   question, no emojis) — because `resolveInstructions` is injected into copy-gen too.
3. Guardrail-wins check: add `Write at least 3000 characters.` Generate again. **Expect:** the copy
   stays within the length/format guardrail (the hard OUTPUT CONTRACT is appended last and overrides
   user text). No unterminated JSON, no HTML.
4. API sanity: `GET /instructions` returns your rows; `source:"user"`. (The `memory` source is the v2
   Memory-Agent seam — not written by anything yet.)

## 2. Campaign strategist → content calendar (Phase 03)

⚠ **The strategist runs only from a SAVED, EXECUTED flow** — `OrchestratePanel` is plan-only.

1. Sidebar → **New chat** (Orchestrate). Type a **multi-post** intent, e.g.
   `Plan a month of content, 3 posts a week, for our AI automation platform on facebook and instagram`.
   - "campaign" alone does NOT trigger campaign scope (by design — it's the old rich single-post
     flow). You need "plan a month" / "N posts a week" / a duration/cadence.
2. **Expect the plan card** to show: `content_search?` → `ideation` → `strategy` →
   `campaign_strategist`, and **NO** concept/media/publisher (those belong to the materialized posts).
3. Save the flow (name it) → open it in **Active Flows** → **Execute**.
4. The run executes and **parks at the campaign strategist selection gate** (`needs_approval`).
   **Expect the Content Calendar editor** to render (not the generic "approve external action"
   button): ~12 slots (4wk × 3/wk), each with pillar / angle / format / platforms / day.

## 3. Review, materialize, grant (Phases 04–05)

1. In the calendar editor, **edit** a few slots (change a format, reword an angle, drop a slot, change
   day offset). Click **Approve & schedule**.
2. This calls the bridge `POST /orchestration/runs/:id/materialize-calendar` →
   - creates a **Campaign** from the run's goal (product/brand/language/platforms),
   - materializes each slot into a **Post + its own DAG + `scheduledAt`** (spread across the posting
     window, starting tomorrow),
   - resolves the strategist gate (run → completed),
   - returns `campaignId`, then the UI runs the **grant** handshake.
3. **Expect the cost-confirm step:** "You're about to let Atria run N posts… Estimated cost $X (≈N
   credits)." Click **Confirm & run**.
4. Verify in DB or the campaign board (step 4): N posts under the new campaign, each `status=brief`
   with a `runId` + future `scheduledAt`; their runs are `approvalMode=atria`, `scheduleConfirmed=true`.
5. **Idempotency:** re-materializing the same calendar (if you re-run) sweeps the un-published posts
   and replaces them — total stays N, never doubles; a `posted` post is never swept.

⚠ **Autonomous publish caution:** with `ENABLE_SCHEDULER_CRON` on, granted posts **will publish for
real** once `scheduledAt` passes **and** the target platform is connected. For a safe dry test: don't
connect the platforms (each post holds at its publish guardrail + notifies — never a dead-token
publish), OR keep `scheduledAt` in the future. Do NOT connect + wait unless you intend live posts
(Meta 24–48h ban risk on burst posting — see `feedback_no_burst_social_posts`).

## 4. Campaign command board (Phase 05 surface)

- **✦ Atria** page with a campaign selected shows the **command board**: a status dot per post
  (planned / running / held-needs-you / posted / failed) + scheduled time, polling every 8s.
- `GET /campaigns/:id/status` backs it. A held post (unconnected platform) shows **Needs you** while
  siblings proceed — the per-post-guardrail story.

## 5. Proactive suggestions (Phase 06)

- The **suggestion cards** at the top of ✦ Atria are derived from your own history (no PII):
  - **≥3 one-off posts for the same product, no campaign** → "Plan a full month for X?" → accept
    prefills the Orchestrate composer with the intent.
  - **≥5 captured leads** → pitch the Email roadmap agent → accept logs demand (no agent runs).
  - **high edit ratio** (you kept rewriting copy) → pitch the **Memory Agent** ("remember your style").
  - **a completed campaign** → "Repeat what worked?"
- To trigger #1 quickly: create 3 single-post campaigns for the same product, then reload ✦ Atria.
- A roadmap pitch is shown **once** then suppressed (dedup via the demand log) — reload shouldn't nag.

## 6. Impact report (Phase 07)

- ✦ Atria shows the **period impact** (last 30d) and, with a campaign selected, the **campaign
  impact**. Two clearly separated sections:
  - **Measured** — spent ($ + credits), posts published, platforms, media pieces, leads. These must
    **reconcile with the 📊 Usage page** (same `mkt_llm_usage` ledger).
  - **Estimated (labeled)** — cost saved vs agency, time saved, est. reach. Derived from the
    `IMPACT_*` env constants (agency $500/day, 2h/post, 300 reach/post by default). Never presented as
    measured.
- Headline reads e.g. "$0.62 spent (≈120 credits) vs an estimated ~$500 / 1 days with an agency — N
  posts across 2 platforms, K leads."

## What to watch for (likely break points)

- **Strategist gate shows the generic approve button, not the calendar** → the run's parked node isn't
  `campaign_strategist` (scope wasn't detected as campaign) OR no `content_calendar` artifact. Re-check
  step 2's intent phrasing.
- **Materialize 404** → campaign not created / wrong tenant. **Grant "over cost ceiling"** → a
  video-heavy calendar exceeded `ATRIA_AUTONOMY_COST_CEILING_USD × posts`; raise the env or drop video
  slots.
- **Impact shows $0 but posts published** → ledger rows didn't attach `runId`/`refId`; check the
  agent-runner recording. **Leads = 0 on a campaign** → leads attribute by `sourceProduct` matching the
  campaign product (no campaign FK on `mkt_lead`).
- **Publishing failures** are expected for IG/Threads/X locally (`docs/publishing-media-constraints.md`)
  — FB is the only demo-safe live target.

## Unresolved / follow-ups

- Real platform reach metrics (v2 Analytics agent) — impact reach is a labeled estimate for now.
- Memory Agent as a runner (learned instructions) — v1 only ships the manual instruction system + the
  `source:memory` column + the pitch.
- Real-Gemini quality A/B: compare copy before/after the expert-prompt lift (subjective; no automated
  check).
