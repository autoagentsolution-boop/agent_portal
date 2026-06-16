#!/usr/bin/env node
// Verify Veo can produce the "exploded view food" aesthetic.
// Outputs 3 clips for A/B compare (different prompts) so we pick the winning style for Phase 12.

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

type ClipSpec = { name: string; prompt: string };

const CLIPS: ClipSpec[] = [
  {
    name: 'explode-radial',
    prompt:
      'Cinematic exploded view of a bowl of Vietnamese pho bo. Ingredients suspended frozen in mid-air around a central empty space where the bowl is implied — thin slices of medium-rare beef, glossy rice noodles, fresh basil and cilantro leaves, bean sprouts, lime wedge, sliced red chili, star anise pods, cinnamon stick. Soup broth droplets and golden steam particles frozen in slow-motion. Dark moody background with rim light. Macro food photography, 4K hyper-real, depth of field. Camera slowly orbits. NO text or labels. 9:16 vertical.',
  },
  {
    name: 'explode-layered-stack',
    prompt:
      'Vertical exploded-view product shot of a Vietnamese pho bowl, like an architectural cross-section: bowl base at bottom, noodles layer hovering 30cm above, beef slices layer hovering above that, herbs/sprouts layer at top — each layer suspended in dark space with soft golden rim light. Broth liquid streams arcing between layers in slow-motion. Macro food photography, dark cinematic background, shallow depth of field. NO text. 9:16 vertical.',
  },
  {
    name: 'explode-converge',
    prompt:
      'Slow-motion reverse-explosion shot: Vietnamese pho bo ingredients (beef slices, rice noodles, basil leaves, bean sprouts, star anise, broth droplets) flying inward from all directions and converging into a single bowl at center, splashing and settling. Dark moody background, golden rim light, cinematic food photography. Camera locked on bowl. NO text. 9:16 vertical.',
  },
];

const genVeoClip = async (apiKey: string, spec: ClipSpec): Promise<string> => {
  const model = 'veo-3.0-fast-generate-001';
  const startUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`;
  const body = {
    instances: [{ prompt: spec.prompt }],
    parameters: { aspectRatio: '9:16', personGeneration: 'allow_all', durationSeconds: 8 },
  };
  const r = await fetch(`${startUrl}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`veo_start_${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j: any = await r.json();
  const opName = j.name;
  if (!opName) throw new Error(`veo_no_op: ${JSON.stringify(j).slice(0, 300)}`);
  console.log(`[${spec.name}] op: ${opName}`);

  const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${opName}`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 9 * 60 * 1000) {
    await new Promise((res) => setTimeout(res, 8000));
    const p = await fetch(`${pollUrl}?key=${apiKey}`);
    if (!p.ok) continue;
    const pj: any = await p.json();
    if (!pj.done) {
      console.log(`[${spec.name}] running…`);
      continue;
    }
    if (pj.error) throw new Error(`veo_failed: ${JSON.stringify(pj.error)}`);
    const v0 =
      pj.response?.generateVideoResponse?.generatedSamples?.[0]
      ?? pj.response?.generatedVideos?.[0]
      ?? pj.response?.videos?.[0];
    if (!v0) throw new Error(`veo_no_video: ${JSON.stringify(pj.response).slice(0, 400)}`);
    const inlineB64 = v0.video?.encodedVideo ?? v0.bytesBase64Encoded;
    const uri = v0.video?.uri ?? v0.uri ?? v0.video?.videoUri;
    const out = path.join(OUT_DIR, `${spec.name}.mp4`);
    if (inlineB64) {
      await writeFile(out, Buffer.from(inlineB64, 'base64'));
      return out;
    }
    if (uri) {
      const sep = uri.includes('?') ? '&' : '?';
      const dl = await fetch(`${uri}${sep}key=${apiKey}`);
      if (!dl.ok) throw new Error(`veo_dl_${dl.status}`);
      await writeFile(out, Buffer.from(await dl.arrayBuffer()));
      return out;
    }
    throw new Error('veo_no_payload');
  }
  throw new Error('veo_timeout');
};

const main = async () => {
  await loadEnv('.env');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY');
  await mkdir(OUT_DIR, { recursive: true });

  // Fire all 3 in parallel — Veo runs ~3-5 min each
  const results = await Promise.allSettled(CLIPS.map((c) => genVeoClip(apiKey, c)));
  console.log('\n=== Results ===');
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') console.log(`  ✓ ${CLIPS[i].name} → ${r.value}`);
    else console.log(`  ✗ ${CLIPS[i].name}: ${(r.reason as Error).message}`);
  });
};

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
