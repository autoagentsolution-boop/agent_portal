# Demo Fixes + P4 + P5 — merged plan (post-QA)

Branch: `pivot/video-content-farm` · 2026-07-09 · Proposed AFTER the QA swarm (Reviewer, Red-team,
Tester, QA-planner) on the P1/P2/P3 build (commits `d6dcf30..b99630e`). Source reports in
`plans/reports/*260709-2100*`.

## Progress (2026-07-09 EOD — user chose F1 Option B; stopping here, big plan tomorrow)
DONE this session (commit after b99630e): **F1** (Option B — grant copy now says "tự đăng theo lịch",
matches auto-publish, across all 4 grant surfaces) · **F2** (atria dead-end recovery — Execute restored on
failed/needs_connection) · **F3 watchdog** (32s stall → manual Execute + hint) · **F6** (read-aloud
double-click ref-guard + `/voice/tts` 1.5s per-owner throttle). Backend tsc + web build green;
verify-campaign-grant re-run PASS.
DEFERRED to tomorrow's big plan: **F3 env** (strict boolean parse — latent; all ENABLE_* are `true` now so
harmless) · **F4** (SSE multiplex — 3rd standing stream; riskiest, touches working hooks) · **F5** (hide
grant on non-campaign posts — WorkflowRun has no direct campaignId, needs DTO plumbing) · **F7** (reconcile
2 stale verify assertions) · all of **P4** (D1 delete-real-posts needs explicit sign-off) and **P5**.

## Reconciliation note (important)
Tester headline "publisher never resumes / nothing posts" = **misdiagnosis**. Re-ran directly: publisher
DOES complete + post (`ok publisher completed`, `ok atria: publisher completed autonomously`). The two
failing verify scripts carry **stale assertions** vs. the intended safety-parking; executor untouched by
this build → not a regression. See F7.

## FIX PHASE — ranked (each = own commit + verify + browser-check)

### P0 — Safety / demo-blocking
- [ ] **F1 [SAFETY, decision needed] — Granted *scheduled* post can auto-publish for REAL with no
  post-generation review, while the G2 copy promises "dừng ở review."** Root (red-team, strong evidence):
  in atria mode `autoPublish:false` is a no-op (`workflow-executor.ts:331` waiver guarded `if(!atriaMode)`);
  the atria publish gate auto-clears when guardrails hold → post parked **`ready`** → the **scheduler**
  (`tick.ts:228` `runtimePublishFn`) publishes for REAL, gated only by `scheduleConfirmed` — which every
  grant UI sets `true` (`post-workflow-view.tsx`, `scheduled-view.tsx`, `workspace-panel.tsx`,
  `content-calendar.tsx`). Consent/behavior mismatch = the Meta-burst-ban risk from memory.
  **Decision (see question):** (A) grant passes `scheduleConfirmed:false` → scheduler HOLDS → human
  approves at review (matches copy, safest); (B) keep auto-publish, change copy to "tự đăng theo lịch";
  (C) DRY-only demo — gate the scheduler for atria runs behind a separate explicit-approve flag.
- [ ] **F2 [P1, this build] — Granted run that errors mid-prep is a UI dead-end.** `isAtriaGranted`
  suppresses `canExecute` for ALL states incl `failed`/`needs_connection`; `preparing` only covers
  `planned`/`running`; `claimNextGrantedRun` re-claims only `planned` → an atria run that errors shows no
  Execute, no grant, no spinner; cron never retries → post bricked. Fix: on atria `failed`/`needs_connection`
  restore Execute (or an "Atria dừng — tiếp tục thủ công / gỡ tự động" recovery).
- [ ] **F3 [P1, this build + pre-existing] — "Đang chuẩn bị" poll spins forever if autonomy cron off.**
  8s poll waits on the cron with Execute suppressed + no watchdog. Compounded: `env.ts` `z.coerce.boolean()`
  turns `"false"`/`"0"` → `true`, so `ENABLE_AUTONOMY_CRON=false` can't actually disable it. Fix: client
  watchdog (≈30s → surface manual Execute) + strict boolean env parse (affects all `ENABLE_*` flags).

### P1 — Visible blemishes (this build)
- [ ] **F4 [P2] — 3rd standing SSE EventSource** (`use-agent-activity`). With use-run-events +
  use-workspace-events = 3 live streams/tab; Vite HTTP/1.1 ~6-conn cap → 2 tabs stall all `fetch()`.
  Multiplex activity onto one shared `/events` subscription (or fold into an existing hook).
- [ ] **F5 [P2] — Grant button shown on non-campaign posts → guaranteed 409 toast.** `canGrant` lacks a
  campaign check. Fix: thread campaign eligibility (add `campaignId` to run DTO, or hide until known).
- [ ] **F6 [P2] — Read-aloud double-click race + `/voice/tts` has no rate limit** (unbounded Gemini-TTS
  spend by varying text). Fix: disable button while loading; per-owner rate/concurrency cap on the route.

### P2 — Pre-existing (not a regression from this build)
- [ ] **F7 — Reconcile 2 stale verify assertions.** `verify-executor` (no-media post: test wants fail-loud,
  currently publishes) + `verify-concept-gate` (wants auto-publish-after-selection, correctly parks at
  publisher). Decide product intent (should text-only publish? should selection auto-publish?) then fix the
  test OR the behavior. 12/14 verify scripts green; typecheck green; `/voice/tts` auth-gated ✓.

## P4 — Demo prep (deferred from prior plan)
- [ ] **D1 — Clean demo data.** Delete the 4 live test posts + Drive test image (ids in memory); seed one
  clean campaign with nice measured Impact numbers.
- [ ] **D2 — Rehearsed demo script.** QA plan already ships a 12-step timed happy-path
  (`qa-e2e-test-plan-260709-2100.md`) — lift into a one-pager, rehearse after F1–F3 land.
- [ ] **D3 — Docs.** Update `./docs` for the new shell (top nav, CC-hosted chat, per-post grant, voice).

## P5 — Design consistency + "alive" amplification (MULTI-AGENT, "sau này")
- [ ] **DC1 — Design team:** `ui-ux-designer` audit → ONE design system (tokens/spacing/type/color,
  dark/light strategy); senior design-review pass (kill AI-slop); `fullstack-developer` implements
  unified tokens per-page, each shipped + verified separately.
- [ ] **DC2 — Lock ONE theme direction** (whole-app dark neural skin OR deliberate light/dark split with
  shared tokens), apply everywhere.
- [ ] **DC3 — Amplify Atria "alive":** node choreography (sequenced activation as the plan runs), reactive
  edge-energy, richer core states (idle→thinking→speaking), sync graph pulse to VOICE narration.

## Full e2e test plan
`plans/reports/qa-e2e-test-plan-260709-2100.md` — 12 sections, 50 cases (shell, plan-a-campaign,
text/image/video gen, style-by-instruction, manual + scheduled publish, per-post + campaign grant, node
light-up, voice, impact, cross-cutting) + timed demo script + safe-demo notes.

## Recommended order
F1 (decision first) → F2/F3 → re-run verify-executor/campaign-grant → F5/F4/F6 → F7 → D1/D2/D3 → P5.
