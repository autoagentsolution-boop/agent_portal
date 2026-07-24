// Connection-required block — rendered when a run is gated `needs_connection` by the
// Connection Resolver. Shows one connect/reconnect card per platform the user must
// authorize (reusing the same connect link as ConnectionsPanel), plus an
// "I've connected — continue" button that re-POSTs /execute to re-resolve the gate.
// Rendered by SavedFlowDetail (Active Flows — the only surface that executes); ready
// to reuse if Orchestrate ever gains an inline execute.
import { connectUrl, type RequiredActionDto } from '../api/client';
import { useLocale } from '../i18n';

interface Props {
  actions: RequiredActionDto[];
  busy: boolean;
  onContinue: () => void;
  // Optional: open the full Connections page (a richer place to connect/manage tokens).
  onOpenConnections?: () => void;
}

export function ConnectionRequired({ actions, busy, onContinue, onOpenConnections }: Props) {
  const { t } = useLocale();
  return (
    <div className="gate-block connection-required">
      <p className="muted small">
        {t('connect.required.pre_run')}
      </p>
      <div className="connections-grid">
        {actions.map((a) => (
          <div className={`connection-card st-${a.type === 'connect_platform' ? 'not_connected' : 'needs_attention'}`} key={a.platform}>
            <div className="connection-head">
              <span className="connection-name">{a.displayName}</span>
            </div>
            <p className="muted small">{a.reason}</p>
            <div className="chip-row">
              {a.capabilities.map((cap) => (
                <span className="cap-chip" key={cap}>{cap.replace('social.post.', '')}</span>
              ))}
            </div>
            <a className="btn primary small" href={connectUrl(a.connectUrl)}>
              {a.type === 'connect_platform' ? t('connect.platform.cta', { platform: a.displayName }) : t('reconnect.platform.cta', { platform: a.displayName })}
            </a>
          </div>
        ))}
      </div>
      <div className="btn-row">
        <button className="btn primary" disabled={busy} onClick={onContinue}>
          {busy ? t('connect.checking.busy') : t('connect.continue.cta')}
        </button>
        {onOpenConnections && (
          <button className="btn" disabled={busy} onClick={onOpenConnections}>{t('connect.manage.cta')}</button>
        )}
      </div>
    </div>
  );
}
