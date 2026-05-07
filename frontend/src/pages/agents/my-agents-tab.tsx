import { useAgents } from '../../hooks/use-agents';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Alert } from '../../components/ui/alert';
import { extractErrorMessage } from '../../lib/api-client';
import { AgentCard } from './agent-card';

export function MyAgentsTab() {
  const { data, isLoading, error } = useAgents();

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return <Alert variant="destructive">{extractErrorMessage(error, 'Failed to load agents')}</Alert>;
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center">
        <p className="text-sm text-gray-600 font-medium">No agents yet</p>
        <p className="text-xs text-gray-500 mt-1">Pick a template to create your first agent.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {data.map((a) => <AgentCard key={a.id} agent={a} />)}
    </div>
  );
}
