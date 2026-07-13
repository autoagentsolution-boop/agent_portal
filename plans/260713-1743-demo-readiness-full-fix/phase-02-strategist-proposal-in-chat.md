# P2 — Strategist Campaign Proposal Inline in Chat

**Priority:** HIGH · **Status:** ✅ DONE (Option B, FE, typecheck clean; browser check = P6) · **Layer:** FE. No DTO change needed — run DTO already carries nodes/artifacts/goal.campaignScope.

## Done (2026-07-13)
- `PlanCard` strategist vs single VARIANT: detects `campaign_strategist` node → "🗓 Strategist campaign" header + explainer (`~N-post calendar over W weeks across your pillars — approve every slot`), computed from `goal.duration/cadence`; else "📄 Single post". Execute button label context-aware ("▶ Draft the calendar" vs "▶ Duyệt & Chạy ngay"). Single-vs-strategist now unmistakable in chat.
- INLINE calendar after execute: `execute()` for a strategist plan does NOT redirect — sets the run and `pollStrategistGate` (bounded 40×2.5s, unmount-guarded) polls `GET /runs/:id` until the selection gate, then reuses `<ContentCalendar runId slots={artifacts.content_calendar.slots} onDone>` right in the transcript → approve → materialize → grant, no navigation. "Open in Active Flows for deep edit" kept as secondary.
- Latent fix: `post-workflow-view.tsx` excludes `campaign_strategist` from the generic "external action" gate label.
- `.plan-scope` CSS badge.
Non-strategist execute path unchanged (still redirects) → small blast radius. Real strategist run in browser → P6.

## Problem
When Atria proposes a campaign-scope (strategist) workflow, the chat only shows a generic `PlanCard` (Save/Execute) — it does NOT render the proposed content calendar. The editable calendar exists but only appears AFTER execute + navigation into Active Flows (`saved-flow-detail.tsx:284`). So the user "can't understand how Atria proposes a strategist campaign" from chat, and can't tell single vs strategist apart in the moment.

## Goal
In the chat transcript, when the proposed plan is campaign-scope, render an INLINE, understandable proposal: a labeled "Strategist campaign" card that (a) states clearly it's a multi-post calendar (vs a single post), (b) previews the proposed calendar slots (pillar/angle/format/platforms/day), and (c) lets the user approve → materialize + (optional) autonomy grant, OR open in Active Flows for deep edit. Single-scope proposals keep the current single-post card but LABELED "Single post".

## Key facts (from scan)
- Scope routing: `workflow-planner.ts:48-52` (`campaignScope !== 'single'` → `campaign_ideas, strategy_brief, content_calendar`).
- Strategist node: `agent-registry.ts:86-119` (`campaign_strategist`, gate `selection`, produces `content_calendar`). Runner `agent-runners.ts:449-481`.
- The calendar UI already exists: `content-calendar.tsx:74-97` (editable grid), approve→`materializeCalendarFromRun` (`client.ts:564` → `POST /campaigns/:id/materialize` → `campaign-materializer.ts:55`). Two-step autonomy grant at `content-calendar.tsx:31-72`.
- Chat plan card: `OrchestratePanel.tsx:298-306 PlanCard`, execute → `onOpenFlow(run.id)` (`:231`).
- Read-only calendar text summary already derivable: `web/src/flow/artifact-format.ts:116-120`.
- Latent bug to fix while here: `post-workflow-view.tsx:318` has no `campaign_strategist` branch → generic "external action" mislabel (only latent since strategist never runs under a Post, but fix the label mapping for safety).

## Architecture
Two options — pick B (fuller, matches "no thin layer"):
- **A (min):** in `PlanCard`, when the plan contains `campaign_strategist`, add a badge "Strategist campaign — N-post calendar" + a one-line explainer, keep Save/Execute. Cheap, clarifies intent, but still no inline calendar.
- **B (recommended):** render the calendar INLINE. The proposal already carries the plan; but the actual `content_calendar` artifact is only produced when the strategist RUNS. So to preview at PROPOSE time, either (i) show the strategist's INTENT (scope, pillars count, cadence, duration from `goal.duration`/`goal.cadence`) as a "what Atria will draft" card, then on Execute run the strategist and render the real editable `ContentCalendar` inline in the chat thread (reuse `content-calendar.tsx`) instead of forcing navigation. (ii) Keep "Open in Active Flows" as a secondary action for power editing.

Recommended: PlanCard gains a `strategist` variant showing scope + planned pillars/cadence/duration; Execute runs the strategist and the chat then embeds `<ContentCalendar runId=... />` (the same component `saved-flow-detail` uses) directly in the transcript with approve→materialize→grant flow — so the user never has to leave chat to see/approve the proposal.

## Related code files
**Read:** `web/src/components/OrchestratePanel.tsx` (298-306 PlanCard, 231 onOpenFlow), `web/src/components/content-calendar.tsx` (whole), `web/src/components/saved-flow-detail.tsx:284-293`, `web/src/flow/artifact-format.ts:116-120`, `src/orchestration/master/workflow-planner.ts:48-52`, `src/orchestration/schemas/goal-spec.ts` (duration/cadence/campaignScope), `web/src/components/post-workflow-view.tsx:318`.
**Modify:** `OrchestratePanel.tsx` (PlanCard strategist variant + inline ContentCalendar embed after execute), `content-calendar.tsx` (make embeddable in chat context; ensure it works with a runId not just in flow-detail), a plan-card copy/explainer, `post-workflow-view.tsx` (add campaign_strategist label branch), DTO/mapper if the plan needs to expose scope/pillars to FE (`mappers.ts`).

## Implementation steps
1. Surface scope + duration/cadence + a "strategist" flag on the run/plan DTO the chat reads (mappers).
2. PlanCard: branch on strategist → header "Strategist campaign", subline "Atria will draft a N-post calendar across your pillars — you approve before anything schedules", vs "Single post — set up one post".
3. On Execute of a strategist plan: run strategist, then embed `<ContentCalendar>` inline in the chat thread (extract/reuse from saved-flow-detail) with approve→materialize→grant.
4. Keep "Open in Active Flows" as secondary for deep edit.
5. Fix `post-workflow-view.tsx:318` label mapping for campaign_strategist gate.

## Todo
- [ ] DTO surfaces scope/pillars/cadence to chat
- [ ] PlanCard strategist vs single variant + explainer copy
- [ ] Inline ContentCalendar embed in chat after execute (reuse component)
- [ ] Approve→materialize→grant works inline
- [ ] Secondary "Open in Active Flows"
- [ ] post-workflow-view strategist label branch
- [ ] UI-flow verify (P6): ask "build a branding campaign monthly" → chat shows strategist card → execute → editable calendar inline → approve → posts scheduled

## Success criteria
From chat alone, the user can see it's a strategist campaign, preview/edit the proposed calendar inline, approve → posts materialize + schedule (auto-run via scheduler node), WITHOUT navigating away first. Single vs strategist is unmistakable in the card.

## Risk
- Calendar preview at propose-time is intent-only (real slots exist after strategist runs) — copy must be honest ("Atria will draft…"), not fake slots.
- Reusing `content-calendar.tsx` outside flow-detail: ensure it's decoupled from that page's state.
