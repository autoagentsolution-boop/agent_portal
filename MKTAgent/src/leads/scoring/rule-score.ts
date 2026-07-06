// Rule-based lead scoring (§01.5, rule layer). Deterministic, cheap, always-on — no LLM, no
// token cost. Produces a 0-100 base score + an auditable reason trail. Weights are now DATA
// (LeadScoringCriteria) so the Strategist can propose campaign-tuned weights (Phase 02) —
// pass none and DEFAULT_CRITERIA reproduces the original hardcoded behaviour exactly.
import type { LeadSource } from '../../../prisma/generated/prisma/client.ts';
import { DEFAULT_CRITERIA, type LeadScoringCriteria } from './criteria.ts';

export interface ScoreReason { layer: 'rule' | 'llm'; reason: string; delta: number }
export interface ScoreResult { score: number; reasons: ScoreReason[] }

// Human-readable "why" per source (independent of the weight, which comes from criteria).
const SOURCE_WHY: Partial<Record<LeadSource, string>> = {
  calcom: 'booked a call (high intent)',
  form: 'submitted a form',
  webhook: 'inbound webhook lead',
};

export interface RuleInput {
  source: LeadSource;
  hasPhone: boolean;
  message: string | null;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

export const ruleScore = (input: RuleInput, criteria: LeadScoringCriteria = DEFAULT_CRITERIA): ScoreResult => {
  const reasons: ScoreReason[] = [];
  const srcDelta = criteria.sourceWeights[input.source] ?? criteria.unknownSourceWeight;
  reasons.push({ layer: 'rule', reason: SOURCE_WHY[input.source] ?? 'lead captured', delta: srcDelta });

  // Base engagement signal so even a bare lead isn't a flat zero.
  reasons.push({ layer: 'rule', reason: 'new lead', delta: criteria.baseWeight });

  if (input.hasPhone) reasons.push({ layer: 'rule', reason: 'left a phone number', delta: criteria.phoneWeight });
  const msgLen = (input.message ?? '').trim().length;
  if (msgLen >= criteria.detailedMessageMinLen) reasons.push({ layer: 'rule', reason: 'wrote a detailed message', delta: criteria.detailedMessageWeight });
  else if (msgLen > 0) reasons.push({ layer: 'rule', reason: 'left a message', delta: criteria.shortMessageWeight });

  const score = clamp(reasons.reduce((s, r) => s + r.delta, 0));
  return { score, reasons };
};
