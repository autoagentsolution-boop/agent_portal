// AssetStore — abstracts where post media lives. Adapters need two things:
//   - a public URL (IG/Threads fetch the image/video server-side)
//   - the raw bytes (FB/LinkedIn/X upload binary via multipart)
//
// Phase-1 impl is Drive-backed by fileId. Folder is shared anyone-with-link, so
// the public lh3 URL works without Google OAuth. Swap to S3/local later by
// implementing this interface — adapters don't change.
import { withRetry } from '../lib/retry.ts';

export interface AssetRef {
  // Drive fileId (current impl). Opaque to adapters.
  id: string;
}

export interface AssetStore {
  publicUrl(ref: AssetRef): string;
  fetchBinary(ref: AssetRef): Promise<{ bytes: Buffer; contentType: string }>;
}

export class DriveAssetStore implements AssetStore {
  // publicUrl = lh3 CDN — fine for IMAGES that a remote server (IG/Threads)
  // fetches. WARNING: for a VIDEO fileId, lh3 returns a JPEG *thumbnail*, not the
  // mp4. Never use this for binary upload; use fetchBinary().
  publicUrl(ref: AssetRef): string {
    return `https://lh3.googleusercontent.com/d/${ref.id}`;
  }

  // fetchBinary = Drive download endpoint → returns the REAL file bytes (mp4 for
  // video, png/jpg for image). 303-redirects to drive.usercontent.google.com;
  // fetch follows it by default. This is what FB/LinkedIn/X multipart upload needs.
  async fetchBinary(ref: AssetRef): Promise<{ bytes: Buffer; contentType: string }> {
    const url = `https://drive.google.com/uc?export=download&id=${ref.id}`;
    const res = await withRetry(() => fetch(url, { redirect: 'follow' }), { label: 'drive_download' });
    if (!res.ok) throw new Error(`asset download failed: ${res.status} for ${ref.id}`);
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    // Guard: Drive serves an HTML interstitial for large/flagged files instead of
    // bytes. Reject it loudly rather than uploading garbage to a platform.
    if (contentType.includes('text/html')) {
      throw new Error(`asset download returned HTML interstitial for ${ref.id} (file too large or needs confirm token)`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    return { bytes, contentType };
  }
}

// Default singleton. Replace construction here when swapping stores.
export const assetStore: AssetStore = new DriveAssetStore();
