// Lead-scoring criteria (Atria Phase 02 — Strategist ↔ Lead Collector bridge).
// The rule layer's weights were hardcoded in rule-score.ts; this makes them DATA so
// (a) the Strategist can PROPOSE weights tuned to the campaign's funnel stage/audience,
// and (b) a user can adjust them. DEFAULT_CRITERIA reproduces the original hardcoded
// behaviour exactly, so existing scores/verify are unchanged when no criteria is passed.
import type { LeadSource } from '../../../prisma/generated/prisma/client.ts';

export interface LeadScoringCriteria {
  // Per-source intent weight (booked call > form > raw webhook). Missing source → unknownSourceWeight.
  sourceWeights: Partial<Record<LeadSource, number>>;
  unknownSourceWeight: number;
  // Base engagement so even a bare lead isn't a flat zero.
  baseWeight: number;
  // Left a phone number (contactability signal).
  phoneWeight: number;
  // Wrote a message: detailed (≥ detailedMessageMinLen) vs short (>0).
  detailedMessageWeight: number;
  shortMessageWeight: number;
  detailedMessageMinLen: number;
}

// Mirrors the original rule-score.ts constants 1:1 (back-compat contract).
export const DEFAULT_CRITERIA: LeadScoringCriteria = {
  sourceWeights: { calcom: 55, form: 35, webhook: 20 },
  unknownSourceWeight: 15,
  baseWeight: 15,
  phoneWeight: 15,
  detailedMessageWeight: 15,
  shortMessageWeight: 8,
  detailedMessageMinLen: 40,
};

export interface ProposeInput {
  funnelStage?: string | null; // awareness|consideration|conversion|retention (strategy_brief)
  audience?: string | null;
}

const B2B = /\b(b2b|business|saas|enterprise|professional|company|team)\b/i;

// The Strategist's contribution: propose weights from the campaign's funnel stage + audience.
// Deterministic (no LLM, no cost) — the strategy is already an LLM artifact; the SCORING intent
// derives cleanly from its funnel stage, so we compute rather than pay for another call.
//   - conversion/retention → buying-intent signals (booked call, phone, form) matter most.
//   - awareness/consideration → engagement (message depth) is the stronger early signal.
//   - B2B audience → contactability (phone/booking) weighted higher.
export const proposeLeadScoringCriteria = (input: ProposeInput): LeadScoringCriteria => {
  const c: LeadScoringCriteria = {
    ...DEFAULT_CRITERIA,
    sourceWeights: { ...DEFAULT_CRITERIA.sourceWeights },
  };
  const stage = (input.funnelStage ?? '').toLowerCase();

  if (stage === 'conversion' || stage === 'retention') {
    c.sourceWeights.calcom = 60;
    c.sourceWeights.form = 40;
    c.phoneWeight = 22;
    c.detailedMessageWeight = 12;
  } else if (stage === 'awareness' || stage === 'consideration') {
    c.detailedMessageWeight = 22;
    c.shortMessageWeight = 12;
    c.phoneWeight = 10;
  }

  if (input.audience && B2B.test(input.audience)) {
    c.phoneWeight += 6;
    c.sourceWeights.calcom = (c.sourceWeights.calcom ?? 55) + 5;
  }
  return c;
};
