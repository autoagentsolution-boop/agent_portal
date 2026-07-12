# Phase 05 — Node-authoring recipe + full verify

**Priority:** P2 · **Status:** planned · **Depends on:** Phase 01-04

## Context links
- `MKTAgent/src/orchestration/registry/agent-registry.ts` (`AgentDefinition`)
- `MKTAgent/src/orchestration/executor/agent-runners.ts` (runner dispatch)
- `MKTAgent/src/orchestration/verify-planner-golden.ts` + prior verify scripts (`verify-master`, `verify-email-node`, `verify-scheduler-node`)
- `docs/` (system-architecture, code-standards)

## Overview
Close the loop: document the exact recipe that makes "add a capability = drop-in a node" literally true (so a DEV acting on a RoadmapDemand `requested` row has an unambiguous path), and run the full verification matrix proving no marketing regression + the new non-marketing capability works alone and composed.

## Node-authoring recipe (the deliverable)
A new capability node requires exactly TWO edits + zero planner/selector changes:
1. **Registry entry** in `AGENTS[]`: `id, produces, requires, optional, gate, requiresApproval, requiresConnection, cost` (+ persona fields). `produces`/`requires` are what `selectByTargets` + `deriveDeps` consume — this is the whole wiring.
2. **Runner** in `agent-runners.ts` keyed by `id`: consumes upstream artifacts, produces the declared `produces` artifact.
Registering both makes the node selectable, composable, and gap-resolving automatically. Document this in `docs/` with the email node as the worked example, and note the RoadmapDemand `spec` fields map 1:1 to the registry entry.

**One caveat if the new node introduces a NEW gate kind:** `executor/approval-policy.ts` `atriaApprovalPolicy(gate, ctx)` must gain a branch for it. It is **fail-closed** (unknown gate → hold+park+notify), so autonomy stays safe by default, but a node needing auto-approval under a granted run requires an explicit policy branch. Also: a new node shows on the Command Center canvas via `GET /orchestration/agents` (`registry/vision-agents.ts` grouping) — no code change, just appears. Document both in the recipe.

## Implementation steps
1. Write `docs/agent-node-authoring.md` (recipe + worked example + the registry↔NodeRequest field mapping).
2. Reconcile/retire stale verify scripts (P1a follow-up): delete dead `src/orchestration/master/intent-router.ts` (`classifyIntent`, no prod refs after P1a P2); reconcile old `verify-master`/intent verify scripts against the reasoning-brain path.
3. Full verify matrix:
   - `verify-planner-golden` (marketing byte-identical)
   - `verify-master` (live Gemini brain routing)
   - `verify-email-node` / `verify-email-agent` / `verify-scheduler-node` (email+schedule group, 0 real sends)
   - New: `verify-capability-gap` (unsupported ask → honest reply + `mkt_roadmap_demand` `requested` row, dedup)
4. Update `docs/development-roadmap.md` + `docs/project-changelog.md` (Track A milestone).

## Todo
- [ ] `docs/agent-node-authoring.md` (recipe + email example + NodeRequest mapping)
- [ ] Delete dead `intent-router.ts`; reconcile stale verify scripts
- [ ] Full verify matrix green (incl. new `verify-capability-gap`)
- [ ] Roadmap + changelog updated

## Success criteria
- A dev can add a new capability node from a RoadmapDemand `requested` row using ONLY the doc, touching only registry + runner.
- Full matrix green: marketing unchanged; scheduled-email group works alone + composed; unsupported ask → gap + backlog.
- No dead code (`intent-router.ts` gone), verify scripts reconciled.

## Risk
| Risk | Mitigation |
|------|-----------|
| Doc drifts from code | Worked example uses the live email node; reference file:line |
| Deleting intent-router breaks a hidden ref | grep for refs first; golden + verify-master catch routing regressions |

## Milestone (Track A)
"Add one non-marketing capability in a day, without touching the core" — provable via the recipe + a RoadmapDemand `requested` row walked end-to-end.

## Next (Track B, deferred)
Node-agent autonomy (L2), dynamic sub-agent spawn (L3), `LlmClient` multi-provider. See `260711-1459-atria-ab-roadmap` §3.
