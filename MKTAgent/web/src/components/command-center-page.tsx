// Atria Command Center — the operating HUB (Atria v2 P1). A page-scoped dark "Neural Network"
// surface rendering REAL registry nodes (GET /orchestration/agents) grouped by division + the live
// credit total (GET /orchestration/usage). v2: it is no longer a funnel — clicking a node opens an
// INLINE drawer (WorkspacePanel / AgentSpotlight over the P0 workspace view-model), not a redirect.
// Only the Atria core + the command bar hand off to the Orchestrate chat (onLaunch); ⌂ Workspace
// exits to the classic UI (onExit). Dark theme stays confined to `.command-center`; the drawer is
// light so embedded post views keep native styling.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type AgentCatalog, type AgentNodeDto, type WorkspaceSummaryDto, type DerivedPostStatus } from '../api/client';
import { WorkspacePanel } from './workspace-panel';
import { AgentSpotlight } from './agent-spotlight';
import { MemoryPanel } from './memory-panel';
import { ImpactReport } from './impact-report';
import { LeadsPage } from './LeadsPage';

interface Props {
  // Hand off to the live Orchestrate chat (Atria core / command bar), optionally seeding the composer.
  onLaunch: (prefill?: string) => void;
  // Leave the command center for the normal workspace (current UI/UX).
  onExit: () => void;
  // Open the Connections page (bubbled up from an embedded PostWorkflowView's connection gate).
  onOpenConnections?: () => void;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

// Inline drawer target: a workspace room, an agent spotlight, or a live agent surface (Memory).
type Panel =
  | { kind: 'workspace'; campaignId: string }
  | { kind: 'agent'; agent: AgentNodeDto }
  | { kind: 'surface'; surface: string; agent: AgentNodeDto };

const STATUS_COLOR: Record<DerivedPostStatus, string> = {
  planned: '#9aa0a6', running: '#1a73e8', held: '#f9ab00', posted: '#188038', failed: '#d93025',
};

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

export function CommandCenterPage({ onLaunch, onExit, onOpenConnections, notify }: Props) {
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummaryDto[]>([]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [cmd, setCmd] = useState('');

  useEffect(() => {
    void api.getAgents().then((r) => {
      if (r.ok) setCatalog(r.data);
      else notify(`Agents: ${r.error.error}`, 'err');
    });
    void api.getUsage().then((r) => { if (r.ok) setCredits(r.data.credits); });
    void api.listWorkspaces().then((r) => { if (r.ok) setWorkspaces(r.data); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const colorOf = useMemo(() => {
    const map = new Map((catalog?.groups ?? []).map((g) => [g.id, g.color]));
    return (a: AgentNodeDto) => map.get(a.group) ?? '#9d7bff';
  }, [catalog]);

  const agents = catalog?.agents ?? [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onLaunch(cmd.trim() || undefined);
  };

  return (
    <div className="command-center">
      <div className="cc-topbar">
        <span className="cc-logo" />
        <span className="cc-brand">Atria</span>
        <span className="cc-tag">Command Center</span>
        <div className="cc-topbar-right">
          <span className="cc-credit" title="Tổng credit đã dùng (minh bạch token → credit)">
            ◈ {credits === null ? '—' : credits.toLocaleString()} credits
          </span>
          <button className="cc-exit" onClick={onExit}>⌂ Workspace</button>
        </div>
      </div>

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

      {workspaces.length > 0 && (
        <div className="cc-ws-strip">
          <span className="cc-ws-strip-label">Workspaces</span>
          {workspaces.map((w) => {
            const dots = (['running', 'held', 'failed', 'posted', 'planned'] as DerivedPostStatus[]).filter((k) => w.counts[k] > 0);
            return (
              <button
                key={w.campaignId}
                className={`cc-ws-chip ${panel?.kind === 'workspace' && panel.campaignId === w.campaignId ? 'is-active' : ''}`}
                onClick={() => setPanel({ kind: 'workspace', campaignId: w.campaignId })}
                title={`${w.postCount} post(s) · ◈ ${Math.round(w.credits).toLocaleString()} cr`}
              >
                <span className="cc-ws-chip-dots">
                  {dots.length === 0
                    ? <span className="ws-dot" style={{ background: STATUS_COLOR.planned }} />
                    : dots.map((k) => <span key={k} className="ws-dot" style={{ background: STATUS_COLOR[k] }} />)}
                </span>
                {w.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="cc-network">
        <button className="cc-core" onClick={() => onLaunch()}>
          <span className="cc-core-label">Master Agent</span>
          <span className="cc-core-name">Atria</span>
          <span className="cc-core-sub">Nhạc trưởng</span>
        </button>
        <svg className="cc-links" viewBox="0 0 100 100" preserveAspectRatio="none">
          {agents.map((a, i) => {
            const ang = (i / agents.length) * Math.PI * 2 - Math.PI / 2;
            return (
              <line
                key={a.id}
                x1={50} y1={50}
                x2={50 + Math.cos(ang) * 42} y2={50 + Math.sin(ang) * 40}
                stroke={colorOf(a)} strokeOpacity={0.22} strokeWidth={0.3} strokeDasharray="1 1.3"
              />
            );
          })}
        </svg>
        {agents.map((a, i) => {
          const planned = a.implStatus === 'planned';
          return (
            <button
              key={a.id}
              className={`cc-node ${a.implStatus === 'stub' ? 'is-stub' : ''} ${planned ? 'is-planned' : ''} ${(panel?.kind === 'agent' || panel?.kind === 'surface') && panel.agent.id === a.id ? 'is-active' : ''}`}
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

      {panel && (
        <>
          <div className="cc-drawer-scrim" onClick={() => setPanel(null)} />
          <aside className="cc-drawer" role="dialog" aria-label="Workspace panel">
            <div className="cc-drawer-chrome">
              <span className="cc-drawer-kind">{panel.kind === 'workspace' ? '▦ Workspace' : panel.kind === 'surface' ? '✨ Agent surface' : '◆ Agent'}</span>
              <button className="cc-drawer-close" aria-label="Close panel" onClick={() => setPanel(null)}>✕</button>
            </div>
            {panel.kind === 'workspace' ? (
              <WorkspacePanel campaignId={panel.campaignId} notify={notify} onOpenConnections={onOpenConnections} />
            ) : panel.kind === 'surface' && panel.surface === 'memory' ? (
              <MemoryPanel notify={notify} />
            ) : panel.kind === 'surface' && panel.surface === 'impact' ? (
              <div className="cc-drawer-body"><ImpactReport period="30d" /></div>
            ) : panel.kind === 'surface' && panel.surface === 'leads' ? (
              <div className="cc-drawer-body"><LeadsPage notify={notify} /></div>
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
