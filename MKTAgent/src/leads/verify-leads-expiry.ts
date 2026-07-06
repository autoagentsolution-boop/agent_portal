// Verify collector expiry: an EXPIRED lead collector (leadCollectorExpiresAt in the past) is
// skipped by the poller (not polled → no leads), while a future/null expiry still collects.
// Throwaway tenant, cleans up.
import { prisma } from '../db/client.ts';
import { createCampaign } from '../db/repos/campaign-repo.ts';
import { createPost } from '../db/repos/post-repo.ts';
import { pollCommentsForLeads, type CommentFetcher } from './sources/comment-poller.ts';

let failures = 0;
const ck = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// Returns one keyword+email comment whose email is UNIQUE per platformPostId (so each polled post
// captures a DISTINCT lead — no dedupe confound).
const fetcher: CommentFetcher = async (_p, platformPostId) => [{ id: `c-${platformPostId}`, authorName: 'X', text: `Atria AI ${platformPostId}@test.dev` }];

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `exp-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const campaign = await createCampaign({ ownerId: user.id, product: 'P', platforms: ['facebook'] });
    let seq = 0;
    const mk = async (expiresAt: Date | null) => {
      const p = await createPost({ campaignId: campaign.id, ownerId: user.id, status: 'posted', platforms: ['facebook'] });
      await prisma.post.update({ where: { id: p.id }, data: { leadCaptureKeyword: 'Atria AI', commentSourceIds: { facebook: `fb${seq++}` }, leadCollectorExpiresAt: expiresAt } });
      return p.id;
    };
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 3_600_000);

    const expired = await mk(past);
    const active = await mk(future);
    const never = await mk(null);

    const r = await pollCommentsForLeads(fetcher, user.id);
    // Only the active + never-expiring posts are polled (2 posts), each captures 1 lead.
    ck('expired collector skipped (2 polled not 3)', r.postsPolled === 2, r.postsPolled);
    ck('active + never collectors captured leads', r.leadsCaptured === 2, r.leadsCaptured);

    const leadCount = await prisma.lead.count({ where: { ownerId: user.id } });
    ck('exactly 2 leads stored (expired one produced none)', leadCount === 2, leadCount);
    void expired; void active; void never;
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    console.log('cleanup: throwaway tenant removed');
  }
}

await main();
console.log(failures ? `\nFAIL — ${failures} expiry check(s) red` : '\nPASS — collector expiry skips expired posts');
process.exit(failures ? 1 : 0);
