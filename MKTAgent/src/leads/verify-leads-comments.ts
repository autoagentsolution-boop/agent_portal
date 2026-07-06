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
      { id: 'c1', authorName: 'Jane Buyer', text: 'Atria AI jane@buyer.com' }, // → lead
      { id: 'c2', authorName: 'No Email', text: 'Atria AI looks great' },       // keyword, no email → skip
      { id: 'c3', authorName: 'Off Topic', text: 'random comment nobody@x.com' },// no keyword → skip
      { id: 'c4', authorName: 'Dupe', text: 'Atria AI jane@buyer.com again' },   // dup email → duplicate
    ]);
    const sum = await pollCommentsForLeads(fake, owner.id);
    ck('poller scanned all comments', sum.commentsScanned === 4, sum);
    ck('captured exactly 1 lead', sum.leadsCaptured === 1, sum);
    ck('counted 1 duplicate', sum.duplicates === 1, sum);

    const leads = await prisma.lead.findMany({ where: { ownerId: owner.id } });
    ck('lead landed on the post OWNER', leads.length === 1, leads.length);
    ck('lead source = comment', leads[0]?.source === 'comment', leads[0]?.source);
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
