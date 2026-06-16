#!/usr/bin/env node
// End-to-end cooking explode pipeline.
// Input:  fixture JSON path (e.g. render-service/fixtures/dishes/pho-bo.json)
// Output: 2 final mp4 (HoaiMy + NamMinh narration) in out/cooking-explode/<slug>/
// Usage:  npx tsx scripts/run-cooking-explode.ts <fixture.json>

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getOrCompute } from '../render-service/src/util/asset-cache.ts';
import {
  buildCompositionWithVerify,
  type DishFixture,
} from '../render-service/src/jobs/gen-explode-composition.ts';
import { generateMotion, VEO_LITE } from '../render-service/src/jobs/gen-explode-motion.ts';
import { encodeExplodeVideo } from '../render-service/src/jobs/encode-explode-video.ts';
import { generateNarration, VOICES_AB } from '../render-service/src/tts/narration-script.ts';
import { ttsRoute } from '../render-service/src/tts/router.ts';
import { pickTrack, prepareMusicForLength, getLibraryDir } from '../render-service/src/audio/music-library.ts';
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
const MOTION_DURATION_SEC = 8;

const motionPrompt = (d: DishFixture): string =>
  `Subtle breathing motion on this exploded-view food poster: gentle steam rising softly upward from the bowl, faint shimmer in the liquid vortex, very slight floating drift on the exploded ingredients (less than 5% movement), almost imperceptible camera push-in (5% zoom over 8 seconds). Preserve the original composition exactly — do NOT add new ingredients, do NOT change label text, do NOT swap items. Cinematic food photography, dark moody background, warm golden lighting. Keep all Vietnamese labels readable and unchanged. 9:16 vertical, smooth slow-motion feel.`;

const main = async () => {
  const fixturePath = process.argv[2];
  if (!fixturePath) throw new Error('Usage: tsx scripts/run-cooking-explode.ts <fixture.json>');

  await loadEnv('.env');
  if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY in .env');

  const fixture: DishFixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const slug = path.basename(fixturePath, '.json');
  const outDir = path.resolve(`out/cooking-explode/${slug}`);
  await mkdir(outDir, { recursive: true });

  const refImg = path.resolve('screenshot/foodexplode2.png');
  const compositionPath = path.join(outDir, `${slug}-composition.png`);
  const motionPath = path.join(outDir, `${slug}-motion.mp4`);
  const musicPath = path.join(outDir, `${slug}-music.mp3`);
  const summaryPath = path.join(outDir, `${slug}-run.json`);

  console.log(`\n=== Cooking Explode Pipeline ===`);
  console.log(`Dish:     ${fixture.dish_name} (${fixture.ingredients.length} ingredients)`);
  console.log(`Slug:     ${slug}`);
  console.log(`Out dir:  ${outDir}`);
  console.log(`Target:   ${TARGET_LENGTH_SEC}s, 1080x1920, 30fps`);

  const cost: CostBreakdown = {
    composition_usd: 0,
    motion_usd: 0,
    narration_usd: 0,
    music_usd: 0,
    verify_usd: 0,
    total_usd: 0,
  };

  let jobId: string | null = null;
  try {
    const job = await createCookingJob({ slug, niche: 'cooking', script: { dish: fixture.dish_name } });
    jobId = job.id;
    console.log(`\nJob: ${jobId}`);

    // ── Step 1: Composition + vision-verify
    console.log(`\n[1/5] Composition + vision-verify…`);
    await logCookingStep(jobId, 'info', 'image', { step: 'composition_start' });
    const composition = await buildCompositionWithVerify({
      fixture,
      slug,
      referenceImagePath: refImg,
      outImagePath: compositionPath,
    });
    cost.composition_usd = composition.freshGenCostUsd;
    cost.verify_usd = composition.attempts * 0.001;
    await logCookingStep(jobId, 'info', 'verify', {
      attempts: composition.attempts,
      mismatchCount: composition.verify.mismatchCount,
      acceptable: composition.verify.isAcceptable,
      fresh_gen_count: composition.freshGenCount,
    });
    console.log(
      `  ✓ ${compositionPath} (${composition.attempts} attempts, mismatches=${composition.verify.mismatchCount}, fresh gens=${composition.freshGenCount}, $${cost.composition_usd.toFixed(2)})`,
    );

    // ── Step 2: Motion via Veo (cached)
    console.log(`\n[2/5] Veo i2v motion…`);
    await logCookingStep(jobId, 'info', 'motion', { step: 'motion_start' });
    const compSha = (await import('node:crypto')).createHash('sha256').update(await readFile(compositionPath)).digest('hex').slice(0, 12);
    const motionCache = await getOrCompute(
      {
        namespace: 'motion',
        ext: 'mp4',
        inputs: { compSha, prompt: motionPrompt(fixture), durationSec: MOTION_DURATION_SEC, preferredModel: VEO_LITE },
      },
      async () => {
        const r = await generateMotion({
          imagePath: compositionPath,
          prompt: motionPrompt(fixture),
          durationSeconds: MOTION_DURATION_SEC,
        });
        return r.buffer;
      },
    );
    await new Promise<void>(async (resolve, reject) => {
      try {
        const buf = await readFile(motionCache.path);
        await writeFile(motionPath, buf);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    cost.motion_usd = motionCache.cached ? 0 : 0.05;
    await logCookingStep(jobId, 'info', 'motion', { cached: motionCache.cached, cost_usd: cost.motion_usd });
    console.log(`  ✓ ${motionPath} ${motionCache.cached ? '(cache hit, $0)' : `(fresh, ~$${cost.motion_usd})`}`);

    // ── Step 3: Narration script (cached) + TTS A/B
    console.log(`\n[3/5] Narration script + TTS (HoaiMy + NamMinh)…`);
    await logCookingStep(jobId, 'info', 'script', { step: 'narration_start' });
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
    console.log(`  script: ${narration.wordCount} words, ~${narration.estimatedSeconds.toFixed(1)}s ${narrationCache.cached ? '(cached)' : '(fresh)'}`);
    await writeFile(path.join(outDir, `${slug}-narration.txt`), narration.script, 'utf8');
    await logCookingStep(jobId, 'info', 'script', { wordCount: narration.wordCount, estimatedSeconds: narration.estimatedSeconds, cached: narrationCache.cached });

    const ttsResults: Array<{ label: string; path: string }> = [];
    for (const [label, voiceId] of Object.entries(VOICES_AB)) {
      const r = await ttsRoute(narration.script, jobId, 'narrators', voiceId);
      ttsResults.push({ label, path: r.outputFile });
      console.log(`  ✓ ${label}: ${r.outputFile} ${r.cached ? '(cached)' : ''}`);
      await logCookingStep(jobId, 'info', 'tts', { voice: voiceId, cached: r.cached });
    }
    cost.narration_usd = 0;

    // ── Step 4: Music from local library (lo-fi instrumental)
    console.log(`\n[4/5] Music (library: ${getLibraryDir()})…`);
    await logCookingStep(jobId, 'info', 'music', { step: 'music_start', source: 'library' });
    const trackPath = await pickTrack({ slug });
    console.log(`  picked: ${path.basename(trackPath)}`);
    await prepareMusicForLength({
      trackPath,
      lengthSec: TARGET_LENGTH_SEC,
      outPath: musicPath,
      fadeOutSec: 2,
    });
    cost.music_usd = 0;
    await logCookingStep(jobId, 'info', 'music', {
      cached: false,
      source: 'library',
      track: path.basename(trackPath),
      cost_usd: 0,
    });
    console.log(`  ✓ ${musicPath} ($0, from library)`);

    // ── Step 5: ffmpeg encode (2 finals)
    console.log(`\n[5/5] ffmpeg encode (2 finals)…`);
    await logCookingStep(jobId, 'info', 'render', { step: 'encode_start' });
    const encode = await encodeExplodeVideo({
      compositionPath,
      motionPath,
      musicPath,
      narrations: ttsResults,
      outputDir: outDir,
      slug,
      targetLengthSec: TARGET_LENGTH_SEC,
    });
    await logCookingStep(jobId, 'info', 'render', {
      durationMs: encode.durationMs,
      files: encode.finalPaths.map((f) => ({ label: f.label, bytes: f.bytes })),
    });
    for (const f of encode.finalPaths) console.log(`  ✓ ${f.label}: ${f.path} (${(f.bytes / 1024 / 1024).toFixed(2)} MB)`);

    cost.total_usd = Number(
      (
        (cost.composition_usd ?? 0) +
        (cost.motion_usd ?? 0) +
        (cost.narration_usd ?? 0) +
        (cost.music_usd ?? 0) +
        (cost.verify_usd ?? 0)
      ).toFixed(4),
    );

    await finishCookingJob(jobId, {
      videoPath: encode.finalPaths[0]!.path,
      cost,
      status: 'done',
    });

    const summary = {
      slug,
      jobId,
      cost,
      composition: { attempts: composition.attempts, mismatches: composition.verify.mismatchCount },
      narration: { words: narration.wordCount, estimatedSeconds: narration.estimatedSeconds },
      finals: encode.finalPaths.map((f) => ({ label: f.label, path: f.path, bytes: f.bytes })),
    };
    await writeFile(summaryPath, JSON.stringify(summary, null, 2));

    console.log(`\n=== DONE ===`);
    console.log(`Cost: $${cost.total_usd.toFixed(4)} (comp=$${cost.composition_usd?.toFixed(2)} motion=$${cost.motion_usd?.toFixed(2)} music=$${cost.music_usd?.toFixed(2)})`);
    console.log(`Summary: ${summaryPath}`);
    console.log(`Finals: ${encode.finalPaths.length}`);
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
