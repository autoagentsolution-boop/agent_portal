import { Alert } from '../ui/alert';
import { Badge } from '../ui/badge';
import type { WizardState } from './wizard-types';

interface StepProps {
  state: WizardState;
}

export function StepActivate({ state }: StepProps) {
  const tpl = state.template;
  if (!tpl) return <Alert variant="warning">Pick a template first.</Alert>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Review &amp; activate</h2>
        <p className="text-sm text-gray-500">Confirm the summary, then activate to start running.</p>
      </div>

      <div className="overflow-hidden rounded-md border border-gray-200">
        <SummaryRow label="Agent name" value={state.agentName} />
        <SummaryRow label="Template" value={`${tpl.name} (${tpl.category})`} />
        <SummaryRow
          label="Integrations"
          value={
            state.selectedIntegrations.length === 0 ? (
              <span className="text-gray-400">None</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {state.selectedIntegrations.map((k) => (
                  <Badge key={k} variant="muted">
                    {k}
                  </Badge>
                ))}
              </div>
            )
          }
        />
        <SummaryRow label="Trigger mode" value={state.triggerMode ?? '—'} />
        <SummaryRow
          label="Test run"
          value={
            <Badge variant={testStatusVariant(state.testStatus)}>{state.testStatus}</Badge>
          }
        />
      </div>

      {state.testStatus === 'failed' && (
        <Alert variant="warning">
          The test didn't finish cleanly. You can still activate — the agent will try again on the next run.
        </Alert>
      )}
      {state.testStatus === 'skipped' && (
        <Alert>Test was skipped. Activating will save the agent as <strong>running</strong>.</Alert>
      )}

      {!state.agentId && (
        <Alert variant="destructive">
          Agent has not been created yet. Go back to Step 6 and run the test first.
        </Alert>
      )}
    </div>
  );
}

function testStatusVariant(s: WizardState['testStatus']): 'success' | 'danger' | 'warning' | 'muted' {
  if (s === 'success') return 'success';
  if (s === 'failed') return 'warning';
  if (s === 'skipped') return 'muted';
  return 'muted';
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-4 py-3 last:border-b-0">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <div className="text-right text-sm text-gray-800">{value}</div>
    </div>
  );
}
