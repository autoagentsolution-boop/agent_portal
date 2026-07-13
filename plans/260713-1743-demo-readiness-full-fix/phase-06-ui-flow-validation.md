# P6 — Real UI-Flow Validation (Browser)

**Priority:** HIGH (de-risks the demo) · **Status:** ✅ DONE — 6 scenarios driven live; caught + fixed 4 real bugs. See `ui-validation/README.md` + screenshots. · **Cross-cutting:** run after each of P1-P5.

## Done (2026-07-13)
Drove `localhost:5173` (agent-browser) as a seeded throwaway tenant (`verify-p6-seed-session.ts`). Auth = minted `mkt_session` cookie injected into the browser. Validated P1 (core central 150px + two-way toggle), general chat (no forced plan), P3 (email by lead name → ✉️ Email flow), P2 (strategist card → inline 12-slot calendar), P4 (instruction-flavored ideas), P5 (product recall).
**4 bugs P6 caught (API-green, UI-broken) — all fixed + re-validated live:** (1) P2 inline calendar poll stuck on `mountedRef` (StrictMode); (2) P2 email mislabeled "Single post" → ✉️ Email; (3) P3 marketing/platform bleed + multi-turn recipient loss (brain prompt); (4) P5 cross-language product recall (product = always-eligible default).
Deferred to manual: P1 real STT (needs mic), P3 real Gmail send (needs user's connected account).

## Why
The user's core pain: **API-green ≠ UI works**. Every fix this session was API/verify-tested, but the actual user path through the UI (localhost:5173) breaks or doesn't match expectations. So each demo scenario must be driven through the REAL browser UI and observed, not asserted via fetch.

## Tooling
Use the `agent-browser` (preferred, AI-optimized snapshots) or `chrome-devtools` skill to drive `http://localhost:5173` against the running BE (`:7100`) + Postgres (`:5433`). Auth: seed/sign a session (reuse `signSession` recipe from `verify-campaign-reuse-http.ts`) or the auth-bypass cookie (memory `project_atria_v2_p0_workspace_reframe`). Backend + UI already run from this session.

## Demo scenarios to drive end-to-end (each = a scripted UI run)
1. **Voice one-button (P1):** open CC → click mic once → assert JARVIS core stays large + glows (listening) → speak a goal → assert transcript + Atria reply + read-aloud → click again → voice off, chat persists. Screenshot each state.
2. **Classify + general chat (checklist 1):** type a general question → Atria answers conversationally (no forced marketing plan).
3. **Birthday/nurture email by lead name (P3):** "gửi email sinh nhật cho <existing lead>" → assert lead resolved, draft parks for approval → approve → sent; then scheduled variant "…đặt lịch mai 9h" → parks scheduled.
4. **Single vs strategist (P2 + checklist 3):** "create a single post about X" → single-post card; "build a monthly branding campaign" → strategist card + inline editable calendar → approve → posts scheduled. Assert NO confusion / no reproduced flow (the fixed bug).
5. **Single-campaign post inherits setup (checklist 4):** on a saved all-platform flow, set up a campaign → create a post brief → assert platforms pre-checked = all (not Facebook-only), language/brand inherited.
6. **Refine post (checklist 5):** open a post with copy → "Refine: make it punchier" → assert copy changes, stays at review.
7. **Instructions ground ideas (P4):** set a workspace Instruction → new plan reflects it.
8. **Memory recall (P5):** state a fact in chat → new chat → Atria recalls without re-asking → see/delete it in the memory panel.

## Deliverable
A repeatable UI smoke-suite (scripts under `web/e2e/` or a scratch runner) + a screenshot/observation log per scenario saved to `plans/260713-1743-demo-readiness-full-fix/ui-validation/`. Each scenario: PASS/FAIL + screenshot + note of any gap the API tests missed.

## Todo
- [ ] Auth path for the browser session (signSession cookie/token)
- [ ] Scenario scripts 1-8 (agent-browser)
- [ ] Screenshot/observation log per scenario
- [ ] File any UI-only gaps back into P1-P5 as follow-ups

## Success criteria
Every demo scenario driven through the real UI PASSES with screenshots; any divergence from expectation is captured and fixed in its phase. The demo is rehearsed exactly as the audience will see it — not just API-proven.

## Risk
- Browser automation on Windows: prefer `agent-browser`; if flaky, fall back to `chrome-devtools` Puppeteer.
- Keep test data isolated (throwaway tenant) so demo data isn't polluted.
