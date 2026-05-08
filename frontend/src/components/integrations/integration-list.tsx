import { Plug } from 'lucide-react';
import { RowSkeleton } from '../ui/loading-skeleton';
import { ErrorState } from '../ui/error-state';
import { EmptyState } from '../ui/empty-state';
import { IntegrationCard, type IntegrationCardProps } from './integration-card';
import type { Integration } from '../../lib/types';

export interface IntegrationListProps {
  integrations: Integration[] | undefined;
  isLoading?: boolean;
  error?: unknown;
  emptyHint?: string;
  busy: { id: string | null; action: IntegrationCardProps['busyAction'] };
  testResults: Record<string, { ok: boolean; message: string } | null>;
  onMockConnect: IntegrationCardProps['onMockConnect'];
  onTest: IntegrationCardProps['onTest'];
  onDisconnect: IntegrationCardProps['onDisconnect'];
  onRetryFetch?: () => void;
  isRetryingFetch?: boolean;
}

export function IntegrationList({
  integrations,
  isLoading,
  error,
  emptyHint = 'No integrations match the current filters.',
  busy,
  testResults,
  onMockConnect,
  onTest,
  onDisconnect,
  onRetryFetch,
  isRetryingFetch,
}: IntegrationListProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <RowSkeleton key={i} height="h-44" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <ErrorState
        title="Failed to load integrations"
        error={error}
        onRetry={onRetryFetch}
        isRetrying={isRetryingFetch}
      />
    );
  }
  if (!integrations || integrations.length === 0) {
    return <EmptyState icon={Plug} title={emptyHint} />;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {integrations.map((i) => (
        <IntegrationCard
          key={i.id}
          integration={i}
          busyAction={busy.id === i.id ? busy.action : null}
          testResult={testResults[i.id] ?? null}
          onMockConnect={onMockConnect}
          onTest={onTest}
          onDisconnect={onDisconnect}
        />
      ))}
    </div>
  );
}
