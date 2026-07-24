import { useState } from 'react';
import { api, type PostDto, type Result } from '../api/client';
import type { DemoMode } from '../flow/demo-flow';
import { fromLocalDateTimeInput, toLocalDateTimeInput } from './form-options';
import { PostWorkflowView } from './post-workflow-view';
import { useLocale, type MessageKey, type Params } from '../i18n';
import { tError } from '../i18n/t-error';

interface Props {
  post: PostDto;
  demoMode: DemoMode;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onEdit: (post: PostDto) => void;
  selected?: boolean;
  onPatched: (p: PostDto | null, id: string) => void;
  onOpenConnections?: () => void;
}

const formatDate = (iso: string | null): string => iso ? new Date(iso).toLocaleString() : 'not scheduled';

// One legible line telling the user exactly where this post is in the publish lifecycle —
// the "did Publisher run / is it scheduled?" question the flow view otherwise hid.
const stageLine = (post: PostDto, t: (key: MessageKey, params?: Params) => string): { icon: string; text: string } => {
  switch (post.status) {
    case 'brief': return { icon: '📝', text: t('post.stage.brief') };
    case 'rework': return { icon: '↻', text: t('post.stage.rework') };
    case 'review': return { icon: '👁', text: t('post.stage.review') };
    case 'ready': return post.scheduledAt
      ? { icon: '⏳', text: t('post.stage.ready_scheduled', { time: formatDate(post.scheduledAt) }) }
      : { icon: '⏳', text: t('post.stage.ready_now') };
    case 'posting': return { icon: '⏳', text: t('post.stage.posting') };
    case 'posted': return { icon: '✅', text: t('post.stage.posted', { time: post.postedAt ? ` ${formatDate(post.postedAt)}` : '' }) };
    case 'partial': return { icon: '⚠', text: t('post.stage.partial') };
    case 'error': return { icon: '⛔', text: t('post.stage.error') };
    default: return { icon: '•', text: post.status };
  }
};

export function PostCard({ post, demoMode, notify, onEdit, selected = false, onPatched, onOpenConnections }: Props) {
  const { t } = useLocale();
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
      else notify(tError(r.error), 'err');
    } finally { setBusy(null); }
  };

  const del = async () => {
    if (!confirm(t('confirm.delete.post'))) return;
    setBusy('delete');
    const r = await api.deletePost(post.id);
    setBusy(null);
    if (r.ok) { notify(t('post.delete.notice')); onPatched(null, post.id); }
    else notify(tError(r.error), 'err');
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
      notify(t('publish.safe_mode.blocked'), 'err');
      return;
    }
    if (!confirm(t('confirm.publish.live', { platforms: post.platforms.join(', ') || 'configured platforms' }))) return;
    await run('Publish', () => api.publishNow(post.id));
  };

  const s = post.status;
  const stage = stageLine(post, t);
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

      {post.runId && <PostWorkflowView runId={post.runId} notify={notify} onOpenConnections={onOpenConnections} />}

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
            <label>{t('post.reject.label')}</label>
            <textarea autoFocus value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={t('post.reject.placeholder')} />
          </div>
          <div className="btn-row">
            <button className="btn primary" onClick={() => void submitReject()}>{t('post.reject.send.cta')}</button>
            <button className="btn" onClick={() => setRejecting(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {scheduling && (
        <div className="approve-panel">
          <div className="field">
            <label>{t('post.schedule.label')}</label>
            <input type="datetime-local" value={approveAt} onChange={(e) => setApproveAt(e.target.value)} />
            <div className="help-text">{t('post.schedule.help')}</div>
          </div>
          <div className="btn-row">
            <button className="btn primary" disabled={!!busy} onClick={() => void approve()}>{t('post.approve_final.cta')}</button>
            <button className="btn" onClick={() => setScheduling(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {refining && (
        <div style={{ marginTop: 10 }}>
          <div className="field">
            <label>{t('post.refine.label')}</label>
            <textarea autoFocus value={refineText} onChange={(e) => setRefineText(e.target.value)} placeholder={t('post.refine.placeholder')} />
            <div className="help-text">{t('post.refine.help')}</div>
          </div>
          <div className="btn-row">
            <button className="btn primary" disabled={!!busy} onClick={() => void submitRefine()}>{busy === 'Refine' ? t('post.refine.busy') : t('post.refine.apply.cta')}</button>
            <button className="btn" onClick={() => setRefining(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {!rejecting && !scheduling && !refining && (
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn" disabled={!canEdit || !!busy} onClick={() => onEdit(post)}>{t('post.edit_brief.cta')}</button>
          {!isFlowPost && (
            <button className="btn" disabled={!canGenerate || !!busy} onClick={() => void run('Generate', () => api.generate(post.id))}>
              {busy === 'Generate' ? '…' : t('post.generate.cta')}
            </button>
          )}
          <button className="btn primary" disabled={!canReview || !!busy} onClick={() => setScheduling(true)}>{t('post.approve_schedule.cta')}</button>
          <button className="btn" disabled={!canRefine || !!busy} onClick={() => setRefining(true)}>{t('post.refine.cta')}</button>
          <button className="btn" disabled={!canReview || !!busy} onClick={() => setRejecting(true)}>{t('post.reject_rework.cta')}</button>
          <button className="btn" disabled={!canPublish || !!busy} title={demoMode === 'safe' ? t('post.publish.title.safe') : t('post.publish.title.live')} onClick={() => void publish()}>
            {busy === 'Publish' ? '…' : demoMode === 'safe' ? t('post.publish_live_only.cta') : t('post.publish_now.cta')}
          </button>
          <button className="btn danger" disabled={!canEdit || !!busy} onClick={() => void del()}>{t('common.delete')}</button>
        </div>
      )}
    </div>
  );
}
