import { Plug } from 'lucide-react';
import { Skeleton } from '../ui/skeleton';
import { extractErrorMessage } from '../../lib/api-client';
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
}: IntegrationListProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-44 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {extractErrorMessage(error, 'Failed to load integrations.')}
      </div>
    );
  }
  if (!integrations || integrations.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
        <Plug className="mx-auto h-6 w-6 text-gray-400" />
        <p className="mt-2 text-sm text-gray-600">{emptyHint}</p>
      </div>
    );
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
