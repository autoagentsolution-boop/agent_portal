# Phase 03 — C2: general `WorkflowProposal` (adapter-first)

**Priority:** P1 · **Status:** planned · **Depends on:** Phase 01/02

## Context links
- `MKTAgent/src/orchestration/atria/atria-brain.ts` (`AtriaTurn.proposal = MasterAgentOutcome`)
- `MKTAgent/src/orchestration/master/master-agent.ts` (`MasterAgentOutcome`, `planFromGoal`)
- `MKTAgent/src/api/orchestration-router.ts` + `orchestration-chat.ts` (`recordTurn`, DTO, flow-card)
- Frontend flow-card / plan-card consumer (reuses `planned` run DTO)

## Overview
The brain's only structured verdict today is a marketing `MasterAgentOutcome` (`GoalSpec`+`WorkflowPlan`). Email/research are smuggled in as flags — the boxing one layer deeper. Introduce a general `WorkflowProposal { goalSummary, nodes[], gates[] }` that the brain returns, independent of the marketing GoalSpec. The marketing planner becomes ONE producer of a proposal.

## Key insight (YAGNI — adapter first)
Widest blast radius in the codebase: run/DTO/frontend/`recordTurn`/conversation-author all assume `MasterAgentOutcome`. Do NOT rip it out. Wrap it: `toWorkflowProposal(outcome): WorkflowProposal`. Everything downstream migrates to consume the general shape while the marketing producer is unchanged. Only once a 2nd (non-marketing) producer exists does `WorkflowProposal` earn "permanent contract" status.

## Consumers to migrate behind the adapter (FEATURES.md cross-check)
- Brain: `atria-brain.AtriaTurn.proposal`; the `execute_workflow` (run-signal) and `set_schedule` (NL time → `goal.schedule.confirmed`, feeds the scheduler splice) tools must keep working — a gap turn must NOT let `execute_workflow` fire.
- Router (`orchestration-router.ts`): `POST /runs`, `/runs/:id/clarify`, `/execute`, `/materialize-calendar`, `/approve-node/:nodeId`, `/apply-tier` — all read/persist the outcome/goal.
- Persistence: `orchestration-chat.ts` (`recordTurn`, `persistOutcome`, `applyOutcomeToRun`), `orchestration-mappers.ts` (DTO), `conversation-author.ts` (reply text).
- Frontend: `PlanCard`/flow-card render off the run DTO — must stay pixel-identical (adapter is lossless for its fields).

## Architecture
1. Define `WorkflowProposal` (new schema): `{ goalSummary: string, nodes: {id, agentId, produces, requires, gate, dependsOn}[], gates: GateKind[], source: 'marketing' | 'task' }`.
2. `toWorkflowProposal(MasterAgentOutcome)` adapter — pure, lossless for the fields the DTO/flow-card need.
3. Migrate DTO/flow-card/`recordTurn` to read `WorkflowProposal` (via the adapter) — no visible change; snapshot/e2e prove parity.
4. Brain's `propose_workflow` can now (Phase 04) return a `WorkflowProposal` from a non-marketing `TaskSpec` path without going through `GoalSpec`.

## Related code files
- **Add:** `src/orchestration/schemas/workflow-proposal.ts`; `src/orchestration/master/outcome-to-proposal.ts` (adapter).
- **Modify:** `atria-brain.ts` (`AtriaTurn.proposal` type → `WorkflowProposal`), router DTO, `orchestration-chat.ts` turn persistence, frontend flow-card consumer.

## Implementation steps
1. Schema + adapter; unit-assert adapter round-trips a representative `MasterAgentOutcome`.
2. Point `AtriaTurn.proposal` at `WorkflowProposal`; adapt at the marketing producer boundary.
3. Migrate DTO + flow-card + persistence to the general shape.
4. tsc + golden + existing e2e (marketing proposal renders identically).

## Todo
- [ ] `workflow-proposal.ts` schema
- [ ] `outcome-to-proposal.ts` adapter (+ round-trip assert)
- [ ] Retarget `AtriaTurn.proposal`
- [ ] Migrate DTO / flow-card / persistence
- [ ] tsc + golden + e2e parity

## Success criteria
- A marketing proposal renders a byte-identical flow card and persists identically (via the adapter).
- Nothing downstream references `MasterAgentOutcome` directly except the adapter.

## Risk
| Risk | Mitigation |
|------|-----------|
| Wide breakage (DTO/FE/persistence) | Adapter-first; migrate consumers behind unchanged output; e2e parity gate |
| Lossy adapter | Round-trip unit test on representative outcomes |

## Next
Phase 04 adds the first non-marketing producer (`TaskSpec` → `WorkflowProposal`), the moment that justifies the contract.
