# Phase 05 — Republish Safety + DAG Correctness  [H2, H3, concept-reset, cloneTemplateRun, publish-only]

**Priority:** HIGH. **Status:** planned. **Depends on:** none (independent).
**Findings:** B#4, D#1, B-F8, D#8, D-F5. Reports: state-machine-qa, workflow-registry.

## Defects
1. **H2/B#4 — rerun-node on a `posted` post double-publishes LIVE.** `/rerun-node` (orchestration-router.ts:313, executor:181) resets downstream nodes (INCL. the publisher) to `pending` and parks the run `planned`, but does NOT reset the Post from `posted`. A subsequent Continue/execute reaches the pending publisher and re-publishes a live post. The direct-publisher-rerun guard exists but does NOT cover reaching the publisher via downstream resume.
2. **B-F8 — concept re-run silently resets `posted → brief`.** Re-running concept on a posted post drops it back to brief, discarding the posted state without warning.
3. **H3/D#1 — carousel publisher has NO DAG edge on storyboard.** publisher lists `video_prompt`/`infographic_brief` as optional inputs but NOT `storyboard` (agent-registry.ts:150); carousel media is attached as a SIDE-EFFECT inside `runStoryboard`, invisible to the DAG. Publisher runs after storyboard only by incidental serial insertion order → once execution parallelizes, publisher can **publish a blank carousel**.
4. **D#8 — cloneTemplateRun copies a frozen plan with NO registry re-validation.** A dropped/renamed agent in the registry breaks every existing template silently.
5. **D-F5 — publish-only / no-content goals dead-end at `plan_error`** with no auto-recovery.

## Fix approach
1. **Guard the publisher against already-published state** — the publisher node (and `claimForPublishOwned`) must refuse when the post is already `posted` (or require an explicit republish intent). On `/rerun-node` that resets downstream, also reset the Post's publish state coherently (e.g. `posted → ready` only with an explicit "republish" flag; default: block re-publish and surface "already posted — use Republish to intentionally re-post").
2. **Coherent state on any downstream reset** — define the rule: resetting the publisher node ⇒ the Post must not remain `posted` in a way that lets a silent re-publish happen. Make concept re-run on a posted post require confirmation / explicit intent, not a silent `→brief`.
3. **Add the carousel DAG edge** — `storyboard` becomes a declared input dependency of `publisher` when the deliverable includes carousel (or always, since storyboard attaches carousel media). Make the media attachment visible to the DAG's input-satisfiability check so publisher can't run before its media node completed. Fixes the blank-carousel-on-parallel hazard now, before parallel execution ships.
4. **Registry re-validation on clone/execute** — when cloning a template or before executing a frozen plan, validate every node's `agentId` still exists in the live registry (+ gate/asset metadata compatible); fail with a clear "template references removed agent X" instead of a runtime crash.
5. **Publish-only goal handling** — either plan a minimal valid DAG (skip content agents, go straight to publisher with existing media) or return an actionable error, not a dead `plan_error`.

## Related code files
Modify: `src/api/orchestration-router.ts` (`/rerun-node` reset logic), `src/orchestration/executor/workflow-executor.ts` (publisher already-posted guard, single-node re-execute), `src/db/repos/post-repo.ts` (`claimForPublishOwned` already-posted guard), `src/orchestration/registry/agent-registry.ts` (publisher inputs incl. storyboard), `src/orchestration/planner/workflow-planner.ts` (edge derivation, publish-only), `src/db/repos/workflow-run-repo.ts` (`cloneTemplateRun` re-validation).

## Implementation steps
1. `claimForPublishOwned` + publisher gate: refuse if post already `posted` unless `republish:true` intent. Add explicit "Republish" action to the API/UI for intentional re-posts.
2. `/rerun-node`: when the reset chain includes the publisher, set the post to a coherent non-posted state OR require republish intent; never leave `posted` + pending publisher.
3. concept re-run on posted → require confirmation flag; no silent `→brief`.
4. Registry: add `storyboard` to publisher's input deps (or a carousel-conditional edge); update the planner edge derivation + input-satisfiability so publisher waits on storyboard for carousel.
5. `cloneTemplateRun`/pre-execute: validate agentIds against the live registry.
6. Planner: handle publish-only/no-content goals.
7. Verify: extend `verify-template-instance.ts`, `verify-rerun-node.ts`, `verify-planner.ts`, `verify-storyboard-video-dep.ts` — assert (a) rerun on posted can't silently republish; (b) publisher waits on storyboard for carousel; (c) cloning a template with a removed agent fails clearly.

## Success criteria
- No path re-publishes a `posted` post without explicit republish intent.
- Publisher never runs before its media node (carousel included), even under parallel execution.
- Cloning/executing a template with a stale agent fails with a clear message, not a crash.

## Risks
- Tightening the publisher's already-posted guard could block legitimate re-runs — provide the explicit Republish action so intentional re-posts still work.

## Next steps → independent.
