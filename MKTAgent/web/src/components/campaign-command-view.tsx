// Campaign command board (Atria Phase 08 / surfaces Phase 05). Live rollup of a materialized
// campaign's posts: a status dot per post (planned / running / held-needs-you / posted / failed) with
// scheduled time. Polls the status endpoint so the board reflects the autonomous run in progress.
import { useEffect, useState, useCallback } from 'react';
import { api, type CampaignStatusDto, type DerivedPostStatus } from '../api/client';

interface Props { campaignId: string }

const DOT: Record<DerivedPostStatus, { color: string; label: string }> = {
  planned: { color: 'var(--muted)', label: 'Planned' },
  running: { color: 'var(--blue)', label: 'Running' },
  held: { color: 'var(--amber)', label: 'Needs you' },
  posted: { color: 'var(--green)', label: 'Posted' },
  failed: { color: 'var(--red)', label: 'Failed' },
};
const ORDER: DerivedPostStatus[] = ['planned', 'running', 'held', 'posted', 'failed'];

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'unscheduled');

export function CampaignCommandView({ campaignId }: Props) {
  const [status, setStatus] = useState<CampaignStatusDto | null>(null);

  const load = useCallback(async () => {
    const r = await api.campaignStatus(campaignId);
    if (r.ok) setStatus(r.data);
  }, [campaignId]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 8000); // poll while a campaign runs
    return () => window.clearInterval(t);
  }, [load]);

  if (!status) return <p className="muted">Loading campaign…</p>;
  if (status.total === 0) return <p className="muted">No posts materialized yet — approve a calendar first.</p>;

  return (
    <section style={{ maxWidth: 820 }}>
      <h3>Campaign board</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '4px 0 14px' }}>
        {ORDER.filter((k) => status.counts[k] > 0).map((k) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: DOT[k].color }} />
            {DOT[k].label}: <strong>{status.counts[k]}</strong>
          </span>
        ))}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 6 }}>
        {status.posts.map((p) => (
          <li key={p.postId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', border: '1px solid var(--border, #eee)', borderRadius: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: DOT[p.status].color }} title={DOT[p.status].label} />
            <span style={{ flex: 1 }}>{when(p.scheduledAt)}</span>
            <span className="muted">{DOT[p.status].label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
