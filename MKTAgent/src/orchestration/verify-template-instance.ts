// Flow-as-Template verification — proves the template↔instance split (DRY-RUN, no real
// Gemini spend, no real posts). Covers:
//   • save (nameRun) freezes a planned run into a template (kind/status/locked)
//   • listSavedRuns returns templates only (instance runs hidden)
//   • cloneTemplateRun produces an executable instance carrying the template's plan +
//     merged campaign goal, without mutating the template
//   • executing an instance whose Post pre-exists does NOT create a second campaign/post
//     (concept_writer fills the existing post), and halts at the publisher gate
//   • re-running a node marks its downstream stale
// Creates one throwaway tenant, cleans up after.
import { prisma } from '../db/client.ts';
import { analyzeDeterministic } from './master/deterministic-analyzer.ts';
import { planWorkflow } from './master/workflow-planner.ts';
import {
  createRun,
  createNodes,
  nameRun,
  listSavedRuns,
  cloneTemplateRun,
  getRunWithNodes,
  resetNodes,
  collectDownstream,
} from '../db/repos/workflow-run-repo.ts';
import { createCampaign } from '../db/repos/campaign-repo.ts';
import { createPostForOwner } from '../db/repos/post-repo.ts';
import { runWorkflow } from './executor/workflow-executor.ts';
import { workflowPlan } from './schemas/workflow-plan.ts';
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
    { body: 'Stub body copy.', threads: 'Stub threads.', x: 'Stub x.' },
    { body: 'Stub body copy v2.', threads: 'Stub threads 2.', x: 'Stub x 2.' },
  ] }) }] } }],
});
const stubPublish: PublishFn = async (platform) => ({ platform, ok: true, url: `https://dry-run/${platform}`, error: null });
// Shared across the verify-* scripts so a new agent contract is ONE edit, not six.
import { stubLlmJson } from './testing/stub-llm-json.ts';
const stubVideo = async () => ({ outputFile: '/tmp/stub-video.mp4', cached: false, durationMs: 0 });
const stubTts = async () => ({ outputFile: '/tmp/stub-voice.wav', cached: false });
const stubImage = async (): Promise<{ imagePath: string; outputFile: string; cached: boolean; durationMs: number }> => ({
  imagePath: '/files/images/stub.png', outputFile: '/tmp/stub-image.png', cached: false, durationMs: 0,
});

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `wf-tmpl-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    // ── 1. Plan + save → template ────────────────────────────────────────────
    const goal = analyzeDeterministic('Build a full branding campaign for our AI automation product on facebook with an infographic');
    const planned = planWorkflow(goal);
    if (!planned.ok) { check('planner ok', false, planned); return; }

    const draft = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(draft.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));

    const saved = await nameRun(draft.id, user.id, 'Branding Flow');
    check('save → kind=template', saved?.kind === 'template', saved?.kind);
    check('save → status=template', saved?.status === 'template', saved?.status);
    check('save → locked', saved?.locked === true, saved?.locked);

    // Idempotency (memory: HTTP test caught re-save dup): a second save no-ops.
    const resave = await nameRun(draft.id, user.id, 'Renamed Should Not Apply');
    check('re-save no-ops (name:null guard)', resave === null, resave);

    // ── 2. listSavedRuns returns templates only ─────────────────────────────
    const savedList = await listSavedRuns(user.id);
    check('listSavedRuns includes the template', savedList.some((r) => r.id === draft.id));

    // ── 3. Clone → instance, template untouched ─────────────────────────────
    const campaign = await createCampaign({
      ownerId: user.id, flowId: draft.id, product: 'Competitor comparison', angle: 'sharper than X',
      platforms: ['facebook'], language: 'en',
    });
    const instance = await cloneTemplateRun(draft.id, user.id, {
      product: campaign.product, angle: campaign.angle, language: campaign.language, platforms: campaign.platforms,
    });
    check('clone → instance created', Boolean(instance), instance);
    check('instance kind=instance', instance?.kind === 'instance', instance?.kind);
    check('instance status=planned', instance?.status === 'planned', instance?.status);
    check('instance.templateId → template', instance?.templateId === draft.id, instance?.templateId);

    const instFull = instance ? await getRunWithNodes(instance.id, user.id) : null;
    check('instance plan cloned (same node count)', instFull?.nodes.length === planned.plan.nodes.length, { got: instFull?.nodes.length, want: planned.plan.nodes.length });
    const mergedGoal = instance?.goal as { slots?: { product?: string; angle?: string } };
    check('instance goal merged product from campaign', mergedGoal?.slots?.product === 'Competitor comparison', mergedGoal?.slots);
    check('instance goal merged angle from campaign', mergedGoal?.slots?.angle === 'sharper than X', mergedGoal?.slots);

    const templateStill = await getRunWithNodes(draft.id, user.id);
    check('template untouched after clone (still template/locked)', templateStill?.kind === 'template' && templateStill.locked === true);
    check('template has NO artifacts', (templateStill?.artifacts.length ?? 0) === 0, templateStill?.artifacts.length);

    // ── 3b. Registry re-validation on clone (Phase 05 / D#8): a template referencing an agent that
    // no longer exists in the registry must fail LOUD on clone, not create a broken instance.
    const ghostTemplate = await prisma.workflowRun.create({
      data: { ownerId: user.id, goal: {}, plan: { nodes: [{ nodeId: 'n1', agentId: 'ghost_agent', dependsOn: [] }] }, status: 'template', kind: 'template', locked: true },
    });
    let cloneThrew = false;
    let cloneErr = '';
    try { await cloneTemplateRun(ghostTemplate.id, user.id, { product: 'x', platforms: ['facebook'] }); }
    catch (e) { cloneThrew = true; cloneErr = String(e instanceof Error ? e.message : e); }
    check('clone of template with removed agent THROWS (not silent)', cloneThrew, cloneErr);
    check('clone error names the removed agent', /ghost_agent/.test(cloneErr), cloneErr);

    // ── 4. Create Post FOR the instance, then execute → no dup campaign/post ──
    const post = await createPostForOwner({
      campaignId: campaign.id, ownerId: user.id, runId: instance!.id,
      platforms: ['facebook'], language: 'en',
    });

    const campaignsBefore = await prisma.campaign.count({ where: { ownerId: user.id } });
    const postsBefore = await prisma.post.count({ where: { ownerId: user.id } });

    const instGoal = analyzeDeterministic('Build a full branding campaign for our AI automation product on facebook with an infographic');
    const instPlan = workflowPlan.parse(instance!.plan);
    const r1 = await runWorkflow(instance!.id, user.id, instGoal, instPlan, { geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, imageFn: stubImage, videoFn: stubVideo, ttsFn: stubTts, autoPublish: false, conceptGate: false });
    check('instance run halts at publisher gate', r1.status === 'needs_approval', r1);

    const campaignsAfter = await prisma.campaign.count({ where: { ownerId: user.id } });
    const postsAfter = await prisma.post.count({ where: { ownerId: user.id } });
    check('concept_writer did NOT create a new campaign', campaignsAfter === campaignsBefore, { before: campaignsBefore, after: campaignsAfter });
    check('concept_writer did NOT create a new post', postsAfter === postsBefore, { before: postsBefore, after: postsAfter });

    const afterRun = await getRunWithNodes(instance!.id, user.id);
    check('concept_writer completed on existing post', afterRun?.nodes.find((n) => n.agentId === 'concept_writer')?.status === 'completed');
    const conceptArt = afterRun?.artifacts.find((a) => a.type === 'content_concept');
    check('content_concept postId = the pre-created post', (conceptArt?.data as { postId?: string })?.postId === post.id, conceptArt?.data);

    const filledPost = await prisma.post.findFirst({ where: { id: post.id, ownerId: user.id } });
    check('pre-created post advanced past brief (copy generated)', filledPost?.status !== 'brief', filledPost?.status);

    // ── 5. Re-run a node marks downstream stale ─────────────────────────────
    const conceptNode = afterRun?.nodes.find((n) => n.agentId === 'concept_writer');
    if (conceptNode && afterRun) {
      const downstream = collectDownstream(afterRun.nodes, conceptNode.nodeId);
      check('concept_writer has downstream to invalidate', downstream.length > 0, downstream);
      await resetNodes(instance!.id, user.id, [conceptNode.nodeId, ...downstream]);
      const afterReset = await getRunWithNodes(instance!.id, user.id);
      const staleDown = afterReset?.nodes.filter((n) => downstream.includes(n.nodeId)).every((n) => n.status === 'pending');
      check('downstream nodes reset to pending (stale)', staleDown === true);
    }
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — template/instance checks green (0 real posts, 0 Gemini spend)' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
