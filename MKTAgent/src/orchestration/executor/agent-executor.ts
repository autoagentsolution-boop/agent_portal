// AgentExecutor — runs ONE node (brief §6: validate-in implicit via upstream
// availability, run agent core, validate-out via the artifact store). Returns the
// produced artifact or throws a recoverable error the workflow executor catches and
// records as a failed node. Output validation happens inside putArtifact (boundary).
import { getRunner, type RunnerContext } from './agent-runners.ts';
import { putArtifact } from './artifact-store.ts';
import { callGeminiJson } from '../master/llm-json.ts';
import { thinkingBudgetFor } from '../thinking-budget.ts';
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

  // Per-node thinking budget (Phase 06): bind callGeminiJson with THIS node's tier ceiling — but ONLY when
  // the seam is the real call (llmJsonFn unset). A DRY-RUN stub sets llmJsonFn; overriding it would break
  // verification's no-spend/no-network contract. Every `ctx.llmJsonFn ?? callGeminiJson` runner then
  // inherits its budget with zero per-runner edits.
  const budget = thinkingBudgetFor(node.agentId, ctx);
  const boundCtx: RunnerContext = ctx.llmJsonFn
    ? ctx
    : { ...ctx, llmJsonFn: (p, u, onUsage) => callGeminiJson(p, u, onUsage, { thinkingBudget: budget }) };

  const output = await runner(boundCtx);
  // validate-out + persist (throws ArtifactValidationError → recoverable).
  const stored = await putArtifact(ctx.runId, ctx.ownerId, node.nodeId, output.type, output.data);

  return { artifactId: stored.id, type: output.type, data: stored.data, postId: output.postId, cost: output.cost };
};
