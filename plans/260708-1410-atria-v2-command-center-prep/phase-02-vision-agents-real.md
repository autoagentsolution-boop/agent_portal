# P2 — Vision agents → real

**Priority:** P1 · **Status:** planned · Sequence: Memory → Analytics → Email → Lead Collector.
Other/future vision AIs stay display-only "planning / coming-up" nodes.

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
- [ ] 2a Memory: edits→proposed learned-instructions→approve→applied; Memory node runnable
- [ ] 2b Analytics: FB Page Insights → real reach into Impact
- [ ] 2c Email: provider + template + send-to-leads
- [ ] 2d Lead Collector: promote to Command-Center workspace surface
- [ ] flip each from vision-agents.ts → runnable registry as it lands

## Success criteria
- Memory demonstrably changes future content after an approved "remember" (verifiable signal).
- Each shipped agent runs as a real node in the Command Center, not a display stub.

## Risk
- Analytics/Email need external access (Insights app-review / email provider) — scope + gate per agent.
