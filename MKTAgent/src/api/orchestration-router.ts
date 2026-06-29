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
import { createRunBody, clarifyRunBody } from './schemas.ts';
import { masterAgent } from '../orchestration/master/master-agent.ts';
import { goalSpec, type GoalSpec } from '../orchestration/schemas/goal-spec.ts';
import { workflowPlan, type WorkflowPlan } from '../orchestration/schemas/workflow-plan.ts';
import { runWorkflow } from '../orchestration/executor/workflow-executor.ts';
import {
  createRun,
  createNodes,
  getRunForOwner,
  getRunWithNodes,
  getLatestRunWithNodesForChat,
  listRuns,
  setRunStatus,
} from '../db/repos/workflow-run-repo.ts';
import { mergeAnswers, toRunDto, type ClarifyQuestions } from './orchestration-mappers.ts';
import type { MasterAgentOutcome } from '../orchestration/master/master-agent.ts';
import { ensureChatSession, recordTurn, summarizeAnswers } from './orchestration-chat.ts';

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

interface RespondExtras { questions?: ClarifyQuestions; assistantMessage?: string }
const respondRun = async (res: Parameters<typeof ok>[0], id: string, ownerId: string, extras: RespondExtras = {}): Promise<void> => {
  const full = await getRunWithNodes(id, ownerId);
  if (!full) { fail(res as never, 404, 'run_not_found'); return; }
  ok(res, toRunDto(full, extras));
};

orchestrationRouter.post('/runs', asyncHandler(async (req, res) => {
  const body = parseOr422(res, createRunBody, req.body ?? {});
  if (!body) return;
  // Conversational unify: every run lives on a chat session (sidebar + history). Open
  // or reuse one, then author a natural reply for this turn alongside the run row.
  const sessionId = await ensureChatSession(req.userId!, body.chatSessionId, body.message);
  const outcome = await masterAgent.handle(body.message);
  const assistantMessage = await recordTurn(sessionId, body.message, outcome);
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
  // Re-plan into the SAME run row (update goal/status + nodes if planned).
  if (outcome.status === 'planned') {
    await setRunStatus(run.id, 'planned', { goal: merged, plan: outcome.plan });
    await createNodes(run.id, req.userId!, outcome.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    return respondRun(res, run.id, req.userId!, { assistantMessage });
  }
  if (outcome.status === 'awaiting_clarification') {
    await setRunStatus(run.id, 'awaiting_clarification', { goal: merged });
    return respondRun(res, run.id, req.userId!, { questions: outcome.questions, assistantMessage });
  }
  await setRunStatus(run.id, 'failed', { goal: merged });
  return respondRun(res, run.id, req.userId!, { assistantMessage });
}));

orchestrationRouter.post('/runs/:id/approve', asyncHandler(async (req, res) => {
  const run = await getRunForOwner(req.params.id, req.userId!);
  if (!run) return fail(res, 404, 'run_not_found');
  if (run.status !== 'planned') return fail(res, 409, 'run_not_planned');
  const goal = goalSpec.parse(run.goal);
  const plan: WorkflowPlan = workflowPlan.parse(run.plan);
  await runWorkflow(run.id, req.userId!, goal, plan);
  return respondRun(res, run.id, req.userId!);
}));

orchestrationRouter.post('/runs/:id/approve-node/:nodeId', asyncHandler(async (req, res) => {
  const run = await getRunForOwner(req.params.id, req.userId!);
  if (!run) return fail(res, 404, 'run_not_found');
  if (run.status !== 'needs_approval') return fail(res, 409, 'run_not_awaiting_approval');
  const goal = goalSpec.parse(run.goal);
  const plan: WorkflowPlan = workflowPlan.parse(run.plan);
  await runWorkflow(run.id, req.userId!, goal, plan, { approveNodeId: req.params.nodeId });
  return respondRun(res, run.id, req.userId!);
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
