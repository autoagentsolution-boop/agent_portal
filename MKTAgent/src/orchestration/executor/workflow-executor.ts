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
import {
  getRunWithNodes,
  setRunStatus,
  setNodeStatus,
} from '../../db/repos/workflow-run-repo.ts';
import { publishNodeStatus } from '../../events/bus.ts';
import { logRun } from '../../db/client.ts';

export interface ExecuteOptions {
  geminiFn?: RunnerContext['geminiFn'];
  publishFn?: RunnerContext['publishFn'];
  llmJsonFn?: RunnerContext['llmJsonFn'];
  imageFn?: RunnerContext['imageFn'];
  // When true, the executor RUNS the gated node instead of halting (post-approval).
  approveNodeId?: string;
  // Single-node re-execute: run ONLY this node (its upstream artifacts are seeded from
  // what's already stored), then stop. Its downstream dependents are reset to pending by
  // the caller (marked stale) but NOT auto-run — the user re-runs them explicitly.
  rerunOnly?: string;
}

export type ExecuteOutcome =
  | { status: 'needs_approval'; nodeId: string }
  | { status: 'completed' }
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

  // Seed context with artifacts already produced (resume case).
  const upstream: Partial<Record<ArtifactType, unknown>> = {};
  let postId: string | undefined;
  for (const a of await listArtifacts(runId)) {
    upstream[a.type] = a.data;
    if (a.type === 'content_concept') postId = (a.data as { postId?: string }).postId;
  }

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
    const ctx: RunnerContext = { runId, ownerId, goal, upstream, postId, geminiFn: opts.geminiFn, publishFn: opts.publishFn, llmJsonFn: opts.llmJsonFn, imageFn: opts.imageFn };
    await setNodeStatus(nodeRow.id, 'running', { startedAt: new Date() });
    publishNodeStatus(ownerId, { runId, nodeId: planNode.nodeId, agentId: planNode.agentId, status: 'running' });
    try {
      const result = await executeNode(planNode, ctx);
      await setNodeStatus(nodeRow.id, 'completed', { finishedAt: new Date(), outputRefs: [result.artifactId] });
      publishNodeStatus(ownerId, { runId, nodeId: planNode.nodeId, agentId: planNode.agentId, status: 'completed' });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).slice(0, 500);
      await setNodeStatus(nodeRow.id, 'failed', { finishedAt: new Date(), error: msg });
      await setRunStatus(runId, 'failed');
      publishNodeStatus(ownerId, { runId, nodeId: planNode.nodeId, agentId: planNode.agentId, status: 'failed', error: msg });
      await logRun('error', 'wf_node_rerun', { runId, nodeId: planNode.nodeId, agentId: planNode.agentId, error: msg }, ownerId);
      return { status: 'failed', nodeId: planNode.nodeId, error: msg };
    }
    // A re-run leaves the run before publishing again — the downstream (incl. publisher)
    // is stale/pending, so park the run at needs_approval for the user to review + resume.
    await setRunStatus(runId, 'needs_approval');
    return { status: 'needs_approval', nodeId: opts.rerunOnly };
  }

  for (const planNodeId of validated.order) {
    const planNode = nodeByPlanId.get(planNodeId)!;
    const nodeRow = nodeRowByPlanId.get(planNodeId)!;
    if (nodeRow.status === 'completed' || nodeRow.status === 'skipped') continue;

    // Approval halt: a gated node stops the run UNLESS it's the one just approved.
    if (planNode.requiresApproval && opts.approveNodeId !== planNodeId) {
      await setNodeStatus(nodeRow.id, 'awaiting_approval');
      await setRunStatus(runId, 'needs_approval');
      publishNodeStatus(ownerId, { runId, nodeId: planNodeId, agentId: planNode.agentId, status: 'awaiting_approval' });
      return { status: 'needs_approval', nodeId: planNodeId };
    }

    const def = getAgent(planNode.agentId);
    const ctx: RunnerContext = { runId, ownerId, goal, upstream, postId, geminiFn: opts.geminiFn, publishFn: opts.publishFn, llmJsonFn: opts.llmJsonFn, imageFn: opts.imageFn };

    await setNodeStatus(nodeRow.id, 'running', { startedAt: new Date() });
    publishNodeStatus(ownerId, { runId, nodeId: planNodeId, agentId: planNode.agentId, status: 'running' });

    try {
      const result = await executeNode(planNode, ctx);
      upstream[result.type as ArtifactType] = result.data;
      if (result.postId) postId = result.postId;
      await setNodeStatus(nodeRow.id, 'completed', {
        finishedAt: new Date(),
        outputRefs: [result.artifactId],
      });
      publishNodeStatus(ownerId, { runId, nodeId: planNodeId, agentId: planNode.agentId, status: 'completed' });
      void def;
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
