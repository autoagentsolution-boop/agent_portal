# Per-Post Autonomy Grant ("Prepare & schedule")

Branch: `pivot/video-content-farm` · 2026-07-09 · Scope: MKTAgent (backend + web)

Let a user grant autonomy on ONE post created from a campaign plan (not campaign-wide, not manual —
manual posts are already covered by Execute + scheduler). Granting = auto-run the pre-steps (concept/
media), PARK before the publisher for the user to edit + apply their tone, then the scheduler publishes
the approved post at its scheduled time. A cost forecast is shown before the credits are spent.

## Locked decisions (user)
- Grant is **per individual post** created from a campaign plan. Manual posts → not this flow (scheduler covers).
- Forecast: whole-plan estimate at Atria's plan suggestion (EXISTS: plan cards) + this post's estimate in the
  grant confirm (Step-1) + per-agent ACTUAL credits shown only after each node runs (EXISTS).
- Tone: reuse existing **Instructions/Memory** (workspace tone rules) — no new tone field.
- No user-facing variant: grant = ONE consistent behavior "prepare + park at review", then scheduled publish.

## What already exists (reuse, don't rebuild)
- `grantAutonomy(runId, ownerId, scheduleConfirmed)` — flips ONE run to `approvalMode:'atria'` (workflow-run-repo:409).
- Autonomy runner claims `{approvalMode:'atria', status:'planned'}` runs and executes them (autonomy-runner).
- `estimateCampaignCost` / `plan-estimate.ts` — real per-agent cost estimate from history.
- Campaign grant 2-step token (issue/verify) — the confirm mechanism to mirror per-post.
- Executor HALTS before the publisher when `autoPublish:false` → `needs_approval` (workflow-executor:4).
- Per-post manual **▶ Execute** + review/edit/approve gate (PostWorkflowView) — the manual equivalent.

## The one real behavior change
Autonomy-runner today runs granted runs with `autoPublish:true` + `dryAutonomyPublish` (machine-approves +
fake publish). For "prepare + park" it must run with **`autoPublish:false`** so the run stops at
`needs_approval` (real content generated, nothing published). The scheduler does the REAL publish later,
after the user approves → `ready`. This makes grant a single safe behavior (never auto-publishes).

## Phases
- [ ] **B1 — Per-post grant endpoint.** `POST /posts/:id/grant-autonomy`, 2-step mirroring campaign grant:
  Step-1 (no token) → estimate THIS post's run (reuse `estimateAgents` over the run's node agents) + issue a
  per-post confirmation token; return `{estimate, confirmationToken, status}`. Step-2 (echo token) →
  `grantAutonomy(post.runId, ...)`. Guard: post has `runId`, belongs to a campaign, status grantable
  (brief/planned; reject running/posted). Owner-scoped.
- [ ] **B2 — Runner parks instead of DRY-publishing.** Autonomy-runner runs granted runs with
  `autoPublish:false` (drop the DRY machine-publish) → pre-steps run → park at `needs_approval`. Verify a
  granted post reaches `needs_approval` with real content, nothing on the wire.
- [ ] **F1 — Per-post grant UI.** A "Chuẩn bị tự động" button on campaign-plan BRIEF posts (gate: status
  brief/planned + has runId + under a campaign). Click → grant Step-1 → show forecast card (this post's
  credits) → "Confirm & prepare" → Step-2 grant. Surface in PostWorkflowView; optionally a compact action
  on the Scheduled row. Reuse the ContentCalendar confirm card styling.
- [ ] **F2 — Post-grant states.** Granted-but-not-yet-run shows "Đang chuẩn bị…"; parked shows the existing
  review/edit gate (pick concept version, edit copy, tone from Instructions/Memory) → approve → `ready`.
- [ ] **V — Verify end to end.** Grant a BRIEF post → runner prepares → parks at review → edit + approve →
  `ready` → scheduler publishes at `scheduledAt` (DRY-verify the publish; no real burst).

## Gating: campaign-plan vs manual
Materialized posts have `runId` + `scheduledAt` + `campaignId` + `status:'brief'`. Show grant on
`brief/planned + runId + campaignId`. A manual brief post with a runId would also qualify (harmless — grant
works there too). If a hard split is needed later, add a `source` marker on Post; not required for v1.

## Risks
- B2 changes existing campaign-autonomy behavior (park instead of DRY-publish) — SAFER (never auto-publishes),
  matches the user's model. Confirm no flow depended on the DRY end-to-end publish.
- Real credit spend on grant (pre-steps run for real) — the forecast + 2-step confirm gate it; owner-scoped.
