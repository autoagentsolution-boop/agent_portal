// RequirementAnalyzer — free text → GoalSpec. Gemini for reasoning, deterministic
// extractor as fallback (mirrors gemini-intake-provider.ts). The returned GoalSpec
// is always Zod-valid: a malformed LLM response falls back, so the rule planner
// downstream can assume a clean input.
import { env } from '../../config/env.ts';
import { z } from 'zod';
import { goalSpec, type GoalSpec } from '../schemas/goal-spec.ts';
import { analyzeDeterministic, parseRemovals, type Removals } from './deterministic-analyzer.ts';
import { requirementSystemPrompt } from '../prompts/requirement-prompt.ts';

// Optional removal delta the LLM may emit on a refinement turn (subtractive intent).
const removalsSchema = z.object({
  disableOutputs: z.array(z.enum(['ideation', 'strategy', 'research', 'infographic', 'storyboard', 'video', 'publishing'])).default([]),
  dropPlatforms: z.array(z.enum(['facebook', 'instagram', 'threads', 'linkedin', 'x'])).default([]),
});

const endpoint = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

const extractJson = (raw: unknown): unknown => {
  const text = (raw as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    .candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('\n') ?? '';
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  if (!cleaned) return null;
  return JSON.parse(cleaned);
};

export interface AnalysisWithRemovals {
  goal: GoalSpec;
  removals: Removals;
}

export interface RequirementAnalyzer {
  analyze(message: string): Promise<GoalSpec>;
  // Refinement variant: also surfaces removal intent (subtractive edits) so the
  // refine path can un-set outputs/platforms. `handle` (fresh goal) ignores removals.
  analyzeWithRemovals(message: string): Promise<AnalysisWithRemovals>;
}

export class GeminiRequirementAnalyzer implements RequirementAnalyzer {
  async analyze(message: string): Promise<GoalSpec> {
    return (await this.analyzeWithRemovals(message)).goal;
  }

  async analyzeWithRemovals(message: string): Promise<AnalysisWithRemovals> {
    if (!env.GEMINI_API_KEY) {
      return { goal: analyzeDeterministic(message), removals: parseRemovals(message) };
    }
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
      if (!res.ok) return { goal: analyzeDeterministic(message), removals: parseRemovals(message) };
      const raw = extractJson(await res.json());
      const parsed = goalSpec.safeParse(raw);
      if (!parsed.success) return { goal: analyzeDeterministic(message), removals: parseRemovals(message) };
      // Removals are optional in the LLM output; fall back to the regex parser when the
      // model omits them (so a deterministic removal phrase still works even via Gemini).
      const llmRemovals = removalsSchema.safeParse((raw as { removals?: unknown })?.removals);
      const removals = llmRemovals.success && (llmRemovals.data.disableOutputs.length || llmRemovals.data.dropPlatforms.length)
        ? llmRemovals.data
        : parseRemovals(message);
      return { goal: { ...parsed.data, provider: `gemini:${env.GEMINI_MODEL}` }, removals };
    } catch {
      return { goal: analyzeDeterministic(message), removals: parseRemovals(message) };
    }
  }
}

export const requirementAnalyzer: RequirementAnalyzer = new GeminiRequirementAnalyzer();
