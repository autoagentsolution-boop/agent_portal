import { RefreshCw } from 'lucide-react';
import { Alert } from '../../components/ui/alert';
import { MetricCard } from '../../components/analytics/metric-card';
import { LatestFailuresList } from '../../components/analytics/latest-failures-list';
import { TopAgentsList } from '../../components/analytics/top-agents-list';
import { useAnalyticsSummary } from '../../hooks/use-analytics';
import { extractErrorMessage } from '../../lib/api-client';
import { formatCost, formatDuration } from '../../lib/formatters';

export function AnalyticsPage() {
  const summaryQ = useAnalyticsSummary();
  const s = summaryQ.data;
  const isLoading = summaryQ.isLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500">
            Operational health across all agents in this workspace. Auto-refreshes every 30s.
          </p>
        </div>
        {summaryQ.isFetching && !isLoading && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Refreshing
          </span>
        )}
      </div>

      {summaryQ.isError && (
        <Alert variant="destructive">
          <div className="font-semibold">Failed to load analytics</div>
          <div className="mt-0.5">{extractErrorMessage(summaryQ.error)}</div>
        </Alert>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Throughput</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard isLoading={isLoading} label="Total executions" value={s?.total_executions ?? 0} />
          <MetricCard
            isLoading={isLoading}
            label="Success rate"
            value={s ? `${s.success_rate.toFixed(2)}%` : '—'}
            variant={s && s.success_rate >= 90 ? 'success' : s && s.success_rate >= 70 ? 'warning' : 'danger'}
          />
          <MetricCard
            isLoading={isLoading}
            label="Avg duration"
            value={formatDuration(s?.avg_duration_ms ?? 0)}
          />
          <MetricCard
            isLoading={isLoading}
            label="Estimated cost"
            value={formatCost(s?.estimated_cost_usd ?? 0)}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Reliability</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            isLoading={isLoading}
            label="Failed executions"
            value={s?.failed_executions ?? 0}
            variant={(s?.failed_executions ?? 0) > 0 ? 'danger' : 'default'}
          />
          <MetricCard
            isLoading={isLoading}
            label="Active agents"
            value={`${s?.active_agents ?? 0} / ${s?.total_agents ?? 0}`}
            variant="info"
          />
          <MetricCard isLoading={isLoading} label="P95 duration" value={formatDuration(s?.p95_duration_ms ?? 0)} />
          <MetricCard
            isLoading={isLoading}
            label="Tokens (in / out)"
            value={
              s
                ? `${s.total_tokens_input.toLocaleString()} / ${s.total_tokens_output.toLocaleString()}`
                : '—'
            }
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Latest failures</h2>
        <LatestFailuresList failures={s?.latest_failures} isLoading={isLoading} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Top agents by execution count</h2>
        <TopAgentsList agents={s?.top_agents} isLoading={isLoading} />
      </section>
    </div>
  );
}
