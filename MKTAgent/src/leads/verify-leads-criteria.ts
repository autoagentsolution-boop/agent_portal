// Verify the Strategist ↔ Lead Collector scoring bridge (Phase 02). Pure, no DB, no LLM:
//  - DEFAULT_CRITERIA reproduces the original hardcoded rule-score behaviour (back-compat)
//  - a custom criteria changes the score (weights are truly data-driven)
//  - proposeLeadScoringCriteria tunes weights by funnel stage + audience
//  - the proposed criteria validates against the strategy_brief artifact schema
import { ruleScore } from './scoring/rule-score.ts';
import { DEFAULT_CRITERIA, proposeLeadScoringCriteria, type LeadScoringCriteria } from './scoring/criteria.ts';
import { strategyBrief } from '../orchestration/schemas/artifact-schemas.ts';

let failures = 0;
const ck = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// Back-compat: defaults must equal the original constants (calcom 55 + base 15 + phone 15 +
// detailed 15 = 100; bare webhook = 20 + 15 = 35).
const calcom = ruleScore({ source: 'calcom', hasPhone: true, message: 'I want to buy 50 licenses for my team next quarter' });
ck('default calcom+phone+detailed = 100', calcom.score === 100, calcom.score);
const webhook = ruleScore({ source: 'webhook', hasPhone: false, message: null });
ck('default bare webhook = 35', webhook.score === 35, webhook.score);
// Explicit default vs implicit default identical.
ck('explicit DEFAULT_CRITERIA == implicit', ruleScore({ source: 'form', hasPhone: true, message: null }, DEFAULT_CRITERIA).score === ruleScore({ source: 'form', hasPhone: true, message: null }).score);

// Data-driven: a custom criteria changes the outcome.
const zeroPhone: LeadScoringCriteria = { ...DEFAULT_CRITERIA, phoneWeight: 0 };
ck('phoneWeight=0 lowers a phone lead', ruleScore({ source: 'form', hasPhone: true, message: null }, zeroPhone).score < ruleScore({ source: 'form', hasPhone: true, message: null }).score);

// Strategist proposals tune by funnel stage.
const conv = proposeLeadScoringCriteria({ funnelStage: 'conversion', audience: 'SMB owners' });
const aware = proposeLeadScoringCriteria({ funnelStage: 'awareness', audience: 'SMB owners' });
ck('conversion weights phone above awareness', conv.phoneWeight > aware.phoneWeight, { conv: conv.phoneWeight, aware: aware.phoneWeight });
ck('awareness weights detailed message above conversion', aware.detailedMessageWeight > conv.detailedMessageWeight);

// B2B audience lifts contactability.
const b2b = proposeLeadScoringCriteria({ funnelStage: 'consideration', audience: 'B2B SaaS buyers' });
const b2c = proposeLeadScoringCriteria({ funnelStage: 'consideration', audience: 'casual shoppers' });
ck('B2B audience raises phone weight', b2b.phoneWeight > b2c.phoneWeight, { b2b: b2b.phoneWeight, b2c: b2c.phoneWeight });

// The proposed criteria rides on a valid strategy_brief artifact.
const brief = strategyBrief.safeParse({
  positioning: 'x', audience: 'B2B SaaS buyers', pillars: ['a'], funnelStage: 'conversion',
  leadScoringCriteria: proposeLeadScoringCriteria({ funnelStage: 'conversion', audience: 'B2B SaaS buyers' }),
});
ck('strategy_brief accepts proposed leadScoringCriteria', brief.success, brief.success ? undefined : brief.error?.issues[0]?.message);

console.log(failures ? `\nFAIL — ${failures} criteria check(s) red` : '\nPASS — all lead-scoring criteria checks green');
process.exit(failures ? 1 : 0);
