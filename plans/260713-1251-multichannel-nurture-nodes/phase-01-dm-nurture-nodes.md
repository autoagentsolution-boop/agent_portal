# Phase 01 — DM Nurture Node (WhatsApp, Telegram, Zalo)

**Priority:** High · **Status:** TODO · **Verdict scope:** WhatsApp 🟢, Telegram 🟡, Zalo 🟡 (defer). LinkedIn DM 🔴 excluded.

## Overview
One `dm_writer`→`dm_agent` node pair (mirror `email_writer`→`email_agent`) that sends an **opt-in, per-channel** message to a contact via a pluggable messaging-adapter registry. Not the social publisher — DMs are 1:1, approval-gated, non-`SocialPlatform` credentials.

## Key insight
- Email node is the template, NOT `publisher`. `email_agent` sets `requiresConnection:false` and checks connectivity inside the runner (`hasGmailConnected`) precisely because its credential isn't a `SocialPlatform` token. DM nodes do the same.
- 3 channels behind one node via a `dmChannel` slot + adapter registry = DRY (avoid 3 node pairs).
- Every channel is opt-in-gated: **Telegram** = lead `/start`ed the bot; **WhatsApp** = consent + approved template; **Zalo** = ZNS-eligible phone. The node MUST refuse to send to a non-opted-in contact (fail-loud, like publisher kill-switch).

## Requirements
**Functional:** given a contact + channel + (draft or template params), send one message; record delivery; respect opt-in state; approval gate before send; DRY-RUN seam.
**Non-functional:** no bulk/burst (`feedback_no_burst_social_posts`); per-message audit; encrypted credential + contact PII at rest.

## Architecture
```
dm_writer  (produces: dm_draft)      → dm_agent (requires: dm_draft, gate: publish, requiresApproval: true, produces: dm_result)
                                          └─ dmAdapters[channel].send(contact, payload, sendFn)
```
New `MessagingChannel` enum (`whatsapp | telegram | zalo`) — **separate from `SocialPlatform`** (schema.prisma:45). New `DmContact` table (ownerId, channel, externalId/phone, optInState, optInAt) — PII encrypted like `Lead`.

Adapter interface (mirror `SocialAdapter` in `src/social/types.ts`):
```ts
interface DmAdapter {
  channel: MessagingChannel;
  send(input: DmSendInput): Promise<DmSendResult>; // never throws; returns {ok,error,platformMessageId}
  optInStatus(contact): Promise<'opted_in'|'expired'|'none'>;
}
```

## Related code files
**Read (templates):** `src/orchestration/executor/agent-runners.ts` (`runEmailWriter`/`runEmailAgent` L769/L833), `src/email/gmail-send.ts` (seam pattern), `src/social/x.ts` (adapter reference), `src/social/index.ts` (registry+fan-out), `src/tokens/service.ts` (`getActiveToken`), `src/connectors/vault/credential-vault.ts`.
**Create:** `src/messaging/types.ts`, `src/messaging/index.ts` (registry + `sendDm(channel,input)`), `src/messaging/whatsapp.ts` (Cloud API template send), `src/messaging/telegram.ts` (Bot API `sendMessage`), `src/messaging/zalo.ts` (ZNS — stub behind flag), `src/messaging/opt-in-repo.ts`, `src/orchestration/executor/dm-runners.ts` (or extend agent-runners).
**Modify:** `src/orchestration/registry/agent-types.ts` (`RunnableAgentId += 'dm_writer'|'dm_agent'`), `agent-registry.ts` (2 `AGENTS[]` entries), `agent-runners.ts` (`runners{}` += 2), `schemas/artifact-schemas.ts` (`dm_draft`,`dm_result` types+schemas+`artifactSchemaFor`), `schemas/goal-spec.ts` (slots `dmChannel`,`dmTo`; output flag `needsDirectMessage`), `master/workflow-planner.ts` (`targetsFromGoal` map `needsDirectMessage→['dm_result']`, `PIPELINE_ORDER`, `TERMINAL_ACTIONS += 'dm_agent'` so schedulable), `prisma/schema.prisma` (+`MessagingChannel`,`DmContact`,`DmMessage`), `src/config/env.ts` + `.env` (WHATSAPP_* , TELEGRAM_BOT_TOKEN, ZALO_* key names).

## Implementation steps
1. Prisma: add `MessagingChannel` enum, `DmContact`, `DmMessage` (delivery log); migrate.
2. `src/messaging/` adapter layer + registry `sendDm`; WhatsApp template send + Telegram bot send real; Zalo ZNS behind `ENABLE_ZALO` flag (defer).
3. Opt-in repo + Telegram webhook intake (`/webhook/telegram`) recording `/start` → `DmContact` opted_in.
4. Artifact types + Zod schemas; register in `artifactSchemaFor`.
5. Registry defs (`dm_writer`, `dm_agent` gate `publish`) + runners (`runDmWriter`, `runDmAgent` with `ctx.dmSendFn` DRY seam).
6. GoalSpec slots + `needsDirectMessage` flag + planner splice; add to `TERMINAL_ACTIONS` so scheduler node (Phase from 260712) can defer a DM.
7. Env keys + connectivity check inside runner (refuse if channel unprovisioned or contact not opted-in).

## Todo
- [ ] Prisma migration (MessagingChannel/DmContact/DmMessage)
- [ ] `src/messaging/*` adapters + registry
- [ ] Telegram `/start` opt-in webhook
- [ ] Artifact types+schemas
- [ ] Registry entries + runners (DRY seam)
- [ ] GoalSpec + planner splice + TERMINAL_ACTIONS
- [ ] Env keys + `env.ts` validation
- [ ] Verify script `verify-dm-node.ts` (DRY, 0 real sends): opt-in refusal, template gate, double-send guard, failure→failed

## Success criteria
`tsc --noEmit` green; verify script passes DRY (0 real messages); one deliberate REAL Telegram send to a `/start`ed test account; WhatsApp template send validated once with an opted-in number. Refuses non-opted-in contact loudly.

## Risk / security
- **Ban risk** if opt-in bypassed → hard gate + no burst. WhatsApp template must be pre-approved or send 400s.
- Contact PII (phone) encrypted at rest (reuse vault). No plaintext phone in logs.
- Prereq: WhatsApp Business Account + verified number provisioned (see synthesis Q1) — node ships behind flag until then.

## Next steps
Depends on nothing in-repo except the scheduler node (already shipped, `260712-1129-generic-scheduler-agent-node`) for timed nurture. Blocks: real WhatsApp provisioning.
