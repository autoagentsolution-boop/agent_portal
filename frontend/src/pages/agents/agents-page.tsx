import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { useDocumentTitle } from '../../hooks/use-document-title';
import { TemplatesTab } from './templates-tab';
import { MyAgentsTab } from './my-agents-tab';

const VALID_TABS = new Set(['templates', 'my-agents']);

export function AgentsPage() {
  useDocumentTitle('Agents');
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const activeTab = requested && VALID_TABS.has(requested) ? requested : 'templates';

  function handleTabChange(value: string) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Agents</h1>
        <p className="text-sm text-gray-500">Browse templates and manage your agent instances.</p>
      </div>
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="my-agents">My Agents</TabsTrigger>
        </TabsList>
        <TabsContent value="templates">
          <TemplatesTab />
        </TabsContent>
        <TabsContent value="my-agents">
          <MyAgentsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
