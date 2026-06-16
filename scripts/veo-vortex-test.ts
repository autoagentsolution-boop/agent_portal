#!/usr/bin/env node
// Test 2 critical motion shots for the new vortex storyboard:
//   1. topdown-to-side-transition — camera tilts from top-down to side, ingredients begin to float
//   2. vortex-up                   — soup + ingredients spiral upward in cyclone, camera follows
// If both work, full storyboard (8-10 clips) is feasible. Cost: 2 × $0.05 Veo 3.1 Light.

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
const MODEL = 'veo-3.1-lite-generate-preview';

type Spec = { name: string; prompt: string };

const SPECS: Spec[] = [
  {
    name: 'transition-topdown-to-side',
    prompt:
      'A bowl of Vietnamese pho bo on a dark slate table, shot from directly above (top-down view). Camera slowly tilts and pulls back from top-down to a 45-degree side angle over the duration of the shot, ending with the bowl filling the lower frame. As the camera tilts, golden broth droplets and steam begin to rise from the bowl, and ingredients (basil leaves, beef slices, star anise, lime wedges) start to gently float upward. Dark moody background, warm tungsten rim light, hyper-real macro food cinematography, 4K, shallow depth of field. NO text. 9:16 vertical.',
  },
  {
    name: 'vortex-up-spiral',
    prompt:
      'Cinematic slow-motion vortex: a bowl of Vietnamese pho bo at the bottom of frame, soup broth and ingredients (rice noodles, medium-rare beef slices, basil leaves, bean sprouts, star anise pods, cinnamon sticks, lime wedges, red chili slices) spiral upward in a glowing golden cyclone, like a tornado of food in zero gravity. The vortex starts wide at the bowl and tapers narrower as it ascends, broth liquid swirling in helical streams. Camera tracks upward following the vortex from bowl rim to apex. Dark moody background, golden volumetric tungsten light, dramatic rim light on every ingredient. Hyper-real 4K macro food photography, shallow depth of field. NO text. 9:16 vertical.',
  },
];

const genVeo = async (apiKey: string, spec: Spec): Promise<string> => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:predictLongRunning`;
  const body = {
    instances: [{ prompt: spec.prompt }],
    parameters: { aspectRatio: '9:16', personGeneration: 'allow_all', durationSeconds: 8 },
  };
  const r = await fetch(`${url}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`start_${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j: any = await r.json();
  if (!j.name) throw new Error(`no_op: ${JSON.stringify(j).slice(0, 300)}`);
  console.log(`[${spec.name}] op: ${j.name}`);

  const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${j.name}`;
  const start = Date.now();
  while (Date.now() - start < 10 * 60 * 1000) {
    await new Promise((res) => setTimeout(res, 8000));
    const p = await fetch(`${pollUrl}?key=${apiKey}`);
    if (!p.ok) continue;
    const pj: any = await p.json();
    if (!pj.done) {
      console.log(`[${spec.name}] running…`);
      continue;
    }
    if (pj.error) throw new Error(`failed: ${JSON.stringify(pj.error)}`);
    const v0 =
      pj.response?.generateVideoResponse?.generatedSamples?.[0]
      ?? pj.response?.generatedVideos?.[0]
      ?? pj.response?.videos?.[0];
    if (!v0) throw new Error(`no_video: ${JSON.stringify(pj.response).slice(0, 400)}`);
    const inline = v0.video?.encodedVideo ?? v0.bytesBase64Encoded;
    const uri = v0.video?.uri ?? v0.uri ?? v0.video?.videoUri;
    const out = path.join(OUT_DIR, `${spec.name}.mp4`);
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
  const results = await Promise.allSettled(SPECS.map((s) => genVeo(apiKey, s)));
  console.log('\n=== Results ===');
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') console.log(`  ✓ ${SPECS[i].name} → ${r.value}`);
    else console.log(`  ✗ ${SPECS[i].name}: ${(r.reason as Error).message}`);
  });
};

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
