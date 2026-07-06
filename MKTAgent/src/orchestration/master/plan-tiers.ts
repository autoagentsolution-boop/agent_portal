// Multi-tier plans (Atria Phase 03 — "Tiết kiệm / Cân bằng / Đầy đủ"). The planner emits ONE DAG
// from a goal; this derives 2-3 goal VARIANTS (fewer / balanced / full agents), plans each, and
// estimates its credit cost from real history — the selectable plan cards at checkpoint 2. The
// user picks a tier and THAT variant's plan becomes the run. Balanced is the anchor (the user's
// actual request); Economy/Full are only offered when they genuinely differ from it.
import { planWorkflow } from './workflow-planner.ts';
import { agentIdList, type WorkflowPlan } from '../schemas/workflow-plan.ts';
import { goalSpec, type GoalSpec } from '../schemas/goal-spec.ts';
import { estimateAgents, type PlanEstimate } from '../../cost/plan-estimate.ts';
import type { AgentCostAverage } from '../../db/repos/workflow-run-repo.ts';

export type PlanTierId = 'economy' | 'balanced' | 'full';

export interface PlanTier {
  id: PlanTierId;
  label: string;
  description: string;
  plan: WorkflowPlan;
  agentIds: string[];
  estimate: PlanEstimate;
}

const TIER_META: Record<PlanTierId, { label: string; description: string }> = {
  economy: { label: 'Economy', description: 'Just the essentials — fewest agents, lowest credits.' },
  balanced: { label: 'Balanced', description: 'The recommended plan for your request.' },
  full: { label: 'Full', description: 'Adds research, ideation and strategy for the richest result.' },
};

// Economy strips the intelligence enrichment (research/ideation/strategy) — keep the deliverable
// + publish, fewer LLM nodes. Full adds the whole intelligence stack on top.
const economyGoal = (g: GoalSpec): GoalSpec =>
  goalSpec.parse({ ...g, outputs: { ...g.outputs, needsResearch: false, needsIdeation: false, needsStrategy: false } });
const fullGoal = (g: GoalSpec): GoalSpec =>
  goalSpec.parse({ ...g, outputs: { ...g.outputs, needsResearch: true, needsIdeation: true, needsStrategy: true } });

const tierOf = (id: PlanTierId, plan: WorkflowPlan, history: AgentCostAverage[]): PlanTier => {
  const agentIds = agentIdList(plan);
  return { id, label: TIER_META[id].label, description: TIER_META[id].description, plan, agentIds, estimate: estimateAgents(agentIds, history) };
};

// Returns [] when even the balanced goal can't plan (caller keeps the single-plan flow).
export const buildPlanTiers = (goal: GoalSpec, history: AgentCostAverage[]): PlanTier[] => {
  const balanced = planWorkflow(goal);
  if (!balanced.ok) return [];
  const anchorKey = agentIdList(balanced.plan).join(',');

  const tiers: PlanTier[] = [];
  // Economy first (display order economy < balanced < full), only if it truly trims the DAG.
  const eco = planWorkflow(economyGoal(goal));
  if (eco.ok && agentIdList(eco.plan).join(',') !== anchorKey) tiers.push(tierOf('economy', eco.plan, history));

  tiers.push(tierOf('balanced', balanced.plan, history));

  const full = planWorkflow(fullGoal(goal));
  const fullKey = full.ok ? agentIdList(full.plan).join(',') : '';
  // Offer Full only when it differs from BOTH balanced and economy (no duplicate cards).
  if (full.ok && fullKey !== anchorKey && !tiers.some((t) => t.agentIds.join(',') === fullKey)) {
    tiers.push(tierOf('full', full.plan, history));
  }
  return tiers;
};
