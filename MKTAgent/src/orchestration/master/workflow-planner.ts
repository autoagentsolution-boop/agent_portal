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
import type { ArtifactType } from '../schemas/artifact-schemas.ts';
import { producerOf } from './artifact-graph.ts';
import { validatePlan } from './workflow-validator.ts';

// Canonical pipeline order. selectByTargets returns the chosen node SET sorted by this, so the
// natural sequence (research → ideation → strategy → [campaign_strategist | concept → media] →
// publisher; email is its own tail) holds — derived edges then point backwards to producers, and
// plan-tiers' ORDERED agentIdList dedup stays stable. Nodes not requested are simply filtered out.
const PIPELINE_ORDER: readonly RunnableAgentId[] = [
  'content_search', 'ideation', 'strategy', 'campaign_strategist',
  'security', 'summarize', 'concept_writer', 'infographic', 'storyboard', 'video',
  'email_writer', 'email_agent', 'publisher',
];

// The terminal artifact types a goal REQUESTS. Backward-chaining resolves the rest from `requires`.
// This is the ONLY place output flags are read — a thin, exhaustive shim so the marketing GoalSpec
// maps to artifact targets while selection itself stays registry-driven and marketing-agnostic.
const targetsFromGoal = (goal: GoalSpec): ArtifactType[] => {
  // General task path (P1b Phase 05): a goal carrying explicit taskTargets is a NON-marketing task —
  // select backward from those directly, ignoring the marketing output flags. This is the seam that
  // makes any registry capability (e.g. summarize) reachable without a marketing frame. Unknown target
  // types simply resolve to no producer in selectByTargets (a capability gap, surfaced in Phase 02).
  if (goal.taskTargets && goal.taskTargets.length) return goal.taskTargets as ArtifactType[];

  const o = goal.outputs;
  // Email path (P4-lite): a self-contained write+send, NOT the social pipeline. The analyzer forces
  // the social flags off when needsEmail is set, so this owns the plan (email_writer's optional
  // content_concept is not a target → a standalone email has no upstream). EXCEPTION: "research then
  // email" keeps research — research_summary is emitted as a target so content_search runs and grounds
  // the email via email_writer's optional research_summary edge (BUG-7 fix).
  if (o.needsEmail) return o.needsResearch ? ['research_summary', 'email_result'] : ['email_result'];

  // Campaign scope: route to the strategist and STOP at the editable calendar. ideation + strategy
  // ALWAYS ground the strategist (via its optional slots — emitted as targets so they're selected);
  // research only when asked. Per-post copy/media/publish belong to the materialized posts, not here.
  if (goal.campaignScope !== 'single') {
    const targets: ArtifactType[] = ['campaign_ideas', 'strategy_brief', 'content_calendar'];
    if (o.needsResearch) targets.push('research_summary');
    return targets;
  }

  // Single-post pipeline. Intelligence agents (research/ideation/strategy) are flag-driven enrichment
  // that ground concept_writer via its OPTIONAL edges; the deliverable/publish targets pull the
  // concept + media + publisher chain by their `requires`. strategy_brief → strategy → campaign_ideas
  // → ideation is a `requires` chain, so needsStrategy alone still selects ideation.
  const targets: ArtifactType[] = [];
  if (o.needsResearch) targets.push('research_summary');
  if (o.needsIdeation) targets.push('campaign_ideas');
  if (o.needsStrategy) targets.push('strategy_brief');
  if (o.needsTextPost) targets.push('content_concept');
  if (o.needsInfographic) targets.push('infographic_brief');
  if (o.needsStoryboard) targets.push('storyboard');
  if (o.needsVideo) targets.push('video_prompt');
  if (o.needsPublishing) targets.push('publish_result');
  return targets;
};

// Backward-chaining selection: for each requested artifact, add its producer, then its producer's
// `requires` (recursively). Optional inputs are NOT chased — optional grounding is an EDGE concern
// (deriveDeps), and any optional producer that should run is already selected via its own target.
// Returns the closed set in canonical pipeline order.
const selectByTargets = (targets: ArtifactType[]): RunnableAgentId[] => {
  const selected = new Set<RunnableAgentId>();
  const queue: ArtifactType[] = [...targets];
  while (queue.length) {
    const type = queue.shift()!;
    const producer = producerOf(type);
    if (!producer || selected.has(producer)) continue;
    selected.add(producer);
    const def = getAgent(producer);
    if (def) for (const req of def.requires) queue.push(req);
  }
  return PIPELINE_ORDER.filter((id) => selected.has(id));
};

const selectAgents = (goal: GoalSpec): RunnableAgentId[] => selectByTargets(targetsFromGoal(goal));

// A publish goal with nothing to publish. Backward-chaining WOULD auto-pull concept_writer (publisher
// requires content_concept), silently turning a content-less publish into a content plan — a behavior
// change. Detect it up front (flag-based) and surface the same actionable error as before.
const isPublishOnly = (goal: GoalSpec): boolean => {
  const o = goal.outputs;
  return o.needsPublishing && !o.needsEmail && goal.campaignScope === 'single'
    && !(o.needsTextPost || o.needsInfographic || o.needsStoryboard || o.needsVideo);
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

  // Generic scheduler splice (2026-07-12): a goal carrying a parsed schedule time gets a `scheduler` node
  // inserted immediately before its terminal action, so the run parks at the scheduler gate and a cron
  // re-enters the flow at the action when due. No schedule → plan unchanged (the publisher keeps its own
  // scheduledAt path).
  // Splice on a PARSED instant (`.at`), NOT on `.confirmed`: gating on confirmed made the scheduler depend
  // on the LLM reliably re-proposing after the user confirms — which it doesn't do consistently, so the
  // scheduler silently never spliced ("schedule lost"). The read-back confirm-ask (conversation-author)
  // is the mis-parse safety, and the approve gate parks at the exact `.at`, so splicing on parse is robust
  // and just gives immediate visual feedback that the flow will be scheduled.
  const scheduled = Boolean(goal.schedule?.at);
  const ids: RunnableAgentId[] = [...selected];
  if (scheduled) {
    const actionIdx = ids.findIndex((id) => TERMINAL_ACTIONS.includes(id));
    if (actionIdx >= 0) ids.splice(actionIdx, 0, 'scheduler');
  }

  // Publish-only goal (Phase 05 / D-F5): a publish with no content to publish. Surface an ACTIONABLE
  // error instead of auto-inventing a content step (see isPublishOnly). A future "publish existing
  // media" path would add a source node here; today we ask the user to include content.
  if (isPublishOnly(goal)) {
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
