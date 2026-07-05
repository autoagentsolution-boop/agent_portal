// Persist a user-uploaded image (base64) into the served image dir, content-addressed by hash
// so re-uploads dedupe. Returns the abs path + a `local:<path>` AssetStore ref. Used by the
// reference-image route (concept gate): the ref conditions media gen, or becomes the post hero.
import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { IMAGE_OUTPUT_DIR } from '../imagegen/nano-banana.ts';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

export const SUPPORTED_IMAGE_MIME = new Set(Object.keys(EXT_BY_MIME));

export const saveUploadedImage = async (
  dataB64: string,
  mimeType: string,
): Promise<{ outputFile: string; ref: string }> => {
  const ext = EXT_BY_MIME[mimeType.toLowerCase()];
  if (!ext) throw new Error(`unsupported image type ${mimeType} (use PNG, JPG, or WebP)`);
  const bytes = Buffer.from(dataB64, 'base64');
  if (bytes.length === 0) throw new Error('empty image data');
  const key = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  await mkdir(IMAGE_OUTPUT_DIR, { recursive: true });
  const outputFile = path.join(IMAGE_OUTPUT_DIR, `${key}.${ext}`);
  await writeFile(outputFile, bytes);
  return { outputFile, ref: `local:${outputFile}` };
};
