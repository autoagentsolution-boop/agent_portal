// Nurture Inbox owner settings — the on/off auto-enroll toggle + cadence shape (max touches, gap days
// between them). Lead Nurture Agent Phase 04. A change here only shapes leads enrolled AFTER saving —
// backend snapshots the cadence into each thread's sequenceId at enroll time.
import { useEffect, useState } from 'react';
import { api, type NurtureSettingsDto } from '../api/client';
import { useLocale } from '../i18n';
import { tError } from '../i18n/t-error';

interface Props { notify: (msg: string, kind?: 'ok' | 'err') => void }

export function NurtureSettingsPanel({ notify }: Props) {
  const { t } = useLocale();
  const [settings, setSettings] = useState<NurtureSettingsDto | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await api.getNurtureSettings();
      if (r.ok) setSettings(r.data); else notify(tError(r.error), 'err');
    })();
  }, [notify]);

  const save = async (patch: Partial<NurtureSettingsDto>) => {
    setSaving(true);
    const r = await api.updateNurtureSettings(patch);
    setSaving(false);
    if (!r.ok) { notify(tError(r.error), 'err'); return; }
    setSettings(r.data);
    notify(t('nurture.settings.saved'));
  };

  if (!settings) return <p className="muted">{t('common.loading')}</p>;

  return (
    <div>
      <div className="ws-panel-head">
        <div>
          <h3>⚙ {t('nurture.settings.title')}</h3>
          <span className="muted">{t('nurture.settings.subtitle')}</span>
        </div>
      </div>

      <label className="ws-status-chip" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={settings.enabled} disabled={saving} onChange={(e) => void save({ enabled: e.target.checked })} />
        {t('nurture.settings.auto_enroll')}
      </label>

      <label className="email-label">{t('nurture.settings.touches_label')}</label>
      <input
        className="email-subject"
        type="number"
        min={1}
        max={12}
        value={settings.maxTouches}
        disabled={saving}
        onChange={(e) => void save({ maxTouches: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })}
      />

      <label className="email-label">{t('nurture.settings.gap_days_label')}</label>
      <input
        className="email-subject"
        type="number"
        min={1}
        max={30}
        value={settings.gapDays}
        disabled={saving}
        onChange={(e) => void save({ gapDays: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })}
      />
      <p className="muted" style={{ marginTop: 10 }}>
        {t('nurture.settings.footnote')}
      </p>
    </div>
  );
}
