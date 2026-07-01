// SaveOfferAuthor — voices the "flow saved, what next?" turn (P6). After a planned
// flow is named/saved, the Master Agent stops being a planner and becomes a guide: it
// offers to (a) set up the first campaign and (b) run a test post, or just open the
// flow. Same resilience contract as conversation-author.ts: Gemini for voice, a
// deterministic fallback so it works with no key, AbortSignal.timeout, NEVER throws.
// The actual buttons/actions live in the web SaveOfferCard — this only writes the prose
// that precedes them, in the user's language.
import { env } from '../../config/env.ts';
import { languageName } from './detect-language.ts';

const SYSTEM_PROMPT = `You are AgentPortal's Master Agent — a marketing orchestration assistant.
The user just SAVED a marketing workflow (a "flow"). Your job now is to guide them into
using it, warmly and concisely (ChatGPT/Claude voice, never robotic).

Write ONE short message (2-4 sentences, no markdown headers, no JSON, no bullet list):
- Confirm the flow is saved (use its name if given).
- Offer two concrete next steps in prose: (1) set up the first campaign to begin the
  strategy, (2) run a test post to see the system work end to end (nothing publishes
  without their approval). Mention they can also just open the flow to explore it.
- Do NOT restate slot names or raw JSON. Do NOT claim anything was published.

LANGUAGE (critical): if the context carries "replyLanguage", write your ENTIRE reply in
that language; otherwise mirror the language of the flow name / product. Never default to
English when the user worked in another language.`;

interface OfferContext {
  flowName: string | null;
  product: string | null;
  language: string | null;
}

const endpoint = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

const extractText = (raw: unknown): string =>
  (raw as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    .candidates?.[0]?.content?.parts?.map((p) => p.text ?? '')
    .join('')
    .trim() ?? '';

// Plain-language fallback — no LLM. Keeps the surface usable (and verify deterministic)
// when GEMINI_API_KEY is absent. English-only by design (the fallback for any degraded
// path); the LLM path handles other languages.
export const deterministicOffer = (ctx: OfferContext): string => {
  const label = ctx.flowName?.trim() || ctx.product?.trim();
  const lead = label ? `Your flow “${label}” is saved.` : `Your flow is saved.`;
  return `${lead} Want to set up the first campaign to start the strategy, or run a test post to see it work end to end? Nothing publishes until you approve — or just open the flow to explore it.`;
};

export interface SaveOfferAuthor {
  author(ctx: OfferContext): Promise<string>;
}

export class GeminiSaveOfferAuthor implements SaveOfferAuthor {
  async author(ctx: OfferContext): Promise<string> {
    const fallback = deterministicOffer(ctx);
    if (!env.GEMINI_API_KEY) return fallback;
    const replyLanguage = languageName(ctx.language);
    const langLine = replyLanguage
      ? `Write your entire reply in ${replyLanguage}.`
      : `Mirror the language of the flow name / product below; do not default to English.`;
    try {
      const res = await fetch(endpoint(env.GEMINI_MODEL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{
            role: 'user',
            parts: [{ text: `${langLine}\n\nContext:\n${JSON.stringify({ ...ctx, replyLanguage: replyLanguage ?? undefined })}` }],
          }],
          generationConfig: { temperature: 0.5 },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return fallback;
      const text = extractText(await res.json());
      return text.length >= 2 ? text : fallback;
    } catch {
      return fallback;
    }
  }
}

export const saveOfferAuthor: SaveOfferAuthor = new GeminiSaveOfferAuthor();
