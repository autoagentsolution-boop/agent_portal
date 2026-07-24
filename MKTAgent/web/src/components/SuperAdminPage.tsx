// Super-admin console (credit-wallet Phase 03) — reachable ONLY at /superadminatria101, never in the
// nav. Two jobs in one page: grant credits to tenants, and read the platform-wide capability-request
// backlog (what users asked Atria for that no node builds yet). The server (requireSuperAdmin → 404)
// is the real gate; this page's client guard just avoids rendering the surface to a non-admin.
import { useCallback, useEffect, useState } from 'react';
import { api, type TenantBalanceDto, type CapabilityRequestDto } from '../api/client';
import { ProviderSpendPanel } from './provider-spend-panel';
import { useLocale } from '../i18n';
import { tError } from '../i18n/t-error';

interface Props {
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onCreditsChanged: () => void; // refresh the top-nav pill after a self-grant
}

export function SuperAdminPage({ notify, onCreditsChanged }: Props) {
  const { t } = useLocale();
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
    if (!Number.isFinite(credits) || credits <= 0) { notify(t('admin.grant.invalid_amount'), 'err'); return; }
    setBusy(true);
    const r = await api.adminGrant(ownerId, credits, reason.trim() || undefined);
    setBusy(false);
    if (!r.ok) { notify(t('admin.grant.failed', { reason: tError(r.error) }), 'err'); return; }
    notify(t('admin.grant.success', { credits, balance: r.data.balance }), 'ok');
    setGrantFor(null); setReason('');
    await load();
    onCreditsChanged();
  };

  if (forbidden) return <div className="center"><div className="muted">{t('admin.not_found')}</div></div>;

  return (
    <section className="superadmin" style={{ maxWidth: 960, margin: '0 auto', padding: '1rem' }}>
      <div className="orchestrate-head">
        <h2>{t('admin.console.title')}</h2>
        <p className="muted small">{t('admin.console.subtitle')}</p>
      </div>

      <h3 style={{ marginTop: '1.5rem' }}>{t('admin.tenants.title')}</h3>
      {!tenants ? <p className="muted">{t('common.loading')}</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', opacity: 0.7 }}>
                <th style={{ padding: '6px 8px' }}>{t('admin.tenants.col.tenant')}</th>
                <th style={{ padding: '6px 8px' }}>{t('admin.tenants.col.balance')}</th>
                <th style={{ padding: '6px 8px' }}>{t('admin.tenants.col.granted')}</th>
                <th style={{ padding: '6px 8px' }}>{t('admin.tenants.col.spent')}</th>
                <th style={{ padding: '6px 8px' }}>{t('admin.tenants.col.last_active')}</th>
                <th style={{ padding: '6px 8px' }} />
              </tr>
            </thead>
            <tbody>
              {tenants.map((row) => (
                <tr key={row.ownerId} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <td style={{ padding: '6px 8px' }}>
                    {row.email}{row.isSuperAdmin && <span title={t('admin.tenants.super_admin_title')}> ⭐</span>}
                  </td>
                  <td style={{ padding: '6px 8px', fontWeight: 600, color: row.balance <= 0 ? '#ff6b6b' : undefined }}>◈ {row.balance.toLocaleString()}</td>
                  <td style={{ padding: '6px 8px', opacity: 0.7 }}>{row.granted.toLocaleString()}</td>
                  <td style={{ padding: '6px 8px', opacity: 0.7 }}>{row.spent.toLocaleString()}</td>
                  <td style={{ padding: '6px 8px', opacity: 0.7 }}>{new Date(row.lastActive).toLocaleDateString()}</td>
                  <td style={{ padding: '6px 8px' }}>
                    {grantFor === row.ownerId ? (
                      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 80 }} placeholder={t('admin.grant.amount_placeholder')} />
                        <input value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 120 }} placeholder={t('admin.grant.reason_placeholder')} />
                        <button className="btn primary" disabled={busy} onClick={() => void submitGrant(row.ownerId)}>{t('admin.grant.submit_cta')}</button>
                        <button className="btn" disabled={busy} onClick={() => { setGrantFor(null); setReason(''); }}>{t('common.cancel')}</button>
                      </span>
                    ) : (
                      <button className="btn" onClick={() => { setGrantFor(row.ownerId); setAmount('1000'); }}>{t('admin.grant.open_cta')}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ProviderSpendPanel />

      <h3 style={{ marginTop: '2rem' }}>{t('admin.capabilities.title')}</h3>
      <p className="muted small">{t('admin.capabilities.subtitle')}</p>
      {!caps ? <p className="muted">{t('common.loading')}</p> : caps.length === 0 ? <p className="muted">{t('admin.capabilities.empty')}</p> : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {caps.map((c) => (
            <li key={c.capabilityId} style={{ padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <strong>{c.capabilityId}</strong>
              <span className="muted small">
                {' '}· {t(c.requests === 1 ? 'admin.capabilities.requests.one' : 'admin.capabilities.requests.other', { count: c.requests })}
                {' '}· {t(c.tenants === 1 ? 'admin.capabilities.tenants.one' : 'admin.capabilities.tenants.other', { count: c.tenants })}
                {' '}· {t('admin.capabilities.last_seen', { date: new Date(c.lastSeen).toLocaleDateString() })}
              </span>
              {c.exampleTask && <div className="muted small" style={{ marginTop: 2 }}>“{c.exampleTask}”</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
