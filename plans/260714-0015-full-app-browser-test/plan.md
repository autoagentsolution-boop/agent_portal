# Full-App Observed Browser Test — Playbook

**Date:** 2026-07-14 · **Branch:** `pivot/video-content-farm` (head `c566347`) · **Status:** PLANNED, run tomorrow with the user observing.
**Goal:** Drive the WHOLE app through a HEADED agent-browser Chromium (user watches live) to sign off every feature + all the fixes from 2026-07-13. Voice uses the REAL mic so the user speaks; I drive everything else and read back what happened.

## Prerequisites (restart env first)
- Docker Postgres: `docker start mktagent-postgres-1` (→ :5433). Docker Desktop must be running.
- Backend: `cd MKTAgent && npm run dev` (→ :7100). Wait for "listening".
- Web: `cd MKTAgent/web && npm run dev` (→ :5173). ← was DOWN at plan time; restart it.
- Confirm: `:5433 :7100 :5173` all UP.

## Harness (one command)
`bash plans/260714-0015-full-app-browser-test/launch-observed-browser.sh`
- Mints a seeded throwaway tenant (leads **Nghiep** + **Lam Tran**; a workspace Instruction "witty, punchy, target SME founders in SE Asia"; a product memory "AI Automation Course"). Prints `USERID` + `COOKIE`.
- Launches a **visible** Chromium with the **real mic auto-granted** (`--use-fake-ui-for-media-stream`, no fake device) on CDP `:9333`, injects the cookie, loads `localhost:5173`.
- Drive with `agent-browser --cdp 9333 <cmd>`. Note: click BUTTONS via `eval` (`el.click()`) — coordinate clicks miss off-viewport controls.

## Scenarios (I drive unless marked 🎤 = user speaks)
| # | Scenario | Steps | Expected (fix) |
|---|----------|-------|----------------|
| 1 | Constellation | Load CC; click a group node to expand | 5 groups equal distance = **true circle**; members fan out, no clip |
| 2 | 🎤 Voice one-button (P1) | Click 🎙 → chat opens → **Listening…**; user says "what are 3 hooks for a time-management post" → transcript → Atria replies + **reads aloud**; click core → stops | Core stays large+central; auto-listens (no 2nd tap); STT→reply→TTS; core=voice toggle |
| 3 | General chat | Type a general question | Conversational answer, **no forced marketing plan** (checklist #1) |
| 4 | Instructions (P4) | Read #3's reply | Tone is **witty/punchy, SME-founder** angle (the workspace Instruction) |
| 5 | Memory (P5) | Ask "nhắc mình sản phẩm chính là gì?"; open 🧠 Memory panel | Recalls "AI Automation Course"; **What Atria remembers** list; delete works |
| 6 | Email by name (P3) | "gửi email chúc mừng sinh nhật cho Nghiep" | **✉️ Email** (email_writer→email_agent); recipient resolved from lead, **no @address asked**, no platform/lead-collection framing |
| 7 | Scheduled email | "...gửi vào 1 giờ chiều mai" (fresh chat) | **✉️ Email → ⏰ Scheduler → email_agent**; localized **🕒 confirm-ask** with exact time; no marketing interrogation |
| 8 | Email↔marketing (whack-a-mole) | SAME chat: email to Nghiep → then "tạo chiến dịch branding cho Atria" → then reverse | Marketing = **clean** (no Nghiep/email/lead bleed); email = clean. Brain declares `kind`, no regex bleed |
| 9 | Single vs strategist (P2) | "viết 1 post về X" → then "chiến dịch branding hàng tháng cho Atria, 3 bài/tuần" → **▶ Draft the calendar** | 📄 Single post vs **🗓 Strategist**; strategist → **inline editable 12-slot calendar in chat** → Approve & schedule (no navigation) |
| 10 | Post inherits setup | On a saved all-platform flow, set up campaign → create post brief | Platforms **pre-checked = all** (not FB-only), language/brand inherited (checklist #4) |
| 11 | Refine post | Open a post with copy → "Refine: make it punchier" | Copy changes, stays at review (checklist #5) |
| 12 | Real Gmail send (OPTIONAL) | Approve a #6/#7 email | Needs the USER's connected Gmail (test tenant has none) — do only if a real account is connected; else observe the approval gate |

## Deliverable
PASS/FAIL + a screenshot per scenario into `plans/260714-0015-full-app-browser-test/results/`; file any gap as a follow-up.

## Cleanup
`agent-browser --cdp 9333 eval 'window.close()'` · `cd MKTAgent && npx tsx src/orchestration/verify-p6-seed-session.ts --cleanup <USERID>` · `rm -rf <observed-test-profile>`.

## Notes
- 🎤 Voice: the harness auto-grants the mic (no prompt) and uses the REAL device, so the user speaks and it transcribes for real. STT is Chrome→Google (needs network).
- If a driven button "does nothing", it's likely off-viewport — click via `eval(el.click())`, not coordinates.
