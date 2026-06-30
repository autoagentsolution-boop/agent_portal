import { useEffect, useState, type MouseEvent } from 'react';
import { useAuth } from './hooks/use-auth';
import { useToast } from './hooks/use-toast';
import { api, loginUrl, type AgentChatSessionDto, type CampaignDto, type PostDto, type SavedRunDto } from './api/client';
import { ActiveFlowsPage } from './components/ActiveFlowsPage';
import { DemoModeToggle } from './components/DemoModeToggle';
import { MasterAgentIntake } from './components/MasterAgentIntake';
import { OrchestratePanel, type OrchestrateRestore } from './components/OrchestratePanel';
import { ConnectionsPanel } from './components/ConnectionsPanel';
import type { DemoMode } from './flow/demo-flow';

type Page = 'master' | 'flows' | 'orchestrate' | 'connections';
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
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [savedRuns, setSavedRuns] = useState<SavedRunDto[]>([]);
  const [chatSessions, setChatSessions] = useState<AgentChatSessionDto[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [orchestrateRestore, setOrchestrateRestore] = useState<OrchestrateRestore | null>(null);
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
    if (!r.ok) return;
    setChatSessions((prev) => [r.data, ...prev.filter((chat) => chat.id !== id)]);
    setActiveChatId(id);

    // Conversational unify: a chat that spawned an orchestration run opens the
    // Orchestrate surface restored; a legacy intake-only chat opens the master setup.
    const runRes = await api.getRunByChat(id);
    if (runRes.ok) {
      setOrchestrateRestore({
        sessionId: id,
        messages: r.data.messages.map((m) => ({ role: m.role, content: m.content })),
        run: runRes.data,
      });
      setPage('orchestrate');
    } else {
      setOrchestrateRestore(null);
      setPage('master');
    }
  };

  const openOrchestrate = () => { setOrchestrateRestore(null); setActiveChatId(null); setSelectedRunId(null); setPage('orchestrate'); };

  const loadSavedRuns = async () => {
    const r = await api.listSavedRuns();
    if (r.ok) setSavedRuns(r.data);
  };

  // Load ALL of the user's posts for the sidebar tree, independent of which campaign
  // is open. Without this, flowPosts only ever held the currently-viewed campaign's
  // posts, so every OTHER campaign in the tree showed "No briefs loaded" until clicked.
  const loadAllPosts = async () => {
    const r = await api.listPosts({ limit: 100 });
    if (r.ok) setFlowPosts(r.data);
  };

  // Merge PostBoard's updates (one campaign's posts, incl. live SSE patches) INTO the
  // global set by id, rather than replacing it — so opening one campaign never wipes
  // the briefs the sidebar shows for the others.
  const mergePosts = (incoming: PostDto[]) => {
    setFlowPosts((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      for (const p of incoming) byId.set(p.id, p);
      return [...byId.values()];
    });
  };

  // Open a Saved Flow in Active Flows (from the sidebar branch or after saving).
  const openSavedFlow = (runId: string) => {
    setSelectedRunId(runId);
    setSelectedPostId(null);
    setActiveCampaign(null);
    setPage('flows');
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
    void loadSavedRuns();
    void loadAllPosts();
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
        <button className={`sidebar-item ${page === 'master' && !activeChatId ? 'active' : ''}`} onClick={() => { setActiveChatId(null); setSelectedRunId(null); setPage('master'); }}>✎ New setup chat</button>
        <button className={`sidebar-item ${page === 'orchestrate' && !activeChatId ? 'active' : ''}`} onClick={openOrchestrate}>⚡ Orchestrate (M1)</button>
        <button className={`sidebar-item ${page === 'connections' ? 'active' : ''}`} onClick={() => { setSelectedRunId(null); setPage('connections'); }}>🔌 Connections</button>
        <button className={`sidebar-item ${page === 'flows' && !selectedRunId ? 'active' : ''}`} onClick={() => { setSelectedRunId(null); setPage('flows'); }}>▦ Active Flows</button>
        <div className="flow-sidebar-tree">
          <button className="tree-row level-1" onClick={() => { setActiveCampaign(null); setSelectedPostId(null); setSelectedRunId(null); setPage('flows'); }}>Branding / Social</button>
          <div className="tree-row level-1 tree-label">Saved Flows</div>
          {savedRuns.length === 0 ? (
            <div className="tree-empty">No saved flows yet</div>
          ) : savedRuns.map((flow) => (
            <button
              key={flow.id}
              className={`tree-row level-2 ${selectedRunId === flow.id ? 'active' : ''}`}
              onClick={() => openSavedFlow(flow.id)}
            >{flow.name ?? 'Untitled flow'} <span className="tree-badge">{flow.nodeCount}</span></button>
          ))}
          {campaigns.length === 0 ? (
            <div className="tree-empty">No campaigns yet</div>
          ) : campaigns.map((campaign) => {
            const campaignPosts = flowPosts.filter((post) => post.campaignId === campaign.id);
            return (
              <div key={campaign.id}>
                <button className={`tree-row level-2 ${activeCampaign === campaign.id && !selectedPostId && !selectedRunId ? 'active' : ''}`} onClick={() => { setActiveCampaign(campaign.id); setSelectedPostId(null); setSelectedRunId(null); setPage('flows'); }}>{campaign.product}</button>
                {campaignPosts.length === 0 ? <div className="tree-empty nested">No briefs loaded</div> : campaignPosts.slice(0, 6).map((post, index) => (
                  <button className={`tree-row level-3 ${selectedPostId === post.id ? 'active' : ''}`} key={post.id} onClick={() => { setActiveCampaign(campaign.id); setSelectedPostId(post.id); setSelectedRunId(null); setPage('flows'); }}>{postTitle(post, index)}</button>
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
            <OrchestratePanel
              key={orchestrateRestore?.sessionId ?? 'new'}
              restore={orchestrateRestore}
              notify={show}
              onRunActivity={(sessionId) => { void loadChats(); if (!activeChatId) setActiveChatId(sessionId); bump(); }}
              onSaved={(runId) => { void loadSavedRuns().then(() => openSavedFlow(runId)); }}
            />
          </div>
        ) : page === 'connections' ? (
          <div className="master-home">
            <ConnectionsPanel notify={show} />
          </div>
        ) : (
          <ActiveFlowsPage
            activeCampaign={activeCampaign}
            demoMode={demoMode}
            refreshKey={refreshKey}
            selectedPostId={selectedPostId}
            selectedRunId={selectedRunId}
            onCampaignSelect={setActiveCampaign}
            onDemoModeChange={setDemoMode}
            onRefresh={() => { bump(); void loadSavedRuns(); }}
            onPostsChange={mergePosts}
            notify={show}
          />
        )}
      </main>

      {toast && <div className={`toast ${toast.kind === 'err' ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
