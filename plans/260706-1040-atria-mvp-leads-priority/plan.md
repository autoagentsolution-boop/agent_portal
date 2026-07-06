# Atria MVP — merge plan (Lead Collector first)

Compare of `RefactorIdea/Atria-MVP-Plan.md` + `atria-command-center-v2.html` against the
current `MKTAgent/` backbone, with a build order that puts **Lead Collector** first (the
make-or-break the user flagged). **Planning only — no code in this pass.**

## TL;DR decisions
- **Do NOT fork a new folder.** Evolve `MKTAgent/` in place on a branch. Atria ≈ 60% already
  built here (orchestration, publisher, leads backbone, product-knowledge, strategy). A parallel
  folder would duplicate DB + adapters + orchestration = DRY disaster + double the demo to keep
  green. "Safety" = branch isolation + ADDITIVE modules, not a second codebase. (§Folder safety)
- **Lead Collector is priority #1** and its make-or-break is NOT the webhook (that exists) — it's
  **per-tenant lead attribution**. Today every inbound lead is hard-assigned to `SYSTEM_OWNER_ID`
  (`src/leads/service.ts` `resolveLeadOwner()`), so in a multi-tenant product every customer's
  leads land in one shared bucket. That single seam decides success. (Phase 01)
- **UI can adapt** without a rewrite — the Atria command-center is an evolution of the existing
  Orchestrate surface, not a new app. Main new pieces: multi-tier plan cards + credit model +
  a Leads page. (Phase 04)

## Gap analysis — Atria 8-agent vision vs current MKTAgent

| Atria layer | Atria wants | Current state | Gap |
|---|---|---|---|
| Memory | user+product profile store all agents read | ProductKnowledge library + campaign.brandContext + persona/accountType | Exists as data; not a first-class "Memory agent" read/write API. **Small** |
| Product Expert | conversational learn-the-product | `/product-knowledge/analyze` (docs→profile) + thin-product gate | Mostly there; missing the proactive "ask-until-enough" loop. **Small** |
| Researcher | web search + user docs → insight | none | **NEW** — no web-search agent |
| Strategist | strategy + **lead scoring** (user-defined criteria) | `strategy` agent (strategy only) | Strategy ok; **lead scoring NEW** |
| Editor | write posts/email + tone-sample approval | `concept_writer`/copy-gen + concept versions gate | Largely there. **Small** |
| Publisher | post + optimal-time suggest + approval | `publisher` (works) + approval gate + per-platform | Time-suggest missing. **Small** |
| **Lead Collector** | opt-in capture (form/import/**comment-keyword**), scoring, secure store | webhook/form/calcom intake + dedupe + GET /leads (T6) | **Per-tenant attribution broken; no UI; no comment-keyword; no scoring; PII unencrypted.** Priority |
| Orchestration | 3-stage flow, 2 checkpoints, **multi-tier plans** w/ token+credit | Orchestrate: understand→clarify→plan→run, 2 gates | Flow there; **multi-tier options + credit model NEW** |

Legend: **Small** = wire-up/extend; **NEW** = build; Priority = do first.

## Build order (Atria's own layering, re-sequenced to front-load Lead Collector risk)

The Atria doc says "Lead Collector near the end (needs careful security)". We INVERT the risk:
Lead Collector's hard part is architectural (tenancy + security), not volume — resolve it early
while the surface is small, then the later agents feed a collector that already works per-tenant.

1. **Phase 01 — Lead Collector** (priority): per-tenant attribution, PII security, Leads UI,
   comment-keyword source, lead scoring hook. → `phase-01-lead-collector.md`
2. **Phase 02 — Agent layers 1-3**: Memory API, Product Expert loop, Researcher (web search),
   Strategist scoring, Editor tone-gate, Publisher time-suggest. → `phase-02-agent-layers.md`
3. **Phase 03 — Orchestration + credit + safety**: multi-tier plan cards, credit model, the 5
   safety layers (approval/rate-limit/preview/kill-switch/audit). → `phase-03-orchestration-credit.md`
4. **Phase 04 — UI adaptation**: how the current web adapts to the command-center v2 look, what's
   reuse vs new, effort. → `phase-04-ui-adaptation.md`

## Folder safety — why in-place, not a new folder
- **Shared foundations** the Atria agents need already live in `MKTAgent/`: Prisma schema + tenant
  model, 5 social adapters, connector/vault layer, orchestration executor, SSE, credit/cost
  rollup. A new folder re-implements or symlinks all of it.
- **Real risk** is breaking the working demo, not "code proximity". Mitigate with: (a) a dedicated
  branch off `pivot/video-content-farm`; (b) new agents as ADDITIVE modules (`src/agents/researcher/`,
  `src/leads/scoring/`) behind existing seams — the working publish/orchestrate paths untouched;
  (c) each phase gated by its own verify script + the existing suite staying green.
- **When a folder WOULD make sense:** only if Atria diverged into a different runtime/stack. It
  doesn't — same TS/Prisma/Express. So: same folder, isolated branch, additive modules.

## Top risks
- **R1 (make-or-break):** multi-tenant lead attribution. Getting the intake→owner mapping + its
  auth wrong leaks one customer's leads to another. Design + review before any code. (Phase 01)
- **R2:** PII at rest. Lead email/phone are plaintext today; a breach is a legal event. Encrypt
  with the existing `crypto.ts` AES-GCM (same as OAuth tokens). (Phase 01)
- **R3:** comment-keyword capture depends on each platform's comment API + polling quotas — feasibility
  spike needed per platform before committing. (Phase 01)
- **R4 (downgraded):** credit is display-only for MVP (transparent token passthrough, no billing) —
  low risk; just pick a stable tokens→credit divisor so a future paid plan can layer on without rework.

## Decisions (user-confirmed 2026-07-06) — resolves the open questions
1. **Intake = unique token per owner.** Each owner gets a rotatable intake token; URL/header carries
   it → maps to ownerId. (Phase 01 gap 1, as designed.)
2. **Credit = transparent token passthrough (input/output), shown friendly for non-tech users.** No
   markup, no paid tier yet (can add later). So: track real input/output tokens (we already persist
   per-node), convert to a simple human number ("credit") + plain-language cost display. No billing
   engine in MVP — just clarity. (Phase 03, simplified.)
3. **Comment-keyword = ONLY comments on posts Atria itself published**, simple platforms first
   (FB/IG). Big simplification: we already hold the published post ID + page token, so we poll just
   OUR post's comments for the keyword — no general social-listening. (Phase 01 gap 4, re-scoped.)
4. **Lead scoring = hybrid: rule-based + LLM-assisted** together. (Phase 01 gap 5 / Phase 02 Strategist.)
5. **Researcher = no external search API.** Use Gemini's built-in Google Search grounding (we already
   call Gemini) + user-provided docs. Zero new dependency/provider. (Phase 02 Researcher.)
