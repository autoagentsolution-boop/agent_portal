import { Link } from 'react-router-dom';
import type { ExecutionRow as ExecutionRowData } from '../../lib/types';
import {
  formatCost,
  formatDuration,
  formatRelativeShort,
  shortId,
} from '../../lib/formatters';
import { ExecutionStatusBadge } from './execution-status-badge';

export interface ExecutionRowProps {
  execution: ExecutionRowData;
  showAgent?: boolean;
}

export function ExecutionRow({ execution, showAgent = false }: ExecutionRowProps) {
  const tokens = execution.tokensInput + execution.tokensOutput;
  return (
    <tr className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
      <td className="px-3 py-2.5">
        <ExecutionStatusBadge status={execution.status} />
      </td>
      {showAgent && (
        <td className="px-3 py-2.5 text-sm text-gray-700">
          {execution.agentInstance?.name ?? '—'}
        </td>
      )}
      <td className="px-3 py-2.5 text-sm text-gray-600">{execution.triggerType}</td>
      <td
        className="px-3 py-2.5 text-sm text-gray-600 whitespace-nowrap"
        title={execution.startedAt ?? execution.createdAt}
      >
        {formatRelativeShort(execution.startedAt ?? execution.createdAt)}
      </td>
      <td className="px-3 py-2.5 text-sm text-gray-700 tabular-nums">
        {formatDuration(execution.durationMs)}
      </td>
      <td className="px-3 py-2.5 text-sm text-gray-600 tabular-nums">
        {tokens > 0 ? tokens.toLocaleString() : '—'}
      </td>
      <td className="px-3 py-2.5 text-sm text-gray-700 tabular-nums">
        {formatCost(execution.estimatedCostUsd)}
      </td>
      <td className="px-3 py-2.5 text-right">
        <Link
          to={`/executions/${execution.id}`}
          className="text-xs font-medium text-gray-700 hover:text-gray-900 hover:underline"
        >
          View · {shortId(execution.id, 6)}
        </Link>
      </td>
    </tr>
  );
}
