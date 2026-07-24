// Connections panel — the §11 "connection" concept, demo-surfaced. Read-only over
// the OAuthToken store (GET /connections): each platform shows connected /
// needs-attention / not-connected with a Connect button that links the existing
// per-user OAuth flow (/connect/:platform/start). No token value is ever shown.
import { useEffect, useState } from 'react';
import { api, connectUrl, type ConnectionDto, type KillSwitchState } from '../api/client';
import { ConnectionCredentialForm } from './connection-credential-form';
import { useLocale, t } from '../i18n';
import { tError } from '../i18n/t-error';

interface Props {
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

// Module-scope: uses the module-level t() (reactive because callers re-render on locale change).
const stateLabel = (state: ConnectionDto['state']): string =>
  state === 'connected' ? t('connections.state.connected')
  : state === 'needs_attention' ? t('connections.state.needs_attention')
  : t('connections.state.not_connected');

const STATE_DOT: Record<ConnectionDto['state'], string> = {
  connected: '●',
  needs_attention: '▲',
  not_connected: '○',
};

const fmtExpiry = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return t('connections.expires', { date: d.toLocaleDateString() });
};

export function ConnectionsPanel({ notify }: Props) {
  const { t } = useLocale();
  const [rows, setRows] = useState<ConnectionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const r = await api.listConnections();
    setLoading(false);
    if (!r.ok) { notify(t('connections.err.list', { error: tError(r.error) }), 'err'); return; }
    setRows(r.data);
  };

  useEffect(() => { void load(); }, []);

  return (
    <section className="connections-panel">
      <div className="orchestrate-head">
        <h2>{t('connections.title')}</h2>
        <p className="muted small">{t('connections.subtitle')}</p>
      </div>

      {loading ? (
        <div className="muted">{t('common.loading')}</div>
      ) : (
        <div className="connections-grid">
          {rows.map((c) => (
            <div className={`connection-card st-${c.state}`} key={c.platformKey}>
              <div className="connection-head">
                <span className="connection-name">{c.displayName}</span>
                <span className={`connection-state st-${c.state}`}>
                  <span className="connection-dot">{STATE_DOT[c.state]}</span> {stateLabel(c.state)}
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
                      {c.state === 'connected' ? t('common.reconnect') : t('common.connect')}
                    </a>
                    <button
                      className="btn ghost small"
                      onClick={() => setFormOpen((cur) => (cur === c.platformKey ? null : c.platformKey))}
                    >
                      {formOpen === c.platformKey ? t('common.close') : c.state === 'connected' ? t('connections.token.update') : t('connections.token.paste_instead')}
                    </button>
                  </>
                ) : (
                  <button
                    className="btn primary small"
                    onClick={() => setFormOpen((cur) => (cur === c.platformKey ? null : c.platformKey))}
                  >
                    {formOpen === c.platformKey ? t('common.close') : c.state === 'connected' ? t('connections.token.update') : t('connections.token.enter')}
                  </button>
                )}
              </div>
              {!c.oauthConfigured && c.state === 'not_connected' && (
                <p className="conn-setup-hint muted small">
                  {t('connections.oauth_not_configured_hint', { platform: c.displayName })}
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
      <KillSwitchSection notify={notify} />
    </section>
  );
}

// Storage as a first-class Connection (item 4). Generated media is written to local disk
// and served at /media/images, so local storage is always "active". Google Drive is a
// per-user OAuth target: connecting it lets the agent upload generated images to the
// user's Drive so IG/Threads (which fetch a public image_url server-side) can publish
// them. Drive is NOT a SocialPlatform → its state comes from /connections/storage.
function StorageSection() {
  const { t } = useLocale();
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
        <h2>{t('connections.storage.title')}</h2>
        <p className="muted small">{t('connections.storage.subtitle')}</p>
      </div>
      <div className="connections-grid">
        <div className="connection-card st-connected">
          <div className="connection-head">
            <span className="connection-name">{t('connections.storage.local_name')}</span>
            <span className="connection-state st-connected"><span className="connection-dot">●</span> {t('connections.storage.active')}</span>
          </div>
          <div className="chip-row">
            <span className="cap-chip">{t('connections.storage.cap_images')}</span>
            <span className="cap-chip">{t('connections.storage.cap_video')}</span>
          </div>
          <p className="muted small" style={{ margin: '4px 0 0' }}>{t('connections.storage.local_hint_pre')} <code>/media</code>{t('connections.storage.local_hint_post')}</p>
        </div>
        <div className={`connection-card ${driveCls}`}>
          <div className="connection-head">
            <span className="connection-name">{t('connections.drive.name')}</span>
            <span className={`connection-state ${driveCls}`}>
              <span className="connection-dot">{driveConnected ? '●' : '○'}</span>{' '}
              {driveConnected ? t('connections.state.connected') : t('connections.state.not_connected')}
            </span>
          </div>
          <div className="chip-row"><span className="cap-chip">{t('connections.storage.cap_public_url')}</span></div>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {t('connections.drive.hint')}
          </p>
          <div className="conn-actions">
            <a className="btn primary small" href={connectUrl('/connect/drive/start')}>
              {driveConnected ? t('connections.drive.reconnect_cta') : t('connections.drive.connect_cta')}
            </a>
          </div>
          {!driveConnected && (
            <details className="conn-owner-setup">
              <summary>{t('connections.drive.setup_summary')}</summary>
              <p className="muted small">{t('connections.drive.setup_hint')}</p>
              <ol className="muted small">
                <li>{t('connections.drive.setup_step1_pre')} <strong>Google Drive API</strong> {t('connections.drive.setup_step1_post')}</li>
                <li>{t('connections.drive.setup_step2_pre')} <code>drive.file</code> {t('connections.drive.setup_step2_post')}</li>
              </ol>
            </details>
          )}
        </div>
      </div>
    </>
  );
}

// Global kill switch (Phase 03 safety) — an emergency stop for EVERY external action
// (publishes / outbound writes) across the whole workspace, independent of any single
// run's abort. Lives here because Connections is the closest thing this app has to a
// settings/ops surface today.
function KillSwitchSection({ notify }: { notify: Props['notify'] }) {
  const { t } = useLocale();
  const [state, setState] = useState<KillSwitchState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.getKillSwitch().then((r) => { if (r.ok) setState(r.data); });
  }, []);

  const toggle = async () => {
    if (!state) return;
    setBusy(true);
    try {
      const r = await api.setKillSwitch(!state.paused);
      if (!r.ok) { notify(t('connections.err.kill_switch', { error: tError(r.error) }), 'err'); return; }
      setState(r.data);
      notify(r.data.paused ? t('connections.kill_switch.paused_notice') : t('connections.kill_switch.resumed_notice'));
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="orchestrate-head" style={{ marginTop: 22 }}>
        <h2>{t('connections.system.title')}</h2>
        <p className="muted small">{t('connections.system.subtitle')}</p>
      </div>
      <div className={`kill-switch-card ${state?.paused ? 'st-paused' : ''}`}>
        <div>
          <span className="kill-switch-state">
            {state?.paused ? t('connections.kill_switch.state_paused') : t('connections.kill_switch.state_active')}
          </span>
          {state?.paused && state.updatedAt && (
            <span className="muted small"> · {t('connections.kill_switch.since', { date: new Date(state.updatedAt).toLocaleString() })}</span>
          )}
        </div>
        <button
          className={`btn small ${state?.paused ? 'primary' : 'danger'}`}
          disabled={busy || !state}
          onClick={() => void toggle()}
        >
          {busy ? t('connections.kill_switch.updating') : state?.paused ? t('connections.kill_switch.resume_cta') : t('connections.kill_switch.pause_cta')}
        </button>
      </div>
    </>
  );
}
