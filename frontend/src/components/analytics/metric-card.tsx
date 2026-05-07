import { cn } from '../../lib/utils';

export type MetricVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

export interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  variant?: MetricVariant;
  isLoading?: boolean;
}

const VARIANT_VALUE: Record<MetricVariant, string> = {
  default: 'text-gray-900',
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-red-600',
  info: 'text-sky-600',
};

export function MetricCard({ label, value, subtext, variant = 'default', isLoading }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div
        className={cn(
          'mt-2 text-2xl font-semibold tabular-nums',
          VARIANT_VALUE[variant],
          isLoading && 'animate-pulse text-gray-300',
        )}
      >
        {isLoading ? '—' : value}
      </div>
      {subtext && <div className="mt-1 text-xs text-gray-500">{subtext}</div>}
    </div>
  );
}
