# Phase 02 — Publisher Boundary Correctness  [C1, H1, H4]

**Priority:** CRITICAL. **Status:** planned. **Depends on:** Phase 01 (seam).
**Findings:** A#2, A#5, B#5, D#2, E#2, E#3. Reports: autonomous-execution-core, state-machine-qa, connect-credential.

## Root cause (3 defects at the same boundary — the publisher node)
1. **C1/D#2 — stale `attachedPost`.** `attachedPost = await getPostByRunId(runId)` is fetched ONCE at run start (workflow-executor.ts:126). On a FRESH goal the Post is created mid-run by `concept_writer`, so `attachedPost` stays `null` the whole run. The auto-publish waiver (workflow-executor.ts:249-252) guards on `!!attachedPost` → `cleanlyPostable=false` → publisher ALWAYS parks for a human, and media-gating (needed asset types) is disabled. Net: the primary fresh-goal path can never auto-publish.
2. **H1 — silent false-success.** (a) `approveReview(postId, owner, date)` (workflow-executor.ts ~199/270/302) returns null when the post isn't in `review`, but the node is still marked `completed` and the run ends `completed` → nothing published, no error. (b) `runPublisher` (agent-runners.ts:275-281) maps a `not_publishable`/`not_found` result from `publishPostNow` to an artifact status WITHOUT throwing → node/run `completed`, nothing out. (c) X adapter (`social/x.ts`) degrades image→text on media-403 and returns `ok:true`.
3. **H4/E#2 — connection staleness.** The connection gate runs once at `/execute`; the publisher waiver even asserts "by here every target IS connected." For video (publish minutes later) and resume/scheduled (hours later) the token may have expired → the "$0 gate" promise is void.

## Fix approach
Treat the publisher node as a **fresh decision boundary**: re-read state, re-check connections, and FAIL LOUD.

1. **Re-read the post at the publisher gate** — replace uses of the run-start `attachedPost` snapshot INSIDE the publisher gate block with a fresh `getPostByRunId(runId)` (or `getPostForOwner(postId,...)` once `postId` is known). Compute `cleanlyPostable` + needed-asset gating from the fresh row. This makes fresh-goal runs eligible for the auto-publish waiver (and Phase 01 policy).
2. **Propagate real publish failure** — `runPublisher` must THROW (or return a failed RunnerOutput that the executor marks `failed`) when `publishPostNow` returns `not_publishable`/`not_found` or a per-platform error. No mapping a non-publish to `completed`. Update `agent-runners.ts:275-296`.
3. **Fail on partial/degraded adapter success** — X (and any adapter) must NOT return `ok:true` when the deliverable (image/video) was dropped. Either fail the platform or surface a `degraded` outcome the executor treats as non-success for autonomous mode. Update `social/x.ts` (+ audit which platforms silently degrade).
4. **Re-resolve connections at the boundary** — before publishing, re-run the connection resolver for `post.platforms` (not the run-start `goal.platforms`). If a target went stale → hold (human) / fail (atria) per Phase 01 policy; never publish to a dead token. (Also fixes the E-note "gate reads goal.platforms but publish uses post.platforms".)
5. **approveReview must not silently no-op** — check its return; if it returns null AND the post is not already `ready`, do NOT mark the node completed — surface an error / hold. (Preserve the intentional idempotent case where the post is already past review.)

## Related code files
Modify: `src/orchestration/executor/workflow-executor.ts` (publisher gate block re-read + approveReview return check), `src/orchestration/executor/agent-runners.ts` (`runPublisher` failure propagation), `src/social/x.ts` (no ok:true on dropped media), the connection resolver call site. Read: `src/scheduler/tick.ts` `processPost`/`publishPostNow`, `src/db/repos/post-repo.ts` `claimForPublishOwned`.

## Implementation steps
1. In the publisher gate, fetch a FRESH post (`getPostByRunId`) and derive `cleanlyPostable` + `neededAssets` from it. Remove reliance on the top-of-run `attachedPost` for the publish decision (keep it for early media-gating where the post exists).
2. Add a connection re-resolve for `post.platforms` right before the claim/publish; feed result into the Phase 01 policy / human gate.
3. `runPublisher`: on `out.status !== 'posted' && !== 'partial'` (or `reason` set) → throw a descriptive error so the executor marks the node `failed` and the run `failed`.
4. `x.ts`: on media-upload 403, return a failed/`degraded` result (config flag whether to still post text). Log it.
5. approveReview return-value guard.
6. Verify: `verify-executor.ts` add a fresh-goal→publish case (DRY-RUN) proving auto-publish waiver now fires when the post is created mid-run; add a case where publishPostNow returns not_publishable and assert the node ends `failed` (not completed).

## Success criteria
- A fresh-goal run (no pre-attached post) is auto-publish-eligible once its post is cleanly postable.
- A publish that didn't really happen → node/run `failed` with an error message; never `completed`.
- Stale connection at publish time → hold/fail, never a dead-token publish.

## Risks / security
- Throwing in `runPublisher` changes run outcome from `completed`→`failed` for previously-silent cases — desired, but audit any flows/tests asserting completed. Update those tests to the correct expectation.
- Re-resolving connections adds a live check at publish — cheap, and required for correctness.

## Next steps → Phase 03 (scheduler must apply the SAME boundary re-read + runtime routing).
