import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../logger.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '..', '..', 'output', 'tts');

export const VOICE_WHITELIST = [
  'vi-VN-HoaiMyNeural',
  'vi-VN-NamMinhNeural',
] as const;

export type EdgeVoice = (typeof VOICE_WHITELIST)[number];

export interface EdgeTTSResult {
  audioPath: string;          // public route for downstream callers
  outputFile: string;         // absolute path on disk
  cached: boolean;
  durationMs: number;
}

const hashKey = (text: string, voice: string): string =>
  createHash('sha256').update(`${voice}::${text}`).digest('hex').slice(0, 16);

const fileExists = async (p: string): Promise<boolean> => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

const runEdgeTTS = (voice: string, text: string, outFile: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const proc = spawn(
      'edge-tts',
      ['--voice', voice, '--text', text, '--write-media', outFile],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`edge-tts exit ${code}: ${stderr.trim()}`));
    });
  });

export const synthesize = async (text: string, voice: EdgeVoice): Promise<EdgeTTSResult> => {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const key = hashKey(text, voice);
  const outputFile = path.join(OUTPUT_DIR, `${key}.mp3`);
  const audioPath = `/files/tts/${key}.mp3`;

  if (await fileExists(outputFile)) {
    logger.info('tts_cache_hit', { voice, key });
    return { audioPath, outputFile, cached: true, durationMs: 0 };
  }

  const started = Date.now();
  await runEdgeTTS(voice, text, outputFile);
  const durationMs = Date.now() - started;
  logger.info('tts_synthesized', { voice, key, ms: durationMs });
  return { audioPath, outputFile, cached: false, durationMs };
};
