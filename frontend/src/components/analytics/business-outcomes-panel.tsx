import { Clock, TrendingUp, AlertCircle } from 'lucide-react';
import { ErrorState } from '../ui/error-state';
import { EmptyState } from '../ui/empty-state';
import { MetricCard } from './metric-card';
import { RangeSelector } from './range-selector';
import { useAgentBusinessOutcomes } from '../../hooks/use-agent-business-outcomes';
import type { BusinessMetric, OutcomeRange } from '../../lib/types';

interface BusinessOutcomesPanelProps {
  agentInstanceId: string;
  range: OutcomeRange;
  onRangeChange: (range: OutcomeRange) => void;
}

function formatMetricValue(m: BusinessMetric): string {
  const v = Number.isInteger(m.value) ? m.value.toLocaleString() : m.value.toFixed(2);
  return m.suffix ? `${v}${m.suffix}` : v;
}

export function BusinessOutcomesPanel({ agentInstanceId, range, onRangeChange }: BusinessOutcomesPanelProps) {
  const q = useAgentBusinessOutcomes(agentInstanceId, range);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Business Outcomes</h2>
          <p className="text-xs text-gray-500">
            What this agent has produced. Aggregated from successful runs.
          </p>
        </div>
        <RangeSelector value={range} onChange={onRangeChange} />
      </div>

      {q.isError && (
        <ErrorState
          variant="inline"
          title="Failed to load outcomes"
          error={q.error}
          onRetry={() => q.refetch()}
          isRetrying={q.isFetching}
        />
      )}

      {q.data?.unsupported && (
        <EmptyState
          icon={AlertCircle}
          title="No outcome metrics defined"
          description={`Template "${q.data.template_id}" has no outcome extractor registered.`}
        />
      )}

      {q.data && !q.data.unsupported && q.data.execution_count === 0 && (
        <EmptyState
          icon={TrendingUp}
          title="No successful runs in this range"
          description="Run the agent or widen the time range to see outcomes."
        />
      )}

      {(q.isLoading || (q.data && !q.data.unsupported && q.data.execution_count > 0)) && (
        <>
          <HeadlineCard
            isLoading={q.isLoading}
            metric={q.data?.headline_metric ?? null}
            executionCount={q.data?.execution_count ?? 0}
            hoursSaved={q.data?.estimated_hours_saved ?? 0}
            basis={q.data?.estimated_basis ?? null}
          />

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              All metrics
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(q.data?.metrics ?? []).map((m) => (
                <MetricCard
                  key={m.key}
                  label={m.label}
                  value={formatMetricValue(m)}
                  isLoading={q.isLoading}
                />
              ))}
              {q.isLoading && (
                <>
                  <MetricCard isLoading label="—" value="—" />
                  <MetricCard isLoading label="—" value="—" />
                  <MetricCard isLoading label="—" value="—" />
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface HeadlineCardProps {
  isLoading: boolean;
  metric: BusinessMetric | null;
  executionCount: number;
  hoursSaved: number;
  basis: string | null;
}

function HeadlineCard({ isLoading, metric, executionCount, hoursSaved, basis }: HeadlineCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">
            {metric?.label ?? 'Headline metric'}
          </div>
          <div className={`mt-1 text-4xl font-bold tabular-nums text-emerald-700 ${isLoading ? 'animate-pulse' : ''}`}>
            {isLoading ? '—' : metric ? formatMetricValueRaw(metric) : '—'}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            From {executionCount} successful run{executionCount === 1 ? '' : 's'}
          </div>
        </div>

        <div className="flex flex-col items-end">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
            <Clock className="h-3.5 w-3.5" />
            Estimated time saved
          </div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums text-gray-900 ${isLoading ? 'animate-pulse' : ''}`}>
            {isLoading ? '—' : `${hoursSaved.toFixed(1)} hrs`}
          </div>
          {basis && !isLoading && (
            <div className="mt-1 max-w-[16rem] text-right text-[11px] italic text-gray-500">
              Estimated · {basis}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatMetricValueRaw(m: BusinessMetric): string {
  const v = Number.isInteger(m.value) ? m.value.toLocaleString() : m.value.toFixed(2);
  return m.suffix ? `${v}${m.suffix}` : v;
}
