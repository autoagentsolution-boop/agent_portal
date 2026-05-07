import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Alert } from '../ui/alert';
import type { WizardAction, WizardState } from './wizard-types';

interface StepProps {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
}

export function StepReviewScope({ state, dispatch }: StepProps) {
  const tpl = state.template;
  if (!tpl) return <Alert variant="warning">Pick a template first.</Alert>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Review task scope</h2>
        <p className="text-sm text-gray-500">
          Confirm what {tpl.name} does — and what it won't do — before configuring.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="agent-name">Name your agent</Label>
        <Input
          id="agent-name"
          placeholder="e.g. Sales Inbox Triage"
          value={state.agentName}
          onChange={(e) => dispatch({ type: 'setAgentName', name: e.target.value })}
        />
        <p className="text-xs text-gray-500">Shown on the My Agents tab and in execution logs.</p>
      </div>

      <Section title="What it does">
        <p className="text-sm text-gray-700">{tpl.taskScope ?? tpl.description ?? 'No description.'}</p>
      </Section>

      {tpl.limitationsJson && tpl.limitationsJson.length > 0 && (
        <Section title="Limitations">
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
            {tpl.limitationsJson.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </Section>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Required integrations">
          <BadgeList items={tpl.requiredIntegrationsJson} variant="info" empty="None" />
        </Section>
        <Section title="Optional integrations">
          <BadgeList items={tpl.optionalIntegrationsJson} variant="muted" empty="None" />
        </Section>
        <Section title="Trigger modes">
          <BadgeList items={tpl.allowedTriggerModesJson} variant="default" empty="—" />
        </Section>
        <Section title="Properties">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={tpl.approvalRequired ? 'warning' : 'muted'}>
              {tpl.approvalRequired ? 'Approval required' : 'No approval'}
            </Badge>
            <Badge variant={costVariant[tpl.costLevel] ?? 'default'}>{tpl.costLevel} cost</Badge>
          </div>
        </Section>
      </div>
    </div>
  );
}

const costVariant: Record<string, 'success' | 'warning' | 'danger'> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {children}
    </div>
  );
}

function BadgeList({
  items,
  variant,
  empty,
}: {
  items: string[];
  variant: 'info' | 'muted' | 'default';
  empty: string;
}) {
  if (!items || items.length === 0) {
    return <p className="text-xs text-gray-400">{empty}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <Badge key={i} variant={variant}>
          {i}
        </Badge>
      ))}
    </div>
  );
}
