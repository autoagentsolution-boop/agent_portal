// Reusable per-agent credential/setup panel. Keyed by the canonical registry agent id
// (snake_case). Owns its own credential-status fetch + save/delete so any surface (real
// flow node in SavedFlowDetail) can drop it in with just an agentId. Never renders secret
// values — inputs are write-only (type=password, cleared after save).
import { useEffect, useMemo, useState } from 'react';
import { api, type AgentCredentialStatusDto } from '../api/client';
import { agentTitle, credentialNeeds, credentialFields } from '../flow/agent-credentials';

interface Props {
  agentId: string;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

export function AgentCredentialPanel({ agentId, notify }: Props) {
  const [status, setStatus] = useState<AgentCredentialStatusDto[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const byKey = useMemo(() => {
    const map = new Map<string, AgentCredentialStatusDto>();
    for (const c of status) map.set(`${c.agentId}:${c.key}`, c);
    return map;
  }, [status]);

  const load = async () => {
    const r = await api.listAgentCredentialStatus();
    if (r.ok) setStatus(r.data);
    else notify(`Load credentials failed: ${r.error.error}`, 'err');
  };
  useEffect(() => { setValues({}); void load(); }, [agentId]);

  const save = async (key: string) => {
    const value = values[key]?.trim();
    if (!value) return;
    setSavingKey(key);
    const r = await api.saveAgentCredential(agentId, key, value);
    setSavingKey(null);
    if (!r.ok) { notify(`Save credential failed: ${r.error.error}`, 'err'); return; }
    setValues((cur) => ({ ...cur, [key]: '' }));
    setStatus((cur) => [r.data, ...cur.filter((i) => !(i.agentId === agentId && i.key === key))]);
    notify('Credential saved encrypted');
  };

  const remove = async (key: string) => {
    if (!confirm('Delete this stored credential?')) return;
    setSavingKey(key);
    const r = await api.deleteAgentCredential(agentId, key);
    setSavingKey(null);
    if (!r.ok) { notify(`Delete credential failed: ${r.error.error}`, 'err'); return; }
    setStatus((cur) => cur.filter((i) => !(i.agentId === agentId && i.key === key)));
    setValues((cur) => ({ ...cur, [key]: '' }));
    notify('Credential deleted');
  };

  const needs = credentialNeeds[agentId] ?? [];
  const fields = credentialFields[agentId] ?? [];

  return (
    <div className="credential-panel">
      <div className="section-title">{agentTitle(agentId)} — setup</div>
      {needs.map((need) => <div className="missing-item" key={need}><span>{need}</span></div>)}

      {fields.length > 0 && (
        <>
          <div className="section-title">Encrypted credential inputs</div>
          {fields.map((field) => {
            const st = byKey.get(`${agentId}:${field.key}`);
            const value = values[field.key] ?? '';
            const busy = savingKey === field.key;
            return (
              <div className="credential-row" key={field.key}>
                <div className="credential-meta">
                  <strong>{field.label}</strong>
                  <span className={`credential-status ${st ? 'active' : 'missing'}`}>{st ? st.status : 'missing'}</span>
                  <p>{field.help}</p>
                </div>
                <div className="credential-actions">
                  <input
                    aria-label={`${field.label} value`}
                    autoComplete="off"
                    placeholder={st ? 'Saved — paste to replace' : 'Paste credential value'}
                    type="password"
                    value={value}
                    onChange={(e) => setValues((cur) => ({ ...cur, [field.key]: e.target.value }))}
                  />
                  <button className="btn primary" disabled={busy || value.trim().length === 0} onClick={() => void save(field.key)}>
                    {busy ? 'Saving…' : st ? 'Replace' : 'Save'}
                  </button>
                  {st && <button className="btn danger" disabled={busy} onClick={() => void remove(field.key)}>Delete</button>}
                </div>
              </div>
            );
          })}
        </>
      )}

      {needs.length === 0 && fields.length === 0 && (
        <p className="muted small">This step runs automatically — no setup required.</p>
      )}
    </div>
  );
}
