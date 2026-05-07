import { cn } from '../../lib/utils';
import type { IntegrationStatus } from '../../lib/types';

const STYLES: Record<IntegrationStatus, { className: string; label: string }> = {
  connected:      { className: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'Connected' },
  mock_connected: { className: 'bg-sky-50 text-sky-700 ring-sky-200',             label: 'Mock Connected' },
  not_connected:  { className: 'bg-gray-100 text-gray-600 ring-gray-200',         label: 'Not Connected' },
  error:          { className: 'bg-red-50 text-red-700 ring-red-200',             label: 'Error' },
  expired:        { className: 'bg-amber-50 text-amber-700 ring-amber-200',       label: 'Expired' },
};

export function IntegrationStatusBadge({ status }: { status: IntegrationStatus }) {
  const style = STYLES[status] ?? STYLES.not_connected;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        style.className,
      )}
    >
      {style.label}
    </span>
  );
}
