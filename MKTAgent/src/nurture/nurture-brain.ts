// Nurture brain (Phase 03) — reads ONE lead's latest reply and returns a NurtureDecision. Mirrors
// orchestration/atria/atria-brain.ts's Gemini function-calling LOOP shape, scoped way down: no web
// search / workspace data / multi-turn planning, just classify → finalize. Two fail-closed layers on
// top of the model's own tool call:
//   1. A DETERMINISTIC opt-out fast path — an unsubscribe/stop/not-interested reply never even reaches
//      the LLM (HARD invariant: bounded spend + opt-out is guaranteed correct, not "probably correct").
//   2. Post-decision guardrails on a draft_reply — a mechanical price/commitment check and a confidence
//      floor override the model's own tool call to `escalate` when either trips. The brain NEVER sends;
//      every draft_reply still lands on the human-approval gate downstream, but these guardrails are the
//      difference between "the model was told not to hallucinate" and "the system can't ship a
//      hallucinated commitment even if the model ignores the prompt."
// On ANY failure (no API key, network/deadline, malformed output) the brain returns `escalate` — NEVER
// a draft and NEVER a silent no-op. `callFn` is injectable so verify-nurture-brain.ts runs deterministic
// and DRY (a fixture "LLM" that returns canned function calls, zero real Gemini spend).
import { env } from '../config/env.ts';
import { recordGeminiCall } from '../cost/llm-usage.ts';
import { logger } from '../lib/logger.ts';
import { BRAIN_THINKING_BUDGET } from '../orchestration/thinking-budget.ts';
import { TOOL_DECLARATIONS, dispatchNurtureTool, type NurtureToolContext } from './nurture-tools.ts';
import { NURTURE_BRAIN_SYSTEM_PROMPT, buildNurtureTurnText, isLowConfidence, isUnclearIntent, type NurtureBrainPromptInput } from './nurture-brain-prompt.ts';
import { nurtureDecision, escalateDecision, type NurtureDecision } from './decision-schema.ts';

export interface NurtureBrainInput extends NurtureBrainPromptInput {
  ownerId: string;
}

interface GeminiContent { role: 'user' | 'model'; parts: unknown[] }
interface Part { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }

// The raw Gemini call — injectable so verification never spends. Returns the raw response envelope;
// parsing/extraction stays in this file (mirrors atria-brain's doCall/partsOf split).
export type RawGeminiCallFn = (contents: GeminiContent[]) => Promise<unknown>;

const MAX_ROUNDS = 3;
const TURN_BUDGET_MS = 20_000;
const CALL_TIMEOUT_MS = 15_000;
const CONFIDENCE_FLOOR = 0.55;

// Deterministic, zero-spend opt-out detection — checked BEFORE the LLM is ever called. Intentionally
// broad-but-bounded phrasing per the plan's named triggers ("stop", "unsubscribe", "not interested").
// A false-positive pause is low-harm (Phase 04's inbox can resume it); a missed opt-out is not
// acceptable, so this errs toward catching it.
const OPT_OUT_RE = /\b(unsubscribe|opt[\s-]?out|take\s+me\s+off|remove\s+me\s+from|please\s+stop|stop\s+email|no\s+longer\s+interested|not\s+interested|don'?t\s+contact\s+me)\b/i;

// Mechanical hallucination guard: every price/currency FIGURE stated in a draft must appear verbatim
// (whitespace-insensitive) in the PRODUCT KNOWLEDGE grounding — not merely "some price exists somewhere
// in the grounding text" (too coarse: that would let a fabricated $50 through just because a genuine
// $99 plan is on file elsewhere). No grounding at all, or any figure not found in it, forces escalate.
const PRICE_RE = /[$₫€£]\s?\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s?(?:usd|vnd|dollars?|đồng)/gi;
const normalizeForMatch = (text: string): string => text.replace(/\s+/g, '').toLowerCase();
const extractPriceFigures = (text: string): string[] => (text.match(PRICE_RE) ?? []).map(normalizeForMatch);

const endpoint = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

const partsOf = (raw: unknown): Part[] =>
  ((raw as { candidates?: Array<{ content?: { parts?: Part[] } }> }).candidates?.[0]?.content?.parts ?? []);

const realCall: RawGeminiCallFn = async (contents) => {
  const res = await fetch(endpoint(env.GEMINI_MODEL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: NURTURE_BRAIN_SYSTEM_PROMPT }] },
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      generationConfig: { temperature: 0.4, thinkingConfig: { thinkingBudget: BRAIN_THINKING_BUDGET } },
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`gemini_${res.status}`);
  return res.json();
};

// Post-decision guardrails. Returns the ORIGINAL decision unchanged unless a fail-closed rule trips, in
// which case it returns a fresh `escalate` decision carrying the original intent/confidence for audit.
const applyGuardrails = (decision: NurtureDecision, productKnowledge: string | null): NurtureDecision => {
  if (decision.action !== 'draft_reply') return decision;
  if (isUnclearIntent(decision.intent) || isLowConfidence(decision.confidence, CONFIDENCE_FLOOR)) {
    return escalateDecision('low_confidence_classification', decision.intent, decision.confidence);
  }
  const draftPrices = decision.draft ? extractPriceFigures(`${decision.draft.subject} ${decision.draft.body}`) : [];
  if (draftPrices.length) {
    const groundingNorm = normalizeForMatch(productKnowledge ?? '');
    const allVerified = draftPrices.every((p) => groundingNorm.includes(p));
    if (!allVerified) return escalateDecision('unverifiable_pricing_claim', decision.intent, decision.confidence);
  }
  return decision;
};

// Run the loop for ONE reply. Never throws — every exit path is a valid NurtureDecision, defaulting to
// escalate on anything short of a clean draft_reply/set_state.
export async function runNurtureBrain(input: NurtureBrainInput, callFn: RawGeminiCallFn = realCall): Promise<NurtureDecision> {
  // Layer 1 — deterministic opt-out fast path (zero LLM spend, guaranteed correct on the named phrases).
  if (OPT_OUT_RE.test(input.latestReply.body)) {
    return nurtureDecision.parse({ action: 'mark_opted_out', intent: 'opt_out', confidence: 1, draft: null, reason: 'matched opt-out phrasing' });
  }
  // The API-key gate + usage ledger only apply to the REAL endpoint — an injected callFn (verification)
  // never spends and must never depend on a configured key, so it's identified by reference and exempted
  // from both (mirrors every other injectable-LLM seam in this codebase: a stub means zero real spend).
  const usingRealCall = callFn === realCall;
  if (usingRealCall && !env.GEMINI_API_KEY) return escalateDecision('no_llm_configured');

  const ctx: NurtureToolContext = { ownerId: input.ownerId, classification: null, decision: null };
  const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: buildNurtureTurnText(input) }] }];
  const deadline = Date.now() + TURN_BUDGET_MS;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (Date.now() > deadline) break;
      const raw = await callFn(contents);
      if (usingRealCall) await recordGeminiCall(raw, { ownerId: input.ownerId, surface: 'nurture', model: env.GEMINI_MODEL }).catch(() => {});
      const parts = partsOf(raw);
      const calls = parts.filter((p) => p.functionCall) as Array<{ functionCall: { name: string; args?: Record<string, unknown> } }>;
      if (!calls.length) break; // no tool call and no decision yet — nothing more to do this turn

      contents.push({ role: 'model', parts: calls.map((c) => ({ functionCall: c.functionCall })) });
      const responses = calls.map((c) => ({
        functionResponse: { name: c.functionCall.name, response: { result: dispatchNurtureTool(c.functionCall.name, c.functionCall.args ?? {}, ctx) } },
      }));
      contents.push({ role: 'user', parts: responses });

      if (ctx.decision) return applyGuardrails(ctx.decision, input.productKnowledge);
    }
  } catch (e) {
    logger.warn('nurture_brain_exception', { ownerId: input.ownerId, error: e instanceof Error ? e.message : String(e) });
  }
  // Ran out of rounds/budget, or the loop exited without a finalizing tool call — fail closed.
  return ctx.decision ? applyGuardrails(ctx.decision, input.productKnowledge) : escalateDecision('brain_no_decision');
}
