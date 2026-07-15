# Phase 04 — Nurture Inbox (approval) + Guardrails + End-to-End Verify

**Priority:** Medium (UX + safety wrap) · **Status:** DONE · **Depends on:** Phases 01-03.

## Context links
- Existing approval surfaces to extend: scheduled-sends / parked-run view (`RunDagView` ⏰ chip, `GET /runs/scheduled`), email panel (`src/api/email-router.ts`), FE nurture-adjacent UI (`MKTAgent/web`).

## Overview
One place for the human to work the pipeline: a Nurture Inbox showing each lead's thread timeline + the pending drafts (proactive touches AND reply responses) awaiting approval, with approve / edit / reject. Plus the compliance/guardrail layer and the cross-phase verify suite. This is where "human-in-the-loop before every send" becomes a real UX, not just a park state.

## Key insights
- Both proactive touches (Phase 01) and reply responses (Phase 03) land as `awaiting_approval` runs — the Inbox is a unified view over them; approve = the existing gate-approve; edit = update draft body before approve; reject = skip touch / discard reply-draft.
- Guardrails are mostly config + a few checks: max touches, min gap, global opt-out suppression, per-owner enable, unsubscribe link injection, Gmail daily-send ceiling.

## Requirements
**Functional:** list threads (status, next action, last reply); per-thread timeline (touches sent, replies received, pending draft); approve/edit/reject a pending draft; manual pause/convert/opt-out; owner settings (nurture on/off, sequence choice, max touches, gap days). Every send still passes the gate.
**Non-functional:** no send path that bypasses approval; unsubscribe honored; a11y/i18n consistent with app (English-default per `project_cc_ui_session_260713`).

## Architecture
Endpoints (`src/api/nurture-router.ts`):
```
GET  /nurture/threads              list (status, lead, nextPlanAt, hasUnhandledReply)
GET  /nurture/threads/:id          timeline (touches + replies + pending draft)
POST /nurture/threads/:id/approve  {touchId, editedSubject?, editedBody?} → approve gate → send/schedule
POST /nurture/threads/:id/reject   {touchId} → skip/discard
POST /nurture/threads/:id/pause | /convert | /opt-out
GET/PUT /nurture/settings          owner toggle, sequence, maxTouches, gapDays
```
Approve reuses the run gate-approve (proactive→scheduler park / reply→send now, both threaded). Edit writes the draft artifact before approve.
Guardrail layer (`src/nurture/guardrails.ts`): enroll check (opt-out suppression, toggle, has-email), pre-send check (unsubscribe link present, daily-cap not exceeded, not opted-out), max-touches stop.
FE: `MKTAgent/web` Nurture Inbox page — thread list + timeline + draft editor + approve/reject; settings panel.

## Related code files
**Create:** `src/api/nurture-router.ts`, `src/nurture/guardrails.ts`, `MKTAgent/web/src/.../NurtureInbox.*`, settings panel component.
**Modify:** `src/server.ts` (mount router), gate-approve path (accept edited draft), `sendGmailAs` (inject `List-Unsubscribe` header + footer link), FE nav/routing, `src/contract/openapi.ts` (new endpoints), owner settings model.

## Implementation steps
1. `nurture-router.ts` — threads list/detail, approve(+edit)/reject, pause/convert/opt-out, settings.
2. `guardrails.ts` — enroll + pre-send checks; wire into enroll (Phase 01) + approve path.
3. Unsubscribe: `List-Unsubscribe` header + footer link → click hits `POST /leads/unsubscribe` → opt-out suppression.
4. FE Nurture Inbox: thread list, timeline (sent/received/pending), draft editor, approve/reject, settings.
5. openapi + FE types regen.
6. End-to-end verify suite.

## Todo
- [x] nurture-router (threads/approve/edit/reject/controls/settings) — `src/api/nurture-router.ts` (+ `/resume` bonus endpoint)
- [x] guardrails (enroll + pre-send) — `src/nurture/guardrails.ts`
- [x] unsubscribe header/link + opt-out endpoint — `gmail-send.ts` header/footer + `GET/POST /leads/unsubscribe` in `leads-router.ts`
- [x] FE Nurture Inbox + settings — `nurture-inbox-panel.tsx` / `nurture-thread-timeline.tsx` / `nurture-settings-panel.tsx`, wired as a new 🌱 vision-agent surface
- [x] openapi + types — DEVIATION: hand-typed at the client boundary instead (matches the established convention for every other post-M1 feature router — email/memory/instructions/atria/impact/admin/voice/connections are ALL absent from `openapi.ts` too; see `web/src/api/client.ts` "routes not in openapi yet" comments throughout)
- [x] `verify-nurture-e2e.ts` (DRY, PASS): enroll→touch1 park→approve→send→reply ingest→brain draft→park→approve→send; opt-out mid-thread suppresses; edit-before-approve respected (verified by decoding the real outbound MIME); daily cap blocks; no send without an explicit approval

## Success criteria
From the Inbox a human approves/edits/rejects every outbound; a full loop (proactive touch → send → lead reply → drafted response → approve → send) runs in-thread with human approval at each send; unsubscribe click opts out + suppresses; guardrails block over-cap / opted-out sends. `tsc`+web build green; e2e verify passes DRY; one deliberate REAL end-to-end run per `feedback_no_burst_social_posts`.

## Risk / security
- Any bypass of the gate = ship-blocker; assert in verify that no code path sends without an approval record.
- Edited draft must re-validate (length/recipient-from-lead) before send.
- Unsubscribe endpoint unauthenticated-by-token → signed link (reuse `MKT_LEAD_WEBHOOK_SECRET` pattern).

## Next steps
Post-MVP: machine-approve within guardrails (Atria policy) once trust established; multi-channel via sibling plan; A/B sequences; CRM export.
