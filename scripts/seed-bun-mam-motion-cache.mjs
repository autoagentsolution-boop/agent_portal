// Seed the storyboard-clip cache with the already-rendered Bún Mắm motion files.
// The cache key changed after we shipped per-panel modelHint routing; without seeding,
// re-running the pipeline would refire Veo ($2.90 burn) even though valid mp4 exists.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(await readFile(path.join(ROOT, 'FoodImage/BunMam/bun-mam-storyboard-v2.json'), 'utf8'));
const cacheRoot = path.join(ROOT, 'render-service/public/explode-cache/storyboard-clip');
const panelDir = path.join(ROOT, 'render-service/public/storyboard-v2/bun-mam');
await mkdir(cacheRoot, { recursive: true });

const canonical = (v) => {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonical);
  return Object.keys(v).sort().reduce((a, k) => (a[k] = canonical(v[k]), a), {});
};
const snapDuration = (d) => [4, 6, 8].reduce((p, c) => Math.abs(c - d) < Math.abs(p - d) ? c : p);
const pad2 = (n) => String(n).padStart(2, '0');

let seeded = 0, alreadyCached = 0, missingSource = 0;
for (const p of fixture.panels) {
  const inputs = {
    id: `${fixture.dishSlug}-panel-${pad2(p.index)}`,
    startImage: path.join(panelDir, `panel-${pad2(p.index)}.png`),
    prompt: p.motionDirection,
    durationSec: snapDuration(p.durationSec),
    provider: 'veo',
    modelHint: 'lite',
  };
  const payload = JSON.stringify({ ns: 'storyboard-clip', inputs: canonical(inputs) });
  const hash = createHash('sha256').update(payload).digest('hex').slice(0, 24);
  const cachePath = path.join(cacheRoot, `${hash}.mp4`);
  const sourcePath = path.join(panelDir, `motion-${pad2(p.index)}.mp4`);

  const cacheExists = await access(cachePath).then(() => true, () => false);
  if (cacheExists) {
    console.log(`panel-${pad2(p.index)} ALREADY ${hash}`);
    alreadyCached++;
    continue;
  }
  const sourceExists = await access(sourcePath).then(() => true, () => false);
  if (!sourceExists) {
    console.log(`panel-${pad2(p.index)} NO_SOURCE ${sourcePath}`);
    missingSource++;
    continue;
  }
  await copyFile(sourcePath, cachePath);
  console.log(`panel-${pad2(p.index)} SEED   ${hash}`);
  seeded++;
}
console.log(`\nseeded=${seeded} already=${alreadyCached} missing=${missingSource}`);
