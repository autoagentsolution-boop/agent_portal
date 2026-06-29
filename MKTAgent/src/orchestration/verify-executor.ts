// Phase 4 verification — full DRY-RUN execution of a planned DAG. NO real social
// posts and NO real Gemini spend: both the LLM call and the publish fn are stubbed
// (honors the DRY-RUN-only rule, memory feedback_no_burst_social_posts). Proves:
//   • executor runs nodes in order, halts BEFORE the publisher (approval gate)
//   • after approve-node, the run resumes and completes
//   • artifacts + node states + Post lifecycle persist correctly
// Creates one throwaway tenant, cleans up after.
import { prisma } from '../db/client.ts';
import { analyzeDeterministic } from './master/deterministic-analyzer.ts';
import { planWorkflow } from './master/workflow-planner.ts';
import { createRun, createNodes, getRunWithNodes } from '../db/repos/workflow-run-repo.ts';
import { runWorkflow } from './executor/workflow-executor.ts';
import type { GeminiFn } from '../copygen/service.ts';
import type { PublishFn } from '../scheduler/tick.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// Stub Gemini: return a well-formed copy-gen response (matches parseGeminiResponse
// expectations) so concept_writer reaches `review` without an API call.
const stubGemini: GeminiFn = async () => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ body: 'Stub body copy for the post.', threads: 'Stub threads.', x: 'Stub x.' }) }] } }],
});

// Stub publish: pretend each platform succeeded — NEVER touches a real platform.
const stubPublish: PublishFn = async (platform) => ({ platform, ok: true, url: `https://dry-run/${platform}`, error: null });

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `wf-exec-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const goal = analyzeDeterministic('Post about our AI automation product on facebook with an infographic');
    // Supply a Drive media id so the (stubbed) publish path has an asset to send;
    // assetType defaults to image (1 asset). Without this the live publisher
    // correctly fail-louds on empty heroFile (asserted separately below).
    goal.slots.heroFile = '1bo4diy3vlH9VmRE-78Z15ux9053-KZci';
    const planned = planWorkflow(goal);
    if (!planned.ok) { check('planner ok', false, planned); return; }

    const run = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(run.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));

    // First pass — should run concept_writer + infographic, then HALT at publisher.
    const r1 = await runWorkflow(run.id, user.id, goal, planned.plan, { geminiFn: stubGemini, publishFn: stubPublish });
    check('first pass halts needs_approval', r1.status === 'needs_approval', r1);
    if (r1.status === 'needs_approval') {
      const pub = planned.plan.nodes.find((n) => n.agentId === 'publisher')!;
      check('halt is at publisher node', r1.nodeId === pub.nodeId, r1.nodeId);
    }

    let full = await getRunWithNodes(run.id, user.id);
    check('run status needs_approval', full?.status === 'needs_approval', full?.status);
    check('concept_writer completed', full?.nodes.find((n) => n.agentId === 'concept_writer')?.status === 'completed');
    check('infographic completed', full?.nodes.find((n) => n.agentId === 'infographic')?.status === 'completed');
    check('publisher awaiting_approval', full?.nodes.find((n) => n.agentId === 'publisher')?.status === 'awaiting_approval');
    check('content_concept artifact stored', full?.artifacts.some((a) => a.type === 'content_concept') ?? false);
    check('NO publish_result yet (gate held)', !(full?.artifacts.some((a) => a.type === 'publish_result') ?? false));

    // Approve the publisher node → resume.
    const pub = planned.plan.nodes.find((n) => n.agentId === 'publisher')!;
    const r2 = await runWorkflow(run.id, user.id, goal, planned.plan, { geminiFn: stubGemini, publishFn: stubPublish, approveNodeId: pub.nodeId });
    check('second pass completes', r2.status === 'completed', r2);

    full = await getRunWithNodes(run.id, user.id);
    check('run completed', full?.status === 'completed', full?.status);
    check('publisher completed', full?.nodes.find((n) => n.agentId === 'publisher')?.status === 'completed');
    const pr = full?.artifacts.find((a) => a.type === 'publish_result');
    check('publish_result stored', Boolean(pr));
    check('publish_result status posted (stub)', (pr?.data as { status?: string })?.status === 'posted', pr?.data);

    // Confirm a real Post row was materialized + reached posted via the live path.
    const concept = full?.artifacts.find((a) => a.type === 'content_concept');
    const postId = (concept?.data as { postId?: string })?.postId;
    const post = postId ? await prisma.post.findFirst({ where: { id: postId, ownerId: user.id } }) : null;
    check('Post materialized + posted (dry)', post?.status === 'posted', post?.status);

    // Faithfulness: a goal WITHOUT media must fail-loud at the live publish path
    // (the executor does not bypass resolvePublishInput validation).
    const goal2 = analyzeDeterministic('Post about our AI automation product on facebook');
    const planned2 = planWorkflow(goal2);
    if (planned2.ok) {
      const run2 = await createRun({ ownerId: user.id, goal: goal2, plan: planned2.plan, status: 'planned' });
      await createNodes(run2.id, user.id, planned2.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
      await runWorkflow(run2.id, user.id, goal2, planned2.plan, { geminiFn: stubGemini, publishFn: stubPublish });
      const pub2 = planned2.plan.nodes.find((n) => n.agentId === 'publisher')!;
      const r2b = await runWorkflow(run2.id, user.id, goal2, planned2.plan, { geminiFn: stubGemini, publishFn: stubPublish, approveNodeId: pub2.nodeId });
      const full2 = await getRunWithNodes(run2.id, user.id);
      const pr2 = full2?.artifacts.find((a) => a.type === 'publish_result');
      check('no-media publish → result status error (faithful, not bypassed)', (pr2?.data as { status?: string })?.status === 'error', { outcome: r2b, pr: pr2?.data });
    }
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — executor DRY-RUN checks green (0 real posts, 0 Gemini spend)' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
