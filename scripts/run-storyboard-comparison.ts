#!/usr/bin/env node
// Compare 2 storyboard variants: B (5-clip detail, $0.25) and C (2-clip cheap, $0.10).
// Both 45s @ 1080×1920, same narration + music. Produces 4 finals (2 variants × 2 voices).
// Usage: npx tsx scripts/run-storyboard-comparison.ts <fixture.json>

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getOrCompute } from '../render-service/src/util/asset-cache.ts';
import {
  generateStoryboardClips,
  buildVariantBSpecs,
  buildVariantCSpecs,
} from '../render-service/src/jobs/gen-storyboard-clips.ts';
import { encodeStoryboardVideo } from '../render-service/src/jobs/encode-storyboard-video.ts';
import { generateNarration, VOICES_AB } from '../render-service/src/tts/narration-script.ts';
import { ttsRoute } from '../render-service/src/tts/router.ts';
import { pickTrack, prepareMusicForLength } from '../render-service/src/audio/music-library.ts';
import {
  createCookingJob,
  finishCookingJob,
  failCookingJob,
  logCookingStep,
  type CostBreakdown,
} from '../render-service/src/jobs/cooking-run-log.ts';

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

const TARGET_LENGTH_SEC = 45;

interface Fixture {
  dish_name: string;
  dish_name_display: string;
  tagline: string;
  final_dish_description: string;
  serving_vessel_style: string;
  table_material: string;
  background_style: string;
  ingredients: Array<{ label: string; prep: string; qty: string; order: number }>;
  finish_step: { label: string; prep: string; qty: string };
}

const main = async () => {
  const fixturePath = process.argv[2];
  if (!fixturePath) throw new Error('Usage: tsx scripts/run-storyboard-comparison.ts <fixture.json>');

  await loadEnv('.env');
  if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');

  const fixture: Fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const slug = path.basename(fixturePath, '.json');
  const outDir = path.resolve(`out/cooking-explode/${slug}`);
  await mkdir(outDir, { recursive: true });

  const heroPath = path.join(outDir, `${slug}-hero.png`);
  const compositionPath = path.join(outDir, `${slug}-composition.png`);
  const musicPath = path.join(outDir, `${slug}-music.mp3`);

  console.log(`\n=== Storyboard Comparison ===`);
  console.log(`Dish: ${fixture.dish_name}`);
  console.log(`Out:  ${outDir}`);
  console.log(`Hero: ${heroPath}`);
  console.log(`Comp: ${compositionPath}`);

  // Verify inputs exist
  for (const p of [heroPath, compositionPath]) {
    try {
      await readFile(p);
    } catch {
      throw new Error(`missing_input: ${p}. Run gen-hero-frame.ts + build-explode-composition.ts first.`);
    }
  }

  const cost: CostBreakdown = { total_usd: 0 };
  let jobId: string | null = null;

  try {
    const job = await createCookingJob({ slug: `${slug}-storyboard`, niche: 'cooking', script: { dish: fixture.dish_name, mode: 'storyboard_comparison' } });
    jobId = job.id;
    console.log(`Job: ${jobId}\n`);

    // Step 1: Generate all Veo clips for both variants (cached).
    console.log(`[1/4] Generate storyboard clips (Variant B: 5 clips, Variant C: 2 clips)…`);
    const variantBSpecs = buildVariantBSpecs(heroPath, compositionPath);
    const variantCSpecs = buildVariantCSpecs(heroPath, compositionPath);

    await logCookingStep(jobId, 'info', 'motion', { step: 'clips_start', variantB: variantBSpecs.length, variantC: variantCSpecs.length });
    const allSpecs = [...variantBSpecs, ...variantCSpecs];
    const allClips = await generateStoryboardClips(allSpecs);

    const clipCost = allClips.reduce((s, c) => s + c.freshCostUsd, 0);
    cost.motion_usd = clipCost;
    console.log(`  → ${allClips.length} clips, ${allClips.filter((c) => c.cached).length} cached, $${clipCost.toFixed(2)} fresh cost`);
    await logCookingStep(jobId, 'info', 'motion', {
      clips: allClips.map((c) => ({ id: c.id, cached: c.cached, freshCostUsd: c.freshCostUsd })),
    });

    const clipsById = new Map(allClips.map((c) => [c.id, c.cachePath]));
    const variantBPaths = variantBSpecs.map((s) => clipsById.get(s.id)!);
    const variantCPaths = variantCSpecs.map((s) => clipsById.get(s.id)!);

    // Step 2: Narration script + TTS A/B (reuse cache).
    console.log(`\n[2/4] Narration + TTS (HoaiMy + NamMinh)…`);
    const narrationCache = await getOrCompute(
      {
        namespace: 'narration',
        ext: 'json',
        inputs: { slug, dish: fixture.dish_name, targetSec: TARGET_LENGTH_SEC, ingredientCount: fixture.ingredients.length },
      },
      async () => {
        const r = await generateNarration({ fixture, targetSeconds: TARGET_LENGTH_SEC });
        return Buffer.from(JSON.stringify(r), 'utf8');
      },
    );
    const narration = JSON.parse((await readFile(narrationCache.path)).toString('utf8')) as { script: string; wordCount: number; estimatedSeconds: number };
    console.log(`  script: ${narration.wordCount} words ${narrationCache.cached ? '(cached)' : '(fresh)'}`);
    await writeFile(path.join(outDir, `${slug}-narration.txt`), narration.script, 'utf8');

    const ttsResults: Array<{ label: string; path: string }> = [];
    for (const [label, voiceId] of Object.entries(VOICES_AB)) {
      const r = await ttsRoute(narration.script, jobId, 'narrators', voiceId);
      ttsResults.push({ label, path: r.outputFile });
      console.log(`  ✓ ${label}: ${path.basename(r.outputFile)} ${r.cached ? '(cached)' : ''}`);
    }
    cost.narration_usd = 0;

    // Step 3: Music (library).
    console.log(`\n[3/4] Music (library)…`);
    const trackPath = await pickTrack({ slug });
    await prepareMusicForLength({ trackPath, lengthSec: TARGET_LENGTH_SEC, outPath: musicPath, fadeOutSec: 2 });
    cost.music_usd = 0;
    console.log(`  ✓ ${path.basename(musicPath)} (${path.basename(trackPath)})`);

    // Step 4: Encode both variants.
    console.log(`\n[4/4] Encode Variants B + C…`);

    const encodeB = await encodeStoryboardVideo({
      heroPath,
      bodyClips: variantBPaths,
      narrations: ttsResults,
      musicPath,
      outputDir: outDir,
      slug,
      variantId: 'variantB-5clip',
      targetLengthSec: TARGET_LENGTH_SEC,
    });
    console.log(`\n  Variant B (5-clip detail tour):`);
    for (const f of encodeB.finalPaths) console.log(`    ✓ ${f.label}: ${path.basename(f.path)} (${(f.bytes / 1024 / 1024).toFixed(2)} MB)`);

    const encodeC = await encodeStoryboardVideo({
      heroPath,
      bodyClips: variantCPaths,
      narrations: ttsResults,
      musicPath,
      outputDir: outDir,
      slug,
      variantId: 'variantC-2clip',
      targetLengthSec: TARGET_LENGTH_SEC,
    });
    console.log(`\n  Variant C (2-clip cheap):`);
    for (const f of encodeC.finalPaths) console.log(`    ✓ ${f.label}: ${path.basename(f.path)} (${(f.bytes / 1024 / 1024).toFixed(2)} MB)`);

    cost.total_usd = Number(((cost.motion_usd ?? 0) + (cost.narration_usd ?? 0) + (cost.music_usd ?? 0)).toFixed(4));

    await finishCookingJob(jobId, {
      videoPath: encodeB.finalPaths[0]!.path,
      cost,
      status: 'done',
    });

    const summaryPath = path.join(outDir, `${slug}-storyboard-comparison.json`);
    await writeFile(
      summaryPath,
      JSON.stringify({
        slug,
        jobId,
        cost,
        variants: {
          B: { clips: variantBSpecs.length, finals: encodeB.finalPaths.map((f) => ({ label: f.label, path: f.path, bytes: f.bytes })) },
          C: { clips: variantCSpecs.length, finals: encodeC.finalPaths.map((f) => ({ label: f.label, path: f.path, bytes: f.bytes })) },
        },
      }, null, 2),
    );

    console.log(`\n=== DONE ===`);
    console.log(`Total cost: $${cost.total_usd.toFixed(4)} (motion=$${cost.motion_usd?.toFixed(2)})`);
    console.log(`Summary: ${summaryPath}`);
    console.log(`Compare:`);
    console.log(`  Variant B HoaiMy:  ${encodeB.finalPaths.find((f) => f.label === 'HoaiMy')?.path}`);
    console.log(`  Variant C HoaiMy:  ${encodeC.finalPaths.find((f) => f.label === 'HoaiMy')?.path}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (jobId) await failCookingJob(jobId, msg);
    throw err;
  }
};

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
