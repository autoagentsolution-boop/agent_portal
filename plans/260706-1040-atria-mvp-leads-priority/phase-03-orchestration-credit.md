# Phase 03 — Orchestration + credit model + safety layers

**Priority:** P1, runs parallel to Phase 02 (it's the "glue"). The 3-stage flow + 2 checkpoints
already exist in Orchestrate; this phase adds multi-tier plans, the credit model, and the 5 safety
layers the Atria doc requires for a safe MVP.

## Already built (Orchestrate today)
- 3-stage flow: understand/clarify → plan (DAG) → run (SSE), with clarify gate + publisher approval
  gate = the doc's "2 điểm chốt".
- Per-node token + USD cost (my #5) + flow-cost rollup.
- Approval gate (publisher), DRY-run publish, per-node audit rows.

## New work

### Multi-tier plans (mockup: Tiết kiệm / Cân bằng / Đầy đủ)
- The command-center shows 2-3 plan options, each with agent count + token estimate + credit cost;
  user picks one (checkpoint 2).
- **Design:** the planner emits N variants (fewer agents / balanced / full) instead of one DAG.
  Estimate tokens per variant from historical per-agent averages (we now persist per-node tokens →
  real data exists). Render as selectable plan cards; the chosen variant becomes the run.
- Reuses the existing PlanCard; adds a variant selector + estimate line.

### Credit model — TRANSPARENT TOKEN PASSTHROUGH (user decision #2)
No billing engine, no markup, no paid tier in MVP — the goal is **clarity for non-tech users**, not
monetization (can add pricing later).
- **Formula:** credit = a friendly presentation of real input/output tokens consumed (which we ALREADY
  persist per node). e.g. show "≈ 60 credits (12k in / 3k out tokens)" — a plain number a non-tech
  user reads, with the raw in/out tokens available on hover for transparency. Pick a fixed
  tokens→credit divisor (a display constant, not a price).
- **Pre-run estimate** uses per-node token history (real averages) → the multi-tier cards show
  estimated credits per tier. **Post-run** shows actual. No ledger/debit/hold needed for MVP — just
  accumulate + display actuals (a `mkt_usage` roll-up per owner/run is enough; a debiting ledger
  waits until there's a paid plan).
- Keep the tokens→credit divisor a single config constant so a future paid plan can layer a price on
  top without reworking the display.

### 5 safety layers (Atria doc requires)
| Layer | Current | Do |
|---|---|---|
| Approval Gate | publisher gate exists | extend to any real-world action (send/collect) |
| Rate Limit | per-adapter + in-process (§11.15) | per-plan quota tie-in |
| Preview | publish-review exists | ensure every real action has a preview |
| Kill Switch | none | a run-level abort + global "pause all external actions" flag |
| Audit Log | external_action_audit_log + node rows | extend to leads capture + credit debits |

Kill Switch is the only net-new safety primitive; the rest are extensions.

## Success criteria
- Planner returns selectable tiers with real token/credit estimates; picking one runs that variant.
- Credit balance debits on run, reconciles to actual, visible pre-run + post-run.
- Kill switch halts a run and a global pause blocks new external actions; both audited.

## Notes
- Estimates should use the per-node token history we already persist — not guesses.
- Credit ledger + kill switch are additive tables/flags; no rewrite of the executor.
