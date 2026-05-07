import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { formatCost, formatDuration } from '../../lib/formatters';
import type { AnalyticsTopAgent } from '../../lib/types';

export interface TopAgentsListProps {
  agents: AnalyticsTopAgent[] | undefined;
  isLoading?: boolean;
  emptyHint?: string;
}

function successRateClass(rate: number): string {
  if (rate >= 90) return 'text-emerald-600';
  if (rate >= 70) return 'text-amber-600';
  return 'text-red-600';
}

export function TopAgentsList({
  agents,
  isLoading,
  emptyHint = 'No agents with executions yet.',
}: TopAgentsListProps) {
  if (isLoading) {
    return <div className="rounded-md border border-dashed border-gray-200 p-6 text-sm text-gray-500">Loading top agents…</div>;
  }
  if (!agents || agents.length === 0) {
    return <div className="rounded-md border border-dashed border-gray-200 p-6 text-sm text-gray-500">{emptyHint}</div>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-2.5">Agent</th>
            <th className="px-4 py-2.5">Template</th>
            <th className="px-4 py-2.5 text-right">Runs</th>
            <th className="px-4 py-2.5 text-right">Success rate</th>
            <th className="px-4 py-2.5 text-right">Avg duration</th>
            <th className="px-4 py-2.5 text-right">Cost</th>
            <th className="px-4 py-2.5 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {agents.map((a) => (
            <tr key={a.agent_instance_id} className="hover:bg-gray-50">
              <td className="px-4 py-2.5">
                <div className="font-medium text-gray-900">{a.name}</div>
              </td>
              <td className="px-4 py-2.5 text-gray-600">{a.template_id}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">{a.runs}</td>
              <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${successRateClass(a.success_rate)}`}>
                {a.success_rate.toFixed(2)}%
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{formatDuration(a.avg_duration_ms)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{formatCost(a.total_cost_usd)}</td>
              <td className="px-4 py-2.5 text-right">
                <Button asChild size="sm" variant="outline">
                  <Link to={`/agents/${a.agent_instance_id}`}>
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open
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
