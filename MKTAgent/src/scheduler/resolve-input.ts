// Build a PublishInput from a Post row. Pure (no network) so it can validate
// the row before the scheduler touches any platform — mirrors the n8n
// "validate → build error write-back" branch.
//
// heroFile holds Drive fileId(s): one for image/video, CSV (2-10) for carousel.
// AssetRef is fileId-based; the folder is shared anyone-with-link so no Google
// OAuth is needed (see assets/store.ts).
import type { Post } from '../../prisma/generated/prisma/client.ts';
import type { PublishInput } from '../social/types.ts';
import type { AssetRef } from '../assets/store.ts';

export class PostValidationError extends Error {}

const parseAssetRefs = (heroFile: string | null): AssetRef[] =>
  (heroFile ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => ({ id }));

export function resolvePublishInput(post: Post): PublishInput {
  if (!post.platforms || post.platforms.length === 0) {
    throw new PostValidationError('no target platforms');
  }
  const assets = parseAssetRefs(post.heroFile);
  if (assets.length === 0) {
    throw new PostValidationError('no asset (heroFile empty)');
  }
  if (post.assetType === 'carousel' && assets.length < 2) {
    throw new PostValidationError('carousel needs >=2 assets');
  }
  if (post.assetType !== 'carousel' && assets.length !== 1) {
    throw new PostValidationError(`${post.assetType} needs exactly 1 asset, got ${assets.length}`);
  }
  return {
    postId: post.id,
    assetType: post.assetType,
    assets,
    copyVi: post.copyVi ?? '',
    copyEn: post.copyEn ?? '',
    copyThreads: post.copyThreads ?? '',
    copyX: post.copyX ?? '',
  };
}
