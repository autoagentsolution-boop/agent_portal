// RequirementAnalyzer — free text → GoalSpec. Gemini for reasoning, deterministic
// extractor as fallback (mirrors gemini-intake-provider.ts). The returned GoalSpec
// is always Zod-valid: a malformed LLM response falls back, so the rule planner
// downstream can assume a clean input.
import { env } from '../../config/env.ts';
import { goalSpec, type GoalSpec } from '../schemas/goal-spec.ts';
import { analyzeDeterministic } from './deterministic-analyzer.ts';
import { requirementSystemPrompt } from '../prompts/requirement-prompt.ts';

const endpoint = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

const extractJson = (raw: unknown): unknown => {
  const text = (raw as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    .candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('\n') ?? '';
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  if (!cleaned) return null;
  return JSON.parse(cleaned);
};

export interface RequirementAnalyzer {
  analyze(message: string): Promise<GoalSpec>;
}

export class GeminiRequirementAnalyzer implements RequirementAnalyzer {
  async analyze(message: string): Promise<GoalSpec> {
    if (!env.GEMINI_API_KEY) return analyzeDeterministic(message);
    try {
      const res = await fetch(endpoint(env.GEMINI_MODEL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: requirementSystemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: message }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return analyzeDeterministic(message);
      const parsed = goalSpec.safeParse(extractJson(await res.json()));
      if (!parsed.success) return analyzeDeterministic(message);
      return { ...parsed.data, provider: `gemini:${env.GEMINI_MODEL}` };
    } catch {
      return analyzeDeterministic(message);
    }
  }
}

export const requirementAnalyzer: RequirementAnalyzer = new GeminiRequirementAnalyzer();
