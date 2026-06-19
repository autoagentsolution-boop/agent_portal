#!/usr/bin/env node
// Standalone klingai.com direct API test — validates auth + endpoint + quality.
// Trừ Resource Pack (NOT web UI credits). Cost: 2 units ($0.28) for std 5s, 4 units ($0.56) for std 10s.
//
// Usage:
//   pnpm tsx ../scripts/test-klingai-direct.ts <imagePath> [--prompt="..."] [--duration=5|10] [--mode=std|pro] [--out=path.mp4]
// Example:
//   ./node_modules/.bin/tsx ../scripts/test-klingai-direct.ts \
//     ../source/bun-mam/panel-01.png \
//     --prompt="Tô bún mắm xoay nhẹ, hơi nước bay lên, ánh sáng vàng lướt qua mặt nước dùng." \
//     --duration=5 --mode=std \
//     --out=../output/bun-mam/klingai-test-panel-01.mp4
//
// Required env (in render-service/.env):
//   KLINGAI_ACCESS_KEY=...
//   KLINGAI_SECRET_KEY=...

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateKlingaiDirectMotion } from '../render-service/src/jobs/gen-klingai-direct-motion.ts';

interface Flags {
  imagePath: string;
  prompt: string;
  duration: number;
  mode: 'std' | 'pro';
  out: string;
}

const loadEnv = async (envPath: string): Promise<void> => {
  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch { /* env file optional */ }
};

const parseArgs = (argv: string[]): Flags => {
  const args = argv.slice(2);
  if (args.length === 0) {
    throw new Error(
      'Usage: tsx scripts/test-klingai-direct.ts <imagePath> [--prompt="..."] [--duration=5|10] [--mode=std|pro] [--out=path.mp4]',
    );
  }
  let imagePath = '';
  let prompt = 'Slow macro push-in. Subtle steam, gentle ingredient motion, cinematic warm golden light.';
  let duration = 5;
  let mode: 'std' | 'pro' = 'std';
  let out = '';

  for (const a of args) {
    if (a.startsWith('--prompt=')) prompt = a.slice('--prompt='.length);
    else if (a.startsWith('--duration=')) duration = Number(a.slice('--duration='.length));
    else if (a.startsWith('--mode=')) mode = a.slice('--mode='.length) as 'std' | 'pro';
    else if (a.startsWith('--out=')) out = a.slice('--out='.length);
    else if (!imagePath) imagePath = a;
  }
  if (!imagePath) throw new Error('imagePath required (first positional arg)');
  if (!out) out = `out/klingai-test-${path.basename(imagePath, path.extname(imagePath))}.mp4`;
  if (![5, 10].includes(duration)) throw new Error(`duration must be 5 or 10, got ${duration}`);
  if (!['std', 'pro'].includes(mode)) throw new Error(`mode must be std or pro, got ${mode}`);
  return { imagePath, prompt, duration, mode, out };
};

const main = async (): Promise<void> => {
  await loadEnv('.env');

  const flags = parseArgs(process.argv);

  console.log('=== klingai.com direct API test ===');
  console.log('Image:    ', path.resolve(flags.imagePath));
  console.log('Prompt:   ', flags.prompt.slice(0, 100) + (flags.prompt.length > 100 ? '…' : ''));
  console.log('Mode:     ', flags.mode);
  console.log('Duration: ', flags.duration + 's');
  console.log('Output:   ', path.resolve(flags.out));
  console.log('Cost:     ', `${flags.mode === 'std' ? (flags.duration === 5 ? 2 : 4) : (flags.duration === 5 ? 3.5 : 7)} units (≈ $${flags.mode === 'std' ? (flags.duration === 5 ? '0.28' : '0.56') : (flags.duration === 5 ? '0.49' : '0.98')})`);
  console.log('');

  if (!process.env.KLINGAI_ACCESS_KEY || !process.env.KLINGAI_SECRET_KEY) {
    console.error('ERROR: KLINGAI_ACCESS_KEY and KLINGAI_SECRET_KEY must be set in .env');
    process.exit(1);
  }

  const started = Date.now();
  try {
    const result = await generateKlingaiDirectMotion({
      imagePath: flags.imagePath,
      prompt: flags.prompt,
      durationSeconds: flags.duration,
      mode: flags.mode,
    });

    await mkdir(path.dirname(flags.out), { recursive: true });
    await writeFile(flags.out, result.buffer);

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log('');
    console.log('=== SUCCESS ===');
    console.log('Model:        ', result.modelName);
    console.log('Mode:         ', result.modeUsed);
    console.log('Duration:     ', result.durationUsed + 's');
    console.log('Wall time:    ', elapsed + 's');
    console.log('Output bytes: ', result.buffer.length);
    console.log('Saved to:     ', path.resolve(flags.out));
  } catch (err) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.error('');
    console.error('=== FAILED ===');
    console.error('Wall time:', elapsed + 's');
    console.error('Error:    ', String(err));
    process.exit(1);
  }
};

main();
