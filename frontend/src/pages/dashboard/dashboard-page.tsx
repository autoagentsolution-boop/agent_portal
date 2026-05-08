import { Link } from 'react-router-dom';
import { ArrowRight, Bot, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { RowSkeleton } from '../../components/ui/loading-skeleton';
import { MetricCard } from '../../components/analytics/metric-card';
import { LatestFailuresList } from '../../components/analytics/latest-failures-list';
import { useAnalyticsSummary } from '../../hooks/use-analytics';
import { useExecutions } from '../../hooks/use-executions';
import { useDocumentTitle } from '../../hooks/use-document-title';
import { formatDuration, formatRelativeShort } from '../../lib/formatters';
import type { ExecutionRow, ExecutionStatus } from '../../lib/types';

const STATUS_PILL: Record<ExecutionStatus, string> = {
  queued: 'bg-gray-100 text-gray-700 ring-gray-200',
  running: 'bg-sky-50 text-sky-700 ring-sky-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  failed: 'bg-red-50 text-red-700 ring-red-200',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200',
  cancelled: 'bg-gray-100 text-gray-500 ring-gray-200',
};

export function DashboardPage() {
  useDocumentTitle('Dashboard');
  const summaryQ = useAnalyticsSummary();
  const recentQ = useExecutions({ limit: 10 });
  const s = summaryQ.data;
  const isLoading = summaryQ.isLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">
            Workspace health at a glance. Auto-refreshes every 30s.
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
        <ErrorState
          variant="inline"
          title="Failed to load summary"
          error={summaryQ.error}
          onRetry={() => summaryQ.refetch()}
          isRetrying={summaryQ.isFetching}
        />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          isLoading={isLoading}
          label="Active agents"
          value={`${s?.active_agents ?? 0} / ${s?.total_agents ?? 0}`}
          variant="info"
        />
        <MetricCard isLoading={isLoading} label="Total executions" value={s?.total_executions ?? 0} />
        <MetricCard
          isLoading={isLoading}
          label="Success rate"
          value={s ? `${s.success_rate.toFixed(2)}%` : '—'}
          variant={s && s.success_rate >= 90 ? 'success' : s && s.success_rate >= 70 ? 'warning' : 'danger'}
        />
        <MetricCard
          isLoading={isLoading}
          label="Failed"
          value={s?.failed_executions ?? 0}
          variant={(s?.failed_executions ?? 0) > 0 ? 'danger' : 'default'}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Latest errors</h2>
            <Button asChild size="sm" variant="ghost">
              <Link to="/analytics">
                View analytics
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          <LatestFailuresList
            failures={s?.latest_failures}
            isLoading={isLoading}
            emptyHint="No failures recorded. Nice."
          />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Recent executions</h2>
            <Button asChild size="sm" variant="ghost">
              <Link to="/executions">
                All executions
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          <RecentExecutions executions={recentQ.data} isLoading={recentQ.isLoading} />
        </section>
      </div>
    </div>
  );
}

interface RecentExecutionsProps {
  executions: ExecutionRow[] | undefined;
  isLoading?: boolean;
}

function RecentExecutions({ executions, isLoading }: RecentExecutionsProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <RowSkeleton key={i} height="h-11" />
        ))}
      </div>
    );
  }
  if (!executions || executions.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        title="No executions yet"
        description="Run an agent to see results land here."
      />
    );
  }

  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
      {executions.map((e) => (
        <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_PILL[e.status] ?? STATUS_PILL.queued}`}
          >
            {e.status}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-gray-900">{e.agentInstance?.name ?? '—'}</div>
            <div className="text-xs text-gray-500">
              {e.template?.name ?? e.templateId} · {e.triggerType}
            </div>
          </div>
          <div className="hidden text-right sm:block">
            <div className="text-sm tabular-nums text-gray-700">{formatDuration(e.durationMs)}</div>
            <div className="text-xs text-gray-500" title={e.startedAt ?? e.createdAt}>
              {formatRelativeShort(e.startedAt ?? e.createdAt)}
            </div>
          </div>
          <Link to={`/executions/${e.id}`} className="shrink-0 text-sm font-medium text-sky-600 hover:underline">
            View
          </Link>
        </li>
      ))}
    </ul>
  );
}
