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
import { platformSupportsAsset } from '../social/postability.ts';

export class PostValidationError extends Error {}

// Per-platform asset type (item 5): the platformAssets map wins, else the post default.
// e.g. { facebook: 'carousel', instagram: 'image' } → FB posts a carousel, IG a single image.
// This is the GENERATION intent (drives distinctAssetTypes — what media to produce). It does
// NOT adapter-degrade: we never generate an extra image just because a platform can't do the
// default. Publish-time degradation lives in publishAssetType.
export const platformAssetType = (post: Post, platform: SocialPlatform): AssetType => {
  const map = (post.platformAssets ?? null) as Record<string, AssetType> | null;
  return map?.[platform] ?? post.assetType;
};

// PUBLISH-time asset type for a platform — like platformAssetType but adapter-aware. When the
// platform can't post the intended type (e.g. a carousel/video post targeting image-only
// Threads/IG) it AUTO-DEGRADES to 'image' — reusing an already-produced image (a carousel
// frame, the infographic, or the user's upload) instead of skipping the platform entirely.
// An EXPLICIT per-platform override always wins (even if it results in a skip — user's call).
// Never generates media; degrades only when an image is actually derivable from what exists.
export const publishAssetType = (post: Post, platform: SocialPlatform): AssetType => {
  const map = (post.platformAssets ?? null) as Record<string, AssetType> | null;
  if (map?.[platform]) return map[platform];
  const intended = post.assetType;
  if (platformSupportsAsset(platform, intended)) return intended;
  if (platformSupportsAsset(platform, 'image') && hasDerivableImage(post)) return 'image';
  return intended; // unsupported + nothing to degrade to → caller records a skip
};

// True when a single publishable image can be sourced from the post's existing media —
// explicit image media, a carousel frame, the hero, or the user's reference upload.
export const hasDerivableImage = (post: Post): boolean => imageRefs(post).length > 0;

// The DISTINCT asset types a post must produce across all its targets (item 5). The executor
// generates each once. Falls back to [post.assetType] when no per-platform map is set.
export const distinctAssetTypes = (post: Post): AssetType[] => {
  const set = new Set<AssetType>();
  for (const p of post.platforms ?? []) set.add(platformAssetType(post, p));
  if (set.size === 0) set.add(post.assetType);
  return [...set];
};

// Every image the post can publish, best source first: explicit image media (infographic),
// a carousel frame, the hero, then the user's reference upload. Degrading any multi-asset
// source to its FIRST ref — one image. Used to reuse an image for image-only platforms on a
// carousel/video post (publishAssetType's auto-degrade) with zero re-generation.
const imageRefs = (post: Post): AssetRef[] => {
  const media = (post.assetMedia ?? null) as Record<string, string> | null;
  // heroFile is an image ONLY when the post's own asset type is image/carousel — for a video
  // post heroFile is a video ref and must never be mistaken for a still (would publish an mp4
  // as a photo). Order: infographic image → carousel frame → hero (if image) → user upload.
  const heroImage = post.assetType === 'image' || post.assetType === 'carousel' ? post.heroFile : null;
  const source = media?.['image'] ?? media?.['carousel'] ?? heroImage ?? post.referenceImage;
  return parseAssetRefs(source).slice(0, 1);
};

// Media refs for one asset type: 'image' resolves through every derivable source (imageRefs);
// otherwise explicit per-type media (assetMedia) wins, else the single heroFile.
const refsForAsset = (post: Post, assetType: AssetType): AssetRef[] => {
  if (assetType === 'image') return imageRefs(post);
  const media = (post.assetMedia ?? null) as Record<string, string> | null;
  return parseAssetRefs(media?.[assetType] ?? post.heroFile);
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
  const assetType = publishAssetType(post, platform);
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
