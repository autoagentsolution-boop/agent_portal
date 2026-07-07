import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { useAuth } from './hooks/use-auth';
import { useToast } from './hooks/use-toast';
import { api, loginUrl, type AgentChatSessionDto, type CampaignDto, type PostDto, type SavedRunDto } from './api/client';
import { ActiveFlowsPage } from './components/ActiveFlowsPage';
import { OrchestratePanel, type OrchestrateRestore } from './components/OrchestratePanel';
import { ConnectionsPanel } from './components/ConnectionsPanel';
import { ProductKnowledgeLibrary } from './components/ProductKnowledgeLibrary';
import { LeadsPage } from './components/LeadsPage';
import { UsageDashboard } from './components/UsageDashboard';
import { AtriaHubPage } from './components/atria-hub-page';
import { CommandCenterPage } from './components/command-center-page';
import type { DemoMode } from './flow/demo-flow';

type Page = 'flows' | 'orchestrate' | 'connections' | 'product-knowledge' | 'leads' | 'usage' | 'command-center' | 'atria';
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
  // Command typed on the Command Center, carried once into a fresh Orchestrate composer.
  const [orchestratePrefill, setOrchestratePrefill] = useState<string | null>(null);
  // Sidebar "+" on a campaign requests the SAME create-post modal the board shows (Manual |
  // Master Agent), rather than silently creating an empty brief — unifies the two entry
  // points. Set the target campaign, navigate to its board, and let PostBoard auto-open the
  // modal on mount; PostBoard clears this via onCreateConsumed so it won't reopen later.
  const [pendingCreateCampaign, setPendingCreateCampaign] = useState<string | null>(null);
  // Stable so PostBoard's auto-create effect (deps include it) doesn't re-fire each render.
  const clearPendingCreate = useCallback(() => setPendingCreateCampaign(null), []);
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
    setOrchestratePrefill(null); // restored chats must never re-trigger a stale auto-send
    setOrchestrateRestore({
      sessionId: id,
      messages: r.data.messages.map((m) => ({ role: m.role, content: m.content })),
      run: runRes.ok ? runRes.data : null,
    });
    setPage('orchestrate');
  };

  const openOrchestrate = () => { setOrchestrateRestore(null); setActiveChatId(null); setSelectedRunId(null); setOrchestratePrefill(null); setPage('orchestrate'); };

  // Command Center / Atria → jump into the live Orchestrate surface. A non-empty
  // prefill (a typed command or an accepted Atria suggestion) is a SEND — the panel
  // auto-submits it so the plan appears immediately instead of parking in the composer.
  const launchFromCommandCenter = (prefill?: string) => {
    setOrchestrateRestore(null); setActiveChatId(null); setSelectedRunId(null);
    setOrchestratePrefill(prefill ?? null);
    setPage('orchestrate');
  };

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

  // P6 "Set up first campaign" — create a campaign under the just-saved flow (seamless,
  // labeled from the flow name; full config is editable later) and open it in the board.
  const setupFirstCampaign = async (runId: string) => {
    const flow = savedRuns.find((r) => r.id === runId);
    const product = (flow?.name ?? '').trim() || 'Campaign';
    const r = await api.createCampaign({ product, flowId: runId });
    if (!r.ok) { show(`Create failed: ${r.error.error}`, 'err'); return; }
    setCampaigns((prev) => [r.data, ...prev]);
    setActiveCampaign(r.data.id); setSelectedPostId(null); setSelectedRunId(null); setPage('flows');
    show(`Campaign “${product}” created`);
  };

  // Item 2 (Option A) — the Master Agent created a campaign (+ optional post) under a saved
  // flow from a chat message. Refresh campaigns/posts + saved runs (so the new campaign
  // nests under its flow in the sidebar), then open its board (selecting the post if any).
  const openCreatedCampaign = async (campaignId: string, postId?: string) => {
    await Promise.all([
      api.listCampaigns().then((r) => { if (r.ok) setCampaigns(r.data); }),
      loadAllPosts(),
      loadSavedRuns(),
    ]);
    setActiveCampaign(campaignId);
    setSelectedPostId(postId ?? null);
    setSelectedRunId(null);
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
    // Clear the consumed prefill too — remounting the panel fresh with a stale prefill
    // would auto-submit the old intent again (duplicate run + LLM spend).
    if (activeChatId === chat.id) { setOrchestrateRestore(null); setOrchestratePrefill(null); setPage('orchestrate'); }
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
    return createCampaignForFlow(flowId);
  };

  // Same create, invoked without an event (blueprint CTA "New campaign from this flow").
  const createCampaignForFlow = async (flowId: string | null) => {
    const product = prompt('New campaign — strategy or offer name (e.g. "Product launch", "Competitor comparison"):')?.trim();
    if (!product) return;
    const r = await api.createCampaign({ product, ...(flowId ? { flowId } : {}) });
    if (!r.ok) { show(`Create failed: ${r.error.error}`, 'err'); return; }
    setCampaigns((prev) => [r.data, ...prev]);
    setActiveCampaign(r.data.id); setSelectedPostId(null); setSelectedRunId(null); setPage('flows');
    show(`Campaign “${product}” created`);
  };

  // Add a post under a campaign (sidebar +). Same UX as the board's "+ New full brief":
  // open the campaign board and request the create-mode modal (Manual | Master Agent).
  const createPostUnder = (event: MouseEvent<HTMLButtonElement>, campaignId: string) => {
    event.stopPropagation();
    setActiveCampaign(campaignId); setSelectedPostId(null); setSelectedRunId(null); setPage('flows');
    setPendingCreateCampaign(campaignId);
  };

  // Delete a post/brief from the sidebar (level-4 ×). Refuses while publishing (backend 409).
  const deletePostRow = async (event: MouseEvent<HTMLButtonElement>, post: PostDto) => {
    event.stopPropagation();
    if (!confirm('Delete this post? This removes its brief and outputs.')) return;
    const r = await api.deletePost(post.id);
    if (!r.ok) { show(r.error.error === 'post_in_flight' ? 'Post is publishing — cannot delete' : `Delete failed: ${r.error.error}`, 'err'); return; }
    setFlowPosts((prev) => prev.filter((p) => p.id !== post.id));
    if (selectedPostId === post.id) setSelectedPostId(null);
    bump();
    show('Post deleted');
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

  // P6 "flows without strategy" hint (shown on the New chat hero): saved flows that have
  // no campaign attached yet — i.e. the user created a workflow but never started a
  // strategy on it. Pure client compute from the two lists already loaded.
  const strategizedFlowIds = new Set(campaigns.map((c) => c.flowId).filter(Boolean));
  const flowsWithoutStrategy = savedRuns
    .filter((r) => !strategizedFlowIds.has(r.id))
    .map((r) => ({ id: r.id, name: r.name ?? 'Untitled flow' }));

  // Breadcrumb labels for the campaign board: resolve the open campaign (directly, or
  // via the selected post) → its parent flow. Lets the board show "⚡ Flow ▸ 📁 Campaign"
  // so a user never loses track of which flow/agent-graph a campaign belongs to.
  const crumbCampaignId = activeCampaign ?? flowPosts.find((p) => p.id === selectedPostId)?.campaignId ?? null;
  const crumbCampaign = campaigns.find((c) => c.id === crumbCampaignId) ?? null;
  const crumbFlow = crumbCampaign?.flowId ? savedRuns.find((r) => r.id === crumbCampaign.flowId) ?? null : null;
  const activeCampaignCrumb = {
    flow: crumbFlow ? (crumbFlow.name ?? 'Untitled flow') : null,
    campaign: crumbCampaign?.product ?? null,
  };

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
          <div className={`tree-row-wrap level-4 ${selectedPostId === post.id ? 'active' : ''}`} key={post.id}>
            <button className="tree-row-main" onClick={() => { setActiveCampaign(campaign.id); setSelectedPostId(post.id); setSelectedRunId(null); setPage('flows'); }}>{postTitle(post, index)}</button>
            <button className="tree-row-delete" aria-label="Delete post" onClick={(e) => void deletePostRow(e, post)}>×</button>
          </div>
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
        <button className={`sidebar-item ${page === 'command-center' ? 'active' : ''}`} onClick={() => { setSelectedRunId(null); setPage('command-center'); }}>◈ Command Center</button>
        <button className={`sidebar-item ${page === 'atria' ? 'active' : ''}`} onClick={() => { setSelectedRunId(null); setPage('atria'); }}>✦ Atria</button>
        <button className={`sidebar-item ${page === 'orchestrate' && !activeChatId ? 'active' : ''}`} onClick={openOrchestrate}>✎ New chat</button>
        <button className={`sidebar-item ${page === 'connections' ? 'active' : ''}`} onClick={() => { setSelectedRunId(null); setPage('connections'); }}>🔌 Connections</button>
        <button className={`sidebar-item ${page === 'usage' ? 'active' : ''}`} onClick={() => { setSelectedRunId(null); setPage('usage'); }}>📊 Usage</button>
        <div className="flow-sidebar-tree">
          {/* Product Knowledge, Leads and Flows are peer top-level workspaces — same head level. */}
          <div className="tree-section-head">
            <button className={`tree-row level-1 tree-label flow-head ${page === 'product-knowledge' ? 'active' : ''}`} onClick={() => { setSelectedRunId(null); setActiveCampaign(null); setSelectedPostId(null); setPage('product-knowledge'); }}>📚 Product Knowledge</button>
          </div>
          <div className="tree-section-head">
            <button className={`tree-row level-1 tree-label flow-head ${page === 'leads' ? 'active' : ''}`} onClick={() => { setSelectedRunId(null); setActiveCampaign(null); setSelectedPostId(null); setPage('leads'); }}>🎯 Leads</button>
          </div>
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
        {page === 'command-center' ? (
          <CommandCenterPage
            onLaunch={launchFromCommandCenter}
            onExit={() => { setSelectedRunId(null); setActiveCampaign(null); setSelectedPostId(null); setPage('flows'); }}
            notify={show}
          />
        ) : page === 'orchestrate' ? (
          <div className="master-home">
            <OrchestratePanel
              key={orchestrateRestore?.sessionId ?? 'new'}
              restore={orchestrateRestore}
              initialInput={orchestratePrefill ?? undefined}
              autoStart={Boolean(orchestratePrefill)}
              flowsWithoutStrategy={flowsWithoutStrategy}
              notify={show}
              onRunActivity={(sessionId) => { void loadChats(); if (!activeChatId) setActiveChatId(sessionId); bump(); }}
              onSaved={() => { void loadSavedRuns(); }}
              onSetupCampaign={(runId) => { void loadSavedRuns().then(() => setupFirstCampaign(runId)); }}
              onOpenFlow={(runId) => { void loadSavedRuns().then(() => openSavedFlow(runId)); }}
              onCampaignCreated={(campaignId, postId) => { void openCreatedCampaign(campaignId, postId); }}
            />
          </div>
        ) : page === 'connections' ? (
          <div className="master-home">
            <ConnectionsPanel notify={show} />
          </div>
        ) : page === 'usage' ? (
          <div className="master-home">
            <UsageDashboard notify={show} />
          </div>
        ) : page === 'product-knowledge' ? (
          <div className="master-home">
            <ProductKnowledgeLibrary notify={show} />
          </div>
        ) : page === 'leads' ? (
          <div className="master-home">
            <LeadsPage notify={show} />
          </div>
        ) : page === 'atria' ? (
          <AtriaHubPage
            activeCampaign={activeCampaign}
            chats={chatSessions.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }))}
            flowsWithoutStrategy={flowsWithoutStrategy}
            notify={show}
            onPlanCampaign={launchFromCommandCenter}
            onResumeChat={(id) => void selectChat(id)}
            onOpenFlow={openSavedFlow}
          />
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
            autoCreateForCampaign={pendingCreateCampaign}
            onCreateConsumed={clearPendingCreate}
            onNewFlow={openOrchestrate}
            onOpenConnections={() => { setSelectedRunId(null); setPage('connections'); }}
            onCreateCampaign={(flowId) => void createCampaignForFlow(flowId)}
            onSelectPost={(id) => setSelectedPostId(id)}
            onBack={() => setSelectedPostId(null)}
            flowLabel={activeCampaignCrumb.flow}
            campaignLabel={activeCampaignCrumb.campaign}
            notify={show}
          />
        )}
      </main>

      {toast && <div className={`toast ${toast.kind === 'err' ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
