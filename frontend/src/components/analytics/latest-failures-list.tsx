import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { formatDuration, formatRelativeShort, shortId } from '../../lib/formatters';
import type { AnalyticsLatestFailure } from '../../lib/types';

export interface LatestFailuresListProps {
  failures: AnalyticsLatestFailure[] | undefined;
  isLoading?: boolean;
  emptyHint?: string;
}

export function LatestFailuresList({
  failures,
  isLoading,
  emptyHint = 'No failures recorded yet.',
}: LatestFailuresListProps) {
  if (isLoading) {
    return <div className="rounded-md border border-dashed border-gray-200 p-6 text-sm text-gray-500">Loading failures…</div>;
  }
  if (!failures || failures.length === 0) {
    return <div className="rounded-md border border-dashed border-gray-200 p-6 text-sm text-gray-500">{emptyHint}</div>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-2.5">Agent</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Error</th>
            <th className="px-4 py-2.5">Duration</th>
            <th className="px-4 py-2.5">When</th>
            <th className="px-4 py-2.5 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {failures.map((f) => (
            <tr key={f.execution_id} className="hover:bg-gray-50">
              <td className="px-4 py-2.5">
                <div className="font-medium text-gray-900">{f.agent_name}</div>
                <div className="text-xs text-gray-500">{f.template_id}</div>
              </td>
              <td className="px-4 py-2.5">
                <span
                  className={
                    f.status === 'failed'
                      ? 'rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200'
                      : 'rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200'
                  }
                >
                  {f.status}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <div className="max-w-[28rem] truncate text-gray-700" title={f.error_message ?? ''}>
                  {f.error_message ?? '—'}
                </div>
                <div className="text-xs text-gray-400 font-mono">{shortId(f.execution_id, 12)}</div>
              </td>
              <td className="px-4 py-2.5 tabular-nums text-gray-700">{formatDuration(f.duration_ms)}</td>
              <td className="px-4 py-2.5 text-gray-500" title={f.finished_at ?? ''}>
                {formatRelativeShort(f.finished_at)}
              </td>
              <td className="px-4 py-2.5 text-right">
                <Button asChild size="sm" variant="outline">
                  <Link to={`/executions/${f.execution_id}`}>
                    <ExternalLink className="h-3.5 w-3.5" />
                    View
                  </Link>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
