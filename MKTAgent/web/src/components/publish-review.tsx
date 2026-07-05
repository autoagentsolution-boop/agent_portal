// Publish review (item 3): before the publish/approve gate, show — per target platform
// — whether the post's asset type is postable there AND whether it's connected. Turns an
// opaque "Approve" into an informed check: the user sees exactly what will go where and why
// the rest is held. Fetched on mount from GET /posts/:id/postability (read-only, no network
// publish). Pairs with item 1 (the runtime skip) and item 2 (auto-publish).
import { useEffect, useState } from 'react';
import { api, type PostabilityDto, type PostabilityRowDto } from '../api/client';

interface Props {
  postId: string;
  onOpenConnections?: () => void;
}

const label = (p: string): string => p.charAt(0).toUpperCase() + p.slice(1);

const rowNote = (r: PostabilityRowDto): string => {
  if (r.willPublish) return 'Will publish';
  if (!r.assetSupported) return r.reason ?? `can't post this asset type`;
  return r.reason ?? `connection ${r.connectionState.replace('_', ' ')}`;
};

export function PublishReview({ postId, onOpenConnections }: Props) {
  const [data, setData] = useState<PostabilityDto | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await api.getPostability(postId);
      if (!live) return;
      if (r.ok) setData(r.data);
      else setErr(r.error.error);
    })();
    return () => { live = false; };
  }, [postId]);

  if (err) return <p className="muted small">Couldn't load publish review: {err}</p>;
  if (!data) return <p className="muted small">Checking where this can publish…</p>;

  const hasConnBlock = data.platforms.some((p) => !p.willPublish && p.assetSupported && p.connectionState !== 'connected');

  return (
    <div className="publish-review">
      <div className="section-title">Publish review · {data.assetType}</div>
      <ul className="publish-review-list">
        {data.platforms.map((p) => (
          <li key={p.platform} className={p.willPublish ? 'ok' : 'blocked'}>
            <span className="publish-review-icon">{p.willPublish ? '✓' : '✗'}</span>
            <span className="publish-review-platform">{label(p.platform)}</span>
            <span className="publish-review-note muted small">{rowNote(p)}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        {data.publishable.length > 0
          ? `${data.publishable.length} of ${data.platforms.length} platform(s) will receive this post.`
          : 'No platform can publish this post as-is — adjust the asset type or connect a platform.'}
      </p>
      {hasConnBlock && onOpenConnections && (
        <button className="btn small" onClick={onOpenConnections}>🔌 Fix connections</button>
      )}
    </div>
  );
}
