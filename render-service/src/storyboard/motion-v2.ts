import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../logger.ts';
import { generateStoryboardClips, type ClipSpec } from '../jobs/gen-storyboard-clips.ts';
import { getVideoBackend, type VideoBackend } from '../jobs/video-backends.ts';
import type { AdapterResult, PanelAssets } from './types-v2.ts';

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

// Pick which Veo tier the panel ships on. Only meaningful when backend.name === 'veo';
// Kling backends ignore modelHint. intro/outro panels FORCED to Lite — they're always simple
// fades/holds and routing them to Fast burns the more constrained Fast RPD bucket needlessly.
const pickModelHint = (panel: PanelAssets, backend: VideoBackend): 'lite' | 'fast' | undefined => {
  if (backend.name !== 'veo') return undefined;
  if (panel.kind === 'intro' || panel.kind === 'outro') return 'lite';
  return panel.motionComplexity === 'complex' ? 'fast' : 'lite';
};

const buildClipSpec = (panel: PanelAssets, dishSlug: string, backend: VideoBackend): ClipSpec => ({
  id: `${dishSlug}-panel-${pad2(panel.index)}`,
  startImagePath: panel.imagePathAbs,
  prompt: panel.motionDirection,
  durationSec: backend.snapDuration(panel.durationSec),
  modelHint: pickModelHint(panel, backend),
});

const sumEstCost = (adapter: AdapterResult, backend: VideoBackend): number =>
  adapter.panels.reduce((acc, p) => acc + backend.computeCostUsd(p.durationSec, pickModelHint(p, backend)), 0);

const planDryRun = (adapter: AdapterResult, opts: MotionOptions, backend: VideoBackend): MotionResult => {
  const estCostUsd = sumEstCost(adapter, backend);
  for (const p of adapter.panels) {
    logger.info('motion_dry_run_plan', {
      provider: backend.name,
      idx: p.index,
      kind: p.kind,
      modelHint: pickModelHint(p, backend) ?? 'auto',
      durationSec: backend.snapDuration(p.durationSec),
      estCostUsd: backend.computeCostUsd(p.durationSec, pickModelHint(p, backend)),
      prompt: p.motionDirection.slice(0, 80) + (p.motionDirection.length > 80 ? '…' : ''),
    });
  }
  logger.info('motion_dry_run_summary', {
    provider: backend.name,
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
  const backend = getVideoBackend();
  if (opts.dryRun) return planDryRun(adapter, opts, backend);

  const estCostUsd = sumEstCost(adapter, backend);
  const cap = opts.costCapUsd ?? Number(process.env.COST_CAP_USD ?? '');
  if (Number.isFinite(cap) && cap > 0 && estCostUsd > cap) {
    throw new Error(
      `motion_cost_cap_exceeded: provider=${backend.name} est $${estCostUsd.toFixed(2)} > cap $${cap.toFixed(2)} ` +
        `(${adapter.panels.length} panels, see per-panel estCostUsd in dry-run for breakdown)`,
    );
  }

  const motionDir = path.resolve(opts.outputRoot, 'storyboard-v2', adapter.dishSlug);
  await ensureDir(motionDir);

  const specs = adapter.panels.map((p) => buildClipSpec(p, adapter.dishSlug, backend));
  for (const p of adapter.panels) {
    if (!(await fileExists(p.imagePathAbs))) {
      throw new Error(`motion_missing_panel_image: ${p.imagePathAbs}`);
    }
  }

  logger.info('motion_clips_start', { provider: backend.name, count: specs.length, estCostUsd });
  const results = await generateStoryboardClips(specs, backend);

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
        totals.estCostUsd += backend.computeCostUsd(p.durationSec, pickModelHint(p, backend));
      }
      return { ...p, motionPathAbs: motionAbs, motionPathRel: motionRel };
    }),
  );

  logger.info('motion_clips_done', { provider: backend.name, ...totals });
  return { panels: merged, totals };
};
