#!/usr/bin/env node
// One-off quality benchmark for option D:
//   1. Regen pho-bo dish hero with `nano-banana-pro-preview`  (vs current `gemini-2.5-flash-image`)
//   2. Generate 1 short Veo 3.0 fast vertical clip of pho-bo cooking B-roll
// Saves outputs to out/quality-test-d/ for side-by-side review with the existing render.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const loadEnv = async (envPath: string): Promise<void> => {
  try {
    const content = await readFile(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1]!;
      let v = m[2] ?? '';
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(key in process.env)) process.env[key] = v;
    }
  } catch {}
};

const OUT_DIR = path.resolve('out/quality-test-d');
const API_KEY_VAR = 'GEMINI_API_KEY';

const dishPrompt = `Editorial food photography: a steaming bowl of authentic Vietnamese pho bo on a rustic dark wooden table, top-down 3/4 angle, hyper-realistic, intricate noodles visible, thin slices of medium-rare beef, fresh herbs (basil, cilantro, scallions), bean sprouts on the side, lime wedge, sliced red chili. Warm golden hour lighting, soft volumetric steam rising. Shallow depth of field, bokeh background. Shot on Sony A7IV 85mm f/1.4, food magazine style, Michelin guide aesthetic. 9:16 vertical composition with bowl centered lower third.`;

const veoPrompt = `Cinematic vertical close-up of a steaming bowl of Vietnamese pho bo. Chopsticks lifting glossy rice noodles dripping with broth, steam swirling, slow motion. Beef slices glistening, fresh basil leaves trembling from steam. Warm tungsten lighting, shallow depth of field, 4K hyper-real food cinematography. Aspect ratio 9:16.`;

// --- Pro Banana hero ---
const genProHero = async (apiKey: string): Promise<string> => {
  const model = 'nano-banana-pro-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: dishPrompt }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  };
  const r = await fetch(`${url}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`pro_banana_${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j: any = await r.json();
  const parts = j.candidates?.[0]?.content?.parts ?? [];
  const inline = parts.find((p: any) => p.inlineData)?.inlineData;
  if (!inline?.data) throw new Error(`pro_banana_no_image: ${JSON.stringify(j).slice(0, 400)}`);
  const out = path.join(OUT_DIR, 'pho-bo-pro-banana.png');
  await writeFile(out, Buffer.from(inline.data, 'base64'));
  return out;
};

// --- Veo 3.0 fast clip ---
const genVeoClip = async (apiKey: string): Promise<string> => {
  const model = 'veo-3.0-fast-generate-001';
  const startUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`;
  const startBody = {
    instances: [{ prompt: veoPrompt }],
    parameters: {
      aspectRatio: '9:16',
      personGeneration: 'allow_all',
      durationSeconds: 8,
    },
  };
  const start = await fetch(`${startUrl}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(startBody),
  });
  if (!start.ok) throw new Error(`veo_start_${start.status}: ${(await start.text()).slice(0, 400)}`);
  const startJson: any = await start.json();
  const opName = startJson.name;
  if (!opName) throw new Error(`veo_no_op: ${JSON.stringify(startJson).slice(0, 400)}`);
  console.log(`[veo] operation: ${opName}`);

  // Poll
  const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${opName}`;
  const startedAt = Date.now();
  const MAX_MS = 8 * 60 * 1000;
  while (Date.now() - startedAt < MAX_MS) {
    await new Promise((r) => setTimeout(r, 8000));
    const p = await fetch(`${pollUrl}?key=${apiKey}`);
    if (!p.ok) {
      console.log(`[veo] poll ${p.status}, retry…`);
      continue;
    }
    const pj: any = await p.json();
    if (pj.done) {
      if (pj.error) throw new Error(`veo_failed: ${JSON.stringify(pj.error)}`);
      const videos = pj.response?.generateVideoResponse?.generatedSamples
        ?? pj.response?.generatedVideos
        ?? pj.response?.videos
        ?? [];
      if (!videos.length) throw new Error(`veo_no_video_in_response: ${JSON.stringify(pj.response).slice(0, 500)}`);
      const v0 = videos[0];
      const videoUri = v0.video?.uri ?? v0.uri ?? v0.video?.videoUri;
      const inlineB64 = v0.video?.encodedVideo ?? v0.bytesBase64Encoded;
      const out = path.join(OUT_DIR, 'pho-bo-veo-5s.mp4');
      if (inlineB64) {
        await writeFile(out, Buffer.from(inlineB64, 'base64'));
        return out;
      }
      if (videoUri) {
        const sep = videoUri.includes('?') ? '&' : '?';
        const dl = await fetch(`${videoUri}${sep}key=${apiKey}`);
        if (!dl.ok) throw new Error(`veo_download_${dl.status}: ${(await dl.text()).slice(0, 300)}`);
        const buf = Buffer.from(await dl.arrayBuffer());
        await writeFile(out, buf);
        return out;
      }
      throw new Error(`veo_unknown_format: ${JSON.stringify(v0).slice(0, 500)}`);
    }
    const meta = pj.metadata ?? {};
    console.log(`[veo] still running… progress=${meta.progressPercent ?? '?'}`);
  }
  throw new Error('veo_timeout_8min');
};

const main = async () => {
  await loadEnv('.env');
  const apiKey = process.env[API_KEY_VAR];
  if (!apiKey) throw new Error(`Missing ${API_KEY_VAR} in .env`);
  await mkdir(OUT_DIR, { recursive: true });

  console.log('[1/2] Pro Banana hero…');
  try {
    const heroPath = await genProHero(apiKey);
    console.log(`  ✓ ${heroPath}`);
  } catch (e) {
    console.log(`  ✗ ${(e as Error).message}`);
  }

  console.log('[2/2] Veo 3.0 fast clip (5s)…');
  try {
    const clipPath = await genVeoClip(apiKey);
    console.log(`  ✓ ${clipPath}`);
  } catch (e) {
    console.log(`  ✗ ${(e as Error).message}`);
  }

  console.log('\nDone. Compare:');
  console.log('  - Current hero:  render-service/public/cooking-assets/dishes/pho-bo.png');
  console.log('  - Pro hero:      out/quality-test-d/pho-bo-pro-banana.png');
  console.log('  - Veo clip:      out/quality-test-d/pho-bo-veo-5s.mp4');
};

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
