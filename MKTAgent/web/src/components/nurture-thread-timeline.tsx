// Nurture Inbox thread timeline — the Command Center drawer sub-view for ONE lead's nurture thread
// (Lead Nurture Agent Phase 04). Shows sent/pending touches + received replies in order, plus an
// editable draft + Approve/Reject for whatever is currently parked at a gate — "human-in-the-loop
// before every send" as a real UX, not just a park state. Pause/Resume/Convert/Opt-out are scoped to
// this one thread. Reuses email-panel's/memory-panel's existing classes (no new CSS).
import { useState } from 'react';
import { api, type NurtureThreadDetailDto, type NurturePendingDraftDto } from '../api/client';
import { useLocale } from '../i18n';
import { tError } from '../i18n/t-error';

interface Props {
  thread: NurtureThreadDetailDto;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onBack: () => void;
  onChanged: (updated: NurtureThreadDetailDto) => void;
}

type StageKey = 'nurture.stage.intro' | 'nurture.stage.value' | 'nurture.stage.cta' | 'nurture.stage.reply';
const STAGE_KEY: Record<string, StageKey> = { intro: 'nurture.stage.intro', value: 'nurture.stage.value', cta: 'nurture.stage.cta', reply: 'nurture.stage.reply' };
type StatusKey = 'nurture.status.active' | 'nurture.status.paused' | 'nurture.status.converted' | 'nurture.status.opted_out' | 'nurture.status.completed' | 'nurture.status.failed';
const STATUS_KEY: Record<string, StatusKey> = {
  active: 'nurture.status.active', paused: 'nurture.status.paused', converted: 'nurture.status.converted',
  opted_out: 'nurture.status.opted_out', completed: 'nurture.status.completed', failed: 'nurture.status.failed',
};

export function NurtureThreadTimeline({ thread, notify, onBack, onChanged }: Props) {
  const { t } = useLocale();
  const [editing, setEditing] = useState<Record<string, { subject: string; body: string }>>({});
  const [busy, setBusy] = useState<string | null>(null); // touchId | control action currently in flight

  const draftFor = (d: NurturePendingDraftDto) => editing[d.touchId] ?? { subject: d.subject ?? '', body: d.body ?? '' };
  const setDraft = (d: NurturePendingDraftDto, patch: Partial<{ subject: string; body: string }>) =>
    setEditing((prev) => ({ ...prev, [d.touchId]: { ...draftFor(d), ...patch } }));

  const approve = async (d: NurturePendingDraftDto) => {
    setBusy(d.touchId);
    const edit = editing[d.touchId];
    // Only send editedSubject/editedBody when the human actually changed something — an untouched
    // draft approves exactly what email_writer produced.
    const changed = edit && (edit.subject.trim() !== (d.subject ?? '') || edit.body.trim() !== (d.body ?? ''));
    const r = await api.approveNurtureTouch(thread.id, d.touchId, changed ? { editedSubject: edit.subject, editedBody: edit.body } : undefined);
    setBusy(null);
    if (!r.ok) { notify(tError(r.error), 'err'); return; }
    notify(d.gate === 'schedule' ? t('nurture.approve.confirmed') : t('nurture.approve.sent'));
    onChanged(r.data);
  };

  const reject = async (d: NurturePendingDraftDto) => {
    setBusy(d.touchId);
    const r = await api.rejectNurtureTouch(thread.id, d.touchId);
    setBusy(null);
    if (!r.ok) { notify(tError(r.error), 'err'); return; }
    notify(t('nurture.reject.discarded'));
    onChanged(r.data);
  };

  const control = async (action: 'pause' | 'resume' | 'convert' | 'opt-out') => {
    setBusy(action);
    const fn = action === 'pause' ? api.pauseNurtureThread
      : action === 'resume' ? api.resumeNurtureThread
      : action === 'convert' ? api.convertNurtureThread
      : api.optOutNurtureThread;
    const r = await fn(thread.id);
    setBusy(null);
    if (!r.ok) { notify(tError(r.error), 'err'); return; }
    const doneKey = action === 'opt-out' ? 'nurture.control.opted_out'
      : action === 'pause' ? 'nurture.control.paused'
      : action === 'resume' ? 'nurture.control.resumed'
      : 'nurture.control.converted';
    notify(t(doneKey));
    onChanged(r.data);
  };

  return (
    <div className="cc-drawer-body">
      <button className="cc-drawer-back" onClick={onBack}>{t('nurture.back_to_threads')}</button>
      <div className="ws-panel-head">
        <div>
          <h3>{thread.leadName || thread.leadEmail || t('nurture.lead.fallback_name')}</h3>
          <span className="muted">{thread.leadEmail} · {STATUS_KEY[thread.status] ? t(STATUS_KEY[thread.status]) : thread.status} · {t('nurture.touch.label', { n: thread.touchNumber })}</span>
        </div>
      </div>
      {thread.needsHuman && <p className="muted">⚠ {t('nurture.escalated')}</p>}

      <div className="ws-status-row">
        {thread.status === 'active' && <button className="btn sm" onClick={() => void control('pause')} disabled={!!busy}>{t('nurture.control.pause_cta')}</button>}
        {thread.status === 'paused' && <button className="btn sm" onClick={() => void control('resume')} disabled={!!busy}>{t('nurture.control.resume_cta')}</button>}
        {(thread.status === 'active' || thread.status === 'paused') && (
          <>
            <button className="btn sm" onClick={() => void control('convert')} disabled={!!busy}>{t('nurture.control.convert_cta')}</button>
            <button className="btn sm danger" onClick={() => void control('opt-out')} disabled={!!busy}>{t('nurture.control.opt_out_cta')}</button>
          </>
        )}
      </div>

      {thread.pendingDrafts.length > 0 && (
        <>
          <div className="ws-section-title">{t('nurture.pending.title')}</div>
          {thread.pendingDrafts.map((d) => {
            const draft = draftFor(d);
            return (
              <div key={d.touchId} className="mem-proposal" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <span className="muted">{d.gate === 'schedule' ? t('nurture.pending.confirm_gate') : t('nurture.pending.ready')} · {t('nurture.pending.to', { to: d.to?.join(', ') ?? '—' })}</span>
                <label className="email-label">{t('email.field.subject')}</label>
                <input className="email-subject" value={draft.subject} onChange={(e) => setDraft(d, { subject: e.target.value })} />
                <label className="email-label">{t('email.field.body')}</label>
                <textarea className="email-body" rows={8} value={draft.body} onChange={(e) => setDraft(d, { body: e.target.value })} />
                <div className="email-send-row">
                  <button className="btn primary sm" onClick={() => void approve(d)} disabled={busy === d.touchId}>
                    {busy === d.touchId ? t('nurture.working') : d.gate === 'schedule' ? t('nurture.confirm.cta') : t('nurture.approve_send.cta')}
                  </button>
                  <button className="btn sm" onClick={() => void reject(d)} disabled={busy === d.touchId}>{t('common.reject')}</button>
                </div>
              </div>
            );
          })}
        </>
      )}

      <div className="ws-section-title">{t('nurture.touches.title')}</div>
      <ul className="ws-post-list">
        {thread.touches.length === 0 && <li className="muted">{t('nurture.touches.empty')}</li>}
        {thread.touches.map((tc) => (
          <li key={tc.id} className="mem-row">
            <span className="mem-row-content">
              <strong>{STAGE_KEY[tc.stage] ? t(STAGE_KEY[tc.stage]) : tc.stage}</strong> — {tc.status}
              {tc.sentAt ? ` · ${t('nurture.touch.sent_at', { time: new Date(tc.sentAt).toLocaleString() })}` : ''}
            </span>
          </li>
        ))}
      </ul>

      <div className="ws-section-title">{t('nurture.replies.title')}</div>
      <ul className="ws-post-list">
        {thread.replies.length === 0 && <li className="muted">{t('nurture.replies.empty')}</li>}
        {thread.replies.map((r) => (
          <li key={r.id} className="mem-row">
            <span className="mem-row-content">
              <strong>{r.fromEmail}</strong> · {new Date(r.receivedAt).toLocaleString()}
              <br />{r.body.slice(0, 300)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
