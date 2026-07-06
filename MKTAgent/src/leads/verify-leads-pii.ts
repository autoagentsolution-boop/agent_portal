// Verify §01.2 — lead PII encrypted at rest. Capture a lead over HTTP, then: (a) GET /leads
// returns the PLAINTEXT email (decrypt round-trip), (b) the raw DB column holds CIPHERTEXT not
// plaintext, (c) email_bidx is set and dedupe on it works, (d) raw_payload is not persisted.
import { prisma } from '../db/client.ts';
import { signSession } from '../lib/auth-jwt.ts';
import { env } from '../config/env.ts';
import { isEncrypted } from '../lib/crypto.ts';

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
  const u = await prisma.user.create({ data: { email: `pii-${Date.now()}@t.local` } });
  const jwt = signSession({ sub: u.id, email: u.email });
  const email = `secret-${Date.now()}@lead.local`;
  try {
    const mk = await call('POST', '/leads/intake-tokens', { token: jwt });
    const tok = mk.body?.data?.token as string;

    const cap = await call('POST', '/leads/webhook', { headers: { 'x-intake-token': tok }, body: { email, name: 'PII Person', phone: '+84900000000', message: 'call me' } });
    ck('capture → created', cap.body?.data?.status === 'created', cap.body);

    // (a) read path decrypts back to plaintext
    const list = await call('GET', '/leads', { token: jwt });
    const lead = list.body?.data?.[0];
    ck('GET /leads returns plaintext email', lead?.email === email, lead?.email);
    ck('GET /leads returns plaintext name/phone', lead?.name === 'PII Person' && lead?.phone === '+84900000000', { n: lead?.name, p: lead?.phone });

    // (b) raw DB column is ciphertext, not plaintext
    const raw = await prisma.lead.findFirst({ where: { ownerId: u.id }, orderBy: { receivedAt: 'desc' } });
    ck('DB email column is CIPHERTEXT (not plaintext)', isEncrypted(raw?.email) && raw?.email !== email, raw?.email?.slice(0, 12));
    ck('DB name/phone/message ciphertext', isEncrypted(raw?.name) && isEncrypted(raw?.phone) && isEncrypted(raw?.message), { n: isEncrypted(raw?.name), p: isEncrypted(raw?.phone) });
    ck('email_bidx set', typeof raw?.emailBidx === 'string' && raw!.emailBidx!.length === 64, raw?.emailBidx?.length);
    ck('raw_payload NOT persisted (no-excess)', raw?.rawPayload === null, raw?.rawPayload);

    // (c) dedupe on bidx: same email again → duplicate
    const dup = await call('POST', '/leads/webhook', { headers: { 'x-intake-token': tok }, body: { email, name: 'Again' } });
    ck('same email again → duplicate (bidx dedupe)', dup.body?.data?.status === 'duplicate', dup.body);
  } finally {
    await prisma.lead.deleteMany({ where: { ownerId: u.id } });
    await prisma.leadIntakeToken.deleteMany({ where: { ownerId: u.id } });
    await prisma.user.delete({ where: { id: u.id } });
    await prisma.$disconnect();
  }
  console.log(fail ? `\nFAIL — ${fail}` : '\nPASS — lead PII encrypted at rest, decrypt + dedupe work');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
