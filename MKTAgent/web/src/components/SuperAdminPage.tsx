// Super-admin console (credit-wallet Phase 03) — reachable ONLY at /superadminatria101, never in the
// nav. Two jobs in one page: grant credits to tenants, and read the platform-wide capability-request
// backlog (what users asked Atria for that no node builds yet). The server (requireSuperAdmin → 404)
// is the real gate; this page's client guard just avoids rendering the surface to a non-admin.
import { useCallback, useEffect, useState } from 'react';
import { api, type TenantBalanceDto, type CapabilityRequestDto } from '../api/client';

interface Props {
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onCreditsChanged: () => void; // refresh the top-nav pill after a self-grant
}

export function SuperAdminPage({ notify, onCreditsChanged }: Props) {
  const [tenants, setTenants] = useState<TenantBalanceDto[] | null>(null);
  const [caps, setCaps] = useState<CapabilityRequestDto[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [grantFor, setGrantFor] = useState<string | null>(null);
  const [amount, setAmount] = useState('1000');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [t, c] = await Promise.all([api.adminTenants(), api.adminCapabilityRequests()]);
    // A non-admin hits 404 on every /admin route (surface hidden) — reflect that instead of a broken page.
    if (!t.ok && t.error.status === 404) { setForbidden(true); return; }
    if (t.ok) setTenants(t.data);
    if (c.ok) setCaps(c.data);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const submitGrant = async (ownerId: string) => {
    const credits = parseInt(amount, 10);
    if (!Number.isFinite(credits) || credits <= 0) { notify('Enter a positive credit amount', 'err'); return; }
    setBusy(true);
    const r = await api.adminGrant(ownerId, credits, reason.trim() || undefined);
    setBusy(false);
    if (!r.ok) { notify(`Grant failed: ${r.error.error}`, 'err'); return; }
    notify(`Granted ${credits} credits → new balance ${r.data.balance}`, 'ok');
    setGrantFor(null); setReason('');
    await load();
    onCreditsChanged();
  };

  if (forbidden) return <div className="center"><div className="muted">Not found.</div></div>;

  return (
    <section className="superadmin" style={{ maxWidth: 960, margin: '0 auto', padding: '1rem' }}>
      <div className="orchestrate-head">
        <h2>Super-admin console</h2>
        <p className="muted small">Grant credits to tenants and review the capability-request backlog. Hidden surface — you reached it by URL.</p>
      </div>

      <h3 style={{ marginTop: '1.5rem' }}>Tenants &amp; balances</h3>
      {!tenants ? <p className="muted">Loading…</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', opacity: 0.7 }}>
                <th style={{ padding: '6px 8px' }}>Tenant</th>
                <th style={{ padding: '6px 8px' }}>Balance</th>
                <th style={{ padding: '6px 8px' }}>Granted</th>
                <th style={{ padding: '6px 8px' }}>Spent</th>
                <th style={{ padding: '6px 8px' }}>Last active</th>
                <th style={{ padding: '6px 8px' }} />
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.ownerId} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <td style={{ padding: '6px 8px' }}>
                    {t.email}{t.isSuperAdmin && <span title="super-admin"> ⭐</span>}
                  </td>
                  <td style={{ padding: '6px 8px', fontWeight: 600, color: t.balance <= 0 ? '#ff6b6b' : undefined }}>◈ {t.balance.toLocaleString()}</td>
                  <td style={{ padding: '6px 8px', opacity: 0.7 }}>{t.granted.toLocaleString()}</td>
                  <td style={{ padding: '6px 8px', opacity: 0.7 }}>{t.spent.toLocaleString()}</td>
                  <td style={{ padding: '6px 8px', opacity: 0.7 }}>{new Date(t.lastActive).toLocaleDateString()}</td>
                  <td style={{ padding: '6px 8px' }}>
                    {grantFor === t.ownerId ? (
                      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 80 }} placeholder="credits" />
                        <input value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 120 }} placeholder="reason (optional)" />
                        <button className="btn primary" disabled={busy} onClick={() => void submitGrant(t.ownerId)}>Grant</button>
                        <button className="btn" disabled={busy} onClick={() => { setGrantFor(null); setReason(''); }}>Cancel</button>
                      </span>
                    ) : (
                      <button className="btn" onClick={() => { setGrantFor(t.ownerId); setAmount('1000'); }}>Grant credits</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ marginTop: '2rem' }}>Requested capabilities</h3>
      <p className="muted small">What users asked Atria for that doesn't exist yet — the demand backlog. Decide what to build next.</p>
      {!caps ? <p className="muted">Loading…</p> : caps.length === 0 ? <p className="muted">No capability requests yet.</p> : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {caps.map((c) => (
            <li key={c.capabilityId} style={{ padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <strong>{c.capabilityId}</strong>
              <span className="muted small"> · {c.requests} request{c.requests === 1 ? '' : 's'} · {c.tenants} tenant{c.tenants === 1 ? '' : 's'} · last {new Date(c.lastSeen).toLocaleDateString()}</span>
              {c.exampleTask && <div className="muted small" style={{ marginTop: 2 }}>“{c.exampleTask}”</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
