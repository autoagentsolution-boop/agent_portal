import { useNavigate } from 'react-router-dom';
import { useTemplates } from '../../hooks/use-templates';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { Alert } from '../../components/ui/alert';
import { extractErrorMessage } from '../../lib/api-client';
import type { AgentTemplate } from '../../lib/types';

const costVariant: Record<string, 'success' | 'warning' | 'danger'> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
};

export function TemplatesTab() {
  const { data, isLoading, error } = useTemplates();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return <Alert variant="destructive">{extractErrorMessage(error, 'Failed to load templates')}</Alert>;
  }

  if (!data || data.length === 0) {
    return <Alert>No templates available.</Alert>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {data.map((tpl) => (
        <TemplateCard key={tpl.id} template={tpl} onCreate={() => navigate(`/agents/new?template=${tpl.id}`)} />
      ))}
    </div>
  );
}

function TemplateCard({ template, onCreate }: { template: AgentTemplate; onCreate: () => void }) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{template.name}</CardTitle>
          <Badge variant={costVariant[template.costLevel] ?? 'default'}>{template.costLevel}</Badge>
        </div>
        <CardDescription>{template.category}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <p className="text-sm text-gray-600 mb-3">{template.description}</p>
        <div className="space-y-2">
          {template.requiredIntegrationsJson.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-500">Required:</span>
              {template.requiredIntegrationsJson.map((i) => (
                <Badge key={i} variant="info">{i}</Badge>
              ))}
            </div>
          )}
          {template.optionalIntegrationsJson.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-500">Optional:</span>
              {template.optionalIntegrationsJson.map((i) => (
                <Badge key={i} variant="muted">{i}</Badge>
              ))}
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button size="sm" onClick={onCreate}>Create Agent</Button>
      </CardFooter>
    </Card>
  );
}
