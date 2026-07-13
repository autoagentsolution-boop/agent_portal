// HTTP smoke (bug 2026-07-13) — a campaign created UNDER a flow must inherit the flow's full
// platform set, not collapse to empty/Facebook. Repro: the "Set up first campaign" action posts
// { product, flowId } with NO platforms → the campaign persisted platforms=[] under an all-5-
// platform flow → every post then defaulted to Facebook-only. Live against :7100. Self-cleans.
import { prisma } from '../db/client.ts';
import { signSession } from '../lib/auth-jwt.ts';
import { env } from '../config/env.ts';
import { analyzeDeterministic } from './master/deterministic-analyzer.ts';
import { planWorkflow } from './master/workflow-planner.ts';
import { createRun, createNodes, nameRun } from '../db/repos/workflow-run-repo.ts';

const BASE = `http://localhost:${env.PORT}`;
let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const call = async (method: string, path: string, token: string, body?: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* 204 */ }
  return { status: res.status, body: json };
};

async function main(): Promise<void> {
  try {
    const h = await fetch(`${BASE}/health`);
    if (!h.ok) throw new Error(`health ${h.status}`);
  } catch (e) {
    console.error(`Server not reachable at ${BASE} — start it first. ${String(e)}`);
    process.exit(2);
  }

  const user = await prisma.user.create({ data: { email: `platinherit-${Date.now()}@test.local`, defaultLanguage: 'vi' } });
  const token = signSession({ sub: user.id, email: user.email });
  const ALL5 = ['facebook', 'instagram', 'threads', 'linkedin', 'x'];

  try {
    // Seed a SAVED flow whose goal targets ALL FIVE platforms (the MonthPlan-Atria shape).
    const goal = analyzeDeterministic('Plan a month of content to brand our product across facebook, instagram, threads, linkedin and x');
    goal.platforms = ALL5 as typeof goal.platforms; // force the full set regardless of analyzer nuance
    goal.slots.language = 'vi'; // flow carries a concrete language the campaign should inherit
    const planned = planWorkflow(goal);
    if (!planned.ok) { check('planner ok', false, planned); return; }
    const draft = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(draft.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    const template = await nameRun(draft.id, user.id, 'MonthPlan-Test');
    check('seed → template (all 5 platforms)', template?.kind === 'template', template?.kind);

    // THE BUG PATH: create a campaign under the flow with NO platforms in the body.
    const created = await call('POST', '/campaigns', token, { product: 'MonthPlan-Test', flowId: draft.id });
    check('201 created', created.status === 201, created.status);
    const got: string[] = created.body?.data?.platforms ?? [];
    check('campaign INHERITED all 5 platforms from flow', ALL5.every((p) => got.includes(p)) && got.length === 5, got);
    check('campaign inherited language from flow', created.body?.data?.language === 'vi', created.body?.data?.language);

    // Explicit platforms in the body still win (no clobber).
    const explicit = await call('POST', '/campaigns', token, { product: 'Explicit', flowId: draft.id, platforms: ['facebook', 'x'] });
    check('explicit platforms preserved', JSON.stringify(explicit.body?.data?.platforms) === JSON.stringify(['facebook', 'x']), explicit.body?.data?.platforms);

    // No flow, no platforms → Facebook fallback (never platform-less).
    const bare = await call('POST', '/campaigns', token, { product: 'Bare' });
    check('no-flow campaign falls back to facebook', JSON.stringify(bare.body?.data?.platforms) === JSON.stringify(['facebook']), bare.body?.data?.platforms);
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }

  console.log(failures === 0 ? '\nPASS — campaign platform inheritance green' : `\nFAIL — ${failures} check(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
