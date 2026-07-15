// Nurture Inbox thread timeline — the Command Center drawer sub-view for ONE lead's nurture thread
// (Lead Nurture Agent Phase 04). Shows sent/pending touches + received replies in order, plus an
// editable draft + Approve/Reject for whatever is currently parked at a gate — "human-in-the-loop
// before every send" as a real UX, not just a park state. Pause/Resume/Convert/Opt-out are scoped to
// this one thread. Reuses email-panel's/memory-panel's existing classes (no new CSS).
import { useState } from 'react';
import { api, type NurtureThreadDetailDto, type NurturePendingDraftDto } from '../api/client';

interface Props {
  thread: NurtureThreadDetailDto;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onBack: () => void;
  onChanged: (updated: NurtureThreadDetailDto) => void;
}

const STAGE_LABEL: Record<string, string> = { intro: 'Intro', value: 'Value', cta: 'Call to action', reply: 'Reply' };
const STATUS_LABEL: Record<string, string> = {
  active: 'Active', paused: 'Paused', converted: 'Converted', opted_out: 'Opted out', completed: 'Completed', failed: 'Failed',
};

export function NurtureThreadTimeline({ thread, notify, onBack, onChanged }: Props) {
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
    if (!r.ok) { notify(`Approve: ${r.error.error}`, 'err'); return; }
    notify(d.gate === 'schedule' ? 'Confirmed — approve once more to send.' : 'Sent.');
    onChanged(r.data);
  };

  const reject = async (d: NurturePendingDraftDto) => {
    setBusy(d.touchId);
    const r = await api.rejectNurtureTouch(thread.id, d.touchId);
    setBusy(null);
    if (!r.ok) { notify(`Reject: ${r.error.error}`, 'err'); return; }
    notify('Discarded — nothing was sent.');
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
    if (!r.ok) { notify(`${action}: ${r.error.error}`, 'err'); return; }
    notify(action === 'opt-out' ? 'Opted out — this lead will never be contacted again.' : `Thread ${action}d.`);
    onChanged(r.data);
  };

  return (
    <div className="cc-drawer-body">
      <button className="cc-drawer-back" onClick={onBack}>← Threads</button>
      <div className="ws-panel-head">
        <div>
          <h3>{thread.leadName || thread.leadEmail || 'Lead'}</h3>
          <span className="muted">{thread.leadEmail} · {STATUS_LABEL[thread.status] ?? thread.status} · touch {thread.touchNumber}</span>
        </div>
      </div>
      {thread.needsHuman && <p className="muted">⚠ Atria escalated this thread — review the latest reply below.</p>}

      <div className="ws-status-row">
        {thread.status === 'active' && <button className="btn sm" onClick={() => void control('pause')} disabled={!!busy}>Pause</button>}
        {thread.status === 'paused' && <button className="btn sm" onClick={() => void control('resume')} disabled={!!busy}>Resume</button>}
        {(thread.status === 'active' || thread.status === 'paused') && (
          <>
            <button className="btn sm" onClick={() => void control('convert')} disabled={!!busy}>Mark converted</button>
            <button className="btn sm danger" onClick={() => void control('opt-out')} disabled={!!busy}>Opt out</button>
          </>
        )}
      </div>

      {thread.pendingDrafts.length > 0 && (
        <>
          <div className="ws-section-title">Pending your approval</div>
          {thread.pendingDrafts.map((d) => {
            const draft = draftFor(d);
            return (
              <div key={d.touchId} className="mem-proposal" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <span className="muted">{d.gate === 'schedule' ? 'Confirm this touch is ready to send' : 'Ready to send'} · to {d.to?.join(', ') ?? '—'}</span>
                <label className="email-label">Subject</label>
                <input className="email-subject" value={draft.subject} onChange={(e) => setDraft(d, { subject: e.target.value })} />
                <label className="email-label">Body</label>
                <textarea className="email-body" rows={8} value={draft.body} onChange={(e) => setDraft(d, { body: e.target.value })} />
                <div className="email-send-row">
                  <button className="btn primary sm" onClick={() => void approve(d)} disabled={busy === d.touchId}>
                    {busy === d.touchId ? 'Working…' : d.gate === 'schedule' ? 'Confirm' : 'Approve & send'}
                  </button>
                  <button className="btn sm" onClick={() => void reject(d)} disabled={busy === d.touchId}>Reject</button>
                </div>
              </div>
            );
          })}
        </>
      )}

      <div className="ws-section-title">Touches</div>
      <ul className="ws-post-list">
        {thread.touches.length === 0 && <li className="muted">No touches yet.</li>}
        {thread.touches.map((t) => (
          <li key={t.id} className="mem-row">
            <span className="mem-row-content">
              <strong>{STAGE_LABEL[t.stage] ?? t.stage}</strong> — {t.status}
              {t.sentAt ? ` · sent ${new Date(t.sentAt).toLocaleString()}` : ''}
            </span>
          </li>
        ))}
      </ul>

      <div className="ws-section-title">Replies</div>
      <ul className="ws-post-list">
        {thread.replies.length === 0 && <li className="muted">No replies yet.</li>}
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
