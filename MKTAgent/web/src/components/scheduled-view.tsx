// Scheduled view — the "◷ Scheduled" surface (was a dead placeholder). Lists every post that is
// queued for automatic publishing (status `ready` with a scheduledAt) plus recently posted ones, so
// the user can SEE what the scheduler will fire and when. Read-only; click a row to open the post.
import { useEffect, useState } from 'react';
import { api, type PostDto } from '../api/client';

interface Props {
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onOpenPost: (campaignId: string, postId: string) => void;
}

const fmt = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : '— not scheduled');
const dueClass = (iso: string | null): string => (iso && new Date(iso).getTime() <= Date.now() ? 'due' : '');

export function ScheduledView({ notify, onOpenPost }: Props) {
  const [posts, setPosts] = useState<PostDto[]>([]);
  const [loading, setLoading] = useState(true);
  // Per-post autonomy grant (2-step) for planned/brief posts, right here in the Scheduled list so the
  // fanned-out posts can be handed to Atria without hunting for the Workspace dashboard.
  const [grantFor, setGrantFor] = useState<{ postId: string; credits: number; token: string } | null>(null);
  const [granting, setGranting] = useState(false);

  const load = async () => {
    setLoading(true);
    const r = await api.listPosts({ limit: 100 });
    if (r.ok) setPosts(r.data);
    else notify(`Scheduled: ${r.error.error}`, 'err');
    setLoading(false);
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startGrant = async (postId: string) => {
    setGranting(true);
    try {
      const r = await api.grantPost(postId);
      if (!r.ok) { notify(`Grant: ${r.error.error}`, 'err'); return; }
      setGrantFor({ postId, credits: Math.round(r.data.estimate.credits), token: r.data.confirmationToken ?? '' });
    } finally { setGranting(false); }
  };
  const confirmGrant = async () => {
    if (!grantFor) return;
    setGranting(true);
    try {
      const r = await api.grantPost(grantFor.postId, { confirmationToken: grantFor.token, scheduleConfirmed: true });
      if (!r.ok) { notify(`Grant: ${r.error.error}`, 'err'); return; }
      notify('Đã cấp quyền — Atria sẽ tự chuẩn bị nội dung rồi dừng ở review.');
      setGrantFor(null);
      void load();
    } finally { setGranting(false); }
  };

  // Upcoming = anything with a scheduledAt that hasn't gone out yet. `ready` posts are in the
  // scheduler's live queue; `brief`/`review` posts are planned (e.g. a materialized weekly calendar)
  // but must still be generated + approved before they publish — the badge shows which is which.
  const DONE = ['posted', 'partial', 'error'];
  const upcoming = posts
    .filter((p) => p.scheduledAt && !DONE.includes(p.status))
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
  const recent = posts
    .filter((p) => p.status === 'posted' || p.status === 'partial')
    .sort((a, b) => String(b.postedAt ?? b.updatedAt).localeCompare(String(a.postedAt ?? a.updatedAt)))
    .slice(0, 10);

  const Row = ({ p, when }: { p: PostDto; when: string | null }) => (
    <div className={`sched-row-wrap ${dueClass(when)}`}>
      <button className="sched-row" onClick={() => onOpenPost(p.campaignId, p.id)}>
        <span className={`badge ${p.status}`}>{p.status}</span>
        <span className="sched-when">{fmt(when)}</span>
        <span className="sched-platforms">{p.platforms.join(', ') || 'no platforms'}</span>
        <span className="sched-copy muted">{(p.copy?.body ?? '').replace(/\n/g, ' ').slice(0, 70) || p.id.slice(0, 8)}</span>
      </button>
      {/* A not-yet-generated (brief) campaign post → grant so Atria auto-prepares it (parks at review). */}
      {p.status === 'brief' && p.campaignId && (
        grantFor?.postId === p.id ? (
          <span className="ws-grant-confirm">
            ≈ {grantFor.credits.toLocaleString()} cr?
            <button className="ws-grant-yes" disabled={granting} onClick={() => void confirmGrant()}>Xác nhận</button>
            <button className="ws-grant-no" disabled={granting} onClick={() => setGrantFor(null)}>Huỷ</button>
          </span>
        ) : (
          <button className="ws-grant-btn" disabled={granting} title="Cấp quyền cho Atria tự chuẩn bị rồi dừng ở review" onClick={() => void startGrant(p.id)}>⚡ Chuẩn bị</button>
        )
      )}
    </div>
  );

  return (
    <div className="scheduled-view">
      <div className="spread" style={{ alignItems: 'center' }}>
        <h2>◷ Scheduled</h2>
        <button className="btn small" onClick={() => void load()}>↻ Refresh</button>
      </div>
      <p className="muted">Posts queued for automatic publishing. The scheduler publishes each `ready` post when its time is due.</p>

      <h3 style={{ marginTop: 16 }}>Upcoming ({upcoming.length})</h3>
      {loading ? <p className="muted small">Loading…</p>
        : upcoming.length === 0 ? <p className="muted small">Nothing scheduled. Approve a post with a future time at the publish gate (or set a schedule in the post brief).</p>
        : <div className="sched-list">{upcoming.map((p) => <Row key={p.id} p={p} when={p.scheduledAt} />)}</div>}

      <h3 style={{ marginTop: 20 }}>Recently published</h3>
      {recent.length === 0 ? <p className="muted small">No published posts yet.</p>
        : <div className="sched-list">{recent.map((p) => <Row key={p.id} p={p} when={p.postedAt ?? null} />)}</div>}
    </div>
  );
}
