import { createHash } from 'node:crypto';
import { writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../logger.ts';
import { prisma } from '../db.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '..', '..', 'output', 'stock');

type Orientation = 'portrait' | 'landscape' | 'square';

interface PexelsVideoFile {
  link: string;
  quality: string;
  width: number;
  height: number;
  file_type: string;
}

interface PexelsVideo {
  id: number;
  duration: number;
  width: number;
  height: number;
  video_files: PexelsVideoFile[];
}

export interface StockClipResult {
  clipPath: string;            // /files/stock/<id>.mp4
  outputFile: string;
  durationSec: number;
  width: number;
  height: number;
  source: 'pexels';
  cached: boolean;
}

const fileExists = async (p: string): Promise<boolean> => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

const pickVideoFile = (files: PexelsVideoFile[]): PexelsVideoFile | undefined => {
  const mp4 = files.filter((f) => f.file_type === 'video/mp4');
  const hd = mp4.find((f) => f.quality === 'hd' && f.width <= 1920);
  return hd ?? mp4.find((f) => f.quality === 'sd') ?? mp4[0];
};

const searchPexels = async (
  keyword: string,
  orientation: Orientation,
): Promise<PexelsVideo | null> => {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error('PEXELS_API_KEY required');

  const url = new URL('https://api.pexels.com/videos/search');
  url.searchParams.set('query', keyword);
  url.searchParams.set('orientation', orientation);
  url.searchParams.set('per_page', '5');
  url.searchParams.set('min_duration', '4');
  url.searchParams.set('max_duration', '30');

  const response = await fetch(url, { headers: { Authorization: apiKey } });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`pexels_http_${response.status}: ${body.slice(0, 200)}`);
  }
  const json = (await response.json()) as { videos?: PexelsVideo[] };
  return json.videos?.[0] ?? null;
};

const downloadFile = async (url: string, outputFile: string): Promise<number> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`pexels_download_${response.status}`);
  const buf = Buffer.from(await response.arrayBuffer());
  await writeFile(outputFile, buf);
  return buf.byteLength;
};

export const searchAndDownload = async (
  keywords: string[],
  orientation: Orientation = 'portrait',
): Promise<StockClipResult> => {
  await mkdir(OUTPUT_DIR, { recursive: true });

  let video: PexelsVideo | null = null;
  for (const k of keywords) {
    video = await searchPexels(k, orientation);
    if (video) break;
  }
  if (!video) throw new Error(`pexels_no_match: ${keywords.join('|')}`);

  const file = pickVideoFile(video.video_files);
  if (!file) throw new Error(`pexels_no_mp4: ${video.id}`);

  const hash = createHash('sha256').update(`pexels::${video.id}::${file.quality}`).digest('hex').slice(0, 16);
  const outputFile = path.join(OUTPUT_DIR, `${hash}.mp4`);
  const clipPath = `/files/stock/${hash}.mp4`;

  const cached = await prisma.asset.findUnique({ where: { hash } });
  if (cached && (await fileExists(outputFile))) {
    logger.info('stock_cache_hit', { hash, pexelsId: video.id });
    return { clipPath, outputFile, durationSec: video.duration, width: file.width, height: file.height, source: 'pexels', cached: true };
  }

  const bytes = await downloadFile(file.link, outputFile);
  await prisma.asset.upsert({
    where: { hash },
    update: {},
    create: { hash, kind: 'video_clip', provider: 'pexels', path: clipPath, bytes: BigInt(bytes) },
  });
  logger.info('stock_downloaded', { hash, pexelsId: video.id, bytes });
  return { clipPath, outputFile, durationSec: video.duration, width: file.width, height: file.height, source: 'pexels', cached: false };
};
