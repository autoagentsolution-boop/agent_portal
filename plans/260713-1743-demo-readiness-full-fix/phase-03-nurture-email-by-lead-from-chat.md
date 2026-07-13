# P3 — Birthday/Nurture Email by Lead NAME from Chat

**Priority:** HIGH · **Status:** ✅ DONE (BE, typecheck clean, deterministic verify green; golden 23/23 + reuse 21/21 no regression) · **Layer:** backend brain tool + goal wiring.

## Done (2026-07-13)
- `searchLeadsByName(ownerId, q)` in `lead-repo.ts` — decrypt-in-memory, token-AND match on name+email (bounded 500), ranked name-first. (No name blind-index → SQL contains impossible.)
- `find_lead` brain tool (decl + dispatch): 1 match → sets `ctx.resolvedLead` (authoritative, SERVER-SIDE) + returns MASKED email; >1 → candidates, no resolve (brain asks); 0 → note to ask for address. `maskEmail` keeps first char + domain only → full PII address never enters the LLM context.
- `propose_workflow`: when `ctx.resolvedLead` set AND email goal → override `emailTo` from the Lead RECORD + carry `leadId`. New `leadId` slot on goal-spec.
- `runEmailWriter`: `leadId` present → enrich draft input with lead name/product/message (grounds birthday/nurture WITHOUT forcing sales-nurture framing — deliberate: NOT `draftNurtureEmail`, which would turn a birthday note into a pitch).
- `runEmailAgent`: stamps `markLeadNurtured(leadId)` on successful send (best-effort).
- Brain prompt: `find_lead` tool + "EMAIL TO A NAMED PERSON" recipe (resolve same-turn → 1 propose / many ask / none ask-for-address; never fabricate).
- Verify: `verify-nurture-email-from-chat.ts` — resolve/ambiguous/narrow/unknown, masked email, DRY draft grounding (name+message in prompt, 0 spend), DRY send stamps nurturedAt (0 real send). Gemini name→email-goal routing → P6 browser. One REAL send test → P6.

## Problem
"Send a birthday/nurture email to Nghiep" FAILS from chat: the chat email path resolves the recipient ONLY from a typed `@address` (`deterministic-analyzer.ts:148,158 parseEmailIntent`; `runEmailWriter` throws if `slots.emailTo` has no @address — `agent-runners.ts:770-771`). There is NO lead-name → email lookup in the brain. The lead-grounded nurture (`draftNurtureEmail`, `email-agent.ts:40`) is wired only to the REST panel (`email-router.ts:37,55` by `leadId`), unreachable from chat.

## Goal
User says (voice/text) "gửi email sinh nhật cho Nghiep" (send now) or "…đặt lịch mai 9h" (schedule) → Atria resolves "Nghiep" against the Leads store, pulls the decrypted email, drafts a grounded birthday/nurture email, and runs the validated `email_writer → (scheduler) → email_agent` path with human approval. Ambiguous name → Atria asks which lead.

## Key facts (from scan)
- Brain tools: `atria-tools.ts:50 TOOL_DECLARATIONS`, `:158 dispatchTool`. Existing `set_schedule` (`:203`), `propose_workflow` (`:217`).
- Email path: `needsEmail` → `email_writer → email_agent`; confirmed schedule splices `scheduler` (`workflow-planner.ts:136-177`).
- Lead store: `src/db/repos/lead-repo.ts` (`listLeads`, `getLead`, email decrypt), `Lead` model (PII encrypted, `name`, `email`).
- Recipient wiring: `goal.slots.emailTo` consumed by `runEmailWriter`.
- Validated scheduled-email E2E: run `d5970244` (2026-07-13) — park→cron→real send works.
- Related: the on-hold lead-nurture plan `plans/260713-1251-lead-nurture-agent/` — this P3 is the chat entry point to it.

## Architecture
Add a brain tool `find_lead(name|query)` → searches the owner's leads (name/email/handle contains), returns candidates `[{leadId, name, email, score}]`.
- Brain flow: user names a person → brain calls `find_lead` → if 1 match, set the recipient; if >1, brain asks "which one?" (conversational); if 0, brain says no lead found + offers to type an address.
- Wire the resolved lead email into the email goal: extend `propose_workflow`/email intent so the brain can pass `emailTo` (resolved) + a nurture/birthday `angle` into the GoalSpec `slots` (mirror how `emailTo` is set today). Optionally carry `leadId` on the goal for `nurturedAt` stamping (reuse `markLeadNurtured`, `lead-repo.ts`).
- Send-now vs schedule: unchanged — `set_schedule` confirmed → scheduler splice; else immediate. Both already validated.
- Reuse `draftNurtureEmail` grounding (brand + lead) inside `runEmailWriter` when a leadId is present, so the draft is lead-aware (not generic).

## Related code files
**Read:** `src/orchestration/atria/atria-tools.ts` (50, 158, 203, 217), `src/orchestration/atria/atria-brain.ts` (dispatch), `src/orchestration/prompts/atria-brain-prompt.ts` (add a "sending email to a lead" section), `src/db/repos/lead-repo.ts`, `src/orchestration/master/deterministic-analyzer.ts:148-158 parseEmailIntent`, `src/orchestration/executor/agent-runners.ts:769-833` (email runners), `src/email/email-agent.ts:40 draftNurtureEmail`, `src/orchestration/schemas/goal-spec.ts` (emailTo slot).
**Create:** `find_lead` tool decl + dispatch in `atria-tools.ts`; a lead-search repo helper (`lead-repo.ts` `searchLeadsByName(ownerId, q)`).
**Modify:** `atria-tools.ts` (tool + set resolved `emailTo`/`leadId`/nurture angle on the proposal goal), brain prompt (when a lead name is given, resolve via find_lead before proposing; ask on ambiguity), `agent-runners.ts` runEmailWriter (use `draftNurtureEmail` when `slots.leadId` present), goal-spec (optional `leadId` slot).

## Implementation steps
1. `searchLeadsByName(ownerId, q)` repo helper (decrypt name/email, contains-match, top N).
2. `find_lead` brain tool (decl + dispatch → returns candidates).
3. Brain prompt: recipe for "email to a named person" → find_lead → 1 match set emailTo+leadId; many → ask; none → offer manual address. Birthday/greeting angle default.
4. Thread resolved `emailTo`+`leadId`+angle into the email GoalSpec via propose_workflow.
5. runEmailWriter: when `leadId` present, ground draft via `draftNurtureEmail` (lead+brand) instead of generic.
6. Keep send-now vs `set_schedule` branch. Stamp `markLeadNurtured` on send (reuse).
7. Verify script `verify-nurture-email-from-chat.ts` (DRY seams, 0 real send): name→resolve→draft→approve gate; ambiguous→ask; scheduled variant splices scheduler.

## Todo
- [ ] `searchLeadsByName` repo helper (decrypt + match)
- [ ] `find_lead` brain tool
- [ ] Brain prompt recipe (resolve → ask on ambiguity → manual fallback)
- [ ] Thread emailTo/leadId/angle into email goal
- [ ] Lead-grounded draft in runEmailWriter
- [ ] markLeadNurtured on send
- [ ] verify script (DRY) + one REAL send test to a test lead
- [ ] UI-flow verify (P6): voice "gửi sinh nhật cho <lead>" → draft parks → approve → sends; scheduled variant

## Success criteria
From chat/voice, naming a lead resolves their email, drafts a lead-grounded birthday/nurture mail, and sends now or on schedule with human approval — no typed @address needed. Ambiguous name asks; unknown name offers manual. One deliberate REAL send verifies (per `feedback_no_burst_social_posts`).

## Risk
- PII: never log decrypted email; recipient from the resolved Lead record only (not free text) — same rule as `email-router` send.
- Ambiguity must ask, never guess a recipient (wrong-person send is unrecoverable).
- Bridges into the on-hold nurture plan — keep this a thin chat entry, don't build the full nurture loop here (YAGNI).
