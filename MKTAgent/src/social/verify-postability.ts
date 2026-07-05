// Postability verification (item 1) — the per-platform asset-type gate. Pure, no
// network, no DB: reads adapter `supports` truth and checks the partition/reason
// logic the scheduler tick relies on. Run: `npx tsx src/social/verify-postability.ts`.
import {
  supportedAssetTypes,
  platformSupportsAsset,
  checkPostability,
  partitionByPostability,
} from './postability.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// 1) Adapter truth: FB is the only carousel/video-capable adapter today.
check('facebook supports carousel', platformSupportsAsset('facebook', 'carousel'));
check('facebook supports video', platformSupportsAsset('facebook', 'video'));
check('instagram does NOT support carousel (adapter is image-only)', !platformSupportsAsset('instagram', 'carousel'));
check('threads does NOT support video', !platformSupportsAsset('threads', 'video'));
check('every platform supports image', ['facebook', 'instagram', 'threads', 'linkedin', 'x']
  .every((p) => supportedAssetTypes(p as any).includes('image')));

// 2) checkPostability: reasons present only for unsupported rows.
const rows = checkPostability(['facebook', 'instagram', 'x'], 'carousel');
const fb = rows.find((r) => r.platform === 'facebook')!;
const ig = rows.find((r) => r.platform === 'instagram')!;
check('facebook carousel row supported, no reason', fb.supported && fb.reason === null, fb);
check('instagram carousel row unsupported, has reason', !ig.supported && /cannot post carousel/.test(ig.reason ?? ''), ig);
check('reason lists what IS supported', /image/.test(ig.reason ?? ''), ig);

// 3) partition: carousel → only FB published, others skipped with reason.
const carousel = partitionByPostability(['facebook', 'instagram', 'threads', 'linkedin', 'x'], 'carousel');
check('carousel partition: only facebook supported', carousel.supported.length === 1 && carousel.supported[0] === 'facebook', carousel.supported);
check('carousel partition: 4 skipped', carousel.skipped.length === 4, carousel.skipped);
check('every skipped row carries a reason', carousel.skipped.every((s) => typeof s.reason === 'string' && s.reason.length > 0));

// 4) image → nothing skipped (universal).
const image = partitionByPostability(['facebook', 'instagram', 'threads', 'linkedin', 'x'], 'image');
check('image partition: all supported', image.supported.length === 5 && image.skipped.length === 0, image);

// 5) video → only FB (adapters), rest skipped.
const video = partitionByPostability(['facebook', 'instagram', 'x'], 'video');
check('video partition: only facebook supported', video.supported.length === 1 && video.supported[0] === 'facebook', video.supported);

console.log(failures === 0 ? '\nPASS — all postability checks green' : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
