// Usage & credits dashboard (Phase 03) — the per-owner spend total + per-surface
// breakdown, consumed from GET /orchestration/usage. Mirrors ConnectionsPanel's layout
// (max-width card column) so it reads as part of the same "ops" area of the app.
import { useEffect, useState } from 'react';
import { api, type UsageTotals } from '../api/client';
import { CostStrip } from './cost-strip';
import { tError } from '../i18n/t-error';
import { useLocale, type MessageKey } from '../i18n';

interface Props {
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

const SURFACE_LABEL_KEY: Record<string, MessageKey> = {
  chat: 'usage.surface.chat', intake: 'usage.surface.intake', copygen: 'usage.surface.copygen',
  research: 'usage.surface.research', lead_rescore: 'usage.surface.lead_rescore',
  product_analysis: 'usage.surface.product_analysis', orchestration: 'usage.surface.orchestration',
};

export function UsageDashboard({ notify }: Props) {
  const { t } = useLocale();
  const [usage, setUsage] = useState<UsageTotals | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void api.getUsage().then((r) => {
      setLoading(false);
      if (!r.ok) { notify(tError(r.error), 'err'); return; }
      setUsage(r.data);
    });
    // Remaining wallet balance (credit-wallet Phase 02) — shown alongside cumulative spend below.
    void api.me().then((r) => { if (r.ok) setBalance(r.data.credits ?? null); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const maxCredits = Math.max(1, ...(usage?.bySurface.map((s) => s.credits) ?? [1]));

  return (
    <section className="usage-dashboard">
      <div className="orchestrate-head">
        <h2>{t('usage.title')}</h2>
        <p className="muted small">{t('usage.subtitle')}</p>
      </div>

      {balance !== null && (
        <div className="usage-balance" style={{ margin: '0.5rem 0 1rem', fontSize: '1.05rem' }}>
          <span className="muted small">{t('nav.credits.title')}</span>{' '}
          <strong style={{ color: balance <= 0 ? '#ff6b6b' : undefined }}>◈ {balance.toLocaleString()}</strong>
        </div>
      )}

      {loading && <div className="muted">{t('common.loading')}</div>}

      {!loading && !usage && <p className="muted small">{t('usage.unavailable')}</p>}

      {!loading && usage && (
        <>
          <CostStrip
            cost={{ costUsd: usage.costUsd, totalTokens: usage.totalTokens, credits: usage.credits }}
            secondaryMetric={{ value: usage.calls, label: t('usage.call_singular'), pluralLabel: t('usage.call_plural') }}
          />

          {/* Charged vs absorbed. Every row is shown even at zero: a user should be able to CONFIRM
              they weren't billed for failures or re-runs, not have to infer it from an absence. */}
          <div className="usage-split">
            <div className="usage-split-row">
              <span className="usage-split-label">
                <strong>{t('usage.charged.label')}</strong>
                <span className="muted small"> — {t('usage.charged.note')}</span>
              </span>
              <span className="usage-split-value">
                ◈ {usage.split.charged.credits.toLocaleString()}
                <span className="muted small">
                  {' '}· ${usage.split.charged.costUsd.toFixed(3)} · {usage.split.charged.totalTokens.toLocaleString()} {t('usage.tokens')}
                </span>
              </span>
            </div>
            {([
              ['usage.failed_runs.label', 'usage.failed_runs.note', usage.split.absorbed.failedRuns],
              ['usage.reruns.label', 'usage.reruns.note', usage.split.absorbed.reruns],
              ['usage.chat_background.label', 'usage.chat_background.note', usage.split.absorbed.offRun],
            ] as const).map(([labelKey, noteKey, b]) => (
              <div className="usage-split-row usage-split-free" key={labelKey}>
                <span className="usage-split-label">
                  <strong>{t(labelKey)}</strong>
                  <span className="muted small"> — {t(noteKey)}</span>
                </span>
                <span className="usage-split-value">
                  ${b.costUsd.toFixed(3)}
                  <span className="muted small"> · {b.totalTokens.toLocaleString()} {t('usage.tokens')}</span>
                </span>
              </div>
            ))}
            <p className="muted small usage-split-note">{t('usage.split.explainer')}</p>
          </div>

          <div className="usage-surface-list">
            {usage.bySurface.length === 0 && <p className="muted small">{t('usage.no_usage')}</p>}
            {usage.bySurface.map((s) => (
              <div className="usage-surface-row" key={s.surface}>
                <div className="usage-surface-head">
                  <span className="usage-surface-name">{SURFACE_LABEL_KEY[s.surface] ? t(SURFACE_LABEL_KEY[s.surface]) : s.surface}</span>
                  <span className="usage-surface-credits">{t('plan.tier.credits', { credits: s.credits })}</span>
                </div>
                <div className="usage-bar-track">
                  <div className="usage-bar-fill" style={{ width: `${(s.credits / maxCredits) * 100}%` }} />
                </div>
                <div className="usage-surface-meta muted small">
                  ${s.costUsd.toFixed(3)} · {s.totalTokens.toLocaleString()} {t('usage.tokens')} · {t(s.calls === 1 ? 'usage.call_count.one' : 'usage.call_count.other', { count: s.calls })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
