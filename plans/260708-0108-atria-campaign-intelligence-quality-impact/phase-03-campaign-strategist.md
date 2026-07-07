# Phase 03 — Campaign Strategist + Content Calendar

**Priority:** CORE (headline). **Status:** planned. **Depends on:** 01–02 (built on the quality builder).
**Goal:** From a campaign-scale intent, produce a research-backed, editable **content calendar** (N slots).

## What's new
1. **Campaign intent** — extend `GoalSpec` + analyzer: `campaignScope: 'single'|'campaign'|'spotlight'`
   (default `single` → today UNCHANGED), `duration` (`{weeks}`), `cadence` (posts/week or per-platform).
   Analyzer detects "plan a month/week/campaign" → campaign; "one big push/spotlight" → spotlight.
2. **`content_calendar` artifact** — ordered `CalendarSlot[]`: `{ index, pillar, angle,
   format:'text'|'image'|'carousel'|'video', platforms[], hook, rationale, dayOffset }` (concrete dates
   assigned in Phase 04).
3. **`campaign_strategist` agent** (Intelligence group) — registry entry + runner, `gate:'selection'`
   (calendar is the produce-then-review gate). `requires:[]`, `optional:['research_summary',
   'strategy_brief']`, `produces:['content_calendar']`. Runner builds pillars × funnel arc × cadence ×
   platform-native format across `duration` → slots. Uses the Phase-01 builder + Phase-02 instructions
   (so the calendar is on-brand + expert-grade), grounded in product knowledge, LLM-authored to schema.

## Planner integration
- `selectAgents`: `campaignScope !== 'single'` → select `content_search? → ideation → strategy →
  campaign_strategist` and STOP (per-post media/publisher belong to the materialized posts in Phase 04).
- New run `kind: 'campaign_plan'` (kind is free-form). The strategist run parks at its selection gate
  with the calendar for review. `single` path byte-identical.

## Related code files
Modify: `schemas/goal-spec.ts`, `master/deterministic-analyzer.ts` + `master/requirement-analyzer.ts`,
`schemas/artifact-schemas.ts`, `registry/agent-registry.ts` + `agent-types.ts`,
`executor/agent-runners.ts`, `master/workflow-planner.ts`.
Create: `orchestration/verify-campaign-strategist.ts` (strategist prompt uses the Phase-01 builder).

## Steps
1. GoalSpec + analyzer campaign fields (default single = regression-safe).
2. content_calendar artifact + type.
3. campaign_strategist registry entry (expert `promptSections`) + runner via the builder.
4. Scope-aware planner select + `campaign_plan` kind.
5. Verify (DRY-RUN stub LLM): campaign goal → strategist parks with a valid N-slot calendar (pillars
   rotate, per-slot format valid for its platforms, count ≈ cadence×duration); single goal UNCHANGED.

## Acceptance
- A campaign intent yields a schema-valid, on-brand `content_calendar`; single-scope planning unchanged
  (all planner/executor verifies green).

## Next → Phase 04 materializes the approved calendar into scheduled posts.
