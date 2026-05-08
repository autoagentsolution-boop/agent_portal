import { useNavigate } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { useAgents } from '../../hooks/use-agents';
import { CardSkeleton } from '../../components/ui/loading-skeleton';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { AgentCard } from './agent-card';

export function MyAgentsTab() {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch, isFetching } = useAgents();

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Failed to load agents"
        error={error}
        onRetry={() => refetch()}
        isRetrying={isFetching}
      />
    );
  }

  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        title="No agents yet"
        description="Pick a template to create your first agent."
        action={{ label: 'Browse templates', onClick: () => navigate('/agents?tab=templates') }}
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {data.map((a) => <AgentCard key={a.id} agent={a} />)}
    </div>
  );
}
