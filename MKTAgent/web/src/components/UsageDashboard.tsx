// Usage & credits dashboard (Phase 03) — the per-owner spend total + per-surface
// breakdown, consumed from GET /orchestration/usage. Mirrors ConnectionsPanel's layout
// (max-width card column) so it reads as part of the same "ops" area of the app.
import { useEffect, useState } from 'react';
import { api, type UsageTotals } from '../api/client';
import { CostStrip } from './cost-strip';

interface Props {
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

const SURFACE_LABEL: Record<string, string> = {
  chat: 'Chat', intake: 'Intake', copygen: 'Copy generation', research: 'Research',
  lead_rescore: 'Lead rescoring', product_analysis: 'Product knowledge', orchestration: 'Orchestration',
};

export function UsageDashboard({ notify }: Props) {
  const [usage, setUsage] = useState<UsageTotals | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void api.getUsage().then((r) => {
      setLoading(false);
      if (!r.ok) { notify(`Usage: ${r.error.error}`, 'err'); return; }
      setUsage(r.data);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const maxCredits = Math.max(1, ...(usage?.bySurface.map((s) => s.credits) ?? [1]));

  return (
    <section className="usage-dashboard">
      <div className="orchestrate-head">
        <h2>Usage &amp; credits</h2>
        <p className="muted small">
          Real LLM/media spend across every surface — a friendly credit number up front,
          raw tokens and USD on hover for full transparency.
        </p>
      </div>

      {loading && <div className="muted">Loading…</div>}

      {!loading && !usage && <p className="muted small">Usage unavailable.</p>}

      {!loading && usage && (
        <>
          <CostStrip
            cost={{ costUsd: usage.costUsd, totalTokens: usage.totalTokens, credits: usage.credits }}
            secondaryMetric={{ value: usage.calls, label: 'call' }}
          />

          <div className="usage-surface-list">
            {usage.bySurface.length === 0 && <p className="muted small">No usage recorded yet.</p>}
            {usage.bySurface.map((s) => (
              <div className="usage-surface-row" key={s.surface}>
                <div className="usage-surface-head">
                  <span className="usage-surface-name">{SURFACE_LABEL[s.surface] ?? s.surface}</span>
                  <span className="usage-surface-credits">≈ {s.credits} credits</span>
                </div>
                <div className="usage-bar-track">
                  <div className="usage-bar-fill" style={{ width: `${(s.credits / maxCredits) * 100}%` }} />
                </div>
                <div className="usage-surface-meta muted small">
                  ${s.costUsd.toFixed(3)} · {s.totalTokens.toLocaleString()} tokens · {s.calls} {s.calls === 1 ? 'call' : 'calls'}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
