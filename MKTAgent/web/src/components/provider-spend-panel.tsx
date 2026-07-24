// Provider spend panel for the super-admin console — what WE pay Google, off the mkt_llm_usage
// ledger. Split out of SuperAdminPage to keep that file focused (and under the 200-line rule).
//
// It shows SPEND and BURN RATE and deliberately claims no remaining balance: there is no API that
// exposes the Gemini prepaid balance (AI Studio's Usage-and-Limits page is the only place it lives).
// Presenting an inferred balance would be a guess that reads as a fact, so the panel says where the
// real number is instead. `costUsd` is likewise our price-table estimate at call time, not Google's
// invoice — accurate for trend and magnitude, not for reconciliation.
import { useEffect, useState } from 'react';
import { api, type ProviderSpendDto, type SpendSliceDto } from '../api/client';
import { useLocale } from '../i18n';

const usd = (n: number): string => `$${n.toFixed(2)}`;

function Tile({ label, bucket, sub }: { label: string; bucket: { calls: number; costUsd: number }; sub?: string }) {
  return (
    <div style={{ flex: '1 1 140px', padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
      <div className="muted small">{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 600 }}>{usd(bucket.costUsd)}</div>
      <div className="muted small">{bucket.calls.toLocaleString()} calls{sub ? ` · ${sub}` : ''}</div>
    </div>
  );
}

function SliceTable({ title, rows, total }: { title: string; rows: SpendSliceDto[]; total: number }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ flex: '1 1 280px' }}>
      <h4 style={{ margin: '0 0 6px' }}>{title}</h4>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <td style={{ padding: '4px 6px', wordBreak: 'break-all' }}>{r.key}</td>
              <td style={{ padding: '4px 6px', textAlign: 'right', opacity: 0.7 }}>{r.calls.toLocaleString()}</td>
              <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600 }}>{usd(r.costUsd)}</td>
              <td style={{ padding: '4px 6px', textAlign: 'right', opacity: 0.6, width: 48 }}>
                {total > 0 ? `${Math.round((r.costUsd / total) * 100)}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProviderSpendPanel() {
  const { t } = useLocale();
  const [data, setData] = useState<ProviderSpendDto | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    void api.adminProviderSpend().then((r) => (r.ok ? setData(r.data) : setUnavailable(true)));
  }, []);

  if (unavailable) return null; // non-admin gets 404 on every /admin route; the page already says so
  if (!data) return <p className="muted">{t('admin.spend.loading')}</p>;

  const { windows, daily, bySurface, byModel } = data;
  const avgPerDay = windows.last7d.costUsd / 7;
  const peak = Math.max(1, ...daily.map((d) => d.costUsd));

  return (
    <>
      <h3 style={{ marginTop: '2rem' }}>{t('admin.spend.title')}</h3>
      <p className="muted small">{t('admin.spend.subtitle')}</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <Tile label={t('admin.spend.last_24h')} bucket={windows.last24h} />
        <Tile label={t('admin.spend.last_7d')} bucket={windows.last7d} sub={t('admin.spend.avg_per_day', { amount: usd(avgPerDay) })} />
        <Tile label={t('admin.spend.last_30d')} bucket={windows.last30d} />
        <Tile label={t('admin.spend.lifetime')} bucket={windows.lifetime} />
      </div>

      {daily.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="muted small" style={{ marginBottom: 4 }}>{t('admin.spend.daily_chart_title')}</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 72 }}>
            {daily.map((d) => (
              <div
                key={d.day}
                title={t('admin.spend.daily_tooltip', { day: d.day, cost: usd(d.costUsd), calls: d.calls })}
                style={{
                  flex: 1,
                  minWidth: 6,
                  height: `${Math.max(2, (d.costUsd / peak) * 100)}%`,
                  background: 'rgba(120,180,255,0.55)',
                  borderRadius: '2px 2px 0 0',
                }}
              />
            ))}
          </div>
          <div className="muted small" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{daily[0]?.day}</span><span>{t('admin.spend.peak', { amount: usd(peak) })}</span><span>{daily[daily.length - 1]?.day}</span>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 16 }}>
        <SliceTable title={t('admin.spend.by_surface')} rows={bySurface} total={windows.last30d.costUsd} />
        <SliceTable title={t('admin.spend.by_model')} rows={byModel} total={windows.last30d.costUsd} />
      </div>

      <p className="muted small" style={{ marginTop: 12 }}>{t('admin.spend.balance_note')}</p>
    </>
  );
}
