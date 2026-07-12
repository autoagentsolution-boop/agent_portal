// Atria Command Center — the operating HUB (Atria v2 P1). A page-scoped dark "Neural Network"
// surface rendering REAL registry nodes (GET /orchestration/agents) grouped by division + the live
// credit total (GET /orchestration/usage). v2: it is no longer a funnel — clicking a node opens an
// INLINE drawer (WorkspacePanel / AgentSpotlight over the P0 workspace view-model), not a redirect.
// Only the Atria core + the command bar hand off to the Orchestrate chat (onLaunch); ⌂ Workspace
// exits to the classic UI (onExit). Dark theme stays confined to `.command-center`; the drawer is
// light so embedded post views keep native styling.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode, type CSSProperties } from 'react';
import { api, type AgentCatalog, type AgentNodeDto } from '../api/client';
import { WorkspacePanel } from './workspace-panel';
import { AgentSpotlight } from './agent-spotlight';
import { MemoryPanel } from './memory-panel';
import { ImpactReport } from './impact-report';
import { LeadsPage } from './LeadsPage';
import { EmailPanel } from './email-panel';
import { AtriaSuggestionCards } from './atria-suggestion-cards';
import { AtriaResumeWorkCards } from './atria-resume-work-cards';
import { useAgentActivity } from '../hooks/use-agent-activity';

interface Props {
  // Hand off to the live Orchestrate chat (Atria core / command bar), optionally seeding the composer.
  onLaunch: (prefill?: string) => void;
  // A workspace picked in the global top-nav Workspace menu opens its drawer here (P1). Null = none.
  openWorkspaceId?: string | null;
  onOpenWorkspaceConsumed?: () => void;
  // Open the Connections page (bubbled up from an embedded PostWorkflowView's connection gate).
  onOpenConnections?: () => void;
  // P2.6 — open the deep board (PostBoard + DAG) for a workspace from its dashboard drawer.
  onOpenBoard?: (campaignId: string) => void;
  // Atria's proactive surface, promoted from the Orchestrate empty-state onto the CC home (P2.0):
  // resume a hung chat/flow. Cards self-fetch their suggestions; these feed the "resume work" row.
  resumeChats?: Array<{ id: string; title: string; updatedAt: string }>;
  resumeFlows?: Array<{ id: string; name: string }>;
  resumeRuns?: Array<{ id: string; name: string | null; status: string; chatSessionId: string; updatedAt: string }>;
  onResumeChat?: (id: string) => void;
  onOpenFlow?: (id: string) => void;
  // The live chat, hosted inside the CC (P2.1-2.3). When chatActive, the graph collapses to a
  // mini-hero and chatSlot (the OrchestratePanel, wired in App) renders below. onCloseChat returns home.
  chatActive?: boolean;
  chatSlot?: ReactNode;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

// Inline drawer target: a workspace room, an agent spotlight, or a live agent surface (Memory).
type Panel =
  | { kind: 'workspace'; campaignId: string }
  | { kind: 'agent'; agent: AgentNodeDto }
  | { kind: 'surface'; surface: string; agent: AgentNodeDto };

const QUICK_CMDS = [
  'Tạo chiến dịch marketing cho sản phẩm mới',
  'Nghiên cứu đối thủ rồi viết nội dung',
  'Thu thập leads từ chiến dịch social (opt-in)',
];

// Position N nodes evenly on an ellipse, starting at the top (−90°). Mirrors the mockup's
// buildNetwork layout so the visual reads the same, but driven by real registry data.
const nodePos = (i: number, total: number): { left: string; top: string } => {
  const ang = (i / total) * Math.PI * 2 - Math.PI / 2;
  return { left: `${50 + Math.cos(ang) * 42}%`, top: `${50 + Math.sin(ang) * 40}%` };
};

export function CommandCenterPage({ onLaunch, openWorkspaceId, onOpenWorkspaceConsumed, onOpenConnections, onOpenBoard, resumeChats = [], resumeFlows = [], resumeRuns = [], onResumeChat, onOpenFlow, chatActive = false, chatSlot, notify }: Props) {
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [cmd, setCmd] = useState('');
  // Suggestions already acted on — held HERE (CommandCenterPage survives the chat open/close toggle)
  // so a card doesn't reappear after you leave+return the chat and let you re-fire the same plan.
  const [actedSuggestions, setActedSuggestions] = useState<Set<string>>(new Set());

  useEffect(() => {
    void api.getAgents().then((r) => {
      if (r.ok) setCatalog(r.data);
      else notify(`Agents: ${r.error.error}`, 'err');
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A workspace selected in the global top-nav opens its drawer here, then clears the request.
  useEffect(() => {
    if (!openWorkspaceId) return;
    setPanel({ kind: 'workspace', campaignId: openWorkspaceId });
    onOpenWorkspaceConsumed?.();
  }, [openWorkspaceId, onOpenWorkspaceConsumed]);

  const colorOf = useMemo(() => {
    const map = new Map((catalog?.groups ?? []).map((g) => [g.id, g.color]));
    return (a: AgentNodeDto) => map.get(a.group) ?? '#9d7bff';
  }, [catalog]);

  const agents = catalog?.agents ?? [];

  // W1 — live node light-up: the set of agents whose node is `running` right now (any run). Drives
  // the "agents gather + work" moment. Only subscribe once the graph has nodes to light.
  const activeAgents = useAgentActivity(agents.length > 0);
  const anyRunning = activeAgents.size > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onLaunch(cmd.trim() || undefined);
  };


  return (
    <div className={`command-center ${chatActive ? 'is-chat' : ''}`}>
      {!chatActive && (
      <div className="cc-head">
        <div className="cc-eyebrow">Neural Network</div>
        <h1>Trung tâm điều hành AI của bạn</h1>
        <p>Chạm vào một agent để bắt đầu điều phối. Mọi hành động đều dẫn về không gian làm việc hiện tại.</p>
        <div className="cc-legend">
          {(catalog?.groups ?? []).map((g) => (
            <span className="cc-legend-item" key={g.id}>
              <span className="cc-legend-dot" style={{ background: g.color, boxShadow: `0 0 8px ${g.color}` }} />
              {g.emoji} {g.label}
            </span>
          ))}
        </div>
      </div>
      )}

      <div className={`cc-network ${anyRunning ? 'is-conducting' : ''}`}>
        <button className={`cc-core ${anyRunning ? 'is-conducting' : ''}`} onClick={() => onLaunch()}>
          <span className="cc-core-fx" aria-hidden="true">
            <span className="cc-ring cc-ring-1" />
            <span className="cc-ring cc-ring-2" />
            <span className="cc-ring cc-ring-3" />
            <span className="cc-reticle cc-reticle-out" />
            <span className="cc-reticle cc-reticle-in" />
            <span className="cc-core-orb" />
          </span>
          <span className="cc-core-label">Master Agent</span>
          <span className="cc-core-name">Atria</span>
          <span className="cc-core-sub">Nhạc trưởng</span>
        </button>
        <svg className="cc-links" viewBox="0 0 100 100" preserveAspectRatio="none">
          {agents.map((a, i) => {
            const ang = (i / agents.length) * Math.PI * 2 - Math.PI / 2;
            const on = activeAgents.has(a.id); // energy flows along an edge whose agent is working
            return (
              <line
                key={a.id}
                className={on ? 'cc-link-live' : ''}
                x1={50} y1={50}
                x2={50 + Math.cos(ang) * 42} y2={50 + Math.sin(ang) * 40}
                stroke={colorOf(a)} strokeOpacity={on ? 0.85 : 0.22} strokeWidth={on ? 0.7 : 0.3} strokeDasharray="1 1.3"
              />
            );
          })}
        </svg>
        {/* Data-flow dots: a violet dot dispatches Atria→agent (ambient at idle). When SSE says an
            agent is running, it bursts fast AND an agent-coloured "ack" dot returns agent→Atria.
            Positions mirror nodePos(); pure CSS motion (prefers-reduced-motion calms it). */}
        <div className="cc-flows" aria-hidden="true">
          {agents.map((a, i) => {
            const pos = nodePos(i, agents.length);
            return (
              <span
                key={`flow-${a.id}`}
                className={`cc-flow ${activeAgents.has(a.id) ? 'is-active' : ''}`}
                style={{ '--x2': pos.left, '--y2': pos.top, '--i': i, '--ret': colorOf(a) } as CSSProperties}
              >
                <span className="cc-flow-out" />
                <span className="cc-flow-ret" />
              </span>
            );
          })}
        </div>
        {agents.map((a, i) => {
          const planned = a.implStatus === 'planned';
          const running = activeAgents.has(a.id);
          return (
            <button
              key={a.id}
              className={`cc-node ${a.implStatus === 'stub' ? 'is-stub' : ''} ${planned ? 'is-planned' : ''} ${running ? 'is-running' : ''} ${(panel?.kind === 'agent' || panel?.kind === 'surface') && panel.agent.id === a.id ? 'is-active' : ''}`}
              style={nodePos(i, agents.length)}
              onClick={() =>
                planned ? notify(`${a.name} — sắp ra mắt`)
                : a.surface ? setPanel({ kind: 'surface', surface: a.surface, agent: a })
                : setPanel({ kind: 'agent', agent: a })}
              title={planned ? `${a.name} (sắp ra mắt) — ${a.vibe ?? a.description}` : (a.vibe ?? a.description)}
            >
              <span className="cc-node-circle" style={{ borderColor: colorOf(a) }}>
                <span className="cc-node-emoji">{a.emoji}</span>
                {planned && <span className="cc-node-soon">soon</span>}
              </span>
              <span className="cc-node-label">{a.name.replace(/ Agent$/, '')}</span>
            </button>
          );
        })}
        {agents.length === 0 && <div className="cc-network-empty">Đang tải mạng lưới agent…</div>}
      </div>

      {chatActive ? (
        <div className="cc-chat-embed">
          {chatSlot}
        </div>
      ) : (
      <>
      <form className="cc-cmdbar-wrap" onSubmit={submit}>
        <div className="cc-cmdbar">
          <input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            placeholder="Ra lệnh cho Atria bằng ngôn ngữ tự nhiên…"
          />
          <button type="submit" className="cc-send" aria-label="Gửi">➤</button>
        </div>
        <div className="cc-quick">
          {QUICK_CMDS.map((q) => (
            <button type="button" className="cc-quick-cmd" key={q} onClick={() => setCmd(q)}>{q}</button>
          ))}
        </div>
        <div className="cc-hint">Atria tự nhận diện ngôn ngữ, xác nhận cách hiểu, rồi đề xuất phương án kèm chi phí.</div>
      </form>

      {/* Atria's proactive surface on the home (P2.0) — reminders + resume hung work, promoted from the
          old Orchestrate empty-state so the operator sees them without entering a chat. */}
      <div className="cc-atria-surface">
        <section className="cc-atria-block">
          <h3 className="atria-section-title">Nhắc nhở từ Atria</h3>
          <AtriaSuggestionCards
            notify={notify}
            onPlanCampaign={(t) => onLaunch(t)}
            acted={actedSuggestions}
            onAct={(kind) => setActedSuggestions((s) => new Set(s).add(kind))}
          />
        </section>
        {(resumeChats.length > 0 || resumeFlows.length > 0 || resumeRuns.length > 0) && onResumeChat && onOpenFlow && (
          <AtriaResumeWorkCards
            chats={resumeChats.slice(0, 4)}
            flows={resumeFlows.slice(0, 4)}
            runs={resumeRuns.slice(0, 4)}
            onResumeChat={onResumeChat}
            onOpenFlow={onOpenFlow}
          />
        )}
      </div>
      </>
      )}

      {panel && (
        <>
          <div className="cc-drawer-scrim" onClick={() => setPanel(null)} />
          <aside className="cc-drawer" role="dialog" aria-label="Workspace panel">
            <div className="cc-drawer-chrome">
              <span className="cc-drawer-kind">{panel.kind === 'workspace' ? '▦ Workspace' : panel.kind === 'surface' ? '✨ Agent surface' : '◆ Agent'}</span>
              <button className="cc-drawer-close" aria-label="Close panel" onClick={() => setPanel(null)}>✕</button>
            </div>
            {panel.kind === 'workspace' ? (
              <WorkspacePanel campaignId={panel.campaignId} notify={notify} onOpenConnections={onOpenConnections} onOpenBoard={onOpenBoard ? () => onOpenBoard(panel.campaignId) : undefined} />
            ) : panel.kind === 'surface' && panel.surface === 'memory' ? (
              <MemoryPanel notify={notify} />
            ) : panel.kind === 'surface' && panel.surface === 'impact' ? (
              <div className="cc-drawer-body"><ImpactReport period="30d" /></div>
            ) : panel.kind === 'surface' && panel.surface === 'leads' ? (
              <div className="cc-drawer-body"><LeadsPage notify={notify} /></div>
            ) : panel.kind === 'surface' && panel.surface === 'email' ? (
              <EmailPanel notify={notify} />
            ) : panel.kind === 'surface' ? (
              <AgentSpotlight agent={panel.agent} notify={notify} onOpenWorkspace={(campaignId) => setPanel({ kind: 'workspace', campaignId })} />
            ) : (
              <AgentSpotlight
                agent={panel.agent}
                notify={notify}
                onOpenWorkspace={(campaignId) => setPanel({ kind: 'workspace', campaignId })}
              />
            )}
          </aside>
        </>
      )}
    </div>
  );
}
