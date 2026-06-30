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
import { createRunBody, clarifyRunBody, saveRunBody } from './schemas.ts';
import { masterAgent } from '../orchestration/master/master-agent.ts';
import { goalSpec, type GoalSpec } from '../orchestration/schemas/goal-spec.ts';
import { workflowPlan, type WorkflowPlan } from '../orchestration/schemas/workflow-plan.ts';
import { runWorkflow } from '../orchestration/executor/workflow-executor.ts';
import {
  createRun,
  createNodes,
  deleteNodes,
  getRunForOwner,
  getRunWithNodes,
  getLatestRunWithNodesForChat,
  listRuns,
  listSavedRuns,
  nameRun,
  replanRun,
  setRunStatus,
} from '../db/repos/workflow-run-repo.ts';
import { logger } from '../lib/logger.ts';
import { mergeAnswers, toRunDto, type ClarifyQuestions } from './orchestration-mappers.ts';
import type { MasterAgentOutcome } from '../orchestration/master/master-agent.ts';
import { ensureChatSession, recordTurn, summarizeAnswers } from './orchestration-chat.ts';
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

interface RespondExtras { questions?: ClarifyQuestions; assistantMessage?: string; requiredActions?: RequiredActionDto[] }
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
  const existing = body.chatSessionId ? await getLatestRunWithNodesForChat(sessionId, req.userId!) : null;
  const refine = existing && PRE_EXEC.has(existing.status);

  const outcome = refine
    ? await masterAgent.refine(goalSpec.parse(existing!.goal), body.message)
    : await masterAgent.handle(body.message);
  const assistantMessage = await recordTurn(sessionId, body.message, outcome);

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
    ? await recordTurn(run.chatSessionId, summarizeAnswers(body.answers), outcome)
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
  return respondRun(res, run.id, req.userId!);
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

  // Claim into running before responding so a double-click can't spawn two executors.
  await setRunStatus(run.id, 'running');
  launchWorkflow(run.id, req.userId!, goal, plan);
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
  ok(res, toRunDto(full));
}));
