// ConversationAuthor — turns a MasterAgentOutcome into a natural, human-facing
// assistant message (the layer the old Master Agent had and M1 lacked). Mirrors
// gemini-intake-provider.ts: Gemini for voice, a deterministic fallback so it works
// with no key, AbortSignal.timeout, never throws (a bad LLM call degrades to the
// fallback sentence rather than failing the run). It does NOT decide questions or
// plan the DAG — those are already computed; this only voices the outcome.
import { env } from '../../config/env.ts';
import { conversationSystemPrompt } from '../prompts/conversation-prompt.ts';
import { languageName, type ReplyLanguage } from './detect-language.ts';
import type { MasterAgentOutcome } from './master-agent.ts';

export interface PriorMessage {
  role: 'user' | 'agent';
  content: string;
}

// The language the reply MUST be written in (caller detects it from the user's raw
// message; the explicit goal.slots.language wins when present). Threaded all the way
// to the prompt so the model never infers language from the mixed-language seed
// strings in the clarification questions (the bug behind an EN user getting a VN reply).
export interface AuthorOptions {
  language?: ReplyLanguage | string | null;
}

const endpoint = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

const extractText = (raw: unknown): string =>
  (raw as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    .candidates?.[0]?.content?.parts?.map((p) => p.text ?? '')
    .join('')
    .trim() ?? '';

// Resolve the authoritative reply language: an explicit analyzer-detected
// goal.slots.language wins; otherwise the caller-detected language; else English.
const resolveLanguage = (outcome: MasterAgentOutcome, opts: AuthorOptions): string =>
  languageName(outcome.goal.slots.language ?? opts.language ?? 'en');

// Compact, model-agnostic context describing the turn. Slot names + flags only —
// the prompt forbids restating them verbatim, so this stays a hint, not the output.
// `replyLanguage` is authoritative: the model writes EVERYTHING (including translating
// each clarification question) in it, regardless of the question seeds' own language.
const outcomeContext = (outcome: MasterAgentOutcome, replyLanguage: string): unknown => {
  const goal = {
    product: outcome.goal.slots.product ?? null,
    productDetails: outcome.goal.slots.productDetails ?? null,
    accountType: outcome.goal.slots.accountType ?? null,
    targetAudience: outcome.goal.slots.targetAudience ?? null,
    angle: outcome.goal.slots.angle ?? null,
    platforms: outcome.goal.platforms,
    outputs: outcome.goal.outputs,
  };
  if (outcome.status === 'awaiting_clarification') {
    return { replyLanguage, status: outcome.status, goal, questions: outcome.questions.map((q) => ({ slot: q.slot, question: q.question, required: q.required })) };
  }
  if (outcome.status === 'planned') {
    const agents = outcome.plan.nodes.map((n) => n.agentId);
    return { replyLanguage, status: outcome.status, goal, plan: { agents, nodeCount: outcome.plan.nodes.length, platforms: outcome.goal.platforms } };
  }
  return { replyLanguage, status: outcome.status, goal, error: outcome.error, detail: outcome.detail };
};

// Plain-language fallback composed from the structured outcome — no LLM. Keeps the
// surface usable (and verify deterministic) when GEMINI_API_KEY is absent.
export const deterministicReply = (outcome: MasterAgentOutcome): string => {
  const product = outcome.goal.slots.product?.trim();
  if (outcome.status === 'awaiting_clarification') {
    const lead = product
      ? `Got it — a marketing flow for ${product}.`
      : `Happy to help with this.`;
    const asks = outcome.questions.map((q) => q.question);
    const tail = asks.length
      ? ` To plan the right workflow I need a bit more: ${asks.join(' ')}`
      : ` Tell me a little more so I can plan the right steps.`;
    return lead + tail;
  }
  if (outcome.status === 'planned') {
    const agents = outcome.plan.nodes.map((n) => n.agentId.replace(/_/g, ' '));
    const platforms = outcome.goal.platforms.length ? outcome.goal.platforms.join(', ') : 'Facebook';
    return `Here's the plan${product ? ` for ${product}` : ''}: I'll run ${agents.join(' → ')} across ${outcome.plan.nodes.length} step(s), publishing to ${platforms}. Nothing is published until you approve — review the workflow below and hit approve to start.`;
  }
  return `I couldn't finalize a plan: ${outcome.error}. Add the missing detail and I'll try again.`;
};

export interface ConversationAuthor {
  author(outcome: MasterAgentOutcome, prior?: PriorMessage[], opts?: AuthorOptions): Promise<string>;
}

export class GeminiConversationAuthor implements ConversationAuthor {
  async author(outcome: MasterAgentOutcome, prior: PriorMessage[] = [], opts: AuthorOptions = {}): Promise<string> {
    const fallback = deterministicReply(outcome);
    if (!env.GEMINI_API_KEY) return fallback;
    const replyLanguage = resolveLanguage(outcome, opts);
    try {
      const history = prior.slice(-6).map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
      const res = await fetch(endpoint(env.GEMINI_MODEL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: conversationSystemPrompt }] },
          contents: [
            ...history,
            {
              role: 'user',
              parts: [{
                // Hard language directive FIRST so it dominates any language cue the
                // (mixed-language) question seeds carry, then the structured context.
                text: `Write your entire reply in ${replyLanguage}. Translate every clarification question into ${replyLanguage} — do not copy a question's original wording if it is in another language.\n\nTurn context:\n${JSON.stringify(outcomeContext(outcome, replyLanguage))}`,
              }],
            },
          ],
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

export const conversationAuthor: ConversationAuthor = new GeminiConversationAuthor();
