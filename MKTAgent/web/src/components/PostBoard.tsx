import { useCallback, useEffect, useState } from 'react';
import { api, type PostDto } from '../api/client';
import { usePostEvents } from '../hooks/use-post-events';
import { PostCard } from './PostCard';

import type { DemoMode } from '../flow/demo-flow';

interface Props {
  campaignId: string | null;
  demoMode: DemoMode;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onPostsChange?: (posts: PostDto[]) => void;
}

export function PostBoard({ campaignId, demoMode, notify, onPostsChange }: Props) {
  const [posts, setPosts] = useState<PostDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const setVisiblePosts = useCallback((next: PostDto[] | ((prev: PostDto[]) => PostDto[])) => {
    setPosts((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      onPostsChange?.(value);
      return value;
    });
  }, [onPostsChange]);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api.listPosts(campaignId ? { campaignId, limit: 100 } : { limit: 100 });
    if (r.ok) setVisiblePosts(r.data);
    else notify(`Load failed: ${r.error.error}`, 'err');
    setLoading(false);
  }, [campaignId, notify, setVisiblePosts]);

  useEffect(() => { void load(); }, [load]);

  // Live status patches from SSE — update the matching row in place.
  const live = usePostEvents((e) => {
    setVisiblePosts((prev) =>
      prev.map((p) =>
        p.id === e.postId
          ? { ...p, status: e.status as PostDto['status'], postUrls: e.postUrls ?? p.postUrls, error: e.error ?? p.error }
          : p,
      ),
    );
  });

  const createBrief = async () => {
    if (!campaignId) { notify('Pick a campaign first', 'err'); return; }
    setCreating(true);
    const r = await api.createPost({ campaignId });
    setCreating(false);
    if (r.ok) { notify('Brief created'); await load(); }
    else notify(`Create failed: ${r.error.error}`, 'err');
  };

  // After a per-card action, replace that one post (or drop on delete).
  const onPatched = (p: PostDto | null, id: string) =>
    setVisiblePosts((prev) => (p ? prev.map((x) => (x.id === id ? p : x)) : prev.filter((x) => x.id !== id)));

  return (
    <div>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div className="row">
          <h2 style={{ margin: 0, fontSize: 16 }}>Posts</h2>
          <span className="row muted" style={{ fontSize: 12 }}>
            <span className={`sse-dot ${live ? 'live' : ''}`} /> {live ? 'live' : 'offline'}
          </span>
        </div>
        <button className="btn primary" disabled={!campaignId || creating} onClick={() => void createBrief()}>
          + New brief
        </button>
      </div>

      {!campaignId && <p className="muted">Showing all posts. Select a campaign to create a brief.</p>}

      {loading ? (
        <div className="muted">Loading…</div>
      ) : posts.length === 0 ? (
        <p className="muted">No posts yet. {campaignId ? 'Create a brief to start.' : ''}</p>
      ) : (
        posts.map((p) => (
          <PostCard key={p.id} post={p} demoMode={demoMode} notify={notify} onPatched={onPatched} />
        ))
      )}
    </div>
  );
}
