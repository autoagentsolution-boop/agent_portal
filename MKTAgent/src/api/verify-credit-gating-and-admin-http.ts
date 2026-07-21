// Live HTTP verify for credit-wallet Phase 02 (gating + balance echo) and Phase 03 (super-admin console).
// Proves, against the running server at :PORT with real auth + middleware:
//   - a 0-balance tenant is 402'd at flow START (chat is never routed here so it stays free);
//   - /auth/me echoes isSuperAdmin + remaining balance;
//   - /admin/* is 404 for a non-admin (surface hidden) and 200 for a super-admin;
//   - a grant raises the tenant's balance and lets the SAME run pass the credit gate (→ needs_connection,
//     which stops before any spend — no LLM/publish);
//   - the capability-request backlog surfaces a recorded gap.
// Two throwaway tenants, cleaned up. No Gemini, no publishing.
import { prisma } from '../db/client.ts';
import { signSession } from '../lib/auth-jwt.ts';
import { env } from '../config/env.ts';
import { analyzeDeterministic } from '../orchestration/master/deterministic-analyzer.ts';
import { planWorkflow } from '../orchestration/master/workflow-planner.ts';
import { createRun, createNodes } from '../db/repos/workflow-run-repo.ts';
import { recordCapabilityGap } from '../db/repos/roadmap-demand-repo.ts';

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

  const tenant = await prisma.user.create({ data: { email: `gate-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  const admin = await prisma.user.create({ data: { email: `admin-${Date.now()}@test.local`, defaultLanguage: 'en', isSuperAdmin: true } });
  const tToken = signSession({ sub: tenant.id, email: tenant.email });
  const aToken = signSession({ sub: admin.id, email: admin.email });

  try {
    // A planned PUBLISHING run for the (0-balance) tenant — it requires a social connection, so once the
    // credit gate passes the run stops at the connection gate (no execution → no spend).
    const goal = analyzeDeterministic('Post a launch announcement for our AI automation product on facebook');
    const planned = planWorkflow(goal);
    if (!planned.ok) { check('planner ok', false, planned); return; }
    const run = await createRun({ ownerId: tenant.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(run.id, tenant.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));

    console.log('gate + /auth/me (Phase 02)');
    const me0 = await call('GET', '/auth/me', tToken);
    check('/auth/me echoes credits=0 + isSuperAdmin=false', me0.body?.data?.credits === 0 && me0.body?.data?.isSuperAdmin === false, me0.body?.data);
    const exec0 = await call('POST', `/orchestration/runs/${run.id}/execute`, tToken);
    check('0-balance flow execute → 402 insufficient_credits', exec0.status === 402 && exec0.body?.error === 'insufficient_credits', exec0);

    console.log('admin auth (Phase 03)');
    const nonAdmin = await call('GET', '/admin/tenants', tToken);
    check('non-admin GET /admin/tenants → 404 (surface hidden)', nonAdmin.status === 404, nonAdmin.status);
    const adminList = await call('GET', '/admin/tenants', aToken);
    const listed = Array.isArray(adminList.body?.data) && adminList.body.data.some((t: any) => t.ownerId === tenant.id);
    check('super-admin GET /admin/tenants → 200 incl. tenant', adminList.status === 200 && listed, adminList.status);

    console.log('grant → balance rises → gate passes');
    const grant = await call('POST', '/admin/grant', aToken, { ownerId: tenant.id, credits: 500, reason: 'verify' });
    check('grant → 200, new balance 500', grant.status === 200 && grant.body?.data?.balance === 500, grant.body);
    const me1 = await call('GET', '/auth/me', tToken);
    check('/auth/me reflects granted balance 500', me1.body?.data?.credits === 500, me1.body?.data);
    const exec1 = await call('POST', `/orchestration/runs/${run.id}/execute`, tToken);
    // Credit gate passed once granted (not 402). BUG-3 (gate-after-content): a plan that can produce a
    // reviewable draft now RUNS pre-connect (parks at the publish gate later), so accept `running` OR the
    // legacy `needs_connection` (a no-draft plan) — either proves the credit gate let the run through.
    const execRunStatus = exec1.body?.data?.status;
    check('post-grant execute is NOT 402 (credit gate passed)', exec1.status !== 402 && (execRunStatus === 'running' || execRunStatus === 'needs_connection'), { status: exec1.status, runStatus: execRunStatus });

    console.log('grant to bad owner → 404');
    const badGrant = await call('POST', '/admin/grant', aToken, { ownerId: '00000000-0000-0000-0000-000000000000', credits: 10 });
    check('grant to non-existent tenant → 404 tenant_not_found', badGrant.status === 404, badGrant);

    console.log('capability-request backlog');
    await recordCapabilityGap(tenant.id, 'transcribe-audio', 'verify_signal', { produces: 'transcript', exampleTask: 'transcribe this call' });
    const caps = await call('GET', '/admin/capability-requests', aToken);
    const hasCap = Array.isArray(caps.body?.data) && caps.body.data.some((c: any) => c.capabilityId === 'transcribe-audio');
    check('super-admin sees the recorded capability request', caps.status === 200 && hasCap, caps.status);

    console.log('provider spend (super-admin only)');
    const spendDenied = await call('GET', '/admin/provider-spend', tToken);
    check('non-admin GET /admin/provider-spend → 404 (platform bill stays hidden)', spendDenied.status === 404, spendDenied.status);
    const spend = await call('GET', '/admin/provider-spend', aToken);
    const sd = spend.body?.data;
    check('super-admin GET /admin/provider-spend → 200', spend.status === 200, spend.status);
    check('spend carries all four windows', ['last24h', 'last7d', 'last30d', 'lifetime'].every((k) => typeof sd?.windows?.[k]?.costUsd === 'number'), sd?.windows);
    check('spend windows nest: 24h ≤ 7d ≤ 30d ≤ lifetime',
      sd?.windows?.last24h.costUsd <= sd?.windows?.last7d.costUsd
      && sd?.windows?.last7d.costUsd <= sd?.windows?.last30d.costUsd
      && sd?.windows?.last30d.costUsd <= sd?.windows?.lifetime.costUsd, sd?.windows);
    // The whole point of option A: report spend, never claim a balance we cannot read.
    check('spend claims NO remaining balance', !JSON.stringify(sd ?? {}).match(/"(balance|remaining|runway)"/i), Object.keys(sd ?? {}));
  } finally {
    await prisma.workflowNodeRun.deleteMany({ where: { ownerId: tenant.id } });
    await prisma.workflowRun.deleteMany({ where: { ownerId: tenant.id } });
    await prisma.roadmapDemand.deleteMany({ where: { ownerId: tenant.id } });
    await prisma.creditLedger.deleteMany({ where: { ownerId: { in: [tenant.id, admin.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [tenant.id, admin.id] } } });
    console.log('cleanup: throwaway tenants removed');
  }

  console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILED`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
