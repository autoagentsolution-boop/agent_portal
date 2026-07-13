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
  onStartVoice?: () => void;
  onDismissResume?: (kind: 'run' | 'chat' | 'flow', id: string) => void;
  // The live chat, hosted inside the CC (P2.1-2.3). When chatActive, the graph collapses to a
  // mini-hero and chatSlot (the OrchestratePanel, wired in App) renders below. onCloseChat returns home.
  chatActive?: boolean;
  chatSlot?: ReactNode;
  // Voice unification (P1): live voice state (owned by the embedded OrchestratePanel) + a two-way toggle.
  // In chat mode the Atria core IS this control — one persistent button that turns hands-free voice on/off
  // and stays large + central (no collapse). The core's glow already rides global root attrs.
  voice?: { mode: boolean; state: 'idle' | 'listening' | 'thinking' | 'speaking'; onToggle: () => void };
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

// Inline drawer target: a workspace room, an agent spotlight, or a live agent surface (Memory).
type Panel =
  | { kind: 'workspace'; campaignId: string }
  | { kind: 'agent'; agent: AgentNodeDto }
  | { kind: 'surface'; surface: string; agent: AgentNodeDto };

const QUICK_CMDS = [
  'Create a marketing campaign for a new product',
  'Research competitors, then write content',
  'Collect leads from a social campaign (opt-in)',
];

// Position N nodes evenly on an ellipse, starting at the top (−90°). Mirrors the mockup's
// buildNetwork layout so the visual reads the same, but driven by real registry data.
// Grouped constellation geometry (2 tiers: Atria → group → agent). Group nodes ring Atria at a slightly
// tighter radius so an expanded group's members fan OUTWARD without leaving the frame. `ang` is the
// group's outward direction from Atria, reused to centre its member arc.
interface GroupGeo { ang: number; x: number; y: number }
const groupGeo = (i: number, total: number): GroupGeo => {
  const ang = (i / total) * Math.PI * 2 - Math.PI / 2;
  // Vertical radius is kept smaller than horizontal: the container is short, and the top/bottom groups'
  // members fan outward vertically — a tighter Y keeps the top group's expansion clear of the header.
  // Radii pushed out so the groups sit clear of Atria's outer glow ring (more breathing room).
  return { ang, x: 50 + Math.cos(ang) * 40, y: 50 + Math.sin(ang) * 32 };
};
// Member j of a group: placed on an arc around the GROUP node, centred on its outward direction so the
// members read as "inside" that group and never overlap Atria. The arc is WIDE (up to ~200°, wrapping
// the outer side of the group node) so the circles stay well separated as the member count grows — the
// wider the fan, the more tangential the extreme members sit, which also keeps them inside the frame.
// The container is wider than tall, so we give the vertical radius more % to counter the squash; labels
// are hover-revealed (see CSS) so this only has to keep the *circles* apart, not full label boxes.
const memberGeo = (g: GroupGeo, j: number, count: number): { left: string; top: string; xy: [number, number] } => {
  const spread = count <= 1 ? 0 : Math.min(Math.PI * 1.15, 0.5 * count + 0.5);
  const a = g.ang + (count <= 1 ? 0 : spread * (j / (count - 1) - 0.5));
  // Members pushed further out from their group node for clearer separation.
  const x = g.x + Math.cos(a) * 18;
  const y = g.y + Math.sin(a) * 18;
  return { left: `${x}%`, top: `${y}%`, xy: [x, y] };
};

// Web Speech API support (Chrome/Edge) — gate the mic button so it never shows a dead control.
const VOICE_SUPPORTED = typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

export function CommandCenterPage({ onLaunch, openWorkspaceId, onOpenWorkspaceConsumed, onOpenConnections, onOpenBoard, resumeChats = [], resumeFlows = [], resumeRuns = [], onResumeChat, onOpenFlow, onStartVoice, onDismissResume, chatActive = false, chatSlot, voice, notify }: Props) {
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [cmd, setCmd] = useState('');
  // Suggestions already acted on — held HERE (CommandCenterPage survives the chat open/close toggle)
  // so a card doesn't reappear after you leave+return the chat and let you re-fire the same plan.
  const [actedSuggestions, setActedSuggestions] = useState<Set<string>>(new Set());
  // Grouped constellation: default COLLAPSED (only group nodes). Clicking a group expands its members
  // around that group node; one group open at a time (opening another replaces it).
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

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

  const groups = catalog?.groups ?? [];
  const membersByGroup = useMemo(() => {
    const m = new Map<string, AgentNodeDto[]>();
    for (const a of agents) { const arr = m.get(a.group) ?? []; arr.push(a); m.set(a.group, arr); }
    return m;
  }, [agents]);
  const groupRunning = (gid: string): boolean => (membersByGroup.get(gid) ?? []).some((a) => activeAgents.has(a.id));
  // Open an agent's panel (member click) — planned → "soon" toast, a shipped surface → its inline panel,
  // else the agent spotlight. Unchanged from the flat view, just factored out for reuse by member nodes.
  const openAgent = (a: AgentNodeDto): void => {
    if (a.implStatus === 'planned') notify(`${a.name} — coming soon`);
    else if (a.surface) setPanel({ kind: 'surface', surface: a.surface, agent: a });
    else setPanel({ kind: 'agent', agent: a });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onLaunch(cmd.trim() || undefined);
  };


  return (
    <div className={`command-center ${chatActive ? 'is-chat' : ''}`}>
      {!chatActive && (
      <div className="cc-head">
        <div className="cc-eyebrow">Neural Network</div>
        <h1>Your AI Command Center</h1>
      </div>
      )}

      {(() => {
        const geoList = groups.map((g, i) => ({ g, geo: groupGeo(i, groups.length) }));
        const expanded = geoList.find((x) => x.g.id === expandedGroup) ?? null;
        const members = expanded ? (membersByGroup.get(expanded.g.id) ?? []) : [];
        // In CHAT mode the core is the persistent, two-way VOICE toggle (P1). Otherwise it collapses an
        // open group first (the "back" gesture), else launches the chat.
        const coreClick = () => {
          if (chatActive) { voice?.onToggle(); return; }
          if (expandedGroup) { setExpandedGroup(null); return; }
          onLaunch();
        };
        const vs = chatActive ? (voice?.state ?? 'idle') : null;
        const coreTitle = chatActive
          ? (voice?.mode ? 'Voice on — tap to stop' : 'Tap to talk to Atria')
          : (expandedGroup ? 'Collapse' : 'Open Atria');
        return (
      <div className={`cc-network ${anyRunning ? 'is-conducting' : ''} ${expanded ? 'is-expanded' : ''}`}>
        <button className={`cc-core ${anyRunning ? 'is-conducting' : ''} ${voice?.mode ? 'is-voice-on' : ''} ${vs ? `is-voice-${vs}` : ''}`} onClick={coreClick} title={coreTitle} aria-pressed={chatActive ? Boolean(voice?.mode) : undefined}>
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
          <span className="cc-core-sub">
            {vs === 'listening' ? 'Listening…' : vs === 'thinking' ? 'Thinking…' : vs === 'speaking' ? 'Speaking…' : chatActive ? (voice?.mode ? 'Tap to stop' : '🎙 Tap to talk') : 'Conductor'}
          </span>
        </button>
        <svg className="cc-links" viewBox="0 0 100 100" preserveAspectRatio="none">
          {/* Tier 1: Atria → each group (always). */}
          {geoList.map(({ g, geo }) => {
            const on = groupRunning(g.id);
            return (
              <line key={g.id} className={on ? 'cc-link-live' : ''} x1={50} y1={50} x2={geo.x} y2={geo.y}
                stroke={g.color} strokeOpacity={on ? 0.85 : 0.22} strokeWidth={on ? 0.7 : 0.35} strokeDasharray="1 1.3" />
            );
          })}
          {/* Tier 2: expanded group → its members (energy flows along the sub-edges). */}
          {expanded && members.map((a, j) => {
            const [mx, my] = memberGeo(expanded.geo, j, members.length).xy;
            const on = activeAgents.has(a.id);
            return (
              <line key={`ml-${a.id}`} className="cc-link-live" x1={expanded.geo.x} y1={expanded.geo.y} x2={mx} y2={my}
                stroke={expanded.g.color} strokeOpacity={on ? 0.9 : 0.5} strokeWidth={on ? 0.7 : 0.4} strokeDasharray="1 1.2" />
            );
          })}
        </svg>
        {/* Tier-1 data-flow dots: Atria → group (ambient; burst + return dot when the group is working). */}
        <div className="cc-flows" aria-hidden="true">
          {geoList.map(({ g, geo }, i) => (
            <span key={`flow-${g.id}`} className={`cc-flow ${groupRunning(g.id) ? 'is-active' : ''}`}
              style={{ '--x2': `${geo.x}%`, '--y2': `${geo.y}%`, '--i': i, '--ret': g.color } as CSSProperties}>
              <span className="cc-flow-out" />
              <span className="cc-flow-ret" />
            </span>
          ))}
          {/* Tier-2 dots: group → each member of the expanded group. */}
          {expanded && members.map((a, j) => {
            const m = memberGeo(expanded.geo, j, members.length);
            return (
              <span key={`subflow-${a.id}`} className="cc-flow cc-flow-sub is-active"
                style={{ '--x1': `${expanded.geo.x}%`, '--y1': `${expanded.geo.y}%`, '--x2': m.left, '--y2': m.top, '--i': j, '--ret': expanded.g.color } as CSSProperties}>
                <span className="cc-flow-out" />
              </span>
            );
          })}
        </div>
        {/* Tier-1 group nodes (default collapsed view). Clicking toggles its expansion. */}
        {geoList.map(({ g, geo }) => {
          const count = (membersByGroup.get(g.id) ?? []).length;
          const isOpen = expandedGroup === g.id;
          return (
            <button
              key={g.id}
              className={`cc-group ${groupRunning(g.id) ? 'is-running' : ''} ${isOpen ? 'is-expanded' : ''}`}
              style={{ left: `${geo.x}%`, top: `${geo.y}%` }}
              onClick={() => setExpandedGroup((cur) => (cur === g.id ? null : g.id))}
              title={`${g.label} · ${count} agent`}
            >
              <span className="cc-group-circle" style={{ borderColor: g.color, boxShadow: `0 0 18px ${g.color}55` }}>
                <span className="cc-group-emoji">{g.emoji}</span>
                <span className="cc-group-count" style={{ background: g.color }}>{count}</span>
              </span>
              <span className="cc-group-label">{g.label}</span>
            </button>
          );
        })}
        {/* Tier-2 member nodes — only the expanded group's, fanned around its group node. */}
        {expanded && members.map((a, j) => {
          const planned = a.implStatus === 'planned';
          const running = activeAgents.has(a.id);
          const pos = memberGeo(expanded.geo, j, members.length);
          return (
            <button
              key={a.id}
              className={`cc-node cc-node-member ${a.implStatus === 'stub' ? 'is-stub' : ''} ${planned ? 'is-planned' : ''} ${running ? 'is-running' : ''} ${(panel?.kind === 'agent' || panel?.kind === 'surface') && panel.agent.id === a.id ? 'is-active' : ''}`}
              style={{ left: pos.left, top: pos.top }}
              onClick={() => openAgent(a)}
              title={planned ? `${a.name} (coming soon) — ${a.vibe ?? a.description}` : (a.vibe ?? a.description)}
            >
              <span className="cc-node-circle" style={{ borderColor: colorOf(a) }}>
                <span className="cc-node-emoji">{a.emoji}</span>
                {planned && <span className="cc-node-soon">soon</span>}
              </span>
              <span className="cc-node-label">{a.name.replace(/ Agent$/, '')}</span>
            </button>
          );
        })}
        {agents.length === 0 && <div className="cc-network-empty">Loading agent network…</div>}
      </div>
        );
      })()}

      {chatActive ? (
        <div className="cc-chat-embed">
          {chatSlot}
        </div>
      ) : (
      <>
      {/* Expanded group's members, spelled out as a wrapping chip row (all names at a glance, no node
          overlap — complements the hover-revealed labels on the graph; scales by wrapping). */}
      {expandedGroup && (() => {
        const g = groups.find((x) => x.id === expandedGroup);
        const members = membersByGroup.get(expandedGroup) ?? [];
        if (!g || members.length === 0) return null;
        return (
          <div className="cc-member-legend">
            <span className="cc-member-legend-head" style={{ color: g.color }}>{g.emoji} {g.label}</span>
            {members.map((a) => (
              <button key={a.id} className="cc-member-chip" style={{ borderColor: `${g.color}66` }} onClick={() => openAgent(a)}>
                <span>{a.emoji}</span> {a.name.replace(/ Agent$/, '')}
              </button>
            ))}
          </div>
        );
      })()}
      <form className="cc-cmdbar-wrap" onSubmit={submit}>
        <div className="cc-cmdbar">
          <input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            placeholder="Command Atria in natural language…"
          />
          {VOICE_SUPPORTED && onStartVoice && (
            <button type="button" className="cc-mic" aria-label="Voice chat with Atria" title="Voice chat with Atria" onClick={onStartVoice}>🎙️</button>
          )}
          <button type="submit" className="cc-send" aria-label="Send">➤</button>
        </div>
        <div className="cc-quick">
          {QUICK_CMDS.map((q) => (
            <button type="button" className="cc-quick-cmd" key={q} onClick={() => setCmd(q)}>{q}</button>
          ))}
        </div>
        <div className="cc-hint">Atria detects your language, confirms its understanding, then proposes a plan with its cost.</div>
      </form>

      {/* Atria's proactive surface on the home (P2.0) — reminders + resume hung work, promoted from the
          old Orchestrate empty-state so the operator sees them without entering a chat. */}
      <div className="cc-atria-surface">
        <section className="cc-atria-block">
          <h3 className="atria-section-title">Reminders from Atria</h3>
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
            onDismiss={onDismissResume}
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
