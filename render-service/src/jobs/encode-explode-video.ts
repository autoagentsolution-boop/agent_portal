import { spawn } from 'node:child_process';
import { stat, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../logger.ts';
import { resolveFfmpeg } from '../util/ffmpeg-resolver.ts';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface EncodeRequest {
  compositionPath: string;
  motionPath: string;
  musicPath: string;
  narrations: Array<{ label: string; path: string }>;
  outputDir: string;
  slug: string;
  targetLengthSec?: number;
  introSec?: number;
  width?: number;
  height?: number;
  fps?: number;
}

export interface EncodeResult {
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

// Render intro: composition.png held for introSec, scaled to width×height.
// Composition is already 9:16 from Pro Banana — single scale is enough.
const buildIntroArgs = (compositionPath: string, introSec: number, width: number, height: number, fps: number, outPath: string): string[] => [
  '-loop', '1', '-t', String(introSec), '-i', compositionPath,
  '-vf', `scale=${width}:${height}`,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-pix_fmt', 'yuv420p',
  '-r', String(fps), '-an',
  outPath,
];

// Render body: motion.mp4 looped to bodySec. Motion is already 9:16 from Veo i2v.
const buildBodyArgs = (motionPath: string, bodySec: number, width: number, height: number, fps: number, outPath: string): string[] => [
  '-stream_loop', '-1', '-t', String(bodySec), '-i', motionPath,
  '-vf', `scale=${width}:${height}`,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-pix_fmt', 'yuv420p',
  '-r', String(fps), '-an',
  outPath,
];

// Concat intro + body using the concat demuxer (no filter graph needed).
const buildConcatArgs = (listFile: string, outPath: string): string[] => [
  '-f', 'concat', '-safe', '0', '-i', listFile,
  '-c', 'copy',
  outPath,
];

// Mix narration + pre-prepared music using amix `weights` (no named output → no semicolons).
// Narration weight 1.0 (-0dB, dominant), music 0.13 (~-18dB, background).
const buildMixAudioArgs = (narrationPath: string, musicPath: string, outPath: string, targetLengthSec: number): string[] => [
  '-i', narrationPath,
  '-i', musicPath,
  '-filter_complex', 'amix=inputs=2:duration=first:dropout_transition=0:weights=1.0 0.13:normalize=0',
  '-t', String(targetLengthSec),
  '-c:a', 'libmp3lame', '-q:a', '4',
  outPath,
];

// Mux silent video + mixed audio (no filter graph).
const buildMuxArgs = (silentVideoPath: string, mixedAudioPath: string, outPath: string, targetLengthSec: number): string[] => [
  '-i', silentVideoPath,
  '-i', mixedAudioPath,
  '-t', String(targetLengthSec),
  '-c:v', 'copy',
  '-c:a', 'aac', '-b:a', '192k',
  '-movflags', '+faststart',
  '-shortest',
  outPath,
];

export const encodeExplodeVideo = async (req: EncodeRequest): Promise<EncodeResult> => {
  const started = Date.now();
  const targetLengthSec = req.targetLengthSec ?? 45;
  const introSec = req.introSec ?? 3;
  const width = req.width ?? 1080;
  const height = req.height ?? 1920;
  const fps = req.fps ?? 30;

  if (!req.narrations.length) throw new Error('encode_no_narrations');

  const silentVideoPath = path.join(req.outputDir, `${req.slug}-silent.mp4`);
  const introPath = path.join(req.outputDir, `${req.slug}-intro.mp4`);
  const bodyPath = path.join(req.outputDir, `${req.slug}-body.mp4`);
  const concatListPath = path.join(req.outputDir, `${req.slug}-concat.txt`);
  const bodySec = targetLengthSec - introSec;

  await runFfmpeg({
    args: buildIntroArgs(req.compositionPath, introSec, width, height, fps, introPath),
    label: 'intro',
  });
  await runFfmpeg({
    args: buildBodyArgs(req.motionPath, bodySec, width, height, fps, bodyPath),
    label: 'body',
  });

  // Build concat list (forward-slash paths work on Windows ffmpeg).
  const listContent =
    `file '${introPath.replace(/\\/g, '/')}'\n` +
    `file '${bodyPath.replace(/\\/g, '/')}'\n`;
  await writeFile(concatListPath, listContent, 'utf8');
  await runFfmpeg({
    args: buildConcatArgs(concatListPath, silentVideoPath),
    label: 'concat_silent',
  });

  // Cleanup temp intro/body/list
  await Promise.all([
    rm(introPath, { force: true }),
    rm(bodyPath, { force: true }),
    rm(concatListPath, { force: true }),
  ]);

  const finalPaths: EncodeResult['finalPaths'] = [];
  for (const n of req.narrations) {
    const mixedAudio = path.join(req.outputDir, `${req.slug}-mixed-${n.label.toLowerCase()}.mp3`);
    const out = path.join(req.outputDir, `${req.slug}-final-${n.label.toLowerCase()}.mp4`);
    await runFfmpeg({
      args: buildMixAudioArgs(n.path, req.musicPath, mixedAudio, targetLengthSec),
      label: `mix_${n.label}`,
    });
    await runFfmpeg({
      args: buildMuxArgs(silentVideoPath, mixedAudio, out, targetLengthSec),
      label: `mux_${n.label}`,
    });
    await rm(mixedAudio, { force: true });
    const s = await stat(out);
    finalPaths.push({ label: n.label, path: out, bytes: s.size });
  }

  return { silentVideoPath, finalPaths, durationMs: Date.now() - started };
};
