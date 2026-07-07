# State-Machine QA — Post & WorkflowRun lifecycle (autonomy readiness)

Read-only review. Scope: every way a Post or WorkflowRun can get stuck / orphaned / inconsistent once Atria executes AND approves flows without a human in the loop.

Repo: `MKTAgent/src`. Enums verified in `MKTAgent/prisma/schema.prisma:25` (PostStatus) — actual set is **brief | review | rework | ready | posting | posted | partial | error** (prompt omitted `partial`). WorkflowRun.status is a free-form string (schema default `"planning"`, `schema.prisma:455`); observed values: planned | running | needs_approval | completed | failed | aborted | template | awaiting_clarification | needs_connection.

Live DB sample (read-only): posts {posted 5, brief 3, partial 2, review 1, error 1}; runs {planned 16, completed 10, awaiting_clarification 7, needs_approval 4, template 2, needs_connection 1, failed 1}; nodes {pending 88, completed 69, skipped 12, awaiting_approval 4, failed 1}. No live `posting`/`running` orphans right now — but nothing prevents them (see F1/F2).

---

## 1. Post.status transition table

| from | to | trigger | file:line |
|------|----|---------|-----------|
| (none) | brief | createPostForOwner / buildPostUnderCampaign | post-repo.ts:193; posts-router.ts:77 |
| brief\|rework | review | copy-gen success (cron + manual /generate) | copygen/service.ts:88,208; posts-router.ts:258 |
| brief\|rework | error | copy-gen HARD fail (validation) | copygen/service.ts:56 |
| brief\|rework | (stays) | copy-gen TRANSIENT fail → retry next tick | copygen/service.ts:76-79 |
| review | ready | approveReview (/approve, concept gate, scheduled-publisher approve) | post-repo.ts:143; posts-router.ts:406; executor:199,270 |
| review | rework | rejectReview (/reject) | post-repo.ts:155; posts-router.ts:426 |
| review\|ready | review | editPostCopy (/edit-copy, /select-variant) + refineForPost (/refine) | post-repo.ts:230; copygen/service.ts:164 |
| ready | posting | claimForPublish (cron) / claimForPublishOwned (publish-now, executor publisher) | post-repo.ts:59,71 |
| posting | posted\|partial\|error | aggregate → toWriteBack | scheduler/aggregate.ts:19-49; tick.ts:135 |
| posting | error | failPost (no targets / all skip) + post-claim catch | tick.ts:59-63,178,222 |
| review\|ready\|posted\|partial\|error | brief | concept node re-run resets post → brief | agent-runners.ts:171-172 |
| brief\|review\|rework\|error | (same) | user config edit (EDITABLE guard) | post-repo.ts:171,215 |

Terminal / no forward transition except via concept re-run: **posted, partial**. `partial` has **no retry-the-failed-platforms path** — the only escape is a full concept re-run that wipes it back to `brief`.

## 2. WorkflowRun.status transition table

| from | to | trigger | file:line |
|------|----|---------|-----------|
| (none) | awaiting_clarification\|failed\|planned | createRun | orchestration-router.ts:66,70,73 |
| planned | template | nameRun (save flow, immutable) | workflow-run-repo.ts:250 |
| planned\|awaiting_clarification | planned | apply-tier → replanRun | orchestration-router.ts:380-391 |
| planned\|failed\|needs_connection | running | /execute | orchestration-router.ts:288 |
| planned | needs_connection | /execute connection gate | orchestration-router.ts:274 |
| running | needs_approval | executor gates (concept / publish-completeness / approval / scheduled) | executor:204,230,282,324 |
| running | completed | executor loop end | executor:340 |
| running | failed | node throw / invalid plan / node_not_found | executor:101,166,333 |
| running | planned | rerunOnly single-node done (RESUMABLE park) | executor:177 |
| needs_approval | running | /approve-node | orchestration-router.ts:301 |
| non-terminal | aborted | /abort (kill switch) | orchestration-router.ts:403 |
| aborted | (halts) | executor honors at node boundary | executor:188-191 |

---

## 3. Prioritized findings

### F1 — CRITICAL — stuck `posting`, no reaper — post-repo.ts:59; tick.ts:68,220
A post is claimed `ready→posting` and then `processPost` writes back the terminal status. Recovery from an unexpected error lives ONLY in the same-process try/catch (tick.ts:220-229, tick.ts:177-181). If the Node process is killed / container restarts / OOM between `claimForPublish` and write-back, the row is **permanently `posting`**: `EDITABLE` excludes it (post-repo.ts:171) so no edit, `deletePost` refuses it (post-repo.ts:307), `findPublishDue` only picks `ready` so the cron never revisits it, and there is **no sweeper** that re-ages `posting` rows. Under autonomy no human notices. Scenario: Docker rebuild (the memory notes call stale containers the #1 failure) mid-tick → orphaned post forever.
*Fix direction:* age-out reaper (`posting` + `updatedAt < now-N min` → `error`/`ready`), same for F2.

### F2 — CRITICAL — stuck `running` run, no reaper — executor:143; orchestration-router.ts:288
`/execute` and `/approve-node` flip the run to `running` and launch the executor **detached** (`launchWorkflow`, orchestration-router.ts:242-252, fire-and-forget `void ... .catch`). A crash mid-node leaves the run `running` with a node `running` forever. `/execute` rejects `running` (409 run_in_flight, :262), `deleteRun` refuses `running` (workflow-run-repo.ts:149) → the run can only be freed by `/abort`, which a human must trigger. No heartbeat/timeout reconciler. Autonomy hazard: Atria's own execute crashes → run wedged, and because the detached promise swallows the error (only logs), Atria gets a normal HTTP 200 and believes the flow is progressing.

### F3 — HIGH — scheduler publishes a scheduled post whose flow is parked at an approval gate (media not produced) — workflow-run-repo.ts:139; tick.ts:204
`hasActiveFlowNodes` counts only nodes `in ('running','pending')` — **`awaiting_approval` is deliberately excluded** (comment at :138). But the scheduler's flow-active guard (tick.ts:204) uses exactly this. So a post that is `ready` + `scheduledAt <= now` whose run is parked `needs_approval` at the **pre-video cost gate or publisher gate** is treated as "flow finished" and **published by the cron** even though the video/media step has not run. `resolvePlatformInput` then throws (no media) → `failPost` → post `error` (tick.ts:79-95). Result: a scheduled video post silently errors instead of publishing, and the parked run is orphaned `needs_approval`. Today the human approves before the schedule fires; under autonomy the cron tick vs. Atria-approve ordering is a race. Note post becomes `ready` at the *concept* gate (executor:199) long before media/publisher, so the window is wide.
*Fix direction:* flow-active guard should also treat `awaiting_approval` nodes as "not ready to publish" (or gate on run.status ∈ {needs_approval,running}).

### F4 — HIGH — re-run a node on an already-`posted` post → republish on resume — orchestration-router.ts:313; executor:181
`/rerun-node` resets the target node + all transitive downstream to `pending` (resetNodes, workflow-run-repo.ts:341) and parks the run `planned` (executor:177). For a fully `completed` run whose post is already `posted`, re-running an upstream node (e.g. image) marks the **publisher node `pending` again** (collectDownstream includes it). The post is NOT reset from `posted`. A subsequent `/execute` (Continue) resumes the main loop, reaches the now-`pending` publisher, and — if auto-publish/cleanly-postable — **publishes a second time** (duplicate live post). rerun-node blocks re-running the publisher *directly* (:324) but not reaching it via downstream resume. Autonomy hazard: Atria re-runs a step to "improve" an already-live post and double-posts.
*Fix direction:* refuse rerun when post.status ∈ {posted,partial}, or reset post→review and re-gate the publisher.

### F5 — MEDIUM — publisher node reports `completed` while publish silently failed — agent-runners.ts:275-281; executor:310
`runPublisher` calls `publishPostNow`; if it returns `not_publishable` / `not_found` / `claim_lost` (TickResult with no `status`), line 281 maps that to artifact `status:'awaiting_approval'` but **does not throw**. The executor therefore marks the node `completed` and the run `completed` (executor:310,340). So a run can be `completed` with the post still `ready` (never published) and no error surfaced anywhere. `claim_lost` is benign (cron took it), but `not_publishable` (state drift) means **nothing published and the run looks successful**. Under autonomy Atria reads run=completed and assumes done.
*Fix direction:* throw (→ node failed → run failed) on a non-terminal publish outcome so the failure is visible.

### F6 — MEDIUM — `partial` is a dead-end (no retry of failed platforms) — scheduler/aggregate.ts:21; post-repo.ts:171
`partial` (some platforms ok, some failed) is terminal: not in `EDITABLE`, not re-picked by the cron (`findPublishDue` wants `ready`), no per-platform retry queue. The only escape wipes everything via a concept re-run→`brief` (agent-runners.ts:171) which would **republish the already-succeeded platforms** (F4-style duplicate). 2 live `partial` posts confirm this state is reached. Autonomy has no clean path to complete a partial publish.

### F7 — MEDIUM — orphaned `needs_approval` / `planned` runs never expire — DB: 4 needs_approval, 16 planned
Runs parked at a gate (`needs_approval`, 4 live) or drafted-but-never-executed (`planned`, 16 live; `awaiting_clarification`, 7 live) accumulate with no TTL/cleanup. Each `needs_approval` holds a post at `review`/`ready`. Not a correctness bug today, but under autonomy these are silent backlog: Atria parks a run for approval, never returns, and there is no "stale approval" surfacing. Combined with F3, a parked run can also be raced by the scheduler.

### F8 — LOW — concept re-run resets post `posted→brief` with no confirmation — agent-runners.ts:171-172
`runConceptWriterForExistingPost` unconditionally `setPostStatus(brief)` for any post not already brief/rework — including `posted`/`partial`. Combined with F4/F6 this is the mechanism by which a live post silently re-enters the pipeline. Deliberate ("regenerate this step" semantics) but dangerous under autonomy on already-published rows.

### F9 — INFO — worker transition queries are unscoped by design (no cross-tenant leak) — post-repo.ts:17-84
`findCopyGenDue*`, `findPublishDue*`, `claimForPublish`, worker `updatePost`/`setStatus`, executor `setRunStatus`/`setNodeStatus` are keyed by id only with NO ownerId. Reviewed: this is intentional (documented T2 split, post-repo.ts:4-8) — workers process all tenants and write back to the row's own owner; each row carries its own `ownerId`. **No scoping gap found** in tenant-facing routes: every REST transition (approveReview, rejectReview, updatePostFields, editPostCopy, transitionRun, deleteRun, nameRun, resetNodes) guards on `ownerId`. `getRunStatusById` / `hasActiveFlowNodes` are unscoped but read-only status probes for the trusted executor/scheduler. Clean.

---

## Unresolved questions
- Is there any process supervisor / cron that re-ages `posting` or `running` rows on boot? None found in `src/scheduler/cron.ts` — recommend confirming startup path doesn't reconcile.
- Intended product behavior for `partial`: retry-failed-only vs. accept-as-final? Affects F6 fix.
- Under Atria autonomy, will approve happen in-process (before returning) or via a separate tick? Determines F3 race severity.
