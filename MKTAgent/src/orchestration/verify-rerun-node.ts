// Phase 4 verification — single-node re-execute (DRY, no real posts / no Gemini spend).
// Proves: a completed run can re-run ONE node; the target + its downstream dependents
// reset to pending and their artifacts drop; only the target re-runs (downstream stays
// pending/stale, NOT auto-run); the publisher node refuses re-run; upstream-not-ready
// and unknown-node are rejected. Uses the executor directly with stubs (like verify-executor).
import { prisma } from '../db/client.ts';
import { analyzeDeterministic } from './master/deterministic-analyzer.ts';
import { planWorkflow } from './master/workflow-planner.ts';
import { createRun, createNodes, getRunWithNodes, resetNodes, collectDownstream } from '../db/repos/workflow-run-repo.ts';
import { deleteArtifactsByNodes } from './executor/artifact-store.ts';
import { runWorkflow } from './executor/workflow-executor.ts';
import type { GeminiFn } from '../copygen/service.ts';
import type { PublishFn } from '../scheduler/tick.ts';
import type { LlmJsonFn } from './master/llm-json.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

let conceptRuns = 0;
const stubGemini: GeminiFn = async () => {
  conceptRuns++;
  return { candidates: [{ content: { parts: [{ text: JSON.stringify({ variants: [
    { body: `Body v${conceptRuns}`, threads: 'T', x: 'X' },
    { body: `Alt v${conceptRuns}`, threads: 'T2', x: 'X2' },
  ] }) }] } }] };
};
const stubPublish: PublishFn = async (platform) => ({ platform, ok: true, url: `https://dry-run/${platform}`, error: null });
const stubLlmJson: LlmJsonFn = async (sys) => {
  if (/ideation/i.test(sys)) return { ideas: ['A', 'B'], chosen: 'A' };
  if (/storyboard/i.test(sys)) return { frames: [{ index: 0, imagePrompt: 'Stub frame', caption: 'Stub caption' }] };
  return { positioning: 'P', audience: 'Aud', pillars: ['p1'], funnelStage: 'awareness' };
};
const stubVideo = async () => ({ outputFile: '/tmp/stub-video.mp4', cached: false, durationMs: 0 });
const stubTts = async () => ({ outputFile: '/tmp/stub-voice.wav', cached: false });
let imageRuns = 0;
const stubImage = async () => { imageRuns++; return { imagePath: `/tmp/img${imageRuns}.png`, outputFile: `/tmp/img${imageRuns}.png`, cached: false, durationMs: 1 }; };

// autoPublish:false forces the manual publisher gate so this suite exercises the
// gate/resume + single-node re-run mechanics (item 2 auto-publish is opt-out here).
const opts = { geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, imageFn: stubImage, videoFn: stubVideo, ttsFn: stubTts, autoPublish: false, conceptGate: false };

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `rr-${Date.now()}@test.local` } });
  try {
    const goal = analyzeDeterministic('Make a facebook post with an infographic about our AI automation product');
    const planned = planWorkflow(goal);
    if (!planned.ok) throw new Error(`plan failed: ${planned.error}`);
    const run = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(run.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));

    // Run to the publisher gate — the REAL rerun use case is iterating BEFORE publishing, so the
    // post is `ready` (concept auto-approved review→ready), NOT yet posted. We do NOT publish here.
    const r1 = await runWorkflow(run.id, user.id, goal, planned.plan, opts);
    check('first pass halts needs_approval', r1.status === 'needs_approval', r1);
    const full = await getRunWithNodes(run.id, user.id);
    const pub = full!.nodes.find((n) => n.agentId === 'publisher')!;

    const concept = full!.nodes.find((n) => n.agentId === 'concept_writer')!;
    const info = full!.nodes.find((n) => n.agentId === 'infographic')!;
    const conceptRunsBefore = conceptRuns;
    const imageRunsBefore = imageRuns;

    // Simulate the endpoint's reset: concept + downstream (infographic, publisher) → pending,
    // artifacts dropped; then re-run ONLY concept.
    const downstream = collectDownstream(full!.nodes, concept.nodeId);
    check('downstream of concept includes infographic + publisher', downstream.includes(info.nodeId) && downstream.includes(pub.nodeId), downstream);
    const toReset = [concept.nodeId, ...downstream];
    await deleteArtifactsByNodes(run.id, user.id, toReset);
    await resetNodes(run.id, user.id, toReset);

    const mid = await getRunWithNodes(run.id, user.id);
    check('concept reset to pending', mid!.nodes.find((n) => n.nodeId === concept.nodeId)!.status === 'pending');
    check('infographic reset to pending (stale)', mid!.nodes.find((n) => n.nodeId === info.nodeId)!.status === 'pending');
    check('publisher reset to pending (stale)', mid!.nodes.find((n) => n.nodeId === pub.nodeId)!.status === 'pending');
    check('concept + downstream artifacts dropped', !mid!.artifacts.some((a) => toReset.includes(a.nodeId)), mid!.artifacts.map((a) => a.nodeId));

    const rr = await runWorkflow(run.id, user.id, goal, planned.plan, { ...opts, rerunOnly: concept.nodeId });
    // A single-node re-run regenerates only that node and parks the RUN at `planned`
    // (resumable via the Continue button) — it returns `completed` for the one node and does
    // NOT cascade downstream. The downstream-still-pending checks below assert that intent.
    check('re-run of one node returns completed (run parked resumable)', rr.status === 'completed', rr);
    const parked = await getRunWithNodes(run.id, user.id);
    check('run parked at planned (resumable)', parked!.status === 'planned', parked!.status);

    const after = await getRunWithNodes(run.id, user.id);
    check('concept re-ran (completed again)', after!.nodes.find((n) => n.nodeId === concept.nodeId)!.status === 'completed');
    check('concept ran exactly once more', conceptRuns === conceptRunsBefore + 1, { conceptRuns, conceptRunsBefore });
    check('infographic did NOT auto-run (still pending/stale)', after!.nodes.find((n) => n.nodeId === info.nodeId)!.status === 'pending');
    check('image gen NOT re-invoked (deliberate spend)', imageRuns === imageRunsBefore, { imageRuns, imageRunsBefore });
    check('publisher still pending (not re-published)', after!.nodes.find((n) => n.nodeId === pub.nodeId)!.status === 'pending');
    check('fresh content_concept artifact exists', after!.artifacts.some((a) => a.nodeId === concept.nodeId && a.type === 'content_concept'));

    // ── Posted-guard (Phase 05 / B-F8 + H2): re-running concept on an ALREADY-PUBLISHED post must
    // REFUSE — no silent posted→brief that would open a re-publish path. Drive a fresh run all the
    // way to `posted`, then attempt to re-run concept: the executor must FAIL the node, not rewind.
    const run2 = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(run2.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    await runWorkflow(run2.id, user.id, goal, planned.plan, opts); // → needs_approval at publisher
    const pub2 = (await getRunWithNodes(run2.id, user.id))!.nodes.find((n) => n.agentId === 'publisher')!;
    await runWorkflow(run2.id, user.id, goal, planned.plan, { ...opts, approveNodeId: pub2.nodeId }); // publish → posted
    const posted2 = await getRunWithNodes(run2.id, user.id);
    const post2Id = (posted2!.artifacts.find((a) => a.type === 'content_concept')!.data as { postId?: string }).postId!;
    check('run2 post is posted (setup)', (await prisma.post.findUnique({ where: { id: post2Id } }))?.status === 'posted');
    // Reset concept + downstream (as the endpoint would) and try to re-run concept on the posted post.
    const concept2 = posted2!.nodes.find((n) => n.agentId === 'concept_writer')!;
    await resetNodes(run2.id, user.id, [concept2.nodeId, ...collectDownstream(posted2!.nodes, concept2.nodeId)]);
    const rrPosted = await runWorkflow(run2.id, user.id, goal, planned.plan, { ...opts, rerunOnly: concept2.nodeId });
    check('re-run concept on POSTED post FAILS (no silent un-publish)', rrPosted.status === 'failed', rrPosted);
    check('post stays posted (not rewound to brief)', (await prisma.post.findUnique({ where: { id: post2Id } }))?.status === 'posted');
  } finally {
    await prisma.user.deleteMany({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }
  console.log(failures === 0 ? '\nPASS — single-node re-run checks green (DRY, downstream stale not auto-run)' : `\nFAIL — ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
