import { useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert } from '../../components/ui/alert';
import { WizardShell } from '../../components/wizard/wizard-shell';
import { initialWizardState, wizardReducer } from '../../components/wizard/wizard-types';
import { canAdvance } from '../../components/wizard/wizard-validation';
import { StepSelectTemplate } from '../../components/wizard/step-01-select-template';
import { StepReviewScope } from '../../components/wizard/step-02-review-scope';
import { StepSelectIntegrations } from '../../components/wizard/step-03-select-integrations';
import { StepConfigureFields } from '../../components/wizard/step-04-configure-fields';
import { StepSelectTrigger } from '../../components/wizard/step-05-select-trigger';
import { StepTestRun } from '../../components/wizard/step-06-test-run';
import { StepActivate } from '../../components/wizard/step-07-activate';
import { useTemplate, useTemplates } from '../../hooks/use-templates';
import { archiveAgentSilently, useUpdateAgentStatus } from '../../hooks/use-agents';
import { apiClient, extractErrorMessage } from '../../lib/api-client';

const STEP_LABELS = [
  'Template',
  'Scope',
  'Integrations',
  'Configure',
  'Trigger',
  'Test',
  'Activate',
];

export function CreateAgentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(1);
  const [showStepErrors, setShowStepErrors] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);

  const updateStatus = useUpdateAgentStatus();
  const preselectedId = searchParams.get('template');
  const { data: templates } = useTemplates();
  const preselectedDetail = useTemplate(preselectedId);

  const agentIdRef = useRef<string | null>(null);
  const activatedRef = useRef(false);
  agentIdRef.current = state.agentId;

  useEffect(() => {
    return () => {
      if (agentIdRef.current && !activatedRef.current) {
        archiveAgentSilently(agentIdRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function onBeforeUnload() {
      if (agentIdRef.current && !activatedRef.current) {
        // navigator.sendBeacon would be ideal here, but our DELETE requires the auth cookie
        // and a JSON body; sendBeacon is fire-and-forget so we just queue it via fetch keepalive.
        const url = `${apiClient.defaults.baseURL ?? ''}/agent-instances/${agentIdRef.current}`;
        try {
          fetch(url, { method: 'DELETE', credentials: 'include', keepalive: true }).catch(() => {});
        } catch {
          // ignore
        }
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    if (!preselectedId || state.templateId) return;
    const fromList = templates?.find((t) => t.id === preselectedId) ?? null;
    dispatch({ type: 'setTemplate', templateId: preselectedId, template: fromList });
  }, [preselectedId, templates, state.templateId]);

  useEffect(() => {
    if (preselectedDetail.data) {
      dispatch({ type: 'setTemplateDetail', template: preselectedDetail.data });
    }
  }, [preselectedDetail.data]);

  const totalSteps = STEP_LABELS.length;
  const canProceed = canAdvance(step, state);
  const isLastStep = step === totalSteps;

  function goNext() {
    if (!canProceed) {
      setShowStepErrors(true);
      return;
    }
    setShowStepErrors(false);
    if (step < totalSteps) setStep(step + 1);
  }

  function goBack() {
    setShowStepErrors(false);
    if (step > 1) setStep(step - 1);
  }

  async function activate() {
    if (!state.agentId) {
      setActivateError('Agent has not been created. Go back to step 6 and run the test.');
      return;
    }
    setActivateError(null);
    try {
      await updateStatus.mutateAsync({ id: state.agentId, status: 'running' });
      activatedRef.current = true;
      navigate('/agents?tab=my-agents');
    } catch (err) {
      setActivateError(extractErrorMessage(err, 'Activation failed'));
    }
  }

  function onPrimary() {
    if (isLastStep) void activate();
    else goNext();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Create Agent</h1>
        <p className="text-sm text-gray-500">Step {step} of {totalSteps}</p>
      </div>

      <WizardShell
        step={step}
        totalSteps={totalSteps}
        stepLabels={STEP_LABELS}
        canBack={step > 1 && !updateStatus.isPending}
        canNext={isLastStep ? Boolean(state.agentId) && !updateStatus.isPending : canProceed}
        isLastStep={isLastStep}
        isSubmitting={updateStatus.isPending}
        onBack={goBack}
        onNext={onPrimary}
        onCancel={() => navigate('/agents')}
      >
        {step === 1 && <StepSelectTemplate state={state} dispatch={dispatch} />}
        {step === 2 && <StepReviewScope state={state} dispatch={dispatch} />}
        {step === 3 && <StepSelectIntegrations state={state} dispatch={dispatch} />}
        {step === 4 && (
          <StepConfigureFields state={state} dispatch={dispatch} showErrors={showStepErrors} />
        )}
        {step === 5 && <StepSelectTrigger state={state} dispatch={dispatch} />}
        {step === 6 && <StepTestRun state={state} dispatch={dispatch} />}
        {step === 7 && <StepActivate state={state} />}
      </WizardShell>

      {showStepErrors && !canProceed && (
        <Alert variant="warning">{stepHintMessage(step)}</Alert>
      )}
      {activateError && <Alert variant="destructive">{activateError}</Alert>}
    </div>
  );
}

function stepHintMessage(step: number): string {
  switch (step) {
    case 1: return 'Select a template to continue.';
    case 2: return 'Enter a name for your agent.';
    case 3: return 'All required integrations must be selected.';
    case 4: return 'Some configuration fields are missing or invalid.';
    case 5: return 'Pick a trigger mode.';
    case 6: return 'Run the test (success or failure) before activating.';
    default: return 'Cannot proceed.';
  }
}

