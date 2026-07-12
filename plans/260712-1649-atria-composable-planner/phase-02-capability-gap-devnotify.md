# Phase 02 — Capability-gap detection → extend RoadmapDemand (keystone)

**Priority:** P0 (the differentiator) · **Status:** planned · **Depends on:** Phase 01

## Context links
- Phase 01 `selectByTargets` (emits the gap signal)
- **Existing mechanism to REUSE:** `registry/roadmap-agents.ts` (`ROADMAP_AGENTS[]` — curated not-built roster), `registry/vision-agents.ts` (display-only surfaces), `db/repos/roadmap-demand-repo.ts` (`logRoadmapDemand`/`wasPitched`), `mkt_roadmap_demand` table, `api/atria-router.ts` (`GET /atria/roadmap`, `/atria/suggestions`, `POST /atria/roadmap-demand`)
- `atria/atria-brain.ts`, `atria-tools.ts` (`propose_workflow`), `master/master-agent.ts` (`planFromGoal`)

## Overview
When a requested output artifact has **no producer** in the registry, do NOT dead-end (`no_agents_selected`) or fake-fit into marketing. Instead: (a) Atria replies honestly — "I can't do X yet, I've flagged it to the team," and (b) log the gap as **real per-tenant demand** so a dev sees what to build, with a drop-in spec.

## Key decision (FEATURES.md cross-check) — do NOT build a new table
The codebase already has the capability-gap substrate: `RoadmapDemand` is an owner-scoped append-only log of "not-yet-built agent" pitches/accepts, `roadmap-agents.ts` is the curated roster Atria pitches, `vision-agents.ts` is the display roster. A new `node_requests` table would **duplicate RoadmapDemand** (DRY violation). **Extend RoadmapDemand instead.**

Three "not-a-runnable-node" concepts, reconciled:
| Concept | What it is | Role in gap flow |
|---|---|---|
| `vision-agents.ts` | display-only surfaces (memory/analytics/…) | unchanged; not a gap |
| `roadmap-agents.ts` | curated *known-desired* not-built agents + trigger signal | Atria proactively pitches these (existing) |
| **capability-gap (new)** | a capability the user actively asked for that no node produces | logs demand with `action:'requested'` + auto-spec |

## Architecture
1. **Gap signal (from Phase 01):** `selectByTargets` returns `{ ok:true, ids }` | `{ ok:false, gap:{ unresolved: ArtifactType[] } }`; `planWorkflow` surfaces a `capability_gap` `PlanResult` variant; `planFromGoal` propagates it.
2. **Extend `RoadmapDemand`** (Prisma) minimally:
   - allow `action` value `'requested'` (alongside `pitched`/`accepted`) — a user-driven gap is the strongest demand signal.
   - add optional `spec Json?` column: `{ produces, requires[], suggestedGate, exampleTask }` — the auto-generated drop-in spec (shaped like a registry `AgentDefinition`). Nullable → existing pitched/accepted rows unaffected (no back-fill).
3. **Repo (`roadmap-demand-repo.ts`) additions:** `recordCapabilityGap(ownerId, capabilityId, signal, spec)` → dedup via new `wasRequested(ownerId, capabilityId)` (mirror `wasPitched`); log once, else skip (append-only, no spam). `listDemand(ownerId)` for the read surface.
4. **Brain integration:** `propose_workflow` (via `planFromGoal`) that hits `capability_gap` returns a brain turn `{kind:'reply', text}` — honest, language-mirrored — AND fires `recordCapabilityGap` (best-effort, `.catch` logged; never breaks the turn). No flow card, no `planned` run.
5. **Read surface — reuse `/atria`:** extend `GET /atria/roadmap` (or add `GET /atria/roadmap-demand`) to include `action:'requested'` rows + their `spec`, newest/most-requested first. **No new `/orchestration/node-requests` endpoint, no email.**

## Where the gap is decided (v1 vs v2)
- **v1 (this phase):** the marketing analyzer still runs inside `propose_workflow`; a non-marketing ask that yields no satisfiable target → gap. Wire honest reply + `recordCapabilityGap` from the brain using the raw ask.
- **v2 (Phase 03/04):** once the brain emits `WorkflowProposal`/`TaskSpec` with explicit requested output types, the gap is decided cleanly in `selectByTargets`. This phase lays the repo/spec/reply seam; 03/04 sharpen the trigger.

## Related code files
- **Migration:** add `spec Json?` to `mkt_roadmap_demand`; widen `action` (string/enum) to include `'requested'`.
- **Modify:** `roadmap-demand-repo.ts` (`recordCapabilityGap`, `wasRequested`, `listDemand`); `workflow-planner.ts` (`capability_gap` variant); `master-agent.ts` (propagate gap); `atria-brain.ts`/`atria-tools.ts` (honest reply + fire on gap); `atria-router.ts` (surface requested rows).

## Implementation steps
1. `capability_gap` PlanResult variant + propagation (planner → planFromGoal).
2. Migration (nullable `spec`, widen `action`) — verify existing rows untouched.
3. Repo: `recordCapabilityGap` (dedup by `wasRequested`), `listDemand`.
4. Brain: on gap → honest reply (mirror language) + `recordCapabilityGap` (`.catch`-guarded).
5. Surface via `/atria`.
6. tsc clean; golden-master still diff-clean (no marketing path touched).

## Todo
- [ ] `capability_gap` PlanResult variant + propagation
- [ ] Migration: `mkt_roadmap_demand.spec Json?` + `action` incl. `'requested'`
- [ ] `recordCapabilityGap` + `wasRequested` + `listDemand`
- [ ] Brain honest-reply + fire-on-gap (`.catch`)
- [ ] Surface requested rows via `/atria/roadmap[-demand]`
- [ ] tsc + golden clean
- [ ] e2e: unsupported ask → honest reply + one `requested` demand row (dedup on repeat)

## Success criteria
- Unsupported ask (e.g. "translate this PDF to French") → Atria replies honestly (no marketing fabrication, no crash) AND one `mkt_roadmap_demand` row `action:'requested'` with a coherent `spec`.
- Repeat ask → no duplicate (dedup by `wasRequested`).
- Existing pitched/accepted rows + `/atria/suggestions` unaffected; marketing flows + golden unchanged.

## Risk
| Risk | Mitigation |
|------|-----------|
| Brain hallucinates wrong `produces`/`requires` | Spec advisory; DEV reviews before building; store raw `exampleTask` |
| Gap mis-fires on supported-but-mis-analyzed ask | v1 trigger conservative; 03/04 makes it precise |
| Migration touches live roadmap rows | `spec` nullable, `action` widened not renamed — no back-fill; verify counts pre/post |
| PII in `exampleTask` | Owner-tenant rows, redact obvious PII, existing `/atria` auth (requireAuth) |

## Security
- Reuses `/atria` `requireAuth` (tenant-scoped). `exampleTask` may hold PII → redact obvious emails/addresses; no cross-tenant read.

## Next
Phase 03 lets the brain emit requested output types directly, moving the gap decision into `selectByTargets`.
