// LLM lead scoring (§01.5, LLM layer). OPTIONAL + user-triggered (POST /leads/:id/rescore) so
// it's credit-aware — we don't LLM-score every inbound lead. Gemini reads the lead's message +
// campaign context → an intent adjustment (-30..+30) on top of the deterministic rule score,
// with a short human reason. Injectable llmFn for DRY-RUN verification.
import { callGeminiJson, type LlmJsonFn } from '../../orchestration/master/llm-json.ts';
import type { ScoreReason } from './rule-score.ts';
import { env } from '../../config/env.ts';
import { recordLlmUsage } from '../../cost/llm-usage.ts';

export interface LlmScoreInput {
  ruleScore: number;
  email: string;
  message: string | null;
  source: string;
  brandContext?: string | null; // the owner's product/brand context, to judge fit
}

const SYSTEM = `You score inbound sales leads for buying intent. Given a lead and the business
context, return STRICT JSON: {"delta": <integer -30..30>, "reason": "<max 12 words>"}.
delta ADJUSTS an existing rule score: positive = stronger intent/fit, negative = spam/low-fit.
Be conservative; default delta 0 when the signal is weak. No prose, JSON only.`;

// ownerId/leadId (optional): the requesting tenant + the lead being scored, so a REAL Gemini
// call (via the default callGeminiJson) bills the usage ledger (surface 'lead_rescore', refId
// = leadId). The injected `llmFn` a test/DRY-RUN passes ignores the onUsage sink entirely, so
// nothing is recorded for a stubbed call — only the real path spends + records.
export const llmScoreAdjustment = async (
  input: LlmScoreInput,
  llmFn: LlmJsonFn = callGeminiJson,
  ownerId?: string | null,
  leadId?: string | null,
): Promise<ScoreReason | null> => {
  const user = [
    `Source: ${input.source}`,
    `Message: ${input.message?.trim() || '(none)'}`,
    input.brandContext ? `Business: ${input.brandContext.slice(0, 500)}` : '',
    `Current rule score: ${input.ruleScore}/100`,
  ].filter(Boolean).join('\n');
  try {
    const out = (await llmFn(SYSTEM, user, (usage) => {
      void recordLlmUsage({ ownerId: ownerId ?? null, surface: 'lead_rescore', model: env.GEMINI_MODEL, usage, refId: leadId ?? null });
    })) as { delta?: unknown; reason?: unknown };
    const delta = Math.max(-30, Math.min(30, Math.round(Number(out?.delta ?? 0)) || 0));
    const reason = typeof out?.reason === 'string' && out.reason.trim() ? out.reason.trim().slice(0, 80) : 'AI intent review';
    return { layer: 'llm', reason, delta };
  } catch {
    return null; // upstream/parse failure → leave the rule score untouched (non-blocking)
  }
};

// Combine a base score with the llm adjustment, clamped 0-100.
export const applyLlmAdjustment = (base: number, adj: ScoreReason | null): number =>
  adj ? Math.max(0, Math.min(100, base + adj.delta)) : base;
