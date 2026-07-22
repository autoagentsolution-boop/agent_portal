// P2 dry-run verification — NO real posts (avoids Meta burst-write flagging).
// Checks the three layers each adapter depends on, stopping before any publish:
//   1) registry wiring + declared asset-type support
//   2) token present + decryptable from the encrypted store (getActiveToken)
//   3) asset layer: publicUrl shape (IG/Threads) + fetchBinary returns the right
//      bytes/type (FB/LinkedIn/X), incl. the video-vs-image distinction.
// Liveness already proven by `tokens/cli.ts maintain`; not repeated here.
import { getAdapter, publishTo, isLiveSocialPublish } from './index.ts';
import { getActiveToken } from '../tokens/service.ts';
import { SYSTEM_OWNER_ID } from '../db/system-owner.ts';
import { assetStore } from '../assets/store.ts';
import { prisma } from '../db/client.ts';
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';

const HERO = '1bo4diy3vlH9VmRE-78Z15ux9053-KZci'; // image
const VIDEO = '1EZ8rxIvdQICS2q8sBincrn2lj3FSxTFq'; // video

const platforms: SocialPlatform[] = ['facebook', 'instagram', 'threads', 'linkedin', 'x'];

async function main(): Promise<void> {
  const report: Record<string, unknown> = {};

  // Layer 1: registry + supports
  for (const p of platforms) {
    const a = getAdapter(p);
    report[p] = { registered: Boolean(a), supports: a?.supports ?? [] };
  }

  // Layer 2: token decryptable per platform
  for (const p of platforms) {
    const r = report[p] as Record<string, unknown>;
    try {
      const t = await getActiveToken(SYSTEM_OWNER_ID, p);
      r.tokenOk = t.length > 0;
    } catch (e) {
      r.tokenOk = false;
      r.tokenErr = String(e instanceof Error ? e.message : e).slice(0, 80);
    }
  }

  // Layer 3: asset layer (shared) — publicUrl + fetchBinary type correctness
  const imgUrl = assetStore.publicUrl({ id: HERO });
  const img = await assetStore.fetchBinary({ id: HERO });
  const vid = await assetStore.fetchBinary({ id: VIDEO });
  report.assets = {
    publicUrlShape: imgUrl.startsWith('https://lh3.googleusercontent.com/d/'),
    imageBinary: { type: img.contentType, ok: img.contentType.startsWith('image/') },
    videoBinary: {
      type: vid.contentType,
      ok: vid.contentType.startsWith('video/'),
      mp4Magic: vid.bytes.slice(4, 8).toString() === 'ftyp',
    },
  };

  // Layer 4: the ENABLE_LIVE_SOCIAL_PUBLISH gate. Only assertable when the flag is OFF — the flag
  // defaults ON, and calling publishTo with it on would post for real, which is exactly what this
  // script exists to avoid. Flag on → report the skip rather than fake a pass.
  if (isLiveSocialPublish()) {
    report.liveGate = { skipped: 'ENABLE_LIVE_SOCIAL_PUBLISH is on — asserting it would post for real' };
  } else {
    const r = await publishTo('facebook', {
      postId: 'verify-live-gate',
      ownerId: SYSTEM_OWNER_ID,
      assetType: 'text',
      assets: [],
      body: 'verify',
      threads: 'verify',
      x: 'verify',
    });
    if (!r.dryRun || !r.ok || !r.url?.startsWith('dryrun://') || !r.platformPostId) {
      throw new Error(`live gate off but publishTo did not simulate: ${JSON.stringify(r)}`);
    }
    report.liveGate = { simulated: true, url: r.url };
  }

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
