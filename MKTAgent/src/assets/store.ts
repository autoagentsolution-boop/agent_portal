// AssetStore — abstracts where post media lives. Adapters need two things:
//   - a public URL (IG/Threads fetch the image/video server-side)
//   - the raw bytes (FB/LinkedIn/X upload binary via multipart)
//
// Phase-1 impl is Drive-backed by fileId. Folder is shared anyone-with-link, so
// the public lh3 URL works without Google OAuth. A ref id may also carry a scheme:
//   - `local:<absolute-path>` → a file generated in-process (orchestration image
//     gen, src/imagegen) read straight off MKTAgent's own disk. No network, no
//     Drive upload. fetchBinary works (FB/LinkedIn/X multipart); publicUrl does
//     NOT (a remote platform can't reach our disk) → IG/Threads need a Drive id.
// Swap to S3 later by adding another scheme — adapters don't change.
import { readFile } from 'node:fs/promises';
import { withRetry } from '../lib/retry.ts';

const LOCAL_SCHEME = 'local:';

const contentTypeForExt = (p: string): string => {
  const ext = p.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'webp') return 'image/webp';
  return 'image/png';
};

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
    if (ref.id.startsWith(LOCAL_SCHEME)) {
      // A local file has no public URL — IG/Threads (which fetch server-side)
      // cannot reach our disk. Fail loud rather than emit an unreachable URL.
      throw new Error('local asset has no public URL — use a Drive id for IG/Threads, or fetchBinary for FB/LinkedIn/X');
    }
    return `https://lh3.googleusercontent.com/d/${ref.id}`;
  }

  // fetchBinary = Drive download endpoint → returns the REAL file bytes (mp4 for
  // video, png/jpg for image). 303-redirects to drive.usercontent.google.com;
  // fetch follows it by default. This is what FB/LinkedIn/X multipart upload needs.
  async fetchBinary(ref: AssetRef): Promise<{ bytes: Buffer; contentType: string }> {
    // Local in-process asset (orchestration image gen) — read off disk directly.
    if (ref.id.startsWith(LOCAL_SCHEME)) {
      const filePath = ref.id.slice(LOCAL_SCHEME.length);
      const bytes = await readFile(filePath);
      return { bytes, contentType: contentTypeForExt(filePath) };
    }
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
