// ConversationAuthor — turns a MasterAgentOutcome into a natural, human-facing
// assistant message (the layer the old Master Agent had and M1 lacked). Mirrors
// gemini-intake-provider.ts: Gemini for voice, a deterministic fallback so it works
// with no key, AbortSignal.timeout, never throws (a bad LLM call degrades to the
// fallback sentence rather than failing the run). It does NOT decide questions or
// plan the DAG — those are already computed; this only voices the outcome.
import { env } from '../../config/env.ts';
import { conversationSystemPrompt } from '../prompts/conversation-prompt.ts';
import { languageName } from './detect-language.ts';
import type { MasterAgentOutcome } from './master-agent.ts';
import { recordGeminiCall } from '../../cost/llm-usage.ts';
import { formatWorkspaceReport, type WorkspaceReport } from '../atria/workspace-report.ts';

export interface PriorMessage {
  role: 'user' | 'agent';
  content: string;
}

// Language steering for the reply. The AUTHORITATIVE signal is `userMessage` — the
// model reads it and mirrors its language (works for ANY language, including Latin-
// script ones a code can't disambiguate). `language` is an optional code hint (an
// explicit analyzer goal.slots.language, or a script-detected one) that pins the
// language when the writing system is unambiguous. Both exist so the model never has
// to infer language from the mixed-language clarification question seeds.
export interface AuthorOptions {
  userMessage?: string | null;
  language?: string | null;
  // The authenticated tenant for this turn, so the real Gemini call can be billed to the
  // right owner in the usage ledger. Optional — a missing value records a system-owned row
  // (recordGeminiCall/recordLlmUsage accept null) rather than skipping the record.
  ownerId?: string | null;
  // Campaign-scope turns only: the "what already exists" snapshot. The reply opens with a
  // short report of these campaigns/posts before presenting the new plan + approval ask.
  workspaceReport?: WorkspaceReport | null;
}

const endpoint = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

const extractText = (raw: unknown): string =>
  (raw as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    .candidates?.[0]?.content?.parts?.map((p) => p.text ?? '')
    .join('')
    .trim() ?? '';

// Resolve a language NAME hint, or null when we can't confidently name one (Latin-script message → the
// model mirrors the user's actual message + prior history). We follow the CURRENT message's detected
// language and deliberately do NOT use the persisted goal.slots.language: a stale 'vi' (from an earlier
// turn or recalled memory) was overriding an English message and flipping Atria's plan reply to
// Vietnamese even though the user just wrote in English. Mirroring the message keeps reply + proposal
// turns in the same language.
const resolveLanguage = (_outcome: MasterAgentOutcome, opts: AuthorOptions): string | null =>
  languageName(opts.language ?? null);

// Compact, model-agnostic context describing the turn. Slot names + flags only —
// the prompt forbids restating them verbatim, so this stays a hint, not the output.
// `replyLanguage` (when known) pins the output language; when null the model mirrors
// the user's message. Either way it translates every clarification question seed.
const outcomeContext = (outcome: MasterAgentOutcome, replyLanguage: string | null, report?: WorkspaceReport | null): unknown => {
  const goal = {
    product: outcome.goal.slots.product ?? null,
    productDetails: outcome.goal.slots.productDetails ?? null,
    accountType: outcome.goal.slots.accountType ?? null,
    targetAudience: outcome.goal.slots.targetAudience ?? null,
    angle: outcome.goal.slots.angle ?? null,
    platforms: outcome.goal.platforms,
    outputs: outcome.goal.outputs,
    // Campaign framing so the model can voice "a 4-week, 3 posts/week campaign plan".
    campaignScope: outcome.goal.campaignScope,
    durationWeeks: outcome.goal.duration?.weeks ?? null,
    postsPerWeek: outcome.goal.cadence?.postsPerWeek ?? null,
  };
  const lang = replyLanguage ? { replyLanguage } : {};
  const workspace = report ? { workspaceReport: report } : {};
  // Schedule confirm seam: when the goal carries a parsed-but-unconfirmed time, the reply MUST read the
  // exact instant back and ask the user to confirm before anything is scheduled. Surfaced here so both
  // the LLM prompt and (via the fallback) the no-key path can voice it.
  const sched = outcome.goal.schedule?.at
    ? { schedule: { at: outcome.goal.schedule.at, timezone: outcome.goal.schedule.timezone ?? null, confirmed: Boolean(outcome.goal.schedule.confirmed) } }
    : {};
  if (outcome.status === 'awaiting_clarification') {
    return { ...lang, ...workspace, ...sched, status: outcome.status, goal, questions: outcome.questions.map((q) => ({ slot: q.slot, question: q.question, required: q.required })) };
  }
  if (outcome.status === 'planned') {
    const agents = outcome.plan.nodes.map((n) => n.agentId);
    return { ...lang, ...workspace, ...sched, status: outcome.status, goal, plan: { agents, nodeCount: outcome.plan.nodes.length, platforms: outcome.goal.platforms } };
  }
  return { ...lang, ...workspace, ...sched, status: outcome.status, goal, error: outcome.error, detail: outcome.detail };
};

// Plain-language fallback composed from the structured outcome — no LLM. Keeps the
// surface usable (and verify deterministic) when GEMINI_API_KEY is absent.
// Human-readable local time for the no-LLM fallback. Best-effort Intl formatting in the schedule's
// timezone; degrades to the raw ISO instant if the zone is unknown/invalid (never throws).
const formatScheduleInstant = (at: string, timezone: string | null, locale = 'en-US'): string => {
  try {
    const fmt = new Intl.DateTimeFormat(locale, {
      timeZone: timezone ?? 'UTC', dateStyle: 'full', timeStyle: 'short', hour12: true,
    });
    return `${fmt.format(new Date(at))}${timezone ? ` (${timezone})` : ' (UTC)'}`;
  } catch {
    return `${at}${timezone ? ` (${timezone})` : ''}`;
  }
};

// Confirm-ask appended when the goal carries a parsed-but-unconfirmed schedule — the exact instant read
// back so a mis-parsed time is caught before it is scheduled. Empty once confirmed. Localized (vi/en) and
// appended DETERMINISTICALLY (not left to the LLM, which intermittently omits it → the "schedule lost"
// look, where the flow shows no scheduler and an immediate Execute would send now).
const scheduleConfirmTail = (outcome: MasterAgentOutcome, lang?: string | null): string => {
  const s = outcome.goal.schedule;
  if (!s?.at || s.confirmed) return '';
  const vi = (lang ?? '').toLowerCase().startsWith('vi');
  const when = formatScheduleInstant(s.at, s.timezone ?? null, vi ? 'vi-VN' : 'en-US');
  return vi
    ? `\n\n🕒 Mình hiểu thời gian gửi là ${when}. Bạn xác nhận đúng giờ này giúp mình nhé — chưa có gì được lên lịch cho tới khi bạn xác nhận.`
    : `\n\n🕒 I've read the send time as ${when}. Please confirm that's right — nothing is scheduled until you do.`;
};

export const deterministicReply = (outcome: MasterAgentOutcome, report?: WorkspaceReport | null, lang?: string | null): string => {
  // Campaign-scope turns open with the workspace snapshot — even without an LLM, the
  // reply should show what already exists before proposing the new plan.
  const reportLead = report ? `${formatWorkspaceReport(report)}\n\n` : '';
  const product = outcome.goal.slots.product?.trim();
  const scheduleTail = scheduleConfirmTail(outcome, lang ?? outcome.goal.slots.language);
  if (outcome.status === 'awaiting_clarification') {
    const lead = product
      ? `Got it — a marketing flow for ${product}.`
      : `Happy to help with this.`;
    const asks = outcome.questions.map((q) => q.question);
    const tail = asks.length
      ? ` To plan the right workflow I need a bit more: ${asks.join(' ')}`
      : ` Tell me a little more so I can plan the right steps.`;
    return reportLead + lead + tail + scheduleTail;
  }
  if (outcome.status === 'planned') {
    const agents = outcome.plan.nodes.map((n) => n.agentId.replace(/_/g, ' '));
    const platforms = outcome.goal.platforms.length ? outcome.goal.platforms.join(', ') : 'Facebook';
    if (outcome.goal.campaignScope !== 'single') {
      const weeks = outcome.goal.duration?.weeks ?? 4;
      const perWeek = outcome.goal.cadence?.postsPerWeek ?? 3;
      return `${reportLead}Here's my proposal${product ? ` for ${product}` : ''}: a ${weeks}-week campaign at ${perWeek} post(s)/week on ${platforms}. I'll run ${agents.join(' → ')} to draft the full content calendar for your review. Nothing is created or published until you approve — review the plan below and approve to start.${scheduleTail}`;
    }
    return `${reportLead}Here's the plan${product ? ` for ${product}` : ''}: I'll run ${agents.join(' → ')} across ${outcome.plan.nodes.length} step(s), publishing to ${platforms}. Nothing is published until you approve — review the workflow below and hit approve to start.${scheduleTail}`;
  }
  return `${reportLead}I couldn't finalize a plan: ${outcome.error}. Add the missing detail and I'll try again.`;
};

export interface ConversationAuthor {
  author(outcome: MasterAgentOutcome, prior?: PriorMessage[], opts?: AuthorOptions): Promise<string>;
}

export class GeminiConversationAuthor implements ConversationAuthor {
  async author(outcome: MasterAgentOutcome, prior: PriorMessage[] = [], opts: AuthorOptions = {}): Promise<string> {
    const replyLanguage = resolveLanguage(outcome, opts);
    const fallback = deterministicReply(outcome, opts.workspaceReport, replyLanguage ?? opts.language);
    if (!env.GEMINI_API_KEY) return fallback;
    // Language directive: pin to a named language when we confidently have one, else
    // tell the model to MIRROR the user's message — which covers every language,
    // including Latin-script ones (French, Spanish, German…) a code can't disambiguate.
    const userMessage = (opts.userMessage ?? '').trim();
    const languageDirective = replyLanguage
      ? `Write your entire reply in ${replyLanguage}.`
      : `Write your entire reply in the SAME language as the user's latest message${userMessage ? ` (quoted below)` : ''}. Detect it from their words; do not default to English.`;
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
                // Language directive FIRST so it dominates the (mixed-language) question
                // seeds, then the user's raw message to mirror, then the structured context.
                text: `${languageDirective} Translate every clarification question into that language — never copy a question's original wording when it is in another language.\n\n${userMessage ? `User's latest message: """${userMessage}"""\n\n` : ''}Turn context:\n${JSON.stringify(outcomeContext(outcome, replyLanguage, opts.workspaceReport))}`,
              }],
            },
          ],
          generationConfig: { temperature: 0.5 },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return fallback;
      const raw = await res.json();
      // Ledger the REAL physical call (chat surface) — best-effort, never throws, so a
      // recording hiccup can't degrade the authored reply.
      await recordGeminiCall(raw, { ownerId: opts.ownerId ?? null, surface: 'chat', model: env.GEMINI_MODEL });
      const text = extractText(raw);
      if (text.length < 2) return fallback;
      // The model is handed the schedule but intermittently omits reading the exact time back → the user
      // sees no scheduler + no confirm ask and thinks the time was ignored (and an immediate Execute would
      // send NOW). Append the confirm-ask deterministically (localized) so an unconfirmed schedule always
      // prompts a confirm. `set schedule → confirm → re-plan splices the ⏰ scheduler` still holds.
      return text + scheduleConfirmTail(outcome, replyLanguage ?? opts.language);
    } catch {
      return fallback;
    }
  }
}

export const conversationAuthor: ConversationAuthor = new GeminiConversationAuthor();
