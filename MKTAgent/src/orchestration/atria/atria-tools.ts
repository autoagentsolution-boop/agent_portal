// Atria brain tools (P1a) — the closed tool menu the reasoning loop selects from, plus the dispatcher.
// Each tool WRAPS code that already exists (grounded search, data-query, memory, marketing planner) so
// the brain adds reasoning without new engines. Declarations use Gemini's functionDeclarations schema
// (OpenAPI subset). dispatchTool runs one call and returns a plain JSON result the model reads next round.
import { env } from '../../config/env.ts';
import { groundedSearch } from '../../agents/researcher/grounded-search.ts';
import { workspaceMetrics } from '../master/report-answer.ts';
import { recallForMessage } from '../../memory/user-memory.ts';
import { rememberFreeform, type MemoryKind } from '../../db/repos/user-memory-repo.ts';
import { requirementAnalyzer } from '../master/requirement-analyzer.ts';
import { masterAgent, type MasterAgentOutcome } from '../master/master-agent.ts';
import { mergeGoals } from '../master/goal-merge.ts';
import { recordLlmUsage } from '../../cost/llm-usage.ts';
import { parseScheduleTime } from './parse-schedule-time.ts';
import { goalSpec, type GoalSpec } from '../schemas/goal-spec.ts';
import { recordCapabilityGap, type CapabilityGapSpec } from '../../db/repos/roadmap-demand-repo.ts';

// Per-turn state threaded through every tool call. `searched` accumulates citation labels (surfaced to
// the user for transparency); `proposal` is set when the brain calls propose_workflow (the router turns
// it into a planned/awaiting_clarification run + flow card).
export interface ToolContext {
  ownerId: string;
  message: string; // the raw user message — fallback subject for search/data/recall
  memoryContext: string | null; // recalled memory block (passed into the marketing analyzer)
  sessionId: string | null;
  // The existing pre-exec run's goal (mid-setup), merged in propose_workflow so earlier slots survive.
  priorGoal: GoalSpec | null;
  // The existing PLANNED run's id (a proposal already on screen), so execute_workflow can run it.
  existingRunId: string | null;
  searched: string[];
  proposal: { goal: GoalSpec; outcome: MasterAgentOutcome } | null;
  // Set by execute_workflow when the user asks to run the plan → the router triggers execution.
  executeRunId: string | null;
  // A schedule PROPOSAL parsed by set_schedule THIS turn (natural-language time → absolute UTC instant).
  // Overlaid onto the goal in propose_workflow as UNconfirmed — the user must confirm the exact instant
  // (which they do on a later turn, at which point the schedule is carried via priorGoal → confirmed).
  scheduleProposal: { phrase: string | null; at: string; timezone: string | null } | null;
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
  {
    name: 'set_schedule',
    description:
      'Parse a natural-language time ("tomorrow morning", "next Mon 9am", "sáng mai") into ONE exact absolute instant, so a later action (e.g. sending an email) can happen at that time. Call this when the user wants an action to run at a specific FUTURE time. It returns the exact instant + timezone for you to read back and ask the user to confirm — it schedules NOTHING by itself. After the user confirms, call propose_workflow so the flow includes the scheduler.',
    parameters: {
      type: 'object',
      properties: { when_phrase: { type: 'string', description: 'The time expression exactly as the user said it.' } },
      required: ['when_phrase'],
    },
  },
  {
    name: 'execute_workflow',
    description:
      'Run the workflow you ALREADY proposed (the flow card currently on screen). Use ONLY when the user explicitly says to run / proceed / execute / "chạy đi" AND a plan is already on the table. Atria generates the content, then the run HALTS at the approval gate before anything is published or sent — so this is safe. Do NOT use this to make a new plan (use propose_workflow), and do not call it if no workflow has been proposed yet.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'flag_capability_gap',
    description:
      'Use when the user asks for a capability you genuinely do NOT have — no tool above AND outside the agent pipeline (which covers social posts, campaigns, video, email, research). Examples: translate a document, transcribe audio, analyze a spreadsheet, build a slide deck. Do NOT force such a request into a marketing/email workflow and do NOT pretend to do it. This honestly logs the missing capability as demand for the team to build; afterwards, tell the user plainly you cannot do it yet but have flagged it.',
    parameters: {
      type: 'object',
      properties: {
        capability: { type: 'string', description: 'Short kebab-case id of the missing capability, e.g. "translate", "transcribe-audio", "analyze-spreadsheet".' },
        what_it_would_do: { type: 'string', description: 'One sentence: what this capability would do for the user.' },
        produces: { type: 'string', description: 'The output it would produce, e.g. "translated_text".' },
        requires: { type: 'array', items: { type: 'string' }, description: 'Inputs it would need, e.g. ["source_text","target_language"].' },
        example_task: { type: 'string', description: "The user's request in their own words." },
      },
      required: ['capability'],
    },
  },
] as const;

// Dispatch one tool call. Returns a plain JSON-serializable result (never throws — a thrown tool
// degrades to an {error} the model can reason about instead of breaking the loop).
export async function dispatchTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  try {
    switch (name) {
      case 'web_search': {
        const { text, citations, usage } = await groundedSearch(str(args.query) || ctx.message);
        // Ledger the REAL grounded Gemini call (was dropped → un-billed). Surface 'research' so it bills
        // honestly per-surface, not lumped into 'chat'. Best-effort.
        if (usage) void recordLlmUsage({ ownerId: ctx.ownerId, surface: 'research', model: env.GEMINI_MODEL, usage }).catch(() => {});
        for (const c of citations) if (!ctx.searched.includes(c)) ctx.searched.push(c);
        // Truncate the summary re-fed into the loop's contents so a long grounded answer doesn't bloat
        // every subsequent round's prompt tokens (the model still gets the gist + sources).
        return { summary: text.slice(0, 1500), sources: citations.slice(0, 8) };
      }
      case 'get_workspace_data': {
        // Return RAW numbers only — the brain voices them in its reply (no second LLM voicing here,
        // which was the redundant Gemini call per data-query). Measured vs estimated stay labeled.
        const { report, periodLabel } = await workspaceMetrics(ctx.ownerId, str(args.period) || ctx.message);
        const m = report.metrics;
        return {
          period: periodLabel,
          postsPublished: m.postsPublished,
          platforms: m.platforms,
          leadsCaptured: m.leadsCaptured,
          measuredReach: m.measuredReach,
          estimatedReach: report.value.estimatedReach,
          usdSpent: m.usdSpent,
          creditsSpent: m.creditsSpent,
        };
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
      case 'execute_workflow': {
        // Signal the router to run the plan already on screen. Never executes here — keeps the async
        // launch + connection gate in the router (the /execute path), so this stays a pure signal.
        if (!ctx.existingRunId) return { status: 'no_plan', note: 'There is no proposed workflow to run yet — propose one first.' };
        ctx.executeRunId = ctx.existingRunId;
        return { status: 'executing', note: 'The workflow is now running; it will pause at the approval gate before anything is published or sent.' };
      }
      case 'set_schedule': {
        const phrase = str(args.when_phrase) || ctx.message;
        const parsed = await parseScheduleTime(phrase, ctx.ownerId);
        if (!parsed) {
          return { error: 'could_not_parse_time', note: 'Ask the user to state the time more concretely (e.g. "tomorrow 8am") — do not claim anything is scheduled.' };
        }
        ctx.scheduleProposal = { phrase, at: parsed.atUtc, timezone: parsed.timezone };
        return {
          proposed_time_utc: parsed.atUtc,
          timezone: parsed.timezone,
          human_confirm: parsed.humanConfirm,
          note: 'Read the exact time + timezone back to the user and ask them to confirm. Do NOT say it is scheduled yet. After they confirm, call propose_workflow.',
        };
      }
      case 'propose_workflow': {
        const analyzed = await requirementAnalyzer.analyze(str(args.goal_description) || ctx.message, ctx.ownerId, ctx.memoryContext);
        // Multi-turn: merge onto the prior goal (additive — same semantics as the old refine path) so a
        // description that restates only this turn's delta never drops product/audience/platforms
        // gathered earlier. First turn (no priorGoal) uses the analyzed goal as-is.
        const merged = ctx.priorGoal ? mergeGoals(ctx.priorGoal, analyzed) : analyzed;
        // Schedule overlay (generic-scheduler node): a proposal parsed THIS turn is UNconfirmed (the user
        // still has to confirm the exact instant) → the planner leaves the flow immediate. A schedule
        // CARRIED from a prior turn (priorGoal, via mergeGoals) means the user already saw it and is now
        // proceeding → confirmed, so the planner splices the scheduler node. Either way the executor's
        // schedule gate is the final park checkpoint — nothing parks without an explicit approval click.
        let goal = merged;
        if (ctx.scheduleProposal) {
          goal = goalSpec.parse({ ...merged, schedule: { ...ctx.scheduleProposal, confirmed: false } });
        } else if (merged.schedule?.at) {
          goal = goalSpec.parse({ ...merged, schedule: { ...merged.schedule, confirmed: true } });
        }
        const outcome = masterAgent.planFromGoal(goal);
        ctx.proposal = { goal, outcome };
        if (outcome.status === 'planned') return { status: 'planned', agents: outcome.plan.nodes.map((n) => n.agentId), steps: outcome.plan.nodes.length };
        if (outcome.status === 'awaiting_clarification') return { status: 'need_more_info', missing: outcome.questions.map((q) => q.slot) };
        return { status: 'error', error: outcome.error };
      }
      case 'flag_capability_gap': {
        const capability = str(args.capability).trim().slice(0, 60);
        if (!capability) return { logged: false, note: 'No capability id given — tell the user plainly you cannot do that yet.' };
        const requires = Array.isArray(args.requires) ? args.requires.map(str).filter(Boolean) : undefined;
        const spec: CapabilityGapSpec = {
          whatItWouldDo: str(args.what_it_would_do) || undefined,
          produces: str(args.produces) || undefined,
          requires: requires && requires.length ? requires : undefined,
          exampleTask: (str(args.example_task) || ctx.message).slice(0, 500) || undefined,
        };
        // DB write must never break the turn — on failure the honest reply still stands (logged:false).
        let logged = false;
        try {
          logged = await recordCapabilityGap(ctx.ownerId, capability, str(args.what_it_would_do) || null, spec);
        } catch {
          logged = false;
        }
        return {
          logged,
          note:
            `You do NOT have this capability. In the user's language, tell them honestly you can't do "${capability}" yet, ` +
            `that you've flagged it to the team${logged ? '' : ' (already on the list)'}, and offer what you CAN do if relevant. Never pretend to perform the task.`,
        };
      }
      default:
        return { error: `unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
