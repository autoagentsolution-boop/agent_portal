# Phase 01 — Lead Collector (PRIORITY, make-or-break)

**Priority:** P0. **Status (2026-07-06):** CORE DONE + verified + pushed (a0a53e8).
- ✅ #1 per-tenant attribution (intake tokens, isolation) — commit + verify-leads-tenancy
- ✅ #2 PII encryption + blind-index dedupe + backfill — verify-leads-pii
- ✅ #5 hybrid scoring (rule on capture + LLM rescore) — verify-leads-scoring
- ✅ #3 Leads UI (🎯 page: intake setup + scored table + AI-score)
- ⏳ #4 comment-keyword source — NOT done: needs a live FB/IG Graph-API spike on the user's
  connected page (poll a published post's comments for the keyword) before building the poller.
- ⏳ #6 wire as orchestration agent — deferred (low priority, thin wrapper).

Original analysis below.

## Context / current seams (read before designing)
- `MKTAgent/src/api/leads-router.ts` — 3 public intakes (`/leads/webhook`, `/leads/form`,
  `/leads/calcom`), shared-secret auth (constant-time `safeEqual`); JWT `GET /leads`.
- `MKTAgent/src/leads/service.ts` — `captureLead()` chokepoint: dedupe (email/30d or calcom uid),
  persist, notify. **`resolveLeadOwner()` returns `SYSTEM_OWNER_ID` — the make-or-break seam.**
- `MKTAgent/src/leads/normalize.ts` — per-source normalizers → `NormalizedLead`.
- `MKTAgent/prisma/schema.prisma` `model Lead` (email/phone/message/source/rawPayload…),
  `enum LeadSource { webhook form calcom }`.
- `MKTAgent/src/lib/crypto.ts` — AES-256-GCM used for OAuth tokens (reuse for PII).
- No leads UI anywhere in `web/src`.

## The 5 gaps, in dependency order

### 1. Per-tenant attribution (R1 — make-or-break)
Today: `resolveLeadOwner()` → `SYSTEM_OWNER_ID`, so every customer's inbound leads pool into one
owner. A multi-tenant product cannot ship this.
- **Design:** give each owner a unique **intake token** (not the shared global secret). Intake URL
  carries it (`/leads/form?t=<intakeToken>` or header). `resolveLeadOwner(token)` looks it up →
  ownerId. Store hashed tokens (`mkt_lead_intake_token` table: ownerId, tokenHash, label, active).
  Rotatable, revocable. Global shared secret stays only for the legacy DAIS funnel (back-compat).
- **Files (later):** new migration (intake-token table); `service.ts` `resolveLeadOwner`→token
  lookup; `leads-router.ts` read the token; a `GET/POST /leads/intake-tokens` mgmt route.
- **Security review REQUIRED** before code: token entropy, constant-time compare, no token in logs.

### 2. PII at rest (R2)
Email/phone/name stored plaintext. Encrypt with existing `crypto.ts` (same pattern as OAuthToken).
- **Design:** encrypt `email`,`phone`,`name`,`message` columns; keep a **blind index** (HMAC of
  lowercased email) for the 30-day dedupe query (can't dedupe on ciphertext). Drop or scrub
  `rawPayload` (no-excess-storage principle) — keep only normalized fields.
- **Migration:** add `email_bidx`, encrypt existing rows in a data-migration step.

### 3. Leads UI (none today)
- **Design:** a `Leads` page (sidebar item, like the new 📚 Product Knowledge): table (name, email,
  source, score, receivedAt), filter by source/score, per-lead detail, export CSV. Read-only first;
  scoring column feeds from gap 5. Reuses `GET /leads` (add score + pagination).

### 4. Comment-keyword source (R3 — new opt-in channel) — RE-SCOPED (user decision #3)
Capture opt-in leads from **comments on posts Atria itself published**, keyword-gated (e.g.
"Atria AI"). Simple platforms first (FB/IG). **Big simplification vs general social-listening:**
we already store the published post ID (`post.postUrls` / publish result) + the page-scoped token,
so we poll only OUR post's comment thread for the keyword — no account-wide monitoring, no extra
permissions beyond what publishing already uses.
- **Feasibility spike FIRST:** FB/IG "get comments on a post" via Graph API with the page token we
  hold; poll interval vs quota. (Publish already succeeds on FB, so the token/scope path is proven.)
- **Design:** `enum LeadSource` += `comment`; a poller keyed on published post IDs → match keyword →
  normalize the commenter (name + platform handle; email only if they leave one) → `captureLead` as
  opt-in (the keyword IS the consent signal). New `src/leads/sources/comment-poller.ts` additive
  module, scheduled like the existing token-refresh cron. Only polls posts published by Atria.
- **Note:** a comment lead often has no email → dedupe/PII design (gaps 1-2) must handle a
  platform-handle identity, not just email (blind index on `platform:handle` too).

### 5. Lead scoring (Strategist hook) — HYBRID (user decision #4)
Combine rule-based + LLM-assisted, both from the start:
- **Rule layer (deterministic, cheap, always-on):** user-defined weights (source, keyword match,
  recency, has-email/phone) → a base score. Runs on every capture, no token cost.
- **LLM layer (optional per lead, credit-aware):** Gemini reads the lead's message/comment text +
  campaign context → intent/quality signal that adjusts the score, with a short reason. Gated by the
  credit model (don't LLM-score spam). Store `score` + `scoreReasons[]` (which layer contributed).
- Score on capture + rescore when criteria change. Strategist agent authors the rule weights and the
  LLM rubric (the Strategist↔Lead Collector bridge in Phase 02).

### 6. Wire Lead Collector as an orchestration agent (optional for MVP)
Currently intake is standalone (external funnels). To match the Atria flow diagram, add a
`lead_collector` agent node that, post-publish, registers the campaign's opt-in funnel (form URL /
comment keyword) so a run visibly "collects leads". Thin wrapper over the existing service; the
actual capture stays webhook-driven. Low priority vs gaps 1-3.

## Build sub-order within Phase 01
1 (attribution) → 2 (PII) → 3 (UI, so it's demoable) → 5 (scoring) → 4 (comment-keyword, after spike) → 6 (agent wire).

## Success criteria
- Two tenants' leads never cross (verify: two intake tokens, capture each, `GET /leads` isolation).
- Lead PII ciphertext at rest; dedupe still works via blind index.
- Leads page lists + filters + exports a tenant's leads.
- Scores computed + rescore on criteria change.
- Comment-keyword capture proven on ≥1 platform (or explicitly deferred with a documented reason).

## Verify (later)
`verify-leads-tenancy.ts` (isolation), `verify-leads-crypto.ts` (encrypt + blind-index dedupe),
extend existing suite; no live social posts (no-burst rule).

## Security notes (dev must own or consult)
Intake-token entropy + constant-time compare; PII encryption + blind index; no PII/token in logs
(existing `feedback_never_grep_env_values` discipline); GDPR-style delete (hard-delete a lead +
its blind index). This phase is the one the Atria doc flags: "cần dev hiểu bảo mật".
