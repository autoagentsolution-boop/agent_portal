// Email Agent surface — the Command Center drawer for the 📧 Email node (Atria v2 P2-2c). Lists
// nurture-worthy leads (highest-intent, never-contacted first), drafts a personal email (LLM), lets
// the user review + edit, then sends from THEIR Gmail — one lead at a time, no blast (no-burst rule).
// Rendered in the light drawer (.cc-drawer-body). Reuses .mem-*/.ws-* styling.
import { useCallback, useEffect, useState } from 'react';
import { api, connectUrl, type NurtureLeadDto, type EmailDraftDto } from '../api/client';
import { useLocale } from '../i18n';
import { tError } from '../i18n/t-error';

interface Props { notify: (msg: string, kind?: 'ok' | 'err') => void }

export function EmailPanel({ notify }: Props) {
  const { t } = useLocale();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [leads, setLeads] = useState<NurtureLeadDto[]>([]);
  const [draft, setDraft] = useState<EmailDraftDto | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null); // leadId being drafted
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const [s, l] = await Promise.all([api.emailStatus(), api.nurtureLeads()]);
    if (s.ok) setConnected(s.data.connected);
    if (l.ok) setLeads(l.data); else notify(tError(l.error), 'err');
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const startDraft = async (lead: NurtureLeadDto) => {
    setDrafting(lead.id);
    const r = await api.draftEmail(lead.id);
    setDrafting(null);
    if (!r.ok) { notify(tError(r.error), 'err'); return; }
    setDraft(r.data);
  };

  const send = async () => {
    if (!draft) return;
    setSending(true);
    const r = await api.sendEmail(draft.leadId, draft.subject, draft.body);
    setSending(false);
    if (!r.ok) { notify(tError(r.error), 'err'); return; }
    setLeads((prev) => prev.map((l) => l.id === draft.leadId ? { ...l, nurturedAt: new Date().toISOString() } : l));
    setDraft(null);
    notify(t('email.sent'));
  };

  if (draft) {
    return (
      <div className="cc-drawer-body">
        <button className="cc-drawer-back" onClick={() => setDraft(null)}>{t('email.back_to_leads')}</button>
        <div className="ws-panel-head"><div><h3>✉️ {t('email.draft.title')}</h3><span className="muted">{t('email.draft.to', { to: draft.to })}</span></div></div>
        <label className="email-label">{t('email.field.subject')}</label>
        <input className="email-subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
        <label className="email-label">{t('email.field.body')}</label>
        <textarea className="email-body" rows={12} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
        <div className="email-send-row">
          <button className="btn primary" onClick={() => void send()} disabled={sending}>{sending ? t('email.sending') : t('email.send_to.cta', { to: draft.to })}</button>
          <button className="btn" onClick={() => setDraft(null)}>{t('common.cancel')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="cc-drawer-body">
      <div className="ws-panel-head">
        <div><h3>📧 {t('email.title')}</h3><span className="muted">{t('email.subtitle')}</span></div>
      </div>

      {connected === false && (
        <div className="atria-suggestion" style={{ marginBottom: 12 }}>
          <strong>{t('email.not_connected')}</strong>
          <p className="muted" style={{ margin: '4px 0 8px' }}>{t('email.not_connected.body')}</p>
          <a className="btn primary sm" href={connectUrl('/connect/drive/start')}>{t('connect.platform.cta', { platform: 'Google' })}</a>
        </div>
      )}

      <div className="ws-section-title">{t('email.leads.title')}</div>
      {leads.length === 0 ? (
        <p className="muted">{t('email.leads.empty')}</p>
      ) : (
        <ul className="ws-post-list">
          {leads.map((l) => (
            <li key={l.id} className="mem-row">
              <div className="ws-agent-body" style={{ flex: 1 }}>
                <strong>{l.name || l.email}{typeof l.score === 'number' ? ` · ${l.score}` : ''}</strong>
                <span className="muted">{l.email}{l.sourceProduct ? ` · ${l.sourceProduct}` : ''}</span>
              </div>
              {l.nurturedAt
                ? <span className="muted" title={t('email.contacted.title', { time: new Date(l.nurturedAt).toLocaleString() })}>✓ {t('email.contacted.label')}</span>
                : <button className="btn primary sm" onClick={() => void startDraft(l)} disabled={drafting === l.id}>{drafting === l.id ? t('email.drafting') : t('email.draft.cta')}</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
