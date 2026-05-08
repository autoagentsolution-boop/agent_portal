import { useMemo, useState, type ReactNode } from 'react';
import { ExecutionList } from '../../components/executions/execution-list';
import { useExecutions } from '../../hooks/use-executions';
import { useAgents } from '../../hooks/use-agents';
import { useDocumentTitle } from '../../hooks/use-document-title';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import type { ExecutionStatus } from '../../lib/types';

const STATUS_OPTIONS: Array<{ value: '' | ExecutionStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'running', label: 'Running' },
  { value: 'success', label: 'Success' },
  { value: 'warning', label: 'Warning' },
  { value: 'failed', label: 'Failed' },
];

export function ExecutionsPage() {
  useDocumentTitle('Executions');
  const [status, setStatus] = useState<'' | ExecutionStatus>('');
  const [agentId, setAgentId] = useState<string>('');

  const agentsQ = useAgents();
  const executionsQ = useExecutions({
    ...(status && { status }),
    ...(agentId && { agent_instance_id: agentId }),
    limit: 100,
  });

  const agentOptions = useMemo(
    () => [{ id: '', name: 'All agents' }, ...(agentsQ.data ?? [])],
    [agentsQ.data],
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Executions</h1>
        <p className="text-sm text-gray-500">All recent runs across the workspace.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <FilterField label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as '' | ExecutionStatus)}
              className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus:border-gray-400 focus:outline-none"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Agent">
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus:border-gray-400 focus:outline-none"
              disabled={agentsQ.isLoading}
            >
              {agentOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </FilterField>
        </CardContent>
      </Card>

      <ExecutionList
        executions={executionsQ.data}
        isLoading={executionsQ.isLoading}
        error={executionsQ.error}
        showAgent
        emptyHint="No executions match the current filters."
        onRetry={() => executionsQ.refetch()}
        isRetrying={executionsQ.isFetching}
      />
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
      {children}
    </label>
  );
}
