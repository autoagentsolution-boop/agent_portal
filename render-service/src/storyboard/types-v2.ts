import type { MotionComplexity, Transition } from './schema-v2.ts';

export interface PanelAssets {
  index: number;
  kind: 'intro' | 'step' | 'outro';
  imagePathAbs: string;
  imagePathRel: string;
  audioPathAbs?: string;
  audioPathRel?: string;
  motionPathAbs?: string;
  motionPathRel?: string;
  durationSec: number;
  transition: Transition;
  imageTextLabel: { line1: string; line2: string | null; line3: string | null };
  narrationVi: string;
  motionDirection: string;
  motionComplexity?: MotionComplexity;
}

export interface AdapterTotals {
  imagesGenerated: number;
  imagesCached: number;
  imagesProvided: number;
  ttsGenerated: number;
  ttsCached: number;
  estCostUsd: number;
}

export interface AdapterResult {
  dishSlug: string;
  dishName: string;
  outputRoot: string;
  panels: PanelAssets[];
  totals: AdapterTotals;
}
