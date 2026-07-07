# Phase 01 — Machine-Approval Seam  [C4]

**Priority:** CRITICAL / foundation (Phases 02–03 plug into this). **Status:** DONE 2026-07-08 (tsc + approval-policy.verify 15/15 + verify-executor green; migration applied). NOT committed.
**Implemented:** schema `approvalMode`/`scheduleConfirmed` (+migration 20260707215500); registry `gate` metadata (selection/cost/publish) replacing hardcoded SELECTION_GATE + hasVideoNode; `approval-policy.ts` (fail-closed guardrail fn) + verify; executor atria seam (human path byte-identical, atria auto-clears gates when guardrails hold, else park+notify+audit `atria_gate`); `POST /runs/:id/grant-autonomy` backend-enforced 2-step HMAC double-confirm (`autonomy-grant-token.ts`) + `grantAutonomy` repo fn; clarification `autonomous` bypass; env `ATRIA_AUTONOMY_COST_CEILING_USD` (default $2).
**⚠ Phase-01/02 boundary proven by verify:** on a FRESH goal the publish guardrail fail-CLOSES + HOLDS (buildGuardrailCtx reads the run-start `attachedPost` snapshot = null mid-run = C1). Phase 02's publisher-boundary re-read unlocks single-pass fresh-goal auto-publish. Attached-post / resume runs already auto-publish under the grant with 0 human calls.
**Findings:** A#4, D#3, D#4. Report: `review-260707-1518-autonomous-execution-core.md`, `review-260707-1828-workflow-registry.md`.

## Decisions (RESOLVED 2026-07-07 — user decision gate)
**Model = per-flow pre-authorization GRANT, not a standing policy.** The user double-confirms one
specific task → that run gets an autonomy grant → the flow executes end-to-end **with no mid-flow
approval gate** ("chấp nhận = flow đó được execute không cần approve ở giữa nữa"). Always audit + notify
on completion. Trust is opt-in per task; users grant only what they understand Atria can do.

1. **Atria loop entry:** **GATED `/execute`.** Grant only bypasses the *action-approval gates*; the run
   still flows through the §11 connector runtime (kill-switch + audit + idempotency + rate-limit).
2. **Publish owner for scheduled posts:** **IN-FLOW EXECUTOR.** Scheduler only *releases* a due run at
   `scheduledAt`; the publisher node does the single real external write via `runtimePublishFn`. Scheduler
   never calls `publishTo` directly (Phase 03 removes that shadow path).
3. **Scheduler cron in autonomous deploy:** **ON** (scheduled tasks are part of the model), but only after
   Phase 03 hardening (parked-gate posts treated as not-due, routed through the runtime).
4. **Approval "policy" = GRANT + guardrail check, NOT per-gate checkboxes.** A granted run auto-clears ALL
   its action gates (concept, video-cost, publisher, clarification) because the human approved the whole
   flow up front. The policy fn's ONLY job at each gate = verify guardrails; it never independently decides
   to publish.
   - **Guardrails (fail-closed):** connected + token live-verified + media present + est-cost < budget +
     content-checks pass. On ANY guardrail fail mid-flow → **park node `needs_attention` + audit + notify
     user + wait for human** (do NOT publish, do NOT fail the run).
5. **Double-confirm is BACKEND-ENFORCED.** `approvalMode='atria'` is set ONLY via a grant endpoint
   (`POST /runs/:id/grant-autonomy { confirmationToken, scope }`) → sets mode + writes audit row. Scheduled
   runs additionally require `scheduleConfirmed=true` before the scheduler tick may fire them. UI does the
   2× click; backend refuses the grant without the confirmation evidence.

## Root cause
Every gate resumes ONLY via a UI call carrying `opts.approveNodeId` (workflow-executor.ts): concept selection gate (~188-197 resume, ~295-303 park), publisher gate (~244-272), and the video cost gate (`video.requiresApproval=true`, hard). There is NO server-side path for a machine to approve. Additionally:
- `hasVideoNode` (workflow-executor.ts:113) unconditionally forces `autoPublish=false`, and `video.requiresApproval` is a hard cost gate — neither waivable → Atria cannot autonomously publish video.
- `SELECTION_GATE` is a hardcoded `Set` (agent-runners/executor), not registry-driven; `concept_writer.requiresApproval=false` is served to the UI/roster while the run actually parks `needs_approval` by default (display≠behavior).
- Clarification gate (clarification-engine.ts via master-agent.ts:23) emits REQUIRED questions with no machine bypass → under-specified goals dead-end at `awaiting_clarification`.

## Architecture — the seam
Introduce a first-class **approval authority** on a run: `human` (default; current UI behavior unchanged) or `atria` (policy-driven).

1. **Run field / context:** add `approvalMode: 'human' | 'atria'` to the run execution context (persist on `WorkflowRun`, default `human`; migration). Threaded into the executor `opts`.
2. **Policy function:** `atriaApprovalPolicy(gate: GateKind, ctx): 'approve' | 'hold' | 'reject'` — pure, testable, given the post+run+goal+connection state+cost estimate. Guardrails per the decision above. `hold` = escalate to human (park as today). `reject` = route to rework/fail.
3. **Gate integration (workflow-executor.ts):** at EACH gate, when `approvalMode==='atria'` and `opts.approveNodeId` is absent, consult the policy instead of parking:
   - concept gate → approve auto-selects the chosen version (reuse existing `conceptGate:false` auto-select path); hold parks.
   - publisher gate → approve proceeds to publish (through Phase 02 boundary re-read + Phase 03 runtime); hold parks.
   - video cost gate → approve waives when policy allows (replace the hard `hasVideoNode` block with a policy-gated waiver).
4. **Registry-driven gates:** replace the hardcoded `SELECTION_GATE` set + `hasVideoNode` special-casing with registry metadata (`agent.gate: 'selection' | 'cost' | 'publish' | null`) so a machine reads gate kind from one source. Fix `concept_writer.requiresApproval` display to match actual parking behavior.
5. **Clarification bypass:** add an autonomy path in the analyzer — when `approvalMode==='atria'`, proceed on inferred slots (default platforms per policy) instead of emitting required questions; log the inferred slots for audit.
6. **Audit:** every atria approval decision → audit log row (gate, decision, guardrail values). Autonomous approvals must be forensically traceable.

## Related code files
Modify: `src/orchestration/executor/workflow-executor.ts` (gate checks), `src/orchestration/executor/agent-runners.ts` (SELECTION_GATE, runner gate reads), `src/orchestration/registry/agent-*.ts` (add `gate` metadata; fix concept_writer display), `src/orchestration/master/clarification-engine.ts` + `master-agent.ts` (autonomy bypass), `prisma/schema.prisma` (+`approvalMode`), run repo, orchestration-router (accept/propagate mode + expose policy trigger).
Create: `src/orchestration/executor/approval-policy.ts` (the policy fn), `src/orchestration/executor/approval-policy.verify.ts`.

## Implementation steps
1. Migration: `WorkflowRun.approvalMode` default `'human'` + `scheduleConfirmed Boolean default false` (scheduled-run gate). Regenerate client (⚠ `prisma generate` after `migrate dev` — see batch-2 note).
2. Add `gate` metadata to registry; derive `SELECTION_GATE`/video-gate from it; delete hardcoded sets. Keep behavior identical for `human` mode.
3. Write `approval-policy.ts`: `atriaApprovalPolicy(gate, ctx): 'approve' | 'hold'` — in grant model, returns `approve` when guardrails pass (connected + token-live + media + est-cost<budget + content-checks), else `hold` (park needs_attention + notify). `reject` not used. Pure fn, unit-verifiable.
4. Grant endpoint: `POST /runs/:id/grant-autonomy { confirmationToken, scope }` → verify confirmation evidence, set `approvalMode='atria'`, write audit row. Backend refuses grant without token (double-confirm enforced server-side, not just UI).
5. Wire policy into the 3 gates in workflow-executor.ts, guarded by `approvalMode==='atria'`. On `hold`, park node `needs_attention` + audit + notify (never publish, never fail run). `human` mode path UNCHANGED (regression-safe).
6. Clarification autonomy bypass (proceed on inferred slots when granted; log for audit).
7. Audit rows for every atria decision (grant, each gate clear, each guardrail hold).
8. Scheduled-run gate: scheduler tick must skip runs where `scheduleConfirmed=false` (Phase 03 consumes this; add the field + repo read here).
9. Verify: extend `verify-executor.ts` + new `approval-policy.verify.ts` — granted run does full goal→publish with 0 human calls; guardrail-fail parks+notifies; human mode still parks exactly as before.

## Success criteria
- With `approvalMode='atria'` + policy allowing, a fresh goal runs concept→media→publish with ZERO `approve-node` calls (depends on Phase 02 for the actual publish).
- `human` mode behaves byte-identically to today (all existing verifies green).
- Video can be autonomously published when policy permits; still gated in human mode.
- Every atria approval has an audit row.

## Risks / security
- **Highest-risk change** — auto-approving publish. Mitigate: policy defaults to `hold` (human) for anything not explicitly allowed; guardrails hard-fail closed (unconnected/over-budget/media-missing → hold, never approve).
- Keep the human path untouched to avoid regressing the current demo flow.

## Next steps → Phase 02 (publisher boundary is where the publish actually fires after approval).
