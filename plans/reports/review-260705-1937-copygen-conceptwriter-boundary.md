# copy-gen vs concept_writer — dedup review (item 4)

**Decision: NOT redundant. Keep separate; boundary documented in code. Minor DRY applied.**

## What each is

| Layer | Location | Role |
|---|---|---|
| `concept_writer` | `orchestration/executor/agent-runners.ts` | DAG-node SEAM. Materializes (new-post) or locates (flow-as-template instance) the Post + Campaign the run operates on, drives copy-gen once, auto-approves review→ready so the publisher node can claim it, returns the `content_concept` artifact. **Owns no copy prompt.** |
| `generateForPost` (copy-gen) | `copygen/service.ts` | REUSABLE COPY ENGINE. The actual LLM copy generation for an existing Post. |

## Why not merge

`generateForPost` has three independent callers:
1. `concept_writer` (both paths) — the DAG node.
2. `POST /posts/:id/generate` — the manual board "Generate" button.
3. the copygen cron.

Merging the engine into the orchestrator would couple copy generation to the DAG and break callers 2 + 3. The layering is correct: orchestration seam on top, reusable engine underneath.

## No prompt divergence

concept_writer builds **no** copy prompt of its own — both paths call `generateForPost` directly. All copy prompt/config logic (`resolveCopyConfig`, brandContext grounding, persona path) lives in copy-gen. There is a single copy-generation code path; no divergence to reconcile.

## The only real duplication (fixed)

The two concept_writer paths (`runConceptWriter` new-post, `runConceptWriterForExistingPost` attached-post) differed only in how they obtain the Post; their tail — run copy-gen → require review → auto-approve → build artifact — was duplicated verbatim. Extracted to `finalizeConcept(ctx, postId)`. Behavior-preserving; typecheck green.

## Unresolved

- None. Boundary is documented at the concept_writer definition; a future reader won't re-ask.
