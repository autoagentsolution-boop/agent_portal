import type { ExecutionRow as ExecutionRowData } from '../../lib/types';
import { Skeleton } from '../ui/skeleton';
import { Alert } from '../ui/alert';
import { extractErrorMessage } from '../../lib/api-client';
import { ExecutionRow } from './execution-row';

export interface ExecutionListProps {
  executions: ExecutionRowData[] | undefined;
  isLoading: boolean;
  error: unknown;
  showAgent?: boolean;
  emptyHint?: string;
}

export function ExecutionList({
  executions,
  isLoading,
  error,
  showAgent = false,
  emptyHint = 'No executions yet.',
}: ExecutionListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">{extractErrorMessage(error, 'Failed to load executions')}</Alert>
    );
  }

  if (!executions || executions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
        <p className="text-sm text-gray-500">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
            <th className="px-3 py-2">Status</th>
            {showAgent && <th className="px-3 py-2">Agent</th>}
            <th className="px-3 py-2">Trigger</th>
            <th className="px-3 py-2">Started</th>
            <th className="px-3 py-2">Duration</th>
            <th className="px-3 py-2">Tokens</th>
            <th className="px-3 py-2">Cost</th>
            <th className="px-3 py-2 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {executions.map((e) => (
            <ExecutionRow key={e.id} execution={e} showAgent={showAgent} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
