// Phase 06 verification — connection/credential hardening (the security phase). DB-backed, NO
// network. Proves:
//   H5 — a bare, never-liveness-verified pasted (form) token does NOT pass the spend gate; the
//        resolver now agrees with connection-state (both → needs_attention). A VERIFIED token
//        (real OAuthToken row) passes.
//   getActiveToken — a stale (needs_attention / expired) token is NOT returned as usable; a live
//        token is. Fail-closed: autonomy never publishes on a dead token.
// Creates one throwaway tenant, cleans up after.
import { prisma } from '../db/client.ts';
import { goalSpec, type GoalSpec } from './schemas/goal-spec.ts';
import { planWorkflow } from './master/workflow-planner.ts';
import { resolveConnections } from '../connectors/runtime/connection-resolver.ts';
import { resolveConnectionStates } from '../api/connection-state.ts';
import { getActiveToken } from '../tokens/service.ts';
import { upsertToken } from '../db/repos/token-repo.ts';
import { savePublisherCredential, platformTokenKey } from '../db/repos/agent-credential-repo.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const goal: GoalSpec = goalSpec.parse({
  outputs: { needsTextPost: true, needsPublishing: true },
  platforms: ['facebook'],
  slots: { product: 'AI automation suite' },
  provider: 'test',
});

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `conn-hard-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const planned = planWorkflow(goal);
    if (!planned.ok) { check('planner ok', false, planned); return; }

    // ── H5: bare pasted form token (vault cred, NO OAuthToken row) — never liveness-verified.
    await savePublisherCredential(user.id, platformTokenKey('facebook'), 'pasted-unverified-token');
    const bareRes = await resolveConnections(user.id, goal, planned.plan); // DEFAULT reader (real)
    check('H5: bare form token does NOT pass the gate', bareRes.status !== 'resolved', bareRes);
    check('H5: gate says needs_attention (reconnect/verify)', bareRes.status === 'needs_attention', bareRes);
    // The state UI must AGREE (was the disagreement — resolver active vs state needs_attention).
    const stateOf = await resolveConnectionStates(user.id);
    check('H5: connection-state also needs_attention (surfaces agree)', stateOf('facebook').state === 'needs_attention', stateOf('facebook'));

    // ── A VERIFIED token (real active OAuthToken row, as verifyAndRecordFormToken would write) passes.
    await upsertToken({ ownerId: user.id, platform: 'facebook', token: 'live-token', meta: { pageId: 'p1' }, status: 'active' });
    const okRes = await resolveConnections(user.id, goal, planned.plan);
    check('verified active token → gate resolved', okRes.status === 'resolved', okRes);
    check('connection-state → connected', (await resolveConnectionStates(user.id))('facebook').state === 'connected');

    // ── getActiveToken returns a live token…
    check('getActiveToken returns live token', (await getActiveToken(user.id, 'facebook')) === 'live-token');

    // …but NOT a stale one. Flip the row to needs_attention (no expiry → refresh not due → fail-closed).
    await upsertToken({ ownerId: user.id, platform: 'facebook', token: 'live-token', meta: { pageId: 'p1' }, status: 'needs_attention' });
    let threw = false;
    try { await getActiveToken(user.id, 'facebook'); } catch { threw = true; }
    check('getActiveToken THROWS on needs_attention token (no stale publish)', threw);

    // Expired active token also fails closed.
    await upsertToken({ ownerId: user.id, platform: 'facebook', token: 'live-token', meta: { pageId: 'p1' }, status: 'active', expiresAt: new Date(Date.now() - 86_400_000) });
    let threwExpired = false;
    try { await getActiveToken(user.id, 'facebook'); } catch { threwExpired = true; }
    check('getActiveToken THROWS on expired token', threwExpired);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — connection/credential hardening green (fail-closed; 0 network)' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
