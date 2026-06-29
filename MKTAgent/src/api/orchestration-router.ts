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
  listRuns,
  setRunStatus,
} from '../db/repos/workflow-run-repo.ts';
import { mergeAnswers, toRunDto, type ClarifyQuestions } from './orchestration-mappers.ts';

export const orchestrationRouter: Router = Router();

// Persist a fresh MasterAgent outcome as a WorkflowRun (+ nodes when planned).
const persistOutcome = async (
  ownerId: string,
  chatSessionId: string | undefined,
  goal: GoalSpec,
  outcome: ReturnType<typeof masterAgent.planFromGoal>,
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

const respondRun = async (res: Parameters<typeof ok>[0], id: string, ownerId: string, questions?: ClarifyQuestions): Promise<void> => {
  const full = await getRunWithNodes(id, ownerId);
  if (!full) { fail(res as never, 404, 'run_not_found'); return; }
  ok(res, toRunDto(full, questions));
};

orchestrationRouter.post('/runs', asyncHandler(async (req, res) => {
  const body = parseOr422(res, createRunBody, req.body ?? {});
  if (!body) return;
  const outcome = await masterAgent.handle(body.message);
  const { id, questions } = await persistOutcome(req.userId!, body.chatSessionId, outcome.goal, outcome);
  res.status(201);
  await respondRun(res, id, req.userId!, questions);
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
  // Re-plan into the SAME run row (update goal/status + nodes if planned).
  if (outcome.status === 'planned') {
    await setRunStatus(run.id, 'planned', { goal: merged, plan: outcome.plan });
    await createNodes(run.id, req.userId!, outcome.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    return respondRun(res, run.id, req.userId!);
  }
  if (outcome.status === 'awaiting_clarification') {
    await setRunStatus(run.id, 'awaiting_clarification', { goal: merged });
    return respondRun(res, run.id, req.userId!, outcome.questions);
  }
  await setRunStatus(run.id, 'failed', { goal: merged });
  return respondRun(res, run.id, req.userId!);
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

orchestrationRouter.get('/runs/:id', asyncHandler(async (req, res) => {
  const full = await getRunWithNodes(req.params.id, req.userId!);
  if (!full) return fail(res, 404, 'run_not_found');
  ok(res, toRunDto(full));
}));
