// Phase 6 — flow-template cost rollup. Proves getFlowCostRollup sums token/cost across
// all instance runs of a template, and that GET /orchestration/runs/:id surfaces flowCost
// for a template. DRY-RUN (stub executor) — 0 real spend. Self-cleans.
import { prisma } from '../db/client.ts';
import { signSession } from '../lib/auth-jwt.ts';
import { env } from '../config/env.ts';
import { analyzeDeterministic } from './master/deterministic-analyzer.ts';
import { planWorkflow } from './master/workflow-planner.ts';
import { createRun, createNodes, nameRun, cloneTemplateRun } from '../db/repos/workflow-run-repo.ts';
import { runWorkflow } from './executor/workflow-executor.ts';
import type { GeminiFn } from '../copygen/service.ts';
import type { PublishFn } from '../scheduler/tick.ts';
import type { LlmJsonFn } from './master/llm-json.ts';

const BASE = `http://localhost:${env.PORT}`;
let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const stubGemini: GeminiFn = async () => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ body: 'Stub body copy for the post about the product.', threads: 'Stub threads copy.', x: 'Stub x copy.' }) }] } }],
});
const stubPublish: PublishFn = async (platform) => ({ platform, ok: true, url: `https://dry-run/${platform}`, error: null });
const stubLlmJson: LlmJsonFn = async (systemPrompt) => {
  if (/ideation/i.test(systemPrompt)) return { ideas: ['Stub idea A', 'Stub idea B'], chosen: 'Stub idea A' };
  if (/storyboard/i.test(systemPrompt)) return { frames: [{ index: 0, imagePrompt: 'Stub frame prompt', caption: 'Stub caption' }] };
  return { positioning: 'Stub positioning', audience: 'Stub audience', pillars: ['p1', 'p2'], funnelStage: 'awareness' };
};
const stubVideo = async () => ({ outputFile: '/tmp/stub-video.mp4', cached: false, durationMs: 0 });
const stubTts = async () => ({ outputFile: '/tmp/stub-voice.wav', cached: false });
const stubImage = async () => ({ imagePath: '/files/images/stub.png', outputFile: '/tmp/stub-image.png', cached: false, durationMs: 0 });

const call = async (method: string, path: string, token: string): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json().catch(() => null) };
};

async function main(): Promise<void> {
  try {
    const h = await fetch(`${BASE}/health`);
    if (!h.ok) throw new Error(`health ${h.status}`);
  } catch (e) {
    console.error(`Server not reachable at ${BASE} — start it first. ${String(e)}`); process.exit(2);
  }

  const user = await prisma.user.create({ data: { email: `flowcost-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  const token = signSession({ sub: user.id, email: user.email });
  const runOpts = { geminiFn: stubGemini, publishFn: stubPublish, llmJsonFn: stubLlmJson, imageFn: stubImage, videoFn: stubVideo, ttsFn: stubTts };

  try {
    // Seed a TEMPLATE (saved flow) with an infographic so nodes spend.
    const goal = analyzeDeterministic('Build a full branding campaign for our AI automation product on facebook with an infographic');
    const planned = planWorkflow(goal);
    if (!planned.ok) { check('planner ok', false, planned); return; }
    const draft = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(draft.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    const template = await nameRun(draft.id, user.id, 'Cost Flow');
    check('seeded template', template?.kind === 'template', template?.kind);

    // Clone → instance run (as a post would), execute it to completion (approve publisher).
    const runInstance = async (): Promise<void> => {
      const inst = await cloneTemplateRun(draft.id, user.id, { product: 'AI product', platforms: ['facebook'] });
      if (!inst) throw new Error('clone failed');
      await runWorkflow(inst.id, user.id, goal, planned.plan, runOpts);
      const pub = planned.plan.nodes.find((n) => n.agentId === 'publisher')!;
      await runWorkflow(inst.id, user.id, goal, planned.plan, { ...runOpts, approveNodeId: pub.nodeId });
    };
    await runInstance();
    await runInstance();

    // GET the template → flowCost should roll up BOTH instance runs.
    const r = await call('GET', `/orchestration/runs/${draft.id}`, token);
    check('GET template 200', r.status === 200, r.status);
    const fc = r.body?.data?.flowCost;
    check('flowCost present on template', Boolean(fc), fc);
    check('flowCost.runs === 2', fc?.runs === 2, fc?.runs);
    check('flowCost.costUsd > 0', (fc?.costUsd ?? 0) > 0, fc?.costUsd);
    check('flowCost.totalTokens > 0', (fc?.totalTokens ?? 0) > 0, fc?.totalTokens);
    // Template's OWN nodes never execute → its own cost is 0.
    check('template own cost is 0', (r.body?.data?.cost?.costUsd ?? -1) === 0, r.body?.data?.cost);

    console.log(failures === 0 ? '\nPASS — flow cost rollup green' : `\nFAIL — ${failures} check(s)`);
  } finally {
    await prisma.workflowNodeRun.deleteMany({ where: { ownerId: user.id } });
    await prisma.post.deleteMany({ where: { ownerId: user.id } });
    await prisma.campaign.deleteMany({ where: { ownerId: user.id } });
    await prisma.workflowRun.deleteMany({ where: { ownerId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }
  process.exit(failures === 0 ? 0 : 1);
}

void main();
