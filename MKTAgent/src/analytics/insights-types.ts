// Shared shape for per-platform post Insights that feed the Impact report (Atria v2 P2-2b + IG).
// Each platform adapter (fb-insights, ig-insights) returns an InsightsSum; mergeInsights combines
// them per-field, NULL-aware: a field stays null only when NO platform measured it, so Impact keeps
// its labeled estimate for that field rather than showing a false 0.
export interface InsightsSum {
  measuredReach: number | null;
  measuredImpressions: number | null;
  measuredEngaged: number | null;
  postsMeasured: number;   // posts (any platform) that returned at least one measured field
  platforms: string[];     // which platforms actually contributed measured data (e.g. ['facebook','instagram'])
}

export const emptySum = (): InsightsSum => ({
  measuredReach: null, measuredImpressions: null, measuredEngaged: null, postsMeasured: 0, platforms: [],
});

// null + null = null; otherwise sum the non-null operands (treat null as 0).
const addNullable = (a: number | null, b: number | null): number | null =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0);

export const mergeInsights = (sums: InsightsSum[]): InsightsSum =>
  sums.reduce<InsightsSum>((acc, s) => ({
    measuredReach: addNullable(acc.measuredReach, s.measuredReach),
    measuredImpressions: addNullable(acc.measuredImpressions, s.measuredImpressions),
    measuredEngaged: addNullable(acc.measuredEngaged, s.measuredEngaged),
    postsMeasured: acc.postsMeasured + s.postsMeasured,
    platforms: [...new Set([...acc.platforms, ...s.platforms])],
  }), emptySum());
