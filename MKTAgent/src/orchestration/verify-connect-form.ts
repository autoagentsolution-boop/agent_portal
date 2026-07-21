// OAuth-less connect via form (live HTTP against :7100 + direct service calls).
//
// REWRITTEN 2026-07-21. The original asserted that a pasted token is immediately usable and shows
// `connected` with no OAuthToken row. That contract was superseded by `verifyAndRecordFormToken`:
// saving a paste-entered token now runs a REAL liveness check and records the verdict as an
// OAuthToken row, precisely so a garbage or expired paste stops reporting "connected". Because this
// script pastes a deliberately fake token, the modern correct outcome is the opposite of what it
// asserted — it was failing on a behaviour improvement, not a regression.
//
// What it pins now:
//   1. the credential is stored encrypted and never echoed back (unchanged),
//   2. a paste that FAILS liveness is recorded needs_attention and getActiveToken FAILS CLOSED
//      rather than publishing on a dead token,
//   3. the preflight gate holds for that platform instead of waving it through,
//   4. the vault fallback still resolves when no OAuthToken row exists (verification never ran).
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

    // Saving runs a real liveness check and records the verdict. The pasted value is fake, so the
    // verdict must be needs_attention — an optimistic "connected" here is the bug this replaced.
    const recorded = await prisma.oAuthToken.findUnique({ where: { ownerId_platform: { ownerId: user.id, platform: 'facebook' } } });
    check('paste is verified on save, not assumed live', recorded?.status === 'needs_attention', recorded?.status ?? null);

    // FAIL CLOSED: getActiveToken must refuse a dead token rather than hand it to the publisher.
    // Returning it "because it is all we have" is how LinkedIn's no-refresh tier silently died.
    let refusal: string | null = null;
    try { await getActiveToken(user.id, 'facebook'); } catch (e) { refusal = String(e); }
    check('getActiveToken refuses a token that failed liveness', refusal !== null && /needs re-auth/.test(refusal), refusal);

    // /connections reflects the TRUE state, not "saved therefore connected".
    const after = await call('GET', '/connections', token);
    const fbAfter = (after.body?.data as Array<{ platformKey: string; state: string }>).find((c) => c.platformKey === 'facebook');
    check('facebook NOT reported connected on a failed paste', fbAfter?.state !== 'connected', fbAfter);

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
    // A failed paste must GATE, not sail through — the whole point of verifying on save.
    check('preflight gates a facebook paste that failed liveness', resolution.status !== 'resolved', resolution.status);

    // The vault fallback is still live for the case verification never covered (no OAuthToken row —
    // e.g. a credential saved before verification existed, or a platform with no liveness provider).
    // Deleting the recorded row reproduces exactly that state.
    await prisma.oAuthToken.deleteMany({ where: { ownerId: user.id, platform: 'facebook' } });
    const fallback = await getActiveToken(user.id, 'facebook');
    check('vault fallback resolves the form token when no OAuthToken row exists', fallback === FAKE, fallback.slice(0, 8));
    // …but the GATE still holds on it, and that split is deliberate (connection-resolver.ts:50-55):
    // a never-verified paste is synthesized as `needs_attention`, because the gate authorizes real
    // spend while getActiveToken only answers "what token would we use". Fail-closed at the gate.
    const resolvedNow = await resolveConnections(user.id, goal, planned.plan);
    check('gate still holds on a never-verified vault credential', resolvedNow.status === 'needs_attention', resolvedNow.status);

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

    // requiredActions DTO shape + secrecy. Moved here from verify-api 2026-07-21: that script only
    // saw these on a pre-flight refusal, which "gate-after-content" removed, and it needed a live
    // model to get there. The resolver produces the same actions and is deterministic and free.
    const actions = resIg.status === 'missing_connection' ? resIg.required : [];
    check('gate: requiredActions present', actions.length >= 1, actions);
    check('gate: action targets instagram (connect_platform)', actions.some((a) => a.platform === 'instagram' && a.type === 'connect_platform'), actions);
    check('gate: action carries connectUrl', actions.every((a) => typeof a.connectUrl === 'string' && a.connectUrl.includes('/connect/')), actions[0]);
    // Secrecy: a gate response must never leak token material beyond the closed DTO shape.
    const allowedKeys = ['type', 'platform', 'displayName', 'connectUrl', 'reason', 'capabilities'];
    check('gate: requiredActions expose no token/extra fields', actions.every((a) => Object.keys(a).every((k) => allowedKeys.includes(k))), actions[0]);
  } finally {
    // OAuthToken rows are now created by the save path (verifyAndRecordFormToken), so they must be
    // cleaned up too — the original cleanup predates that and leaked a row per run.
    await prisma.oAuthToken.deleteMany({ where: { ownerId: user.id } });
    await prisma.agentCredential.deleteMany({ where: { ownerId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant + credentials removed');
  }

  console.log(failures === 0 ? '\nPASS — connect-via-form (vault fallback + connections state) green' : `\nFAIL — ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
