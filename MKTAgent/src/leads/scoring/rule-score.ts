// Rule-based lead scoring (§01.5, rule layer). Deterministic, cheap, always-on — no LLM, no
// token cost. Produces a 0-100 base score + an auditable reason trail. The weights are sane
// defaults for MVP; user-tunable criteria (Strategist) land in Phase 02 on top of this shape.
import type { LeadSource } from '../../../prisma/generated/prisma/client.ts';

export interface ScoreReason { layer: 'rule' | 'llm'; reason: string; delta: number }
export interface ScoreResult { score: number; reasons: ScoreReason[] }

// Source intent: a booked call (Cal.com) is the strongest buying signal; a form fill is warm;
// a raw webhook / social comment is a cooler top-of-funnel touch.
// Keyed by the current LeadSource enum (webhook|form|calcom). A future 'comment' source
// (§01.4) falls through to the default weight until the enum + poller land.
const SOURCE_WEIGHT: Partial<Record<LeadSource, { delta: number; why: string }>> = {
  calcom: { delta: 55, why: 'booked a call (high intent)' },
  form: { delta: 35, why: 'submitted a form' },
  webhook: { delta: 20, why: 'inbound webhook lead' },
};

export interface RuleInput {
  source: LeadSource;
  hasPhone: boolean;
  message: string | null;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

export const ruleScore = (input: RuleInput): ScoreResult => {
  const reasons: ScoreReason[] = [];
  const src = SOURCE_WEIGHT[input.source] ?? { delta: 15, why: 'lead captured' };
  reasons.push({ layer: 'rule', reason: src.why, delta: src.delta });

  // Base engagement signal so even a bare lead isn't a flat zero.
  reasons.push({ layer: 'rule', reason: 'new lead', delta: 15 });

  if (input.hasPhone) reasons.push({ layer: 'rule', reason: 'left a phone number', delta: 15 });
  const msgLen = (input.message ?? '').trim().length;
  if (msgLen >= 40) reasons.push({ layer: 'rule', reason: 'wrote a detailed message', delta: 15 });
  else if (msgLen > 0) reasons.push({ layer: 'rule', reason: 'left a message', delta: 8 });

  const score = clamp(reasons.reduce((s, r) => s + r.delta, 0));
  return { score, reasons };
};
