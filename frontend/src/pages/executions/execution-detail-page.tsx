import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Bot, Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Alert } from '../../components/ui/alert';
import { ExecutionStatusBadge, isTerminal } from '../../components/executions/execution-status-badge';
import { ExecutionOutputViewer } from '../../components/executions/execution-output-viewer';
import { useExecution } from '../../hooks/use-execution';
import { useRetryExecution } from '../../hooks/use-executions';
import { extractErrorMessage } from '../../lib/api-client';
import {
  formatCost,
  formatDateTime,
  formatDuration,
  shortId,
} from '../../lib/formatters';

export function ExecutionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const retry = useRetryExecution();

  const { data, isLoading, error } = useExecution(id, { poll: true });

  async function onRetry() {
    if (!id) return;
    try {
      const res = await retry.mutateAsync(id);
      navigate(`/executions/${res.execution_id}`);
    } catch (err) {
      window.alert(extractErrorMessage(err, 'Retry failed'));
    }
  }

  if (isLoading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error) {
    return <Alert variant="destructive">{extractErrorMessage(error, 'Failed to load execution')}</Alert>;
  }

  if (!data) {
    return <Alert variant="destructive">Execution not found.</Alert>;
  }

  const agentName = data.agentInstance?.name ?? '—';
  const templateName =
    data.agentInstance?.template?.name ?? data.template?.name ?? data.templateId;
  const running = !isTerminal(data.status);
  const showRetry = data.status === 'failed' || data.status === 'warning';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <ExecutionStatusBadge status={data.status} />
          <h1 className="text-xl font-semibold text-gray-900">
            {agentName}
            <span className="text-gray-400 font-normal"> · {templateName}</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {data.agentInstanceId && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/agents/${data.agentInstanceId}`}>
                <Bot className="h-3.5 w-3.5" />
                View Agent
              </Link>
            </Button>
          )}
          {showRetry && (
            <Button size="sm" onClick={onRetry} disabled={retry.isPending}>
              <RefreshCw className={`h-3.5 w-3.5 ${retry.isPending ? 'animate-spin' : ''}`} />
              {retry.isPending ? 'Retrying…' : 'Retry'}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
          <Metric label="Started" value={formatDateTime(data.startedAt)} />
          <Metric label="Finished" value={formatDateTime(data.finishedAt)} />
          <Metric label="Duration" value={formatDuration(data.durationMs)} />
          <Metric label="Trigger" value={data.triggerType} />
          <Metric label="Tokens in" value={data.tokensInput.toLocaleString()} />
          <Metric label="Tokens out" value={data.tokensOutput.toLocaleString()} />
          <Metric label="Cost" value={formatCost(data.estimatedCostUsd)} />
          <Metric label="Execution ID" value={shortId(data.id, 12)} title={data.id} />
        </CardContent>
      </Card>

      {data.resultSummary && (
        <Card>
          <CardHeader>
            <CardTitle>Result summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-700">{data.resultSummary}</p>
          </CardContent>
        </Card>
      )}

      {data.errorMessage && (data.status === 'failed' || data.status === 'warning') && (
        <Alert variant="destructive">
          <div className="font-medium mb-1">Execution {data.status}</div>
          <pre className="whitespace-pre-wrap text-xs">{data.errorMessage}</pre>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Output</CardTitle>
          {running && (
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Polling for result…
            </span>
          )}
        </CardHeader>
        <CardContent>
          {running ? (
            <p className="text-sm text-gray-500">Waiting for result…</p>
          ) : (
            <ExecutionOutputViewer
              templateId={data.templateId}
              executionId={data.id}
              output={data.output?.outputJson ?? null}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm text-gray-900 mt-0.5" title={title}>
        {value}
      </div>
    </div>
  );
}
