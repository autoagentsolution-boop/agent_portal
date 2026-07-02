import { useState } from 'react';
import { api, type PostDto, type Result } from '../api/client';
import type { DemoMode } from '../flow/demo-flow';
import { fromLocalDateTimeInput, toLocalDateTimeInput } from './form-options';
import { PostWorkflowView } from './post-workflow-view';

interface Props {
  post: PostDto;
  demoMode: DemoMode;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onEdit: (post: PostDto) => void;
  selected?: boolean;
  onPatched: (p: PostDto | null, id: string) => void;
}

const formatDate = (iso: string | null): string => iso ? new Date(iso).toLocaleString() : 'not scheduled';

// One legible line telling the user exactly where this post is in the publish lifecycle —
// the "did Publisher run / is it scheduled?" question the flow view otherwise hid.
const stageLine = (post: PostDto): { icon: string; text: string } => {
  switch (post.status) {
    case 'brief': return { icon: '📝', text: 'Draft brief — generate copy to continue' };
    case 'rework': return { icon: '↻', text: 'Reworking — regenerate with feedback' };
    case 'review': return { icon: '👁', text: 'Copy ready — awaiting your approval' };
    case 'ready': return post.scheduledAt
      ? { icon: '⏳', text: `Scheduled for ${formatDate(post.scheduledAt)} — Publisher will run` }
      : { icon: '⏳', text: 'Approved — Publisher runs on next scheduler tick' };
    case 'posting': return { icon: '⏳', text: 'Publisher running — posting now…' };
    case 'posted': return { icon: '✅', text: `Published${post.postedAt ? ` ${formatDate(post.postedAt)}` : ''}` };
    case 'partial': return { icon: '⚠', text: 'Partly published — some platforms failed' };
    case 'error': return { icon: '⛔', text: 'Publish failed — see error below' };
    default: return { icon: '•', text: post.status };
  }
};

export function PostCard({ post, demoMode, notify, onEdit, selected = false, onPatched }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [refining, setRefining] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [refineText, setRefineText] = useState('');
  const [approveAt, setApproveAt] = useState(toLocalDateTimeInput(post.scheduledAt));

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

  const approve = async () => {
    const scheduledAt = fromLocalDateTimeInput(approveAt) ?? undefined;
    await run('Approve', () => api.approve(post.id, scheduledAt));
    setScheduling(false);
  };

  const submitRefine = async () => {
    if (!refineText.trim()) return;
    await run('Refine', () => api.refine(post.id, refineText.trim()));
    setRefining(false);
    setRefineText('');
  };

  const publish = async () => {
    if (demoMode === 'safe') {
      notify('Safe Simulation is on: publish is blocked to avoid accidental real social posts. Switch to Live for the one controlled demo.', 'err');
      return;
    }
    if (!confirm(`Live publish this post to: ${post.platforms.join(', ') || 'configured platforms'}?`)) return;
    await run('Publish', () => api.publishNow(post.id));
  };

  const s = post.status;
  const stage = stageLine(post);
  // A flow-attached post (runId) generates copy via its Concept Writer DAG step (Execute),
  // not the legacy copy-gen button — showing both is the "two engines" confusion. Legacy
  // Generate stays only for run-less posts (manual, no flow).
  const isFlowPost = Boolean(post.runId);
  const canGenerate = (s === 'brief' || s === 'rework') && !isFlowPost;
  const canReview = s === 'review';
  const canPublish = s === 'ready';
  const canEdit = ['brief', 'review', 'rework', 'error'].includes(s);
  const canRefine = (s === 'review' || s === 'ready') && Boolean(post.copy);

  return (
    <div id={`post-${post.id}`} className={`card post-card ${selected ? 'selected' : ''}`}>
      <div className="spread">
        <div className="row">
          <span className={`badge ${s}`}>{s}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {post.assetType} · {post.platforms.join(', ') || 'no platforms'} · {post.language ?? 'inherit language'} · {post.lengthSpec ?? 'inherit length'}
          </span>
        </div>
        <span className="muted" style={{ fontSize: 11 }}>{post.id.slice(0, 8)}</span>
      </div>

      <div className={`stage-line st-${s}`}>
        <span className="stage-icon">{stage.icon}</span>
        <span className="stage-text">{stage.text}</span>
      </div>

      <div className="brief-summary">
        <span>Media: {post.heroFile ? post.heroFile : 'missing asset IDs'}</span>
        <span>Schedule: {formatDate(post.scheduledAt)}</span>
        {post.feedback && <span>Feedback: {post.feedback}</span>}
      </div>

      {post.copy && (
        <div style={{ marginTop: 8 }}>
          <div className="copy-box"><div className="label">Body</div><div className="text">{post.copy.body}</div></div>
          <div className="copy-box"><div className="label">Threads</div><div className="text">{post.copy.threads}</div></div>
          <div className="copy-box"><div className="label">X</div><div className="text">{post.copy.x}</div></div>
        </div>
      )}

      {post.error && <div className="copy-box" style={{ borderColor: 'var(--red)' }}><div className="label">Error</div><div className="text">{post.error}</div></div>}

      {post.runId && <PostWorkflowView runId={post.runId} notify={notify} />}

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

      {rejecting && (
        <div style={{ marginTop: 10 }}>
          <div className="field">
            <label>Rework feedback</label>
            <textarea autoFocus value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="What to change: tone, hook, CTA, length, language…" />
          </div>
          <div className="btn-row">
            <button className="btn primary" onClick={() => void submitReject()}>Send feedback</button>
            <button className="btn" onClick={() => setRejecting(false)}>Cancel</button>
          </div>
        </div>
      )}

      {scheduling && (
        <div className="approve-panel">
          <div className="field">
            <label>Approve schedule</label>
            <input type="datetime-local" value={approveAt} onChange={(e) => setApproveAt(e.target.value)} />
            <div className="help-text">Empty means ready immediately. Scheduler publishes ready posts whose time is due.</div>
          </div>
          <div className="btn-row">
            <button className="btn primary" disabled={!!busy} onClick={() => void approve()}>Approve final</button>
            <button className="btn" onClick={() => setScheduling(false)}>Cancel</button>
          </div>
        </div>
      )}

      {refining && (
        <div style={{ marginTop: 10 }}>
          <div className="field">
            <label>Refine copy (targeted edit)</label>
            <textarea autoFocus value={refineText} onChange={(e) => setRefineText(e.target.value)} placeholder="e.g. shorten the hook, add a discount mention, make the tone warmer…" />
            <div className="help-text">Applies a small change via AI (keeps audit trail). Result returns to review for re-approval.</div>
          </div>
          <div className="btn-row">
            <button className="btn primary" disabled={!!busy} onClick={() => void submitRefine()}>{busy === 'Refine' ? 'Refining…' : 'Apply refinement'}</button>
            <button className="btn" onClick={() => setRefining(false)}>Cancel</button>
          </div>
        </div>
      )}

      {!rejecting && !scheduling && !refining && (
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn" disabled={!canEdit || !!busy} onClick={() => onEdit(post)}>Edit brief</button>
          {!isFlowPost && (
            <button className="btn" disabled={!canGenerate || !!busy} onClick={() => void run('Generate', () => api.generate(post.id))}>
              {busy === 'Generate' ? '…' : 'Generate copy'}
            </button>
          )}
          <button className="btn primary" disabled={!canReview || !!busy} onClick={() => setScheduling(true)}>Approve / schedule</button>
          <button className="btn" disabled={!canRefine || !!busy} onClick={() => setRefining(true)}>Refine</button>
          <button className="btn" disabled={!canReview || !!busy} onClick={() => setRejecting(true)}>Reject + rework</button>
          <button className="btn" disabled={!canPublish || !!busy} title={demoMode === 'safe' ? 'Safe mode blocks real publishing' : 'Real social post'} onClick={() => void publish()}>
            {busy === 'Publish' ? '…' : demoMode === 'safe' ? 'Publish (safe)' : 'Publish now'}
          </button>
          <button className="btn danger" disabled={!canEdit || !!busy} onClick={() => void del()}>Delete</button>
        </div>
      )}
    </div>
  );
}
