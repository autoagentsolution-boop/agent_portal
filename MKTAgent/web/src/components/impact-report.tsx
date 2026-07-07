// Impact / value report (Atria Phase 08 / surfaces Phase 07). The money shot: real cost/output/leads
// next to a clearly-LABELED saved-vs-agency estimate. Works per-campaign (pass campaignId) or
// per-period (pass period). Real numbers and estimates are visually separated — honesty by design.
import { useEffect, useState } from 'react';
import { api, type ImpactReportDto } from '../api/client';

interface Props {
  campaignId?: string; // one campaign
  period?: '7d' | '30d' | '90d' | 'all'; // or a period window
}

const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ padding: 12, border: '1px solid var(--border, #ddd)', borderRadius: 8, minWidth: 120 }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div className="muted" style={{ fontSize: 13 }}>{label}</div>
      {hint && <div className="muted" style={{ fontSize: 11 }}>{hint}</div>}
    </div>
  );
}

export function ImpactReport({ campaignId, period = '30d' }: Props) {
  const [report, setReport] = useState<ImpactReportDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const p = campaignId ? api.campaignImpact(campaignId) : api.periodImpact(period);
    void p.then((r) => { if (r.ok) setReport(r.data); setLoading(false); });
  }, [campaignId, period]);

  if (loading) return <p className="muted">Loading impact…</p>;
  if (!report) return <p className="muted">No impact data yet.</p>;
  const { metrics, value } = report;

  return (
    <section style={{ maxWidth: 820 }}>
      <h3>Impact {campaignId ? '(this campaign)' : `(last ${period})`}</h3>
      <p style={{ fontSize: 17, fontWeight: 600, margin: '6px 0 16px' }}>{report.headline}</p>

      <h4 style={{ margin: '0 0 8px' }}>Measured</h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <Stat label="spent" value={money(metrics.usdSpent)} hint={`≈ ${metrics.creditsSpent} credits`} />
        <Stat label="posts published" value={String(metrics.postsPublished)} />
        <Stat label="platforms" value={String(metrics.platforms.length)} hint={metrics.platforms.join(', ') || '—'} />
        <Stat label="media pieces" value={String(metrics.mediaPieces)} />
        <Stat label="leads captured" value={String(metrics.leadsCaptured)} />
      </div>

      <h4 style={{ margin: '18px 0 8px' }}>
        Estimated <span className="tree-badge" title="Derived from configurable market assumptions — not measured">estimate</span>
      </h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <Stat label="cost saved vs agency" value={money(value.savedUsd)} hint={`baseline ~${money(value.baselineUsd)}`} />
        <Stat label="time saved" value={`${value.savedDays} days`} />
        <Stat label="est. reach" value={value.estimatedReach.toLocaleString()} hint="needs Insights for real reach (v2)" />
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        Estimates use: ${value.assumptions.agencyDayRateUsd}/day agency rate, {value.assumptions.hoursPerPost}h/post,
        {value.assumptions.reachPerPost} reach/post. Tune these in workspace settings.
      </p>
    </section>
  );
}
