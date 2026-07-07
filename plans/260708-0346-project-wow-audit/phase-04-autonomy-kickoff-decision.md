# Phase 04 — Autonomy kickoff (DECISION, then conditional wire)

**Priority:** P0-labeled, but DECISION-gated. **Status:** BLOCKED on decision.

## Current behavior (verified)
Granting campaign autonomy flips `approvalMode='atria'` on the materialized posts' runs
(bulk grant `grantAutonomyForCampaign` in `workflow-run-repo`, see `campaign-grant.ts:3`), and
the autonomy seam is real & fail-closed (HMAC double-confirm `autonomy-grant-token.ts`, policy
`approval-policy.ts:36-55`, park-on-hold). BUT: the granted run stays `status='planned'`, posts
sit at `status='brief'`, and NOTHING executes the granted DAG. The scheduler only publishes
posts already `ready`; no cron picks up granted-but-unstarted runs.

Net: "grant autonomy" gives Atria PERMISSION to act without a human gate, but no component
actually KICKS OFF the work. On-behalf execution is armed but never triggered.

## Decision needed (user)
Is this intentional or an unfinished wire?
- **A. Grant = permission only** (user still hits run/publish; Atria then proceeds gate-free).
  → Not a bug. Document it. Maybe rename the CTA to make it clear ("Auto-approve when I run").
- **B. Grant should auto-run** (the WOW: "approve once, Atria does the rest end-to-end").
  → Wire kickoff. This is likely the intended Phase-05 finish.

## Conditional implementation (if B)
Two seams, pick one:
1. **Inline kickoff** — in the grant handler, after flipping approvalMode, call `launchWorkflow`
   (the executor entry used elsewhere) for each granted run. Simple, immediate; risk: long
   synchronous fan-out on the grant request → prefer fire-and-forget / queue.
2. **Granted-run executor cron (recommended)** — a scheduler tick that claims runs where
   `approvalMode='atria' AND status='planned'`, executes them through the SAME gated executor
   (the autonomy policy machine-approves at the gate), lands posts at `ready`, then the existing
   publish path takes over. Mirrors the reaper/scheduler pattern; atomic `updateMany` claim to
   avoid double-run; gated by a new `ENABLE_AUTONOMY_CRON` flag.
   Reuse: executor (`workflow-executor.ts`), claim pattern (`post-repo.ts` updateMany), policy
   (`approval-policy.ts`).

## Todo (after decision)
- [ ] Decide A / B
- [ ] If B: choose inline vs cron (recommend cron); implement claim+execute; new env flag
- [ ] Verify: grant → (cron tick) → run executes → gate machine-approved → posts publish, NO human
- [ ] Verify a NON-granted run still requires human approval (fail-closed intact)

## Success criteria
- B: granting autonomy on a campaign results in posts actually publishing on-behalf, end-to-end.
- Fail-closed preserved: ungranted runs never auto-publish.

## Risk
- HIGH-sensitivity path (real publishing without a human). Keep the flag OFF by default; test on
  DRY-RUN adapters first (memory: adapters default DRY-RUN). Idempotency + claim guards mandatory.
