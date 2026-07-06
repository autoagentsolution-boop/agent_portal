// Verify the lead-collector post-deleted handling: when a platform reports the post is gone,
// the poller removes that platform's watch source and (when none remain) marks the collector
// 'post_deleted'; a re-publish reactivates it. Creates a throwaway tenant, cleans up.
import { prisma } from '../db/client.ts';
import { createCampaign } from '../db/repos/campaign-repo.ts';
import { createPost } from '../db/repos/post-repo.ts';
import { pollCommentsForLeads, PostGoneError, type CommentFetcher } from './sources/comment-poller.ts';
import { recordCommentSources } from './sources/comment-watch.ts';

let failures = 0;
const ck = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// Fetcher that throws PostGoneError for the named platforms (deleted), [] otherwise (transient).
const goneFor = (...gone: string[]): CommentFetcher => async (platform) => {
  if (gone.includes(platform)) throw new PostGoneError(platform, 'x');
  return [];
};

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `pd-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const campaign = await createCampaign({ ownerId: user.id, product: 'P', platforms: ['facebook', 'instagram'] });
    const setup = async () => {
      const p = await createPost({ campaignId: campaign.id, ownerId: user.id, status: 'posted', platforms: ['facebook', 'instagram'] });
      await prisma.post.update({ where: { id: p.id }, data: { leadCaptureKeyword: 'Atria AI', commentSourceIds: { facebook: 'fb1', instagram: 'ig1' }, leadCollectorStatus: null } });
      return p.id;
    };
    const get = (id: string) => prisma.post.findUnique({ where: { id } });

    // 1) One platform deleted → that source removed, other kept, still active (status null).
    const p1 = await setup();
    await pollCommentsForLeads(goneFor('facebook'), user.id);
    const a = await get(p1);
    ck('deleted platform removed from sources', JSON.stringify(a?.commentSourceIds) === JSON.stringify({ instagram: 'ig1' }), a?.commentSourceIds);
    ck('still active while another source remains', a?.leadCollectorStatus === null, a?.leadCollectorStatus);

    // 2) All platforms deleted → no sources left → status 'post_deleted'.
    const p2 = await setup();
    await pollCommentsForLeads(goneFor('facebook', 'instagram'), user.id);
    const b = await get(p2);
    ck('all sources gone', Object.keys((b?.commentSourceIds ?? {}) as object).length === 0, b?.commentSourceIds);
    ck('collector marked post_deleted', b?.leadCollectorStatus === 'post_deleted', b?.leadCollectorStatus);

    // 3) A transient/[] fetch does NOT deactivate.
    const p3 = await setup();
    await pollCommentsForLeads(goneFor(), user.id); // nothing gone
    const c = await get(p3);
    ck('transient poll keeps sources + active', Object.keys((c?.commentSourceIds ?? {}) as object).length === 2 && c?.leadCollectorStatus === null, { s: c?.commentSourceIds, st: c?.leadCollectorStatus });

    // 4) Re-publish reactivates a stopped collector (clears the deleted status).
    const stopped = await get(p2);
    await recordCommentSources(stopped as any, { facebook: 'https://facebook.com/newpost123' });
    const d = await get(p2);
    ck('re-publish clears post_deleted', d?.leadCollectorStatus === null, d?.leadCollectorStatus);
    ck('re-publish records the new source', (d?.commentSourceIds as any)?.facebook === 'newpost123', d?.commentSourceIds);
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    console.log('cleanup: throwaway tenant removed');
  }
}

await main();
console.log(failures ? `\nFAIL — ${failures} post-deleted check(s) red` : '\nPASS — lead-collector post-deleted handling works');
process.exit(failures ? 1 : 0);
