---
title: "Marketing + Lead-Gen n8n Pipeline"
description: "Sheet-driven multi-platform poster + inbound form lead capture, separate from the video farm"
status: pending
priority: P2
effort: ~14h (Phase 1 build) + design-only Phase 2
branch: pivot/video-content-farm
tags: [n8n, marketing, lead-gen, meta, google-sheets, google-drive]
created: 2026-06-23
---

# Marketing + Lead-Gen Pipeline

New n8n pipeline, **independent** of the video-content-farm. Google Sheet is the control plane;
n8n is a "read schedule → post → capture lead" engine. No scraping, inbound leads only (ToS-clean).

## Two-Loop Architecture

```
LOOP A — POSTING (cron-driven)                    LOOP B — LEAD CAPTURE (webhook-driven)
┌──────────────────────────────────┐              ┌──────────────────────────────────┐
│ Schedule Trigger (~every 20 min)  │              │ Form (Google Form / Tally)        │
│        ↓                           │              │   submit                          │
│ Google Sheets: read `calendar`    │              │        ↓ POST                      │
│        ↓                           │              │ n8n Webhook /webhook/mkt-lead     │
│ Filter: status=ready AND          │              │  (shared-secret auth)             │
│         scheduledAt ≤ now          │              │        ↓                           │
│        ↓ (claim row → status=posting)            │ Validate + dedupe (email)         │
│ Google Drive: download hero+slides│              │        ↓                           │
│        ↓                           │              │ ├─ Sheets append → `leads` tab    │
│ Platform-adapter fan-out:         │              │ └─ Gmail → Sales notification     │
│   FB Page ▸  Threads ▸ (X/IG P2)  │              │        ↓                           │
│        ↓ (per-platform status)    │              │ Respond 200 {ok:true}             │
│ Google Sheets: write-back         │              └──────────────────────────────────┘
│   status=posted|partial|error     │
│   postUrl, postedAt, error         │              The two loops share NOTHING at runtime.
└──────────────────────────────────┘              Sheet is the only shared artifact (different tabs).
```

**Idempotency:** Loop A claims a row (status `ready`→`posting`) before any network call, and writes a
per-platform result back. A row in `posting`/`posted` is never re-picked by an overlapping cron tick.

## Phases

| # | Phase | Status | Scope |
|---|-------|--------|-------|
| 01 | [Sheet schema + Drive layout](phase-01-sheet-and-drive-schema.md) | pending | calendar+leads tabs, Drive folder convention |
| 02 | [Posting workflow node graph](phase-02-posting-workflow.md) | pending | cron→read→claim→download→fan-out→write-back, idempotency, partial-failure |
| 03 | [Meta OAuth: FB Page + Threads](phase-03-meta-oauth-setup.md) | pending | reuse fb-token-refresh pattern; scopes, tokens, refresh |
| 04 | [Lead capture workflow](phase-04-lead-capture-workflow.md) | pending | form→webhook→leads tab + Gmail Sales email |
| 05 | [Platform-adapter abstraction](phase-05-platform-adapter-spec.md) | pending | how `platforms` column maps to format handlers |
| 06 | [Security + ops](phase-06-security-and-ops.md) | pending | vault, webhook auth, rate limits, token expiry, monitoring |
| 07 | [Phase 2 auto-gen migration](phase-07-phase2-autogen-design.md) | pending | DESIGN ONLY — Gemini+Slides+review gate |
| 08 | [Social-listening Loop C](phase-08-social-listening-loop-c-design.md) | design-only | DESIGN ONLY — Reddit listen + Claude draft, human posts; feeds Loop B |

## Key Dependencies

- **P01 → P02**: workflow reads the schema P01 defines.
- **P03 → P02**: posting fan-out needs Meta creds wired before it can post.
- **P05 ⇄ P02**: adapter spec is the contract the fan-out implements; build together.
- **P04 independent**: lead loop has no dependency on A; can build in parallel with P02/P03.
- **P06** spans all; finalize after P02–P05 node graphs are settled.
- **P07** depends on Phase 1 running long enough to harvest "golden prompts" (rationale in P07).
- **P08** (Loop C) independent design; build only after Phase 1 live. Feeds Loop B, replaces nothing.

## File Ownership (no overlap)

| Artifact | Owner phase |
|----------|-------------|
| `n8n-workflows/mkt-post-scheduler.json` | P02 |
| `n8n-workflows/mkt-lead-capture.json` | P04 |
| `n8n-workflows/mkt-meta-token-refresh.json` | P03 |
| `docs/marketing-pipeline-setup.md` | P06 |
| `.env.example` (append marketing block) | P06 |

## Conventions Reused (scouted from repo)

- **Credentials via env-vars, NEVER literal keys in JSON** — `{{$env.FB_PAGE_ACCESS_TOKEN}}` style
  (`upload-to-platforms.json:89`, `fb-token-refresh.json:34`). Hard repo rule: never commit keyed n8n JSON.
- **Per-platform failure isolation** via `"onError": "continueErrorOutput"` + a separate error branch
  (`upload-to-platforms.json:53,99`).
- **Meta token refresh** = exchange long-lived token weekly + PATCH n8n credential via internal API
  (`fb-token-refresh.json:57-69`). Reuse verbatim, swap creds.
- **timezone `Asia/Bangkok`**, `scheduleTrigger` typeVersion 1.2, `httpRequest` 4.2 (scouted versions).
- **Import flow** + Windows `MSYS_NO_PATHCONV=1` gotcha per `docs/n8n-workflow-setup.md:34`.

## Decisions Locked (do not re-litigate)

- Control plane = Google Sheet (NOT Postgres). State machine lives in the sheet for idempotency.
  Postgres `run_log` reused only as optional audit sink, not as source of truth.
- Lead store = Sheet `leads` tab + Gmail to Sales. Sales does outreach manually.
- Phase 1 channels = FB Page + Threads only. X + Instagram adapters designed but Phase 2+. No TikTok.
- Phase 1 creative = manual (ChatGPT → Drive). Pipeline reads, does not generate.
- Empty slide folder → post hero+copy only, skip carousel.

## Open Questions — RESOLVED 2026-06-23

1. **Sheet row-claim atomicity** — RESOLVED: self-host n8n version uncertain → do NOT rely on `Settings →
   Concurrency = 1`. P02 uses a **Postgres advisory-lock** (`pg_try_advisory_lock`) as the primary claim
   mechanism around the read→`posting` write. Transactional, version-independent.
2. **FB Page type** — RESOLVED (unknown): P03 + P06 setup doc must include a detection step (classic Page vs
   new Pages-experience) at OAuth-wire time, since endpoints/tokens differ. Adapter branches on type.
3. **Threads account** — RESOLVED: brand will CREATE a Threads account before build. Plan keeps both FB Page
   + Threads adapters for Phase 1; user onboards Threads (`threads_basic` + `threads_content_publish`) in time.
4. **Form tool** — RESOLVED: **Google Form** + Apps Script glue (POST to n8n webhook on submit). P04 builds the
   Apps Script trigger + webhook receiver. NOT Tally, NOT n8n Form Trigger.
5. **Gmail send + mailbox** — RESOLVED (default): Gmail node on the **Sales mailbox** sends the lead notification.
6. **scheduledAt timezone** — RESOLVED (default): sheet authors write `scheduledAt` in **Asia/Bangkok**
   (matches existing video-farm workflows). Filter compares against `now` in same tz.
