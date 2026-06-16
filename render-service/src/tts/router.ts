import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../logger.ts';
import { prisma } from '../db.ts';
import { synthesizeGCloud } from './gcloud.ts';
import { normalizeLoudness } from '../audio/normalize.ts';
import voices from './voices.json' with { type: 'json' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '..', '..', 'output', 'tts');
const VOICE_ID_REGEX = /^(gcloud|edge):[a-z]{2}-[A-Z]{2}-[A-Za-z0-9-]+$/;

export const ROLES = ['narrators', 'host_female', 'host_male', 'character_a', 'character_b'] as const;
export type Role = (typeof ROLES)[number];

export interface TtsResult {
  audioPath: string;
  outputFile: string;
  voiceUsed: string;
  provider: 'edge' | 'gcloud';
  cached: boolean;
  durationMs: number;
}

const fileExists = async (p: string): Promise<boolean> => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

const sha = (s: string): string =>
  createHash('sha256').update(s).digest('hex').slice(0, 20);

export const selectVoice = (jobId: string, role: Role): string => {
  const pool = (voices as Record<string, string[]>)[role] ?? voices.narrators;
  const idx = parseInt(sha(`${jobId}::${role}`).slice(0, 8), 16) % pool.length;
  return pool[idx]!;
};

const EDGE_TTS_ATTEMPTS = 4;
const EDGE_TTS_BASE_BACKOFF_MS = 2000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const callEdgeTts = (voice: string, textFile: string, outFile: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const proc = spawn(
      'edge-tts',
      ['--voice', voice, '--file', textFile, '--write-media', outFile],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    proc.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    proc.on('error', reject);
    proc.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`edge-tts exit ${code}: ${stderr.slice(-200)}`));
        return;
      }
      try {
        const buf = await import('node:fs/promises').then((m) => m.readFile(outFile));
        resolve(buf);
      } catch (e) {
        reject(e);
      }
    });
  });

const isEdgeTransientError = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const msg = (err as { message?: string }).message ?? '';
  return /NoAudioReceived|TimeoutError|ConnectionError|websocket|ResetError/i.test(msg);
};

const synthesizeEdge = async (voice: string, text: string, outFile: string): Promise<Buffer> => {
  // Write text to temp file and use --file to avoid argv length/escaping issues
  // with long Vietnamese text containing colons + diacritics on Windows.
  const textFile = path.join(tmpdir(), `edge-tts-${createHash('sha256').update(`${voice}::${text}`).digest('hex').slice(0, 12)}.txt`);
  await writeFile(textFile, text, 'utf8');
  try {
    for (let attempt = 1; attempt <= EDGE_TTS_ATTEMPTS; attempt++) {
      try {
        return await callEdgeTts(voice, textFile, outFile);
      } catch (err) {
        const last = attempt === EDGE_TTS_ATTEMPTS;
        const transient = isEdgeTransientError(err);
        if (last || !transient) throw err;
        const delay = EDGE_TTS_BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        logger.warn('edge_tts_retry', { voice, attempt, delay, error: String(err).slice(0, 200) });
        await sleep(delay);
      }
    }
    throw new Error('edge_tts_unreachable');
  } finally {
    await rm(textFile, { force: true });
  }
};

const fallbackEdgeForGCloudFemale = 'vi-VN-HoaiMyNeural';
const fallbackEdgeForGCloudMale = 'vi-VN-NamMinhNeural';

const synthesize = async (voiceId: string, text: string, outFile: string): Promise<{ buf: Buffer; provider: 'edge' | 'gcloud'; voiceUsed: string }> => {
  if (!VOICE_ID_REGEX.test(voiceId)) throw new Error(`voiceId_invalid: ${voiceId}`);
  const [provider, name] = voiceId.split(':') as ['edge' | 'gcloud', string];

  if (provider === 'gcloud') {
    try {
      const buf = await synthesizeGCloud(text, name);
      await writeFile(outFile, buf);
      return { buf, provider, voiceUsed: voiceId };
    } catch (err) {
      logger.warn('gcloud_failed_falling_back_edge', { voice: voiceId, error: String(err) });
      const fallbackVoice = /Wavenet-A|Neural2-A|Wavenet-C/.test(name) ? fallbackEdgeForGCloudFemale : fallbackEdgeForGCloudMale;
      const buf = await synthesizeEdge(fallbackVoice, text, outFile);
      return { buf, provider: 'edge', voiceUsed: `edge:${fallbackVoice}` };
    }
  }
  const buf = await synthesizeEdge(name, text, outFile);
  return { buf, provider, voiceUsed: voiceId };
};

export const ttsRoute = async (
  text: string,
  jobId: string,
  role: Role,
  explicitVoiceId?: string,
): Promise<TtsResult> => {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const voiceId = explicitVoiceId ?? selectVoice(jobId, role);
  const key = sha(`${voiceId}::${text}`);
  const outputFile = path.join(OUTPUT_DIR, `${key}.mp3`);
  const audioPath = `/files/tts/${key}.mp3`;

  const cached = await prisma.asset.findUnique({ where: { hash: key } });
  if (cached && (await fileExists(outputFile))) {
    logger.info('tts_cache_hit', { key, voiceId });
    return { audioPath, outputFile, voiceUsed: voiceId, provider: voiceId.startsWith('gcloud') ? 'gcloud' : 'edge', cached: true, durationMs: 0 };
  }

  const started = Date.now();
  const { provider, voiceUsed } = await synthesize(voiceId, text, outputFile);
  try {
    await normalizeLoudness(outputFile);
  } catch (err) {
    logger.warn('loudnorm_failed_keeping_raw', { error: String(err) });
  }
  const finalStat = await stat(outputFile);
  await prisma.asset.upsert({
    where: { hash: key },
    update: {},
    create: { hash: key, kind: 'audio', provider, path: audioPath, bytes: BigInt(finalStat.size) },
  });
  const durationMs = Date.now() - started;
  logger.info('tts_synthesized', { key, voiceUsed, provider, ms: durationMs });
  return { audioPath, outputFile, voiceUsed, provider, cached: false, durationMs };
};
