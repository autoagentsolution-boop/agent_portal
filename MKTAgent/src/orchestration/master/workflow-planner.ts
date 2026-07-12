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

  // Email goal (P4-lite): write + send an email — a self-contained path, NOT the social pipeline.
  // The analyzer forces the social flags off when needsEmail is set, so this branch owns the plan.
  // email_writer optionally grounds on a content_concept, but a standalone email needs no upstream.
  if (outputs.needsEmail) {
    return ['email_writer', 'email_agent'];
  }

  // Campaign scope (Atria Phase 03): a multi-post plan routes to the campaign_strategist and STOPS
  // at the editable content calendar — per-post copy/media/publish belong to the posts materialized
  // from the approved calendar (Phase 04), NOT to this planning run. `single` falls through to the
  // unchanged one-post pipeline below (byte-identical). ideation + strategy always ground the
  // strategist; research only when asked (it's a paid grounded call).
  if (goal.campaignScope && goal.campaignScope !== 'single') {
    if (outputs.needsResearch) ids.push('content_search');
    ids.push('ideation', 'strategy', 'campaign_strategist');
    return ids;
  }

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

// The terminal external-action nodes a scheduler is spliced in FRONT of. First consumer is email;
// publisher is listed so a scheduled social post rides the same generic path once it's proven out.
const TERMINAL_ACTIONS: ReadonlyArray<RunnableAgentId> = ['email_agent', 'publisher'];

export const planWorkflow = (goal: GoalSpec): PlanResult => {
  const selected = selectAgents(goal);
  if (selected.length === 0) {
    return { ok: false, error: 'no_agents_selected', detail: ['goal produced no output requirements'] };
  }

  // Generic scheduler splice (2026-07-12): a goal carrying a user-CONFIRMED schedule gets a `scheduler`
  // node inserted immediately before its terminal action, so the run parks at the scheduler gate and a
  // cron re-enters the flow at the action when due. Unconfirmed / no schedule → plan unchanged (the
  // publisher keeps its own scheduledAt path). Guarded on `.confirmed` so a mere parse never plans it.
  const scheduled = Boolean(goal.schedule?.confirmed && goal.schedule.at);
  const ids: RunnableAgentId[] = [...selected];
  if (scheduled) {
    const actionIdx = ids.findIndex((id) => TERMINAL_ACTIONS.includes(id));
    if (actionIdx >= 0) ids.splice(actionIdx, 0, 'scheduler');
  }

  // Publish-only goal (Phase 05 / D-F5): needsPublishing selected the publisher but no content
  // agent was — nothing produces the `content_concept` the publisher requires, so validatePlan
  // would fail with a cryptic `plan_unsatisfiable_inputs`. Surface an ACTIONABLE error instead:
  // a publish needs something to publish. (A future "publish existing media" path would add a
  // source node here; today we ask the user to include content.)
  if (selected.includes('publisher') && !selected.includes('concept_writer')) {
    return { ok: false, error: 'publish_only_no_content', detail: ['A publish goal needs content — add a text post, image, or video for the publisher to send.'] };
  }

  const placed: Array<{ nodeId: string; def: AgentDefinition }> = [];
  const nodes: WorkflowNode[] = [];

  ids.forEach((agentId, i) => {
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

  // Scheduler edge wiring: the scheduler produces no artifact any node consumes, so deriveDeps can't
  // order it — wire it explicitly as writer(s) → scheduler → action. The action then depends ONLY on the
  // scheduler (its content producers stay transitively upstream, so input satisfiability holds), which
  // forces the executor to halt at the scheduler gate BEFORE reaching the action.
  if (scheduled) {
    const schedulerNode = nodes.find((n) => n.agentId === 'scheduler');
    const actionNode = nodes.find((n) => TERMINAL_ACTIONS.includes(n.agentId));
    if (schedulerNode && actionNode) {
      schedulerNode.dependsOn = [...actionNode.dependsOn];
      actionNode.dependsOn = [schedulerNode.nodeId];
    }
  }

  const parsed = workflowPlan.safeParse({ goal: goal.goal, nodes });
  if (!parsed.success) {
    return { ok: false, error: 'plan_malformed', detail: parsed.error.issues.map((x) => x.message) };
  }

  // Final gate: every node's required inputs must be satisfiable + DAG acyclic.
  const check = validatePlan(parsed.data);
  if (!check.ok) return check;

  return { ok: true, plan: parsed.data };
};
