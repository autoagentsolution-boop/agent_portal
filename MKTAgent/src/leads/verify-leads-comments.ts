// Verify §01.4/§01.6 — comment-keyword lead capture. Pure parse + extractPostId, then the
// poller with an INJECTED fake fetcher (the live Graph API is a separate seam): a keyword+email
// comment on a watched post becomes an opt-in lead on the post's OWNER, deduped, isolated.
import { prisma } from '../db/client.ts';
import { parseComment } from './sources/comment-parse.ts';
import { extractPostId } from './sources/comment-watch.ts';
import { pollCommentsForLeads, type FetchedComment } from './sources/comment-poller.ts';

let fail = 0;
const ck = (n: string, c: boolean, x?: unknown) => { console.log(c ? `  ok   ${n}` : `  FAIL ${n} ${JSON.stringify(x)?.slice(0, 200)}`); if (!c) fail++; };

async function main() {
  // --- Pure parse ---
  ck('keyword + email → matched', parseComment('Atria AI john@example.com please', 'Atria AI').matched === true);
  ck('extracts the email lowercased', parseComment('want Atria AI: John@Example.COM', 'Atria AI').email === 'john@example.com');
  ck('"keyword + email" form matches', parseComment('Atria AI + me@x.io', 'Atria AI').matched === true);
  ck('keyword present but NO email → not matched (keywordHit true)', (() => { const p = parseComment('Atria AI sounds cool', 'Atria AI'); return !p.matched && p.keywordHit; })());
  ck('no keyword → not matched even with email', parseComment('hi a@b.com', 'Atria AI').matched === false);
  ck('case/space-insensitive keyword', parseComment('atria   ai  a@b.com', 'Atria AI').matched === true);
  ck('empty keyword → never matches', parseComment('a@b.com', '').matched === false);

  // --- extractPostId ---
  ck('FB post id from url', extractPostId('facebook', 'https://facebook.com/12345_67890') === '12345_67890');
  ck('IG media id from /p/ url', extractPostId('instagram', 'https://www.instagram.com/p/ABC123/') === 'ABC123');
  ck('Threads code from @user/post/ url', extractPostId('threads', 'https://www.threads.net/@brand/post/Cabc123XYZ') === 'Cabc123XYZ');
  ck('Threads media id from our /t/ fallback url', extractPostId('threads', 'https://www.threads.net/t/17999999999999999') === '17999999999999999');
  ck('LinkedIn urn from feed/update url', extractPostId('linkedin', 'https://www.linkedin.com/feed/update/urn:li:ugcPost:12345') === 'urn:li:ugcPost:12345');
  ck('X tweet id from x.com/{user}/status url', extractPostId('x', 'https://x.com/brand/status/1234567890') === '1234567890');
  ck('X tweet id from our twitter.com/i/web/status url', extractPostId('x', 'https://twitter.com/i/web/status/1234567890') === '1234567890');
  ck('unparseable url → null (not guessed)', extractPostId('facebook', 'not-a-url') === null);

  // --- Poller with a fake fetcher ---
  const owner = await prisma.user.create({ data: { email: `cmt-${Date.now()}@t.local` } });
  const other = await prisma.user.create({ data: { email: `cmt-o-${Date.now()}@t.local` } });
  const camp = await prisma.campaign.create({ data: { ownerId: owner.id, product: 'Widget', platforms: ['facebook'] } });
  const post = await prisma.post.create({
    data: { campaignId: camp.id, ownerId: owner.id, status: 'posted', assetType: 'image',
      copy: { body: 'x', threads: 'x', x: 'x' }, platforms: ['facebook'],
      leadCaptureKeyword: 'Atria AI', commentSourceIds: { facebook: 'fbpost1' } },
  });
  try {
    const fake = async (): Promise<FetchedComment[]> => ([
      { id: 'c1', authorName: 'Jane Buyer', text: 'Atria AI jane@buyer.com' }, // → email-typed lead
      { id: 'c2', authorName: 'No Email', text: 'Atria AI looks great' },       // keyword, no email → HANDLE-ONLY lead (Phase 03)
      { id: 'c3', authorName: 'Off Topic', text: 'random comment nobody@x.com' },// no keyword → skip
      { id: 'c4', authorName: 'Dupe', text: 'Atria AI jane@buyer.com again' },   // dup email → duplicate
    ]);
    const sum = await pollCommentsForLeads(fake, owner.id);
    ck('poller scanned all comments', sum.commentsScanned === 4, sum);
    // Multichannel Nurture Phase 03: a keyword-only comment (no email) now mints a HANDLE-ONLY lead
    // instead of being skipped — c1 (email) + c2 (handle-only) both capture; c3 has no keyword; c4
    // dupes c1's email.
    ck('captured 2 leads (email-typed + handle-only)', sum.leadsCaptured === 2, sum);
    ck('counted 1 duplicate', sum.duplicates === 1, sum);

    const leads = await prisma.lead.findMany({ where: { ownerId: owner.id }, orderBy: { receivedAt: 'asc' } });
    ck('both leads landed on the post OWNER', leads.length === 2, leads.length);
    ck('every captured lead source = comment', leads.every((l) => l.source === 'comment'), leads.map((l) => l.source));
    const handleOnly = leads.find((l) => !l.email);
    ck('the no-email comment became a handle-only lead (no email, has platform identity)', Boolean(handleOnly) && handleOnly?.platform === 'facebook' && handleOnly?.platformUserId === 'No Email', handleOnly);
    ck('other tenant sees no leads (isolation)', (await prisma.lead.count({ where: { ownerId: other.id } })) === 0);
  } finally {
    await prisma.lead.deleteMany({ where: { ownerId: { in: [owner.id, other.id] } } });
    await prisma.post.deleteMany({ where: { campaignId: camp.id } });
    await prisma.campaign.delete({ where: { id: camp.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } });
    await prisma.$disconnect();
  }
  console.log(fail ? `\nFAIL — ${fail}` : '\nPASS — comment-keyword lead capture works');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
