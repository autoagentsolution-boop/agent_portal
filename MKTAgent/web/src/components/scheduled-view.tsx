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

  const load = async () => {
    setLoading(true);
    const r = await api.listPosts({ limit: 100 });
    if (r.ok) setPosts(r.data);
    else notify(`Scheduled: ${r.error.error}`, 'err');
    setLoading(false);
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    <button className={`sched-row ${dueClass(when)}`} onClick={() => onOpenPost(p.campaignId, p.id)}>
      <span className={`badge ${p.status}`}>{p.status}</span>
      <span className="sched-when">{fmt(when)}</span>
      <span className="sched-platforms">{p.platforms.join(', ') || 'no platforms'}</span>
      <span className="sched-copy muted">{(p.copy?.body ?? '').replace(/\n/g, ' ').slice(0, 70) || p.id.slice(0, 8)}</span>
    </button>
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
