import { spawn } from 'node:child_process';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../logger.ts';
import { resolveFfmpeg } from '../util/ffmpeg-resolver.ts';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface StoryboardEncodeRequest {
  heroPath: string;
  bodyClips: string[];
  narrations: Array<{ label: string; path: string }>;
  musicPath: string;
  outputDir: string;
  slug: string;
  variantId: string;
  targetLengthSec?: number;
  introSec?: number;
  outroSec?: number;
  width?: number;
  height?: number;
  fps?: number;
}

export interface StoryboardEncodeResult {
  silentVideoPath: string;
  finalPaths: Array<{ label: string; path: string; bytes: number }>;
  durationMs: number;
}

interface FfmpegRun {
  args: string[];
  label: string;
  timeoutMs?: number;
}

const runFfmpeg = ({ args, label, timeoutMs = DEFAULT_TIMEOUT_MS }: FfmpegRun): Promise<void> =>
  new Promise((resolve, reject) => {
    logger.info('ffmpeg_start', { label });
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
    }, timeoutMs);
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        logger.info('ffmpeg_done', { label });
        resolve();
      } else {
        reject(new Error(`ffmpeg_${label}_exit_${code}: ${stderr.slice(-400)}`));
      }
    });
  });

const heroHoldArgs = (heroPath: string, holdSec: number, width: number, height: number, fps: number, outPath: string): string[] => [
  '-loop', '1', '-t', String(holdSec), '-i', heroPath,
  '-vf', `scale=${width}:${height}`,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-pix_fmt', 'yuv420p', '-r', String(fps), '-an',
  outPath,
];

const normalizeClipArgs = (clipPath: string, width: number, height: number, fps: number, outPath: string): string[] => [
  '-i', clipPath,
  '-vf', `scale=${width}:${height}`,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-pix_fmt', 'yuv420p', '-r', String(fps), '-an',
  outPath,
];

const concatArgs = (listFile: string, outPath: string): string[] => [
  '-f', 'concat', '-safe', '0', '-i', listFile,
  '-c', 'copy',
  outPath,
];

const mixAudioArgs = (narrationPath: string, musicPath: string, outPath: string, targetLengthSec: number): string[] => [
  '-i', narrationPath,
  '-i', musicPath,
  '-filter_complex', 'amix=inputs=2:duration=first:dropout_transition=0:weights=1.0 0.13:normalize=0',
  '-t', String(targetLengthSec),
  '-c:a', 'libmp3lame', '-q:a', '4',
  outPath,
];

const muxArgs = (silentVideoPath: string, mixedAudioPath: string, outPath: string, targetLengthSec: number): string[] => [
  '-i', silentVideoPath,
  '-i', mixedAudioPath,
  '-t', String(targetLengthSec),
  '-c:v', 'copy',
  '-c:a', 'aac', '-b:a', '192k',
  '-movflags', '+faststart',
  '-shortest',
  outPath,
];

const ffmpegEscape = (p: string): string => p.replace(/\\/g, '/').replace(/'/g, "'\\''");

export const encodeStoryboardVideo = async (req: StoryboardEncodeRequest): Promise<StoryboardEncodeResult> => {
  const started = Date.now();
  const targetLengthSec = req.targetLengthSec ?? 45;
  const introSec = req.introSec ?? 3;
  const minOutroSec = req.outroSec ?? 2;
  const width = req.width ?? 1080;
  const height = req.height ?? 1920;
  const fps = req.fps ?? 30;

  if (!req.narrations.length) throw new Error('encode_no_narrations');
  if (!req.bodyClips.length) throw new Error('encode_no_body_clips');

  const tmpDir = path.join(req.outputDir, `.tmp-${req.variantId}`);
  await mkdir(tmpDir, { recursive: true });

  // Step 1: render intro hero hold + normalize each body clip + outro hero hold.
  const introPath = path.join(tmpDir, 'intro.mp4');
  await runFfmpeg({ args: heroHoldArgs(req.heroPath, introSec, width, height, fps, introPath), label: 'intro_hero' });

  const normalizedClips: string[] = [];
  for (let i = 0; i < req.bodyClips.length; i++) {
    const out = path.join(tmpDir, `body-${String(i).padStart(2, '0')}.mp4`);
    await runFfmpeg({
      args: normalizeClipArgs(req.bodyClips[i]!, width, height, fps, out),
      label: `body_${i}`,
    });
    normalizedClips.push(out);
  }

  // Compute outro length: stretch hero hold to fill the gap to target length.
  // Approx body duration = 8s per clip; outro = max(minOutroSec, target - intro - 8*nClips).
  const approxBodySec = req.bodyClips.length * 8;
  const outroSec = Math.max(minOutroSec, targetLengthSec - introSec - approxBodySec);
  const outroPath = path.join(tmpDir, 'outro.mp4');
  await runFfmpeg({ args: heroHoldArgs(req.heroPath, outroSec, width, height, fps, outroPath), label: 'outro_hero' });

  // Step 2: concat intro + clips + outro into silent video.
  const concatListPath = path.join(tmpDir, 'concat.txt');
  const listContent = [introPath, ...normalizedClips, outroPath]
    .map((p) => `file '${ffmpegEscape(p)}'`)
    .join('\n') + '\n';
  await writeFile(concatListPath, listContent, 'utf8');

  const silentVideoPath = path.join(req.outputDir, `${req.slug}-${req.variantId}-silent.mp4`);
  await runFfmpeg({ args: concatArgs(concatListPath, silentVideoPath), label: 'concat_silent' });

  // Step 3: mix audio + mux for each narration voice.
  const finalPaths: StoryboardEncodeResult['finalPaths'] = [];
  for (const n of req.narrations) {
    const mixedAudio = path.join(tmpDir, `mixed-${n.label.toLowerCase()}.mp3`);
    const out = path.join(req.outputDir, `${req.slug}-${req.variantId}-${n.label.toLowerCase()}.mp4`);
    await runFfmpeg({
      args: mixAudioArgs(n.path, req.musicPath, mixedAudio, targetLengthSec),
      label: `mix_${req.variantId}_${n.label}`,
    });
    await runFfmpeg({
      args: muxArgs(silentVideoPath, mixedAudio, out, targetLengthSec),
      label: `mux_${req.variantId}_${n.label}`,
    });
    const s = await stat(out);
    finalPaths.push({ label: n.label, path: out, bytes: s.size });
  }

  // Cleanup tmp
  await rm(tmpDir, { recursive: true, force: true });

  return { silentVideoPath, finalPaths, durationMs: Date.now() - started };
};
