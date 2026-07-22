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
import { emailOutputs, parseRemovals, parseEmailIntent } from '../master/deterministic-analyzer.ts';
import { masterAgent, type MasterAgentOutcome } from '../master/master-agent.ts';
import { mergeGoals, applyRemovals } from '../master/goal-merge.ts';
import { contentLanguageFor } from '../master/detect-language.ts';
import { recordLlmUsage } from '../../cost/llm-usage.ts';
import { parseScheduleTime } from './parse-schedule-time.ts';
import { goalSpec, type GoalSpec } from '../schemas/goal-spec.ts';
import { recordCapabilityGap, type CapabilityGapSpec } from '../../db/repos/roadmap-demand-repo.ts';
import { searchLeadsByName } from '../../db/repos/lead-repo.ts';

// Per-turn state threaded through every tool call. `searched` accumulates citation labels (surfaced to
// the user for transparency); `proposal` is set when the brain calls propose_workflow (the router turns
// it into a planned/awaiting_clarification run + flow card).
export interface ToolContext {
  ownerId: string;
  message: string; // the raw user message — fallback subject for search/data/recall
  memoryContext: string | null; // recalled memory block (passed into the marketing analyzer)
  instructions: string | null; // workspace Instructions block (P4) — passed into the marketing analyzer
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
  // A lead resolved BY NAME this turn (find_lead, single match). propose_workflow reads it to set the
  // email recipient FROM THE LEAD RECORD (authoritative — never a model-typed address) + carry leadId.
  // Only set on an unambiguous single match; >1 matches leave this null so the brain asks which one.
  resolvedLead: { leadId: string; email: string; name: string | null } | null;
  // The language the BRAIN read off this turn's message (`message_language` on any tool call). The only
  // signal that separates Indonesian from English — same Latin script, so no code can tell them apart.
  // Captured on the CONTEXT rather than read per-call so the schedule-rescue path below (which the brain
  // never routed through) resolves the same language the user is actually chatting in.
  messageLanguage: string | null;
}

// Supported NON-marketing utility capabilities → the terminal artifact each produces. propose_task plans
// backward from this target (bypassing the marketing frame). Extend by authoring a node + adding a row.
const TASK_CAPABILITIES: Record<string, string> = { summarize: 'summary' };

const MEMORY_KINDS = new Set<MemoryKind>(['product', 'brand', 'audience', 'preference', 'contact', 'fact']);
const asKind = (v: unknown): MemoryKind => (MEMORY_KINDS.has(v as MemoryKind) ? (v as MemoryKind) : 'fact');
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

// Mask a lead's email before it reaches the model (find_lead): keep the first local char + full domain
// so the user can tell candidates apart by domain without the full PII address entering the LLM context.
const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const head = local && local.length ? local[0] : '';
  return `${head}***@${domain}`;
};

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
      'Use when the user wants to CREATE or RUN something that needs the agent pipeline — a social post/campaign, a video, an email to send, or a research deliverable. Assembles a flow of agent nodes and shows a flow card of which agents will run. It does NOT execute anything; the user reviews and approves first. '
      + 'ALSO call this whenever a flow card is already on screen and the user asks to MODIFY the plan — add a step ("add a video"), REMOVE a step ("remove the video and storyboard", "bỏ infographic"), or change platforms/scope. A refinement MUST go through this tool to actually re-plan: describe the FULL updated goal in goal_description AND state the removal plainly (e.g. "... but WITHOUT a video or storyboard"). Do NOT merely acknowledge a change in words — if you skip this call, the plan on screen stays unchanged and you will have lied to the user about editing it.',
    parameters: {
      type: 'object',
      properties: {
        goal_description: {
          type: 'string',
          description:
            'A full natural-language description of the goal as you understand it: product/topic, platforms, outputs (post/video/email/campaign), and scope (single vs a multi-week campaign).',
        },
        kind: {
          type: 'string',
          enum: ['email', 'marketing'],
          description:
            "YOU decide the intent type — do not leave it to guesswork. 'email' = a personal message SENT to a person (a birthday/greeting/thank-you/nurture note, or any email to someone). 'marketing' = a social post, campaign, ad, or marketing content published to platforms. A birthday greeting for a named person is 'email', NOT 'marketing'. Always set this so the flow is built correctly.",
        },
        message_language: {
          type: 'string',
          description:
            "The ISO 639-1 code of the language the USER'S OWN MESSAGE is written in — the same language you are replying in (e.g. 'id' Indonesian, 'vi' Vietnamese, 'fr' French, 'en' English). Read it off their words ONLY; background context/memory above may be in another language — ignore that. This sets the language of the CONTENT that gets generated, so getting it wrong ships a post in the wrong language.",
        },
      },
      required: ['goal_description', 'kind', 'message_language'],
    },
  },
  {
    name: 'set_schedule',
    description:
      'Parse a natural-language time ("tomorrow morning", "next Mon 9am", "sáng mai") into ONE exact absolute instant, so a later action (e.g. sending an email) can happen at that time. Call this when the user wants an action to run at a specific FUTURE time. It returns the exact instant + timezone for you to read back and ask the user to confirm — it schedules NOTHING by itself. IMPORTANT: in the SAME turn, right after this, also call propose_workflow so the draft flow is created and the parsed time is carried on it (still UNconfirmed); then read the time back and ask the user to confirm. After they confirm, call propose_workflow again — the flow then includes the ⏰ scheduler step.',
    parameters: {
      type: 'object',
      properties: {
        when_phrase: { type: 'string', description: 'The time expression exactly as the user said it.' },
        message_language: { type: 'string', description: "ISO 639-1 code of the language the USER'S message is written in — the language the scheduled content will be written in. Ignore the language of any background context above." },
      },
      required: ['when_phrase', 'message_language'],
    },
  },
  {
    name: 'find_lead',
    description:
      "Resolve a captured LEAD by NAME (or partial name / email fragment) from the user's own leads, when they ask to email someone by name without giving an @ address (e.g. \"send a birthday email to Nghiep\"). Returns matching candidates with a MASKED email so you can confirm the right person. Call this BEFORE propose_workflow for a named-recipient email: exactly one match → the recipient is resolved for you (propose right away, same turn); several → ask the user which one; none → tell them you have no lead by that name and ask for the email address. NEVER guess or invent an email address.",
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The person to find — a name, partial name, or an email fragment like a domain to disambiguate (e.g. "Nghiep", "Nghiep gmail").' } },
      required: ['name'],
    },
  },
  {
    name: 'execute_workflow',
    description:
      'Run the workflow you ALREADY proposed (the flow card currently on screen). Use ONLY when the user explicitly says to run / proceed / execute / "chạy đi" AND a plan is already on the table. Atria generates the content, then the run HALTS at the approval gate before anything is published or sent — so this is safe. Do NOT use this to make a new plan (use propose_workflow), and do not call it if no workflow has been proposed yet.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'propose_task',
    description:
      'Route ANY request to PERFORM A TASK on content the user gives you — summarize, translate, transcribe, convert, extract, analyze, reformat, etc. — through this tool. Do NOT decide yourself whether the capability exists: pass the capability id (a short kebab-case verb like "summarize", "translate", "transcribe-audio", "analyze-spreadsheet") and the content, and THE SYSTEM checks the registry. If a node exists (currently: "summarize" — condense a document/article/report; data protection is built in, a Data Guard scan masks any personal/sensitive GDPR/PII data first) it assembles a flow card (executes nothing until the user approves). If NO node exists, the system automatically LOGS the request as demand for the team and tells you to be honest — you then tell the user you can\'t do it yet but have flagged it. This is the RELIABLE path for capturing missing capabilities: always come HERE for a content task rather than just replying "I can\'t".',
    parameters: {
      type: 'object',
      properties: {
        capability: { type: 'string', description: 'Short kebab-case verb for the task the user wants done to the content, e.g. "summarize", "translate", "transcribe-audio", "analyze-spreadsheet", "convert-to-slides". Pass what they asked for even if you are unsure it is supported — the system decides and logs a gap if not.' },
        source_text: { type: 'string', description: 'The text/content to run the capability on (e.g. the document). Provide it verbatim — for summarize, the security node masks sensitive spans downstream, so do not pre-redact.' },
        message_language: { type: 'string', description: "ISO 639-1 code of the language the USER'S request is written in (not the source text's) — the language the summary/result should come back in. Ignore the language of any background context above." },
      },
      required: ['capability', 'source_text', 'message_language'],
    },
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
  // Latest declaration wins, but never let a blank overwrite a good one — the brain declares the language
  // on the tools that need it, and the value must survive for the whole turn.
  const declared = str(args.message_language).trim();
  if (declared) ctx.messageLanguage = declared;
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
      case 'find_lead': {
        const query = str(args.name).trim();
        if (!query) return { found: 0, note: 'No name given — ask the user who to send to, or for an email address.' };
        const matches = await searchLeadsByName(ctx.ownerId, query, 5);
        if (!matches.length) {
          return { found: 0, note: `No lead named "${query}". Tell the user you don't have a saved contact by that name and ask for the email address to send to — never invent one.` };
        }
        if (matches.length === 1) {
          const m = matches[0]!;
          // Authoritative recipient stays SERVER-SIDE on ctx; only the masked address goes to the model.
          ctx.resolvedLead = { leadId: m.id, email: m.email, name: m.name };
          return { found: 1, lead: { name: m.name ?? '(no name)', email_masked: maskEmail(m.email) }, note: 'Resolved this single match — the recipient is set. Propose the email now (same turn); do NOT ask for their address.' };
        }
        // Ambiguous — do NOT resolve; the brain must ask which one (never guess a recipient).
        return {
          found: matches.length,
          candidates: matches.map((m) => ({ name: m.name ?? '(no name)', email_masked: maskEmail(m.email) })),
          note: 'Several matches — ask the user which person (show the masked emails so they can tell them apart). Do NOT propose until they pick. When they clarify, call find_lead again with a narrower query (e.g. add the domain).',
        };
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
          note: 'Now, in THIS same turn, call propose_workflow so the draft flow is created carrying this time (it stays UNconfirmed until the user agrees). Then read the exact time + timezone back to the user and ask them to confirm — do NOT say it is scheduled yet. After they confirm, call propose_workflow again; the flow will then include the ⏰ scheduler step.',
        };
      }
      case 'propose_workflow': {
        // analyzeWithRemovals (not analyze) so a subtractive refine ("remove the video/storyboard step",
        // "bỏ infographic") surfaces its removal delta — analyze() discards it, which is why remove-node
        // refinements silently no-op'd while the model still narrated "I removed it" (BUG-1). Prior is left
        // undefined so the goal parse stays byte-identical to the old analyze() path; removals come from the
        // message (LLM or regex parseRemovals) and are applied AFTER the additive merge below.
        const { goal: analyzed, removals: analyzedRemovals } = await requirementAnalyzer.analyzeWithRemovals(str(args.goal_description) || ctx.message, undefined, ctx.ownerId, ctx.memoryContext, ctx.instructions);
        // Removal intent is read from BOTH the goal_description AND the user's raw message — the brain often
        // passes only the positive goal in goal_description, so a "remove the video" refine would be lost if
        // we only looked there. parseRemovals(ctx.message) catches it from the user's actual words. Union.
        const msgRemovals = parseRemovals(ctx.message);
        const removals = {
          disableOutputs: [...new Set([...analyzedRemovals.disableOutputs, ...msgRemovals.disableOutputs])],
          dropPlatforms: [...new Set([...analyzedRemovals.dropPlatforms, ...msgRemovals.dropPlatforms])],
        } as typeof analyzedRemovals;
        // The BRAIN (LLM) declares the intent KIND — 'email' (a personal message SENT to a person) vs
        // 'marketing' (a social post / campaign). The regex analyzer only extracts slots; it must NOT decide
        // the TYPE (letting it guess is what mis-routed a birthday greeting into a 5-platform campaign, and
        // vice-versa). Force the goal's type to the brain's declared kind so the two intents never bleed into
        // each other. Omitted kind → keep the analyzer's result (backward-compatible for plain social posts).
        const kindArg = str(args.kind).trim().toLowerCase();
        const kind = kindArg === 'email' ? 'email' : kindArg === 'marketing' ? 'marketing' : null;
        const analyzedTyped = goalSpec.parse(
          kind === 'email'
            ? { ...analyzed, outputs: emailOutputs(analyzed.outputs), platforms: [] as GoalSpec['platforms'], campaignScope: 'single' as const, duration: null, cadence: null }
            : kind === 'marketing'
              ? { ...analyzed, outputs: { ...analyzed.outputs, needsEmail: false }, slots: { ...analyzed.slots, emailTo: null, leadId: null } }
              : analyzed,
        );
        // Merge onto the prior goal (additive) only WITHIN the same kind — a genuine refine. A kind SWITCH
        // (marketing after an email, or vice-versa) starts fresh so nothing bleeds across. A bare confirm/
        // refine names nothing new (empty delta) → always continues the prior, so an email survives its
        // confirm turn even if this turn's analyzed type looks different.
        const effKind = analyzedTyped.outputs.needsEmail ? 'email' : 'marketing';
        const priorKind = ctx.priorGoal ? (ctx.priorGoal.outputs.needsEmail ? 'email' : 'marketing') : null;
        const deltaEmpty = !analyzedTyped.outputs.needsEmail && !(analyzedTyped.slots.product ?? '').trim()
          && analyzedTyped.platforms.length === 0 && !analyzedTyped.outputs.needsIdeation
          && !analyzedTyped.outputs.needsInfographic && !analyzedTyped.outputs.needsVideo;
        const isSwitch = ctx.priorGoal != null && !deltaEmpty && priorKind !== effKind;
        const mergedAdditive = ctx.priorGoal && !isSwitch ? mergeGoals(ctx.priorGoal, analyzedTyped) : analyzedTyped;
        // Subtractive pass AFTER the additive merge (mergeGoals alone is additive and would keep a node the
        // user asked to drop). applyRemovals un-sets the named output flags (storyboard removal also drops
        // video) + drops named platforms, with an empty-plan guard. No-op when nothing was flagged for removal.
        const merged = (removals.disableOutputs.length || removals.dropPlatforms.length) ? applyRemovals(mergedAdditive, removals) : mergedAdditive;
        // Schedule overlay (generic-scheduler node): a proposal parsed THIS turn is UNconfirmed (the user
        // still has to confirm the exact instant) → the planner leaves the flow immediate. A schedule
        // CARRIED from a prior turn (priorGoal, via mergeGoals) means the user already saw it and is now
        // proceeding → confirmed, so the planner splices the scheduler node. Either way the executor's
        // schedule gate is the final park checkpoint — nothing parks without an explicit approval click.
        let goal = merged;
        if (ctx.scheduleProposal) {
          // A schedule parsed THIS turn is normally UNconfirmed — the user must confirm the exact instant.
          // BUT on the confirm turn the model re-parses the SAME time it already read back (priorGoal
          // already carries that instant) — that IS the user confirming, so a re-parse of the same instant
          // becomes confirmed (else the scheduler never splices — the "schedule lost" bug). A DIFFERENT
          // instant is a reschedule → stays unconfirmed until the user confirms the new time.
          const priorAt = ctx.priorGoal?.schedule?.at ?? null;
          const confirmed = priorAt != null && priorAt === ctx.scheduleProposal.at;
          goal = goalSpec.parse({ ...merged, schedule: { ...ctx.scheduleProposal, confirmed } });
        } else if (merged.schedule?.at) {
          goal = goalSpec.parse({ ...merged, schedule: { ...merged.schedule, confirmed: true } });
        }
        // Content language mirrors the language the user is actually chatting in — derived from THIS
        // message + the flow's established prior language, never the analyzer's inferred slot (a stale
        // 'vi' bled from recalled memory would otherwise force Vietnamese onto an English conversation).
        // A detectable language in a later refine turn overrides. `message_language` is the BRAIN's own
        // read of this message — the only signal that can tell Indonesian from English (same Latin
        // script), and it is filtered to Latin-blind-spot codes so it cannot re-open the memory bleed.
        goal = goalSpec.parse({ ...goal, slots: { ...goal.slots, language: contentLanguageFor(ctx.message, ctx.priorGoal?.slots.language ?? null, ctx.messageLanguage) } });
        // Lead-resolved recipient (P3): when find_lead matched a single lead this turn AND this is an email
        // goal, set the recipient FROM THE LEAD RECORD (never the model's text) + carry leadId so the writer
        // grounds on the lead and the send stamps nurturedAt. Non-email goals ignore it.
        if (ctx.resolvedLead && goal.outputs.needsEmail) {
          goal = goalSpec.parse({ ...goal, slots: { ...goal.slots, emailTo: ctx.resolvedLead.email, leadId: ctx.resolvedLead.leadId } });
        }
        const outcome = masterAgent.planFromGoal(goal);
        ctx.proposal = { goal, outcome };
        if (outcome.status === 'planned') return { status: 'planned', agents: outcome.plan.nodes.map((n) => n.agentId), steps: outcome.plan.nodes.length };
        if (outcome.status === 'awaiting_clarification') return { status: 'need_more_info', missing: outcome.questions.map((q) => q.slot) };
        return { status: 'error', error: outcome.error };
      }
      case 'propose_task': {
        const capability = str(args.capability).trim().toLowerCase().slice(0, 60);
        const target = TASK_CAPABILITIES[capability];
        if (!target) {
          // Deterministic capability-gap logging (the reliable path): the registry has NO node that produces
          // this capability, so the planner can't build anything for it. Record the request as demand HERE —
          // do NOT depend on the brain separately calling flag_capability_gap (it routinely skips that). The
          // planner/registry's own "I can't build this" is the ground-truth signal that a node is missing.
          const logged = capability
            ? await recordCapabilityGap(ctx.ownerId, capability, null, { exampleTask: (ctx.message || '').slice(0, 500) || undefined }).catch(() => false)
            : false;
          return { status: 'unsupported_logged', capability, logged, note: `No agent node can do "${capability}" yet — I've LOGGED this request as demand for the team to build. Tell the user plainly you can't do it yet but have flagged/recorded it, and offer what you CAN do instead. Do NOT pretend to do it.` };
        }
        const sourceText = str(args.source_text).trim();
        if (!sourceText) return { status: 'need_input', note: `Ask the user to paste or provide the text to ${capability}.` };
        // A non-marketing TASK goal: select backward from the utility's output artifact (taskTargets),
        // skip the marketing clarification engine, carry the source text in a slot for the runner.
        const goal = goalSpec.parse({
          taskTargets: [target],
          outputs: { needsTextPost: false, needsPublishing: false },
          // Summary language mirrors the chat, same rule as propose_workflow (no prior task-lang to carry).
          slots: { sourceText, language: contentLanguageFor(ctx.message, ctx.priorGoal?.slots.language ?? null, ctx.messageLanguage) },
          provider: 'atria-task',
        });
        const outcome = masterAgent.planFromGoal(goal, { skipClarification: true });
        ctx.proposal = { goal, outcome };
        if (outcome.status === 'planned') return { status: 'planned', agents: outcome.plan.nodes.map((n) => n.agentId), steps: outcome.plan.nodes.length };
        return { status: 'error', error: outcome.status === 'plan_error' ? outcome.error : 'could_not_plan' };
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

// Deterministic propose_workflow for a turn that parsed a schedule but never proposed anything (see the
// call site in atria-brain.ts). The KIND comes from `parseEmailIntent` rather than the brain, so this is a
// rescue, not a replacement: it only runs when the alternative is losing the schedule outright. Returns
// the proposal when one was built, else null (no schedule parsed, already proposed, or the plan failed).
export async function rescueScheduleProposal(ctx: ToolContext): Promise<{ goal: GoalSpec; outcome: MasterAgentOutcome } | null> {
  if (!ctx.scheduleProposal || ctx.proposal) return null;
  await dispatchTool('propose_workflow', {
    goal_description: ctx.message,
    kind: parseEmailIntent(ctx.message).isEmail ? 'email' : 'marketing',
    message_language: ctx.messageLanguage ?? '',
  }, ctx);
  // dispatchTool MUTATES ctx.proposal; the cast drops the narrowing TS still holds from the guard above.
  const built = ctx.proposal as ToolContext['proposal'];
  return built && built.outcome.status !== 'plan_error' ? built : null;
}
