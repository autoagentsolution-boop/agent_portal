import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(await readFile(path.join(ROOT, 'FoodImage/BunMam/bun-mam-storyboard-v2.json'), 'utf8'));
const cacheRoot = path.join(ROOT, 'render-service/public/explode-cache/storyboard-clip');
const imagesDir = path.join(ROOT, 'render-service/public/storyboard-v2/bun-mam');

const canonical = (v) => {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonical);
  return Object.keys(v).sort().reduce((a, k) => (a[k] = canonical(v[k]), a), {});
};
const snapDuration = (d) => [4, 6, 8].reduce((p, c) => Math.abs(c - d) < Math.abs(p - d) ? c : p);
const pad2 = (n) => String(n).padStart(2, '0');

let hits = 0, misses = 0;
for (const p of fixture.panels) {
  const inputs = {
    id: `${fixture.dishSlug}-panel-${pad2(p.index)}`,
    startImage: path.join(imagesDir, `panel-${pad2(p.index)}.png`),
    prompt: p.motionDirection,
    durationSec: snapDuration(p.durationSec),
    provider: 'veo',
    modelHint: 'lite',
  };
  const payload = JSON.stringify({ ns: 'storyboard-clip', inputs: canonical(inputs) });
  const hash = createHash('sha256').update(payload).digest('hex').slice(0, 24);
  const cachePath = path.join(cacheRoot, `${hash}.mp4`);
  const ok = await access(cachePath).then(() => true, () => false);
  console.log(`panel-${pad2(p.index)} ${ok ? 'HIT' : 'MISS'} ${hash}`);
  ok ? hits++ : misses++;
}
console.log(`\n${hits} hits / ${misses} misses`);
