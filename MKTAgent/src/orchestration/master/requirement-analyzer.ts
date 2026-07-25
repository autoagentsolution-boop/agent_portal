// RequirementAnalyzer — free text → GoalSpec. Gemini for reasoning, deterministic
// extractor as fallback (mirrors gemini-intake-provider.ts). The returned GoalSpec
// is always Zod-valid: a malformed LLM response falls back, so the rule planner
// downstream can assume a clean input.
import { env } from '../../config/env.ts';
import { z } from 'zod';
import { goalSpec, type GoalSpec } from '../schemas/goal-spec.ts';
import { analyzeDeterministic, parseRemovals, parsePlatforms, type Removals } from './deterministic-analyzer.ts';
import { requirementSystemPrompt } from '../prompts/requirement-prompt.ts';
import { recordGeminiCall } from '../../cost/llm-usage.ts';

// Language-agnostic recipient extraction — any email address, no locale-specific keyword gate.
const EMAIL_ADDR_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

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

// Renderable video-runtime bounds — MUST match goal-spec's slots.videoLengthSec (.min/.max) and
// deterministic-analyzer's parseVideoLength clamp. A model-declared value outside this range would
// fail goalSpec.safeParse (the field is a hard z.number().min().max()), dropping the whole LLM goal;
// clamp in place so only that one field is corrected. Mutates raw.slots.videoLengthSec when it is a
// finite number; leaves null/absent/non-numeric untouched.
const VIDEO_LENGTH_MIN_SEC = 12;
const VIDEO_LENGTH_MAX_SEC = 120;
const clampVideoLength = (raw: unknown): void => {
  const slots = (raw as { slots?: { videoLengthSec?: unknown } } | null)?.slots;
  const v = slots?.videoLengthSec;
  if (typeof v === 'number' && Number.isFinite(v)) {
    slots!.videoLengthSec = Math.min(VIDEO_LENGTH_MAX_SEC, Math.max(VIDEO_LENGTH_MIN_SEC, Math.round(v)));
  }
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
      // videoLengthSec is model-declared now (the prompt asks for it), but the schema hard-bounds it to
      // 12–120 and REJECTS out-of-range — a model that answers 5 or 600 would fail the whole safeParse and
      // silently drop the entire LLM goal to the deterministic fallback. Clamp it into range BEFORE parsing
      // (mirrors deterministic-analyzer's parseVideoLength clamp) so a model over/undershoot degrades one
      // field gracefully instead of discarding a good extraction. Only touches a present numeric value.
      clampVideoLength(raw);
      const parsed = goalSpec.safeParse(raw);
      if (!parsed.success) return fallback();
      // Removals are LLM-AUTHORITATIVE (Phase 2 of the regex→LLM migration). The model reads the whole
      // sentence — it distinguishes a real removal ("bỏ video") from a removal VERB that modifies something
      // else ("publish WITHOUT review" = keep publishing) and from nested negation ("don't publish to FB but
      // post to IG"), which a regex fundamentally cannot. So the model's declared `removals` WIN whenever the
      // model produced a valid `removals` object at all. `parseRemovals(message)` is now a FALLBACK ONLY —
      // used when the model omitted the field entirely (older prompt / malformed output), never UNIONed on
      // top (the union re-introduced the false-positives it was meant to fix: it dropped `publishing` +
      // `facebook` from "publish automatically without review"). Baseline evidence: over the adversarial
      // corpus the model's raw removals matched intent on every case; the union was what corrupted them.
      const rawRemovals = (raw as { removals?: unknown })?.removals;
      const llmRemovals = removalsSchema.safeParse(rawRemovals);
      const removals = rawRemovals != null && llmRemovals.success ? llmRemovals.data : parseRemovals(message);
      // LLM-authoritative goal (same philosophy as contentLanguageFor): the model read the message and
      // its extraction WINS; the deterministic parser is only a FALLBACK for the fields the model left
      // empty/default, never an override that second-guesses a value the model actually declared. This is
      // what the analyzer's regex "corrections" used to be — they also leaked language-specific misses
      // (the EN/VI email keywords dropped a Korean/Thai send). `analyzeDeterministic` still owns the
      // no-LLM path above.
      // platforms: a platform NAME ("Facebook", "Instagram") is an unambiguous FACTUAL token, not an
      // intent the model has to classify — and the model demonstrably drops one from a multi-platform
      // request ("Facebook e Instagram" → only instagram). So UNION the deterministic parse (same category
      // as the language-agnostic @ recipient below: extract a fact, don't second-guess intent). This is the
      // one regex-corroboration kept; the intent-classification overrides (scope/autoPublish/quality/
      // email-routing) are gone — those the model owns.
      // BUT the union must not resurrect a platform the model INTENTIONALLY excluded: "don't publish to
      // Facebook, but post to Instagram" → the model correctly declares platforms [instagram] +
      // dropPlatforms [facebook]. A blind parsePlatforms(message) sees the word "Facebook" and pulls it
      // back, corrupting a correct intent classification (the FACT union overriding an INTENT decision —
      // the exact anti-pattern this migration removes). So subtract the model's dropPlatforms from the
      // union: recover a DROPPED platform the model forgot to mention, never one it deliberately removed.
      const dropped = new Set<string>(removals.dropPlatforms);
      const platforms = Array.from(new Set([...parsed.data.platforms, ...parsePlatforms(message)]))
        .filter((p) => !dropped.has(p)) as GoalSpec['platforms'];
      // Recipient is a language-agnostic @ address (any language); ROUTING email-vs-marketing is the
      // brain's `kind` declaration downstream (propose_workflow), never a regex keyword guess. The email
      // angle/subject the model already extracted stay as-is.
      const addr = (message.match(EMAIL_ADDR_RE) ?? [])[0] ?? null;
      const base = { ...parsed.data, platforms, provider: `gemini:${env.GEMINI_MODEL}` };
      const goal = { ...base, slots: { ...base.slots, emailTo: base.slots.emailTo ?? addr } };
      return { goal, removals };
    } catch {
      return fallback();
    }
  }
}

export const requirementAnalyzer: RequirementAnalyzer = new GeminiRequirementAnalyzer();
