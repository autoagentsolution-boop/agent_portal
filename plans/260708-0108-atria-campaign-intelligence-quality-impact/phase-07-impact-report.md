# Phase 07 — Impact / Value Report (prove the ROI)

**Priority:** HIGH (retention + sales). **Status:** planned. **Depends on:** 03–05 (campaigns to report on).
**Goal:** Show the user the concrete value Atria delivered — output, leads, and especially COST SAVED —
so "$20 with Atria vs ~$500 + 2 months with an agency" is visible, per-campaign and per-period.

## What's grounded vs estimated (honesty matters)
- **REAL (already captured):** cost spent (`mkt_llm_usage` ledger + credits, per owner/surface/run),
  output volume (posts, media pieces, platforms — from Post/Artifact rows), wall-clock time (run
  timestamps), **leads captured** (`mkt_lead` per campaign, from Lead Collector).
- **ESTIMATED (labeled):** cost SAVED vs a market baseline (agency/freelancer rate × equivalent human
  hours) and reach — v1 uses a transparent heuristic clearly labeled "estimate". REAL reach/views/
  engagement need platform Insights APIs → v2 (Analytics agent). Never present an estimate as measured.

## What's new
1. **Impact metrics service** (`impact/impact-metrics.ts`) — pure aggregation over existing data for a
   campaign or period: `{ postsPublished, platforms, mediaPieces, creditsSpent, usdSpent, leadsCaptured,
   runMinutes }`. Reuses the cost ledger + credits lib; no new capture.
2. **Value model** (`impact/value-model.ts`) — a CONFIGURABLE baseline (env/workspace: agency day-rate,
   hours-per-post, freelancer per-post) → `{ baselineUsd, baselineDays, savedUsd, savedDays }` +
   estimated reach (leads × configurable funnel factor, or a per-platform heuristic). All inputs are
   named constants a workspace can tune — no magic numbers.
3. **Impact report artifact** — `GET /campaigns/:id/impact` and `GET /impact?period=` → a structured
   report the UI renders: headline ("$20 vs ~$540 / 6 weeks"), the real numbers, the estimated ones
   clearly tagged, and a per-pillar/what-worked breakdown (feeds Phase-06's "repeat what worked").
4. **Feedback into proactivity** — the impact numbers become Phase-06 signals ("this pillar drove the
   most leads → suggest more of it next campaign"). The loop that makes Atria look smart.

## Related code files
Create: `impact/impact-metrics.ts`, `impact/value-model.ts`, `api/impact-router.ts`,
`impact/verify-impact.ts`. Modify: `config/env.ts` (baseline constants), server route mount, campaign
repo (rollup query). Read: `cost/llm-usage.ts`, `cost/credits.ts`, `db/repos/*` (posts, leads).

## Steps
1. impact-metrics aggregator (real numbers, pure).
2. value-model (configurable baseline → saved cost/time + estimated reach, all labeled).
3. `/campaigns/:id/impact` + `/impact?period=` endpoints.
4. Verify: seed a campaign (N posts, real ledger rows, K leads) → report shows correct real numbers +
   a saved-vs-baseline figure from the configured constants + reach clearly tagged "estimate".

## Acceptance
- After a campaign, the user sees a truthful, compelling Impact report: real cost/output/leads + a clearly
  labeled saved-vs-agency estimate. Numbers reconcile with the Usage page (no double-count).

## Next → Phase 08 renders the report + everything else in the UI.
