# Phase 03 — Comment→Lead Capture Hardening (X, Threads, LinkedIn, Instagram)

**Priority:** Medium · **Status:** TODO · **Verdict scope:** already spans all 5 platforms; this HARDENS, not adds.

## Key finding (answers the user's direct question)
Comment lead-capture is **already implemented for all 5 platforms**, not just Facebook:
`src/leads/sources/comment-poller.ts` → `COMMENTABLE = ['facebook','instagram','threads','linkedin','x']`, 30-min cron (`comment-cron.ts`, `ENABLE_LEADS_CRON=true`). So the ask "did we do the same for X/Threads/LinkedIn/IG?" = **yes, mechanism exists.** The work is hardening the weak fetchers and (optionally) moving Meta to webhooks.

## Current state per platform
| Platform | Fetcher | State | Gap |
|---|---|---|---|
| Facebook | `comment-fetchers/meta.ts` | mature, gone-detection | poll only → webhook upgrade optional |
| Instagram | `comment-fetchers/meta.ts` | mature | poll only → webhook optional |
| Threads | `comment-fetchers/threads.ts` | **LIVE-UNTESTED**, media-id caveat | verify vs real token |
| X | `comment-fetchers/x.ts` | tier-gated (free → `[]`) | confirm paid tier; flag-gate |
| LinkedIn | `comment-fetchers/linkedin.ts` | unverified, partner-gated | likely leave best-effort |

**Hard limit (all platforms):** comment APIs return handle/id/name only — **never email/phone**. Current capture only mints a `Lead` when the commenter *typed* an email the keyword parser (`parseComment`) matched. Non-FB commenters are otherwise handle-only. This is correct behavior, not a defect — document it, don't "fix" it.

## Requirements
Real-time-ish, reliable capture on the platforms where it's cheap/free (Meta family). Honest handle-only lead records where no contact info is present. Cost containment on X.

## Architecture
Two tracks:
1. **Webhook upgrade (Meta: FB/IG/Threads)** — add a webhook intake beside the poller (poller stays as fallback/catch-up). New `POST /webhooks/meta` verifying `X-Hub-Signature-256`, routing `feed`/`comments`/`mentions` changes into the SAME `captureLead` chokepoint. Real-time, free, fewer API calls.
2. **Poll hardening (Threads/X/LinkedIn)** — live-test Threads fetcher against a real token; gate X behind `ENABLE_X_LEAD_CAPTURE` (paid tier); leave LinkedIn best-effort with clear log when partner scope absent.

Add a `handle-only` lead shape: capture commenter id/handle even without email (source `comment`, no PII) so the nurture nodes (Phase 01/02) have a target to greet/DM later — this is the bridge between capture and nurture.

## Related code files
**Read:** `src/leads/sources/comment-poller.ts` (`COMMENTABLE`, `parseComment`), `comment-fetch-graph.ts` (dispatcher), `comment-fetchers/{meta,threads,x,linkedin}.ts`, `src/leads/service.ts` (`captureLead` chokepoint), `src/leads/sources/comment-cron.ts`, `src/api/leads-router.ts` (existing webhook/form intake pattern), `prisma/schema.prisma` `model Lead` (L429) + `enum LeadSource` (L54).
**Create:** `src/leads/sources/meta-webhook.ts` (verify + route), webhook route in leads-router.
**Modify:** `comment-fetchers/threads.ts` + `x.ts` (harden/flag), `src/leads/service.ts` (accept handle-only lead), `prisma/schema.prisma` (Lead: nullable email OK already? confirm; add `platformHandle`/`platformUserId` columns), `.env`/`env.ts` (`META_WEBHOOK_VERIFY_TOKEN`, `ENABLE_X_LEAD_CAPTURE`).

## Implementation steps
1. Confirm `Lead` allows no-email handle-only rows; add `platformUserId`/`platformHandle` cols (migration).
2. `meta-webhook.ts`: GET verify challenge + POST signature check → normalize comment → `captureLead` (dedupe reuse).
3. Route in `leads-router.ts`; subscribe app to `feed`/`comments`/`mentions` fields (app-review prereq noted).
4. Live-test Threads fetcher; fix media-id vs shortcode resolution.
5. Gate X fetcher behind `ENABLE_X_LEAD_CAPTURE`; document tier requirement; free tier stays no-op.
6. LinkedIn: log-and-skip when partner scope missing (no false "captured 0" noise).
7. Handle-only lead path so captured commenters become nurture targets.

## Todo
- [ ] Lead handle-only columns + migration
- [ ] Meta webhook intake (verify + route → captureLead)
- [ ] Subscribe app fields (app review)
- [ ] Threads fetcher live-test + fix
- [ ] X fetcher tier flag
- [ ] LinkedIn graceful-skip
- [ ] `verify-comment-capture.ts` (fixture payloads → captureLead, no live calls)

## Success criteria
Meta webhook captures a real comment end-to-end into `Lead` (handle-only + email-typed cases). Threads fetcher returns real replies with a live token. X no-ops on free tier without error. No platform crashes the cron. Handle-only leads are queryable as nurture targets.

## Risk / security
- Webhook = public callback → strict `X-Hub-Signature-256` verify (reuse `MKT_LEAD_WEBHOOK_SECRET` pattern), reject unsigned.
- No email/phone from comments → do not imply enrichment we can't do (honest UX).
- App review + public URL infra required for Meta webhooks (deploy dependency).

## Next steps
Feeds Phase 01/02 (captured handles = nurture/greeting targets). Meta webhook needs public URL + app review; poller remains the no-infra fallback until then.
