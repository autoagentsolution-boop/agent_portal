// Concept selection gate — DRY-RUN. Proves the run PAUSES right after concept_writer produces
// its versions (conceptGate default), exposes 3-5 variants on the artifact, keeps downstream
// pending + the post unapproved, and RESUMES to media/publish on approve-node(concept) after a
// version is selected. No real Gemini/social. Run: npx tsx src/orchestration/verify-concept-gate.ts
import { prisma } from '../db/client.ts';
import { analyzeDeterministic } from './master/deterministic-analyzer.ts';
import { planWorkflow } from './master/workflow-planner.ts';
import { createRun, createNodes, getRunWithNodes } from '../db/repos/workflow-run-repo.ts';
import { runWorkflow } from './executor/workflow-executor.ts';
import { listArtifacts, updateArtifactData } from './executor/artifact-store.ts';
import { editPostCopy, setPostReferenceImage } from '../db/repos/post-repo.ts';
import type { GeminiFn } from '../copygen/service.ts';
import type { PublishFn } from '../scheduler/tick.ts';
import type { LlmJsonFn } from './master/llm-json.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const stubGemini: GeminiFn = async () => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ variants: [
    { body: 'Version ONE body.', threads: 'v1 threads', x: 'v1 x' },
    { body: 'Version TWO body.', threads: 'v2 threads', x: 'v2 x' },
    { body: 'Version THREE body.', threads: 'v3 threads', x: 'v3 x' },
  ] }) }] } }],
});
const stubPublish: PublishFn = async (platform) => ({ platform, ok: true, url: `https://dry-run/${platform}`, error: null });
const stubLlmJson: LlmJsonFn = async (sys) => {
  if (/ideation/i.test(sys)) return { ideas: ['A', 'B'], chosen: 'A' };
  if (/storyboard/i.test(sys)) return { frames: [{ index: 0, imagePrompt: 'p', caption: 'c' }] };
  return { positioning: 'P', audience: 'Aud', pillars: ['p1'], funnelStage: 'awareness' };
};
// Recording image stub: captures the last request so we can assert the reference image drives
// edit-mode conditioning (slice 2).
let lastImageReq: { mode?: string; referenceImagePath?: string } | null = null;
const stubImage = async (req: { mode?: string; referenceImagePath?: string }) => {
  lastImageReq = req;
  return { imagePath: '/tmp/i.png', outputFile: '/tmp/i.png', cached: false, durationMs: 1 };
};

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `cg-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const goal = analyzeDeterministic('Post about our AI automation product on facebook with an infographic');
    const planned = planWorkflow(goal);
    if (!planned.ok) { check('planner ok', false, planned); return; }
    const run = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(run.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));

    // 1) Execute with the gate ON (default) → parks at concept.
    const r1 = await runWorkflow(run.id, user.id, goal, planned.plan, { geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, imageFn: stubImage });
    const conceptNode = planned.plan.nodes.find((n) => n.agentId === 'concept_writer')!;
    check('parks needs_approval at concept', r1.status === 'needs_approval' && r1.nodeId === conceptNode.nodeId, r1);

    let full = await getRunWithNodes(run.id, user.id);
    check('concept node awaiting_approval', full?.nodes.find((n) => n.agentId === 'concept_writer')?.status === 'awaiting_approval');
    check('infographic still pending (not run before selection)', full?.nodes.find((n) => n.agentId === 'infographic')?.status === 'pending');
    check('publisher still pending', full?.nodes.find((n) => n.agentId === 'publisher')?.status === 'pending');
    check('no publish_result yet', !(full?.artifacts.some((a) => a.type === 'publish_result') ?? false));

    const art = full?.artifacts.find((a) => a.type === 'content_concept');
    const data = art?.data as { variants?: Array<{ body: string }>; copy?: { body: string }; chosen?: number; postId?: string } | undefined;
    check('artifact carries 3 variants', (data?.variants?.length ?? 0) === 3, data?.variants?.length);
    check('default selection = variant[0]', data?.copy?.body === 'Version ONE body.' && data?.chosen === 0, { copy: data?.copy?.body, chosen: data?.chosen });

    const postId = data?.postId!;
    const parked = await prisma.post.findFirst({ where: { id: postId, ownerId: user.id } });
    check('post NOT yet approved (still review)', parked?.status === 'review', parked?.status);
    check('post.copy = variant[0]', (parked?.copy as { body?: string })?.body === 'Version ONE body.', parked?.copy);

    // 2) Select variant[1] (mirrors POST /select-variant), then persist to the artifact.
    const chosen = data!.variants![1] as { body: string; threads: string; x: string };
    await editPostCopy(postId, user.id, chosen);
    if (art) await updateArtifactData(art.id, user.id, 'content_concept', { ...data, copy: chosen, chosen: 1 });
    const afterSelect = await prisma.post.findFirst({ where: { id: postId, ownerId: user.id } });
    check('select-variant switched post.copy to v2', (afterSelect?.copy as { body?: string })?.body === 'Version TWO body.', afterSelect?.copy);

    // 2b) Upload a reference image at the gate → infographic must generate FROM it (edit mode).
    await setPostReferenceImage(postId, user.id, 'local:/tmp/my-reference.png');

    // 3) Resume via approve-node(concept) → concept confirmed + media runs, then PARKS at the
    // publisher gate. Manual flow keeps TWO human gates (product decision 2026-07-10): selecting a
    // concept is NOT consent to publish — only granted/autonomy runs auto-publish (via the scheduler).
    const r2 = await runWorkflow(run.id, user.id, goal, planned.plan, { geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, imageFn: stubImage, approveNodeId: conceptNode.nodeId });
    const publisherNode = planned.plan.nodes.find((n) => n.agentId === 'publisher')!;
    check('resume PARKS at publisher gate (2nd human gate, not auto-publish)', r2.status === 'needs_approval' && r2.nodeId === publisherNode.nodeId, r2);
    full = await getRunWithNodes(run.id, user.id);
    check('concept completed after confirm', full?.nodes.find((n) => n.agentId === 'concept_writer')?.status === 'completed');
    check('infographic ran after selection', full?.nodes.find((n) => n.agentId === 'infographic')?.status === 'completed');
    check('infographic generated FROM the reference image (edit mode)', lastImageReq?.mode === 'edit' && lastImageReq?.referenceImagePath === '/tmp/my-reference.png', lastImageReq);
    check('publisher parked awaiting_approval (not auto-published)', full?.nodes.find((n) => n.agentId === 'publisher')?.status === 'awaiting_approval', full?.nodes.find((n) => n.agentId === 'publisher')?.status);
    const parkedForPublish = await prisma.post.findFirst({ where: { id: postId, ownerId: user.id } });
    check('post parked ready (awaiting publish approval, NOT posted)', parkedForPublish?.status === 'ready', parkedForPublish?.status);

    // 4) Approve the publisher gate → NOW it publishes (dry) and the post posts. Proves the 2nd gate
    // resolves the full manual flow: concept select → publish approve → posted.
    const r3 = await runWorkflow(run.id, user.id, goal, planned.plan, { geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, imageFn: stubImage, approveNodeId: publisherNode.nodeId });
    check('resume completes after publisher approval', r3.status === 'completed', r3);
    full = await getRunWithNodes(run.id, user.id);
    check('publisher completed after 2nd gate', full?.nodes.find((n) => n.agentId === 'publisher')?.status === 'completed');
    const finalPost = await prisma.post.findFirst({ where: { id: postId, ownerId: user.id } });
    check('post reached posted (dry)', finalPost?.status === 'posted', finalPost?.status);
    check('final copy is the SELECTED v2', (finalPost?.copy as { body?: string })?.body === 'Version TWO body.', finalPost?.copy);
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
  console.log(failures === 0 ? '\nPASS — concept selection gate checks green' : `\nFAIL — ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
