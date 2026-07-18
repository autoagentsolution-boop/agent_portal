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
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void api.getUsage().then((r) => {
      setLoading(false);
      if (!r.ok) { notify(`Usage: ${r.error.error}`, 'err'); return; }
      setUsage(r.data);
    });
    // Remaining wallet balance (credit-wallet Phase 02) — shown alongside cumulative spend below.
    void api.me().then((r) => { if (r.ok) setBalance(r.data.credits ?? null); });
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

      {balance !== null && (
        <div className="usage-balance" style={{ margin: '0.5rem 0 1rem', fontSize: '1.05rem' }}>
          <span className="muted small">Credits remaining</span>{' '}
          <strong style={{ color: balance <= 0 ? '#ff6b6b' : undefined }}>◈ {balance.toLocaleString()}</strong>
        </div>
      )}

      {loading && <div className="muted">Loading…</div>}

      {!loading && !usage && <p className="muted small">Usage unavailable.</p>}

      {!loading && usage && (
        <>
          <CostStrip
            cost={{ costUsd: usage.costUsd, totalTokens: usage.totalTokens, credits: usage.credits }}
            secondaryMetric={{ value: usage.calls, label: 'call' }}
          />

          {/* Free work, itemised. Deliberately NOT framed as "charged vs not charged": the wallet
              debits from wf_node_run while this page reads mkt_llm_usage, and those two ledgers do not
              currently agree (see docs/product/06 §3.8). Claiming a "charged" total here would state a
              number the bill does not match. What IS true regardless of that question is the rule
              below — failures and off-run work are never billed — so that is all this claims.
              Shown even at zero: a user should be able to confirm they weren't billed for failures
              rather than infer it from an absence. */}
          <div className="usage-split">
            <div className="usage-split-row usage-split-free">
              <span className="usage-split-label">
                <strong>Failed runs</strong>
                <span className="muted small"> — never charged</span>
              </span>
              <span className="usage-split-value">
                ${usage.split.notCharged.failedRuns.costUsd.toFixed(3)}
                <span className="muted small"> · {usage.split.notCharged.failedRuns.totalTokens.toLocaleString()} tokens</span>
              </span>
            </div>
            <div className="usage-split-row usage-split-free">
              <span className="usage-split-label">
                <strong>Chat &amp; background work</strong>
                <span className="muted small"> — free</span>
              </span>
              <span className="usage-split-value">
                ${usage.split.notCharged.offRun.costUsd.toFixed(3)}
                <span className="muted small"> · {usage.split.notCharged.offRun.totalTokens.toLocaleString()} tokens</span>
              </span>
            </div>
            <p className="muted small usage-split-note">
              A run that fails costs you nothing — not even the steps that finished before it broke.
              Chatting with Atria and background analysis are free too. Everything above is spend we
              absorbed, already excluded from your balance.
            </p>
          </div>

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
