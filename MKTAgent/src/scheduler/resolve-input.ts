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
import type { CopyVariants } from '../copygen/parse.ts';

export class PostValidationError extends Error {}

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
  const copy = readCopy(post.copy);
  return {
    postId: post.id,
    ownerId: post.ownerId,
    assetType: post.assetType,
    assets,
    body: copy.body,
    threads: copy.threads,
    x: copy.x,
  };
}
