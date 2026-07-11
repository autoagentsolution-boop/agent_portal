// Workspace metrics for the Atria brain's get_workspace_data tool. Aggregates the user's REAL Impact
// numbers for a period parsed from their message. NO LLM here on purpose: the brain voices the numbers
// itself in its final reply, so voicing them a second time here would double the Gemini calls per
// data-query (the old direct path did the voicing; the brain path makes it redundant). Pure + cheap.
import { metricsForPeriod } from '../../impact/impact-metrics.ts';
import { buildImpactReport, type ImpactReport } from '../../impact/value-model.ts';

export interface WorkspaceMetrics {
  report: ImpactReport; // the structured, measured/labeled report — the brain reads .metrics + .value
  periodLabel: string; // human label for the lookback window ("the last 30 days")
}

// Map words in the message to a lookback window. Default 30 days (the Impact page default).
const periodFromMessage = (msg: string): { since: Date; label: string } => {
  const t = msg.toLowerCase();
  const now = Date.now();
  if (/\b(today|hôm nay|to ?day)\b/.test(t)) return { since: new Date(now - 86_400_000), label: 'today' };
  if (/\b(this week|tuần này|7\s*(day|ngày)|last week|tuần (trước|qua))\b/.test(t)) return { since: new Date(now - 7 * 86_400_000), label: 'the last 7 days' };
  if (/\b(quarter|90\s*(day|ngày)|3 (month|tháng)|quý)\b/.test(t)) return { since: new Date(now - 90 * 86_400_000), label: 'the last 90 days' };
  if (/\b(all time|tất cả|toàn bộ|từ trước( đến nay)?|overall|to date)\b/.test(t)) return { since: new Date(0), label: 'all time' };
  return { since: new Date(now - 30 * 86_400_000), label: 'the last 30 days' };
};

// Aggregate the REAL metrics for the period named in the message. No LLM — the caller (Atria brain)
// phrases the answer. Never invents numbers: buildImpactReport labels measured vs estimated.
export async function workspaceMetrics(ownerId: string, message: string): Promise<WorkspaceMetrics> {
  const { since, label } = periodFromMessage(message);
  const metrics = await metricsForPeriod(ownerId, since);
  const report = buildImpactReport('period', metrics);
  return { report, periodLabel: label };
}
