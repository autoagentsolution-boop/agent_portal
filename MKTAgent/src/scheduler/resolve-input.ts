// Build a PublishInput from a Post row. Pure (no network) so it can validate
// the row before the scheduler touches any platform — mirrors the n8n
// "validate → build error write-back" branch.
//
// heroFile holds Drive fileId(s): one for image/video, CSV (2-10) for carousel.
// AssetRef is fileId-based; the folder is shared anyone-with-link so no Google
// OAuth is needed (see assets/store.ts).
import type { Post, SocialPlatform, AssetType } from '../../prisma/generated/prisma/client.ts';
import type { PublishInput } from '../social/types.ts';
import type { AssetRef } from '../assets/store.ts';
import type { CopyVariants } from '../copygen/parse.ts';

export class PostValidationError extends Error {}

// Per-platform asset type (item 5): the platformAssets map wins, else the post default.
// e.g. { facebook: 'carousel', instagram: 'image' } → FB posts a carousel, IG a single image.
export const platformAssetType = (post: Post, platform: SocialPlatform): AssetType => {
  const map = (post.platformAssets ?? null) as Record<string, AssetType> | null;
  return map?.[platform] ?? post.assetType;
};

// The DISTINCT asset types a post must produce across all its targets (item 5). The executor
// generates each once. Falls back to [post.assetType] when no per-platform map is set.
export const distinctAssetTypes = (post: Post): AssetType[] => {
  const set = new Set<AssetType>();
  for (const p of post.platforms ?? []) set.add(platformAssetType(post, p));
  if (set.size === 0) set.add(post.assetType);
  return [...set];
};

// Media refs for one asset type: explicit per-type media (assetMedia) wins; else fall back
// to the single heroFile, degrading a carousel hero to its first frame when a platform wants
// a single 'image' (the common "carousel on FB, image elsewhere" case, no re-generation).
const refsForAsset = (post: Post, assetType: AssetType): AssetRef[] => {
  const media = (post.assetMedia ?? null) as Record<string, string> | null;
  const explicit = media?.[assetType];
  let refs = parseAssetRefs(explicit ?? post.heroFile);
  if (!explicit && assetType === 'image' && refs.length > 1) refs = refs.slice(0, 1);
  return refs;
};

// Post.copy is JSON — narrow it to the variant bag, tolerating partial/null.
const readCopy = (copy: unknown): CopyVariants => {
  const c = (copy ?? {}) as Partial<CopyVariants>;
  return {
    body: typeof c.body === 'string' ? c.body : '',
    threads: typeof c.threads === 'string' ? c.threads : '',
    x: typeof c.x === 'string' ? c.x : '',
  };
};

const parseAssetRefs = (heroFile: string | null): AssetRef[] =>
  (heroFile ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => ({ id }));

// Validate + build the publish input for the post's DEFAULT asset type. Retained for
// callers/tests that treat a post as single-asset; the per-platform path uses
// resolvePlatformInput below.
export function resolvePublishInput(post: Post): PublishInput {
  if (!post.platforms || post.platforms.length === 0) {
    throw new PostValidationError('no target platforms');
  }
  return buildInput(post, post.assetType, parseAssetRefs(post.heroFile));
}

// Build the publish input for ONE platform (item 5), honoring its per-platform asset type +
// media (with degradation). Throws PostValidationError when that platform's media is missing
// or mismatched — the caller records it as a skip rather than crashing the whole fan-out.
export function resolvePlatformInput(post: Post, platform: SocialPlatform): PublishInput {
  const assetType = platformAssetType(post, platform);
  return buildInput(post, assetType, refsForAsset(post, assetType), platform);
}

// Shared validation + shape. `where` labels errors with the platform when per-platform.
const buildInput = (post: Post, assetType: AssetType, assets: AssetRef[], where?: SocialPlatform): PublishInput => {
  const tag = where ? `${where}: ` : '';
  if (assets.length === 0) throw new PostValidationError(`${tag}no asset (${assetType})`);
  if (assetType === 'carousel' && assets.length < 2) throw new PostValidationError(`${tag}carousel needs >=2 assets`);
  if (assetType !== 'carousel' && assets.length !== 1) {
    throw new PostValidationError(`${tag}${assetType} needs exactly 1 asset, got ${assets.length}`);
  }
  const copy = readCopy(post.copy);
  return { postId: post.id, ownerId: post.ownerId, assetType, assets, body: copy.body, threads: copy.threads, x: copy.x };
};
