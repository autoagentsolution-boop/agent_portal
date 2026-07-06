// WorkflowExecutor — runs a planned DAG in dependency order (brief §7). It:
//   • topo-sorts the plan (reusing the validator's sort)
//   • runs each node via the AgentExecutor, threading upstream artifacts forward
//   • HALTS before any requiresApproval node (publisher) → run status needs_approval
//   • on node failure, records the node failed + run failed (mirrors the scheduler's
//     posting→error recovery so a run never hangs mid-flight)
// Resumable: after a human approves the gated node, the API calls run() again; nodes
// already `completed` are skipped and their artifacts re-loaded into the context.
import { validatePlan } from '../master/workflow-validator.ts';
import { getAgent } from '../registry/agent-registry.ts';
import { executeNode } from './agent-executor.ts';
import { listArtifacts } from './artifact-store.ts';
import type { RunnerContext } from './agent-runners.ts';
import type { GoalSpec } from '../schemas/goal-spec.ts';
import type { WorkflowPlan } from '../schemas/workflow-plan.ts';
import type { ArtifactType } from '../schemas/artifact-schemas.ts';
import type { AssetType } from '../../../prisma/generated/prisma/client.ts';
import {
  getRunWithNodes,
  setRunStatus,
  setNodeStatus,
  getRunStatusById,
} from '../../db/repos/workflow-run-repo.ts';
import { getPostByRunId, approveReview } from '../../db/repos/post-repo.ts';
import { platformSupportsAsset } from '../../social/postability.ts';
import { publishAssetType, distinctAssetTypes } from '../../scheduler/resolve-input.ts';
import { publishNodeStatus } from '../../events/bus.ts';
import { suggestPublishTimes, summarizeTiming } from '../../agents/publish-timing/suggest-time.ts';
import { logRun } from '../../db/client.ts';
import type { NodeExecResult } from './agent-executor.ts';

// Cost columns for a completed node. Best-effort: a node with no cost (stub/publisher)
// records $0. Never throws — cost accounting must not break a run.
const costFields = (result: NodeExecResult) => ({
  promptTokens: result.cost?.promptTokens ?? 0,
  outputTokens: result.cost?.outputTokens ?? 0,
  totalTokens: result.cost?.totalTokens ?? 0,
  costUsd: result.cost?.costUsd ?? 0,
});

// Media node ↔ post assetType. A media step runs only when it matches the chosen assetType:
// carousel/image never trigger (and never pay for) the video pipeline, and a carousel's
// single-image infographic doesn't clobber its multi-slide hero. storyboard serves both
// carousel (story slides) and video (keyframes) so it maps to both.
const MEDIA_AGENT_ASSET: Record<string, ReadonlyArray<string>> = {
  infographic: ['image'],
  storyboard: ['carousel', 'video'],
  video: ['video'],
};

// Agents that PAUSE the run right AFTER they execute (produce-then-gate), for a user
// decision on the just-produced output. concept_writer parks so the user picks one of its
// 3-5 versions (+ optional reference image) before media/publish run. Distinct from the
// requiresApproval BEFORE-gate (publisher/video), which halts before spending.
const SELECTION_GATE = new Set<string>(['concept_writer']);

export interface ExecuteOptions {
  geminiFn?: RunnerContext['geminiFn'];
  publishFn?: RunnerContext['publishFn'];
  llmJsonFn?: RunnerContext['llmJsonFn'];
  imageFn?: RunnerContext['imageFn'];
  videoFn?: RunnerContext['videoFn'];
  ttsFn?: RunnerContext['ttsFn'];
  researchFn?: RunnerContext['researchFn'];
  // When true, the executor RUNS the gated node instead of halting (post-approval).
  approveNodeId?: string;
  // Auto-publish (item 2): when true (DEFAULT), the publisher external-write gate is
  // skipped so a post flows straight through to publish with no Approve step. The
  // pre-VIDEO cost gate is NOT affected — that halt is keyed on agentId 'video'. Set
  // false to restore the manual "nothing publishes until you approve" gate (also how
  // the verify scripts exercise the gate/resume path without ever publishing).
  autoPublish?: boolean;
  // Concept selection gate: when true (DEFAULT), the run PAUSES right after concept_writer
  // produces its 3-5 versions so the user picks one (+ optionally uploads a reference image)
  // before media/publish run. Resume via approve-node(concept). false = auto-select version 1
  // and continue (the verify scripts + any headless path opt out).
  conceptGate?: boolean;
  // Single-node re-execute: run ONLY this node (its upstream artifacts are seeded from
  // what's already stored), then stop. Its downstream dependents are reset to pending by
  // the caller (marked stale) but NOT auto-run — the user re-runs them explicitly.
  rerunOnly?: string;
}

export type ExecuteOutcome =
  | { status: 'needs_approval'; nodeId: string }
  | { status: 'completed' }
  | { status: 'aborted'; nodeId: string }
  | { status: 'failed'; nodeId: string; error: string };

// Run (or resume) a run's DAG. The run + nodes already exist in the DB (created at
// plan time). `goal`/`plan` are the validated snapshots.
export const runWorkflow = async (
  runId: string,
  ownerId: string,
  goal: GoalSpec,
  plan: WorkflowPlan,
  opts: ExecuteOptions = {},
): Promise<ExecuteOutcome> => {
  const validated = validatePlan(plan);
  if (!('order' in validated)) {
    await setRunStatus(runId, 'failed');
    const error = 'error' in validated ? validated.error : 'plan_invalid';
    return { status: 'failed', nodeId: '-', error };
  }

  const runRow = await getRunWithNodes(runId, ownerId);
  if (!runRow) return { status: 'failed', nodeId: '-', error: 'run_not_found' };
  const nodeRowByPlanId = new Map(runRow.nodes.map((n) => [n.nodeId, n]));
  const nodeByPlanId = new Map(plan.nodes.map((n) => [n.nodeId, n]));
  // A video deliverable is expensive + high-stakes: the user must review the GENERATED video and
  // explicitly approve publishing — approving the video COST gate must not cascade into auto-publish.
  // So when the plan has a video node, the publisher gate is never auto-waived (separate approvals).
  const hasVideoNode = [...nodeByPlanId.values()].some((n) => n.agentId === 'video');

  // Seed context with artifacts already produced (resume case).
  const upstream: Partial<Record<ArtifactType, unknown>> = {};
  let postId: string | undefined;
  for (const a of await listArtifacts(runId)) {
    upstream[a.type] = a.data;
    if (a.type === 'content_concept') postId = (a.data as { postId?: string }).postId;
  }
  // Flow-as-template: an instance run is created FOR a pre-existing Post (post.runId).
  // Seed that postId so concept_writer fills the existing post (+ its campaign) rather
  // than materializing a new campaign+post. Legacy runs have no attached post → falls
  // back to concept_writer's create path. The artifact-derived postId (resume) wins.
  const attachedPost = await getPostByRunId(runId);
  if (!postId) postId = attachedPost?.id;
  // The post's chosen media governs WHICH media steps run: skip the ones no target needs, so a
  // carousel/image post never spends on video and vice-versa (#2). With per-platform asset types
  // (item 5) this is the DISTINCT set across all targets — a media step runs if it produces ANY
  // needed type. Empty (post not yet created on a legacy first run) → no gating; run per plan.
  const neededAssets: AssetType[] = attachedPost ? distinctAssetTypes(attachedPost) : [];

  await setRunStatus(runId, 'running');

  // Single-node re-execute: run exactly the requested node and return. Upstream is
  // already seeded above from stored artifacts, so the node reads the same inputs it
  // did on the first run. Downstream dependents were reset to pending (stale) by the
  // caller and are left for the user to re-run — we do NOT cascade here.
  if (opts.rerunOnly) {
    const planNode = nodeByPlanId.get(opts.rerunOnly);
    const nodeRow = nodeRowByPlanId.get(opts.rerunOnly);
    if (!planNode || !nodeRow) {
      await setRunStatus(runId, 'failed');
      return { status: 'failed', nodeId: opts.rerunOnly, error: 'node_not_found' };
    }
    const ctx: RunnerContext = { runId, ownerId, goal, upstream, postId, geminiFn: opts.geminiFn, publishFn: opts.publishFn, llmJsonFn: opts.llmJsonFn, imageFn: opts.imageFn, videoFn: opts.videoFn, ttsFn: opts.ttsFn, researchFn: opts.researchFn };
    await setNodeStatus(nodeRow.id, 'running', { startedAt: new Date() });
    publishNodeStatus(ownerId, { runId, nodeId: planNode.nodeId, agentId: planNode.agentId, status: 'running' });
    try {
      const result = await executeNode(planNode, ctx);
      await setNodeStatus(nodeRow.id, 'completed', { finishedAt: new Date(), outputRefs: [result.artifactId], ...costFields(result) });
      publishNodeStatus(ownerId, { runId, nodeId: planNode.nodeId, agentId: planNode.agentId, status: 'completed' });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).slice(0, 500);
      await setNodeStatus(nodeRow.id, 'failed', { finishedAt: new Date(), error: msg });
      await setRunStatus(runId, 'failed');
      publishNodeStatus(ownerId, { runId, nodeId: planNode.nodeId, agentId: planNode.agentId, status: 'failed', error: msg });
      await logRun('error', 'wf_node_rerun', { runId, nodeId: planNode.nodeId, agentId: planNode.agentId, error: msg }, ownerId);
      return { status: 'failed', nodeId: planNode.nodeId, error: msg };
    }
    // A re-run regenerates one step; its downstream was reset to pending (stale) by the
    // caller. Park the run at `planned` — NOT needs_approval — so it is RESUMABLE: the
    // Execute button reappears (as "Continue"), and running it resumes the main loop
    // (skips completed nodes, runs the stale downstream, halts at the publisher gate).
    // Parking at needs_approval was the dead-end bug: no awaiting_approval node existed,
    // so there was neither an approve button nor an execute button — the run got stuck.
    await setRunStatus(runId, 'planned');
    return { status: 'completed' };
  }

  for (const planNodeId of validated.order) {
    const planNode = nodeByPlanId.get(planNodeId)!;
    const nodeRow = nodeRowByPlanId.get(planNodeId)!;
    if (nodeRow.status === 'completed' || nodeRow.status === 'skipped') continue;

    // Kill switch (run abort): POST /runs/:id/abort flips the run to 'aborted'. The detached
    // executor honors it at each node boundary — stop cleanly BEFORE spending on the next node.
    if ((await getRunStatusById(runId)) === 'aborted') {
      publishNodeStatus(ownerId, { runId, nodeId: planNodeId, agentId: planNode.agentId, status: 'aborted' });
      return { status: 'aborted', nodeId: planNodeId };
    }

    // Concept selection gate — RESUME: the run parked here after concept produced its versions.
    // On approve-node(concept) the user has picked a version (+ optional reference image) → approve
    // the post (review→ready) so the publisher can claim it, mark the node completed, and continue
    // to media/publish. A re-execute that doesn't target this node keeps the run parked.
    if (SELECTION_GATE.has(planNode.agentId) && nodeRow.status === 'awaiting_approval') {
      if (opts.approveNodeId === planNodeId) {
        if (postId) await approveReview(postId, ownerId, new Date());
        await setNodeStatus(nodeRow.id, 'completed');
        publishNodeStatus(ownerId, { runId, nodeId: planNodeId, agentId: planNode.agentId, status: 'completed' });
        continue;
      }
      await setRunStatus(runId, 'needs_approval');
      return { status: 'needs_approval', nodeId: planNodeId };
    }

    // Media selection by needed asset types (#2, item 5): skip a media step none of the
    // targets need — BEFORE the approval halt, so a carousel-only post never stops at the
    // video gate. A step runs if it produces ANY needed asset type.
    const wantAssets = MEDIA_AGENT_ASSET[planNode.agentId];
    if (wantAssets && neededAssets.length > 0 && !wantAssets.some((a) => neededAssets.includes(a as AssetType))) {
      await setNodeStatus(nodeRow.id, 'skipped');
      publishNodeStatus(ownerId, { runId, nodeId: planNodeId, agentId: planNode.agentId, status: 'skipped' });
      continue;
    }

    // Publish-completeness gate (future-proofing): the publisher must NOT fire while any OTHER
    // step is still in progress (e.g. a video still generating once the executor runs branches in
    // parallel). If a non-publisher node isn't terminal, HOLD the run and notify the user which
    // steps remain — never publish prematurely. In today's sequential executor upstream is already
    // done by the time we reach the publisher, so this is normally a no-op; it guards the future.
    if (planNode.agentId === 'publisher') {
      const fresh = await getRunWithNodes(runId, ownerId);
      const pending = (fresh?.nodes ?? []).filter(
        (n) => n.nodeId !== planNodeId && !['completed', 'skipped', 'failed'].includes(n.status),
      );
      if (pending.length > 0) {
        await setNodeStatus(nodeRow.id, 'awaiting_approval');
        await setRunStatus(runId, 'needs_approval');
        const remaining = pending.map((n) => n.agentId).join(', ');
        publishNodeStatus(ownerId, {
          runId, nodeId: planNodeId, agentId: planNode.agentId, status: 'awaiting_approval',
          notice: `Holding publish — ${pending.length} step(s) still in progress: ${remaining}`,
        });
        return { status: 'needs_approval', nodeId: planNodeId };
      }
    }

    // Approval halt: a gated node stops the run UNLESS it's the one just approved. Read the
    // gating policy from the LIVE registry (not the frozen plan) so a policy change — e.g.
    // adding the pre-video cost gate — applies to already-planned templates/runs too.
    const gated = getAgent(planNode.agentId)?.requiresApproval ?? planNode.requiresApproval;
    // Auto-publish default (item 2): waive the publisher gate when the post is cleanly
    // postable — every target platform's adapter supports the asset type. The connection
    // resolver already ran before the DAG, so by here every target IS connected; the only
    // remaining blocker is asset compatibility (item 1). If some target can't take the asset,
    // KEEP the gate so the publish review (item 3) surfaces exactly what would be skipped
    // before anything goes out. The video cost gate (agentId 'video') is separate and always
    // holds. autoPublish=false restores the manual gate (verify scripts, opt-out).
    // Auto-publish is suppressed when the run produces a video: approving the video cost gate must
    // NOT also publish. The user reviews the finished video, then approves the publisher separately.
    const autoPublish = (opts.autoPublish ?? true) && !hasVideoNode;
    let requiresApproval = gated;
    if (gated && planNode.agentId === 'publisher' && autoPublish) {
      // Per-platform (item 5): each target may publish its own asset type — auto-run only
      // when EVERY target's adapter supports ITS asset type; otherwise gate for the review.
      const cleanlyPostable =
        !!attachedPost && attachedPost.platforms.length > 0 &&
        attachedPost.platforms.every((p) => platformSupportsAsset(p, publishAssetType(attachedPost, p)));
      requiresApproval = !cleanlyPostable; // clean → auto-run; any skip/unknown → gate for review
    }
    if (requiresApproval && opts.approveNodeId !== planNodeId) {
      await setNodeStatus(nodeRow.id, 'awaiting_approval');
      await setRunStatus(runId, 'needs_approval');
      // Publisher gate (Phase 02): surface the optimal-time suggestion on the halt event so
      // the approval UI shows the recommended window BEFORE the user approves. Pure heuristic
      // (no spend); other gated nodes (the video cost gate) carry no suggestion.
      const timingSuggestion =
        planNode.agentId === 'publisher'
          ? summarizeTiming(
              suggestPublishTimes({
                platforms: attachedPost?.platforms ?? goal.platforms,
                audience: goal.slots.targetAudience ?? null,
                language: attachedPost?.language ?? goal.slots.language ?? null,
              }),
            )
          : undefined;
      publishNodeStatus(ownerId, { runId, nodeId: planNodeId, agentId: planNode.agentId, status: 'awaiting_approval', timingSuggestion });
      return { status: 'needs_approval', nodeId: planNodeId };
    }

    const def = getAgent(planNode.agentId);
    const ctx: RunnerContext = { runId, ownerId, goal, upstream, postId, geminiFn: opts.geminiFn, publishFn: opts.publishFn, llmJsonFn: opts.llmJsonFn, imageFn: opts.imageFn, videoFn: opts.videoFn, ttsFn: opts.ttsFn, researchFn: opts.researchFn };

    await setNodeStatus(nodeRow.id, 'running', { startedAt: new Date() });
    publishNodeStatus(ownerId, { runId, nodeId: planNodeId, agentId: planNode.agentId, status: 'running' });

    try {
      const result = await executeNode(planNode, ctx);
      upstream[result.type as ArtifactType] = result.data;
      if (result.postId) postId = result.postId;
      await setNodeStatus(nodeRow.id, 'completed', {
        finishedAt: new Date(),
        outputRefs: [result.artifactId],
        ...costFields(result),
      });
      publishNodeStatus(ownerId, { runId, nodeId: planNodeId, agentId: planNode.agentId, status: 'completed' });
      void def;

      // Concept selection gate — PARK: pause right after concept produced its 3-5 versions so the
      // user picks one (+ optional reference image) before media/publish run. conceptGate=false
      // (verify scripts / headless) auto-selects version 1 and approves so the flow continues.
      if (SELECTION_GATE.has(planNode.agentId)) {
        if (opts.conceptGate ?? true) {
          await setNodeStatus(nodeRow.id, 'awaiting_approval');
          await setRunStatus(runId, 'needs_approval');
          publishNodeStatus(ownerId, { runId, nodeId: planNodeId, agentId: planNode.agentId, status: 'awaiting_approval' });
          return { status: 'needs_approval', nodeId: planNodeId };
        }
        if (postId) await approveReview(postId, ownerId, new Date());
      }
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).slice(0, 500);
      await setNodeStatus(nodeRow.id, 'failed', { finishedAt: new Date(), error: msg });
      await setRunStatus(runId, 'failed');
      publishNodeStatus(ownerId, { runId, nodeId: planNodeId, agentId: planNode.agentId, status: 'failed', error: msg });
      await logRun('error', 'wf_node', { runId, nodeId: planNodeId, agentId: planNode.agentId, error: msg }, ownerId);
      return { status: 'failed', nodeId: planNodeId, error: msg };
    }
  }

  await setRunStatus(runId, 'completed');
  await logRun('info', 'wf_run', { runId, status: 'completed' }, ownerId);
  return { status: 'completed' };
};
