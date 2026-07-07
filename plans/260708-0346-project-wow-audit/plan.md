# Atria WOW Audit — Fix Plan (execute 2026-07-09)

Source: audit-summary.md (this dir) + `plans/reports/qa-260708-0346-*.md`.
All findings re-verified against live code before planning. **Reframed severity below.**

## Reframe after code verification
The raw audit called 4 things "P0". Verification splits them:
- **2 are clear bugs** with unambiguous fixes → phase-01, phase-02. Do these.
- **2 are deliberate design points** the code intentionally chose → phase-03, phase-04.
  They are DECISIONS, not defects. Don't "fix" until the product call is made.

## DECISION GATE (answer before touching phase-03/04)
1. **Campaign scope** (phase-03): Bare "build me a branding campaign" currently → rich
   SINGLE post (by design, `deterministic-analyzer.ts:86-88`). Only "plan a month" / "3
   posts/week" → multi-post calendar. **Do you want bare campaign/branding to auto-escalate
   to the multi-post calendar for the demo?** (Y → widen; N → leave, maybe add a nudge.)
2. **Autonomy kickoff** (phase-04): Granting autonomy flips `approvalMode='atria'` but does
   NOT execute the granted DAG (posts sit at `brief`). **Intentional (grant = permission,
   user still triggers) or unfinished Phase-05 wire (grant should auto-run)?**
3. **Auto-publish default** (phase-05 P1): cleanly-postable posts skip the gate by default.
   Keep ON for demo, or gate?

## Phases
- [ ] **phase-01** — Link-status persistence (P0 BUG, user-observed) · [phase-01-link-status-persistence.md](phase-01-link-status-persistence.md)
- [ ] **phase-02** — Impact↔Usage credit reconcile (P0 BUG) · [phase-02-impact-credits-reconcile.md](phase-02-impact-credits-reconcile.md)
- [ ] **phase-03** — Campaign-scope exposure (DECISION + conditional widen) · [phase-03-campaign-scope-decision.md](phase-03-campaign-scope-decision.md)
- [ ] **phase-04** — Autonomy kickoff (DECISION + conditional wire) · [phase-04-autonomy-kickoff-decision.md](phase-04-autonomy-kickoff-decision.md)
- [ ] **phase-05** — P1/P2 polish batch · [phase-05-p1-polish.md](phase-05-p1-polish.md)

## Suggested order
phase-01 (isolated, clear) → phase-02 (small, clear) → [decisions] → phase-03/04 as decided → phase-05.

## What's already solid (do NOT re-touch)
Real LLM+rule hybrid, live multi-post strategist, real publish gate, fail-closed autonomy
seam (HMAC), accurate token accounting incl. thinking tokens, real runners for all 9 agents,
Command Center shows real data (= Atria's intended final form), reapers real, no double-publish,
stale-attachedPost auto-publish already fixed. Evidence in audit-summary.md.
