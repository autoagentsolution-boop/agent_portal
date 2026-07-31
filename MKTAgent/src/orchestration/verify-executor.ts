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
import { createCampaign } from '../db/repos/campaign-repo.ts';
import { createPostForOwner, getPostByRunId } from '../db/repos/post-repo.ts';
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
// Shared across the verify-* scripts so a new agent contract is ONE edit, not six.
import { stubLlmJson } from './testing/stub-llm-json.ts';
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
    // Infographic cost = the flat image price PLUS its planning LLM call (2026-07-21 — the node
    // used to fill a fixed string template and had no LLM cost at all). Assert the image price is
    // still in there and the planning delta stays small, rather than pinning an exact total that
    // moves with token pricing.
    const infoCost = nodeCost('infographic')?.costUsd ?? 0;
    check('infographic cost = image + a small planning call', infoCost > 0.04 && infoCost < 0.05, infoCost);
    check('infographic recorded planning tokens', (nodeCost('infographic')?.totalTokens ?? 0) > 0, nodeCost('infographic')?.totalTokens);
    check('publisher cost is 0 (no spend)', (nodeCost('publisher')?.costUsd ?? -1) === 0, nodeCost('publisher')?.costUsd);
    const runTotal = (full?.nodes ?? []).reduce((s, n) => s + (n.costUsd ?? 0), 0);
    check('run total cost > 0', runTotal > 0, runTotal);

    // Text-only faithfulness (product decision 2026-07-10): a goal WITHOUT media is a valid text
    // post — X/Threads/LinkedIn (and FB) accept text-only — so the live publish path PUBLISHES it
    // rather than fail-loud. Asserts the text post reaches `posted` through the real publish path.
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
      check('text-only publish → run completes', r2b.status === 'completed', r2b);
      check('text-only publish → publisher node completed', full2?.nodes.find((n) => n.agentId === 'publisher')?.status === 'completed', full2?.nodes.find((n) => n.agentId === 'publisher')?.status);
      check('text-only publish → publish_result posted', (pr2?.data as { status?: string })?.status === 'posted', pr2?.data);
    }

    // ── Atria autonomy grant (Phase 02): with the publisher-boundary re-read (C1 fixed), a GRANTED
    // FRESH-goal run now clears its own gates and drives concept→media→publish in ONE pass with
    // ZERO approve-node calls. The post is created mid-run by concept_writer; buildGuardrailCtx
    // re-reads it FRESH at the boundary (was null run-start snapshot before). The H4 connection
    // re-resolve reads token status — the throwaway tenant has none, so we inject a stub reader
    // simulating a connected facebook (the resolver's own DI seam) to exercise the happy path.
    const stubConnReader = async () => [{ platform: 'facebook' as const, status: 'active' as const, expiresAt: null }];
    const run3 = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(run3.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    // Grant autonomy (what the endpoint does after the double-confirm handshake).
    await prisma.workflowRun.update({ where: { id: run3.id }, data: { approvalMode: 'atria' } });
    const r3 = await runWorkflow(run3.id, user.id, goal, planned.plan, {
      geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, imageFn: stubImage, videoFn: stubVideo, ttsFn: stubTts,
      connectionReaderFn: stubConnReader,
      // NO approveNodeId — the grant is the authorization. conceptGate/autoPublish left at defaults.
    });
    check('atria: fresh-goal completes in ONE pass (0 human approvals)', r3.status === 'completed', r3);
    const full3 = await getRunWithNodes(run3.id, user.id);
    check('atria: concept auto-selected (completed, not parked)', full3?.nodes.find((n) => n.agentId === 'concept_writer')?.status === 'completed', full3?.nodes.find((n) => n.agentId === 'concept_writer')?.status);
    check('atria: publisher completed autonomously', full3?.nodes.find((n) => n.agentId === 'publisher')?.status === 'completed');
    const pr3 = full3?.artifacts.find((a) => a.type === 'publish_result');
    check('atria: publish_result posted (dry)', (pr3?.data as { status?: string })?.status === 'posted', pr3?.data);
    // Forensic traceability: every atria gate decision left an audit row (selection + publish approve).
    const auditRows = await prisma.mktRunLog.count({ where: { ownerId: user.id, step: 'atria_gate', detail: { path: ['runId'], equals: run3.id } } });
    check('atria: gate decisions audited (≥2 rows: selection + publish)', auditRows >= 2, auditRows);

    // Guardrail fail-closed: same grant, but the connection re-resolve finds NO live token →
    // publish HOLDS + notifies (never a dead-token publish), proving H4 at the boundary.
    const run5 = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(run5.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    await prisma.workflowRun.update({ where: { id: run5.id }, data: { approvalMode: 'atria' } });
    const r5 = await runWorkflow(run5.id, user.id, goal, planned.plan, {
      geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, imageFn: stubImage, videoFn: stubVideo, ttsFn: stubTts,
      connectionReaderFn: async () => [], // no connections → publish guardrail fail-closes
    });
    check('atria: unconnected publish HOLDS (H4 fail-closed, no dead-token publish)', r5.status === 'needs_approval', r5);
    const full5 = await getRunWithNodes(run5.id, user.id);
    check('atria: held run published nothing', !(full5?.artifacts.some((a) => a.type === 'publish_result') ?? false));

    // Human-mode regression guard: an ungranted run STILL parks at the publisher (byte-identical
    // to before this phase) — autonomy must never be the accidental default.
    const run4 = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(run4.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    const r4 = await runWorkflow(run4.id, user.id, goal, planned.plan, { geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, imageFn: stubImage, autoPublish: false, conceptGate: false });
    check('human mode still parks needs_approval (no autonomy leak)', r4.status === 'needs_approval', r4);

    // ── Phase-0 characterization: media-gating skip (guards the executor/gate-runner split). A post
    //    whose chosen assetType is CAROUSEL must SKIP (and never pay for) the `video` node. This is
    //    the branch that stops an unapproved Veo render. Build a campaign+carousel post attached to a
    //    run whose plan contains a video node; assert the video node ends `skipped` and videoFn is
    //    never invoked. (MEDIA_AGENT_ASSET: video→['video'], carousel post needs ['carousel'].)
    {
      const camp = await createCampaign({ ownerId: user.id, product: 'MediaGating Test' });
      const videoGoal = analyzeDeterministic('Make a short video and a storyboard carousel for our product on facebook');
      const vPlan = planWorkflow(videoGoal);
      if (!vPlan.ok) { check('media-gating: plan builds', false, vPlan); }
      else {
        const hasVideoNode = vPlan.plan.nodes.some((n) => n.agentId === 'video');
        check('media-gating: plan contains a video node (precondition)', hasVideoNode, vPlan.plan.nodes.map((n) => n.agentId));
        const mgRun = await createRun({ ownerId: user.id, goal: videoGoal, plan: vPlan.plan, status: 'planned' });
        await createNodes(mgRun.id, user.id, vPlan.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
        // Attach a CAROUSEL post (not video) to this run → video node must be skipped.
        await createPostForOwner({ campaignId: camp.id, ownerId: user.id, assetType: 'carousel', platforms: ['facebook'], runId: mgRun.id });
        let videoCalls = 0;
        const countingVideo = async () => { videoCalls++; return { outputFile: '/tmp/stub-video.mp4', cached: false, durationMs: 0 }; };
        await runWorkflow(mgRun.id, user.id, videoGoal, vPlan.plan, {
          geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, imageFn: stubImage, videoFn: countingVideo, ttsFn: stubTts, autoPublish: false, conceptGate: false,
        });
        const mgFull = await getRunWithNodes(mgRun.id, user.id);
        const videoNode = mgFull?.nodes.find((n) => n.agentId === 'video');
        check('media-gating: video node SKIPPED for a carousel post', videoNode?.status === 'skipped', videoNode?.status);
        check('media-gating: videoFn NEVER invoked (no unapproved Veo spend)', videoCalls === 0, { videoCalls });
        // F3: two-sided. Skipping the video isn't enough — the carousel deliverable that SHOULD run must
        // actually run, else "gate everything off" would also pass this test (carousel post → no slides).
        const sbNode = mgFull?.nodes.find((n) => n.agentId === 'storyboard');
        check('media-gating: storyboard node RUNS for a carousel post (not over-skipped)', sbNode?.status === 'completed', sbNode?.status);
        const mgPost = await getPostByRunId(mgRun.id);
        const mgMedia = (mgPost?.assetMedia ?? null) as Record<string, string> | null;
        check('media-gating: carousel media populated (slides actually attached)', typeof mgMedia?.['carousel'] === 'string' && mgMedia['carousel'].length > 0, mgMedia?.['carousel']);
      }
    }

    // ── Phase-0 characterization: schedule-gate scheduledAt PRESERVATION (guards the `new Date()`
    //    clobber). A publisher run whose attached post has a FUTURE scheduledAt must approve without
    //    firing, and the stored scheduledAt must be byte-identical afterward (the cron owns the fire).
    {
      const camp2 = await createCampaign({ ownerId: user.id, product: 'SchedPreserve Test' });
      const future = new Date(Date.now() + 7 * 24 * 3600 * 1000); // +7d, stable within the run
      const spRun = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
      await createNodes(spRun.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
      await createPostForOwner({ campaignId: camp2.id, ownerId: user.id, assetType: 'image', platforms: ['facebook'], runId: spRun.id, scheduledAt: future });
      const pubNode = planned.plan.nodes.find((n) => n.agentId === 'publisher')!;
      // First pass to park at publisher, then approve the publisher node.
      await runWorkflow(spRun.id, user.id, goal, planned.plan, { geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, imageFn: stubImage, autoPublish: false, conceptGate: false });
      await runWorkflow(spRun.id, user.id, goal, planned.plan, { geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, imageFn: stubImage, approveNodeId: pubNode.nodeId });
      const spPost = await getPostByRunId(spRun.id);
      check('schedule-gate: post NOT published (future scheduledAt → parked ready)', spPost?.status !== 'posted', spPost?.status);
      check('schedule-gate: scheduledAt PRESERVED byte-identical (no new Date() clobber)',
        spPost?.scheduledAt?.getTime() === future.getTime(), { got: spPost?.scheduledAt?.toISOString(), want: future.toISOString() });
    }

    // ── Phase-0 characterization: abort mid-run (guards the per-node abort check between nodes). The
    //    executor checks getRunStatusById()==='aborted' at the TOP of each node iteration, so an abort
    //    that lands mid-run must stop the run BEFORE the next node. We flip the run to `aborted` from
    //    inside the first stubbed LLM call, then assert the run returns {status:'aborted'} and the
    //    downstream publisher never reaches a terminal produced state.
    {
      const abRun = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
      await createNodes(abRun.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
      let flipped = false;
      // The first node (ideation/strategy) runs through llmJsonFn — flip to aborted on its first call.
      const abortingLlm: LlmJsonFn = async (...args: Parameters<LlmJsonFn>) => {
        if (!flipped) { flipped = true; await prisma.workflowRun.update({ where: { id: abRun.id }, data: { status: 'aborted' } }); }
        return stubLlmJson(...args);
      };
      const rAbort = await runWorkflow(abRun.id, user.id, goal, planned.plan, { geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: abortingLlm, imageFn: stubImage, autoPublish: false, conceptGate: false });
      check('abort: mid-run abort returns status aborted', rAbort.status === 'aborted', rAbort);
      const abFull = await getRunWithNodes(abRun.id, user.id);
      const publisherProduced = abFull?.nodes.find((n) => n.agentId === 'publisher')?.status;
      // F6: pin the EXACT resting state, not just "not terminal". A mid-run abort stops before the node
      // iterates, so the publisher must sit at its initial `pending` (never entered running/skipped/failed).
      // The looser "!= completed && != awaiting_approval" would also pass on `failed` or `running`, hiding
      // an abort that leaks a node into a live state. ('pending' is also the schema default — a deliberate
      // rename of the initial node state across schema+repo is a real contract change this test surfaces.)
      check('abort: publisher rests at pending after mid-run abort (never entered a live state)',
        publisherProduced === 'pending', { publisher: publisherProduced, nodes: abFull?.nodes.map((n) => `${n.agentId}:${n.status}`) });
    }
    // ── Phase-0 characterization: publisher FAIL-LOUD (H1). A publish where every target failed
    //    (publishFn returns ok:false for each platform → aggregate status 'error') must surface as a
    //    FAILED node/run, NEVER a silent `completed`. Guards the delivery-family split.
    {
      const flRun = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
      await createNodes(flRun.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
      const failingPublish: PublishFn = async (platform) => ({ platform, ok: false, url: null, error: 'stub forced failure' });
      const pubNode = planned.plan.nodes.find((n) => n.agentId === 'publisher')!;
      await runWorkflow(flRun.id, user.id, goal, planned.plan, { geminiFn: stubGemini, publishFn: failingPublish, llmJsonFn: stubLlmJson, imageFn: stubImage, autoPublish: false, conceptGate: false });
      const rFail = await runWorkflow(flRun.id, user.id, goal, planned.plan, { geminiFn: stubGemini, publishFn: failingPublish, llmJsonFn: stubLlmJson, imageFn: stubImage, approveNodeId: pubNode.nodeId });
      check('publisher fail-loud: a fully-failed publish → run FAILED (not completed)', rFail.status === 'failed', rFail);
      const flFull = await getRunWithNodes(flRun.id, user.id);
      check('publisher fail-loud: publisher node marked failed', flFull?.nodes.find((n) => n.agentId === 'publisher')?.status === 'failed', flFull?.nodes.find((n) => n.agentId === 'publisher')?.status);
      check('publisher fail-loud: NO publish_result posted', !((flFull?.artifacts.find((a) => a.type === 'publish_result')?.data as { status?: string })?.status === 'posted'));
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
