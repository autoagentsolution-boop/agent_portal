// Connections panel — the §11 "connection" concept, demo-surfaced. Read-only over
// the OAuthToken store (GET /connections): each platform shows connected /
// needs-attention / not-connected with a Connect button that links the existing
// per-user OAuth flow (/connect/:platform/start). No token value is ever shown.
import { useEffect, useState } from 'react';
import { api, connectUrl, type ConnectionDto } from '../api/client';
import { ConnectionCredentialForm } from './connection-credential-form';

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
  const [formOpen, setFormOpen] = useState<string | null>(null);

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
              <div className="conn-actions">
                {c.oauthConfigured ? (
                  <>
                    <a className={`btn ${c.state === 'connected' ? 'ghost' : 'primary'} small`} href={connectUrl(c.connectUrl)}>
                      {c.state === 'connected' ? 'Reconnect' : 'Connect'}
                    </a>
                    <button
                      className="btn ghost small"
                      onClick={() => setFormOpen((cur) => (cur === c.platformKey ? null : c.platformKey))}
                    >
                      {formOpen === c.platformKey ? 'Close' : c.state === 'connected' ? 'Update token' : 'Paste token instead'}
                    </button>
                  </>
                ) : (
                  <button
                    className="btn primary small"
                    onClick={() => setFormOpen((cur) => (cur === c.platformKey ? null : c.platformKey))}
                  >
                    {formOpen === c.platformKey ? 'Close' : c.state === 'connected' ? 'Update token' : 'Enter token'}
                  </button>
                )}
              </div>
              {!c.oauthConfigured && c.state === 'not_connected' && (
                <p className="conn-setup-hint muted small">
                  One-click Connect turns on once the owner sets up the {c.displayName} app. For now, paste a token.
                </p>
              )}
              {formOpen === c.platformKey && (
                <ConnectionCredentialForm
                  platformKey={c.platformKey}
                  displayName={c.displayName}
                  notify={notify}
                  onSaved={() => { setFormOpen(null); void load(); }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <StorageSection />
    </section>
  );
}

// Storage as a first-class Connection (item 4). Generated media is written to local disk
// and served at /media/images, so local storage is always "active". Google Drive is a
// per-user OAuth target: connecting it lets the agent upload generated images to the
// user's Drive so IG/Threads (which fetch a public image_url server-side) can publish
// them. Drive is NOT a SocialPlatform → its state comes from /connections/storage.
function StorageSection() {
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);

  useEffect(() => {
    void api.storageStatus().then((r) => {
      if (r.ok) setDriveConnected(r.data.drive.connected);
    });
  }, []);

  const driveCls = driveConnected ? 'st-connected' : 'st-not_connected';
  return (
    <>
      <div className="orchestrate-head" style={{ marginTop: 22 }}>
        <h2>Storage</h2>
        <p className="muted small">Where generated media (images, video) is saved. Used by the agent when it produces assets.</p>
      </div>
      <div className="connections-grid">
        <div className="connection-card st-connected">
          <div className="connection-head">
            <span className="connection-name">Local storage</span>
            <span className="connection-state st-connected"><span className="connection-dot">●</span> Active</span>
          </div>
          <div className="chip-row">
            <span className="cap-chip">images</span>
            <span className="cap-chip">video</span>
          </div>
          <p className="muted small" style={{ margin: '4px 0 0' }}>Media is saved to this workspace and served at <code>/media</code>. No setup required.</p>
        </div>
        <div className={`connection-card ${driveCls}`}>
          <div className="connection-head">
            <span className="connection-name">Google Drive</span>
            <span className={`connection-state ${driveCls}`}>
              <span className="connection-dot">{driveConnected ? '●' : '○'}</span>{' '}
              {driveConnected ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <div className="chip-row"><span className="cap-chip">public image URL</span></div>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Connect Drive to publish generated images to Instagram and Threads (they fetch a public URL).
          </p>
          <div className="conn-actions">
            <a className="btn primary small" href={connectUrl('/connect/drive/start')}>
              {driveConnected ? 'Reconnect Google Drive' : 'Connect Google Drive'}
            </a>
          </div>
          {!driveConnected && (
            <details className="conn-owner-setup">
              <summary>One-time owner setup</summary>
              <p className="muted small">Users just click Connect &amp; authorize — no console needed. Reuses the app's existing Google login redirect, so no new redirect URI to register. One-time, the owner:</p>
              <ol className="muted small">
                <li>Enable the <strong>Google Drive API</strong> in the project.</li>
                <li>Add scope <code>drive.file</code> (non-sensitive — no review) &amp; publish the consent screen (or add yourself as a test user).</li>
              </ol>
            </details>
          )}
        </div>
      </div>
    </>
  );
}
