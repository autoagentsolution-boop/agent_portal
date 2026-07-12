// Generic-scheduler node verification (Phase 07) — proves the whole deferred-execution path DRY:
//   1. Planner: a CONFIRMED schedule splices [email_writer, scheduler, email_agent]; none → unchanged.
//   2. Executor gate: reaching the scheduler HALTS (needs_approval), draft produced, NOTHING sent.
//   3. Park: approving the schedule gate → status='scheduled', scheduler node completed, no send.
//   4. Re-entry: a due parked run resumes and the action (email_agent) runs EXACTLY ONCE (stub gmail).
//   5. Double-fire: two concurrent resume ticks → still exactly one send (advisory lock + atomic claim).
//   6. Coexist: the generic cron ignores runs with no scheduler node (a completed/publisher run).
//   7. Guards: an unconfirmed scheduled run is never claimed; a resume failure ends `failed` (no re-queue).
// NO real emails, NO LLM spend: the writer LLM + Gmail send are stubbed. One throwaway tenant, cleaned up.
import { prisma } from '../../db/client.ts';
import {
  createRun, createNodes, parkScheduled, claimScheduledDue, cancelScheduled, getRunForOwner,
} from '../../db/repos/workflow-run-repo.ts';
import { runWorkflow, type ExecuteOptions } from './workflow-executor.ts';
import { runResumeDueTick } from '../../scheduler/resume-due-runs.ts';
import { analyzeDeterministic } from '../master/deterministic-analyzer.ts';
import { planWorkflow } from '../master/workflow-planner.ts';
import { agentIdList, workflowPlan, type WorkflowPlan } from '../schemas/workflow-plan.ts';
import { goalSpec, type GoalSpec } from '../schemas/goal-spec.ts';
import type { GmailSendFn } from '../../email/gmail-send.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// Stub writer LLM (canned draft, no Gemini call) + a counting Gmail send (no real email).
let sends = 0;
const draftStub = async () => ({ subject: 'Chúc mừng sinh nhật!', body: 'Chào Lam,\n\nChúc mừng sinh nhật nha!' });
const sendOk: GmailSendFn = async () => { sends++; return { id: `stub-${sends}` }; };
const sendThrow: GmailSendFn = async () => { sends++; throw new Error('gmail token expired (401)'); };
const stubOpts = (send: GmailSendFn): ExecuteOptions => ({ llmJsonFn: draftStub, gmailSendFn: send });

const past = new Date(Date.now() - 60_000);

// Build a confirmed-scheduled email goal + its plan.
const scheduledEmailGoal = (): GoalSpec => {
  const base = analyzeDeterministic('Gửi email chúc mừng sinh nhật cho bạn tôi, email lam.nguyen@example.com, vui vẻ thân mật');
  return goalSpec.parse({ ...base, schedule: { at: new Date(Date.now() + 3_600_000).toISOString(), phrase: 'sáng mai', timezone: 'Asia/Bangkok', confirmed: true } });
};

// Setup a run through halt → park (past due), returning its id + the scheduler node id.
async function haltAndPark(ownerId: string, goal: GoalSpec, plan: WorkflowPlan): Promise<string> {
  const run = await createRun({ ownerId, goal, plan, status: 'planned' });
  await createNodes(run.id, ownerId, plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
  await runWorkflow(run.id, ownerId, goal, plan, stubOpts(sendOk)); // halts at scheduler gate
  const schedulerNode = plan.nodes.find((n) => n.agentId === 'scheduler')!;
  await parkScheduled(run.id, ownerId, past, schedulerNode.nodeId);
  return run.id;
}

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `sched-node-${Date.now()}@test.local`, defaultLanguage: 'vi' } });
  try {
    // ── 1. Planner splice ──────────────────────────────────────────────────────────────────────
    const goal = scheduledEmailGoal();
    const planned = planWorkflow(goal);
    check('(1) confirmed schedule → email_writer→scheduler→email_agent',
      planned.ok && agentIdList(planned.plan).join('→') === 'email_writer→scheduler→email_agent',
      planned.ok ? agentIdList(planned.plan) : planned.error);
    const noSched = planWorkflow(goalSpec.parse({ ...goal, schedule: { ...goal.schedule, confirmed: false } }));
    check('(1) unconfirmed schedule → email_writer→email_agent (no scheduler)',
      noSched.ok && agentIdList(noSched.plan).join('→') === 'email_writer→email_agent',
      noSched.ok ? agentIdList(noSched.plan) : noSched.error);
    if (!planned.ok) return;
    const plan = workflowPlan.parse(planned.plan);
    const schedulerNode = plan.nodes.find((n) => n.agentId === 'scheduler')!;

    // ── 2. Executor gate HALT (draft produced, nothing sent) ─────────────────────────────────────
    sends = 0;
    const run = await createRun({ ownerId: user.id, goal, plan, status: 'planned' });
    await createNodes(run.id, user.id, plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    const halt = await runWorkflow(run.id, user.id, goal, plan, stubOpts(sendOk));
    check('(2) run HALTS at the scheduler gate', halt.status === 'needs_approval' && halt.nodeId === schedulerNode.nodeId, halt);
    const afterHalt = await getRunForOwner(run.id, user.id);
    check('(2) run status needs_approval', afterHalt?.status === 'needs_approval', afterHalt?.status);
    check('(2) NO email sent at the gate', sends === 0, sends);
    const draftArtifact = await prisma.artifact.findFirst({ where: { runId: run.id, type: 'email_draft' } });
    check('(2) email draft produced for review', Boolean(draftArtifact));

    // ── 3. Park on approve ───────────────────────────────────────────────────────────────────────
    const parked = await parkScheduled(run.id, user.id, past, schedulerNode.nodeId);
    check('(3) approve schedule gate → status=scheduled', parked?.status === 'scheduled', parked?.status);
    check('(3) scheduledResumeAt + scheduleConfirmed set', Boolean(parked?.scheduledResumeAt) && parked?.scheduleConfirmed === true);
    const schedNodeRow = await prisma.workflowNodeRun.findFirst({ where: { runId: run.id, nodeId: schedulerNode.nodeId } });
    check('(3) scheduler node marked completed (resume-safe skip)', schedNodeRow?.status === 'completed', schedNodeRow?.status);
    check('(3) still no send after park', sends === 0, sends);

    // ── 6. Coexist: a completed run (publisher-style) is NOT claimed by the generic cron ──────────
    const completedRun = await createRun({ ownerId: user.id, goal: scheduledEmailGoal(), status: 'completed' });
    void completedRun; // its mere existence must not be picked (status != scheduled) — asserted via claim below

    // ── 4 + 5. Re-entry + double-fire: two concurrent ticks → EXACTLY ONE send ────────────────────
    sends = 0;
    const [t1, t2] = await Promise.all([runResumeDueTick(stubOpts(sendOk)), runResumeDueTick(stubOpts(sendOk))]);
    check('(5) exactly one email sent across two concurrent ticks', sends === 1, sends);
    const picks = [t1, t2].filter((t) => t.picked && t.runId === run.id);
    check('(4) the parked run was resumed', picks.length === 1, [t1, t2]);
    const afterResume = await getRunForOwner(run.id, user.id);
    check('(4) resumed run completed', afterResume?.status === 'completed', afterResume?.status);
    const emailResult = await prisma.artifact.findFirst({ where: { runId: run.id, type: 'email_result' } });
    check('(4) email_result artifact written (action ran unattended)', Boolean(emailResult));

    // ── 7a. Unconfirmed scheduled run is NEVER claimed ───────────────────────────────────────────
    const unconfirmed = await createRun({ ownerId: user.id, goal: scheduledEmailGoal(), plan, status: 'planned' });
    await prisma.workflowRun.update({ where: { id: unconfirmed.id }, data: { status: 'scheduled', scheduledResumeAt: past, scheduleConfirmed: false } });
    const claim = await claimScheduledDue(new Date());
    check('(7a) unconfirmed + completed runs never claimed', claim === null || (claim.id !== unconfirmed.id && claim.id !== completedRun.id), claim?.id);
    await prisma.workflowRun.update({ where: { id: unconfirmed.id }, data: { status: 'cancelled', scheduledResumeAt: null } });

    // ── 7b. A resume FAILURE ends `failed`, not re-queued (no infinite loop) ──────────────────────
    sends = 0;
    const failRunId = await haltAndPark(user.id, scheduledEmailGoal(), plan);
    const fx = await runResumeDueTick(stubOpts(sendThrow));
    check('(7b) resume attempted the send', sends === 1, sends);
    check('(7b) failed run reported', fx.picked && fx.runId === failRunId && fx.status === 'failed', fx);
    const failed = await getRunForOwner(failRunId, user.id);
    check('(7b) run ends failed (not back to scheduled)', failed?.status === 'failed', failed?.status);
    const reclaim = await claimScheduledDue(new Date());
    check('(7b) failed run not re-queued', reclaim?.id !== failRunId, reclaim?.id);
    if (reclaim) await prisma.workflowRun.update({ where: { id: reclaim.id }, data: { status: 'cancelled' } }).catch(() => {});

    // ── Cancel guard: cancel only affects a `scheduled` run ───────────────────────────────────────
    check('(cancel) cancel no-ops on a completed run', (await cancelScheduled(run.id, user.id)) === null);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — scheduler-node checks green (0 real emails, 0 LLM spend)' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
