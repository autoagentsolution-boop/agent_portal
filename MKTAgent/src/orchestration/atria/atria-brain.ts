// Atria reasoning brain (P1a — intent-router redesign). Replaces the regex classifyIntent + immediate
// marketing extraction with a real tool-using agent LOOP: Gemini reasons over the conversation, calls
// tools (web search, workspace data, memory) when useful, and either answers conversationally (the
// DEFAULT) or proposes a workflow (→ flow card + approval gate). The brain decides intent by reasoning,
// not by hardcoded branches. Mirrors the fetch/timeout/ledger style of the other orchestration LLM seams.
import { env } from '../../config/env.ts';
import { recordGeminiCall } from '../../cost/llm-usage.ts';
import { atriaBrainSystemPrompt } from '../prompts/atria-brain-prompt.ts';
import { TOOL_DECLARATIONS, dispatchTool, type ToolContext } from './atria-tools.ts';
import { masterAgent, type MasterAgentOutcome } from '../master/master-agent.ts';
import type { PriorMessage } from '../master/conversation-author.ts';

// The brain's verdict for a turn. `reply` = answer the user directly (conversational / general reasoning
// / data-query relay) — the router records a reply-only run. `proposal` = the brain called
// propose_workflow — the router creates the matching run (planned / awaiting_clarification) so the
// existing plan card + approval gate drive execution. `searched` surfaces web-search sources used.
export type AtriaTurn =
  | { kind: 'reply'; text: string; searched: string[] }
  | { kind: 'proposal'; outcome: MasterAgentOutcome; searched: string[] };

export interface AtriaBrainInput {
  message: string;
  ownerId: string;
  memoryContext: string | null;
  sessionId: string | null;
  prior?: PriorMessage[];
}

const MAX_ROUNDS = 5; // tool-call rounds before we force a final answer (runaway guard)
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

const callGemini = (contents: GeminiContent[]): Promise<Response> =>
  fetch(endpoint(env.GEMINI_MODEL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: atriaBrainSystemPrompt }] },
      contents,
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      generationConfig: { temperature: 0.5 },
    }),
    signal: AbortSignal.timeout(60_000),
  });

// Legacy degradation: no key → skip the reasoning loop and use the deterministic marketing planner so
// the surface still works (returns a proposal outcome, exactly like the old handle path).
async function legacyFallback(input: AtriaBrainInput): Promise<AtriaTurn> {
  const outcome = await masterAgent.handle(input.message, input.ownerId, input.memoryContext);
  return { kind: 'proposal', outcome, searched: [] };
}

// Run the reasoning loop for one user turn. Never throws — any loop failure degrades to the legacy
// marketing path so a turn is always answered.
export async function runAtriaBrain(input: AtriaBrainInput): Promise<AtriaTurn> {
  if (!env.GEMINI_API_KEY) return legacyFallback(input);
  const ctx: ToolContext = {
    ownerId: input.ownerId,
    message: input.message,
    memoryContext: input.memoryContext,
    sessionId: input.sessionId,
    searched: [],
    proposal: null,
  };
  const contents: GeminiContent[] = [...historyContents(input.prior ?? []), { role: 'user', parts: [{ text: input.message }] }];

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await callGemini(contents);
      if (!res.ok) return input.prior?.length ? { kind: 'reply', text: '', searched: ctx.searched } : legacyFallback(input);
      const raw = await res.json();
      await recordGeminiCall(raw, { ownerId: input.ownerId, surface: 'chat', model: env.GEMINI_MODEL });

      const parts = partsOf(raw);
      const calls = parts.filter((p) => p.functionCall) as Array<{ functionCall: { name: string; args?: Record<string, unknown> } }>;

      if (!calls.length) {
        // Final answer. A propose_workflow that produced a run outcome wins (flow card path); else reply.
        if (ctx.proposal && ctx.proposal.outcome.status !== 'plan_error') return { kind: 'proposal', outcome: ctx.proposal.outcome, searched: ctx.searched };
        return { kind: 'reply', text: textOf(parts), searched: ctx.searched };
      }

      // Echo the model's function-call turn, then append each tool result for the next round.
      contents.push({ role: 'model', parts: calls.map((c) => ({ functionCall: c.functionCall })) });
      const responses: unknown[] = [];
      for (const c of calls) {
        const result = await dispatchTool(c.functionCall.name, c.functionCall.args ?? {}, ctx);
        responses.push({ functionResponse: { name: c.functionCall.name, response: { result } } });
      }
      contents.push({ role: 'user', parts: responses });

      // Short-circuit: once a workflow is proposed (planned or needs-more-info), the marketing pipeline
      // owns the turn — no need to keep looping to re-voice it (conversation-author voices proposals).
      if (ctx.proposal && ctx.proposal.outcome.status !== 'plan_error') return { kind: 'proposal', outcome: ctx.proposal.outcome, searched: ctx.searched };
    }
    // Ran out of rounds without a clean answer — fall back to a proposal if any, else legacy.
    if (ctx.proposal && ctx.proposal.outcome.status !== 'plan_error') return { kind: 'proposal', outcome: ctx.proposal.outcome, searched: ctx.searched };
    return legacyFallback(input);
  } catch {
    return legacyFallback(input);
  }
}
