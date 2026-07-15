// Nurture Inbox owner settings — the on/off auto-enroll toggle + cadence shape (max touches, gap days
// between them). Lead Nurture Agent Phase 04. A change here only shapes leads enrolled AFTER saving —
// backend snapshots the cadence into each thread's sequenceId at enroll time.
import { useEffect, useState } from 'react';
import { api, type NurtureSettingsDto } from '../api/client';

interface Props { notify: (msg: string, kind?: 'ok' | 'err') => void }

export function NurtureSettingsPanel({ notify }: Props) {
  const [settings, setSettings] = useState<NurtureSettingsDto | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await api.getNurtureSettings();
      if (r.ok) setSettings(r.data); else notify(`Settings: ${r.error.error}`, 'err');
    })();
  }, [notify]);

  const save = async (patch: Partial<NurtureSettingsDto>) => {
    setSaving(true);
    const r = await api.updateNurtureSettings(patch);
    setSaving(false);
    if (!r.ok) { notify(`Settings: ${r.error.error}`, 'err'); return; }
    setSettings(r.data);
    notify('Saved.');
  };

  if (!settings) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="ws-panel-head">
        <div>
          <h3>⚙ Nurture settings</h3>
          <span className="muted">Every touch still needs your approval before it sends — this only shapes the cadence.</span>
        </div>
      </div>

      <label className="ws-status-chip" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={settings.enabled} disabled={saving} onChange={(e) => void save({ enabled: e.target.checked })} />
        Auto-enroll new leads with an email
      </label>

      <label className="email-label">Touches in the cadence (1–12)</label>
      <input
        className="email-subject"
        type="number"
        min={1}
        max={12}
        value={settings.maxTouches}
        disabled={saving}
        onChange={(e) => void save({ maxTouches: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })}
      />

      <label className="email-label">Days between touches (1–30)</label>
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
        Changing these only affects leads enrolled after you save — threads already running keep their original cadence.
      </p>
    </div>
  );
}
