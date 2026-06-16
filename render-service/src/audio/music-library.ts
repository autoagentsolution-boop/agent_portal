import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../logger.ts';
import { resolveFfmpeg } from '../util/ffmpeg-resolver.ts';

const DEFAULT_LIBRARY_DIR = path.resolve('render-service/public/music-library/lofi-vn');
const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.opus', '.aac']);
const FFMPEG_TIMEOUT_MS = 60_000;

export interface PickTrackOptions {
  slug?: string;
  libraryDir?: string;
  seed?: string;
}

const libraryDir = (override?: string): string =>
  override ?? process.env.MUSIC_LIBRARY_DIR ?? DEFAULT_LIBRARY_DIR;

const listTracks = async (dir: string): Promise<string[]> => {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    throw new Error(`music_library_dir_missing: ${dir} (${String(err)})`);
  }
  const tracks: string[] = [];
  for (const e of entries) {
    if (AUDIO_EXTS.has(path.extname(e).toLowerCase())) tracks.push(path.join(dir, e));
  }
  if (!tracks.length) throw new Error(`music_library_empty: ${dir}`);
  return tracks.sort();
};

const seedIndex = (seed: string, mod: number): number => {
  const h = createHash('sha256').update(seed).digest();
  let n = 0;
  for (let i = 0; i < 4; i++) n = (n << 8) | h[i]!;
  return Math.abs(n) % mod;
};

export const pickTrack = async (opts: PickTrackOptions = {}): Promise<string> => {
  const dir = libraryDir(opts.libraryDir);
  const tracks = await listTracks(dir);
  const seed = opts.seed ?? opts.slug;
  const idx = seed ? seedIndex(seed, tracks.length) : Math.floor(Math.random() * tracks.length);
  const picked = tracks[idx]!;
  logger.info('music_track_picked', { picked: path.basename(picked), poolSize: tracks.length, seed });
  return picked;
};

const runFfmpeg = (args: string[], label: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const proc = spawn(resolveFfmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`ffmpeg_${label}_timeout`));
    }, FFMPEG_TIMEOUT_MS);
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg_${label}_exit_${code}: ${stderr.slice(-300)}`));
    });
  });

export interface PrepareMusicRequest {
  trackPath: string;
  lengthSec: number;
  outPath: string;
  fadeOutSec?: number;
}

export interface PrepareMusicResult {
  outPath: string;
  bytes: number;
  durationMs: number;
}

export const prepareMusicForLength = async (req: PrepareMusicRequest): Promise<PrepareMusicResult> => {
  const fadeOutSec = req.fadeOutSec ?? 2;
  const started = Date.now();
  const fadeStart = Math.max(0, req.lengthSec - fadeOutSec);

  // Fade-out via volume curve (afade filter not available in Remotion's stripped ffmpeg build).
  // Use `volume=eval=frame` with conditional expression to ramp down over last fadeOutSec seconds.
  const fadeExpr = `if(lt(t,${fadeStart}),1,max(0,(${req.lengthSec}-t)/${fadeOutSec}))`;

  await runFfmpeg(
    [
      '-stream_loop', '-1',
      '-i', req.trackPath,
      '-t', String(req.lengthSec),
      '-af', `volume='${fadeExpr}':eval=frame`,
      '-c:a', 'libmp3lame',
      '-q:a', '4',
      req.outPath,
    ],
    'prepare_music',
  );
  const s = await stat(req.outPath);
  logger.info('music_prepared', {
    source: path.basename(req.trackPath),
    out: path.basename(req.outPath),
    lengthSec: req.lengthSec,
    bytes: s.size,
  });
  return { outPath: req.outPath, bytes: s.size, durationMs: Date.now() - started };
};

export const getLibraryDir = (): string => libraryDir();
