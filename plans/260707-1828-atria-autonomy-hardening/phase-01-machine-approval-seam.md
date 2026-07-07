# Phase 01 — Machine-Approval Seam  [C4]

**Priority:** CRITICAL / foundation (Phases 02–03 plug into this). **Status:** planned.
**Findings:** A#4, D#3, D#4. Report: `review-260707-1518-autonomous-execution-core.md`, `review-260707-1828-workflow-registry.md`.

## Decisions to record here first (from plan.md decision gate)
- Atria loop entry (gated `/execute` vs ungated): ______
- Atria approval policy — may auto-approve: [ ] concept [ ] publisher [ ] video-cost-gate ; guardrails: connected + media-ready + est-cost < ___ + content-checks pass.

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
1. Migration: `WorkflowRun.approvalMode` default `'human'`. Regenerate client (⚠ `prisma generate` after `migrate dev` — see batch-2 note).
2. Add `gate` metadata to registry; derive `SELECTION_GATE`/video-gate from it; delete hardcoded sets. Keep behavior identical for `human` mode.
3. Write `approval-policy.ts` with guardrails from the decision. Pure fn, unit-verifiable.
4. Wire policy into the 3 gates in workflow-executor.ts, guarded by `approvalMode==='atria'`. `human` mode path UNCHANGED (regression-safe).
5. Clarification autonomy bypass.
6. Audit rows for atria decisions.
7. Verify: extend `verify-executor.ts` + new `approval-policy.verify.ts` — atria mode runs a full goal→publish with 0 human calls; human mode still parks exactly as before.

## Success criteria
- With `approvalMode='atria'` + policy allowing, a fresh goal runs concept→media→publish with ZERO `approve-node` calls (depends on Phase 02 for the actual publish).
- `human` mode behaves byte-identically to today (all existing verifies green).
- Video can be autonomously published when policy permits; still gated in human mode.
- Every atria approval has an audit row.

## Risks / security
- **Highest-risk change** — auto-approving publish. Mitigate: policy defaults to `hold` (human) for anything not explicitly allowed; guardrails hard-fail closed (unconnected/over-budget/media-missing → hold, never approve).
- Keep the human path untouched to avoid regressing the current demo flow.

## Next steps → Phase 02 (publisher boundary is where the publish actually fires after approval).
