import { useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { useRunAgent } from '../../hooks/use-agents';
import { extractErrorMessage } from '../../lib/api-client';
import type { AgentInstance, AgentInstanceStatus } from '../../lib/types';

const statusVariant: Record<AgentInstanceStatus, 'success' | 'warning' | 'danger' | 'default' | 'muted'> = {
  running: 'success',
  paused: 'warning',
  error: 'danger',
  draft: 'default',
  archived: 'muted',
};

export function AgentCard({ agent }: { agent: AgentInstance }) {
  const navigate = useNavigate();
  const runMutation = useRunAgent();

  async function onRun() {
    try {
      const result = await runMutation.mutateAsync(agent.id);
      navigate(`/executions/${result.execution_id}`);
    } catch (err) {
      window.alert(extractErrorMessage(err, 'Run failed'));
    }
  }

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{agent.name}</CardTitle>
          <Badge variant={statusVariant[agent.status]}>{agent.status}</Badge>
        </div>
        <CardDescription>
          {agent.template?.name ?? agent.templateId} · {agent.triggerMode}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {agent.integrationsUsedJson && agent.integrationsUsedJson.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {agent.integrationsUsedJson.map((i) => (
              <Badge key={i} variant="muted">{i}</Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">No integrations configured</p>
        )}
      </CardContent>
      <CardFooter className="justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/agents/${agent.id}`)}>
          Details
        </Button>
        <Button
          size="sm"
          onClick={onRun}
          disabled={runMutation.isPending || agent.status === 'archived' || agent.status === 'paused'}
        >
          <Play className="h-3.5 w-3.5" />
          {runMutation.isPending ? 'Starting…' : 'Run Now'}
        </Button>
      </CardFooter>
    </Card>
  );
}
