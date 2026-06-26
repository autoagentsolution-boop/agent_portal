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
  publicUrl(ref: AssetRef): string {
    return `https://lh3.googleusercontent.com/d/${ref.id}`;
  }

  async fetchBinary(ref: AssetRef): Promise<{ bytes: Buffer; contentType: string }> {
    const url = this.publicUrl(ref);
    const res = await withRetry(() => fetch(url), { label: 'drive_fetch' });
    if (!res.ok) throw new Error(`asset fetch failed: ${res.status} for ${ref.id}`);
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    const bytes = Buffer.from(await res.arrayBuffer());
    return { bytes, contentType };
  }
}

// Default singleton. Replace construction here when swapping stores.
export const assetStore: AssetStore = new DriveAssetStore();
