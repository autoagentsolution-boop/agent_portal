import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { useAuth } from './hooks/use-auth';
import { useToast } from './hooks/use-toast';
import { api, loginUrl, type AgentChatSessionDto, type CampaignDto, type PostDto, type SavedRunDto } from './api/client';
import { ActiveFlowsPage } from './components/ActiveFlowsPage';
import { OrchestratePanel, type OrchestrateRestore } from './components/OrchestratePanel';
import { ConnectionsPanel } from './components/ConnectionsPanel';
import type { DemoMode } from './flow/demo-flow';

type Page = 'flows' | 'orchestrate' | 'connections';
type Theme = 'light' | 'dark';

const postTitle = (post: PostDto, index: number): string => {
  const firstLine = post.copy?.body?.split('\n').find((line) => line.trim())?.trim();
  if (firstLine) return firstLine.slice(0, 42);
  return `Post ${index + 1} · ${post.status}`;
};

export function App() {
  const auth = useAuth();
  const { toast, show } = useToast();
  const [page, setPage] = useState<Page>('orchestrate');
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

    // All chats open the Orchestrate surface, restored from their messages. A chat that
    // spawned an orchestration run also restores that run (plan/exec card); a legacy
    // intake-only chat restores with no run (run: null) — the user can continue it as a
    // normal Orchestrate conversation. (The old Master Agent setup surface is retired.)
    const runRes = await api.getRunByChat(id);
    setOrchestrateRestore({
      sessionId: id,
      messages: r.data.messages.map((m) => ({ role: m.role, content: m.content })),
      run: runRes.ok ? runRes.data : null,
    });
    setPage('orchestrate');
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
  // the briefs the sidebar shows for the others. MUST be useCallback-stable: PostBoard's
  // load() depends on onPostsChange, so a new closure each render → infinite reload loop
  // (the "Posts • Loading…" hang). Empty deps: it only touches the stable setFlowPosts.
  const mergePosts = useCallback((incoming: PostDto[]) => {
    setFlowPosts((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      for (const p of incoming) byId.set(p.id, p);
      return [...byId.values()];
    });
  }, []);

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
    if (activeChatId === chat.id) { setOrchestrateRestore(null); setPage('orchestrate'); }
    show('Chat deleted');
  };

  // Delete a Saved Flow (run) from the sidebar. Refuses while executing (backend 409).
  const deleteSavedFlow = async (event: MouseEvent<HTMLButtonElement>, flow: SavedRunDto) => {
    event.stopPropagation();
    if (!confirm(`Delete flow “${flow.name ?? 'Untitled'}”? This removes its steps and outputs.`)) return;
    const r = await api.deleteRun(flow.id);
    if (!r.ok) { show(r.error.error === 'run_in_flight' ? 'Flow is running — stop it first' : `Delete failed: ${r.error.error}`, 'err'); return; }
    setSavedRuns((prev) => prev.filter((x) => x.id !== flow.id));
    if (selectedRunId === flow.id) { setSelectedRunId(null); setPage('flows'); }
    show('Flow deleted');
  };

  // Delete a campaign from the sidebar (cascades to its posts/briefs).
  const deleteCampaignRow = async (event: MouseEvent<HTMLButtonElement>, campaign: CampaignDto) => {
    event.stopPropagation();
    if (!confirm(`Delete campaign “${campaign.product}”? This removes its posts too.`)) return;
    const r = await api.deleteCampaign(campaign.id);
    if (!r.ok) { show(`Delete failed: ${r.error.error}`, 'err'); return; }
    setCampaigns((prev) => prev.filter((x) => x.id !== campaign.id));
    setFlowPosts((prev) => prev.filter((p) => p.campaignId !== campaign.id));
    if (activeCampaign === campaign.id) { setActiveCampaign(null); setSelectedPostId(null); }
    show('Campaign deleted');
  };

  // Create a campaign, optionally under a flow (sidebar +). A lightweight prompt for
  // the product name keeps this a quick management action (full config is editable later).
  const createCampaignUnder = async (event: MouseEvent<HTMLButtonElement>, flowId: string | null) => {
    event.stopPropagation();
    const product = prompt('New campaign — product or offer name:')?.trim();
    if (!product) return;
    const r = await api.createCampaign({ product, ...(flowId ? { flowId } : {}) });
    if (!r.ok) { show(`Create failed: ${r.error.error}`, 'err'); return; }
    setCampaigns((prev) => [r.data, ...prev]);
    setActiveCampaign(r.data.id); setSelectedPostId(null); setSelectedRunId(null); setPage('flows');
    show(`Campaign “${product}” created`);
  };

  // Create an empty post/brief under a campaign (sidebar +). Opens it in the board.
  const createPostUnder = async (event: MouseEvent<HTMLButtonElement>, campaignId: string) => {
    event.stopPropagation();
    const r = await api.createPost({ campaignId });
    if (!r.ok) { show(`Create failed: ${r.error.error}`, 'err'); return; }
    setFlowPosts((prev) => [r.data, ...prev]);
    setActiveCampaign(campaignId); setSelectedPostId(r.data.id); setSelectedRunId(null); setPage('flows');
    bump();
    show('Post created');
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

  // One campaign row + its posts (level-3) under it, with create/delete controls.
  // Reused for both flow-nested campaigns and the Ungrouped section.
  const renderCampaign = (campaign: CampaignDto) => {
    const campaignPosts = flowPosts.filter((post) => post.campaignId === campaign.id);
    return (
      <div key={campaign.id}>
        <div className={`tree-row-wrap level-3 ${activeCampaign === campaign.id && !selectedPostId && !selectedRunId ? 'active' : ''}`}>
          <button className="tree-row-main" onClick={() => { setActiveCampaign(campaign.id); setSelectedPostId(null); setSelectedRunId(null); setPage('flows'); }}>📁 {campaign.product}</button>
          <button className="tree-row-add" aria-label={`New post in ${campaign.product}`} title="New post" onClick={(e) => void createPostUnder(e, campaign.id)}>+</button>
          <button className="tree-row-delete" aria-label={`Delete campaign ${campaign.product}`} onClick={(e) => void deleteCampaignRow(e, campaign)}>×</button>
        </div>
        {campaignPosts.slice(0, 8).map((post, index) => (
          <button className={`tree-row level-4 ${selectedPostId === post.id ? 'active' : ''}`} key={post.id} onClick={() => { setActiveCampaign(campaign.id); setSelectedPostId(post.id); setSelectedRunId(null); setPage('flows'); }}>{postTitle(post, index)}</button>
        ))}
      </div>
    );
  };

  return (
    <div className={`app-root theme-${theme}`}>
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <strong>AgentPortal</strong>
          <button className="icon-btn" aria-label="Toggle theme" onClick={() => setTheme((t) => t === 'light' ? 'dark' : 'light')}>{theme === 'light' ? '◐' : '☼'}</button>
        </div>
        <button className={`sidebar-item ${page === 'orchestrate' && !activeChatId ? 'active' : ''}`} onClick={openOrchestrate}>✎ New chat</button>
        <button className={`sidebar-item ${page === 'connections' ? 'active' : ''}`} onClick={() => { setSelectedRunId(null); setPage('connections'); }}>🔌 Connections</button>
        <div className="flow-sidebar-tree">
          <div className="tree-section-head">
            <button className={`tree-row level-1 tree-label flow-head ${page === 'flows' && !selectedRunId && !activeCampaign ? 'active' : ''}`} onClick={() => { setActiveCampaign(null); setSelectedPostId(null); setSelectedRunId(null); setPage('flows'); }}>▦ Flows</button>
            <button className="tree-row-add" aria-label="New flow" title="New flow — describe it to the Master Agent" onClick={(e) => { e.stopPropagation(); openOrchestrate(); }}>+</button>
          </div>
          {savedRuns.length === 0 && campaigns.length === 0 && (
            <div className="tree-empty">No flows yet — orchestrate one to begin</div>
          )}
          {savedRuns.map((flow) => {
            const flowCampaigns = campaigns.filter((c) => c.flowId === flow.id);
            return (
              <div key={flow.id}>
                <div className={`tree-row-wrap level-2 ${selectedRunId === flow.id ? 'active' : ''}`}>
                  <button className="tree-row-main" onClick={() => openSavedFlow(flow.id)}>⚡ {flow.name ?? 'Untitled flow'} <span className="tree-badge">{flow.nodeCount}</span></button>
                  <button className="tree-row-add" aria-label={`New campaign in ${flow.name ?? 'flow'}`} title="New campaign" onClick={(e) => void createCampaignUnder(e, flow.id)}>+</button>
                  <button className="tree-row-delete" aria-label={`Delete flow ${flow.name ?? 'Untitled'}`} onClick={(e) => void deleteSavedFlow(e, flow)}>×</button>
                </div>
                {flowCampaigns.map(renderCampaign)}
              </div>
            );
          })}
          {campaigns.some((c) => !c.flowId) && (
            <>
              <div className="tree-row level-2 tree-label">Ungrouped campaigns</div>
              {campaigns.filter((c) => !c.flowId).map(renderCampaign)}
            </>
          )}
        </div>
        <button className="sidebar-item muted-action">⌕ Search chats</button>
        <button className="sidebar-item muted-action">◷ Scheduled</button>

        <div className="sidebar-section">Chats</div>
        {chatSessions.length === 0 ? (
          <div className="sidebar-empty">No chats yet — start one with New chat</div>
        ) : chatSessions.map((chat) => (
          <div className={`sidebar-chat-row ${activeChatId === chat.id ? 'active' : ''}`} key={chat.id}>
            <button className="sidebar-link" onClick={() => void selectChat(chat.id)}>{chat.title}</button>
            <button className="sidebar-chat-delete" aria-label={`Delete ${chat.title}`} onClick={(event) => void deleteChat(event, chat)}>×</button>
          </div>
        ))}
        <div className="sidebar-user">{auth.user.email}</div>
      </aside>

      <main className="app-main">
        {page === 'orchestrate' ? (
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
            onDemoModeChange={setDemoMode}
            onRefresh={() => { bump(); void loadSavedRuns(); }}
            onPostsChange={mergePosts}
            onNewFlow={openOrchestrate}
            notify={show}
          />
        )}
      </main>

      {toast && <div className={`toast ${toast.kind === 'err' ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
