# Lead Nurture Agent — Two-Way, Human-Gated Sales Assistant

**Date:** 2026-07-13 · **Branch:** `pivot/video-content-farm` · **Status:** ALL 4 PHASES DONE (2026-07-15), not yet committed
**Goal:** Turn captured leads from dead rows into an active, two-way email relationship. A nurture agent proactively plans a template drip AND reacts to lead replies (reads inbound Gmail, classifies intent, drafts a contextual response) — but **every outbound email is human-approved before send.** No blast, no unattended send.

## Why (current gap)
Today nurture is 100% manual: a lead sits with `nurturedAt=null`; the only path is the Email panel (`email-router.ts`) where a human drafts+sends ONE email at a time. No cadence, no follow-up, no reply handling. Atria's "Nurture N leads automatically?" card is a pitch for a capability that doesn't exist. See `../260713-1251-multichannel-nurture-nodes/` for the sibling (DM/greeting) plan on hold.

## Locked decisions
- **Two-way** conversational (reads + responds to replies), NOT one-way drip.
- **Human-in-the-loop before EVERY send** — proactive touches + reply responses both parked for approve/edit/reject. Fail-closed invariant.
- **Template sequence + LLM personalization**, default **3 touches @ day 0 / 3 / 6**; a lead reply interrupts the drip → conversational mode.
- **Auto-enroll** every captured lead that has an email (per-owner on/off toggle). Handle-only leads don't enroll.

## Architecture (reuse-first)
The send path is ALREADY built + validated (2026-07-13 scheduler test): `email_writer → scheduler → email_agent`. Each nurture touch/reply = one such run parked at its gate = the "approve each touch." NEW work = state + reply-ingestion + a light brain.

```
capture ─▶ NurtureThread ─▶ driver-cron plans touch ─▶ email_writer(draft) ─▶ [PARK: approve] ─▶ scheduler ─▶ email_agent(send in-thread)
                 ▲                                                                                                    │
                 └──── nurture-brain re-plans ◀── reply-poller(Gmail read) ◀── lead replies ◀───────────────────────┘
```

## Phases
| # | Phase | New vs reuse | Status |
|---|-------|--------------|--------|
| 01 | [Nurture state + drip engine](phase-01-nurture-state-and-drip-engine.md) — `LeadNurtureThread`/`NurtureTouch`, sequence template, driver cron, auto-enroll, proactive touch → approve → send | 🆕 state+cron, ✅ send path | DONE |
| 02 | [Gmail read + reply ingestion](phase-02-gmail-read-and-reply-ingestion.md) — `gmail.readonly` scope, thread/message-id persistence, reply-poller, inbound→lead match | 🆕 (hard part) | DONE |
| 03 | [Nurture brain + conversation](phase-03-nurture-brain-and-conversation.md) — classify reply intent, draft contextual response, drip↔conversation state machine, opt-out/convert | 🆕 brain, ✅ atria-brain pattern | DONE |
| 04 | [Approval inbox + guardrails + verify](phase-04-approval-inbox-guardrails-verify.md) — Nurture Inbox UI (thread timeline + pending approvals), guardrails, verify scripts | 🆕 UI, ✅ approval surface | DONE |

## Hard invariants
1. **No send without human approval** (both directions) — enforce at the gate, fail-closed.
2. **Threading** — all touches/replies stay in ONE Gmail thread (`threadId` + `In-Reply-To`/`References`).
3. **Opt-out is absolute** — unsubscribe link + reply-intent detection → never contact again.
4. **One thread per lead**, atomic-claimed touches (no double-send), idempotent.

## Prerequisites / blockers
- Gmail **read scope** (`gmail.readonly`) added → users re-consent (today only Drive/`gmail.send` piggyback). Phase 02 gate.
- Reply-poller runs on the SAME polling model as `comment-poller.ts` (no Pub/Sub infra needed for MVP).

## Non-goals (YAGNI)
Multi-channel (DM/SMS — that's the sibling plan); fully-autonomous send; lead enrichment; A/B testing sequences; CRM sync. Add later if asked.
