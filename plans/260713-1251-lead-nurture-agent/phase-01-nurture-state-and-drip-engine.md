# Phase 01 — Nurture State + Drip Engine (proactive, human-gated)

**Priority:** High (backbone) · **Status:** TODO · **Depends on:** nothing (reuses shipped scheduler/email path).

## Context links
- Send path (validated 2026-07-13): `../260712-1129-generic-scheduler-agent-node/` + memory `project_generic_scheduler_node_260712`.
- Reuse: `src/orchestration/executor/agent-runners.ts` (`runEmailWriter` L769, `runEmailAgent` L833), `src/email/gmail-send.ts` (`sendGmailAs`, `GmailSendFn` seam), `src/api/email-router.ts` (`draftNurtureEmail`), `src/db/repos/lead-repo.ts` (`listLeads`,`getLead`,`markLeadNurtured`), `src/orchestration/autonomy/autonomy-cron.ts`+`autonomy-runner.ts` (driver pattern), `src/db/repos/workflow-run-repo.ts` (`parkScheduled`,`claimScheduledDue`).

## Overview
Per-lead nurture state machine + a driver cron that proactively plans the next template touch and materializes it as an approval-parked email run. This alone delivers a working (one-way) human-gated drip; Phases 02-03 add the reply loop.

## Key insights
- A nurture touch = one email run through the EXISTING path. Touch 1 (day 0) → `email_writer → email_agent` (publish gate, approve→send now). Touch 2+ (day 3/6) → `email_writer → scheduler` (approve draft+time→park) → `email_agent` (fire at T). Both shapes already work.
- The "brain" here is a **cadence state machine + template map**, not an LLM loop (LLM only personalizes wording inside `email_writer`). KISS.
- Driver mirrors `autonomy-runner.ts`: atomic-claim a due thread, act, advance state. Flag-gated (`ENABLE_NURTURE_CRON`).

## Requirements
**Functional:** auto-enroll leads-with-email (per-owner toggle); plan next touch per active thread when due; draft+park for approval; on approved-send record touch + set `nextPlanAt = sentAt + gapDays`; stop after last touch → `completed`; manual pause/convert/opt-out buttons.
**Non-functional:** one thread per lead; atomic claim (no double touch); no send without approval; audit each transition; lead PII stays encrypted.

## Architecture
New Prisma models:
```prisma
model LeadNurtureThread {
  id, ownerId, leadId (unique per owner), sequenceId
  status      NurtureStatus  // active | paused | converted | opted_out | completed | failed
  mode        NurtureMode    // drip | conversation   (conversation set in Phase 03)
  touchNumber Int            // last completed touch index
  nextPlanAt  DateTime?      // when driver should plan the next touch (null = nothing due)
  gmailThreadId String?      // set on first send (Phase 02 threading)
  lastMessageId String?      // RFC Message-ID of our last sent mail (Phase 02)
  createdAt, updatedAt
}
model NurtureTouch {
  id, threadId, index, stage (intro|value|cta|reply)
  runId       String?   // the wf_run that drafts+sends this touch
  status      // planned | awaiting_approval | scheduled | sent | skipped | failed
  scheduledAt, sentAt DateTime?
}
enum NurtureStatus {...}  enum NurtureMode { drip conversation }
```
Sequence template (data, not code branching):
```ts
const DEFAULT_SEQUENCE = { id: 'default3', touches: [
  { index: 0, stage: 'intro', dayOffset: 0 },
  { index: 1, stage: 'value', dayOffset: 3 },
  { index: 2, stage: 'cta',   dayOffset: 6 },
]};
const STAGE_INTENT = { intro: 'Warm thank-you + who we are', value: 'One concrete value/proof point', cta: 'Soft ask: reply or book a call' };
```
Driver flow (`nurture-runner.ts`, one sweep):
1. Enroll: leads with email + owner toggle on + no thread → create `active/drip` thread, `nextPlanAt=now`.
2. Claim: `nextPlanAt <= now && status=active` → atomic set a claim flag (mirror `claimScheduledDue`).
3. Plan touch: look up sequence[touchNumber+1]; if none → `completed`. Else build `GoalSpec` (slots: `emailTo=lead.email`, `angle=STAGE_INTENT[stage]`, `language/brandVoice` from owner, `schedule.at = lastSentAt + gapDays` for touch≥1, or immediate for touch 0), `outputs.needsEmail=true` + a new `nurtureThreadId` marker slot.
4. Kick off run → `email_writer` drafts → PARKS at gate (`awaiting_approval`). Link `runId` on `NurtureTouch`.
5. On approved send completion (hook into email_agent result) → mark touch `sent`, `touchNumber++`, `nextPlanAt = sentAt + nextGap`, persist `gmailThreadId`/`lastMessageId` (Phase 02).

## Related code files
**Create:** `src/nurture/nurture-thread-repo.ts`, `src/nurture/sequence.ts` (template+STAGE_INTENT), `src/nurture/nurture-runner.ts` (driver sweep), `src/nurture/nurture-cron.ts` (schedule, `ENABLE_NURTURE_CRON`), `src/nurture/enroll.ts`.
**Modify:** `prisma/schema.prisma` (+2 models +2 enums; `Lead` back-relation), `src/orchestration/schemas/goal-spec.ts` (slot `nurtureThreadId`, `nurtureStage`), `src/server.ts` (mount nurture cron), `src/config/env.ts`+`.env` (`ENABLE_NURTURE_CRON`, `NURTURE_MAX_PER_TICK`), `src/db/repos/lead-repo.ts` (helper: leads eligible for enroll), owner settings (nurture on/off toggle — add to user/settings model).
**Reuse untouched:** email_writer/email_agent runners, scheduler node, `sendGmailAs`, `draftNurtureEmail`.

## Implementation steps
1. Prisma models + enums + migration; `nurture-thread-repo` CRUD + atomic claim.
2. `sequence.ts` template + stage→intent map.
3. `enroll.ts` — sweep eligible leads → create threads (idempotent, unique leadId).
4. `nurture-runner.ts` — claim due threads → build nurture GoalSpec → kick off email run (parks). Hook send-completion → advance state.
5. `nurture-cron.ts` + `server.ts` mount + env flag.
6. GoalSpec nurture slots; ensure planner routes `needsEmail` + nurture slots through existing email path (no planner change if reusing `needsEmail`).
7. Manual controls: pause/convert/opt-out repo methods (Phase 04 wires UI).

## Todo
- [ ] Prisma models/enums + migration
- [ ] thread-repo + atomic claim
- [ ] sequence template + stage intents
- [ ] enroll sweep (toggle-gated, idempotent)
- [ ] nurture-runner (plan → kick off parked run → advance on send)
- [ ] cron + server mount + env flags
- [ ] GoalSpec nurture slots
- [ ] send-completion hook → touch/state advance
- [ ] `verify-nurture-drip.ts` (DRY, 0 real sends): enroll, plan, park, advance, complete, no-double-touch

## Success criteria
`tsc` green; verify DRY passes; a captured test lead auto-enrolls, touch 1 drafts + parks for approval, approval sends (real, one) + stamps state, `nextPlanAt` advances +3d, touch 2 parks with a scheduled time. No send without approval; no double-touch under overlapping cron ticks.

## Risk / security
- Double-send → atomic claim + `NurtureTouch.status` guard (mirror scheduler double-fire guards).
- Noisy auto-enroll → per-owner toggle default consider OFF until validated; touch 1 still needs approval so nothing sends unattended.
- Lead email from `Lead` record only (never client-supplied) — same rule as `email-router.ts` send.

## Next steps
Phase 02 adds `gmailThreadId`/`lastMessageId` capture on send + inbound reply ingestion. Phase 01 send-completion hook must persist those ids even before Phase 02 consumes them.
