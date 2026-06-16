#!/usr/bin/env node
// Approach A test: image-to-video camera tilt.
//   1. Gen top-down still of pho bowl via nano-banana-pro-preview
//   2. Pass still as start frame to Veo 3.1 with prompt "tilt down to 3/4 side view"
//   3. Verify camera tilt actually happens (vs Veo ignoring start frame)
//
// Cost: ~$0.10 ($0.05 still + $0.05 Veo Light, or $0.15 Fast if Light rejects image input).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const loadEnv = async (p: string) => {
  try {
    const c = await readFile(p, 'utf8');
    for (const ln of c.split(/\r?\n/)) {
      const m = ln.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2] ?? '';
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1]! in process.env)) process.env[m[1]!] = v;
    }
  } catch {}
};

const OUT_DIR = path.resolve('out/quality-test-d');

const topdownPrompt = `Top-down birds-eye view of a single bowl of Vietnamese pho bo on a dark slate table. Bowl centered in frame, perfectly round. Inside: clear golden broth, glossy rice noodles tangled in spiral, thin slices of medium-rare beef arranged in fan, fresh Thai basil leaves and cilantro on top, bean sprouts, lime wedge, sliced red chili, star anise pod, cinnamon stick floating. Steam rising softly. Dark moody background visible around bowl. Warm tungsten rim light from upper right. Macro food photography, 4K hyper-real, sharp focus throughout. NO text or labels. 9:16 vertical composition with bowl filling 70% of frame.`;

const tiltPrompt = `Smooth cinematic camera tilt: starting from a top-down bird's-eye view of this Vietnamese pho bowl, the camera slowly tilts forward and pulls back over 8 seconds, ending at a 45-degree front 3/4 side angle with the bowl in the lower third of the frame. As the camera tilts, golden steam begins to rise more dramatically from the bowl, broth droplets start to lift, and ingredients gently float upward suggesting impending vortex motion. Dark moody background revealed during tilt, warm tungsten rim light, hyper-real macro food cinematography, 4K. NO text. 9:16 vertical.`;

const genTopdownStill = async (apiKey: string): Promise<string> => {
  const model = 'nano-banana-pro-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: topdownPrompt }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  };
  const r = await fetch(`${url}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`pro_banana_${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j: any = await r.json();
  const inline = j.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
  if (!inline?.data) throw new Error(`pro_banana_no_image: ${JSON.stringify(j).slice(0, 300)}`);
  const out = path.join(OUT_DIR, 'topdown-still.png');
  await writeFile(out, Buffer.from(inline.data, 'base64'));
  return out;
};

const genVeoI2V = async (apiKey: string, stillPath: string, model: string): Promise<string> => {
  const imgB64 = (await readFile(stillPath)).toString('base64');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`;
  const body = {
    instances: [
      {
        prompt: tiltPrompt,
        image: { bytesBase64Encoded: imgB64, mimeType: 'image/png' },
      },
    ],
    parameters: { aspectRatio: '9:16', personGeneration: 'allow_all', durationSeconds: 8 },
  };
  const r = await fetch(`${url}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`veo_start_${r.status}: ${(await r.text()).slice(0, 500)}`);
  const j: any = await r.json();
  if (!j.name) throw new Error(`no_op: ${JSON.stringify(j).slice(0, 300)}`);
  console.log(`[veo-i2v ${model}] op: ${j.name}`);

  const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${j.name}`;
  const start = Date.now();
  while (Date.now() - start < 10 * 60 * 1000) {
    await new Promise((res) => setTimeout(res, 8000));
    const p = await fetch(`${pollUrl}?key=${apiKey}`);
    if (!p.ok) continue;
    const pj: any = await p.json();
    if (!pj.done) {
      console.log('[veo-i2v] running…');
      continue;
    }
    if (pj.error) throw new Error(`veo_failed: ${JSON.stringify(pj.error)}`);
    const v0 =
      pj.response?.generateVideoResponse?.generatedSamples?.[0]
      ?? pj.response?.generatedVideos?.[0]
      ?? pj.response?.videos?.[0];
    if (!v0) throw new Error(`no_video: ${JSON.stringify(pj.response).slice(0, 400)}`);
    const inline = v0.video?.encodedVideo ?? v0.bytesBase64Encoded;
    const uri = v0.video?.uri ?? v0.uri ?? v0.video?.videoUri;
    const out = path.join(OUT_DIR, `i2v-tilt-${model.split('-').slice(0, 3).join('-')}.mp4`);
    if (inline) {
      await writeFile(out, Buffer.from(inline, 'base64'));
      return out;
    }
    if (uri) {
      const sep = uri.includes('?') ? '&' : '?';
      const dl = await fetch(`${uri}${sep}key=${apiKey}`);
      if (!dl.ok) throw new Error(`dl_${dl.status}`);
      await writeFile(out, Buffer.from(await dl.arrayBuffer()));
      return out;
    }
    throw new Error('no_payload');
  }
  throw new Error('timeout');
};

const main = async () => {
  await loadEnv('.env');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY');
  await mkdir(OUT_DIR, { recursive: true });

  console.log('[1/2] Pro Banana top-down still…');
  const stillPath = await genTopdownStill(apiKey);
  console.log(`  ✓ ${stillPath}`);

  console.log('[2/2] Veo 3.1 Light i2v tilt…');
  try {
    const clip = await genVeoI2V(apiKey, stillPath, 'veo-3.1-lite-generate-preview');
    console.log(`  ✓ Light: ${clip}`);
  } catch (e) {
    console.log(`  ✗ Light: ${(e as Error).message}`);
    console.log('  → fallback to Veo 3.1 fast…');
    const clip2 = await genVeoI2V(apiKey, stillPath, 'veo-3.1-fast-generate-preview');
    console.log(`  ✓ Fast: ${clip2}`);
  }
};

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
