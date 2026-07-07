// Phase 07 / M2 verification — checkPostLinks iterates the UNION of postUrls + commentSourceIds,
// so a WATCHED platform with NO postUrls entry (X publishes without a stored URL) is existence-
// checked and can self-heal to post_deleted. Before the fix the loop walked postUrls only, so an
// X-only collector never triggered `noneLeft` and polled a deleted post until 30d expiry.
// Network-free via the injectable aliveFn. Throwaway tenant, cleaned up.
import { prisma } from '../db/client.ts';
import { createCampaign } from '../db/repos/campaign-repo.ts';
import { createPost } from '../db/repos/post-repo.ts';
import { checkPostLinks, type AliveFn } from './sources/post-liveness.ts';
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';

let failures = 0;
const ck = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// Stub: report the named platforms dead (false), everything else alive (true). No network.
const deadFor = (...dead: SocialPlatform[]): AliveFn => async (platform) => (dead.includes(platform) ? false : true);

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `lu-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const campaign = await createCampaign({ ownerId: user.id, product: 'P', platforms: ['x'] });

    // Post watched on X ONLY — commentSourceIds has x, but postUrls is EMPTY (X stores no URL).
    const p = await createPost({ campaignId: campaign.id, ownerId: user.id, status: 'posted', platforms: ['x'] });
    await prisma.post.update({
      where: { id: p.id },
      data: { leadCaptureKeyword: 'Atria AI', commentSourceIds: { x: 'tweet123' }, platformPostIds: { x: 'tweet123' }, leadCollectorStatus: null },
    });

    const fresh = await prisma.post.findUnique({ where: { id: p.id } });
    const results = await checkPostLinks(fresh!, user.id, deadFor('x'));
    ck('X source (no postUrls) WAS checked (union iteration)', results.some((r) => r.platform === 'x'), results);
    ck('X reported dead', results.find((r) => r.platform === 'x')?.alive === false, results);

    const after = await prisma.post.findUnique({ where: { id: p.id } });
    ck('X source dropped from commentSourceIds', Object.keys((after?.commentSourceIds ?? {}) as object).length === 0, after?.commentSourceIds);
    ck('collector self-healed to post_deleted (was un-healable before M2)', after?.leadCollectorStatus === 'post_deleted', after?.leadCollectorStatus);

    // Control: a still-alive X source is kept + stays active.
    const p2 = await createPost({ campaignId: campaign.id, ownerId: user.id, status: 'posted', platforms: ['x'] });
    await prisma.post.update({ where: { id: p2.id }, data: { leadCaptureKeyword: 'Atria AI', commentSourceIds: { x: 'tweet999' }, platformPostIds: { x: 'tweet999' }, leadCollectorStatus: null } });
    await checkPostLinks((await prisma.post.findUnique({ where: { id: p2.id } }))!, user.id, deadFor());
    const alive = await prisma.post.findUnique({ where: { id: p2.id } });
    ck('alive X source kept + collector still active', (alive?.commentSourceIds as any)?.x === 'tweet999' && alive?.leadCollectorStatus === null, { s: alive?.commentSourceIds, st: alive?.leadCollectorStatus });
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    console.log('cleanup: throwaway tenant removed');
  }
}

await main();
console.log(failures ? `\nFAIL — ${failures} liveness-union check(s) red` : '\nPASS — liveness union iteration self-heals URL-less sources');
process.exit(failures ? 1 : 0);
