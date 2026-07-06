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
import { createRunBody, clarifyRunBody, saveRunBody } from './schemas.ts';
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
  nameRun,
  renameRun,
  replanRun,
  setRunStatus,
  resetNodes,
  collectDownstream,
  getFlowCostRollup,
  agentCostAverages,
} from '../db/repos/workflow-run-repo.ts';
import { deleteArtifactsByNodes } from '../orchestration/executor/artifact-store.ts';
import { getAgent } from '../orchestration/registry/agent-registry.ts';
import { logger } from '../lib/logger.ts';
import { mergeAnswers, toRunDto, type ClarifyQuestions } from './orchestration-mappers.ts';
import type { MasterAgentOutcome } from '../orchestration/master/master-agent.ts';
import { ensureChatSession, recordTurn, recordSaveOffer, recordCampaignCreated, summarizeAnswers } from './orchestration-chat.ts';
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
  }

  const refine = existing && existing.kind !== 'template' && PRE_EXEC.has(existing.status);

  const outcome = refine
    ? await masterAgent.refine(goalSpec.parse(existing!.goal), body.message, req.userId!)
    : await masterAgent.handle(body.message, req.userId!);
  const assistantMessage = await recordTurn(sessionId, body.message, outcome, req.userId!);

  if (refine) {
    const { questions } = await applyOutcomeToRun(existing!.id, req.userId!, outcome.goal, outcome);
    res.status(201);
    return respondRun(res, existing!.id, req.userId!, { questions, assistantMessage });
  }

  const { id, questions } = await persistOutcome(req.userId!, sessionId, outcome.goal, outcome);
  res.status(201);
  await respondRun(res, id, req.userId!, { questions, assistantMessage });
}));

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
  void runWorkflow(runId, ownerId, goal, plan, opts).catch((e) => {
    logger.error('wf_execute_detached_failed', { runId, error: String(e instanceof Error ? e.message : e) });
  });
};

orchestrationRouter.post('/runs/:id/execute', asyncHandler(async (req, res) => {
  const run = await getRunForOwner(req.params.id, req.userId!);
  if (!run) return fail(res, 404, 'run_not_found');
  // A Flow template is an immutable blueprint — it is never executed directly. The user
  // creates a Post (which clones the template into an instance run) and executes that.
  if (run.kind === 'template') return fail(res, 409, 'template_not_executable', 'this flow is a template — create a post to run it');
  // Allow execute from planned, a re-run of a failed flow, OR a re-resolve after the
  // user connected a platform (needs_connection). Reject if already in flight.
  if (run.status === 'running' || run.status === 'needs_approval') return fail(res, 409, 'run_in_flight');
  if (run.status !== 'planned' && run.status !== 'failed' && run.status !== 'needs_connection') {
    return fail(res, 409, 'run_not_executable');
  }
  const goal = goalSpec.parse(run.goal);
  const plan: WorkflowPlan = workflowPlan.parse(run.plan);

  // Connection gate (§11.6/11.11): resolve every requiresConnection agent's platforms
  // against the user's connections BEFORE spending money. A gap stops the run here
  // ($0 — no executor, no image-gen) with the connect actions the UI needs.
  const resolution = await resolveConnections(req.userId!, goal, plan);
  if (resolution.status !== 'resolved') {
    await setRunStatus(run.id, 'needs_connection');
    logger.info('wf_execute_gated_needs_connection', { runId: run.id, count: resolution.required.length });
    return respondRun(res, run.id, req.userId!, { requiredActions: resolution.required });
  }

  // Auto-publish (item 2): default ON — a cleanly-postable post publishes with no Approve
  // step; the executor still halts for the publish review when some target can't take the
  // asset (item 1/3). Callers (e.g. verify scripts) may opt out with autoPublish=false to
  // force the manual gate. Only an explicit `false` disables it; anything else → default.
  const autoPublish = (req.body as { autoPublish?: unknown } | undefined)?.autoPublish !== false;
  // Concept selection gate default ON: pause after concept for the user to pick a version.
  const conceptGate = (req.body as { conceptGate?: unknown } | undefined)?.conceptGate !== false;

  // Claim into running before responding so a double-click can't spawn two executors.
  await setRunStatus(run.id, 'running');
  launchWorkflow(run.id, req.userId!, goal, plan, { autoPublish, conceptGate });
  return respondRun(res, run.id, req.userId!);
}));

orchestrationRouter.post('/runs/:id/approve-node/:nodeId', asyncHandler(async (req, res) => {
  const run = await getRunForOwner(req.params.id, req.userId!);
  if (!run) return fail(res, 404, 'run_not_found');
  if (run.status !== 'needs_approval') return fail(res, 409, 'run_not_awaiting_approval');
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
  await deleteArtifactsByNodes(full.id, req.userId!, toReset);
  await resetNodes(full.id, req.userId!, toReset);

  await setRunStatus(full.id, 'running');
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

// Delete a run (Saved Flow). Cascades to its nodes + artifacts. A run mid-execution
// (running) is refused with 409 so a detached executor never writes to a deleted run.
orchestrationRouter.delete('/runs/:id', asyncHandler(async (req, res) => {
  const outcome = await deleteRun(req.params.id, req.userId!);
  if (outcome === 'not_found') return fail(res, 404, 'run_not_found');
  if (outcome === 'in_flight') return fail(res, 409, 'run_in_flight');
  res.status(204).end();
}));
