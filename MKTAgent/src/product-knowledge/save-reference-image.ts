// Persist an uploaded product image (from the 📚 Product Knowledge analyze call) to disk so it can
// be REUSED as the visual reference for infographic/storyboard whenever a post selects that product
// (feedback). The analyze flow otherwise only keeps the TEXT profile and discards the image bytes.
// Written to the same output dir the image generator uses, so the `local:` AssetStore reads it back.
import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { IMAGE_OUTPUT_DIR } from '../imagegen/nano-banana.ts';

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const extFor = (mime: string): string =>
  mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';

export const isImageMime = (mime: string): boolean => IMAGE_MIME.has(mime.toLowerCase());

// Save one image's base64 bytes; returns a `local:<abspath>` ref, or null on a non-image / write
// failure (best-effort — a reference-image hiccup must never fail the product-knowledge analysis).
export const saveProductReferenceImage = async (
  dataB64: string,
  mimeType: string,
): Promise<string | null> => {
  if (!isImageMime(mimeType)) return null;
  try {
    const buf = Buffer.from(dataB64, 'base64');
    const key = createHash('sha256').update(buf).digest('hex').slice(0, 24);
    await mkdir(IMAGE_OUTPUT_DIR, { recursive: true });
    const outputFile = path.join(IMAGE_OUTPUT_DIR, `pk-${key}.${extFor(mimeType.toLowerCase())}`);
    await writeFile(outputFile, buf);
    return `local:${outputFile}`;
  } catch {
    return null;
  }
};
