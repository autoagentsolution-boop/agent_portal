# Multi-channel Lead-Nurture & Relationship Nodes — Plan Overview

**Date:** 2026-07-13 · **Branch:** `pivot/video-content-farm` · **Status:** RESEARCH DONE → plan drafted, NOT started
**Goal:** Add nurture/relationship agent nodes beyond the existing `email_agent` — (a) opt-in **direct messages** (WhatsApp, Zalo, Telegram), (b) public **@mention/reply greetings** (X, Threads, Facebook, Instagram), and (c) harden **comment→lead capture** already present on all 5 social platforms.

## Reality gate (read first)
Official APIs do **not** allow posting on another person's wall or cold-DMing strangers. Everything here is either opt-in messaging or public mention/reply. See `research-synthesis.md` + the two researcher reports:
- `plans/reports/researcher-260713-1251-dm-nurture-apis.md`
- `plans/reports/researcher-260713-1251-wall-post-and-comment-capture-apis.md`

Feasibility verdicts drive scope:
- **Build:** WhatsApp (🟢), Telegram (🟡 opt-in), X/Threads/FB/IG mention-greeting (🟡), webhook-ify Meta comment capture (🟢).
- **Defer/constrain:** Zalo ZNS (🟡 VN-only, needs ZNS approval), X comment capture (🟡 paid tier).
- **Do NOT build:** LinkedIn DM (🔴 no API, ban risk), literal "wall posting" on any platform (🔴).

## Architecture decision
Mirror the **email node pair** (`*_writer` → `*_agent`, gate `publish`, `requiresApproval:true`), NOT the social publisher, because DMs are 1:1 + approval-gated + use non-`SocialPlatform` credentials (`email_agent` already sets `requiresConnection:false` and checks connectivity inside the runner for exactly this reason). Use a **channel slot + pluggable adapter registry** (like `publishTo` fan-out) so 3 DM channels = 1 node pair, not 3.

## Phases
| # | Phase | Verdict scope | Status |
|---|-------|--------------|--------|
| 01 | [DM nurture node](phase-01-dm-nurture-nodes.md) — `dm_writer`→`dm_agent` + WhatsApp/Telegram(/Zalo) adapters, opt-in contact model | 🟢🟡 | TODO |
| 02 | [Mention-greeting node](phase-02-wall-greeting-engagement-nodes.md) — `greeting_writer`→`greeting_agent`, @mention/reply via existing social adapters (new adapter actions) | 🟡 | TODO |
| 03 | [Comment-capture hardening](phase-03-lead-capture-extension.md) — Meta webhooks, live-test Threads/X fetchers, tier-gate X, honest handle-only lead model | 🟢🟡 | TODO |

## Key dependencies
- New non-`SocialPlatform` messaging channels → `MessagingChannel` enum + Prisma migration (separate from `SocialPlatform`).
- WhatsApp/Telegram/Zalo credentials & opt-in contact store → new tables + vault reuse (`credential-vault.ts`, `TOKEN_ENC_KEY`).
- No new email/phone enrichment — comment leads stay handle/id unless the commenter typed contact info (unchanged).

## Non-goals (YAGNI)
LinkedIn DM; literal wall posting; scraping/unofficial APIs; contact enrichment/data-broker lookups; bulk cold outreach (violates every platform + `feedback_no_burst_social_posts`).
