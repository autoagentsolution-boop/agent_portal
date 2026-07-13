# Demo-Readiness — Full Fix (no thin layers)

**Date:** 2026-07-13 · **Branch:** `pivot/video-content-farm` · **Status:** ✅ ALL 6 PHASES DONE — implemented, typecheck-clean, deterministic verifies green, driven live in-browser (P6). Uncommitted.

## Result (2026-07-13)
P4+P5a (instructions + memory into the brain preamble), P3 (find_lead email-by-name), P1 (voice one-button + core central), P2 (strategist inline calendar), P6 (browser validation) — all shipped. Backend typecheck clean; golden 23/23 + campaign-intent + reuse 21/21 + platform-inherit 6/6 = no regression; new verifies green (`verify-instructions-and-memory`, `verify-nurture-email-from-chat`). **P6 drove 6 scenarios in the real UI and caught+fixed 4 bugs the API tests missed** (P2 poll, P2 email label, P3 framing bleed, P5 cross-lang recall) — see `ui-validation/`. Not committed yet.
**Goal:** Close every gap between the demo checklist and reality with REAL end-to-end fixes (not band-aids), and verify through the actual UI flow (not just API).

## Demo-readiness matrix (audited 2026-07-13, 4 parallel codebase scans)

| # | Demo expectation | Verdict | Evidence | Gap → fix |
|---|---|---|---|---|
| 1 | Chat with Atria; understand + classify request | ✅ WORKS | `atria-brain.ts:120` general-first Gemini function-calling loop, 9 real tools | — |
| 2 | Send Birthday/Nurture email to leads; now or scheduled | 🟡 PARTIAL | send-now + scheduled both real (`workflow-planner.ts:136`), validated 2026-07-13; BUT recipient must be a typed @address — no lead-name lookup from chat (`agent-runners.ts:770`); lead-grounded nurture only in REST panel | **P3** lead-lookup tool in brain |
| 3 | Marketing branding; no single↔strategist confusion | 🟡 LOGIC ✅ / UX 🟡 | intent bug fixed today (campaign-intent 21/21); scope routing real (`workflow-planner.ts:48`); BUT strategist calendar NOT shown inline in chat — user must execute + navigate to Active Flows to see the proposal (`saved-flow-detail.tsx:284`) | **P2** render calendar proposal inline in chat |
| 4 | Create Post under single campaign inheriting prior setup | ✅ WORKS | platform-inheritance fixed today; chain campaign→post real (`posts-router.ts:80`, `campaigns-router.ts:69`) | — (verify in UI) |
| 5 | Refine post / change content | ✅ WORKS | LLM `/refine` + manual `/edit-copy`, FE-wired (`posts-router.ts:279`, `PostCard.tsx:201`) | — (verify in UI) |
| 6 | Ideas follow user Instructions; default to Atria if none | 🟡 PARTIAL | Instructions system real (`instruction-repo.ts`) but injected ONLY into content-agent prompts, NOT the brain/analyzer that generates the IDEAS (`build-agent-prompt.ts:41`); brain grounded by memory instead | **P4** inject Instructions into brain + analyzer |
| 7 | Voice or text with Atria, fast + efficient | 🟡 PARTIAL | STT/TTS/viz all real (`use-speech-recognition.ts`, `tts-player.ts`, `voice-viz.ts`); BUT layout collapses JARVIS core to 132px on chat, 3 fragmented voice controls, mic is one-way | **P1** unify voice+chat 1-button, keep core central |

### "Currently hard" items — root causes
- **User can't see how Atria proposes a strategist campaign** → the proposal calendar is real but only visible AFTER execute + navigation into Active Flows; the chat plan card never renders it. → **P2**.
- **What workflows can the current agent nodes do** → 14 live nodes, 9 composable DAG shapes (see `research/node-and-workflow-inventory.md`). Answered.
- **CC voice "redirects" to Atria chat page** → NOT a redirect (no router). CC page collapses its own layout: `.command-center.is-chat` (`styles.css:377-385`) shrinks the JARVIS core to 132px and the embedded OrchestratePanel takes over. → **P1**.
- **Voice + chat should be ONE button** → ~90% built (`App.tsx:98 launchVoice` + `OrchestratePanel autoVoice` sets both); needs a persistent two-way toggle + unify the 3 controls + keep core central. → **P1**.

## Memory subsystem — what it does + how to make Atria smarter (P5)
TWO stores, easy to conflate:
- **(A) UserMemory (`mkt_memory`)** — slot facts (product/brand/audience/preference), keyword recall (no embeddings). Captured ONLY on proposal turns, drops language/angle. Injected into the marketing analyzer (strong) but NOT the brain's conversational prompt → Atria is memory-blind when just chatting.
- **(B) Memory Agent** — hand-edited posts → Gemini style rules → `Instruction(source='memory')`, opt-in (user must Accept) → grounds `concept_writer`. Real preference learning, but manual.
Gaps → smarter: inject memory into brain prompt every turn; capture on reply turns + language/angle; embeddings for semantic recall; use `usedCount`/performance in ranking (currently a dead signal); UI to view/edit slot memory (none today). → **P5**.

## Workstreams (phases)
| # | Phase | Demo impact | Effort |
|---|-------|-------------|--------|
| P1 | [Voice+chat one-button, JARVIS core central](phase-01-voice-cc-unification.md) | HIGH (most visible) | M |
| P2 | [Strategist proposal inline in chat](phase-02-strategist-proposal-in-chat.md) | HIGH | M |
| P3 | [Nurture/birthday email by lead name from chat](phase-03-nurture-email-by-lead-from-chat.md) | HIGH | M |
| P4 | [Instructions ground Atria's ideas](phase-04-instructions-ground-atria-ideas.md) | MED | S |
| P5 | [Memory makes Atria smarter](phase-05-memory-smarter.md) | MED | M→L |
| P6 | [Real UI-flow validation (browser)](phase-06-ui-flow-validation.md) | HIGH (de-risks demo) | S |

## Principle
No thin layers: each phase ships real BE+FE wiring + a verify (API) AND a driven UI-flow check (P6), because the user's pain is that API-green ≠ UI-works. Reuse the validated scheduler/email/registry stack.
