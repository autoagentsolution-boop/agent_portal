// Add-post create-mode picker (item 3). Two ways to add a brief under the current campaign:
//   • Manual input       → the existing PostBriefForm (unchanged) — caller opens it.
//   • Create with Master Agent → describe the post; the agent extracts + fills the brief
//                          fields so the user never hand-fills the form. Post lands under
//                          THIS campaign in `brief` status and opens on the board to tweak.
import { useState } from 'react';
import { api, type PostDto } from '../api/client';

interface Props {
  campaignId: string;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onManual: () => void;
  onCreated: (post: PostDto) => void;
  onClose: () => void;
}

type View = 'choose' | 'agent';

export function CreatePostModal({ campaignId, notify, onManual, onCreated, onClose }: Props) {
  const [view, setView] = useState<View>('choose');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const createWithAgent = async () => {
    const text = message.trim();
    if (text.length < 3) { notify('Describe the post first', 'err'); return; }
    setBusy(true);
    try {
      const r = await api.createPostFromAgent(campaignId, text);
      if (!r.ok) { notify(`Create failed: ${r.error.error}`, 'err'); return; }
      const captured = r.data.filled?.length ? `Filled: ${r.data.filled.join(', ')}` : 'Brief created';
      notify(captured);
      onCreated(r.data);
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="spread">
          <h3 style={{ margin: 0 }}>{view === 'choose' ? 'Add a post' : 'Create with Master Agent'}</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>×</button>
        </div>

        {view === 'choose' && (
          <div className="modal-choices">
            <button className="modal-choice" onClick={onManual}>
              <span className="modal-choice-title">✎ Manual input</span>
              <span className="modal-choice-sub">Fill the brief fields yourself — language, length, media, platforms.</span>
            </button>
            <button className="modal-choice primary" onClick={() => setView('agent')}>
              <span className="modal-choice-title">✨ Create with Master Agent</span>
              <span className="modal-choice-sub">Describe the post — the agent fills the brief for you.</span>
            </button>
          </div>
        )}

        {view === 'agent' && (
          <div className="modal-agent">
            <textarea
              autoFocus
              value={message}
              disabled={busy}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void createWithAgent(); } }}
              placeholder="e.g. Short punchy Vietnamese Instagram post about our AI automation course, upbeat brand voice"
              rows={4}
            />
            {busy && (
              <div className="chat-bubble agent thinking-bubble" role="status" aria-live="polite">
                <span className="thinking-copy">Thinking</span>
                <span className="thinking-dots" aria-hidden="true"><span /><span /><span /></span>
              </div>
            )}
            <div className="btn-row">
              <button className="btn primary" disabled={busy} onClick={() => void createWithAgent()}>{busy ? 'Creating…' : 'Create post'}</button>
              <button className="btn" disabled={busy} onClick={() => setView('choose')}>Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
