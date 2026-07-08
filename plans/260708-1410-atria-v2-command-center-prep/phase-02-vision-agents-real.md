# P2 — Vision agents → real

**Priority:** P1 · **Status:** DONE — ALL 4 vision agents live (Memory 2a, Analytics 2b +IG, Lead Collector 2d,
Email 2c). Each is a live Command-Center `surface` (implStatus:'live'+surface), opening a drawer panel — NOT a
DAG RunnableAgentId (they're meta/assistant surfaces). Future vision AIs stay display-only "coming-up" nodes.

## Key insight
`vision-agents.ts` holds 4 display-only nodes (memory, analytics, email, lead_collector) with a
`whatItWouldDo` pitch but NO runner. Making one "real" = give it a runner + registry entry (like the 9
runnable agents) + wire its data. Lead Collector is already partially real (comment capture + leads
cron). Each has a different integration surface (below).

## Sub-phases
### 2a. Memory (FIRST — highest WOW, no external API)
"Atria learns your style." Builds directly on the existing instruction system
(`instructions-router.ts`, `resolveRunInstructions`, per-agent/workspace scope) + `copyEdited`
signal (the edit-ratio Atria already tracks in `signal-reader.ts`).
- Turn user edits/refines into LEARNED instructions (proposed, user-approved — mirrors the
  suggest→approve loop). Memory Agent = the surface that proposes "remember this style?" and, on
  approval, writes a workspace/agent instruction that future runs honor.
- Files: `signal-reader.ts` (edit signal exists), `atria-suggestions.ts` (R4 memory pitch exists),
  `instructions` (storage), a new `memory` runner/surface.

### 2b. Analytics
Real post Insights (reach/engagement) — needs platform Insights API (FB/IG app-review scoped).
- MVP: FB Page Insights on published posts (owner has FB). Feeds the Impact "reach" (today estimated).
- Gate: app-review for full metrics; ship FB-first, mark others estimated.

### 2c. Email Campaign
New channel: nurture the captured leads (Leads already exist, scored). Needs an email provider
(pick one) + templates. Ties to the R3 "nurture your leads" suggestion.

### 2d. Lead Collector (finish + surface)
Already real (comment keyword capture, 5 platforms, liveness). Promote from vision node to a
Command-Center workspace surface (leads dashboard as an agent room).

## Todo
- [x] **2a Memory: DONE + LIVE-VERIFIED (2026-07-08).** edits→proposed learned-instructions→approve→applied. `memory-agent.ts` (proposeMemories: gathers copyEdited posts → Gemini → 1-3 style rules, injectable LlmJsonFn for DRY verify, records surface:'memory'); `memory-router.ts` (GET / , GET /proposals, POST /accept, DELETE /:id); accepted = `source:'memory'` instruction scope=workspace agentId=concept_writer → resolveInstructions (already in copygen) injects it into every future draft. Memory node flipped `implStatus:'live'`+`surface:'memory'` (vision-agents), CC opens `MemoryPanel` inline (new drawer kind 'surface'). verify-memory-agent PASS (loop incl. applied-to-concept_writer-not-ideation + tenant isolation). LIVE: real Gemini produced 3 evidence-grounded rules from user's 3 edits; accepted one → DB row source=memory/concept_writer confirmed.
- [x] **2b Analytics: DONE + LIVE-VERIFIED (2026-07-08).** FB Page Insights → measured metrics into Impact.
  `src/analytics/fb-insights.ts` (TWO independent metric groups — Graph fails the whole call if ANY metric
  is invalid: reach group `post_impressions_unique,post_impressions`; engage group `post_clicks,post_reactions_by_type_total`;
  best-effort per group, 30min TTL cache, MAX_POSTS=50). `sumFbInsights` per-field-nullable → Impact keeps
  its labeled estimate when Meta withholds a field. Wired into `metricsForCampaign`/`metricsForPeriod`
  (ImpactMetrics += measuredReach/Impressions/Engaged + fbPostsMeasured); `buildImpactReport` headline prefers
  measured reach→engagement→estimate; impact-report.tsx shows measured reach/engagement stats. Analytics node
  flipped `implStatus:'live'`+`surface:'impact'` → opens Impact inline in CC drawer. verify-fb-insights PASS.
  **⚠ LIVE FINDING:** on Graph v25.0 the classic `post_impressions*`/`post_engaged_users` are DEPRECATED/withheld
  (Meta gives no post reach for pages <100 followers) → reach=null for the test page (graceful → estimate).
  Engagement group WORKS: 6 FB posts measured, measuredEngaged=0 (real: 0 clicks/reactions). Reach populates
  automatically on a qualifying page. UI stat "engagements (FB) · measured · clicks + reactions · 6 posts" live.
- [x] **2c Email: DONE + LIVE-VERIFIED (2026-07-08).** Nurture leads via the owner's own GMAIL (no 3rd-party ESP —
  reuse Google OAuth, added `gmail.send` scope to `driveAuthUrl`). `src/email/gmail-send.ts` (`sendGmailAs` owner token
  + shared `buildRaw` RFC822/base64url, extracted from leads/notify.ts DRY; `hasGmailConnected`); `email-agent.ts`
  (`draftNurtureEmail` — Gemini, warm personal, human-gate no-blast, surface:'email' usage); `email-router.ts`
  (GET /status, /leads [decrypted, nurture-sorted], POST /draft, POST /send→stamps nurturedAt). Migration
  `lead_nurtured_at` (Lead.nurturedAt idempotency/audit + repo `markLeadNurtured`). Email node→live surface;
  `EmailPanel` (leads→Draft→edit→Send one-at-a-time). verify-email-agent PASS. LIVE: real Gemini drafted a grounded
  nurture email for the real lead, editor renders. ⚠ actual SEND needs user to RECONNECT Google (old token=drive-only
  scope → `gmail_scope_missing` until re-consent) + is outward-facing (didn't send). **ALL 4 vision agents now live.**
- [x] **2d Lead Collector: DONE + LIVE-VERIFIED (2026-07-08).** Already real (comment capture/scoring/liveness);
  promoted from display-only vision node → live CC surface. `lead_collector` flipped `implStatus:'live'`+`surface:'leads'`;
  CC drawer renders the existing `LeadsPage` inline (DRY reuse, like Analytics→ImpactReport). No backend change.
  Live: node opens the full Leads dashboard (collectors w/ per-platform links, keyword Start/Stop/Extend, Poll comments, Intake setup).
- [x] flip Memory/Analytics/Lead-Collector → live surfaces (implStatus:'live'+surface; NOT DAG RunnableAgentIds — they're meta/assistant surfaces opening a CC drawer panel). Only **email** still planned.

## 2b multi-platform (user: "áp dụng cho platform khác không?")
- [x] **Instagram DONE 2026-07-08.** `src/analytics/ig-insights.ts` (`sumIgInsights` — reach + total_interactions
  groups, best-effort, TTL cache; IG `impressions` deprecated post-2024-07 → always null). Shared `insights-types.ts`
  (`InsightsSum` + `mergeInsights` null-aware) unifies FB+IG; impact-metrics merges both (renamed field
  `fbPostsMeasured`→`postsMeasured` + `insightsPlatforms`); headline/UI label the source (FB / IG / FB+IG).
  verify-ig-insights PASS. ⚠ Live-unverified for IG (account has NO IG posts yet — the IG publish path was
  fixed by P3 Drive but never live-posted) → IG contributes null, FB still measured. Real IG reach flows the
  moment an IG post exists (IG gives reach even for small accounts, unlike FB).
- Threads (`/{media}/insights?metric=views,likes,replies`, newer/limited), X (`public_metrics` — free tier
  blocks impressions), LinkedIn (org analytics partner-gated) = same pattern, still follow-up.

## Success criteria
- Memory demonstrably changes future content after an approved "remember" (verifiable signal).
- Each shipped agent runs as a real node in the Command Center, not a display stub.

## Risk
- Analytics/Email need external access (Insights app-review / email provider) — scope + gate per agent.
