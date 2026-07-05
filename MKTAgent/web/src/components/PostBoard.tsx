import { useCallback, useEffect, useState } from 'react';
import { api, type PostDto } from '../api/client';
import { usePostEvents } from '../hooks/use-post-events';
import { PostBriefForm } from './PostBriefForm';
import { PostCard } from './PostCard';
import { CreatePostModal } from './create-post-modal';
import { ProductKnowledgeUpload } from './product-knowledge-upload';

import type { DemoMode } from '../flow/demo-flow';

interface Props {
  campaignId: string | null;
  demoMode: DemoMode;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  selectedPostId?: string | null;
  visiblePostId?: string | null;
  onPostsChange?: (posts: PostDto[]) => void;
  // Sidebar "+" requested the create-post modal for this campaign — open it on mount.
  autoCreate?: boolean;
  onCreateConsumed?: () => void;
  onOpenConnections?: () => void;
}

export function PostBoard({ campaignId, demoMode, notify, selectedPostId, visiblePostId, onPostsChange, autoCreate, onCreateConsumed, onOpenConnections }: Props) {
  const [posts, setPosts] = useState<PostDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PostDto | null>(null);
  const [picking, setPicking] = useState(false);
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);

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

  // Honor a sidebar-requested create: open the modal once, then tell App to clear the flag
  // so it doesn't reopen on later renders.
  useEffect(() => {
    if (autoCreate && campaignId) { setPicking(true); setEditing(null); onCreateConsumed?.(); }
  }, [autoCreate, campaignId, onCreateConsumed]);

  useEffect(() => {
    if (!selectedPostId) return;
    document.getElementById(`post-${selectedPostId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedPostId, posts.length]);

  // Scroll to a post created in-board (agent-authored) once it's rendered after reload.
  useEffect(() => {
    if (!localSelectedId) return;
    document.getElementById(`post-${localSelectedId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [localSelectedId, posts.length]);

  const live = usePostEvents((e) => {
    setVisiblePosts((prev) =>
      prev.map((p) =>
        p.id === e.postId
          ? { ...p, status: e.status as PostDto['status'], postUrls: e.postUrls ?? p.postUrls, error: e.error ?? p.error }
          : p,
      ),
    );
  });

  const saved = async () => {
    setCreating(false);
    setEditing(null);
    await load();
  };

  // Master-Agent path created a post under this campaign — close the picker, reload the
  // board, and mark it selected so the effect scrolls it into view.
  const agentCreated = async (post: PostDto) => {
    setPicking(false);
    setLocalSelectedId(post.id);
    await load();
  };

  const onPatched = (p: PostDto | null, id: string) => {
    if (p) setEditing((current) => (current?.id === p.id ? p : current));
    setVisiblePosts((prev) => (p ? prev.map((x) => (x.id === id ? p : x)) : prev.filter((x) => x.id !== id)));
  };

  return (
    <div>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div className="row">
          <h2 style={{ margin: 0, fontSize: 16 }}>Posts</h2>
          <span className="row muted" style={{ fontSize: 12 }}>
            <span className={`sse-dot ${live ? 'live' : ''}`} /> {live ? 'live' : 'offline'}
          </span>
        </div>
        <button
          className="btn primary"
          disabled={!campaignId}
          onClick={() => { if (creating) { setCreating(false); } else { setPicking(true); setEditing(null); } }}
        >
          {creating ? '×' : '+ New full brief'}
        </button>
      </div>

      {campaignId && picking && (
        <CreatePostModal
          campaignId={campaignId}
          notify={notify}
          onManual={() => { setPicking(false); setEditing(null); setCreating(true); }}
          onCreated={(post) => void agentCreated(post)}
          onClose={() => setPicking(false)}
        />
      )}

      {campaignId && <ProductKnowledgeUpload campaignId={campaignId} notify={notify} />}

      {!campaignId && <p className="muted">Showing all posts. Select a campaign to create a full brief.</p>}

      {campaignId && creating && (
        <PostBriefForm
          campaignId={campaignId}
          onSaved={() => void saved()}
          onCancel={() => setCreating(false)}
          notify={notify}
        />
      )}

      {campaignId && editing && (
        <PostBriefForm
          campaignId={campaignId}
          post={editing}
          onSaved={() => void saved()}
          onCancel={() => setEditing(null)}
          notify={notify}
        />
      )}

      {loading ? (
        <div className="muted">Loading…</div>
      ) : posts.length === 0 ? (
        <p className="muted">No posts yet. {campaignId ? 'Create a full brief to start.' : ''}</p>
      ) : (
        posts.filter((p) => !visiblePostId || p.id === visiblePostId).map((p) => (
          <PostCard
            key={p.id}
            post={p}
            demoMode={demoMode}
            notify={notify}
            selected={selectedPostId === p.id || localSelectedId === p.id}
            onEdit={(post) => { setCreating(false); setEditing(post); }}
            onPatched={onPatched}
            onOpenConnections={onOpenConnections}
          />
        ))
      )}
    </div>
  );
}
