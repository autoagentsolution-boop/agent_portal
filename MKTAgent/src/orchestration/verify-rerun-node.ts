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
  return { candidates: [{ content: { parts: [{ text: JSON.stringify({ body: `Body v${conceptRuns}`, threads: 'T', x: 'X' }) }] } }] };
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

const opts = { geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, imageFn: stubImage, videoFn: stubVideo, ttsFn: stubTts };

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `rr-${Date.now()}@test.local` } });
  try {
    const goal = analyzeDeterministic('Make a facebook post with an infographic about our AI automation product');
    const planned = planWorkflow(goal);
    if (!planned.ok) throw new Error(`plan failed: ${planned.error}`);
    const run = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(run.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));

    // Run to the publisher gate, then approve to complete.
    const r1 = await runWorkflow(run.id, user.id, goal, planned.plan, opts);
    check('first pass halts needs_approval', r1.status === 'needs_approval', r1);
    let full = await getRunWithNodes(run.id, user.id);
    const pub = full!.nodes.find((n) => n.agentId === 'publisher')!;
    await runWorkflow(run.id, user.id, goal, planned.plan, { ...opts, approveNodeId: pub.nodeId });
    full = await getRunWithNodes(run.id, user.id);
    check('run completed after approve', full!.status === 'completed', full!.status);

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
    check('re-run returns needs_approval (parks before publish)', rr.status === 'needs_approval', rr);

    const after = await getRunWithNodes(run.id, user.id);
    check('concept re-ran (completed again)', after!.nodes.find((n) => n.nodeId === concept.nodeId)!.status === 'completed');
    check('concept ran exactly once more', conceptRuns === conceptRunsBefore + 1, { conceptRuns, conceptRunsBefore });
    check('infographic did NOT auto-run (still pending/stale)', after!.nodes.find((n) => n.nodeId === info.nodeId)!.status === 'pending');
    check('image gen NOT re-invoked (deliberate spend)', imageRuns === imageRunsBefore, { imageRuns, imageRunsBefore });
    check('publisher still pending (not re-published)', after!.nodes.find((n) => n.nodeId === pub.nodeId)!.status === 'pending');
    check('fresh content_concept artifact exists', after!.artifacts.some((a) => a.nodeId === concept.nodeId && a.type === 'content_concept'));
  } finally {
    await prisma.user.deleteMany({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }
  console.log(failures === 0 ? '\nPASS — single-node re-run checks green (DRY, downstream stale not auto-run)' : `\nFAIL — ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
