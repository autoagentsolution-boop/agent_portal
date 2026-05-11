import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { formatValuePreview } from '../../lib/overrides-diff';

interface ConfigAppliedPanelProps {
  defaultConfig: Record<string, unknown> | null | undefined;
  overrideConfig: Record<string, unknown> | null | undefined;
}

export function ConfigAppliedPanel({ defaultConfig, overrideConfig }: ConfigAppliedPanelProps) {
  const hasOverride = overrideConfig && Object.keys(overrideConfig).length > 0;
  if (!hasOverride) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Configuration applied
            <Badge variant="muted">defaults</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">
            Ran with the agent's saved defaults — no per-run overrides.
          </p>
        </CardContent>
      </Card>
    );
  }

  const base = defaultConfig ?? {};
  const keys = Object.keys(overrideConfig);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Configuration applied
          <Badge variant="warning">{keys.length} override{keys.length === 1 ? '' : 's'}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-4 font-medium">Field</th>
                <th className="py-2 pr-4 font-medium">Default</th>
                <th className="py-2 font-medium">This run</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs text-gray-700">{k}</td>
                  <td className="py-2 pr-4 text-gray-500">
                    <code className="font-mono text-xs break-all">{formatValuePreview(base[k])}</code>
                  </td>
                  <td className="py-2 text-amber-700">
                    <code className="font-mono text-xs break-all">{formatValuePreview(overrideConfig[k])}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
