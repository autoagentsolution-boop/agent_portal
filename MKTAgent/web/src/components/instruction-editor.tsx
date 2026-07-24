// Instruction editor (Atria Phase 08 / surfaces Phase 02). The "how I want my content" box,
// ChatGPT-style: workspace instructions (global) that Atria layers into EVERY agent's prompt, plus
// per-campaign overrides when a campaignId is supplied. Add / toggle / delete; hard guardrails always
// win server-side, so this is a steer, not a bypass.
import { useEffect, useState, useCallback } from 'react';
import { api, type InstructionDto, type InstructionScope } from '../api/client';
import { useLocale } from '../i18n';
import { tError } from '../i18n/t-error';

interface Props {
  scope?: InstructionScope; // 'workspace' (default) or 'campaign'
  refId?: string; // required when scope='campaign'
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

export function InstructionEditor({ scope = 'workspace', refId, notify }: Props) {
  const { t } = useLocale();
  const [rows, setRows] = useState<InstructionDto[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api.listInstructions(scope, refId);
    if (r.ok) setRows(r.data);
  }, [scope, refId]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    const content = draft.trim();
    if (!content) return;
    setBusy(true);
    const r = await api.createInstruction({ scope, scopeRefId: scope === 'workspace' ? null : refId, content });
    setBusy(false);
    if (r.ok) { setDraft(''); notify(t('instructions.added_notice')); void load(); }
    else notify(tError(r.error), 'err');
  };

  const toggle = async (row: InstructionDto) => {
    const r = await api.updateInstruction(row.id, { enabled: !row.enabled });
    if (r.ok) void load(); else notify(tError(r.error), 'err');
  };

  const remove = async (row: InstructionDto) => {
    const r = await api.deleteInstruction(row.id);
    if (r.ok) void load(); else notify(tError(r.error), 'err');
  };

  return (
    <section style={{ maxWidth: 720 }}>
      <h3>{scope === 'workspace' ? t('instructions.title.workspace') : t('instructions.title.campaign')}</h3>
      <p className="muted" style={{ marginTop: 4 }}>{t('instructions.description')}</p>

      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('instructions.placeholder')}
          rows={3}
          style={{ flex: 1, resize: 'vertical' }}
        />
        <button className="btn-primary" disabled={busy || !draft.trim()} onClick={() => void add()}>{t('instructions.add_cta')}</button>
      </div>

      {rows.length === 0 ? (
        <p className="muted">{t('instructions.empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
          {rows.map((row) => (
            <li key={row.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, border: '1px solid var(--border)', borderRadius: 8, opacity: row.enabled ? 1 : 0.5 }}>
              <input type="checkbox" checked={row.enabled} onChange={() => void toggle(row)} title={t('instructions.enabled_title')} />
              <span style={{ flex: 1 }}>
                {row.content}
                {row.source === 'memory' && <span className="tree-badge" title={t('instructions.learned_badge_title')}> {t('instructions.learned_badge_label')}</span>}
                {row.agentId && <span className="muted"> · {t('instructions.for_agent', { agent: row.agentId })}</span>}
              </span>
              <button className="icon-btn" aria-label={t('common.delete')} onClick={() => void remove(row)}>×</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
