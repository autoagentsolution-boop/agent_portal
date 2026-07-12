// WorkflowPlan — the dynamic DAG the planner emits (brief §5). Stored as a JSON
// snapshot on WorkflowRun.plan (Phase 3). Nodes carry plan-local ids ("n1"..) and
// depends_on edges; the executor topo-sorts on these. Zod-validated so a plan that
// round-trips through the DB stays well-formed.
import { z } from 'zod';
import type { RunnableAgentId } from '../registry/agent-types.ts';

const runnableAgentId = z.enum([
  'ideation',
  'strategy',
  'content_search',
  'campaign_strategist',
  'concept_writer',
  'infographic',
  'storyboard',
  'video',
  'publisher',
  'email_writer',
  'email_agent',
  'scheduler',
]);

export const workflowNode = z.object({
  nodeId: z.string(), // plan-local, e.g. "n2"
  agentId: runnableAgentId,
  dependsOn: z.array(z.string()).default([]), // plan-local node ids
  // Whether this node halts the run for human approval before it executes
  // (publisher = external write; concept_writer = review gate). brief §11.12.
  requiresApproval: z.boolean().default(false),
});
export type WorkflowNode = z.infer<typeof workflowNode>;

export const workflowPlan = z.object({
  goal: z.literal('marketing_content'),
  nodes: z.array(workflowNode).min(1),
});
export type WorkflowPlan = z.infer<typeof workflowPlan>;

// Planner outcome is a discriminated result, NOT a thrown error (brief §6:
// validation failure → recoverable error to the Master Agent, not a 500).
export type PlanResult =
  | { ok: true; plan: WorkflowPlan }
  | { ok: false; error: string; detail?: string[] };

export const agentIdList = (plan: WorkflowPlan): RunnableAgentId[] =>
  plan.nodes.map((n) => n.agentId);
