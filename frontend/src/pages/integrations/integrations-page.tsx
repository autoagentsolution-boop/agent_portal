import { useMemo, useState } from 'react';
import { cn } from '../../lib/utils';
import { IntegrationList } from '../../components/integrations/integration-list';
import {
  useDisconnectIntegration,
  useIntegrations,
  useMockConnectIntegration,
  useTestIntegration,
} from '../../hooks/use-integrations';
import { useDocumentTitle } from '../../hooks/use-document-title';
import { extractErrorMessage } from '../../lib/api-client';
import type { Integration, IntegrationStatus } from '../../lib/types';

type FilterValue = 'all' | IntegrationStatus;

const FILTERS: Array<{ id: FilterValue; label: string }> = [
  { id: 'all',            label: 'All' },
  { id: 'connected',      label: 'Connected' },
  { id: 'mock_connected', label: 'Mock Connected' },
  { id: 'not_connected',  label: 'Not Connected' },
  { id: 'error',          label: 'Error' },
  { id: 'expired',        label: 'Expired' },
];

type BusyAction = 'mock-connect' | 'test' | 'disconnect' | null;
type TestResultMap = Record<string, { ok: boolean; message: string } | null>;

export function IntegrationsPage() {
  useDocumentTitle('Integrations');
  const [filter, setFilter] = useState<FilterValue>('all');
  const [testResults, setTestResults] = useState<TestResultMap>({});
  const [busy, setBusy] = useState<{ id: string | null; action: BusyAction }>({
    id: null,
    action: null,
  });

  const listQ = useIntegrations();
  const mockConnectM = useMockConnectIntegration();
  const testM = useTestIntegration();
  const disconnectM = useDisconnectIntegration();

  const filtered = useMemo(() => {
    const all = listQ.data ?? [];
    if (filter === 'all') return all;
    return all.filter((i: Integration) => i.status === filter);
  }, [listQ.data, filter]);

  const wrap = async <T,>(
    id: string,
    action: BusyAction,
    fn: () => Promise<T>,
    onSuccess?: (result: T) => void,
  ) => {
    setBusy({ id, action });
    try {
      const result = await fn();
      onSuccess?.(result);
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: false, message: extractErrorMessage(err, 'Action failed') },
      }));
    } finally {
      setBusy({ id: null, action: null });
    }
  };

  const handleMockConnect = (id: string) =>
    wrap(id, 'mock-connect', () => mockConnectM.mutateAsync(id), () =>
      setTestResults((prev) => ({ ...prev, [id]: { ok: true, message: 'Mock connected.' } })),
    );

  const handleTest = (id: string) =>
    wrap(id, 'test', () => testM.mutateAsync(id), (res) =>
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: res.status === 'success', message: res.message },
      })),
    );

  const handleDisconnect = (id: string) =>
    wrap(id, 'disconnect', () => disconnectM.mutateAsync(id), () =>
      setTestResults((prev) => ({ ...prev, [id]: null })),
    );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Integrations</h1>
        <p className="text-sm text-gray-500">
          Mock or real connections used by your agents. Demo mode keeps everything in mock.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-gray-200 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              filter === f.id
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <IntegrationList
        integrations={filtered}
        isLoading={listQ.isLoading}
        error={listQ.error}
        busy={busy}
        testResults={testResults}
        onMockConnect={handleMockConnect}
        onTest={handleTest}
        onDisconnect={handleDisconnect}
        onRetryFetch={() => listQ.refetch()}
        isRetryingFetch={listQ.isFetching}
      />
    </div>
  );
}
