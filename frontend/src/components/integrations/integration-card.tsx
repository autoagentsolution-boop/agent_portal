import { Plug, Plug2, Activity, PlugZap } from 'lucide-react';
import { Button } from '../ui/button';
import { formatRelativeShort } from '../../lib/formatters';
import { IntegrationStatusBadge } from './integration-status-badge';
import type { Integration } from '../../lib/types';

export interface IntegrationCardProps {
  integration: Integration;
  busyAction?: 'mock-connect' | 'test' | 'disconnect' | null;
  testResult?: { ok: boolean; message: string } | null;
  onMockConnect: (id: string) => void;
  onTest: (id: string) => void;
  onDisconnect: (id: string) => void;
}

const CATEGORY_ICON: Record<string, typeof Plug> = {
  Communication: PlugZap,
  Productivity: Plug2,
  Support: Activity,
  CRM: Plug,
};

export function IntegrationCard({
  integration: i,
  busyAction,
  testResult,
  onMockConnect,
  onTest,
  onDisconnect,
}: IntegrationCardProps) {
  const Icon = (i.category && CATEGORY_ICON[i.category]) || Plug;
  const isConnected = i.status === 'connected' || i.status === 'mock_connected';
  const busy = busyAction !== null && busyAction !== undefined;

  return (
    <article className="flex flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-100">
          <Icon className="h-5 w-5 text-gray-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{i.name}</h3>
            <IntegrationStatusBadge status={i.status} />
          </div>
          <p className="text-xs text-gray-500">{i.category ?? 'Uncategorized'}</p>
          <p className="mt-1 text-[11px] text-gray-500">
            Last tested:{' '}
            <span className="font-medium text-gray-600">
              {i.lastTestedAt ? formatRelativeShort(i.lastTestedAt) : 'never'}
            </span>
          </p>
        </div>
      </header>

      {testResult && (
        <p
          className={`mt-3 rounded-md px-2.5 py-1.5 text-xs ${
            testResult.ok
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {testResult.message}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {!isConnected && (
          <Button
            size="sm"
            variant="default"
            disabled={busy}
            onClick={() => onMockConnect(i.id)}
          >
            {busyAction === 'mock-connect' ? 'Connecting…' : 'Mock Connect'}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !isConnected}
          onClick={() => onTest(i.id)}
        >
          {busyAction === 'test' ? 'Testing…' : 'Test Connection'}
        </Button>
        {isConnected && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onDisconnect(i.id)}
          >
            {busyAction === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        )}
      </div>
    </article>
  );
}
