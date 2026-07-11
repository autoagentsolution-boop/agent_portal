// Atria brain tools (P1a) — the closed tool menu the reasoning loop selects from, plus the dispatcher.
// Each tool WRAPS code that already exists (grounded search, data-query, memory, marketing planner) so
// the brain adds reasoning without new engines. Declarations use Gemini's functionDeclarations schema
// (OpenAPI subset). dispatchTool runs one call and returns a plain JSON result the model reads next round.
import { groundedSearch } from '../../agents/researcher/grounded-search.ts';
import { answerDataQuery } from '../master/report-answer.ts';
import { recallForMessage } from '../../memory/user-memory.ts';
import { rememberFreeform, type MemoryKind } from '../../db/repos/user-memory-repo.ts';
import { requirementAnalyzer } from '../master/requirement-analyzer.ts';
import { masterAgent, type MasterAgentOutcome } from '../master/master-agent.ts';
import type { GoalSpec } from '../schemas/goal-spec.ts';

// Per-turn state threaded through every tool call. `searched` accumulates citation labels (surfaced to
// the user for transparency); `proposal` is set when the brain calls propose_workflow (the router turns
// it into a planned/awaiting_clarification run + flow card).
export interface ToolContext {
  ownerId: string;
  message: string; // the raw user message — fallback subject for search/data/recall
  memoryContext: string | null; // recalled memory block (passed into the marketing analyzer)
  sessionId: string | null;
  searched: string[];
  proposal: { goal: GoalSpec; outcome: MasterAgentOutcome } | null;
}

const MEMORY_KINDS = new Set<MemoryKind>(['product', 'brand', 'audience', 'preference', 'contact', 'fact']);
const asKind = (v: unknown): MemoryKind => (MEMORY_KINDS.has(v as MemoryKind) ? (v as MemoryKind) : 'fact');
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

// Gemini functionDeclarations — the menu shown to the model each round.
export const TOOL_DECLARATIONS = [
  {
    name: 'web_search',
    description:
      'Live web / grounded search. Use to get facts, current info, or market/competitor/context you do not already know, so your next reply is grounded instead of guessed.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to search for, phrased as a clear query.' } },
      required: ['query'],
    },
  },
  {
    name: 'get_workspace_data',
    description:
      "The user's REAL campaign/post performance numbers (posts, reach, leads, spend). Use for any question about how their campaigns are doing. Use only the numbers returned; never invent performance data.",
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'Optional time window in natural language, e.g. "this week", "last 30 days", "all time".' },
      },
    },
  },
  {
    name: 'recall_memory',
    description:
      'Durable facts already known about this user (their product, brand voice, audience, preferences). Check before asking something they may have already told you.',
    parameters: {
      type: 'object',
      properties: { topic: { type: 'string', description: 'What to recall about the user (e.g. their product, audience).' } },
    },
  },
  {
    name: 'save_memory',
    description: 'Remember a durable fact the user just shared, so you do not re-ask next time.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['product', 'brand', 'audience', 'preference', 'contact', 'fact'], description: 'Category of the fact.' },
        content: { type: 'string', description: 'The fact to store, in one short sentence.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'propose_workflow',
    description:
      'Use ONLY when the user actually wants to CREATE or RUN something that needs the agent pipeline — a social post/campaign, a video, an email to send, or a research deliverable. Assembles a flow of agent nodes and shows a flow card of which agents will run. It does NOT execute anything; the user reviews and approves first.',
    parameters: {
      type: 'object',
      properties: {
        goal_description: {
          type: 'string',
          description:
            'A full natural-language description of the goal as you understand it: product/topic, platforms, outputs (post/video/email/campaign), and scope (single vs a multi-week campaign).',
        },
      },
      required: ['goal_description'],
    },
  },
] as const;

// Dispatch one tool call. Returns a plain JSON-serializable result (never throws — a thrown tool
// degrades to an {error} the model can reason about instead of breaking the loop).
export async function dispatchTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  try {
    switch (name) {
      case 'web_search': {
        const { text, citations } = await groundedSearch(str(args.query) || ctx.message);
        for (const c of citations) if (!ctx.searched.includes(c)) ctx.searched.push(c);
        return { summary: text, sources: citations.slice(0, 8) };
      }
      case 'get_workspace_data': {
        const { answer, report } = await answerDataQuery(ctx.ownerId, str(args.period) || ctx.message);
        const m = report.metrics;
        return { answer, postsPublished: m.postsPublished, platforms: m.platforms, leadsCaptured: m.leadsCaptured, usdSpent: m.usdSpent, creditsSpent: m.creditsSpent };
      }
      case 'recall_memory': {
        const { context } = await recallForMessage(ctx.ownerId, str(args.topic) || ctx.message);
        return { memory: context ?? 'Nothing stored yet for this user.' };
      }
      case 'save_memory': {
        const content = str(args.content).slice(0, 500).trim();
        if (content) await rememberFreeform(ctx.ownerId, asKind(args.kind), content, ctx.sessionId);
        return { saved: Boolean(content) };
      }
      case 'propose_workflow': {
        const goal = await requirementAnalyzer.analyze(str(args.goal_description) || ctx.message, ctx.ownerId, ctx.memoryContext);
        const outcome = masterAgent.planFromGoal(goal);
        ctx.proposal = { goal, outcome };
        if (outcome.status === 'planned') return { status: 'planned', agents: outcome.plan.nodes.map((n) => n.agentId), steps: outcome.plan.nodes.length };
        if (outcome.status === 'awaiting_clarification') return { status: 'need_more_info', missing: outcome.questions.map((q) => q.slot) };
        return { status: 'error', error: outcome.error };
      }
      default:
        return { error: `unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
