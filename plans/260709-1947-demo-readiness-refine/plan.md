# Demo-Readiness Refine — last day before public demo for the customer

Branch: `pivot/video-content-farm` · 2026-07-09 · Priority: **SAFETY FIRST** (don't break what works),
then the demo flows, then WOW, then voice. Scope confirmed by user.

## Demo must SHOW (all four + forecast + voice)
1. Plan campaign via Atria chat (works) — 2. Auto-prepare via per-post grant (needs e2e verify) —
3. Neural network "alive" (node light-up during real runs) — 4. Insights + Impact measured (works) —
+ transparent per-post cost forecast (verified accurate: video 18cr vs image 9cr = different agent sets) —
+ **VOICE**: Atria replies AND reads reports aloud (new build, from the P4 Arch-A pipeline spec).

## Ordering (safety → flows → WOW → voice), each step = green + browser-verified + committed
### P0 — Safety / regression (DEMO-BLOCKING, do first)
- [ ] **R1 — Full click-through of the new shell.** Every top-nav destination (Command Center, Impact,
  Instructions, Connections, Usage, Scheduled, Knowledge, Leads), Workspace ▾ drawer, Chats ▾, at
  desktop + a narrow width. No dead routes, no overflow, no console errors. Fix regressions.
- [ ] **R2 — Verify per-post grant END-TO-END (currently only Step-1 tested).** Grant ONE cheap image
  post → autonomy runner prepares pre-steps → parks at `needs_approval` (NOT DRY-published) → edit +
  approve → `ready` → scheduler publishes at scheduledAt (DRY-verify the publish). Confirms B1+B2 live.
- [ ] **R3 — Verify B2 didn't break the existing campaign-grant.** A campaign-level grant still runs +
  parks correctly (no DRY end-to-end publish, no stuck runs). Reap/scheduler unaffected.
- [ ] **R4 — Core publish + insights flows still work post-refactor.** Post → PostWorkflowView → execute
  → approve → publish gate; Impact shows measured insights. (Spot-check, no new real burst posts.)

### P1 — Close functional gaps (small, high-value)
- [ ] **G1 — Grant on the post view (PostWorkflowView).** Add the "⚡ Chuẩn bị" grant next to Execute for a
  planned campaign post (thread postId in). The user opens Scheduled→post and expects it there.
- [ ] **G2 — "Đang chuẩn bị…" state.** After grant, show a clear "Atria đang chuẩn bị" indicator on the
  post (planned + approvalMode atria) until it parks at review. (F2.)
- [ ] **G3 — Forecast surfaced at plan time.** Confirm the whole-plan credit estimate is visible on the
  Atria plan card / grant confirm; make the per-post cost basis (video vs image) legible in the demo.

### P2 — WOW polish (high visibility for the demo)
- [ ] **W1 — Node light-up during REAL runs (SSE-driven).** When a run executes, light/pulse the agent
  node whose SSE `node.status=running` fires; dim on complete. Reuse the run-event bus. This is the
  "agents gather + work" moment on the neural graph. (Decorative core pulse already exists.)
- [ ] **W2 — Dark-restyle the CC-landing suggestion + resume cards** (currently light on dark).
- [ ] **W3 — Workspace drawer discoverability** — a clearer affordance so the dashboard is findable.

### P3 — VOICE (biggest new build — from the existing P4 Arch-A pipeline spec)
- [ ] **V1 — TTS backend seam.** Endpoint/service that turns an Atria reply or an Impact report into audio
  (reuse `ai-multimodal` TTS / Azure TTS per research). Owner-scoped, cost-tracked. Cache per message.
- [ ] **V2 — "Read aloud" on Atria replies + Impact report.** A speaker button on each agent bubble and on
  the Impact report → plays the TTS. The typewriter reveal seam (P3) drives the cadence.
- [ ] **V3 — (stretch) auto-narrate** the report when opened. Gate behind a toggle; demo-only if time.

### P4 — Demo prep
- [ ] **D1 — Clean demo data.** Delete the 4 test posts + Drive test image; seed/curate a clean campaign
  with nice measured Impact numbers for the show.
- [ ] **D2 — Rehearsed demo script** — the exact click path for the 4 flows + forecast + voice, timed.
- [ ] **D3 — Docs** — update ./docs for the new shell (top nav, CC-hosted chat, per-post grant).

## Risks / time tension
- Voice (P3) is a real build; with SAFETY-FIRST, it may not fully land — keep V1+V2 minimal, V3 stretch.
- Node light-up (W1) is the biggest WOW-per-effort; prioritize it within P2.
- Every change ships as its own commit + browser-verify so a demo-day regression is trivially revertible.
