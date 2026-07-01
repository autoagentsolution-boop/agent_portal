// Read-only setup status for a clicked flow node. Replaces the old per-node credential
// input panel (which duplicated Connections and looked like secrets were fed to the LLM).
// Setup lives in ONE place — the Connections panel. Here we only SHOW state:
//   • publisher node → per-platform connected/not chips + a link to Connections.
//   • every other node runs automatically server-side → nothing to configure.
import { useEffect, useState } from 'react';
import { api, type ConnectionDto } from '../api/client';

interface Props {
  agentId: string;
  onOpenConnections?: () => void;
}

const STATE_DOT: Record<ConnectionDto['state'], string> = {
  connected: '●',
  needs_attention: '▲',
  not_connected: '○',
};

// Only the publisher touches external accounts. Internal agents (ideation, strategy,
// concept, infographic, video…) run with workspace-level provider keys and need no
// per-flow setup, so their node detail is just the artifact output.
export function NodeSetupStatus({ agentId, onOpenConnections }: Props) {
  const [rows, setRows] = useState<ConnectionDto[]>([]);

  useEffect(() => {
    if (agentId !== 'publisher') return;
    void api.listConnections().then((r) => { if (r.ok) setRows(r.data); });
  }, [agentId]);

  if (agentId !== 'publisher') return null;

  return (
    <div className="node-setup">
      <div className="section-title">Publishing connections</div>
      <p className="muted small">
        This step publishes on your behalf. Connect platforms in Connections — the agent
        requests a capability at run time and never handles your tokens here.
      </p>
      <div className="chip-row">
        {rows.length === 0
          ? <span className="muted small">No platforms yet — open Connections to add one.</span>
          : rows.map((c) => (
              <span className={`conn-chip st-${c.state}`} key={c.platformKey}>
                {STATE_DOT[c.state]} {c.displayName}
              </span>
            ))}
      </div>
      {onOpenConnections && (
        <button className="btn small" onClick={onOpenConnections}>Open Connections</button>
      )}
    </div>
  );
}
