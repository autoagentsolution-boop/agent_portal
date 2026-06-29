// Phase 5 verification — live HTTP loop against a running server (:7100). Mints a
// JWT for two throwaway tenants, exercises the orchestration lifecycle over real
// fetch: 401 no-auth, create→clarify→approve→approve-node, cross-tenant 404, GET.
// DRY-RUN: the publisher runs the live path but the materialized Post has no media
// → publish_result faithfully errors (no real social post). Cleans up after.
//
// Run: server up on :7100 (ENABLE_*_CRON unset), then `npx tsx src/orchestration/verify-api.ts`.
import { prisma } from '../db/client.ts';
import { signSession } from '../lib/auth-jwt.ts';
import { env } from '../config/env.ts';

const BASE = `http://localhost:${env.PORT}`;
let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
};

interface Json { status: number; body: any }
const call = async (method: string, path: string, token?: string, body?: unknown): Promise<Json> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

async function main(): Promise<void> {
  // Health gate first — fail fast with a clear message if the server isn't up.
  try {
    const h = await fetch(`${BASE}/health`);
    if (!h.ok) throw new Error(`health ${h.status}`);
  } catch (e) {
    console.error(`Server not reachable at ${BASE} — start it first (npx tsx src/server.ts). ${String(e)}`);
    process.exit(2);
  }

  const userA = await prisma.user.create({ data: { email: `api-a-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  const userB = await prisma.user.create({ data: { email: `api-b-${Date.now()}@test.local` } });
  const tokenA = signSession({ sub: userA.id, email: userA.email });
  const tokenB = signSession({ sub: userB.id, email: userB.email });

  try {
    // Auth gate.
    const noAuth = await call('POST', '/orchestration/runs', undefined, { message: 'Post about X on facebook' });
    check('401 without token', noAuth.status === 401, noAuth);

    // Vague request → awaiting_clarification (asks product). Conversational unify: the
    // run is now backed by a chat session and carries an authored assistant message.
    const vague = await call('POST', '/orchestration/runs', tokenA, { message: 'help me with marketing' });
    check('201 created (vague)', vague.status === 201, vague.status);
    check('vague → awaiting_clarification', vague.body?.data?.status === 'awaiting_clarification', vague.body?.data?.status);
    check('clarification questions present', (vague.body?.data?.questions?.length ?? 0) >= 1, vague.body?.data?.questions);
    check('run carries chatSessionId', typeof vague.body?.data?.chatSessionId === 'string', vague.body?.data?.chatSessionId);
    check('run carries assistantMessage', typeof vague.body?.data?.assistantMessage === 'string' && vague.body.data.assistantMessage.length > 1, vague.body?.data?.assistantMessage);
    const vagueRunId = vague.body?.data?.id;
    const chatId = vague.body?.data?.chatSessionId;

    // Richness gate: product + a single platform is now too thin to plan — the agent
    // must ASK first (audience/angle), not jump to a bare DAG. This is the core fix.
    const thin = await call('POST', '/orchestration/runs', tokenA, {
      message: 'Post about our AI automation product on facebook with file id 1bo4diy3vlH9VmRE-78Z15ux9053-KZci',
    });
    check('thin (product+platform) → awaiting_clarification', thin.body?.data?.status === 'awaiting_clarification', thin.body?.data?.status);
    check('thin asks audience or angle', (thin.body?.data?.questions ?? []).some((q: any) => (q.slot === 'targetAudience' || q.slot === 'angle') && q.required), thin.body?.data?.questions);

    // Answer clarification on the vague run → re-plan. Reuses the same chat session.
    const clarified = await call('POST', `/orchestration/runs/${vagueRunId}/clarify`, tokenA, {
      answers: { product: 'AI automation suite', output_format: 'Text + infographic', platforms: ['facebook'], targetAudience: 'small business owners', angle: 'save operational time' },
    });
    check('clarify → planned', clarified.body?.data?.status === 'planned', clarified.body?.data?.status);
    check('plan has nodes', (clarified.body?.data?.nodes?.length ?? 0) >= 2, clarified.body?.data?.nodes?.length);
    check('clarify keeps same chat session', clarified.body?.data?.chatSessionId === chatId, clarified.body?.data?.chatSessionId);
    check('clarify carries assistantMessage', typeof clarified.body?.data?.assistantMessage === 'string', clarified.body?.data?.assistantMessage);

    // History restore: latest run for the chat session.
    const byChat = await call('GET', `/orchestration/runs/by-chat/${chatId}`, tokenA);
    check('by-chat restore → 200 latest run', byChat.status === 200 && byChat.body?.data?.id === vagueRunId, byChat.status);
    check('by-chat cross-tenant → 404', (await call('GET', `/orchestration/runs/by-chat/${chatId}`, tokenB)).status === 404);

    // Fully-specified request in one shot → planned immediately (rich = no gate).
    const complete = await call('POST', '/orchestration/runs', tokenA, {
      message: 'Post about our AI automation product on facebook, audience small business owners, angle saving operational time, with file id 1bo4diy3vlH9VmRE-78Z15ux9053-KZci',
    });
    check('rich one-shot → planned', complete.body?.data?.status === 'planned', complete.body?.data?.status);
    const runId = complete.body?.data?.id;

    // Cross-tenant read → 404.
    const leak = await call('GET', `/orchestration/runs/${runId}`, tokenB);
    check('cross-tenant GET → 404', leak.status === 404, leak.status);

    // Approve → executes, halts at publisher gate (needs_approval).
    const approved = await call('POST', `/orchestration/runs/${runId}/approve`, tokenA);
    check('approve → needs_approval', approved.body?.data?.status === 'needs_approval', approved.body?.data?.status);
    const pub = approved.body?.data?.nodes?.find((n: any) => n.agentId === 'publisher');
    check('publisher node awaiting_approval', pub?.status === 'awaiting_approval', pub?.status);
    check('concept_writer completed', approved.body?.data?.nodes?.find((n: any) => n.agentId === 'concept_writer')?.status === 'completed');

    // Wrong state guard: approve again → 409.
    const reApprove = await call('POST', `/orchestration/runs/${runId}/approve`, tokenA);
    check('re-approve → 409 not_planned', reApprove.status === 409, reApprove.status);

    // Approve the publisher node → resume → completed (live publish path, real media id).
    const resumed = await call('POST', `/orchestration/runs/${runId}/approve-node/${pub.nodeId}`, tokenA);
    check('approve-node → completed', resumed.body?.data?.status === 'completed', resumed.body?.data?.status);
    const pr = resumed.body?.data?.artifacts?.find((a: any) => a.type === 'publish_result');
    check('publish_result artifact present', Boolean(pr), resumed.body?.data?.artifacts?.map((a: any) => a.type));

    // List runs for A.
    const list = await call('GET', '/orchestration/runs', tokenA);
    check('list returns A\'s runs', (list.body?.data?.length ?? 0) >= 2, list.body?.data?.length);
    check('list 401 for no token', (await call('GET', '/orchestration/runs')).status === 401);

    // ---- Connections (M2-lite, read-only) ----
    check('GET /connections 401 without token', (await call('GET', '/connections')).status === 401);
    const conns = await call('GET', '/connections', tokenA);
    check('GET /connections 200 for A', conns.status === 200, conns.status);
    // Always lists all 5 platforms (connected or not) — fresh tenant A has none yet.
    const rows = conns.body?.data ?? [];
    check('connections lists 5 platforms', rows.length === 5, rows.length);
    check('fresh tenant → all not_connected', rows.every((r: any) => r.state === 'not_connected'), rows.map((r: any) => r.state));
    check('each row carries capabilities + connectUrl', rows.every((r: any) => Array.isArray(r.capabilities) && typeof r.connectUrl === 'string'), rows[0]);
    check('no token value leaked in connection rows', rows.every((r: any) => !('token' in r) && !('refreshToken' in r)), rows[0]);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    console.log('cleanup: 2 throwaway tenants removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — orchestration API checks green' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
