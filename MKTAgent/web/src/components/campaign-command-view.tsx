// Campaign command board (Atria Phase 08 / surfaces Phase 05). Live rollup of a materialized
// campaign's posts: a status dot per post (planned / running / held-needs-you / posted / failed) with
// scheduled time. Polls the status endpoint so the board reflects the autonomous run in progress.
import { useEffect, useState, useCallback } from 'react';
import { api, type CampaignStatusDto, type DerivedPostStatus } from '../api/client';
import { useLocale } from '../i18n';

interface Props { campaignId: string }

// Label keys per status (values resolved via t() inside the component — no module-level t()
// dependency on the active locale at import time).
const DOT_KEY: Record<DerivedPostStatus, { color: string; labelKey: 'campaign.status.planned' | 'campaign.status.running' | 'campaign.status.held' | 'campaign.status.posted' | 'campaign.status.failed' }> = {
  planned: { color: 'var(--muted)', labelKey: 'campaign.status.planned' },
  running: { color: 'var(--blue)', labelKey: 'campaign.status.running' },
  held: { color: 'var(--amber)', labelKey: 'campaign.status.held' },
  posted: { color: 'var(--green)', labelKey: 'campaign.status.posted' },
  failed: { color: 'var(--red)', labelKey: 'campaign.status.failed' },
};
const ORDER: DerivedPostStatus[] = ['planned', 'running', 'held', 'posted', 'failed'];

export function CampaignCommandView({ campaignId }: Props) {
  const { t } = useLocale();
  const [status, setStatus] = useState<CampaignStatusDto | null>(null);
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : t('campaign.unscheduled'));

  const load = useCallback(async () => {
    const r = await api.campaignStatus(campaignId);
    if (r.ok) setStatus(r.data);
  }, [campaignId]);

  useEffect(() => {
    void load();
    const tm = window.setInterval(() => void load(), 8000); // poll while a campaign runs
    return () => window.clearInterval(tm);
  }, [load]);

  if (!status) return <p className="muted">{t('campaign.loading')}</p>;
  if (status.total === 0) return <p className="muted">{t('campaign.empty')}</p>;

  return (
    <section style={{ maxWidth: 820 }}>
      <h3>{t('campaign.board.title')}</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '4px 0 14px' }}>
        {ORDER.filter((k) => status.counts[k] > 0).map((k) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: DOT_KEY[k].color }} />
            {t(DOT_KEY[k].labelKey)}: <strong>{status.counts[k]}</strong>
          </span>
        ))}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 6 }}>
        {status.posts.map((p) => (
          <li key={p.postId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: DOT_KEY[p.status].color }} title={t(DOT_KEY[p.status].labelKey)} />
            <span style={{ flex: 1 }}>{when(p.scheduledAt)}</span>
            <span className="muted">{t(DOT_KEY[p.status].labelKey)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
