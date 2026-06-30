// Connector Runtime verification — exercises invokeAction's validation + mapping
// WITHOUT any real network post (the unknown-platform/unsupported-action/missing-input
// branches return before publishTo; the asset→action mapping + shim shape are pure).
// Honors the DRY-RUN-only rule: no live adapter call is made here. Pure, no DB.
// Run: `npx tsx src/connectors/runtime/verify-runtime.ts`.
import { invokeAction, actionKeyForAsset, runtimePublishFn } from './connector-runtime.ts';
import type { PublishInput } from '../../social/types.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const fullInput = (overrides: Partial<PublishInput> = {}): PublishInput => ({
  postId: 'post-1',
  ownerId: 'owner-1',
  assetType: 'image',
  assets: [{ id: 'f1' }],
  body: 'hello',
  threads: 'hello',
  x: 'hello',
  ...overrides,
});

const run = async () => {
  // 1) Asset → action key mapping.
  check('image → social.post.image', actionKeyForAsset('image') === 'social.post.image');
  check('video → social.post.video', actionKeyForAsset('video') === 'social.post.video');
  check('carousel → social.post.carousel', actionKeyForAsset('carousel') === 'social.post.carousel');

  // 2) Unsupported action on a platform → structured error, NO network call.
  const unsupported = await invokeAction({ ownerId: 'o', platform: 'threads', actionKey: 'social.post.carousel', input: fullInput({ assetType: 'carousel' }) });
  check('threads carousel → ok:false (unsupported)', unsupported.ok === false && /does not support/.test(unsupported.error ?? ''), unsupported);
  check('error result carries platform + actionKey', unsupported.platform === 'threads' && unsupported.actionKey === 'social.post.carousel', unsupported);

  // 3) Missing required input → validation error BEFORE any network call.
  const missing = await invokeAction({ ownerId: 'o', platform: 'facebook', actionKey: 'social.post.image', input: fullInput({ ownerId: '' }) });
  check('missing ownerId → ok:false (validation)', missing.ok === false && /missing required input/.test(missing.error ?? ''), missing);

  const noAssets = await invokeAction({ ownerId: 'o', platform: 'facebook', actionKey: 'social.post.image', input: fullInput({ assets: [] }) });
  check('empty assets → ok:false (validation)', noAssets.ok === false && /missing required input/.test(noAssets.error ?? ''), noAssets);

  // 4) Shim shape: runtimePublishFn returns a PublishResult (platform/ok/url/error).
  // Use an unsupported combo so it short-circuits before a real post (DRY).
  const shimmed = await runtimePublishFn('threads', fullInput({ assetType: 'carousel' }));
  check('shim returns PublishResult shape', 'platform' in shimmed && 'ok' in shimmed && 'url' in shimmed && 'error' in shimmed, shimmed);
  check('shim maps ok:false through', shimmed.ok === false && shimmed.platform === 'threads', shimmed);

  console.log(failures === 0 ? '\nPASS — all connector-runtime checks green' : `\nFAIL — ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
};

void run();
