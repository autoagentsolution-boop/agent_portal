// Agent spotlight — the Command Center drawer view for an AGENT node (Atria v2 P1). Shows the
// agent's identity + its live state ACROSS the tenant's workspaces: which workspaces it's active in,
// its credits + run tallies per workspace, and an aggregate. Data is composed client-side from the
// P0 view-model (listWorkspaces → getWorkspace, matching this agent's card) — no dedicated backend
// endpoint yet (bounded fan-out over a handful of campaigns; capped defensively). Clicking a
// workspace hands off to the full WorkspacePanel.
import { useEffect, useState } from 'react';
import { api, type AgentNodeDto, type WorkspaceAgentCardDto } from '../api/client';

interface Props {
  agent: AgentNodeDto;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onOpenWorkspace: (campaignId: string) => void;
}

interface Appearance { campaignId: string; name: string; card: WorkspaceAgentCardDto }
const MAX_WORKSPACES = 20; // defensive cap on the per-agent fan-out
const fmtCredits = (n: number) => Math.round(n).toLocaleString();

export function AgentSpotlight({ agent, notify, onOpenWorkspace }: Props) {
  const [rows, setRows] = useState<Appearance[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setRows(null);
      const list = await api.listWorkspaces();
      if (!list.ok) { if (!cancelled) { notify(`Workspaces: ${list.error.error}`, 'err'); setRows([]); } return; }
      const details = await Promise.all(
        list.data.slice(0, MAX_WORKSPACES).map((w) => api.getWorkspace(w.campaignId)),
      );
      if (cancelled) return;
      const found: Appearance[] = [];
      for (const d of details) {
        if (!d.ok) continue;
        const card = d.data.agents.find((a) => a.agentId === agent.id);
        if (card) found.push({ campaignId: d.data.campaignId, name: d.data.name, card });
      }
      found.sort((a, b) => b.card.credits - a.card.credits);
      setRows(found);
    })();
    return () => { cancelled = true; };
  }, [agent.id, notify]);

  const agg = (rows ?? []).reduce(
    (s, r) => ({ credits: s.credits + r.card.credits, runs: s.runs + r.card.runs, running: s.running + r.card.running, failed: s.failed + r.card.failed }),
    { credits: 0, runs: 0, running: 0, failed: 0 },
  );

  return (
    <div className="cc-drawer-body">
      <div className="ws-panel-head">
        <div>
          <h3>{agent.emoji} {agent.name.replace(/ Agent$/, '')}</h3>
          <span className="muted">{agent.vibe ?? agent.description}</span>
        </div>
        {rows !== null && rows.length > 0 && (
          <span className="ws-cost" title="Total credits this agent has spent across workspaces">◈ {fmtCredits(agg.credits)} cr</span>
        )}
      </div>

      {rows === null ? (
        <p className="muted">Loading activity…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No activity yet — Atria hasn't run {agent.name.replace(/ Agent$/, '')} in a workspace.</p>
      ) : (
        <>
          <div className="ws-status-row">
            <span className="ws-status-chip">Active in <strong>{rows.length}</strong> workspace{rows.length === 1 ? '' : 's'}</span>
            <span className="ws-status-chip"><strong>{agg.runs}</strong> total runs</span>
            {agg.running > 0 && <span className="ws-status-chip" style={{ color: 'var(--blue)' }}><strong>{agg.running}</strong> running</span>}
            {agg.failed > 0 && <span className="ws-status-chip" style={{ color: 'var(--red)' }}><strong>{agg.failed}</strong> failed</span>}
          </div>
          <div className="ws-section-title">Workspaces</div>
          <ul className="ws-post-list">
            {rows.map((r) => (
              <li key={r.campaignId}>
                <button className="ws-post-row" onClick={() => onOpenWorkspace(r.campaignId)}>
                  <span className="ws-post-when">{r.name}</span>
                  <span className="muted">◈ {fmtCredits(r.card.credits)} cr · {r.card.completed}/{r.card.runs}</span>
                  <span className="ws-post-open">Open →</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
