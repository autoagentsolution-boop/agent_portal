# Observed Live Test (2026-07-15) — Running Report

**Driver:** headed agent-browser CDP :9333 · tenant `p6-demo-...@test.local` (seeded: leads Nghiep+Lam, Instruction "witty/punchy SME founders SE Asia", product memory), granted 20000 credits. No platform connections.
**Purpose:** retest yesterday's scripts + today's new features live; user observes, flags bugs.

## Scripts — ALL PASS

| # | Scenario | Result |
|---|----------|--------|
| S1 | Marketing multi-turn add/remove node | ✅ plan 4→ add video 6 → remove video+storyboard 4 (deterministic). Reply EN, "Save as flow" EN (BUG-2 ok). |
| S2 | Edit & refine to regenerate | ✅ (after BUG-A fix) — ✎ Edit + ✨ Refine appear + work (Refine regenerated shorter copy live). **Instruction applied + flips**: witty/emoji → changed Instruction to formal/no-emoji → new run copy went formal ("Streamline complex processes. Boost efficiency…"). P4 confirmed. |
| S3 | Schedule + manual post inherits setup | ✅ 🗓 Strategist detected (cadence), 12-slot inline calendar (per-slot asset-type+remove+platforms), FB+IG inherited (12 slots), pillars, approve-before-schedule. BUG-8 (no truncation) ok. |
| S4 | Schedule birthday email | ✅ email-by-name (Nghiep), Email Writer→⏰Scheduler→Email Agent, time parse ("Thu Jul 16 9:00 AM Asia/Bangkok"), confirm-ask, confirm succeeded cleanly (BUG-4 no flaky). |
| S5 | Lead collector | ✅ Leads page: Nghiep+Lam, intake setup, poll comments, encrypted. |
| S6 | Nurture email + Automatically (NEW) | ✅ enrolled 2 leads → touch1 intro drafted (LLM-personalized "Hi Nghiep…") → parked → **Nurture Inbox** shows thread + editable Subject/Body + Approve&send/Reject/Pause/Convert/Opt-out. Human-gated. |
| S6b | Doc summarize + Data Guard security | ✅ upload PII doc (attach-on-landing) → 🛡️Data Guard→Summarize → summary ZERO raw PII (Jane Doe/email/phone/card/diabetes all absent); scan masked [PERSONAL]2× [CONTACT]2× [FINANCIAL]1× [HEALTH]1× (examples pre-masked); bullets render list (BUG-6). Completed, debited 14cr. |
| S7 | Analyze | ✅ "0 posts published, 2 leads, spent $0.10" — real numbers, honest zero. |
| S8 | Memory | ✅ recalled "AI Automation Course… + AI onboarding tool + AI scheduling assistant" (seed + accumulated). |
| S9 | Market research + send email | ✅ (retry) — Content Search→Email Writer→Email Agent (BUG-7 research NOT dropped), real competitors (Heicoders/Vertical/Artifisial). ⚠ 1st attempt transient brain error (degrade), retry ok. |
| S10 | Nurture strategist + scheduler drip | ✅ = same drip as S6: 3-touch day 0/3/6 (intro/value/cta), gapDays=3 = "wait several days" no-spam; verify-nurture-drip 34/34 covers cadence. |

**BUG-3 (gate-after-content) validated live:** concept generates pre-connect (≈1cr/341tok), publisher parks `needs_connection` with "Connect Facebook to publish — your draft is ready and waiting." ✅
**Credit debit** validated across flows: 20000 → ~19908, debits on BOTH parked (concept, 2cr) and completed (summarize, 14cr; strategist ~76cr) runs; pill refreshes. ✅
**Attach-on-landing** (bug fix) validated: uploaded doc from landing → summarize flow. ✅

### BUG-A/B/SSE fixes made THIS session — UNCOMMITTED
- BUG-A edit/refine (saved-flow-detail.tsx + concept-copy-editor.tsx + post-workflow-view.tsx SSE + posts-router.ts edit-copy artifact sync)
- BUG-B credit reconcile-debit (credit-repo.ts reconcileRunDebit, workflow-executor.ts finally-wrap, workflow-run-repo.ts refine spend, copygen/service.ts, schema migration `credit_wallet_multi_debit_reconcile`)
- ⚠ behavior change flagged: a run that FAILS mid-DAG now bills partial spend (was free) — confirm matches product intent.

## Bugs found

### BUG-A — Edit/Refine copy controls missing in SavedFlowDetail — FIXED
"Approve & run now" navigates to `saved-flow-detail.tsx` (SavedFlowDetail), NOT post-workflow-view. SavedFlowDetail never had the ✎ Edit copy / ✨ Refine with AI controls or the re-run row, AND had the same "stuck on Running…" SSE bug (only reloaded run DTO on completed/failed, not `awaiting_approval`) — so `run.status` stayed optimistically `running`, hiding review affordances. Fixes: extracted shared `concept-copy-editor.tsx`, added edit/refine + rerun + SSE-reload-on-awaiting_approval to saved-flow-detail.tsx (+ same SSE fix in post-workflow-view.tsx), and fixed backend `POST /:id/edit-copy` to sync the `content_concept` artifact (was a real gap — hand-edits reverted on reload; mirrors existing `/refine`). Live-verified both paths; tsc clean web+backend. ⚠ saved-flow-detail.tsx now ~392 lines (>200 guideline) — future split.

### BUG-B — Parked runs never debit credits (under-billing) — FIXING
Ledger showed only `grant:20000`, ZERO debits, balance unchanged, despite 6 runs (all parked: 3 needs_approval / 2 needs_connection / 1 planned, 0 completed) that spent real Gemini tokens on concept-gen + one AI refine. Debit fires ONLY at terminal `completed` (`workflow-executor.ts` → `runCredits`→`debitRun`, idempotent `@@unique([runId,kind])`). Parked runs (no connection / awaiting approval) never complete → never charge. **Amplified by BUG-3**: un-connected runs now generate (spend) before parking. Refine/edit-copy LLM spend also uncharged. Fix in progress: reconciling delta-debit at every stop-point (park/complete/fail), race-safe, no double-charge on resume.

## Pending
- P4 instruction-flip (change Instruction → formal/no-emoji → new run → confirm tone flips).
- Scripts 3-10 (schedule+inherit, birthday email, lead collector, nurture email + auto, doc summarize+security+email, analyze, memory, market research+email, nurture strategist+scheduler drip).
- User question: does the gate always classify content requests as "marketing"? (to observe in remaining scripts).

## Unresolved
- Balance PILL refresh after debit (frontend) — confirm the top-nav pill updates once debits land.
