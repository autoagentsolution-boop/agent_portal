// Memory Agent surface — the Command Center drawer for the 🧠 Memory node (Atria v2 P2-2a).
// Shows what Atria has LEARNED (source:'memory' instructions) and, on demand, analyses the user's
// hand-edited copy into new proposed style rules to Accept/Dismiss. Accepting writes a memory that
// every future concept_writer draft honours. Rendered in the light drawer (.cc-drawer-body).
import { useCallback, useEffect, useState } from 'react';
import { api, type MemoryDto, type MemoryFactDto, type MemoryProposalDto } from '../api/client';

interface Props { notify: (msg: string, kind?: 'ok' | 'err') => void }

// Friendly label per slot-fact kind (P5a) — so "What Atria remembers" reads plainly, not as raw enum tags.
const FACT_KIND_LABEL: Record<string, string> = {
  product: 'Product', brand: 'Brand', audience: 'Audience', preference: 'Preference', contact: 'Contact', fact: 'Note',
};

export function MemoryPanel({ notify }: Props) {
  const [memories, setMemories] = useState<MemoryDto[] | null>(null);
  const [facts, setFacts] = useState<MemoryFactDto[] | null>(null);
  const [proposals, setProposals] = useState<MemoryProposalDto[] | null>(null);
  const [editedCount, setEditedCount] = useState<number | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const loadMemories = useCallback(async () => {
    const r = await api.listMemories();
    if (r.ok) setMemories(r.data);
    else notify(`Memory: ${r.error.error}`, 'err');
  }, [notify]);

  const loadFacts = useCallback(async () => {
    const r = await api.listMemoryFacts();
    if (r.ok) setFacts(r.data);
    else notify(`Memory: ${r.error.error}`, 'err');
  }, [notify]);

  useEffect(() => { void loadMemories(); void loadFacts(); }, [loadMemories, loadFacts]);

  const forgetFact = async (f: MemoryFactDto) => {
    const r = await api.deleteMemoryFact(f.id);
    if (!r.ok) { notify(`Forget: ${r.error.error}`, 'err'); return; }
    setFacts((prev) => (prev ?? []).filter((x) => x.id !== f.id));
    notify('Forgotten');
  };

  const analyze = async () => {
    setAnalyzing(true);
    const r = await api.memoryProposals();
    setAnalyzing(false);
    if (!r.ok) { notify(`Analyze: ${r.error.error}`, 'err'); return; }
    setEditedCount(r.data.editedCount);
    setProposals(r.data.proposals);
    if (r.data.proposals.length === 0) {
      notify(r.data.editedCount < 3 ? 'Edit a few more posts first — I learn from your edits.' : 'No consistent style pattern yet.', 'ok');
    }
  };

  const accept = async (p: MemoryProposalDto) => {
    const r = await api.acceptMemory(p.content, p.agentId);
    if (!r.ok) { notify(`Save: ${r.error.error}`, 'err'); return; }
    setProposals((prev) => (prev ?? []).filter((x) => x.content !== p.content));
    setMemories((prev) => [r.data, ...(prev ?? [])]);
    notify('Learned — future drafts will follow this.');
  };

  const dismiss = (p: MemoryProposalDto) => setProposals((prev) => (prev ?? []).filter((x) => x.content !== p.content));

  const forget = async (m: MemoryDto) => {
    const r = await api.deleteMemory(m.id);
    if (!r.ok) { notify(`Forget: ${r.error.error}`, 'err'); return; }
    setMemories((prev) => (prev ?? []).filter((x) => x.id !== m.id));
    notify('Forgotten');
  };

  return (
    <div className="cc-drawer-body">
      <div className="ws-panel-head">
        <div>
          <h3>🧠 Memory</h3>
          <span className="muted">Atria learns your copy style from the posts you edit.</span>
        </div>
        <button className="btn primary" onClick={() => void analyze()} disabled={analyzing}>
          {analyzing ? 'Analyzing…' : 'Analyze my edits'}
        </button>
      </div>

      {proposals && proposals.length > 0 && (
        <>
          <div className="ws-section-title">Proposed — approve to remember</div>
          <ul className="ws-post-list">
            {proposals.map((p) => (
              <li key={p.content} className="mem-proposal">
                <div className="mem-proposal-body">
                  <strong>{p.content}</strong>
                  {p.rationale && <span className="muted">{p.rationale}</span>}
                </div>
                <div className="mem-proposal-actions">
                  <button className="btn primary sm" onClick={() => void accept(p)}>Remember</button>
                  <button className="btn sm" onClick={() => dismiss(p)}>Dismiss</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {proposals && proposals.length === 0 && (
        <p className="muted" style={{ marginTop: 8 }}>
          {editedCount !== null && editedCount < 3
            ? `Only ${editedCount} edited post${editedCount === 1 ? '' : 's'} so far — edit a few more and I'll spot your style.`
            : 'No consistent pattern found in your edits yet.'}
        </p>
      )}

      <div className="ws-section-title">What Atria remembers about you</div>
      {facts === null ? (
        <p className="muted">Loading…</p>
      ) : facts.length === 0 ? (
        <p className="muted">Nothing yet — tell Atria about your product, brand, or audience in chat and it’ll remember.</p>
      ) : (
        <ul className="ws-post-list">
          {facts.map((f) => (
            <li key={f.id} className="mem-row">
              <span className="mem-row-content">
                <strong>{FACT_KIND_LABEL[f.kind] ?? f.kind}:</strong> {f.content}
              </span>
              <button className="ws-post-open mem-forget" onClick={() => void forgetFact(f)} title="Forget this">Forget</button>
            </li>
          ))}
        </ul>
      )}

      <div className="ws-section-title">Learned copy style</div>
      {memories === null ? (
        <p className="muted">Loading…</p>
      ) : memories.length === 0 ? (
        <p className="muted">Nothing learned yet. Edit some post copy, then Analyze.</p>
      ) : (
        <ul className="ws-post-list">
          {memories.map((m) => (
            <li key={m.id} className="mem-row">
              <span className="mem-row-content">{m.content}</span>
              <button className="ws-post-open mem-forget" onClick={() => void forget(m)} title="Forget this">Forget</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
