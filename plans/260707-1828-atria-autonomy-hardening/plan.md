# Atria Autonomy Hardening — Plan

Fix the bugs / inconsistencies / uncovered logic paths found by the 5-reviewer audit (2026-07-07)
BEFORE building UI v2 + letting Atria execute & approve flows for the user. Source of truth for
findings: `plans/reports/review-260707-1828-CONSOLIDATED-autonomy-readiness.md` (+ 5 detail reports).

Each phase file below is SELF-CONTAINED: root cause + exact files/lines + fix approach + steps +
acceptance + verify. Implement in order (later phases depend on earlier seams). Do NOT re-derive from
the reports mid-implementation — the phase file is the spec.

## Decision gate (answer BEFORE Phase 01 — blocks scope)
1. **Atria autonomous loop entry:** does it call `POST /runs/:id/execute` (gated) or `runWorkflow`/scheduler directly (ungated)? → decides whether C2/H4 are default-path or theoretical.
2. **Publish ownership for scheduled posts:** in-flow executor gate OR the scheduler cron? They currently RACE. Pick one owner.
3. **Scheduler cron in the autonomous deploy:** ON or OFF? (`ENABLE_SCHEDULER_CRON`)
4. **Autonomy approval policy:** what may Atria auto-approve (concept? publisher? video cost gate?) and under what guardrails (connected + media-ready + budget-under-X)?
Record answers at top of Phase 01 before coding.

## Phases (priority order)
- **phase-01-machine-approval-seam.md** — [C4] autonomous-approval architecture + override flags. FOUNDATION.
- **phase-02-publisher-boundary.md** — [C1,H1,H4] re-read post at publisher boundary, propagate real publish failure, re-resolve connections.
- **phase-03-scheduler-safe-path.md** — [C2] route scheduler through §11 runtime, respect parked gates, honor the ownership decision.
- **phase-04-self-healing-reapers.md** — [C3, orphans, partial] timeout reapers + failure propagation, no silent success.
- **phase-05-republish-and-dag-correctness.md** — [H2,H3, concept-reset, cloneTemplateRun, publish-only] double-publish + DAG edge + template drift.
- **phase-06-connection-credential-hardening.md** — [H5,M4,M5] reconcile resolver vs state, token freshness, destination id, token cron.
- **phase-07-consistency-and-regressions.md** — [H6,M1,M2,M3,M6,LOW] my batch-3 regressions + consistency cleanups (fastest; can go first if warming up).

## Cross-cutting principles
- **No silent `ok:true`** — a publish/media step that didn't really happen must surface as node/run `failed`, never `completed`.
- **Machine ≠ human** — every gate needs an explicit "who approves" (human | atria-policy) instead of assuming a UI click returns.
- **Re-read at the boundary** — never trust a run-start snapshot (`attachedPost`) at a decision point minutes/hours later.
- **One publish chokepoint** — all real external writes go through the connector runtime (kill-switch + audit + idempotency), including the scheduler.

## Sequencing / dependencies
01 (seam) → 02 (publisher uses the seam) → 03 (scheduler uses 02's boundary logic) → 04 (reapers backstop all). 05/06/07 are largely independent; 07 can be done anytime.
