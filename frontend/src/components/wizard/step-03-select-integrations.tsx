import { useMemo } from 'react';
import { useIntegrations } from '../../hooks/use-integrations';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import { Alert } from '../ui/alert';
import { extractErrorMessage } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import type { Integration, IntegrationStatus } from '../../lib/types';
import type { WizardAction, WizardState } from './wizard-types';

interface StepProps {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
}

const statusVariant: Record<IntegrationStatus, 'success' | 'warning' | 'danger' | 'muted'> = {
  mock_connected: 'success',
  connected: 'success',
  not_connected: 'warning',
  error: 'danger',
  expired: 'warning',
};

export function StepSelectIntegrations({ state, dispatch }: StepProps) {
  const tpl = state.template;
  const { data, isLoading, error } = useIntegrations();

  const allowedKeys = useMemo(() => {
    const required = tpl?.requiredIntegrationsJson ?? [];
    const optional = tpl?.optionalIntegrationsJson ?? [];
    return new Set([...required, ...optional]);
  }, [tpl]);

  const requiredSet = useMemo(
    () => new Set(tpl?.requiredIntegrationsJson ?? []),
    [tpl],
  );

  const visible = useMemo(() => {
    if (!data) return [];
    return data.filter((i) => allowedKeys.has(i.integrationKey));
  }, [data, allowedKeys]);

  if (!tpl) return <Alert variant="warning">Pick a template first.</Alert>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Connect integrations</h2>
        <p className="text-sm text-gray-500">
          Only integrations allowed by this template are shown. Required ones cannot be deselected.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          {extractErrorMessage(error, 'Failed to load integrations')}
        </Alert>
      )}

      {!isLoading && visible.length === 0 && (
        <Alert variant="warning">
          No matching integrations exist in this workspace. Connect them in /integrations and return.
        </Alert>
      )}

      <div className="space-y-2">
        {visible.map((integ) => {
          const isRequired = requiredSet.has(integ.integrationKey);
          const isSelected = state.selectedIntegrations.includes(integ.integrationKey);
          const isDisconnected = integ.status === 'not_connected' || integ.status === 'error';
          return (
            <IntegrationRow
              key={integ.id}
              integration={integ}
              isRequired={isRequired}
              isSelected={isSelected}
              isDisconnected={isDisconnected}
              onToggle={() =>
                !isRequired && dispatch({ type: 'toggleIntegration', key: integ.integrationKey })
              }
            />
          );
        })}
      </div>
    </div>
  );
}

interface RowProps {
  integration: Integration;
  isRequired: boolean;
  isSelected: boolean;
  isDisconnected: boolean;
  onToggle: () => void;
}

function IntegrationRow({ integration, isRequired, isSelected, isDisconnected, onToggle }: RowProps) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center justify-between gap-3 rounded-md border bg-white p-3 transition-colors',
        isSelected ? 'border-gray-900' : 'border-gray-200 hover:border-gray-300',
        isRequired && 'cursor-default',
      )}
    >
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={isSelected}
          disabled={isRequired}
          onChange={onToggle}
          className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
        />
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">{integration.name}</span>
            {isRequired && <Badge variant="info">required</Badge>}
            <Badge variant={statusVariant[integration.status]}>{integration.status}</Badge>
          </div>
          <p className="text-xs text-gray-500">
            {integration.category ?? 'Other'} · key: {integration.integrationKey}
          </p>
        </div>
      </div>
      {isDisconnected && isSelected && (
        <span className="text-xs text-yellow-700">Will fail at runtime until connected</span>
      )}
    </label>
  );
}
