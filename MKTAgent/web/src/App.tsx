import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './hooks/use-auth';
import { useToast } from './hooks/use-toast';
import { api, loginUrl, type AgentChatSessionDto, type CampaignDto, type PostDto, type SavedRunDto } from './api/client';
import { ActiveFlowsPage } from './components/ActiveFlowsPage';
import { OrchestratePanel, type OrchestrateRestore, type OrchestrateHandle, type VoiceState } from './components/OrchestratePanel';
import { ConnectionsPanel } from './components/ConnectionsPanel';
import { ProductKnowledgeLibrary } from './components/ProductKnowledgeLibrary';
import { LeadsPage } from './components/LeadsPage';
import { ScheduledView } from './components/scheduled-view';
import { UsageDashboard } from './components/UsageDashboard';
import { InstructionEditor } from './components/instruction-editor';
import { ImpactReport } from './components/impact-report';
import { CampaignCommandView } from './components/campaign-command-view';
import { CommandCenterPage } from './components/command-center-page';
import { TopNav } from './components/top-nav';
import type { Page } from './app-nav';
import type { WorkspaceSummaryDto } from './api/client';
import type { DemoMode } from './flow/demo-flow';


export function App() {
  const auth = useAuth();
  const { toast, show } = useToast();
  // Command Center is the default landing (Atria v2 P1) — the operating hub, not the chat.
  const [page, setPage] = useState<Page>('command-center');
  const [activeCampaign, setActiveCampaign] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState<DemoMode>('safe');
  const [refreshKey, setRefreshKey] = useState(0);
  const [flowPosts, setFlowPosts] = useState<PostDto[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignDto[]>([]);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [savedRuns, setSavedRuns] = useState<SavedRunDto[]>([]);
  const [resumableRuns, setResumableRuns] = useState<Array<{ id: string; name: string | null; status: string; chatSessionId: string | null; updatedAt: string }>>([]);
  const [chatSessions, setChatSessions] = useState<AgentChatSessionDto[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [orchestrateRestore, setOrchestrateRestore] = useState<OrchestrateRestore | null>(null);
  // Command typed on the Command Center, carried once into a fresh Orchestrate composer.
  const [orchestratePrefill, setOrchestratePrefill] = useState<string | null>(null);
  // Set true only when the CC voice button opens the chat → OrchestratePanel enters hands-free voice
  // mode on mount. Cleared by every other open path so a normal chat never auto-listens.
  const [orchestrateAutoVoice, setOrchestrateAutoVoice] = useState(false);
  // Top-nav-owned state (Command Center Unification P1): credits + workspaces feed the global top bar;
  // a workspace picked in the top-nav Workspace menu opens on the Command Center via openWorkspaceId.
  const [credits, setCredits] = useState<number | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummaryDto[]>([]);
  const [openWorkspaceId, setOpenWorkspaceId] = useState<string | null>(null);
  // Explicit "chat is open in the CC" flag (NOT derived from prefill) so consuming the prefill after
  // the first auto-send doesn't close the chat — and, crucially, a remount (tab switch / refresh) no
  // longer re-fires the auto-send (was: duplicate LLM call every time you returned to the CC).
  const [ccChatOpen, setCcChatOpen] = useState(false);
  // Voice unification (P1): the OrchestratePanel owns the STT/TTS machine; App mirrors its state so the
  // Command Center core can reflect + toggle it (one persistent, two-way control). Ref = imperative toggle.
  const voicePanelRef = useRef<OrchestrateHandle>(null);
  const [voiceUi, setVoiceUi] = useState<{ mode: boolean; state: VoiceState }>({ mode: false, state: 'idle' });
  const handleVoiceChange = useCallback(
    (v: { mode: boolean; state: VoiceState }) => setVoiceUi((p) => (p.mode === v.mode && p.state === v.state ? p : v)),
    [],
  );
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
    setOrchestrateAutoVoice(false); // resuming a chat is not a voice launch
    setOrchestrateRestore({
      sessionId: id,
      messages: r.data.messages.map((m) => ({ role: m.role, content: m.content })),
      run: runRes.ok ? runRes.data : null,
    });
    setCcChatOpen(true);
    setPage('command-center'); // chat now hosted INSIDE the Command Center (P2.3)
  };

  const openOrchestrate = () => { setOrchestrateRestore(null); setActiveChatId(null); setSelectedRunId(null); setOrchestratePrefill(null); setOrchestrateAutoVoice(false); setCcChatOpen(true); setPage('command-center'); };

  // CC voice button → open Atria chat straight into hands-free voice mode (mic in, TTS out).
  const launchVoice = () => { setOrchestrateRestore(null); setActiveChatId(null); setSelectedRunId(null); setOrchestratePrefill(null); setOrchestrateAutoVoice(true); setCcChatOpen(true); setPage('command-center'); };

  // Command bar / Atria core → open the chat, now hosted INSIDE the Command Center (P2.2). A non-empty
  // prefill (a typed command or an accepted Atria suggestion) is a SEND — the panel auto-submits it so
  // the plan appears immediately. The graph collapses to a mini-hero while the transcript is active.
  const launchFromCommandCenter = (prefill?: string) => {
    setOrchestrateRestore(null); setActiveChatId(null); setSelectedRunId(null);
    setOrchestratePrefill(prefill ?? null);
    setOrchestrateAutoVoice(false);
    setCcChatOpen(true);
    setPage('command-center');
  };

  const ccChatActive = ccChatOpen;
  const closeCcChat = () => { voicePanelRef.current?.stopVoice(); setVoiceUi({ mode: false, state: 'idle' }); setCcChatOpen(false); setOrchestratePrefill(null); setOrchestrateRestore(null); setActiveChatId(null); setOrchestrateAutoVoice(false); };

  // Returning to the CC (tab switch / back) with an open chat but no live restore → re-hydrate it from
  // the active session so the conversation reappears WITHOUT re-sending. Only runs on a page transition
  // INTO command-center (not during the live send, where the panel already holds the conversation).
  const prevPage = useRef<Page>('command-center');
  useEffect(() => {
    const entered = prevPage.current !== 'command-center' && page === 'command-center';
    prevPage.current = page;
    if (entered && ccChatOpen && activeChatId && !orchestratePrefill && !orchestrateRestore) {
      void selectChat(activeChatId);
    }
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSavedRuns = async () => {
    const r = await api.listSavedRuns();
    if (r.ok) setSavedRuns(r.data);
  };

  // In-flight Atria email/task runs (paused mid-flight, no campaign) for the CC "Continue where you
  // left off" cards — they surface nowhere else, so without this a run paused at an approval gate is
  // reachable only by remembering its chat. Refreshed on the same signals as chats/saved flows.
  const loadResumableRuns = async () => {
    const r = await api.listResumableRuns();
    if (r.ok) setResumableRuns(r.data);
  };

  // Dismiss a "Continue where you left off" card = delete the underlying item (the user's own clutter):
  // a chat, an in-flight run, or a saved flow. The ✕ click IS the consent, so no extra confirm; a
  // running run refuses (409) rather than orphaning its executor. Refresh only the affected list.
  const dismissResumeItem = async (kind: 'run' | 'chat' | 'flow', id: string) => {
    const r = kind === 'chat' ? await api.deleteAgentChat(id) : await api.deleteRun(id);
    if (!r.ok) { show(`Couldn't delete: ${r.error.error}`, 'err'); return; }
    if (kind === 'chat') void loadChats();
    else if (kind === 'run') void loadResumableRuns();
    else void loadSavedRuns();
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

  // ── Top-nav data + actions (P1) ────────────────────────────────────────────────────────────────
  const loadCredits = async () => { const r = await api.getUsage(); if (r.ok) setCredits(r.data.credits ?? null); };
  const loadWorkspaces = async () => { const r = await api.listWorkspaces(); if (r.ok) setWorkspaces(r.data); };

  // Delete a chat by id (top-nav Chats menu → no event object like the old sidebar row).
  const deleteChatById = async (id: string) => {
    const chat = chatSessions.find((c) => c.id === id);
    if (!chat || !confirm(`Delete “${chat.title}”?`)) return;
    const r = await api.deleteAgentChat(id);
    if (!r.ok) { show(`Delete failed: ${r.error.error}`, 'err'); return; }
    setChatSessions((prev) => prev.filter((c) => c.id !== id));
    setActiveChatId((cur) => (cur === id ? null : cur));
    show('Chat deleted');
  };

  // Delete a workspace (campaign) from the top-nav Workspace menu.
  const deleteWorkspaceFromNav = async (campaignId: string, name: string) => {
    if (!confirm(`Delete workspace “${name}”? All posts in it will be deleted.`)) return;
    const r = await api.deleteCampaign(campaignId);
    if (!r.ok) { show(`Delete failed: ${r.error.error}`, 'err'); return; }
    setWorkspaces((prev) => prev.filter((w) => w.campaignId !== campaignId));
    setCampaigns((prev) => prev.filter((c) => c.id !== campaignId));
    if (openWorkspaceId === campaignId) setOpenWorkspaceId(null);
    show('Workspace deleted');
  };

  // Open a workspace from the top-nav: land on the Command Center and let it open the drawer.
  const openWorkspaceFromNav = (campaignId: string) => { setOpenWorkspaceId(campaignId); setPage('command-center'); };

  // Create a campaign under a flow (blueprint CTA "New campaign from this flow").
  const createCampaignForFlow = async (flowId: string | null) => {
    const product = prompt('New campaign — strategy or offer name (e.g. "Product launch", "Competitor comparison"):')?.trim();
    if (!product) return;
    const r = await api.createCampaign({ product, ...(flowId ? { flowId } : {}) });
    if (!r.ok) { show(`Create failed: ${r.error.error}`, 'err'); return; }
    setCampaigns((prev) => [r.data, ...prev]);
    setActiveCampaign(r.data.id); setSelectedPostId(null); setSelectedRunId(null); setPage('flows');
    show(`Campaign “${product}” created`);
  };


  useEffect(() => {
    if (!auth.user) return;
    void api.listCampaigns().then((r) => { if (r.ok) setCampaigns(r.data); });
    void loadChats();
    void loadSavedRuns();
    void loadResumableRuns();
    void loadAllPosts();
    void loadCredits();
    void loadWorkspaces();
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

  // The live chat panel — built once, hosted INSIDE the Command Center via chatSlot (P2.5: the
  // standalone orchestrate page is gone). One source of truth for all its wiring
  // (restore/prefill/run cards/SSE/connection gate).
  const orchestratePanelEl = (
    <OrchestratePanel
      key={orchestrateRestore?.sessionId ?? 'new'}
      ref={voicePanelRef}
      restore={orchestrateRestore}
      initialInput={orchestratePrefill ?? undefined}
      autoStart={Boolean(orchestratePrefill)}
      onAutoStarted={() => setOrchestratePrefill(null)}
      autoVoice={orchestrateAutoVoice}
      onVoiceChange={handleVoiceChange}
      flowsWithoutStrategy={flowsWithoutStrategy}
      chats={chatSessions.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }))}
      notify={show}
      onRunActivity={(sessionId) => { void loadChats(); void loadResumableRuns(); if (!activeChatId) setActiveChatId(sessionId); bump(); }}
      onSaved={() => { void loadSavedRuns(); void loadResumableRuns(); }}
      onSetupCampaign={(runId) => { void loadSavedRuns().then(() => setupFirstCampaign(runId)); }}
      onOpenFlow={(runId) => { void loadSavedRuns().then(() => openSavedFlow(runId)); }}
      onResumeChat={(id) => void selectChat(id)}
      onCampaignCreated={(campaignId, postId) => { void openCreatedCampaign(campaignId, postId); }}
    />
  );

  return (
    <div className="app-root">
      <TopNav
        page={page}
        onNavigate={(p) => { setSelectedRunId(null); if (p !== 'flows') { setActiveCampaign(null); setSelectedPostId(null); } if (p === 'command-center') closeCcChat(); setPage(p); }}
        credits={credits}
        userEmail={auth.user.email}
        workspaces={workspaces}
        onOpenWorkspace={openWorkspaceFromNav}
        onContinueChat={(id) => void selectChat(id)}
        onDeleteWorkspace={(id, name) => void deleteWorkspaceFromNav(id, name)}
        chats={chatSessions}
        activeChatId={activeChatId}
        onSelectChat={(id) => void selectChat(id)}
        onDeleteChat={(id) => void deleteChatById(id)}
      />

      <main className="app-main">
        {page === 'command-center' ? (
          <CommandCenterPage
            onLaunch={launchFromCommandCenter}
            openWorkspaceId={openWorkspaceId}
            onOpenWorkspaceConsumed={() => setOpenWorkspaceId(null)}
            onOpenConnections={() => { setSelectedRunId(null); setPage('connections'); }}
            onOpenBoard={(id) => { setActiveCampaign(id); setSelectedPostId(null); setSelectedRunId(null); setPage('flows'); }}
            resumeChats={chatSessions
              .filter((c) => !resumableRuns.some((run) => run.chatSessionId === c.id))
              .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }))}
            resumeFlows={flowsWithoutStrategy}
            resumeRuns={resumableRuns.filter((run) => run.chatSessionId).map((run) => ({ id: run.id, name: run.name, status: run.status, chatSessionId: run.chatSessionId!, updatedAt: run.updatedAt }))}
            onResumeChat={(id) => void selectChat(id)}
            onOpenFlow={(id) => openSavedFlow(id)}
            onStartVoice={launchVoice}
            onDismissResume={dismissResumeItem}
            chatActive={ccChatActive}
            chatSlot={orchestratePanelEl}
            voice={{ mode: voiceUi.mode, state: voiceUi.state, onToggle: () => voicePanelRef.current?.toggleVoice() }}
            notify={show}
          />
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
        ) : page === 'scheduled' ? (
          <div className="master-home">
            <ScheduledView notify={show} onOpenPost={(campaignId, postId) => { setActiveCampaign(campaignId); setSelectedPostId(postId); setSelectedRunId(null); setPage('flows'); }} />
          </div>
        ) : page === 'instructions' ? (
          <div className="master-home">
            <InstructionEditor scope="workspace" notify={show} />
          </div>
        ) : page === 'impact' ? (
          <div className="master-home atria-home-stack">
            {activeCampaign && (
              <>
                <CampaignCommandView campaignId={activeCampaign} />
                <ImpactReport campaignId={activeCampaign} />
              </>
            )}
            <ImpactReport period="30d" />
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
