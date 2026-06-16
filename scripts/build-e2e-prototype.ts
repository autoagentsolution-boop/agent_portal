#!/usr/bin/env node
// Build full vortex storyboard prototype for pho bo.
// Sequential Veo i2v chaining for cross-clip consistency:
//   Pro Banana topdown still → clip1 → (last frame) → clip2 → ... → clip7
// Then ffmpeg trim each + reverse vortex-up = vortex-down + concat → final mp4.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
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

const OUT_DIR = path.resolve('out/quality-test-d/e2e');
const FFMPEG = path.resolve('render-service/node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe');
const VEO_MODEL = 'veo-3.1-lite-generate-preview';

const ff = (args: string[]) => {
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr || r.stdout}`);
};

// --- Pro Banana topdown still ---
const topdownPrompt = `Top-down birds-eye view of a single bowl of Vietnamese pho bo on a dark slate table. Bowl perfectly centered, perfectly round. Inside: clear golden broth, glossy rice noodles in spiral, thin slices of medium-rare beef in fan, fresh Thai basil and cilantro on top, bean sprouts, lime wedge, sliced red chili, star anise pod, cinnamon stick floating. Steam rising softly. Dark moody background around bowl. Warm tungsten rim light from upper right. Macro food photography, 4K hyper-real, sharp focus. NO text. 9:16 vertical with bowl filling 70% of frame.`;

const genTopdownStill = async (apiKey: string): Promise<string> => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/nano-banana-pro-preview:generateContent`;
  const r = await fetch(`${url}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: topdownPrompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });
  if (!r.ok) throw new Error(`pro_${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j: any = await r.json();
  const inline = j.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
  if (!inline?.data) throw new Error('no_image');
  const out = path.join(OUT_DIR, '00-topdown-still.png');
  await writeFile(out, Buffer.from(inline.data, 'base64'));
  return out;
};

// --- Veo i2v ---
const genVeoI2V = async (apiKey: string, startImagePath: string, prompt: string, outName: string): Promise<string> => {
  const imgB64 = (await readFile(startImagePath)).toString('base64');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${VEO_MODEL}:predictLongRunning`;
  const body = {
    instances: [{ prompt, image: { bytesBase64Encoded: imgB64, mimeType: 'image/png' } }],
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
  console.log(`  [${outName}] op: ${j.name}`);

  const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${j.name}`;
  const start = Date.now();
  while (Date.now() - start < 10 * 60 * 1000) {
    await new Promise((res) => setTimeout(res, 8000));
    const p = await fetch(`${pollUrl}?key=${apiKey}`);
    if (!p.ok) continue;
    const pj: any = await p.json();
    if (!pj.done) {
      console.log(`  [${outName}] running…`);
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
    const out = path.join(OUT_DIR, `${outName}.mp4`);
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

const extractLastFrame = (clipPath: string, outPath: string) => {
  ff(['-sseof', '-0.5', '-i', clipPath, '-frames:v', '1', outPath]);
};

const trimClip = (inPath: string, outPath: string, seconds: number) => {
  ff(['-i', inPath, '-t', String(seconds), '-c', 'copy', outPath]);
};

const reverseClip = (inPath: string, outPath: string) => {
  ff(['-i', inPath, '-vf', 'reverse', '-an', outPath]);
};

const concatClips = (clipPaths: string[], outPath: string) => {
  const listFile = path.join(OUT_DIR, '_concat.txt');
  const lines = clipPaths.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "\\'")}'`).join('\n');
  spawnSync('node', ['-e', `require('fs').writeFileSync(process.argv[1], process.argv[2])`, listFile, lines]);
  ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', outPath]);
};

const main = async () => {
  await loadEnv('.env');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY');
  await mkdir(OUT_DIR, { recursive: true });

  const t0 = Date.now();
  console.log('[0/7] Pro Banana topdown still…');
  const still = await genTopdownStill(apiKey);
  console.log(`  ✓ ${still}`);

  // Clip 1: intro tilt
  console.log('[1/7] Intro tilt (top-down → 3/4 side)…');
  const clip1 = await genVeoI2V(
    apiKey,
    still,
    `Cinematic camera tilt: starting top-down bird's-eye view of this Vietnamese pho bowl, camera slowly tilts forward and pulls back over 8 seconds, ending at a 45-degree front 3/4 angle. Bowl moves to lower-center of frame as we tilt. Golden steam intensifies, broth droplets begin to lift, ingredients gently float upward suggesting imminent vortex. Dark moody background, warm tungsten rim light. Hyper-real macro food cinematography. 9:16.`,
    '01-intro-tilt',
  );
  console.log(`  ✓ ${clip1}`);
  const frame1End = path.join(OUT_DIR, '01-end-frame.png');
  extractLastFrame(clip1, frame1End);

  // Clip 2: vortex up
  console.log('[2/7] Vortex up (cyclone from bowl)…');
  const clip2 = await genVeoI2V(
    apiKey,
    frame1End,
    `Cinematic slow-motion vortex: from this Vietnamese pho bowl shot at 3/4 angle, soup broth and ingredients (rice noodles, medium-rare beef slices, basil leaves, bean sprouts, star anise pods, cinnamon sticks, lime wedges, red chili slices) spiral upward in a glowing golden cyclone like a tornado of food. Vortex tapers narrower as it ascends. Camera tracks upward following the vortex from bowl rim to apex. Dark background, golden volumetric tungsten light. Hyper-real 4K. 9:16.`,
    '02-vortex-up',
  );
  console.log(`  ✓ ${clip2}`);
  const frame2End = path.join(OUT_DIR, '02-end-frame.png');
  extractLastFrame(clip2, frame2End);

  // Clip 3: tour spices
  console.log('[3/7] Tour: spices toasting close-up…');
  const clip3 = await genVeoI2V(
    apiKey,
    frame2End,
    `Cinematic macro close-up: from the vortex of suspended ingredients, camera dives toward and tracks slowly around the spice cluster — cinnamon sticks, star anise pods, cardamom, cloves — all suspended in mid-air with golden tungsten light glinting off their surfaces, subtle steam wisps around them, slow-motion rotation. Hyper-real macro food photography, shallow depth of field, dark background. 9:16.`,
    '03-tour-spices',
  );
  console.log(`  ✓ ${clip3}`);
  const frame3End = path.join(OUT_DIR, '03-end-frame.png');
  extractLastFrame(clip3, frame3End);

  // Clip 4: tour beef + noodles
  console.log('[4/7] Tour: beef + noodles macro…');
  const clip4 = await genVeoI2V(
    apiKey,
    frame3End,
    `Cinematic macro close-up: from the spices, camera glides over to the suspended beef slices and rice noodles cluster — thin medium-rare beef slices with marbling visible, glossy rice noodles cascading in suspended motion, golden broth droplets glistening. Slow-motion rotation, dark background, warm tungsten rim light. Hyper-real 4K macro food cinematography. 9:16.`,
    '04-tour-beef-noodles',
  );
  console.log(`  ✓ ${clip4}`);
  const frame4End = path.join(OUT_DIR, '04-end-frame.png');
  extractLastFrame(clip4, frame4End);

  // Clip 5: tour herbs + lime
  console.log('[5/7] Tour: herbs + lime + chili macro…');
  const clip5 = await genVeoI2V(
    apiKey,
    frame4End,
    `Cinematic macro close-up: camera glides to the fresh herbs and aromatics — Thai basil leaves, cilantro sprigs, bean sprouts, lime wedges with juice droplets, sliced red chilies — all suspended mid-air, slow rotation, vibrant green and red colors popping against dark background. Golden rim light. Hyper-real macro food photography, shallow depth of field. 9:16.`,
    '05-tour-herbs',
  );
  console.log(`  ✓ ${clip5}`);
  const frame5End = path.join(OUT_DIR, '05-end-frame.png');
  extractLastFrame(clip5, frame5End);

  // Clip 6: outro tilt (side → top-down dish reveal)
  console.log('[6/7] Outro tilt (side → top-down dish reveal)…');
  const clip6 = await genVeoI2V(
    apiKey,
    frame5End,
    `Cinematic camera tilt: starting from this 3/4 side angle view, all suspended ingredients converge back down into a perfectly assembled bowl of Vietnamese pho bo. Camera simultaneously tilts upward to end at a clean top-down bird's-eye view of the finished bowl over 8 seconds. Soft steam rises. Dark slate background visible. Warm tungsten rim light. Hyper-real macro food photography. 9:16.`,
    '06-outro-tilt',
  );
  console.log(`  ✓ ${clip6}`);

  // Post-processing: trim each clip to target lengths
  console.log('[7/7] ffmpeg: trim + reverse + concat…');
  const t1 = path.join(OUT_DIR, 't01-intro.mp4');
  const t2 = path.join(OUT_DIR, 't02-vortex-up.mp4');
  const t3 = path.join(OUT_DIR, 't03-spices.mp4');
  const t4 = path.join(OUT_DIR, 't04-beef.mp4');
  const t5 = path.join(OUT_DIR, 't05-herbs.mp4');
  const t6r = path.join(OUT_DIR, 't06-vortex-down.mp4');
  const t7 = path.join(OUT_DIR, 't07-outro.mp4');

  trimClip(clip1, t1, 4);
  trimClip(clip2, t2, 6);
  trimClip(clip3, t3, 5);
  trimClip(clip4, t4, 5);
  trimClip(clip5, t5, 5);
  reverseClip(t2, t6r);                 // vortex-down = reverse of vortex-up
  trimClip(clip6, t7, 4);

  // Concat in order: intro → vortex-up → spices → beef → herbs → vortex-down → outro
  const final = path.join(OUT_DIR, 'pho-bo-e2e-prototype.mp4');
  concatClips([t1, t2, t3, t4, t5, t6r, t7], final);

  const dt = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\n=== Done in ${dt} min ===`);
  console.log(`Final: ${final}`);
};

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
