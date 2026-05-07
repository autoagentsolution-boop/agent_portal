import { useEffect } from 'react';
import { useTemplate, useTemplates } from '../../hooks/use-templates';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import { Alert } from '../ui/alert';
import { extractErrorMessage } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import type { AgentTemplate } from '../../lib/types';
import type { WizardAction, WizardState } from './wizard-types';

interface StepProps {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
}

const costVariant: Record<string, 'success' | 'warning' | 'danger'> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
};

export function StepSelectTemplate({ state, dispatch }: StepProps) {
  const { data: list, isLoading, error } = useTemplates();
  const detail = useTemplate(state.templateId);

  useEffect(() => {
    if (detail.data) {
      dispatch({ type: 'setTemplateDetail', template: detail.data });
    }
  }, [detail.data, dispatch]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Choose a template</h2>
        <p className="text-sm text-gray-500">Each template has a fixed task scope and integration set.</p>
      </div>

      {isLoading && (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      )}

      {error && (
        <Alert variant="destructive">{extractErrorMessage(error, 'Failed to load templates')}</Alert>
      )}

      {list && list.length === 0 && <Alert>No templates available.</Alert>}

      {list && list.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((tpl) => (
            <TemplateOption
              key={tpl.id}
              template={tpl}
              selected={state.templateId === tpl.id}
              onSelect={() => dispatch({ type: 'setTemplate', templateId: tpl.id, template: tpl })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateOption({
  template,
  selected,
  onSelect,
}: {
  template: AgentTemplate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" onClick={onSelect} className="text-left">
      <Card
        className={cn(
          'transition-colors hover:border-gray-400',
          selected && 'border-gray-900 ring-2 ring-gray-900/10',
        )}
      >
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base">{template.name}</CardTitle>
            <Badge variant={costVariant[template.costLevel] ?? 'default'}>{template.costLevel}</Badge>
          </div>
          <CardDescription>{template.category}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="line-clamp-2 text-sm text-gray-600">{template.description}</p>
        </CardContent>
      </Card>
    </button>
  );
}
