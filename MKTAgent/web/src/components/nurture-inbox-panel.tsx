// Nurture Inbox — Command Center drawer for the 🌱 Nurture node (Lead Nurture Agent Phase 04). Lists
// every lead's nurture thread (flagging ones that need attention), opens NurtureThreadTimeline for the
// selected one, and a gear button opens the owner cadence settings. This is where "human-in-the-loop
// before every send" becomes a real UX — the Inbox is a unified view over every proactive touch AND
// reply draft awaiting approve/edit/reject.
import { useCallback, useEffect, useState } from 'react';
import { api, type NurtureThreadListDto, type NurtureThreadDetailDto } from '../api/client';
import { NurtureThreadTimeline } from './nurture-thread-timeline';
import { NurtureSettingsPanel } from './nurture-settings-panel';

interface Props { notify: (msg: string, kind?: 'ok' | 'err') => void }

const STATUS_LABEL: Record<string, string> = {
  active: 'Active', paused: 'Paused', converted: 'Converted', opted_out: 'Opted out', completed: 'Completed', failed: 'Failed',
};

export function NurtureInboxPanel({ notify }: Props) {
  const [threads, setThreads] = useState<NurtureThreadListDto[] | null>(null);
  const [selected, setSelected] = useState<NurtureThreadDetailDto | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    const r = await api.listNurtureThreads();
    if (r.ok) setThreads(r.data); else notify(`Nurture: ${r.error.error}`, 'err');
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const open = async (id: string) => {
    const r = await api.getNurtureThread(id);
    if (!r.ok) { notify(`Nurture: ${r.error.error}`, 'err'); return; }
    setSelected(r.data);
  };

  const onChanged = (updated: NurtureThreadDetailDto) => {
    setSelected(updated);
    setThreads((prev) => (prev ?? []).map((t) => (t.id === updated.id ? updated : t)));
  };

  if (showSettings) {
    return (
      <div className="cc-drawer-body">
        <button className="cc-drawer-back" onClick={() => setShowSettings(false)}>← Nurture Inbox</button>
        <NurtureSettingsPanel notify={notify} />
      </div>
    );
  }

  if (selected) {
    return (
      <NurtureThreadTimeline
        thread={selected}
        notify={notify}
        onBack={() => { setSelected(null); void load(); }}
        onChanged={onChanged}
      />
    );
  }

  return (
    <div className="cc-drawer-body">
      <div className="ws-panel-head">
        <div><h3>🌱 Nurture Inbox</h3><span className="muted">Approve, edit, or reject every touch and reply before it sends.</span></div>
        <button className="btn sm" onClick={() => setShowSettings(true)}>⚙ Settings</button>
      </div>

      {threads === null ? (
        <p className="muted">Loading…</p>
      ) : threads.length === 0 ? (
        <p className="muted">No nurture threads yet. Turn nurture on in Settings once you have captured leads with an email.</p>
      ) : (
        <ul className="ws-post-list">
          {threads.map((t) => (
            <li key={t.id} className="mem-row" onClick={() => void open(t.id)} style={{ cursor: 'pointer' }}>
              <div className="ws-agent-body" style={{ flex: 1 }}>
                <strong>{t.leadName || t.leadEmail || 'Lead'}</strong>
                <span className="muted">
                  {STATUS_LABEL[t.status] ?? t.status} · touch {t.touchNumber}
                  {t.hasUnhandledReply ? ' · new reply' : ''}
                  {t.needsHuman ? ' · ⚠ needs you' : ''}
                </span>
              </div>
              <span className="ws-post-open">Open</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
