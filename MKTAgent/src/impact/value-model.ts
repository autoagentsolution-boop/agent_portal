// Value model (Atria Phase 07) — turns the REAL metrics into the ROI story: cost SAVED vs a market
// baseline + time saved + an estimated reach. Every figure here is an ESTIMATE derived from the
// CONFIGURABLE baseline constants (env, workspace-tunable) and is LABELED as such — never presented
// as measured. The honesty rule: real numbers (metrics) and estimates (this) stay clearly separated.
import { env } from '../config/env.ts';
import { creditsFromUsd } from '../cost/credits.ts';
import type { ImpactMetrics } from './impact-metrics.ts';

export interface ValueEstimate {
  estimated: true; // marker: everything in here is an estimate, not a measurement
  baselineUsd: number; // what an agency would have charged (day-rate × equivalent human days)
  freelancerUsd: number; // alternative baseline: a freelancer per-post rate
  baselineDays: number; // equivalent human work-days
  savedUsd: number; // baseline − real spend (never negative)
  savedDays: number; // human days the user didn't spend
  estimatedReach: number; // reach heuristic (LABELED estimate; real reach needs Insights → v2)
  assumptions: {
    agencyDayRateUsd: number;
    hoursPerPost: number;
    workHoursPerDay: number;
    freelancerPerPostUsd: number;
    reachPerPost: number;
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function estimateValue(metrics: ImpactMetrics): ValueEstimate {
  const posts = metrics.postsPublished;
  const a = {
    agencyDayRateUsd: env.IMPACT_AGENCY_DAY_RATE_USD,
    hoursPerPost: env.IMPACT_HOURS_PER_POST,
    workHoursPerDay: env.IMPACT_WORK_HOURS_PER_DAY,
    freelancerPerPostUsd: env.IMPACT_FREELANCER_PER_POST_USD,
    reachPerPost: env.IMPACT_REACH_PER_POST,
  };

  const humanHours = posts * a.hoursPerPost;
  const baselineDays = a.workHoursPerDay > 0 ? humanHours / a.workHoursPerDay : 0;
  const baselineUsd = baselineDays * a.agencyDayRateUsd;
  const freelancerUsd = posts * a.freelancerPerPostUsd;

  return {
    estimated: true,
    baselineUsd: round2(baselineUsd),
    freelancerUsd: round2(freelancerUsd),
    baselineDays: round2(baselineDays),
    savedUsd: round2(Math.max(0, baselineUsd - metrics.usdSpent)),
    savedDays: round2(baselineDays), // Atria's own wall-clock is negligible vs human days
    estimatedReach: Math.round(posts * a.reachPerPost),
    assumptions: {
      agencyDayRateUsd: a.agencyDayRateUsd,
      hoursPerPost: a.hoursPerPost,
      workHoursPerDay: a.workHoursPerDay,
      freelancerPerPostUsd: a.freelancerPerPostUsd,
      reachPerPost: a.reachPerPost,
    },
  };
}

export interface ImpactReport {
  scope: 'campaign' | 'period';
  metrics: ImpactMetrics; // REAL
  value: ValueEstimate; // ESTIMATED (labeled)
  headline: string; // the money shot
  creditsSpent: number;
}

// The one-line proof: "$X spent (≈N credits) vs ~$Y / Z days with an agency".
export function buildImpactReport(scope: 'campaign' | 'period', metrics: ImpactMetrics): ImpactReport {
  const value = estimateValue(metrics);
  // Prefer MEASURED social Insights (P2-2b: FB + IG): reach if a platform exposes it, else measured
  // engagement; fall back to the labeled reach estimate only when NO platform measured anything.
  const ABBR: Record<string, string> = { facebook: 'FB', instagram: 'IG', threads: 'TH', linkedin: 'LI', x: 'X' };
  const src = metrics.insightsPlatforms.length ? metrics.insightsPlatforms.map((p) => ABBR[p] ?? p.toUpperCase()).join('+') : 'measured';
  const reachPhrase =
    metrics.measuredReach !== null
      ? `${metrics.measuredReach.toLocaleString()} reach (measured, ${src})`
      : metrics.measuredEngaged !== null
        ? `${metrics.measuredEngaged.toLocaleString()} engagements (measured, ${src})`
        : `~${value.estimatedReach.toLocaleString()} est. reach`;
  const headline =
    `$${round2(metrics.usdSpent)} spent (≈${metrics.creditsSpent} credits) vs an estimated ~$${value.baselineUsd} / ${value.baselineDays} days with an agency — ` +
    `${metrics.postsPublished} posts across ${metrics.platforms.length} platform${metrics.platforms.length === 1 ? '' : 's'}, ${metrics.leadsCaptured} leads, ${reachPhrase}.`;
  return { scope, metrics, value, headline, creditsSpent: metrics.creditsSpent };
}

// Convenience for the UI: also expose the campaign spend as credits (already on metrics).
export { creditsFromUsd };
