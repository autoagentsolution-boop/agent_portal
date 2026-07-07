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
import type { LlmJsonFn } from './master/llm-json.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// Stub Gemini: return a well-formed copy-gen response (matches parseGeminiResponse
// expectations) so concept_writer reaches `review` without an API call.
// concept_writer now generates VERSIONS → the stub returns a {variants:[…]} bag.
const stubGemini: GeminiFn = async () => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ variants: [
    { body: 'Stub body copy for the post.', threads: 'Stub threads.', x: 'Stub x.' },
    { body: 'Second stub version, different hook.', threads: 'Stub threads 2.', x: 'Stub x 2.' },
  ] }) }] } }],
});

// Stub publish: pretend each platform succeeded — NEVER touches a real platform.
const stubPublish: PublishFn = async (platform) => ({ platform, ok: true, url: `https://dry-run/${platform}`, error: null });

// Stub the generic JSON LLM (ideation/strategy) — schema-valid output, no spend.
const stubLlmJson: LlmJsonFn = async (systemPrompt) => {
  if (/ideation/i.test(systemPrompt)) return { ideas: ['Stub idea A', 'Stub idea B'], chosen: 'Stub idea A' };
  if (/storyboard/i.test(systemPrompt)) return { frames: [{ index: 0, imagePrompt: 'Stub frame prompt', caption: 'Stub caption' }] };
  return { positioning: 'Stub positioning', audience: 'Stub audience', pillars: ['p1', 'p2'], funnelStage: 'awareness' };
};
// Stub Veo i2v — return a fake mp4 path WITHOUT rendering a real (slow, paid) video.
const stubVideo = async () => ({ outputFile: '/tmp/stub-video.mp4', cached: false, durationMs: 0 });
const stubTts = async () => ({ outputFile: '/tmp/stub-voice.wav', cached: false });

// Stub image gen — return a fake local path WITHOUT generating a real image / file.
// The publish path is per-platform stubbed so fetchBinary is never called.
const stubImage = async (): Promise<{ imagePath: string; outputFile: string; cached: boolean; durationMs: number }> => ({
  imagePath: '/files/images/stub.png',
  outputFile: '/tmp/stub-image.png',
  cached: false,
  durationMs: 0,
});

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `wf-exec-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const goal = analyzeDeterministic('Build a full branding campaign for our AI automation product on facebook with an infographic');
    // NOTE: heroFile intentionally NOT pre-set — the live infographic agent now
    // generates an image and attaches it (heroFile=local:<path>) before the
    // publisher runs. This exercises the real attach flow (A2).
    const planned = planWorkflow(goal);
    if (!planned.ok) { check('planner ok', false, planned); return; }

    const run = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(run.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));

    // First pass — should run concept_writer + infographic, then HALT at publisher.
    const r1 = await runWorkflow(run.id, user.id, goal, planned.plan, { geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, imageFn: stubImage, videoFn: stubVideo, ttsFn: stubTts, autoPublish: false, conceptGate: false });
    check('first pass halts needs_approval', r1.status === 'needs_approval', r1);
    if (r1.status === 'needs_approval') {
      const pub = planned.plan.nodes.find((n) => n.agentId === 'publisher')!;
      check('halt is at publisher node', r1.nodeId === pub.nodeId, r1.nodeId);
    }

    let full = await getRunWithNodes(run.id, user.id);
    check('run status needs_approval', full?.status === 'needs_approval', full?.status);
    check('ideation completed (live, stubbed)', full?.nodes.find((n) => n.agentId === 'ideation')?.status === 'completed');
    check('strategy completed (live, stubbed)', full?.nodes.find((n) => n.agentId === 'strategy')?.status === 'completed');
    check('campaign_ideas artifact stored', full?.artifacts.some((a) => a.type === 'campaign_ideas') ?? false);
    check('strategy_brief artifact stored', full?.artifacts.some((a) => a.type === 'strategy_brief') ?? false);
    check('concept_writer completed', full?.nodes.find((n) => n.agentId === 'concept_writer')?.status === 'completed');
    check('infographic completed', full?.nodes.find((n) => n.agentId === 'infographic')?.status === 'completed');
    check('publisher awaiting_approval', full?.nodes.find((n) => n.agentId === 'publisher')?.status === 'awaiting_approval');
    check('content_concept artifact stored', full?.artifacts.some((a) => a.type === 'content_concept') ?? false);
    const infoArt = full?.artifacts.find((a) => a.type === 'infographic_brief');
    check('infographic_brief carries imageRef (local:)', String((infoArt?.data as { imageRef?: string })?.imageRef ?? '').startsWith('local:'), infoArt?.data);
    const conceptArt = full?.artifacts.find((a) => a.type === 'content_concept');
    const pid = (conceptArt?.data as { postId?: string })?.postId;
    const postMid = pid ? await prisma.post.findFirst({ where: { id: pid, ownerId: user.id } }) : null;
    check('Post.heroFile set to local: by infographic', String(postMid?.heroFile ?? '').startsWith('local:'), postMid?.heroFile);
    check('NO publish_result yet (gate held)', !(full?.artifacts.some((a) => a.type === 'publish_result') ?? false));

    // Approve the publisher node → resume.
    const pub = planned.plan.nodes.find((n) => n.agentId === 'publisher')!;
    const r2 = await runWorkflow(run.id, user.id, goal, planned.plan, { geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, imageFn: stubImage, approveNodeId: pub.nodeId });
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
    check('Post.runId links back to the flow (DAG under post)', post?.runId === run.id, { runId: post?.runId, run: run.id });

    // Phase 6 — token/cost accounting recorded on completed nodes.
    const nodeCost = (agentId: string) => full?.nodes.find((n) => n.agentId === agentId);
    check('ideation recorded tokens', (nodeCost('ideation')?.totalTokens ?? 0) > 0, nodeCost('ideation')?.totalTokens);
    check('concept_writer recorded cost>0', (nodeCost('concept_writer')?.costUsd ?? 0) > 0, nodeCost('concept_writer')?.costUsd);
    check('infographic recorded flat image cost', Math.abs((nodeCost('infographic')?.costUsd ?? 0) - 0.04) < 1e-9, nodeCost('infographic')?.costUsd);
    check('publisher cost is 0 (no spend)', (nodeCost('publisher')?.costUsd ?? -1) === 0, nodeCost('publisher')?.costUsd);
    const runTotal = (full?.nodes ?? []).reduce((s, n) => s + (n.costUsd ?? 0), 0);
    check('run total cost > 0', runTotal > 0, runTotal);

    // Faithfulness: a goal WITHOUT media must fail-loud at the live publish path
    // (the executor does not bypass resolvePublishInput validation).
    const goal2 = analyzeDeterministic('Post about our AI automation product on facebook');
    const planned2 = planWorkflow(goal2);
    if (planned2.ok) {
      const run2 = await createRun({ ownerId: user.id, goal: goal2, plan: planned2.plan, status: 'planned' });
      await createNodes(run2.id, user.id, planned2.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
      await runWorkflow(run2.id, user.id, goal2, planned2.plan, { geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, autoPublish: false, conceptGate: false });
      const pub2 = planned2.plan.nodes.find((n) => n.agentId === 'publisher')!;
      const r2b = await runWorkflow(run2.id, user.id, goal2, planned2.plan, { geminiFn: stubGemini, publishFn: stubPublish, approveNodeId: pub2.nodeId });
      const full2 = await getRunWithNodes(run2.id, user.id);
      const pr2 = full2?.artifacts.find((a) => a.type === 'publish_result');
      check('no-media publish → result status error (faithful, not bypassed)', (pr2?.data as { status?: string })?.status === 'error', { outcome: r2b, pr: pr2?.data });
    }

    // ── Atria autonomy grant (Phase 01): a GRANTED run clears its own gates with ZERO
    // approve-node calls. IMPORTANT Phase-01/02 boundary: `buildGuardrailCtx` still reads the
    // run-START post snapshot (getPostByRunId), which is NULL on a FRESH goal (the post is created
    // mid-run by concept_writer — the C1 finding). So on a fresh goal the publish guardrail
    // fail-CLOSES and the run HOLDS + notifies (never a silent publish). Phase 02 adds the
    // publisher-boundary re-read that lets a fresh goal auto-publish in a single pass. Here we
    // prove: (pass 1) concept auto-selects + publisher fail-closed holds + audited; (pass 2, on
    // resume once the post IS resolvable) the grant publishes with 0 human approvals.
    const run3 = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(run3.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    // Grant autonomy (what the endpoint does after the double-confirm handshake).
    await prisma.workflowRun.update({ where: { id: run3.id }, data: { approvalMode: 'atria' } });
    const r3a = await runWorkflow(run3.id, user.id, goal, planned.plan, {
      geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, imageFn: stubImage, videoFn: stubVideo, ttsFn: stubTts,
      // NO approveNodeId — the grant is the authorization. conceptGate/autoPublish left at defaults.
    });
    check('atria pass1: fresh-goal publish fail-closed HOLDS (Phase 02 unlocks it)', r3a.status === 'needs_approval', r3a);
    let full3 = await getRunWithNodes(run3.id, user.id);
    check('atria: concept auto-selected (completed, not parked)', full3?.nodes.find((n) => n.agentId === 'concept_writer')?.status === 'completed', full3?.nodes.find((n) => n.agentId === 'concept_writer')?.status);
    check('atria pass1: publisher HELD, nothing published', !(full3?.artifacts.some((a) => a.type === 'publish_result') ?? false));
    // Forensic traceability: every atria gate decision left an audit row (selection approve + publish hold).
    const auditRows = await prisma.mktRunLog.count({ where: { ownerId: user.id, step: 'atria_gate', detail: { path: ['runId'], equals: run3.id } } });
    check('atria: gate decisions audited (≥2 rows: selection + publish)', auditRows >= 2, auditRows);

    // Pass 2 — resume WITHOUT any approve-node (still 0 human approvals). The post now exists, so
    // buildGuardrailCtx re-reads it non-null → publish guardrails hold → the grant publishes.
    const r3b = await runWorkflow(run3.id, user.id, goal, planned.plan, { geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, imageFn: stubImage });
    check('atria pass2: completes autonomously (0 human approvals)', r3b.status === 'completed', r3b);
    full3 = await getRunWithNodes(run3.id, user.id);
    check('atria: publisher completed autonomously', full3?.nodes.find((n) => n.agentId === 'publisher')?.status === 'completed');
    const pr3 = full3?.artifacts.find((a) => a.type === 'publish_result');
    check('atria: publish_result posted (dry)', (pr3?.data as { status?: string })?.status === 'posted', pr3?.data);

    // Human-mode regression guard: an ungranted run STILL parks at the publisher (byte-identical
    // to before this phase) — autonomy must never be the accidental default.
    const run4 = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(run4.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    const r4 = await runWorkflow(run4.id, user.id, goal, planned.plan, { geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, imageFn: stubImage, autoPublish: false, conceptGate: false });
    check('human mode still parks needs_approval (no autonomy leak)', r4.status === 'needs_approval', r4);
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
