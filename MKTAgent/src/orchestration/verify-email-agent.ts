// Atria v2 P2-2c verification — the Email Agent nurture loop. Proves: draft generation (DRY stub LLM,
// no spend), that send builds a valid RFC822/base64url message, stamps lead.nurturedAt (idempotency +
// audit), targets the LEAD's stored email (decrypted), and is tenant-isolated. Gmail send is stubbed
// (no real email). Throwaway tenants.
import { prisma } from '../db/client.ts';
import { createLead, getLead, markLeadNurtured } from '../db/repos/lead-repo.ts';
import { draftNurtureEmail } from '../email/email-agent.ts';
import { sendGmailAs, buildRaw, type GmailSendFn } from '../email/gmail-send.ts';
import type { LlmJsonFn } from '../orchestration/master/llm-json.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const stubLlm: LlmJsonFn = async () => ({ subject: 'Quick follow-up on your interest 🙂', body: 'Hi Mai,\n\nThanks for checking out our AI automation — happy to answer any questions.\n\nBest' });

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `email-${Date.now()}@test.local`, defaultLanguage: 'en', brandName: 'Acme AI' } });
  const other = await prisma.user.create({ data: { email: `email-other-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const lead = await createLead({
      ownerId: user.id, name: 'Mai Nguyễn', email: 'mai@example.com', phone: null, message: 'Interested in pricing',
      sourceProduct: 'AI automation platform', source: 'comment', calBookingUid: null, score: 82, scoreReasons: [],
    });

    // ── Draft (DRY stub) ────────────────────────────────────────────────────────────────────────
    const decrypted = (await getLead(lead.id, user.id))!;
    check('setup: lead email decrypts to plaintext', decrypted.email === 'mai@example.com', decrypted.email);
    const draft = await draftNurtureEmail(user.id, decrypted, { brand: 'Acme AI', llm: stubLlm });
    check('draft: has subject + body', Boolean(draft.subject) && Boolean(draft.body), draft);
    check('draft: never contacted yet', decrypted.nurturedAt === null, decrypted.nurturedAt);

    // ── buildRaw shape (RFC822 → base64url, UTF-8 subject) ─────────────────────────────────────
    const raw = buildRaw('mai@example.com', draft.subject, draft.body);
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    check('send: raw is base64url decodable', decoded.includes('To: mai@example.com'), decoded.slice(0, 40));
    check('send: subject UTF-8 B-encoded (emoji/VN safe)', decoded.includes('Subject: =?UTF-8?B?'), decoded.slice(0, 120));

    // ── Send via stubbed Gmail (no real email) → success ───────────────────────────────────────
    const captured: { raw?: string; owner?: string } = {};
    const stubSend: GmailSendFn = async (r, ownerId) => { captured.raw = r; captured.owner = ownerId; return { id: 'msg_123' }; };
    const result = await sendGmailAs(user.id, { to: decrypted.email, subject: draft.subject, body: draft.body }, stubSend);
    check('send: ok + messageId', result.ok && result.id === 'msg_123', result);
    check('send: dispatched for the right owner', captured.owner === user.id, captured.owner);

    // ── Stamp nurturedAt (idempotency/audit) ────────────────────────────────────────────────────
    check('stamp: markLeadNurtured true for owner', await markLeadNurtured(lead.id, user.id));
    const after = (await getLead(lead.id, user.id))!;
    check('stamp: nurturedAt now set', after.nurturedAt !== null, after.nurturedAt);
    check('stamp: cross-tenant mark is a no-op', !(await markLeadNurtured(lead.id, other.id)));

    // ── Scope-missing path degrades to a clean error (not a throw) ───────────────────────────────
    const scopeErr: GmailSendFn = async () => { throw new Error('insufficient authentication scopes (403)'); };
    const denied = await sendGmailAs(user.id, { to: decrypted.email, subject: 's', body: 'b' }, scopeErr);
    check('scope: 403 → gmail_scope_missing (no throw)', !denied.ok && denied.error === 'gmail_scope_missing', denied);

    // ── Tenant isolation: other tenant can't read this lead ─────────────────────────────────────
    check('isolation: cross-tenant getLead → null', (await getLead(lead.id, other.id)) === null);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.user.delete({ where: { id: other.id } });
    console.log('cleanup: throwaway tenants removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — email agent loop green' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
