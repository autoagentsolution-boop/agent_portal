// Verify the Lead Nurture Agent driver (Phase 01) — DRY-RUN, 0 real sends, 0 LLM spend. One
// throwaway tenant + lead, a fixed synthetic clock (no real time passes), stubbed llmJsonFn/
// gmailSendFn threaded through the REAL executor (workflow-executor.ts/agent-runners.ts are
// untouched — this exercises them exactly as production would, just with injected seams).
//
// Covers: idempotent enroll, plan-a-touch (drafts + parks, never sends unattended), advance on an
// EXPLICITLY approved send, nextPlanAt += gapDays, touch 2 parks with a scheduled time, completion
// after the last touch, and no double-touch under overlapping claims.
//   npx tsx src/nurture/verify-nurture-drip.ts
import { prisma } from '../db/client.ts';
import { createLead } from '../db/repos/lead-repo.ts';
import { getRunForOwner } from '../db/repos/workflow-run-repo.ts';
import { runWorkflow, type ExecuteOptions } from '../orchestration/executor/workflow-executor.ts';
import { goalSpec } from '../orchestration/schemas/goal-spec.ts';
import { workflowPlan } from '../orchestration/schemas/workflow-plan.ts';
import { runNurtureOnce } from './nurture-runner.ts';
import { enrollLead, claimDueThread } from './nurture-thread-repo.ts';
import { DEFAULT_SEQUENCE } from './sequence.ts';

let failed = 0;
const ok = (cond: boolean, label: string, extra?: unknown): void => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`, cond || extra === undefined ? '' : JSON.stringify(extra));
  if (!cond) failed++;
};

const DAY = 24 * 60 * 60 * 1000;
let sendCount = 0;
const opts: ExecuteOptions = {
  llmJsonFn: async () => ({ subject: 'A note for you', body: 'Personalized nurture body.' }),
  gmailSendFn: async () => { sendCount++; return { id: `stub-msg-${sendCount}` }; },
};

// Simulate a human approving ONE gated node on a parked run (mirrors what the real /approve-node
// route + Phase 04's future approval inbox do) — fetches the LIVE run row, not a cached JS object,
// so this round-trips through the DB exactly like production.
const approveNode = async (runId: string, ownerId: string, nodeId: string) => {
  const run = await getRunForOwner(runId, ownerId);
  if (!run) throw new Error('run missing');
  const goal = goalSpec.parse(run.goal);
  const plan = workflowPlan.parse(run.plan);
  return runWorkflow(runId, ownerId, goal, plan, { ...opts, approveNodeId: nodeId });
};

async function main(): Promise<void> {
  const user = await prisma.user.create({
    data: { email: `nurture-${Date.now()}@test.local`, defaultLanguage: 'en', nurtureEnabled: true },
  });
  const ownerId = user.id;
  try {
    const lead = await createLead({
      ownerId, name: 'Nurture Test Lead', email: 'nurture-lead@example.com', phone: null,
      message: 'interested in the product', sourceProduct: 'Atria', source: 'form',
      calBookingUid: null, score: 70, scoreReasons: [],
    });

    const t0 = new Date('2026-01-01T00:00:00.000Z');

    console.log('enroll (idempotent)');
    const enrolledOnce = await runNurtureOnce(t0, 10, opts);
    ok(enrolledOnce.enrolled === 1, 'sweep enrolls the eligible lead', enrolledOnce);
    const dupe = await enrollLead(ownerId, lead.id, DEFAULT_SEQUENCE.id, t0);
    ok(dupe === null, 'a second enroll attempt is a no-op (idempotent, unique leadId)');
    const threadCount = await prisma.leadNurtureThread.count({ where: { ownerId } });
    ok(threadCount === 1, 'exactly one thread exists for the lead', threadCount);

    console.log('touch 0 — plan + park (no send without approval)');
    ok(enrolledOnce.planned === 1, 'the same sweep also planned touch 0 (nextPlanAt was due=now)', enrolledOnce);
    ok(sendCount === 0, 'touch 0 drafted but NOTHING sent yet (fail-closed)');
    let touch0 = await prisma.nurtureTouch.findFirst({ where: { threadId: (await prisma.leadNurtureThread.findFirstOrThrow({ where: { ownerId } })).id, index: 0 } });
    ok(!!touch0 && touch0.status === 'awaiting_approval' && !!touch0.runId, 'touch 0 parked awaiting_approval, linked to a run', touch0);
    ok(touch0?.scheduledAt === null, 'touch 0 has no scheduled time (immediate send path)');

    const run0 = await getRunForOwner(touch0!.runId!, ownerId);
    const plan0 = workflowPlan.parse(run0!.plan);
    ok(plan0.nodes.map((n) => n.agentId).join('->') === 'email_writer->email_agent', 'touch 0 plan is email_writer->email_agent', plan0.nodes.map((n) => n.agentId));
    const emailAgentNode0 = plan0.nodes.find((n) => n.agentId === 'email_agent')!.nodeId;

    console.log('touch 0 — explicit approval sends for real (stubbed Gmail)');
    const approve0 = await approveNode(touch0!.runId!, ownerId, emailAgentNode0);
    ok(approve0.status === 'completed', 'run completes once the send is approved', approve0);
    ok(sendCount === 1, 'exactly one send happened, only after approval');

    console.log('advance — touch 0 sent, nextPlanAt += 3d');
    const afterSend0 = await runNurtureOnce(t0, 10, opts);
    ok(afterSend0.advanced === 1, 'sweep detects the completed run and advances the thread', afterSend0);
    touch0 = await prisma.nurtureTouch.findUnique({ where: { id: touch0!.id } });
    ok(touch0?.status === 'sent' && touch0.sentAt !== null, 'touch 0 marked sent', touch0);
    let thread = await prisma.leadNurtureThread.findFirstOrThrow({ where: { ownerId } });
    ok(thread.touchNumber === 1, 'thread advanced to touchNumber=1', thread.touchNumber);
    const expectedNext = new Date(t0.getTime() + 3 * DAY).getTime();
    ok(thread.nextPlanAt !== null && thread.nextPlanAt.getTime() === expectedNext, `nextPlanAt = day+3 (${new Date(expectedNext).toISOString()})`, thread.nextPlanAt);
    ok(afterSend0.planned === 0, 'nothing else due yet at t0 (next touch is 3 days out)');

    console.log('touch 1 (day 3) — parks WITH a scheduled time');
    const t1 = new Date(t0.getTime() + 3 * DAY);
    const sweep1 = await runNurtureOnce(t1, 10, opts);
    ok(sweep1.planned === 1, 'sweep plans touch 1 once due', sweep1);
    const touch1 = await prisma.nurtureTouch.findFirst({ where: { threadId: thread.id, index: 1 } });
    ok(!!touch1 && touch1.status === 'awaiting_approval', 'touch 1 parked awaiting_approval', touch1);
    ok(touch1?.scheduledAt !== null && touch1!.scheduledAt!.getTime() === t1.getTime(), 'touch 1 carries the scheduled send time', touch1?.scheduledAt);
    const run1 = await getRunForOwner(touch1!.runId!, ownerId);
    const plan1 = workflowPlan.parse(run1!.plan);
    ok(plan1.nodes.map((n) => n.agentId).join('->') === 'email_writer->scheduler->email_agent', 'touch 1 plan splices the scheduler node', plan1.nodes.map((n) => n.agentId));
    ok(sendCount === 1, 'still only one send total — touch 1 has NOT sent');

    console.log('touch 1 — drive to sent (approve schedule gate, then the send gate)');
    const schedulerNode1 = plan1.nodes.find((n) => n.agentId === 'scheduler')!.nodeId;
    const emailAgentNode1 = plan1.nodes.find((n) => n.agentId === 'email_agent')!.nodeId;
    const afterSchedule1 = await approveNode(touch1!.runId!, ownerId, schedulerNode1);
    ok(afterSchedule1.status === 'needs_approval', 'clearing the schedule gate still halts at the send gate', afterSchedule1);
    ok(sendCount === 1, 'no send yet — only the schedule gate was cleared');
    const afterApprove1 = await approveNode(touch1!.runId!, ownerId, emailAgentNode1);
    ok(afterApprove1.status === 'completed', 'run completes once the send gate is approved');
    ok(sendCount === 2, 'second real send happened, only after explicit approval');
    const sweep1b = await runNurtureOnce(t1, 10, opts);
    ok(sweep1b.advanced === 1, 'sweep advances touch 1 to sent', sweep1b);
    thread = await prisma.leadNurtureThread.findFirstOrThrow({ where: { ownerId } });
    ok(thread.touchNumber === 2, 'thread advanced to touchNumber=2', thread.touchNumber);
    ok(thread.nextPlanAt !== null && thread.nextPlanAt.getTime() === t1.getTime() + 3 * DAY, 'nextPlanAt advanced another +3d');

    console.log('touch 2 (day 6, last touch) — send, then thread completes');
    const t2 = new Date(t1.getTime() + 3 * DAY);
    const sweep2 = await runNurtureOnce(t2, 10, opts);
    ok(sweep2.planned === 1, 'sweep plans the final touch', sweep2);
    const touch2 = await prisma.nurtureTouch.findFirst({ where: { threadId: thread.id, index: 2 } });
    const run2 = await getRunForOwner(touch2!.runId!, ownerId);
    const plan2 = workflowPlan.parse(run2!.plan);
    await approveNode(touch2!.runId!, ownerId, plan2.nodes.find((n) => n.agentId === 'scheduler')!.nodeId);
    await approveNode(touch2!.runId!, ownerId, plan2.nodes.find((n) => n.agentId === 'email_agent')!.nodeId);
    ok(sendCount === 3, 'third real send happened for the final touch');
    const sweep2b = await runNurtureOnce(t2, 10, opts);
    ok(sweep2b.advanced === 1, 'sweep advances the final touch to sent', sweep2b);
    thread = await prisma.leadNurtureThread.findFirstOrThrow({ where: { ownerId } });
    ok(thread.status === 'completed', 'thread status = completed after the last touch', thread.status);
    ok(thread.touchNumber === 3 && thread.nextPlanAt === null, 'touchNumber=3, nextPlanAt cleared (nothing left to plan)', thread);

    console.log('no double-touch under overlapping claims');
    const lead2 = await createLead({
      ownerId, name: 'Race Lead', email: 'race-lead@example.com', phone: null, message: null,
      sourceProduct: null, source: 'form', calBookingUid: null, score: 50, scoreReasons: [],
    });
    const raceThread = await enrollLead(ownerId, lead2.id, DEFAULT_SEQUENCE.id, t0);
    ok(raceThread !== null, 'race-test thread enrolled');
    const claims = await Promise.all([claimDueThread(t0), claimDueThread(t0), claimDueThread(t0)]);
    const won = claims.filter((c) => c !== null);
    ok(won.length === 1, 'exactly one of 3 concurrent claims wins the due thread', claims.map((c) => c?.id ?? null));
  } finally {
    await prisma.user.delete({ where: { id: ownerId } }).catch(() => {});
    console.log('cleanup: throwaway tenant removed (cascades leads/threads/touches/runs)');
  }

  console.log(failed === 0 ? '\nPASS — nurture-drip checks green (0 real sends, 0 LLM spend)' : `\nFAIL — ${failed} check(s) failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
