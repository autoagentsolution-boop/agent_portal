#!/usr/bin/env node
// Test pivot: Nano Banana Pro with foodexplode.png reference → gen pho bo S-curve composition (no text).
// Then Veo i2v gentle motion. Confirm aesthetic before building Remotion text overlay system.

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

const OUT_DIR = path.resolve('out/quality-test-d/spiral');
const REF_IMAGE = path.resolve('screenshot/foodexplode.png');

const compositionPrompt = `Generate a vertical 9:16 food photography composition matching the style of the reference image, but for Vietnamese PHO BO ingredients only.

REQUIRED COMPOSITION:
- Dark moody wooden table background, dramatic chiaroscuro lighting
- A glowing golden broth S-curve spiral flowing vertically from a finished bowl of pho bo at the bottom up to the top of the frame
- Along the S-curve, scattered/suspended pho ingredients in mid-air slow-motion: thin medium-rare beef slices (thịt bò tái), well-done beef slices (thịt bò chín), beef brisket (nạm/gầu), rice noodles (bánh phở), bone broth (nước dùng), fish sauce (nước mắm), star anise (hoa hồi), cloves (đinh hương), shallots (hành tím), salt (muối), rock sugar (đường phèn), ginger (gừng), thảo quả (black cardamom), cinnamon (quế), black pepper (tiêu đen), chilies and lime (chanh ớt), green chives (gừ đỏ), Vietnamese coriander (rau quế), green onion (ngò gai), white onion (hành tây), spring onion + scallions (hành lá, ngò), and a finishing garnish at top.
- Each ingredient clearly visible, photo-realistic, dramatic rim light, slight broth droplets and golden steam between them
- A finished bowl of pho bo at the bottom with chopsticks and side plates
- DO NOT include any text, labels, lines, captions, or annotations — leave clean negative space on left and right sides of the spiral for text to be added later in post.
- Photorealistic food photography, 4K hyper-real, shallow depth of field, warm golden tungsten light, magazine-cover quality, NO text or labels of any kind.`;

const genComposition = async (apiKey: string): Promise<string> => {
  const refBytes = (await readFile(REF_IMAGE)).toString('base64');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/nano-banana-pro-preview:generateContent`;
  const body = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: 'image/png', data: refBytes } },
          { text: compositionPrompt },
        ],
      },
    ],
    generationConfig: { responseModalities: ['IMAGE'] },
  };
  const r = await fetch(`${url}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`pro_${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j: any = await r.json();
  const inline = j.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
  if (!inline?.data) throw new Error(`no_image: ${JSON.stringify(j).slice(0, 400)}`);
  const out = path.join(OUT_DIR, 'spiral-composition.png');
  await writeFile(out, Buffer.from(inline.data, 'base64'));
  return out;
};

const motionPrompt = `Subtle cinematic motion from this Vietnamese pho bo composition: golden broth flows slowly through the S-curve spiral, gentle steam rises from the bowl, the suspended ingredients breathe and gently rotate in place (no major position change), broth droplets shimmer. Camera performs an extremely slow push-in (5% zoom over 8 seconds). The overall composition stays the same — all ingredients remain in their suspended positions along the spiral. Dark moody background, warm tungsten rim light. Hyper-real macro food cinematography. NO text. 9:16 vertical.`;

const genMotion = async (apiKey: string, startImagePath: string): Promise<string> => {
  const imgB64 = (await readFile(startImagePath)).toString('base64');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-lite-generate-preview:predictLongRunning`;
  const body = {
    instances: [{ prompt: motionPrompt, image: { bytesBase64Encoded: imgB64, mimeType: 'image/png' } }],
    parameters: { aspectRatio: '9:16', personGeneration: 'allow_all', durationSeconds: 8 },
  };
  const r = await fetch(`${url}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`veo_${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j: any = await r.json();
  if (!j.name) throw new Error('no_op');
  console.log(`[motion] op: ${j.name}`);

  const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${j.name}`;
  const start = Date.now();
  while (Date.now() - start < 10 * 60 * 1000) {
    await new Promise((res) => setTimeout(res, 8000));
    const p = await fetch(`${pollUrl}?key=${apiKey}`);
    if (!p.ok) continue;
    const pj: any = await p.json();
    if (!pj.done) {
      console.log('[motion] running…');
      continue;
    }
    if (pj.error) throw new Error(`failed: ${JSON.stringify(pj.error)}`);
    const v0 =
      pj.response?.generateVideoResponse?.generatedSamples?.[0]
      ?? pj.response?.generatedVideos?.[0]
      ?? pj.response?.videos?.[0];
    if (!v0) throw new Error('no_video');
    const inline = v0.video?.encodedVideo ?? v0.bytesBase64Encoded;
    const uri = v0.video?.uri ?? v0.uri ?? v0.video?.videoUri;
    const out = path.join(OUT_DIR, 'spiral-motion.mp4');
    if (inline) await writeFile(out, Buffer.from(inline, 'base64'));
    else if (uri) {
      const sep = uri.includes('?') ? '&' : '?';
      const dl = await fetch(`${uri}${sep}key=${apiKey}`);
      if (!dl.ok) throw new Error(`dl_${dl.status}`);
      await writeFile(out, Buffer.from(await dl.arrayBuffer()));
    } else throw new Error('no_payload');
    return out;
  }
  throw new Error('timeout');
};

const main = async () => {
  await loadEnv('.env');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY');
  await mkdir(OUT_DIR, { recursive: true });

  console.log('[1/2] Nano Banana Pro: spiral composition (ref = foodexplode.png)…');
  const stillPath = await genComposition(apiKey);
  console.log(`  ✓ ${stillPath}`);

  console.log('[2/2] Veo 3.1 Light: gentle motion (broth flow + steam + breathe)…');
  try {
    const clip = await genMotion(apiKey, stillPath);
    console.log(`  ✓ ${clip}`);
  } catch (e) {
    console.log(`  ✗ ${(e as Error).message}`);
  }
};

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
