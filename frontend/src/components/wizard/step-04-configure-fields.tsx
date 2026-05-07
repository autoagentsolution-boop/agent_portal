import { useMemo } from 'react';
import { Alert } from '../ui/alert';
import { DynamicConfigForm } from './dynamic-config-form';
import { validateConfigClient } from './wizard-validation';
import type { WizardAction, WizardState } from './wizard-types';

interface StepProps {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
  showErrors: boolean;
}

export function StepConfigureFields({ state, dispatch, showErrors }: StepProps) {
  const tpl = state.template;
  const schema = tpl?.configSchemaJson;

  const errors = useMemo(
    () => (showErrors ? validateConfigClient(state.config, schema) : []),
    [showErrors, state.config, schema],
  );

  if (!tpl) return <Alert variant="warning">Pick a template first.</Alert>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Configure fields</h2>
        <p className="text-sm text-gray-500">
          These fields drive the agent's behavior at runtime.
        </p>
      </div>

      <DynamicConfigForm
        schema={schema ?? {}}
        values={state.config}
        errors={errors}
        onChange={(key, value) => dispatch({ type: 'setConfigField', key, value })}
      />
    </div>
  );
}
