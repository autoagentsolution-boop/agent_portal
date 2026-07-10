# Email Agent node + lead-collector awareness (P4-lite)

> **STATUS: Email Agent node DONE (commit `271fee4`), verified live + verify-email-node green.**
> Lead-collector awareness = deferred light follow-up (needs an honest connected-sources check, not a
> blind "enabled" claim). Scheduled auto-send = the email node's next increment.

Branch `pivot/video-content-farm` · 2026-07-10. Scoped down per user: NO lead→nurture DAG composition
(too much cron to manage). Instead: (1) a general **Email Agent node** = write + review + send an email;
(2) lead-collector stays the existing cron default, just surfaced so the user KNOWS Atria enabled it.

## Decisions (locked by user)
- Email Agent = a real DAG node. `email_writer` (drafts) → `email_agent` (sends via Gmail, approval-gated).
  Unblocks the "email a friend happy birthday" flow + a simple nurture primitive.
- "Send at a specific time" → v1 = the user approves at the gate when ready (no new cron/table). Scheduled
  auto-send is the clean next increment (reuse the existing scheduler cron + a small scheduled_email row).
- Lead-collector = keep as-is (cron surface), NOT a DAG node. Improve AWARENESS: Atria mentions it's
  enabled naturally when a marketing flow is planned (light touch; no new engine).
- concept_writer NOT reused for email (it materializes a marketing Post). Dedicated lean `email_writer`.

## Build
1. **Artifacts** (`artifact-schemas.ts`): `email_draft` {to[], subject, body}, `email_result` {to[], status, sentIds, error}.
2. **Registry** (`agent-types.ts` + `agent-registry.ts`): `email_writer` (produces email_draft; optional content_concept), `email_agent` (requires email_draft; produces email_result; requiresApproval=external-write gate; Gmail checked in-runner, requiresConnection=false to avoid the social connection-resolver coupling).
3. **GoalSpec** (`goal-spec.ts`): `outputs.needsEmail`; slots `emailTo`, `emailSubject`.
4. **Planner** (`workflow-planner.ts`): `needsEmail` → `[email_writer, email_agent]` only (skip marketing pipeline).
5. **Analyzer** (`deterministic-analyzer.ts` + `requirement-analyzer.ts`): detect email intent (regex vi+en + an `@addr`), extract recipient/subject; OR-in like autoPublish/platforms; force off needsTextPost/media/publishing + clear platforms.
6. **Runners** (`agent-runners.ts`): `runEmailWriter` (LLM draft grounded in goal + optional concept, reuse callGeminiJson), `runEmailAgent` (sendGmailAs to each recipient; DRY seam for verify).
7. **Awareness** (light): when a marketing flow plans, the conversation reply notes lead collection is active (deferred if it bloats scope — flag only).

## Verify
- "Gửi email chúc mừng sinh nhật cho Lam <lam@example.com>" → plans email_writer→email_agent (NO platform ask),
  drafts a warm birthday email, parks at approval; approving sends via Gmail (DRY in test).
- Regression: a normal marketing goal still plans the unchanged pipeline (needsEmail stays false).
