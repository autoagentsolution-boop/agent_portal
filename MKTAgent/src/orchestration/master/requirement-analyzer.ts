// RequirementAnalyzer — free text → GoalSpec. Gemini for reasoning, deterministic
// extractor as fallback (mirrors gemini-intake-provider.ts). The returned GoalSpec
// is always Zod-valid: a malformed LLM response falls back, so the rule planner
// downstream can assume a clean input.
import { env } from '../../config/env.ts';
import { z } from 'zod';
import { goalSpec, type GoalSpec } from '../schemas/goal-spec.ts';
import { analyzeDeterministic, parseRemovals, parsePlatforms, parseEmailIntent, emailOutputs, type Removals } from './deterministic-analyzer.ts';
import { requirementSystemPrompt } from '../prompts/requirement-prompt.ts';
import { recordGeminiCall } from '../../cost/llm-usage.ts';

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
  // ownerId (optional): the authenticated tenant, threaded so a REAL Gemini call bills the
  // usage ledger to the right owner (surface 'intake'). Missing/null records a system row.
  // memoryContext (P3): recalled durable facts about this user, injected so known product/
  // brand/audience pre-fill the goal instead of being re-asked.
  // instructionsContext (P4): the user's workspace Instructions block, injected so proposed
  // pillars/angle/tone honor them — not just the downstream content agents.
  analyze(message: string, ownerId?: string | null, memoryContext?: string | null, instructionsContext?: string | null): Promise<GoalSpec>;
  // Refinement variant: also surfaces removal intent (subtractive edits) so the
  // refine path can un-set outputs/platforms. `handle` (fresh goal) ignores removals.
  // `prior` (the goal gathered so far) gives the model conversation context so a short
  // reply ("đi làm với đồng nghiệp", "for everyone") maps to the RIGHT slot instead of
  // extracting nothing — the fix for the never-ending clarification loop.
  analyzeWithRemovals(message: string, prior?: GoalSpec, ownerId?: string | null, memoryContext?: string | null, instructionsContext?: string | null): Promise<AnalysisWithRemovals>;
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
  async analyze(message: string, ownerId?: string | null, memoryContext?: string | null, instructionsContext?: string | null): Promise<GoalSpec> {
    return (await this.analyzeWithRemovals(message, undefined, ownerId, memoryContext, instructionsContext)).goal;
  }

  async analyzeWithRemovals(message: string, prior?: GoalSpec, ownerId?: string | null, memoryContext?: string | null, instructionsContext?: string | null): Promise<AnalysisWithRemovals> {
    const fallback = (): AnalysisWithRemovals => ({
      // Even the deterministic fallback keeps prior context: merge is additive downstream,
      // but seed the message's platforms so nothing is lost when the LLM is unavailable.
      goal: analyzeDeterministic(message),
      removals: parseRemovals(message),
    });
    if (!env.GEMINI_API_KEY) return fallback();
    try {
      // User Instructions (P4) lead the prompt so proposed pillars/angle/tone honor the user's
      // configured steer. Recalled memory (P3) follows so known product/brand/audience pre-fill
      // instead of being re-asked. Both empty → behavior unchanged for a brand-new user.
      const instructionsBlock = instructionsContext?.trim() ? `${instructionsContext.trim()}\n\n` : '';
      const memoryBlock = memoryContext?.trim() ? `${memoryContext.trim()}\n\n` : '';
      // On a refinement turn, hand the model the known goal + the new reply, and tell it to
      // return the UPDATED goal (map a topic→product, an audience→targetAudience, etc.).
      const userText = prior
        ? `${instructionsBlock}${memoryBlock}Known goal so far (JSON): ${JSON.stringify(priorContext(prior))}\n\nThe user just replied: "${message}"\n\nThis reply is usually a short answer to a clarification. Return the UPDATED full goal: carry over every field already known and fill the ones this reply provides. Map a topic/subject → "product" (for a personal life/experience post the topic IS the product), an audience → "targetAudience", a tone/style → "brandVoice", a specific message → "angle". Never blank out a field that is already known.`
        : `${instructionsBlock}${memoryBlock}${message}`;
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
      const rawJson = await res.json();
      // Ledger the REAL physical call (intake surface) before parsing — the call happened
      // (and billed) regardless of whether the JSON turns out parseable. Best-effort, never throws.
      await recordGeminiCall(rawJson, { ownerId: ownerId ?? null, surface: 'intake', model: env.GEMINI_MODEL });
      const raw = extractJson(rawJson);
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
      // Campaign scope (Phase 03) is likewise a regex-detectable intent ("plan a month of content",
      // "3 posts a week"). The LLM defaults it to `single` silently, so when it did NOT escalate but
      // the deterministic parser detects a multi-post intent, adopt that scope + duration/cadence.
      const det = analyzeDeterministic(message);
      const campaign = parsed.data.campaignScope === 'single' && det.campaignScope !== 'single'
        ? { campaignScope: det.campaignScope, duration: det.duration, cadence: det.cadence }
        : {};
      // Auto-publish is a regex-detectable command ("đăng luôn", "auto-publish") the LLM may miss;
      // OR the two so an explicit hands-off ask is never lost. Default stays false (gated).
      const autoPublish = parsed.data.autoPublish || det.autoPublish;
      // qualityPref (Phase 06): the marketing LLM prompt doesn't model it, so its value is the Zod default
      // ('standard'). Adopt the deterministic keyword detection when the message states a preference — same
      // "regex-detectable intent the LLM may miss" pattern as autoPublish/campaign above.
      const qualityPref = parsed.data.qualityPref !== 'standard' ? parsed.data.qualityPref : det.qualityPref;
      const base = { ...parsed.data, platforms, ...campaign, autoPublish, qualityPref, provider: `gemini:${env.GEMINI_MODEL}` };
      // Email intent (P4-lite) is a regex-detectable command ("gửi email cho…") the marketing-only
      // LLM prompt doesn't model — OR it in so an email goal routes to the email path, not a social
      // post. Forces the social flags off + recipient/subject into the email slots.
      const email = parseEmailIntent(message);
      const goal = email.isEmail
        ? { ...base, outputs: emailOutputs(base.outputs), platforms: [] as GoalSpec['platforms'], campaignScope: 'single' as const, duration: null, cadence: null,
            // Email angle = what the email should SAY. Prefer the raw purpose (retains the recipient's
            // name + occasion, e.g. "birthday note for Nghiep") over the LLM's marketing-cleaned angle,
            // which strips the name → the writer would otherwise fabricate one from the @-local-part.
            slots: { ...base.slots, angle: email.purpose ?? base.slots.angle ?? null, emailTo: base.slots.emailTo ?? email.to ?? null, emailSubject: base.slots.emailSubject ?? email.subject ?? null } }
        : base;
      return { goal, removals };
    } catch {
      return fallback();
    }
  }
}

export const requirementAnalyzer: RequirementAnalyzer = new GeminiRequirementAnalyzer();
