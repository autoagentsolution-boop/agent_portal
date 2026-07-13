// Orchestration router (Milestone 1) — the goal-based agent workflow API. Flow:
//   POST /orchestration/runs            message → analyze + clarify + plan → run row
//   POST /orchestration/runs/:id/clarify answers → merge into goal → re-plan
//   POST /orchestration/runs/:id/approve planned → run executor (halts at gate)
//   POST /orchestration/runs/:id/approve-node/:nodeId  resume past an approval gate
//   GET  /orchestration/runs            tenant-scoped list
//   GET  /orchestration/runs/:id        run + nodes + artifacts
// TENANCY (T2): mounted behind requireAuth; every repo call scoped by req.userId.
// Publishing still runs the live publish path → the approve-node gate is the
// external-write control (brief §11.12).
import { Router } from 'express';
import { ok, fail, parseOr422, asyncHandler } from './http.ts';
import { usageTotals } from '../cost/llm-usage.ts';
import { buildPlanTiers } from '../orchestration/master/plan-tiers.ts';
import { createRunBody, clarifyRunBody, saveRunBody, applyTierBody, killSwitchBody } from './schemas.ts';
import { getKillSwitch, setExternalActionsPaused } from '../system/kill-switch.ts';
import { recordExternalAction } from '../connectors/audit/external-action-audit-log.ts';
import { masterAgent } from '../orchestration/master/master-agent.ts';
import { goalSpec, type GoalSpec } from '../orchestration/schemas/goal-spec.ts';
import { workflowPlan, type WorkflowPlan } from '../orchestration/schemas/workflow-plan.ts';
import { runWorkflow } from '../orchestration/executor/workflow-executor.ts';
import {
  createRun,
  createNodes,
  deleteNodes,
  deleteRun,
  getRunForOwner,
  getRunWithNodes,
  getLatestRunWithNodesForChat,
  listRuns,
  listSavedRuns,
  listResumableRuns,
  nameRun,
  renameRun,
  replanRun,
  setRunStatus,
  transitionRun,
  resetNodes,
  collectDownstream,
  getFlowCostRollup,
  agentCostAverages,
  grantAutonomy,
  markRunCrashed,
  setNodeStatus,
  cloneTemplateRun,
  parkScheduled,
  reparkScheduled,
  cancelScheduled,
  listScheduledRuns,
} from '../db/repos/workflow-run-repo.ts';
import { createCampaign } from '../db/repos/campaign-repo.ts';
import { materializeCalendar } from '../orchestration/master/campaign-materializer.ts';
import type { CalendarSlot } from '../orchestration/schemas/artifact-schemas.ts';
import { z } from 'zod';
import { issueGrantToken, verifyGrantToken } from './autonomy-grant-token.ts';
import { getPostByRunId, setPostSchedule } from '../db/repos/post-repo.ts';
import { publishNodeStatus } from '../events/bus.ts';
import { logRun } from '../db/client.ts';
import { deleteArtifactsByNodes } from '../orchestration/executor/artifact-store.ts';
import { getAgent, agentGate } from '../orchestration/registry/agent-registry.ts';
import { AGENTS } from '../orchestration/registry/agent-registry.ts';
import { AGENT_GROUPS } from '../orchestration/registry/agent-groups.ts';
import { VISION_AGENTS } from '../orchestration/registry/vision-agents.ts';
import { logger } from '../lib/logger.ts';
import { mergeAnswers, toRunDto, type ClarifyQuestions } from './orchestration-mappers.ts';
import type { MasterAgentOutcome } from '../orchestration/master/master-agent.ts';
import { ensureChatSession, recordTurn, recordAnswerTurn, recordSaveOffer, recordCampaignCreated, recordCampaignScopeClarify, summarizeAnswers, getChatHistory } from './orchestration-chat.ts';
import { runAtriaBrain } from '../orchestration/atria/atria-brain.ts';
import { recallForMessage, captureFromGoal } from '../memory/user-memory.ts';
import { resolveWorkspaceInstructionsBlock } from '../orchestration/prompts/resolve-instructions.ts';
import { buildLeadAwarenessNote } from '../leads/lead-readiness.ts';
import { detectCampaignIntent } from '../orchestration/master/campaign-intent.ts';
import { createCampaignFromFlow } from '../orchestration/master/campaign-from-flow.ts';
import { parsePlatforms } from '../orchestration/master/deterministic-analyzer.ts';
import { resolveConnections } from '../connectors/runtime/connection-resolver.ts';
import type { RequiredActionDto } from './schemas.ts';

export const orchestrationRouter: Router = Router();

// Persist a fresh MasterAgent outcome as a WorkflowRun (+ nodes when planned).
const persistOutcome = async (
  ownerId: string,
  chatSessionId: string,
  goal: GoalSpec,
  outcome: MasterAgentOutcome,
): Promise<{ id: string; questions?: ClarifyQuestions }> => {
  if (outcome.status === 'awaiting_clarification') {
    const run = await createRun({ ownerId, chatSessionId, goal, status: 'awaiting_clarification' });
    return { id: run.id, questions: outcome.questions };
  }
  if (outcome.status === 'plan_error') {
    const run = await createRun({ ownerId, chatSessionId, goal, status: 'failed' });
    return { id: run.id };
  }
  const run = await createRun({ ownerId, chatSessionId, goal, plan: outcome.plan, status: 'planned' });
  await createNodes(run.id, ownerId, outcome.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
  return { id: run.id };
};

// Re-plan an EXISTING run in place (clarification answers OR a conversational
// refinement). Clears old planned nodes first so a changed DAG doesn't duplicate.
// Returns the questions to surface when the outcome is awaiting_clarification.
const applyOutcomeToRun = async (
  runId: string,
  ownerId: string,
  goal: GoalSpec,
  outcome: MasterAgentOutcome,
): Promise<{ questions?: ClarifyQuestions }> => {
  await deleteNodes(runId, ownerId);
  if (outcome.status === 'planned') {
    await replanRun(runId, 'planned', goal, outcome.plan);
    await createNodes(runId, ownerId, outcome.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    return {};
  }
  if (outcome.status === 'awaiting_clarification') {
    await replanRun(runId, 'awaiting_clarification', goal, null);
    return { questions: outcome.questions };
  }
  await replanRun(runId, 'failed', goal, null);
  return {};
};

interface RespondExtras { questions?: ClarifyQuestions; assistantMessage?: string; requiredActions?: RequiredActionDto[]; campaignIntent?: boolean; createdCampaignId?: string; createdPostId?: string }
const respondRun = async (res: Parameters<typeof ok>[0], id: string, ownerId: string, extras: RespondExtras = {}): Promise<void> => {
  const full = await getRunWithNodes(id, ownerId);
  if (!full) { fail(res as never, 404, 'run_not_found'); return; }
  ok(res, toRunDto(full, extras));
};

// Execute a PLANNED (or re-runnable) instance run: resolve connections, then launch the executor. Shared
// by POST /runs/:id/execute (the "Duyệt & Chạy" button) AND the Atria brain's execute_workflow tool
// ("chạy đi"), so both trigger execution identically. Pure control — the caller renders the run.
type ExecResult =
  | { status: 'running' }
  | { status: 'needs_connection'; requiredActions: RequiredActionDto[] }
  | { status: 'error'; code: 404 | 409; error: string; detail?: string };

const executePlannedRun = async (
  runId: string,
  ownerId: string,
  opts: { autoPublish?: boolean; conceptGate?: boolean } = {},
): Promise<ExecResult> => {
  const run = await getRunForOwner(runId, ownerId);
  if (!run) return { status: 'error', code: 404, error: 'run_not_found' };
  if (run.kind === 'template') return { status: 'error', code: 409, error: 'template_not_executable', detail: 'this flow is a template — create a post to run it' };
  if (run.status === 'running' || run.status === 'needs_approval') return { status: 'error', code: 409, error: 'run_in_flight' };
  if (run.status !== 'planned' && run.status !== 'failed' && run.status !== 'needs_connection') return { status: 'error', code: 409, error: 'run_not_executable' };
  const goal = goalSpec.parse(run.goal);
  const plan: WorkflowPlan = workflowPlan.parse(run.plan);
  // Connection gate (§11.6/11.11): resolve every requiresConnection agent's platforms BEFORE spending.
  const resolution = await resolveConnections(ownerId, goal, plan);
  if (resolution.status !== 'resolved') {
    await setRunStatus(run.id, 'needs_connection');
    logger.info('wf_execute_gated_needs_connection', { runId: run.id, count: resolution.required.length });
    return { status: 'needs_connection', requiredActions: resolution.required };
  }
  // Claim into running before responding so a double-click / double-call can't spawn two executors.
  await setRunStatus(run.id, 'running');
  launchWorkflow(run.id, ownerId, goal, plan, opts);
  return { status: 'running' };
};

// A run is still in the conversational pre-execution phase (so a follow-up message
// refines it) until it has been approved/executed. needs_approval/running/completed
// are live executions — a new message there starts a fresh run instead.
const PRE_EXEC = new Set(['awaiting_clarification', 'planned', 'failed', 'planning']);

orchestrationRouter.post('/runs', asyncHandler(async (req, res) => {
  const body = parseOr422(res, createRunBody, req.body ?? {});
  if (!body) return;
  // Conversational unify: every run lives on a chat session (sidebar + history). Open
  // or reuse one, then author a natural reply for this turn alongside the run row.
  const sessionId = await ensureChatSession(req.userId!, body.chatSessionId, body.message);

  // Refinement vs fresh: if this chat already has a pre-execution run, treat the new
  // message as a follow-up — analyze it as a DELTA and merge onto the prior goal so
  // nothing already gathered (product/audience/platforms) is lost. Otherwise plan
  // from scratch.
  // A frozen Flow template is never refined in place — a new message forks a fresh run
  // so an approved blueprint can't be mutated by continued chat (kind guard is explicit
  // even though status='template' already fails PRE_EXEC).
  const existing = body.chatSessionId ? await getLatestRunWithNodesForChat(sessionId, req.userId!) : null;

  // Saved-flow reuse (item 2): once a flow is SAVED (kind=template), a follow-up asking
  // to create a campaign/post must bind to THAT flow — NOT fork a new flow. Detect the
  // intent and return the template run + a campaignIntent flag so the panel surfaces the
  // setup-campaign action (which creates a campaign with flowId=template.id). Without this
  // the message falls through to handle() and re-plans a brand-new flow (the fork bug).
  if (existing && existing.kind === 'template') {
    const templateGoal = goalSpec.parse(existing.goal);
    const intent = detectCampaignIntent(body.message, templateGoal);
    if (intent.isCreate) {
      // Option A: ACTUALLY create the campaign (+ optional first post) bound to this flow,
      // from the user's typed request — not just offer a button (which felt like a loop:
      // the user gave names and got the offer again). The panel navigates to the new
      // campaign board on createdCampaignId.
      // Honor an explicit platform override in the create message ("chỉ facebook") so a
      // campaign/post created under a FB+IG flow can still target just one platform.
      const platformOverride = parsePlatforms(body.message);
      const { campaign, post } = await createCampaignFromFlow(
        req.userId!, existing.id, templateGoal,
        { campaignName: intent.campaignName, postTitle: intent.postTitle },
        platformOverride,
      );
      const assistantMessage = await recordCampaignCreated(
        sessionId, body.message, existing.name, campaign.product, Boolean(post), templateGoal,
      );
      logger.info('wf_campaign_from_flow', { flowId: existing.id, campaignId: campaign.id, postId: post?.id ?? null });
      res.status(201);
      return respondRun(res, existing.id, req.userId!, {
        assistantMessage,
        campaignIntent: true,
        createdCampaignId: campaign.id,
        createdPostId: post?.id ?? undefined,
      });
    }
    // Ambiguous (create ask + a batch/calendar word): RECONFIRM single vs weekly before acting
    // instead of falling through to the brain (which would reproduce a whole new flow — the bug).
    if (intent.isAmbiguous) {
      const assistantMessage = await recordCampaignScopeClarify(sessionId, body.message, templateGoal);
      logger.info('wf_campaign_scope_clarify', { flowId: existing.id });
      res.status(201);
      return respondRun(res, existing.id, req.userId!, { assistantMessage });
    }
  }

  // Atria reasoning brain (P1a) — replaces the regex intent classifier + immediate marketing extraction.
  // The brain reasons over the conversation, calls tools (web search, workspace data, memory) as needed,
  // and returns EITHER a conversational reply (answer directly — the DEFAULT) or a workflow proposal
  // (planned/clarification outcome → flow card + approval gate). Marketing is no longer the default
  // frame; it's one tool the brain invokes only when a task actually needs a capability.
  const existingPreExec = existing && existing.kind !== 'template' && PRE_EXEC.has(existing.status) ? existing : null;

  // Recall (P3): durable facts about this user — fed to the brain's memory tool AND the marketing
  // analyzer inside propose_workflow so a known product/brand/audience pre-fills instead of re-asking.
  const memory = await recallForMessage(req.userId!, body.message).catch(() => ({ context: null, usedIds: [] }));
  // Instructions (P4): the user's workspace Instructions steer the brain's reasoning + proposals, not
  // only the downstream content agents. Resolved per-request and injected as a DYNAMIC preamble (never the
  // cached system prompt). Null when none set → Atria keeps its own default. Best-effort — never blocks.
  const instructions = await resolveWorkspaceInstructionsBlock(req.userId!).catch(() => null);
  // Conversation so far (excludes the current, not-yet-persisted message) so the brain deep-dives with
  // full multi-turn context.
  const prior = await getChatHistory(sessionId).catch(() => []);
  // Mid-setup: hand the in-progress run's goal to the brain so propose_workflow MERGES onto it (earlier
  // slots survive) instead of re-analyzing this turn's message in isolation. A PLANNED run's id lets the
  // brain's execute_workflow tool run the plan on screen when the user says "chạy đi".
  const priorGoal = existingPreExec ? goalSpec.parse(existingPreExec.goal) : null;
  const existingRunId = existingPreExec && existingPreExec.status === 'planned' ? existingPreExec.id : null;

  const turn = await runAtriaBrain({ message: body.message, ownerId: req.userId!, memoryContext: memory.context, instructions, sessionId, prior, priorGoal, existingRunId, voice: body.voice });

  // Conversational / general-reasoning / data-query answer — no plan.
  if (turn.kind === 'reply') {
    const text = appendSources(turn.text?.trim() || '…', turn.searched);
    await recordAnswerTurn(sessionId, body.message, text);
    await logRun('info', 'atria_reply', { searched: turn.searched.length, tools: turn.tools, rounds: turn.rounds, midSetup: Boolean(existingPreExec), execute: Boolean(turn.executeRunId) }, req.userId!).catch(() => {});
    // "chạy đi" — the brain's execute_workflow ran the plan already on screen. Trigger execution and
    // return THAT run (now running / needs_connection) so the UI reflects it, with the brain's reply.
    if (turn.executeRunId) {
      const exec = await executePlannedRun(turn.executeRunId, req.userId!);
      res.status(201);
      return respondRun(res, turn.executeRunId, req.userId!, {
        assistantMessage: text,
        requiredActions: exec.status === 'needs_connection' ? exec.requiredActions : undefined,
      });
    }
    // Side-question DURING setup: keep the in-progress plan run + its flow card visible — do NOT fork an
    // `answered` run that would become "latest" and shadow the plan (getLatestRunWithNodesForChat orders
    // by updatedAt desc). Answer inline, return the existing run so the card stays and the next turn
    // still refines it.
    if (existingPreExec) {
      res.status(201);
      return respondRun(res, existingPreExec.id, req.userId!, { assistantMessage: text });
    }
    // Standalone conversation: a reply-only `answered` run (no nodes, no plan card).
    const run = await createRun({ ownerId: req.userId!, chatSessionId: sessionId, goal: { intent: 'converse', message: body.message }, status: 'answered' });
    res.status(201);
    return respondRun(res, run.id, req.userId!, { assistantMessage: text });
  }

  // Workflow proposal — the brain assembled a DAG. Voice it via the existing conversation-author (keeps
  // the tuned plan-presentation + approval-ask copy), with lead-awareness on a FRESH marketing plan.
  const outcome = turn.outcome;
  await logRun('info', 'atria_proposal', { status: outcome.status, tools: turn.tools, rounds: turn.rounds, inPlace: Boolean(existingPreExec) }, req.userId!).catch(() => {});
  // Lead-awareness is a MARKETING-campaign nudge ("your post could collect leads"). It makes no sense on
  // an email goal (a birthday note / personal email doesn't collect leads) — skip it there so Atria never
  // brings up lead collection in the middle of a personal-email flow.
  const leadNote = !existingPreExec && outcome.status === 'planned' && !outcome.goal.outputs.needsEmail
    ? await buildLeadAwarenessNote(req.userId!, outcome.goal, body.message).catch(() => null)
    : null;
  const assistantMessage = await recordTurn(sessionId, body.message, outcome, req.userId!, leadNote);
  // Capture (P3): remember the goal's durable slots for next time. Fire-and-forget.
  void captureFromGoal(req.userId!, outcome.goal, sessionId).catch(() => {});

  // In-place when the chat already has a pre-execution run (the flow card evolves on ONE run as setup
  // progresses); a fresh proposal creates a new run.
  if (existingPreExec) {
    const { questions } = await applyOutcomeToRun(existingPreExec.id, req.userId!, outcome.goal, outcome);
    res.status(201);
    return respondRun(res, existingPreExec.id, req.userId!, { questions, assistantMessage });
  }
  const { id, questions } = await persistOutcome(req.userId!, sessionId, outcome.goal, outcome);
  res.status(201);
  await respondRun(res, id, req.userId!, { questions, assistantMessage });
}));

// Transparency footnote: when the brain grounded a reply with web search, name the sources it used so
// the answer reads like ChatGPT/Claude ("🔎 Sources: …") rather than an unattributed claim.
const appendSources = (text: string, searched: string[]): string =>
  searched.length ? `${text}\n\n🔎 ${searched.slice(0, 5).join(' · ')}` : text;

orchestrationRouter.post('/runs/:id/clarify', asyncHandler(async (req, res) => {
  const body = parseOr422(res, clarifyRunBody, req.body ?? {});
  if (!body) return;
  const run = await getRunForOwner(req.params.id, req.userId!);
  if (!run) return fail(res, 404, 'run_not_found');
  if (run.status !== 'awaiting_clarification') return fail(res, 409, 'run_not_awaiting_clarification');

  const prior = goalSpec.parse(run.goal);
  const merged = mergeAnswers(prior, body.answers);
  const outcome = masterAgent.planFromGoal(merged);
  // Record the clarification turn (user's answers → authored assistant reply) on the
  // same chat session the run belongs to, when present.
  const assistantMessage = run.chatSessionId
    ? await recordTurn(run.chatSessionId, summarizeAnswers(body.answers), outcome, req.userId!)
    : undefined;
  const { questions } = await applyOutcomeToRun(run.id, req.userId!, merged, outcome);
  return respondRun(res, run.id, req.userId!, { questions, assistantMessage });
}));

// Save a planned run as a named Saved Flow (no execution). The chat "Approve" button
// calls this; execution happens later from Active Flows via /execute.
orchestrationRouter.post('/runs/:id/save', asyncHandler(async (req, res) => {
  const body = parseOr422(res, saveRunBody, req.body ?? {});
  if (!body) return;
  const run = await getRunForOwner(req.params.id, req.userId!);
  if (!run) return fail(res, 404, 'run_not_found');
  if (run.status !== 'planned') return fail(res, 409, 'run_not_planned');
  const named = await nameRun(run.id, req.userId!, body.name.trim());
  if (!named) return fail(res, 409, 'run_not_planned');
  // P6: the flow is saved — the Master Agent now guides the user into using it. Record
  // a conversational offer turn (set up first campaign / run a test post / open flow) on
  // the run's chat session so it surfaces in-chat and survives restore. Best-effort:
  // never let the offer break the save (author already degrades, but guard persistence).
  let assistantMessage: string | undefined;
  if (run.chatSessionId) {
    try {
      assistantMessage = await recordSaveOffer(run.chatSessionId, body.name.trim(), goalSpec.parse(run.goal), req.userId!);
    } catch (e) {
      logger.warn('save_offer_record_failed', { runId: run.id, error: String(e instanceof Error ? e.message : e) });
    }
  }
  return respondRun(res, run.id, req.userId!, { assistantMessage });
}));

// Rename a saved flow (any status). Unlike /save (planned-only, the initial naming),
// this lets the user relabel a flow they've already executed. Reuses the {name} body.
orchestrationRouter.patch('/runs/:id', asyncHandler(async (req, res) => {
  const body = parseOr422(res, saveRunBody, req.body ?? {});
  if (!body) return;
  const named = await renameRun(req.params.id, req.userId!, body.name.trim());
  if (!named) return fail(res, 404, 'run_not_found');
  return respondRun(res, req.params.id, req.userId!);
}));

// Execute (or re-execute a failed) saved/planned flow. ASYNC by design: the DAG runs
// ideation→…→real image gen (~30-60s) then halts at the publisher gate. Running it on
// the request thread hangs the UI with no progress (the old "stuck Thinking" bug).
// Instead we flip status→running synchronously (so a concurrent execute 409s) and let
// the executor run detached — SSE (node.status) drives the live DAG; the panel refetches
// artifacts on the terminal event. All executor writes are keyed by runId → safe detached.
const launchWorkflow = (
  runId: string,
  ownerId: string,
  goal: GoalSpec,
  plan: WorkflowPlan,
  opts: Parameters<typeof runWorkflow>[4] = {},
): void => {
  void runWorkflow(runId, ownerId, goal, plan, opts).catch(async (e) => {
    const msg = String(e instanceof Error ? e.message : e);
    logger.error('wf_execute_detached_failed', { runId, error: msg });
    // Don't swallow (Phase 04 / B#2): a reject here means the run threw OUTSIDE the per-node
    // try/catch → it's wedged `running`. Surface it as `failed` so Atria/the UI sees the real
    // outcome instead of a hung HTTP 200. Best-effort; the reaper backstops a truly-dead process.
    try {
      if (await markRunCrashed(runId, `executor crashed: ${msg}`)) {
        publishNodeStatus(ownerId, { runId, nodeId: '-', agentId: '-', status: 'failed', error: 'executor crashed' });
      }
    } catch (e2) {
      logger.error('wf_execute_detached_recover_failed', { runId, error: String(e2).slice(0, 160) });
    }
  });
};

orchestrationRouter.post('/runs/:id/execute', asyncHandler(async (req, res) => {
  // Auto-publish (decision 2026-07-08): default OFF — a post halts at the approval gate for review.
  // Only pass an explicit body toggle through (UI switch); when the body omits it, leave undefined so
  // the executor falls back to the goal's NL flag (Atria honoring "đăng luôn") and otherwise the gate.
  const rawAutoPublish = (req.body as { autoPublish?: unknown } | undefined)?.autoPublish;
  const autoPublish = typeof rawAutoPublish === 'boolean' ? rawAutoPublish : undefined;
  // Concept selection gate default ON: pause after concept for the user to pick a version.
  const conceptGate = (req.body as { conceptGate?: unknown } | undefined)?.conceptGate !== false;

  const result = await executePlannedRun(req.params.id, req.userId!, { autoPublish, conceptGate });
  if (result.status === 'error') return fail(res, result.code, result.error, result.detail);
  if (result.status === 'needs_connection') return respondRun(res, req.params.id, req.userId!, { requiredActions: result.requiredActions });
  return respondRun(res, req.params.id, req.userId!);
}));

// Test-run a saved flow ("Run a test post"). A saved flow is a TEMPLATE (not directly executable —
// /execute 409s), so clone it into a throwaway INSTANCE and run THAT: concept_writer materializes a
// fresh campaign+post, the DAG runs to the publish gate. Fixes the chat offer that 409'd on the
// just-saved template. A non-template (legacy planned instance) runs in place.
orchestrationRouter.post('/runs/:id/test-run', asyncHandler(async (req, res) => {
  const run = await getRunForOwner(req.params.id, req.userId!);
  if (!run) return fail(res, 404, 'run_not_found');
  let target = run;
  if (run.kind === 'template') {
    const clone = await cloneTemplateRun(run.id, req.userId!);
    if (!clone) return fail(res, 409, 'template_clone_failed', 'could not clone this flow into a runnable instance');
    target = clone;
  } else if (run.status === 'running' || run.status === 'needs_approval') {
    return fail(res, 409, 'run_in_flight');
  }
  const goal = goalSpec.parse(target.goal);
  const plan: WorkflowPlan = workflowPlan.parse(target.plan);
  const resolution = await resolveConnections(req.userId!, goal, plan);
  if (resolution.status !== 'resolved') {
    await setRunStatus(target.id, 'needs_connection');
    return respondRun(res, target.id, req.userId!, { requiredActions: resolution.required });
  }
  await setRunStatus(target.id, 'running');
  launchWorkflow(target.id, req.userId!, goal, plan, {});
  return respondRun(res, target.id, req.userId!);
}));

// Grant Atria autonomy on a run (autonomy-hardening Phase 01). BACKEND-ENFORCED double-confirm:
// step 1 (no confirmationToken) issues one — the run is NOT yet granted; step 2 (echo the token)
// flips approvalMode → 'atria'. A single stray call therefore can never auto-enable autonomy.
// Once granted, the run executes its whole flow with no mid-flow approval gate (guardrails still
// hold + notify on any gap — see the executor policy). `scheduleConfirmed=true` re-confirms a
// finalized schedule so the Phase 03 scheduler may fire it. Every grant is audited.
orchestrationRouter.post('/runs/:id/grant-autonomy', asyncHandler(async (req, res) => {
  const run = await getRunForOwner(req.params.id, req.userId!);
  if (!run) return fail(res, 404, 'run_not_found');
  if (run.kind === 'template') return fail(res, 409, 'template_not_executable', 'this flow is a template — create a post to run it');
  if (run.status !== 'planned' && run.status !== 'failed' && run.status !== 'needs_connection') {
    return fail(res, 409, 'run_not_grantable', 'only a planned/executable run can be granted autonomy');
  }
  const body = (req.body ?? {}) as { confirmationToken?: unknown; scheduleConfirmed?: unknown };

  // Step 1 — no valid token yet: issue one and return WITHOUT granting (the required 2nd confirm).
  if (!verifyGrantToken(run.id, req.userId!, body.confirmationToken)) {
    return ok(res, { runId: run.id, pendingConfirmation: true, confirmationToken: issueGrantToken(run.id, req.userId!) });
  }

  // Step 2 — token verified: activate the grant + audit.
  const scheduleConfirmed = body.scheduleConfirmed === true;
  const granted = await grantAutonomy(run.id, req.userId!, scheduleConfirmed);
  if (!granted) return fail(res, 409, 'run_not_grantable');
  await logRun('info', 'atria_grant', { runId: run.id, approvalMode: 'atria', scheduleConfirmed }, req.userId!);
  logger.info('wf_autonomy_granted', { runId: run.id, scheduleConfirmed });
  return respondRun(res, run.id, req.userId!);
}));

// Materialize an approved content calendar (Atria Phase 03→04 bridge). The campaign_strategist run
// parks at its selection gate with a content_calendar artifact but NO campaign yet — this endpoint
// creates the campaign FROM the run's goal, materializes the user-edited slots into scheduled posts,
// and resolves the gate. Returns the new campaignId (the UI then runs the Phase-05 grant on it).
const materializeSlotSchema = z.object({
  index: z.number().int().nonnegative(),
  pillar: z.string().max(400).default(''),
  angle: z.string().max(2000).default(''),
  format: z.enum(['text', 'image', 'carousel', 'video']).default('image'),
  platforms: z.array(z.string()).default([]),
  hook: z.string().max(1000).default(''),
  rationale: z.string().max(2000).default(''),
  dayOffset: z.number().int().nonnegative().default(0),
});
const materializeCalendarBody = z.object({ slots: z.array(materializeSlotSchema).min(1).max(120) }).strict();

orchestrationRouter.post('/runs/:id/materialize-calendar', asyncHandler(async (req, res) => {
  const run = await getRunWithNodes(req.params.id, req.userId!);
  if (!run) return fail(res, 404, 'run_not_found');
  const strategistNode = run.nodes.find((n) => n.agentId === 'campaign_strategist');
  if (!strategistNode) return fail(res, 409, 'not_a_campaign_plan', 'this run has no campaign strategist step');
  const body = parseOr422(res, materializeCalendarBody, req.body ?? {});
  if (!body) return;

  const goal = goalSpec.parse(run.goal);
  const clean = (s?: string | null): string | null => (s && s.trim() ? s.trim() : null);
  const isBrand = goal.slots.accountType === 'business' || goal.slots.accountType === 'company';
  const campaign = await createCampaign({
    ownerId: req.userId!,
    flowId: run.id, // link the campaign to the strategist flow that produced its calendar
    product: goal.slots.product ?? 'Untitled product',
    angle: clean(goal.slots.angle),
    brandVoice: clean(goal.slots.brandVoice) ?? (isBrand ? 'Professional, trustworthy brand voice' : null),
    brandContext: clean(goal.slots.productDetails),
    language: clean(goal.slots.language),
    platforms: goal.platforms.length ? goal.platforms : ['facebook'],
  });

  const result = await materializeCalendar(campaign.id, req.userId!, body.slots as CalendarSlot[]);

  // Resolve the strategist selection gate — the calendar is approved; the materialized posts run
  // as their own flows now, so the planning run is complete.
  await setNodeStatus(strategistNode.id, 'completed');
  await setRunStatus(run.id, 'completed');
  // Surface partial failures (P1-4): a slot whose GoalSpec failed to plan is skipped, not silently
  // dropped — log the count + reasons so a materialized < requested count is explainable (the
  // response's `materialize.skipped` carries the per-slot detail for the UI).
  const skipped = result?.skipped ?? [];
  await logRun('info', 'atria_calendar_materialized', { runId: run.id, campaignId: campaign.id, posts: result?.posts.length ?? 0, requested: body.slots.length, skipped: skipped.length, skippedReasons: skipped.slice(0, 5) }, req.userId!);
  if (skipped.length) logger.warn('atria_materialize_partial', { campaignId: campaign.id, requested: body.slots.length, created: result?.posts.length ?? 0, skipped: skipped.length });

  ok(res, { campaignId: campaign.id, materialize: result });
}));

orchestrationRouter.post('/runs/:id/approve-node/:nodeId', asyncHandler(async (req, res) => {
  const run = await getRunForOwner(req.params.id, req.userId!);
  if (!run) return fail(res, 404, 'run_not_found');
  if (run.status !== 'needs_approval') return fail(res, 409, 'run_not_awaiting_approval');

  // Schedule gate (generic-scheduler node): approving the scheduler does NOT run inline — it PARKS the
  // run for a timed re-entry. Read the confirmed instant off the goal (set in chat via set_schedule +
  // the user's explicit confirm) and require it be a valid FUTURE time; then park (status='scheduled',
  // scheduledResumeAt) and let the resumeDueRuns cron re-enter the flow at its action when due.
  {
    const plan = workflowPlan.parse(run.plan);
    const targetNode = plan.nodes.find((n) => n.nodeId === req.params.nodeId);
    if (targetNode && agentGate(targetNode.agentId) === 'schedule') {
      const goal = goalSpec.parse(run.goal);
      // A body-supplied ISO instant (Reschedule/confirm UI) overrides the goal's parsed instant.
      const rawAt = (req.body as { scheduledAt?: unknown } | undefined)?.scheduledAt;
      const iso = typeof rawAt === 'string' && rawAt.trim() ? rawAt : goal.schedule?.at ?? null;
      const at = iso ? new Date(iso) : null;
      if (!at || Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
        return fail(res, 409, 'schedule_not_confirmed', 'confirm a valid future time before scheduling this run');
      }
      const parked = await parkScheduled(run.id, req.userId!, at, targetNode.nodeId);
      if (!parked) return fail(res, 409, 'run_not_awaiting_approval');
      await logRun('info', 'wf_scheduled', { runId: run.id, resumeAt: at.toISOString(), tz: goal.schedule?.timezone ?? null }, req.userId!);
      logger.info('wf_run_scheduled', { runId: run.id, resumeAt: at.toISOString() });
      return respondRun(res, run.id, req.userId!);
    }
  }

  // Optional schedule at the publish gate: the user may pick a FUTURE time. Set it on the run's
  // post BEFORE resuming so the executor's isScheduledFuture() parks the post `ready` (the scheduler
  // publishes it at that time) instead of publishing inline. A flow post is `ready` (concept already
  // auto-approved review→ready), so setting scheduledAt here is the only place to schedule it — the
  // review-gated /posts/:id/approve path no longer applies. Ignored on a past/invalid date.
  const rawSched = (req.body as { scheduledAt?: unknown } | undefined)?.scheduledAt;
  if (typeof rawSched === 'string' && rawSched.trim()) {
    const when = new Date(rawSched);
    if (!Number.isNaN(when.getTime()) && when.getTime() > Date.now()) {
      const post = await getPostByRunId(run.id);
      if (post) await setPostSchedule(post.id, req.userId!, when);
    }
  }
  const goal = goalSpec.parse(run.goal);
  const plan: WorkflowPlan = workflowPlan.parse(run.plan);
  // Resume past the approval gate, also detached (the publisher step itself can take
  // seconds). Flip to running first for the same double-submit guard as /execute.
  await setRunStatus(run.id, 'running');
  launchWorkflow(run.id, req.userId!, goal, plan, { approveNodeId: req.params.nodeId });
  return respondRun(res, run.id, req.userId!);
}));

// Re-run ONE node of a completed/failed run (control surface under a post): the user
// didn't like a step's output (e.g. the concept or the image) and wants that agent to
// run again before publishing. Guards: the node must exist, be re-runnable (completed or
// failed, not the publisher — that's the gated external write), and its upstream deps
// must be completed. We reset the node + its transitive dependents to pending (stale),
// delete their artifacts, then launch the executor in single-node mode. Downstream is
// NOT auto-run — the user re-runs each explicitly (keeps image/video spend deliberate).
orchestrationRouter.post('/runs/:id/rerun-node/:nodeId', asyncHandler(async (req, res) => {
  const full = await getRunWithNodes(req.params.id, req.userId!);
  if (!full) return fail(res, 404, 'run_not_found');
  if (full.status === 'running') return fail(res, 409, 'run_in_flight');

  const node = full.nodes.find((n) => n.nodeId === req.params.nodeId);
  if (!node) return fail(res, 404, 'node_not_found');
  // Block re-run only for the external-WRITE gate (publisher) — re-running it would re-publish.
  // An internal cost-gated step like video is re-runnable: a deliberate re-run is the user
  // choosing to spend, distinct from the automatic pre-video approval halt. Only the publisher
  // requiresConnection, so it uniquely identifies the external write.
  if (getAgent(node.agentId as Parameters<typeof getAgent>[0])?.requiresConnection) return fail(res, 409, 'node_not_rerunnable', 'the publish step runs via approval, not re-run');
  // A pending/awaiting node hasn't produced output to regenerate — after an upstream re-run leaves
  // downstream stale-pending, the user resumes with Continue (execute), NOT a per-node re-run. Guide
  // them there instead of a generic refusal (part of the chained-rerun confusion, P5 #1).
  if (node.status === 'pending' || node.status === 'awaiting_approval') {
    return fail(res, 409, 'node_not_run_yet', 'this step hasn’t run yet — click Continue to run it as part of the flow');
  }
  if (node.status !== 'completed' && node.status !== 'failed') return fail(res, 409, 'node_not_rerunnable', 'only a finished step can be re-run');

  // Upstream deps must be completed so the node has valid inputs to read.
  const byId = new Map(full.nodes.map((n) => [n.nodeId, n]));
  const depsReady = node.dependsOn.every((d) => byId.get(d)?.status === 'completed');
  if (!depsReady) return fail(res, 409, 'upstream_not_ready', 'run the earlier steps first');

  const goal = goalSpec.parse(full.goal);
  const plan: WorkflowPlan = workflowPlan.parse(full.plan);

  // Reset the target + everything downstream of it (now stale), and drop their artifacts.
  const downstream = collectDownstream(full.nodes, node.nodeId);
  const toReset = [node.nodeId, ...downstream];

  // Already-published guard (Phase 05 / H2): if the reset chain includes the publisher and the
  // attached post is already live, refuse — re-running would reach a re-pending publisher and
  // RE-POST a live post. Regenerating content for a posted post means creating a NEW post, not
  // rewinding the published one. (Re-publishing intentionally is a deliberate, separate action.)
  const resetHitsPublisher = toReset.some((nid) => {
    const n = byId.get(nid);
    return n && getAgent(n.agentId as Parameters<typeof getAgent>[0])?.requiresConnection;
  });
  if (resetHitsPublisher) {
    const post = await getPostByRunId(full.id);
    if (post && (post.status === 'posted' || post.status === 'partial' || post.status === 'posting')) {
      return fail(res, 409, 'already_posted', 'This post is already published — re-running would risk re-posting it. Create a new post to iterate on the content.');
    }
  }

  // ATOMIC CLAIM (P5 #1): reads above use the `full` snapshot; two rapid reruns (or a rerun racing a
  // resume/approve) could BOTH pass the not-running check and BOTH launch a detached executor, whose
  // overlapping node writes corrupt the run (the flaky "concept failed + infographic stuck pending").
  // Guard the transition on the exact status we read — only ONE caller wins the move to `running`; the
  // loser gets 409 and mutates nothing. Claim BEFORE resetting nodes so a losing rerun can't wipe state.
  const claimed = await transitionRun(full.id, req.userId!, full.status, 'running');
  if (!claimed) return fail(res, 409, 'run_in_flight', 'the run changed — refresh and try again');

  await deleteArtifactsByNodes(full.id, req.userId!, toReset);
  await resetNodes(full.id, req.userId!, toReset);

  launchWorkflow(full.id, req.userId!, goal, plan, { rerunOnly: node.nodeId });
  return respondRun(res, full.id, req.userId!);
}));

// Saved Flows list (named runs only) for the sidebar + Active Flows surface.
orchestrationRouter.get('/runs/saved', asyncHandler(async (req, res) => {
  const rows = await listSavedRuns(req.userId!);
  ok(res, rows.map((r) => ({ id: r.id, name: r.name, status: r.status, nodeCount: r.nodeCount, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })), { count: rows.length, nextCursor: null });
}));

orchestrationRouter.get('/runs', asyncHandler(async (req, res) => {
  const rows = await listRuns(req.userId!);
  ok(res, rows.map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })), { count: rows.length, nextCursor: null });
}));

// Resumable in-flight runs for the Command Center "Continue where you left off" cards: non-marketing
// Atria runs (email / task) paused mid-flight with no campaign, resumed by reopening their chat.
// Registered BEFORE /runs/:id so the static segment wins. Owner-scoped.
orchestrationRouter.get('/runs/resumable', asyncHandler(async (req, res) => {
  const rows = await listResumableRuns(req.userId!);
  ok(res, rows.map((r) => ({ id: r.id, name: r.name, status: r.status, chatSessionId: r.chatSessionId, updatedAt: r.updatedAt.toISOString() })), { count: rows.length, nextCursor: null });
}));

// Scheduled runs for the Scheduled page (generic-scheduler node): parked runs (status='scheduled')
// with their confirmed resume instant + timezone, soonest first. Registered BEFORE /runs/:id so the
// static segment wins. Owner-scoped.
orchestrationRouter.get('/runs/scheduled', asyncHandler(async (req, res) => {
  const rows = await listScheduledRuns(req.userId!);
  const items = rows.map((r) => {
    const goal = goalSpec.parse(r.goal);
    return {
      id: r.id,
      name: r.name ?? null,
      resumeAt: r.scheduledResumeAt ? r.scheduledResumeAt.toISOString() : null,
      timezone: goal.schedule?.timezone ?? null,
      phrase: goal.schedule?.phrase ?? null,
      action: (r.plan as { nodes?: Array<{ agentId: string }> } | null)?.nodes?.find((n) => n.agentId === 'email_agent' || n.agentId === 'publisher')?.agentId ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  });
  ok(res, items, { count: items.length, nextCursor: null });
}));

// Cancel a scheduled run before it fires. No-ops (409) if the cron already claimed it (now running).
orchestrationRouter.post('/runs/:id/cancel-schedule', asyncHandler(async (req, res) => {
  const cancelled = await cancelScheduled(req.params.id, req.userId!);
  if (!cancelled) return fail(res, 409, 'run_not_scheduled', 'this run is not scheduled (or already firing)');
  await logRun('info', 'wf_schedule_cancelled', { runId: req.params.id }, req.userId!);
  return respondRun(res, req.params.id, req.userId!);
}));

// Reschedule a parked run to a new confirmed future time. Body: { scheduledAt: ISO }. No-ops if the run
// is no longer `scheduled` (already firing/cancelled). Also updates the goal's schedule.at for consistency.
orchestrationRouter.post('/runs/:id/reschedule', asyncHandler(async (req, res) => {
  const rawAt = (req.body as { scheduledAt?: unknown } | undefined)?.scheduledAt;
  const at = typeof rawAt === 'string' && rawAt.trim() ? new Date(rawAt) : null;
  if (!at || Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
    return fail(res, 422, 'invalid_time', 'provide a valid future scheduledAt (ISO 8601)');
  }
  const run = await getRunForOwner(req.params.id, req.userId!);
  if (!run) return fail(res, 404, 'run_not_found');
  if (run.status !== 'scheduled') return fail(res, 409, 'run_not_scheduled', 'this run is not scheduled (or already firing)');
  const goal = goalSpec.parse(run.goal);
  const nextGoal = { ...goal, schedule: { ...(goal.schedule ?? { phrase: null, timezone: null }), at: at.toISOString(), confirmed: true } };
  await replanRun(run.id, run.status, nextGoal, (run.plan as object | null) ?? null);
  const reparked = await reparkScheduled(req.params.id, req.userId!, at);
  if (!reparked) return fail(res, 409, 'run_not_scheduled', 'this run is not scheduled (or already firing)');
  await logRun('info', 'wf_rescheduled', { runId: req.params.id, resumeAt: at.toISOString() }, req.userId!);
  return respondRun(res, req.params.id, req.userId!);
}));

// History restore: the latest run for a chat session (conversational unify). The
// panel calls this when the user reopens a chat that spawned a run. 404 → that chat
// has no run (legacy intake-only chat) → caller falls back to the master surface.
orchestrationRouter.get('/runs/by-chat/:chatSessionId', asyncHandler(async (req, res) => {
  const full = await getLatestRunWithNodesForChat(req.params.chatSessionId, req.userId!);
  if (!full) return fail(res, 404, 'run_not_found');
  ok(res, toRunDto(full));
}));

orchestrationRouter.get('/runs/:id', asyncHandler(async (req, res) => {
  const full = await getRunWithNodes(req.params.id, req.userId!);
  if (!full) return fail(res, 404, 'run_not_found');
  // Flow template → include the spend rolled up across all its instance runs (posts), so
  // the Flow detail renders as a real dashboard. Instance/draft runs just carry own cost.
  const flowCost = full.kind === 'template'
    ? await getFlowCostRollup(full.id, req.userId!)
    : undefined;
  ok(res, toRunDto(full, flowCost ? { flowCost } : {}));
}));

// Apply a chosen plan tier (Phase 03 checkpoint 2): rebuild the run's plan from the picked
// Economy/Balanced/Full variant so a subsequent execute runs THAT DAG. Only before execution
// (planned / awaiting_clarification) — a running/completed run can't be re-tiered.
orchestrationRouter.post('/runs/:id/apply-tier', asyncHandler(async (req, res) => {
  const body = parseOr422(res, applyTierBody, req.body ?? {});
  if (!body) return;
  const run = await getRunForOwner(req.params.id, req.userId!);
  if (!run) return fail(res, 404, 'run_not_found');
  if (run.status === 'running' || run.status === 'completed') return fail(res, 409, 'run_not_retierable', 'this run is already executing or finished');
  const owned = await agentCostAverages(req.userId!);
  const history = owned.length ? owned : await agentCostAverages();
  const tier = buildPlanTiers(goalSpec.parse(run.goal), history).find((t) => t.id === body.tierId);
  if (!tier) return fail(res, 422, 'tier_unavailable', `tier ${body.tierId} is not offered for this goal`);
  await deleteNodes(run.id, req.userId!);
  await replanRun(run.id, 'planned', run.goal as object, tier.plan);
  await createNodes(run.id, req.userId!, tier.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
  const full = await getRunWithNodes(run.id, req.userId!);
  ok(res, toRunDto(full!));
}));

// Kill switch — run abort (Phase 03 safety): flip the run to 'aborted' so the detached executor
// stops at the next node boundary. Idempotent; refused once the run is already terminal.
orchestrationRouter.post('/runs/:id/abort', asyncHandler(async (req, res) => {
  const run = await getRunForOwner(req.params.id, req.userId!);
  if (!run) return fail(res, 404, 'run_not_found');
  if (['completed', 'failed', 'aborted'].includes(run.status)) return fail(res, 409, 'run_terminal', `run already ${run.status}`);
  await setRunStatus(run.id, 'aborted');
  await recordExternalAction({ ownerId: req.userId!, runId: run.id, platform: 'system', actionKey: 'run.abort', status: 'ok', detail: { from: run.status } }).catch(() => {});
  ok(res, { id: run.id, status: 'aborted' });
}));

// Kill switch — global external-actions pause (Phase 03 safety). GET reads state; POST toggles
// (audited). When paused, the connector runtime refuses every external write platform-wide.
orchestrationRouter.get('/killswitch', asyncHandler(async (req, res) => {
  void req;
  ok(res, await getKillSwitch());
}));
orchestrationRouter.post('/killswitch', asyncHandler(async (req, res) => {
  const body = parseOr422(res, killSwitchBody, req.body ?? {});
  if (!body) return;
  const state = await setExternalActionsPaused(body.paused, req.userId!);
  await recordExternalAction({ ownerId: req.userId!, platform: 'system', actionKey: 'kill_switch.toggle', status: 'ok', detail: { paused: body.paused } }).catch(() => {});
  ok(res, state);
}));

// Multi-tier plan options for a run's goal (Phase 03 checkpoint 2): Economy / Balanced / Full,
// each with its agent list + a credit estimate from the owner's real history (global fallback for
// a new owner). Read-only preview — selecting a tier to run stays in the existing execute flow.
orchestrationRouter.get('/runs/:id/plan-tiers', asyncHandler(async (req, res) => {
  const run = await getRunForOwner(req.params.id, req.userId!);
  if (!run) return fail(res, 404, 'run_not_found');
  const owned = await agentCostAverages(req.userId!);
  const history = owned.length ? owned : await agentCostAverages();
  ok(res, { tiers: buildPlanTiers(goalSpec.parse(run.goal), history) });
}));

// Per-owner LLM/media spend — the billing/analysis view. Total + per-surface breakdown
// (chat, intake, copygen, research, lead_rescore, product_analysis, orchestration) from the
// mkt_llm_usage ledger (the authoritative cross-surface total, incl. real thinking tokens).
orchestrationRouter.get('/usage', asyncHandler(async (req, res) => {
  ok(res, await usageTotals(req.userId!));
}));

// Agent registry as display data — the "Neural Network" command-center view (Atria
// Phase 04) renders real nodes from this, so no decorative/fake agents. Groups carry
// their label/emoji/colour; agents carry persona metadata (emoji/group/vibe/status).
// Registry is global (not tenant-scoped); still behind requireAuth like the rest.
orchestrationRouter.get('/agents', asyncHandler(async (_req, res) => {
  ok(res, {
    groups: Object.values(AGENT_GROUPS),
    agents: [
      // Runnable agents (real DAG nodes) — live/stub from the registry.
      ...AGENTS.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        emoji: a.emoji ?? '🤖',
        group: a.group ?? 'creative',
        vibe: a.vibe ?? null,
        implStatus: a.implStatus as 'live' | 'stub' | 'planned',
        surface: null as string | null,
        requiresConnection: a.requiresConnection,
        requiresApproval: a.requiresApproval,
      })),
      // Vision agents (roadmap). Most are display-only 'planned'; one that shipped a real surface
      // (Memory, P2-2a) reports implStatus 'live' + a `surface` id → the UI makes it clickable.
      ...VISION_AGENTS.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        emoji: a.emoji,
        group: a.group,
        vibe: a.vibe,
        implStatus: (a.implStatus ?? 'planned') as 'live' | 'stub' | 'planned',
        surface: a.surface ?? null,
        requiresConnection: false,
        requiresApproval: false,
      })),
    ],
  });
}));

// Delete a run (Saved Flow). Cascades to its nodes + artifacts. A run mid-execution
// (running) is refused with 409 so a detached executor never writes to a deleted run.
orchestrationRouter.delete('/runs/:id', asyncHandler(async (req, res) => {
  const outcome = await deleteRun(req.params.id, req.userId!);
  if (outcome === 'not_found') return fail(res, 404, 'run_not_found');
  if (outcome === 'in_flight') return fail(res, 409, 'run_in_flight');
  res.status(204).end();
}));
