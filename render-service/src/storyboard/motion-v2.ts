import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../logger.ts';
import { generateStoryboardClips, type ClipSpec } from '../jobs/gen-storyboard-clips.ts';
import type { AdapterResult, PanelAssets } from './types-v2.ts';

const VEO_LITE_COST = 0.05;
const VEO_MAX_DURATION_SEC = 8;
// Veo 3.1 lite/fast preview accepts ONLY discrete durations {4, 6, 8} despite the public
// "4..8 inclusive" docs. Submitting 5 or 7 fails with INVALID_ARGUMENT at predictLongRunning.
// Snap up so narration is never truncated.
const VEO_ALLOWED_DURATIONS = [4, 6, 8] as const;
const snapVeoDuration = (sec: number): number => {
  const n = Math.max(1, Math.round(sec));
  for (const allowed of VEO_ALLOWED_DURATIONS) {
    if (n <= allowed) return allowed;
  }
  return VEO_MAX_DURATION_SEC;
};

export interface MotionOptions {
  outputRoot: string;
  dryRun?: boolean;
  costCapUsd?: number;
}

export interface MotionTotals {
  clipsGenerated: number;
  clipsCached: number;
  estCostUsd: number;
}

export interface MotionResult {
  panels: PanelAssets[];
  totals: MotionTotals;
}

const pad2 = (n: number): string => n.toString().padStart(2, '0');

const ensureDir = async (p: string): Promise<void> => {
  await mkdir(p, { recursive: true });
};

const fileExists = async (p: string): Promise<boolean> => {
  try {
    const s = await stat(p);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
};

const copyToTarget = async (src: string, dst: string): Promise<void> => {
  await ensureDir(path.dirname(dst));
  await copyFile(src, dst);
};

const buildClipSpec = (panel: PanelAssets, dishSlug: string): ClipSpec => ({
  id: `${dishSlug}-panel-${pad2(panel.index)}`,
  startImagePath: panel.imagePathAbs,
  prompt: panel.motionDirection,
  durationSec: snapVeoDuration(panel.durationSec),
});

const planDryRun = (adapter: AdapterResult, opts: MotionOptions): MotionResult => {
  const estCostUsd = adapter.panels.length * VEO_LITE_COST;
  for (const p of adapter.panels) {
    logger.info('motion_dry_run_plan', {
      idx: p.index,
      durationSec: snapVeoDuration(p.durationSec),
      prompt: p.motionDirection.slice(0, 80) + (p.motionDirection.length > 80 ? '…' : ''),
    });
  }
  logger.info('motion_dry_run_summary', {
    panels: adapter.panels.length,
    estCostUsd,
    capUsd: opts.costCapUsd ?? null,
  });
  return {
    panels: adapter.panels,
    totals: { clipsGenerated: 0, clipsCached: 0, estCostUsd: 0 },
  };
};

export const generatePanelMotion = async (
  adapter: AdapterResult,
  opts: MotionOptions,
): Promise<MotionResult> => {
  if (opts.dryRun) return planDryRun(adapter, opts);

  const estCostUsd = adapter.panels.length * VEO_LITE_COST;
  const cap = opts.costCapUsd ?? Number(process.env.COST_CAP_USD ?? '');
  if (Number.isFinite(cap) && cap > 0 && estCostUsd > cap) {
    throw new Error(
      `motion_cost_cap_exceeded: est $${estCostUsd.toFixed(2)} > cap $${cap.toFixed(2)} ` +
        `(${adapter.panels.length} panels × $${VEO_LITE_COST})`,
    );
  }

  const motionDir = path.resolve(opts.outputRoot, 'storyboard-v2', adapter.dishSlug);
  await ensureDir(motionDir);

  const specs = adapter.panels.map((p) => buildClipSpec(p, adapter.dishSlug));
  for (const p of adapter.panels) {
    if (!(await fileExists(p.imagePathAbs))) {
      throw new Error(`motion_missing_panel_image: ${p.imagePathAbs}`);
    }
  }

  logger.info('motion_clips_start', { count: specs.length, estCostUsd });
  const results = await generateStoryboardClips(specs);

  const totals: MotionTotals = { clipsGenerated: 0, clipsCached: 0, estCostUsd: 0 };
  const merged: PanelAssets[] = await Promise.all(
    adapter.panels.map(async (p, i) => {
      const r = results[i]!;
      const motionRel = `storyboard-v2/${adapter.dishSlug}/motion-${pad2(p.index)}.mp4`;
      const motionAbs = path.join(motionDir, `motion-${pad2(p.index)}.mp4`);
      await copyToTarget(r.cachePath, motionAbs);
      if (r.cached) totals.clipsCached += 1;
      else {
        totals.clipsGenerated += 1;
        totals.estCostUsd += VEO_LITE_COST;
      }
      return { ...p, motionPathAbs: motionAbs, motionPathRel: motionRel };
    }),
  );

  logger.info('motion_clips_done', { ...totals });
  return { panels: merged, totals };
};
