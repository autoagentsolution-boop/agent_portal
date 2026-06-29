// Connections panel — the §11 "connection" concept, demo-surfaced. Read-only over
// the OAuthToken store (GET /connections): each platform shows connected /
// needs-attention / not-connected with a Connect button that links the existing
// per-user OAuth flow (/connect/:platform/start). No token value is ever shown.
import { useEffect, useState } from 'react';
import { api, connectUrl, type ConnectionDto } from '../api/client';

interface Props {
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

const STATE_LABEL: Record<ConnectionDto['state'], string> = {
  connected: 'Connected',
  needs_attention: 'Needs attention',
  not_connected: 'Not connected',
};

const STATE_DOT: Record<ConnectionDto['state'], string> = {
  connected: '●',
  needs_attention: '▲',
  not_connected: '○',
};

const fmtExpiry = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `expires ${d.toLocaleDateString()}`;
};

export function ConnectionsPanel({ notify }: Props) {
  const [rows, setRows] = useState<ConnectionDto[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const r = await api.listConnections();
    setLoading(false);
    if (!r.ok) { notify(`Connections: ${r.error.error}`, 'err'); return; }
    setRows(r.data);
  };

  useEffect(() => { void load(); }, []);

  return (
    <section className="connections-panel">
      <div className="orchestrate-head">
        <h2>Connections</h2>
        <p className="muted small">
          Social platforms this workspace can publish to. The agent uses these connections at
          run time — it requests a capability (e.g. post an image) and never handles your tokens directly.
        </p>
      </div>

      {loading ? (
        <div className="muted">Loading…</div>
      ) : (
        <div className="connections-grid">
          {rows.map((c) => (
            <div className={`connection-card st-${c.state}`} key={c.platformKey}>
              <div className="connection-head">
                <span className="connection-name">{c.displayName}</span>
                <span className={`connection-state st-${c.state}`}>
                  <span className="connection-dot">{STATE_DOT[c.state]}</span> {STATE_LABEL[c.state]}
                </span>
              </div>
              {c.expiresAt && c.state !== 'not_connected' && (
                <div className="connection-expiry muted small">{fmtExpiry(c.expiresAt)}</div>
              )}
              <div className="chip-row">
                {c.capabilities.map((cap) => (
                  <span className="cap-chip" key={cap}>{cap.replace('social.post.', '')}</span>
                ))}
              </div>
              <a
                className={`btn ${c.state === 'connected' ? 'ghost' : 'primary'} small`}
                href={connectUrl(c.connectUrl)}
              >
                {c.state === 'connected' ? 'Reconnect' : 'Connect'}
              </a>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
