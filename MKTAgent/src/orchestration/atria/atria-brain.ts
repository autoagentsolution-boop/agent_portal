// Atria reasoning brain (P1a — intent-router redesign). Replaces the regex classifyIntent + immediate
// marketing extraction with a real tool-using agent LOOP: Gemini reasons over the conversation, calls
// tools (web search, workspace data, memory) when useful, and either answers conversationally (the
// DEFAULT) or proposes a workflow (→ flow card + approval gate). The brain decides intent by reasoning,
// not by hardcoded branches. Mirrors the fetch/timeout/ledger style of the other orchestration LLM seams.
//
// Bounded by a hard per-turn wall-clock budget (loop + nested tool LLM calls all await on POST /runs).
// A RUNTIME failure degrades to a graceful conversational apology — NOT a marketing plan — so a transient
// Gemini blip can't reintroduce the very framing this redesign removed. Only a missing API key falls back
// to the deterministic marketing planner (the sole capability without an LLM).
import { env } from '../../config/env.ts';
import { recordGeminiCall } from '../../cost/llm-usage.ts';
import { atriaBrainSystemPrompt } from '../prompts/atria-brain-prompt.ts';
import { TOOL_DECLARATIONS, dispatchTool, type ToolContext } from './atria-tools.ts';
import { getBrainCache, invalidateBrainCache } from './atria-brain-cache.ts';
import { masterAgent, type MasterAgentOutcome } from '../master/master-agent.ts';
import { detectLanguage } from '../master/detect-language.ts';
import type { PriorMessage } from '../master/conversation-author.ts';
import type { GoalSpec } from '../schemas/goal-spec.ts';

// The brain's verdict for a turn. `reply` = answer the user directly (conversational / general reasoning
// / data-query relay) — the router records a reply-only turn. `proposal` = the brain called
// propose_workflow — the router creates the matching run (planned / awaiting_clarification) so the
// existing plan card + approval gate drive execution. `searched`/`tools`/`rounds` are surfaced for the
// source footnote + observability logging.
export type AtriaTurn =
  | { kind: 'reply'; text: string; searched: string[]; tools: string[]; rounds: number; executeRunId?: string | null }
  | { kind: 'proposal'; outcome: MasterAgentOutcome; searched: string[]; tools: string[]; rounds: number };

export interface AtriaBrainInput {
  message: string;
  ownerId: string;
  memoryContext: string | null;
  sessionId: string | null;
  prior?: PriorMessage[];
  // The existing pre-execution run's GoalSpec, when this chat is mid-setup. Threaded into
  // propose_workflow and merged (additive) so slots gathered on earlier turns (product/audience/
  // platforms) are never lost when the model's goal_description restates only the delta.
  priorGoal?: GoalSpec | null;
  // The existing PLANNED run's id, so execute_workflow ("chạy đi") can run the plan on screen.
  existingRunId?: string | null;
  // Voice mode: the reply is spoken, so keep it to 1-2 short sentences (faster TTS, less delay).
  voice?: boolean;
}

const MAX_ROUNDS = 3; // tool-call rounds before we force a final answer (runaway guard)
const TURN_BUDGET_MS = 45_000; // hard wall-clock ceiling for the WHOLE turn (loop + nested tool LLM calls)
const CALL_TIMEOUT_MS = 30_000; // per brain call — below the turn budget so one round can't consume it all
const endpoint = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

interface Part { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }
interface GeminiContent { role: 'user' | 'model'; parts: unknown[] }

const partsOf = (raw: unknown): Part[] =>
  ((raw as { candidates?: Array<{ content?: { parts?: Part[] } }> }).candidates?.[0]?.content?.parts ?? []);
const textOf = (parts: Part[]): string => parts.map((p) => p.text ?? '').join('').trim();

// History → Gemini contents (user↔model). Last 8 turns keep the deep-dive context without bloating.
const historyContents = (prior: PriorMessage[]): GeminiContent[] =>
  prior.slice(-8).map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));

// One generateContent call. With a cache name the static prefix (system prompt + tools) comes from the
// server-side CachedContent — billed at the cached rate — so we omit it from the body; without one we
// send it inline (unchanged behavior).
const doCall = (contents: GeminiContent[], cache: string | null): Promise<Response> => {
  // Atria KEEPS its thinking — but with an EXPLICIT budget, not the default. gemini-2.5-flash's DEFAULT
  // (dynamic) thinking mode misbehaves with tools: it intermittently returns finishReason=STOP with EMPTY
  // content parts (no tool call, no text), which the loop can only read as a failed turn → a spurious
  // apology. An explicit thinkingBudget avoids that failure mode while preserving real reasoning headroom
  // for deep-dive replies (the model still only spends what a turn needs). Measured: default → EMPTY every
  // time; budget 512/2048 → a clean tool-call/reply every time with genuine thinking tokens used.
  const body: Record<string, unknown> = { contents, generationConfig: { temperature: 0.5, thinkingConfig: { thinkingBudget: 4096 } } };
  if (cache) {
    body.cachedContent = cache;
  } else {
    body.systemInstruction = { parts: [{ text: atriaBrainSystemPrompt }] };
    body.tools = [{ functionDeclarations: TOOL_DECLARATIONS }];
  }
  return fetch(endpoint(env.GEMINI_MODEL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
};

const callGemini = async (contents: GeminiContent[]): Promise<Response> => {
  const cache = await getBrainCache(); // best-effort — null → inline prefix
  const res = await doCall(contents, cache);
  // A cached call can 4xx if the cache expired/was evicted between the check and the call — invalidate
  // and retry once inline so a stale cache never degrades a turn.
  if (!res.ok && cache) {
    invalidateBrainCache();
    return doCall(contents, null);
  }
  return res;
};

// No-key degradation ONLY: use the deterministic marketing planner so the surface still works without an
// LLM (returns a proposal outcome, exactly like the old handle path).
async function legacyFallback(input: AtriaBrainInput): Promise<AtriaTurn> {
  const outcome = await masterAgent.handle(input.message, input.ownerId, input.memoryContext);
  return { kind: 'proposal', outcome, searched: [], tools: [], rounds: 0 };
}

// Runtime-failure degradation (Gemini down / empty response / deadline). A short apology in the user's
// language — deliberately NOT a marketing proposal, which would re-box a general request as marketing.
const gracefulReply = (message: string, searched: string[], tools: string[], rounds: number): AtriaTurn => {
  const vi = detectLanguage(message) === 'vi';
  const text = vi
    ? 'Xin lỗi, mình đang gặp trục trặc khi xử lý yêu cầu này. Bạn thử lại giúp mình một chút nhé.'
    : "Sorry — I ran into a problem handling that just now. Could you try again in a moment?";
  return { kind: 'reply', text, searched, tools, rounds };
};

// Run the reasoning loop for one user turn. Never throws — bounded by MAX_ROUNDS + a wall-clock budget,
// and degrades gracefully so a turn is always answered.
export async function runAtriaBrain(input: AtriaBrainInput): Promise<AtriaTurn> {
  if (!env.GEMINI_API_KEY) return legacyFallback(input);
  const ctx: ToolContext = {
    ownerId: input.ownerId,
    message: input.message,
    memoryContext: input.memoryContext,
    sessionId: input.sessionId,
    priorGoal: input.priorGoal ?? null,
    existingRunId: input.existingRunId ?? null,
    searched: [],
    proposal: null,
    executeRunId: null,
    scheduleProposal: null,
  };
  // Voice hint rides the user turn (NOT the system prompt — that's context-cached and must stay stable).
  const userParts = input.voice
    ? [{ text: '(The user is speaking by voice — reply in 1–2 short, natural spoken sentences. No lists or markdown.)' }, { text: input.message }]
    : [{ text: input.message }];
  const contents: GeminiContent[] = [...historyContents(input.prior ?? []), { role: 'user', parts: userParts }];
  const tools: string[] = [];
  const deadline = Date.now() + TURN_BUDGET_MS;
  // A workflow proposal (planned or needs-more-info) wins the turn; plan_error stays conversational.
  const proposalOrNull = (rounds: number): AtriaTurn | null =>
    ctx.proposal && ctx.proposal.outcome.status !== 'plan_error'
      ? { kind: 'proposal', outcome: ctx.proposal.outcome, searched: ctx.searched, tools, rounds }
      : null;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      // Wall-clock guard: never let the loop + nested tool LLM calls block POST /runs indefinitely.
      if (Date.now() > deadline) return proposalOrNull(round) ?? gracefulReply(input.message, ctx.searched, tools, round);

      const res = await callGemini(contents);
      if (!res.ok) return proposalOrNull(round) ?? gracefulReply(input.message, ctx.searched, tools, round);
      const raw = await res.json();
      // Best-effort ledger — a ledger hiccup must NOT throw into the outer catch and discard a good reply.
      await recordGeminiCall(raw, { ownerId: input.ownerId, surface: 'chat', model: env.GEMINI_MODEL }).catch(() => {});

      const parts = partsOf(raw);
      const calls = parts.filter((p) => p.functionCall) as Array<{ functionCall: { name: string; args?: Record<string, unknown> } }>;

      if (!calls.length) {
        // Final answer. A propose_workflow that produced a run outcome wins (flow card path); else reply.
        const proposal = proposalOrNull(round + 1);
        if (proposal) return proposal;
        const text = textOf(parts);
        return text
          ? { kind: 'reply', text, searched: ctx.searched, tools, rounds: round + 1, executeRunId: ctx.executeRunId }
          : gracefulReply(input.message, ctx.searched, tools, round + 1); // empty text (5xx/safety block) → no junk "…" turn
      }

      // Echo the model's function-call turn, then append each tool result for the next round.
      contents.push({ role: 'model', parts: calls.map((c) => ({ functionCall: c.functionCall })) });
      const responses: unknown[] = [];
      for (const c of calls) {
        tools.push(c.functionCall.name);
        const result = await dispatchTool(c.functionCall.name, c.functionCall.args ?? {}, ctx);
        responses.push({ functionResponse: { name: c.functionCall.name, response: { result } } });
      }
      contents.push({ role: 'user', parts: responses });

      // Short-circuit: once a workflow is proposed, the marketing pipeline owns the turn — no need to
      // keep looping to re-voice it (conversation-author voices proposals).
      const proposal = proposalOrNull(round + 1);
      if (proposal) return proposal;
    }
    // Ran out of rounds — return a pending proposal if any, else a graceful reply (NOT a forced plan).
    return proposalOrNull(MAX_ROUNDS) ?? gracefulReply(input.message, ctx.searched, tools, MAX_ROUNDS);
  } catch {
    return proposalOrNull(0) ?? gracefulReply(input.message, ctx.searched, tools, 0);
  }
}
