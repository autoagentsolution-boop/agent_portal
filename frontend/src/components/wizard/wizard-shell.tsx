import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

interface WizardShellProps {
  step: number;
  totalSteps: number;
  stepLabels: string[];
  canBack: boolean;
  canNext: boolean;
  isLastStep: boolean;
  nextLabel?: string;
  isSubmitting?: boolean;
  onBack: () => void;
  onNext: () => void;
  onCancel: () => void;
  children: ReactNode;
}

export function WizardShell({
  step,
  totalSteps,
  stepLabels,
  canBack,
  canNext,
  isLastStep,
  nextLabel,
  isSubmitting,
  onBack,
  onNext,
  onCancel,
  children,
}: WizardShellProps) {
  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-wrap items-center gap-2">
        {stepLabels.map((label, idx) => {
          const num = idx + 1;
          const state = num < step ? 'done' : num === step ? 'current' : 'future';
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium',
                  state === 'done' && 'bg-gray-900 border-gray-900 text-white',
                  state === 'current' && 'border-gray-900 text-gray-900 bg-white',
                  state === 'future' && 'border-gray-300 text-gray-400 bg-white',
                )}
              >
                {state === 'done' ? <Check className="h-3.5 w-3.5" /> : num}
              </span>
              <span
                className={cn(
                  'text-xs',
                  state === 'current' ? 'font-medium text-gray-900' : 'text-gray-500',
                )}
              >
                {label}
              </span>
              {num < totalSteps && <span className="text-gray-300">›</span>}
            </li>
          );
        })}
      </ol>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">{children}</div>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onCancel} type="button">
          Cancel
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onBack} disabled={!canBack || isSubmitting} type="button">
            Back
          </Button>
          <Button onClick={onNext} disabled={!canNext || isSubmitting} type="button">
            {isSubmitting ? 'Working…' : nextLabel ?? (isLastStep ? 'Activate Agent' : 'Next')}
          </Button>
        </div>
      </div>
    </div>
  );
}
