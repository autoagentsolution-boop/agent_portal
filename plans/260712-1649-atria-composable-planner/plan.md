# Atria — Composable Planner & Capability-Gap Handling (Track A / P1b)

**Branch:** `pivot/video-content-farm` · **Created:** 2026-07-12 · **Status:** planned — FINAL (cross-checked vs `FEATURES.md` codebase scan 2026-07-12)

Consolidates and supersedes three prior plans:
- `260711-1021-atria-reasoning-loop` (P1a — DONE/pushed; substrate)
- `260711-1140-p1b-node-decoupling` (P1b — the refactor; core of this plan)
- `260711-1459-atria-ab-roadmap` (strategic Track A/B framing; §Context)

## Problem (the real blocker)
User asks Atria to "write a birthday email for my friend and schedule it to send on <date>." Atria/brain is still boxed into a **marketing frame** and mishandles anything outside it. Two structural faults:
1. **`selectAgents()` is a marketing if-ladder** (`workflow-planner.ts:19-59`). It only reaches non-marketing nodes (`email_writer`/`email_agent`) through the `needsEmail` flag; nothing is artifact-driven, so any task without a marketing flag has **no path**.
2. **No graceful capability gap.** When a task needs a capability no registry node produces, the planner returns `no_agents_selected` (dead end) instead of telling the user honestly + flagging the missing node to DEV.

The registry itself is already good: nodes declare `produces`/`requires`/`gate`, and `deriveDeps` wires edges data-driven. The dumb layer is **selection**.

## Goal
Any capability chain — present or future — runs **standalone OR composed**, selected by **backward-chaining from the requested output artifact**, and a genuinely-missing capability produces an honest user reply + a structured **DEV node-request** (drop-in spec), not a dead end. Kill "everything is boxed to marketing" at the selection layer.

## Non-negotiable safety net
`verify-planner-golden.ts` + `planner-golden-snapshot.json` (15 cases, every current branch). **Must diff-clean after every phase** — any change to a marketing plan must be explained/re-baselined deliberately.

## Phases
| # | Phase | Status | File |
|---|-------|--------|------|
| 1 | C1 — backward-chaining selection (registry-driven; golden-clean **incl. tiers+materializer**) | ✅ DONE (`6047d18`,`0295323`) | [phase-01](phase-01-c1-backward-chaining.md) |
| 2 | Capability-gap → **extend RoadmapDemand** (reuse, don't duplicate) — **keystone** | ✅ DONE (`2861dbe`) | [phase-02](phase-02-capability-gap-devnotify.md) |
| 5 | First non-marketing node (`summarize`) — reachable + composable + runs | ✅ DONE (`caa2d27`) | [phase-05](phase-05-node-authoring-verify.md) |
| 3 | C2 — general `WorkflowProposal` (adapter-first over MasterAgentOutcome) | ⏸ SUPERSEDED/YAGNI | [phase-03](phase-03-c2-workflow-proposal.md) |
| 4 | C3 — `TaskSpec` + GoalSpec persistence/back-compat | ⏸ SUPERSEDED/YAGNI | [phase-04](phase-04-c3-taskspec.md) |

**Status (2026-07-12):** the highest-value slice (P1 + P2) shipped, then P5 authored the first real non-marketing node (`summarize`) end-to-end. P5 used a **lightweight seam** — a general `GoalSpec.taskTargets` + a `propose_task` brain tool — that delivered what C2/C3 (P3/P4) were meant to unlock, at a fraction of the cost. **P3/P4 are therefore superseded/YAGNI**: revisit only on a concrete need (multi-turn task refine, or a 3rd+ producer that justifies the general `WorkflowProposal` contract). Adding another utility = author node + runner + one `TASK_CAPABILITIES` row.

**Rescan 2026-07-12 (codebase trace, `f2c9f98`+):** confirmed P3/P4 NOT needed now. A full trace of the task-goal lifecycle found the seam is well-contained — every marketing-shaped `GoalSpec` reader a task goal can reach is either GUARDED (`buildLeadAwarenessNote` short-circuits on `!needsPublishing`; `captureFromGoal` no-ops on empty slots) or UNREACHABLE (`/clarify` mapper, `goal-to-brief`, `campaign-from-flow`). The ONE real gap was `mergeGoals` dropping `taskTargets`/`sourceText` (+ my new `qualityPref`) → a task reverting to a marketing publish flow on refine, plus the clarification engine asking marketing questions of a task goal. **Both hardened directly** (goal-merge preserves the three fields; clarification-engine early-returns `ready` for task goals) — cheap, additive, zero blast radius, closes the latent bug + protects Phase 06's `qualityPref` across refine. Only the misroute path (LLM picking `propose_workflow` on a task) could trigger it, and it's now closed. **Trigger to revive P3/P4:** a 2nd non-marketing `TASK_CAPABILITIES` entry or genuine multi-turn task refinement — until then the general contract earns nothing.

## Locked decisions (2026-07-12)
- **Capability-gap channel:** **extend the existing `RoadmapDemand`** mechanism (`roadmap-demand-repo.ts` + `/atria` surface) — do NOT add a parallel `node_requests` table (DRY). Reuse `logRoadmapDemand(owner, capabilityId, 'requested', signal)` + a `wasRequested` dedup; add an optional `spec` (produces/requires/suggestedGate/exampleTask) column for auto-generated gap specs. **No email** (pull demand from the existing surface).
- **C2 contract:** adapter-first (wrap `MasterAgentOutcome`→`WorkflowProposal`); do NOT make it the permanent contract until a 2nd non-marketing producer exists (YAGNI).
- **Provider abstraction (`LlmClient`) → Track B, deferred.** Not in this plan.
- **No new capability node built now.** The existing `{email_writer→scheduler→email_agent}` group proves composition; a deliberately-absent capability (e.g. translate/summarize) proves the gap path. Real nodes are authored later via the Phase-5 recipe.

## Verified blast radius (FEATURES.md cross-check, 2026-07-12)
`planWorkflow` / `selectAgents` has **four** entry points, not one — all must stay byte-AND-order-identical:
1. `master-agent.planFromGoal` ← router `POST /orchestration/runs`, `atria-tools.propose_workflow`
2. `plan-tiers.buildPlanTiers` → `planWorkflow` ×3 (`balanced`, `economyGoal`, `fullGoal` — mutate `outputs.needs{Research,Ideation,Strategy}`). ⚠ Tier cards dedup by **ordered** `agentIdList.join(',')` → node ORDER is load-bearing, not just the set.
3. `campaign-materializer` → `planWorkflow` per calendar slot (single-scope goal).
4. ~12 `verify-*.ts` scripts.

`GoalSpec` is a **persisted snapshot** (`wf_run.goal` JSON) read by ~15 modules — see [phase-04](phase-04-c3-taskspec.md). Three "not-a-runnable-node" concepts already coexist and must be reconciled by P2: `roadmap-agents.ts` (curated not-built roster), `vision-agents.ts` (display-only surfaces), and the capability-gap path.

## Prerequisite (already landed)
Commit `0733288` — email intent + recipient name survive refine/confirm turns (goal-merge + analyzer + writer). Fixes the *symptom*; this plan fixes the *frame*. Retest birthday+schedule in a NEW chat once Phase 1 lands.

## Deferred → Track B (context only)
Node-agent autonomy (L2: per-node tool loops), dynamic sub-agent spawn (L3), `LlmClient` multi-provider. See `260711-1459-atria-ab-roadmap` §3.

## Open questions
1. Phase 4: general `TaskSpec` as a sibling of `GoalSpec`, or capability-tagged unified goal? Defer detail until C1/C2 shape settles.
2. Does the brain surface the RoadmapDemand `requested` rows to the *user* ("others asked for translate too") or DEV-only? (v1: DEV-only via the existing `/atria` surface.)
