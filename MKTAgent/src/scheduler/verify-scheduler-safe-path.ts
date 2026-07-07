// Phase 03 verification — the scheduler as a SAFE publish path (C2). Proves the cron:
//   (a) is stopped by the global kill-switch, and audits the blocked attempt (§11);
//   (b) never publishes a post whose flow is parked at a gate (isPublishBlocked);
//   (c) never auto-fires an atria grant whose schedule wasn't re-confirmed;
//   (d) writes an external-action audit row on the runtime publish path.
// NO real posts / NO network: the kill-switch short-circuits BEFORE any adapter call, and the
// blocked cases never reach publish. Creates one throwaway tenant, cleans up after.
import { prisma } from '../db/client.ts';
import { runSchedulerTick } from './tick.ts';
import { isPublishBlocked, createRun, createNodes } from '../db/repos/workflow-run-repo.ts';
import { setExternalActionsPaused } from '../system/kill-switch.ts';
import { analyzeDeterministic } from '../orchestration/master/deterministic-analyzer.ts';
import { planWorkflow } from '../orchestration/master/workflow-planner.ts';
import type { PublishFn } from './tick.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// A stub publish that MUST NEVER be called in the blocked/skip cases — if it is, the guard failed.
let stubCalls = 0;
const stubPublish: PublishFn = async (platform) => { stubCalls++; return { platform, ok: true, url: `https://dry-run/${platform}`, error: null }; };

const pastDue = new Date(Date.now() - 60_000);

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `sched-safe-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const campaign = await prisma.campaign.create({ data: { ownerId: user.id, product: 'Filter', platforms: ['facebook'] } });
    const goal = analyzeDeterministic('Post about our product on facebook with an infographic');
    const planned = planWorkflow(goal);
    if (!planned.ok) { check('planner ok', false, planned); return; }

    // ── (a) Kill-switch blocks a scheduled publish + audits it. Post is standalone (no runId →
    // not gate-blocked) and due; the real runtime publish path (default) hits the kill-switch first.
    await setExternalActionsPaused(true, user.id);
    const pKill = await prisma.post.create({
      data: {
        campaignId: campaign.id, ownerId: user.id, status: 'ready', scheduledAt: pastDue,
        assetType: 'image', heroFile: 'local:stub.png', platforms: ['facebook'],
        copy: { body: 'hi', threads: 'hi', x: 'hi' },
      },
    });
    await runSchedulerTick(); // DEFAULT publish = runtimePublishFn (kill-switch + audit path)
    const afterKill = await prisma.post.findUnique({ where: { id: pKill.id } });
    check('(a) kill-switch → scheduled post ends error (not posted)', afterKill?.status === 'error', afterKill?.status);
    check('(a) kill-switch → post error mentions paused', /paused/i.test(afterKill?.error ?? ''), afterKill?.error);
    const auditRows = await prisma.externalActionAuditLog.count({ where: { ownerId: user.id, status: 'error' } });
    check('(d) blocked publish audited (§11 audit row written)', auditRows >= 1, auditRows);
    await setExternalActionsPaused(false, user.id);

    // ── (b) The B#3 case precisely: run is otherwise DONE but the publisher node is parked
    // awaiting_approval (post reached `ready` earlier). hasActiveFlowNodes (running/pending only)
    // MISSED this → cron published before media/approval. isPublishBlocked must catch the parked node.
    const runParked = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'completed' });
    await createNodes(runParked.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    const pubNode = planned.plan.nodes.find((n) => n.agentId === 'publisher')!;
    await prisma.workflowNodeRun.updateMany({ where: { runId: runParked.id }, data: { status: 'completed' } });
    await prisma.workflowNodeRun.updateMany({ where: { runId: runParked.id, nodeId: pubNode.nodeId }, data: { status: 'awaiting_approval' } });
    check('(b) isPublishBlocked true for publisher-parked run (hasActiveFlowNodes would miss it)', await isPublishBlocked(runParked.id));
    const pParked = await prisma.post.create({
      data: {
        campaignId: campaign.id, ownerId: user.id, runId: runParked.id, status: 'ready', scheduledAt: pastDue,
        assetType: 'image', heroFile: 'local:stub.png', platforms: ['facebook'],
        copy: { body: 'hi', threads: 'hi', x: 'hi' },
      },
    });
    stubCalls = 0;
    await runSchedulerTick(stubPublish);
    const afterParked = await prisma.post.findUnique({ where: { id: pParked.id } });
    check('(b) gate-parked post NOT published (stays ready)', afterParked?.status === 'ready', afterParked?.status);
    check('(b) publish fn never called for blocked post', stubCalls === 0, stubCalls);

    // ── (c) An atria grant whose schedule was NOT re-confirmed is not fired, even when the run is
    // fully terminal (completed, all nodes done). scheduleConfirmed=false must hold it.
    const runAtria = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'completed' });
    await createNodes(runAtria.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    await prisma.workflowNodeRun.updateMany({ where: { runId: runAtria.id }, data: { status: 'completed' } });
    await prisma.workflowRun.update({ where: { id: runAtria.id }, data: { approvalMode: 'atria', scheduleConfirmed: false } });
    check('(c) isPublishBlocked true for atria + unconfirmed schedule', await isPublishBlocked(runAtria.id));
    // And once re-confirmed, it is NO LONGER blocked (terminal run + all nodes done).
    await prisma.workflowRun.update({ where: { id: runAtria.id }, data: { scheduleConfirmed: true } });
    check('(c) isPublishBlocked false once schedule re-confirmed', !(await isPublishBlocked(runAtria.id)));
  } finally {
    await setExternalActionsPaused(false, user.id).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — scheduler safe-path checks green (0 real posts, 0 network)' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
