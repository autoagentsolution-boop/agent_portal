import { useEffect, useState, type MouseEvent } from 'react';
import { useAuth } from './hooks/use-auth';
import { useToast } from './hooks/use-toast';
import { api, loginUrl, type AgentChatSessionDto, type CampaignDto, type PostDto } from './api/client';
import { ActiveFlowsPage } from './components/ActiveFlowsPage';
import { DemoModeToggle } from './components/DemoModeToggle';
import { MasterAgentIntake } from './components/MasterAgentIntake';
import { OrchestratePanel } from './components/OrchestratePanel';
import type { DemoMode } from './flow/demo-flow';

type Page = 'master' | 'flows' | 'orchestrate';
type Theme = 'light' | 'dark';

const postTitle = (post: PostDto, index: number): string => {
  const firstLine = post.copy?.body?.split('\n').find((line) => line.trim())?.trim();
  if (firstLine) return firstLine.slice(0, 42);
  return `Post ${index + 1} · ${post.status}`;
};

export function App() {
  const auth = useAuth();
  const { toast, show } = useToast();
  const [page, setPage] = useState<Page>('master');
  const [theme, setTheme] = useState<Theme>('light');
  const [activeCampaign, setActiveCampaign] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState<DemoMode>('safe');
  const [refreshKey, setRefreshKey] = useState(0);
  const [flowPosts, setFlowPosts] = useState<PostDto[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignDto[]>([]);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [chatSessions, setChatSessions] = useState<AgentChatSessionDto[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const activeChat = chatSessions.find((chat) => chat.id === activeChatId) ?? null;
  const bump = () => setRefreshKey((k) => k + 1);

  const loadChats = async () => {
    const r = await api.listAgentChats();
    if (!r.ok) return;

    setChatSessions((current) => r.data.map((chat) => {
      const hydrated = current.find((item) => item.id === chat.id && item.messages.length > chat.messages.length);
      return hydrated ? { ...chat, draft: hydrated.draft ?? chat.draft, messages: hydrated.messages } : chat;
    }));
    setActiveChatId((current) => current && r.data.some((chat) => chat.id === current) ? current : null);
  };

  const selectChat = async (id: string) => {
    const r = await api.getAgentChat(id);
    if (r.ok) {
      setChatSessions((prev) => [r.data, ...prev.filter((chat) => chat.id !== id)]);
      setActiveChatId(id);
      setPage('master');
    }
  };

  const deleteChat = async (event: MouseEvent<HTMLButtonElement>, chat: AgentChatSessionDto) => {
    event.stopPropagation();
    if (!confirm(`Delete “${chat.title}”?`)) return;

    const r = await api.deleteAgentChat(chat.id);
    if (!r.ok) {
      show(`Delete failed: ${r.error.error}`, 'err');
      return;
    }

    setChatSessions((prev) => prev.filter((item) => item.id !== chat.id));
    setActiveChatId((current) => current === chat.id ? null : current);
    if (activeChatId === chat.id) setPage('master');
    show('Chat deleted');
  };

  const upsertChat = (chat: AgentChatSessionDto) => {
    setChatSessions((prev) => [chat, ...prev.filter((item) => item.id !== chat.id)]);
    setActiveChatId(chat.id);
  };

  useEffect(() => {
    if (!auth.user) return;
    void api.listCampaigns().then((r) => { if (r.ok) setCampaigns(r.data); });
    void loadChats();
  }, [auth.user, refreshKey]);

  if (auth.loading) return <div className="center"><div className="muted">Loading…</div></div>;

  if (!auth.user) {
    return (
      <div className="center">
        <div className="card">
          <h1>MKTAgent</h1>
          <p className="muted">Multi-tenant marketing automation. Sign in to manage campaigns and review posts.</p>
          <a className="btn primary" href={loginUrl()}>Sign in with Google</a>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-root theme-${theme}`}>
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <strong>AgentPortal</strong>
          <button className="icon-btn" aria-label="Toggle theme" onClick={() => setTheme((t) => t === 'light' ? 'dark' : 'light')}>{theme === 'light' ? '◐' : '☼'}</button>
        </div>
        <button className={`sidebar-item ${page === 'master' && !activeChatId ? 'active' : ''}`} onClick={() => { setActiveChatId(null); setPage('master'); }}>✎ New setup chat</button>
        <button className={`sidebar-item ${page === 'orchestrate' ? 'active' : ''}`} onClick={() => setPage('orchestrate')}>⚡ Orchestrate (M1)</button>
        <button className={`sidebar-item ${page === 'flows' ? 'active' : ''}`} onClick={() => setPage('flows')}>▦ Active Flows</button>
        <div className="flow-sidebar-tree">
          <button className="tree-row level-1" onClick={() => { setActiveCampaign(null); setSelectedPostId(null); setPage('flows'); }}>Branding / Social</button>
          {campaigns.length === 0 ? (
            <div className="tree-empty">No campaigns yet</div>
          ) : campaigns.map((campaign) => {
            const campaignPosts = flowPosts.filter((post) => post.campaignId === campaign.id);
            return (
              <div key={campaign.id}>
                <button className={`tree-row level-2 ${activeCampaign === campaign.id && !selectedPostId ? 'active' : ''}`} onClick={() => { setActiveCampaign(campaign.id); setSelectedPostId(null); setPage('flows'); }}>{campaign.product}</button>
                {campaignPosts.length === 0 ? <div className="tree-empty nested">No briefs loaded</div> : campaignPosts.slice(0, 6).map((post, index) => (
                  <button className={`tree-row level-3 ${selectedPostId === post.id ? 'active' : ''}`} key={post.id} onClick={() => { setActiveCampaign(campaign.id); setSelectedPostId(post.id); setPage('flows'); }}>{postTitle(post, index)}</button>
                ))}
              </div>
            );
          })}
        </div>
        <button className="sidebar-item muted-action">⌕ Search chats</button>
        <button className="sidebar-item muted-action">◷ Scheduled</button>

        <div className="sidebar-section">Chats</div>
        {chatSessions.length === 0 ? (
          <div className="sidebar-empty">No setup chats yet</div>
        ) : chatSessions.map((chat) => (
          <div className={`sidebar-chat-row ${activeChatId === chat.id ? 'active' : ''}`} key={chat.id}>
            <button className="sidebar-link" onClick={() => void selectChat(chat.id)}>{chat.title}</button>
            <button className="sidebar-chat-delete" aria-label={`Delete ${chat.title}`} onClick={(event) => void deleteChat(event, chat)}>×</button>
          </div>
        ))}
        <div className="sidebar-user">{auth.user.email}</div>
      </aside>

      <main className="app-main">
        {page === 'master' ? (
          <div className="master-home">
            <div className="master-toolbar"><DemoModeToggle mode={demoMode} onChange={setDemoMode} /></div>
            <MasterAgentIntake
              session={activeChat}
              notify={show}
              onSessionChange={upsertChat}
              onOpenFlows={() => setPage('flows')}
              onCreated={(campaign) => { setActiveCampaign(campaign.id); bump(); }}
            />
          </div>
        ) : page === 'orchestrate' ? (
          <div className="master-home">
            <OrchestratePanel notify={show} />
          </div>
        ) : (
          <ActiveFlowsPage
            activeCampaign={activeCampaign}
            demoMode={demoMode}
            refreshKey={refreshKey}
            selectedPostId={selectedPostId}
            onCampaignSelect={setActiveCampaign}
            onDemoModeChange={setDemoMode}
            onRefresh={bump}
            onPostsChange={setFlowPosts}
            notify={show}
          />
        )}
      </main>

      {toast && <div className={`toast ${toast.kind === 'err' ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
