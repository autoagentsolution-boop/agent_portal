import { Alert } from '../ui/alert';
import { cn } from '../../lib/utils';
import type { WizardAction, WizardState } from './wizard-types';

interface StepProps {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
}

const ALL_MODES: Array<{ key: string; title: string; description: string }> = [
  { key: 'manual', title: 'Manual', description: 'Run on demand from the Agents page.' },
  {
    key: 'schedule',
    title: 'Schedule (mock)',
    description: 'Display a frequency selector. Demo only — not actually scheduled.',
  },
  {
    key: 'webhook',
    title: 'Webhook',
    description: 'Triggered by inbound webhook events.',
  },
];

const SCHEDULE_OPTIONS = [
  { key: 'hourly', label: 'Hourly' },
  { key: 'daily', label: 'Daily' },
];

export function StepSelectTrigger({ state, dispatch }: StepProps) {
  const tpl = state.template;
  if (!tpl) return <Alert variant="warning">Pick a template first.</Alert>;

  const allowed = new Set(tpl.allowedTriggerModesJson ?? []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Choose trigger mode</h2>
        <p className="text-sm text-gray-500">Determines when the agent runs.</p>
      </div>

      <div className="space-y-2">
        {ALL_MODES.map((mode) => {
          const isAllowed = allowed.has(mode.key);
          const isSelected = state.triggerMode === mode.key;
          return (
            <label
              key={mode.key}
              className={cn(
                'flex items-start gap-3 rounded-md border p-3 transition-colors',
                isAllowed ? 'cursor-pointer bg-white' : 'cursor-not-allowed bg-gray-50 opacity-60',
                isSelected ? 'border-gray-900' : 'border-gray-200 hover:border-gray-300',
              )}
            >
              <input
                type="radio"
                name="trigger-mode"
                disabled={!isAllowed}
                checked={isSelected}
                onChange={() => dispatch({ type: 'setTriggerMode', mode: mode.key })}
                className="mt-1 h-4 w-4 border-gray-300 text-gray-900 focus:ring-gray-400"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">{mode.title}</div>
                <div className="text-xs text-gray-500">{mode.description}</div>
                {!isAllowed && (
                  <div className="mt-1 text-xs text-gray-400">
                    Not supported by this template.
                  </div>
                )}
                {isSelected && mode.key === 'schedule' && (
                  <ScheduleFrequencyPicker
                    value={(state.config['schedule_frequency'] as string) ?? 'daily'}
                    onChange={(v) =>
                      dispatch({ type: 'setConfigField', key: 'schedule_frequency', value: v })
                    }
                  />
                )}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleFrequencyPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="text-xs text-gray-500">Frequency:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 rounded-md border border-gray-300 bg-white px-2 text-xs"
      >
        {SCHEDULE_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
