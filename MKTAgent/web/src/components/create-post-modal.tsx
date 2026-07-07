// Add-post create-mode picker (item 3). Two ways to add a brief under the current campaign:
//   • Manual input       → the existing PostBriefForm (unchanged) — caller opens it.
//   • Create with Master Agent → describe the post; the agent extracts + fills the brief
//                          fields so the user never hand-fills the form. If it can't fill
//                          the high-impact fields (angle/platforms/format) it ASKS first
//                          (clarify view), then creates the post under THIS campaign.
import { useEffect, useState } from 'react';
import { api, type PostDto, type Dto, type ProductKnowledgeEntry } from '../api/client';

type ClarifyQuestion = NonNullable<Dto['PostFromAgentDto']['questions']>[number];

interface Props {
  campaignId: string;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onManual: () => void;
  onCreated: (post: PostDto) => void;
  onClose: () => void;
}

type View = 'choose' | 'agent' | 'clarify';

export function CreatePostModal({ campaignId, notify, onManual, onCreated, onClose }: Props) {
  const [view, setView] = useState<View>('choose');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [questions, setQuestions] = useState<ClarifyQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  // Product library so an agent-created post can reuse a stored product (feedback #4) instead of
  // re-describing it — pick here, or leave "Inherit from campaign" for the campaign default.
  const [library, setLibrary] = useState<ProductKnowledgeEntry[]>([]);
  const [knowledgeId, setKnowledgeId] = useState<string>('');
  useEffect(() => { void api.listProductKnowledge().then((r) => { if (r.ok) setLibrary(r.data); }); }, []);

  // Finalize: post the message (+ answers when finishing a clarify round). A 200 with
  // questions switches to the clarify view; a 201 with a post closes + hands it up.
  const submit = async (withAnswers?: Record<string, string | string[]>) => {
    const text = message.trim();
    if (text.length < 3) { notify('Describe the post first', 'err'); return; }
    setBusy(true);
    try {
      const r = await api.createPostFromAgent(campaignId, text, withAnswers, knowledgeId || null);
      if (!r.ok) { notify(`Create failed: ${r.error.error}`, 'err'); return; }
      if (r.data.questions?.length) {
        setQuestions(r.data.questions);
        // Seed single-choice defaults so an optional question has a value even if skipped.
        const seed: Record<string, string | string[]> = {};
        for (const q of r.data.questions) {
          if (q.choices && !q.multiSelect) seed[q.slot] = q.choices[0];
          else if (q.multiSelect) seed[q.slot] = [];
          else seed[q.slot] = '';
        }
        setAnswers(seed);
        setView('clarify');
        return;
      }
      if (r.data.post) {
        notify(r.data.filled?.length ? `Filled: ${r.data.filled.join(', ')}` : 'Brief created');
        onCreated(r.data.post as PostDto);
      }
    } finally { setBusy(false); }
  };

  const setAnswer = (slot: string, value: string | string[]) => setAnswers((prev) => ({ ...prev, [slot]: value }));
  const togglePlatform = (slot: string, choice: string) => setAnswers((prev) => {
    const cur = Array.isArray(prev[slot]) ? (prev[slot] as string[]) : [];
    return { ...prev, [slot]: cur.includes(choice) ? cur.filter((c) => c !== choice) : [...cur, choice] };
  });

  // Required questions must be answered before we can create (a required text needs text;
  // a required multi-select needs ≥1 choice).
  const canSubmitClarify = questions.every((q) => {
    if (!q.required) return true;
    const a = answers[q.slot];
    return Array.isArray(a) ? a.length > 0 : Boolean(a && String(a).trim());
  });

  const title = view === 'choose' ? 'Add a post' : view === 'clarify' ? 'A few details' : 'Create with Master Agent';

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="spread">
          <h3 style={{ margin: 0 }}>{title}</h3>
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
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
              placeholder="e.g. Short punchy Vietnamese Instagram post about our AI automation course, upbeat brand voice"
              rows={4}
            />
            {library.length > 0 && (
              <div className="field">
                <label>Product knowledge (library)</label>
                <select value={knowledgeId} disabled={busy} onChange={(e) => setKnowledgeId(e.target.value)}>
                  <option value="">Inherit from campaign</option>
                  {library.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <div className="help-text">Reuse a stored product profile — grounds copy + media on it without re-uploading.</div>
              </div>
            )}
            {busy && (
              <div className="chat-bubble agent thinking-bubble" role="status" aria-live="polite">
                <span className="thinking-copy">Thinking</span>
                <span className="thinking-dots" aria-hidden="true"><span /><span /><span /></span>
              </div>
            )}
            <div className="btn-row">
              <button className="btn primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Thinking…' : 'Continue'}</button>
              <button className="btn" disabled={busy} onClick={() => setView('choose')}>Back</button>
            </div>
          </div>
        )}

        {view === 'clarify' && (
          <div className="modal-agent">
            <p className="muted small" style={{ marginTop: 0 }}>The agent needs a bit more to make this post specific:</p>
            {questions.map((q) => (
              <div className="clarify-q" key={q.slot}>
                <label>{q.question}{q.required && <span className="req"> *</span>}</label>
                {q.multiSelect && q.choices ? (
                  <div className="platform-grid">
                    {q.choices.map((c) => {
                      const on = Array.isArray(answers[q.slot]) && (answers[q.slot] as string[]).includes(c);
                      return (
                        <button type="button" key={c} className={`check-pill ${on ? 'on' : ''}`} onClick={() => togglePlatform(q.slot, c)}>{c}</button>
                      );
                    })}
                  </div>
                ) : q.choices ? (
                  <div className="platform-grid">
                    {q.choices.map((c) => (
                      <button type="button" key={c} className={`check-pill ${answers[q.slot] === c ? 'on' : ''}`} onClick={() => setAnswer(q.slot, c)}>{c}</button>
                    ))}
                  </div>
                ) : (
                  <input
                    value={typeof answers[q.slot] === 'string' ? (answers[q.slot] as string) : ''}
                    onChange={(e) => setAnswer(q.slot, e.target.value)}
                    placeholder="Type your answer"
                  />
                )}
              </div>
            ))}
            {busy && (
              <div className="chat-bubble agent thinking-bubble" role="status" aria-live="polite">
                <span className="thinking-copy">Creating</span>
                <span className="thinking-dots" aria-hidden="true"><span /><span /><span /></span>
              </div>
            )}
            <div className="btn-row">
              <button className="btn primary" disabled={busy || !canSubmitClarify} onClick={() => void submit(answers)}>{busy ? 'Creating…' : 'Create post'}</button>
              <button className="btn" disabled={busy} onClick={() => setView('agent')}>Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
