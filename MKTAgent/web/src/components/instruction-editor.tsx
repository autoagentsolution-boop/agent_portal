// Instruction editor (Atria Phase 08 / surfaces Phase 02). The "how I want my content" box,
// ChatGPT-style: workspace instructions (global) that Atria layers into EVERY agent's prompt, plus
// per-campaign overrides when a campaignId is supplied. Add / toggle / delete; hard guardrails always
// win server-side, so this is a steer, not a bypass.
import { useEffect, useState, useCallback } from 'react';
import { api, type InstructionDto, type InstructionScope } from '../api/client';

interface Props {
  scope?: InstructionScope; // 'workspace' (default) or 'campaign'
  refId?: string; // required when scope='campaign'
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

export function InstructionEditor({ scope = 'workspace', refId, notify }: Props) {
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
    if (r.ok) { setDraft(''); notify('Instruction added — Atria will honor it across your content.'); void load(); }
    else notify(r.error.error, 'err');
  };

  const toggle = async (row: InstructionDto) => {
    const r = await api.updateInstruction(row.id, { enabled: !row.enabled });
    if (r.ok) void load(); else notify(r.error.error, 'err');
  };

  const remove = async (row: InstructionDto) => {
    const r = await api.deleteInstruction(row.id);
    if (r.ok) void load(); else notify(r.error.error, 'err');
  };

  return (
    <section style={{ maxWidth: 720 }}>
      <h3>{scope === 'workspace' ? 'Atria Instructions' : 'Campaign instructions'}</h3>
      <p className="muted" style={{ marginTop: 4 }}>
        Tell Atria how you want your content — tone, rules, do's and don'ts. It refers to these across
        every agent. (Hard limits like length and platform caps always apply.)
      </p>

      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. Always end with a question. Never use emojis. Keep a warm, expert tone."
          rows={3}
          style={{ flex: 1, resize: 'vertical' }}
        />
        <button className="btn-primary" disabled={busy || !draft.trim()} onClick={() => void add()}>Add</button>
      </div>

      {rows.length === 0 ? (
        <p className="muted">No instructions yet — add one above.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
          {rows.map((row) => (
            <li key={row.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, border: '1px solid var(--border)', borderRadius: 8, opacity: row.enabled ? 1 : 0.5 }}>
              <input type="checkbox" checked={row.enabled} onChange={() => void toggle(row)} title="Enabled" />
              <span style={{ flex: 1 }}>
                {row.content}
                {row.source === 'memory' && <span className="tree-badge" title="Learned by the Memory Agent"> learned</span>}
                {row.agentId && <span className="muted"> · for {row.agentId}</span>}
              </span>
              <button className="icon-btn" aria-label="Delete" onClick={() => void remove(row)}>×</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
