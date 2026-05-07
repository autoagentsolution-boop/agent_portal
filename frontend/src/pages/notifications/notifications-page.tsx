import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { NotificationList } from '../../components/notifications/notification-list';
import {
  useAcknowledgeNotification,
  useNotifications,
  useResolveNotification,
} from '../../hooks/use-notifications';
import { useRetryExecution } from '../../hooks/use-executions';
import type { NotificationSeverity, NotificationStatus } from '../../lib/types';

type FilterValue =
  | { kind: 'all' }
  | { kind: 'status'; status: NotificationStatus }
  | { kind: 'severity'; severity: NotificationSeverity };

interface FilterTab {
  id: string;
  label: string;
  value: FilterValue;
}

const FILTERS: FilterTab[] = [
  { id: 'all',          label: 'All',         value: { kind: 'all' } },
  { id: 'unread',       label: 'Unread',      value: { kind: 'status', status: 'unread' } },
  { id: 'critical',     label: 'Critical',    value: { kind: 'severity', severity: 'critical' } },
  { id: 'warning',      label: 'Warning',     value: { kind: 'severity', severity: 'warning' } },
  { id: 'info',         label: 'Info',        value: { kind: 'severity', severity: 'info' } },
  { id: 'success',      label: 'Success',     value: { kind: 'severity', severity: 'success' } },
  { id: 'resolved',     label: 'Resolved',    value: { kind: 'status', status: 'resolved' } },
  { id: 'acknowledged', label: 'Acknowledged',value: { kind: 'status', status: 'acknowledged' } },
];

function toQuery(value: FilterValue) {
  if (value.kind === 'status') return { status: value.status };
  if (value.kind === 'severity') return { severity: value.severity };
  return {};
}

export function NotificationsPage() {
  const [activeId, setActiveId] = useState<string>('all');
  const active = FILTERS.find((f) => f.id === activeId) ?? FILTERS[0];

  const navigate = useNavigate();
  const listQ = useNotifications(toQuery(active.value));
  const acknowledgeM = useAcknowledgeNotification();
  const resolveM = useResolveNotification();
  const retryM = useRetryExecution();

  const busyId =
    (acknowledgeM.isPending && acknowledgeM.variables) ||
    (resolveM.isPending && resolveM.variables) ||
    null;

  const handleRetry = async (executionId: string) => {
    try {
      const result = await retryM.mutateAsync(executionId);
      navigate(`/executions/${result.execution_id}`);
    } catch {
      /* mutation surfaces its own error; navigation simply skipped */
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Notifications</h1>
        <p className="text-sm text-gray-500">
          Alerts from agent executions. Failures, warnings, and successful runs land here.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-gray-200 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setActiveId(f.id)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeId === f.id
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <NotificationList
        notifications={listQ.data}
        isLoading={listQ.isLoading}
        error={listQ.error}
        busyId={busyId || null}
        onAcknowledge={(id) => acknowledgeM.mutate(id)}
        onResolve={(id) => resolveM.mutate(id)}
        onRetry={handleRetry}
        emptyHint={
          active.value.kind === 'all'
            ? 'No notifications yet. Run a few agents to see them here.'
            : `No notifications match "${active.label}".`
        }
      />
    </div>
  );
}
