import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Play, Pause, PlayCircle, Archive } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { ErrorState } from '../../components/ui/error-state';
import { ExecutionList } from '../../components/executions/execution-list';
import { BusinessOutcomesPanel } from '../../components/analytics/business-outcomes-panel';
import { RunAgentModal } from '../../components/agents/run-agent-modal';
import {
  useAgent,
  useArchiveAgent,
  useRunAgent,
  useUpdateAgentStatus,
} from '../../hooks/use-agents';
import { useExecutions } from '../../hooks/use-executions';
import { useDocumentTitle } from '../../hooks/use-document-title';
import { extractErrorMessage } from '../../lib/api-client';
import type { AgentInstanceStatus, OutcomeRange } from '../../lib/types';
import { formatDateTime } from '../../lib/formatters';

const STATUS_VARIANT: Record<AgentInstanceStatus, 'success' | 'warning' | 'danger' | 'default' | 'muted'> = {
  running: 'success',
  paused: 'warning',
  error: 'danger',
  draft: 'default',
  archived: 'muted',
};

const RUNNABLE: ReadonlySet<AgentInstanceStatus> = new Set(['draft', 'running', 'paused']);

export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const agentQ = useAgent(id);
  const executionsQ = useExecutions({ agent_instance_id: id, limit: 50 });
  const [outcomeRange, setOutcomeRange] = useState<OutcomeRange>('7d');
  const [runModalOpen, setRunModalOpen] = useState(false);
  const runMutation = useRunAgent();
  const statusMutation = useUpdateAgentStatus();
  const archiveMutation = useArchiveAgent();

  useDocumentTitle(agentQ.data?.name ?? 'Agent');

  useEffect(() => {
    if (searchParams.get('run') === '1' && agentQ.data) {
      setRunModalOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('run');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, agentQ.data]);

  if (agentQ.isLoading && !agentQ.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (agentQ.error) {
    return (
      <ErrorState
        title="Failed to load agent"
        error={agentQ.error}
        onRetry={() => agentQ.refetch()}
        isRetrying={agentQ.isFetching}
      />
    );
  }

  const agent = agentQ.data;
  if (!agent) return <ErrorState title="Agent not found" />;

  async function onRunWithOverrides(overrides: Record<string, unknown>) {
    if (!agent) return;
    const result = await runMutation.mutateAsync({ id: agent.id, overrides });
    setRunModalOpen(false);
    navigate(`/executions/${result.execution_id}`);
  }

  async function onTransition(next: AgentInstanceStatus) {
    if (!agent) return;
    try {
      await statusMutation.mutateAsync({ id: agent.id, status: next });
    } catch (err) {
      window.alert(extractErrorMessage(err, 'Status change failed'));
    }
  }

  async function onArchive() {
    if (!agent) return;
    if (!window.confirm(`Archive "${agent.name}"? It can no longer run.`)) return;
    try {
      await archiveMutation.mutateAsync(agent.id);
      navigate('/agents');
    } catch (err) {
      window.alert(extractErrorMessage(err, 'Archive failed'));
    }
  }

  const canRun = RUNNABLE.has(agent.status);
  const latestOverride =
    executionsQ.data?.find((e) => e.configOverrideJson && Object.keys(e.configOverrideJson).length > 0)
      ?.configOverrideJson ?? null;
  const canPause = agent.status === 'running';
  const canResume = agent.status === 'paused';
  const canArchive = agent.status !== 'archived';
  const config = (agent.configJson ?? {}) as Record<string, unknown>;
  const integrations = agent.integrations ?? [];
  const templateName = agent.template?.name ?? agent.templateId;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/agents')}>
            <ArrowLeft className="h-4 w-4" />
            All agents
          </Button>
          <h1 className="text-xl font-semibold text-gray-900">{agent.name}</h1>
          <Badge variant={STATUS_VARIANT[agent.status]}>{agent.status}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {canPause && (
            <Button variant="outline" size="sm" onClick={() => onTransition('paused')} disabled={statusMutation.isPending}>
              <Pause className="h-3.5 w-3.5" />
              Pause
            </Button>
          )}
          {canResume && (
            <Button variant="outline" size="sm" onClick={() => onTransition('running')} disabled={statusMutation.isPending}>
              <PlayCircle className="h-3.5 w-3.5" />
              Resume
            </Button>
          )}
          {canArchive && (
            <Button variant="ghost" size="sm" onClick={onArchive} disabled={archiveMutation.isPending}>
              <Archive className="h-3.5 w-3.5" />
              Archive
            </Button>
          )}
          {canRun && (
            <Button size="sm" onClick={() => setRunModalOpen(true)} disabled={runMutation.isPending}>
              <Play className="h-3.5 w-3.5" />
              {runMutation.isPending ? 'Starting…' : 'Run Now'}
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="outcomes">
        <TabsList>
          <TabsTrigger value="outcomes">Outcomes</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="executions">
            Executions{executionsQ.data ? ` (${executionsQ.data.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="outcomes">
          <Card>
            <CardContent className="p-5">
              <BusinessOutcomesPanel
                agentInstanceId={agent.id}
                range={outcomeRange}
                onRangeChange={setOutcomeRange}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="overview">
          <Card>
            <CardContent className="p-5 grid gap-4 md:grid-cols-2">
              <Field label="Template" value={templateName} />
              <Field label="Trigger mode" value={agent.triggerMode} />
              <Field label="Created" value={formatDateTime(agent.createdAt)} />
              <Field label="Updated" value={formatDateTime(agent.updatedAt)} />
              <div className="md:col-span-2">
                <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Integrations</div>
                {integrations.length === 0 ? (
                  <p className="text-sm text-gray-500">None configured.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {integrations.map((ai) => (
                      <Badge key={ai.integrationId} variant="muted">
                        {ai.integration.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(config).length === 0 ? (
                <p className="text-sm text-gray-500">No configuration recorded.</p>
              ) : (
                <dl className="grid gap-x-4 gap-y-2 md:grid-cols-2">
                  {Object.entries(config).map(([k, v]) => (
                    <div key={k} className="flex flex-col">
                      <dt className="text-xs uppercase tracking-wide text-gray-500">{k}</dt>
                      <dd className="text-sm text-gray-800 break-all">
                        {typeof v === 'string' ? v : JSON.stringify(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-xs text-gray-500">
                  Saved defaults are read-only. Override parameters per run without changing these defaults.
                </p>
                {canRun && (
                  <Button size="sm" variant="outline" onClick={() => setRunModalOpen(true)} disabled={runMutation.isPending}>
                    <Play className="h-3.5 w-3.5" />
                    Run with overrides
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="executions">
          <ExecutionList
            executions={executionsQ.data}
            isLoading={executionsQ.isLoading}
            error={executionsQ.error}
            emptyHint="This agent has no executions yet. Click Run Now to fire one."
            onRetry={() => executionsQ.refetch()}
            isRetrying={executionsQ.isFetching}
          />
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardContent className="p-6 text-sm text-gray-500">
              Notifications stream wires up in Phase 10.
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <RunAgentModal
        open={runModalOpen}
        agentName={agent.name}
        agentConfig={config}
        templateSchema={agent.template?.configSchemaJson ?? {}}
        overridableFields={agent.template?.overridableFieldsJson ?? []}
        defaultOverrides={latestOverride}
        isSubmitting={runMutation.isPending}
        onClose={() => setRunModalOpen(false)}
        onSubmit={onRunWithOverrides}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}
