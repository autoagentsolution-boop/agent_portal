// Memory Agent surface — the Command Center drawer for the 🧠 Memory node (Atria v2 P2-2a).
// Shows what Atria has LEARNED (source:'memory' instructions) and, on demand, analyses the user's
// hand-edited copy into new proposed style rules to Accept/Dismiss. Accepting writes a memory that
// every future concept_writer draft honours. Rendered in the light drawer (.cc-drawer-body).
import { useCallback, useEffect, useState } from 'react';
import { api, type MemoryDto, type MemoryFactDto, type MemoryProposalDto } from '../api/client';
import { useLocale } from '../i18n';
import { tError } from '../i18n/t-error';

interface Props { notify: (msg: string, kind?: 'ok' | 'err') => void }

// Friendly label key per slot-fact kind (P5a) — so "What Atria remembers" reads plainly, not as raw enum tags.
const FACT_KIND_KEY: Record<string, 'memory.kind.product' | 'memory.kind.brand' | 'memory.kind.audience' | 'memory.kind.preference' | 'memory.kind.contact' | 'memory.kind.note'> = {
  product: 'memory.kind.product', brand: 'memory.kind.brand', audience: 'memory.kind.audience',
  preference: 'memory.kind.preference', contact: 'memory.kind.contact', fact: 'memory.kind.note',
};

export function MemoryPanel({ notify }: Props) {
  const { t } = useLocale();
  const [memories, setMemories] = useState<MemoryDto[] | null>(null);
  const [facts, setFacts] = useState<MemoryFactDto[] | null>(null);
  const [proposals, setProposals] = useState<MemoryProposalDto[] | null>(null);
  const [editedCount, setEditedCount] = useState<number | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const loadMemories = useCallback(async () => {
    const r = await api.listMemories();
    if (r.ok) setMemories(r.data);
    else notify(tError(r.error), 'err');
  }, [notify]);

  const loadFacts = useCallback(async () => {
    const r = await api.listMemoryFacts();
    if (r.ok) setFacts(r.data);
    else notify(tError(r.error), 'err');
  }, [notify]);

  useEffect(() => { void loadMemories(); void loadFacts(); }, [loadMemories, loadFacts]);

  const forgetFact = async (f: MemoryFactDto) => {
    const r = await api.deleteMemoryFact(f.id);
    if (!r.ok) { notify(tError(r.error), 'err'); return; }
    setFacts((prev) => (prev ?? []).filter((x) => x.id !== f.id));
    notify(t('memory.forgotten'));
  };

  const analyze = async () => {
    setAnalyzing(true);
    const r = await api.memoryProposals();
    setAnalyzing(false);
    if (!r.ok) { notify(tError(r.error), 'err'); return; }
    setEditedCount(r.data.editedCount);
    setProposals(r.data.proposals);
    if (r.data.proposals.length === 0) {
      notify(r.data.editedCount < 3 ? t('memory.analyze.need_more_edits') : t('memory.analyze.no_pattern'), 'ok');
    }
  };

  const accept = async (p: MemoryProposalDto) => {
    const r = await api.acceptMemory(p.content, p.agentId);
    if (!r.ok) { notify(tError(r.error), 'err'); return; }
    setProposals((prev) => (prev ?? []).filter((x) => x.content !== p.content));
    setMemories((prev) => [r.data, ...(prev ?? [])]);
    notify(t('memory.learned'));
  };

  const dismiss = (p: MemoryProposalDto) => setProposals((prev) => (prev ?? []).filter((x) => x.content !== p.content));

  const forget = async (m: MemoryDto) => {
    const r = await api.deleteMemory(m.id);
    if (!r.ok) { notify(tError(r.error), 'err'); return; }
    setMemories((prev) => (prev ?? []).filter((x) => x.id !== m.id));
    notify(t('memory.forgotten'));
  };

  return (
    <div className="cc-drawer-body">
      <div className="ws-panel-head">
        <div>
          <h3>🧠 {t('memory.title')}</h3>
          <span className="muted">{t('memory.subtitle')}</span>
        </div>
        <button className="btn primary" onClick={() => void analyze()} disabled={analyzing}>
          {analyzing ? t('memory.analyzing') : t('memory.analyze.cta')}
        </button>
      </div>

      {proposals && proposals.length > 0 && (
        <>
          <div className="ws-section-title">{t('memory.proposed.title')}</div>
          <ul className="ws-post-list">
            {proposals.map((p) => (
              <li key={p.content} className="mem-proposal">
                <div className="mem-proposal-body">
                  <strong>{p.content}</strong>
                  {p.rationale && <span className="muted">{p.rationale}</span>}
                </div>
                <div className="mem-proposal-actions">
                  <button className="btn primary sm" onClick={() => void accept(p)}>{t('memory.remember.cta')}</button>
                  <button className="btn sm" onClick={() => dismiss(p)}>{t('memory.dismiss.cta')}</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {proposals && proposals.length === 0 && (
        <p className="muted" style={{ marginTop: 8 }}>
          {editedCount !== null && editedCount < 3
            ? t(editedCount === 1 ? 'memory.analyze.edited_count_one' : 'memory.analyze.edited_count_other', { count: editedCount })
            : t('memory.analyze.no_pattern')}
        </p>
      )}

      <div className="ws-section-title">{t('memory.facts.title')}</div>
      {facts === null ? (
        <p className="muted">{t('common.loading')}</p>
      ) : facts.length === 0 ? (
        <p className="muted">{t('memory.facts.empty')}</p>
      ) : (
        <ul className="ws-post-list">
          {facts.map((f) => (
            <li key={f.id} className="mem-row">
              <span className="mem-row-content">
                <strong>{FACT_KIND_KEY[f.kind] ? t(FACT_KIND_KEY[f.kind]) : f.kind}:</strong> {f.content}
              </span>
              <button className="ws-post-open mem-forget" onClick={() => void forgetFact(f)} title={t('memory.forget.title')}>{t('memory.forget.cta')}</button>
            </li>
          ))}
        </ul>
      )}

      <div className="ws-section-title">{t('memory.style.title')}</div>
      {memories === null ? (
        <p className="muted">{t('common.loading')}</p>
      ) : memories.length === 0 ? (
        <p className="muted">{t('memory.style.empty')}</p>
      ) : (
        <ul className="ws-post-list">
          {memories.map((m) => (
            <li key={m.id} className="mem-row">
              <span className="mem-row-content">{m.content}</span>
              <button className="ws-post-open mem-forget" onClick={() => void forget(m)} title={t('memory.forget.title')}>{t('memory.forget.cta')}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
