// Leads page (Lead Collector §01.3). Two parts: an intake-token setup panel (mint the token
// a funnel presents so leads land on THIS tenant) and the leads table with the hybrid score.
import { useEffect, useState } from 'react';
import { api, type LeadRow, type IntakeTokenRow } from '../api/client';

interface Props { notify: (msg: string, kind?: 'ok' | 'err') => void }

const scoreClass = (s: number | null): string => (s == null ? 'muted' : s >= 70 ? 'score-hot' : s >= 40 ? 'score-warm' : 'score-cold');

export function LeadsPage({ notify }: Props) {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [tokens, setTokens] = useState<IntakeTokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [l, t] = await Promise.all([api.listLeads(), api.listIntakeTokens()]);
    if (l.ok) setLeads(l.data); else notify(`Leads: ${l.error.error}`, 'err');
    if (t.ok) setTokens(t.data);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mint = async () => {
    setBusy('mint');
    const r = await api.createIntakeToken();
    setBusy(null);
    if (!r.ok) { notify(`Mint: ${r.error.error}`, 'err'); return; }
    setFreshToken(r.data.token); // shown once
    notify('Intake token created — copy it now, it is shown only once');
    await load();
  };
  const revoke = async (id: string) => {
    if (!confirm('Revoke this intake token? Funnels using it stop working.')) return;
    const r = await api.revokeIntakeToken(id);
    if (!r.ok) { notify(`Revoke: ${r.error.error}`, 'err'); return; }
    notify('Revoked'); await load();
  };
  const pollComments = async () => {
    setBusy('poll');
    const r = await api.pollComments();
    setBusy(null);
    if (!r.ok) { notify(`Poll: ${r.error.error}`, 'err'); return; }
    notify(`Polled ${r.data.postsPolled} post(s): ${r.data.leadsCaptured} new lead(s), ${r.data.duplicates} dup(s)`);
    if (r.data.leadsCaptured > 0) await load();
  };
  const rescore = async (id: string) => {
    setBusy(id);
    const r = await api.rescoreLead(id);
    setBusy(null);
    if (!r.ok) { notify(`Rescore: ${r.error.error}`, 'err'); return; }
    setLeads((prev) => prev.map((l) => (l.id === id ? r.data : l)));
    notify(`AI re-scored: ${r.data.score}`);
  };

  const base = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

  return (
    <div className="leads-page">
      <div className="spread" style={{ marginBottom: 14 }}>
        <div>
          <div className="eyebrow">Lead Collector</div>
          <h2 style={{ margin: '2px 0 0', fontSize: 18 }}>🎯 Leads</h2>
          <p className="muted small" style={{ marginTop: 4 }}>Opt-in leads captured from your funnels, scored for intent. Leads are private to your workspace and stored encrypted.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" disabled={busy === 'poll'} onClick={() => void pollComments()}>{busy === 'poll' ? 'Polling…' : '↻ Poll comments'}</button>
          <button className="btn" onClick={() => setSetupOpen((o) => !o)}>{setupOpen ? 'Hide setup' : '⚙ Intake setup'}</button>
        </div>
      </div>

      {setupOpen && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="spread">
            <strong style={{ fontSize: 14 }}>Intake tokens</strong>
            <button className="btn small primary" disabled={busy === 'mint'} onClick={() => void mint()}>{busy === 'mint' ? 'Minting…' : '+ New token'}</button>
          </div>
          <p className="muted small" style={{ marginTop: 4 }}>A funnel (form, Cal.com, webhook) presents this token so its leads land on your workspace. Add it as <code>?t=TOKEN</code> or an <code>x-intake-token</code> header.</p>
          {freshToken && (
            <div className="copy-box" style={{ borderColor: 'var(--accent)' }}>
              <div className="label">New token — copy now (shown once)</div>
              <div className="text" style={{ wordBreak: 'break-all' }}>{freshToken}</div>
              <div className="muted small" style={{ marginTop: 4 }}>Example: <code>{base || 'http://localhost:7100'}/leads/form?t={freshToken}</code></div>
              <button className="btn small" style={{ marginTop: 6 }} onClick={() => { void navigator.clipboard.writeText(freshToken); notify('Copied'); }}>Copy token</button>
            </div>
          )}
          {tokens.length === 0 ? <p className="muted small">No tokens yet.</p> : (
            <div className="post-summary-list" style={{ marginTop: 8 }}>
              {tokens.map((t) => (
                <div key={t.id} className="spread" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span className="small">{t.label ?? 'Intake token'} · <span className={t.active ? '' : 'muted'}>{t.active ? 'active' : 'revoked'}</span> · <span className="muted">used {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString() : 'never'}</span></span>
                  {t.active && <button className="btn small danger" onClick={() => void revoke(t.id)}>Revoke</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? <div className="muted">Loading…</div> : leads.length === 0 ? (
        <p className="muted">No leads yet. Open <strong>Intake setup</strong>, mint a token, and wire it into your form/Cal.com/webhook.</p>
      ) : (
        <div className="lead-table">
          {leads.map((l) => (
            <div key={l.id} className="lead-row card">
              <div className={`lead-score ${scoreClass(l.score)}`} title={l.scoreReasons.map((r) => `${r.reason} (${r.delta >= 0 ? '+' : ''}${r.delta})`).join('\n')}>
                {l.score ?? '—'}
              </div>
              <div className="lead-main">
                <div className="lead-head"><strong>{l.name ?? l.email}</strong> <span className="muted small">{l.email}</span></div>
                <div className="muted small">{l.source}{l.phone ? ` · ${l.phone}` : ''} · {new Date(l.receivedAt).toLocaleString()}</div>
                {l.message && <div className="small" style={{ marginTop: 4 }}>{l.message}</div>}
              </div>
              <button className="btn small" disabled={busy === l.id} onClick={() => void rescore(l.id)}>{busy === l.id ? '…' : '✨ AI score'}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
