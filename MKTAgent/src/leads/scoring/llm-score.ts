// LLM lead scoring (§01.5, LLM layer). OPTIONAL + user-triggered (POST /leads/:id/rescore) so
// it's credit-aware — we don't LLM-score every inbound lead. Gemini reads the lead's message +
// campaign context → an intent adjustment (-30..+30) on top of the deterministic rule score,
// with a short human reason. Injectable llmFn for DRY-RUN verification.
import { callGeminiJson, type LlmJsonFn } from '../../orchestration/master/llm-json.ts';
import type { ScoreReason } from './rule-score.ts';

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

// Returns a single llm-layer ScoreReason (the adjustment) or null if the model is unusable.
export const llmScoreAdjustment = async (input: LlmScoreInput, llmFn: LlmJsonFn = callGeminiJson): Promise<ScoreReason | null> => {
  const user = [
    `Source: ${input.source}`,
    `Message: ${input.message?.trim() || '(none)'}`,
    input.brandContext ? `Business: ${input.brandContext.slice(0, 500)}` : '',
    `Current rule score: ${input.ruleScore}/100`,
  ].filter(Boolean).join('\n');
  try {
    const out = (await llmFn(SYSTEM, user)) as { delta?: unknown; reason?: unknown };
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
