# Phase 03 — Nurture Brain + Conversational State Machine

**Priority:** High (the "sales assistant" intelligence) · **Status:** TODO · **Depends on:** Phase 01 (state) + Phase 02 (replies ingested).

## Context links
- Reasoning pattern to mirror: `src/orchestration/atria/atria-brain.ts` (Gemini function-calling LOOP) + `atria-tools.ts` (tools wrap existing code). Memory `project_atria_reasoning_loop_260711`.
- Draft reuse: `draftNurtureEmail` in `src/api/email-router.ts`; send via Phase 02 threaded `sendGmailAs`.

## Overview
When a lead replies, the brain classifies intent, drafts a contextual in-thread response, and updates the thread's state — flipping it from `drip` to `conversation`, cancelling pending scheduled drip touches. **The drafted response still PARKS for human approval before send** (Phase 04 surfaces it). The brain never sends; it decides + drafts.

## Key insights
- A reply INTERRUPTS the template drip. Once `hasUnhandledReply`, the driver stops planning proactive touches and hands the thread to the brain (`mode=conversation`). Pending scheduled drip touches for that thread are cancelled (`reparkScheduled`→cancel).
- Brain output is an ACTION, not a send: `draft_reply` | `pause` | `mark_converted` | `mark_opted_out` | `escalate` (unsure → human-only, no auto-draft). Every `draft_reply` becomes an approval-parked email run.
- Keep the brain scoped + cheap: it sees {lead, thread history (touches + prior replies), latest inbound, brand/product}. Function-calling loop budget-capped (reuse thinking-budget policy `project_composable_planner_plan_260712` P6).
- **Opt-out / unsubscribe** is detected two ways: the List-Unsubscribe link (Phase 04) AND reply-intent classification ("stop", "not interested", "unsubscribe") → `mark_opted_out`, absolute, never contact again.

## Requirements
**Functional:** classify inbound reply intent (interested | question | objection | not_now | booking | opt_out | unclear); for actionable intents draft a grounded response; set thread state (engaged/paused/converted/opted_out); cancel drip on engagement; escalate on low confidence. All outbound still human-gated.
**Non-functional:** deterministic state transitions (idempotent per `InboundReply.handled`); bounded LLM spend; no hallucinated commitments (prompt guardrails: no pricing/promises not in product knowledge → escalate); audit each decision.

## Architecture
```
nurture-brain.ts  (invoked by driver when thread.hasUnhandledReply):
  input  = { lead, thread, touches, replies, latestReply, brand, productKnowledge }
  loop   = Gemini function-calling with tools:
             classify_reply(intent, confidence)
             draft_reply(subject, body)        // grounded; may call product-knowledge lookup
             set_state(status|mode)
             escalate(reason)
  output = NurtureDecision { action, draft?, newStatus?, newMode? }
```
Driver integration (extends Phase 01 `nurture-runner`):
1. If `thread.hasUnhandledReply` → run brain (conversation branch) BEFORE any proactive planning.
2. `draft_reply` → build reply GoalSpec (threaded: `inReplyTo/references/threadId` from thread), kick off `email_writer`(seed with brain draft)→ PARK `awaiting_approval` as a `NurtureTouch{stage:'reply'}`. Mark `InboundReply.handled=true`.
3. `mark_opted_out|converted|paused` → set status, cancel pending scheduled touches, no draft.
4. `escalate` → flag thread `needs_human`, notify; no auto-draft.
5. If NO unhandled reply and `mode=drip` → fall through to Phase 01 proactive planning.

New: `src/nurture/nurture-brain.ts`, `src/nurture/nurture-tools.ts`, `NurtureDecision` schema. Thread gains `mode` transitions + `needs_human` flag.

## Related code files
**Create:** `src/nurture/nurture-brain.ts`, `src/nurture/nurture-tools.ts`, `src/nurture/decision-schema.ts`.
**Modify:** `src/nurture/nurture-runner.ts` (conversation branch first), `src/nurture/nurture-thread-repo.ts` (state/mode/needs_human transitions, cancel-pending-touches), `src/api/email-router.ts` reuse `draftNurtureEmail` (or generalize for reply context), product-knowledge grounding hook (existing product library).
**Reuse:** atria-brain function-calling scaffolding, thinking-budget policy, threaded `sendGmailAs` (Phase 02), scheduler cancel (`cancelScheduled`).

## Implementation steps
1. `NurtureDecision` Zod schema + tool defs (`nurture-tools.ts`).
2. `nurture-brain.ts` — Gemini function-calling loop, budget-capped, grounded in product knowledge; hard rule: unverifiable claim/price → `escalate`.
3. Driver conversation branch: reply-first, then draft→park / state-change / escalate; cancel drip on engagement.
4. Opt-out intent → absolute suppression (write to a per-owner suppression set checked at enroll + send).
5. Idempotency: `InboundReply.handled` guard; one decision per reply.
6. Notifications for `escalate`/`needs_human`.

## Todo
- [ ] Decision schema + tool defs
- [ ] Brain loop (budget-capped, product-grounded, escalate-on-unsure)
- [ ] Driver conversation branch (reply-first) + drip cancel
- [ ] Opt-out absolute suppression
- [ ] Idempotent per-reply handling
- [ ] Escalate/needs_human notify
- [ ] `verify-nurture-brain.ts` (DRY, fixture replies → decisions; 0 sends, mocked LLM): each intent → correct action, opt-out suppresses, unsure→escalate, drip cancelled on reply

## Success criteria
Given a fixture lead reply of each intent, brain produces the correct action; an "interested/question" reply yields a grounded drafted response PARKED for approval, in-thread; "unsubscribe/stop" → opted_out + suppressed (no future enroll/send); low-confidence/price-ask → escalate (no auto-draft). A reply cancels pending drip touches. No send occurs without approval.

## Risk / security
- **Hallucinated commitments** (fake pricing/promises) → grounding + escalate-on-unverifiable; human approval is the backstop.
- LLM spend → budget cap + only run brain on unhandled replies.
- Opt-out must be honored globally, not per-thread → suppression set.
- Prompt-injection via reply body (lead pastes instructions) → treat reply as DATA, not instructions; system prompt hardening; human approval catches escapes.

## Next steps
Phase 04 surfaces parked drafts (proactive + reply) in a Nurture Inbox for approve/edit/reject, adds unsubscribe link + guardrail config, and the verify suite tying all phases end-to-end.
