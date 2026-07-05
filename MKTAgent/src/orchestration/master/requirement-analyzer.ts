// RequirementAnalyzer — free text → GoalSpec. Gemini for reasoning, deterministic
// extractor as fallback (mirrors gemini-intake-provider.ts). The returned GoalSpec
// is always Zod-valid: a malformed LLM response falls back, so the rule planner
// downstream can assume a clean input.
import { env } from '../../config/env.ts';
import { z } from 'zod';
import { goalSpec, type GoalSpec } from '../schemas/goal-spec.ts';
import { analyzeDeterministic, parseRemovals, parsePlatforms, type Removals } from './deterministic-analyzer.ts';
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
  // `prior` (the goal gathered so far) gives the model conversation context so a short
  // reply ("đi làm với đồng nghiệp", "for everyone") maps to the RIGHT slot instead of
  // extracting nothing — the fix for the never-ending clarification loop.
  analyzeWithRemovals(message: string, prior?: GoalSpec): Promise<AnalysisWithRemovals>;
}

// Compact prior goal for the context prompt — only the fields the analyzer fills.
const priorContext = (g: GoalSpec): unknown => ({
  product: g.slots.product ?? null,
  productDetails: g.slots.productDetails ?? null,
  accountType: g.slots.accountType ?? null,
  targetAudience: g.slots.targetAudience ?? null,
  angle: g.slots.angle ?? null,
  brandVoice: g.slots.brandVoice ?? null,
  language: g.slots.language ?? null,
  platforms: g.platforms,
  outputs: g.outputs,
});

export class GeminiRequirementAnalyzer implements RequirementAnalyzer {
  async analyze(message: string): Promise<GoalSpec> {
    return (await this.analyzeWithRemovals(message)).goal;
  }

  async analyzeWithRemovals(message: string, prior?: GoalSpec): Promise<AnalysisWithRemovals> {
    const fallback = (): AnalysisWithRemovals => ({
      // Even the deterministic fallback keeps prior context: merge is additive downstream,
      // but seed the message's platforms so nothing is lost when the LLM is unavailable.
      goal: analyzeDeterministic(message),
      removals: parseRemovals(message),
    });
    if (!env.GEMINI_API_KEY) return fallback();
    try {
      // On a refinement turn, hand the model the known goal + the new reply, and tell it to
      // return the UPDATED goal (map a topic→product, an audience→targetAudience, etc.).
      const userText = prior
        ? `Known goal so far (JSON): ${JSON.stringify(priorContext(prior))}\n\nThe user just replied: "${message}"\n\nThis reply is usually a short answer to a clarification. Return the UPDATED full goal: carry over every field already known and fill the ones this reply provides. Map a topic/subject → "product" (for a personal life/experience post the topic IS the product), an audience → "targetAudience", a tone/style → "brandVoice", a specific message → "angle". Never blank out a field that is already known.`
        : message;
      const res = await fetch(endpoint(env.GEMINI_MODEL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: requirementSystemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userText }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return fallback();
      const raw = extractJson(await res.json());
      const parsed = goalSpec.safeParse(raw);
      if (!parsed.success) return fallback();
      // Removals are optional in the LLM output; fall back to the regex parser when the
      // model omits them (so a deterministic removal phrase still works even via Gemini).
      const llmRemovals = removalsSchema.safeParse((raw as { removals?: unknown })?.removals);
      const removals = llmRemovals.success && (llmRemovals.data.disableOutputs.length || llmRemovals.data.dropPlatforms.length)
        ? llmRemovals.data
        : parseRemovals(message);
      // Platforms are regex-detectable facts — union the deterministic parse so a platform
      // named in the message is never lost to an LLM miss ("asked fb+linkedin, only fb stuck").
      const platforms = Array.from(new Set([...parsed.data.platforms, ...parsePlatforms(message)])) as GoalSpec['platforms'];
      return { goal: { ...parsed.data, platforms, provider: `gemini:${env.GEMINI_MODEL}` }, removals };
    } catch {
      return fallback();
    }
  }
}

export const requirementAnalyzer: RequirementAnalyzer = new GeminiRequirementAnalyzer();
