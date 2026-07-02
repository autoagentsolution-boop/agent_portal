// AgentExecutor — runs ONE node (brief §6: validate-in implicit via upstream
// availability, run agent core, validate-out via the artifact store). Returns the
// produced artifact or throws a recoverable error the workflow executor catches and
// records as a failed node. Output validation happens inside putArtifact (boundary).
import { getRunner, type RunnerContext } from './agent-runners.ts';
import { putArtifact } from './artifact-store.ts';
import type { WorkflowNode } from '../schemas/workflow-plan.ts';
import type { NodeCost } from './node-cost.ts';

export interface NodeExecResult {
  artifactId: string;
  type: string;
  data: unknown;
  postId?: string;
  cost?: NodeCost;
}

export const executeNode = async (
  node: WorkflowNode,
  ctx: RunnerContext,
): Promise<NodeExecResult> => {
  const runner = getRunner(node.agentId);
  if (!runner) throw new Error(`no runner for agent ${node.agentId}`);

  const output = await runner(ctx);
  // validate-out + persist (throws ArtifactValidationError → recoverable).
  const stored = await putArtifact(ctx.runId, ctx.ownerId, node.nodeId, output.type, output.data);

  return { artifactId: stored.id, type: output.type, data: stored.data, postId: output.postId, cost: output.cost };
};
