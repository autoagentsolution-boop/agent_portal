// Verify §01.1 — per-tenant lead intake. Two owners, each with their own intake token;
// a lead captured with A's token must land on A and be invisible to B (and vice-versa).
// Legacy global secret → system owner. Unknown/revoked token → 401. Live HTTP against :7100.
import { prisma } from '../db/client.ts';
import { signSession } from '../lib/auth-jwt.ts';
import { env } from '../config/env.ts';

const BASE = `http://localhost:${env.PORT}`;
let fail = 0;
const ck = (n: string, c: boolean, x?: unknown) => { console.log(c ? `  ok   ${n}` : `  FAIL ${n} ${JSON.stringify(x)?.slice(0, 200)}`); if (!c) fail++; };
const call = async (m: string, p: string, opts: { token?: string; headers?: Record<string, string>; body?: unknown } = {}) => {
  const res = await fetch(`${BASE}${p}`, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : null };
};

async function main() {
  const a = await prisma.user.create({ data: { email: `lead-a-${Date.now()}@t.local` } });
  const b = await prisma.user.create({ data: { email: `lead-b-${Date.now()}@t.local` } });
  const jwtA = signSession({ sub: a.id, email: a.email });
  const jwtB = signSession({ sub: b.id, email: b.email });
  try {
    // Mint an intake token for each owner.
    const mkA = await call('POST', '/leads/intake-tokens', { token: jwtA, body: { label: 'A funnel' } });
    const mkB = await call('POST', '/leads/intake-tokens', { token: jwtB });
    ck('mint A → 201 + plaintext token', mkA.status === 201 && typeof mkA.body?.data?.token === 'string', { s: mkA.status });
    ck('mint requires JWT (401 no auth)', (await call('POST', '/leads/intake-tokens', {})).status === 401);
    const tokA = mkA.body?.data?.token as string;
    const tokB = mkB.body?.data?.token as string;

    // Capture a lead with A's token (header) and B's token (query).
    const capA = await call('POST', '/leads/webhook', { headers: { 'x-intake-token': tokA }, body: { email: `x-${Date.now()}@lead.local`, name: 'Alpha Lead' } });
    ck('capture with A token → created', capA.body?.data?.status === 'created', capA.body);
    const capB = await call('POST', `/leads/webhook?t=${encodeURIComponent(tokB)}`, { body: { email: `y-${Date.now()}@lead.local`, name: 'Beta Lead' } });
    ck('capture with B token (query) → created', capB.body?.data?.status === 'created', capB.body);

    // Isolation: A sees only A's lead, B only B's.
    const listA = await call('GET', '/leads', { token: jwtA });
    const listB = await call('GET', '/leads', { token: jwtB });
    ck('A sees exactly 1 lead (Alpha)', (listA.body?.data?.length ?? 0) === 1 && listA.body.data[0].name === 'Alpha Lead', listA.body?.data?.map((l: any) => l.name));
    ck('B sees exactly 1 lead (Beta)', (listB.body?.data?.length ?? 0) === 1 && listB.body.data[0].name === 'Beta Lead', listB.body?.data?.map((l: any) => l.name));
    ck('no cross-tenant leak (A has no Beta)', !listA.body?.data?.some((l: any) => l.name === 'Beta Lead'));

    // Unknown token → 401. Revoke A → its token stops working.
    ck('unknown intake token → 401', (await call('POST', '/leads/webhook', { headers: { 'x-intake-token': 'atk_bogus' }, body: { email: 'z@lead.local' } })).status === 401);
    ck('no token at all → 401', (await call('POST', '/leads/webhook', { body: { email: 'z@lead.local' } })).status === 401);
    const revoke = await call('DELETE', `/leads/intake-tokens/${mkA.body.data.id}`, { token: jwtA });
    ck('revoke A token → 204', revoke.status === 204);
    ck('revoked token → 401', (await call('POST', '/leads/webhook', { headers: { 'x-intake-token': tokA }, body: { email: 'after@lead.local' } })).status === 401);
    ck('cross-tenant revoke → 404', (await call('DELETE', `/leads/intake-tokens/${mkB.body.data.id}`, { token: jwtA })).status === 404);

    // Legacy global secret still works → system owner (back-compat), if configured.
    if (env.MKT_LEAD_WEBHOOK_SECRET) {
      const legacy = await call('POST', '/leads/webhook', { headers: { 'x-webhook-secret': env.MKT_LEAD_WEBHOOK_SECRET }, body: { email: `legacy-${Date.now()}@lead.local` } });
      ck('legacy global secret → created (system owner)', legacy.body?.data?.status === 'created', legacy.body);
    } else {
      console.log('  --   legacy secret not configured, skipping back-compat check');
    }
  } finally {
    await prisma.lead.deleteMany({ where: { ownerId: { in: [a.id, b.id] } } });
    await prisma.leadIntakeToken.deleteMany({ where: { ownerId: { in: [a.id, b.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    await prisma.$disconnect();
  }
  console.log(fail ? `\nFAIL — ${fail}` : '\nPASS — per-tenant lead intake isolated');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
