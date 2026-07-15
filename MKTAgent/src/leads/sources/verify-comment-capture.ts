// Verify Phase 03 — comment→lead capture hardening. FIXTURE payloads only, NO live Meta/X/LinkedIn
// calls: the Meta webhook GET/POST handlers and the X free-tier gate are exercised directly against
// realistic (but hand-built) Graph-webhook envelopes, mirroring verify-leads-comments.ts's "inject a
// fake fetcher" style. Throwaway tenant, cleans up.
import { createHmac } from 'node:crypto';
import { prisma } from '../../db/client.ts';
import { createCampaign } from '../../db/repos/campaign-repo.ts';
import { createPost } from '../../db/repos/post-repo.ts';
import { pollCommentsForLeads, type FetchedComment } from './comment-poller.ts';
import {
  handleVerifyChallenge,
  handleWebhookDelivery,
  normalizeMetaWebhookEntry,
} from './meta-webhook.ts';
import { fetchXComments } from './comment-fetchers/x.ts';

let fail = 0;
const ck = (n: string, c: boolean, x?: unknown) => {
  console.log(c ? `  ok   ${n}` : `  FAIL ${n} ${JSON.stringify(x)?.slice(0, 200)}`);
  if (!c) fail++;
};

const TEST_SECRET = 'verify-test-secret-not-real';
const TEST_VERIFY_TOKEN = 'verify-test-token-not-real';
const sign = (raw: Buffer): string => `sha256=${createHmac('sha256', TEST_SECRET).update(raw).digest('hex')}`;

async function main() {
  // ---- GET — verify-challenge handshake (pure, no DB) ----
  const okChallenge = handleVerifyChallenge(
    { 'hub.mode': 'subscribe', 'hub.verify_token': TEST_VERIFY_TOKEN, 'hub.challenge': 'abc123' },
    TEST_VERIFY_TOKEN,
  );
  ck('GET challenge: correct token → 200 + echoes challenge', okChallenge.status === 200 && okChallenge.body === 'abc123', okChallenge);
  const wrongToken = handleVerifyChallenge(
    { 'hub.mode': 'subscribe', 'hub.verify_token': 'guessed', 'hub.challenge': 'abc123' },
    TEST_VERIFY_TOKEN,
  );
  ck('GET challenge: wrong token → 403, no echo', wrongToken.status === 403 && wrongToken.body === '', wrongToken);
  const wrongMode = handleVerifyChallenge(
    { 'hub.mode': 'unsubscribe', 'hub.verify_token': TEST_VERIFY_TOKEN, 'hub.challenge': 'abc123' },
    TEST_VERIFY_TOKEN,
  );
  ck('GET challenge: wrong hub.mode → 403', wrongMode.status === 403, wrongMode);

  // ---- Pure normalize: FB / IG / Threads envelopes + malformed shapes never throw ----
  const fbNorm = normalizeMetaWebhookEntry({
    object: 'page',
    entry: [{ id: 'page1', changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', post_id: 'page1_post1', comment_id: 'c1', message: 'hi', sender_id: 'u1', sender_name: 'N' } }] }],
  });
  ck('normalize: FB feed comment → 1 normalized', fbNorm.length === 1 && fbNorm[0]?.platform === 'facebook' && fbNorm[0]?.platformPostId === 'page1_post1', fbNorm);
  const igNorm = normalizeMetaWebhookEntry({
    object: 'instagram',
    entry: [{ id: 'ig1', changes: [{ field: 'comments', value: { id: 'ic1', text: 'hi', media: { id: 'media1' }, from: { id: 'igu1', username: 'igname' } } }] }],
  });
  ck('normalize: IG comment → 1 normalized', igNorm.length === 1 && igNorm[0]?.platform === 'instagram' && igNorm[0]?.platformPostId === 'media1' && igNorm[0]?.authorId === 'igu1', igNorm);
  const threadsNorm = normalizeMetaWebhookEntry({
    object: 'threads',
    entry: [{ id: 'th1', changes: [{ field: 'replies', value: { id: 'tr1', text: 'hi', media: { id: 'tmedia1' }, from: { username: 'thname' } } }] }],
  });
  ck('normalize: Threads reply → 1 normalized', threadsNorm.length === 1 && threadsNorm[0]?.platform === 'threads' && threadsNorm[0]?.platformPostId === 'tmedia1', threadsNorm);
  ck('normalize: null body → [] (no throw)', normalizeMetaWebhookEntry(null).length === 0);
  ck('normalize: no entry array → []', normalizeMetaWebhookEntry({ object: 'page' }).length === 0);
  ck('normalize: changes not an array → []', normalizeMetaWebhookEntry({ object: 'page', entry: [{ changes: 'not-an-array' }] }).length === 0);
  ck('normalize: unknown object → []', normalizeMetaWebhookEntry({ object: 'bogus', entry: [{ changes: [{ field: 'feed', value: {} }] }] }).length === 0);

  // ---- X free-tier gate: no token, no network — a clean no-op when ENABLE_X_LEAD_CAPTURE is off ----
  const xResult = await fetchXComments('tweet-doesnt-matter', '00000000-0000-0000-0000-000000000000');
  ck('X fetcher: free-tier (flag off) → [] with no network/token lookup', Array.isArray(xResult) && xResult.length === 0, xResult);

  // ---- DB-backed: webhook POST → captureLead, handle-only + email-typed, dedupe with the poller ----
  const owner = await prisma.user.create({ data: { email: `mw-${Date.now()}@t.local` } });
  try {
    const camp = await createCampaign({ ownerId: owner.id, product: 'Widget', platforms: ['facebook'] });
    const post = await createPost({ campaignId: camp.id, ownerId: owner.id, status: 'posted', platforms: ['facebook'] });
    await prisma.post.update({
      where: { id: post.id },
      data: { leadCaptureKeyword: 'Atria AI', commentSourceIds: { facebook: 'page1_post1' } },
    });

    // (a) handle-only comment (keyword hit, NO email) → a Lead with platform identity, email empty.
    const handleOnlyBody = {
      object: 'page',
      entry: [{ id: 'page1', changes: [{ field: 'feed', value: {
        item: 'comment', verb: 'add', post_id: 'page1_post1', comment_id: 'wc1',
        message: 'Atria AI looks great', sender_id: 'wu100', sender_name: 'Webhook Jane',
      } }] }],
    };
    const raw1 = Buffer.from(JSON.stringify(handleOnlyBody));
    const r1 = await handleWebhookDelivery(raw1, sign(raw1), handleOnlyBody, TEST_SECRET);
    ck('POST valid signature (handle-only) → 200 received', r1.status === 200 && r1.body.received === true, r1);

    const leadsAfterHandleOnly = await prisma.lead.findMany({ where: { ownerId: owner.id } });
    ck('handle-only webhook comment minted exactly 1 lead', leadsAfterHandleOnly.length === 1, leadsAfterHandleOnly.length);
    const handleLead = leadsAfterHandleOnly[0];
    ck('handle-only lead has NO email', !handleLead?.email, handleLead?.email);
    ck('handle-only lead has platform identity', handleLead?.platform === 'facebook' && handleLead?.platformUserId === 'wu100', { p: handleLead?.platform, u: handleLead?.platformUserId });
    ck('handle-only lead source = comment', handleLead?.source === 'comment', handleLead?.source);

    // (b) email-typed comment on the SAME post → a SECOND, distinct lead with an email.
    const emailBody = {
      object: 'page',
      entry: [{ id: 'page1', changes: [{ field: 'feed', value: {
        item: 'comment', verb: 'add', post_id: 'page1_post1', comment_id: 'wc2',
        message: 'Atria AI jane@buyer.com', sender_id: 'wu200', sender_name: 'Webhook Buyer',
      } }] }],
    };
    const raw2 = Buffer.from(JSON.stringify(emailBody));
    const r2 = await handleWebhookDelivery(raw2, sign(raw2), emailBody, TEST_SECRET);
    ck('POST valid signature (email-typed) → 200 received', r2.status === 200, r2);
    const leadsAfterEmail = await prisma.lead.findMany({ where: { ownerId: owner.id } });
    ck('email-typed webhook comment minted a 2nd lead', leadsAfterEmail.length === 2, leadsAfterEmail.length);

    // (c) invalid signature → rejected, NO third lead minted.
    const badSigResult = await handleWebhookDelivery(raw1, 'sha256=' + '0'.repeat(64), handleOnlyBody, TEST_SECRET);
    ck('POST invalid signature → 401', badSigResult.status === 401, badSigResult);

    // (d) missing signature → rejected.
    const noSigResult = await handleWebhookDelivery(raw1, undefined, handleOnlyBody, TEST_SECRET);
    ck('POST missing signature → 401', noSigResult.status === 401, noSigResult);

    const leadsAfterRejects = await prisma.lead.count({ where: { ownerId: owner.id } });
    ck('rejected signatures minted NO additional leads (still 2)', leadsAfterRejects === 2, leadsAfterRejects);

    // (e) malformed payload with a VALID signature → 200 received, no throw, no lead minted.
    const garbage = { not: 'a real webhook payload', entry: 'oops-not-an-array' };
    const rawGarbage = Buffer.from(JSON.stringify(garbage));
    const garbageResult = await handleWebhookDelivery(rawGarbage, sign(rawGarbage), garbage, TEST_SECRET);
    ck('malformed payload (valid sig) → 200, no crash', garbageResult.status === 200, garbageResult);
    ck('malformed payload minted no lead', (await prisma.lead.count({ where: { ownerId: owner.id } })) === 2);

    // (f) SAME commenter (wu100) re-delivered via the 30-min POLLER → dedupes to the SAME lead, not a 3rd.
    const fakePollerFetcher = async (): Promise<FetchedComment[]> => ([
      { id: 'wc1', authorName: 'Webhook Jane', authorId: 'wu100', text: 'Atria AI looks great' },
    ]);
    const pollSummary = await pollCommentsForLeads(fakePollerFetcher, owner.id);
    ck('poller re-sees the SAME comment → 1 duplicate, 0 new', pollSummary.duplicates === 1 && pollSummary.leadsCaptured === 0, pollSummary);
    ck('webhook + poller of the same comment → still exactly 2 leads total', (await prisma.lead.count({ where: { ownerId: owner.id } })) === 2);
  } finally {
    await prisma.lead.deleteMany({ where: { ownerId: owner.id } });
    await prisma.post.deleteMany({ where: { ownerId: owner.id } });
    await prisma.campaign.deleteMany({ where: { ownerId: owner.id } });
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.$disconnect();
  }

  console.log(fail ? `\nFAIL — ${fail}` : '\nPASS — comment-capture hardening (Meta webhook + X gate + handle-only leads) works');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
