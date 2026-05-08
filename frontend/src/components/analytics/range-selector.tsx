import type { OutcomeRange } from '../../lib/types';
import { cn } from '../../lib/utils';

interface RangeSelectorProps {
  value: OutcomeRange;
  onChange: (value: OutcomeRange) => void;
}

const OPTIONS: { value: OutcomeRange; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

export function RangeSelector({ value, onChange }: RangeSelectorProps) {
  return (
    <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-sm">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded px-3 py-1 font-medium transition-colors',
            value === opt.value
              ? 'bg-gray-900 text-white'
              : 'text-gray-600 hover:bg-gray-50',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
