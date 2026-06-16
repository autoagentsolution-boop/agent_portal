#!/usr/bin/env node
// Iterate explode aesthetic + benchmark Veo 3.1 Light vs Veo 3.0 fast.
// Variants in parallel:
//   1. v2-golden-bowl    — warmer tungsten + center bowl visible + steam particles
//   2. v3-topdown-radial — bird's eye flat radial spread
//   3. v1-light-control  — same prompt as winning radial-v1 but on Veo 3.1 Light (cost benchmark)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const loadEnv = async (p: string) => {
  try {
    const c = await readFile(p, 'utf8');
    for (const ln of c.split(/\r?\n/)) {
      const m = ln.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const k = m[1]!;
      let v = m[2] ?? '';
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {}
};

const OUT_DIR = path.resolve('out/quality-test-d');

type Spec = { name: string; model: string; prompt: string };

const SPECS: Spec[] = [
  {
    name: 'explode-v2-golden-bowl',
    model: 'veo-3.1-lite-generate-preview',
    prompt:
      'Cinematic exploded view of a Vietnamese pho bowl: an empty white-and-blue ceramic bowl sits at the center, ingredients FROZEN suspended in mid-air radiating outward from the bowl like a slow-motion explosion — thin medium-rare beef slices, glossy rice noodles tangling, fresh Thai basil and cilantro leaves, bean sprouts, lime wedges, sliced red chilies, star anise pods, cinnamon stick, frozen broth droplets and golden steam particles. Warm tungsten rim light, dark moody backdrop, dramatic shadows. Camera slowly dollies forward 5%. Macro food photography, hyper-real 4K, shallow depth of field. NO text or labels. 9:16 vertical.',
  },
  {
    name: 'explode-v3-topdown-radial',
    model: 'veo-3.1-lite-generate-preview',
    prompt:
      'Top-down birds-eye view of a Vietnamese pho bowl exploding in slow-motion: bowl centered at the frame, ingredients radiating outward in a perfect circular pattern frozen mid-air — beef slices, rice noodles, herbs, sprouts, lime wedges, star anise, chilies, cinnamon sticks. Dark slate background, golden volumetric light from above, broth droplets suspended. Camera slowly rotates 10 degrees. Macro food photography, 4K hyper-real, dramatic lighting. NO text. 9:16 vertical.',
  },
  {
    name: 'explode-v1-control-light',
    model: 'veo-3.1-lite-generate-preview',
    prompt:
      'Cinematic exploded view of a bowl of Vietnamese pho bo. Ingredients suspended frozen in mid-air around a central empty space where the bowl is implied — thin slices of medium-rare beef, glossy rice noodles, fresh basil and cilantro leaves, bean sprouts, lime wedge, sliced red chili, star anise pods, cinnamon stick. Soup broth droplets and golden steam particles frozen in slow-motion. Dark moody background with rim light. Macro food photography, 4K hyper-real, depth of field. Camera slowly orbits. NO text or labels. 9:16 vertical.',
  },
];

const genVeo = async (apiKey: string, spec: Spec): Promise<string> => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${spec.model}:predictLongRunning`;
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
  console.log(`[${spec.name}] (${spec.model}) op: ${j.name}`);

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
