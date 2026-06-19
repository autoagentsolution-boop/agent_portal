import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../logger.ts';
import { generate as nanoBananaGen } from '../image/nano-banana.ts';
import { ttsRoute } from '../tts/router.ts';
import type { StoryboardV2 } from './schema-v2.ts';
import type { AdapterResult, AdapterTotals, PanelAssets } from './types-v2.ts';

const NANO_BANANA_USD = 0.06;
const TTS_USD = 0.005;

export interface AdapterOptions {
  outputRoot: string;            // typically render-service/public
  imagesDir?: string;            // if set, skip image gen; map panel index → <dir>/panel-NN.png
  dryRun?: boolean;
  skipTts?: boolean;
}

const pad2 = (n: number): string => n.toString().padStart(2, '0');

const fileExists = async (p: string): Promise<boolean> => {
  try {
    const s = await stat(p);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
};

const ensureDir = async (p: string): Promise<void> => {
  await mkdir(p, { recursive: true });
};

const copyToTarget = async (src: string, dst: string): Promise<void> => {
  await ensureDir(path.dirname(dst));
  await copyFile(src, dst);
};

const runChunked = async <T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const results = await Promise.all(batch.map(fn));
    out.push(...results);
  }
  return out;
};

const renderPanelImage = async (
  story: StoryboardV2,
  panelIdx: number,
  destAbs: string,
  imagesDir: string | undefined,
  referenceAbs: string | undefined,
  totals: AdapterTotals,
): Promise<void> => {
  const panel = story.panels[panelIdx]!;
  if (imagesDir) {
    const src = path.resolve(imagesDir, `panel-${pad2(panel.index)}.png`);
    if (!(await fileExists(src))) {
      throw new Error(`pre_gen_image_missing: ${src}`);
    }
    await copyToTarget(src, destAbs);
    totals.imagesProvided += 1;
    logger.info('panel_image_provided', { index: panel.index, src: path.basename(src) });
    return;
  }
  const mode: 'text-to-image' | 'edit' = referenceAbs ? 'edit' : 'text-to-image';
  const result = await nanoBananaGen({
    prompt: panel.imagePrompt,
    mode,
    referenceImagePath: referenceAbs,
  });
  await copyToTarget(result.outputFile, destAbs);
  if (result.cached) totals.imagesCached += 1;
  else {
    totals.imagesGenerated += 1;
    totals.estCostUsd += NANO_BANANA_USD;
  }
  logger.info('panel_image_done', {
    index: panel.index,
    mode,
    cached: result.cached,
    referenced: Boolean(referenceAbs),
  });
};

const renderPanelTts = async (
  story: StoryboardV2,
  panelIdx: number,
  destAbs: string,
  totals: AdapterTotals,
): Promise<boolean> => {
  const panel = story.panels[panelIdx]!;
  const text = panel.narrationVi.trim();
  if (!text) return false;
  // Short-circuit when narration already exists at destination — avoids DB round-trip
  // for re-stitch flows and lets users hand-drop pre-baked mp3s (parallel to --images-dir).
  if (await fileExists(destAbs)) {
    totals.ttsCached += 1;
    logger.info('panel_tts_done', { index: panel.index, cached: true, voice: 'pre-existing' });
    return true;
  }
  const result = await ttsRoute(text, story.dishSlug, 'narrators');
  await copyToTarget(result.outputFile, destAbs);
  if (result.cached) totals.ttsCached += 1;
  else {
    totals.ttsGenerated += 1;
    totals.estCostUsd += TTS_USD;
  }
  logger.info('panel_tts_done', { index: panel.index, cached: result.cached, voice: result.voiceUsed });
  return true;
};

const planDryRun = (story: StoryboardV2, opts: AdapterOptions, panelDir: string): AdapterResult => {
  const panels: PanelAssets[] = story.panels.map((p) => ({
    index: p.index,
    kind: p.kind,
    imagePathAbs: path.join(panelDir, `panel-${pad2(p.index)}.png`),
    imagePathRel: `storyboard-v2/${story.dishSlug}/panel-${pad2(p.index)}.png`,
    audioPathAbs: p.narrationVi.trim() ? path.join(panelDir, `narration-${pad2(p.index)}.mp3`) : undefined,
    audioPathRel: p.narrationVi.trim() ? `storyboard-v2/${story.dishSlug}/narration-${pad2(p.index)}.mp3` : undefined,
    durationSec: p.durationSec,
    transition: p.transition,
    imageTextLabel: p.imageTextLabel,
    narrationVi: p.narrationVi,
    motionDirection: p.motionDirection,
    motionComplexity: p.motionComplexity,
  }));
  for (const p of story.panels) {
    const src = opts.imagesDir
      ? `pre-gen ${path.resolve(opts.imagesDir, `panel-${pad2(p.index)}.png`)}`
      : `pro-banana mode=${p.index === 1 ? 'text-to-image' : 'edit'} prompt="${p.imagePrompt.slice(0, 60)}…"`;
    logger.info('dry_run_plan', { idx: p.index, image: src, tts: p.narrationVi ? `"${p.narrationVi.slice(0, 60)}…"` : 'skip' });
  }
  return {
    dishSlug: story.dishSlug,
    dishName: story.dishName,
    outputRoot: opts.outputRoot,
    panels,
    totals: { imagesGenerated: 0, imagesCached: 0, imagesProvided: 0, ttsGenerated: 0, ttsCached: 0, estCostUsd: 0 },
  };
};

export const runAdapterV2 = async (story: StoryboardV2, opts: AdapterOptions): Promise<AdapterResult> => {
  const panelDir = path.resolve(opts.outputRoot, 'storyboard-v2', story.dishSlug);
  if (opts.dryRun) return planDryRun(story, opts, panelDir);

  await ensureDir(panelDir);
  const totals: AdapterTotals = {
    imagesGenerated: 0,
    imagesCached: 0,
    imagesProvided: 0,
    ttsGenerated: 0,
    ttsCached: 0,
    estCostUsd: 0,
  };

  // Panel 0 always sequential (reference for subsequent edit-mode calls when no pre-gen images).
  const panel0Dest = path.join(panelDir, `panel-${pad2(story.panels[0]!.index)}.png`);
  await renderPanelImage(story, 0, panel0Dest, opts.imagesDir, undefined, totals);
  const refForRest = opts.imagesDir ? undefined : panel0Dest;

  // Panels 1..N in parallel batches.
  await runChunked(story.panels.slice(1).map((_, i) => i + 1), 4, async (i) => {
    const dest = path.join(panelDir, `panel-${pad2(story.panels[i]!.index)}.png`);
    await renderPanelImage(story, i, dest, opts.imagesDir, refForRest, totals);
  });

  // TTS in parallel batches.
  const ttsResults = opts.skipTts
    ? []
    : await runChunked(story.panels.map((_, i) => i), 4, async (i) => {
        const dest = path.join(panelDir, `narration-${pad2(story.panels[i]!.index)}.mp3`);
        const ok = await renderPanelTts(story, i, dest, totals);
        return ok ? dest : null;
      });

  const panels: PanelAssets[] = story.panels.map((p, i) => {
    const ttsPath = ttsResults[i] ?? null;
    const hasTts = Boolean(ttsPath);
    return {
      index: p.index,
      kind: p.kind,
      imagePathAbs: path.join(panelDir, `panel-${pad2(p.index)}.png`),
      imagePathRel: `storyboard-v2/${story.dishSlug}/panel-${pad2(p.index)}.png`,
      audioPathAbs: hasTts ? path.join(panelDir, `narration-${pad2(p.index)}.mp3`) : undefined,
      audioPathRel: hasTts ? `storyboard-v2/${story.dishSlug}/narration-${pad2(p.index)}.mp3` : undefined,
      durationSec: p.durationSec,
      transition: p.transition,
      imageTextLabel: p.imageTextLabel,
      narrationVi: p.narrationVi,
      motionDirection: p.motionDirection,
      motionComplexity: p.motionComplexity,
    };
  });

  return { dishSlug: story.dishSlug, dishName: story.dishName, outputRoot: opts.outputRoot, panels, totals };
};
