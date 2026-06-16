#!/usr/bin/env node
// Continue E2E build after Veo 3.1 Light quota cap.
// Gens clip 5 + clip 6 on Veo 3.0 fast (separate quota), then stitches all 7 trims.

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

const ff = (args: string[]) => {
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr || r.stdout}`);
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
  const txt = clipPaths.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "\\'")}'`).join('\n');
  spawnSync('node', ['-e', "require('fs').writeFileSync(process.argv[1], process.argv[2])", listFile, txt]);
  ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', outPath]);
};

const genVeoI2V = async (apiKey: string, startImagePath: string, prompt: string, outName: string, model: string): Promise<string> => {
  const imgB64 = (await readFile(startImagePath)).toString('base64');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`;
  const body = {
    instances: [{ prompt, image: { bytesBase64Encoded: imgB64, mimeType: 'image/png' } }],
    parameters: { aspectRatio: '9:16', personGeneration: 'allow_adult', durationSeconds: 8 },
  };
  const r = await fetch(`${url}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`veo_${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j: any = await r.json();
  if (!j.name) throw new Error('no_op');
  console.log(`  [${outName}] (${model}) op: ${j.name}`);

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

const main = async () => {
  await loadEnv('.env');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY');
  await mkdir(OUT_DIR, { recursive: true });

  const FAST = 'veo-3.0-fast-generate-001';

  // Resume from clip 4 end frame
  const clip4Path = path.join(OUT_DIR, '04-tour-beef-noodles.mp4');
  const frame4End = path.join(OUT_DIR, '04-end-frame.png');
  extractLastFrame(clip4Path, frame4End);

  // Clip 5: tour herbs
  console.log('[5/7] Tour herbs + lime + chili (Veo 3.0 fast fallback)…');
  const clip5 = await genVeoI2V(
    apiKey,
    frame4End,
    `Cinematic macro close-up: camera glides to fresh herbs and aromatics — Thai basil leaves, cilantro sprigs, bean sprouts, lime wedges with juice droplets, sliced red chilies — all suspended mid-air, slow rotation, vibrant green and red colors against dark background. Golden rim light. Hyper-real macro food photography, shallow depth of field. 9:16.`,
    '05-tour-herbs',
    FAST,
  );
  const frame5End = path.join(OUT_DIR, '05-end-frame.png');
  extractLastFrame(clip5, frame5End);

  // Clip 6: outro tilt
  console.log('[6/7] Outro tilt (Veo 3.0 fast)…');
  const clip6 = await genVeoI2V(
    apiKey,
    frame5End,
    `Cinematic camera tilt: from this 3/4 side angle, all suspended ingredients converge back into a perfectly assembled bowl of Vietnamese pho bo. Camera simultaneously tilts upward ending at clean top-down bird's-eye view of finished bowl over 8 seconds. Soft steam rises. Dark slate background. Warm tungsten rim light. Hyper-real macro food photography. 9:16.`,
    '06-outro-tilt',
    FAST,
  );

  // ffmpeg post-process
  console.log('[7/7] ffmpeg: trim + reverse + concat…');
  const clip1 = path.join(OUT_DIR, '01-intro-tilt.mp4');
  const clip2 = path.join(OUT_DIR, '02-vortex-up.mp4');
  const clip3 = path.join(OUT_DIR, '03-tour-spices.mp4');

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
  trimClip(clip4Path, t4, 5);
  trimClip(clip5, t5, 5);
  reverseClip(t2, t6r);
  trimClip(clip6, t7, 4);

  const final = path.join(OUT_DIR, 'pho-bo-e2e-prototype.mp4');
  concatClips([t1, t2, t3, t4, t5, t6r, t7], final);
  console.log(`\nFinal: ${final}`);
};

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
