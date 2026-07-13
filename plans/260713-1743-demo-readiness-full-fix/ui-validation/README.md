# P6 — Real UI-flow validation log (2026-07-13)

Driven through the REAL browser at `localhost:5173` (agent-browser) against BE `:7100` + pg `:5433`, as a seeded throwaway tenant (`verify-p6-seed-session.ts`: 2 leads incl. "Nghiep", a workspace Instruction, a product memory). This is the phase that proves **API-green ≠ UI-works** — and it earned its keep: it caught **4 real bugs** the API/verify tests missed, each fixed and re-validated live.

## Scenarios

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| 1 | **P1 voice one-button / core central** | ✅ PASS | Core stays **150×150** (not 132px) in chat mode, central + glowing; shows "🎙 Tap to talk"; clicking core toggles "Tap to stop" ↔ "Tap to talk" (two-way bridge). `01a`,`01b` |
| 2 | **General chat (checklist #1)** | ✅ PASS | "3 hooks for a LinkedIn post" → conversational answer, **no forced marketing plan**. `02` |
| 3 | **P3 email by lead name** | ✅ PASS (after fixes) | "soạn email sinh nhật cho Nghiep" → resolves lead → proposes **✉️ Email** (email_writer→email_agent), approval-gated, no address asked. `03c` |
| 4 | **P2 strategist inline + single-vs-strategist** | ✅ PASS (after fix) | "🗓 Strategist campaign — ~12-post calendar" card → "▶ Draft the calendar" → **inline editable 12-slot calendar in chat** + "Approve & schedule". `04a`,`04c` |
| 7 | **P4 instructions ground ideas** | ✅ PASS | Replies + pillars are "witty, punchy, targeting SME founders in SE Asia" = the seeded workspace Instruction, in Atria's reasoning (not just content agents). `02`,`04c` |
| 8 | **P5 memory recall** | ✅ PASS (after fix) | "sản phẩm của mình là gì?" → recalls seeded "AI Automation Course" (cross-language). `08` |

STT audio round-trip (P1) can't run headless (no mic) — layout + toggle validated; real speech needs a manual mic check. Real Gmail send (P3) needs the user's connected account — draft/approval-gate validated live; DRY send + `nurturedAt` stamp green in `verify-nurture-email-from-chat.ts`.

## Bugs caught by P6 (all fixed + re-validated live)

1. **P2 inline calendar never rendered** — `pollStrategistGate`'s loop was gated on `mountedRef.current`, which a React-18 StrictMode dev double-mount left stuck `false`. Fixed: set `mountedRef=true` in a mount effect; don't gate the loop on it. → inline calendar now renders.
2. **P2 email flow mislabeled "📄 Single post"** — the PlanCard binary assumed post-or-campaign. Added an **✉️ Email** variant (`isEmailPlan`).
3. **P3 marketing/platform bleed** — the brain asked "which platform to post the email to?" and applied "target SME founders" framing to a personal birthday email (the workspace Instruction over-applying), and asked permission / lost the recipient across turns. Fixed in the brain prompt: an email is never posted to a platform; personal emails skip marketing framing; resolve+propose in one turn; re-run `find_lead` every propose turn.
4. **P5 cross-language recall miss** — a Vietnamese query never keyword-matched an English product fact, and `product`-kind facts had priority 0 → dropped. Made `product` an always-eligible default (like brand/preference); P5b embeddings still the real fix.

## Notes
- Voice STT: `webkitSpeechRecognition` exists in the automation Chromium but autoVoice needs a real mic to transcribe.
- Minor: language mirroring is mostly good (VN in → VN out) but occasionally replies EN to a VN message — pre-existing brain behavior, not touched this session.
