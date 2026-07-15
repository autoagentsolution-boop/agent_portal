# Phase 02 — Gmail Read Scope + Reply Ingestion + Threading

**Priority:** High (enables two-way) · **Status:** TODO · **Depends on:** Phase 01 (threads + touch state exist).

## Context links
- Send today: `src/email/gmail-send.ts` (`realSend` loads owner Google refresh token via `getPublisherAppCred(ownerId, DRIVE_REFRESH_KEY)`; Gmail piggybacks the Drive OAuth). `hasGmailConnected(ownerId)`.
- OAuth: `src/social/connect-providers.ts`, `src/config/env.ts` (`GOOGLE_CLIENT_ID/SECRET/OAUTH_REDIRECT_URI`), `src/db/repos/agent-credential-repo.ts` (`getPublisherAppCred`).
- Poller pattern to mirror: `src/leads/sources/comment-poller.ts` + `comment-cron.ts` (30-min sweep, per-owner, PostGone-style deactivation).

## Overview
The hard, net-new part: read inbound Gmail so the agent can see lead replies, keep the whole exchange in one Gmail thread, and match an inbound message back to the right `LeadNurtureThread`. This produces `InboundReply` records the Phase 03 brain consumes. NOTHING here sends.

## Key insights
- Current OAuth only grants send-equivalent (Drive/`gmail.send`). Reading needs **`gmail.readonly`** (or `gmail.modify` if we later want to mark-read). Adding a scope = **users must re-consent** — this is an onboarding/migration step, gate everything behind "has read scope".
- **Threading is header-driven:** capture Gmail `threadId` + our sent message's RFC `Message-ID` on every send; send replies with `In-Reply-To`+`References`=stored ids and `threadId`=stored → Gmail collapses the conversation. `sendGmailAs` must be extended to (a) accept/emit these headers and (b) return `threadId`+`messageId`.
- **Matching inbound→thread:** primary key = Gmail `threadId` (we stored it). Fallback = sender email == `lead.email`. Ignore our own outbound + auto-replies (check `From`, `Auto-Submitted` header, `Precedence: bulk`).
- MVP = **polling** the known nurtured threadIds (cheap, bounded set) — no Pub/Sub push/watch infra. `users.messages.list q="threadId:<id>"` or per-thread `users.threads.get`, filter messages with `internalDate > thread.lastCheckedAt` and `From != owner`.

## Requirements
**Functional:** extend send to capture+return `threadId`/`messageId` and accept reply headers; detect owner's Gmail read-scope; poll active threads for new inbound lead messages; persist normalized `InboundReply` (threadId, from, snippet/body decrypted-at-rest, receivedAt, gmailMessageId) idempotently; skip self/auto/bulk.
**Non-functional:** idempotent (never re-ingest same gmailMessageId); reply body encrypted at rest like `Lead` PII; graceful when scope missing (surface `gmail_read_scope_missing`, don't crash cron); rate-aware (Gmail read quotas).

## Architecture
Extend `sendGmailAs` (`src/email/gmail-send.ts`):
```ts
type SendResult = { ok; id?; threadId?; messageId?; error? };  // add threadId + RFC messageId
sendGmailAs(ownerId, { to, subject, body, inReplyTo?, references?, threadId? }, sendFn?)
// build raw MIME with In-Reply-To/References headers; pass threadId to gmail.users.messages.send
```
On send completion (Phase 01 hook), persist `thread.gmailThreadId`/`thread.lastMessageId`.

New reply ingestion:
```
nurture-reply-poller.ts (cron, ENABLE_NURTURE_REPLY_CRON):
  for each owner with read scope:
    for each active thread with gmailThreadId:
      msgs = gmailListThread(ownerId, gmailThreadId, since=thread.lastCheckedAt)
      for m in msgs where from==lead.email && messageId not seen:
        persist InboundReply(threadId, gmailMessageId, from, body*, receivedAt)
        thread.hasUnhandledReply = true; thread.lastCheckedAt = now
```
New Prisma:
```prisma
model InboundReply {
  id, threadId (FK LeadNurtureThread), gmailMessageId (unique), fromEmail, bodyEnc, receivedAt, handled Boolean @default(false)
}
// LeadNurtureThread += hasUnhandledReply Boolean, lastCheckedAt DateTime?
```
Gmail read client: `src/nurture/gmail-read.ts` — `listThreadMessages(ownerId, threadId, since)`, `hasGmailReadScope(ownerId)` (uses same refresh token; scope check via tokeninfo or a probe call catching 403 `insufficientPermission`).

## Related code files
**Create:** `src/nurture/gmail-read.ts`, `src/nurture/reply-repo.ts`, `src/nurture/nurture-reply-poller.ts`, `src/nurture/nurture-reply-cron.ts`.
**Modify:** `src/email/gmail-send.ts` (headers + return threadId/messageId), `prisma/schema.prisma` (`InboundReply` + thread cols), `src/social/connect-providers.ts` / Google consent scope list (add `gmail.readonly`), `src/config/env.ts`+`.env` (`ENABLE_NURTURE_REPLY_CRON`), `src/server.ts` (mount), onboarding/connect UI (prompt re-consent for read scope — Phase 04).

## Implementation steps
1. Add `gmail.readonly` to the Google consent scopes; add `hasGmailReadScope` probe + a "reconnect for replies" surfacing.
2. Extend `sendGmailAs` MIME builder for `In-Reply-To`/`References`, pass `threadId`, return `threadId`+RFC `messageId`; persist on thread (wire Phase 01 hook).
3. `gmail-read.ts` list-thread-since + decode body (text/plain preferred).
4. `InboundReply` model + `reply-repo` (idempotent upsert on `gmailMessageId`).
5. `nurture-reply-poller` + cron + server mount + flag; self/auto/bulk filtering.
6. Set `hasUnhandledReply` for Phase 03 to consume.

## Todo
- [ ] Add gmail.readonly scope + reconnect prompt + `hasGmailReadScope`
- [ ] `sendGmailAs` threading headers + return ids; persist on thread
- [ ] `gmail-read.ts` list-thread-since + body decode
- [ ] `InboundReply` model + idempotent repo
- [ ] reply-poller + cron + mount + flag
- [ ] self/auto-reply/bulk filtering
- [ ] `verify-reply-ingestion.ts` (fixture Gmail payloads → InboundReply; no live Gmail): match by threadId, dedup, skip-self

## Success criteria
Sent nurture mail returns + stores `threadId`/`messageId`; a real reply from a test lead is ingested into `InboundReply` and matched to the right thread, exactly once, staying in one Gmail conversation. Missing read scope surfaces a reconnect prompt, doesn't crash the cron.

## Risk / security
- Reading a user's inbox = elevated trust: **only** read threads WE started (scope query by our `threadId`), never a general inbox scan; document + minimize.
- Reply body PII → encrypt at rest (reuse vault approach); redact in logs.
- Scope re-consent friction → clear onboarding; feature degrades to one-way (Phase 01) if not granted.
- Quota: bounded to active nurtured threads; backoff on 429.

## Next steps
Phase 03 brain consumes `InboundReply` (classify + draft response). Threading ids from here make the brain's response land in-thread.
