// Phase 04 verification — the self-healing reaper. Proves stuck rows are rescued and, crucially,
// that FRESH in-progress rows are NOT false-reaped (the real danger). Uses an injected `now` to age
// rows deterministically instead of raw-SQL backdating (@updatedAt would overwrite a set value).
// NO network. Creates one throwaway tenant, cleans up after.
import { prisma } from '../db/client.ts';
import { runReaperOnce } from './reaper.ts';
import { markRunCrashed } from '../db/repos/workflow-run-repo.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const plus = (base: Date, min: number): Date => new Date(base.getTime() + min * 60_000);

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `reaper-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  const now0 = new Date();
  try {
    const campaign = await prisma.campaign.create({ data: { ownerId: user.id, product: 'X', platforms: ['facebook'] } });
    const mkRun = (status: string) => prisma.workflowRun.create({ data: { ownerId: user.id, goal: {}, status } });
    const mkNode = (runId: string, agentId: string) =>
      prisma.workflowNodeRun.create({ data: { runId, ownerId: user.id, nodeId: 'n1', agentId, status: 'running', startedAt: now0 } });

    // Rows, all created FRESH at now0.
    const post = await prisma.post.create({ data: { campaignId: campaign.id, ownerId: user.id, status: 'posting', assetType: 'image', platforms: ['facebook'], copy: { body: 'x', threads: 'x', x: 'x' } } });
    const runNoNode = await mkRun('running');                    // run-timeout, no running node
    const runNode = await mkRun('running');                      // node-timeout cascade (concept)
    const nodeC = await mkNode(runNode.id, 'concept_writer');
    const runVideo = await mkRun('running');                     // video budget
    const nodeV = await mkNode(runVideo.id, 'video');

    // Step 1 — reaper at now0: NOTHING is stale yet (fresh). The false-positive guard.
    const r1 = await runReaperOnce(now0);
    check('fresh sweep reaps nothing', r1.postingReaped === 0 && r1.nodesReaped === 0 && r1.runsReaped === 0, r1);
    check('fresh posting post untouched', (await prisma.post.findUnique({ where: { id: post.id } }))?.status === 'posting');
    check('fresh running run untouched', (await prisma.workflowRun.findUnique({ where: { id: runNoNode.id } }))?.status === 'running');
    check('fresh running node untouched', (await prisma.workflowNodeRun.findUnique({ where: { id: nodeC.id } }))?.status === 'running');

    // Step 2 — +12 min: posting(10) + concept node(10) stale; video(30) + run(20) still within budget.
    const r2 = await runReaperOnce(plus(now0, 12));
    check('posting post reaped → error', (await prisma.post.findUnique({ where: { id: post.id } }))?.status === 'error', r2);
    check('stale concept node reaped → failed', (await prisma.workflowNodeRun.findUnique({ where: { id: nodeC.id } }))?.status === 'failed');
    check('concept node run cascaded → failed', (await prisma.workflowRun.findUnique({ where: { id: runNode.id } }))?.status === 'failed');
    check('video node WITHIN budget NOT reaped (no false positive)', (await prisma.workflowNodeRun.findUnique({ where: { id: nodeV.id } }))?.status === 'running');
    check('run WITHIN timeout NOT reaped', (await prisma.workflowRun.findUnique({ where: { id: runNoNode.id } }))?.status === 'running');

    // Step 3 — +35 min: run(20) and video node(30) now stale too.
    await runReaperOnce(plus(now0, 35));
    check('run past timeout reaped → failed', (await prisma.workflowRun.findUnique({ where: { id: runNoNode.id } }))?.status === 'failed');
    check('video node past budget reaped → failed', (await prisma.workflowNodeRun.findUnique({ where: { id: nodeV.id } }))?.status === 'failed');
    check('video node run cascaded → failed', (await prisma.workflowRun.findUnique({ where: { id: runVideo.id } }))?.status === 'failed');

    // Step 4 — detached-crash recovery: markRunCrashed fails the run + its running node directly.
    const runCrash = await mkRun('running');
    const nodeCrash = await mkNode(runCrash.id, 'infographic');
    const crashed = await markRunCrashed(runCrash.id, 'boom');
    check('markRunCrashed reaps the run', crashed === true);
    check('crashed run → failed', (await prisma.workflowRun.findUnique({ where: { id: runCrash.id } }))?.status === 'failed');
    check('crashed run running node → failed', (await prisma.workflowNodeRun.findUnique({ where: { id: nodeCrash.id } }))?.status === 'failed');

    // Step 5 — orphan surfacing: a needs_approval run past the TTL is FOUND (logged) but NOT deleted.
    const orphan = await mkRun('needs_approval');
    const r5 = await runReaperOnce(plus(now0, 8 * 24 * 60)); // +8 days
    check('orphan run surfaced (found)', r5.orphansFound >= 1, r5.orphansFound);
    check('orphan run NOT deleted (still present, needs_approval)', (await prisma.workflowRun.findUnique({ where: { id: orphan.id } }))?.status === 'needs_approval');
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — reaper checks green (no false reaping; 0 network)' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
