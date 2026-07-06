// Per-platform asset-type publish (item 5) — DB-backed. Creates posts with a per-platform
// asset map and drives processPost with a STUB publish (NO real social calls) to assert the
// fan-out resolves each platform's own asset type + degraded media. Run:
//   npx tsx src/scheduler/verify-per-platform-publish.ts
import { prisma } from '../db/client.ts';
import { processPost, type PublishFn } from './tick.ts';
import { attachPostMedia } from '../db/repos/post-repo.ts';
import type { PublishInput } from '../social/types.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const recorderFor = (rec: Record<string, PublishInput>): PublishFn => async (platform, input) => {
  rec[platform] = input;
  return { platform, ok: true, url: `https://example/${platform}`, error: null };
};

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `pp-${Date.now()}@test.local` } });
  try {
    const campaign = await prisma.campaign.create({ data: { ownerId: user.id, product: 'Filter', platforms: ['facebook'] } });

    // 1) Mixed per-platform assets from ONE carousel hero: FB=carousel (all frames),
    //    IG/LinkedIn/X=image (degraded first frame). threads is omitted from the map, so its
    //    intended type is the carousel default it can't post — but an image IS derivable from
    //    the carousel frames, so it AUTO-DEGRADES to image (item #6) instead of being skipped.
    const rec1: Record<string, PublishInput> = {};
    const p1 = await prisma.post.create({
      data: {
        campaignId: campaign.id, ownerId: user.id, status: 'posting',
        assetType: 'carousel', heroFile: 'a,b,c',
        copy: { body: 'hi', threads: 'hi', x: 'hi' },
        platformAssets: { facebook: 'carousel', instagram: 'image', linkedin: 'image', x: 'image' },
        platforms: ['facebook', 'instagram', 'linkedin', 'x', 'threads'],
      },
    });
    const r1 = await processPost(p1, recorderFor(rec1));
    check('mixed post → all posted (threads auto-degraded, not skipped)', r1.status === 'posted', r1);
    check('facebook → carousel, 3 assets', rec1.facebook?.assetType === 'carousel' && rec1.facebook?.assets.length === 3, rec1.facebook);
    check('instagram → image, 1 asset (degraded first frame)', rec1.instagram?.assetType === 'image' && rec1.instagram?.assets.length === 1 && rec1.instagram?.assets[0]?.id === 'a', rec1.instagram);
    check('linkedin → image, 1 asset', rec1.linkedin?.assetType === 'image' && rec1.linkedin?.assets.length === 1, rec1.linkedin);
    check('x → image, 1 asset', rec1.x?.assetType === 'image' && rec1.x?.assets.length === 1, rec1.x);
    check('threads → image auto-degraded (reuses first carousel frame)', rec1.threads?.assetType === 'image' && rec1.threads?.assets.length === 1 && rec1.threads?.assets[0]?.id === 'a', rec1.threads);

    // 1b) A GENUINE skip: a video-only post (heroFile is a video ref, no image media, no
    //     reference upload) → threads has no derivable image → stays video → SKIPPED, and the
    //     write-back records why. Proves auto-degrade never fabricates an image from a video.
    const rec1b: Record<string, PublishInput> = {};
    const p1b = await prisma.post.create({
      data: {
        campaignId: campaign.id, ownerId: user.id, status: 'posting',
        assetType: 'video', heroFile: 'vidref', copy: { body: 'hi', threads: 'hi', x: 'hi' },
        platformAssets: { facebook: 'video' },
        platforms: ['facebook', 'threads'],
      },
    });
    const r1b = await processPost(p1b, recorderFor(rec1b));
    check('video post → partial (threads has no image to degrade to)', r1b.status === 'partial', r1b);
    check('threads NOT published (no derivable image)', rec1b.threads === undefined, Object.keys(rec1b));
    const w1b = await prisma.post.findUnique({ where: { id: p1b.id } });
    check('write-back records threads skip in error', /threads/.test(w1b?.error ?? ''), w1b?.error);

    // 2) No per-platform map → legacy single-asset behavior (image to all connected-capable).
    const rec2: Record<string, PublishInput> = {};
    const p2 = await prisma.post.create({
      data: {
        campaignId: campaign.id, ownerId: user.id, status: 'posting',
        assetType: 'image', heroFile: 'solo', copy: { body: 'hi', threads: 'hi', x: 'hi' },
        platforms: ['facebook', 'instagram', 'x'],
      },
    });
    const r2 = await processPost(p2, recorderFor(rec2));
    check('legacy image post → posted (all support image)', r2.status === 'posted', r2);
    check('legacy: every platform got image/1 asset', ['facebook', 'instagram', 'x'].every((p) => rec2[p]?.assetType === 'image' && rec2[p]?.assets.length === 1), rec2);

    // 3) Explicit assetMedia per type wins over heroFile (video ref for a video platform).
    const rec3: Record<string, PublishInput> = {};
    const p3 = await prisma.post.create({
      data: {
        campaignId: campaign.id, ownerId: user.id, status: 'posting',
        assetType: 'image', heroFile: 'img1', copy: { body: 'hi', threads: 'hi', x: 'hi' },
        platformAssets: { facebook: 'video' },
        assetMedia: { video: 'vid1', image: 'img1' },
        platforms: ['facebook'],
      },
    });
    const r3 = await processPost(p3, recorderFor(rec3));
    check('assetMedia post → posted', r3.status === 'posted', r3);
    check('facebook video uses assetMedia.video ref', rec3.facebook?.assetType === 'video' && rec3.facebook?.assets[0]?.id === 'vid1', rec3.facebook);

    // 4) All-unsupported → clean error, no publish. IG carousel (adapter image-only) alone.
    const rec4: Record<string, PublishInput> = {};
    const p4 = await prisma.post.create({
      data: {
        campaignId: campaign.id, ownerId: user.id, status: 'posting',
        assetType: 'carousel', heroFile: 'a,b', copy: { body: 'hi', threads: 'hi', x: 'hi' },
        platformAssets: { instagram: 'carousel' },
        platforms: ['instagram'],
      },
    });
    const r4 = await processPost(p4, recorderFor(rec4));
    check('all-unsupported → error, nothing published', r4.status === 'error' && Object.keys(rec4).length === 0, { r4, rec4 });

    // 5) attachPostMedia on a MULTI-asset post (5b): fills assetMedia per type WITHOUT
    //    clobbering heroFile/assetType; both types coexist and publish from their own media.
    const p5 = await prisma.post.create({
      data: {
        campaignId: campaign.id, ownerId: user.id, status: 'brief',
        assetType: 'carousel', copy: { body: 'hi', threads: 'hi', x: 'hi' },
        platformAssets: { facebook: 'carousel', instagram: 'image' },
        platforms: ['facebook', 'instagram'],
      },
    });
    await attachPostMedia(p5.id, user.id, 'carousel', 'c1,c2');
    await attachPostMedia(p5.id, user.id, 'image', 'i1');
    const a5 = await prisma.post.findUnique({ where: { id: p5.id } });
    const media5 = a5?.assetMedia as Record<string, string> | null;
    check('multi-asset: assetMedia holds BOTH types', media5?.carousel === 'c1,c2' && media5?.image === 'i1', media5);
    check('multi-asset: heroFile untouched (per-platform map present)', a5?.heroFile === null, a5?.heroFile);
    check('multi-asset: assetType untouched (still carousel)', a5?.assetType === 'carousel', a5?.assetType);
    const rec5: Record<string, PublishInput> = {};
    await prisma.post.update({ where: { id: p5.id }, data: { status: 'posting' } });
    await processPost((await prisma.post.findUnique({ where: { id: p5.id } }))!, recorderFor(rec5));
    check('multi-asset publish: fb carousel [c1,c2], ig image [i1]', rec5.facebook?.assets.length === 2 && rec5.instagram?.assetType === 'image' && rec5.instagram?.assets[0]?.id === 'i1', rec5);

    // 6) attachPostMedia on a SINGLE-asset post (no map): also sets heroFile + assetType (legacy).
    const p6 = await prisma.post.create({
      data: { campaignId: campaign.id, ownerId: user.id, status: 'brief', assetType: 'image', copy: { body: 'hi', threads: 'hi', x: 'hi' }, platforms: ['facebook'] },
    });
    await attachPostMedia(p6.id, user.id, 'image', 'x1');
    const a6 = await prisma.post.findUnique({ where: { id: p6.id } });
    check('single-asset: heroFile + assetType set', a6?.heroFile === 'x1' && a6?.assetType === 'image', { hero: a6?.heroFile, at: a6?.assetType });
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
  console.log(failures === 0 ? '\nPASS — per-platform publish checks green' : `\nFAIL — ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
