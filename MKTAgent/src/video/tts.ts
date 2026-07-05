// Voiceover (TTS) via Gemini — reuses GEMINI_API_KEY, multilingual (narrates in whatever
// language the text is written in). The video agent feeds it the storyboard captions so the
// voiceover matches the campaign language. Returns a WAV file (Gemini emits raw 24kHz PCM;
// we wrap it in a WAV header so ffmpeg can mux it). Filesystem cache like veo/nano-banana.
import { createHash } from 'node:crypto';
import { writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AUDIO_OUTPUT_DIR = path.resolve(__dirname, '..', '..', 'output', 'audio');
const MODEL = 'gemini-2.5-flash-preview-tts';
const SAMPLE_RATE = 24000; // Gemini TTS output rate
const DEFAULT_VOICE = 'Kore';

export interface TtsRequest {
  text: string;
  voice?: string;
}

const fileExists = async (p: string): Promise<boolean> => {
  try { await stat(p); return true; } catch { return false; }
};

// Wrap raw signed-16-bit little-endian mono PCM in a minimal WAV (RIFF) container.
const pcmToWav = (pcm: Buffer, sampleRate: number): Buffer => {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(1, 22); // channels = mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate (mono, 2 bytes/sample)
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

// Generate a voiceover WAV for `text`. Cached by (model, voice, text).
export const generate = async (req: TtsRequest): Promise<{ outputFile: string; cached: boolean }> => {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY required for TTS');
  await mkdir(AUDIO_OUTPUT_DIR, { recursive: true });

  const voice = req.voice || DEFAULT_VOICE;
  const key = createHash('sha256').update(`${MODEL}::${voice}::${req.text}`).digest('hex').slice(0, 24);
  const outputFile = path.join(AUDIO_OUTPUT_DIR, `${key}.wav`);
  if (await fileExists(outputFile)) {
    logger.info('tts_cache_hit', { key });
    return { outputFile, cached: true };
  }

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: req.text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
  });
  if (!r.ok) throw new Error(`tts_http_${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as any;
  const inline = j.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)?.inlineData;
  if (!inline?.data) throw new Error('tts_no_audio_in_response');
  const wav = pcmToWav(Buffer.from(inline.data, 'base64'), SAMPLE_RATE);
  await writeFile(outputFile, wav);
  logger.info('tts_generated', { key, bytes: wav.length });
  return { outputFile, cached: false };
};
