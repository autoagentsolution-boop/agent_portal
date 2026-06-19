#!/usr/bin/env node
// Storyboard v2 end-to-end runner.
// Input:  ChatGPT-authored multi-panel storyboard JSON (validated against schema-v2)
// Output: out/<dishSlug>-v2.mp4 (1080x1920, 30fps)
//
// Flags:
//   --dry-run           Plan only, no API calls, $0 spent
//   --skip-motion       Skip Veo i2v (panels render as static images)
//   --skip-tts          Skip TTS (panels render silent)
//   --images-dir=<dir>  Pre-generated panel images (skip Pro Banana); files must be panel-NN.png
//   --out=<path>        Override output mp4 path (default: out/<slug>-v2.mp4)
//   --cost-cap=<usd>    Override COST_CAP_USD env (motion stage refuses if estimate exceeds)
//
// Usage:
//   npx tsx scripts/run-storyboard-v2.ts render-service/fixtures/storyboard-v2/bo-kho.json \
//     --images-dir=render-service/public/storyboard-v2/bo-kho --dry-run

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { parseStoryboardV2 } from '../render-service/src/storyboard/validate.ts';
import { runAdapterV2 } from '../render-service/src/storyboard/adapter-v2.ts';
import { generatePanelMotion } from '../render-service/src/storyboard/motion-v2.ts';
import type { PanelAssets } from '../render-service/src/storyboard/types-v2.ts';
import type {
  CookingExplosionV2Props,
  PanelV2Render,
} from '../render-service/src/templates/cooking-explosion/types.ts';
import { pickTrack, prepareMusicForLength } from '../render-service/src/audio/music-library.ts';

// Anchor paths to the script file location, NOT CWD. Running this script from
// render-service/ (where package.json lives) used to double the segment as
// render-service/render-service/public/... because path.resolve('render-service/public')
// resolves relative to CWD.
import { fileURLToPath } from 'node:url';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const PUBLIC_ROOT = path.resolve(PROJECT_ROOT, 'render-service/public');
const TEMP_DIR = path.resolve(PROJECT_ROOT, 'render-service/temp');

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

interface CliFlags {
  fixturePath: string;
  dryRun: boolean;
  skipMotion: boolean;
  skipTts: boolean;
  skipMusic: boolean;
  imagesDir?: string;
  out?: string;
  costCapUsd?: number;
}

const parseArgs = (argv: string[]): CliFlags => {
  const args = argv.slice(2);
  if (args.length === 0) throw new Error('Usage: tsx scripts/run-storyboard-v2.ts <fixture.json> [--dry-run] [--skip-motion] [--skip-tts] [--images-dir=<dir>] [--out=<path>] [--cost-cap=<usd>]');
  const fixturePath = args[0]!;
  const flags: CliFlags = { fixturePath, dryRun: false, skipMotion: false, skipTts: false, skipMusic: false };
  for (const a of args.slice(1)) {
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--skip-motion') flags.skipMotion = true;
    else if (a === '--skip-tts') flags.skipTts = true;
    else if (a === '--skip-music') flags.skipMusic = true;
    else if (a.startsWith('--images-dir=')) flags.imagesDir = a.slice('--images-dir='.length);
    else if (a.startsWith('--out=')) flags.out = a.slice('--out='.length);
    else if (a.startsWith('--cost-cap=')) flags.costCapUsd = Number(a.slice('--cost-cap='.length));
    else throw new Error(`Unknown flag: ${a}`);
  }
  return flags;
};

const toPanelRender = (p: PanelAssets): PanelV2Render => ({
  index: p.index,
  kind: p.kind,
  imagePath: p.imagePathRel,
  audioPath: p.audioPathRel,
  motionPath: p.motionPathRel,
  durationSec: p.durationSec,
  transition: p.transition,
  imageTextLabel: p.imageTextLabel,
});

const runRemotion = (propsPath: string, outPath: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const args = [
      'remotion',
      'render',
      'src/templates/index.tsx',
      'CookingExplosion',
      outPath,
      `--props=${propsPath}`,
    ];
    console.log(`[remotion] npx ${args.join(' ')}`);
    const proc = spawn('npx', args, { cwd: 'render-service', stdio: 'inherit', shell: process.platform === 'win32' });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`remotion render exited with code ${code}`));
    });
  });

const main = async () => {
  const flags = parseArgs(process.argv);
  await loadEnv('.env');

  const raw = JSON.parse(await readFile(flags.fixturePath, 'utf8'));
  const story = parseStoryboardV2(raw);

  const outAbs = path.resolve(flags.out ?? `out/${story.dishSlug}-v2.mp4`);
  await mkdir(path.dirname(outAbs), { recursive: true });
  await mkdir(TEMP_DIR, { recursive: true });

  console.log(`\n=== Storyboard V2 Pipeline ===`);
  console.log(`Dish:    ${story.dishName} (${story.panels.length} panels, ${story.totalDurationSec}s)`);
  console.log(`Slug:    ${story.dishSlug}`);
  console.log(`Mode:    dry-run=${flags.dryRun} skip-motion=${flags.skipMotion} skip-tts=${flags.skipTts} images-dir=${flags.imagesDir ?? '(gen)'}`);
  console.log(`Output:  ${outAbs}`);

  // ── Stage 1: Adapter — images + TTS
  console.log(`\n[1/3] Adapter (images + TTS)…`);
  const adapter = await runAdapterV2(story, {
    outputRoot: PUBLIC_ROOT,
    imagesDir: flags.imagesDir,
    dryRun: flags.dryRun,
    skipTts: flags.skipTts,
  });
  const t = adapter.totals;
  console.log(`  images: ${t.imagesProvided} provided + ${t.imagesCached} cached + ${t.imagesGenerated} fresh`);
  console.log(`  tts:    ${t.ttsCached} cached + ${t.ttsGenerated} fresh`);
  console.log(`  est:    $${t.estCostUsd.toFixed(4)}`);

  // ── Stage 2: Motion (Veo i2v per panel)
  console.log(`\n[2/3] Motion (Veo i2v per panel)…`);
  let panels = adapter.panels;
  let motionCost = 0;
  if (flags.skipMotion) {
    console.log(`  skipped (--skip-motion)`);
  } else {
    const motion = await generatePanelMotion(adapter, {
      outputRoot: PUBLIC_ROOT,
      dryRun: flags.dryRun,
      costCapUsd: flags.costCapUsd,
    });
    panels = motion.panels;
    motionCost = motion.totals.estCostUsd;
    console.log(`  clips: ${motion.totals.clipsCached} cached + ${motion.totals.clipsGenerated} fresh`);
    console.log(`  est:   $${motionCost.toFixed(4)}`);
  }

  // ── Stage 2.5: Background music (chill lo-fi loop with fade-out)
  let bgMusicPath: string | undefined;
  if (flags.skipMusic) {
    console.log(`\n[2.5/3] Music skipped (--skip-music)`);
  } else if (flags.dryRun) {
    console.log(`\n[2.5/3] Music (dry-run) — would pick from MUSIC_LIBRARY_DIR, loop to ${story.totalDurationSec}s, fade-out 2s`);
  } else {
    console.log(`\n[2.5/3] Background music…`);
    const musicDir = path.resolve(PUBLIC_ROOT, 'storyboard-v2', story.dishSlug);
    const musicAbs = path.join(musicDir, 'music.mp3');
    const musicRel = `storyboard-v2/${story.dishSlug}/music.mp3`;
    await mkdir(musicDir, { recursive: true });
    const trackPath = await pickTrack({ slug: story.dishSlug });
    await prepareMusicForLength({
      trackPath,
      lengthSec: story.totalDurationSec,
      outPath: musicAbs,
      fadeOutSec: 2,
    });
    bgMusicPath = musicRel;
    console.log(`  track:  ${path.basename(trackPath)}`);
    console.log(`  output: ${musicAbs}`);
  }

  // ── Stage 3: Remotion render
  console.log(`\n[3/3] Remotion render…`);
  const props: CookingExplosionV2Props = {
    schemaVersion: 'v2',
    dishName: story.dishName,
    variant: 'dark',
    panels: panels.map(toPanelRender),
    bgMusicPath,
  };
  const propsPath = path.join(TEMP_DIR, `v2-render-props-${story.dishSlug}.json`);
  await writeFile(propsPath, JSON.stringify(props, null, 2), 'utf8');
  console.log(`  props: ${propsPath}`);

  if (flags.dryRun) {
    console.log(`  skipped (--dry-run); props written for inspection`);
  } else {
    // Remotion CLI expects path relative to cwd=render-service
    const relProps = path.relative('render-service', propsPath);
    const relOut = path.relative('render-service', outAbs);
    await runRemotion(relProps, relOut);
  }

  // ── Summary
  const totalCost = t.estCostUsd + motionCost;
  console.log(`\n=== DONE ===`);
  console.log(`Est total cost: $${totalCost.toFixed(4)}`);
  console.log(`Output:         ${outAbs}`);
};

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
