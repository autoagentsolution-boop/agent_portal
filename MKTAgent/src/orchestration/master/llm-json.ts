// Generic text→JSON Gemini call for orchestration agents (ideation, strategy).
// Distinct from copygen's GeminiFn (which is shaped for the copy-gen request body):
// here an agent just needs "given a system prompt + a user message, return a JSON
// object". Mirrors requirement-analyzer.ts's endpoint + JSON-extraction pattern so
// behaviour is consistent with the intake path. Injectable for DRY-RUN verification.
import { env } from '../../config/env.ts';
import { withRetry } from '../../lib/retry.ts';

import type { GeminiUsage } from '../executor/node-cost.ts';
import { extractGeminiUsage } from '../../cost/llm-usage.ts';

// Optional usage sink: the real call reports REAL token usage (incl. thinking tokens) so the
// caller can record it to the ledger + cost from it. Injected stubs (DRY-RUN) simply ignore it,
// so verification records nothing (no spend) — kept optional to preserve the seam contract.
export type UsageSink = (usage: GeminiUsage) => void;
export type LlmJsonFn = (systemPrompt: string, userText: string, onUsage?: UsageSink) => Promise<unknown>;

const endpoint = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

// Pull the model's text out of the Gemini envelope and JSON.parse it (tolerating a
// ```json fence). Throws on empty/garbage so the calling runner fails the node
// (recoverable) rather than persisting a malformed artifact.
const extractJson = (raw: unknown): unknown => {
  const text =
    (raw as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates?.[0]
      ?.content?.parts?.map((p) => p.text ?? '')
      .join('\n') ?? '';
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  if (!cleaned) throw new Error('llm_json: empty response');
  return JSON.parse(cleaned);
};

// Not annotated `: LlmJsonFn` — the 4th `opts` arg (per-node thinking budget, Phase 06) is beyond that
// 3-arg seam type. It stays structurally assignable to LlmJsonFn (extra optional arg), so runners can still
// do `ctx.llmJsonFn ?? callGeminiJson`, while the executor calls it with the budget explicitly.
export const callGeminiJson = async (
  systemPrompt: string,
  userText: string,
  onUsage?: UsageSink,
  opts?: { thinkingBudget?: number },
): Promise<unknown> => {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
  const res = await withRetry(
    () =>
      fetch(endpoint(env.GEMINI_MODEL), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userText }] }],
          generationConfig: {
            temperature: 0.6,
            responseMimeType: 'application/json',
            // Explicit budget when provided (executor binds it per node); omitted → Gemini default (unchanged
            // for any direct caller that doesn't pass opts).
            ...(opts?.thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget: opts.thinkingBudget } } : {}),
          },
        }),
        signal: AbortSignal.timeout(60_000),
      }),
    { label: 'gemini_orchestration_json' },
  );
  const raw = await res.json();
  if (onUsage) onUsage(extractGeminiUsage(raw)); // report REAL usage before parsing
  return extractJson(raw);
};
