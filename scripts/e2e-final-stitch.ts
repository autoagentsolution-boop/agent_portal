#!/usr/bin/env node
// Final stitch: trim 6 Veo clips + concat. Skip vortex-down (outro tilt already does converge).

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('out/quality-test-d/e2e');
const FFMPEG = path.resolve('render-service/node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe');

const ff = (args: string[]) => {
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr || r.stdout}`);
};

const trim = (inP: string, outP: string, sec: number) =>
  ff(['-i', inP, '-t', String(sec), '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-an', outP]);

const clips: [string, number][] = [
  ['01-intro-tilt.mp4', 4],
  ['02-vortex-up.mp4', 6],
  ['03-tour-spices.mp4', 5],
  ['04-tour-beef-noodles.mp4', 5],
  ['05-tour-herbs.mp4', 5],
  ['06-outro-tilt.mp4', 6],   // outro slightly longer — it has the converge
];

const trimmed = clips.map(([f, sec], i) => {
  const inP = path.join(OUT_DIR, f);
  const outP = path.join(OUT_DIR, `t${String(i + 1).padStart(2, '0')}-${f}`);
  console.log(`trim ${f} → ${sec}s`);
  trim(inP, outP, sec);
  return outP;
});

const listFile = path.join(OUT_DIR, '_concat.txt');
writeFileSync(listFile, trimmed.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));

const final = path.join(OUT_DIR, 'pho-bo-e2e-prototype.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-an', final]);

console.log(`\nFinal: ${final}`);
const total = clips.reduce((a, [, s]) => a + s, 0);
console.log(`Duration: ~${total}s`);
