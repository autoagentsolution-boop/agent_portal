// WorkflowPlanner — RULE-based agent selection + DAG construction (brief §5, §10).
// User decision (locked): rule-based, NOT LLM-driven. A valid GoalSpec always
// yields a valid DAG; the LLM only produced the GoalSpec upstream. Edges are
// DERIVED by matching each selected agent's `requires` against the `produces` of
// already-selected upstream agents — no hardcoded flow. This keeps adding an agent
// to the registry the only change needed to extend a flow.
import type { GoalSpec } from '../schemas/goal-spec.ts';
import {
  workflowPlan,
  type WorkflowNode,
  type PlanResult,
} from '../schemas/workflow-plan.ts';
import { getAgent } from '../registry/agent-registry.ts';
import type { AgentDefinition, RunnableAgentId } from '../registry/agent-types.ts';
import { validatePlan } from './workflow-validator.ts';

// Rule selection (brief §10). Order matters: it establishes the natural pipeline
// sequence so derived edges point backwards to already-added producers.
const selectAgents = (goal: GoalSpec): RunnableAgentId[] => {
  const ids: RunnableAgentId[] = [];
  const { outputs } = goal;
  if (outputs.needsResearch) ids.push('content_search');
  // strategy requires campaign_ideas → ideation is implied whenever strategy runs.
  if (outputs.needsIdeation || outputs.needsStrategy) ids.push('ideation');
  if (outputs.needsStrategy) ids.push('strategy');
  // concept_writer produces content_concept — the narrative spine required by a text post AND by
  // every media agent (infographic/storyboard/video). Add it whenever ANY of those is requested,
  // not just needsTextPost; otherwise a media-only goal has an unsatisfiable content_concept
  // dependency and fails to plan (plan_error).
  if (outputs.needsTextPost || outputs.needsInfographic || outputs.needsStoryboard || outputs.needsVideo) {
    ids.push('concept_writer');
  }
  if (outputs.needsInfographic) ids.push('infographic');
  // Storyboard is independent; video DEPENDS ON storyboard. So plan storyboard whenever
  // it's asked OR a video is (video implies storyboard), and video only when asked.
  if (outputs.needsStoryboard || outputs.needsVideo) ids.push('storyboard');
  if (outputs.needsVideo) ids.push('video');
  if (outputs.needsPublishing) ids.push('publisher');
  return ids;
};

// Derive depends_on: for each of this agent's required (+ satisfiable optional)
// artifact types, link to the most-recent upstream node that produces it.
const deriveDeps = (
  agent: AgentDefinition,
  nodeId: string,
  placed: Array<{ nodeId: string; def: AgentDefinition }>,
): string[] => {
  const deps = new Set<string>();
  const wanted = [...agent.requires, ...agent.optional];
  for (const type of wanted) {
    // search backwards for the latest producer already placed
    for (let i = placed.length - 1; i >= 0; i--) {
      const cand = placed[i];
      if (cand && cand.def.produces.includes(type)) {
        deps.add(cand.nodeId);
        break;
      }
    }
  }
  void nodeId;
  return [...deps];
};

export const planWorkflow = (goal: GoalSpec): PlanResult => {
  const selected = selectAgents(goal);
  if (selected.length === 0) {
    return { ok: false, error: 'no_agents_selected', detail: ['goal produced no output requirements'] };
  }

  const placed: Array<{ nodeId: string; def: AgentDefinition }> = [];
  const nodes: WorkflowNode[] = [];

  selected.forEach((agentId, i) => {
    const def = getAgent(agentId);
    if (!def) return; // unreachable: selected ids are registry ids
    const nodeId = `n${i + 1}`;
    nodes.push({
      nodeId,
      agentId,
      dependsOn: deriveDeps(def, nodeId, placed),
      requiresApproval: def.requiresApproval,
    });
    placed.push({ nodeId, def });
  });

  const parsed = workflowPlan.safeParse({ goal: goal.goal, nodes });
  if (!parsed.success) {
    return { ok: false, error: 'plan_malformed', detail: parsed.error.issues.map((x) => x.message) };
  }

  // Final gate: every node's required inputs must be satisfiable + DAG acyclic.
  const check = validatePlan(parsed.data);
  if (!check.ok) return check;

  return { ok: true, plan: parsed.data };
};
