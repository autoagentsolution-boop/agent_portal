import { useState } from 'react';
import { api, type PostDto, type Result } from '../api/client';

interface Props {
  post: PostDto;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onPatched: (p: PostDto | null, id: string) => void;
}

export function PostCard({ post, notify, onPatched }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState('');

  // Run an action helper, surface errors, patch the row on success.
  const run = async (label: string, fn: () => Promise<Result<PostDto>>) => {
    setBusy(label);
    try {
      const r = await fn();
      if (r.ok) { notify(`${label}: ${r.data.status}`); onPatched(r.data, post.id); }
      else notify(`${label} failed: ${r.error.error}${r.error.details ? ` — ${JSON.stringify(r.error.details)}` : ''}`, 'err');
    } finally { setBusy(null); }
  };

  const del = async () => {
    if (!confirm('Delete this post?')) return;
    setBusy('delete');
    const r = await api.deletePost(post.id);
    setBusy(null);
    if (r.ok) { notify('Post deleted'); onPatched(null, post.id); }
    else notify(`Delete failed: ${r.error.error}`, 'err');
  };

  const submitReject = async () => {
    if (!feedback.trim()) return;
    await run('Reject', () => api.reject(post.id, feedback.trim()));
    setRejecting(false);
    setFeedback('');
  };

  const s = post.status;
  const canGenerate = s === 'brief' || s === 'rework';
  const canReview = s === 'review';
  const canPublish = s === 'ready';
  const canEdit = ['brief', 'review', 'rework', 'error'].includes(s);

  return (
    <div className="card">
      <div className="spread">
        <div className="row">
          <span className={`badge ${s}`}>{s}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {post.assetType} · {post.platforms.join(', ') || 'no platforms'} · {post.language ?? 'lang: inherit'}
          </span>
        </div>
        <span className="muted" style={{ fontSize: 11 }}>{post.id.slice(0, 8)}</span>
      </div>

      {post.copy && (
        <div style={{ marginTop: 8 }}>
          <div className="copy-box"><div className="label">Body</div><div className="text">{post.copy.body}</div></div>
          <div className="copy-box"><div className="label">Threads</div><div className="text">{post.copy.threads}</div></div>
          <div className="copy-box"><div className="label">X</div><div className="text">{post.copy.x}</div></div>
        </div>
      )}

      {post.error && <div className="copy-box" style={{ borderColor: 'var(--red)' }}><div className="label">Error</div><div className="text">{post.error}</div></div>}

      {post.postUrls && Object.keys(post.postUrls).length > 0 && (
        <div className="copy-box">
          <div className="label">Published</div>
          <div className="text">
            {Object.entries(post.postUrls).map(([k, v]) => (
              <div key={k}><a href={v} target="_blank" rel="noreferrer">{k}</a></div>
            ))}
          </div>
        </div>
      )}

      {rejecting ? (
        <div style={{ marginTop: 10 }}>
          <div className="field">
            <label>Rework feedback</label>
            <textarea autoFocus value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="What to change…" />
          </div>
          <div className="btn-row">
            <button className="btn primary" onClick={() => void submitReject()}>Send feedback</button>
            <button className="btn" onClick={() => setRejecting(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn" disabled={!canGenerate || !!busy} onClick={() => void run('Generate', () => api.generate(post.id))}>
            {busy === 'Generate' ? '…' : 'Generate copy'}
          </button>
          <button className="btn primary" disabled={!canReview || !!busy} onClick={() => void run('Approve', () => api.approve(post.id))}>
            Approve
          </button>
          <button className="btn" disabled={!canReview || !!busy} onClick={() => setRejecting(true)}>Reject</button>
          <button className="btn" disabled={!canPublish || !!busy} title="Real social post" onClick={() => void run('Publish', () => api.publishNow(post.id))}>
            {busy === 'Publish' ? '…' : 'Publish now'}
          </button>
          <button className="btn danger" disabled={!canEdit || !!busy} onClick={() => void del()}>Delete</button>
        </div>
      )}
    </div>
  );
}
