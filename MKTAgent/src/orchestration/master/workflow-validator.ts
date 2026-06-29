// WorkflowValidator (brief §6, planner step 4). Guards two invariants before a
// plan is accepted, returning a recoverable error (not a throw) on failure:
//   1. DAG integrity — every depends_on references a real node; no cycles.
//   2. Input satisfiability — every node's REQUIRED artifact types are produced
//      by some transitive upstream node. (Optional inputs need not be satisfied.)
// Topo-order is also returned so the executor doesn't re-sort.
import type { WorkflowPlan, PlanResult } from '../schemas/workflow-plan.ts';
import { getAgent } from '../registry/agent-registry.ts';
import type { ArtifactType } from '../schemas/artifact-schemas.ts';

export interface ValidatedPlan {
  ok: true;
  plan: WorkflowPlan;
  order: string[]; // node ids in a valid execution order
}

// Kahn topological sort. Returns null if a cycle exists or an edge dangles.
const topoSort = (plan: WorkflowPlan): string[] | null => {
  const ids = new Set(plan.nodes.map((n) => n.nodeId));
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of plan.nodes) {
    indeg.set(n.nodeId, 0);
    adj.set(n.nodeId, []);
  }
  for (const n of plan.nodes) {
    for (const dep of n.dependsOn) {
      if (!ids.has(dep)) return null; // dangling edge
      adj.get(dep)!.push(n.nodeId);
      indeg.set(n.nodeId, (indeg.get(n.nodeId) ?? 0) + 1);
    }
  }
  const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id)!) {
      indeg.set(next, indeg.get(next)! - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  return order.length === plan.nodes.length ? order : null; // shorter ⇒ cycle
};

export const validatePlan = (plan: WorkflowPlan): ValidatedPlan | PlanResult => {
  const order = topoSort(plan);
  if (!order) return { ok: false, error: 'plan_cyclic_or_dangling' };

  const nodeById = new Map(plan.nodes.map((n) => [n.nodeId, n]));
  // Walk in topo-order accumulating produced types; each node's required inputs
  // must already be in the available set.
  const available = new Set<ArtifactType>();
  const detail: string[] = [];
  for (const id of order) {
    const node = nodeById.get(id)!;
    const def = getAgent(node.agentId);
    if (!def) {
      detail.push(`${id}: unknown agent ${node.agentId}`);
      continue;
    }
    for (const req of def.requires) {
      if (!available.has(req)) detail.push(`${id} (${node.agentId}): missing required input ${req}`);
    }
    for (const out of def.produces) available.add(out);
  }
  if (detail.length) return { ok: false, error: 'plan_unsatisfiable_inputs', detail };

  return { ok: true, plan, order };
};
