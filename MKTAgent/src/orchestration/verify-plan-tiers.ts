// Verify multi-tier plans (Atria Phase 03). Pure — no DB, no LLM. Asserts Economy/Balanced/Full
// derive distinct DAGs with monotonic credit estimates, and that tiers dedupe when identical.
import { buildPlanTiers } from './master/plan-tiers.ts';
import { estimateAgents } from '../cost/plan-estimate.ts';
import { goalSpec, type GoalSpec } from './schemas/goal-spec.ts';
import type { AgentCostAverage } from '../db/repos/workflow-run-repo.ts';

let failures = 0;
const ck = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const NO_HISTORY: AgentCostAverage[] = [];

// A rich campaign goal: full deliverables + publish. Economy should trim research/ideation/
// strategy; Full should add them back.
const rich: GoalSpec = goalSpec.parse({
  outputs: { needsIdeation: true, needsStrategy: true, needsResearch: false, needsTextPost: true, needsInfographic: true, needsVideo: true, needsStoryboard: true, needsPublishing: true },
  platforms: ['facebook'],
  slots: { product: 'AI automation suite', productDetails: 'automates invoicing and reporting for SMB teams' },
  provider: 'test',
});

const tiers = buildPlanTiers(rich, NO_HISTORY);
ck('produces multiple tiers', tiers.length >= 2, tiers.map((t) => t.id));
ck('includes a balanced tier', tiers.some((t) => t.id === 'balanced'));

const eco = tiers.find((t) => t.id === 'economy');
const bal = tiers.find((t) => t.id === 'balanced');
const full = tiers.find((t) => t.id === 'full');

if (eco && bal) {
  ck('economy has fewer agents than balanced', eco.agentIds.length < bal.agentIds.length, { eco: eco.agentIds, bal: bal.agentIds });
  ck('economy costs fewer credits', eco.estimate.credits <= bal.estimate.credits, { eco: eco.estimate.credits, bal: bal.estimate.credits });
  ck('economy drops research/ideation/strategy', !eco.agentIds.includes('content_search') && !eco.agentIds.includes('ideation') && !eco.agentIds.includes('strategy'), eco.agentIds);
}
if (full && bal) {
  ck('full adds the intelligence stack', full.agentIds.includes('ideation') && full.agentIds.includes('strategy'), full.agentIds);
  ck('full costs at least as much as balanced', full.estimate.credits >= bal.estimate.credits, { full: full.estimate.credits, bal: bal.estimate.credits });
}

// Every tier carries a positive estimate + a valid plan.
ck('every tier has a positive credit estimate', tiers.every((t) => t.estimate.credits > 0), tiers.map((t) => t.estimate.credits));
ck('every tier plan is non-empty', tiers.every((t) => t.plan.nodes.length > 0));

// Dedup: a bare text-only goal → economy == balanced (no enrichment to strip) → not duplicated.
const bare: GoalSpec = goalSpec.parse({
  outputs: { needsTextPost: true, needsPublishing: false, needsIdeation: false, needsStrategy: false, needsResearch: false, needsInfographic: false, needsStoryboard: false, needsVideo: false },
  platforms: ['facebook'],
  slots: { product: 'AI automation suite', productDetails: 'automates invoicing for SMB teams' },
  provider: 'test',
});
const bareTiers = buildPlanTiers(bare, NO_HISTORY);
const keys = bareTiers.map((t) => t.agentIds.join(','));
ck('no duplicate tier DAGs', new Set(keys).size === keys.length, keys);

// History beats fallback: a recorded average changes the estimate vs the default.
const withHistory: AgentCostAverage[] = [{ agentId: 'concept_writer', avgTotalTokens: 50_000, avgCostUsd: 0.1, samples: 5 }];
const estDefault = estimateAgents(['concept_writer'], NO_HISTORY);
const estHist = estimateAgents(['concept_writer'], withHistory);
ck('history overrides fallback estimate', estHist.totalTokens === 50_000 && estHist.totalTokens !== estDefault.totalTokens, { hist: estHist.totalTokens, def: estDefault.totalTokens });

console.log(failures ? `\nFAIL — ${failures} plan-tier check(s) red` : '\nPASS — multi-tier plans green');
process.exit(failures ? 1 : 0);
