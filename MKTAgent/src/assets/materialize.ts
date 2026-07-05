// Publish-time asset materialization (Piece 3). Turns `local:<path>` image refs into
// public Drive fileIds for the platforms that need a server-side-fetchable URL.
//
// The split (see docs/publishing-media-constraints.md):
//   - IG / Threads → Meta fetches a PUBLIC image_url → needs a Drive/lh3 URL.
//   - FB / LinkedIn / X → upload raw bytes off disk (fetchBinary) → keep `local:`.
import { uploadImageToDrive } from './drive-client.ts';
import type { AssetRef } from './store.ts';
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';

const LOCAL_SCHEME = 'local:';

// Platforms whose adapter consumes publicUrl() rather than fetchBinary().
export const NEEDS_PUBLIC_URL: ReadonlySet<SocialPlatform> = new Set<SocialPlatform>(['instagram', 'threads']);

// Upload each local: image ref to the owner's Drive (once), returning refs whose ids are
// public Drive fileIds; non-local refs pass through untouched. Caller gates on Drive being
// connected and on the asset being an image (video → lh3 returns a thumbnail, unsupported).
export const materializeForPublicUrl = async (
  ownerId: string,
  assets: AssetRef[],
): Promise<AssetRef[]> => {
  const out: AssetRef[] = [];
  for (const ref of assets) {
    if (ref.id.startsWith(LOCAL_SCHEME)) {
      const fileId = await uploadImageToDrive(ownerId, ref.id.slice(LOCAL_SCHEME.length));
      out.push({ id: fileId });
    } else {
      out.push(ref);
    }
  }
  return out;
};
