// Publish-time asset materialization (Piece 3). Turns `local:<path>` image refs into
// public Drive fileIds for the platforms that need a server-side-fetchable URL.
//
// The split (see docs/publishing-media-constraints.md):
//   - IG / Threads → Meta fetches a PUBLIC image_url → needs a Drive/lh3 URL.
//   - FB / LinkedIn / X → upload raw bytes off disk (fetchBinary) → keep `local:`.
//
// ORDERING: the publish order is the `assets[]` array order (from the post's heroFile),
// NOT the order the agent finished generating images. We upload sequentially in array
// order and also stamp each Drive filename with a 0-padded index prefix so the files sort
// correctly in the Drive UI too. Generation-completion time never affects order.
import { basename } from 'node:path';
import { uploadImageToDrive } from './drive-client.ts';
import type { AssetRef } from './store.ts';
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';

const LOCAL_SCHEME = 'local:';

// Platforms whose adapter consumes publicUrl() rather than fetchBinary().
export const NEEDS_PUBLIC_URL: ReadonlySet<SocialPlatform> = new Set<SocialPlatform>(['instagram', 'threads']);

// Kebab-case a campaign/product name for a safe, readable filename segment.
export const slugify = (s: string): string =>
  (s || 'post')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'post';

// Upload each local: image ref to the owner's Drive (in array order), returning refs whose
// ids are public Drive fileIds; non-local refs pass through untouched. Caller gates on Drive
// being connected and on the asset being an image. `folderId` targets a campaign folder;
// `slug` labels files. The array position (1-based) becomes the filename order prefix.
export const materializeForPublicUrl = async (
  ownerId: string,
  assets: AssetRef[],
  ctx: { folderId?: string; slug?: string } = {},
): Promise<AssetRef[]> => {
  const out: AssetRef[] = [];
  for (const [i, ref] of assets.entries()) {
    if (ref.id.startsWith(LOCAL_SCHEME)) {
      const path = ref.id.slice(LOCAL_SCHEME.length);
      const idx = String(i + 1).padStart(2, '0');
      const name = ctx.slug ? `${idx}-${ctx.slug}-${basename(path)}` : `${idx}-${basename(path)}`;
      const fileId = await uploadImageToDrive(ownerId, path, { folderId: ctx.folderId, name });
      out.push({ id: fileId });
    } else {
      out.push(ref);
    }
  }
  return out;
};
