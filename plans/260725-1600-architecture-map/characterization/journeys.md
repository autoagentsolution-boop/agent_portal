# FE Characterization — 4 P0 Journeys (agent-browser, live stack)

> **Phase-0 sub-phase. Records CURRENT behavior** so the Phase-3 App.tsx / client.ts decomposition
> can't silently change it. Ran 2026-08-01 on `refactor/full-product` against live BE:7100 +
> web:5173 + pg:5433 + Chromium CDP:9333, superadmin test tenant, **live Gemini** (real plan gen).
> Harness: `scripts/launch-fe-char.sh`. Baselines: `baselines/*.json`. Re-run after each Phase-3
> extract; a diff in any pinned field is a regression to explain, not to accept.

## Stack recipe
- Seed: `MKTAgent/src/scripts/seed-fe-characterization.ts` — mints superadmin tenant, 2 campaigns
  (Alpha/Beta) each with 1 `brief` post, 1 lead, 1 workspace instruction, 1 product memory, trial
  credits (2000). Prints USERID + CAMPAIGN_A/B + COOKIE. `--cleanup <USERID>` tears it down.
- BE boot: `GEMINI_API_KEY=<from .env> npx tsx src/server.ts` (live plan gen needs the key).
- Web boot: `VITE_API_BASE=http://localhost:7100 npx vite --port 5173`.
- Cookie: `agent-browser --cdp 9333 cookies set mkt_session <COOKIE> --url http://localhost:5173 --sameSite Lax`.

## Gotchas (kept — each cost real time)
1. **`click @ref` silently no-ops on this app.** Always `eval("…find(b=>…)?.click()")`.
2. **Landing composer is `<input>`; in-chat composer is `<textarea>`.** The INPUT→TEXTAREA swap is a
   *characterized invariant* (documented in App/OrchestratePanel) — do not normalize it. Submit the
   landing input with `press Enter`; the Send-button click is flaky after a reload.
3. **Chats dropdown has two title-matching buttons.** The menu item is the one whose text *starts*
   with the `💬` emoji; the other is a header. Match on the prefix.
4. **No chat-local close ✕ in the CC embed.** Close / release mic via top-nav **◈ Command Center**
   (`onNavigate('command-center')` → `App.closeCcChat` → `voicePanelRef.stopVoice`).

---

## J1 — cc-chat-send-and-reentry  ✅
**Drives:** landing send → live plan card, then nav away + reopen via Chats dropdown → transcript
re-hydrates with NO duplicate assistant reply / plan card. Pins the re-entry de-dup (`selectChat`
hydration + `orchestratePrefill` cleared so a restore never re-sends).

| field | baseline | meaning |
|---|---|---|
| `planCards` | 1 | exactly one WORKFLOW PLAN card after send |
| `assistantGreat` | 1 | one "I have everything needed…" reply |
| `approveBtn` | true | plan renders its Approve gate |
| `composerIsTextarea` | true | in-chat composer is a `<textarea>` (INPUT→TEXTAREA) |
| **re-entry** `planCards` | 1 | no duplicate plan after nav-away + reopen |
| **re-entry** `greatReplies` | 1 | no duplicate reply (de-dup holds) |
| **re-entry** `userMsgs` | 2 | user line appears in transcript + still-open composer echo (current DOM shape) |

`baselines/j1-cc-chat-send.json`, `baselines/j1-cc-chat-reentry.json`.

## J2 — cc-flow-execute-approve  ✅
**Drives:** reopen the persisted chat (run restored via `getRunByChat`) → Approve & run → Concept
Writer runs, Publisher parks at the approval gate (no live publish), credits debited, tokens shown,
no false insufficient-credits error. Pins the optimistic-run + gate + credit-reconcile chain.

| field | baseline | meaning |
|---|---|---|
| `conceptCompleted` | true | first node ran (SAVED FLOW view rendered) |
| `publisherPaused` | true | "Paused — approve to publish" — gate held, nothing published |
| `creditsSpent` | true | balance 2000 → 1,999 (real debit) |
| `tokensShown` | true | run shows ≈1 credit / 318 tokens |
| `realCreditsError` | false | no spurious insufficient-credits toast |

`baselines/j2-flow-execute-approve.json`. (402→credits-toast branch not reachable on a funded
tenant; covered structurally by the client.ts wrapper test `insufficient_credits` case.)

## J3 — campaign-postboard-merge  ✅
**Drives:** open Alpha board (A's post present) → open Beta board → back to Alpha → **A's post
survives** in the DOM, no infinite "Posts • Loading…". Directly exercises `mergePosts`
merge-not-replace + `useCallback` stability (the unit companion `App.merge-posts.test.ts` pins the
reducer; this pins it end-to-end through the real board load fan-out).

| field | baseline | meaning |
|---|---|---|
| `onA` | true | back on Alpha board |
| `aPostSurvives` | true | A's post id still in DOM after A→B→A (merge, not replace) |
| `infiniteLoading` | false | no "Posts • Loading…" hang |
| `loadingCount` | 0 | no lingering Loading spinner (stable `onPostsChange`) |

`baselines/j3-postboard-merge.json`.

## J4 — cc-voice-launch-close  ✅
**Drives:** launch voice from CC (aria "Voice chat with Atria") → chat opens in voice mode
("Tap to stop"/"Speak" active) → close via top-nav ◈ Command Center → voice UI idle, back on
landing, mic released (`stopVoice` via `voicePanelRef`).

| field | baseline | meaning |
|---|---|---|
| voice launch → active | "Tap to stop" + "Speak" present | mic listening on launch |
| `voiceStillActive` (after close) | false | voice torn down on close |
| `backOnLanding` | true | returned to CC home |
| `hasTextarea` (after close) | false | chat surface unmounted |

`baselines/j4-voice-launch-close.json`.

---

## Coverage note
All 4 P0 journeys green — behavior recorded, no regressions found (this is baseline capture, not a
bug hunt). Combined with Track-B deterministic companions (`web/src/**/*.test.ts` — mergePosts
reducer, request<T,M> wrapper, events-bus ref-count, StrictMode fire-once guard, credits mirror),
the FE zero-coverage region flagged in `gap-analysis.md` is now closed for Phase-0 purposes.

## Not covered here (by design)
- P2 thin render guards (connections-oauth, usage/impact) — low decomposition risk, deferred.
- 402→credits-toast live path — needs a drained tenant; the wrapper unit test covers the code branch.
- StrictMode double-invoke of the REAL OrchestratePanel — the autostart-guard unit test pins the
  pattern; a full-panel StrictMode render is Track-B follow-up if the extraction touches that effect.
