// Concept copy editor — inline "✎ Edit copy" (hand edit, no LLM) + "✨ Refine with AI"
// (targeted LLM instruction) for a generated concept_writer draft. Shared by both run-detail
// surfaces (PostWorkflowView under a campaign post, and SavedFlowDetail for a standalone flow
// run) so the two views don't drift out of feature parity — this was previously duplicated
// inline in post-workflow-view.tsx only, which is why SavedFlowDetail never had it.
import { useState } from 'react';
import { api } from '../api/client';

export interface Copy { body: string; threads: string; x: string }

interface Props {
  postId: string;
  copy: Copy;
  busy: boolean; // parent's busy flag — disables while another action (execute/approve/rerun) is in flight
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onSaved: () => void; // reload the run so the refreshed concept artifact re-renders
}

export function ConceptCopyEditor({ postId, copy, busy: parentBusy, notify, onSaved }: Props) {
  const [editCopy, setEditCopy] = useState<Copy | null>(null);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineText, setRefineText] = useState('');
  const [busy, setBusy] = useState(false);
  const disabled = busy || parentBusy;

  const save = async () => {
    if (!editCopy) return;
    setBusy(true);
    try {
      const r = await api.editCopy(postId, editCopy);
      if (!r.ok) { notify(`Save copy: ${r.error.error}`, 'err'); return; }
      setEditCopy(null); notify('Copy updated'); onSaved();
    } finally { setBusy(false); }
  };

  const refine = async () => {
    const text = refineText.trim();
    if (!text) return;
    setBusy(true);
    try {
      const r = await api.refine(postId, text);
      if (!r.ok) { notify(`Refine: ${r.error.error}`, 'err'); return; }
      setRefineOpen(false); setRefineText(''); notify('Copy refined'); onSaved();
    } finally { setBusy(false); }
  };

  return (
    <div className="copy-edit-row">
      {!editCopy && !refineOpen && (
        <div className="btn-row">
          <button className="btn small" disabled={disabled} onClick={() => setEditCopy({ ...copy })}>✎ Edit copy</button>
          <button className="btn small" disabled={disabled} onClick={() => setRefineOpen(true)}>✨ Refine with AI</button>
        </div>
      )}
      {editCopy && (
        <div className="copy-editor">
          <label>Body</label>
          <textarea rows={4} value={editCopy.body} onChange={(e) => setEditCopy({ ...editCopy, body: e.target.value })} />
          <label>Threads</label>
          <textarea rows={2} value={editCopy.threads} onChange={(e) => setEditCopy({ ...editCopy, threads: e.target.value })} />
          <label>X</label>
          <textarea rows={2} value={editCopy.x} onChange={(e) => setEditCopy({ ...editCopy, x: e.target.value })} />
          <div className="btn-row">
            <button className="btn small primary" disabled={disabled} onClick={() => void save()}>{busy ? 'Saving…' : 'Save copy'}</button>
            <button className="btn small" disabled={disabled} onClick={() => setEditCopy(null)}>Cancel</button>
          </div>
        </div>
      )}
      {refineOpen && (
        <div className="copy-editor">
          <label>Refine instruction</label>
          <textarea rows={3} autoFocus value={refineText} onChange={(e) => setRefineText(e.target.value)} placeholder="e.g. shorten the hook, add a discount mention, make the tone warmer…" />
          <div className="btn-row">
            <button className="btn small primary" disabled={disabled || !refineText.trim()} onClick={() => void refine()}>{busy ? 'Refining…' : 'Refine'}</button>
            <button className="btn small" disabled={disabled} onClick={() => { setRefineOpen(false); setRefineText(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
