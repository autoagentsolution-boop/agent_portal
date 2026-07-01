// Phase 1 smoke: OAuth-less connect via form. Proves (live HTTP against :7100 + direct
// service calls) that a platform credential entered through the form endpoint is:
//   1. stored encrypted under publisher/<platform>_access_token (PUT /agent/credentials),
//   2. resolved by getActiveToken() as the publish-time token (vault fallback),
//   3. reflected as `connected` in GET /connections without any OAuthToken row.
// DRY: no external posting. Creates + deletes its own throwaway tenant.
// Run: server up on :7100, then `npx tsx src/orchestration/verify-connect-form.ts`.
import { prisma } from '../db/client.ts';
import { signSession } from '../lib/auth-jwt.ts';
import { env } from '../config/env.ts';
import { getActiveToken } from '../tokens/service.ts';
import { resolveConnections } from '../connectors/runtime/connection-resolver.ts';
import { planWorkflow } from './master/workflow-planner.ts';
import { goalSpec } from './schemas/goal-spec.ts';

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

  const user = await prisma.user.create({ data: { email: `cf-${Date.now()}@test.local` } });
  const token = signSession({ sub: user.id, email: user.email });
  const FAKE = 'FAKE-fb-token-not-real-do-not-post';

  try {
    // Baseline: no token anywhere → getActiveToken throws, /connections shows not_connected.
    let threw = false;
    try { await getActiveToken(user.id, 'facebook'); } catch { threw = true; }
    check('getActiveToken throws with no credential', threw);

    const before = await call('GET', '/connections', token);
    const fbBefore = (before.body?.data as Array<{ platformKey: string; state: string }>).find((c) => c.platformKey === 'facebook');
    check('facebook not_connected before form save', fbBefore?.state === 'not_connected', fbBefore);

    // Store the access token via the form endpoint (same as the UI form).
    const put = await call('PUT', '/agent/credentials/publisher/facebook_access_token', token, { value: FAKE });
    check('PUT publisher/facebook_access_token → 200', put.status === 200, put.status);

    // Fallback resolves the form token as the publish-time token.
    const resolved = await getActiveToken(user.id, 'facebook');
    check('getActiveToken returns form token (vault fallback)', resolved === FAKE, resolved.slice(0, 8));

    // /connections now reports connected — with NO OAuthToken row present.
    const after = await call('GET', '/connections', token);
    const fbAfter = (after.body?.data as Array<{ platformKey: string; state: string }>).find((c) => c.platformKey === 'facebook');
    check('facebook connected after form save (no OAuthToken)', fbAfter?.state === 'connected', fbAfter);

    // Value never echoed back by the status endpoint.
    const status = await call('GET', '/agent/credentials/status', token);
    const row = (status.body?.data as Array<{ agentId: string; key: string; status: string; value?: string }>)
      .find((c) => c.agentId === 'publisher' && c.key === 'facebook_access_token');
    check('credential listed in status', Boolean(row), row);
    check('credential value NOT echoed', row !== undefined && !('value' in row), Object.keys(row ?? {}));

    // Disallowed key still rejected (allowlist intact).
    const bad = await call('PUT', '/agent/credentials/publisher/not_a_real_key', token, { value: 'x' });
    check('PUT disallowed key → 422', bad.status === 422, bad.status);

    // Phase 3: the execute-preflight (Connection Resolver, default reader) must count
    // the form credential as a live connection — else a form-connected user is wrongly
    // gated at needs_connection. Build a real publishing plan targeting facebook.
    const goal = goalSpec.parse({
      outputs: { needsTextPost: true, needsPublishing: true },
      platforms: ['facebook'],
      slots: { product: 'AI automation suite' },
      provider: 'test',
    });
    const planned = planWorkflow(goal);
    if (!planned.ok) throw new Error(`fixture plan failed: ${planned.error}`);
    const resolution = await resolveConnections(user.id, goal, planned.plan); // real default reader
    check('preflight resolves with only a form credential (facebook)', resolution.status === 'resolved', resolution);

    // And a platform with NO credential at all still gates.
    const goalIg = goalSpec.parse({
      outputs: { needsTextPost: true, needsPublishing: true },
      platforms: ['instagram'],
      slots: { product: 'AI automation suite' },
      provider: 'test',
    });
    const plannedIg = planWorkflow(goalIg);
    if (!plannedIg.ok) throw new Error(`fixture plan failed: ${plannedIg.error}`);
    const resIg = await resolveConnections(user.id, goalIg, plannedIg.plan);
    check('preflight still gates instagram (no credential)', resIg.status === 'missing_connection', resIg);
  } finally {
    await prisma.agentCredential.deleteMany({ where: { ownerId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant + credentials removed');
  }

  console.log(failures === 0 ? '\nPASS — connect-via-form (vault fallback + connections state) green' : `\nFAIL — ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
