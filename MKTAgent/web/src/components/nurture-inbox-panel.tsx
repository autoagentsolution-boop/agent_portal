// Nurture Inbox — Command Center drawer for the 🌱 Nurture node (Lead Nurture Agent Phase 04). Lists
// every lead's nurture thread (flagging ones that need attention), opens NurtureThreadTimeline for the
// selected one, and a gear button opens the owner cadence settings. This is where "human-in-the-loop
// before every send" becomes a real UX — the Inbox is a unified view over every proactive touch AND
// reply draft awaiting approve/edit/reject.
import { useCallback, useEffect, useState } from 'react';
import { api, type NurtureThreadListDto, type NurtureThreadDetailDto } from '../api/client';
import { NurtureThreadTimeline } from './nurture-thread-timeline';
import { NurtureSettingsPanel } from './nurture-settings-panel';
import { useLocale } from '../i18n';
import { tError } from '../i18n/t-error';

interface Props { notify: (msg: string, kind?: 'ok' | 'err') => void }

type StatusKey = 'nurture.status.active' | 'nurture.status.paused' | 'nurture.status.converted' | 'nurture.status.opted_out' | 'nurture.status.completed' | 'nurture.status.failed';
const STATUS_KEY: Record<string, StatusKey> = {
  active: 'nurture.status.active', paused: 'nurture.status.paused', converted: 'nurture.status.converted',
  opted_out: 'nurture.status.opted_out', completed: 'nurture.status.completed', failed: 'nurture.status.failed',
};

export function NurtureInboxPanel({ notify }: Props) {
  const { t } = useLocale();
  const [threads, setThreads] = useState<NurtureThreadListDto[] | null>(null);
  const [selected, setSelected] = useState<NurtureThreadDetailDto | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    const r = await api.listNurtureThreads();
    if (r.ok) setThreads(r.data); else notify(tError(r.error), 'err');
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const open = async (id: string) => {
    const r = await api.getNurtureThread(id);
    if (!r.ok) { notify(tError(r.error), 'err'); return; }
    setSelected(r.data);
  };

  const onChanged = (updated: NurtureThreadDetailDto) => {
    setSelected(updated);
    setThreads((prev) => (prev ?? []).map((t) => (t.id === updated.id ? updated : t)));
  };

  if (showSettings) {
    return (
      <div className="cc-drawer-body">
        <button className="cc-drawer-back" onClick={() => setShowSettings(false)}>{t('nurture.back_to_inbox')}</button>
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
        <div><h3>🌱 {t('nurture.inbox.title')}</h3><span className="muted">{t('nurture.inbox.subtitle')}</span></div>
        <button className="btn sm" onClick={() => setShowSettings(true)}>⚙ {t('nurture.settings.cta')}</button>
      </div>

      {threads === null ? (
        <p className="muted">{t('common.loading')}</p>
      ) : threads.length === 0 ? (
        <p className="muted">{t('nurture.inbox.empty')}</p>
      ) : (
        <ul className="ws-post-list">
          {threads.map((th) => (
            <li key={th.id} className="mem-row" onClick={() => void open(th.id)} style={{ cursor: 'pointer' }}>
              <div className="ws-agent-body" style={{ flex: 1 }}>
                <strong>{th.leadName || th.leadEmail || t('nurture.lead.fallback_name')}</strong>
                <span className="muted">
                  {STATUS_KEY[th.status] ? t(STATUS_KEY[th.status]) : th.status} · {t('nurture.touch.label', { n: th.touchNumber })}
                  {th.hasUnhandledReply ? ` · ${t('nurture.new_reply')}` : ''}
                  {th.needsHuman ? ` · ⚠ ${t('nurture.needs_you')}` : ''}
                </span>
              </div>
              <span className="ws-post-open">{t('nurture.open.cta')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
