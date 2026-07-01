// Focused smoke for this session's two new backend surfaces (live HTTP against :7100):
//   1. PATCH /orchestration/runs/:id — rename a flow in ANY status (owner-scoped).
//   2. PUT /agent/credentials/:agentId/:key — re-keyed to snake_case registry ids.
// DRY: no external posting. Creates + deletes its own throwaway tenants/runs.
// Run: server up on :7100, then `npx tsx src/orchestration/verify-rename-and-creds.ts`.
import { prisma } from '../db/client.ts';
import { signSession } from '../lib/auth-jwt.ts';
import { env } from '../config/env.ts';
import { createRun, createNodes, setRunStatus } from '../db/repos/workflow-run-repo.ts';

const BASE = `http://localhost:${env.PORT}`;
let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
};

const call = async (method: string, path: string, token?: string, body?: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

async function main(): Promise<void> {
  try { const h = await fetch(`${BASE}/health`); if (!h.ok) throw new Error(`health ${h.status}`); }
  catch (e) { console.error(`Server not reachable at ${BASE}. ${String(e)}`); process.exit(2); }

  const userA = await prisma.user.create({ data: { email: `rn-a-${Date.now()}@test.local` } });
  const userB = await prisma.user.create({ data: { email: `rn-b-${Date.now()}@test.local` } });
  const tokenA = signSession({ sub: userA.id, email: userA.email });
  const tokenB = signSession({ sub: userB.id, email: userB.email });

  try {
    // ── Part B: rename a flow in a NON-planned status (the whole point of PATCH vs /save)
    const run = await createRun({ ownerId: userA.id, goal: { kind: 'test' }, status: 'completed' });
    await createNodes(run.id, userA.id, [{ nodeId: 'n1', agentId: 'publisher', dependsOn: [] }]);

    const noAuth = await call('PATCH', `/orchestration/runs/${run.id}`, undefined, { name: 'X' });
    check('PATCH 401 without token', noAuth.status === 401, noAuth.status);

    const empty = await call('PATCH', `/orchestration/runs/${run.id}`, tokenA, { name: '' });
    check('PATCH empty name → 422', empty.status === 422, empty.status);

    const renamed = await call('PATCH', `/orchestration/runs/${run.id}`, tokenA, { name: 'Renamed While Completed' });
    check('PATCH rename on completed run → 200', renamed.status === 200, renamed.status);
    check('name persisted', renamed.body?.data?.name === 'Renamed While Completed', renamed.body?.data?.name);
    check('status unchanged (still completed)', renamed.body?.data?.status === 'completed', renamed.body?.data?.status);

    const cross = await call('PATCH', `/orchestration/runs/${run.id}`, tokenB, { name: 'Hijack' });
    check('PATCH cross-tenant → 404', cross.status === 404, cross.status);

    const missing = await call('PATCH', `/orchestration/runs/00000000-0000-0000-0000-000000000000`, tokenA, { name: 'Ghost' });
    check('PATCH unknown id → 404', missing.status === 404, missing.status);

    // ── Part C: credential allowlist re-keyed to snake_case registry ids
    const okKey = await call('PUT', `/agent/credentials/concept_writer/gemini_api_key`, tokenA, { value: 'sk-smoke-test' });
    check('PUT concept_writer/gemini_api_key → 200 (snake_case id)', okKey.status === 200, okKey.status);
    check('cred status active', okKey.body?.data?.status === 'active', okKey.body?.data);

    const videoKey = await call('PUT', `/agent/credentials/video/video_provider_key`, tokenA, { value: 'v-smoke' });
    check('PUT video/video_provider_key → 200 (renamed from voice-video)', videoKey.status === 200, videoKey.status);

    const oldKebab = await call('PUT', `/agent/credentials/concept-writer/gemini_api_key`, tokenA, { value: 'sk-x' });
    check('PUT old kebab concept-writer → 422 (retired)', oldKebab.status === 422, oldKebab.status);

    const oldVoice = await call('PUT', `/agent/credentials/voice-video/video_provider_key`, tokenA, { value: 'x' });
    check('PUT old kebab voice-video → 422 (retired)', oldVoice.status === 422, oldVoice.status);

    // Cleanup credentials (rename smoke leaves none of its own beyond these).
    await call('DELETE', `/agent/credentials/concept_writer/gemini_api_key`, tokenA);
    await call('DELETE', `/agent/credentials/video/video_provider_key`, tokenA);
    await setRunStatus(run.id, 'completed'); // no-op guard; run deleted below
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    console.log('cleanup: throwaway tenants + rows removed');
  }

  console.log(failures === 0 ? '\nPASS — rename + credential re-key checks green' : `\nFAIL — ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
