#!/usr/bin/env node
// Probe: Veo 3.1 text-to-video with explicit "3D product exploded view" prompt.
// Test if Veo can produce the reference style (Apple keynote-like 3D animation).
// Cost: $0.05 (Veo 3.1 Lite). Output: out/probes/veo-3d-explode-probe.mp4
// Usage: npx tsx scripts/probe-veo-3d-explode.ts

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../render-service/src/logger.ts';

const VEO_MODEL = 'veo-3.1-lite-generate-preview';

const PROMPT = `Hyper-realistic 3D CGI commercial product showcase animation of a Vietnamese pho bo bowl exploded view.

Style: Apple keynote product reveal aesthetic. Premium 3D rendered ingredients suspended in dark studio space. All components (rice noodles, beef slices, fresh herbs, lime wedge, star anise, cinnamon stick, beef broth, white ceramic bowl) frozen mid-air in a 3D arrangement, slowly drifting apart with golden particle trails. Camera orbits clockwise around the floating ingredients in slow motion over 8 seconds. Each ingredient has subtle internal motion (steam, broth droplets, herb leaves trembling).

Lighting: dark moody studio background with dramatic rim light from upper right, soft fill from below, golden tungsten color temperature. Hyper-detailed PBR materials, photorealistic textures, depth of field on rotating focus.

Composition: 9:16 vertical aspect ratio. Bowl positioned at lower center. Ingredients radiating outward in a clean exploded layout. NO text, NO labels, NO captions appearing.

Mood: premium restaurant marketing reel, professional product commercial, ultra-detailed 3D animation showcase, Vietnamese culinary heritage atmosphere, cinematic slow-motion food showcase.`;

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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const startTextToVideo = async (apiKey: string, prompt: string): Promise<string> => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${VEO_MODEL}:predictLongRunning`;
  const body = {
    instances: [{ prompt }],
    parameters: { aspectRatio: '9:16', personGeneration: 'allow_all', durationSeconds: 8 },
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`veo_start_${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j = (await r.json()) as { name?: string };
  if (!j.name) throw new Error('veo_no_op_name');
  return j.name;
};

const pollVeo = async (apiKey: string, opName: string): Promise<Buffer> => {
  const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${opName}`;
  const start = Date.now();
  while (Date.now() - start < 10 * 60 * 1000) {
    await sleep(8000);
    let r: Response;
    try {
      r = await fetch(pollUrl, { headers: { 'x-goog-api-key': apiKey } });
    } catch (err) {
      logger.warn('veo_poll_net', { error: String(err).slice(0, 200) });
      continue;
    }
    if (!r.ok) continue;
    const pj = (await r.json()) as any;
    if (!pj.done) {
      console.log('[probe] running…');
      continue;
    }
    if (pj.error) throw new Error(`veo_failed: ${JSON.stringify(pj.error).slice(0, 300)}`);
    const v0 = pj.response?.generateVideoResponse?.generatedSamples?.[0] ?? pj.response?.generatedVideos?.[0] ?? pj.response?.videos?.[0];
    if (!v0) throw new Error(`veo_no_payload: ${JSON.stringify(pj.response).slice(0, 300)}`);
    const inline = v0.video?.encodedVideo ?? v0.bytesBase64Encoded;
    const uri = v0.video?.uri ?? v0.uri ?? v0.video?.videoUri;
    if (inline) return Buffer.from(inline, 'base64');
    if (uri) {
      const dl = await fetch(uri, { headers: { 'x-goog-api-key': apiKey } });
      if (!dl.ok) throw new Error(`veo_download_${dl.status}`);
      return Buffer.from(await dl.arrayBuffer());
    }
    throw new Error('veo_no_payload_or_uri');
  }
  throw new Error('veo_poll_timeout');
};

const main = async () => {
  await loadEnv('.env');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY');

  const outDir = path.resolve('out/probes');
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'veo-3d-explode-probe.mp4');
  const promptPath = path.join(outDir, 'veo-3d-explode-probe-prompt.txt');
  await writeFile(promptPath, PROMPT);
  console.log(`Prompt: ${promptPath}`);

  console.log(`\nProbing Veo 3.1 Lite text-to-video (3D exploded view style)…`);
  const start = Date.now();
  const opName = await startTextToVideo(apiKey, PROMPT);
  console.log(`  op: ${opName}`);
  const buf = await pollVeo(apiKey, opName);
  await writeFile(outPath, buf);
  const sec = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✓ Probe done in ${sec}s (~$0.05): ${outPath}`);
  console.log(`  Size: ${(buf.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`\nReview:`);
  console.log(`  - 3D space feel? (ingredients floating in space, not flat poster)`);
  console.log(`  - Camera orbit visible? (clockwise rotation around bowl)`);
  console.log(`  - Ingredient identifiable? (each piece distinct, not blurry mash)`);
  console.log(`  - Studio aesthetic? (Apple-keynote-like, not random food shot)`);
};

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
